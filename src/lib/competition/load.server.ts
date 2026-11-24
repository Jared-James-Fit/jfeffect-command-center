/**
 * Gathers what the engines need for one competition from what's already on
 * file (server only, the service role after the caller's own staff check, or
 * the worker): the competition-lift sets (the analytics' own strength line),
 * the athlete's meets with their attempts, warm-up habits, bodyweight, pain,
 * check-in recovery flags, how far the program reaches, cardio, the field,
 * the last assessment, calls and what's included in their package. Nothing is
 * asked of the coach that's already somewhere in the app. Every read is best
 * effort except the competition itself: a source that can't be read leaves its
 * part out and is said under missing information.
 */
import { liftStrengths } from "@/lib/analytics/lift-strength";
import {
  envelopeAt,
  envelopeTrend,
  strengthEnvelope,
  type EnvelopePoint,
  type SessionEstimate,
} from "@/lib/analytics/strength-estimate";
import { meetsFromRows } from "@/lib/analytics/competition-strength";
import { epley1RM } from "@/lib/analytics/e1rm";
import type { BriefContext, CompetitionFacts } from "./brief";
import type { ConversionPoint, LiftEvidence } from "./forecast";
import { addDays, daysBetween } from "./milestones";
import { readRules, LB_PER_KG } from "./rules";
import type { Lift, MeetRecord, MilestoneKind, Objective, Observation } from "./types";
import { warmupHistory, type WarmupHistory } from "./warmups";
import { liftForPlace } from "./watch";
import { classLimitKg } from "@/lib/weight-management/target";

type Db = any;
const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
/** A logged set's load in lb (pl-programs.ts resultLoadLb, kept here so the server never loads the browser client). */
function resultLoadLb(r: any): number {
  if (r.normalized_lb != null) return Number(r.normalized_lb) || 0;
  if (r.normalized_kg != null) return (Number(r.normalized_kg) || 0) * LB_PER_KG;
  const n = Number(r.entered_value ?? r.actual_load) || 0;
  return (r.entered_unit ?? r.actual_load_unit ?? "lb") === "kg" ? n * LB_PER_KG : n;
}
const kg = (lb: number) => Math.round((lb / LB_PER_KG) * 10) / 10;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn("[competition] read failed", (e as Error)?.message);
    return fallback;
  }
}

export function todayWinnipeg(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Winnipeg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The athlete's competition-lift sets (completed, loaded), shaped for liftStrengths (lb). */
async function compSets(sb: Db, clientId: string, since: string): Promise<any[]> {
  const out: any[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await sb
      .from("pl_row_results")
      .select(
        "id, set_index, row_id, actual_load, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, actual_reps, actual_rpe, actual_rir, mean_concentric_velocity_mps, load_type, is_bodyweight, completed_at, pl_exercise_rows!inner(exercise_id, exercises!inner(is_competition_lift, competition_lift_type))",
      )
      .eq("client_id", clientId)
      .eq("pl_exercise_rows.exercises.is_competition_lift", true)
      .not("actual_reps", "is", null)
      .not("completed_at", "is", null)
      .gte("completed_at", `${since}T00:00:00Z`)
      .order("completed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const lb = resultLoadLb(r);
      const ex = r.pl_exercise_rows?.exercises;
      const loaded = lb > 0 && r.load_type !== "assisted" && r.is_bodyweight !== true;
      out.push({
        id: r.id,
        row_id: r.row_id,
        set_index: r.set_index,
        date: r.completed_at,
        load: loaded ? lb : 0,
        reps: Number(r.actual_reps) || 0,
        rpe: r.actual_rpe ?? null,
        rir: r.actual_rir ?? null,
        velocity_mps:
          r.mean_concentric_velocity_mps != null ? Number(r.mean_concentric_velocity_mps) : null,
        counts_load: loaded,
        est_1rm: loaded ? epley1RM(lb, Number(r.actual_reps) || 0) : 0,
        is_competition_lift: ex?.is_competition_lift === true,
        competition_lift_type: ex?.competition_lift_type ?? null,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const liftOf = (t: string | null): Lift | null => {
  const s = String(t ?? "").toLowerCase();
  return s.includes("squat")
    ? "squat"
    : s.includes("bench")
      ? "bench"
      : s.includes("dead")
        ? "deadlift"
        : null;
};

const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function basisWords(env: EnvelopePoint | null, sessions: SessionEstimate[]): string | null {
  if (!env) return null;
  const s = sessions.find((x) => x.day === env.basis);
  if (!s) return `${kg(env.value)} kg estimate`;
  return `${kg(s.set.load)} kg × ${s.set.reps}${s.set.effort != null ? ` @ ${s.set.effort}` : ""} on ${fmtDay(s.day)} → ${kg(s.e1rm)} kg estimate`;
}

/** A stored meet row (athlete_powerlifting_results) as a MeetRecord. */
function meetFromRow(r: any): MeetRecord {
  const a = r.attempts && typeof r.attempts === "object" ? r.attempts : null;
  const t = (x: any): [number | null, number | null, number | null] => {
    const arr = Array.isArray(x) ? x : [];
    return [0, 1, 2].map((i) => (arr[i] == null ? null : Number(arr[i]))) as [
      number | null,
      number | null,
      number | null,
    ];
  };
  return {
    date: String(r.meet_date).slice(0, 10),
    name: r.meet_name ?? null,
    federation: r.federation ?? null,
    equipment: r.equipment ?? null,
    event: (r.event ?? "SBD").toUpperCase(),
    division: r.division ?? null,
    weightClass: r.weight_class_kg ?? null,
    bodyweight: r.bodyweight_kg ? Number(r.bodyweight_kg) : null,
    squat: Number(r.squat_kg) || null,
    bench: Number(r.bench_kg) || null,
    deadlift: Number(r.deadlift_kg) || null,
    total:
      Number(r.total_kg) || Number(r.squat_kg) + Number(r.bench_kg) + Number(r.deadlift_kg) || null,
    place: r.place ?? null,
    attempts: a ? { s: t(a.s), b: t(a.b), d: t(a.d) } : null,
    tested: r.tested ?? null,
  };
}

export function readCompetitionFacts(c: any): CompetitionFacts {
  return {
    id: c.id,
    name: c.name,
    meetDate: String(c.meet_date).slice(0, 10),
    meetEndDate: c.meet_end_date ? String(c.meet_end_date).slice(0, 10) : null,
    federation: c.federation ?? null,
    division: c.division ?? null,
    weightClass: c.weight_class ?? null,
    level: c.level ?? null,
    objective: (c.objective as Objective | null) ?? null,
    targetTotal: c.target_total_kg != null ? Number(c.target_total_kg) : null,
    targetPlace: c.target_place ?? null,
    qualificationTotal: c.qualification_total_kg != null ? Number(c.qualification_total_kg) : null,
    recordsNote: c.records_note ?? null,
    registration: c.registration ?? "unknown",
    liftingStart: c.lifting_start ?? null,
    weighInAt: c.weigh_in_at ?? null,
    flight: c.flight ?? null,
    location: c.location ?? null,
    rules: readRules(c.rules, c.federation),
    athleteGoalTotal: c.athlete_goal_total_kg != null ? Number(c.athlete_goal_total_kg) : null,
  };
}

export function readObservations(raw: unknown): Observation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (o: any) =>
        o && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && Number(o.loadKg) > 0 && Number(o.reps) >= 1,
    )
    .map((o: any) => ({
      id: typeof o.id === "string" ? o.id : undefined,
      date: o.date,
      lift: LIFTS.includes(o.lift) ? o.lift : null,
      exercise: String(o.exercise ?? "").slice(0, 80),
      loadKg: Number(o.loadKg),
      reps: Math.round(Number(o.reps)),
      rpe: o.rpe != null && Number.isFinite(Number(o.rpe)) ? Number(o.rpe) : null,
      standard: ["competition", "variation", "unclear"].includes(o.standard)
        ? o.standard
        : "unclear",
      equipment: o.equipment ?? null,
      source: ["instagram", "video", "screenshot", "link", "manual", "caption"].includes(o.source)
        ? o.source
        : "manual",
      url: typeof o.url === "string" ? o.url : null,
      confidence: ["high", "medium", "low"].includes(o.confidence) ? o.confidence : "low",
      note: o.note ?? null,
    }));
}

export function readMeets(raw: unknown): MeetRecord[] {
  return Array.isArray(raw)
    ? (raw.filter((m: any) => m && /^\d{4}-\d{2}-\d{2}$/.test(m.date)) as MeetRecord[])
    : [];
}

export type LoadedCompetition = { ctx: BriefContext; competition: any; client: any };

export async function loadCompetitionContext(
  sb: Db,
  competitionId: string,
  opts: { milestone?: MilestoneKind | null; today?: string } = {},
): Promise<LoadedCompetition> {
  const { data: comp, error } = await sb
    .from("competitions")
    .select("*")
    .eq("id", competitionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!comp) throw new Error("Competition not found");
  const clientId = comp.client_id as string;
  const today = opts.today ?? todayWinnipeg();
  const facts = readCompetitionFacts(comp);

  const { data: client } = await sb
    .from("clients")
    .select("id, full_name, first_name, preferred_name, timezone, user_id, sex, assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  const since = addDays(today, -7 * 160);

  const [
    sets,
    meetRows,
    warmRows,
    bwRows,
    painMap,
    checkins,
    blocks,
    cardio,
    competitors,
    previous,
    calls,
    enrollment,
    checks,
  ] = await Promise.all([
    safe(() => compSets(sb, clientId, addDays(today, -7 * 120)), [] as any[]),
    safe(
      async () =>
        (
          await sb
            .from("athlete_powerlifting_results")
            .select(
              "meet_date, meet_name, federation, equipment, event, division, weight_class_kg, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, total_kg, place, attempts, tested",
            )
            .eq("client_id", clientId)
            .gte("meet_date", since)
            .order("meet_date", { ascending: false })
            .limit(60)
        ).data ?? [],
      [] as any[],
    ),
    safe(
      async () =>
        (
          await sb
            .from("pl_warmup_sets")
            .select("row_id, load, unit, reps, created_at")
            .eq("client_id", clientId)
            .gte("created_at", `${addDays(today, -84)}T00:00:00Z`)
            .limit(2000)
        ).data ?? [],
      [] as any[],
    ),
    safe(async () => {
      if (!client?.user_id) return [];
      return (
        (
          await sb
            .from("progress_bodyweight")
            .select("logged_date, weight_value, weight_unit")
            .eq("user_id", client.user_id)
            .gte("logged_date", addDays(today, -28))
            .order("logged_date", { ascending: true })
            .limit(60)
        ).data ?? []
      );
    }, [] as any[]),
    safe(async () => {
      const { loadPainEntries } = await import("@/lib/pain/load");
      const { buildPainHistory } = await import("@/lib/pain/history");
      const entries = await loadPainEntries(sb, [clientId]);
      return buildPainHistory(entries.get(clientId) ?? [], today);
    }, null as any),
    safe(
      async () =>
        (
          await sb
            .from("messenger_checkins")
            .select("submitted_at, answers")
            .eq("client_id", clientId)
            .eq("task_type", "weekly_checkin")
            .eq("status", "completed")
            .not("submitted_at", "is", null)
            .order("submitted_at", { ascending: false })
            .limit(3)
        ).data ?? [],
      [] as any[],
    ),
    safe(
      async () => {
        const cols =
          "id, name, start_date, end_date, status, archived, client_visible, training_focus";
        let r = await sb
          .from("pl_blocks")
          .select(`${cols}, block_type`)
          .eq("client_id", clientId)
          .eq("archived", false)
          .limit(80);
        if (r.error)
          r = await sb
            .from("pl_blocks")
            .select(cols)
            .eq("client_id", clientId)
            .eq("archived", false)
            .limit(80);
        if (r.error) throw new Error(r.error.message);
        return r.data ?? [];
      },
      null as any[] | null,
    ),
    safe(
      async () =>
        (
          await sb
            .from("cardio_targets")
            .select(
              "duration_minutes, frequency_per_week, scheduled_weekdays, enabled, status, start_date, end_date",
            )
            .eq("client_id", clientId)
            .limit(40)
        ).data ?? [],
      [] as any[],
    ),
    safe(
      async () =>
        (
          await sb
            .from("competition_competitors")
            .select("id, name, identity, meets, observations")
            .eq("competition_id", competitionId)
            .eq("archived", false)
            .order("created_at")
        ).data ?? [],
      [] as any[],
    ),
    safe(
      async () =>
        (
          await sb
            .from("competition_assessments")
            .select("internal, kind, created_at")
            .eq("competition_id", competitionId)
            .neq("status", "superseded")
            .order("created_at", { ascending: false })
            .limit(1)
        ).data?.[0] ?? null,
      null as any,
    ),
    safe(
      async () =>
        (
          await sb
            .from("pt_sessions")
            .select("session_date, status, session_type, title, uses_credit")
            .eq("client_id", clientId)
            .gte("session_date", addDays(today, -60))
            .lte("session_date", facts.meetDate)
            .limit(200)
        ).data ?? [],
      [] as any[],
    ),
    safe(
      async () =>
        (
          await sb
            .from("coaching_package_enrollments")
            .select(
              "included_calls, coaching_packages!inner(name, included_calls, call_booking_card_id)",
            )
            .eq("client_id", clientId)
            .eq("status", "active")
            .limit(1)
        ).data?.[0] ?? null,
      null as any,
    ),
    safe(
      async () =>
        (
          await sb
            .from("competition_assessments")
            .select("internal, competition_id, competitions!inner(meet_date, results)")
            .eq("client_id", clientId)
            .eq("kind", "confirm")
            .neq("competition_id", competitionId)
            .not("competitions.results", "is", null)
            .limit(10)
        ).data ?? [],
      [] as any[],
    ),
  ]);

  // the strength line per lift (the analytics' own read), meets as lifted
  const meets = meetRows.map(meetFromRow);
  const strengths = liftStrengths(sets, meetsFromRows(meetRows), today);
  const lifts = {} as Record<Lift, LiftEvidence>;
  const conversion: ConversionPoint[] = [];
  const topSingles: Partial<Record<Lift, number | null>> = {};
  const sixWeeks = addDays(today, -42);
  for (const lift of LIFTS) {
    const ls = strengths[lift];
    const now = envelopeAt(ls.envelope, today);
    const trend = envelopeTrend(ls.envelope, addDays(today, -56), today);
    const weeks =
      trend.kind !== "unclear" ? Math.max(1, daysBetween(trend.from.day, trend.to.day) / 7) : 1;
    lifts[lift] = {
      lift,
      nowKg: now ? kg(now.value) : null,
      state: now?.state ?? null,
      basis: basisWords(now, ls.sessions),
      basisDay: now?.basis ?? null,
      hardSessions6w: ls.sessions.filter((s) => s.confidence === "high" && s.day >= sixWeeks)
        .length,
      trendPerWeek:
        trend.kind === "unclear" ? null : Math.round((trend.pct / 100 / weeks) * 10000) / 10000,
      direction:
        trend.kind === "unclear" ? "unclear" : trend.kind === "steady" ? "flat" : trend.kind,
    };
    const singles = ls.sessions
      .filter((s) => s.day >= sixWeeks && s.set.reps <= 2)
      .map((s) => kg(s.heaviest));
    topSingles[lift] = singles.length ? Math.max(...singles) : null;
    // training-to-platform: each past meet against the training line 3 weeks before it
    const trainingOnly = strengthEnvelope(ls.sessions);
    for (const m of meets) {
      const v = m[lift];
      if (!v || m.date >= today) continue;
      const pre = envelopeAt(trainingOnly, addDays(m.date, -21));
      if (
        !pre ||
        (pre.state !== "measured" && pre.state !== "raised") ||
        daysBetween(pre.basis, addDays(m.date, -21)) > 42
      )
        continue;
      conversion.push({ lift, meetDate: m.date, meetKg: v, trainingKg: kg(pre.value) });
    }
  }

  // warm-up habits per lift: warm-ups before the first working set of the same row and day
  const setsByRowDay = new Map<string, any[]>();
  for (const s of sets) {
    const key = `${s.row_id}|${String(s.date).slice(0, 10)}`;
    (setsByRowDay.get(key) ?? setsByRowDay.set(key, []).get(key)!).push(s);
  }
  const warmSessions: Record<Lift, Array<{ warmups: number[]; firstWorkingKg: number | null }>> = {
    squat: [],
    bench: [],
    deadlift: [],
  };
  const warmByRowDay = new Map<string, number[]>();
  for (const w of warmRows) {
    const key = `${w.row_id}|${String(w.created_at).slice(0, 10)}`;
    const k = (w.unit === "lb" ? Number(w.load) / LB_PER_KG : Number(w.load)) || 0;
    if (k > 0) (warmByRowDay.get(key) ?? warmByRowDay.set(key, []).get(key)!).push(k);
  }
  for (const [key, ws] of warmByRowDay) {
    const work = setsByRowDay.get(key);
    if (!work?.length) continue;
    const lift = liftOf(work[0].competition_lift_type);
    if (!lift) continue;
    const first = [...work].sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0))[0];
    warmSessions[lift].push({
      warmups: ws,
      firstWorkingKg: first.load > 0 ? first.load / LB_PER_KG : null,
    });
  }
  const warmups: Partial<Record<Lift, WarmupHistory>> = {};
  for (const lift of LIFTS)
    if (warmSessions[lift].length) warmups[lift] = warmupHistory(warmSessions[lift]);

  // bodyweight: 7-day average and the weekly trend over the last 3 weeks
  const bw = bwRows
    .map((r: any) => ({
      day: String(r.logged_date),
      kg: r.weight_unit === "lb" ? Number(r.weight_value) / LB_PER_KG : Number(r.weight_value),
    }))
    .filter((r: any) => r.kg > 25);
  const last7 = bw.filter((r: any) => r.day >= addDays(today, -7));
  const bodyweightAvg = last7.length
    ? Math.round((last7.reduce((s: number, r: any) => s + r.kg, 0) / last7.length) * 10) / 10
    : null;
  const recent = bw.filter((r: any) => r.day >= addDays(today, -21));
  let bodyweightTrendPerWeek: number | null = null;
  if (recent.length >= 4) {
    const xs = recent.map((r: any) => daysBetween(today, r.day));
    const mx = xs.reduce((s: number, x: number) => s + x, 0) / xs.length;
    const my = recent.reduce((s: number, r: any) => s + r.kg, 0) / recent.length;
    const sxx = xs.reduce((s: number, x: number) => s + (x - mx) ** 2, 0);
    if (sxx > 0)
      bodyweightTrendPerWeek =
        Math.round(
          (xs.reduce((s: number, x: number, i: number) => s + (x - mx) * (recent[i].kg - my), 0) /
            sxx) *
            7 *
            100,
        ) / 100;
  }

  // program coverage and whether a peak covers the final weeks
  const programRead = blocks != null;
  const live = (blocks ?? []).filter(
    (b: any) =>
      b.client_visible !== false &&
      !["Completed", "Archived"].includes(String(b.status)) &&
      b.end_date,
  );
  const programEndsOn = live.length
    ? live
        .map((b: any) => String(b.end_date).slice(0, 10))
        .sort()
        .pop()!
    : null;
  const finalFrom = addDays(facts.meetDate, -21);
  const finalBlocks = live.filter(
    (b: any) =>
      String(b.end_date) >= finalFrom && (!b.start_date || String(b.start_date) <= facts.meetDate),
  );
  const peakCovered = live.length
    ? finalBlocks.some((b: any) =>
        /peak|taper|intensif|meet|comp/i.test(
          `${b.block_type ?? ""} ${b.name ?? ""} ${b.training_focus ?? ""}`,
        ),
      )
    : null;

  const pain = ((painMap?.flagged ?? []) as any[]).map((a) => ({
    place: a.label as string,
    lift: liftForPlace(a.label ?? a.region ?? ""),
    worse: a.trend === "worse",
    score: a.latest?.score ?? null,
  }));
  const recoveryFlags = checkins.filter((c: any) => {
    const f = c.answers?.recovery_flags;
    return Array.isArray(f) && f.some((x: string) => /sleep|stress|energy/i.test(x));
  }).length;

  const activeCardio = cardio.filter(
    (c: any) =>
      c.enabled !== false &&
      !/archived|ended|inactive/i.test(String(c.status ?? "")) &&
      String(c.start_date ?? "") <= today &&
      (!c.end_date || String(c.end_date) >= today),
  );
  const perWeek = (c: any) =>
    Number(c.frequency_per_week) ||
    (Array.isArray(c.scheduled_weekdays) ? c.scheduled_weekdays.length : 0);
  const cardioMinutesPerWeek = activeCardio.length
    ? activeCardio.reduce(
        (s: number, c: any) => s + (Number(c.duration_minutes) || 0) * perWeek(c),
        0,
      )
    : null;

  // calls: the last one held and one already booked before the meet
  const isCall = (s: any) =>
    s.uses_credit === false ||
    /call|consult|meeting|strategy/i.test(`${s.session_type ?? ""} ${s.title ?? ""}`);
  const held = calls
    .filter(
      (s: any) =>
        isCall(s) && s.session_date <= today && ["Completed", "Scheduled"].includes(s.status),
    )
    .map((s: any) => String(s.session_date))
    .sort();
  const upcoming = calls
    .filter((s: any) => isCall(s) && s.session_date > today && s.status === "Scheduled")
    .map((s: any) => String(s.session_date))
    .sort();
  let includedCallsLeft: number | null = null;
  const pkg = enrollment?.coaching_packages;
  const includedCalls = enrollment ? (enrollment.included_calls ?? pkg?.included_calls ?? 0) : 0;
  if (enrollment && includedCalls > 0 && pkg?.call_booking_card_id) {
    const u = await safe(
      async () =>
        (
          await sb.rpc("coaching_call_usage", {
            _client: clientId,
            _card: pkg.call_booking_card_id,
            _on: today,
          })
        ).data,
      null as any,
    );
    includedCallsLeft = u ? Number(u.left) : null;
  }

  const forecastChecks = (checks as any[]).flatMap((c) => {
    const exp = c.internal?.engine?.forecast?.total?.expected;
    const actual = Number(c.competitions?.results?.total);
    return exp && actual
      ? [
          {
            meetDate: String(c.competitions.meet_date),
            lift: "total" as const,
            predicted: Number(exp),
            actual,
          },
        ]
      : [];
  });

  const name = client?.full_name || [client?.first_name].filter(Boolean).join(" ") || "Athlete";
  const ctx: BriefContext = {
    today,
    milestone: opts.milestone ?? null,
    competition: facts,
    athlete: {
      name,
      firstName: client?.preferred_name || client?.first_name || name.split(" ")[0],
      sex:
        client?.sex === "male" || client?.sex === "M"
          ? "M"
          : client?.sex === "female" || client?.sex === "F"
            ? "F"
            : null,
      bodyweightAvg,
      bodyweightTrendPerWeek,
      classLimit: classLimitKg(facts.weightClass),
    },
    lifts,
    meets,
    conversion,
    warmups,
    topSingles,
    competitors: competitors.map((c: any) => ({
      id: c.id,
      name: c.name,
      identity: c.identity,
      meets: readMeets(c.meets),
      observations: readObservations(c.observations),
    })),
    watch: {
      programEndsOn,
      programRead,
      peakCovered: programRead ? peakCovered : null,
      pain,
      recoveryFlags,
      adherence: null,
      cardioMinutesPerWeek,
    },
    call: {
      lastCallDaysAgo: held.length ? daysBetween(held[held.length - 1], today) : null,
      upcomingCallOn: upcoming[0] ?? null,
      includedCallsLeft,
      packageName: pkg?.name ?? null,
    },
    previous: previous
      ? { expectedTotal: previous.internal?.engine?.forecast?.total?.expected ?? null }
      : null,
    checks: forecastChecks,
    cues: {},
  };
  return { ctx, competition: comp, client };
}
