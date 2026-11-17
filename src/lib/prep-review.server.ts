/**
 * A meet prep's coach review, read with the coach's own session (RLS decides):
 * each competition lift's block Training Max against the % sets loaded off it
 * (tm-review.ts), a missing one's calibration read, and the lift-specific taper
 * for a confirmed lifting day (meet-taper.ts). Nothing here writes a Training
 * Max or moves a session by itself: prep-review.functions.ts does that only on
 * the coach's tap.
 */
import { isCompetitionMaxName, referenceFamily, type LiftFamily } from "@/lib/workouts/load-reference";
import { recommendFromCalibration, reviewTrainingMax, type CalibrationRead, type TmReview, type TmSet } from "@/lib/workouts/tm-review";
import {
  addDays,
  classifyTaperRow,
  daysBetween,
  pastMeetTapers,
  planLiftTaper,
  slowLiftsFrom,
  TAPER_LIFTS,
  type LiftSet,
  type TaperLift,
  type TaperPlan,
  type TaperSession,
} from "@/lib/workouts/meet-taper";

type Db = any;
const LB = 0.45359237;
/** The name a new block Training Max is stored under (the names already on file). */
export const TM_LIFT_NAME: Record<TaperLift, string> = {
  squat: "Competition Squat",
  bench: "Competition Bench Press",
  deadlift: "Competition Deadlift",
};

async function pageAll<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) throw new Error(error.message ?? String(error));
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function inChunks<T>(ids: string[], run: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    out.push(...(await pageAll<T>((f, t) => run(chunk, f, t))));
  }
  return out;
}

/** The top of a prescribed RPE: "6-7" → 7, "8" → 8, "8–8.5" → 8.5. */
export function rpeTop(rpe: unknown): number | null {
  const nums = String(rpe ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number).filter((n) => n >= 1 && n <= 10) ?? [];
  return nums.length ? Math.max(...nums) : null;
}

const localDate = (iso: string, tz: string) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
};

export type PrepInfo = {
  id: string;
  title: string;
  eventName: string | null;
  start: string;
  end: string | null;
  dayTbd: boolean;
};

export type PrepLift = {
  lift: TaperLift;
  blockId: string | null;
  blockName: string | null;
  tmKg: number | null;
  review: TmReview | null;
  calibration: (CalibrationRead & { date: string | null }) | null;
};

export type PrepReview = { prep: PrepInfo | null; lifts: PrepLift[] };

type Loaded = {
  prep: any;
  blocks: any[];
  weeks: any[];
  days: any[];
  rows: any[];
  results: any[];
  maxes: any[];
  tz: string;
  trainingDays: string[];
};

async function loadPrep(sb: Db, clientId: string, prepId: string | null, today: string): Promise<Loaded | null> {
  const { data: client } = await sb.from("clients").select("timezone, committed_training_days").eq("id", clientId).maybeSingle();
  const tz = client?.timezone || "America/Winnipeg";
  let q = sb
    .from("pl_preps")
    .select("id, client_id, title, event_name, event_date, event_end_date, event_day_tbd, archived")
    .eq("client_id", clientId)
    .eq("archived", false)
    .not("event_date", "is", null)
    .order("event_date");
  if (prepId) q = q.eq("id", prepId);
  const { data: preps, error } = await q;
  if (error) throw new Error(error.message);
  const prep = (preps ?? []).find((p: any) => (p.event_end_date ?? p.event_date) >= today) ?? null;
  if (!prep) return null;
  const { data: blocks, error: be } = await sb
    .from("pl_blocks")
    .select("id, name, start_date, end_date, status, sort_order, archived")
    .eq("prep_id", prep.id)
    .eq("archived", false)
    .order("sort_order");
  if (be) throw new Error(be.message);
  const blockIds = (blocks ?? []).map((b: any) => b.id);
  const weeks = await inChunks<any>(blockIds, (c, f, t) => sb.from("pl_weeks").select("id, block_id, week_index").in("block_id", c).order("id").range(f, t));
  const days = await inChunks<any>(weeks.map((w) => w.id), (c, f, t) =>
    sb.from("pl_days").select("id, week_id, day_index, title, scheduled_date, schedule_locked, is_optional, archived").in("week_id", c).eq("archived", false).order("id").range(f, t),
  );
  const rows = await inChunks<any>(days.map((d) => d.id), (c, f, t) =>
    sb
      .from("pl_exercise_rows")
      .select("id, day_id, sort_order, sets, reps_text, rpe, percentage, percentage_basis, movement_family, exercises(id, name, competition_lift_type, movement_family, is_competition_lift)")
      .in("day_id", c)
      .order("id")
      .range(f, t),
  );
  const results = await inChunks<any>(rows.map((r) => r.id), (c, f, t) =>
    sb
      .from("pl_row_results")
      .select("row_id, set_index, normalized_kg, actual_reps, actual_rpe_num, actual_rpe, completed_at, is_working_set")
      .eq("client_id", clientId)
      .in("row_id", c)
      .order("row_id")
      .range(f, t),
  );
  const maxes = await inChunks<any>(blockIds, (c, f, t) =>
    sb.from("pl_client_maxes").select("id, lift, training_max, unit, block_id, active").eq("client_id", clientId).in("block_id", c).order("id").range(f, t),
  );
  return { prep, blocks: blocks ?? [], weeks, days, rows, results, maxes, tz, trainingDays: client?.committed_training_days ?? [] };
}

const familyOf = (r: any): LiftFamily | null =>
  referenceFamily({ rowFamily: r.movement_family, competitionLiftType: r.exercises?.competition_lift_type, movementFamily: r.exercises?.movement_family });
const isComp = (r: any) => !!r.exercises?.is_competition_lift && TAPER_LIFTS.includes(r.exercises?.competition_lift_type);
const resultRpe = (x: any) => {
  const n = Number(x.actual_rpe_num ?? x.actual_rpe);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
};
const logged = (x: any) => !!x.completed_at && x.is_working_set !== false && Number(x.actual_reps) > 0 && Number(x.normalized_kg) > 0;

function blockTm(L: Loaded, blockId: string, lift: TaperLift): number | null {
  const m = L.maxes.find((x) => x.block_id === blockId && x.active !== false && isCompetitionMaxName(String(x.lift ?? ""), lift) && Number(x.training_max) > 0);
  if (!m) return null;
  return String(m.unit ?? "kg").toLowerCase().startsWith("lb") ? Number(m.training_max) * LB : Number(m.training_max);
}

function currentBlock(L: Loaded, today: string) {
  const live = L.blocks.filter((b) => b.start_date);
  return (
    live.find((b) => b.start_date <= today && (!b.end_date || b.end_date >= today)) ??
    live.find((b) => b.start_date > today) ??
    live[live.length - 1] ??
    null
  );
}

function reviewFrom(L: Loaded, today: string): PrepReview {
  const prep: PrepInfo = {
    id: L.prep.id,
    title: L.prep.title,
    eventName: L.prep.event_name ?? null,
    start: L.prep.event_date,
    end: L.prep.event_end_date ?? null,
    dayTbd: !!L.prep.event_day_tbd,
  };
  const block = currentBlock(L, today);
  const weekById = new Map(L.weeks.map((w) => [w.id, w]));
  const dayById = new Map(L.days.map((d) => [d.id, d]));
  const resultsByRow = new Map<string, any[]>();
  for (const x of L.results) resultsByRow.set(x.row_id, [...(resultsByRow.get(x.row_id) ?? []), x]);
  const blockOfRow = (r: any) => weekById.get(dayById.get(r.day_id)?.week_id)?.block_id ?? null;
  const dateOfRow = (r: any, x: any) => dayById.get(r.day_id)?.scheduled_date ?? localDate(x.completed_at, L.tz);

  const lifts: PrepLift[] = TAPER_LIFTS.map((lift) => {
    const tm = block ? blockTm(L, block.id, lift) : null;
    if (tm != null) {
      // every % TM set of this lift's family, in blocks holding the same Training Max
      const sets: TmSet[] = [];
      for (const r of L.rows) {
        if (r.percentage_basis !== "training_max" || !(Number(r.percentage) > 0) || familyOf(r) !== lift) continue;
        const b = blockOfRow(r);
        if (!b || Math.abs((blockTm(L, b, lift) ?? -1) - tm) > 0.01) continue;
        const cap = rpeTop(r.rpe);
        if (cap == null) continue;
        for (const x of resultsByRow.get(r.id) ?? []) {
          if (!logged(x)) continue;
          sets.push({ date: dateOfRow(r, x), pct: Number(r.percentage), cap, kg: Number(x.normalized_kg), reps: Number(x.actual_reps), rpe: resultRpe(x) });
        }
      }
      return { lift, blockId: block!.id, blockName: block!.name, tmKg: Math.round(tm * 10) / 10, review: reviewTrainingMax({ tmKg: tm, sets }), calibration: null };
    }
    // no Training Max: the latest calibration single (a competition single prescribed by RPE alone)
    const singleRows = L.rows.filter((r) => isComp(r) && familyOf(r) === lift && String(r.reps_text ?? "").trim() === "1" && r.percentage == null);
    const withSingle = singleRows
      .map((r) => ({ r, day: dayById.get(r.day_id), sets: (resultsByRow.get(r.id) ?? []).filter(logged) }))
      .filter((x) => x.day?.scheduled_date);
    const done = withSingle.filter((x) => x.sets.length).sort((a, b) => (a.day.scheduled_date < b.day.scheduled_date ? 1 : -1))[0];
    if (!done) {
      const next = withSingle.filter((x) => x.day.scheduled_date >= today).sort((a, b) => (a.day.scheduled_date < b.day.scheduled_date ? -1 : 1))[0];
      return {
        lift,
        blockId: block?.id ?? null,
        blockName: block?.name ?? null,
        tmKg: null,
        review: null,
        calibration: { ...recommendFromCalibration({ sets: [] }), date: next?.day.scheduled_date ?? null },
      };
    }
    const sameDay = L.rows.filter((r) => r.day_id === done.r.day_id && r.id !== done.r.id && familyOf(r) === lift && r.sort_order > done.r.sort_order);
    const sets = [
      ...done.sets.map((x: any) => ({ kg: Number(x.normalized_kg), reps: Number(x.actual_reps), rpe: resultRpe(x), single: Number(x.actual_reps) === 1 })),
      ...sameDay.flatMap((r) => (resultsByRow.get(r.id) ?? []).filter(logged).map((x: any) => ({ kg: Number(x.normalized_kg), reps: Number(x.actual_reps), rpe: resultRpe(x), single: false }))),
    ];
    return {
      lift,
      blockId: block?.id ?? null,
      blockName: block?.name ?? null,
      tmKg: null,
      review: null,
      calibration: { ...recommendFromCalibration({ sets }), date: done.day.scheduled_date },
    };
  });
  return { prep, lifts };
}

export async function loadPrepReview(sb: Db, clientId: string, today: string): Promise<PrepReview> {
  const L = await loadPrep(sb, clientId, null, today);
  if (!L) return { prep: null, lifts: [] };
  return reviewFrom(L, today);
}

const WEEKDAY: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

export type MeetDayPreview = {
  prep: PrepInfo;
  day: string;
  delta: number;
  /** every taper session at its even-shift date */
  even: Array<{ dayId: string; title: string; from: string; to: string }>;
  plan: TaperPlan;
  /** sessions already trained or started: they stay where they are */
  touched: number;
};

/** The taper for a confirmed lifting day: the even shift, and the lift-by-lift plan. */
export async function previewMeetDay(sb: Db, clientId: string, prepId: string, day: string, today: string): Promise<MeetDayPreview> {
  const L = await loadPrep(sb, clientId, prepId, today);
  if (!L) throw new Error("That meet prep wasn't found, or its meet has passed.");
  const p = L.prep;
  if (day < p.event_date || day > (p.event_end_date ?? p.event_date)) throw new Error(`Pick a day from ${p.event_date} to ${p.event_end_date ?? p.event_date}.`);
  const delta = daysBetween(p.event_date, day);
  const windowStart = addDays(p.event_date, -15);
  const rowsByDay = new Map<string, any[]>();
  for (const r of L.rows) rowsByDay.set(r.day_id, [...(rowsByDay.get(r.day_id) ?? []), r]);
  const touchedDay = (d: any) =>
    (d.scheduled_date && d.scheduled_date < today) || (rowsByDay.get(d.id) ?? []).some((r) => L.results.some((x) => x.row_id === r.id));
  const candidates = L.days.filter((d) => d.schedule_locked && d.scheduled_date && d.scheduled_date >= windowStart && d.scheduled_date < p.event_date);
  const { data: comps } = candidates.length
    ? await sb.from("pl_day_completions").select("day_id").in("day_id", candidates.map((d) => d.id))
    : { data: [] };
  const started = new Set((comps ?? []).map((c: any) => c.day_id));
  const taper = candidates.filter((d) => !touchedDay(d) && !started.has(d.id)).sort((a, b) => (a.scheduled_date < b.scheduled_date ? -1 : 1));
  const taperIds = new Set(taper.map((d) => d.id));
  const before = L.days.filter((d) => d.scheduled_date && d.scheduled_date < p.event_date && !taperIds.has(d.id)).map((d) => d.scheduled_date).sort();
  const notBefore = before[before.length - 1] ?? addDays(windowStart, -1);

  const sessions: TaperSession[] = taper.map((d) => {
    const heavy = new Set<TaperLift>();
    const light = new Set<TaperLift>();
    for (const r of rowsByDay.get(d.id) ?? []) {
      if (!isComp(r)) continue;
      const kind = classifyTaperRow({ lift: familyOf(r) as TaperLift | null, rpeCap: rpeTop(r.rpe) });
      const lift = familyOf(r) as TaperLift;
      if (kind === "heavy") heavy.add(lift);
      else if (kind === "light") light.add(lift);
    }
    for (const l of heavy) light.delete(l);
    return { dayId: d.id, title: d.title ?? "Workout", date: addDays(d.scheduled_date, delta), heavy: [...heavy], light: [...light] };
  });
  const lastLight = [...sessions].reverse().find((s) => !s.heavy.length && s.light.length);
  if (lastLight) lastLight.primer = true;

  // the athlete's competition-lift history, every block, for their past meets
  const hist = await pageAll<any>((f, t) =>
    sb
      .from("pl_row_results")
      .select("normalized_kg, actual_reps, actual_rpe_num, actual_rpe, completed_at, is_working_set, pl_exercise_rows!inner(exercises!inner(competition_lift_type, is_competition_lift))")
      .eq("client_id", clientId)
      .not("completed_at", "is", null)
      .gt("normalized_kg", 0)
      .lte("actual_reps", 10)
      .order("completed_at")
      .range(f, t),
  );
  const sets: LiftSet[] = hist
    .filter((x) => x.is_working_set !== false && x.pl_exercise_rows?.exercises?.is_competition_lift && TAPER_LIFTS.includes(x.pl_exercise_rows?.exercises?.competition_lift_type))
    .map((x) => ({ date: localDate(x.completed_at, L.tz), lift: x.pl_exercise_rows.exercises.competition_lift_type, kg: Number(x.normalized_kg), reps: Number(x.actual_reps), rpe: resultRpe(x) }));
  const { data: tested } = await sb.from("pl_client_maxes").select("tested_at").eq("client_id", clientId).eq("source", "tested").not("tested_at", "is", null);
  const hints = [...new Set((tested ?? []).map((t: any) => String(t.tested_at).slice(0, 10)))] as string[];
  const meets = pastMeetTapers(sets, hints);
  const review = reviewFrom(L, today);
  const slowLifts = slowLiftsFrom(Object.fromEntries(review.lifts.map((l) => [l.lift, l.review ?? { status: "none" }])));
  const plan = planLiftTaper({
    liftingDay: day,
    sessions,
    meets,
    slowLifts,
    notBefore,
    today,
    trainingDays: L.trainingDays.map((n) => WEEKDAY[String(n).toLowerCase()]).filter((n) => n != null),
  });
  return {
    prep: review.prep!,
    day,
    delta,
    even: sessions.map((s) => ({ dayId: s.dayId, title: s.title, from: addDays(s.date, -delta), to: s.date })),
    plan,
    touched: candidates.length - taper.length,
  };
}
