import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Trash2, Copy, Save, Clock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  getBlockTree, addDay, addRow, updateRow, deleteRow, updateDay,
  estimateDayMinutes, durationRange, TIME_PROFILES, PERCENTAGE_BASES,
  saveBlockAsTemplate, type TimeProfile, type PercentageBasis, type TrainingStyle,
} from "@/lib/pl-programs";

export const Route = createFileRoute("/_authenticated/admin/blocks/$blockId")({ component: BlockEditor });

function BlockEditor() {
  const { blockId } = Route.useParams();
  const qc = useQueryClient();
  const [activeWeek, setActiveWeek] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);

  const { data: tree, isLoading } = useQuery({
    queryKey: ["pl-block-tree", blockId],
    queryFn: () => getBlockTree(blockId),
  });

  const { data: exercises = [] } = useQuery({
    queryKey: ["exercises-min"],
    queryFn: async () => (await supabase.from("exercises").select("id, name").order("name")).data ?? [],
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["pl-block-tree", blockId] });

  if (isLoading || !tree) return <div className="p-8 text-sm text-muted-foreground">Loading block…</div>;
  const { block, weeks, days, rows } = tree;
  const currentWeekId = activeWeek ?? weeks[0]?.id;

  return (
    <>
      <PageHeader title={block.name} subtitle={`${block.weeks} week block · ${block.training_focus ?? "—"}`} />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/admin/client-programs/$clientId" params={{ clientId: block.client_id }} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to client programs
          </Link>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setTplOpen(true)}><Save className="mr-1 h-4 w-4" /> Save Block as Template</Button>
          </div>
        </div>

        <Tabs value={currentWeekId} onValueChange={setActiveWeek}>
          <TabsList className="flex-wrap">
            {weeks.map((w: any) => (
              <TabsTrigger key={w.id} value={w.id}>Week {w.week_index}</TabsTrigger>
            ))}
          </TabsList>

          {weeks.map((w: any) => {
            const weekDays = days.filter((d: any) => d.week_id === w.id);
            return (
              <TabsContent key={w.id} value={w.id} className="space-y-4">
                {weekDays.map((d: any) => {
                  const dayRows = rows.filter((r: any) => r.day_id === d.id);
                  return (
                    <DayCard key={d.id} day={d} rows={dayRows} exercises={exercises as any[]} onChange={refresh} />
                  );
                })}
                <Button variant="outline" size="sm" onClick={async () => {
                  await addDay(w.id, weekDays.length + 1, `Day ${weekDays.length + 1}`);
                  refresh();
                }}>
                  <Plus className="mr-1 h-4 w-4" /> Add Day
                </Button>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>

      <SaveAsTemplateDialog open={tplOpen} onOpenChange={setTplOpen} blockId={blockId} defaultName={block.name} />
    </>
  );
}

function DayCard({ day, rows, exercises, onChange }: { day: any; rows: any[]; exercises: any[]; onChange: () => void }) {
  const auto = estimateDayMinutes(rows);
  const shownMinutes = day.duration_source === "manual" && day.duration_override_min ? day.duration_override_min : auto;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Input value={day.title ?? ""} onChange={(e) => updateDay(day.id, { title: e.target.value }).then(onChange)} className="w-56 font-bold" placeholder={`Day ${day.day_index}`} />
          <Input value={day.focus ?? ""} onChange={(e) => updateDay(day.id, { focus: e.target.value }).then(onChange)} className="w-48" placeholder="Focus (e.g. Squat + Bench)" />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <Badge variant="outline">{durationRange(shownMinutes)}</Badge>
          <Badge variant="secondary" className="text-[10px]">{day.duration_source === "manual" ? "Manual" : "Auto"}</Badge>
          {day.duration_source === "manual" && (
            <Button size="sm" variant="ghost" onClick={() => updateDay(day.id, { duration_source: "auto", duration_override_min: null, duration_estimate_min: auto }).then(onChange)}>
              <RotateCcw className="mr-1 h-3 w-3" /> Clear
            </Button>
          )}
          <Input type="number" placeholder="Override min" className="w-28" value={day.duration_override_min ?? ""} onChange={(e) => {
            const v = parseInt(e.target.value);
            if (Number.isFinite(v)) updateDay(day.id, { duration_override_min: v, duration_source: "manual" }).then(onChange);
          }} />
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-1 text-left">Exercise</th>
              <th className="p-1">Sets</th>
              <th className="p-1">Reps</th>
              <th className="p-1">RPE</th>
              <th className="p-1">RIR</th>
              <th className="p-1">% / Basis</th>
              <th className="p-1">Load</th>
              <th className="p-1">Rest (s)</th>
              <th className="p-1">Tempo</th>
              <th className="p-1">Profile</th>
              <th className="p-1 text-left">Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <RowEditor key={r.id} row={r} exercises={exercises} onChange={onChange} />
            ))}
          </tbody>
        </table>
      </div>

      <Button size="sm" variant="outline" className="mt-2" onClick={async () => { await addRow(day.id, rows.length); onChange(); }}>
        <Plus className="mr-1 h-4 w-4" /> Add Exercise
      </Button>
    </Card>
  );
}

function RowEditor({ row, exercises, onChange }: { row: any; exercises: any[]; onChange: () => void }) {
  const [local, setLocal] = useState(row);
  const save = async (patch: any) => {
    const merged = { ...local, ...patch };
    setLocal(merged);
    try { await updateRow(row.id, patch); onChange(); }
    catch (e: any) { toast.error(e.message); }
  };
  return (
    <tr className="border-t border-border">
      <td className="p-1 min-w-[180px]">
        <Select value={local.exercise_id ?? "custom"} onValueChange={(v) => save({ exercise_id: v === "custom" ? null : v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick exercise" /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="custom">— Custom name —</SelectItem>
            {exercises.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {!local.exercise_id && (
          <Input className="h-7 mt-1 text-xs" placeholder="Custom name" value={local.exercise_name_override ?? ""} onChange={(e) => setLocal({ ...local, exercise_name_override: e.target.value })} onBlur={(e) => save({ exercise_name_override: e.target.value })} />
        )}
      </td>
      <td className="p-1"><Input className="h-8 w-14 text-xs" type="number" value={local.sets ?? ""} onChange={(e) => setLocal({ ...local, sets: parseInt(e.target.value) || null })} onBlur={(e) => save({ sets: parseInt(e.target.value) || null })} /></td>
      <td className="p-1"><Input className="h-8 w-20 text-xs" value={local.reps_text ?? ""} placeholder="8 or 8-12" onChange={(e) => setLocal({ ...local, reps_text: e.target.value })} onBlur={(e) => save({ reps_text: e.target.value })} /></td>
      <td className="p-1"><Input className="h-8 w-16 text-xs" value={local.rpe ?? ""} placeholder="8" onChange={(e) => setLocal({ ...local, rpe: e.target.value })} onBlur={(e) => save({ rpe: e.target.value })} /></td>
      <td className="p-1"><Input className="h-8 w-16 text-xs" value={local.rir ?? ""} placeholder="2" onChange={(e) => setLocal({ ...local, rir: e.target.value })} onBlur={(e) => save({ rir: e.target.value })} /></td>
      <td className="p-1">
        <div className="flex gap-1">
          <Input className="h-8 w-16 text-xs" type="number" value={local.percentage ?? ""} placeholder="80" onChange={(e) => setLocal({ ...local, percentage: parseFloat(e.target.value) || null })} onBlur={(e) => save({ percentage: parseFloat(e.target.value) || null })} />
          <Select value={local.percentage_basis ?? "manual"} onValueChange={(v) => save({ percentage_basis: v as PercentageBasis })}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{PERCENTAGE_BASES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </td>
      <td className="p-1"><Input className="h-8 w-20 text-xs" type="number" value={local.load_kg ?? ""} placeholder="kg" onChange={(e) => setLocal({ ...local, load_kg: parseFloat(e.target.value) || null })} onBlur={(e) => save({ load_kg: parseFloat(e.target.value) || null })} /></td>
      <td className="p-1"><Input className="h-8 w-20 text-xs" type="number" value={local.rest_seconds ?? ""} placeholder="180" onChange={(e) => setLocal({ ...local, rest_seconds: parseInt(e.target.value) || null })} onBlur={(e) => save({ rest_seconds: parseInt(e.target.value) || null })} /></td>
      <td className="p-1"><Input className="h-8 w-20 text-xs" value={local.tempo ?? ""} placeholder="3-1-1" onChange={(e) => setLocal({ ...local, tempo: e.target.value })} onBlur={(e) => save({ tempo: e.target.value })} /></td>
      <td className="p-1">
        <Select value={local.time_profile ?? "accessory_compound"} onValueChange={(v) => save({ time_profile: v as TimeProfile })}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{TIME_PROFILES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="p-1 min-w-[160px]"><Input className="h-8 text-xs" value={local.notes ?? ""} onChange={(e) => setLocal({ ...local, notes: e.target.value })} onBlur={(e) => save({ notes: e.target.value })} /></td>
      <td className="p-1">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => { await deleteRow(row.id); onChange(); }}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </td>
    </tr>
  );
}

function SaveAsTemplateDialog({ open, onOpenChange, blockId, defaultName }: any) {
  const [name, setName] = useState(defaultName ?? "");
  const [style, setStyle] = useState<TrainingStyle>("powerlifting");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save Block as Template</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Template Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Training Style</Label>
            <Select value={style} onValueChange={(v) => setStyle(v as TrainingStyle)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="powerlifting">Powerlifting</SelectItem>
                <SelectItem value="bodybuilding">Bodybuilding / Hypertrophy</SelectItem>
                <SelectItem value="strength">Strength</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
                <SelectItem value="lifestyle">Lifestyle</SelectItem>
                <SelectItem value="rehab">Rehab / Pivot</SelectItem>
                <SelectItem value="conditioning">Conditioning</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => {
            try {
              await saveBlockAsTemplate(blockId, name, style);
              toast.success("Saved to Program Library");
              onOpenChange(false);
            } catch (e: any) { toast.error(e.message); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}