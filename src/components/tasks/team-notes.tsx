/**
 * Team notes: Quick notes shared with a group of teammates, right under Quick
 * notes on the Tasks page (the panel renders this section).
 *
 * - One card per group ("Fionna", "Fionna & Yannick"), the group edited most
 *   recently first; its + starts a note for the same people in one tap.
 * - Everyone on a note reads and edits it; a teammate's edit shows up live
 *   (realtime) unless you're typing in it.
 * - Remove from team (whoever shared it) takes it back into your Quick notes
 *   and off everyone else's list, with Undo. Anyone else can Leave it.
 * - People… changes who it's for; whoever's added gets one push.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ChevronDown, Copy, LogOut, Plus, RotateCcw, Trash2, Undo2, Users } from "lucide-react";
import { toast } from "sonner";
import { firstName, type TeamMember } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { TaskSwipeRow } from "@/components/tasks/task-swipe-row";
import { NoteEditor, RowMenu, copyText, type SaveState } from "@/components/tasks/note-editor";
import { TeamPeopleDialog } from "@/components/tasks/team-people-dialog";
import { hasText, noteHeading, noteMatches, notePreview } from "@/lib/note-text";
import {
  deleteTeamNote, groupKey, groupLabel, groupTeamNotes, insertTeamNote, leaveTeamNote, membersAfterPick, othersIn,
  saveRememberedGroup, updateTeamNote, useTeamNotes, type TeamNote,
} from "@/lib/team-notes";
import { notifyTeamNoteSharedFn } from "@/lib/team-notes.functions";

/** Notes shown per group before "Show all". */
const GROUP_ROWS = 3;

const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/** Tell whoever was just put on these notes (never me). Best effort. */
export function announceTeamNotes(noteIds: string[], to: string[], me: string | null) {
  const people = [...new Set(to)].filter((u) => u && u !== me);
  if (!noteIds.length || !people.length) return;
  void notifyTeamNoteSharedFn({ data: { noteIds, to: people } }).catch(() => {});
}

/** Round initials: who a group is, at a glance. */
function Faces({ names }: { names: string[] }) {
  return (
    <span aria-hidden className="inline-flex -space-x-1">
      {names.slice(0, 3).map((n, i) => (
        <span key={`${n}-${i}`} className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[10px] font-bold uppercase text-foreground ring-2 ring-card">
          {firstName(n).slice(0, 1) || "?"}
        </span>
      ))}
    </span>
  );
}

/** Whoever shared it can take it back; a note from before that person left can be taken by anyone on it. */
export const canTakeBack = (n: Pick<TeamNote, "created_by" | "members">, me: string | null) =>
  !!me && (n.created_by === me || !n.created_by || !n.members.includes(n.created_by));

type PeopleDialog =
  | { mode: "new"; initial: string[] }
  | { mode: "edit"; note: TeamNote };

export function TeamNotesSection({
  me, teamMembers, search = "", targets, collapsed, onToggleCollapsed, toQuickNotes, dropQuickNote,
}: {
  me: string | null;
  teamMembers: TeamMember[];
  search?: string;
  /** One-tap groups for a new note, newest first. */
  targets: string[][];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Put words into my own Quick notes; resolves to the new note's id. */
  toQuickNotes: (t: { title: string; body: string }) => string;
  /** Take a note toQuickNotes just made back out (Undo). */
  dropQuickNote: (id: string) => void;
}) {
  const { notes, ready, error, patch, refresh } = useTeamNotes(!!me, { live: true });
  const [openId, setOpenId] = useState<string | null>(null);
  /** A note being started: not in the database until something's written in it. */
  const [draft, setDraft] = useState<TeamNote | null>(null);
  const [people, setPeople] = useState<PeopleDialog | null>(null);
  const [leaving, setLeaving] = useState<TeamNote | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const nameOf = useCallback(
    (u: string) => (u === me ? "Me" : teamMembers.find((m) => m.user_id === u)?.full_name || "Teammate"),
    [teamMembers, me],
  );
  const labelOf = useCallback((others: string[]) => groupLabel(others.map(nameOf)), [nameOf]);

  const searching = search.trim().length > 0;
  const shown = useMemo(() => notes.filter((n) => noteMatches(n, search)), [notes, search]);
  const groups = useMemo(() => groupTeamNotes(shown, me), [shown, me]);
  const isCollapsed = collapsed && !searching;
  const hasTeam = teamMembers.some((m) => m.user_id !== me);

  // A push for a shared note opens it (#note=<id>).
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || typeof window === "undefined" || !ready) return;
    deepLinked.current = true;
    const id = window.location.hash.match(/(?:^#|&)note=([0-9a-f-]{36})/i)?.[1];
    if (!id) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (notes.some((n) => n.id === id)) setOpenId(id);
    else toast("That note isn't shared with you any more.");
  }, [ready, notes]);

  const startNote = (others: string[]) => {
    if (!me) return;
    const now = new Date().toISOString();
    setDraft({ id: newId(), members: [me, ...others.filter((u) => u !== me)], title: "", body: "", created_by: me, updated_by: me, created_at: now, updated_at: now });
  };

  const removeFromTeam = async (n: TeamNote) => {
    const qid = toQuickNotes({ title: n.title, body: n.body });
    patch((rows) => rows.filter((r) => r.id !== n.id));
    if (openId === n.id) setOpenId(null);
    try {
      await deleteTeamNote(n.id);
    } catch {
      dropQuickNote(qid);
      refresh();
      toast.error("Couldn't take it off the team. Try again.");
      return;
    }
    const others = othersIn(n.members, me);
    toast.success("Moved to your Quick notes", {
      description: others.length ? `${labelOf(others)} no longer ${others.length > 1 ? "see" : "sees"} it.` : undefined,
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            const back = await insertTeamNote(n);
            patch((rows) => [back, ...rows.filter((r) => r.id !== back.id)]);
            dropQuickNote(qid);
          } catch {
            toast.error("Couldn't put it back on the team. It's still in your Quick notes.");
          }
        },
      },
    });
  };

  const removeNote = async (n: TeamNote) => {
    patch((rows) => rows.filter((r) => r.id !== n.id));
    if (openId === n.id) setOpenId(null);
    try {
      await deleteTeamNote(n.id);
    } catch {
      refresh();
      toast.error("Couldn't delete the note. Try again.");
      return;
    }
    const others = othersIn(n.members, me);
    toast("Note deleted", {
      description: others.length ? `Gone for ${labelOf(others)} too.` : undefined,
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            const back = await insertTeamNote(n);
            patch((rows) => [back, ...rows.filter((r) => r.id !== back.id)]);
          } catch {
            toast.error("Couldn't bring it back.");
          }
        },
      },
    });
  };

  const leave = async (n: TeamNote) => {
    setLeaving(null);
    patch((rows) => rows.filter((r) => r.id !== n.id));
    if (openId === n.id) setOpenId(null);
    try {
      await leaveTeamNote(n.id);
      toast.success("You left the note");
    } catch {
      refresh();
      toast.error("Couldn't leave the note. Try again.");
    }
  };

  const savePeople = async (n: TeamNote, picked: string[]) => {
    const members = membersAfterPick(n.members, picked, me);
    if (groupKey(members) === groupKey(n.members)) return;
    patch((rows) => rows.map((r) => (r.id === n.id ? { ...r, members } : r)));
    try {
      const saved = await updateTeamNote(n.id, { members });
      patch((rows) => rows.map((r) => (r.id === saved.id ? saved : r)));
      saveRememberedGroup(me, othersIn(saved.members, me));
      announceTeamNotes([n.id], saved.members.filter((u) => !n.members.includes(u)), me);
      const others = othersIn(saved.members, me);
      toast.success(others.length ? `Shared with ${labelOf(others)}` : "Only you on it now");
    } catch (e: any) {
      refresh();
      toast.error(e?.message ?? "Couldn't change who it's for.");
    }
  };

  const menuFor = (n: TeamNote) => (
    <>
      <DropdownMenuItem onClick={() => setPeople({ mode: "edit", note: n })}>
        <Users className="mr-2 h-4 w-4" />People…
      </DropdownMenuItem>
      {canTakeBack(n, me) ? (
        <DropdownMenuItem onClick={() => void removeFromTeam(n)}>
          <Undo2 className="mr-2 h-4 w-4" />Remove from team
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onClick={() => setLeaving(n)}>
          <LogOut className="mr-2 h-4 w-4" />Leave
        </DropdownMenuItem>
      )}
    </>
  );

  const openNote = draft ?? notes.find((n) => n.id === openId) ?? null;

  // No team and nothing shared: nothing to show.
  if (!me || (!hasTeam && notes.length === 0)) return null;
  if (searching && ready && shown.length === 0) return null;

  return (
    <section aria-label="Team notes" data-team-notes>
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
          className="-ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1.5 text-left"
        >
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isCollapsed && "-rotate-90")} />
          <h2 className="text-sm font-semibold text-foreground">Team notes</h2>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground/70">
            {searching ? `${shown.length}/${notes.length}` : notes.length}
          </span>
        </button>
        {hasTeam && (
          <Button
            variant="ghost" size="icon" className="ml-auto h-9 w-9 text-muted-foreground"
            aria-label="New team note" onClick={() => setPeople({ mode: "new", initial: targets[0] ?? [] })}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {!isCollapsed && (
        !ready ? (
          error ? (
            <button
              type="button"
              onClick={refresh}
              className="mt-1 flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4 shrink-0" />
              Couldn&apos;t load team notes. Tap to try again.
            </button>
          ) : (
            <div className="mt-1 h-[52px] jf-skeleton rounded-xl bg-card ring-1 ring-border" aria-label="Loading team notes" />
          )
        ) : groups.length === 0 ? (
          <div className="mt-1 rounded-xl border border-dashed border-border px-3 py-3">
            <p className="text-xs text-muted-foreground">
              Share a quick note from its ⋯ and it lands here, grouped by who it&apos;s with.
            </p>
            {targets.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {targets.map((g) => (
                  <button
                    key={groupKey(g)}
                    type="button"
                    onClick={() => startNote(g)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />Note for {labelOf(g)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-1 space-y-2">
            {groups.map((g) => {
              const open = expanded.has(g.key) || searching;
              const rows = open ? g.notes : g.notes.slice(0, GROUP_ROWS);
              const more = g.notes.length > GROUP_ROWS && !searching;
              const names = g.others.map(nameOf);
              return (
                <div key={g.key} className="overflow-hidden rounded-xl bg-card ring-1 ring-border" data-team-group={g.key}>
                  <div className="flex items-center gap-2 border-b border-border/70 py-1 pl-3 pr-1">
                    {names.length > 0 && <Faces names={names} />}
                    <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{groupLabel(names)}</span>
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">{g.notes.length}</span>
                    <Button
                      variant="ghost" size="icon" className="ml-auto h-9 w-9 text-muted-foreground"
                      aria-label={`New note for ${groupLabel(names)}`} onClick={() => startNote(g.others)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <ul>
                    {rows.map((n, i) => {
                      const preview = notePreview(n);
                      const editor = n.updated_by && n.updated_by !== me ? firstName(nameOf(n.updated_by)) : "";
                      return (
                        <li key={n.id} className={cn(i > 0 && "border-t border-border/70")}>
                          <TaskSwipeRow onSwipeLeft={() => void removeNote(n)}>
                            <div className="flex items-center gap-2 pl-3 pr-1">
                              <button type="button" className="min-w-0 flex-1 py-2.5 text-left" onClick={() => setOpenId(n.id)}>
                                <div className="truncate text-sm font-semibold leading-snug">{noteHeading(n)}</div>
                                <div className="truncate text-xs leading-snug text-muted-foreground">
                                  {editor && <span className="font-medium text-foreground/70">{editor} · </span>}
                                  {preview || "No additional text"}
                                </div>
                              </button>
                              <RowMenu label="Team note actions">
                                {menuFor(n)}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={async () => { if (await copyText(n.body || n.title)) toast.success("Copied ✓"); }}>
                                  <Copy className="mr-2 h-4 w-4" />Copy
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive" onClick={() => void removeNote(n)}>
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              </RowMenu>
                            </div>
                          </TaskSwipeRow>
                        </li>
                      );
                    })}
                    {more && (
                      <li className="border-t border-border/70">
                        <button
                          type="button"
                          onClick={() => setExpanded((s) => { const x = new Set(s); if (x.has(g.key)) x.delete(g.key); else x.add(g.key); return x; })}
                          className="w-full px-3 py-2 text-left text-xs font-semibold text-primary"
                        >
                          {open ? "Show less" : `Show all ${g.notes.length}`}
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        )
      )}

      {openNote && (
        <TeamNoteEditor
          key={openNote.id}
          note={openNote}
          isDraft={!!draft}
          inList={notes.some((n) => n.id === openNote.id)}
          me={me}
          labelOf={labelOf}
          onSaved={(row, wasNew, stillOpen) => {
            patch((rows) => [row, ...rows.filter((r) => r.id !== row.id)]);
            if (wasNew) {
              // The draft is now a real note: keep it open (unless Done was tapped while it saved).
              if (stillOpen) { setDraft(null); setOpenId(row.id); }
              saveRememberedGroup(me, othersIn(row.members, me));
              announceTeamNotes([row.id], row.members, me);
            }
          }}
          onClose={() => { setDraft(null); setOpenId(null); }}
          onDelete={() => { if (draft) setDraft(null); else void removeNote(openNote); }}
          onPeople={() => !draft && setPeople({ mode: "edit", note: openNote })}
          menuFor={draft ? undefined : menuFor}
        />
      )}

      <TeamPeopleDialog
        open={!!people}
        title={people?.mode === "edit" ? "Who it's for" : "New team note"}
        description={people?.mode === "edit" ? noteHeading(people.note) : undefined}
        teamMembers={teamMembers}
        me={me}
        initial={people?.mode === "edit" ? othersIn(people.note.members, me) : people?.initial ?? []}
        groups={targets}
        confirmLabel={people?.mode === "edit" ? "Save" : "Start note"}
        onClose={() => setPeople(null)}
        onConfirm={({ people: picked }) => {
          const p = people;
          setPeople(null);
          if (!p) return;
          if (p.mode === "new") startNote(picked);
          else void savePeople(p.note, picked);
        }}
      />

      <Dialog open={!!leaving} onOpenChange={(o) => !o && setLeaving(null)}>
        <DialogContent className="z-[90] max-w-sm">
          <DialogHeader>
            <DialogTitle>Leave this note?</DialogTitle>
            <DialogDescription>
              {leaving ? `${labelOf(othersIn(leaving.members, me))} keep${othersIn(leaving.members, me).length > 1 ? "" : "s"} it. Someone on it can add you back.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLeaving(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => leaving && void leave(leaving)}>Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------- editor

/**
 * A team note open in the editor. Saves as you type (debounced, and before it
 * closes); a teammate's edit comes in live while nothing of yours is unsaved.
 * A note being started is created on the first save with something in it.
 */
function TeamNoteEditor({
  note, isDraft, inList, me, labelOf, onSaved, onClose, onDelete, onPeople, menuFor,
}: {
  note: TeamNote;
  isDraft: boolean;
  /** On my list of team notes (a note being started isn't, until it's saved). */
  inList: boolean;
  me: string | null;
  labelOf: (others: string[]) => string;
  onSaved: (row: TeamNote, wasNew: boolean, stillOpen: boolean) => void;
  onClose: () => void;
  onDelete: () => void;
  onPeople: () => void;
  /** The note's own actions, given the words as they are on screen. */
  menuFor?: (n: TeamNote) => React.ReactNode;
}) {
  const [text, setText] = useState({ title: note.title, body: note.body });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  /** The words as the database has them. */
  const saved = useRef({ title: note.title, body: note.body });
  const created = useRef(!isDraft);
  const latest = useRef(text);
  latest.current = text;
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const closed = useRef(false);

  const pending = () => latest.current.title !== saved.current.title || latest.current.body !== saved.current.body;

  const save = useCallback(async (): Promise<void> => {
    if (running.current) { again.current = true; return running.current; }
    if (!pending()) return;
    const sending = { ...latest.current };
    if (!created.current && !hasText(sending)) return;
    const run = (async () => {
      setSaveState("saving");
      try {
        const wasNew = !created.current;
        const row = wasNew
          ? await insertTeamNote({ id: note.id, members: note.members, title: sending.title, body: sending.body })
          : await updateTeamNote(note.id, sending);
        created.current = true;
        saved.current = sending;
        setSaveState("saved");
        onSaved(row, wasNew, !closed.current);
      } catch {
        setSaveState("error");
      }
    })();
    running.current = run;
    await run;
    running.current = null;
    if (again.current) { again.current = false; await save(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.members]);

  // Save a beat after the last keystroke.
  useEffect(() => {
    if (!pending()) return;
    const t = window.setTimeout(() => void save(), 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, save]);

  // A teammate's edit comes in while nothing of mine is waiting to save.
  useEffect(() => {
    if (pending() || running.current) return;
    if (note.title !== saved.current.title || note.body !== saved.current.body) {
      saved.current = { title: note.title, body: note.body };
      setText({ title: note.title, body: note.body });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.title, note.body, note.updated_at]);

  // Never lose the last keystrokes when the app is hidden.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void save(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [save]);

  // Deleted, or someone took me off it, while it was open.
  const listed = useRef(false);
  if (inList) listed.current = true;
  const gone = listed.current && !inList;
  const warned = useRef(false);
  useEffect(() => {
    if (!gone || warned.current) return;
    warned.current = true;
    toast("This note was deleted or isn't shared with you any more.", {
      description: pending() ? "What you typed is still on screen: copy it before you close." : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone]);

  const close = useCallback(() => {
    closed.current = true;
    void save();
    onClose();
  }, [save, onClose]);

  const others = othersIn(note.members, me);
  return (
    <NoteEditor
      note={text}
      saveState={saveState}
      backLabel="Team notes"
      onChange={(p) => setText((t) => ({ ...t, ...p }))}
      onClose={close}
      onDelete={onDelete}
      menu={menuFor ? menuFor({ ...note, ...text }) : (
        <DropdownMenuItem disabled>
          <Users className="mr-2 h-4 w-4" />For {labelOf(others)}
        </DropdownMenuItem>
      )}
      chip={
        <button
          type="button"
          onClick={onPeople}
          disabled={isDraft}
          className="mb-2 inline-flex w-fit max-w-full shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[12px] font-semibold text-foreground active:opacity-70 disabled:opacity-100"
          title="Who it's for"
        >
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{others.length ? `With ${labelOf(others)}` : "Only you"}</span>
          {!isDraft && <span className="shrink-0 font-normal text-muted-foreground">· change</span>}
        </button>
      }
    />
  );
}
