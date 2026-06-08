import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Trash2, Save, Clock, Copy, LayoutGrid, CalendarRange, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  getTemplate, updateTemplate, summarizeTemplatePayload, TIME_PROFILES,
  estimateDayMinutes, durationRange, PERCENTAGE_BASES, type TrainingStyle,
} from "@/lib/pl-programs";
import { ExerciseLibraryPanel, type ExerciseRef, DND_EXERCISE, readDrop, movementAccent } from "@/components/program-builder";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";
import { useConflictWatch } from "@/hooks/use-conflict-watch";
import { AlertTriangle } from "lucide-react";
import { ActionButton } from "@/components/action-button";

// Append a row into the first day reachable inside any template payload shape.
function appendRowToFirstDay(payload: any, type: string, row: any) {
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
  const setP = (next: any) => { setPayload(next); setDirty(true); };

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
    <>
      <PageHeader
        backTo="/admin/program-library"
        backLabel="Back to Program Library"
        breadcrumbs={[{ label: "Program Library", to: "/admin/program-library" }, { label: meta.name || "Template" }]}
        title={meta.name || "Template"}
        subtitle={`${type.replace("_", " ")} · ${summary.weeks}w · ${summary.days}d · ${summary.rows} rows`}
      />
      <div className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/admin/program-library" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to library
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <SaveStatus state={autosave.state} savedAt={autosave.savedAt} />
            <ActionButton
              onAction={save}
              loadingLabel="Saving…"
              successLabel="Saved"
              successToast="Template saved"
              icon={<Save className="h-4 w-4" />}
            >
              {dirty ? "Save now" : "Saved"}
            </ActionButton>
          </div>
        </div>

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
          <TabsList>
            <TabsTrigger value="structure">Structure</TabsTrigger>
            <TabsTrigger value="meta">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="meta" className="mt-3">
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

          <TabsContent value="structure" className="mt-3">
            <div className="flex h-[calc(100vh-220px)] gap-2 overflow-hidden rounded-md border border-border">
              <ExerciseLibraryPanel
                exercises={exercises as ExerciseRef[]}
                onQuickAdd={(exId) => {
                  const ex = (exercises as any[]).find((e) => e.id === exId);
                  appendRowToFirstDay(payload, type, { exercise_id: exId, exercise_name_override: ex?.name });
                  setP({ ...payload });
                  toast.success("Added to first day");
                }}
                onPick={(exId) => {
                  const ex = (exercises as any[]).find((e) => e.id === exId);
                  // append to first day found
                  appendRowToFirstDay(payload, type, { exercise_id: exId, exercise_name_override: ex?.name });
                  setP({ ...payload });
                  toast.success("Added to first day — drag onto a specific day for placement");
                }}
              />
              <div className="flex-1 overflow-auto p-2">
                <StructureEditor type={type} payload={payload} setPayload={setP} exercises={exercises as any[]} />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

// ---------- Structure editing for the JSON payload ----------

function StructureEditor({ type, payload, setPayload, exercises }: { type: string; payload: any; setPayload: (p: any) => void; exercises: any[] }) {
  if (type === "full_prep") return <FullPrepEditor payload={payload} setPayload={setPayload} exercises={exercises} />;
  if (type === "block") return <BlockPayloadEditor weeksData={payload.weeks_data || []} setWeeksData={(wd) => setPayload({ ...payload, weeks_data: wd })} exercises={exercises} />;
  if (type === "week") return <WeekEditor week={payload} setWeek={setPayload} exercises={exercises} />;
  if (type === "day") return <DayEditor day={payload} setDay={setPayload} exercises={exercises} />;
  return (
    <Card className="p-4 max-w-3xl">
      <RowEditor row={payload} setRow={setPayload} exercises={exercises} />
    </Card>
  );
}

function FullPrepEditor({ payload, setPayload, exercises }: any) {
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
          />
        </Card>
      ))}
    </div>
  );
}

function BlockPayloadEditor({ weeksData, setWeeksData, exercises }: { weeksData: any[]; setWeeksData: (wd: any[]) => void; exercises: any[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [view, setView] = useState<"block" | "week">("block");
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
            />
          )}
        </>
      ) : (
        <div className="space-y-4">
          {weeksData.length > 0 && (
            <div className="sticky top-12 z-10 flex flex-wrap items-center gap-1.5 rounded-md border border-primary/20 bg-[color-mix(in_oklab,var(--primary)_6%,var(--background))] px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                Full Block · {weeksData.length} week{weeksData.length === 1 ? "" : "s"}
              </span>
              <div className="mx-2 h-4 w-px bg-border" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]">
                    <CalendarRange className="h-3 w-3" /> Jump to week <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
                  {weeksData.map((w: any, i: number) => (
                    <DropdownMenuItem key={i} onClick={() => jumpToWeek(i)} className="text-xs">Week {w.week_index}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={collapseAll} disabled={collapsed.size === weeksData.length}>
                <ChevronsDownUp className="h-3 w-3" /> Collapse all
              </Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={expandAll} disabled={collapsed.size === 0}>
                <ChevronsUpDown className="h-3 w-3" /> Expand all
              </Button>
            </div>
          )}
          {weeksData.length === 0 && (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No weeks yet. Click <em>Add week</em> to start.
            </p>
          )}
          {weeksData.map((w: any, wi: number) => {
            const isCollapsed = collapsed.has(wi);
            const s = weekStats[wi] ?? { days: 0, rows: 0, minutes: 0 };
            return (
              <Card
                key={wi}
                id={`tpl-week-${wi}`}
                className="overflow-hidden p-0 border-2 border-border"
                style={{ borderLeftWidth: 6, borderLeftColor: "var(--primary)" }}
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))] px-3 py-2">
                  <button
                    onClick={() => toggleCollapse(wi)}
                    className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-primary/10 hover:text-foreground"
                    title={isCollapsed ? "Expand week" : "Collapse week"}
                  >
                    {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <span className="inline-flex h-6 items-center rounded-md bg-primary px-2 text-[11px] font-bold uppercase tracking-wide text-primary-foreground">
                    Week {w.week_index}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {s.days} day{s.days === 1 ? "" : "s"} · {s.rows} row{s.rows === 1 ? "" : "s"} · Est {fmtDur(s.minutes)}
                  </span>
                  <Input
                    className="h-7 max-w-[200px] border-0 bg-transparent text-xs focus-visible:ring-1"
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
                {!isCollapsed && (
                  <div className="bg-[color-mix(in_oklab,var(--primary)_2%,transparent)] p-3">
                    <WeekEditor
                      week={w}
                      setWeek={(nw) => { const c = [...weeksData]; c[wi] = nw; setWeeksData(c); }}
                      exercises={exercises}
                      onCopyDayToFuture={(di) => copyDayToFuture(wi, di)}
                      hideHeader
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WeekEditor({ week, setWeek, exercises, onCopyDayToFuture, hideHeader }: { week: any; setWeek: (w: any) => void; exercises: any[]; onCopyDayToFuture?: (dayIdx: number) => void; hideHeader?: boolean }) {
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
        <Card key={i} className="p-3 border-l-[3px] border-l-primary/40">
          <div className="mb-2 flex items-center gap-2">
            <Input className="max-w-xs font-bold" value={d.title ?? ""} onChange={(e) => { const copy = [...days]; copy[i] = { ...d, title: e.target.value }; setWeek({ ...week, days: copy }); }} />
            <Input className="max-w-xs" placeholder="Focus" value={d.focus ?? ""} onChange={(e) => { const copy = [...days]; copy[i] = { ...d, focus: e.target.value }; setWeek({ ...week, days: copy }); }} />
            <div className="ml-auto flex gap-1">
              {onCopyDayToFuture && (
                <Button size="sm" variant="ghost" onClick={() => onCopyDayToFuture(i)} title="Copy this day → same day in future weeks">
                  <ArrowRight className="mr-1 h-3 w-3" /> → future
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => dupDay(i)} title="Duplicate"><Copy className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => delDay(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          <DayEditor day={d} setDay={(nd) => { const copy = [...days]; copy[i] = nd; setWeek({ ...week, days: copy }); }} exercises={exercises} />
        </Card>
      ))}
      {hideHeader && days.length > 0 && (
        <Button size="sm" variant="ghost" onClick={addDay}><Plus className="mr-1 h-3 w-3" /> Day</Button>
      )}
    </div>
  );
}

function DayEditor({ day, setDay, exercises }: { day: any; setDay: (d: any) => void; exercises: any[] }) {
  const rows = day.rows || [];
  const [dragOver, setDragOver] = useState(false);
  const addRow = () => setDay({ ...day, rows: [...rows, { sort_order: rows.length, sets: 3, reps_text: "8-12", time_profile: "accessory_compound" }] });
  const insertExercise = (exId: string, atIndex?: number) => {
    const ex = (exercises as any[]).find((x) => x.id === exId);
    const newRow = { sort_order: 0, sets: 3, reps_text: "8-12", time_profile: "accessory_compound", exercise_id: exId, exercise_name_override: ex?.name };
    const next = [...rows];
    const idx = atIndex ?? next.length;
    next.splice(idx, 0, newRow);
    setDay({ ...day, rows: next.map((r: any, i: number) => ({ ...r, sort_order: i })) });
  };
  const dayMin = useMemo(() => estimateDayMinutes(rows), [rows]);

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
        <Button size="sm" variant="outline" onClick={addRow}><Plus className="mr-1 h-3 w-3" /> Row</Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          {dragOver ? "Drop exercise here" : "Drag exercises from the library, or click + Row"}
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((r: any, i: number) => (
            <RowEditor
              key={i}
              row={r}
              setRow={(nr) => { const copy = [...rows]; copy[i] = nr; setDay({ ...day, rows: copy }); }}
              onDelete={() => setDay({ ...day, rows: rows.filter((_: any, j: number) => j !== i) })}
              exercises={exercises}
              compact
            />
          ))}
        </div>
      )}
      <Textarea className="mt-2" placeholder="Day notes" value={day.notes ?? ""} onChange={(e) => setDay({ ...day, notes: e.target.value })} rows={2} />
    </div>
  );
}

function RowEditor({ row, setRow, onDelete, exercises, compact }: { row: any; setRow: (r: any) => void; onDelete?: () => void; exercises: any[]; compact?: boolean }) {
  const exName = (exercises as any[]).find((e) => e.id === row.exercise_id)?.name ?? row.exercise_name_override ?? "";
  const accent = movementAccent(exName);
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-secondary/20 p-2 pl-3 space-y-1">
      <div className={`absolute left-0 top-0 h-full w-1.5 ${accent}`} aria-hidden />
      <div className="grid grid-cols-12 items-center gap-1">
        <div className="col-span-4">
        <Select value={row.exercise_id ?? "__custom"} onValueChange={(v) => setRow({ ...row, exercise_id: v === "__custom" ? null : v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Exercise" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__custom">— Custom name —</SelectItem>
            {(exercises as any[]).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {!row.exercise_id && (
          <Input className="mt-1 h-7 text-xs" placeholder="Custom name" value={row.exercise_name_override ?? ""} onChange={(e) => setRow({ ...row, exercise_name_override: e.target.value })} />
        )}
      </div>
        <Input className="col-span-1 h-8 text-xs" inputMode="numeric" placeholder="Sets" value={row.sets ?? ""} onChange={(e) => setRow({ ...row, sets: parseInt(e.target.value) || null })} />
        <Input className="col-span-2 h-8 text-xs" placeholder="Reps" value={row.reps_text ?? ""} onChange={(e) => setRow({ ...row, reps_text: e.target.value })} />
        <Input className="col-span-1 h-8 text-xs" inputMode="decimal" placeholder="RPE" value={row.rpe ?? ""} onChange={(e) => setRow({ ...row, rpe: e.target.value })} />
        <Input className="col-span-1 h-8 text-xs" inputMode="decimal" placeholder="RIR" value={row.rir ?? ""} onChange={(e) => setRow({ ...row, rir: e.target.value })} />
        <Input className="col-span-1 h-8 text-xs" inputMode="numeric" placeholder="Rest s" value={row.rest_seconds ?? ""} onChange={(e) => setRow({ ...row, rest_seconds: parseInt(e.target.value) || null })} />
        <div className="col-span-2 flex justify-end gap-1">
          {onDelete && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
        </div>
      </div>
      <div className="grid grid-cols-12 items-center gap-1">
        <Select value={row.percentage_basis ?? "manual"} onValueChange={(v) => setRow({ ...row, percentage_basis: v })}>
          <SelectTrigger className="col-span-3 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{PERCENTAGE_BASES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="col-span-1 h-8 text-xs" inputMode="decimal" placeholder="%" value={row.percentage ?? ""} onChange={(e) => setRow({ ...row, percentage: parseFloat(e.target.value) || null })} />
        <Input className="col-span-2 h-8 text-xs" inputMode="decimal" placeholder="Load kg" value={row.load_kg ?? ""} onChange={(e) => setRow({ ...row, load_kg: parseFloat(e.target.value) || null })} />
        <Input className="col-span-2 h-8 text-xs" placeholder="Tempo 3-1-1" value={row.tempo ?? ""} onChange={(e) => setRow({ ...row, tempo: e.target.value })} />
        <Select value={row.time_profile ?? "accessory_compound"} onValueChange={(v) => setRow({ ...row, time_profile: v })}>
          <SelectTrigger className="col-span-4 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{TIME_PROFILES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}