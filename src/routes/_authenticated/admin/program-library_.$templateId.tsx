import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, ArrowLeft, Plus, Trash2, Save, Clock, Copy, LayoutGrid, CalendarRange, ArrowRight, ZoomIn, ZoomOut, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Rows3, ChevronDown, ChevronUp, Settings2, Undo2, Redo2, ClipboardCopy, ClipboardPaste, Expand, RotateCcw, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import {
  getTemplate, updateTemplate, summarizeTemplatePayload, TIME_PROFILES,
  estimateDayMinutes, durationRange, PERCENTAGE_BASES, type TrainingStyle,
} from "@/lib/pl-programs";
import { ExerciseLibraryPanel, type ExerciseRef, DND_EXERCISE, readDrop, exerciseAccent, EXERCISE_CARD_COLORS, HighlightedText, usePbDragging, beginPbDrag, endPbDrag } from "@/components/program-builder";
import { derivePurposeLabels, defaultRestSeconds, effectiveRestSeconds, PURPOSE_LABEL_OPTIONS, resolveCategory, purposeLabelBadgeClass } from "@/lib/exercise-metadata";
import { ProgramBuilderShortcutsButton } from "@/components/program-builder-shortcuts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Palette } from "lucide-react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";
import { useConflictWatch } from "@/hooks/use-conflict-watch";
import { usePersistentUndoStack } from "@/lib/persistent-undo";
import { useScrollRestoration } from "@/lib/scroll-restore";
import { TemplateBuilderIdentityBadge } from "@/components/builder-identity-header";
import { ActionButton } from "@/components/action-button";
import { copyRows, useClip } from "@/lib/program-builder-clipboard";
import { ExerciseBlocksEditor } from "@/components/exercise-blocks-editor";
import { useMultiBlockBuilderFlag } from "@/lib/admin-flags";
import { Layers } from "lucide-react";
import { createContext, useContext } from "react";
import { listClientMaxes, buildMaxIndex, computeRowLoad, type ClientMaxRow } from "@/lib/pl-maxes";
import { MaxEditorDialog } from "@/components/client-maxes-panel";
import { BlockMaxesButton } from "@/components/block-maxes-panel";
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
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
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
      focusField(next);
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
        if (col) { e.preventDefault(); focusField(col); return true; }
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
    const peer = nextRow.querySelector<HTMLElement>(`[data-pb-field="${fieldName}"]`)
      ?? fieldsInRow(nextRow)[Math.min(idx, fieldsInRow(nextRow).length - 1)];
    if (peer) { e.preventDefault(); focusField(peer); return true; }
    return false;
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

export const Route = createFileRoute("/_authenticated/admin/program-library_/$templateId")({
  component: TemplateEditor,
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s.block === "string" ? (s.block as string) : undefined,
  }),
});

const STYLES: TrainingStyle[] = ["powerlifting", "bodybuilding", "strength", "lifestyle", "hybrid", "rehab", "conditioning", "custom"];

function TemplateEditor() {
  const { templateId } = Route.useParams();
  const search = useSearch({ strict: false }) as { block?: string };
  const qc = useQueryClient();

  const { data: tpl, isLoading } = useQuery({
    queryKey: ["pl-template", templateId],
    queryFn: () => getTemplate(templateId),
  });
  const { data: exercises = [] } = useQuery({
    queryKey: ["exercises-min"],
    queryFn: async () =>
      (await supabase
        .from("exercises")
        .select("id, name, muscle_group, category, tags, exercise_category, is_competition_lift, competition_lift_type")
        .order("name")).data ?? [],
  });

  // local working state
  const [meta, setMeta] = useState<any>(null);
  const [payload, setPayload] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);

  // ---- Undo / Redo history for payload ----
  const lastPushTs = useRef(0);
  // Durable per-template undo/redo. The server's `updated_at` is the
  // baseline marker — if the template was saved elsewhere since the last
  // visit, stored history is dropped (we never replay stale ops onto a
  // newer payload). See src/lib/persistent-undo.ts.
  const undoStack = usePersistentUndoStack({
    scope: `tpl:${templateId}`,
    baseline: (tpl as any)?.updated_at ?? null,
    enabled: hydratedRef.current,
  });
  const canUndo = undoStack.canUndo;
  const canRedo = undoStack.canRedo;

  useEffect(() => {
    if (tpl && !meta) {
      setMeta({
        name: tpl.name, training_style: tpl.training_style, training_focus: tpl.training_focus ?? "",
        notes: tpl.notes ?? "", weeks: tpl.weeks ?? 0, days_per_week: tpl.days_per_week ?? 0,
        est_duration_min: tpl.est_duration_min ?? 0, tags: (tpl.tags ?? []).join(", "), status: tpl.status,
      });
      setPayload(JSON.parse(JSON.stringify(tpl.payload || {})));
      hydratedRef.current = true;
    }
  }, [tpl]);

  const setM = (patch: any) => { setMeta({ ...meta, ...patch }); setDirty(true); };
  const setP = (next: any, opts?: { skipHistory?: boolean }) => {
    if (!opts?.skipHistory && payload != null) {
      const now = Date.now();
      // Coalesce rapid edits (e.g. typing) within 600ms into a single history step.
      if (now - lastPushTs.current > 600) {
        undoStack.pushSnapshot(JSON.stringify(payload));
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
      payload: p,
    });
    qc.invalidateQueries({ queryKey: ["pl-template", templateId] });
    qc.invalidateQueries({ queryKey: ["pl-templates"] });
    setDirty(false);
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

  // Cross-coach conflict watcher for the template meta fields.
  const remoteMeta = useMemo(() => tpl ? {
    name: tpl.name, training_style: tpl.training_style, training_focus: tpl.training_focus ?? "",
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
      await autosave.flush();
      await persist(meta, payload);
    } finally { setSaving(false); }
  };

  if (isLoading || !tpl || !meta || !payload) return <div className="p-8 text-sm text-muted-foreground">Loading template…</div>;

  const summary = summarizeTemplatePayload({ ...tpl, payload });
  const type = tpl.template_type;

  return (
    <EditorChrome
      meta={meta} summary={summary} typeLabel={type.replace("_", " ")}
      autosave={autosave} save={save} dirty={dirty}
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
      <Tabs defaultValue="structure">
        <TabsList className="h-8">
          <TabsTrigger value="structure" className="h-7 text-xs px-2"><Rows3 className="mr-1 h-3 w-3" />Structure</TabsTrigger>
          <TabsTrigger value="meta" className="h-7 text-xs px-2"><Settings2 className="mr-1 h-3 w-3" />Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="meta" className="mt-2">
          <Card className="p-4 space-y-3 max-w-2xl">
              <div><Label>Name</Label><Input value={meta.name} onChange={(e) => setM({ name: e.target.value })} /></div>
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
        </TabsContent>

        <TabsContent value="structure" className="mt-2">
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
          />
        </TabsContent>
      </Tabs>
    </EditorChrome>
  );
}

function EditorChrome({ meta, summary, typeLabel, autosave, save, dirty, children }: {
  meta: any; summary: any; typeLabel: string;
  autosave: any; save: () => Promise<void>; dirty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 p-2 md:p-3">
      <div className="sticky top-0 z-30 -mx-2 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur md:-mx-3 md:px-3">
        <Link to="/admin/program-library" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <TemplateBuilderIdentityBadge templateName={meta.name || "Template"} />
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="truncate text-sm font-bold">{meta.name || "Template"}</span>
          <span className="hidden md:inline text-[11px] text-muted-foreground whitespace-nowrap">
            {typeLabel} · {summary.weeks}w · {summary.days}d · {summary.rows} rows
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SaveStatus state={autosave.state} savedAt={autosave.savedAt} />
          <ActionButton
            onAction={save}
            loadingLabel="Saving…"
            successLabel="Saved"
            successToast="Template saved"
            icon={<Save className="h-3.5 w-3.5" />}
            size="sm"
            className="h-7 text-xs"
          >
            {dirty ? "Save now" : "Saved"}
          </ActionButton>
        </div>
      </div>
      {children}
    </div>
  );
}

export function StructureCanvas({ type, payload, setP, exercises, appendRowToFirstDay, undo, redo, canUndo, canRedo, clientId, blockId, toolbarExtras, templateId }: {
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
}) {
  const [prefs, setPrefsState] = useState<EditorPrefs>(() => readPrefs());
  const setPrefs = (patch: Partial<EditorPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefsState(next);
    writePrefs(next);
  };
  const { compact, zoom, sidebarCollapsed } = prefs;
  const [fullscreen, setFullscreen] = useState(false);
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

  return (
    <MaxesContext.Provider value={maxesCtx}>
    <div
      className={cn(
        "rounded-md border border-border bg-background",
        fullscreen && "fixed inset-0 z-[60] rounded-none border-0",
      )}
    >
      {/* Sticky compact toolbar */}
      <div
        className={cn(
          "z-20 flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur",
          fullscreen ? "sticky top-0" : "sticky top-[42px]",
        )}
      >
        <Button size="icon" variant="ghost" className="h-7 w-7" title={sidebarCollapsed ? "Show library" : "Hide library"} onClick={() => setPrefs({ sidebarCollapsed: !sidebarCollapsed })}>
          {sidebarCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </Button>
        <div className="h-5 w-px bg-border" />
        <div className="inline-flex items-center gap-0.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canUndo} title="Undo (Cmd/Ctrl+Z)" onClick={undo}>
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canRedo} title="Redo (Cmd/Ctrl+Shift+Z)" onClick={redo}>
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="h-5 w-px bg-border" />
        <button
          onClick={() => setPrefs({ compact: !compact })}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition",
            compact
              ? "border-green-600 bg-green-600 text-white hover:bg-green-700 hover:border-green-700"
              : "border-red-500 bg-red-500 text-white hover:bg-red-600 hover:border-red-600"
          )}
          title="Toggle compact mode"
        >
          <Rows3 className="h-3 w-3" /> {compact ? "Compact On" : "Compact Off"}
        </button>
        <div className="h-5 w-px bg-border" />
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <Button size="icon" variant="ghost" className="h-6 w-6" title="Zoom out" onClick={() => setZoom(zoom - 0.05)}>
            <ZoomOut className="h-3 w-3" />
          </Button>
          <span className="min-w-[34px] text-center text-[10px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button size="icon" variant="ghost" className="h-6 w-6" title="Zoom in" onClick={() => setZoom(zoom + 0.05)}>
            <ZoomIn className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" title="Reset to 100%" onClick={() => setZoom(1)}>
            <span className="text-[9px] font-bold">1:1</span>
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" title="Fit to screen" onClick={fitToScreen}>
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
        <div className="ml-auto inline-flex items-center gap-1.5">
          <Button
            size="sm"
            variant={fullscreen ? "default" : "outline"}
            className="h-7 gap-1 text-[11px] font-semibold"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? "Exit full screen (Esc)" : "Open full screen editor (Shift+.)"}
          >
            {fullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" /> Exit Full Screen
              </>
            ) : (
              <>
                <Expand className="h-3.5 w-3.5" /> Full Screen Mode
              </>
            )}
          </Button>
          <BlockMaxesButton clientId={clientId ?? null} blockId={blockId ?? null} />
          {toolbarExtras}
          <ProgramBuilderShortcutsButton />
        </div>
      </div>

      <div className={cn("flex gap-0 overflow-hidden", fullscreen ? "h-[calc(100vh-46px)]" : "h-[calc(100vh-150px)]")}>
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
        <div className="flex-1 overflow-auto" ref={canvasRef}>
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              width: `${100 / zoom}%`,
              minHeight: `${100 / zoom}%`,
            }}
            className="pl-1 pr-2 py-2"
          >
            <StructureEditor type={type} payload={payload} setPayload={setP} exercises={exercises as any[]} compact={compact} templateId={templateId} />
          </div>
        </div>
      </div>
    </div>
    </MaxesContext.Provider>
  );
}

// ---------- Structure editing for the JSON payload ----------

function StructureEditor({ type, payload, setPayload, exercises, compact, templateId }: { type: string; payload: any; setPayload: (p: any) => void; exercises: any[]; compact?: boolean; templateId?: string }) {
  if (type === "full_prep" || type === "block") {
    return <MultiBlockStructureEditor type={type} payload={payload} setPayload={setPayload} exercises={exercises} compact={compact} templateId={templateId} />;
  }
  if (type === "week") return <WeekEditor week={payload} setWeek={setPayload} exercises={exercises} compact={compact} />;
  if (type === "day") return <DayEditor day={payload} setDay={setPayload} exercises={exercises} compact={compact} />;
  return (
    <Card className="p-4 max-w-3xl">
      <RowEditor row={payload} setRow={setPayload} exercises={exercises} compact={compact} />
    </Card>
  );
}

// ---------- Multi-block (v2 payload) structure editor -----------------------
function MultiBlockStructureEditor({ type, payload, setPayload, exercises, compact, templateId }: {
  type: "block" | "full_prep" | string;
  payload: any;
  setPayload: (p: any) => void;
  exercises: any[];
  compact?: boolean;
  templateId?: string;
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
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Prep details</div>
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
      <Card className="flex flex-wrap items-center gap-3 p-2 text-xs">
        <span className="font-bold uppercase tracking-wide text-muted-foreground">Program</span>
        <span>{active.length} active block{active.length === 1 ? "" : "s"}</span>
        {archived.length > 0 && <span className="text-muted-foreground">· {archived.length} archived</span>}
        {trashed.length > 0 && <span className="text-muted-foreground">· {trashed.length} in trash</span>}
        <span className="ml-auto" />
        <Button size="sm" variant="outline" className="h-7" onClick={handleAddBlock} disabled={inRecovery}>
          <Plus className="mr-1 h-3 w-3" /> Add block
        </Button>
      </Card>

      {/* Block tab strip */}
      <div className="flex flex-wrap items-center gap-1">
        {active.map((b) => {
          const isActive = b.id === activeBlockId;
          return (
            <div key={b.id} className={cn(
              "group inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
              isActive ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}>
              <button type="button" className="font-semibold" onClick={() => setActive(b.id)} title={`${b.weeks.length} weeks`}>
                {b.name}
              </button>
              {(b.phase || b.training_focus) && (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {b.phase || b.training_focus}
                </span>
              )}
              <span className="text-[10px] opacity-70">·{b.weeks.length}w</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="ml-1 opacity-60 hover:opacity-100" aria-label="Block menu"><Settings2 className="h-3 w-3" /></button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2 text-xs">
                  <div className="space-y-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 flex-1 text-[11px]" onClick={() => handleRename(b.id)}><Pencil className="mr-1 h-3 w-3" />Rename</Button>
                      <Button size="sm" variant="ghost" className="h-6 flex-1 text-[11px]" onClick={() => handleDuplicate(b.id)}><Copy className="mr-1 h-3 w-3" />Duplicate</Button>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 flex-1 text-[11px]" onClick={() => handleMove(b.id, -1)}>← Move left</Button>
                      <Button size="sm" variant="ghost" className="h-6 flex-1 text-[11px]" onClick={() => handleMove(b.id, 1)}>Move right →</Button>
                    </div>
                    <div>
                      <Label className="text-[10px]">Phase</Label>
                      <Select value={b.phase ?? "__none"} onValueChange={(v) => handleUpdatePhase(b.id, v === "__none" ? null : v)}>
                        <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Optional phase" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">— None —</SelectItem>
                          {BLOCK_PHASE_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Est minutes / workout</Label>
                      <Input
                        type="number" inputMode="numeric"
                        className="h-7 text-[11px]"
                        value={b.estimated_minutes ?? ""}
                        onChange={(e) => handleUpdateEst(b.id, parseInt(e.target.value) || null)}
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Notes</Label>
                      <Textarea rows={2} className="text-[11px]" value={b.notes} onChange={(e) => handleUpdateNotes(b.id, e.target.value)} />
                    </div>
                    <div className="flex gap-1 border-t border-border pt-1">
                      <Button size="sm" variant="ghost" className="h-6 flex-1 text-[11px]" onClick={() => handleArchive(b.id)}><ArchiveIcon className="mr-1 h-3 w-3" />Archive</Button>
                      <Button size="sm" variant="ghost" className="h-6 flex-1 text-[11px] text-destructive" onClick={() => handleTrash(b.id)}><Trash2 className="mr-1 h-3 w-3" />Trash</Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          );
        })}
        {active.length === 0 && (
          <span className="text-xs text-muted-foreground">No active blocks. Click "Add block" to start.</span>
        )}
      </div>

      {(archived.length > 0 || trashed.length > 0) && (
        <details className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Archived & Trash ({archived.length + trashed.length})</summary>
          <div className="mt-2 space-y-1">
            {archived.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <ArchiveIcon className="h-3 w-3" />
                <span className="flex-1 truncate">{b.name}</span>
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => handleRestore(b.id)}><ArchiveRestore className="mr-1 h-3 w-3" />Restore</Button>
                <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => handleTrash(b.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
            {trashed.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <Trash2 className="h-3 w-3" />
                <span className="flex-1 truncate line-through">{b.name}</span>
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => handleRestoreTrash(b.id)}><ArchiveRestore className="mr-1 h-3 w-3" />Restore</Button>
                <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => handlePurge(b.id)}>Delete forever</Button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Active block weeks editor */}
      {activeBlock ? (
        <div className="rounded-md border border-border p-2">
          <BlockPayloadEditor
            key={activeBlock.id}
            weeksData={activeBlock.weeks}
            setWeeksData={setActiveBlockWeeks}
            exercises={exercises}
            compact={compact}
          />
        </div>
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Add a block to start building this program.
        </Card>
      )}
    </div>
  );
}

export function BlockPayloadEditor({ weeksData, setWeeksData, exercises, compact }: { weeksData: any[]; setWeeksData: (wd: any[]) => void; exercises: any[]; compact?: boolean }) {
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
  const [view, _setView] = useState<"block" | "week">(initialPos.view);
  const writePos = (next: { view: "block" | "week"; activeIdx: number }) => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(POS_KEY, JSON.stringify(next)); } catch {}
  };
  const setActiveIdx = (idx: number) => { _setActiveIdx(idx); writePos({ view, activeIdx: idx }); };
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
  const weekHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const weekCardsScrollRef = useRef<HTMLDivElement | null>(null);
  const weekColumnWidthClass = compact
    ? "w-[88vw] max-w-[520px] sm:w-[440px] lg:w-[480px] xl:w-[520px]"
    : "w-[94vw] max-w-[720px] sm:w-[600px] lg:w-[640px] xl:w-[700px]";
  const syncWeekScroll = (source: "header" | "cards") => (e: React.UIEvent<HTMLDivElement>) => {
    const other = source === "header" ? weekCardsScrollRef.current : weekHeaderScrollRef.current;
    if (!other) return;
    const left = e.currentTarget.scrollLeft;
    if (Math.abs(other.scrollLeft - left) > 1) other.scrollLeft = left;
  };
  const addWeek = () => {
    const nextIdx = (weeksData[weeksData.length - 1]?.week_index ?? 0) + 1;
    setWeeksData([...weeksData, { week_index: nextIdx, days: [{ day_index: 1, title: "Day 1", rows: [] }] }]);
    setActiveIdx(weeksData.length);
  };
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
  const copyWeek1ToAll = () => {
    if (weeksData.length < 2) return;
    copyWeekToFuture(0);
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
  return (
    <div className="space-y-2">
      <div className="sticky top-0 z-20 -mx-2 mb-2 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-2 py-2 backdrop-blur">
        <div className="inline-flex rounded-md border border-border p-0.5">
          <button onClick={() => setView("block")} className={cn("inline-flex items-center gap-1 rounded px-2 py-1 text-xs", view === "block" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <LayoutGrid className="h-3 w-3" /> Full Block
          </button>
          <button onClick={() => setView("week")} className={cn("inline-flex items-center gap-1 rounded px-2 py-1 text-xs", view === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <CalendarRange className="h-3 w-3" /> Weekly
          </button>
        </div>
        {/* Active editing context — always visible while scrolling deep into a week */}
        {view === "week" && weeksData[activeIdx] && (() => {
          const aw = weeksData[activeIdx];
          const s = weekStats[activeIdx] ?? { days: 0, rows: 0, minutes: 0 };
          return (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[11px] text-foreground">
              <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                Editing · Week {aw.week_index}
              </span>
              <span className="text-muted-foreground">
                {s.days}d · {s.rows} rows · Est {fmtDur(s.minutes)}
              </span>
              {aw.notes ? (
                <span className="hidden md:inline max-w-[220px] truncate italic text-muted-foreground" title={aw.notes}>
                  “{aw.notes}”
                </span>
              ) : null}
            </div>
          );
        })()}
        {view === "block" && weeksData.length > 1 && (
          <Button size="sm" variant="outline" onClick={copyWeek1ToAll}>
            <Copy className="mr-1 h-3 w-3" /> Copy Week 1 → all weeks
          </Button>
        )}
        {view === "week" && weeksData[activeIdx] && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => copyWeekToFuture(activeIdx)}
            title="Copy this week's prescriptions into every later week"
          >
            <ArrowRight className="mr-1 h-3 w-3" /> Apply → future
          </Button>
        )}
        <BlockMaxesButton clientId={ctxClientId} blockId={ctxBlockId} />
        <Button size="sm" variant="ghost" className="ml-auto" onClick={addWeek}>
          <Plus className="mr-1 h-3 w-3" /> Add week
        </Button>
      </div>

      {view === "week" ? (
        <>
          <div className="-mx-2 overflow-x-auto px-2 pb-2">
            <div className="flex w-max items-center gap-1">
              {weeksData.map((w: any, i: number) => (
                <button key={i} onClick={() => setActiveIdx(i)} className={`h-8 w-[112px] shrink-0 rounded-md border px-2 py-1 text-xs ${activeIdx === i ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                  Week {w.week_index}{w.phase ? ` · ${w.phase}` : ""}
                </button>
              ))}
              {weeksData[activeIdx] && (
                <div className="ml-1 flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => dupWeek(activeIdx)} title="Duplicate week"><Copy className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => copyWeekToFuture(activeIdx)} title="Copy week → future weeks"><ArrowRight className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => delWeek(activeIdx)} title="Delete week"><Trash2 className="h-3 w-3" /></Button>
                </div>
              )}
            </div>
          </div>
          {weeksData[activeIdx] && (
            <WeekEditor
              week={weeksData[activeIdx]}
              setWeek={(w) => { const copy = [...weeksData]; copy[activeIdx] = w; setWeeksData(copy); }}
              exercises={exercises}
              onCopyDayToFuture={(di) => copyDayToFuture(activeIdx, di)}
              compact={compact}
            />
          )}
        </>
      ) : (
        <div className="space-y-3">
          {weeksData.length > 0 && (
            <div
              ref={weekHeaderScrollRef}
              onScroll={syncWeekScroll("header")}
              className={cn(
                "sticky top-10 z-20 -mx-2 overflow-x-auto border-b border-primary/20 bg-[color-mix(in_oklab,var(--primary)_6%,var(--background))] px-3 py-2 shadow-sm backdrop-blur scroll-smooth",
                "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              )}
            >
              <div className={cn("flex w-max items-stretch", compact ? "gap-2" : "gap-3")}>
                {weeksData.map((w: any, i: number) => {
                  const s = weekStats[i] ?? { days: 0, rows: 0, minutes: 0 };
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setActiveIdx(i);
                        document.getElementById(`tpl-week-${i}`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
                      }}
                      className={cn(
                        "grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left shadow-sm hover:border-primary/60",
                        weekColumnWidthClass,
                        activeIdx === i && "border-primary bg-primary/10",
                      )}
                    >
                      <span className="min-w-0 truncate text-xs font-bold uppercase tracking-wide text-primary">Week {w.week_index}</span>
                      {w.phase && (
                        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          {w.phase}
                        </span>
                      )}
                      <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
                        {s.days}d · {s.rows} rows · {fmtDur(s.minutes)}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={addWeek}
                  className={cn("shrink-0 rounded-md border border-dashed border-primary/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-primary hover:bg-primary/10", compact ? "w-[200px]" : "w-[260px]")}
                >
                  Add Week
                </button>
              </div>
            </div>
          )}
          {weeksData.length === 0 && (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No weeks yet. Click <em>Add week</em> to start.
            </p>
          )}
          <div
            ref={weekCardsScrollRef}
            onScroll={syncWeekScroll("cards")}
            className={cn(
            "snap-x snap-proximity overflow-x-auto overflow-y-visible pb-3 scroll-smooth",
            compact ? "px-2 scroll-pl-2" : "px-3 scroll-pl-3",
          )}>
            <div className={cn("flex w-max items-start", compact ? "gap-2" : "gap-3")}>
              {weeksData.map((w: any, wi: number) => {
                const s = weekStats[wi] ?? { days: 0, rows: 0, minutes: 0 };
                return (
                  <Card
                    key={wi}
                    id={`tpl-week-${wi}`}
                    className={cn(
                      "shrink-0 snap-start border-2 border-border p-0",
                      weekColumnWidthClass,
                    )}
                    style={{ borderLeftWidth: 6, borderLeftColor: "var(--primary)" }}
                  >
                    <div className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-primary/20 bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))] shadow-sm sm:grid-cols-[auto_auto_minmax(120px,1fr)_auto]",
                      compact ? "px-2 py-1" : "px-3 py-2",
                    )}>
                      <span className={cn("inline-flex shrink-0 items-center rounded-md bg-primary px-2 text-[10px] font-bold uppercase tracking-wide text-primary-foreground", compact ? "h-5" : "h-6 text-[11px]")}> 
                        Week {w.week_index}
                      </span>
                      <span className={cn("min-w-0 truncate text-muted-foreground max-sm:col-span-2", compact ? "text-[10px]" : "text-[11px]")}> 
                        {s.days} day{s.days === 1 ? "" : "s"} · {s.rows} row{s.rows === 1 ? "" : "s"} · Est {fmtDur(s.minutes)}
                      </span>
                      <div className={cn("flex min-w-0 items-center gap-1 max-sm:col-span-2")}>
                        <Select
                          value={w.phase || "__none"}
                          onValueChange={(v) => { const c = [...weeksData]; c[wi] = { ...w, phase: v === "__none" ? null : v }; setWeeksData(c); }}
                        >
                          <SelectTrigger className={cn("w-[130px] shrink-0 text-[11px]", compact ? "h-6" : "h-7")}>
                            <SelectValue placeholder="Week label" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">No label</SelectItem>
                            {BLOCK_PHASE_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input
                          className={cn("min-w-0 border-0 bg-transparent text-xs focus-visible:ring-1", compact ? "h-6" : "h-7")}
                          placeholder="Week notes"
                          value={w.notes ?? ""}
                          onChange={(e) => { const c = [...weeksData]; c[wi] = { ...w, notes: e.target.value }; setWeeksData(c); }}
                        />
                      </div>
                      <div className="col-start-2 row-start-1 flex shrink-0 gap-1 sm:col-start-auto sm:row-start-auto">
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => copyWeekToFuture(wi)} title="Copy week → all future weeks">
                          <Copy className="mr-1 h-3 w-3" /> → future
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => dupWeek(wi)} title="Duplicate week"><Copy className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => delWeek(wi)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className={cn("bg-[color-mix(in_oklab,var(--primary)_2%,transparent)]", compact ? "p-2" : "p-3")}>
                      <WeekEditor
                        week={w}
                        setWeek={(nw) => { const c = [...weeksData]; c[wi] = nw; setWeeksData(c); }}
                        exercises={exercises}
                        onCopyDayToFuture={(di) => copyDayToFuture(wi, di)}
                        compact={compact}
                        hideHeader
                      />
                    </div>
                  </Card>
                );
              })}
              {/* Trailing add-week tile */}
              <button
                type="button"
                onClick={addWeek}
                className={cn(
                  "flex shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary/40 bg-primary/5 text-primary hover:bg-primary/10",
                  compact ? "h-[140px] w-[200px]" : "h-[200px] w-[260px]",
                )}
              >
                <Plus className="h-6 w-6" />
                <span className="text-sm font-bold uppercase tracking-wide">Add Week</span>
              </button>
              {/* Trailing spacer so the last week / Add Week tile can snap to the left edge */}
              <div aria-hidden className="shrink-0 w-[80vw]" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WeekEditor({ week, setWeek, exercises, onCopyDayToFuture, hideHeader, compact }: { week: any; setWeek: (w: any) => void; exercises: any[]; onCopyDayToFuture?: (dayIdx: number) => void; hideHeader?: boolean; compact?: boolean }) {
  const days = week.days || [];
  const addDay = () => {
    const nextIdx = (days[days.length - 1]?.day_index ?? 0) + 1;
    setWeek({ ...week, days: [...days, { day_index: nextIdx, title: `Day ${nextIdx}`, rows: [] }] });
  };
  const dupDay = (i: number) => {
    const copy = JSON.parse(JSON.stringify(days[i]));
    copy.day_index = (days[days.length - 1]?.day_index ?? 0) + 1;
    copy.title = `${copy.title || `Day ${copy.day_index}`} (copy)`;
    setWeek({ ...week, days: [...days, copy] });
  };
  const delDay = (i: number) => { if (!confirm("Remove day?")) return; setWeek({ ...week, days: days.filter((_: any, j: number) => j !== i) }); };
  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div className="flex items-center gap-2">
          <Input className="max-w-xs" placeholder="Week notes" value={week.notes ?? ""} onChange={(e) => setWeek({ ...week, notes: e.target.value })} />
          <Button size="sm" variant="outline" onClick={addDay}><Plus className="mr-1 h-3 w-3" /> Day</Button>
        </div>
      )}
      {hideHeader && days.length === 0 && (
        <Button size="sm" variant="outline" onClick={addDay}><Plus className="mr-1 h-3 w-3" /> Day</Button>
      )}
      <WeeklyVolumeSummary week={week} exercises={exercises as any} weekIndex={week?.week_index} />
      {days.map((d: any, i: number) => {
        const dayMinutes = estimateDayMinutes(d.rows || []);
        return (
        <Card key={i} className={cn("border-l-[3px] border-l-primary/40", compact ? "p-2" : "p-3")}>
          <div className={cn("flex items-center gap-2", compact ? "mb-1" : "mb-2")}>
            <Input className={cn("max-w-xs font-bold", compact && "h-7 text-xs")} value={d.title ?? ""} onChange={(e) => { const copy = [...days]; copy[i] = { ...d, title: e.target.value }; setWeek({ ...week, days: copy }); }} />
            <Input className={cn("max-w-xs", compact && "h-7 text-xs")} placeholder="Focus" value={d.focus ?? ""} onChange={(e) => { const copy = [...days]; copy[i] = { ...d, focus: e.target.value }; setWeek({ ...week, days: copy }); }} />
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
              <Clock className="h-3 w-3" /> {durationRange(dayMinutes)}
            </span>
            <div className="ml-auto flex gap-0.5">
              {onCopyDayToFuture && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => onCopyDayToFuture(i)} title="Copy this day → same day in future weeks">
                  <ArrowRight className="mr-1 h-3 w-3" /> → future
                </Button>
              )}
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => dupDay(i)} title="Duplicate"><Copy className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => delDay(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          <DayEditor day={d} setDay={(nd) => { const copy = [...days]; copy[i] = nd; setWeek({ ...week, days: copy }); }} exercises={exercises} compact={compact} />
        </Card>
      )})}
      {hideHeader && days.length > 0 && (
        <Button size="sm" variant="ghost" onClick={addDay}><Plus className="mr-1 h-3 w-3" /> Day</Button>
      )}
    </div>
  );
}

function DayEditor({ day, setDay, exercises, compact }: { day: any; setDay: (d: any) => void; exercises: any[]; compact?: boolean }) {
  const rows = day.rows || [];
  // Derive ordered purpose labels (Primary / Secondary / Tertiary / Quaternary
  // for competition + variation rows; Assistance for everything else). Manual
  // `purpose_label` on a row wins. Recomputes whenever rows are reordered.
  const purposeLabels = useMemo(() => {
    const exById = new Map<string, any>((exercises as any[]).map((e) => [e.id, e]));
    return derivePurposeLabels(rows, (r: any) => (r.exercise_id ? exById.get(r.exercise_id) : null));
  }, [rows, exercises]);
  const [dragOver, setDragOver] = useState(false);
  const [dragRowIdx, setDragRowIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
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
    // Default: NO suggested load. Coach opts in explicitly per row.
    // Prescription fields stay empty. Rest auto-fills from exercise category.
    const newRow = {
      sort_order: 0,
      time_profile: "accessory_compound",
      percentage_basis: "none",
      exercise_id: exId,
      exercise_name_override: ex?.name,
      rest_seconds: defaultRestSeconds(ex as any),
    };
    const next = [...rows];
    const idx = atIndex ?? next.length;
    next.splice(idx, 0, newRow);
    setDay({ ...day, rows: next.map((r: any, i: number) => ({ ...r, sort_order: i })) });
  };
  const dayMin = useMemo(() => estimateDayMinutes(rows), [rows]);

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
      className={cn(
        "space-y-3 rounded-lg bg-builder-canvas p-3 sm:p-4 ring-1 ring-builder-card-border/40 transition-colors",
        dragOver && "ring-2 ring-primary ring-offset-1 ring-offset-background bg-primary/5",
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
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Est {durationRange(dayMin)}</span>
        <div className="flex items-center gap-1">
          {clip && clip.kind === "rows" && clip.rows.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={pasteFromClip} title={`Paste ${clip.rows.length} exercise${clip.rows.length === 1 ? "" : "s"}`}>
              <ClipboardPaste className="mr-1 h-3 w-3" /> Paste ({clip.rows.length})
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={addRow}><Plus className="mr-1 h-3 w-3" /> Row</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-builder-card-border p-4 text-center text-xs text-muted-foreground">
          {dragOver ? "Drop exercise here" : "Drag exercises from the library, or click + Row"}
        </p>
      ) : (
        <div className="space-y-3" data-pb-day>
          {rows.map((r: any, i: number) => (
            <Fragment key={i}>
              <InlineAddExerciseButton
                exercises={exercises}
                onPick={(exId: string) => insertExercise(exId, i)}
                label={i === 0 ? "Add exercise at the start" : "Insert exercise here"}
              />
            <div
              draggable
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
              }}
              onDragEnd={() => { setDragRowIdx(null); setDropTargetIdx(null); }}
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
              }}
              className={cn(
                "cursor-grab active:cursor-grabbing",
                dropTargetIdx === i && "border-t-2 border-t-primary",
                dropTargetIdx === i + 1 && "border-b-2 border-b-primary",
              )}
            >
              <RowEditor
                row={r}
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
                }}
                onDragEndRow={() => { setDragRowIdx(null); setDropTargetIdx(null); }}
                isDragging={dragRowIdx === i}
                exercises={exercises}
                compact={compact !== false}
                purposeLabel={purposeLabels[i]}
              />
            </div>
            </Fragment>
          ))}
          <InlineAddExerciseButton
            exercises={exercises}
            onPick={(exId: string) => insertExercise(exId, rows.length)}
            label="Add exercise at the end"
          />
        </div>
      )}
      <Textarea className={cn("mt-2", compact && "text-xs")} placeholder="Day notes" value={day.notes ?? ""} onChange={(e) => setDay({ ...day, notes: e.target.value })} rows={compact ? 1 : 2} />
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
}: {
  exercises: any[];
  onPick: (exerciseId: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = exercises as any[];
    if (!term) return list.slice(0, 100);
    return list
      .filter((e) => {
        const hay = [e.name, e.muscle_group, e.category, ...(e.tags ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(term);
      })
      .slice(0, 200);
  }, [exercises, q]);

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
          className={cn(
            "group/insert relative -my-1.5 flex h-3 w-full items-center justify-center",
            "opacity-40 transition-opacity hover:opacity-100 focus:opacity-100",
          )}
        >
          <span
            aria-hidden
            className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/60 group-hover/insert:bg-primary/50"
          />
          <span
            className={cn(
              "relative z-10 inline-flex h-5 w-5 items-center justify-center rounded-full",
              "border border-border bg-background text-muted-foreground shadow-sm",
              "group-hover/insert:border-primary group-hover/insert:bg-primary group-hover/insert:text-primary-foreground",
            )}
          >
            <Plus className="h-3 w-3" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-2"
        align="center"
        onOpenAutoFocus={() => setTimeout(() => inputRef.current?.focus(), 0)}
      >
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                      <HighlightedText text={ex.name} query={q} />
                    </div>
                    {tagLine && (
                      <div className="text-[10px] text-muted-foreground">
                        <HighlightedText text={tagLine} query={q} />
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

function SwapExerciseButton({ row, setRow, exercises }: { row: any; setRow: (r: any) => void; exercises: any[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (exercises as any[]).filter((e) => e.id !== row.exercise_id);
    if (!term) return list.slice(0, 100);
    return list
      .filter((e) => {
        const hay = [e.name, e.muscle_group, e.category, ...(e.tags ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(term);
      })
      .slice(0, 200);
  }, [exercises, q, row.exercise_id]);
  const pick = (ex: any) => {
    // Preserve every existing input (sets/reps/rpe/rir/load/rest/tempo/notes…)
    // Replace only the exercise identity.
    setRow({ ...row, exercise_id: ex.id, exercise_name_override: ex.name });
    setOpen(false);
    setQ("");
    toast.success(`Swapped to ${ex.name}`);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Swap exercise (keeps sets, reps, load, etc.)">
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Swap exercise</div>
        <Input
          autoFocus
          placeholder="Search exercises…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-2 h-8 text-xs"
        />
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => pick(ex)}
                  className="rounded px-2 py-1 text-left text-xs hover:bg-muted"
                >
                  <HighlightedText text={ex.name} query={q} />
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Sets, reps, load, rest, tempo, and notes are preserved.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function RowEditor({ row, setRow, onDelete, exercises, compact, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onDragStartRow, onDragEndRow, isDragging, purposeLabel }: { row: any; setRow: (r: any) => void; onDelete?: () => void; exercises: any[]; compact?: boolean; onMoveUp?: () => void; onMoveDown?: () => void; canMoveUp?: boolean; canMoveDown?: boolean; onDragStartRow?: (e: React.DragEvent) => void; onDragEndRow?: () => void; isDragging?: boolean; purposeLabel?: string }) {
  const Field = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <span className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">{label}</span>
      {children}
    </div>
  );
  // High-contrast input styling for builder rows — white fill so editable
  // fields pop against the dark card background and never look pre-filled.
  const inputCls =
    "bg-white text-slate-900 border-2 border-slate-300 shadow-sm " +
    "placeholder:text-slate-400 placeholder:font-normal " +
    "hover:border-slate-400 " +
    "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 " +
    "dark:bg-white dark:text-slate-900 dark:border-slate-300 dark:placeholder:text-slate-400";
  const exMeta = (exercises as any[]).find((e) => e.id === row.exercise_id) ?? null;
  const exName = exMeta?.name ?? row.exercise_name_override ?? "";
  const accent = exerciseAccent(exMeta, row.card_color);
  const restCat = resolveCategory(exMeta);
  const restDefault = defaultRestSeconds(exMeta);
  const effectiveRest = effectiveRestSeconds(row, exMeta);
  const restIsOverride = row.rest_seconds_override != null && row.rest_seconds_override !== restDefault;
  const [expanded, setExpanded] = useState(!compact);
  useEffect(() => { if (!compact) setExpanded(true); }, [compact]);
  const h = compact ? "h-7" : "h-8";
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
    });
  }, [clientId, exName, row.percentage, row.percentage_basis, row.load_kg, row.load_lb, rowUnit, maxesIndex]);
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
  return (
    <div
      data-pb-row
      onKeyDown={(e) => {
        // Quick key: Alt+R resets the currently focused card
        if (e.altKey && (e.key === "r" || e.key === "R")) {
          e.preventDefault();
          e.stopPropagation();
          resetCard();
        }
      }}
      className={cn(
        "relative overflow-hidden rounded-lg border border-builder-card-border bg-builder-card shadow-builder-card transition-colors hover:border-builder-card-border-strong",
        isDragging && "opacity-50 ring-2 ring-primary",
        compact ? "p-3 pl-5 space-y-1.5" : "p-4 pl-6 space-y-2",
      )}
    >
      <div className={`absolute left-0 top-0 h-full w-2 ${accent}`} aria-hidden />
      {/* ---- Header row: identity (left) + actions (right) ---- */}
      <div className="flex items-start gap-2">
        <Field className="min-w-0 flex-1" label="Exercise">
        <div className="flex items-center gap-1">
          <span
            draggable={!!onDragStartRow}
            onDragStart={onDragStartRow}
            onDragEnd={onDragEndRow}
            title="Drag to reorder"
            className="cursor-grab active:cursor-grabbing rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <GripVertical className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
        <Select value={row.exercise_id ?? "__custom"} onValueChange={(v) => setRow({ ...row, exercise_id: v === "__custom" ? null : v })}>
          <SelectTrigger className={cn("min-h-8 h-auto py-1 text-sm font-semibold [&>span]:line-clamp-2 [&>span]:whitespace-normal [&>span]:text-left [&>span]:leading-tight")}>
            <SelectValue placeholder="Exercise" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__custom">— Custom name —</SelectItem>
            {(exercises as any[]).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {!row.exercise_id && (
          <RowCell className="mt-1 h-7 text-sm font-semibold" placeholder="Custom name" value={row.exercise_name_override} onCommit={(v) => setRow({ ...row, exercise_name_override: v })} />
        )}
        {purposeLabel && (
          <div className="mt-1 flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide transition hover:bg-secondary",
                    purposeLabelBadgeClass(purposeLabel),
                  )}
                  title={row.purpose_label ? "Manual purpose label — click to change" : "Auto purpose label — click to override"}
                >
                  {purposeLabel}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-2" align="start">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Purpose label</div>
                <div className="grid gap-1">
                  <button
                    type="button"
                    onClick={() => setRow({ ...row, purpose_label: null })}
                    className={cn("rounded px-2 py-1 text-left text-xs hover:bg-muted",
                      !row.purpose_label && "bg-muted/60 font-semibold")}
                  >
                    Auto (from position)
                  </button>
                  {PURPOSE_LABEL_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setRow({ ...row, purpose_label: opt })}
                      className={cn("rounded px-2 py-1 text-left text-xs hover:bg-muted",
                        row.purpose_label === opt && "bg-primary/10 font-semibold text-primary")}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
          </div>
        </div>
        </Field>
        <div className="flex shrink-0 items-center gap-0.5 pt-4">
          {onMoveUp && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onMoveUp}
              disabled={canMoveUp === false}
              title="Move up"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
          )}
          {onMoveDown && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onMoveDown}
              disabled={canMoveDown === false}
              title="Move down"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { copyRows([row]); toast.success("Exercise copied"); }} title="Copy exercise">
            <ClipboardCopy className="h-3.5 w-3.5" />
          </Button>
          <SwapExerciseButton row={row} setRow={setRow} exercises={exercises} />
          {multiBlockFlag && row._dbId && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-primary"
              onClick={() => setBlocksOpen(true)}
              title="Multi-block editor (preview)"
            >
              <Layers className="h-3.5 w-3.5" />
            </Button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Advanced settings (exercise classification)">
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" align="end">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground">Exercise classification</div>
              <p className="mb-2 text-[11px] leading-snug text-foreground/80">
                Controls automatic rest defaults, workout-duration estimates, and warm-up buffer. Inferred automatically — override only when needed.
              </p>
              <Select value={row.time_profile ?? "accessory_compound"} onValueChange={(v) => setRow({ ...row, time_profile: v })}>
                <SelectTrigger className={cn("text-xs font-medium", h, inputCls)}>
                  <SelectValue>
                    {TIME_PROFILE_LABEL[row.time_profile ?? "accessory_compound"] ?? (row.time_profile ?? "Accessory compound")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>{TIME_PROFILES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <div className="mt-2 text-[10px] text-foreground/70">
                Current: <span className="font-semibold text-foreground">{TIME_PROFILE_LABEL[row.time_profile ?? "accessory_compound"] ?? (row.time_profile ?? "Accessory compound")}</span>
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Card color">
                <Palette className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="end">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Card color</div>
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  onClick={() => setRow({ ...row, card_color: null })}
                  className={cn(
                    "h-6 w-6 rounded-full border-2 bg-background text-[10px] leading-none text-muted-foreground hover:border-foreground",
                    !row.card_color ? "border-foreground" : "border-border",
                  )}
                  title="Default (auto)"
                >
                  A
                </button>
                {EXERCISE_CARD_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setRow({ ...row, card_color: c.value })}
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition",
                      c.swatch,
                      row.card_color === c.value ? "border-foreground" : "border-transparent hover:border-foreground/50",
                    )}
                    title={c.label}
                    aria-label={c.label}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {compact && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded((v) => !v)} title={expanded ? "Hide advanced" : "Show advanced"}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          )}
          {onDelete && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={resetCard}
            title="Reset card (Alt+R)"
            aria-label="Reset card"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {/* ---- Primary programming row ---- */}
      <div className="grid grid-cols-12 items-end gap-1">
        <Field className="col-span-2" label="Sets">
          <RowCell dataField="sets" className={cn("text-sm font-semibold tabular-nums text-center", h, inputCls)} inputMode="numeric" placeholder="3" value={row.sets} onCommit={(v) => setRow({ ...row, sets: parseIntOrNull(v) })} />
        </Field>
        <Field className="col-span-3" label="Reps">
          <RowCell dataField="reps" className={cn("text-sm font-semibold tabular-nums text-center", h, inputCls)} placeholder="8-12" value={row.reps_text} onCommit={(v) => setRow({ ...row, reps_text: v ?? "" })} />
        </Field>
        <Field className="col-span-2" label="RPE">
          <RowCell dataField="rpe" className={cn("text-sm font-semibold tabular-nums text-center", h, inputCls)} inputMode="decimal" placeholder="—" value={row.rpe} onCommit={(v) => setRow({ ...row, rpe: v ?? "" })} />
        </Field>
        <Field className="col-span-2" label="RIR">
          <RowCell dataField="rir" className={cn("text-sm font-semibold tabular-nums text-center", h, inputCls)} inputMode="decimal" placeholder="—" value={row.rir} onCommit={(v) => setRow({ ...row, rir: v ?? "" })} />
        </Field>
        <Field className="col-span-3" label={`Rest time${restIsOverride ? " *" : ""}`}>
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
                    className={cn(
                      "text-xs font-semibold tabular-nums px-2 [&>span]:truncate",
                      h,
                      inputCls,
                      restIsOverride && "ring-1 ring-primary/40",
                    )}
                  >
                    <SelectValue>
                      {selectValue === "auto"
                        ? `Auto · ${fmtRestSeconds(restDefault)}`
                        : selectValue === "custom"
                          ? `Custom · ${fmtRestSeconds(override ?? null)}`
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
                    className={cn("mt-1 text-xs font-semibold tabular-nums text-center", h, inputCls)}
                    inputMode="numeric"
                    placeholder="Custom rest (seconds)"
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
                <span
                  className="px-0.5 text-[10px] leading-tight text-foreground/80 truncate"
                  title={
                    selectValue === "auto"
                      ? `Auto · ${restCat} default · ${fmtRestSeconds(effectiveRest)}`
                      : `${fmtRestSeconds(effectiveRest)} programmed`
                  }
                >
                  {selectValue === "auto"
                    ? `Auto · ${restCat} · ${fmtRestSeconds(effectiveRest)}`
                    : `${fmtRestSeconds(effectiveRest)} programmed`}
                </span>
              </>
            );
          })()}
        </Field>
      </div>
      {expanded && (
      <div className="grid grid-cols-12 items-start gap-2">
        {/* ---- Suggested Load: one coherent group ---- */}
        <div className={cn("col-span-12", loadMode === "none" ? "md:col-span-6" : "md:col-span-9", "rounded-md border border-builder-card-border/70 bg-builder-inset p-2")}>
          <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">Suggested load</span>
            <button
              type="button"
              role="switch"
              aria-checked={suggestedOn}
              onClick={() => setLoadMode(suggestedOn ? "none" : "manual")}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors border",
                suggestedOn ? "bg-green-600 border-green-600" : "bg-red-500 border-red-500",
              )}
              title={suggestedOn ? "Click to remove suggested load" : "Click to add a suggested load"}
            >
              <span className={cn("inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform", suggestedOn ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
          {suggestedOn ? (
            <div className="grid grid-cols-12 items-end gap-1">
              <div className="col-span-3">
                <div className="inline-flex w-full rounded-md border border-border p-0.5">
                  <button type="button" onClick={() => setLoadMode("manual")} className={cn("flex-1 rounded px-1.5 py-0.5 text-[10px] font-semibold", loadMode === "manual" ? "bg-primary text-primary-foreground" : "text-foreground/80")} title="Fixed weight">Weight</button>
                  <button type="button" onClick={() => setLoadMode("pct")} className={cn("flex-1 rounded px-1.5 py-0.5 text-[10px] font-semibold", loadMode === "pct" ? "bg-primary text-primary-foreground" : "text-foreground/80")} title="Percentage of max">%</button>
                </div>
              </div>
              {loadMode === "pct" && (
                <Field className="col-span-4" label="Basis">
                  <Select value={row.percentage_basis ?? "manual"} onValueChange={(v) => setRow({ ...row, percentage_basis: v })}>
                    <SelectTrigger className={cn("text-xs font-medium", h, inputCls)}><SelectValue /></SelectTrigger>
                    <SelectContent>{PERCENTAGE_BASES.filter((p) => p.value !== "none" && p.value !== "manual").map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )}
              {loadMode === "pct" && (
                <Field className="col-span-2" label="%">
                  <RowCell className={cn("text-xs font-semibold tabular-nums text-center", h, inputCls)} inputMode="decimal" placeholder="75" value={row.percentage} onCommit={(v) => setRow({ ...row, percentage: parseFloatOrNull(v) })} />
                </Field>
              )}
              <Field className={cn(loadMode === "pct" ? "col-span-3" : "col-span-9")} label={`Value (${rowUnit})`}>
                <div className="flex gap-1">
                  <RowCell
                    dataField="load"
                    className={cn("text-xs font-semibold tabular-nums flex-1", h, inputCls)}
                    inputMode="decimal"
                    placeholder={loadMode === "pct" ? "auto" : "weight"}
                    value={rowUnit === "kg" ? row.load_kg : row.load_lb}
                    onCommit={(v) => setRow({ ...row, [rowUnit === "kg" ? "load_kg" : "load_lb"]: parseFloatOrNull(v) })}
                  />
                  <Select value={rowUnit} onValueChange={(v) => setRow({ ...row, load_unit: v })}>
                    <SelectTrigger className={cn("w-[56px] text-[11px] font-semibold px-1.5", h, inputCls)} data-pb-field="unit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kg">kg</SelectItem>
                      <SelectItem value="lb">lb</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Field>
            </div>
          ) : (
            <p className="px-0.5 text-[11px] italic text-foreground/70">Off — client logs their own weight.</p>
          )}
        </div>
        <Field className={cn("col-span-12", loadMode === "none" ? "md:col-span-6" : "md:col-span-3")} label="Tempo">
          <RowCell dataField="tempo" className={cn("text-xs font-semibold tabular-nums text-center", h, inputCls)} placeholder="—" value={row.tempo} onCommit={(v) => setRow({ ...row, tempo: v ?? "" })} />
          <span className="px-0.5 text-[10px] leading-tight text-foreground/70 truncate" title="Tempo notation: eccentric–pause–concentric (seconds). Example: 3-1-1 = 3s down, 1s pause, 1s up.">
            ecc–pause–con · e.g. 3-1-1
          </span>
        </Field>
      </div>
      )}
      {expanded && row.manual_override && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-600 dark:text-amber-400">
            Manual override
            {row.override_of_pct && <span className="text-muted-foreground">(was {row.override_of_pct}%)</span>}
          </span>
          <button onClick={clearOverride} className="text-[10px] underline text-muted-foreground hover:text-foreground">Remove override</button>
        </div>
      )}
      {expanded && clientId && computed && computed.status !== "manual" && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px]">
          {computed.status === "ok" && (
            <>
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-700 dark:text-emerald-400">
              <PbCalculator className="h-3 w-3" />
              {row.percentage}% {computed.baseLabel} = <strong>{computed.load} {computed.unit}</strong>
              <span className="text-muted-foreground">(of {computed.base?.toFixed(1)})</span>
            </span>
            {!row.manual_override && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={overrideCalculated} title="Replace the calculated load with a fixed manual value for this row only">
                Override
              </Button>
            )}
            </>
          )}
          {computed.status === "no-max" && (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-warning">
                <PbAlertCircle className="h-3 w-3" /> No max set for "{exName}"
              </span>
              <Button
                size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                onClick={() => setMaxEditor({
                  client_id: clientId, lift: exName, unit: "kg",
                  source: "manual", active: true, rounding_mode: "nearest", rounding_step: 2.5,
                  block_id: blockId ?? null,
                })}
              >
                <Plus className="mr-0.5 h-3 w-3" /> Set Max
              </Button>
            </>
          )}
          {computed.status === "no-percentage" && (
            <span className="text-muted-foreground">Enter a % to compute load</span>
          )}
          {computed.status === "needs-link" && (
            <span className="text-muted-foreground">Linked-row basis — set on the row this references</span>
          )}
        </div>
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
    </div>
  );
}