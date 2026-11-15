/**
 * Team notes (table `team_notes`): Quick notes shared with a group of teammates.
 *
 * A Quick note is private to one person. Shared with teammates it becomes a
 * team note: everyone on it (`members`, the sharer included) reads and edits
 * the same note, and the Tasks page lists them under Quick notes, one card per
 * group ("Fionna", "Fionna & Yannick"). The database keeps `members` straight
 * (each person once, teammates only) and decides who sees a note (RLS: members).
 *
 * The pure helpers (groups, who to offer first when sharing) are tested in
 * src/test/team-notes.test.ts.
 */
import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { firstName } from "@/lib/tasks";
import { watchTasksRealtime } from "@/lib/tasks-realtime";

export type TeamNote = {
  id: string;
  /** Everyone on it (logins), in the order they were added, the sharer included. */
  members: string[];
  title: string;
  body: string;
  /** Who shared it: the only one who can take it back into their own Quick notes. */
  created_by: string | null;
  /** Who last changed the words. */
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export const TEAM_NOTES_KEY = ["team-notes"] as const;

const table = () => (supabase as any).from("team_notes");
const COLS = "id, members, title, body, created_by, updated_by, created_at, updated_at";

// ---------------------------------------------------------------- database

export async function fetchTeamNotes(): Promise<TeamNote[]> {
  const { data, error } = await table().select(COLS).order("updated_at", { ascending: false }).limit(1000);
  if (error) throw error;
  return (data ?? []) as TeamNote[];
}

/** A new team note (or one put back by Undo, with its own id and dates). */
export async function insertTeamNote(input: {
  id?: string; members: string[]; title: string; body: string;
  created_by?: string | null; created_at?: string; updated_at?: string;
}): Promise<TeamNote> {
  const row: Record<string, unknown> = { members: input.members, title: input.title, body: input.body };
  if (input.id) row.id = input.id;
  if (input.created_by) row.created_by = input.created_by;
  if (input.created_at) row.created_at = input.created_at;
  if (input.updated_at) row.updated_at = input.updated_at;
  const { data, error } = await table().insert(row).select(COLS).single();
  if (error) throw error;
  return data as TeamNote;
}

/** Words or people. Resolves to the note as saved (the database stamps who and when). */
export async function updateTeamNote(id: string, patch: Partial<Pick<TeamNote, "title" | "body" | "members">>): Promise<TeamNote> {
  const { data, error } = await table().update(patch).eq("id", id).select(COLS).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This note isn't shared with you any more.");
  return data as TeamNote;
}

export async function deleteTeamNote(id: string): Promise<void> {
  const { error } = await table().delete().eq("id", id);
  if (error) throw error;
}

/** Take yourself off a note; it stays with everyone else. */
export async function leaveTeamNote(id: string): Promise<void> {
  const { error } = await (supabase as any).rpc("team_note_leave", { _id: id });
  if (error) throw error;
}

/**
 * Every team note the signed-in person is on, kept fresh from any device
 * (realtime with `live`, rebuilt on app resume like the task board).
 */
export function useTeamNotes(enabled: boolean, { live = false }: { live?: boolean } = {}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: TEAM_NOTES_KEY, queryFn: fetchTeamNotes, enabled, staleTime: 30_000 });
  // One live channel per page: the section that lists the notes opens it.
  useEffect(() => {
    if (!enabled || !live) return;
    return watchTasksRealtime({
      client: supabase,
      name: "team-notes-rt",
      table: "team_notes",
      onChange: () => { qc.invalidateQueries({ queryKey: TEAM_NOTES_KEY }); },
    });
  }, [enabled, live, qc]);
  /** Change the cached list straight away (the save follows). */
  const patch = useCallback((fn: (rows: TeamNote[]) => TeamNote[]) => {
    qc.setQueryData<TeamNote[]>(TEAM_NOTES_KEY, (prev) => fn(prev ?? []));
  }, [qc]);
  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: TEAM_NOTES_KEY }); }, [qc]);
  return { notes: q.data ?? [], ready: q.isSuccess, error: q.isError, patch, refresh };
}

// ---------------------------------------------------------------- groups

/** The same people, whatever order they were added in. */
export function groupKey(people: string[]): string {
  return [...new Set(people.filter(Boolean))].sort().join(",");
}

/** Everyone on it but me. */
export const othersIn = (members: string[], me: string | null) => members.filter((u) => u && u !== me);

export type TeamNoteGroup = {
  key: string;
  /** Everyone in the group but me, in the order the latest note has them. */
  others: string[];
  /** Newest edit first. */
  notes: TeamNote[];
  /** When the group last changed (ms). */
  latest: number;
};

const ts = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);

/** One group per set of people (me aside), the group edited most recently first. */
export function groupTeamNotes(notes: TeamNote[], me: string | null): TeamNoteGroup[] {
  const byKey = new Map<string, TeamNoteGroup>();
  const sorted = [...notes].sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  for (const n of sorted) {
    const others = othersIn(n.members, me);
    const key = groupKey(others);
    const g = byKey.get(key);
    if (g) g.notes.push(n);
    else byKey.set(key, { key, others, notes: [n], latest: ts(n.updated_at) });
  }
  return [...byKey.values()].sort((a, b) => b.latest - a.latest);
}

/**
 * Who to offer first when sharing a note, as one-tap choices: the groups shared
 * with last (remembered on this device, newest first), then the groups that
 * have notes, then each teammate alone. Only people still on the team; never
 * an empty group; each group once.
 */
export function shareTargets(opts: {
  remembered: string[][];
  notes: TeamNote[];
  teamIds: string[];
  me: string | null;
  limit?: number;
}): string[][] {
  const team = new Set(opts.teamIds.filter((u) => u !== opts.me));
  const out: string[][] = [];
  const seen = new Set<string>();
  const offer = (people: string[]) => {
    const others = [...new Set(people)].filter((u) => u !== opts.me);
    if (!others.length || others.some((u) => !team.has(u))) return;
    const key = groupKey(others);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(others);
  };
  for (const g of opts.remembered) offer(g);
  for (const g of groupTeamNotes(opts.notes, opts.me)) offer(g.others);
  for (const u of team) offer([u]);
  return out.slice(0, opts.limit ?? 3);
}

/** Put a group first in the remembered list (each group once, newest first). */
export function rememberGroup(list: string[][], people: string[], max = 6): string[][] {
  const key = groupKey(people);
  if (!key) return list;
  return [people, ...list.filter((g) => groupKey(g) !== key)].slice(0, max);
}

/** "Fionna", "Fionna & Yannick", "Fionna, Yannick & Steph", "Fionna, Yannick +2". */
export function groupLabel(names: string[]): string {
  const n = names.map((x) => firstName(x)).filter(Boolean);
  if (n.length === 0) return "Only you";
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} & ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} & ${n[2]}`;
  return `${n[0]}, ${n[1]} +${n.length - 2}`;
}

/** The members after the people picker: me kept where I was, the others as picked. */
export function membersAfterPick(current: string[], picked: string[], me: string | null): string[] {
  const keep = current.filter((u) => u === me || picked.includes(u));
  const added = picked.filter((u) => u !== me && !keep.includes(u));
  const out = [...keep, ...added];
  return me && !out.includes(me) ? [me, ...out] : out;
}

// ---------------------------------------------------------------- remembered groups (this device)

const REMEMBER_KEY = (userId: string) => `jf-team-note-groups:${userId}`;

export function readRememberedGroups(userId: string | null): string[][] {
  if (!userId) return [];
  try {
    const v = JSON.parse(localStorage.getItem(REMEMBER_KEY(userId)) ?? "[]");
    return Array.isArray(v) ? v.filter((g) => Array.isArray(g) && g.every((u) => typeof u === "string")) : [];
  } catch {
    return [];
  }
}

export function saveRememberedGroup(userId: string | null, people: string[]) {
  if (!userId) return;
  try {
    localStorage.setItem(REMEMBER_KEY(userId), JSON.stringify(rememberGroup(readRememberedGroups(userId), people)));
  } catch { /* storage unavailable: the groups with notes still come first */ }
}
