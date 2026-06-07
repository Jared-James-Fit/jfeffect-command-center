import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { durationRange } from "@/lib/pl-programs";

export const Route = createFileRoute("/_authenticated/portal/workouts/$dayId")({ component: WorkoutDay });

const sb = supabase as any;

function WorkoutDay() {
  const { dayId } = Route.useParams();
  const portalUserId = usePortalUserId();
  const qc = useQueryClient();

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("id").eq("user_id", portalUserId!).maybeSingle()).data,
  });

  const { data: day } = useQuery({
    queryKey: ["pl-day", dayId],
    queryFn: async () => (await sb.from("pl_days").select("*").eq("id", dayId).maybeSingle()).data,
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["pl-day-rows", dayId],
    queryFn: async () => (await sb.from("pl_exercise_rows").select("*, exercises(id,name,video_url,vimeo_embed_url,thumbnail_url,cues)").eq("day_id", dayId).order("sort_order")).data ?? [],
  });

  const { data: results = [] } = useQuery({
    queryKey: ["pl-day-results", dayId, client?.id],
    enabled: !!client?.id && (rows as any[]).length > 0,
    queryFn: async () => {
      const rowIds = (rows as any[]).map((r) => r.id);
      if (!rowIds.length) return [];
      return (await sb.from("pl_row_results").select("*").in("row_id", rowIds).eq("client_id", client!.id)).data ?? [];
    },
  });

  const { data: completion } = useQuery({
    queryKey: ["pl-day-completion", dayId, client?.id],
    enabled: !!client?.id,
    queryFn: async () => (await sb.from("pl_day_completions").select("*").eq("day_id", dayId).eq("client_id", client!.id).maybeSingle()).data,
  });

  const [notes, setNotes] = useState("");
  const [actualMin, setActualMin] = useState<string>("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pl-day-results", dayId] });
    qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
  };

  if (!day) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <>
      <PageHeader title={day.title || `Day ${day.day_index}`} subtitle={day.focus ?? ""} />
      <div className="p-4 md:p-8 space-y-4">
        <Link to="/portal/workouts" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> All workouts
        </Link>

        <div className="flex items-center gap-2">
          <Badge variant="outline"><Clock className="mr-1 h-3 w-3" /> {durationRange(day.duration_override_min ?? day.duration_estimate_min ?? 60)}</Badge>
          {completion && <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10"><CheckCircle2 className="mr-1 h-3 w-3" /> Completed</Badge>}
        </div>

        {day.notes && <Card className="p-4 text-sm whitespace-pre-wrap bg-secondary/30">{day.notes}</Card>}

        <div className="space-y-3">
          {(rows as any[]).map((r) => (
            <ExerciseBlock key={r.id} row={r} clientId={client?.id} existingResults={(results as any[]).filter((x) => x.row_id === r.id)} onChange={refresh} />
          ))}
        </div>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-bold">Workout Notes</div>
          <Textarea value={notes || (completion?.client_notes ?? "")} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel? Any pain, PRs, surprises?" />
          <div className="flex items-center gap-2">
            <Input type="number" className="w-32" placeholder="Actual min" value={actualMin || (completion?.actual_duration_min?.toString() ?? "")} onChange={(e) => setActualMin(e.target.value)} />
            <Button onClick={async () => {
              if (!client?.id) return;
              try {
                const payload = { day_id: dayId, client_id: client.id, client_notes: notes || completion?.client_notes || null, actual_duration_min: actualMin ? parseInt(actualMin) : (completion?.actual_duration_min ?? null), completed_at: new Date().toISOString() };
                if (completion) await sb.from("pl_day_completions").update(payload).eq("id", completion.id);
                else await sb.from("pl_day_completions").insert(payload);
                toast.success("Workout marked complete");
                refresh();
              } catch (e: any) { toast.error(e.message); }
            }}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Mark Workout Complete
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

function ExerciseBlock({ row, clientId, existingResults, onChange }: { row: any; clientId: string | undefined; existingResults: any[]; onChange: () => void }) {
  const name = row.exercises?.name ?? row.exercise_name_override ?? "Exercise";
  const video = row.exercises?.video_url ?? row.exercises?.vimeo_embed_url ?? null;
  const setCount = Math.max(1, row.sets ?? 1);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold">{name}</div>
          <div className="text-xs text-muted-foreground">
            {row.sets ?? "?"} × {row.reps_text ?? "?"}
            {row.rpe && ` @ RPE ${row.rpe}`}
            {row.rir && ` · ${row.rir} RIR`}
            {row.percentage && ` · ${row.percentage}%`}
            {row.load_kg && ` · ${row.load_kg} kg`}
            {row.tempo && ` · tempo ${row.tempo}`}
            {row.rest_seconds && ` · rest ${row.rest_seconds}s`}
          </div>
          {row.notes && <p className="mt-1 text-xs text-muted-foreground italic">{row.notes}</p>}
        </div>
        {video && <a href={video} target="_blank" rel="noreferrer"><Button size="sm" variant="outline">Demo <ExternalLink className="ml-1 h-3 w-3" /></Button></a>}
      </div>

      <div className="mt-3 space-y-2">
        {Array.from({ length: setCount }).map((_, i) => {
          const existing = existingResults.find((x) => x.set_index === i + 1);
          return <SetRow key={i} rowId={row.id} clientId={clientId} setIndex={i + 1} existing={existing} onChange={onChange} />;
        })}
      </div>
    </Card>
  );
}

function SetRow({ rowId, clientId, setIndex, existing, onChange }: { rowId: string; clientId: string | undefined; setIndex: number; existing?: any; onChange: () => void }) {
  const [load, setLoad] = useState(existing?.actual_load?.toString() ?? "");
  const [reps, setReps] = useState(existing?.actual_reps?.toString() ?? "");
  const [rpe, setRpe] = useState(existing?.actual_rpe ?? "");

  const save = async () => {
    if (!clientId) return;
    const payload = { row_id: rowId, client_id: clientId, set_index: setIndex, actual_load: load ? parseFloat(load) : null, actual_reps: reps ? parseInt(reps) : null, actual_rpe: rpe || null, completed_at: new Date().toISOString() };
    try {
      if (existing) await sb.from("pl_row_results").update(payload).eq("id", existing.id);
      else await sb.from("pl_row_results").insert(payload);
      onChange();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 font-mono text-muted-foreground">Set {setIndex}</span>
      <Input className="h-8 w-20" placeholder="Load" value={load} onChange={(e) => setLoad(e.target.value)} onBlur={save} />
      <Input className="h-8 w-16" placeholder="Reps" value={reps} onChange={(e) => setReps(e.target.value)} onBlur={save} />
      <Input className="h-8 w-16" placeholder="RPE" value={rpe} onChange={(e) => setRpe(e.target.value)} onBlur={save} />
      {existing?.completed_at && <CheckCircle2 className="h-4 w-4 text-green-500" />}
    </div>
  );
}