/**
 * Everything the coach's Cardio tab needs for one client, read in one pass
 * (Nov 23 2026): the plan in force and any change waiting for its date, the
 * coach's draft, every published version and how it went, what was logged,
 * bodyweight, and the recovery and performance read (cardio/insights.ts) built
 * on the weight-management engine's own read of their records, so the two
 * never disagree. Server only; the caller checks the staff member reaches the
 * client first. Every read but the client row is best-effort.
 */
import { loadWeightManagement, type LoadedWeightManagement } from "@/lib/weight-management/load.server";
import { normalizeCardioWeekdays, type CardioWeekday } from "@/lib/cardio-prescription";
import { prescribedFor, isCompletedCardio, type CardioTargetRow } from "@/lib/analytics/cardio-adherence";
import { buildCardioRead, type CardioRead, type CardioReadInput } from "@/lib/cardio/insights";
import { planFacts, type CardioScoreContext } from "@/lib/cardio/quality";
import { planOn, pendingStart, planRows, type PendingChange, type TargetRow } from "@/lib/cardio/publish";
import { cleanPlan, type CardioPlan, type PlanContext } from "@/lib/cardio/plan";
import { versionOutcomes, type VersionOutcome, type VersionRow } from "@/lib/cardio/history";
import { addDays } from "@/lib/weight-management/units";
import type { CardioCompletion, CardioProposalRow, CardioWorkspaceView } from "@/lib/cardio/types";
export type { CardioCompletion, CardioProposalRow, CardioWorkspaceView } from "@/lib/cardio/types";
import type { SpeedUnit } from "@/lib/weight-management/units";




const PAGE = 1000;

async function safe<T>(run: () => PromiseLike<{ data: T | null; error?: any }>, fallback: T): Promise<T> {
  try {
    const r = await run();
    return r && !r.error && r.data != null ? r.data : fallback;
  } catch {
    return fallback;
  }
}

/** A missing table (the migration not applied yet) reads as unavailable, never an error. */
export async function workspaceAvailable(sb: any): Promise<boolean> {
  try {
    const { error } = await sb.from("cardio_plan_drafts").select("client_id").limit(1);
    if (!error) return true;
    return !(/does not exist|schema cache|PGRST205|42P01/i.test(`${error.code ?? ""} ${error.message ?? ""}`));
  } catch {
    return false;
  }
}

/** A fingerprint of the rows that make up the plan: a draft started from another one is stale. */
export function rowsHash(rows: TargetRow[]): string {
  const s = JSON.stringify(
    planRows(rows)
      .map((r) => [r.id, r.start_date, r.end_date, (r as any).last_updated_at ?? (r as any).updated_at ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

/** The waiting change, if one is: the scheduled version and what it did. */
export async function loadPending(sb: any, clientId: string): Promise<(PendingChange & { effective: string }) | null> {
  const { data } = await sb
    .from("cardio_plan_versions")
    .select("id, effective_date, created_ids, closes")
    .eq("client_id", clientId)
    .eq("state", "scheduled")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    versionId: data.id,
    effective: data.effective_date,
    createdIds: (data.created_ids ?? []) as string[],
    closes: ((data.closes ?? []) as any[]).map((c) => ({ id: String(c.id), prevEnd: c.prevEnd ?? c.prev_end ?? null })),
  };
}

export async function loadCardioWorkspace(sb: any, clientId: string, opts: { loaded?: LoadedWeightManagement } = {}): Promise<CardioWorkspaceView> {
  const loaded = opts.loaded ?? (await loadWeightManagement(sb, clientId));
  const { input, assessment } = loaded;
  const today = assessment.today;
  const available = await workspaceAvailable(sb);
  const since26w = addDays(today, -182);

  const [client, rows, draftRow, versions, proposals, completions, sets, wear, feedback] = await Promise.all([
    safe<any>(() => sb.from("clients").select("preferred_high_days, committed_training_days, user_id, full_name").eq("id", clientId).maybeSingle(), null),
    safe<any[]>(() => sb.from("cardio_targets").select("*").eq("client_id", clientId).order("start_date", { ascending: true }), []),
    available ? safe<any>(() => sb.from("cardio_plan_drafts").select("*").eq("client_id", clientId).maybeSingle(), null) : Promise.resolve(null),
    available
      ? safe<any[]>(
          () =>
            sb
              .from("cardio_plan_versions")
              .select("id, version_no, effective_date, published_at, weekly_minutes, weekly_sessions, change_lines, source, note, state, published_by, message_id, sessions")
              .eq("client_id", clientId)
              .order("published_at", { ascending: false })
              .limit(40),
          [],
        )
      : Promise.resolve([]),
    available
      ? safe<any[]>(
          () =>
            sb
              .from("cardio_cleo_proposals")
              .select("id, created_at, instructions, answer, sessions, change_lines, nutrition_note, status, decided_at, decision_note, model, error")
              .eq("client_id", clientId)
              .order("created_at", { ascending: false })
              .limit(12),
          [],
        )
      : Promise.resolve([]),
    safe<any[]>(
      () =>
        sb
          .from("cardio_completions")
          .select("id, cardio_target_id, completed_date, completed, skipped, duration_minutes, cardio_type, incline, avg_speed, distance, distance_unit, calories, avg_heart_rate, rpe, completion_target")
          .eq("client_id", clientId)
          .gte("completed_date", since26w)
          .order("completed_date", { ascending: true })
          .limit(PAGE * 2),
      [],
    ),
    safe<any[]>(
      () =>
        sb
          .from("pl_row_results")
          .select("completed_at")
          .eq("client_id", clientId)
          .gte("completed_at", `${addDays(today, -42)}T00:00:00Z`)
          .not("completed_at", "is", null)
          .limit(5000),
      [],
    ),
    loaded.client.userId
      ? safe<any[]>(() => sb.from("wearable_daily_metrics").select("metric_date, resting_hr, hrv_ms, sleep_minutes").eq("user_id", loaded.client.userId).gte("metric_date", addDays(today, -35)), [])
      : Promise.resolve([]),
    safe<any[]>(() => sb.from("pl_workout_feedback").select("created_at, recovery_today").eq("client_id", clientId).gte("created_at", `${addDays(today, -21)}T00:00:00Z`), []),
  ]);

  const ctx: CardioWorkspaceView["ctx"] = {
    trainingDays: normalizeCardioWeekdays(input.trainingDays),
    highDays: normalizeCardioWeekdays(client?.preferred_high_days ?? []),
    heavyLowerDays: normalizeCardioWeekdays(input.heavyLowerDays),
  };
  const targetRows = rows as TargetRow[];
  const live = planOn(targetRows, today);
  const next = pendingStart(targetRows, today);
  const pendingVersion = available && next ? await loadPending(sb, clientId).catch(() => null) : null;
  const baseHash = rowsHash(targetRows);
  const programs = new Map<string, number>();
  for (const r of rows) if (r.program_name && (r.status ?? "Active") !== "Archived" && (!r.end_date || r.end_date >= today)) programs.set(r.program_name, (programs.get(r.program_name) ?? 0) + 1);

  // adherence over the last 4 full weeks, and the prescription trend over 6
  const asTargets = rows as unknown as CardioTargetRow[];
  const done = (from: string, to: string) => completions.filter((c) => c.completed_date >= from && c.completed_date <= to && isCompletedCardio(c as any)).length;
  const end4 = addDays(today, -1);
  const start4 = addDays(today, -28);
  const pres4 = prescribedFor(asTargets, start4, end4);
  const adherence = pres4.sessions > 0 ? { done: done(start4, end4), planned: pres4.sessions } : null;
  const recentPres = prescribedFor(asTargets, addDays(today, -21), end4).minutes / 3;
  const priorPres = prescribedFor(asTargets, addDays(today, -42), addDays(today, -22)).minutes / 3;

  // weekly check-ins: how training felt, the last 3 against the 3 before
  const checkins = input.checkins.slice().sort((a, b) => b.date.localeCompare(a.date));
  const ratings = checkins.map((c) => num((c.answers as any)?.training_rating)).map((n) => (n != null && n >= 1 && n <= 5 ? n : null));
  const recentR = avg(ratings.slice(0, 3).filter((n): n is number => n != null));
  const priorR = avg(ratings.slice(3, 6).filter((n): n is number => n != null));

  // working sets a week: the last 3 weeks against the 3 before
  const setDates = (sets as any[]).map((s) => String(s.completed_at).slice(0, 10));
  const recentSets = setDates.filter((d) => d >= addDays(today, -21)).length / 3;
  const priorSets = setDates.filter((d) => d < addDays(today, -21) && d >= addDays(today, -42)).length / 3;

  // a wearable: the last 7 days against their own usual (the 4 weeks before)
  const w7 = (wear as any[]).filter((w) => w.metric_date >= addDays(today, -7));
  const wBase = (wear as any[]).filter((w) => w.metric_date < addDays(today, -7));
  const series = (xs: any[], k: string) => xs.map((x) => num(x[k])).filter((n): n is number => n != null && n > 0);
  const pair = (k: string) => {
    const r = avg(series(w7, k));
    const b = avg(series(wBase, k));
    return r != null && b != null && series(w7, k).length >= 3 && series(wBase, k).length >= 7 ? { recent: r, baseline: b } : null;
  };
  const sleep = avg(series(w7, "sleep_minutes"));

  const rec = (feedback as any[]).map((f) => num(f.recovery_today)).filter((n): n is number => n != null && n >= 1 && n <= 5);
  const wmRec = assessment.recommendation;
  const cardioAction = wmRec.actions.find((a) => a.kind === "cardio");
  const facts = planFacts(live, ctx);
  const tr = assessment.trajectory;

  const readInput: CardioReadInput = {
    today,
    plan: {
      empty: facts.empty,
      minutes: facts.minutes,
      sessions: facts.sessions,
      hardMinutes: facts.hardMinutes,
      avgRpe: facts.avgRpe,
      highImpactSessions: facts.highImpactSessions,
      beforeLifting: facts.beforeLifting,
      dayBeforeHeavyLower: facts.dayBeforeHeavyLower,
      trainingDayMinutesMax: facts.trainingDayMinutesMax,
      biggestDayShare: facts.biggestDayShare,
      days: facts.days,
    },
    goal: { direction: assessment.direction, status: (tr as any).status ?? null, pctPerWeek: tr.trend?.pctPerWeek ?? null, trendClear: !!tr.trend?.clear },
    adherence,
    prescribedTrend: { recent: recentPres || null, prior: priorPres || null },
    performance: input.performance,
    trainingRating: { recent: recentR, prior: priorR },
    volume: { recent: recentSets || null, prior: priorSets || null },
    checkins: {
      count: assessment.checkins.count,
      poorSleep: assessment.checkins.poorSleep,
      lowEnergy: assessment.checkins.lowEnergy,
      stress: assessment.checkins.stress,
      hungerHigh: assessment.checkins.hungerHigh,
      cardioIssues: assessment.checkins.cardioIssues,
    },
    wearables: { restingHr: pair("resting_hr"), hrv: pair("hrv_ms"), sleepHours: sleep != null && series(w7, "sleep_minutes").length >= 3 ? sleep / 60 : null },
    feedback: { recovery: avg(rec), sessions: rec.length },
    steps: input.dailySteps,
    meetWeeksOut: assessment.meetWeeksOut,
    walkingLimits: input.health.walkingLimits,
    powerlifter: input.powerlifter || assessment.context === "powerlifting_class",
    wm: {
      verdict: wmRec.verdict,
      limiting: wmRec.limiting,
      cardio: cardioAction && cardioAction.kind === "cardio" ? cardioAction.direction : null,
      nutrition: wmRec.actions.some((a) => a.kind === "nutrition"),
      headline: wmRec.headline,
    },
  };
  const read = buildCardioRead(readInput);
  const recoveryFlags = read.signals.filter((s) => s.status === "flag" && ["sleep", "sleep_tracked", "energy", "rhr", "hrv", "recovered"].includes(s.key)).length;
  const lastChanged = (rows as any[])
    .filter((r) => !r.program_name)
    .map((r) => String(r.last_updated_at ?? r.updated_at ?? "").slice(0, 10))
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  // ── the change log: each published version against the one before, and edits made outside a publish ──
  const { barriersFromCheckins } = await import("@/lib/plan-quality");
  const { cardioFingerprint, cardioSlots, cardioVersionChanges, changeRead } = await import("@/lib/plan-changes");
  const liveVersions = (versions as any[]).filter((v) => v.state !== "replaced");
  const known = cardioVersionChanges(
    liveVersions.map((v) => ({ effective_date: String(v.effective_date), state: String(v.state), sessions: cardioSlots(Array.isArray(v.sessions) ? v.sessions : []) })),
    today,
  );
  const latestVersion = liveVersions.reduce((m, v) => Math.max(m, Number(v.version_no) || 0), 0);
  const fp = cardioFingerprint(cardioSlots(live.sessions as any[]));
  (fp.items._plan as any).version = latestVersion;
  const { trackPlanChanges } = await import("@/lib/plan-changes.server");
  // a publish is read from its version above; the snapshot catches edits made any other way
  const logged = await trackPlanChanges(sb, clientId, "cardio", fp, today, { comparable: (prev) => Number((prev.items._plan as any)?.version ?? 0) === latestVersion });
  if (!known.length && !logged.length && lastChanged && lastChanged >= addDays(today, -28))
    known.push({ domain: "cardio", area: "cardio_dose", size: "minor", summary: "Cardio targets edited", on: lastChanged, unknown: true });
  const weighIns14 = input.weighIns.filter((w) => w.date >= addDays(today, -14)).length;
  const changeLog = changeRead("cardio", [...logged, ...known], today, { meetWeeksOut: assessment.meetWeeksOut, weighIns14 });
  // they log their lifting but hardly any cardio: likely unlogged, not undone
  const unlogged = !!adherence && adherence.planned >= 8 && adherence.done / adherence.planned <= 0.25 && recentSets >= 6;

  const scoreCtx: CardioScoreContext = {
    ...ctx,
    direction: input.goal?.type || assessment.goal ? assessment.direction : input.plan.phase ? assessment.direction : null,
    context: assessment.context,
    trendStatus: (tr as any).status ?? null,
    powerlifter: readInput.powerlifter,
    walkingLimits: input.health.walkingLimits,
    meetWeeksOut: assessment.meetWeeksOut,
    adherence,
    issues: assessment.checkins.cardioIssues,
    recoveryFlags,
    steps: input.dailySteps,
    bodyweightKg: tr.current?.kg ?? null,
    lastChanged,
    today,
    checkins: assessment.checkins.count,
    lowerPerformance: input.performance.lower,
    hungerHigh: assessment.checkins.hungerHigh,
    changeLog,
    barriers: barriersFromCheckins(input.checkins.slice().sort((a, b) => b.date.localeCompare(a.date))),
    firstName: String(client?.full_name ?? "").trim().split(/\s+/)[0] || null,
    unlogged,
    trainingVolume: { recent: recentSets || null, prior: priorSets || null },
  };

  const draft = draftRow
    ? {
        plan: cleanPlan(draftRow.sessions, ctx),
        effectiveDate: draftRow.effective_date ?? null,
        note: draftRow.note ?? null,
        updatedAt: draftRow.updated_at,
        baseHash: draftRow.base_hash ?? null,
        stale: !!draftRow.base_hash && draftRow.base_hash !== baseHash,
      }
    : null;

  const versionRows = (versions as any[]).map((v) => ({ ...v, change_lines: v.change_lines ?? [] }));
  const weighIns = input.weighIns.filter((p) => p.date >= since26w);
  return {
    available,
    clientId,
    firstName: loaded.client.firstName,
    hasLogin: !!loaded.client.userId,
    today,
    speedUnit: assessment.speedUnit,
    weightUnit: loaded.client.unit,
    ctx,
    rows: targetRows,
    live,
    pending: next
      ? { effective: next, plan: planOn(targetRows, next), versionId: pendingVersion?.versionId ?? null, createdIds: pendingVersion?.createdIds ?? [], closes: pendingVersion?.closes ?? [] }
      : null,
    programs: [...programs.entries()].map(([name, sessions]) => ({ name, sessions })),
    baseHash,
    draft,
    versions: versionRows,
    outcomes: versionOutcomes(versionRows.filter((v) => v.state !== "replaced"), completions as any[], input.weighIns, today),
    completions: completions as CardioCompletion[],
    weighIns,
    read,
    scoreCtx,
    proposals: proposals as CardioProposalRow[],
    wmHeadline: wmRec.headline,
    phase: input.plan.phase,
  };
}
