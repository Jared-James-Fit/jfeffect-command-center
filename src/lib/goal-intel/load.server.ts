/**
 * What a client's goals are read against (server only; the service role
 * after the caller's own staff check, or the worker). Every number comes from
 * a reader that already exists, so the goal ledger agrees with the rest of the
 * app:
 *  - competition lifts: the analytics' strength line (competition
 *    load.server.ts loadLiftEvidence);
 *  - a goal at a meet: Competition Intelligence's own deterministic forecast
 *    for that meet (loadCompetitionContext + buildBrief), concerns included;
 *  - bodyweight: the weigh-ins (the app's log and the coach's older entries,
 *    one a day) through the weight-management trajectory;
 *  - pain: the pain history every reader shares;
 *  - adherence: planned workouts against finished ones, the last 4 weeks;
 *  - learning: how their own resolved goals went against their projection.
 * Every read is best effort: one that fails is left out and said under
 * missing, never guessed.
 */
import { experienceLevel } from "@/lib/program-intel/first-program";
import { buildTrajectory, type WeighIn } from "@/lib/weight-management/trajectory";
import { calibrationFrom, type BodyweightRead, type GoalContext, type MeetForecast, type StrengthRead } from "./feasibility";
import { LB_PER_KG, LIFTS, OPEN_STATUSES, addDays, type GoalRow, type Lift, type Unit } from "./types";

type Db = any;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn("[goal-intel] read failed", (e as Error)?.message);
    return fallback;
  }
}

export function localToday(tz: string | null | undefined, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  }
}

export type GoalClient = {
  id: string;
  user_id: string | null;
  first_name: string | null;
  preferred_name: string | null;
  full_name: string | null;
  preferred_weight_unit: string | null;
  timezone: string | null;
  sex: string | null;
  intake_training_experience: string | null;
  last_active_at: string | null;
  assigned_coach_id: string | null;
  service_tier: string | null;
  archived: boolean | null;
};

export const CLIENT_COLS =
  "id, user_id, first_name, preferred_name, full_name, preferred_weight_unit, timezone, sex, intake_training_experience, last_active_at, assigned_coach_id, service_tier, archived";

export async function readGoals(sb: Db, clientId: string): Promise<GoalRow[]> {
  const { data, error } = await sb.from("client_goals").select("*").eq("client_id", clientId).order("created_at", { ascending: true }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as GoalRow[];
}

export type LoadedGoalContext = {
  client: GoalClient;
  goals: GoalRow[];
  ctx: GoalContext;
  /** what the read rests on (latest set, weigh-in, forecast): a goal re-reads only when it moves */
  signature: string;
  competitions: Record<string, { id: string; name: string; meet_date: string; status: string; live_at: string | null }>;
};

/** Read everything one client's goals need, once. */
export async function loadGoalContext(sb: Db, clientId: string, opts: { goals?: GoalRow[]; today?: string; /** read lifts and bodyweight whatever the goals need (extraction) */ evidence?: boolean } = {}): Promise<LoadedGoalContext> {
  const { data: client, error } = await sb.from("clients").select(CLIENT_COLS).eq("id", clientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!client) throw new Error("Client not found");
  const today = opts.today ?? localToday(client.timezone);
  const goals = opts.goals ?? (await readGoals(sb, clientId));
  const open = goals.filter((g) => OPEN_STATUSES.includes(g.status) || (g.status === "active" && !g.outcome));
  const needLifts = !!opts.evidence || open.some((g) => g.kind === "lift" || g.kind === "total");
  const needBw = !!opts.evidence || open.some((g) => g.kind === "bodyweight");
  const compIds = Array.from(new Set(open.filter((g) => (g.kind === "lift" || g.kind === "total") && g.competition_id).map((g) => g.competition_id as string)));
  const unit: Unit = client.preferred_weight_unit === "kg" ? "kg" : "lb";

  const [lifts, comps, weighIns, pain, adherence, goalsSetup] = await Promise.all([
    needLifts
      ? safe(async () => {
          const { loadLiftEvidence } = await import("@/lib/competition/load.server");
          return loadLiftEvidence(sb, clientId, today);
        }, null)
      : Promise.resolve(null),
    safe(
      async () =>
        (
          await sb
            .from("competitions")
            .select("id, name, meet_date, status, live_at")
            .eq("client_id", clientId)
            .order("meet_date", { ascending: false })
            .limit(30)
        ).data ?? [],
      [] as any[],
    ),
    // a client with no login still has the coach's weigh-ins
    needBw ? safe(() => readWeighIns(sb, clientId, client.user_id, today), [] as WeighIn[]) : Promise.resolve([] as WeighIn[]),
    safe(async () => {
      const { loadPainEntries } = await import("@/lib/pain/load");
      const { buildPainHistory } = await import("@/lib/pain/history");
      const entries = await loadPainEntries(sb, [clientId]);
      return buildPainHistory(entries.get(clientId) ?? [], today);
    }, null as any),
    // planned workouts the last 4 weeks (the app's own rule for a workout's date) and how many of those they did
    safe(async () => {
      const { loadDatedWorkouts } = await import("@/lib/cleo-schedule.server");
      const planned = (await loadDatedWorkouts(sb, { clientIds: [clientId], from: addDays(today, -28), to: addDays(today, -1) })).filter((w) => w.visible && !w.optional);
      if (planned.length < 3) return null;
      return Math.round((planned.filter((w) => w.done).length / planned.length) * 100);
    }, null as number | null),
    safe(
      async () =>
        (await sb.from("client_goals_setup").select("training_experience").eq("client_id", clientId).maybeSingle()).data ?? null,
      null as any,
    ),
  ]);

  // forecasts for the meets goals are tied to (Competition Intelligence's own engine)
  const meets: Record<string, MeetForecast> = {};
  const liveAt: string[] = [];
  for (const id of compIds) {
    const c = (comps as any[]).find((x) => x.id === id);
    if (!c || c.status !== "upcoming" || c.meet_date < today) continue;
    const f = await safe(async () => {
      const { loadCompetitionContext } = await import("@/lib/competition/load.server");
      const { buildBrief } = await import("@/lib/competition/brief");
      const loaded = await loadCompetitionContext(sb, id, { today });
      const b = buildBrief(loaded.ctx);
      return {
        competitionId: id,
        meetDate: c.meet_date,
        name: c.name,
        lifts: Object.fromEntries(LIFTS.map((l) => [l, b.forecast.lifts[l]?.range ?? null])),
        total: b.forecast.total,
        confidence: b.forecast.confidence,
        incrementKg: loaded.ctx.competition.rules.incrementKg || 2.5,
        concerns: b.watch
          .filter((w) => (w.area === "pain" || w.area === "recovery") && w.severity !== "watch")
          .map((w) => ({ lift: (w.lift ?? null) as Lift | null, severity: w.severity, text: w.text })),
      } satisfies MeetForecast;
    }, null);
    if (f) meets[id] = f;
    liveAt.push(`${id}:${c.live_at ?? ""}`);
  }

  // bodyweight through the weight-management trajectory (noise taken out)
  let bodyweight: BodyweightRead | null = null;
  if (weighIns.length) {
    const t = buildTrajectory({ weighIns, today });
    if (t.current) {
      bodyweight = {
        currentKg: t.current.kg,
        trendKgPerWeek: t.trend?.kgPerWeek ?? null,
        trendClear: !!t.trend?.clear,
        seKgPerWeek: t.trend?.seKgPerWeek ?? null,
        noiseKg: t.trend?.noiseKg ?? null,
        weighInsLast14: t.weighInsLast14,
        stale: t.stale,
      };
    }
  }

  // pain on a place a lift loads (competition watch.ts's own mapping)
  const concerns: GoalContext["concerns"] = [];
  if (pain?.flagged?.length) {
    const { liftForPlace } = await import("@/lib/competition/watch");
    for (const a of pain.flagged as any[]) {
      const worse = a.trend === "worse";
      const score = a.latest?.score ?? null;
      const severity = worse || (score != null && score >= 7) ? "serious" : score != null && score >= 4 ? "concern" : "watch";
      concerns.push({ lift: (liftForPlace(a.label ?? a.region ?? "") as Lift | null) ?? null, severity, text: `${a.label ?? "Pain"}${worse ? " getting worse" : " flagged"}` });
    }
  }

  // what they've said about how to approach a meet (preference goals), by competition
  const preferences: Record<string, string[]> = {};
  for (const g of goals) {
    if (g.kind !== "preference" || !g.competition_id || !OPEN_STATUSES.includes(g.status)) continue;
    (preferences[g.competition_id] ??= []).push(g.approved_text ?? g.client_text ?? g.source_quote ?? "");
  }

  // learning: their own resolved goals
  // (only targets projected from the training line: a meet forecast measures something else)
  const calibration = calibrationFrom(
    goals
      .filter((g) => g.outcome && (g.kind === "lift" || g.kind === "total") && (g.approved_read?.source ? g.approved_read.source === "training_trend" : !g.competition_id && g.feasibility?.projection?.source === "training_trend"))
      .map((g) => g.outcome!),
  );

  const level = experienceLevel(goalsSetup?.training_experience ?? client.intake_training_experience ?? null);
  const strength: Partial<Record<Lift, StrengthRead>> = {};
  if (lifts) for (const l of LIFTS) if (lifts[l]) strength[l] = lifts[l];
  const ctx: GoalContext = {
    today,
    unit,
    level,
    lifts: strength,
    meets,
    bodyweight,
    weightContext: null,
    concerns,
    adherencePct: adherence,
    calibration,
    preferences,
  };
  const signature = [
    today,
    LIFTS.map((l) => `${l}:${strength[l]?.nowKg ?? ""}:${strength[l]?.basisDay ?? ""}:${strength[l]?.state ?? ""}`).join(","),
    weighIns.length ? weighIns[weighIns.length - 1].date + ":" + weighIns.length : "",
    liveAt.join(","),
    concerns.map((c) => c.text).join(","),
    adherence ?? "",
    calibration ?? "",
  ].join("|");
  const competitions: LoadedGoalContext["competitions"] = {};
  for (const c of comps as any[]) competitions[c.id] = c;
  return { client: client as GoalClient, goals, ctx, signature, competitions };
}

/** Their weigh-ins, the app's log and the coach's older entries, one a day (the app's wins), kg. */
async function readWeighIns(sb: Db, clientId: string, userId: string | null, today: string): Promise<WeighIn[]> {
  const since = addDays(today, -120);
  const [canon, legacy] = await Promise.all([
    userId
      ? sb.from("progress_bodyweight").select("logged_date, weight_value, weight_unit").eq("user_id", userId).gte("logged_date", since).order("logged_date").limit(400)
      : Promise.resolve({ data: [] }),
    sb.from("progress_metrics").select("entry_date, bodyweight, bodyweight_unit").eq("client_id", clientId).not("bodyweight", "is", null).gte("entry_date", since).order("entry_date").limit(400),
  ]);
  const byDay = new Map<string, number>();
  for (const r of (legacy.data ?? []) as any[]) {
    const v = Number(r.bodyweight);
    if (v > 0) byDay.set(String(r.entry_date).slice(0, 10), r.bodyweight_unit === "lb" ? v / LB_PER_KG : v);
  }
  for (const r of (canon.data ?? []) as any[]) {
    const v = Number(r.weight_value);
    if (v > 0) byDay.set(String(r.logged_date).slice(0, 10), r.weight_unit === "lb" ? v / LB_PER_KG : v);
  }
  return Array.from(byDay.entries())
    .map(([date, kg]) => ({ date, kg }))
    .filter((w) => w.kg > 25 && w.kg < 400)
    .sort((a, b) => a.date.localeCompare(b.date));
}
