import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, ArrowLeft, Plus, Trash2, Save, Clock, Copy, LayoutGrid, CalendarRange, ArrowRight, ZoomIn, ZoomOut, Maximize2, PanelLeftClose, PanelLeftOpen, Rows3, ChevronDown, ChevronUp, Settings2, Undo2, Redo2, ClipboardCopy, ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import {
  getTemplate, updateTemplate, summarizeTemplatePayload, TIME_PROFILES,
  estimateDayMinutes, durationRange, PERCENTAGE_BASES, type TrainingStyle,
} from "@/lib/pl-programs";
import { ExerciseLibraryPanel, type ExerciseRef, DND_EXERCISE, readDrop, movementAccent } from "@/components/program-builder";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";
import { useConflictWatch } from "@/hooks/use-conflict-watch";
import { ActionButton } from "@/components/action-button";
import { copyRows, useClip } from "@/lib/program-builder-clipboard";
import { createContext, useContext } from "react";
import { listClientMaxes, buildMaxIndex, computeRowLoad, type ClientMaxRow } from "@/lib/pl-maxes";
import { MaxEditorDialog } from "@/components/client-maxes-panel";
import { BlockMaxesButton } from "@/components/block-maxes-panel";
import { AlertCircle as PbAlertCircle, Calculator as PbCalculator } from "lucide-react";

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
  value, onCommit, className, placeholder, inputMode, commitDelay = 400,
}: {
  value: string | number | null | undefined;
  onCommit: (v: string | null) => void;
  className?: string;
  placeholder?: string;
  inputMode?: any;
  commitDelay?: number;
}) {
  const stringify = (v: string | number | null | undefined) => (v == null ? "" : String(v));
  const [local, setLocal] = useState(() => stringify(value));
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef(stringify(value));

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
    <Input
      className={className}
      placeholder={placeholder}
      inputMode={inputMode}
      value={local}
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
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setLocal(lastCommittedRef.current);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

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
  const stamp = { sort_order: 0, sets: 3, reps_text: "8-12", time_profile: "accessory_compound", ...row };
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
});

const STYLES: TrainingStyle[] = ["powerlifting", "bodybuilding", "strength", "lifestyle", "hybrid", "rehab", "conditioning", "custom"];

function TemplateEditor() {
  const { templateId } = Route.useParams();
  const qc = useQueryClient();

  const { data: tpl, isLoading } = useQuery({
    queryKey: ["pl-template", templateId],
    queryFn: () => getTemplate(templateId),
  });
  const { data: exercises = [] } = useQuery({
    queryKey: ["exercises-min"],
    queryFn: async () =>
      (await supabase.from("exercises").select("id, name, muscle_group, category, tags").order("name")).data ?? [],
  });

  // local working state
  const [meta, setMeta] = useState<any>(null);
  const [payload, setPayload] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);

  // ---- Undo / Redo history for payload ----
  const histRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const lastPushTs = useRef(0);
  const [, bumpHist] = useState(0);
  const canUndo = histRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  useEffect(() => {
    if (tpl && !meta) {
      setMeta({
        name: tpl.name, training_style: tpl.training_style, training_focus: tpl.training_focus ?? "",
        notes: tpl.notes ?? "", weeks: tpl.weeks ?? 0, days_per_week: tpl.days_per_week ?? 0,
        est_duration_min: tpl.est_duration_min ?? 0, tags: (tpl.tags ?? []).join(", "), status: tpl.status,
      });
      setPayload(JSON.parse(JSON.stringify(tpl.payload || {})));
      hydratedRef.current = true;
      histRef.current = [];
      futureRef.current = [];
      bumpHist((n) => n + 1);
    }
  }, [tpl]);

  const setM = (patch: any) => { setMeta({ ...meta, ...patch }); setDirty(true); };
  const setP = (next: any, opts?: { skipHistory?: boolean }) => {
    if (!opts?.skipHistory && payload != null) {
      const now = Date.now();
      // Coalesce rapid edits (e.g. typing) within 600ms into a single history step.
      if (now - lastPushTs.current > 600) {
        histRef.current.push(JSON.stringify(payload));
        if (histRef.current.length > 100) histRef.current.shift();
      }
      lastPushTs.current = now;
      futureRef.current = [];
      bumpHist((n) => n + 1);
    }
    setPayload(next);
    setDirty(true);
  };
  const undo = () => {
    const prev = histRef.current.pop();
    if (!prev) return;
    futureRef.current.push(JSON.stringify(payload));
    setPayload(JSON.parse(prev));
    setDirty(true);
    lastPushTs.current = 0;
    bumpHist((n) => n + 1);
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    histRef.current.push(JSON.stringify(payload));
    setPayload(JSON.parse(next));
    setDirty(true);
    lastPushTs.current = 0;
    bumpHist((n) => n + 1);
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
  const autosave = useAutosave({
    key: `template:${templateId}:editor`,
    value: autosaveValue,
    delay: 1500,
    enabled: !!meta && !!payload && hydratedRef.current && dirty,
    onSave: async ({ meta: m, payload: p }) => {
      if (!m || !p) return;
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
                <div><Label>Focus</Label><Input value={meta.training_focus} onChange={(e) => setM({ training_focus: e.target.value })} /></div>
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

export function StructureCanvas({ type, payload, setP, exercises, appendRowToFirstDay, undo, redo, canUndo, canRedo, clientId, blockId, toolbarExtras }: {
  type: string; payload: any; setP: (p: any, opts?: { skipHistory?: boolean }) => void; exercises: any[];
  appendRowToFirstDay: (payload: any, type: string, row: any) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  /** Optional — when present, RowEditor will display computed loads & "no max" warnings. */
  clientId?: string | null;
  /** Optional — when set, maxes are loaded with block-scoped overrides applied. */
  blockId?: string | null;
  /** Optional — rendered in the canvas toolbar (e.g. "Block Maxes" button). */
  toolbarExtras?: React.ReactNode;
}) {
  const [prefs, setPrefsState] = useState<EditorPrefs>(() => readPrefs());
  const setPrefs = (patch: Partial<EditorPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefsState(next);
    writePrefs(next);
  };
  const { compact, zoom, sidebarCollapsed } = prefs;
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
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

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
    <div className="rounded-md border border-border bg-background">
      {/* Sticky compact toolbar */}
      <div className="sticky top-[42px] z-20 flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-2 py-1.5 backdrop-blur">
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
          className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition", compact ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          title="Toggle compact mode"
        >
          <Rows3 className="h-3 w-3" /> Compact
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
          <BlockMaxesButton clientId={clientId ?? null} blockId={blockId ?? null} />
          {toolbarExtras}
        </div>
      </div>

      <div className="flex h-[calc(100vh-150px)] gap-0 overflow-hidden">
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
            <StructureEditor type={type} payload={payload} setPayload={setP} exercises={exercises as any[]} compact={compact} />
          </div>
        </div>
      </div>
    </div>
    </MaxesContext.Provider>
  );
}

// ---------- Structure editing for the JSON payload ----------

function StructureEditor({ type, payload, setPayload, exercises, compact }: { type: string; payload: any; setPayload: (p: any) => void; exercises: any[]; compact?: boolean }) {
  if (type === "full_prep") return <FullPrepEditor payload={payload} setPayload={setPayload} exercises={exercises} compact={compact} />;
  if (type === "block") return <BlockPayloadEditor weeksData={payload.weeks_data || []} setWeeksData={(wd) => setPayload({ ...payload, weeks_data: wd })} exercises={exercises} compact={compact} />;
  if (type === "week") return <WeekEditor week={payload} setWeek={setPayload} exercises={exercises} compact={compact} />;
  if (type === "day") return <DayEditor day={payload} setDay={setPayload} exercises={exercises} compact={compact} />;
  return (
    <Card className="p-4 max-w-3xl">
      <RowEditor row={payload} setRow={setPayload} exercises={exercises} compact={compact} />
    </Card>
  );
}

function FullPrepEditor({ payload, setPayload, exercises, compact }: any) {
  const prep = payload.prep || {};
  const blocks = payload.blocks_data || [];
  const setPrep = (patch: any) => setPayload({ ...payload, prep: { ...prep, ...patch } });
  const setBlocks = (b: any[]) => setPayload({ ...payload, blocks_data: b });
  return (
    <div className="space-y-4">
      <Card className="p-4 max-w-2xl">
        <div className="mb-2 text-sm font-bold">Prep details</div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Event name</Label><Input value={prep.event_name ?? ""} onChange={(e) => setPrep({ event_name: e.target.value || null })} /></div>
          <div><Label>Event date</Label><Input type="date" value={prep.event_date ?? ""} onChange={(e) => setPrep({ event_date: e.target.value || null })} /></div>
          <div><Label>Goal type</Label><Input value={prep.goal_type ?? ""} onChange={(e) => setPrep({ goal_type: e.target.value })} /></div>
          <div><Label>Total weeks</Label><Input type="number" inputMode="numeric" value={prep.total_weeks ?? ""} onChange={(e) => setPrep({ total_weeks: parseInt(e.target.value) || null })} /></div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Blocks</h3>
        <Button size="sm" onClick={() => setBlocks([...blocks, { name: `Block ${blocks.length + 1}`, training_focus: "", weeks_data: [] }])}>
          <Plus className="mr-1 h-3 w-3" /> Add block
        </Button>
      </div>
      {blocks.map((b: any, i: number) => (
        <Card key={i} className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input className="max-w-xs font-bold" value={b.name ?? ""} onChange={(e) => { const copy = [...blocks]; copy[i] = { ...b, name: e.target.value }; setBlocks(copy); }} />
            <Input className="max-w-xs" placeholder="Focus" value={b.training_focus ?? ""} onChange={(e) => { const copy = [...blocks]; copy[i] = { ...b, training_focus: e.target.value }; setBlocks(copy); }} />
            <Button size="icon" variant="ghost" className="ml-auto text-destructive" onClick={() => { if (confirm("Remove block?")) setBlocks(blocks.filter((_: any, j: number) => j !== i)); }}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <BlockPayloadEditor
            weeksData={b.weeks_data || []}
            setWeeksData={(wd) => { const copy = [...blocks]; copy[i] = { ...b, weeks_data: wd }; setBlocks(copy); }}
            exercises={exercises}
            compact={compact}
          />
        </Card>
      ))}
    </div>
  );
}

export function BlockPayloadEditor({ weeksData, setWeeksData, exercises, compact }: { weeksData: any[]; setWeeksData: (wd: any[]) => void; exercises: any[]; compact?: boolean }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [view, setView] = useState<"block" | "week">("block");
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
        {view === "block" && weeksData.length > 1 && (
          <Button size="sm" variant="outline" onClick={copyWeek1ToAll}>
            <Copy className="mr-1 h-3 w-3" /> Copy Week 1 → all weeks
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
                  Week {w.week_index}
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
            <div className="sticky top-12 z-10 -mx-2 overflow-x-auto border-b border-primary/20 bg-[color-mix(in_oklab,var(--primary)_6%,var(--background))] px-2 py-2 backdrop-blur">
              <div className="flex w-max items-center gap-1.5">
                <span className="mr-1 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  Full Block · {weeksData.length} week{weeksData.length === 1 ? "" : "s"}
                </span>
                {weeksData.map((w: any, i: number) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => document.getElementById(`tpl-week-${i}`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" })}
                    className="h-8 w-[112px] shrink-0 rounded-md border border-border bg-card px-2 text-xs font-semibold text-muted-foreground hover:border-primary/60 hover:text-primary"
                  >
                    Week {w.week_index}
                  </button>
                ))}
              </div>
            </div>
          )}
          {weeksData.length === 0 && (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No weeks yet. Click <em>Add week</em> to start.
            </p>
          )}
          <div className={cn(
            "snap-x snap-proximity overflow-x-auto pb-3 scroll-smooth",
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
                      "shrink-0 snap-start overflow-hidden border-2 border-border p-0",
                      compact
                        ? "w-[88vw] max-w-[520px] sm:w-[440px] lg:w-[480px] xl:w-[520px]"
                        : "w-[94vw] max-w-[720px] sm:w-[600px] lg:w-[640px] xl:w-[700px]",
                    )}
                    style={{ borderLeftWidth: 6, borderLeftColor: "var(--primary)" }}
                  >
                    <div className={cn(
                      "flex flex-wrap items-center gap-1.5 border-b border-primary/20 bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))]",
                      compact ? "px-2 py-1" : "px-3 py-2",
                    )}>
                      <span className={cn("inline-flex items-center rounded-md bg-primary px-2 text-[10px] font-bold uppercase tracking-wide text-primary-foreground", compact ? "h-5" : "h-6 text-[11px]")}>
                        Week {w.week_index}
                      </span>
                      <span className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-[11px]")}>
                        {s.days} day{s.days === 1 ? "" : "s"} · {s.rows} row{s.rows === 1 ? "" : "s"} · Est {fmtDur(s.minutes)}
                      </span>
                      <Input
                        className={cn("min-w-[120px] flex-1 border-0 bg-transparent text-xs focus-visible:ring-1", compact ? "h-6" : "h-7")}
                        placeholder="Week notes"
                        value={w.notes ?? ""}
                        onChange={(e) => { const c = [...weeksData]; c[wi] = { ...w, notes: e.target.value }; setWeeksData(c); }}
                      />
                      <div className="ml-auto flex gap-1">
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
      {days.map((d: any, i: number) => (
        <Card key={i} className={cn("border-l-[3px] border-l-primary/40", compact ? "p-2" : "p-3")}>
          <div className={cn("flex items-center gap-2", compact ? "mb-1" : "mb-2")}>
            <Input className={cn("max-w-xs font-bold", compact && "h-7 text-xs")} value={d.title ?? ""} onChange={(e) => { const copy = [...days]; copy[i] = { ...d, title: e.target.value }; setWeek({ ...week, days: copy }); }} />
            <Input className={cn("max-w-xs", compact && "h-7 text-xs")} placeholder="Focus" value={d.focus ?? ""} onChange={(e) => { const copy = [...days]; copy[i] = { ...d, focus: e.target.value }; setWeek({ ...week, days: copy }); }} />
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
      ))}
      {hideHeader && days.length > 0 && (
        <Button size="sm" variant="ghost" onClick={addDay}><Plus className="mr-1 h-3 w-3" /> Day</Button>
      )}
    </div>
  );
}

function DayEditor({ day, setDay, exercises, compact }: { day: any; setDay: (d: any) => void; exercises: any[]; compact?: boolean }) {
  const rows = day.rows || [];
  const [dragOver, setDragOver] = useState(false);
  const [dragRowIdx, setDragRowIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const clip = useClip();
  const addRow = () => setDay({ ...day, rows: [...rows, { sort_order: rows.length, sets: 3, reps_text: "8-12", time_profile: "accessory_compound" }] });
  const pasteFromClip = () => {
    if (!clip || clip.kind !== "rows") return;
    const cloned = JSON.parse(JSON.stringify(clip.rows));
    const next = [...rows, ...cloned];
    setDay({ ...day, rows: next.map((r: any, i: number) => ({ ...r, sort_order: i })) });
  };
  const insertExercise = (exId: string, atIndex?: number) => {
    const ex = (exercises as any[]).find((x) => x.id === exId);
    const newRow = { sort_order: 0, sets: 3, reps_text: "8-12", time_profile: "accessory_compound", exercise_id: exId, exercise_name_override: ex?.name };
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
        "space-y-2 rounded-md transition-colors",
        dragOver && "ring-2 ring-primary ring-offset-1 bg-primary/5",
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
        <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          {dragOver ? "Drop exercise here" : "Drag exercises from the library, or click + Row"}
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r: any, i: number) => (
            <div
              key={i}
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
                dropTargetIdx === i && "border-t-2 border-t-primary",
                dropTargetIdx === i + 1 && "border-b-2 border-b-primary",
              )}
            >
              <RowEditor
                row={r}
                setRow={(nr) => { const copy = [...rows]; copy[i] = nr; setDay({ ...day, rows: copy }); }}
                onDelete={() => setDay({ ...day, rows: rows.filter((_: any, j: number) => j !== i) })}
                onMoveUp={i > 0 ? () => moveRow(i, i - 1) : undefined}
                onMoveDown={i < rows.length - 1 ? () => moveRow(i, i + 2) : undefined}
                onDragStartRow={(e) => {
                  e.dataTransfer.setData("application/x-pb-row-reorder", String(i));
                  e.dataTransfer.effectAllowed = "move";
                  setDragRowIdx(i);
                }}
                onDragEndRow={() => { setDragRowIdx(null); setDropTargetIdx(null); }}
                isDragging={dragRowIdx === i}
                exercises={exercises}
                compact={compact !== false}
              />
            </div>
          ))}
        </div>
      )}
      <Textarea className={cn("mt-2", compact && "text-xs")} placeholder="Day notes" value={day.notes ?? ""} onChange={(e) => setDay({ ...day, notes: e.target.value })} rows={compact ? 1 : 2} />
    </div>
  );
}

function RowEditor({ row, setRow, onDelete, exercises, compact, onMoveUp, onMoveDown, onDragStartRow, onDragEndRow, isDragging }: { row: any; setRow: (r: any) => void; onDelete?: () => void; exercises: any[]; compact?: boolean; onMoveUp?: () => void; onMoveDown?: () => void; onDragStartRow?: (e: React.DragEvent) => void; onDragEndRow?: () => void; isDragging?: boolean }) {
  const Field = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <span className="px-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">{label}</span>
      {children}
    </div>
  );
  const exName = (exercises as any[]).find((e) => e.id === row.exercise_id)?.name ?? row.exercise_name_override ?? "";
  const accent = movementAccent(exName);
  const [expanded, setExpanded] = useState(!compact);
  useEffect(() => { if (!compact) setExpanded(true); }, [compact]);
  const h = compact ? "h-7" : "h-8";
  const { clientId, blockId, index: maxesIndex, maxes, refresh } = useClientMaxesCtx();
  const [maxEditor, setMaxEditor] = useState<any>(null);
  // Derive a clear "load mode" from the existing basis field.
  const loadMode: "pct" | "manual" | "none" =
    row.percentage_basis === "none" ? "none"
    : (!row.percentage_basis || row.percentage_basis === "manual") ? "manual"
    : "pct";
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
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-border bg-card shadow-sm transition-shadow hover:border-foreground/30 hover:shadow",
        isDragging && "opacity-50 ring-2 ring-primary",
        compact ? "p-1.5 pl-4 space-y-1" : "p-2 pl-5 space-y-1",
      )}
    >
      <div className={`absolute left-0 top-0 h-full w-2 ${accent}`} aria-hidden />
      <div className="grid grid-cols-12 items-end gap-1">
        <Field className="col-span-4" label="Exercise">
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
          <SelectTrigger className={cn(h, "text-sm font-semibold")}><SelectValue placeholder="Exercise" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__custom">— Custom name —</SelectItem>
            {(exercises as any[]).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {!row.exercise_id && (
          <RowCell className="mt-1 h-7 text-sm font-semibold" placeholder="Custom name" value={row.exercise_name_override} onCommit={(v) => setRow({ ...row, exercise_name_override: v })} />
        )}
          </div>
        </div>
        </Field>
        <Field className="col-span-1" label="Sets">
          <RowCell className={cn("text-sm font-medium tabular-nums", h)} inputMode="numeric" placeholder="3" value={row.sets} onCommit={(v) => setRow({ ...row, sets: parseIntOrNull(v) })} />
        </Field>
        <Field className="col-span-2" label="Reps">
          <RowCell className={cn("text-sm font-medium tabular-nums", h)} placeholder="8-12" value={row.reps_text} onCommit={(v) => setRow({ ...row, reps_text: v ?? "" })} />
        </Field>
        <Field className="col-span-1" label="RPE">
          <RowCell className={cn("text-sm font-medium tabular-nums", h)} inputMode="decimal" placeholder="8" value={row.rpe} onCommit={(v) => setRow({ ...row, rpe: v ?? "" })} />
        </Field>
        <Field className="col-span-1" label="RIR">
          <RowCell className={cn("text-sm font-medium tabular-nums", h)} inputMode="decimal" placeholder="2" value={row.rir} onCommit={(v) => setRow({ ...row, rir: v ?? "" })} />
        </Field>
        <Field className="col-span-1" label="Rest s">
          <RowCell className={cn("text-sm font-medium tabular-nums", h)} inputMode="numeric" placeholder="90" value={row.rest_seconds} onCommit={(v) => setRow({ ...row, rest_seconds: parseIntOrNull(v) })} />
        </Field>
        <div className="col-span-2 flex justify-end gap-0.5 pb-0.5">
          {onMoveUp && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onMoveUp} title="Move up">
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
          )}
          {onMoveDown && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onMoveDown} title="Move down">
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { copyRows([row]); toast.success("Exercise copied"); }} title="Copy exercise">
            <ClipboardCopy className="h-3.5 w-3.5" />
          </Button>
          {compact && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded((v) => !v)} title={expanded ? "Hide advanced" : "Show advanced"}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          )}
          {onDelete && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
        </div>
      </div>
      {expanded && (
      <div className="grid grid-cols-12 items-end gap-1">
        <Field className="col-span-3" label="Load mode">
          <div className="inline-flex rounded-md border border-border p-0.5">
            <button type="button" onClick={() => setLoadMode("pct")} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", loadMode === "pct" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>%</button>
            <button type="button" onClick={() => setLoadMode("manual")} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", loadMode === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Manual</button>
            <button type="button" onClick={() => setLoadMode("none")} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", loadMode === "none" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>No load</button>
          </div>
        </Field>
        {loadMode === "pct" && (
        <Field className="col-span-3" label="Basis">
          <Select value={row.percentage_basis ?? "manual"} onValueChange={(v) => setRow({ ...row, percentage_basis: v })}>
            <SelectTrigger className={cn("text-xs", h)}><SelectValue /></SelectTrigger>
            <SelectContent>{PERCENTAGE_BASES.filter((p) => p.value !== "none" && p.value !== "manual").map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        )}
        {loadMode === "pct" && (
        <Field className="col-span-1" label="%">
          <RowCell className={cn("text-xs", h)} inputMode="decimal" placeholder="75" value={row.percentage} onCommit={(v) => setRow({ ...row, percentage: parseFloatOrNull(v) })} />
        </Field>
        )}
        {loadMode !== "none" && (
        <Field className={cn(loadMode === "pct" ? "col-span-2" : "col-span-3")} label={`Load (${rowUnit})`}>
          <div className="flex gap-1">
            <RowCell
              className={cn("text-xs flex-1", h)}
              inputMode="decimal"
              placeholder={loadMode === "pct" ? "auto" : "100"}
              value={rowUnit === "kg" ? row.load_kg : row.load_lb}
              onCommit={(v) => setRow({ ...row, [rowUnit === "kg" ? "load_kg" : "load_lb"]: parseFloatOrNull(v) })}
            />
            <Select value={rowUnit} onValueChange={(v) => setRow({ ...row, load_unit: v })}>
              <SelectTrigger className={cn("w-[52px] text-[11px] px-1.5", h)}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kg">kg</SelectItem>
                <SelectItem value="lb">lb</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Field>
        )}
        <Field className="col-span-2" label="Tempo">
          <RowCell className={cn("text-xs", h)} placeholder="3-1-1" value={row.tempo} onCommit={(v) => setRow({ ...row, tempo: v ?? "" })} />
        </Field>
        <Field className={cn(loadMode === "none" ? "col-span-5" : "col-span-3")} label="Type">
          <Select value={row.time_profile ?? "accessory_compound"} onValueChange={(v) => setRow({ ...row, time_profile: v })}>
            <SelectTrigger className={cn("text-xs", h)}><SelectValue /></SelectTrigger>
            <SelectContent>{TIME_PROFILES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
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
      {expanded && loadMode === "none" && (
        <p className="text-[11px] text-muted-foreground italic">Client logs the load used — no target prescribed.</p>
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
    </div>
  );
}