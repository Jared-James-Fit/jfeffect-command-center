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
 * - Move to matrix: one tap on a quadrant tile (row menu, editor menu, or
 *   bulk select) creates the task and moves the note to Recently Deleted,
 *   with Undo that removes the task and restores the note.
 * - Delete (swipe left, row menu, editor menu, bulk) moves a note to
 *   Recently Deleted with an Undo toast. Trashed notes are restorable for
 *   30 days, then purged on the next load. Trash is just a `deletedAt`
 *   stamp on the same stored note, so nothing else about storage changes.
 * - Auto-saves (debounced, flushed on close / page hide) with a quiet
 *   Saving… / Saved indicator. Storage key + note shape are unchanged, so
 *   existing notes carry over as-is.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal, Trash2, ChevronDown, ChevronLeft, Copy, Check, Pencil, CheckSquare, Files, SquarePen,
  RotateCcw, ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import { QUADRANTS, type TaskQuadrant } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { TaskSwipeRow } from "@/components/tasks/task-swipe-row";

/** `deletedAt` set ⇒ the note is in Recently Deleted. */
export type Note = { id: string; title: string; body: string; updatedAt: number; deletedAt?: number };
type QuadStyle = { color: string; title: string; subtitle: string };
/** What a note becomes in the matrix. */
export type NoteTaskInput = { title: string; notes: string | null; quadrant: TaskQuadrant };
export type SaveState = "idle" | "saving" | "saved" | "error";

const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

// ---------------------------------------------------------------- storage

export function useNotes(storageKey: string) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // `ready` flips in the same render that applies the stored notes, so the
  // initial empty state can never be written over what's in storage.
  const [ready, setReady] = useState(false);
  const latest = useRef<Note[]>([]);
  const dirty = useRef(false);
  /** JSON currently in storage — lets the save effect skip no-op writes. */
  const persisted = useRef<string | null>(null);

  useEffect(() => {
    let stored: Note[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      persisted.current = raw;
      if (raw) stored = JSON.parse(raw);
    } catch { /* storage unavailable — keep in memory */ }
    // Expired trash is dropped here; the save effect persists the purge.
    setNotes(purgeExpired(stored, Date.now()));
    setReady(true);
  }, [storageKey]);

  const flush = useCallback(() => {
    if (!dirty.current) return;
    try {
      const json = JSON.stringify(latest.current);
      localStorage.setItem(storageKey, json);
      persisted.current = json;
      dirty.current = false;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [storageKey]);

  useEffect(() => {
    latest.current = notes;
    if (!ready) return;
    if (JSON.stringify(notes) === (persisted.current ?? "[]")) {
      // Back to what's stored (e.g. an edit was undone) — nothing pending.
      if (dirty.current) { dirty.current = false; setSaveState("saved"); }
      return;
    }
    dirty.current = true;
    setSaveState("saving");
    const t = window.setTimeout(flush, 400);
    return () => window.clearTimeout(t);
  }, [notes, ready, flush]);

  // Never lose the last keystrokes: flush when the app is backgrounded,
  // the page is closed, or the panel unmounts.
  useEffect(() => {
    const onHide = () => flush();
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [flush]);

  return { notes, setNotes, saveState, flush };
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

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export function noteHeading(n: Pick<Note, "title" | "body">) {
  return n.title.trim() || lines(n.body)[0] || "Untitled note";
}
export function notePreview(n: Pick<Note, "title" | "body">) {
  const ls = lines(n.body);
  return (n.title.trim() ? ls[0] : ls[1]) ?? "";
}
/**
 * Task fields for a note: its title (or first line) becomes the task title
 * and the rest of the text rides along as the task notes. Null when empty.
 */
export function noteToTask(n: Pick<Note, "title" | "body">): Omit<NoteTaskInput, "quadrant"> | null {
  const bodyLines = n.body.split("\n");
  const firstIdx = bodyLines.findIndex((l) => l.trim());
  const title = (n.title.trim() || (firstIdx >= 0 ? bodyLines[firstIdx].trim() : "")).slice(0, 200);
  if (!title) return null;
  const rest = n.title.trim() ? n.body : bodyLines.slice(firstIdx + 1).join("\n");
  return { title, notes: rest.trim() ? rest.trim() : null };
}

/** Most recently edited first, like Apple Notes. */
export function sortByRecent<T extends Pick<Note, "updatedAt">>(notes: T[]): T[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}
export function noteMatches(n: Pick<Note, "title" | "body">, q: string) {
  const s = q.trim().toLowerCase();
  return !s || `${n.title}\n${n.body}`.toLowerCase().includes(s);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Box of the visual viewport — shrinks when the iOS keyboard opens. */
function useVisualViewportBox(active: boolean) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    const update = () => setBox(vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight });
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active]);
  return box;
}

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function useIsDesktop() {
  const [d, setD] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setD(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return d;
}

/**
 * A row's ••• menu, opened on tap for touch input. Radix opens on
 * pointerdown, so a swipe or scroll that starts on ••• would pop it open.
 * Mouse and keyboard keep Radix's default behavior.
 */
function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const touchDown = useRef(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground" aria-label={label}
          onPointerDown={(e) => {
            touchDown.current = e.pointerType !== "mouse";
            // Radix skips its open-on-pointerdown when the event is defaulted.
            if (touchDown.current) e.preventDefault();
          }}
          onClick={() => {
            if (touchDown.current) setOpen(true);
            touchDown.current = false;
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------- panel

/** Rows shown before "Show all" — keeps the panel short at the top of the page. */
const COLLAPSED_ROWS = 3;

export function QuickNotesPanel({
  storageKey, quadStyles, onCreateTask, onDeleteTask, search = "", hideComposeButton = false,
}: {
  storageKey: string;
  quadStyles: Record<TaskQuadrant, QuadStyle>;
  /** Creates the matrix task for a note; resolves to the new task id. */
  onCreateTask: (input: NoteTaskInput) => Promise<string>;
  /** Removes a task created by a move (Undo). */
  onDeleteTask: (id: string) => Promise<void>;
  /** Task Manager search text — notes are filtered by it too. */
  search?: string;
  /** Hide the floating compose button (e.g. while the task bulk bar is up). */
  hideComposeButton?: boolean;
}) {
  const { notes, setNotes, saveState, flush } = useNotes(storageKey);
  const [collapsed, setCollapsed] = usePersistedFlag(`${storageKey}-collapsed`, false);
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
    const copy = { ...n, id: newId(), title: n.title ? `${n.title} (copy)` : n.title, updatedAt: Date.now() };
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

  const moveToMatrix = async (list: Note[], quadrant: TaskQuadrant) => {
    const movable = list.flatMap((n) => {
      const t = noteToTask(n);
      return t ? [{ note: n, task: { ...t, quadrant } }] : [];
    });
    if (!movable.length) { toast.error("Write something first, then move it."); return; }
    const results = await Promise.allSettled(movable.map((m) => onCreateTask(m.task)));
    const movedIds = movable.filter((_, i) => results[i].status === "fulfilled").map((m) => m.note.id);
    const taskIds = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const where = quadStyles[quadrant].title;
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

  /** 2×2 quadrant tiles, laid out like the matrix. One tap moves the note(s). */
  const moveGrid = (list: () => Note[]) => (
    <>
      <DropdownMenuLabel className="pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Move to matrix
      </DropdownMenuLabel>
      <div className="grid grid-cols-2 gap-1 px-1 pb-1">
        {QUADRANTS.map((q) => {
          const st = quadStyles[q.key];
          return (
            <DropdownMenuItem
              key={q.key}
              onClick={() => moveToMatrix(list(), q.key)}
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

  return (
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
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Quick Notes</h2>
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

          {shown.length === 0 ? (
            searching ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">No notes match your search.</p>
            ) : (
              <button
                type="button"
                onClick={addNote}
                className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-xs text-muted-foreground border border-dashed border-border hover:text-foreground"
              >
                <SquarePen className="h-4 w-4 shrink-0" />
                No notes yet. Tap to capture something. Notes save automatically.
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
                          <div className="truncate text-xs leading-snug text-muted-foreground">{preview || "No additional text"}</div>
                        </button>
                        {!selectMode && (
                          <RowMenu label="Note actions">
                            {moveGrid(() => [n])}
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
      {mounted && !openNote && !selectMode && !hideComposeButton && createPortal(
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
          style={{ bottom: isDesktop ? "2rem" : "calc(max(env(safe-area-inset-bottom), 6px) + 84px)" }}
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
          moveGrid={moveGrid(() => [openNote])}
        />
      )}

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
  );
}

// ---------------------------------------------------------------- editor

function NoteEditor({
  note, saveState, onChange, onClose, onDuplicate, onDelete, moveGrid,
}: {
  note: Note;
  saveState: SaveState;
  onChange: (patch: Partial<Note>) => void;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  moveGrid: React.ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const box = useVisualViewportBox(!isDesktop);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const isNew = !note.title && !note.body;

  // Lock the page behind the editor; Escape closes on desktop.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  // When the keyboard opens/closes the editor resizes — keep the caret line
  // in view so typing near the bottom of a long note never hides under it.
  useEffect(() => {
    const ta = bodyRef.current;
    if (!ta || document.activeElement !== ta) return;
    const end = ta.selectionEnd ?? 0;
    const lineHeight = 28;
    // Height of the text before the caret, measured with an off-screen clone.
    const probe = document.createElement("textarea");
    const cs = getComputedStyle(ta);
    probe.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;height:0;overflow:hidden;width:${ta.clientWidth}px;font:${cs.font};line-height:${cs.lineHeight};padding:${cs.padding};white-space:pre-wrap;word-wrap:break-word;letter-spacing:${cs.letterSpacing}`;
    probe.value = ta.value.slice(0, end);
    document.body.appendChild(probe);
    const caretY = probe.scrollHeight;
    probe.remove();
    if (caretY > ta.scrollTop + ta.clientHeight - lineHeight || caretY < ta.scrollTop + lineHeight) {
      ta.scrollTop = Math.max(0, caretY - ta.clientHeight + lineHeight * 2);
    }
  }, [box?.height]);

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    const ok = await copyText(note.body || note.title);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Couldn't copy — select the text instead");
    }
  };

  const status =
    saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save" : saveState === "saved" ? "Saved" : "";

  const mobileStyle: React.CSSProperties | undefined = !isDesktop && box
    ? { top: box.top, height: box.height }
    : undefined;

  const words = note.body.trim() ? note.body.trim().split(/\s+/).length : 0;

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Edit note">
      {/* Desktop backdrop */}
      <div className="absolute inset-0 hidden bg-black/40 backdrop-blur-[2px] md:block" onClick={onClose} />
      <div
        className={cn(
          "absolute inset-x-0 flex flex-col bg-background text-foreground",
          "md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(88vh,960px)] md:w-[min(92vw,820px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:bg-card md:shadow-2xl md:ring-1 md:ring-border",
          !mobileStyle && "top-0 h-[100dvh]",
        )}
        style={mobileStyle}
      >
        {/* Toolbar */}
        <div
          className="flex shrink-0 items-center gap-1 border-b border-border/70 px-1.5 pb-1.5 md:px-3 md:pt-2"
          style={{ paddingTop: isDesktop ? undefined : "calc(env(safe-area-inset-top) + 0.375rem)" }}
        >
          <Button variant="ghost" className="h-10 gap-0.5 px-2 text-[15px] font-medium text-primary hover:text-primary" onClick={onClose}>
            <ChevronLeft className="h-5 w-5" />Quick Notes
          </Button>
          <span
            className={cn(
              "ml-1 truncate text-[11px] text-muted-foreground transition-opacity duration-300",
              saveState === "error" && "text-destructive",
              !status && "opacity-0",
            )}
            aria-live="polite"
          >
            {status}
          </span>
          <div className="ml-auto flex items-center">
            <Button
              variant="ghost"
              className={cn("h-10 gap-1.5 px-2.5 text-sm font-medium", copied && "text-emerald-600 dark:text-emerald-400")}
              onClick={copy}
              disabled={!note.body && !note.title}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="More note actions">
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[85] w-60">
                {moveGrid}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => window.setTimeout(() => { titleRef.current?.focus(); titleRef.current?.select(); }, 50)}>
                  <Pencil className="mr-2 h-4 w-4" />Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}><Files className="mr-2 h-4 w-4" />Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" className="h-10 px-2.5 text-[15px] font-semibold text-primary hover:text-primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>

        {/* Title + body */}
        <div className="flex min-h-0 flex-1 flex-col px-4 md:px-8">
          <input
            ref={titleRef}
            value={note.title}
            onChange={(e) => onChange({ title: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); bodyRef.current?.focus(); } }}
            placeholder="Title"
            enterKeyHint="next"
            className="w-full shrink-0 bg-transparent pb-2 pt-4 text-[22px] font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50"
          />
          <div className="h-px shrink-0 bg-border/70" />
          <textarea
            ref={bodyRef}
            value={note.body}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder="Start writing…"
            className="min-h-0 w-full flex-1 resize-none overflow-y-auto overscroll-contain bg-transparent pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-[16px] leading-7 outline-none placeholder:text-muted-foreground/50 [scrollbar-gutter:stable]"
            spellCheck
          />
        </div>
        <div className="hidden shrink-0 px-8 pb-3 text-right text-[11px] text-muted-foreground md:block">
          {words.toLocaleString()} {words === 1 ? "word" : "words"}
        </div>
      </div>
    </div>,
    document.body,
  );
}
