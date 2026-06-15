import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Star, GripVertical, Check, Loader2, AlertCircle, Circle, Plus, Link as LinkIcon, Unlink, CloudOff, AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuickAddExerciseDialog } from "@/components/quick-add-exercise-dialog";

// ---------------- Drag & drop payload helpers ----------------

export const DND_EXERCISE = "application/x-pb-exercise";
export const DND_ROW = "application/x-pb-row";

export function setDragExercise(e: React.DragEvent, exerciseId: string) {
  e.dataTransfer.setData(DND_EXERCISE, exerciseId);
  e.dataTransfer.effectAllowed = "copy";
}
export function setDragRow(e: React.DragEvent, rowId: string, fromDayId: string) {
  e.dataTransfer.setData(DND_ROW, JSON.stringify({ rowId, fromDayId }));
  e.dataTransfer.effectAllowed = "move";
}
export function readDrop(e: React.DragEvent):
  | { kind: "exercise"; exerciseId: string }
  | { kind: "row"; rowId: string; fromDayId: string }
  | null {
  const ex = e.dataTransfer.getData(DND_EXERCISE);
  if (ex) return { kind: "exercise", exerciseId: ex };
  const r = e.dataTransfer.getData(DND_ROW);
  if (r) {
    try {
      const p = JSON.parse(r);
      return { kind: "row", rowId: p.rowId, fromDayId: p.fromDayId };
    } catch {}
  }
  return null;
}

// ---------------- Density toggle ----------------

export type Density = "compact" | "comfortable";
const DENSITY_KEY = "pb.density";

export function useDensity(): [Density, (d: Density) => void] {
  const [d, setD] = useState<Density>(() => {
    if (typeof window === "undefined") return "compact";
    return (localStorage.getItem(DENSITY_KEY) as Density) || "compact";
  });
  const set = (next: Density) => {
    setD(next);
    try { localStorage.setItem(DENSITY_KEY, next); } catch {}
  };
  return [d, set];
}

export const DENSITY_CLASSES: Record<Density, { row: string; cell: string; input: string }> = {
  compact: { row: "h-7", cell: "px-1 py-0.5", input: "h-6 text-[11px] px-1.5" },
  comfortable: { row: "h-9", cell: "px-2 py-1", input: "h-8 text-xs px-2" },
};

// ---------------- Save state pill ----------------

export type SaveState = "idle" | "saving" | "saved" | "error" | "offline" | "pending";

// Global event so a "Save now" button or other components can flush pending
// debounced CellInput timers without re-plumbing every input.
export const PB_FLUSH_EVENT = "pb:flush-cells";
export function flushPendingCells() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PB_FLUSH_EVENT));
}

export function useSaveState() {
  const [state, setState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const inflight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const up = () => setOnline(true);
    const down = () => { setOnline(false); setState((s) => (s === "saving" || s === "pending" ? "offline" : s)); };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  const wrap = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    inflight.current++;
    setState("saving");
    try {
      const r = await fn();
      inflight.current = Math.max(0, inflight.current - 1);
      if (inflight.current === 0) {
        setState("saved");
        setLastSavedAt(Date.now());
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 2500);
      }
      return r;
    } catch (e) {
      inflight.current = Math.max(0, inflight.current - 1);
      setState("error");
      throw e;
    }
  };

  // Allow CellInput / external typing to mark the builder dirty so the pill flips
  // from "Saved" to "Unsaved" without waiting for the network round-trip.
  const markPending = () => setState((s) => (s === "saving" ? s : "pending"));

  return { state, wrap, setState, lastSavedAt, online, markPending };
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function SaveStatePill({ state, lastSavedAt }: { state: SaveState; lastSavedAt?: number | null }) {
  if (state === "saving")
    return (
      <Badge variant="outline" className="gap-1 text-[10px] font-normal">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </Badge>
    );
  if (state === "saved")
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500 text-[10px] font-normal">
        <Check className="h-3 w-3" /> {lastSavedAt ? `Saved ${timeAgo(lastSavedAt)}` : "Saved"}
      </Badge>
    );
  if (state === "error")
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive text-[10px] font-normal">
        <AlertCircle className="h-3 w-3" /> Save failed
      </Badge>
    );
  if (state === "offline")
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-500 text-[10px] font-normal">
        <CloudOff className="h-3 w-3" /> Offline — queued
      </Badge>
    );
  if (state === "pending")
    return (
      <Badge variant="outline" className="gap-1 text-[10px] font-normal text-muted-foreground">
        <Circle className="h-2 w-2 fill-current animate-pulse" /> Unsaved changes
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-[10px] font-normal text-muted-foreground">
      <Circle className="h-2 w-2 fill-current" /> Auto-save
    </Badge>
  );
}

// ---------------- Cell input (Tab/Enter friendly) ----------------

export function CellInput({
  value,
  onCommit,
  placeholder,
  className,
  density = "compact",
  type = "text",
  inputMode,
  draftKey,
  autosaveDelay = 1200,
  onDirty,
}: {
  value: string | number | null | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  density?: Density;
  type?: string;
  inputMode?: any;
  /** Optional stable key for localStorage draft mirror. Skip to disable drafts. */
  draftKey?: string;
  /** Debounce in ms before background commit fires while typing. Default 1200ms. */
  autosaveDelay?: number;
  /** Notified the first time local diverges from the server value (for "unsaved" pill). */
  onDirty?: () => void;
}) {
  const stringify = (v: string | number | null | undefined) => (v == null ? "" : String(v));
  const initial = stringify(value);
  const [local, setLocal] = useState(initial);
  const focusedRef = useRef(false);
  const lastSyncedRef = useRef(initial);
  const lastCommittedRef = useRef(initial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cross-coach conflict: when server value diverges while user has unsaved
  // local edits, surface a tiny "keep mine / use latest" prompt and pause
  // autosave so we don't silently clobber the other coach's change.
  const [conflictRemote, setConflictRemote] = useState<string | null>(null);

  // ---- Local draft hydration (only on first mount, only if input was actually
  // edited last session AND the server value still matches the baseline at the
  // time we stored the draft — so we never blow away another coach's update).
  useEffect(() => {
    if (!draftKey || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`lov:pb:cell:${draftKey}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { local: string; baseline: string };
      if (parsed.baseline === initial && parsed.local !== initial) {
        setLocal(parsed.local);
        onDirty?.();
      } else {
        // Stale draft — server has moved on. Drop it silently.
        window.localStorage.removeItem(`lov:pb:cell:${draftKey}`);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Sync from prop without disrupting typing.
  useEffect(() => {
    const next = stringify(value);
    if (next === lastSyncedRef.current) return;
    const hadLocalEdit = local !== lastCommittedRef.current;
    lastSyncedRef.current = next;
    // Don't overwrite live typing. Only sync if the input isn't focused AND
    // local matches what we last committed (i.e. user has no unsaved diff).
    if (!focusedRef.current && !hadLocalEdit) {
      setLocal(next);
      lastCommittedRef.current = next;
      if (draftKey && typeof window !== "undefined") {
        try { window.localStorage.removeItem(`lov:pb:cell:${draftKey}`); } catch {}
      }
      setConflictRemote(null);
      return;
    }
    // User has an in-flight local edit AND the server value changed to
    // something that isn't what they're typing → another coach saved.
    if (hadLocalEdit && next !== local) {
      setConflictRemote(next);
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const writeDraft = (v: string) => {
    if (!draftKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        `lov:pb:cell:${draftKey}`,
        JSON.stringify({ local: v, baseline: lastSyncedRef.current }),
      );
    } catch {}
  };
  const clearDraft = () => {
    if (!draftKey || typeof window === "undefined") return;
    try { window.localStorage.removeItem(`lov:pb:cell:${draftKey}`); } catch {}
  };

  const commit = (v: string) => {
    if (v === lastCommittedRef.current) return;
    if (v === stringify(value)) {
      // Value already matches server — nothing to send. Still clear draft.
      lastCommittedRef.current = v;
      clearDraft();
      return;
    }
    lastCommittedRef.current = v;
    clearDraft();
    onCommit(v);
  };

  // Debounced autosave: fire commit after the user pauses typing.
  useEffect(() => {
    if (local === lastCommittedRef.current) return;
    // Block silent commits while a conflict is unresolved — user must pick.
    if (conflictRemote !== null) return;
    onDirty?.();
    writeDraft(local);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(local), autosaveDelay);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, conflictRemote]);

  // Listen for global flush ("Save now" button or manual flush).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      if (conflictRemote === null) commit(local);
    };
    window.addEventListener(PB_FLUSH_EVENT, handler);
    return () => window.removeEventListener(PB_FLUSH_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, conflictRemote]);

  // Fill-down: copy the current value into every input in the same column
  // BELOW this one within the same [data-pb-grid]. Uses the native value
  // setter so React's onChange fires on each target CellInput (which then
  // sets local state and triggers its debounced commit).
  const runFillDown = (sourceEl: HTMLInputElement) => {
    const grid = sourceEl.closest("[data-pb-grid]") as HTMLElement | null;
    if (!grid) return 0;
    const cols = Number(grid.getAttribute("data-pb-cols") ?? 1) || 1;
    const all = Array.from(grid.querySelectorAll<HTMLInputElement>(".pb-cell-input"));
    const idx = all.indexOf(sourceEl);
    if (idx < 0) return 0;
    const col = idx % cols;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    let n = 0;
    for (let i = idx + cols; i < all.length; i += cols) {
      const target = all[i];
      if (!target) continue;
      if (i % cols !== col) continue;
      if (target.disabled || target.readOnly) continue;
      const v = sourceEl.value;
      if (target.value === v) continue;
      setter?.call(target, v);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      n++;
    }
    return n;
  };

  const inputEl = (
    <Input
      type={type}
      inputMode={inputMode}
      placeholder={placeholder}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={(e) => { focusedRef.current = true; e.currentTarget.select(); }}
      onBlur={() => {
        focusedRef.current = false;
        if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
        if (conflictRemote === null) commit(local);
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "ArrowDown") {
          e.preventDefault();
          // Commit current value first so the fill source is the latest typed text.
          if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
          if (conflictRemote === null) commit(local);
          runFillDown(e.currentTarget as HTMLInputElement);
          return;
        }
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
          const all = Array.from(
            (e.target as HTMLInputElement)
              .closest("[data-pb-grid]")
              ?.querySelectorAll<HTMLInputElement>(".pb-cell-input") ?? [],
          );
          const idx = all.indexOf(e.target as HTMLInputElement);
          const cols = Number((e.target as HTMLInputElement).closest("[data-pb-grid]")?.getAttribute("data-pb-cols") ?? 1);
          const next = all[idx + cols];
          next?.focus();
          next?.select();
        } else if (e.key === "Escape") {
          setLocal(lastCommittedRef.current);
          clearDraft();
          setConflictRemote(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(
        "pb-cell-input",
        DENSITY_CLASSES[density].input,
        "pr-5",
        conflictRemote !== null && "border-amber-500/70 ring-1 ring-amber-500/40",
        className,
      )}
    />
  );

  const wrappedInput = (
    <div className="group/pbcell relative w-full">
      {inputEl}
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => {
          // Don't steal focus from the input — we want its value to be source-of-truth.
          e.preventDefault();
        }}
        onClick={(e) => {
          const wrapper = (e.currentTarget as HTMLElement).parentElement;
          const input = wrapper?.querySelector<HTMLInputElement>(".pb-cell-input");
          if (!input) return;
          if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
          if (conflictRemote === null) commit(local);
          runFillDown(input);
        }}
        title="Fill down to all rows below (⌘↓)"
        aria-label="Fill down to all rows below"
        className="absolute right-0.5 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/pbcell:opacity-100 group-focus-within/pbcell:opacity-100"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
    </div>
  );

  if (conflictRemote === null) return wrappedInput;

  return (
    <div className="relative w-full">
      {wrappedInput}
      <div className="absolute left-0 right-0 top-full z-40 mt-1 min-w-[180px] rounded-md border border-amber-500/60 bg-background p-1.5 text-[10px] shadow-lg">
        <div className="flex items-start gap-1">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-amber-600 dark:text-amber-400">This field was updated somewhere else.</div>
            <div className="truncate text-muted-foreground">
              Latest saved: <span className="font-mono text-foreground">{conflictRemote || "(empty)"}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <button
                onClick={() => setConflictRemote(null)}
                className="rounded bg-amber-500 px-1.5 py-0.5 font-semibold text-white hover:bg-amber-600"
                title="Keep your edit — it will autosave over the latest value"
              >
                Keep mine
              </button>
              <button
                onClick={() => {
                  setLocal(conflictRemote);
                  lastCommittedRef.current = conflictRemote;
                  clearDraft();
                  setConflictRemote(null);
                }}
                className="rounded border border-border bg-background px-1.5 py-0.5 hover:bg-secondary"
                title="Discard your edit and use the latest saved value"
              >
                Use latest
              </button>
              <button
                onClick={() => setConflictRemote(null)}
                className="rounded border border-border bg-background px-1.5 py-0.5 text-muted-foreground hover:bg-secondary"
                title="Dismiss this warning without committing"
              >
                Review
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Exercise library panel ----------------

const FAV_KEY = "pb.favorites";
function readFavs(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function writeFavs(s: Set<string>) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); } catch {}
}

export interface ExerciseRef {
  id: string;
  name: string;
  muscle_group?: string | null;
  category?: string | null;
  equipment?: string | null;
  tags?: string[] | null;
}

const QUICK_FILTERS = [
  "Squat", "Bench", "Deadlift", "Chest", "Back", "Shoulders",
  "Quads", "Hamstrings", "Glutes", "Arms", "Accessories", "Mobility",
];

function exerciseMatchesFilter(ex: ExerciseRef, f: string): boolean {
  const hay = [ex.name, ex.muscle_group, ex.category, ...(ex.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(f.toLowerCase());
}

export function ExerciseLibraryPanel({
  exercises,
  recentIds = [],
  onPick,
  onQuickAdd,
  selectedDayLabel,
  collapsed,
  onToggleCollapse,
}: {
  exercises: ExerciseRef[];
  recentIds?: string[];
  onPick?: (id: string) => void;
  /** Called by the row "+" button — should add to the currently selected day. */
  onQuickAdd?: (id: string) => void;
  /** Shown next to the search input, e.g. "→ Day 1". */
  selectedDayLabel?: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [favs, setFavs] = useState<Set<string>>(() => readFavs());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global keyboard shortcuts:
  //   "/"   → focus the search input (and expand if collapsed)
  //   Esc   → clear the search input when focused
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (target?.isContentEditable ?? false);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (collapsed) onToggleCollapse?.();
        // wait a tick in case we just expanded
        setTimeout(() => inputRef.current?.focus(), 0);
      } else if (e.key === "Escape" && document.activeElement === inputRef.current) {
        setQ("");
        (document.activeElement as HTMLElement)?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, onToggleCollapse]);

  // Custom events from <ProgramBuilderShortcutsButton />
  useEffect(() => {
    const focus = () => {
      if (collapsed) onToggleCollapse?.();
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    const clear = () => {
      setQ("");
      inputRef.current?.focus();
    };
    const close = () => {
      if (document.activeElement === inputRef.current) {
        (document.activeElement as HTMLElement)?.blur();
      }
      if (!collapsed) onToggleCollapse?.();
    };
    window.addEventListener("pb:focus-search", focus);
    window.addEventListener("pb:clear-search", clear);
    window.addEventListener("pb:close-search", close);
    return () => {
      window.removeEventListener("pb:focus-search", focus);
      window.removeEventListener("pb:clear-search", clear);
      window.removeEventListener("pb:close-search", close);
    };
  }, [collapsed, onToggleCollapse]);

  const toggleFav = (id: string) => {
    const next = new Set(favs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFavs(next);
    writeFavs(next);
  };

  const filtered = useMemo(() => {
    let list = exercises;
    if (filter) list = list.filter((e) => exerciseMatchesFilter(e, filter));
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((e) =>
        e.name.toLowerCase().includes(needle) ||
        (e.muscle_group ?? "").toLowerCase().includes(needle) ||
        (e.tags ?? []).some((t) => t.toLowerCase().includes(needle))
      );
    }
    return list.slice(0, 200);
  }, [exercises, q, filter]);

  const recent = useMemo(() => {
    const map = new Map(exercises.map((e) => [e.id, e]));
    return recentIds.map((id) => map.get(id)).filter(Boolean) as ExerciseRef[];
  }, [exercises, recentIds]);

  const favList = useMemo(
    () => exercises.filter((e) => favs.has(e.id)).slice(0, 20),
    [exercises, favs],
  );

  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-r border-border bg-card">
        <Button size="icon" variant="ghost" className="mt-2" onClick={onToggleCollapse} title="Show exercise library (press /)">
          <Search className="h-4 w-4" />
        </Button>
        <kbd className="mt-1 rounded border border-border bg-background px-1 text-[9px] font-mono text-muted-foreground">/</kbd>
      </div>
    );
  }

  return (
    <div className="flex h-full w-60 flex-col border-r border-border bg-card text-xs">
      <div className="border-b-2 border-border">
        <div className="flex items-center gap-1.5 p-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search exercises…   ( / )"
            className="h-8 border-0 bg-transparent px-1 text-sm font-medium focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); setQ(""); (e.currentTarget as HTMLInputElement).blur(); }
            }}
          />
          {q && (
            <button
              type="button"
              onClick={() => { setQ(""); inputRef.current?.focus(); }}
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Clear (Esc)"
            >
              ×
            </button>
          )}
          <kbd
            title="Press / to focus, Esc to clear"
            className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-background px-1 font-mono text-[10px] text-muted-foreground"
          >
            /
          </kbd>
          {onToggleCollapse && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onToggleCollapse} title="Hide">
              ×
            </Button>
          )}
        </div>
        {(selectedDayLabel || onQuickAdd) && (
          <div className="px-2 pb-1 text-[10px] text-muted-foreground">
            {selectedDayLabel ? <>Adds to <span className="font-semibold text-foreground">{selectedDayLabel}</span></> : <>Click a day to select an add target</>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        <button
          onClick={() => setFilter(null)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px]",
            filter === null ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {QUICK_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(filter === f ? null : f)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {favList.length > 0 && !q && !filter && (
          <Section label="Favorites">
            {favList.map((e) => (
              <ExerciseItem key={e.id} ex={e} fav onFav={toggleFav} onPick={onPick} />
            ))}
          </Section>
        )}
        {recent.length > 0 && !q && !filter && (
          <Section label="Recent">
            {recent.map((e) => (
              <ExerciseItem key={e.id} ex={e} fav={favs.has(e.id)} onFav={toggleFav} onPick={onPick} />
            ))}
          </Section>
        )}
        <Section label={q || filter ? "Results" : "Library"}>
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-[11px] text-muted-foreground">No exercises.</div>
          ) : (
            filtered.map((e) => (
              <ExerciseItem key={e.id} ex={e} fav={favs.has(e.id)} onFav={toggleFav} onPick={onPick} onQuickAdd={onQuickAdd} />
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sticky top-0 z-10 bg-card/95 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ExerciseItem({
  ex,
  fav,
  onFav,
  onPick,
  onQuickAdd,
}: {
  ex: ExerciseRef;
  fav?: boolean;
  onFav: (id: string) => void;
  onPick?: (id: string) => void;
  onQuickAdd?: (id: string) => void;
}) {
  const tagLine = [ex.muscle_group, ex.category].filter(Boolean).join(" · ");
  return (
    <div
      draggable
      onDragStart={(e) => setDragExercise(e, ex.id)}
      onDoubleClick={() => onPick?.(ex.id)}
      title="Drag into a day, click + to add to selected day, or double-click to add to first day"
      className="group flex cursor-grab items-center gap-1 border-b border-border/50 px-2 py-1 hover:bg-secondary/50 active:cursor-grabbing"
    >
      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">{ex.name}</div>
        {tagLine && <div className="truncate text-[10px] text-muted-foreground">{tagLine}</div>}
      </div>
      {onQuickAdd && (
        <button
          onClick={(e) => { e.stopPropagation(); onQuickAdd(ex.id); }}
          className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-primary hover:bg-primary/10"
          title="Add to selected day"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onFav(ex.id); }}
        className={cn(
          "opacity-0 group-hover:opacity-100",
          fav && "opacity-100 text-yellow-500",
        )}
        title={fav ? "Unfavorite" : "Favorite"}
      >
        <Star className={cn("h-3 w-3", fav && "fill-current")} />
      </button>
    </div>
  );
}

// ---------------- Copy week dialog ----------------

export function CopyWeekDialog({
  open,
  onOpenChange,
  weeks,
  defaultSrcId,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  weeks: { id: string; week_index: number }[];
  defaultSrcId?: string;
  onCopy: (opts: { srcWeekId: string; targetWeekId: string; prescriptions: boolean; notes: boolean }) => Promise<void>;
}) {
  const [src, setSrc] = useState<string>(defaultSrcId ?? weeks[0]?.id ?? "");
  const [tgt, setTgt] = useState<string>(weeks[1]?.id ?? "");
  const [prescriptions, setPrescriptions] = useState(true);
  const [notes, setNotes] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSrc(defaultSrcId ?? weeks[0]?.id ?? "");
      const defIdx = weeks.findIndex((w) => w.id === (defaultSrcId ?? weeks[0]?.id));
      setTgt(weeks[defIdx + 1]?.id ?? weeks[1]?.id ?? "");
    }
  }, [open, defaultSrcId, weeks]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy week</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>From</Label>
              <Select value={src} onValueChange={setSrc}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {weeks.map((w) => <SelectItem key={w.id} value={w.id}>Week {w.week_index}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Into</Label>
              <Select value={tgt} onValueChange={setTgt}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {weeks.filter((w) => w.id !== src).map((w) => (
                    <SelectItem key={w.id} value={w.id}>Week {w.week_index}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2 rounded-md border border-border p-3">
            <label className="flex items-center gap-2">
              <Checkbox checked={prescriptions} onCheckedChange={(v) => setPrescriptions(!!v)} />
              <span>Copy prescriptions (sets, reps, RPE, %, load, rest, tempo)</span>
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={notes} onCheckedChange={(v) => setNotes(!!v)} />
              <span>Copy notes & cues</span>
            </label>
            <p className="text-[11px] text-muted-foreground">
              Client results are never copied. The target week is replaced.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            disabled={!src || !tgt || src === tgt || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onCopy({ srcWeekId: src, targetWeekId: tgt, prescriptions, notes });
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Copying…" : "Copy week"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Movement priority chip ----------------

export type MovementPriority = "Primary" | "Secondary" | "Tertiary" | "Accessory" | "Warm-Up" | "Conditioning";

export const PRIORITY_OPTIONS: MovementPriority[] = [
  "Primary", "Secondary", "Tertiary", "Accessory", "Warm-Up", "Conditioning",
];

/** Infer a movement priority from time_profile + exercise name (used when no explicit label). */
export function inferPriority(timeProfile?: string | null, name?: string | null): MovementPriority {
  if (timeProfile === "main_lift") return "Primary";
  if (timeProfile === "secondary_lift") return "Secondary";
  if (timeProfile === "warmup_mobility") return "Warm-Up";
  if (timeProfile === "conditioning") return "Conditioning";
  if (timeProfile === "accessory_compound") return "Tertiary";
  return "Accessory";
}

/** Selectable card-color palette for exercise rows. */
export const EXERCISE_CARD_COLORS: { value: string; label: string; cls: string; swatch: string }[] = [
  { value: "red",     label: "Red",     cls: "bg-red-500/70",     swatch: "bg-red-500" },
  { value: "amber",   label: "Amber",   cls: "bg-amber-500/70",   swatch: "bg-amber-500" },
  { value: "yellow",  label: "Yellow",  cls: "bg-yellow-500/70",  swatch: "bg-yellow-500" },
  { value: "emerald", label: "Green",   cls: "bg-emerald-500/70", swatch: "bg-emerald-500" },
  { value: "sky",     label: "Blue",    cls: "bg-sky-500/70",     swatch: "bg-sky-500" },
  { value: "violet",  label: "Violet",  cls: "bg-violet-500/70",  swatch: "bg-violet-500" },
  { value: "purple",  label: "Purple",  cls: "bg-purple-500/70",  swatch: "bg-purple-500" },
  { value: "pink",    label: "Pink",    cls: "bg-pink-500/70",    swatch: "bg-pink-500" },
  { value: "slate",   label: "Slate",   cls: "bg-slate-500/70",   swatch: "bg-slate-500" },
];

/**
 * Tailwind color for an exercise card's left edge accent.
 * - Competition Squat / Bench / Deadlift keep their distinctive colors.
 * - Everything else defaults to red.
 * - A per-row `override` (e.g. row.card_color) takes precedence.
 */
export function movementAccent(name?: string | null, override?: string | null): string {
  if (override) {
    const found = EXERCISE_CARD_COLORS.find((c) => c.value === override);
    if (found) return found.cls;
  }
  void name;
  return "bg-red-500/70";
}

/**
 * Metadata-driven card accent. Uses exercise category and competition-lift
 * type — never matches on the exercise name. Prefer this over `movementAccent`
 * in new code. A per-row `override` (row.card_color) still wins.
 */
export function exerciseAccent(
  ex?: {
    is_competition_lift?: boolean | null;
    competition_lift_type?: "squat" | "bench" | "deadlift" | null;
    exercise_category?: "competition" | "variation" | "assistance" | null;
  } | null,
  override?: string | null,
): string {
  if (override) {
    const found = EXERCISE_CARD_COLORS.find((c) => c.value === override);
    if (found) return found.cls;
  }
  if (ex?.is_competition_lift) {
    switch (ex.competition_lift_type) {
      case "squat":    return "bg-yellow-500/70";
      case "bench":    return "bg-sky-500/70";
      case "deadlift": return "bg-emerald-500/70";
    }
  }
  if (ex?.exercise_category === "variation") return "bg-amber-500/70";
  return "bg-red-500/70";
}

// ---------------- Edit scope dialog ----------------

export type EditScopeChoice = "this" | "future" | "all" | "cancel";

export function EditScopeDialog({
  open,
  onOpenChange,
  onChoose,
  customDownstream = 0,
  description,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChoose: (choice: EditScopeChoice) => void;
  /** Count of custom days downstream (warning case). */
  customDownstream?: number;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onChoose("cancel"); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How should this change apply?</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          {description && <p className="text-muted-foreground">{description}</p>}
          {customDownstream > 0 && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              {customDownstream} downstream day{customDownstream === 1 ? "" : "s"} {customDownstream === 1 ? "has" : "have"} custom edits and will be preserved.
            </p>
          )}
          <div className="space-y-1.5 pt-2">
            <ScopeButton label="This day only" hint="Change just this day. Future weeks stay as they are." onClick={() => onChoose("this")} />
            <ScopeButton label="This day + future weeks" hint="Apply to this day and every later week's matching day (skips custom)." onClick={() => onChoose("future")} />
            <ScopeButton label="All matching days in block" hint="Apply to every week's matching day in this block (skips custom)." onClick={() => onChoose("all")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onChoose("cancel")}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeButton({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-md border border-border p-2 text-left text-sm hover:border-primary hover:bg-primary/5"
    >
      <div className="font-semibold">{label}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </button>
  );
}

// ---------------- Link badge ----------------

export function LinkBadge({
  isCustom,
  sourceLabel,
  onBreak,
  onRelink,
}: {
  isCustom: boolean;
  /** e.g. "W1 D2". null = no link. */
  sourceLabel?: string | null;
  onBreak?: () => void;
  onRelink?: () => void;
}) {
  if (isCustom) {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-500 text-[10px]">
        <Unlink className="h-3 w-3" /> Custom
        {onRelink && (
          <button onClick={onRelink} className="ml-1 underline hover:text-amber-400" title="Re-link to previous week">re-link</button>
        )}
      </Badge>
    );
  }
  if (sourceLabel) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
        <LinkIcon className="h-3 w-3" /> Linked to {sourceLabel}
        {onBreak && (
          <button onClick={onBreak} className="ml-1 underline hover:text-foreground" title="Break link">break</button>
        )}
      </Badge>
    );
  }
  return null;
}