/**
 * Quick Notes — lightweight Apple-Notes-style capture inside the Task Manager.
 *
 * - Light list (title + one-line preview), collapsible section, sorted by
 *   most recently edited and capped to a few rows so it can live at the top
 *   of the Task Manager without burying the tasks.
 * - New notes come from a floating compose button (bottom-right, thumb
 *   reach on mobile, always visible on desktop), like Apple Notes.
 * - Tapping a note opens a dedicated editor: full screen on mobile (sized to
 *   the visual viewport so the keyboard never covers the text), a large
 *   centered panel on desktop.
 * - Private to the person: notes live in the database under their account
 *   (see useNotes), so they follow them across devices and nobody else, not
 *   even the owner's "view as", ever sees them.
 * - Share with team: one tap on a group shared with before ("Fionna") makes
 *   it a team note for those people, listed under Quick notes by group (see
 *   team-notes.tsx); "Choose people…" picks anyone, as a team note or a task.
 *   One tap on a quadrant tile files it in My tasks (private). Either way the
 *   note moves to Recently Deleted, with Undo that puts everything back.
 * - Delete (swipe left, row menu, editor menu, bulk) moves a note to
 *   Recently Deleted with an Undo toast. Trashed notes are restorable for
 *   30 days, then purged on the next load. Trash is just a `deletedAt`
 *   stamp on the same stored note, so nothing else about storage changes.
 * - Auto-saves (debounced, flushed on close / page hide) with a quiet
 *   Saving… / Saved indicator. Notes saved on a device before this carry
 *   over into the account on first open.
 * - Save to client file: a note can be linked to a client. It then syncs to
 *   their profile (client_file_notes) both ways. Deleting it here (or moving
 *   it to the matrix) archives the client copy; it is never lost from their file.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal, Trash2, ChevronDown, Copy, CheckSquare, Files, SquarePen,
  RotateCcw, ArrowRightLeft, UserRound, UserRoundPlus, ExternalLink, Link2Off, Users, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { QUADRANTS, firstName, type TaskQuadrant, type TeamMember } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { TaskSwipeRow } from "@/components/tasks/task-swipe-row";
import { useOpenClientProfile } from "@/lib/open-client-profile";
import { fetchLinkedCopies, pushQuickNote, setQuickNoteRemoved, unlinkQuickNote } from "@/lib/client-file-notes";
import { ClientLinkDialog } from "@/components/tasks/client-link-dialog";
import { deleteQuickNotes, fetchMyQuickNotes, noteSignature, upsertQuickNotes } from "@/lib/quick-notes-db";
import { MenuLabel, NoteEditor, RowMenu, copyText, useIsDesktop, useMounted, type SaveState } from "@/components/tasks/note-editor";
import { TeamPeopleDialog } from "@/components/tasks/team-people-dialog";
import { TeamNotesSection, announceTeamNotes } from "@/components/tasks/team-notes";
import { hasText, noteHeading, noteMatches, notePreview, noteToTask, sortByRecent } from "@/lib/note-text";
import {
  deleteTeamNote, groupLabel, insertTeamNote, othersIn, readRememberedGroups, saveRememberedGroup, shareTargets, useTeamNotes,
} from "@/lib/team-notes";

// Shared with Team notes; still exported from here for the tests and older imports.
export { noteHeading, noteMatches, notePreview, noteToTask, sortByRecent };
export type { SaveState };

/** `deletedAt` set ⇒ the note is in Recently Deleted. */
export type Note = {
  id: string; title: string; body: string; updatedAt: number; deletedAt?: number;
  /** Linked client: the note syncs to their client file. */
  clientId?: string; clientName?: string;
};
type QuadStyle = { color: string; title: string; subtitle: string };
/** Where a note goes as a task: My tasks (private) or the team board, for whoever's picked (never me). */
export type NoteDestination = { quadrant: TaskQuadrant; team: boolean; people?: string[] };
/** What a note becomes in the matrix. */
export type NoteTaskInput = { title: string; notes: string | null } & NoteDestination;

const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

// ---------------------------------------------------------------- storage

/** Notes saved on this device before they lived in the database. */
function readDeviceNotes(storageKey: string): Note[] {
  try {
    const raw = localStorage.getItem(storageKey);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((n) => n && typeof n.id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The signed-in person's notes, stored in the database (private to them) so
 * they follow the person across devices. Same interface as before: edit the
 * array with `setNotes`; changes save automatically (debounced, flushed when
 * the app is hidden or the panel closes) with a Saving… / Saved state.
 *
 * Notes still sitting in this device's storage from before are carried over
 * once, into the account that opens the panel, then cleared from the device.
 * Coming back to the app re-reads the notes, so an edit on another device
 * shows up here unless this device has unsaved changes.
 */
export function useNotes(storageKey: string, userId: string | null, enabled = true) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const latest = useRef<Note[]>([]);
  /** Signature of each note as the database has it. */
  const persisted = useRef(new Map<string, string>());
  const saving = useRef(false);
  const again = useRef(false);
  latest.current = notes;

  const pending = useCallback(() => {
    const cur = latest.current;
    const ids = new Set(cur.map((n) => n.id));
    const upserts = cur.filter((n) => {
      const prev = persisted.current.get(n.id);
      // A brand-new note isn't stored until something is written in it.
      if (prev === undefined && !n.title.trim() && !n.body.trim()) return false;
      return prev !== noteSignature(n);
    });
    const deletes = [...persisted.current.keys()].filter((id) => !ids.has(id));
    return { upserts, deletes };
  }, []);

  const flush = useCallback(async () => {
    if (!userId || !ready) return;
    if (saving.current) { again.current = true; return; }
    const { upserts, deletes } = pending();
    if (!upserts.length && !deletes.length) return;
    saving.current = true;
    setSaveState("saving");
    try {
      await upsertQuickNotes(upserts, userId);
      for (const n of upserts) persisted.current.set(n.id, noteSignature(n));
      await deleteQuickNotes(deletes);
      for (const id of deletes) persisted.current.delete(id);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      saving.current = false;
      if (again.current) { again.current = false; void flush(); }
    }
  }, [userId, ready, pending]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      let stored = await fetchMyQuickNotes();
      const device = readDeviceNotes(storageKey);
      if (device.length) {
        const known = new Set(stored.map((n) => n.id));
        const carry = purgeExpired(device, Date.now()).filter((n) => !known.has(n.id) && (n.title.trim() || n.body.trim()));
        await upsertQuickNotes(carry, userId);
        stored = [...stored, ...carry];
        try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
      }
      persisted.current = new Map(stored.map((n) => [n.id, noteSignature(n)]));
      // Expired trash is dropped here; the save effect deletes it from the database.
      setNotes(purgeExpired(stored, Date.now()));
      setLoadError(false);
      setReady(true);
    } catch {
      setLoadError(true);
    }
  }, [userId, storageKey]);

  useEffect(() => {
    if (!enabled || !userId) return;
    void load();
  }, [enabled, userId, load]);

  // Pick up edits made on another device when the app comes back.
  useEffect(() => {
    if (!enabled || !ready) return;
    const onVis = async () => {
      if (document.visibilityState !== "visible" || saving.current) return;
      const { upserts, deletes } = pending();
      if (upserts.length || deletes.length) return;
      try {
        const stored = await fetchMyQuickNotes();
        const still = pending();
        if (saving.current || still.upserts.length || still.deletes.length) return;
        persisted.current = new Map(stored.map((n) => [n.id, noteSignature(n)]));
        setNotes(purgeExpired(stored, Date.now()));
      } catch { /* offline — keep what's here */ }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [enabled, ready, pending]);

  useEffect(() => {
    if (!ready) return;
    const { upserts, deletes } = pending();
    if (!upserts.length && !deletes.length) return;
    setSaveState("saving");
    const t = window.setTimeout(() => void flush(), 400);
    return () => window.clearTimeout(t);
  }, [notes, ready, flush, pending]);

  // Never lose the last keystrokes: save when the app is backgrounded,
  // the page is closed, or the panel unmounts.
  useEffect(() => {
    const onHide = () => void flush();
    const onVis = () => { if (document.visibilityState === "hidden") void flush(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      void flush();
    };
  }, [flush]);

  return { notes, setNotes, saveState, flush, ready, loadError, retry: load };
}

// ---------------------------------------------------------------- client file sync

/** What the server copy must reflect: client, text, and whether the note is still here. */
export function syncSignature(n: Pick<Note, "clientId" | "title" | "body" | "deletedAt">) {
  return JSON.stringify([n.clientId ?? null, n.title, n.body, !!n.deletedAt]);
}

/**
 * Keeps linked notes in step with their client-file copy.
 * Pull (on load + when the app comes back): edits made on the client profile flow in,
 * unless this device has unsent changes. Push (debounced): text/client changes upsert the
 * copy; a deleted note archives it; a restored note un-archives it.
 */
function useClientFileSync(
  notes: Note[],
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>,
  ready: boolean,
) {
  const sent = useRef(new Map<string, string>());
  const latest = useRef(notes);
  latest.current = notes;
  const [pulledAt, setPulledAt] = useState(0);
  const running = useRef(false);
  const again = useRef(false);
  const warned = useRef(false);

  const pull = useCallback(async () => {
    const linked = latest.current.filter((n) => n.clientId);
    if (linked.length) {
      try {
        const rows = await fetchLinkedCopies(linked.map((n) => n.id));
        const byId = new Map(rows.map((r) => [r.quick_note_id, r]));
        const merges = new Map<string, Partial<Note>>();
        for (const n of linked) {
          const r = byId.get(n.id);
          if (!r) continue; // no copy yet → push creates it
          const prev = sent.current.get(n.id);
          const pending = prev !== undefined && prev !== syncSignature(n);
          const differs = r.title !== n.title || r.body !== n.body || r.client_id !== n.clientId;
          const archivedOk = n.deletedAt ? !!r.archived_at : (!r.archived_at || r.archive_reason === "manual");
          if (!differs && archivedOk) {
            sent.current.set(n.id, syncSignature(n));
          } else if (differs && !pending && !n.deletedAt && Date.parse(r.updated_at) > n.updatedAt) {
            const patch = { title: r.title, body: r.body, clientId: r.client_id, updatedAt: Date.parse(r.updated_at) };
            merges.set(n.id, patch);
            if (archivedOk) sent.current.set(n.id, syncSignature({ ...n, ...patch }));
          }
        }
        if (merges.size) setNotes((arr) => arr.map((n) => (merges.has(n.id) ? { ...n, ...merges.get(n.id) } : n)));
      } catch { /* offline: push retries on the next change */ }
    }
    setPulledAt(Date.now());
  }, [setNotes]);

  useEffect(() => {
    if (!ready) return;
    void pull();
    const onVis = () => { if (document.visibilityState === "visible") void pull(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [ready, pull]);

  useEffect(() => {
    if (!ready || !pulledAt) return;
    const run = async () => {
      if (running.current) { again.current = true; return; }
      running.current = true;
      try {
        for (const n of latest.current) {
          const prev = sent.current.get(n.id);
          if (!n.clientId) { if (prev) sent.current.delete(n.id); continue; }
          const sig = syncSignature(n);
          if (prev === sig) continue;
          try {
            if (n.deletedAt) {
              await setQuickNoteRemoved(n.id, true);
            } else {
              // First sync this session, or coming back from Recently Deleted.
              if (prev === undefined || JSON.parse(prev)[3]) await setQuickNoteRemoved(n.id, false);
              await pushQuickNote({ id: n.id, clientId: n.clientId, title: n.title, body: n.body });
            }
            sent.current.set(n.id, sig);
          } catch {
            if (!warned.current) {
              warned.current = true;
              toast.error("Couldn't sync a note to the client file yet. It'll retry.");
            }
          }
        }
      } finally {
        running.current = false;
        if (again.current) { again.current = false; void run(); }
      }
    };
    const t = window.setTimeout(run, 800);
    return () => window.clearTimeout(t);
  }, [notes, ready, pulledAt]);
}

function usePersistedFlag(key: string, initial: boolean) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    try { const raw = localStorage.getItem(key); if (raw != null) setV(raw === "1"); } catch { /* storage unavailable — keep in memory */ }
  }, [key]);
  const set = useCallback((next: boolean) => {
    setV(next);
    try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* storage unavailable — keep in memory */ }
  }, [key]);
  return [v, set] as const;
}

// ---------------------------------------------------------------- helpers

export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Drop notes that have sat in Recently Deleted longer than TRASH_DAYS. */
export function purgeExpired<T extends Pick<Note, "deletedAt">>(notes: T[], now: number): T[] {
  return notes.filter((n) => !n.deletedAt || now - n.deletedAt < TRASH_DAYS * DAY_MS);
}
/** Whole days left before a trashed note is purged (min 1 while it still exists). */
export function trashDaysLeft(deletedAt: number, now: number) {
  return Math.max(1, Math.ceil((deletedAt + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

// ---------------------------------------------------------------- panel

/** Rows shown before "Show all" — keeps the panel short at the top of the page. */
const COLLAPSED_ROWS = 3;

export function QuickNotesPanel(props: QuickNotesPanelProps) {
  // Viewing as someone else: their notes are theirs alone, so show nothing of anyone's.
  if (props.privateTo) {
    return (
      <section aria-label="Quick Notes" className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        <Lock className="h-4 w-4 shrink-0" />
        {firstName(props.privateTo) || "Their"}&apos;s Quick Notes are private to them.
      </section>
    );
  }
  return <NotesPanel {...props} />;
}

type QuickNotesPanelProps = {
  /** Device storage key that held notes before they moved to the database (carried over once). */
  storageKey: string;
  /** The signed-in person; their notes are the only ones shown. */
  userId: string | null;
  /** Set while viewing as someone else: shows a "private" placeholder instead. */
  privateTo?: string | null;
  quadStyles: Record<TaskQuadrant, QuadStyle>;
  /** People a note can be sent to on the team board. */
  teamMembers: TeamMember[];
  /** Creates the matrix task for a note; resolves to the new task id. */
  onCreateTask: (input: NoteTaskInput) => Promise<string>;
  /** Removes a task created by a move (Undo). */
  onDeleteTask: (id: string) => Promise<void>;
  /** Task Manager search text — notes are filtered by it too. */
  search?: string;
  /** Hide the floating compose button (e.g. while the task bulk bar is up). */
  hideComposeButton?: boolean;
};

function NotesPanel({
  storageKey, userId, quadStyles, teamMembers, onCreateTask, onDeleteTask, search = "", hideComposeButton = false,
}: QuickNotesPanelProps) {
  const { notes, setNotes, saveState, flush, ready, loadError, retry } = useNotes(storageKey, userId);
  useClientFileSync(notes, setNotes, ready);
  const openClient = useOpenClientProfile();
  /** Note whose client is being picked. */
  const [linkFor, setLinkFor] = useState<string | null>(null);
  /** Notes being shared with the team (the people sheet is open while set). */
  const [teamSend, setTeamSend] = useState<Note[] | null>(null);
  const [collapsed, setCollapsed] = usePersistedFlag(`${storageKey}-collapsed`, false);
  const [teamCollapsed, setTeamCollapsed] = usePersistedFlag(`${storageKey}-team-collapsed`, false);
  const team = useTeamNotes(!!userId);
  /** Groups shared with last on this device, newest first. */
  const [remembered, setRemembered] = useState<string[][]>([]);
  useEffect(() => { setRemembered(readRememberedGroups(userId)); }, [userId]);
  const teamIds = useMemo(() => teamMembers.map((m) => m.user_id), [teamMembers]);
  const hasTeam = teamIds.some((u) => u !== userId);
  /** One-tap groups to share with, the last one used first. */
  const targets = useMemo(
    () => shareTargets({ remembered, notes: team.notes, teamIds, me: userId, limit: 3 }),
    [remembered, team.notes, teamIds, userId],
  );
  const nameOf = useCallback(
    (u: string) => teamMembers.find((m) => m.user_id === u)?.full_name || "Teammate",
    [teamMembers],
  );
  const labelOf = useCallback((people: string[]) => groupLabel(people.map(nameOf)), [nameOf]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  /** Permanent delete (from Recently Deleted only). */
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const mounted = useMounted();
  const isDesktop = useIsDesktop();

  const searching = search.trim().length > 0;
  const active = useMemo(() => notes.filter((n) => !n.deletedAt), [notes]);
  const trashed = useMemo(
    () => notes.filter((n) => n.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [notes],
  );
  const shown = useMemo(() => sortByRecent(active.filter((n) => noteMatches(n, search))), [active, search]);
  const isCollapsed = collapsed && !searching;
  const overflows = !searching && !selectMode && shown.length > COLLAPSED_ROWS;
  const capped = overflows && !showAll;
  const rows = capped ? shown.slice(0, COLLAPSED_ROWS) : shown;

  const addNote = useCallback(() => {
    const n: Note = { id: newId(), title: "", body: "", updatedAt: Date.now() };
    setNotes((arr) => [n, ...arr]);
    setCollapsed(false);
    setOpenId(n.id);
  }, [setNotes, setCollapsed]);

  const updateNote = useCallback((id: string, patch: Partial<Note>) =>
    setNotes((arr) => arr.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n))), [setNotes]);

  // updatedAt is left alone so a restored note returns to its old spot.
  const restoreNotes = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setNotes((arr) => arr.map((n) => (set.has(n.id) ? { ...n, deletedAt: undefined } : n)));
  }, [setNotes]);
  const trashNotes = (ids: string[], { quiet = false } = {}) => {
    const set = new Set(ids);
    const now = Date.now();
    // An untouched brand-new note has nothing worth keeping — drop it outright.
    setNotes((arr) => arr
      .filter((n) => !set.has(n.id) || n.title.trim() || n.body.trim())
      .map((n) => (set.has(n.id) ? { ...n, deletedAt: now } : n)));
    setSelected(new Set());
    setSelectMode(false);
    if (openId && set.has(openId)) setOpenId(null);
    if (quiet) return;
    toast(ids.length > 1 ? `${ids.length} notes moved to Recently Deleted` : "Moved to Recently Deleted", {
      action: { label: "Undo", onClick: () => restoreNotes(ids) },
    });
  };
  const removeForever = (ids: string[]) => {
    const set = new Set(ids);
    setNotes((arr) => arr.filter((n) => !set.has(n.id)));
  };
  const duplicate = (n: Note) => {
    // A copy starts unlinked so one client never gets two synced copies by accident.
    const { clientId: _c, clientName: _n, ...rest } = n;
    const copy = { ...rest, id: newId(), title: n.title ? `${n.title} (copy)` : n.title, updatedAt: Date.now() };
    setNotes((arr) => [copy, ...arr]);
    toast.success("Note duplicated");
    return copy;
  };

  const closeEditor = useCallback(() => {
    // Drop a brand-new note that was never written in.
    setNotes((arr) => arr.filter((n) => n.id !== openId || n.title.trim() || n.body.trim()));
    setOpenId(null);
    window.setTimeout(flush, 0);
  }, [openId, setNotes, flush]);

  // Emptying the trash closes its sheet so the next delete doesn't reopen it.
  useEffect(() => { if (trashed.length === 0) setTrashOpen(false); }, [trashed.length]);

  const openNote = notes.find((n) => n.id === openId) ?? null;
  const allSelected = shown.length > 0 && selected.size === shown.length;

  const moveToMatrix = async (list: Note[], dest: NoteDestination) => {
    const movable = list.flatMap((n) => {
      const t = noteToTask(n);
      return t ? [{ note: n, task: { ...t, ...dest } }] : [];
    });
    if (!movable.length) { toast.error("Write something first, then move it."); return; }
    const results = await Promise.allSettled(movable.map((m) => onCreateTask(m.task)));
    const movedIds = movable.filter((_, i) => results[i].status === "fulfilled").map((m) => m.note.id);
    const taskIds = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const people = dest.people ?? [];
    const where = dest.team
      ? `Team · ${quadStyles[dest.quadrant].title}${people.length ? ` · ${labelOf(people)}` : ""}`
      : `My tasks · ${quadStyles[dest.quadrant].title}`;
    if (movedIds.length) {
      // The note goes to Recently Deleted (not gone) so Undo can bring it back.
      trashNotes(movedIds, { quiet: true });
      toast.success(movedIds.length > 1 ? `${movedIds.length} notes moved to ${where}` : `Moved to ${where}`, {
        action: {
          label: "Undo",
          onClick: () => {
            restoreNotes(movedIds);
            Promise.all(taskIds.map(onDeleteTask)).catch(() =>
              toast.error("Note restored, but the task couldn't be removed. Delete it from the matrix."));
          },
        },
      });
    }
    const failed = movable.length - movedIds.length;
    if (failed) toast.error(failed > 1 ? `${failed} notes couldn't be moved. They're still here.` : "Couldn't move the note. It's still here.");
  };

  /**
   * Share as a team note for these people (never me: I'm always on it). The
   * note goes to Recently Deleted (not gone) so Undo can bring it back.
   */
  const shareToTeam = async (list: Note[], people: string[]) => {
    if (!userId) return;
    const sharable = list.filter(hasText);
    if (!sharable.length) { toast.error("Write something first, then share it."); return; }
    const members = [userId, ...people.filter((u) => u !== userId)];
    const results = await Promise.allSettled(
      sharable.map((n) => insertTeamNote({ members, title: n.title, body: n.body })),
    );
    const rows = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const sharedIds = sharable.filter((_, i) => results[i].status === "fulfilled").map((n) => n.id);
    if (rows.length) {
      team.patch((prev) => [...rows, ...prev.filter((r) => !rows.some((x) => x.id === r.id))]);
      trashNotes(sharedIds, { quiet: true });
      saveRememberedGroup(userId, people);
      setRemembered(readRememberedGroups(userId));
      setTeamCollapsed(false);
      announceTeamNotes(rows.map((r) => r.id), people, userId);
      const who = labelOf(othersIn(rows[0].members, userId));
      toast.success(rows.length > 1 ? `${rows.length} notes shared with ${who}` : `Shared with ${who}`, {
        description: "It's under Team notes.",
        action: {
          label: "Undo",
          onClick: () => {
            restoreNotes(sharedIds);
            team.patch((prev) => prev.filter((r) => !rows.some((x) => x.id === r.id)));
            Promise.all(rows.map((r) => deleteTeamNote(r.id))).catch(() => {
              team.refresh();
              toast.error("Note restored, but it's still in Team notes. Delete it there.");
            });
          },
        },
      });
    }
    const failed = sharable.length - rows.length;
    if (failed) toast.error(failed > 1 ? `${failed} notes couldn't be shared. They're still here.` : "Couldn't share the note. It's still here.");
  };

  /** Into my own Quick notes (a team note taken back): resolves to its id. */
  const addQuickNote = useCallback((t: { title: string; body: string }) => {
    const n: Note = { id: newId(), title: t.title, body: t.body, updatedAt: Date.now() };
    setNotes((arr) => [n, ...arr]);
    setCollapsed(false);
    window.setTimeout(flush, 0);
    return n.id;
  }, [setNotes, setCollapsed, flush]);
  const dropQuickNote = useCallback((id: string) => setNotes((arr) => arr.filter((n) => n.id !== id)), [setNotes]);

  /**
   * A note's way out: share it with a group shared with before (one tap), or
   * pick people (a team note or a task); or file it in My tasks (2×2 tiles).
   */
  const moveGrid = (list: () => Note[]) => (
    <>
      {hasTeam && (
        <>
          <MenuLabel>Share with team</MenuLabel>
          {targets.map((g) => (
            <DropdownMenuItem key={g.join(",")} onClick={() => void shareToTeam(list(), g)} data-share-group>
              <Users className="mr-2 h-4 w-4" /><span className="truncate">{labelOf(g)}</span>
            </DropdownMenuItem>
          ))}
        </>
      )}
      <DropdownMenuItem onClick={() => setTeamSend(list())}>
        <UserRoundPlus className="mr-2 h-4 w-4" />{hasTeam ? "Choose people…" : "Send to team…"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <MenuLabel>Move to my tasks</MenuLabel>
      <div className="grid grid-cols-2 gap-1 px-1 pb-1">
        {QUADRANTS.map((q) => {
          const st = quadStyles[q.key];
          return (
            <DropdownMenuItem
              key={q.key}
              onClick={() => moveToMatrix(list(), { quadrant: q.key, team: false })}
              className="min-h-10 justify-center rounded-md border px-1.5 text-center text-xs font-bold"
              style={{
                color: st.color,
                borderColor: `color-mix(in srgb, ${st.color} 45%, transparent)`,
                backgroundColor: `color-mix(in srgb, ${st.color} 12%, transparent)`,
              }}
            >
              {st.title}
            </DropdownMenuItem>
          );
        })}
      </div>
    </>
  );

  const linkNote = (id: string, c: { id: string; name: string }) => {
    // Linking isn't an edit: the note keeps its place in the list.
    setNotes((arr) => arr.map((n) => (n.id === id ? { ...n, clientId: c.id, clientName: c.name } : n)));
    setLinkFor(null);
    const first = c.name.split(" ")[0];
    toast.success(`Saved to ${first}'s client file`, {
      description: "Edits stay in sync. If you delete it here, it stays in their notes archive.",
      action: { label: "Open", onClick: () => { setOpenId(null); openClient(c.id, { tab: "notes" }); } },
    });
  };
  const unlinkNote = async (n: Note) => {
    try {
      await unlinkQuickNote(n.id);
      setNotes((arr) => arr.map((x) => (x.id === n.id ? { ...x, clientId: undefined, clientName: undefined } : x)));
      toast.success(`Kept on ${(n.clientName ?? "the client").split(" ")[0]}'s file. No longer synced.`);
    } catch {
      toast.error("Couldn't stop syncing. Try again.");
    }
  };
  const openClientFile = (n: Note) => {
    if (!n.clientId) return;
    if (openId) closeEditor();
    openClient(n.clientId, { tab: "notes" });
  };
  const clientMenu = (n: Note) =>
    n.clientId ? (
      <>
        <MenuLabel>On {(n.clientName ?? "client").split(" ")[0]}&apos;s file · synced</MenuLabel>
        <DropdownMenuItem onClick={() => openClientFile(n)}><ExternalLink className="mr-2 h-4 w-4" />Open client file</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setLinkFor(n.id)}><UserRound className="mr-2 h-4 w-4" />Change client…</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void unlinkNote(n)}><Link2Off className="mr-2 h-4 w-4" />Stop syncing</DropdownMenuItem>
      </>
    ) : (
      <DropdownMenuItem onClick={() => setLinkFor(n.id)}><UserRoundPlus className="mr-2 h-4 w-4" />Save to client file…</DropdownMenuItem>
    );
  const linkTarget = notes.find((n) => n.id === linkFor) ?? null;
  /** Under the title: the client file this note syncs to, or a way to pick one. */
  const clientChip = (n: Note) =>
    n.clientId ? (
      <button
        type="button"
        onClick={() => openClientFile(n)}
        className="mb-2 inline-flex w-fit max-w-full shrink-0 items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-[12px] font-semibold text-primary active:opacity-70"
        title="Open client file"
      >
        <UserRound className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{n.clientName ?? "Client"}</span>
        <span className="shrink-0 font-normal text-primary/70">· synced to client file</span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setLinkFor(n.id)}
        className="mb-2 inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground active:opacity-70"
      >
        <UserRoundPlus className="h-3.5 w-3.5" /> Save to client file
      </button>
    );
  const shareLabel = teamSend ? (teamSend.length > 1 ? `${teamSend.length} notes` : teamSend[0] ? noteHeading(teamSend[0]) : "") : "";

  return (
    <>
    <section aria-label="Quick Notes">
      {/* Section header */}
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!isCollapsed}
          className="-ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1.5 text-left"
        >
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isCollapsed && "-rotate-90")} />
          <h2 className="text-sm font-semibold text-foreground">Quick notes</h2>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground/70">
            {searching ? `${shown.length}/${active.length}` : active.length}
          </span>
        </button>
        <div className="ml-auto flex items-center">
          {selectMode ? (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs font-semibold" onClick={() => { setSelectMode(false); setSelected(new Set()); }}>
              Cancel
            </Button>
          ) : (
            (active.length > 1 || trashed.length > 0) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Quick Notes options">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {active.length > 1 && (
                    <DropdownMenuItem onClick={() => { setCollapsed(false); setSelectMode(true); }}>
                      <CheckSquare className="mr-2 h-4 w-4" />Select notes
                    </DropdownMenuItem>
                  )}
                  {trashed.length > 0 && (
                    <DropdownMenuItem onClick={() => setTrashOpen(true)}>
                      <Trash2 className="mr-2 h-4 w-4" />Recently Deleted ({trashed.length})
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          )}
        </div>
      </div>

      {!isCollapsed && (
        <>
          {selectMode && (
            <div className="mt-1 flex items-center justify-between rounded-lg bg-primary/5 px-2 py-1">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]"
                onClick={() => setSelected(allSelected ? new Set() : new Set(shown.map((n) => n.id)))}>
                {allSelected ? "Deselect all" : "Select all"}
              </Button>
              <span className="text-[11px] font-bold">{selected.size} selected</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" disabled={selected.size === 0}>
                    <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />Move
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {moveGrid(() => shown.filter((n) => selected.has(n.id)))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                disabled={selected.size === 0} onClick={() => trashNotes(Array.from(selected))}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
              </Button>
            </div>
          )}

          {!ready ? (
            loadError ? (
              <button
                type="button"
                onClick={() => void retry()}
                className="mt-1 flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-4 w-4 shrink-0" />
                Couldn&apos;t load your notes. Tap to try again.
              </button>
            ) : (
              <div className="mt-1 h-[52px] jf-skeleton rounded-xl bg-card ring-1 ring-border" aria-label="Loading notes" />
            )
          ) : shown.length === 0 ? (
            searching ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">No notes match your search.</p>
            ) : (
              <button
                type="button"
                onClick={addNote}
                className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg px-1 text-left text-sm text-muted-foreground hover:text-foreground"
              >
                <SquarePen className="h-4 w-4 shrink-0" />
                Add a note
              </button>
            )
          ) : (
            <ul className="mt-1 overflow-hidden rounded-xl bg-card ring-1 ring-border">
              {rows.map((n, i) => {
                const preview = notePreview(n);
                return (
                  <li key={n.id} className={cn(i > 0 && "border-t border-border/70")}>
                    <TaskSwipeRow onSwipeLeft={() => trashNotes([n.id])} disabled={selectMode}>
                      <div className="flex items-center gap-2 pl-3 pr-1">
                        {selectMode && (
                          <Checkbox
                            className="h-[18px] w-[18px]"
                            checked={selected.has(n.id)}
                            onCheckedChange={(v) => setSelected((s) => { const x = new Set(s); if (v) x.add(n.id); else x.delete(n.id); return x; })}
                            aria-label={`Select ${noteHeading(n)}`}
                          />
                        )}
                        <button
                          type="button"
                          className="min-w-0 flex-1 py-2.5 text-left"
                          onClick={() => {
                            if (selectMode) setSelected((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; });
                            else setOpenId(n.id);
                          }}
                        >
                          <div className="truncate text-sm font-semibold leading-snug">{noteHeading(n)}</div>
                          <div className="flex min-w-0 items-center gap-1.5 text-xs leading-snug text-muted-foreground">
                            {n.clientId && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/12 px-1.5 py-px text-[10px] font-semibold text-primary">
                                <UserRound className="h-2.5 w-2.5" />{(n.clientName ?? "Client").split(" ")[0]}
                              </span>
                            )}
                            <span className="truncate">{preview || "No additional text"}</span>
                          </div>
                        </button>
                        {!selectMode && (
                          <RowMenu label="Note actions">
                            {moveGrid(() => [n])}
                            <DropdownMenuSeparator />
                            {clientMenu(n)}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={async () => { if (await copyText(n.body || n.title)) toast.success("Copied ✓"); }}>
                              <Copy className="mr-2 h-4 w-4" />Copy
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => duplicate(n)}><Files className="mr-2 h-4 w-4" />Duplicate</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => trashNotes([n.id])}>
                              <Trash2 className="mr-2 h-4 w-4" />Delete
                            </DropdownMenuItem>
                          </RowMenu>
                        )}
                      </div>
                    </TaskSwipeRow>
                  </li>
                );
              })}
              {overflows && (
                <li className="border-t border-border/70">
                  <button
                    type="button"
                    onClick={() => setShowAll(!showAll)}
                    className="w-full px-3 py-2 text-left text-xs font-semibold text-primary"
                  >
                    {capped ? `Show all ${shown.length}` : "Show less"}
                  </button>
                </li>
              )}
            </ul>
          )}
        </>
      )}

      {/* Compose — floats bottom-right above the mobile nav, like Apple Notes. */}
      {mounted && ready && !openNote && !selectMode && !hideComposeButton && createPortal(
        <button
          type="button"
          data-viewport-pinned
          onClick={addNote}
          aria-label="New note"
          title="New note"
          className={cn(
            "fixed right-4 z-50 flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground",
            "shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] ring-1 ring-black/10 transition-opacity active:opacity-80",
            "h-14 w-14 md:right-8 md:h-12 md:w-auto md:px-5",
          )}
          style={{ bottom: isDesktop ? "2rem" : "calc(var(--mobile-bar-top) + 14px)" }}
        >
          <SquarePen className="h-6 w-6 md:h-5 md:w-5" />
          <span className="hidden text-sm font-semibold md:inline">New note</span>
        </button>,
        document.body,
      )}

      {openNote && (
        <NoteEditor
          note={openNote}
          saveState={saveState}
          onChange={(patch) => updateNote(openNote.id, patch)}
          onClose={closeEditor}
          onDuplicate={() => { const c = duplicate(openNote); setOpenId(c.id); }}
          onDelete={() => trashNotes([openNote.id])}
          menu={<>{moveGrid(() => [openNote])}<DropdownMenuSeparator />{clientMenu(openNote)}</>}
          chip={clientChip(openNote)}
        />
      )}

      <TeamPeopleDialog
        open={!!teamSend}
        title="Share with team"
        description={shareLabel}
        teamMembers={teamMembers}
        me={userId}
        initial={targets[0] ?? []}
        groups={targets}
        taskStyles={quadStyles}
        confirmLabel="Share"
        onClose={() => setTeamSend(null)}
        onConfirm={({ people, kind, quadrant }) => {
          const list = teamSend ?? [];
          setTeamSend(null);
          if (kind === "note") void shareToTeam(list, people);
          else void moveToMatrix(list, { quadrant, team: true, people });
        }}
      />

      <ClientLinkDialog
        open={!!linkTarget}
        noteText={linkTarget ? `${linkTarget.title}\n${linkTarget.body}` : ""}
        currentClientId={linkTarget?.clientId}
        onPick={(c) => linkTarget && linkNote(linkTarget.id, c)}
        onClose={() => setLinkFor(null)}
      />

      <Dialog open={trashOpen && trashed.length > 0} onOpenChange={setTrashOpen}>
        <DialogContent className="flex max-h-[85dvh] max-w-md flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Recently Deleted</DialogTitle>
            <DialogDescription>Notes are permanently deleted after {TRASH_DAYS} days.</DialogDescription>
          </DialogHeader>
          <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {trashed.map((n, i) => (
              <li key={n.id} className={cn("flex items-center gap-1 px-1", i > 0 && "border-t border-border/70")}>
                <div className="min-w-0 flex-1 py-2.5">
                  <div className="truncate text-sm font-semibold leading-snug">{noteHeading(n)}</div>
                  <div className="truncate text-xs leading-snug text-muted-foreground">
                    {trashDaysLeft(n.deletedAt!, Date.now())} {trashDaysLeft(n.deletedAt!, Date.now()) === 1 ? "day" : "days"} left
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-9 px-2 text-xs font-semibold text-primary hover:text-primary" onClick={() => restoreNotes([n.id])}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />Restore
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${noteHeading(n)} now`} onClick={() => setConfirmDelete([n.id])}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            <Button variant="ghost" className="text-primary hover:text-primary" onClick={() => restoreNotes(trashed.map((n) => n.id))}>
              Restore all
            </Button>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(trashed.map((n) => n.id))}>
              Delete all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="z-[90] max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete && confirmDelete.length > 1 ? `${confirmDelete.length} notes` : "note"} permanently?</DialogTitle>
            <DialogDescription>This can't be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDelete) removeForever(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>

    <TeamNotesSection
      me={userId}
      teamMembers={teamMembers}
      search={search}
      targets={targets}
      collapsed={teamCollapsed}
      onToggleCollapsed={() => setTeamCollapsed(!teamCollapsed)}
      toQuickNotes={addQuickNote}
      dropQuickNote={dropQuickNote}
    />
    </>
  );
}
