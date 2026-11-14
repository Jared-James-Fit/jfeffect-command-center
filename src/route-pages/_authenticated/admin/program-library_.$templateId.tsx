import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditWithAiButton } from "@/components/program-ai/edit-with-ai";
import { AlertTriangle, ArrowLeft, Check, Dumbbell, X, MoreHorizontal, Smartphone, Search, Plus, Trash2, Save, Clock, Copy, LayoutGrid, CalendarRange, ArrowRight, ZoomIn, ZoomOut, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Rows3, ChevronDown, ChevronUp, Settings2, Undo2, Redo2, ClipboardCopy, ClipboardPaste, Expand, RotateCcw, ArrowLeftRight, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import {
  getTemplate, updateTemplate, summarizeTemplatePayload, TIME_PROFILES,
  estimateDayMinutes, durationRange, PERCENTAGE_BASES, type TrainingStyle,
} from "@/lib/pl-programs";
import { ExerciseLibraryPanel, type ExerciseRef, DND_EXERCISE, readDrop, exerciseAccent, HighlightedText, usePbDragging, beginPbDrag, endPbDrag } from "@/components/program-builder";
import { searchExercises, type SearchableExercise } from "@/lib/exercise-search";
import { resolveMovementFamily } from "@/lib/exercise-family";
import { ExerciseOrderBadge } from "@/components/exercise-order-badge";
import { derivePurposeLabels, deriveWeeklyPurposeLabelByRowId, defaultRestSeconds, effectiveRestSeconds, PURPOSE_LABEL_OPTIONS, resolveCategory, purposeLabelBadgeClass, purposeLabelText } from "@/lib/exercise-metadata";
import { validateDay } from "@/lib/pl-template-validation";
import { ProgramBuilderShortcutsButton } from "@/components/program-builder-shortcuts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobileNow } from "@/hooks/use-mobile";
import { BestOnComputerTip } from "@/components/best-on-computer-tip";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { createPortal } from "react-dom";
import { DayDateButton } from "@/components/workout-day/day-date-button";
import { formatDayLabel, formatDaySubtitle } from "@/lib/workout-day-label";
import {
  PROGRAM_DAY_STATUS_META,
  type ProgramDayScheduleStatus,
} from "@/lib/program-schedule-status";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";
import { useConflictWatch } from "@/hooks/use-conflict-watch";
import { usePersistentUndoStack } from "@/lib/persistent-undo";
import { useScrollRestoration } from "@/lib/scroll-restore";
import { BuilderHeader, BuilderTitleInput } from "@/components/program-editor/builder-chrome";
import { ActionButton } from "@/components/action-button";
import { copyRows, useClip } from "@/lib/program-builder-clipboard";
import { formatDuration } from "@/lib/duration";
import { useBuilderExerciseLibrary } from "@/lib/builder-exercise-library";
import { weekPurposeLabelsByDay } from "@/lib/program-editor-labels";
import { CountdownTimerButton } from "@/components/countdown-timer-button";
import { DurationInput } from "@/components/duration-input";
import { ExerciseBlocksEditor } from "@/components/exercise-blocks-editor";
import { useMultiBlockBuilderFlag } from "@/lib/admin-flags";
import { Layers } from "lucide-react";
import { createContext, useContext } from "react";
import { listClientMaxes, buildMaxIndex, computeRowLoad, type ClientMaxRow } from "@/lib/pl-maxes";
import { hasRpeCap, isMaxBasis, plannedLoadLabel, referenceFamily } from "@/lib/workouts/load-reference";
import { MaxEditorDialog } from "@/components/client-maxes-panel";
import { BlockMaxesButton, BlockMaxesDialog } from "@/components/block-maxes-panel";
import { AlertCircle as PbAlertCircle, Calculator as PbCalculator } from "lucide-react";
import { WeeklyVolumeSummary } from "@/components/volume/weekly-volume-summary";
import {
  normalizeTemplatePayload,
  serializeTemplatePayload,
  getActiveTemplateBlocks,
  getArchivedTemplateBlocks,
  getTrashedTemplateBlocks,
  addBlankBlock,
  replaceBlock,
  reorderActiveBlocks,
  setBlockArchived,
  setBlockTrashed,
  purgeTrashedBlock,
  cloneTemplateBlock,
  BLOCK_PHASE_OPTIONS,
  isPayloadInRecovery,
  type TemplatePayloadV2,
  type TemplateBlockV2,
} from "@/lib/pl-template-blocks";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArchiveRestore, Archive as ArchiveIcon, Pencil } from "lucide-react";
import { ProgramStatusBadge } from "@/components/programs/program-status-badge";
import { MembershipListingSheet } from "@/components/programs/membership-listing-sheet";
import { useAuth } from "@/lib/auth";
import { AddExtraDayDialog } from "@/components/add-extra-day-dialog";
import { getRouteApi as __getRouteApi } from "@tanstack/react-router";
const Route = __getRouteApi("/_authenticated/admin/program-library_/$templateId");


// ---------------- Day focus + expand/collapse bus ----------------
// Module-level event bus that lets the program builder know which day
// the coach is currently working on, broadcast "expand all" /
// "collapse all" pulses to every row in that day, and auto-collapse
// the previously-active day when focus moves to a new one.
type DayBusEvent = "expand" | "collapse";
const dayBus = (() => {
  const listeners: Record<string, Set<(ev: DayBusEvent) => void>> = {};
  const activeSubs = new Set<(k: string | null) => void>();
  let active: string | null = null;
  return {
    on(key: string, cb: (ev: DayBusEvent) => void) {
      const set = (listeners[key] ||= new Set());
      set.add(cb);
      return () => { set.delete(cb); };
    },
    emit(key: string, ev: DayBusEvent) {
      listeners[key]?.forEach((fn) => fn(ev));
    },
    getActive() { return active; },
    setActive(key: string | null) {
      if (active === key) return;
      const prev = active;
      active = key;
      // Auto-collapse all rows in the day we just left.
      if (prev) listeners[prev]?.forEach((fn) => fn("collapse"));
      activeSubs.forEach((fn) => fn(active));
    },
    subscribeActive(cb: (k: string | null) => void) {
      activeSubs.add(cb);
      return () => { activeSubs.delete(cb); };
    },
  };
})();

function useDayActive(dayKey: string | undefined): boolean {
  const [isActive, setIsActive] = useState(() => !!dayKey && dayBus.getActive() === dayKey);
  useEffect(() => {
    if (!dayKey) return;
    setIsActive(dayBus.getActive() === dayKey);
    return dayBus.subscribeActive((k) => setIsActive(k === dayKey));
  }, [dayKey]);
  return isActive;
}

// ---------------- Fast local-state cell (instant typing, debounced commit) ---
// Keeps keystrokes local so parent rows/days/blocks don't re-render per digit.
// Commits to parent on blur, Enter, or after a short pause.
function parseIntOrNull(s: string | null): number | null {
  if (s == null || s === "") return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
function parseFloatOrNull(s: string | null): number | null {
  if (s == null || s === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function RowCell({
  value, onCommit, className, placeholder, inputMode, commitDelay = 400, dataField,
}: {
  value: string | number | null | undefined;
  onCommit: (v: string | null) => void;
  className?: string;
  placeholder?: string;
  inputMode?: any;
  commitDelay?: number;
  dataField?: string;
}) {
  const stringify = (v: string | number | null | undefined) => (v == null ? "" : String(v));
  const [local, setLocal] = useState(() => stringify(value));
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef(stringify(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Pull in remote changes only when the input isn't being edited.
  useEffect(() => {
    const next = stringify(value);
    if (focusedRef.current) return;
    if (next === local) return;
    setLocal(next);
    lastCommittedRef.current = next;
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const doCommit = (s: string) => {
    if (s === lastCommittedRef.current) return;
    lastCommittedRef.current = s;
    onCommit(s === "" ? null : s);
  };

  return (
    <span className="group/cell relative inline-block w-full align-middle">
    <Input
      ref={inputRef as any}
      className={className}
      placeholder={placeholder}
      inputMode={inputMode}
      value={local}
      data-pb-field={dataField}
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => doCommit(v), commitDelay);
      }}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        doCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setLocal(lastCommittedRef.current);
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (handleRowFieldNav(e, { value: local })) {
          // committed handler took over
          return;
        }
      }}
    />
    {dataField ? (
      <button
        type="button"
        tabIndex={-1}
        title="Fill down (⌘/Ctrl + ↓)"
        aria-label="Fill down"
        onMouseDown={(e) => { e.preventDefault(); }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Commit any pending edit first so the source value is current.
          if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
          doCommit(local);
          fillDownFromCell(inputRef.current, local);
        }}
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-10 hidden group-hover/cell:flex items-center justify-center h-4 w-4 rounded-sm bg-primary text-primary-foreground shadow ring-1 ring-background hover:bg-primary/90"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
    ) : null}
    </span>
  );
}

// ---- Spreadsheet-style keyboard navigation for builder rows -------------
// Inputs that participate must carry a `data-pb-field` attribute and live
// inside a `[data-pb-row]` container; rows live inside `[data-pb-day]`.
const NAV_FIELDS = [
  "sets","reps","rpe","rir","rest","tempo","percentage","load","unit",
] as const;

function focusField(el: HTMLElement | null) {
  if (!el) return;
  el.focus();
  if (el instanceof HTMLInputElement && (el.type === "text" || el.type === "number" || !el.type)) {
    try { el.select(); } catch {}
  }
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function fieldsInRow(row: Element): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>("[data-pb-field]"))
    .filter((el) => !(el as any).disabled && el.offsetParent !== null);
}

/**
 * Fill the given value into every input with the same data-pb-field
 * in rows BELOW the source cell, scoped to the same day. Uses the
 * native input value setter so React's onChange fires and the row's
 * debounced commit pipeline persists each new value.
 */
function fillDownFromCell(source: HTMLInputElement | null, value: string) {
  if (!source) return 0;
  const fieldName = source.getAttribute("data-pb-field");
  if (!fieldName) return 0;
  const row = source.closest("[data-pb-row]");
  const day = source.closest("[data-pb-day]");
  if (!row || !day) return 0;
  const rows = Array.from(day.querySelectorAll<HTMLElement>("[data-pb-row]"));
  const ri = rows.indexOf(row as HTMLElement);
  if (ri < 0) return 0;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  let count = 0;
  for (let i = ri + 1; i < rows.length; i++) {
    const peer = rows[i].querySelector<HTMLInputElement>(`input[data-pb-field="${fieldName}"]`);
    if (!peer || (peer as any).disabled) continue;
    if (peer.value === value) continue;
    setter?.call(peer, value);
    peer.dispatchEvent(new Event("input", { bubbles: true }));
    peer.dispatchEvent(new Event("change", { bubbles: true }));
    count++;
  }
  if (count > 0) {
    try { toast.success(`Filled "${value || "—"}" into ${count} row${count === 1 ? "" : "s"} below`); } catch {}
  }
  return count;
}

/**
 * Handle Enter / Shift+Enter / left-right (at caret boundary) / up-down
 * navigation between editable prescription fields. Returns true if the
 * event was handled.
 */
export function handleRowFieldNav(
  e: React.KeyboardEvent<HTMLInputElement>,
  opts?: { value?: string },
): boolean {
  const target = e.currentTarget;
  const row = target.closest("[data-pb-row]");
  if (!row) return false;
  const fields = fieldsInRow(row);
  const idx = fields.indexOf(target);
  if (idx < 0) return false;
  const len = (opts?.value ?? target.value ?? "").length;
  const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
  const atEnd = target.selectionStart === len && target.selectionEnd === len;

  const moveSibling = (delta: number) => {
    const next = fields[idx + delta];
    if (next) {
      e.preventDefault();
      // Commit pending edit (via blur) FIRST, then move focus on the next
      // frame so React has time to flush the re-render. Without this the
      // destination input would flicker / lose focus when the parent
      // re-rendered mid-keystroke — the "glitch" with arrow left/right.
      target.blur();
      requestAnimationFrame(() => focusField(next));
      return true;
    }
    // wrap to adjacent row, same column
    const day = row.closest("[data-pb-day]");
    if (day) {
      const rows = Array.from(day.querySelectorAll<HTMLElement>("[data-pb-row]"));
      const ri = rows.indexOf(row as HTMLElement);
      const nextRow = rows[ri + (delta > 0 ? 1 : -1)];
      if (nextRow) {
        const cols = fieldsInRow(nextRow);
        const col = cols[delta > 0 ? 0 : cols.length - 1];
        if (col) {
          e.preventDefault();
          target.blur();
          requestAnimationFrame(() => focusField(col));
          return true;
        }
      }
    }
    return false;
  };

  const moveVertical = (delta: number) => {
    const day = row.closest("[data-pb-day]");
    if (!day) return false;
    const rows = Array.from(day.querySelectorAll<HTMLElement>("[data-pb-row]"));
    const ri = rows.indexOf(row as HTMLElement);
    const nextRow = rows[ri + delta];
    if (!nextRow) return false;
    const fieldName = target.getAttribute("data-pb-field");
    const findPeer = () =>
      nextRow.querySelector<HTMLElement>(`[data-pb-field="${fieldName}"]`)
      ?? fieldsInRow(nextRow)[Math.min(idx, Math.max(fieldsInRow(nextRow).length - 1, 0))]
      ?? null;
    const peer = findPeer();
    if (peer) {
      e.preventDefault();
      target.blur();
      requestAnimationFrame(() => {
        const fresh = findPeer();
        if (fresh) focusField(fresh);
      });
      return true;
    }
    // Target row is collapsed → expand it by simulating a click, then focus
    // the same column on the next frame once inputs have mounted. This is
    // what made arrow-key nav feel "glitchy" — collapsed cards swallowed the
    // jump because their inputs weren't in the DOM yet.
    e.preventDefault();
    (nextRow as HTMLElement).click();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const after = findPeer();
        if (after) focusField(after);
      });
    });
    return true;
  };

  if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return moveSibling(1) || (target.blur(), true);
  }
  if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return moveSibling(-1) || (target.blur(), true);
  }
  if (e.key === "ArrowRight" && atEnd && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return moveSibling(1);
  }
  if (e.key === "ArrowLeft" && atStart && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return moveSibling(-1);
  }
  if (e.key === "ArrowDown" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return moveVertical(1);
  }
  if (e.key === "ArrowUp" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return moveVertical(-1);
  }
  if (e.key === "ArrowDown" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    fillDownFromCell(target, opts?.value ?? target.value ?? "");
    return true;
  }
  return false;
}

// ---- Format helpers ----
function fmtRestSeconds(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec} sec`;
  if (sec % 60 === 0) return `${sec / 60} min`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
const TIME_PROFILE_LABEL: Record<string, string> = {
  competition_lift: "Competition lift",
  heavy_compound: "Heavy compound",
  accessory_compound: "Accessory compound",
  isolation: "Isolation",
  machine: "Machine",
  bodyweight: "Bodyweight",
  core: "Core",
  cardio: "Cardio",
  custom: "Custom",
};

// ---- Client-max context shared by RowEditor regardless of nesting depth ----
type MaxesCtx = {
  clientId: string | null;
  blockId: string | null;
  maxes: ClientMaxRow[];
  index: Map<string, ClientMaxRow>;
  refresh: () => void;
};
const MaxesContext = createContext<MaxesCtx>({ clientId: null, blockId: null, maxes: [], index: new Map(), refresh: () => {} });
export function useClientMaxesCtx() { return useContext(MaxesContext); }

// ---- Phone layout (under 768px), set by StructureCanvas ----
// One week at a time, exercise rows that keep their names, a ⋯ per row, and
// exercises added and swapped from a searchable sheet instead of tiny
// popovers and a 2,000-item dropdown. Desktop is unchanged.
const BuilderPhoneContext = createContext(false);
const useBuilderPhone = () => useContext(BuilderPhoneContext);
const inRowMenu = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest("[data-row-menu]");
// Focus moving from an open card into something it opened (a menu, a select's
// list, a popover, the exercise picker) isn't leaving the card: folding it
// then would unmount what was just opened.
const inFloatingLayer = (t: EventTarget | null) =>
  t instanceof Element &&
  !!t.closest('[data-row-menu], [data-radix-popper-content-wrapper], [role="menu"], [role="listbox"], [role="dialog"]');

// ---- Editor preferences (compact mode, zoom, sidebar) ----
const PREFS_KEY = "pl-tpl-editor-prefs:v1";
type EditorPrefs = { compact: boolean; zoom: number; sidebarCollapsed: boolean };
const DEFAULT_PREFS: EditorPrefs = { compact: false, zoom: 0.9, sidebarCollapsed: false };
function readPrefs(): EditorPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return DEFAULT_PREFS; }
}
function writePrefs(p: EditorPrefs) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

// True when the exercise has at least one demo video link (any provider).
function hasExerciseVideo(ex: any): boolean {
  if (!ex) return false;
  const fields = [ex.video_url, ex.youtube_url, ex.vimeo_url];
  return fields.some((v) => typeof v === "string" && v.trim().length > 0);
}

// Append a row into the first day reachable inside any template payload shape.
export function appendRowToFirstDay(payload: any, type: string, row: any) {
  // New rows default to NO suggested load (percentage_basis="none").
  // Coaches must opt in via the "Include Suggested Load" toggle.
  const stamp = { sort_order: 0, sets: 3, reps_text: "8-12", time_profile: "accessory_compound", percentage_basis: "none", ...row };
  const pushIntoDay = (d: any) => {
    d.rows = d.rows || [];
    d.rows.push({ ...stamp, sort_order: d.rows.length });
  };
  if (type === "exercise_row") {
    Object.assign(payload, stamp);
    return;
  }
  if (type === "day") { pushIntoDay(payload); return; }
  if (type === "week") {
    const d = (payload.days || [])[0];
    if (d) pushIntoDay(d);
    return;
  }
  if (type === "block") {
    const w = (payload.weeks_data || [])[0];
    const d = (w?.days || [])[0];
    if (d) pushIntoDay(d);
    return;
  }
  if (type === "full_prep") {
    const b = (payload.blocks_data || [])[0];
    const w = (b?.weeks_data || [])[0];
    const d = (w?.days || [])[0];
    if (d) pushIntoDay(d);
  }
}

export function TemplateEditorErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  // eslint-disable-next-line no-console
  console.error("[program-library-template] route error", error);
  return (
    <div className="mx-auto max-w-lg space-y-3 p-8 text-center">
      <h2 className="text-lg font-semibold">Couldn't open this template</h2>
      <p className="text-sm text-muted-foreground">{error?.message ?? "The template editor failed to load."}</p>
      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
        <Link
          to="/admin/program-library"
          className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Back to library
        </Link>
      </div>
    </div>
  );
}

const STYLES: TrainingStyle[] = ["powerlifting", "bodybuilding", "strength", "lifestyle", "hybrid", "rehab", "conditioning", "custom"];

export function TemplateEditor() {
  const { templateId } = Route.useParams();
  const search = useSearch({ strict: false }) as { block?: string };
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdminViewer = role === "admin";
  const [membershipOpen, setMembershipOpen] = useState(false);

  const { data: tpl, isLoading } = useQuery({
    queryKey: ["pl-template", templateId],
    queryFn: () => getTemplate(templateId),
  });
  const { data: exercises = [] } = useBuilderExerciseLibrary();

  // local working state
  const [meta, setMeta] = useState<any>(null);
  const [payload, setPayload] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);
  // bumped to re-read the template from the server (after an Edit with AI change)
  const [reloadTick, setReloadTick] = useState(0);
  // JSON of the payload as first hydrated — the undo stack compares its
  // persisted content fingerprint against this to detect stale history.
  const initialPayloadJsonRef = useRef<string | null>(null);

  // ---- Undo / Redo history for payload ----
  const lastPushTs = useRef(0);
  // Durable per-template undo/redo. The server's `updated_at` is the
  // baseline marker — if the template was saved elsewhere since the last
  // visit, stored history is dropped (we never replay stale ops onto a
  // newer payload). See src/lib/persistent-undo.ts.
  const undoStack = usePersistentUndoStack({
    scope: `tpl:${templateId}`,
    baseline: (tpl as any)?.updated_at ?? null,
    freshSnapshot: hydratedRef.current ? initialPayloadJsonRef.current : null,
    enabled: hydratedRef.current,
  });
  const canUndo = undoStack.canUndo;
  const canRedo = undoStack.canRedo;

  useEffect(() => {
    if (tpl && !meta) {
      setMeta({
        name: tpl.name, training_style: tpl.training_style, training_focus: tpl.training_focus ?? "",
        description: (tpl as any).description ?? "",
        notes: tpl.notes ?? "", weeks: tpl.weeks ?? 0, days_per_week: tpl.days_per_week ?? 0,
        est_duration_min: tpl.est_duration_min ?? 0, tags: (tpl.tags ?? []).join(", "), status: tpl.status,
      });
      const freshPayload = JSON.parse(JSON.stringify(tpl.payload || {}));
      initialPayloadJsonRef.current = JSON.stringify(freshPayload);
      setPayload(freshPayload);
      hydratedRef.current = true;
    }
  }, [tpl, reloadTick]);

  const setM = (patch: any) => { setMeta({ ...meta, ...patch }); setDirty(true); };
  // The header's second row (the canvas's toolbar) and which view is open.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const phoneNow = useIsMobileNow();
  const setP = (next: any, opts?: { skipHistory?: boolean }) => {
    if (!opts?.skipHistory && payload != null) {
      const now = Date.now();
      // Coalesce rapid edits (e.g. typing) within 600ms into a single history step.
      if (now - lastPushTs.current > 600) {
        undoStack.pushSnapshot(JSON.stringify(payload), JSON.stringify(next));
      }
      lastPushTs.current = now;
    }
    setPayload(next);
    setDirty(true);
  };
  const undo = () => {
    if (payload == null) return;
    const prev = undoStack.undo(JSON.stringify(payload));
    if (!prev) return;
    setPayload(JSON.parse(prev));
    setDirty(true);
    lastPushTs.current = 0;
  };
  const redo = () => {
    if (payload == null) return;
    const next = undoStack.redo(JSON.stringify(payload));
    if (!next) return;
    setPayload(JSON.parse(next));
    setDirty(true);
    lastPushTs.current = 0;
  };

  const persist = async (m: any, p: any) => {
    await updateTemplate(templateId, {
      ...m,
      tags: m.tags.split(",").map((s: string) => s.trim()).filter(Boolean),
      weeks: m.weeks || null, days_per_week: m.days_per_week || null,
      est_duration_min: m.est_duration_min || null,
      training_focus: m.training_focus || null, notes: m.notes || null,
      description: (m.description ?? "").trim() || null,
      payload: p,
    });
    qc.invalidateQueries({ queryKey: ["pl-template", templateId] });
    qc.invalidateQueries({ queryKey: ["pl-templates"] });
  };

  const autosaveValue = useMemo(() => ({ meta, payload }), [meta, payload]);
  // Recovery gate: when the normalized payload is in __recovery mode, the
  // raw original payload is malformed. Block autosave so we never overwrite
  // it with an empty v2 shell. The structure editor also disables
  // destructive ops while recovery is active.
  const isRecovery = useMemo(() => {
    if (!payload) return false;
    const type = (tpl as any)?.template_type;
    if (type !== "block" && type !== "full_prep") return false;
    try {
      return isPayloadInRecovery(
        normalizeTemplatePayload(payload, { templateType: type, templateId }),
      );
    } catch { return false; }
  }, [payload, tpl, templateId]);
  const autosave = useAutosave({
    key: `template:${templateId}:editor`,
    value: autosaveValue,
    delay: 8000,
    enabled: !!meta && !!payload && hydratedRef.current && dirty && !isRecovery,
    onSave: async ({ meta: m, payload: p }) => {
      if (!m || !p) return;
      if (isRecovery) return; // belt-and-braces: never autosave recovery state
      await persist(m, p);
    },
  });
  // after Edit with AI changed the template, what was just re-read is the saved version
  const cleanTick = useRef(0);
  useEffect(() => {
    if (reloadTick > cleanTick.current && meta && payload) {
      cleanTick.current = reloadTick;
      autosave.markClean();
    }
  }, [reloadTick, meta, payload, autosave]);

  // Save-state truth: only clear the dirty flag once the autosave state
  // machine confirms a successful write with nothing still pending — a
  // background-settling timed-out request must never mark the editor clean
  // while the status chip still shows a failure.
  useEffect(() => {
    if (autosave.state === "saved" && !autosave.hasPending()) setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosave.state, autosaveValue]);

  // Cross-coach conflict watcher for the template meta fields.
  const remoteMeta = useMemo(() => tpl ? {
    name: tpl.name, training_style: tpl.training_style, training_focus: tpl.training_focus ?? "",
    description: (tpl as any).description ?? "",
    notes: tpl.notes ?? "", weeks: tpl.weeks ?? 0, days_per_week: tpl.days_per_week ?? 0,
    est_duration_min: tpl.est_duration_min ?? 0, tags: (tpl.tags ?? []).join(", "), status: tpl.status,
  } : undefined, [tpl]);
  const conflictWatch = useConflictWatch({
    remote: remoteMeta,
    local: meta,
    savedAt: autosave.savedAt,
  });

  // Restore the coach's vertical scroll for this template / selected block.
  // Scoped per user + template + active block so switching blocks doesn't
  // jump to the wrong saved position. Waits until the editor has hydrated.
  useScrollRestoration({
    key: `tpl:${templateId}:b:${search.block ?? "_"}`,
    ready: !!tpl && !!meta && !!payload,
    dependencies: [search.block ?? null],
  });

  const save = async () => {
    if (!meta || !payload) return;
    setSaving(true);
    try {
      // Single write path: flush pending autosave changes, or persist
      // directly when nothing is queued. Never both — the old
      // flush()+persist() double-write raced the two saves, and flush()
      // used to swallow failures so "Template saved" could appear after a
      // failed save. flush() now rejects on failure.
      if (autosave.hasPending()) {
        await autosave.flush();
      } else {
        await persist(meta, payload);
      }
      // an edit made while that was saving is still unsaved: it keeps its autosave
      if (!autosave.hasPending()) setDirty(false);
    } finally { setSaving(false); }
  };

  if (isLoading || !tpl || !meta || !payload) return <div className="p-8 text-sm text-muted-foreground">Loading template…</div>;

  const summary = summarizeTemplatePayload({ ...tpl, payload });
  const type = tpl.template_type;

  return (
    <EditorChrome
      meta={meta} summary={summary} typeLabel={type.replace("_", " ")}
      autosave={autosave} save={save} dirty={dirty}
      statusTemplate={{ ...tpl, payload }}
      onRename={(name) => setM({ name })}
      onToolbarEl={settingsOpen ? undefined : setToolbarEl}
      settingsOpen={settingsOpen}
      onToggleSettings={() => setSettingsOpen((v) => !v)}
      onMembership={isAdminViewer ? async () => {
        // members get what's saved: save what's on screen first
        if (dirty || autosave.hasPending()) await save();
        setMembershipOpen(true);
      } : undefined}
      aiTool={["block", "full_prep", "program"].includes(type) ? (
        <EditWithAiButton
          target={{ kind: "template", templateId }}
          title={meta.name || tpl.name}
          size="sm"
          variant="ghost"
          className="h-9 px-2.5"
          label={phoneNow ? "AI" : "Edit with AI"}
          // the AI reads what's saved: save what's on screen first
          beforeOpen={async () => { if (dirty || autosave.hasPending()) await save(); }}
          onApplied={async () => {
            // re-read the template as it is now (the hydration effect runs again)
            hydratedRef.current = false;
            setMeta(null);
            setPayload(null);
            setDirty(false);
            await qc.invalidateQueries({ queryKey: ["pl-template", templateId] });
            qc.invalidateQueries({ queryKey: ["pl-templates"] });
            setReloadTick((t) => t + 1);
          }}
        />
      ) : null}
    >
      {conflictWatch.conflict && (
          <Card className="flex flex-wrap items-start gap-3 border-amber-500/60 bg-amber-500/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-amber-700 dark:text-amber-400">This template was updated somewhere else.</div>
              <div className="text-xs text-muted-foreground">Another coach saved changes to the template settings after you started editing.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="default" onClick={conflictWatch.dismiss}>Keep mine</Button>
              <Button size="sm" variant="outline" onClick={() => {
                if (conflictWatch.conflict) {
                  setMeta({ ...(conflictWatch.conflict as any) });
                  setDirty(false);
                }
                conflictWatch.acceptRemote();
              }}>Use latest saved value</Button>
              <Button size="sm" variant="ghost" onClick={conflictWatch.dismiss}>Review</Button>
            </div>
          </Card>
        )}
      {settingsOpen ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-9 -ml-2" onClick={() => setSettingsOpen(false)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to the program
            </Button>
          </div>
          <Card className="p-4 space-y-3 max-w-2xl">
              <div><Label>Name</Label><Input value={meta.name} onChange={(e) => setM({ name: e.target.value })} /></div>
              <div>
                <Label>Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea
                  value={meta.description ?? ""}
                  onChange={(e) => setM({ description: e.target.value })}
                  rows={3}
                  placeholder="Briefly explain what this program is designed for and who it is best suited to."
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Shown to coaches in the library and assignment preview. Separate from internal Notes. Clear the field to remove it.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Style</Label>
                  <Select value={meta.training_style} onValueChange={(v) => setM({ training_style: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Focus</Label>
                  <Select
                    value={meta.training_focus || "__none"}
                    onValueChange={(v) => setM({ training_focus: v === "__none" ? "" : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Optional focus" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— None —</SelectItem>
                      {BLOCK_PHASE_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Weeks</Label><Input type="number" inputMode="numeric" value={meta.weeks} onChange={(e) => setM({ weeks: parseInt(e.target.value) || 0 })} /></div>
                <div><Label>Days/week</Label><Input type="number" inputMode="numeric" value={meta.days_per_week} onChange={(e) => setM({ days_per_week: parseInt(e.target.value) || 0 })} /></div>
                <div><Label>Est min</Label><Input type="number" inputMode="numeric" value={meta.est_duration_min} onChange={(e) => setM({ est_duration_min: parseInt(e.target.value) || 0 })} /></div>
              </div>
              <div><Label>Tags (comma-separated)</Label><Input value={meta.tags} onChange={(e) => setM({ tags: e.target.value })} /></div>
              <div><Label>Notes</Label><Textarea value={meta.notes} onChange={(e) => setM({ notes: e.target.value })} rows={3} /></div>
          </Card>
        </div>
      ) : (
        <StructureCanvas
            type={type}
            payload={payload}
            setP={setP}
            exercises={exercises as any[]}
            appendRowToFirstDay={appendRowToFirstDay}
            undo={undo}
            redo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            templateId={templateId}
            toolbarTarget={toolbarEl}
          />
      )}
      {isAdminViewer && (
        <MembershipListingSheet
          template={{
            id: templateId,
            name: meta.name || tpl.name,
            description: meta.description ?? (tpl as any).description ?? null,
            training_style: meta.training_style ?? tpl.training_style ?? null,
            training_focus: meta.training_focus || tpl.training_focus || null,
            goal: (tpl as any).goal ?? null,
            est_duration_min: meta.est_duration_min || tpl.est_duration_min || null,
            payload_revision: (tpl as any).payload_revision ?? null,
          }}
          open={membershipOpen}
          onOpenChange={setMembershipOpen}
        />
      )}
    </EditorChrome>
  );
}

function EditorChrome({ meta, summary, typeLabel, autosave, save, dirty, statusTemplate, aiTool, children, onRename, onToolbarEl, settingsOpen, onToggleSettings, onMembership }: {
  meta: any; summary: any; typeLabel: string;
  autosave: any; save: () => Promise<void>; dirty: boolean;
  statusTemplate?: any;
  /** admins: put this program in the membership app, or update / take it out */
  onMembership?: () => void;
  /** Edit with AI (block and program templates). */
  aiTool?: React.ReactNode;
  children: React.ReactNode;
  onRename: (name: string) => void;
  onToolbarEl?: (el: HTMLDivElement | null) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  const phone = useIsMobileNow();
  const kind = typeLabel ? typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1) : "Template";
  return (
    <div className="space-y-3 px-2 pb-8 md:px-3">
      <BuilderHeader
        onToolbarEl={onToolbarEl}
        back={
          <Link
            to="/admin/program-library"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Back to the library"
            title="Back to the library"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        }
        title={<BuilderTitleInput value={meta.name ?? ""} onChange={onRename} placeholder="Template name" label="Template name" />}
        meta={
          <span className="inline-flex items-center gap-1.5">
            <span className="truncate">{kind} template · {summary.weeks} week{summary.weeks === 1 ? "" : "s"} · {summary.days} day{summary.days === 1 ? "" : "s"}</span>
            {statusTemplate && <ProgramStatusBadge template={statusTemplate} quiet />}
          </span>
        }
        actions={
          <>
            {/* only news: saving, saved, failed, offline (an unsaved edit shows as Save) */}
            {autosave.state !== "idle" && (
              <SaveStatus state={autosave.state} savedAt={autosave.savedAt} compact={phone} className="max-md:px-1" />
            )}
            {dirty && (
              <ActionButton
                onAction={save}
                loadingLabel="Saving…"
                successLabel="Saved"
                successToast="Template saved"
                size="sm"
                variant="outline"
                className="h-9"
              >
                Save
              </ActionButton>
            )}
            {aiTool}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-10 w-10" aria-label="Template options">
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={onToggleSettings}>
                  {settingsOpen ? <Rows3 className="mr-2 h-4 w-4" /> : <Settings2 className="mr-2 h-4 w-4" />}
                  {settingsOpen ? "Back to the program" : "Template settings"}
                </DropdownMenuItem>
                {onMembership && (
                  <DropdownMenuItem onSelect={onMembership} data-builder-membership>
                    <Smartphone className="mr-2 h-4 w-4" /> Membership app
                  </DropdownMenuItem>
                )}
                {!dirty && (
                  <DropdownMenuItem onSelect={() => { void save().then(() => toast.success("Template saved")).catch((e: any) => toast.error(e?.message ?? "Couldn't save")); }}>
                    <Save className="mr-2 h-4 w-4" /> Save now
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {children}
    </div>
  );
}

// Where the week navigation goes: the canvas toolbar's middle, so the weeks
// share one row with undo / redo instead of stacking a bar of their own.
const WeekNavSlotContext = createContext<HTMLElement | null>(null);

export function StructureCanvas({ type, payload, setP, exercises, appendRowToFirstDay, undo, redo, canUndo, canRedo, clientId, blockId, toolbarExtras, templateId, dayScheduleStatus, onFixCalendarIssue, toolbarTarget, singleBlock }: {
  type: string; payload: any; setP: (p: any, opts?: { skipHistory?: boolean }) => void; exercises: any[];
  appendRowToFirstDay: (payload: any, type: string, row: any) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  /** Optional — when present, RowEditor will display computed loads & "no max" warnings. */
  clientId?: string | null;
  /** Optional — when set, maxes are loaded with block-scoped overrides applied. */
  blockId?: string | null;
  /** Optional — rendered in the canvas toolbar (e.g. "Block Maxes" button). */
  toolbarExtras?: React.ReactNode;
  /** Optional — template id, used to give legacy blocks deterministic
   * temporary IDs (legacy:<templateId>:...). Stable across refreshes. */
  templateId?: string;
  /** Optional — canonical per-day schedule status (live client block editor).
   * When present, day cards show On Calendar / Missing Date / Calendar Issue /
   * Completed / In Progress badges sourced from pl_scheduled_workouts. */
  dayScheduleStatus?: Map<string, ProgramDayScheduleStatus>;
  /** Optional — one-click repair for "Calendar Issue" day badges. */
  onFixCalendarIssue?: (dayId: string) => void;
  /** The page header's toolbar row: the canvas puts its controls there, so the
   * editor has one sticky bar. Without it (or in full screen) they sit on top
   * of the canvas. */
  toolbarTarget?: HTMLElement | null;
  /** A client's block: one block, so no program / block strip (adding a block
   * inside it never saved anywhere, and archiving it would empty the block). */
  singleBlock?: boolean;
}) {
  const [prefs, setPrefsState] = useState<EditorPrefs>(() => readPrefs());
  const setPrefs = (patch: Partial<EditorPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefsState(next);
    writePrefs(next);
  };
  const { compact: compactPref, zoom: zoomPref, sidebarCollapsed } = prefs;
  // A phone gets the builder at full width and natural scroll: no library
  // sidebar (exercises go in with each day's + buttons), no zoom, no full
  // screen, and every card opens (compact rows only help on a wide screen).
  const phone = useIsMobileNow();
  const zoom = phone ? 1 : zoomPref;
  const compact = phone ? false : compactPref;
  const [fullscreen, setFullscreen] = useState(false);
  const [weekSlot, setWeekSlot] = useState<HTMLDivElement | null>(null);
  const [maxesOpen, setMaxesOpen] = useState(false);
  const setZoom = (z: number) => setPrefs({ zoom: Math.max(0.5, Math.min(1.3, +z.toFixed(2))) });
  const fitToScreen = () => {
    // Rough fit heuristic based on viewport width
    if (typeof window === "undefined") return;
    const w = window.innerWidth;
    setZoom(w < 900 ? 0.7 : w < 1280 ? 0.8 : w < 1600 ? 0.9 : 1.0);
  };
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Keyboard: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Ctrl+Y = redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) {
        if (e.key === "Escape" && fullscreen) {
          e.preventDefault();
          setFullscreen(false);
        }
        return;
      }
      const k = e.key.toLowerCase();
      // Never hijack Cmd/Ctrl+Z while the coach is typing in a field — the
      // browser's native text undo must win, otherwise a single keypress
      // silently rewinds the ENTIRE payload (an old snapshot can then be
      // autosaved, wiping newer field values like RPE/RIR).
      const t = e.target as HTMLElement | null;
      const inEditable =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (inEditable) return;
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "." && e.shiftKey) { e.preventDefault(); setFullscreen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, fullscreen]);

  // Lock body scroll while fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  const maxesQuery = useQuery({
    queryKey: ["pl-client-maxes", clientId, blockId ?? null],
    queryFn: () => listClientMaxes(clientId as string, blockId ?? null),
    enabled: !!clientId,
  });
  const maxesCtx: MaxesCtx = useMemo(() => ({
    clientId: clientId ?? null,
    blockId: blockId ?? null,
    maxes: maxesQuery.data ?? [],
    index: buildMaxIndex(maxesQuery.data ?? []),
    refresh: () => maxesQuery.refetch(),
  }), [clientId, blockId, maxesQuery.data]);

  const canSetMaxes = !!clientId && !!blockId;
  const tap = phone ? "h-10 w-10" : "h-8 w-8";
  // One row of controls: undo / redo, the weeks (BlockPayloadEditor fills the
  // slot), and one ⋯ for everything a coach reaches for now and then.
  const toolbar = (
    <div className="flex items-center gap-0.5 px-1.5 py-1 md:px-2" data-builder-toolbar>
      <Button size="icon" variant="ghost" className={cn(tap, "shrink-0")} disabled={!canUndo} aria-label="Undo" title="Undo (Cmd/Ctrl+Z)" onClick={undo}>
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" className={cn(tap, "shrink-0")} disabled={!canRedo} aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z)" onClick={redo}>
        <Redo2 className="h-4 w-4" />
      </Button>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
      <div ref={setWeekSlot} className="flex min-w-0 flex-1 items-center" />
      {toolbarExtras}
      {!phone && <ProgramBuilderShortcutsButton />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className={cn(tap, "shrink-0")} aria-label="Editor options">
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {canSetMaxes && (
            <DropdownMenuItem onSelect={() => setMaxesOpen(true)}>
              <Dumbbell className="mr-2 h-4 w-4" /> 1RM and training maxes
            </DropdownMenuItem>
          )}
          {!phone && (
            <>
              {canSetMaxes && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setPrefs({ sidebarCollapsed: !sidebarCollapsed })}>
                {sidebarCollapsed ? <PanelLeftOpen className="mr-2 h-4 w-4" /> : <PanelLeftClose className="mr-2 h-4 w-4" />}
                {sidebarCollapsed ? "Show exercise library" : "Hide exercise library"}
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={compact} onCheckedChange={(v) => setPrefs({ compact: !!v })}>
                Compact cards
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onSelect={() => setFullscreen((v) => !v)}>
                {fullscreen ? <Minimize2 className="mr-2 h-4 w-4" /> : <Expand className="mr-2 h-4 w-4" />}
                {fullscreen ? "Exit full screen" : "Full screen"}
                <DropdownMenuShortcut>⇧.</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="flex items-center gap-1 px-2 py-1.5 text-sm">
                <span className="flex-1 text-muted-foreground">Zoom</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Zoom out" onClick={() => setZoom(zoom - 0.05)}>
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <button type="button" className="min-w-[44px] rounded px-1 text-center text-xs tabular-nums hover:bg-muted" title="Reset to 100%" onClick={() => setZoom(1)}>
                  {Math.round(zoom * 100)}%
                </button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Zoom in" onClick={() => setZoom(zoom + 0.05)}>
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
              </div>
              <DropdownMenuItem onSelect={fitToScreen}>
                <Maximize2 className="mr-2 h-4 w-4" /> Fit to screen
              </DropdownMenuItem>
            </>
          )}
          {phone && !canSetMaxes && (
            <DropdownMenuItem disabled>Library, drag and drop and zoom are on a computer</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  const portalToolbar = !!toolbarTarget && !fullscreen;

  return (
    <MaxesContext.Provider value={maxesCtx}>
    <BuilderPhoneContext.Provider value={phone}>
    <WeekNavSlotContext.Provider value={weekSlot}>
    {portalToolbar && createPortal(toolbar, toolbarTarget!)}
    {maxesOpen && clientId && blockId && (
      <BlockMaxesDialog clientId={clientId} blockId={blockId} onClose={() => setMaxesOpen(false)} />
    )}
    <div
      className={cn(
        !phone && "workout-card-surface overflow-hidden",
        fullscreen && "fixed inset-0 z-[60] rounded-none border-0 bg-background shadow-none",
      )}
    >
      {!portalToolbar && (
        <div className={cn("z-20 border-b border-border bg-background", fullscreen ? "sticky top-0" : "sticky top-0")}>
          {toolbar}
        </div>
      )}
      {phone && (
        <div className="pb-1 pt-2" data-builder-phone>
          <BestOnComputerTip storageKey="jf.coach-builder.desktop-tip">
            The exercise library, drag and drop and side by side weeks are on a computer. Days,
            exercises, sets and reps all edit here.
          </BestOnComputerTip>
        </div>
      )}

      <div
        className={cn(
          !phone && "flex gap-0 overflow-hidden",
          !phone && (fullscreen ? "h-[calc(100vh-46px)]" : "h-[calc(100vh-150px)]"),
        )}
      >
        {!phone && (
        <ExerciseLibraryPanel
          exercises={exercises as ExerciseRef[]}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setPrefs({ sidebarCollapsed: !sidebarCollapsed })}
          onQuickAdd={(exId) => {
            const ex = (exercises as any[]).find((e) => e.id === exId);
            appendRowToFirstDay(payload, type, { exercise_id: exId, exercise_name_override: ex?.name });
            setP({ ...payload });
            toast.success("Added to first day");
          }}
          onPick={(exId) => {
            const ex = (exercises as any[]).find((e) => e.id === exId);
            appendRowToFirstDay(payload, type, { exercise_id: exId, exercise_name_override: ex?.name });
            setP({ ...payload });
            toast.success("Added — drag onto a day for placement");
          }}
        />
        )}
        <div className={cn(!phone && "@container flex-1 overflow-auto")} ref={canvasRef}>
          <div
            style={
              phone
                ? undefined
                : {
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                    width: `${100 / zoom}%`,
                    minHeight: `${100 / zoom}%`,
                  }
            }
            className={phone ? "py-2" : "px-3 py-3"}
          >
            <StructureEditor type={type} payload={payload} setPayload={setP} exercises={exercises as any[]} compact={compact} templateId={templateId} dayScheduleStatus={dayScheduleStatus} onFixCalendarIssue={onFixCalendarIssue} singleBlock={singleBlock} />
          </div>
        </div>
      </div>
    </div>
    </WeekNavSlotContext.Provider>
    </BuilderPhoneContext.Provider>
    </MaxesContext.Provider>
  );
}

// ---------- Structure editing for the JSON payload ----------

function StructureEditor({ type, payload, setPayload, exercises, compact, templateId, dayScheduleStatus, onFixCalendarIssue, singleBlock }: { type: string; payload: any; setPayload: (p: any) => void; exercises: any[]; compact?: boolean; templateId?: string; dayScheduleStatus?: Map<string, ProgramDayScheduleStatus>; onFixCalendarIssue?: (dayId: string) => void; singleBlock?: boolean }) {
  if (type === "full_prep" || type === "block") {
    return <MultiBlockStructureEditor type={type} payload={payload} setPayload={setPayload} exercises={exercises} compact={compact} templateId={templateId} dayScheduleStatus={dayScheduleStatus} onFixCalendarIssue={onFixCalendarIssue} singleBlock={singleBlock} />;
  }
  if (type === "week") return <WeekEditor week={payload} setWeek={setPayload} exercises={exercises} compact={compact} />;
  if (type === "day") {
    return (
      <section className="rounded-2xl border border-border bg-card">
        <DayEditor day={payload} setDay={setPayload} exercises={exercises} compact={compact} dayKey="single" standalone />
      </section>
    );
  }
  return (
    <Card className="p-4 max-w-3xl">
      <RowEditor row={payload} setRow={setPayload} exercises={exercises} compact={compact} />
    </Card>
  );
}

// ---------- Multi-block (v2 payload) structure editor -----------------------
function MultiBlockStructureEditor({ type, payload, setPayload, exercises, compact, templateId, dayScheduleStatus, onFixCalendarIssue, singleBlock }: {
  type: "block" | "full_prep" | string;
  singleBlock?: boolean;
  payload: any;
  setPayload: (p: any) => void;
  exercises: any[];
  compact?: boolean;
  templateId?: string;
  dayScheduleStatus?: Map<string, ProgramDayScheduleStatus>;
  onFixCalendarIssue?: (dayId: string) => void;
}) {
  const navigate = useNavigate();
  // This component is also reused from `/admin/blocks/$blockId`, where the
  // program-library route isn't in the match chain. Use a non-strict search
  // hook so it works under either route without triggering an invariant.
  const search = useSearch({ strict: false }) as { block?: string };
  const v2 = useMemo<TemplatePayloadV2>(
    () => normalizeTemplatePayload(payload, { templateType: type, templateId }),
    [payload, type, templateId],
  );
  const inRecovery = isPayloadInRecovery(v2);
  const active = getActiveTemplateBlocks(v2);
  const archived = getArchivedTemplateBlocks(v2);
  const trashed = getTrashedTemplateBlocks(v2);

  // Pick active block from URL or fall back to first active.
  const activeBlockId = useMemo(() => {
    if (search.block && active.some((b) => b.id === search.block)) return search.block;
    return active[0]?.id ?? null;
  }, [search.block, active]);
  const activeBlock = active.find((b) => b.id === activeBlockId) ?? null;

  const setActive = (id: string) => {
    navigate({ search: (prev: any) => ({ ...prev, block: id }), replace: true } as any);
  };
  const commit = (nextV2: TemplatePayloadV2) => {
    if (inRecovery) {
      // eslint-disable-next-line no-console
      console.warn("[template-builder] mutation blocked: payload in recovery mode");
      return;
    }
    try {
      setPayload(serializeTemplatePayload(nextV2));
    } catch (e: any) {
      // Recovery-mode payload — refuse autosave; surface to user instead of
      // silently overwriting raw data with an empty v2 shell.
      // eslint-disable-next-line no-console
      console.warn("[template-builder] save refused:", e?.message);
    }
  };

  const handleAddBlock = () => {
    const next = addBlankBlock(v2);
    const created = getActiveTemplateBlocks(next).slice(-1)[0];
    commit(next);
    if (created) setActive(created.id);
  };
  const handleRename = (id: string) => {
    const b = v2.blocks.find((x) => x.id === id);
    if (!b) return;
    const name = window.prompt("Rename block", b.name);
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === b.name) return;
    commit(replaceBlock(v2, id, { name: trimmed }));
  };
  const handleDuplicate = (id: string) => {
    const b = v2.blocks.find((x) => x.id === id);
    if (!b) return;
    const cloned = cloneTemplateBlock(b);
    const next: TemplatePayloadV2 = {
      ...v2,
      blocks: [...v2.blocks, { ...cloned, order_index: v2.blocks.length }],
    };
    commit(next);
    setActive(cloned.id);
  };
  const handleArchive = (id: string) => {
    commit(setBlockArchived(v2, id, true));
    if (id === activeBlockId) {
      const remaining = active.filter((b) => b.id !== id);
      if (remaining[0]) setActive(remaining[0].id);
    }
  };
  const handleRestore = (id: string) => commit(setBlockArchived(v2, id, false));
  const handleTrash = (id: string) => {
    if (!confirm("Move this block to trash? You can restore it from the menu below.")) return;
    commit(setBlockTrashed(v2, id, true));
    if (id === activeBlockId) {
      const remaining = active.filter((b) => b.id !== id);
      if (remaining[0]) setActive(remaining[0].id);
    }
  };
  const handleRestoreTrash = (id: string) => commit(setBlockTrashed(v2, id, false));
  const handlePurge = (id: string) => {
    if (!confirm("Permanently delete this block? This cannot be undone.")) return;
    commit(purgeTrashedBlock(v2, id));
  };
  const handleMove = (id: string, dir: -1 | 1) => {
    const ids = active.map((b) => b.id);
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= ids.length) return;
    const next = [...ids];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    commit(reorderActiveBlocks(v2, next));
  };
  const handleUpdatePhase = (id: string, phase: string | null) => {
    commit(replaceBlock(v2, id, { phase }));
  };
  const handleUpdateNotes = (id: string, notes: string) => {
    commit(replaceBlock(v2, id, { notes }));
  };
  const handleUpdateEst = (id: string, mins: number | null) => {
    commit(replaceBlock(v2, id, { estimated_minutes: mins }));
  };
  const setActiveBlockWeeks = (wd: any[]) => {
    if (!activeBlock) return;
    commit(replaceBlock(v2, activeBlock.id, { weeks: wd }));
  };

  // Prep card for full_prep templates (lives in __legacy.prep so other readers keep working).
  const prep = (v2.__legacy && v2.__legacy.prep) || {};
  const setPrep = (patch: any) => {
    const nextLegacy = { ...(v2.__legacy ?? {}), prep: { ...prep, ...patch } };
    commit({ ...v2, __legacy: nextLegacy });
  };

  return (
    <div className="space-y-3">
      {type === "full_prep" && (
        <Card className="p-3 max-w-2xl">
          <div className="mb-2 text-sm font-semibold">Prep details</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Event name</Label><Input value={prep.event_name ?? ""} onChange={(e) => setPrep({ event_name: e.target.value || null })} /></div>
            <div><Label className="text-xs">Event date</Label><Input type="date" value={prep.event_date ?? ""} onChange={(e) => setPrep({ event_date: e.target.value || null })} /></div>
            <div><Label className="text-xs">Goal type</Label><Input value={prep.goal_type ?? ""} onChange={(e) => setPrep({ goal_type: e.target.value })} /></div>
            <div><Label className="text-xs">Total weeks</Label><Input type="number" inputMode="numeric" value={prep.total_weeks ?? ""} onChange={(e) => setPrep({ total_weeks: parseInt(e.target.value) || null })} /></div>
          </div>
        </Card>
      )}

      {/* Program overview */}
      {inRecovery && (
        <Card className="border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <div className="font-semibold">This template payload is malformed.</div>
              <div>
                The raw payload has been preserved untouched. Autosave and all
                destructive block operations (add, archive, trash, reorder,
                purge, assignment) are disabled until an admin reviews and
                explicitly confirms a recovery action.
              </div>
              <div className="opacity-80">
                Reason: {String((v2 as any).__recovery?.reason || "Unknown")}
              </div>
            </div>
          </div>
        </Card>
      )}
      {/* The program's blocks (templates only): one row of tabs, the block
          you're on carrying its settings, + to add one. A client's block
          editor is one block, so it has none of this. */}
      {!singleBlock && (
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Blocks">
          {active.map((b) => {
            const isActive = b.id === activeBlockId;
            return (
              <div
                key={b.id}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1 rounded-lg pl-3 pr-1 text-sm transition-colors max-md:h-10",
                  isActive ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <button type="button" role="tab" aria-selected={isActive} className="max-w-[200px] truncate pr-1" onClick={() => setActive(b.id)} title={`${b.weeks.length} weeks`}>
                  {b.name}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{b.phase || b.training_focus ? `${b.phase || b.training_focus} · ` : ""}{b.weeks.length}w</span>
                </button>
                {isActive && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`${b.name} settings`}><Settings2 className="h-3.5 w-3.5" /></button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2 text-xs" align="start">
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-1">
                          <Button size="sm" variant="ghost" className="h-8 justify-start text-xs" onClick={() => handleRename(b.id)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Rename</Button>
                          <Button size="sm" variant="ghost" className="h-8 justify-start text-xs" onClick={() => handleDuplicate(b.id)}><Copy className="mr-1.5 h-3.5 w-3.5" />Duplicate</Button>
                          <Button size="sm" variant="ghost" className="h-8 justify-start text-xs" onClick={() => handleMove(b.id, -1)}>← Move left</Button>
                          <Button size="sm" variant="ghost" className="h-8 justify-start text-xs" onClick={() => handleMove(b.id, 1)}>Move right →</Button>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Phase</Label>
                          <Select value={b.phase ?? "__none"} onValueChange={(v) => handleUpdatePhase(b.id, v === "__none" ? null : v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Optional phase" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">None</SelectItem>
                              {BLOCK_PHASE_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Minutes per workout</Label>
                          <Input
                            inputMode="numeric"
                            className="h-8 text-xs"
                            value={b.estimated_minutes ?? ""}
                            onChange={(e) => handleUpdateEst(b.id, parseInt(e.target.value) || null)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Notes</Label>
                          <Textarea rows={2} className="text-xs" value={b.notes} onChange={(e) => handleUpdateNotes(b.id, e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-1 border-t border-border pt-2">
                          <Button size="sm" variant="ghost" className="h-8 justify-start text-xs" onClick={() => handleArchive(b.id)}><ArchiveIcon className="mr-1.5 h-3.5 w-3.5" />Archive</Button>
                          <Button size="sm" variant="ghost" className="h-8 justify-start text-xs text-destructive" onClick={() => handleTrash(b.id)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Trash</Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            );
          })}
          <Button size="sm" variant="ghost" className="h-9 shrink-0 text-muted-foreground max-md:h-10" onClick={handleAddBlock} disabled={inRecovery}>
            <Plus className="mr-1 h-4 w-4" /> Block
          </Button>
          {active.length === 0 && (
            <span className="text-xs text-muted-foreground">No active blocks. Add one to start.</span>
          )}
        </div>
      )}

      {!singleBlock && (archived.length > 0 || trashed.length > 0) && (
        <details className="rounded-lg px-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer py-1">Archived and trash ({archived.length + trashed.length})</summary>
          <div className="mt-1 space-y-1">
            {archived.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <ArchiveIcon className="h-3 w-3" />
                <span className="flex-1 truncate">{b.name}</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleRestore(b.id)}><ArchiveRestore className="mr-1 h-3 w-3" />Restore</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" aria-label={`Trash ${b.name}`} onClick={() => handleTrash(b.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
            {trashed.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <Trash2 className="h-3 w-3" />
                <span className="flex-1 truncate line-through">{b.name}</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleRestoreTrash(b.id)}><ArchiveRestore className="mr-1 h-3 w-3" />Restore</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handlePurge(b.id)}>Delete forever</Button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Active block weeks editor */}
      {activeBlock ? (
        <BlockPayloadEditor
          key={activeBlock.id}
          weeksData={activeBlock.weeks}
          setWeeksData={setActiveBlockWeeks}
          exercises={exercises}
          compact={compact}
          dayScheduleStatus={dayScheduleStatus}
          onFixCalendarIssue={onFixCalendarIssue}
        />
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Add a block to start building this program.
        </Card>
      )}
    </div>
  );
}

export function BlockPayloadEditor({ weeksData, setWeeksData, exercises, compact, dayScheduleStatus, onFixCalendarIssue }: { weeksData: any[]; setWeeksData: (wd: any[]) => void; exercises: any[]; compact?: boolean; dayScheduleStatus?: Map<string, ProgramDayScheduleStatus>; onFixCalendarIssue?: (dayId: string) => void }) {
  // Persist the coach's editing position (active week + view mode) across
  // refreshes via localStorage so they return to exactly where they left off.
  const POS_KEY = "pb.block-editor.pos:v1";
  const readPos = (): { view: "block" | "week"; activeIdx: number } => {
    if (typeof window === "undefined") return { view: "block", activeIdx: 0 };
    try {
      const raw = window.localStorage.getItem(POS_KEY);
      if (!raw) return { view: "block", activeIdx: 0 };
      const p = JSON.parse(raw);
      return {
        view: p.view === "week" ? "week" : "block",
        activeIdx: Number.isFinite(p.activeIdx) ? p.activeIdx : 0,
      };
    } catch { return { view: "block", activeIdx: 0 }; }
  };
  const initialPos = readPos();
  const [activeIdx, _setActiveIdx] = useState(initialPos.activeIdx);
  const [viewPref, _setView] = useState<"block" | "week">(initialPos.view);
  // A phone shows one week at a time (side by side weeks don't fit); the
  // desktop choice is kept as it was.
  const phone = useBuilderPhone();
  const view: "block" | "week" = phone ? "week" : viewPref;
  const writePos = (next: { view: "block" | "week"; activeIdx: number }) => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(POS_KEY, JSON.stringify(next)); } catch {}
  };
  const setActiveIdx = (idx: number) => { _setActiveIdx(idx); writePos({ view: viewPref, activeIdx: idx }); };
  const setView = (v: "block" | "week") => { _setView(v); writePos({ view: v, activeIdx }); };
  // Clamp activeIdx if weeks were removed since last visit.
  useEffect(() => {
    if (weeksData.length === 0) return;
    if (activeIdx >= weeksData.length) _setActiveIdx(weeksData.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeksData.length]);
  const { clientId: ctxClientId, blockId: ctxBlockId } = useClientMaxesCtx();
  const weekStats = useMemo(() => weeksData.map((w: any) => {
    const days = w.days || [];
    let rowCount = 0;
    let minutes = 0;
    for (const d of days) {
      const dr = d.rows || [];
      rowCount += dr.length;
      minutes += estimateDayMinutes(dr) || 0;
    }
    return { days: days.length, rows: rowCount, minutes };
  }), [weeksData]);
  const fmtDur = (m: number) => { if (!m || m <= 0) return "—"; const h = Math.floor(m/60); const mm = Math.round(m%60); return h > 0 ? `${h}h ${mm}m` : `${mm}m`; };
  const weekColumnWidthClass = compact
    ? "w-[88vw] max-w-[520px] sm:w-[440px] lg:w-[480px] xl:w-[520px]"
    : "w-[94vw] max-w-[720px] sm:w-[600px] lg:w-[640px] xl:w-[700px]";
  const addWeek = () => {
    const nextIdx = (weeksData[weeksData.length - 1]?.week_index ?? 0) + 1;
    setWeeksData([...weeksData, { week_index: nextIdx, days: [{ day_index: 1, title: "", subtitle: "", rows: [] }] }]);
    setActiveIdx(weeksData.length);
  };
  // Per-week "Advanced" toggles (full-block view): week label, week notes and
  // copy-to-future-weeks live behind these so the basic week header stays
  // clean (number · stats · duplicate · delete).
  const [advWeeks, setAdvWeeks] = useState<Record<number, boolean>>({});
  const dupWeek = (i: number) => {
    const w = weeksData[i];
    const next = JSON.parse(JSON.stringify(w));
    next.week_index = (weeksData[weeksData.length - 1]?.week_index ?? 0) + 1;
    setWeeksData([...weeksData, next]);
  };
  const delWeek = (i: number) => {
    if (!confirm("Remove this week?")) return;
    setWeeksData(weeksData.filter((_, j) => j !== i));
    if (activeIdx >= weeksData.length - 1) setActiveIdx(Math.max(0, activeIdx - 1));
  };
  const copyWeekToFuture = (i: number) => {
    const src = weeksData[i];
    if (!src) return;
    const next = weeksData.map((w, j) => {
      if (j <= i) return w;
      const c = JSON.parse(JSON.stringify(src));
      c.week_index = w.week_index;
      return c;
    });
    setWeeksData(next);
    toast.success(`Copied Week ${src.week_index} → future weeks`);
  };
  const copyDayToFuture = (weekIdx: number, dayIdx: number) => {
    const srcDay = weeksData[weekIdx]?.days?.[dayIdx];
    if (!srcDay) return;
    const next = weeksData.map((w, j) => {
      if (j <= weekIdx) return w;
      const days = [...(w.days || [])];
      const clone = JSON.parse(JSON.stringify(srcDay));
      const existing = days.findIndex((d: any) => d.day_index === srcDay.day_index);
      if (existing >= 0) days[existing] = clone;
      else days.push(clone);
      return { ...w, days };
    });
    setWeeksData(next);
    toast.success(`Copied Day ${srcDay.day_index} → future weeks`);
  };
  // Week notes / phase: opened from the week's ⋯, edited in place.
  const [weekDetailsOpen, setWeekDetailsOpen] = useState(false);
  const weekNavSlot = useContext(WeekNavSlotContext);
  const goWeek = (i: number) => {
    setActiveIdx(i);
    if (view === "block") {
      document.getElementById(`tpl-week-${i}`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    }
  };
  const setWeekAt = (i: number, patch: any) => {
    const c = [...weeksData];
    c[i] = { ...c[i], ...patch };
    setWeeksData(c);
  };
  const weekMenu = (i: number, opts?: { onDetails?: () => void }) => {
    const w = weeksData[i];
    if (!w) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className={cn("shrink-0", phone ? "h-10 w-10" : "h-8 w-8")} aria-label={`Week ${w.week_index} options`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Week {w.week_index}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => opts?.onDetails?.()}>
            <Pencil className="mr-2 h-4 w-4" /> Notes and phase
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dupWeek(i)}>
            <Copy className="mr-2 h-4 w-4" /> Duplicate week
          </DropdownMenuItem>
          <DropdownMenuItem disabled={i >= weeksData.length - 1} onSelect={() => copyWeekToFuture(i)}>
            <ArrowRight className="mr-2 h-4 w-4" /> Copy to later weeks
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={() => delWeek(i)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete week
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const weekNotesEditor = (i: number, onDone: () => void) => {
    const w = weeksData[i];
    if (!w) return null;
    return (
      <div className="mt-2 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
        <Select value={w.phase || "__none"} onValueChange={(v) => setWeekAt(i, { phase: v === "__none" ? null : v })}>
          <SelectTrigger className="h-10 text-sm md:h-9" aria-label="Week phase"><SelectValue placeholder="Phase" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">No phase</SelectItem>
            {BLOCK_PHASE_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          className="h-10 text-base md:h-9 md:text-sm"
          placeholder="Week notes, for you only"
          aria-label="Week notes"
          value={w.notes ?? ""}
          onChange={(e) => setWeekAt(i, { notes: e.target.value })}
        />
        <Button variant="secondary" className="h-10 md:h-9" onClick={onDone}>Done</Button>
      </div>
    );
  };
  // The weeks: one row in the editor's toolbar (the canvas's slot), the
  // week you're on in neutral, + adds one, ⋯ holds the rest.
  const weekNav = (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {!phone && (
        <div role="tablist" aria-label="Layout" className="mr-1 inline-flex shrink-0 rounded-lg bg-muted p-0.5">
          {([["week", "Week"], ["block", "Whole block"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
                view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "week" ? <CalendarRange className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />} {label}
            </button>
          ))}
        </div>
      )}
      <div
        role="tablist"
        aria-label="Weeks"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <span className="shrink-0 px-1 text-xs text-muted-foreground">Week</span>
        {weeksData.map((w: any, i: number) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={activeIdx === i}
            aria-label={`Week ${w.week_index}${w.phase ? `, ${w.phase}` : ""}`}
            title={w.phase ? `Week ${w.week_index} · ${w.phase}` : `Week ${w.week_index}`}
            data-week-chip
            onClick={() => goWeek(i)}
            className={cn(
              "shrink-0 rounded-lg px-2 text-sm font-semibold tabular-nums transition-colors",
              phone ? "h-10 min-w-10" : "h-8 min-w-8",
              activeIdx === i ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {w.week_index}
          </button>
        ))}
        <button
          type="button"
          onClick={addWeek}
          aria-label="Add week"
          title="Add week"
          className={cn("inline-flex shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", phone ? "h-10 w-10" : "h-8 w-8")}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
  const fmtWeekLine = (i: number) => {
    const s = weekStats[i] ?? { days: 0, rows: 0, minutes: 0 };
    return `${s.days} day${s.days === 1 ? "" : "s"}${s.minutes > 0 ? ` · about ${fmtDur(s.minutes)}` : ""}`;
  };
  return (
    <div className="space-y-2">
      {weekNavSlot ? createPortal(weekNav, weekNavSlot) : (
        <div className="sticky top-0 z-20 -mx-2 mb-2 flex items-center border-b border-border bg-background px-2 py-1 max-md:mx-0">{weekNav}</div>
      )}

      {weeksData.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">No weeks yet.</p>
          <Button variant="outline" className="mt-3 h-10" onClick={addWeek}><Plus className="mr-1.5 h-4 w-4" /> Add week</Button>
        </div>
      )}

      {view === "week" ? (
        weeksData[activeIdx] && (() => {
          const aw = weeksData[activeIdx];
          return (
            <>
              <div className="pl-1" data-week-summary>
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h2 className="text-base font-semibold">Week {aw.week_index}</h2>
                    {aw.phase && <span className="text-sm text-muted-foreground">{aw.phase}</span>}
                    <span className="text-xs text-muted-foreground">{fmtWeekLine(activeIdx)}</span>
                  </div>
                  {weekMenu(activeIdx, { onDetails: () => setWeekDetailsOpen(true) })}
                </div>
                {aw.notes && !weekDetailsOpen && (
                  <button type="button" className="mt-0.5 block max-w-full truncate text-left text-[13px] italic text-muted-foreground hover:text-foreground" onClick={() => setWeekDetailsOpen(true)}>
                    {aw.notes}
                  </button>
                )}
                {weekDetailsOpen && weekNotesEditor(activeIdx, () => setWeekDetailsOpen(false))}
              </div>
              <WeekEditor
                week={aw}
                setWeek={(w) => { const copy = [...weeksData]; copy[activeIdx] = w; setWeeksData(copy); }}
                exercises={exercises}
                onCopyDayToFuture={(di) => copyDayToFuture(activeIdx, di)}
                compact={compact}
                layout="grid"
                dayKeyPrefix={`wk${aw.week_index ?? activeIdx}`}
                blockId={ctxBlockId}
                blockStartDate={null}
                blockEndDate={null}
                onExtraDayAdded={() => { /* block-tree query invalidated inside AddExtraDayDialog */ }}
                dayScheduleStatus={dayScheduleStatus}
                onFixCalendarIssue={onFixCalendarIssue}
              />
            </>
          );
        })()
      ) : (
        <div
          className={cn(
            "snap-x snap-proximity overflow-x-auto overflow-y-visible overscroll-x-contain pb-3",
            compact ? "scroll-pl-2" : "scroll-pl-3",
          )}
        >
          <div className={cn("flex w-max items-start", compact ? "gap-2" : "gap-3")}>
            {weeksData.map((w: any, wi: number) => (
              <section
                key={wi}
                id={`tpl-week-${wi}`}
                className={cn("shrink-0 snap-start rounded-2xl border border-border bg-muted/30", weekColumnWidthClass)}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-base font-semibold">Week {w.week_index}</h2>
                      {w.phase && <span className="truncate text-sm text-muted-foreground">{w.phase}</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {fmtWeekLine(wi)}
                      {w.notes && !advWeeks[wi] ? <span className="italic"> · {w.notes}</span> : null}
                    </div>
                  </div>
                  {weekMenu(wi, { onDetails: () => setAdvWeeks((prev) => ({ ...prev, [wi]: true })) })}
                </div>
                {advWeeks[wi] && (
                  <div className="px-3 pb-2">
                    {weekNotesEditor(wi, () => setAdvWeeks((prev) => ({ ...prev, [wi]: false })))}
                  </div>
                )}
                <div className={compact ? "px-2 pb-2" : "px-2.5 pb-3"}>
                  <WeekEditor
                    week={w}
                    setWeek={(nw) => { const c = [...weeksData]; c[wi] = nw; setWeeksData(c); }}
                    exercises={exercises}
                    onCopyDayToFuture={(di) => copyDayToFuture(wi, di)}
                    compact={compact}
                    hideVolumeSummary={!advWeeks[wi]}
                    dayKeyPrefix={`wk${w.week_index ?? wi}`}
                    blockId={ctxBlockId}
                    blockStartDate={null}
                    blockEndDate={null}
                    onExtraDayAdded={() => {}}
                    dayScheduleStatus={dayScheduleStatus}
                    onFixCalendarIssue={onFixCalendarIssue}
                  />
                </div>
              </section>
            ))}
            {/* Trailing add-week tile */}
            <button
              type="button"
              onClick={addWeek}
              className={cn(
                "flex shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                compact ? "h-[140px] w-[200px]" : "h-[200px] w-[260px]",
              )}
            >
              <Plus className="h-6 w-6" />
              <span className="text-sm font-medium">Add week</span>
            </button>
            {/* Trailing spacer so the last week / Add Week tile can snap to the left edge */}
            <div aria-hidden className="w-[80vw] shrink-0" />
          </div>
        </div>
      )}
    </div>
  );
}

function WeekEditor({ week, setWeek, exercises, onCopyDayToFuture, hideVolumeSummary, compact, dayKeyPrefix, blockId, blockStartDate, blockEndDate, onExtraDayAdded, dayScheduleStatus, onFixCalendarIssue, layout = "stack" }: { week: any; setWeek: (w: any) => void; exercises: any[]; onCopyDayToFuture?: (dayIdx: number) => void; hideHeader?: boolean; hideVolumeSummary?: boolean; compact?: boolean; dayKeyPrefix?: string; blockId?: string | null; blockStartDate?: string | null; blockEndDate?: string | null; onExtraDayAdded?: () => void; dayScheduleStatus?: Map<string, ProgramDayScheduleStatus>; onFixCalendarIssue?: (dayId: string) => void; layout?: "stack" | "grid" }) {
  const days = week.days || [];
  const purposeLabelsByDay = useMemo(() => weekPurposeLabelsByDay(days, exercises), [days, exercises]);
  const phone = useBuilderPhone();
  const clip = useClip();
  // Days that show their Focus line even before one is typed.
  const [dayOpts, setDayOpts] = useState<Record<number, boolean>>({});
  const setDayAt = (i: number, next: any) => {
    const copy = [...days];
    copy[i] = next;
    setWeek({ ...week, days: copy });
  };
  const addDay = () => {
    const nextIdx = (days[days.length - 1]?.day_index ?? 0) + 1;
    // Do not seed `title` with a generated "Day N" string — the label is
    // derived from position at render time. Keep `title` NULL and let the
    // coach fill in an optional workout `subtitle` (e.g. "Final Heavy").
    setWeek({ ...week, days: [...days, { day_index: nextIdx, title: "", subtitle: "", rows: [] }] });
  };
  const dupDay = (i: number) => {
    const copy = JSON.parse(JSON.stringify(days[i]));
    copy.day_index = (days[days.length - 1]?.day_index ?? 0) + 1;
    // Do not stuff " (copy)" into the derived-only title. If the source
    // day had a coach subtitle, append " (copy)" there instead so the
    // duplicated day is easy to tell apart. Otherwise leave subtitle empty.
    copy.title = "";
    const srcSub = (formatDaySubtitle(copy) ?? "").trim();
    copy.subtitle = srcSub ? `${srcSub} (copy)` : "";
    // Never inherit the source's specific scheduled_date — it would otherwise
    // silently double-book a calendar slot.
    copy.scheduled_date = null;
    setWeek({ ...week, days: [...days, copy] });
  };
  const delDay = (i: number) => { if (!confirm("Remove day?")) return; setWeek({ ...week, days: days.filter((_: any, j: number) => j !== i) }); };
  const pasteInto = (i: number) => {
    if (!clip || clip.kind !== "rows") return;
    const d = days[i];
    const next = [...(d.rows || []), ...JSON.parse(JSON.stringify(clip.rows))];
    setDayAt(i, { ...d, rows: next.map((r: any, j: number) => ({ ...r, sort_order: j })) });
  };
  const addEmptyRow = (i: number) => {
    const d = days[i];
    const rows = d.rows || [];
    setDayAt(i, {
      ...d,
      rows: [...rows, {
        sort_order: rows.length,
        // Leave sets/reps/rpe/rir empty — placeholders only. Coach fills in.
        time_profile: "accessory_compound",
        percentage_basis: "none",
      }],
    });
  };
  return (
    <div className={cn("space-y-3", layout === "grid" && "@container")}>
      {!hideVolumeSummary && <WeeklyVolumeSummary week={week} exercises={exercises as any} weekIndex={week?.week_index} />}
      <WeekPriorityWarnings week={week} exercises={exercises as any} />
      {days.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No days in this week yet.
        </p>
      )}
      <div className={cn("grid gap-3", layout === "grid" && "@4xl:grid-cols-2 @[96rem]:grid-cols-3", compact && "gap-2")}>
      {days.map((d: any, i: number) => {
        const dayMinutes = estimateDayMinutes(d.rows || []);
        const dKey = `${dayKeyPrefix ?? `wk${week.week_index ?? 0}`}:d${d.day_index ?? i}`;
        const positional = i + 1;
        const dayLabel = formatDayLabel(d, positional);
        const dayName = formatDaySubtitle(d) ?? "";
        // Canonical schedule status for this day (live client block editor
        // only). Reflects what the calendar ACTUALLY shows — instance dates
        // win over the legacy pl_days.scheduled_date mirror.
        const dayStatus = d._dbId ? dayScheduleStatus?.get(d._dbId) : undefined;
        const showFocus = !!dayOpts[i] || !!d.focus?.trim();
        const rowCount = (d.rows || []).length;
        return (
        <section
          key={i}
          data-builder-day
          aria-label={`${dayLabel}${dayName ? `: ${dayName}` : ""}`}
          className={cn("min-w-0 self-start rounded-2xl border border-border bg-card", compact && "rounded-xl")}
        >
          <div className={cn("flex items-start gap-1 pb-1", compact ? "px-2.5 pt-2" : "px-3 pt-2.5")}>
            <div className="min-w-0 flex-1">
              {/* One quiet line: which day, when, how it stands, how long. */}
              <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/70">{dayLabel}</span>
                {/* a date belongs to a client's block (a template's days have none) */}
                {(dayScheduleStatus || d.scheduled_date) && (
                  <>
                    <span aria-hidden>·</span>
                    <DayDateButton
                      variant="inline"
                      needed={!!dayStatus?.missingDate}
                      value={dayStatus?.canonicalDate ?? d.scheduled_date ?? null}
                      onChange={(iso) => setDayAt(i, { ...d, scheduled_date: iso })}
                    />
                  </>
                )}
                {dayStatus?.status === "completed" && (
                  <span className="inline-flex items-center gap-0.5 font-medium text-success" data-day-status="completed">
                    <Check className="h-3.5 w-3.5" aria-hidden /> Done
                  </span>
                )}
                {dayStatus?.status === "in-progress" && (
                  <span className="font-medium text-foreground/80" data-day-status="in-progress">In progress</span>
                )}
                {dayStatus?.calendarIssue && (
                  <span className="inline-flex items-center gap-1 font-medium text-warning" title="The editor date and the calendar date disagree. The calendar is right: Fix aligns this day with it.">
                    Calendar issue
                    {onFixCalendarIssue && (
                      <button type="button" className="min-h-8 rounded-md px-1 underline underline-offset-2 hover:bg-muted" onClick={() => onFixCalendarIssue(dayStatus.dayId)}>
                        Fix
                      </button>
                    )}
                  </span>
                )}
                {rowCount > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{durationRange(dayMinutes)}</span>
                  </>
                )}
              </div>
              {/* The workout's name, typed in place (what the athlete reads). */}
              <input
                value={dayName}
                placeholder="Name this workout"
                aria-label={`${dayLabel} name`}
                autoComplete="off"
                onChange={(e) => {
                  const v = e.target.value;
                  // the name is the subtitle; the legacy title follows it so
                  // screens still reading `title` show the same name
                  setDayAt(i, { ...d, subtitle: v, title: v });
                }}
                className={cn(
                  "-mx-1.5 mt-0.5 block w-[calc(100%+0.75rem)] min-w-0 rounded-md bg-transparent px-1.5 font-semibold outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground hover:bg-muted/60 focus:bg-muted",
                  compact ? "h-8 text-sm" : "h-9 text-base",
                )}
              />
              {showFocus && (
                // wraps like text (a long focus line is never cut off), one line only
                <AutoGrowTextarea
                  value={d.focus ?? ""}
                  rows={1}
                  maxHeight={96}
                  placeholder="Focus, e.g. Squat or Upper"
                  aria-label={`${dayLabel} focus`}
                  onChange={(e) => setDayAt(i, { ...d, focus: e.target.value.replace(/\s*\n+\s*/g, " ") })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
                  className="-mx-1.5 block min-h-0 w-[calc(100%+0.75rem)] resize-none rounded-md border-0 bg-transparent px-1.5 py-1 text-[13px] leading-snug text-muted-foreground shadow-none outline-none transition-colors placeholder:text-muted-foreground/70 hover:bg-muted/60 focus:bg-muted focus:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0 max-md:text-base"
                />
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className={cn("-mr-1 shrink-0", phone ? "h-10 w-10" : "h-8 w-8")} aria-label={`${dayLabel} options`}>
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {rowCount > 0 && (
                  <>
                    <DropdownMenuItem onSelect={() => { dayBus.setActive(dKey); dayBus.emit(dKey, "expand"); }}>
                      <ChevronDown className="mr-2 h-4 w-4" /> Open every exercise
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => dayBus.emit(dKey, "collapse")}>
                      <ChevronUp className="mr-2 h-4 w-4" /> Close every exercise
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {clip && clip.kind === "rows" && clip.rows.length > 0 && (
                  <DropdownMenuItem onSelect={() => pasteInto(i)}>
                    <ClipboardPaste className="mr-2 h-4 w-4" /> Paste {clip.rows.length} exercise{clip.rows.length === 1 ? "" : "s"}
                  </DropdownMenuItem>
                )}
                {!phone && (
                  <DropdownMenuItem onSelect={() => addEmptyRow(i)}>
                    <Plus className="mr-2 h-4 w-4" /> Add an empty row
                  </DropdownMenuItem>
                )}
                {!showFocus && (
                  <DropdownMenuItem onSelect={() => setDayOpts((prev) => ({ ...prev, [i]: true }))}>
                    <Pencil className="mr-2 h-4 w-4" /> Add a focus line
                  </DropdownMenuItem>
                )}
                {onCopyDayToFuture && (
                  <DropdownMenuItem onSelect={() => onCopyDayToFuture(i)}>
                    <ArrowRight className="mr-2 h-4 w-4" /> Copy to later weeks
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => dupDay(i)}>
                  <Copy className="mr-2 h-4 w-4" /> Duplicate day
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={() => delDay(i)}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete day
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {dayStatus?.missingDate && (
            <p className={cn("flex items-center gap-1.5 pb-1.5 text-xs text-warning", compact ? "px-2.5" : "px-3")}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Not on the calendar yet. Set a date so it shows up for them.
            </p>
          )}
          <DayEditor day={d} setDay={(nd) => setDayAt(i, nd)} exercises={exercises} compact={compact} dayKey={dKey} purposeLabels={purposeLabelsByDay[i]} />
        </section>
      )})}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-11 flex-1 border-dashed text-muted-foreground md:h-10" onClick={addDay}>
          <Plus className="mr-1.5 h-4 w-4" /> Add day
        </Button>
        {blockId && week._dbId && (
          <AddExtraDayDialog
            weekId={week._dbId}
            blockId={blockId}
            existingDayCount={days.length}
            blockStartDate={blockStartDate}
            blockEndDate={blockEndDate}
            onAdded={onExtraDayAdded}
            triggerClassName="h-11 flex-1 md:h-10"
          />
        )}
      </div>
    </div>
  );
}

function DayEditor({ day, setDay, exercises, compact, dayKey, purposeLabels: weekLabels, standalone }: {
  day: any; setDay: (d: any) => void; exercises: any[]; compact?: boolean; dayKey?: string;
  /** This day's labels read across its week (WeekEditor); else read from the day alone. */
  purposeLabels?: string[];
  /** A day template on its own: it keeps its own small toolbar (no week around it). */
  standalone?: boolean;
}) {
  const rows = day.rows || [];
  // Derive ordered purpose labels (Primary / Secondary / Tertiary / Quaternary
  // for competition + variation rows; Assistance for everything else). Manual
  // `purpose_label` on a row wins. Recomputes whenever rows are reordered.
  const purposeLabels = useMemo(() => {
    if (weekLabels && weekLabels.length === rows.length) return weekLabels;
    const exById = new Map<string, any>((exercises as any[]).map((e) => [e.id, e]));
    return derivePurposeLabels(rows, (r: any) => (r.exercise_id ? exById.get(r.exercise_id) : null));
  }, [rows, exercises, weekLabels]);
  // Hard requirements for assignment — surface live so the coach sees gaps
  // as they build (and we can also block assignment without confirmation).
  const dayIssues = useMemo(
    () =>
      validateDay(
        day,
        new Map<string, string>((exercises as any[]).map((e) => [e.id, e.name])),
      ),
    [day, exercises],
  );
  const phone = useBuilderPhone();
  const [dragOver, setDragOver] = useState(false);
  const [dragRowIdx, setDragRowIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const pbDragging = usePbDragging();
  const clip = useClip();
  const addRow = () => setDay({
    ...day,
    rows: [...rows, {
      sort_order: rows.length,
      // Leave sets/reps/rpe/rir empty — placeholders only. Coach fills in.
      time_profile: "accessory_compound",
      percentage_basis: "none",
    }],
  });
  const pasteFromClip = () => {
    if (!clip || clip.kind !== "rows") return;
    const cloned = JSON.parse(JSON.stringify(clip.rows));
    const next = [...rows, ...cloned];
    setDay({ ...day, rows: next.map((r: any, i: number) => ({ ...r, sort_order: i })) });
  };
  const insertExercise = (exId: string, atIndex?: number) => {
    const ex = (exercises as any[]).find((x) => x.id === exId);
    // Auto-detect tracking type from exercise.default_measurement_type.
    // Coaches can override per-row in the builder, but time-based exercises
    // (planks, carries, holds) should show the timer automatically.
    const autoTrackingType: "reps_weight" | "reps" | "time" =
      ex?.default_measurement_type === "time" ? "time" : "reps_weight";
    const newRow: Record<string, any> = {
      sort_order: 0,
      time_profile: "accessory_compound",
      percentage_basis: "none",
      exercise_id: exId,
      exercise_name_override: ex?.name,
      rest_seconds: defaultRestSeconds(ex as any),
      tracking_type: autoTrackingType,
      measurement_type: autoTrackingType === "time" ? "time" : "reps",
      // For time-based exercises, auto-fill duration from exercise default
      ...(autoTrackingType === "time" && ex?.duration_seconds
        ? { duration_seconds: ex.duration_seconds }
        : {}),
    };
    const next = [...rows];
    const idx = atIndex ?? next.length;
    next.splice(idx, 0, newRow);
    setDay({ ...day, rows: next.map((r: any, i: number) => ({ ...r, sort_order: i })) });
  };

  // Day focus: track which day the coach is editing. Becomes active on any
  // click / focus inside the card. Switching to a different day automatically
  // collapses every row in the previous day (handled by dayBus.setActive).
  const isActive = useDayActive(dayKey);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Tracks whether this day is currently in "expand all" mode so a single
  // shortcut / button can toggle between expand-all and collapse-all.
  const [allExpanded, setAllExpanded] = useState(false);
  const activateDay = () => { if (dayKey) dayBus.setActive(dayKey); };
  const expandAll = () => {
    if (!dayKey) return;
    dayBus.setActive(dayKey);
    dayBus.emit(dayKey, "expand");
    setAllExpanded(true);
  };
  const collapseAll = () => {
    if (!dayKey) return;
    dayBus.emit(dayKey, "collapse");
    // Drop focus so cards don't auto-reopen via onFocusCapture.
    if (containerRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    setAllExpanded(false);
  };
  const toggleAll = () => { if (allExpanded) collapseAll(); else expandAll(); };
  // Single keyboard shortcut (only while this day is the active one):
  //   Cmd/Ctrl+Shift+X → toggle expand / collapse every row in this day
  useEffect(() => {
    if (!isActive || !dayKey) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        toggleAll();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isActive, dayKey, allExpanded]);

  const moveRow = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    const insertAt = to > from ? to - 1 : to;
    next.splice(insertAt, 0, moved);
    setDay({ ...day, rows: next.map((r: any, i: number) => ({ ...r, sort_order: i })) });
  };

  return (
    <div
      ref={containerRef}
      onMouseDownCapture={activateDay}
      onFocusCapture={activateDay}
      data-builder-day-rows
      className={cn(
        "relative rounded-b-2xl transition-colors",
        pbDragging === "exercise" && !dragOver && "outline-dashed outline-1 -outline-offset-4 outline-primary/40",
        dragOver && "bg-primary/5 outline outline-2 -outline-offset-2 outline-primary",
      )}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes(DND_EXERCISE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        const drop = readDrop(e);
        if (drop?.kind === "exercise") {
          e.preventDefault();
          insertExercise(drop.exerciseId);
        }
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute -top-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">
          Drop to add to this day
        </div>
      )}
      {standalone && (
        <div className="flex items-center justify-end gap-1 px-3 pt-2 text-xs text-muted-foreground">
          {dayKey && rows.length > 0 && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={toggleAll}>
              {allExpanded ? (<><ChevronUp className="mr-1 h-3.5 w-3.5" /> Close every exercise</>) : (<><ChevronDown className="mr-1 h-3.5 w-3.5" /> Open every exercise</>)}
            </Button>
          )}
          {clip && clip.kind === "rows" && clip.rows.length > 0 && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={pasteFromClip}>
              <ClipboardPaste className="mr-1 h-3.5 w-3.5" /> Paste ({clip.rows.length})
            </Button>
          )}
          {!phone && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={addRow}><Plus className="mr-1 h-3.5 w-3.5" /> Empty row</Button>}
        </div>
      )}
      {dayIssues.length > 0 && rows.length > 0 && (
        <div className={cn("mb-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning", compact ? "mx-2.5" : "mx-3")} role="status">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Still needs filling in</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {dayIssues.map((m, idx) => <li key={idx}>{m}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
      {rows.length === 0 && !phone && (
        <p className="mx-3 mb-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {dragOver ? "Release to drop here" : pbDragging === "exercise" ? "Drop the exercise anywhere in this day" : "Drag exercises in from the library, or add one below"}
        </p>
      )}
      {rows.length > 0 && (
        <div data-pb-day>
          {rows.map((r: any, i: number) => (
            <Fragment key={i}>
              {!phone && i > 0 && (
              <InlineAddExerciseButton
                exercises={exercises}
                onPick={(exId: string) => insertExercise(exId, i)}
                label="Insert exercise here"
              />
              )}
            <div
              draggable={!phone}
              onDragStart={(e) => {
                // Don't start a row-drag when the user is interacting with
                // a form control or button inside the row.
                const target = e.target as HTMLElement;
                if (target.closest('input, textarea, select, button, [role="combobox"], [contenteditable="true"]')) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData("application/x-pb-row-reorder", String(i));
                e.dataTransfer.effectAllowed = "move";
                setDragRowIdx(i);
                beginPbDrag("row");
              }}
              onDragEnd={() => { setDragRowIdx(null); setDropTargetIdx(null); endPbDrag(); }}
              onDragOver={(e) => {
                if (dragRowIdx == null) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                setDropTargetIdx(before ? i : i + 1);
              }}
              onDrop={(e) => {
                if (dragRowIdx == null) return;
                e.preventDefault();
                e.stopPropagation();
                const target = dropTargetIdx ?? i;
                moveRow(dragRowIdx, target);
                setDragRowIdx(null);
                setDropTargetIdx(null);
                endPbDrag();
              }}
              className={cn(
                "border-t border-border/70 transition-opacity",
                !phone && "cursor-grab active:cursor-grabbing",
                dragRowIdx === i && "opacity-40",
                dropTargetIdx === i && "shadow-[inset_0_2px_0_0_var(--primary)]",
                dropTargetIdx === i + 1 && "shadow-[inset_0_-2px_0_0_var(--primary)]",
              )}
            >
              <RowEditor
                row={{ ...r, index_total: rows.length }}
                setRow={(nr) => { const copy = [...rows]; copy[i] = nr; setDay({ ...day, rows: copy }); }}
                onDelete={() => setDay({ ...day, rows: rows.filter((_: any, j: number) => j !== i) })}
                canMoveUp={i > 0}
                canMoveDown={i < rows.length - 1}
                onMoveUp={() => moveRow(i, i - 1)}
                onMoveDown={() => moveRow(i, i + 2)}
                onDragStartRow={(e) => {
                  e.dataTransfer.setData("application/x-pb-row-reorder", String(i));
                  e.dataTransfer.effectAllowed = "move";
                  setDragRowIdx(i);
                  beginPbDrag("row");
                }}
                onDragEndRow={() => { setDragRowIdx(null); setDropTargetIdx(null); endPbDrag(); }}
                isDragging={dragRowIdx === i}
                exercises={exercises}
                compact={compact !== false}
                purposeLabel={purposeLabels[i]}
                dayKey={dayKey}
                index={i}
              />
            </div>
            </Fragment>
          ))}
        </div>
      )}
      <InlineAddExerciseButton
        exercises={exercises}
        onPick={(exId: string) => insertExercise(exId, rows.length)}
        label="Add exercise"
        prominent
      />
    </div>
  );
}

/**
 * Slim "+" rendered between exercise rows in DayEditor. Click opens a
 * popover with a search box; choosing a result inserts a new row at that
 * position. The trigger stays low-profile (hairline divider + faded button)
 * until the user hovers the slot, so it doesn't clutter the day.
 */
function InlineAddExerciseButton({
  exercises,
  onPick,
  label,
  prominent = false,
}: {
  exercises: any[];
  onPick: (exerciseId: string) => void;
  label: string;
  /** The day's own add (end of the day): a full button on a phone. */
  prominent?: boolean;
}) {
  const phone = useBuilderPhone();
  if (phone) {
    return prominent ? (
      <PhoneAddExerciseButton exercises={exercises} onPick={onPick} label={label} />
    ) : null;
  }
  return <InlineAddExercisePopover exercises={exercises} onPick={onPick} label={label} prominent={prominent} />;
}

/** The day's last row: "+ Add exercise", the same on a phone and a computer. */
const ADD_EXERCISE_ROW =
  "flex min-h-12 w-full items-center gap-2 rounded-b-2xl border-t border-border/70 px-3 text-[15px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:min-h-11 md:text-sm";

function PhoneAddExerciseButton({
  exercises,
  onPick,
  label,
}: {
  exercises: any[];
  onPick: (exerciseId: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={ADD_EXERCISE_ROW} onClick={() => setOpen(true)} data-add-exercise>
        <Plus className="h-4 w-4" aria-hidden /> {label}
      </button>
      <PhoneExercisePickerSheet
        open={open}
        onOpenChange={setOpen}
        title="Add exercise"
        exercises={exercises}
        onPick={(ex) => onPick(ex.id)}
      />
    </>
  );
}

/**
 * The library on a phone: a tall sheet with a search box and rows a thumb can
 * hit (the desktop popovers are 24px rows in a 256px box).
 */
function PhoneExercisePickerSheet({
  open,
  onOpenChange,
  title,
  description,
  exercises,
  excludeId,
  onPick,
  onCustomName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  exercises: any[];
  excludeId?: string | null;
  onPick: (exercise: any) => void;
  /** Offer "Use a custom name" (a row with no library exercise). */
  onCustomName?: (name: string) => void;
}) {
  // the same sheet on a computer, from the side
  const phone = useBuilderPhone();
  const [q, setQ] = useState("");
  const searched = useMemo(() => {
    const list = (exercises as SearchableExercise[]).filter((e) => !excludeId || e.id !== excludeId);
    return searchExercises(list, q, { limit: q.trim() ? 200 : 100 });
  }, [exercises, q, excludeId]);
  const filtered = searched.results.map((r) => r.exercise) as any[];
  const terms = searched.highlightTerms;
  const close = (next: boolean) => {
    if (!next) setQ("");
    onOpenChange(next);
  };
  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side={phone ? "bottom" : "right"}
        hideCloseButton
        className={cn("flex flex-col gap-0 overflow-hidden p-0", phone ? "h-[88dvh] rounded-t-2xl" : "w-[420px] sm:max-w-[420px]")}
      >
        <div className="shrink-0 border-b border-border px-4 pb-3 pt-2">
          {phone && <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />}
          <div className="flex items-start gap-2">
            <SheetTitle className="min-w-0 flex-1 pt-1 text-base font-semibold">{title}</SheetTitle>
            {!phone && (
              <Button type="button" size="icon" variant="ghost" className="-mr-2 h-9 w-9 shrink-0" aria-label="Close" onClick={() => close(false)}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <SheetDescription className={description ? "text-[13px]" : "sr-only"}>
            {description ?? "Search the exercise library"}
          </SheetDescription>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              enterKeyHint="search"
              type="search"
              placeholder="Search exercises"
              aria-label="Search exercises"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 pl-9 text-base"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {q.trim() && !searched.hasExactMatches && filtered.length > 0 && (
            <p className="pb-2 text-[12px] text-muted-foreground">No exact matches. Showing the closest.</p>
          )}
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches that. Try another word.</p>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((ex) => {
                const tagLine = [ex.muscle_group, ex.category].filter(Boolean).join(" · ");
                return (
                  <li key={ex.id}>
                    <button
                      type="button"
                      onClick={() => { onPick(ex); close(false); }}
                      className="flex min-h-[52px] w-full flex-col justify-center rounded-xl border border-border bg-card px-3 py-2 text-left transition active:scale-[0.99]"
                    >
                      <span className="text-[15px] font-medium"><HighlightedText text={ex.name} terms={terms} /></span>
                      {tagLine && <span className="text-[12px] text-muted-foreground">{tagLine}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {onCustomName && (
          <div className="shrink-0 border-t border-border px-4 py-2">
            <Button
              type="button"
              variant="ghost"
              className="h-10 w-full text-muted-foreground"
              onClick={() => { onCustomName(q.trim()); close(false); }}
            >
              {q.trim() ? `Use "${q.trim()}" as a custom name` : "Use a custom name instead"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InlineAddExercisePopover({
  exercises,
  onPick,
  label,
  prominent,
}: {
  exercises: any[];
  onPick: (exerciseId: string) => void;
  label: string;
  /** The day's own "+ Add exercise" row (else the slim insert line between rows). */
  prominent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const pbDragging = usePbDragging();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const searched = useMemo(
    () => searchExercises(exercises as SearchableExercise[], q, { limit: q.trim() ? 200 : 100 }),
    [exercises, q],
  );
  const filtered = searched.results.map((r) => r.exercise) as any[];
  const terms = searched.highlightTerms;

  const pick = (exId: string) => {
    onPick(exId);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes(DND_EXERCISE)) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "copy";
              if (!dropActive) setDropActive(true);
            }
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(e) => {
            const drop = readDrop(e);
            setDropActive(false);
            if (drop?.kind === "exercise") {
              e.preventDefault();
              e.stopPropagation();
              onPick(drop.exerciseId);
            }
          }}
          data-add-exercise={prominent ? "" : undefined}
          className={prominent ? cn(ADD_EXERCISE_ROW, dropActive && "bg-primary/10 text-foreground") : cn(
            "group/insert relative -my-1.5 flex w-full items-center justify-center transition-all",
            dropActive ? "h-10 opacity-100" : pbDragging === "exercise" ? "h-6 opacity-100" : "h-3 opacity-0 hover:opacity-100 focus:opacity-100",
          )}
        >
          {prominent ? (<><Plus className="h-4 w-4" aria-hidden /> {dropActive ? "Drop here" : label}</>) : (<>
          <span
            aria-hidden
            className={cn(
              "absolute inset-x-0 top-1/2 -translate-y-1/2 transition-all",
              dropActive ? "h-1 rounded-full bg-primary"
                : pbDragging === "exercise" ? "h-0.5 bg-primary/60 rounded-full"
                : "h-px bg-border/60 group-hover/insert:bg-primary/50",
            )}
          />
          {dropActive && (
            <span className="pointer-events-none absolute left-1/2 -top-5 -translate-x-1/2 whitespace-nowrap rounded bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow">
              Drop here
            </span>
          )}
          <span
            className={cn(
              "relative z-10 inline-flex items-center justify-center rounded-full border shadow-sm transition-all",
              dropActive
                ? "h-6 w-6 border-primary bg-primary text-primary-foreground scale-110"
                : pbDragging === "exercise"
                  ? "h-5 w-5 border-primary bg-background text-primary"
                  : "h-5 w-5 border-border bg-background text-muted-foreground group-hover/insert:border-primary group-hover/insert:bg-primary group-hover/insert:text-primary-foreground",
            )}
          >
            <Plus className="h-3 w-3" />
          </span>
          </>)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-2"
        align="center"
        onOpenAutoFocus={() => setTimeout(() => inputRef.current?.focus(), 0)}
      >
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
          {label}
        </div>
        <Input
          ref={inputRef}
          placeholder="Search exercises…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-2 h-8 text-xs"
        />
        <div className="max-h-64 overflow-y-auto">
          {q.trim() && !searched.hasExactMatches && filtered.length > 0 && (
            <div className="px-2 pb-1 text-[10px] text-muted-foreground">
              No exact matches. Showing closest results.
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No matches
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((ex) => {
                const tagLine = [ex.muscle_group, ex.category].filter(Boolean).join(" · ");
                return (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => pick(ex.id)}
                    className="rounded px-2 py-1 text-left hover:bg-muted"
                  >
                    <div className="text-xs">
                      <HighlightedText text={ex.name} terms={terms} />
                    </div>
                    {tagLine && (
                      <div className="text-[10px] text-muted-foreground">
                        <HighlightedText text={tagLine} terms={terms} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A labelled field inside an open exercise card. Defined once at module
 * level: made inside RowEditor it was a new component every render, so each
 * commit (400 ms after the last key) remounted the whole card's inputs and
 * threw the cursor out of the box being typed in.
 */
function RowField({ label, className, children }: { label: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="px-0.5 text-xs leading-none text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const TRACKING_LABEL: Record<"reps_weight" | "reps" | "time", string> = {
  reps_weight: "Reps",
  reps: "Reps, no weight",
  time: "Time",
};

function RowEditor({ row, setRow, onDelete, exercises, compact, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onDragStartRow, onDragEndRow, isDragging, purposeLabel, dayKey, index }: { row: any; setRow: (r: any) => void; onDelete?: () => void; exercises: any[]; compact?: boolean; onMoveUp?: () => void; onMoveDown?: () => void; canMoveUp?: boolean; canMoveDown?: boolean; onDragStartRow?: (e: React.DragEvent) => void; onDragEndRow?: () => void; isDragging?: boolean; purposeLabel?: string; dayKey?: string; index?: number }) {
  // A phone: every field is a 44px box with 16px text (no iOS zoom on focus),
  // every button a 40px tap.
  const phone = useBuilderPhone();
  // Inputs follow the theme: a well on the card, never a white box in dark mode.
  const inputCls =
    "rounded-lg border border-input bg-background text-foreground shadow-none " +
    "placeholder:font-normal placeholder:text-muted-foreground/60 " +
    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
  const exMeta = (exercises as any[]).find((e) => e.id === row.exercise_id) ?? null;
  const exName = exMeta?.name ?? row.exercise_name_override ?? "";
  const rowHasVideo = hasExerciseVideo(exMeta);
  const videoUrl: string | null = exMeta
    ? (exMeta.video_url || exMeta.youtube_url || exMeta.vimeo_url || null)
    : null;
  // A library exercise with no demo video: a small amber camera on its row.
  const missingVideo = !!row.exercise_id && !!exMeta && !rowHasVideo;
  // Colour is the exercise's movement family everywhere (shared module).
  const family = resolveMovementFamily(exMeta, row.movement_family);
  const accent = exerciseAccent(exMeta, null, row.movement_family);
  const restCat = resolveCategory(exMeta);
  const restDefault = defaultRestSeconds(exMeta);
  const effectiveRest = effectiveRestSeconds(row, exMeta);
  const restIsOverride = row.rest_seconds_override != null && row.rest_seconds_override !== restDefault;
  const [expanded, setExpanded] = useState(!compact);
  useEffect(() => { if (!compact) setExpanded(true); }, [compact]);
  // Exercise type, label and family: rarely touched, folded under "More".
  const [moreOpen, setMoreOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // "Collapsed" = the whole card is in summary/read-only mode (no input boxes).
  // It expands automatically when the user clicks or tabs into it, and snaps
  // back to summary when focus leaves the card.
  // Minimum requirements to be "fillable" enough to allow auto-collapse:
  // exercise + sets + reps + an intensity signal (RPE, RIR, or a suggested
  // load — either a % of a basis or a manual kg/lb load). Until all of
  // these are present we keep the card expanded so coaches see the empty
  // inputs they still owe.
  const meetsMinimum = (() => {
    const hasEx = !!((row as any).exercise_id || (row as any).exercise_name_override);
    const hasSets = row.sets != null && row.sets !== "";
    const isTime = (row as any).measurement_type === "time";
    const hasReps = isTime
      ? ((row as any).duration_seconds != null && Number((row as any).duration_seconds) > 0)
      : !!row.reps_text;
    const hasRpe = (row as any).rpe != null && (row as any).rpe !== "";
    const hasRir = (row as any).rir != null && (row as any).rir !== "";
    const hasPct = (row as any).percentage != null && (row as any).percentage !== "" &&
      (row as any).percentage_basis && (row as any).percentage_basis !== "none";
    const hasManualLoad = ((row as any).load_kg != null && (row as any).load_kg !== "") ||
      ((row as any).load_lb != null && (row as any).load_lb !== "");
    const hasIntensity = hasRpe || hasRir || hasPct || hasManualLoad;
    return hasEx && hasSets && hasReps && hasIntensity;
  })();
  const meetsMinRef = useRef(meetsMinimum);
  useEffect(() => { meetsMinRef.current = meetsMinimum; }, [meetsMinimum]);
  const [collapsed, setCollapsed] = useState(meetsMinimum);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCollapse = () => {
    // Don't auto-collapse incomplete cards — keep them expanded so the
    // missing fields stay visible.
    if (!meetsMinRef.current) return;
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setCollapsed(true), 120);
  };
  const cancelCollapse = () => {
    if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null; }
  };
  useEffect(() => () => { if (collapseTimer.current) clearTimeout(collapseTimer.current); }, []);
  // Listen for day-wide expand/collapse pulses from the parent DayEditor.
  useEffect(() => {
    if (!dayKey) return;
    return dayBus.on(dayKey, (ev) => {
      if (ev === "expand") { cancelCollapse(); setCollapsed(false); }
      else { cancelCollapse(); setCollapsed(true); }
    });
  }, [dayKey]);
  const h = phone ? "h-11 text-base" : compact ? "h-8 text-sm" : "h-9 text-sm";
  const { clientId, blockId, index: maxesIndex, maxes, refresh } = useClientMaxesCtx();
  const [maxEditor, setMaxEditor] = useState<any>(null);
  // Derive a clear "load mode" from the existing basis field.
  // NEW DEFAULT: an unset basis means NO suggested load (off-by-default).
  // Legacy rows with explicit `manual` + an existing load value keep their
  // suggested-load enabled so we never silently strip a real programmed load.
  const hasExistingManualLoad = (row.load_kg ?? null) !== null || (row.load_lb ?? null) !== null;
  const loadMode: "pct" | "manual" | "none" =
    row.percentage_basis === "none" ? "none"
    : row.percentage_basis === "manual" ? "manual"
    : !row.percentage_basis ? (hasExistingManualLoad ? "manual" : "none")
    : "pct";
  const suggestedOn = loadMode !== "none";
  const rowUnit: "kg" | "lb" = row.load_unit === "lb" ? "lb" : "kg";
  const setLoadMode = (mode: "pct" | "manual" | "none") => {
    if (mode === "manual") {
      setRow({ ...row, percentage_basis: "manual", percentage: null, manual_override: false });
    } else if (mode === "none") {
      setRow({ ...row, percentage_basis: "none", percentage: null, load_kg: null, load_lb: null, manual_override: false });
    } else {
      // Switch back to % — default to training_max if no basis previously.
      setRow({ ...row, percentage_basis: row.percentage_basis && row.percentage_basis !== "manual" && row.percentage_basis !== "none" ? row.percentage_basis : "training_max", manual_override: false });
    }
  };
  // A % of a max reads the exercise's own max, else its lift family's competition
  // max (load-reference.ts): a High Bar Squat's 65% TM is the Competition Squat's.
  const refFamily = referenceFamily({ rowFamily: row.movement_family, competitionLiftType: exMeta?.competition_lift_type, movementFamily: exMeta?.movement_family });
  const ownCompetition = !!refFamily && String(exMeta?.competition_lift_type ?? "").toLowerCase() === refFamily;
  const computed = useMemo(() => {
    if (!clientId) return null;
    return computeRowLoad({
      exerciseName: exName,
      basis: row.percentage_basis,
      percentage: row.percentage ? Number(row.percentage) : null,
      manualLoadKg: row.load_kg ? Number(row.load_kg) : null,
      manualLoadLb: row.load_lb ? Number(row.load_lb) : null,
      unit: rowUnit,
      maxesIndex,
      family: refFamily,
      ownCompetition,
    });
  }, [clientId, exName, row.percentage, row.percentage_basis, row.load_kg, row.load_lb, rowUnit, maxesIndex, refFamily, ownCompetition]);
  const overrideCalculated = () => {
    if (!computed || computed.status !== "ok" || computed.load == null) return;
    const patch: any = { ...row, manual_override: true, override_of_pct: row.percentage };
    if (rowUnit === "kg") patch.load_kg = computed.load;
    else patch.load_lb = computed.load;
    setRow(patch);
  };
  const clearOverride = () => {
    setRow({ ...row, manual_override: false, load_kg: null, load_lb: null });
  };
  const resetCard = () => {
    setRow({
      ...row,
      sets: null,
      reps_text: "",
      duration_seconds: null,
      reps_text_backup: null,
      duration_seconds_backup: null,
      rpe: "",
      rir: "",
      percentage: null,
      percentage_basis: null,
      load_kg: null,
      load_lb: null,
      rest_seconds: null,
      rest_seconds_override: null,
      tempo: "",
      notes: "",
      manual_override: false,
      override_of_pct: null,
      purpose_label: null,
    });
    toast.success("Card reset");
  };
  const multiBlockFlag = useMultiBlockBuilderFlag();
  const [blocksOpen, setBlocksOpen] = useState(false);
  const iconBtn = phone ? "h-10 w-10" : "h-8 w-8";
  const openCard = () => { cancelCollapse(); setCollapsed(false); };
  // Swap keeps every input (sets / reps / rpe / rir / load / rest / tempo /
  // notes…) and replaces only the exercise.
  const pickExercise = (ex: any) => {
    setRow({ ...row, exercise_id: ex.id, exercise_name_override: ex.name });
    toast.success(`Swapped to ${ex.name}`);
  };

  // Three explicit tracking types: reps + weight, reps only, time only.
  // The prescription drives what the client logs — no name-based guesses.
  const tracking: "reps_weight" | "reps" | "time" =
    (row as any).tracking_type === "reps"
      ? "reps"
      : (row as any).tracking_type === "time" || (row as any).measurement_type === "time"
        ? "time"
        : "reps_weight";
  const isTime = tracking === "time";
  const setTracking = (next: "reps_weight" | "reps" | "time") => {
    if (next === tracking) return;
    if (next === "time") {
      const restored = (row as any).duration_seconds_backup ?? null;
      setRow({
        ...row,
        tracking_type: "time",
        measurement_type: "time",
        reps_text_backup: row.reps_text || (row as any).reps_text_backup || null,
        reps_text: "",
        duration_seconds: restored,
        // time-only: no loaded weight
        load_kg: null,
        load_lb: null,
        percentage: null,
        percentage_basis: "none",
        manual_override: false,
      });
    } else if (next === "reps") {
      const restored = (row as any).reps_text_backup ?? "";
      setRow({
        ...row,
        tracking_type: "reps",
        measurement_type: "reps",
        duration_seconds_backup: (row as any).duration_seconds ?? (row as any).duration_seconds_backup ?? null,
        duration_seconds: null,
        reps_text: row.reps_text || restored,
        // reps-only: no weight
        load_kg: null,
        load_lb: null,
        percentage: null,
        percentage_basis: "none",
        manual_override: false,
      });
    } else {
      const restored = (row as any).reps_text_backup ?? "";
      setRow({
        ...row,
        tracking_type: "reps_weight",
        measurement_type: "reps",
        duration_seconds_backup: (row as any).duration_seconds ?? (row as any).duration_seconds_backup ?? null,
        duration_seconds: null,
        reps_text: row.reps_text || restored,
      });
    }
  };

  // The prescription in one line: "3 × 8-12 · RPE 8 · tempo 3-1-1 · rest 1m 30s".
  const amount = isTime
    ? ((row as any).duration_seconds != null && Number((row as any).duration_seconds) > 0 ? formatDuration(Number((row as any).duration_seconds)) : null)
    : (row.reps_text ? String(row.reps_text) : null);
  const hasSets = row.sets != null && row.sets !== "";
  const summaryParts: string[] = [];
  if (hasSets && amount) summaryParts.push(`${row.sets} × ${amount}`);
  else if (hasSets) summaryParts.push(`${row.sets} set${Number(row.sets) === 1 ? "" : "s"}`);
  else if (amount) summaryParts.push(isTime ? amount : `${amount} reps`);
  // An RPE beside a planned % caps it ("RPE cap 6"): the % is the load, the RPE the limit.
  if (row.rpe !== "" && row.rpe != null) summaryParts.push(hasRpeCap(row) ? `RPE cap ${row.rpe}` : `RPE ${row.rpe}`);
  if (row.rir !== "" && row.rir != null) summaryParts.push(`RIR ${row.rir}`);
  const loadSummary = (() => {
    if (loadMode === "none") return null;
    if (loadMode === "pct" && row.percentage != null && row.percentage !== "") {
      // "65% Comp Squat TM" / "70% TM" / "92.5% of top set": what the athlete's weight is worked out from
      const viaFamily = isMaxBasis(row.percentage_basis) && !!refFamily && !ownCompetition;
      const label = computed?.status === "ok" && computed.label
        ? computed.label
        : plannedLoadLabel({ percentage: row.percentage, basis: row.percentage_basis, refLift: viaFamily && refFamily ? `Competition ${refFamily[0].toUpperCase()}${refFamily.slice(1)}` : null, viaFamily });
      const load = computed?.status === "ok" && computed.load != null ? ` = ${computed.load} ${rowUnit}` : "";
      if (label) return `${label}${load}`;
      // "90% of Previous Week", never "90% % of Previous Week"
      const basisLabel = (PERCENTAGE_BASES.find((p) => p.value === row.percentage_basis)?.label) ?? "";
      const words = basisLabel.replace(/^%\s*/, "").replace(/\s*\(linked row\)$/, "");
      return `${row.percentage}%${words ? ` ${words}` : ""}`;
    }
    const val = rowUnit === "kg" ? row.load_kg : row.load_lb;
    if (val != null && val !== "") return `${val} ${rowUnit}`;
    return null;
  })();
  if (loadSummary) summaryParts.push(loadSummary);
  if (row.tempo) summaryParts.push(`tempo ${row.tempo}`);
  const restSummary = `rest ${fmtRestSeconds(effectiveRest)}`;
  const showLabel = !!purposeLabel && purposeLabel !== "Assistance";

  // Order number, derived from the row's current position in the day (never
  // stored): reorder or delete a row and every card renumbers automatically.
  // Hidden when no index is provided (standalone single-row view).
  const RowIndexBadge = index == null ? null : (
    <ExerciseOrderBadge position={index + 1} family={family} tone="neutral" size="sm" className="mt-0.5 h-6 min-w-6 rounded-full text-xs" />
  );

  const grip = !phone ? (
    <span
      draggable={!!onDragStartRow}
      onDragStart={onDragStartRow}
      onDragEnd={onDragEndRow}
      onClick={(e) => e.stopPropagation()}
      title="Drag to reorder"
      aria-hidden
      className="absolute left-0.5 top-2.5 cursor-grab rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground active:cursor-grabbing group-hover/row:opacity-100"
    >
      <GripVertical className="h-4 w-4" />
    </span>
  ) : null;

  // Everything else a row can do, in one ⋯ (phone and computer alike). It's
  // its own: opening it or picking from it never opens the card.
  const rowMenu = (
    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className={cn(iconBtn, "-mr-1")} data-row-menu aria-label={`${exName || "Exercise"} options`}>
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" data-row-menu>
          {collapsed && (
            <DropdownMenuItem onSelect={openCard}>
              <Settings2 className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
            <ArrowLeftRight className="mr-2 h-4 w-4" /> Swap exercise
          </DropdownMenuItem>
          {onMoveUp && (
            <DropdownMenuItem disabled={canMoveUp === false} onSelect={onMoveUp}>
              <ChevronUp className="mr-2 h-4 w-4" /> Move up
            </DropdownMenuItem>
          )}
          {onMoveDown && (
            <DropdownMenuItem disabled={canMoveDown === false} onSelect={onMoveDown}>
              <ChevronDown className="mr-2 h-4 w-4" /> Move down
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => { copyRows([row]); toast.success("Exercise copied"); }}>
            <ClipboardCopy className="mr-2 h-4 w-4" /> Copy
          </DropdownMenuItem>
          {rowHasVideo && videoUrl && (
            <DropdownMenuItem onSelect={() => window.open(videoUrl, "_blank", "noopener,noreferrer")}>
              <Video className="mr-2 h-4 w-4" /> Watch the demo
            </DropdownMenuItem>
          )}
          {multiBlockFlag && row._dbId && (
            <DropdownMenuItem onSelect={() => setBlocksOpen(true)}>
              <Layers className="mr-2 h-4 w-4" /> Multi-block editor (preview)
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={resetCard}>
            <RotateCcw className="mr-2 h-4 w-4" /> Clear sets, reps and load
          </DropdownMenuItem>
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const nameBlock = (
    <div className="min-w-0 flex-1">
      <div className={cn("flex items-start gap-1.5", phone ? "text-[15px]" : "text-sm")}>
        <span className="min-w-0 font-semibold leading-snug [overflow-wrap:anywhere] line-clamp-2">
          {exName || <span className="font-normal italic text-muted-foreground">No exercise yet</span>}
        </span>
        {missingVideo && (
          <VideoOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-label="No demo video on this exercise" />
        )}
      </div>
    </div>
  );

  return (
    <div
      data-pb-row
      // a row's ⋯ is its own: opening it or picking from it never opens the
      // card (React events bubble out of the menu's portal)
      // (and nothing in a layer it opened, like the exercise picker, opens it)
      onClickCapture={(e) => { if (collapsed && !inFloatingLayer(e.target)) openCard(); }}
      onFocusCapture={(e) => { if (inFloatingLayer(e.target)) return; openCard(); }}
      onBlurCapture={(e) => {
        if (inFloatingLayer(e.relatedTarget)) return;
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) scheduleCollapse();
      }}
      onKeyDown={(e) => {
        // keys inside a menu / list / sheet this card opened are theirs
        // (Escape closes the menu, never the card under it)
        if (inFloatingLayer(e.target)) return;
        // Quick key: Alt+R resets the currently focused card
        if (e.altKey && (e.key === "r" || e.key === "R")) {
          // Keydown bubbles up from the card's inputs — on macOS Option+R
          // types "®" while editing text, which would nuke the whole card
          // mid-typing. Only treat it as a shortcut when focus is on the
          // card container itself, not inside a field.
          const t = e.target as HTMLElement | null;
          if (t && t.closest("input, textarea, select, [contenteditable]")) return;
          e.preventDefault();
          e.stopPropagation();
          resetCard();
        }
        if (e.key === "Escape" && !collapsed) {
          (document.activeElement as HTMLElement | null)?.blur?.();
          setCollapsed(true);
        }
      }}
      className={cn(
        "group/row @container/row relative transition-colors",
        isDragging && "opacity-50",
        collapsed
          ? cn("cursor-pointer hover:bg-muted/40", compact ? "py-2 pl-4 pr-2" : "py-2.5 pl-4 pr-2")
          : cn("bg-muted/40", phone ? "space-y-3 py-3 pl-4 pr-2" : "space-y-2.5 py-3 pl-4 pr-2"),
      )}
      title={collapsed ? "Click to edit" : undefined}
    >
      {/* The movement family: one thin stripe (squat yellow, bench blue,
          deadlift green, everything else red). */}
      <span className={cn("absolute bottom-2 left-1.5 top-2 w-[3px] rounded-full", accent)} aria-hidden />
      {grip}
      {collapsed ? (
        <div className="flex min-w-0 items-start gap-2.5">
          {RowIndexBadge}
          <div className="min-w-0 flex-1">
            {nameBlock}
            <div className={cn("mt-0.5 leading-snug text-muted-foreground", phone ? "text-[13px]" : "text-xs")}>
              {summaryParts.length > 0 ? summaryParts.join(" · ") : <span className="italic">No sets or reps yet</span>}
              <span className="opacity-60"> · </span>
              <span className="whitespace-nowrap">{restSummary}</span>
            </div>
            {showLabel && (
              <div className="mt-0.5 text-xs text-muted-foreground" data-purpose-label>{purposeLabelText(purposeLabel)}</div>
            )}
          </div>
          {rowMenu}
        </div>
      ) : (
      <>
      {/* ---- The exercise: its name, Swap, ⋯ ---- */}
      <div className="flex min-w-0 items-start gap-2.5">
        {RowIndexBadge}
        <div className="min-w-0 flex-1">
          {nameBlock}
          {!row.exercise_id && (
            <RowCell className={cn("mt-1.5 font-medium", h, inputCls)} placeholder="Custom name" value={row.exercise_name_override} onCommit={(v) => setRow({ ...row, exercise_name_override: v })} />
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("shrink-0 gap-1.5 px-2 text-muted-foreground hover:text-foreground", phone ? "h-10" : "h-8")}
          onClick={() => setPickerOpen(true)}
          title="Swap exercise (keeps sets, reps, load, etc.)"
        >
          <ArrowLeftRight className="h-4 w-4" /> {row.exercise_id || row.exercise_name_override ? "Swap" : "Pick"}
        </Button>
        {rowMenu}
      </div>
      {/* ---- Sets · Reps (or time) · RPE · RIR · Rest ---- */}
      {/* six across on a narrow card (a phone, two days side by side), twelve on a wide one */}
      <div className="grid grid-cols-6 items-end gap-2 @xl/row:grid-cols-12">
        <RowField className="col-span-2" label="Sets">
          <RowCell dataField="sets" className={cn("text-center font-semibold tabular-nums", h, inputCls)} inputMode="numeric" placeholder="3" value={row.sets} onCommit={(v) => setRow({ ...row, sets: parseIntOrNull(v) })} />
        </RowField>
        <RowField
          className="col-span-4 @xl/row:col-span-3"
          label={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="-my-1 inline-flex items-center gap-0.5 rounded py-1 text-xs text-muted-foreground hover:text-foreground" aria-label={`Logged as: ${TRACKING_LABEL[tracking]}. Change`}>
                  {TRACKING_LABEL[tracking]} <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52" data-row-menu>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">They log</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={tracking} onValueChange={(v) => setTracking(v as any)}>
                  <DropdownMenuRadioItem value="reps_weight">Reps and weight</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="reps">Reps only (bodyweight)</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="time">Time</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          <div className="flex items-stretch gap-1">
            {isTime ? (
              <>
                <DurationInput
                  valueSeconds={(row as any).duration_seconds ?? null}
                  onChange={(secs: number | null) => setRow({ ...row, duration_seconds: secs })}
                  compact
                />
                <CountdownTimerButton seconds={(row as any).duration_seconds} compact />
              </>
            ) : (
              <RowCell dataField="reps" className={cn("flex-1 text-center font-semibold tabular-nums", h, inputCls)} placeholder="8-12" value={row.reps_text} onCommit={(v) => setRow({ ...row, reps_text: v ?? "" })} />
            )}
          </div>
        </RowField>
        <RowField className="col-span-2" label="RPE">
          <RowCell dataField="rpe" className={cn("text-center font-semibold tabular-nums", h, inputCls)} inputMode="decimal" placeholder="—" value={row.rpe} onCommit={(v) => setRow({ ...row, rpe: v ?? "" })} />
        </RowField>
        <RowField className="col-span-2" label="RIR">
          <RowCell dataField="rir" className={cn("text-center font-semibold tabular-nums", h, inputCls)} inputMode="decimal" placeholder="—" value={row.rir} onCommit={(v) => setRow({ ...row, rir: v ?? "" })} />
        </RowField>
        <RowField className="col-span-2 @xl/row:col-span-3" label={`Rest${restIsOverride ? " (set)" : ""}`}>
          {(() => {
            const REST_PRESETS: { v: number; label: string }[] = [
              { v: 30, label: "30 sec" },
              { v: 60, label: "60 sec" },
              { v: 90, label: "90 sec" },
              { v: 120, label: "2 min" },
              { v: 180, label: "3 min" },
              { v: 240, label: "4 min" },
              { v: 300, label: "5 min" },
              { v: 480, label: "8 min" },
              { v: 600, label: "10 min" },
            ];
            const override = row.rest_seconds_override as number | null | undefined;
            const presetMatch = override != null && REST_PRESETS.some((p) => p.v === override);
            const selectValue = override == null ? "auto" : presetMatch ? String(override) : "custom";
            const onChange = (v: string) => {
              if (v === "auto") {
                setRow({ ...row, rest_seconds_override: null, rest_seconds: null });
              } else if (v === "custom") {
                const init = override ?? restDefault ?? 60;
                setRow({ ...row, rest_seconds_override: init, rest_seconds: init });
              } else {
                const n = parseInt(v, 10);
                setRow({ ...row, rest_seconds_override: n, rest_seconds: n });
              }
            };
            return (
              <>
                <Select value={selectValue} onValueChange={onChange}>
                  <SelectTrigger
                    className={cn("px-2 font-medium tabular-nums [&>span]:truncate", h, inputCls)}
                    title={selectValue === "auto" ? `Auto · ${restCat} default · ${fmtRestSeconds(effectiveRest)}` : `${fmtRestSeconds(effectiveRest)} programmed`}
                  >
                    <SelectValue>
                      {selectValue === "auto"
                        ? `Auto · ${fmtRestSeconds(restDefault)}`
                        : selectValue === "custom"
                          ? `${fmtRestSeconds(override ?? null)}`
                          : fmtRestSeconds(parseInt(selectValue, 10))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto · {fmtRestSeconds(restDefault)}</SelectItem>
                    {REST_PRESETS.map((p) => (
                      <SelectItem key={p.v} value={String(p.v)}>{p.label}</SelectItem>
                    ))}
                    <SelectItem value="custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {selectValue === "custom" && (
                  <RowCell
                    dataField="rest"
                    className={cn("mt-1 text-center font-semibold tabular-nums", h, inputCls)}
                    inputMode="numeric"
                    placeholder="Seconds"
                    value={override ?? ""}
                    onCommit={(v) => {
                      const n = parseIntOrNull(v);
                      if (n == null || n <= 0) {
                        setRow({ ...row, rest_seconds_override: null, rest_seconds: null });
                      } else {
                        setRow({ ...row, rest_seconds_override: n, rest_seconds: n });
                      }
                    }}
                  />
                )}
              </>
            );
          })()}
        </RowField>
      </div>
      {compact && !phone && (
        <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Load and tempo
        </button>
      )}
      {expanded && (
      <div className="grid grid-cols-12 items-start gap-2">
        {/* ---- Suggested load: one group ---- */}
        <div className={cn("col-span-12 rounded-lg border border-border bg-background/60 p-2.5", loadMode === "none" ? "@xl/row:col-span-8" : "@xl/row:col-span-9")}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium">Suggested load</div>
              {!suggestedOn && <div className="text-xs text-muted-foreground">Off. They log their own weight.</div>}
            </div>
            <Switch
              checked={suggestedOn}
              onCheckedChange={(on) => setLoadMode(on ? "manual" : "none")}
              aria-label="Suggested load"
              disabled={tracking !== "reps_weight" && !suggestedOn}
            />
          </div>
          {suggestedOn && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="w-full @md/row:w-auto">
                <div className="inline-flex w-full rounded-lg bg-muted p-0.5 @md/row:w-auto" role="group" aria-label="Load as">
                  <button type="button" aria-pressed={loadMode === "manual"} onClick={() => setLoadMode("manual")} className={cn("flex-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium", phone ? "h-9" : "h-7", loadMode === "manual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")} title="Fixed weight">Weight</button>
                  <button type="button" aria-pressed={loadMode === "pct"} onClick={() => setLoadMode("pct")} className={cn("flex-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium", phone ? "h-9" : "h-7", loadMode === "pct" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")} title="Percentage of max">% of max</button>
                </div>
              </div>
              {loadMode === "pct" && (
                <RowField className="min-w-[150px] flex-[2]" label="Of">
                  <Select value={row.percentage_basis ?? "manual"} onValueChange={(v) => setRow({ ...row, percentage_basis: v })}>
                    <SelectTrigger className={cn("font-medium", h, inputCls)}><SelectValue /></SelectTrigger>
                    <SelectContent>{PERCENTAGE_BASES.filter((p) => p.value !== "none" && p.value !== "manual").map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </RowField>
              )}
              {loadMode === "pct" && (
                <RowField className="w-20 shrink-0" label="%">
                  <RowCell dataField="percentage" className={cn("text-center font-semibold tabular-nums", h, inputCls)} inputMode="decimal" placeholder="75" value={row.percentage} onCommit={(v) => setRow({ ...row, percentage: parseFloatOrNull(v) })} />
                </RowField>
              )}
              <RowField className="min-w-[150px] flex-1" label={`Weight (${rowUnit})`}>
                <div className="flex gap-1">
                  <RowCell
                    dataField="load"
                    className={cn("flex-1 font-semibold tabular-nums", h, inputCls)}
                    inputMode="decimal"
                    placeholder={loadMode === "pct" ? "auto" : "weight"}
                    value={rowUnit === "kg" ? row.load_kg : row.load_lb}
                    onCommit={(v) => setRow({ ...row, [rowUnit === "kg" ? "load_kg" : "load_lb"]: parseFloatOrNull(v) })}
                  />
                  <Select value={rowUnit} onValueChange={(v) => setRow({ ...row, load_unit: v })}>
                    <SelectTrigger className={cn("w-[64px] px-2 font-medium", h, inputCls)} data-pb-field="unit" aria-label="Unit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kg">kg</SelectItem>
                      <SelectItem value="lb">lb</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </RowField>
            </div>
          )}
        </div>
        <RowField className={cn("col-span-12", loadMode === "none" ? "@xl/row:col-span-4" : "@xl/row:col-span-3")} label="Tempo">
          <RowCell dataField="tempo" className={cn("text-center font-semibold tabular-nums", h, inputCls)} placeholder="3-1-1" value={row.tempo} onCommit={(v) => setRow({ ...row, tempo: v ?? "" })} />
          <span className="px-0.5 text-[11px] leading-tight text-muted-foreground" title="Tempo: eccentric–pause–concentric (seconds). 3-1-1 = 3s down, 1s pause, 1s up.">
            Down, pause, up in seconds
          </span>
        </RowField>
      </div>
      )}
      {expanded && row.manual_override && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 font-medium text-warning">
            Weight set by hand
            {row.override_of_pct && <span className="text-muted-foreground">(was {row.override_of_pct}%)</span>}
          </span>
          <button type="button" onClick={clearOverride} className="min-h-8 px-1 text-xs text-muted-foreground underline hover:text-foreground">Use the % again</button>
        </div>
      )}
      {expanded && clientId && computed && computed.status !== "manual" && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {computed.status === "ok" && (
            <>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 tabular-nums text-foreground">
              <PbCalculator className="h-3.5 w-3.5 text-muted-foreground" />
              {row.percentage}% {computed.baseLabel} = <strong>{computed.load} {computed.unit}</strong>
              <span className="text-muted-foreground">(of {computed.base?.toFixed(1)})</span>
            </span>
            {!row.manual_override && (
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={overrideCalculated} title="Replace the calculated load with a fixed weight for this row only">
                Set it by hand
              </Button>
            )}
            </>
          )}
          {computed.status === "no-max" && (
            <>
              <span className="inline-flex items-center gap-1 text-warning">
                <PbAlertCircle className="h-3.5 w-3.5" /> No max on file for {exName || "this exercise"}
              </span>
              <Button
                size="sm" variant="outline" className="h-8 px-2 text-xs"
                onClick={() => setMaxEditor({
                  client_id: clientId, lift: exName, unit: "kg",
                  source: "manual", active: true, rounding_mode: "nearest", rounding_step: 2.5,
                  block_id: blockId ?? null,
                })}
              >
                <Plus className="mr-0.5 h-3.5 w-3.5" /> Set max
              </Button>
            </>
          )}
          {computed.status === "no-percentage" && (
            <span className="text-muted-foreground">Enter a % to work out the load</span>
          )}
          {computed.status === "needs-link" && (
            <span className="text-muted-foreground">Linked-row basis: set it on the row this references</span>
          )}
        </div>
      )}
      {/* ---- More: label, movement family, exercise type ---- */}
      <div>
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="-mx-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {moreOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          More{!moreOpen && (row.purpose_label || row.movement_family) ? <span className="text-foreground/70"> · set by hand</span> : null}
        </button>
        {moreOpen && (
          <div className="mt-1.5 grid gap-2 @xl/row:grid-cols-3">
            <RowField label="Label">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn("flex items-center justify-between gap-1 px-2.5 text-left font-medium", h, inputCls)}
                    title={row.purpose_label ? "Manual purpose label — click to change" : "Auto purpose label — click to override"}
                  >
                    <span className="truncate">{purposeLabelText(purposeLabel) || "Auto"}{!row.purpose_label && <span className="font-normal text-muted-foreground"> · auto</span>}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1.5" align="start">
                  <div className="grid gap-0.5">
                    <button
                      type="button"
                      onClick={() => setRow({ ...row, purpose_label: null })}
                      className={cn("rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", !row.purpose_label && "bg-muted font-medium")}
                    >
                      Auto (from position)
                    </button>
                    {PURPOSE_LABEL_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setRow({ ...row, purpose_label: opt })}
                        className={cn("rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", row.purpose_label === opt && "bg-muted font-medium")}
                      >
                        {purposeLabelText(opt)}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </RowField>
            <RowField label="Movement family">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn("flex items-center justify-between gap-1 px-2.5 text-left font-medium", h, inputCls)}
                    title={row.movement_family ? "Manual movement family — click to change" : "Auto movement family — click to override"}
                  >
                    <span className="truncate">
                      {(() => {
                        const map: Record<string, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift", upper: "Upper body", lower: "Lower body", other: "Other" };
                        return row.movement_family ? map[row.movement_family as string] ?? row.movement_family : <>Auto<span className="font-normal text-muted-foreground"> · from the exercise</span></>;
                      })()}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1.5" align="start">
                  <div className="grid gap-0.5">
                    <button
                      type="button"
                      onClick={() => setRow({ ...row, movement_family: null })}
                      className={cn("rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", !row.movement_family && "bg-muted font-medium")}
                    >
                      Auto (from exercise)
                    </button>
                    {([
                      ["squat", "Squat"],
                      ["bench", "Bench"],
                      ["deadlift", "Deadlift"],
                      ["upper", "Upper body"],
                      ["lower", "Lower body"],
                      ["other", "Other"],
                    ] as const).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setRow({ ...row, movement_family: val })}
                        className={cn("rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", row.movement_family === val && "bg-muted font-medium")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </RowField>
            <RowField label="Exercise type (rest and timing)">
              <Select value={row.time_profile ?? "accessory_compound"} onValueChange={(v) => setRow({ ...row, time_profile: v })}>
                <SelectTrigger className={cn("font-medium", h, inputCls)} title="Sets the automatic rest, the workout's length and the warm-up buffer. Inferred automatically; change it only when needed.">
                  <SelectValue>
                    {TIME_PROFILE_LABEL[row.time_profile ?? "accessory_compound"] ?? (row.time_profile ?? "Accessory compound")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>{TIME_PROFILES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </RowField>
          </div>
        )}
      </div>
      {phone && meetsMinimum && (
        // a phone has no "click away" to fold the card back into its row
        <Button
          variant="secondary"
          className="h-11 w-full"
          onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); cancelCollapse(); setCollapsed(true); }}
        >
          Done
        </Button>
      )}
      </>
      )}
      {maxEditor && (
        <MaxEditorDialog
          clientId={clientId!}
          value={maxEditor}
          existing={maxes}
          onClose={() => setMaxEditor(null)}
          onSaved={() => { setMaxEditor(null); refresh(); }}
        />
      )}
      {multiBlockFlag && row._dbId && (
        <ExerciseBlocksEditor
          open={blocksOpen}
          onOpenChange={setBlocksOpen}
          rowId={row._dbId}
          exerciseName={exName || "Exercise"}
        />
      )}
      <PhoneExercisePickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={row.exercise_id || row.exercise_name_override ? "Swap exercise" : "Pick an exercise"}
        description="Sets, reps, load, rest, tempo and notes stay as they are."
        exercises={exercises}
        excludeId={row.exercise_id}
        onPick={pickExercise}
        onCustomName={(name) => {
          setRow({ ...row, exercise_id: null, exercise_name_override: name || row.exercise_name_override || "" });
          openCard();
        }}
      />
    </div>
  );
}

/**
 * Non-blocking warning banner shown inside WeekEditor. Surfaces conflicts
 * derived from the current week's rows via one scheduled weekly priority map
 * — never modifies any row or blocks saving.
 */
function WeekPriorityWarnings({ week, exercises }: { week: any; exercises: any[] }) {
  const FAMILY_LABEL: Record<string, string> = {
    squat: "Squat", bench: "Bench", deadlift: "Deadlift",
    upper: "Upper", lower: "Lower", other: "Other",
  };
  const warnings = useMemo(() => {
    const primaryByFamily = new Map<string, number>();
    const labelsByFamily = new Map<string, Set<string>>();
    const missingLabelOnCompRows: number[] = [];
    // keyed by each row's place (builder rows carry no `id`)
    const labelsByDay = weekPurposeLabelsByDay((week?.days ?? []) as any[], exercises ?? []);
    ((week?.days ?? []) as any[]).forEach((d: any, di: number) => {
      const rows = (d?.rows ?? []) as any[];
      if (!rows.length) return;
      rows.forEach((r: any, ri: number) => {
        const label = labelsByDay[di]?.[ri] ?? "Assistance";
        const famRaw = String(r.movement_family ?? "").toLowerCase();
        const isCompFamily = famRaw === "squat" || famRaw === "bench" || famRaw === "deadlift";
        if (label && label !== "Assistance" && famRaw) {
          const set = labelsByFamily.get(famRaw) ?? new Set<string>();
          set.add(label);
          labelsByFamily.set(famRaw, set);
          if (label === "Primary") {
            primaryByFamily.set(famRaw, (primaryByFamily.get(famRaw) ?? 0) + 1);
          }
        }
        // Comp lift row with no auto or manual priority label at all
        if (isCompFamily && (!label || label === "Assistance") && !(r.purpose_label ?? "").trim()) {
          missingLabelOnCompRows.push(1);
        }
      });
    });
    const out: string[] = [];
    for (const [fam, count] of primaryByFamily) {
      if (count >= 2) {
        out.push(`Two Primary ${FAMILY_LABEL[fam] ?? fam} exposures this week. Keep both if intentional.`);
      }
    }
    for (const [fam, labels] of labelsByFamily) {
      const hasTertiaryOrQuat = labels.has("Tertiary") || labels.has("Quaternary");
      const hasPrimaryOrSecondary = labels.has("Primary") || labels.has("Secondary");
      if (hasTertiaryOrQuat && !hasPrimaryOrSecondary) {
        const which = labels.has("Tertiary") ? "Tertiary" : "Quaternary";
        out.push(`${which} ${FAMILY_LABEL[fam] ?? fam} exists without a Primary or Secondary ${FAMILY_LABEL[fam] ?? fam} this week.`);
      }
    }
    if (missingLabelOnCompRows.length) {
      out.push(`${missingLabelOnCompRows.length === 1 ? "1 competition lift row" : `${missingLabelOnCompRows.length} competition lift rows`} without a priority label.`);
    }
    return out;
  }, [week, exercises]);
  if (!warnings.length) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
      <div className="mb-1 flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" />
        Priority checks
      </div>
      <ul className="ml-4 list-disc space-y-0.5">
        {warnings.map((w, i) => (<li key={i}>{w}</li>))}
      </ul>
    </div>
  );
}