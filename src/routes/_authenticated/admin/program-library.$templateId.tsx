import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { ArrowLeft, Plus, Trash2, Save, Clock, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  getTemplate, updateTemplate, summarizeTemplatePayload, TIME_PROFILES,
  estimateDayMinutes, durationRange, PERCENTAGE_BASES, type TrainingStyle,
} from "@/lib/pl-programs";

export const Route = createFileRoute("/_authenticated/admin/program-library/$templateId")({
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
    queryFn: async () => (await supabase.from("exercises").select("id, name").order("name")).data ?? [],
  });

  // local working state
  const [meta, setMeta] = useState<any>(null);
  const [payload, setPayload] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tpl && !meta) {
      setMeta({
        name: tpl.name, training_style: tpl.training_style, training_focus: tpl.training_focus ?? "",
        notes: tpl.notes ?? "", weeks: tpl.weeks ?? 0, days_per_week: tpl.days_per_week ?? 0,
        est_duration_min: tpl.est_duration_min ?? 0, tags: (tpl.tags ?? []).join(", "), status: tpl.status,
      });
      setPayload(JSON.parse(JSON.stringify(tpl.payload || {})));
    }
  }, [tpl]);

  if (isLoading || !tpl || !meta || !payload) return <div className="p-8 text-sm text-muted-foreground">Loading template…</div>;

  const summary = summarizeTemplatePayload({ ...tpl, payload });
  const type = tpl.template_type;

  const setM = (patch: any) => { setMeta({ ...meta, ...patch }); setDirty(true); };
  const setP = (next: any) => { setPayload(next); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      await updateTemplate(templateId, {
        ...meta,
        tags: meta.tags.split(",").map((s: string) => s.trim()).filter(Boolean),
        weeks: meta.weeks || null, days_per_week: meta.days_per_week || null,
        est_duration_min: meta.est_duration_min || null,
        training_focus: meta.training_focus || null, notes: meta.notes || null,
        payload,
      });
      toast.success("Saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["pl-template", templateId] });
      qc.invalidateQueries({ queryKey: ["pl-templates"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader title={meta.name || "Template"} subtitle={`${type.replace("_", " ")} · ${summary.weeks}w · ${summary.days}d · ${summary.rows} rows`} />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/admin/program-library" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to library
          </Link>
          <div className="ml-auto">
            <Button onClick={save} disabled={!dirty || saving}>
              <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
          </div>
        </div>

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
            <StructureEditor type={type} payload={payload} setPayload={setP} exercises={exercises as any[]} />
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
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {weeksData.map((w: any, i: number) => (
          <button key={i} onClick={() => setActiveIdx(i)} className={`rounded-md border px-2 py-1 text-xs ${activeIdx === i ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
            Week {w.week_index}
          </button>
        ))}
        <Button size="sm" variant="ghost" onClick={addWeek}><Plus className="h-3 w-3" /></Button>
        {weeksData[activeIdx] && (
          <>
            <Button size="sm" variant="ghost" onClick={() => dupWeek(activeIdx)} title="Duplicate week"><Copy className="h-3 w-3" /></Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => delWeek(activeIdx)} title="Delete week"><Trash2 className="h-3 w-3" /></Button>
          </>
        )}
      </div>
      {weeksData[activeIdx] && (
        <WeekEditor
          week={weeksData[activeIdx]}
          setWeek={(w) => { const copy = [...weeksData]; copy[activeIdx] = w; setWeeksData(copy); }}
          exercises={exercises}
        />
      )}
    </div>
  );
}

function WeekEditor({ week, setWeek, exercises }: { week: any; setWeek: (w: any) => void; exercises: any[] }) {
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
      <div className="flex items-center gap-2">
        <Input className="max-w-xs" placeholder="Week notes" value={week.notes ?? ""} onChange={(e) => setWeek({ ...week, notes: e.target.value })} />
        <Button size="sm" variant="outline" onClick={addDay}><Plus className="mr-1 h-3 w-3" /> Day</Button>
      </div>
      {days.map((d: any, i: number) => (
        <Card key={i} className="p-3">
          <div className="mb-2 flex items-center gap-2">
            <Input className="max-w-xs font-bold" value={d.title ?? ""} onChange={(e) => { const copy = [...days]; copy[i] = { ...d, title: e.target.value }; setWeek({ ...week, days: copy }); }} />
            <Input className="max-w-xs" placeholder="Focus" value={d.focus ?? ""} onChange={(e) => { const copy = [...days]; copy[i] = { ...d, focus: e.target.value }; setWeek({ ...week, days: copy }); }} />
            <div className="ml-auto flex gap-1">
              <Button size="icon" variant="ghost" onClick={() => dupDay(i)} title="Duplicate"><Copy className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => delDay(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          <DayEditor day={d} setDay={(nd) => { const copy = [...days]; copy[i] = nd; setWeek({ ...week, days: copy }); }} exercises={exercises} />
        </Card>
      ))}
    </div>
  );
}

function DayEditor({ day, setDay, exercises }: { day: any; setDay: (d: any) => void; exercises: any[] }) {
  const rows = day.rows || [];
  const addRow = () => setDay({ ...day, rows: [...rows, { sort_order: rows.length, sets: 3, reps_text: "8-12", time_profile: "accessory_compound" }] });
  const dayMin = useMemo(() => estimateDayMinutes(rows), [rows]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Est {durationRange(dayMin)}</span>
        <Button size="sm" variant="outline" onClick={addRow}><Plus className="mr-1 h-3 w-3" /> Row</Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">No exercises yet.</p>
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
  const ex = (exercises as any[]).find((e) => e.id === row.exercise_id);
  return (
    <div className={`grid items-center gap-1 rounded-md border border-border bg-secondary/20 p-2 ${compact ? "grid-cols-12" : "grid-cols-6"}`}>
      <div className={compact ? "col-span-3" : "col-span-3"}>
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
      <Input className="col-span-1 h-8 text-xs" inputMode="decimal" placeholder="%" value={row.percentage ?? ""} onChange={(e) => setRow({ ...row, percentage: parseFloat(e.target.value) || null })} />
      <Input className="col-span-1 h-8 text-xs" inputMode="numeric" placeholder="Rest" value={row.rest_seconds ?? ""} onChange={(e) => setRow({ ...row, rest_seconds: parseInt(e.target.value) || null })} />
      <Select value={row.time_profile ?? "accessory_compound"} onValueChange={(v) => setRow({ ...row, time_profile: v })}>
        <SelectTrigger className="col-span-2 h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{TIME_PROFILES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
      </Select>
      <div className="col-span-1 flex justify-end">
        {onDelete && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
      <Textarea className="col-span-12 h-12 text-xs" placeholder="Notes / tempo" value={row.notes ?? ""} onChange={(e) => setRow({ ...row, notes: e.target.value })} />
    </div>
  );
}