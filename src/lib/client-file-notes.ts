/**
 * Client file notes: notes staff keep on a client's profile (table `client_file_notes`).
 *
 * A Quick Note (Task Manager) can be linked to a client. While linked it syncs both ways:
 * edits in Quick Notes update the client copy, and edits made on the client file flow back
 * the next time Quick Notes loads. Deleting the Quick Note (or moving it to the matrix)
 * archives the client copy instead of removing it, so the client file never loses history.
 */
import { supabase } from "@/integrations/supabase/client";

export type ClientFileNote = {
  id: string;
  client_id: string;
  author_id: string;
  title: string;
  body: string;
  pinned: boolean;
  source: "client_file" | "quick_note";
  quick_note_id: string | null;
  archived_at: string | null;
  archive_reason: "manual" | "quick_note_removed" | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

const table = () => (supabase as any).from("client_file_notes");
const COLS = "id, client_id, author_id, title, body, pinned, source, quick_note_id, archived_at, archive_reason, created_at, updated_at, updated_by";

export const clientFileNotesKey = (clientId: string) => ["client-file-notes", clientId] as const;

export async function listClientFileNotes(clientId: string): Promise<ClientFileNote[]> {
  const { data, error } = await table().select(COLS).eq("client_id", clientId).order("updated_at", { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as ClientFileNote[];
}

export async function addClientFileNote(clientId: string, title: string, body: string): Promise<ClientFileNote> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await table()
    .insert({ client_id: clientId, author_id: auth.user?.id, title: title.trim(), body: body.trim(), source: "client_file" })
    .select(COLS).single();
  if (error) throw error;
  return data as ClientFileNote;
}

export async function updateClientFileNote(id: string, patch: Partial<Pick<ClientFileNote, "title" | "body" | "pinned">>) {
  const { error } = await table().update(patch).eq("id", id);
  if (error) throw error;
}

export async function setClientFileNoteArchived(id: string, archived: boolean) {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await table()
    .update(archived
      ? { archived_at: new Date().toISOString(), archived_by: auth.user?.id ?? null, archive_reason: "manual", pinned: false }
      : { archived_at: null, archived_by: null, archive_reason: null })
    .eq("id", id);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Quick Note sync                                                     */
/* ------------------------------------------------------------------ */

/** Create or update the client copy of a linked Quick Note (one copy per note). */
export async function pushQuickNote(n: { id: string; clientId: string; title: string; body: string }) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { error } = await table().upsert(
    { author_id: uid, quick_note_id: n.id, client_id: n.clientId, title: n.title, body: n.body, source: "quick_note" },
    { onConflict: "author_id,quick_note_id" },
  );
  if (error) throw error;
}

/**
 * The Quick Note left (deleted / moved to the matrix) or came back. Leaving archives the
 * client copy; coming back only un-archives what Quick Notes itself archived, never a note
 * a coach archived by hand.
 */
export async function setQuickNoteRemoved(quickNoteId: string, removed: boolean) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const q = table();
  const { error } = removed
    ? await q.update({ archived_at: new Date().toISOString(), archived_by: uid, archive_reason: "quick_note_removed", pinned: false })
        .eq("author_id", uid).eq("quick_note_id", quickNoteId).is("archived_at", null)
    : await q.update({ archived_at: null, archived_by: null, archive_reason: null })
        .eq("author_id", uid).eq("quick_note_id", quickNoteId).eq("archive_reason", "quick_note_removed");
  if (error) throw error;
}

/** Stop syncing: the client copy stays on the file as a normal note. */
export async function unlinkQuickNote(quickNoteId: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const { error } = await table().update({ quick_note_id: null }).eq("author_id", uid).eq("quick_note_id", quickNoteId);
  if (error) throw error;
}

/** Server copies of my linked Quick Notes, to pull edits made on the client file. */
export async function fetchLinkedCopies(quickNoteIds: string[]): Promise<Array<Pick<ClientFileNote, "quick_note_id" | "client_id" | "title" | "body" | "updated_at" | "updated_by" | "archived_at" | "archive_reason">>> {
  if (!quickNoteIds.length) return [];
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];
  const { data, error } = await table()
    .select("quick_note_id, client_id, title, body, updated_at, updated_by, archived_at, archive_reason")
    .eq("author_id", uid).in("quick_note_id", quickNoteIds);
  if (error) throw error;
  return data ?? [];
}

/* ------------------------------------------------------------------ */
/* Pure helpers (tested)                                               */
/* ------------------------------------------------------------------ */

/** Pinned first, then most recently changed — new stuff on top. */
export function sortActive<T extends Pick<ClientFileNote, "pinned" | "updated_at">>(notes: T[]): T[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
}

/** Most recently archived first. */
export function sortArchived<T extends Pick<ClientFileNote, "archived_at" | "updated_at">>(notes: T[]): T[] {
  return [...notes].sort((a, b) => (b.archived_at ?? b.updated_at).localeCompare(a.archived_at ?? a.updated_at));
}

/** "New" for 48h after a note lands on the file. */
export function isFresh(createdAt: string, now = Date.now()): boolean {
  return now - Date.parse(createdAt) < 48 * 3600 * 1000;
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Clients a note is probably about: first (or full) name mentioned in the note, tolerant of
 * one typo for names of 4+ letters ("Colton" → Colten). Best matches first.
 */
export function suggestClients<T extends { id: string; full_name: string | null }>(text: string, clients: T[], max = 3): T[] {
  const words = text.toLowerCase().replace(/[^a-zÀ-ɏ'\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return [];
  const scored: Array<{ c: T; score: number }> = [];
  for (const c of clients) {
    const parts = (c.full_name ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const first = parts[0];
    if (!first || first.length < 3) continue;
    const last = parts.length > 1 ? parts[parts.length - 1] : null;
    let score = 0;
    if (words.includes(first)) score = 3;
    else if (first.length >= 4 && words.some((w) => editDistanceAtMost1(w, first))) score = 2;
    if (score && last && words.includes(last)) score += 2;
    if (score) scored.push({ c, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((s) => s.c);
}
