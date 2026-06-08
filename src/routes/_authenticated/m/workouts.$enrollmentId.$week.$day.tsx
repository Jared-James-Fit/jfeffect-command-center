import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { completeWorkout, uncompleteWorkout, logSet } from "@/lib/member-plans.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";

export const Route = createFileRoute("/_authenticated/m/workouts/$enrollmentId/$week/$day")({ component: WorkoutTracker });

type SetLog = { reps?: number | null; load_lb?: number | null; rpe?: number | null; rir?: number | null; notes?: string | null };

function WorkoutTracker() {
  const { enrollmentId, week, day } = Route.useParams();
  const weekIndex = Number(week), dayIndex = Number(day);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const completeFn = useServerFn(completeWorkout);
  const uncompleteFn = useServerFn(uncompleteWorkout);
  const logFn = useServerFn(logSet);
  const [notes, setNotes] = useState("");
  const [logs, setLogs] = useState<Record<string, SetLog>>({});

  const { data: enr } = useQuery({
    queryKey: ["m-enrollment", enrollmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plan_enrollments").select("*, member_plans(*)")
        .eq("id", enrollmentId).maybeSingle();
      return data as any;
    },
  });

  const { data: completion } = useQuery({
    queryKey: ["m-completion", enrollmentId, weekIndex, dayIndex],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_workout_completions").select("*")
        .eq("enrollment_id", enrollmentId).eq("week_index", weekIndex).eq("day_index", dayIndex).maybeSingle();
      return data;
    },
  });

  const { data: existingLogs = [] } = useQuery({
    queryKey: ["m-set-logs", enrollmentId, weekIndex, dayIndex],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_set_logs").select("*")
        .eq("enrollment_id", enrollmentId).eq("week_index", weekIndex).eq("day_index", dayIndex);
      return (data ?? []) as any[];
    },
  });

  useEffect(() => {
    const map: Record<string, SetLog> = {};
    for (const l of existingLogs as any[]) {
      map[`${l.exercise_index}:${l.set_index}`] = { reps: l.reps, load_lb: l.load_lb, rpe: l.rpe, rir: l.rir, notes: l.notes };
    }
    setLogs(map);
  }, [existingLogs]);

  if (!enr) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const plan = enr.member_plans;
  const dayObj = plan?.published_payload?.weeks_data?.[weekIndex - 1]?.days?.[dayIndex - 1];
  const rows: any[] = dayObj?.rows ?? [];
  const loggingEnabled = plan?.logging_enabled !== false;
  const isComplete = !!completion;

  const updateLog = (key: string, patch: Partial<SetLog>) => setLogs((m) => ({ ...m, [key]: { ...m[key], ...patch } }));

  const saveLog = async (exerciseIndex: number, setIndex: number) => {
    const key = `${exerciseIndex}:${setIndex}`;
    const v = logs[key] ?? {};
    await logFn({ data: { enrollmentId, weekIndex, dayIndex, exerciseIndex, setIndex,
      reps: v.reps ?? null, load_lb: v.load_lb ?? null, rpe: v.rpe ?? null, rir: v.rir ?? null, notes: v.notes ?? null } });
  };

  const handleComplete = async () => {
    await completeFn({ data: { enrollmentId, weekIndex, dayIndex, notes } });
    qc.invalidateQueries({ queryKey: ["m-completion", enrollmentId, weekIndex, dayIndex] });
    qc.invalidateQueries({ queryKey: ["m-completions", enrollmentId] });
    qc.invalidateQueries({ queryKey: ["m-enrollment", enrollmentId] });
  };

  const handleUncomplete = async () => {
    await uncompleteFn({ data: { enrollmentId, weekIndex, dayIndex } });
    qc.invalidateQueries({ queryKey: ["m-completion", enrollmentId, weekIndex, dayIndex] });
    qc.invalidateQueries({ queryKey: ["m-completions", enrollmentId] });
    qc.invalidateQueries({ queryKey: ["m-enrollment", enrollmentId] });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={dayObj?.title || `Week ${weekIndex} · Day ${dayIndex}`}
        subtitle={plan?.name}
        actions={isComplete ? <Badge>Complete</Badge> : null}
      />
      {rows.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">No exercises configured for this workout.</Card>
      )}
      {rows.map((row: any, ei: number) => {
        const setCount = Math.max(1, Number(row.sets) || 1);
        return (
          <Card key={ei} className="p-4">
            <div className="font-semibold">{row.exercise || row.name || `Exercise ${ei + 1}`}</div>
            <div className="text-xs text-muted-foreground">
              {row.sets ? `${row.sets} sets` : ""}{row.reps ? ` · ${row.reps} reps` : ""}{row.rpe ? ` · RPE ${row.rpe}` : ""}{row.rir ? ` · RIR ${row.rir}` : ""}{row.rest ? ` · rest ${row.rest}` : ""}
            </div>
            {row.notes && <div className="mt-1 text-xs text-muted-foreground">{row.notes}</div>}
            {loggingEnabled && (
              <div className="mt-3 space-y-2">
                {Array.from({ length: setCount }, (_, si) => {
                  const key = `${ei}:${si}`;
                  const v = logs[key] ?? {};
                  return (
                    <div key={si} className="grid grid-cols-12 items-center gap-1.5">
                      <div className="col-span-1 text-xs text-muted-foreground">#{si + 1}</div>
                      <Input className="col-span-3" placeholder="lbs" type="number" value={v.load_lb ?? ""} onChange={(e) => updateLog(key, { load_lb: e.target.value === "" ? null : Number(e.target.value) })} />
                      <Input className="col-span-2" placeholder="reps" type="number" value={v.reps ?? ""} onChange={(e) => updateLog(key, { reps: e.target.value === "" ? null : Number(e.target.value) })} />
                      <Input className="col-span-2" placeholder="RPE" type="number" step="0.5" value={v.rpe ?? ""} onChange={(e) => updateLog(key, { rpe: e.target.value === "" ? null : Number(e.target.value) })} />
                      <Input className="col-span-2" placeholder="RIR" type="number" value={v.rir ?? ""} onChange={(e) => updateLog(key, { rir: e.target.value === "" ? null : Number(e.target.value) })} />
                      <ActionButton
                        size="icon"
                        variant="ghost"
                        className="col-span-2"
                        onAction={() => saveLog(ei, si)}
                        title="Save set"
                        successToast={false}
                      >
                        <Save className="h-4 w-4" />
                      </ActionButton>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
      <Card className="p-4">
        <Textarea placeholder="Notes for this workout (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="mt-3 flex gap-2">
          {isComplete
            ? <Button variant="outline" onClick={handleUncomplete}>Mark incomplete</Button>
            : <ActionButton onAction={handleComplete} loadingLabel="Saving…" successLabel="Complete" successToast="Workout complete" icon={<CheckCircle2 className="h-4 w-4" />}>Mark workout complete</ActionButton>}
          <Button variant="ghost" onClick={() => navigate({ to: "/m/my-plans/$enrollmentId", params: { enrollmentId } })}>Back to plan</Button>
        </div>
      </Card>
    </div>
  );
}