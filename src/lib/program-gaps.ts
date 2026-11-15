/**
 * Missing program data: what a coaching client is about to train that they
 * can't follow yet, one reading for Messages (the Program data filter, a
 * chat row's line, the Brief), the client's Training tab and the Missing
 * program data page. Pure: `program_gaps()` (the database) returns the
 * upcoming, untouched workouts' rows that might be missing something, and
 * this decides with the builder's own rule (`rowProblems`) and the logger's
 * own max lookup (`computeRowLoad`), so all of them always agree.
 *
 * A client's gaps, each with its own fix:
 *   - workouts: rows missing a prescription (an exercise, sets, reps or time,
 *     or any of RPE / RIR / a weight / a % the app can read): the editor, or
 *     Edit with AI with `fillInstruction`;
 *   - maxes: a % of a training max or 1RM with no max on file for that lift
 *     (the athlete sees no weight): Athlete setup;
 *   - undated: workouts on a live program with no date: Place them;
 *   - no training days set while a program is live: Athlete setup.
 */
import { rowProblems, ROW_LABEL, type RowProblem } from "@/lib/pl-template-validation";
import { buildMaxIndex, computeRowLoad, type ClientMaxRow } from "@/lib/pl-maxes";
import { referenceFamily, type LiftFamily } from "@/lib/workouts/load-reference";

/** A gap this many days out (or sooner) is due soon: amber on the inbox, first on the list. */
export const SOON_DAYS = 7;

export type ProgramGapsData = {
  clients: Array<{ id: string; name: string | null; first_name: string | null; photo: string | null; training_days: string[] | null; today: string; no_training_days: boolean }>;
  blocks: Array<{ id: string; client_id: string; name: string | null; start_date: string | null }>;
  days: Array<{ id: string; block_id: string; client_id: string; week_index: number | null; day_index: number | null; title: string | null; date: string | null; optional: boolean | null }>;
  rows: Array<{
    id: string; day_id: string; sort_order: number | null; exercise_id: string | null; exercise: string | null;
    exercise_name_override: string | null; sets: number | null; reps_text: string | null; rpe: string | null; rir: string | null;
    percentage: number | string | null; percentage_basis: string | null; load_kg: number | string | null; load_lb: number | string | null;
    measurement_type: string | null; duration_seconds: number | null; movement_family: string | null;
    competition_lift_type: string | null; exercise_family: string | null;
  }>;
  maxes: ClientMaxRow[];
};

export const EMPTY_PROGRAM_GAPS: ProgramGapsData = { clients: [], blocks: [], days: [], rows: [], maxes: [] };

export type GapItem = { rowId: string; exercise: string; problems: RowProblem[] };
export type GapWorkout = {
  dayId: string;
  blockId: string;
  blockName: string;
  weekIndex: number | null;
  dayIndex: number | null;
  title: string | null;
  date: string | null;
  optional: boolean;
  items: GapItem[];
};
export type MissingMax = {
  /** "training_max" or "1rm" */
  basis: string;
  /** the lift the max is for: its competition lift ("Squat"), else the exercise */
  lift: string;
  exercises: string[];
  /** sets (rows) that read it */
  rows: number;
  firstDate: string | null;
  /** rows with no RPE or RIR either: the athlete sees nothing to go by */
  nothingElse: number;
};
export type UndatedBlock = { blockId: string; blockName: string; count: number };

export type ClientProgramGaps = {
  clientId: string;
  name: string;
  firstName: string;
  photo: string | null;
  today: string;
  workouts: GapWorkout[];
  maxes: MissingMax[];
  undated: UndatedBlock[];
  noTrainingDays: boolean;
  /** the soonest dated workout anything here affects */
  firstDate: string | null;
  /** something affects a workout within SOON_DAYS (or nothing can be scheduled: no days, no dates) */
  dueSoon: boolean;
  /** one count per thing to fix: each workout, each max, each block's undated workouts, the training days */
  count: number;
};

const FAMILY_LABEL: Record<LiftFamily, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
export const MAX_BASIS_LABEL: Record<string, string> = { training_max: "Training max", "1rm": "1RM" };

/** Whole days from `a` to `b` (ISO dates). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = b.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const blank = (v: unknown) => v == null || String(v).trim() === "";
const minDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

/** Is this % row missing the max it reads (the logger would show no weight from it)? */
function missingMaxFor(row: ProgramGapsData["rows"][number], blockId: string, clientMaxes: ClientMaxRow[]): { lift: string } | null {
  const basis = String(row.percentage_basis ?? "");
  if ((basis !== "training_max" && basis !== "1rm") || blank(row.percentage)) return null;
  const family = referenceFamily({ rowFamily: row.movement_family, competitionLiftType: row.competition_lift_type, movementFamily: row.exercise_family });
  const ownCompetition = !!family && String(row.competition_lift_type ?? "").toLowerCase() === family;
  const index = buildMaxIndex(clientMaxes.filter((m) => !m.block_id || m.block_id === blockId));
  const res = computeRowLoad({
    exerciseName: row.exercise,
    basis,
    percentage: Number(row.percentage),
    manualLoadKg: null,
    manualLoadLb: null,
    unit: "kg",
    maxesIndex: index,
    family,
    ownCompetition,
  });
  if (res.status !== "no-max") return null;
  return { lift: family ? FAMILY_LABEL[family] : (row.exercise ?? "This exercise") };
}

/** Every client with something missing, the most urgent first. */
export function buildProgramGaps(data: ProgramGapsData | null | undefined): ClientProgramGaps[] {
  const d = data ?? EMPTY_PROGRAM_GAPS;
  const blocks = new Map(d.blocks.map((b) => [b.id, b]));
  const days = new Map(d.days.map((x) => [x.id, x]));
  const maxesByClient = new Map<string, ClientMaxRow[]>();
  for (const m of d.maxes ?? []) maxesByClient.set(m.client_id, [...(maxesByClient.get(m.client_id) ?? []), m]);

  const out: ClientProgramGaps[] = [];
  for (const c of d.clients) {
    const workouts = new Map<string, GapWorkout>();
    const maxes = new Map<string, MissingMax>();
    const clientMaxes = maxesByClient.get(c.id) ?? [];
    const rows = d.rows
      .filter((r) => days.get(r.day_id)?.client_id === c.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    for (const r of rows) {
      const day = days.get(r.day_id)!;
      const block = blocks.get(day.block_id);
      const problems = rowProblems(r);
      if (problems.length) {
        const w = workouts.get(day.id) ?? {
          dayId: day.id,
          blockId: day.block_id,
          blockName: block?.name ?? "Program",
          weekIndex: day.week_index,
          dayIndex: day.day_index,
          title: day.title,
          date: day.date,
          optional: !!day.optional,
          items: [],
        };
        w.items.push({ rowId: r.id, exercise: r.exercise ?? "Unnamed exercise", problems });
        workouts.set(day.id, w);
      }
      const miss = missingMaxFor(r, day.block_id, clientMaxes);
      if (miss) {
        const key = `${r.percentage_basis}:${miss.lift}`;
        const m = maxes.get(key) ?? { basis: String(r.percentage_basis), lift: miss.lift, exercises: [], rows: 0, firstDate: null, nothingElse: 0 };
        m.rows += 1;
        const ex = r.exercise ?? "";
        if (ex && !m.exercises.includes(ex)) m.exercises.push(ex);
        m.firstDate = minDate(m.firstDate, day.date);
        if (blank(r.rpe) && blank(r.rir)) m.nothingElse += 1;
        maxes.set(key, m);
      }
    }
    const undatedMap = new Map<string, UndatedBlock>();
    for (const day of d.days) {
      if (day.client_id !== c.id || day.date) continue;
      const u = undatedMap.get(day.block_id) ?? { blockId: day.block_id, blockName: blocks.get(day.block_id)?.name ?? "Program", count: 0 };
      u.count += 1;
      undatedMap.set(day.block_id, u);
    }
    const workoutList = [...workouts.values()].sort(byDate);
    const maxList = [...maxes.values()].sort((a, b) => cmpDate(a.firstDate, b.firstDate) || b.rows - a.rows);
    const undated = [...undatedMap.values()];
    const noTrainingDays = !!c.no_training_days;
    const count = workoutList.length + maxList.length + undated.length + (noTrainingDays ? 1 : 0);
    if (!count) continue;
    let firstDate: string | null = null;
    for (const w of workoutList) firstDate = minDate(firstDate, w.date);
    for (const m of maxList) firstDate = minDate(firstDate, m.firstDate);
    const today = String(c.today ?? "").slice(0, 10);
    const dueSoon = noTrainingDays || undated.length > 0 || (!!firstDate && !!today && daysBetween(today, firstDate) <= SOON_DAYS);
    const name = (c.name ?? "").trim() || "Client";
    out.push({
      clientId: c.id,
      name,
      firstName: (c.first_name ?? "").trim() || name.split(/\s+/)[0],
      photo: c.photo ?? null,
      today,
      workouts: workoutList,
      maxes: maxList,
      undated,
      noTrainingDays,
      firstDate,
      dueSoon,
      count,
    });
  }
  return out.sort((a, b) => Number(b.dueSoon) - Number(a.dueSoon) || cmpDate(a.firstDate, b.firstDate) || a.name.localeCompare(b.name));
}

function cmpDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}
function byDate(a: GapWorkout, b: GapWorkout): number {
  return cmpDate(a.date, b.date) || (a.weekIndex ?? 0) - (b.weekIndex ?? 0) || (a.dayIndex ?? 0) - (b.dayIndex ?? 0);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Mon, Nov 16" from an ISO date (no time zone shift). */
export function gapDateLabel(iso: string | null | undefined): string {
  if (!iso) return "No date";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** When the first affected workout is: "Today", "Tomorrow", "In 3 days", else the date. */
export function whenLabel(today: string, date: string | null): string | null {
  if (!date || !today) return null;
  const d = daysBetween(today, date);
  if (d <= 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d <= SOON_DAYS) return `In ${d} days`;
  return gapDateLabel(date);
}

/** What a gap needs, in words: "RPE, RIR, or suggested load". */
export function problemsLabel(problems: RowProblem[]): string {
  return problems.map((p) => ROW_LABEL[p]).join(", ");
}

/**
 * The parts of a client's gaps, shortest words first: for a chat row's line
 * and the Brief. `schedule: false` leaves out the dates and training days
 * (the Training tab says those itself).
 */
export function gapParts(g: ClientProgramGaps, { schedule = true }: { schedule?: boolean } = {}): string[] {
  const parts: string[] = [];
  if (g.workouts.length) parts.push(`${plural(g.workouts.length, "workout")} missing a prescription`);
  for (const m of g.maxes) parts.push(`${MAX_BASIS_LABEL[m.basis] ?? "Max"} for ${m.lift} not on file`);
  if (!schedule) return parts;
  const undated = g.undated.reduce((n, u) => n + u.count, 0);
  if (undated) parts.push(`${plural(undated, "workout")} with no date`);
  if (g.noTrainingDays) parts.push("No training days set");
  return parts;
}

/** A chat row's line: the most pressing part, "+N more" for the rest. */
export function gapTagLabel(g: ClientProgramGaps): string {
  const parts = gapParts(g);
  if (!parts.length) return "";
  const first = parts[0];
  return parts.length > 1 ? `${first} +${parts.length - 1}` : first;
}

/** The Brief's detail line: when it starts, then everything else. */
export function gapDetail(g: ClientProgramGaps): string {
  const parts = gapParts(g);
  const when = g.firstDate ? `from ${gapDateLabel(g.firstDate)}` : null;
  return [when, ...parts].filter(Boolean).join(" · ");
}

/** One plain line each for the Brief's AI read (dates, never "in 2 days"). */
export function gapBriefLines(g: ClientProgramGaps | null | undefined): string[] {
  if (!g) return [];
  const lines: string[] = [];
  for (const w of g.workouts.slice(0, 6)) {
    lines.push(`Program: the ${w.date ?? "undated"} workout (${w.blockName}, week ${w.weekIndex ?? "?"}) is missing ${w.items.map((i) => `${i.exercise}'s ${problemsLabel(i.problems)}`).join("; ")}`);
  }
  if (g.workouts.length > 6) lines.push(`Program: ${g.workouts.length - 6} more upcoming workouts are missing a prescription`);
  for (const m of g.maxes) lines.push(`Program: ${m.rows} sets from ${m.firstDate ?? "an undated workout"} are a % of the ${m.lift} ${MAX_BASIS_LABEL[m.basis] ?? "max"}, and none is on file`);
  for (const u of g.undated) lines.push(`Program: ${u.count} workouts in ${u.blockName} have no date`);
  if (g.noTrainingDays) lines.push("Program: no training days set while a program is live");
  return lines;
}

/**
 * What Edit with AI is asked when the coach taps Fill in with AI: the exact
 * rows and what each is missing, and to change nothing else. The coach still
 * reads the proposal and applies it.
 */
export function fillInstruction(g: ClientProgramGaps, blockId?: string | null): string {
  const workouts = g.workouts.filter((w) => !blockId || w.blockId === blockId);
  const all = workouts.flatMap((w) =>
    w.items.map((i) => `- ${w.blockName}, week ${w.weekIndex ?? "?"}, ${gapDateLabel(w.date)}: ${i.exercise} (missing ${problemsLabel(i.problems)})`),
  );
  const head = "Fill in what these upcoming workouts are missing, and change nothing else:";
  const maxes = g.maxes.length
    ? `\nThere's no ${g.maxes.map((m) => `${m.lift} ${MAX_BASIS_LABEL[m.basis] ?? "max"}`).join(" or ")} on file: don't invent one; give those sets an RPE so ${g.firstName} has something to go by.`
    : "";
  const tail = `\nUse each exercise's notes and the rest of the program: an RPE for the main lifts and their back-offs, an RIR for accessories, the low end of any range in the notes ("easy" is RIR 4).`;
  // the AI's box takes FILL_MAX characters: list what fits, then say how many more
  const lines: string[] = [];
  let used = head.length + maxes.length + tail.length + 60;
  for (const l of all) {
    if (used + l.length + 1 > FILL_MAX) break;
    lines.push(l);
    used += l.length + 1;
  }
  const more = all.length > lines.length ? `\n…and ${all.length - lines.length} more like these in the same workouts and weeks.` : "";
  return [head, ...lines].join("\n") + more + maxes + tail;
}

/** Edit with AI's instruction limit (program-ai.functions.ts). */
export const FILL_MAX = 4000;
