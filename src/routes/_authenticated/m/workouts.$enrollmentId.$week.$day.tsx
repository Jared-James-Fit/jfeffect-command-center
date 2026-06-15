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
import { TrainingHelpButton } from "@/components/training-help-sheet";
import { WorkoutEmptyCard } from "@/components/workout-empty-state";
import { runJob } from "@/lib/progress-jobs";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { writeSetEditAudit } from "@/lib/logged-set-audit";
import { WorkoutUndoProvider, useWorkoutUndo, UndoButton } from "@/lib/workout-undo";
import { WorkoutSyncBanner } from "@/components/workout-sync-banner";
import {
  enqueueOfflineWrite,
  registerQueueHandler,
} from "@/lib/workout-offline-queue";
import { writePlanCache, cachedInitialData } from "@/lib/workout-plan-cache";

export const Route = createFileRoute("/_authenticated/m/workouts/$enrollmentId/$week/$day")({
  component: () => (
    <WorkoutUndoProvider>
      <WorkoutTracker />
    </WorkoutUndoProvider>
  ),
});

type SetLog = { reps?: number | null; load_lb?: number | null; rpe?: number | null; rir?: number | null; notes?: string | null };

function WorkoutTracker() {
  const { enrollmentId, week, day } = Route.useParams();
  const weekIndex = Number(week), dayIndex = Number(day);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const completeFn = useServerFn(completeWorkout);
  const uncompleteFn = useServerFn(uncompleteWorkout);
  const logFn = useServerFn(logSet);
  const { user } = useAuth();
  const { isImpersonating, client: povClient } = useClientImpersonation();
  const undo = useWorkoutUndo();
  const [notes, setNotes] = useState("");
  const [logs, setLogs] = useState<Record<string, SetLog>>({});

  const cacheScope = `m:${enrollmentId}`;
  const route = `/m/workouts/${enrollmentId}/${week}/${day}`;

  // Register offline handlers once. These are the queue's only access to the
  // server fns — saveLog() etc. push payloads here instead of calling RPC
  // directly, so a flaky connection never loses data.
  useEffect(() => {
    registerQueueHandler("m_log_set", async (payload: any) => { await logFn({ data: payload }); });
    registerQueueHandler("m_complete_workout", async (payload: any) => { await completeFn({ data: payload }); });
    registerQueueHandler("m_uncomplete_workout", async (payload: any) => { await uncompleteFn({ data: payload }); });
  }, [logFn, completeFn, uncompleteFn]);

  const { data: enr, isError: enrError, isSuccess: enrLoaded, refetch: refetchEnr } = useQuery({
    queryKey: ["m-enrollment", enrollmentId],
    initialData: cachedInitialData<any>(cacheScope, "enrollment"),
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plan_enrollments").select("*, member_plans(*)")
        .eq("id", enrollmentId).maybeSingle();
      if (data) writePlanCache(cacheScope, "enrollment", data);
      return data as any;
    },
  });

  const { data: completion } = useQuery({
    queryKey: ["m-completion", enrollmentId, weekIndex, dayIndex],
    initialData: cachedInitialData<any>(cacheScope, `completion:${weekIndex}:${dayIndex}`),
    queryFn: async () => {
      const { data } = await supabase
        .from("member_workout_completions").select("*")
        .eq("enrollment_id", enrollmentId).eq("week_index", weekIndex).eq("day_index", dayIndex).maybeSingle();
      writePlanCache(cacheScope, `completion:${weekIndex}:${dayIndex}`, data);
      return data;
    },
  });

  const { data: existingLogs = [] } = useQuery({
    queryKey: ["m-set-logs", enrollmentId, weekIndex, dayIndex],
    initialData: cachedInitialData<any[]>(cacheScope, `set-logs:${weekIndex}:${dayIndex}`),
    queryFn: async () => {
      const { data } = await supabase
        .from("member_set_logs").select("*")
        .eq("enrollment_id", enrollmentId).eq("week_index", weekIndex).eq("day_index", dayIndex);
      const out = (data ?? []) as any[];
      writePlanCache(cacheScope, `set-logs:${weekIndex}:${dayIndex}`, out);
      return out;
    },
  });

  useEffect(() => {
    const map: Record<string, SetLog> = {};
    for (const l of existingLogs as any[]) {
      map[`${l.exercise_index}:${l.set_index}`] = { reps: l.reps, load_lb: l.load_lb, rpe: l.rpe, rir: l.rir, notes: l.notes };
    }
    setLogs(map);
  }, [existingLogs]);

  if (!enr && !enrLoaded && !enrError) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  const plan = enr?.member_plans;
  const dayObj = plan?.published_payload?.weeks_data?.[weekIndex - 1]?.days?.[dayIndex - 1];
  const rows: any[] = dayObj?.rows ?? [];
  if (enrError || (enrLoaded && !enr)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Workout didn’t load" subtitle="" />
        <WorkoutEmptyCard
          clientId={null}
          clientName={null}
          workoutId={null}
          route={route}
          onRetry={() => refetchEnr()}
        />
      </div>
    );
  }
  const loggingEnabled = plan?.logging_enabled !== false;
  const isComplete = !!completion;

  const updateLog = (key: string, patch: Partial<SetLog>) => {
    setLogs((prev) => {
      const before = prev[key] ? { ...prev[key] } : {};
      const next = { ...prev, [key]: { ...prev[key], ...patch } };
      const field = Object.keys(patch)[0] ?? "field";
      undo.push({
        label: `Edited ${field}`,
        coalesceKey: `edit:${key}:${field}`,
        coalesceMs: 800,
        undo: () => setLogs((m) => ({ ...m, [key]: before })),
      });
      return next;
    });
  };

  const saveLog = async (exerciseIndex: number, setIndex: number) => {
    const key = `${exerciseIndex}:${setIndex}`;
    const v = logs[key] ?? {};
    const before = (existingLogs as any[]).find((l) => l.exercise_index === exerciseIndex && l.set_index === setIndex) ?? null;
    const payload = {
      enrollmentId, weekIndex, dayIndex, exerciseIndex, setIndex,
      reps: v.reps ?? null, load_lb: v.load_lb ?? null, rpe: v.rpe ?? null, rir: v.rir ?? null, notes: v.notes ?? null,
    };
    // Always go through the queue so weak-connection writes don't fail silently.
    enqueueOfflineWrite({
      id: `m_set:${enrollmentId}:${weekIndex}:${dayIndex}:${exerciseIndex}:${setIndex}`,
      label: "Saved set",
      handlerKey: "m_log_set",
      payload,
    });
    // Optimistic local sync of existingLogs cache so the UI feels instant.
    qc.setQueryData(["m-set-logs", enrollmentId, weekIndex, dayIndex], (old: any[] = []) => {
      const filtered = old.filter((l) => !(l.exercise_index === exerciseIndex && l.set_index === setIndex));
      return [...filtered, { ...(before ?? {}), ...payload, _optimistic: true }];
    });
    // Push an undo entry that reverses to the previous saved value.
    undo.push({
      label: "Saved set",
      undo: () => {
        if (before) {
          enqueueOfflineWrite({
            id: `m_set:${enrollmentId}:${weekIndex}:${dayIndex}:${exerciseIndex}:${setIndex}`,
            label: "Reverted set",
            handlerKey: "m_log_set",
            payload: { enrollmentId, weekIndex, dayIndex, exerciseIndex, setIndex,
              reps: before.reps ?? null, load_lb: before.load_lb ?? null,
              rpe: before.rpe ?? null, rir: before.rir ?? null, notes: before.notes ?? null },
          });
          setLogs((m) => ({ ...m, [key]: { reps: before.reps, load_lb: before.load_lb, rpe: before.rpe, rir: before.rir, notes: before.notes } }));
        }
      },
    });
    // Audit if coach/admin POV is editing on the member's behalf.
    if (isImpersonating && user?.id && povClient?.id) {
      const row = rows[exerciseIndex];
      void writeSetEditAudit(
        {
          weight: before?.load_lb ?? null,
          reps: before?.reps ?? null,
          rpe: before?.rpe ?? null,
          unit: "lb",
          status: before ? "logged" : null,
        },
        {
          weight: v.load_lb ?? null,
          reps: v.reps ?? null,
          rpe: v.rpe ?? null,
          unit: "lb",
          status: "logged",
        },
        {
          setLogId: before?.id ?? null,
          clientId: povClient.id,
          workoutId: null,
          enrollmentId,
          exerciseId: null,
          exerciseName: row?.exercise || row?.name || null,
          editedByUserId: user.id,
          editedByRole: "coach_pov",
          editSource: "coach_pov",
          pageRoute: route,
        },
      );
    }
  };

  const handleComplete = async () => {
    const wasComplete = isComplete;
    enqueueOfflineWrite({
      id: `m_complete:${enrollmentId}:${weekIndex}:${dayIndex}`,
      label: "Marked workout complete",
      handlerKey: "m_complete_workout",
      payload: { enrollmentId, weekIndex, dayIndex, notes },
    });
    toast.success("Workout complete", { description: "Syncing in background." });
    qc.setQueryData(["m-completion", enrollmentId, weekIndex, dayIndex],
      (old: any) => old ?? { enrollment_id: enrollmentId, week_index: weekIndex, day_index: dayIndex, completed_at: new Date().toISOString(), _optimistic: true });
    undo.push({
      label: "Marked workout complete",
      undo: () => {
        if (wasComplete) return;
        enqueueOfflineWrite({
          id: `m_complete:${enrollmentId}:${weekIndex}:${dayIndex}`,
          label: "Reverted completion",
          handlerKey: "m_uncomplete_workout",
          payload: { enrollmentId, weekIndex, dayIndex },
        });
        qc.setQueryData(["m-completion", enrollmentId, weekIndex, dayIndex], null);
      },
    });
  };

  const handleUncomplete = async () => {
    const prev = completion;
    enqueueOfflineWrite({
      id: `m_complete:${enrollmentId}:${weekIndex}:${dayIndex}`,
      label: "Marked workout incomplete",
      handlerKey: "m_uncomplete_workout",
      payload: { enrollmentId, weekIndex, dayIndex },
    });
    qc.setQueryData(["m-completion", enrollmentId, weekIndex, dayIndex], null);
    undo.push({
      label: "Marked workout incomplete",
      undo: () => {
        enqueueOfflineWrite({
          id: `m_complete:${enrollmentId}:${weekIndex}:${dayIndex}`,
          label: "Restored completion",
          handlerKey: "m_complete_workout",
          payload: { enrollmentId, weekIndex, dayIndex, notes },
        });
        qc.setQueryData(["m-completion", enrollmentId, weekIndex, dayIndex], prev ?? null);
      },
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={dayObj?.title || `Week ${weekIndex} · Day ${dayIndex}`}
        subtitle={plan?.name}
        actions={
          <div className="flex items-center gap-2">
            <UndoButton />
            <TrainingHelpButton size="sm" variant="outline" />
            {isComplete ? <Badge>Complete</Badge> : null}
          </div>
        }
      />
      <WorkoutSyncBanner
        clientId={povClient?.id ?? null}
        workoutId={null}
        pageRoute={route}
      />
      {rows.length === 0 && (
        <WorkoutEmptyCard
          clientId={null}
          clientName={null}
          workoutId={null}
          route={route}
          onRetry={() => qc.invalidateQueries({ queryKey: ["m-enrollment", enrollmentId] })}
        />
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