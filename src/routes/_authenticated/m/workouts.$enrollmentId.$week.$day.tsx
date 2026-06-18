// Thin route shim: mounts the shared <WorkoutDayView> with the member
// adapter so member workouts run the same UI / write paths as the coach
// portal. The previous 657-line monolith duplicated read shapes (DTO
// queries) and write paths (`m_log_set` / `m_complete_workout` offline
// handlers) that the adapter now subsumes — every member write reshapes
// from a pl_*-row payload to the member_* tables inside the adapter.
//
// dayId convention: the member adapter encodes (week, day) tuples as the
// string `"week:day"` (see encodeDayId / decodeDayId in member-adapter.ts).
// The shared view treats it as an opaque id.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { WorkoutDayView } from "@/components/workout-day/WorkoutDayView";
import { buildWorkoutAdapter } from "@/lib/workout-context";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/m/workouts/$enrollmentId/$week/$day")({
  // Mirror the portal route's search contract so deep links into the
  // member workout (readonly preview, "edit past workout", "leave a
  // review") behave identically across both surfaces.
  validateSearch: (s: Record<string, unknown>) => ({
    readonly: s.readonly === 1 || s.readonly === "1" || s.readonly === true ? 1 : undefined,
    edit: s.edit === 1 || s.edit === "1" || s.edit === true ? 1 : undefined,
    review: s.review === 1 || s.review === "1" || s.review === true ? 1 : undefined,
  }),
  component: MemberWorkoutRoute,
});

function MemberWorkoutRoute() {
  const { enrollmentId, week, day } = Route.useParams();
  const search = Route.useSearch();
  const { user } = useAuth();

  // Member adapter: ownerId == userId because there's no `clients` row
  // (members live in `member_*` tables). The adapter rewrites all
  // pl_*-shaped reads/writes against member_* on the way through.
  const adapter = useMemo(
    () =>
      user?.id
        ? buildWorkoutAdapter({
            kind: "member",
            userId: user.id,
            ownerId: user.id,
            enrollmentId,
          })
        : undefined,
    [user?.id, enrollmentId],
  );

  // The protected layout already redirects unauthenticated visitors, but
  // guard against the transient render where `user` resolves after the
  // first paint so we never mount WorkoutDayView with a null adapter
  // (its queries assume one is present when `adapter.kind === "member"`).
  if (!adapter) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <WorkoutDayView
      dayId={`${week}:${day}`}
      search={search}
      adapter={adapter}
      navigation={{
        backTo: `/m/my-plans/${enrollmentId}`,
        listPath: `/m/my-plans/${enrollmentId}`,
        messagesPath: "/m/messages",
      }}
    />
  );
}


type SetLog = { reps?: number | null; load_lb?: number | null; rpe?: number | null; rir?: number | null; notes?: string | null };

function WorkoutTracker() {
  const { enrollmentId, week, day } = Route.useParams();
  const weekIndex = Number(week), dayIndex = Number(day);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  // Member-context adapter — all member writes flow through here so the
  // shared workout surface stays the single source of truth. The offline
  // queue handlers below translate persisted payloads into adapter calls,
  // which keeps already-enqueued items compatible across deploys.
  const adapter = useMemo(
    () =>
      user?.id
        ? buildWorkoutAdapter({
            kind: "member",
            userId: user.id,
            ownerId: user.id,
            enrollmentId,
          })
        : null,
    [user?.id, enrollmentId],
  );
  const { isImpersonating, client: povClient } = useClientImpersonation();
  const undo = useWorkoutUndo();
  const [notes, setNotes] = useState("");
  const [logs, setLogs] = useState<Record<string, SetLog>>({});
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lastSummary, setLastSummary] = useState<WorkoutSummary | null>(null);

  const cacheScope = `m:${enrollmentId}`;
  const route = `/m/workouts/${enrollmentId}/${week}/${day}`;

  // ── Heartbeat-based active duration (member parity with client tracker) ──
  // There's no completion row until the user marks the workout complete, so
  // we key local state by `m:enrollmentId:week:day`. started_at is stamped on
  // first mount; activity timestamps accrue on input/focus/visibility and
  // survive refresh. On complete we hand both to the server fn so the stored
  // active_duration_seconds reflects engaged time, not wall-clock.
  const hbKeyStart = `m-hb-start:${enrollmentId}:${weekIndex}:${dayIndex}`;
  const hbKeyList = `m-hb-list:${enrollmentId}:${weekIndex}:${dayIndex}`;
  const readHbStart = (): string | null => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(hbKeyStart); } catch { return null; }
  };
  const readHbList = (): string[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(hbKeyList);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
    } catch { return []; }
  };
  const writeHbList = (list: string[]) => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(hbKeyList, JSON.stringify(list.slice(-600))); } catch { /* quota */ }
  };
  const clearHb = () => {
    if (typeof window === "undefined") return;
    try { window.localStorage.removeItem(hbKeyStart); window.localStorage.removeItem(hbKeyList); } catch { /* ignore */ }
  };

  // Register offline handlers once. These are the queue's only access to
  // member writes — saveLog() etc. push payloads here instead of calling
  // the adapter directly, so a flaky connection never loses data. Payload
  // shapes are kept stable (enrollmentId/weekIndex/dayIndex/...) so any
  // queued item from a prior deploy still replays cleanly; the handler
  // re-encodes them into the adapter's dayId/rowId surface.
  useEffect(() => {
    if (!adapter) return;
    registerQueueHandler("m_log_set", async (payload: any) => {
      await adapter.logSet({
        dayId: `${payload.weekIndex}:${payload.dayIndex}`,
        rowId: `ex:${payload.exerciseIndex}`,
        setIndex: payload.setIndex,
        reps: payload.reps ?? null,
        loadLb: payload.load_lb ?? null,
        rpe: payload.rpe ?? null,
        rir: payload.rir ?? null,
        notes: payload.notes ?? null,
      });
    });
    registerQueueHandler("m_complete_workout", async (payload: any) => {
      await adapter.updateDayCompletion(`${payload.weekIndex}:${payload.dayIndex}`, {
        completedAt: new Date().toISOString(),
        notes: payload.notes ?? null,
        startedAt: payload.startedAt ?? null,
        activeDurationSeconds: payload.activeDurationSeconds ?? null,
      });
    });
    registerQueueHandler("m_uncomplete_workout", async (payload: any) => {
      await adapter.updateDayCompletion(`${payload.weekIndex}:${payload.dayIndex}`, {
        completedAt: null,
      });
    });
  }, [adapter]);

  // Adapter-fronted reads. All shapes are DTOs (camelCase), not raw rows —
  // the adapter encapsulates the member_* table layout. Queries are gated on
  // an authenticated adapter; without auth the protected route layout
  // already redirects to /auth, but we still guard `enabled` so this page
  // doesn't try to fetch with a null adapter during a transient render.
  const dayId = `${weekIndex}:${dayIndex}`;
  const enabled = !!adapter;

  const { data: summary } = useQuery<EnrollmentSummaryDTO | null>({
    queryKey: ["m-summary", enrollmentId],
    enabled,
    initialData: cachedInitialData<EnrollmentSummaryDTO>(cacheScope, "summary-dto") ?? null,
    queryFn: async () => {
      const out = await adapter!.getEnrollmentSummary();
      writePlanCache(cacheScope, "summary-dto", out);
      return out;
    },
  });

  const { data: dayMeta, isError: dayError, isSuccess: dayLoaded, refetch: refetchDay } = useQuery<WorkoutDay | null>({
    queryKey: ["m-day-dto", enrollmentId, weekIndex, dayIndex],
    enabled,
    initialData: cachedInitialData<WorkoutDay>(cacheScope, `day-dto:${weekIndex}:${dayIndex}`) ?? null,
    queryFn: async () => {
      const out = await adapter!.getDay(dayId);
      writePlanCache(cacheScope, `day-dto:${weekIndex}:${dayIndex}`, out);
      return out;
    },
  });

  const { data: rows = [], refetch: refetchRows } = useQuery<ExerciseRowDTO[]>({
    queryKey: ["m-rows-dto", enrollmentId, weekIndex, dayIndex],
    enabled,
    initialData: cachedInitialData<ExerciseRowDTO[]>(cacheScope, `rows-dto:${weekIndex}:${dayIndex}`) ?? [],
    queryFn: async () => {
      const out = await adapter!.listRows(dayId);
      writePlanCache(cacheScope, `rows-dto:${weekIndex}:${dayIndex}`, out);
      return out;
    },
  });

  const { data: completion } = useQuery<DayCompletionDTO | null>({
    queryKey: ["m-completion-dto", enrollmentId, weekIndex, dayIndex],
    enabled,
    initialData: cachedInitialData<DayCompletionDTO>(cacheScope, `completion-dto:${weekIndex}:${dayIndex}`) ?? null,
    queryFn: async () => {
      const out = await adapter!.getDayCompletion(dayId);
      writePlanCache(cacheScope, `completion-dto:${weekIndex}:${dayIndex}`, out);
      return out;
    },
  });

  const { data: existingLogs = [] } = useQuery<RowResultDTO[]>({
    queryKey: ["m-set-logs-dto", enrollmentId, weekIndex, dayIndex],
    enabled,
    initialData: cachedInitialData<RowResultDTO[]>(cacheScope, `set-logs-dto:${weekIndex}:${dayIndex}`) ?? [],
    queryFn: async () => {
      const out = await adapter!.listRowResults(dayId);
      writePlanCache(cacheScope, `set-logs-dto:${weekIndex}:${dayIndex}`, out);
      return out;
    },
  });

  const { data: existingReview } = useQuery<ReviewDTO | null>({
    queryKey: ["m-review-dto", enrollmentId, weekIndex, dayIndex],
    enabled,
    queryFn: async () => adapter!.getReview(dayId),
  });

  useEffect(() => {
    const map: Record<string, SetLog> = {};
    for (const l of existingLogs) {
      map[`${l.rowId}:${l.setIndex}`] = {
        reps: l.reps,
        load_lb: l.loadLb,
        rpe: l.rpe,
        rir: l.rir,
        notes: l.notes,
      };
    }
    setLogs(map);
  }, [existingLogs]);

  // Heartbeat lifecycle: stamp start once, then push activity timestamps
  // (coalesced to once per 20s) on user input and visibility. Disabled
  // once the workout is complete or while a coach is impersonating.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (completion) return;
    if (isImpersonating) return;
    if (!readHbStart()) {
      try { window.localStorage.setItem(hbKeyStart, new Date().toISOString()); } catch { /* ignore */ }
    }
    const COALESCE_MS = 20_000;
    const PING_MS = 60_000;
    let lastPush = 0;
    const push = () => {
      const now = Date.now();
      if (now - lastPush < COALESCE_MS) return;
      lastPush = now;
      const list = readHbList();
      list.push(new Date(now).toISOString());
      writeHbList(list);
    };
    push();
    const onVis = () => { if (document.visibilityState === "visible") push(); };
    const onFocus = () => push();
    const onInput = () => push();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pointerdown", onInput, { passive: true });
    window.addEventListener("keydown", onInput);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") push();
    }, PING_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completion, isImpersonating, hbKeyStart]);

  if (!dayMeta && !dayLoaded && !dayError) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (dayError || (dayLoaded && !dayMeta)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Workout didn’t load" subtitle="" />
        <WorkoutEmptyCard
          clientId={null}
          clientName={null}
          workoutId={null}
          route={route}
          onRetry={() => Promise.all([
            refetchDay(),
            refetchRows(),
            qc.refetchQueries({ queryKey: ["m-completion-dto", enrollmentId, weekIndex, dayIndex] }),
            qc.refetchQueries({ queryKey: ["m-set-logs-dto", enrollmentId, weekIndex, dayIndex] }),
          ])}
        />
      </div>
    );
  }
  const loggingEnabled = summary?.loggingEnabled !== false;
  const isComplete = !!completion?.completedAt;

  // Compute logging quality from in-memory + persisted logs against the
  // published plan rows. Skip rows have no concept on the member side yet.
  const completeness = (() => {
    const required: RequiredRowSpec[] = rows.map((row) => ({
      rowId: row.id,
      prescribedSets: Math.max(1, Number(row.targetSets) || 1),
      metricKind: "load_reps",
    }));
    const logged: LoggedSetSpec[] = [];
    for (const l of existingLogs) {
      logged.push({
        rowId: l.rowId,
        setIndex: l.setIndex,
        reps: l.reps,
        loadLb: l.loadLb,
        rpe: l.rpe,
        rir: l.rir,
      });
    }
    // Overlay in-memory edits so the live badge tracks unsaved work too.
    for (const [key, v] of Object.entries(logs)) {
      const lastColon = key.lastIndexOf(":");
      const rowId = key.slice(0, lastColon);
      const siStr = key.slice(lastColon + 1);
      logged.push({ rowId, setIndex: Number(siStr), reps: v.reps, loadLb: v.load_lb, rpe: v.rpe, rir: v.rir });
    }
    return summarizeCompleteness(required, logged);
  })();

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
    const rowId = `ex:${exerciseIndex}`;
    const key = `${rowId}:${setIndex}`;
    const v = logs[key] ?? {};
    const before = existingLogs.find((l) => l.rowId === rowId && l.setIndex === setIndex) ?? null;
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
    qc.setQueryData<RowResultDTO[]>(
      ["m-set-logs-dto", enrollmentId, weekIndex, dayIndex],
      (old = []) => {
        const filtered = old.filter((l) => !(l.rowId === rowId && l.setIndex === setIndex));
        const next: RowResultDTO = {
          id: before?.id ?? `mlog:${weekIndex}:${dayIndex}:${exerciseIndex}:${setIndex}`,
          rowId,
          setIndex,
          reps: v.reps ?? null,
          loadLb: v.load_lb ?? null,
          actualLoadUnit: before?.actualLoadUnit ?? "lb",
          rpe: v.rpe ?? null,
          rir: v.rir ?? null,
          isWorkingSet: before?.isWorkingSet ?? null,
          notes: v.notes ?? null,
          completedDurationSeconds: before?.completedDurationSeconds ?? null,
          loggedAt: before?.loggedAt ?? new Date().toISOString(),
        };
        return [...filtered, next];
      },
    );
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
              reps: before.reps ?? null, load_lb: before.loadLb ?? null,
              rpe: before.rpe ?? null, rir: before.rir ?? null, notes: before.notes ?? null },
          });
          setLogs((m) => ({ ...m, [key]: { reps: before.reps, load_lb: before.loadLb, rpe: before.rpe, rir: before.rir, notes: before.notes } }));
        }
      },
    });
    // Audit if coach/admin POV is editing on the member's behalf.
    if (isImpersonating && user?.id && povClient?.id) {
      const row = rows[exerciseIndex];
      void writeSetEditAudit(
        {
          weight: before?.loadLb ?? null,
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
          exerciseName: row?.exerciseName ?? null,
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
    // Build a summary from the in-memory logs + plan rows so the member sees
    // an instant post-workout summary screen (no extra DB round-trip needed).
    const summaryRows = rows.map((row) => ({
      id: row.id,
      sets: Math.max(1, Number(row.targetSets) || 1),
      exercises: { id: null, name: row.exerciseName },
    }));
    const summaryResults: Array<{ row_id: string; actual_load: number | null; actual_reps: number | null; actual_load_unit: "kg" | "lb" | null; actual_rpe: number | null; completed_at: string | null }> = [];
    for (const [key, v] of Object.entries(logs)) {
      const lastColon = key.lastIndexOf(":");
      const rowId = key.slice(0, lastColon);
      summaryResults.push({
        row_id: rowId,
        actual_load: v.load_lb ?? null,
        actual_reps: v.reps ?? null,
        actual_load_unit: "lb",
        actual_rpe: v.rpe ?? null,
        completed_at: null,
      });
    }
    const workoutSummary = computeWorkoutSummary(summaryRows, summaryResults, {
      displayUnit: "lb",
      hasNote: !!notes.trim(),
    });
    // Heartbeat-derived duration. Falls back gracefully if storage was wiped.
    const startedAtIso = readHbStart() ?? new Date().toISOString();
    const completedAtIso = new Date().toISOString();
    const heartbeats = readHbList();
    const activeSeconds = computeActiveSeconds(startedAtIso, completedAtIso, heartbeats) ?? null;
    enqueueOfflineWrite({
      id: `m_complete:${enrollmentId}:${weekIndex}:${dayIndex}`,
      label: "Marked workout complete",
      handlerKey: "m_complete_workout",
      payload: {
        enrollmentId,
        weekIndex,
        dayIndex,
        notes,
        startedAt: startedAtIso,
        ...(activeSeconds != null ? { activeDurationSeconds: activeSeconds } : {}),
      },
    });
    toast.success(`Workout complete — Score: ${workoutSummary.score}/100`, {
      description: workoutSummary.totalLifted > 0 ? `Total lifted: ${workoutSummary.totalLiftedFmt}` : "Syncing in background.",
    });
    setLastSummary(workoutSummary);
    setSummaryOpen(true);
    qc.setQueryData<DayCompletionDTO | null>(
      ["m-completion-dto", enrollmentId, weekIndex, dayIndex],
      (old) =>
        old ?? {
          id: null,
          startedAt: startedAtIso,
          inProgressAt: null,
          completedAt: completedAtIso,
          notes: notes || null,
          actualMinutes: activeSeconds != null ? Math.round(activeSeconds / 60) : null,
        },
    );
    clearHb();
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
        qc.setQueryData(["m-completion-dto", enrollmentId, weekIndex, dayIndex], null);
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
    qc.setQueryData(["m-completion-dto", enrollmentId, weekIndex, dayIndex], null);
    undo.push({
      label: "Marked workout incomplete",
      undo: () => {
        enqueueOfflineWrite({
          id: `m_complete:${enrollmentId}:${weekIndex}:${dayIndex}`,
          label: "Restored completion",
          handlerKey: "m_complete_workout",
          payload: { enrollmentId, weekIndex, dayIndex, notes },
        });
        qc.setQueryData(["m-completion-dto", enrollmentId, weekIndex, dayIndex], prev ?? null);
      },
    });
  };

  return (
    <div className="space-y-5">
      {lastSummary && (
        <WorkoutSubmissionSummary
          open={summaryOpen}
          onOpenChange={setSummaryOpen}
          summary={lastSummary}
          workoutTitle={dayMeta?.title ?? `Week ${weekIndex} · Day ${dayIndex}`}
        />
      )}
      <PageHeader
        title={dayMeta?.title || `Week ${weekIndex} · Day ${dayIndex}`}
        subtitle={summary?.planName ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <UndoButton />
            <TrainingHelpButton size="sm" variant="outline" />
            {isComplete ? <Badge>Complete</Badge> : null}
            {rows.length > 0 && (
              <LoggingQualityBadge
                quality={completeness.loggingQuality}
                percentage={completeness.loggingPercentage}
                showPercent
              />
            )}
          </div>
        }
      />
      <WorkoutSyncBanner
        clientId={povClient?.id ?? null}
        workoutId={null}
        pageRoute={route}
      />
      {isComplete && (
        <CompletedWorkoutActions
          ctx={{ kind: "member", enrollmentId, weekIndex, dayIndex }}
          hasCoach={false}
          initialReview={
            existingReview
              ? {
                  overallRating: existingReview.overallRating,
                  sessionRpe: existingReview.sessionRpe,
                  pain: existingReview.pain,
                  painLevel: existingReview.painLevel,
                  painArea: existingReview.painArea,
                  painNote: existingReview.painNote,
                  clientNote: existingReview.clientNote,
                  editCount: existingReview.editCount,
                  submittedAt: existingReview.submittedAt,
                }
              : null
          }
          onReviewSaved={() =>
            qc.invalidateQueries({ queryKey: ["m-review-dto", enrollmentId, weekIndex, dayIndex] })
          }
        />
      )}
      {rows.length === 0 && (
        <WorkoutEmptyCard
          clientId={null}
          clientName={null}
          workoutId={null}
          route={route}
          onRetry={() => Promise.all([
            qc.refetchQueries({ queryKey: ["m-rows-dto", enrollmentId, weekIndex, dayIndex] }),
            qc.refetchQueries({ queryKey: ["m-completion-dto", enrollmentId, weekIndex, dayIndex] }),
            qc.refetchQueries({ queryKey: ["m-set-logs-dto", enrollmentId, weekIndex, dayIndex] }),
          ])}
        />
      )}
      {rows.map((row, ei) => {
        const setCount = Math.max(1, Number(row.targetSets) || 1);
        const rowId = row.id; // "ex:<index>"
        return (
          <Card key={ei} className="p-4">
            <div className="font-semibold">{row.exerciseName || `Exercise ${ei + 1}`}</div>
            <div className="text-xs text-muted-foreground">
              {row.targetSets ? `${row.targetSets} sets` : ""}
              {row.targetReps ? ` · ${row.targetReps} reps` : ""}
              {row.targetEffort ? ` · ${row.targetEffort}` : ""}
              {row.restSeconds != null ? ` · rest ${row.restSeconds}s` : ""}
            </div>
            {row.notes && <div className="mt-1 text-xs text-muted-foreground">{row.notes}</div>}
            {loggingEnabled && (
              <div className="mt-3 space-y-2">
                {Array.from({ length: setCount }, (_, si) => {
                  const key = `${rowId}:${si}`;
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