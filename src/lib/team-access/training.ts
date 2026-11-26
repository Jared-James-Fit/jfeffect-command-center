/**
 * A specialist's Training tab: the athlete's program and what they logged,
 * read-only and simplified (docs/COACHING_PLATFORM.md §7). The competition
 * lifts, their barbell variations and the primary / secondary work lead; the
 * accessories are folded. No coach's notes, program notes or private
 * decisions ever come through: the server never reads those columns, and
 * nothing here has a place for them. Pure.
 */
import { compLiftOfResult, type CompLift } from "@/lib/analytics/competition-strength";
import { rangeLift } from "@/lib/workouts/pick-range";
import { exerciseRole } from "@/lib/exercise-role";
import { loggedLines, prescriptionLine, type LoggedSet } from "@/lib/workouts/training-words";

export type TrainingBlockSrc = {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  sort_order: number | null;
};
export type TrainingWeekSrc = {
  id: string;
  block_id: string;
  week_index: number;
  start_date: string | null;
  end_date: string | null;
  phase: string | null;
};
export type TrainingDaySrc = {
  id: string;
  week_id: string;
  day_index: number | null;
  title: string | null;
  subtitle: string | null;
  scheduled_date: string | null;
  is_optional: boolean | null;
};
export type TrainingRowSrc = {
  id: string;
  day_id: string;
  sort_order: number | null;
  exercise_name_override: string | null;
  sets: number | null;
  reps_text: string | null;
  rpe: string | null;
  rir: string | null;
  percentage: number | null;
  percentage_basis: string | null;
  load_kg: number | null;
  load_lb: number | null;
  load_unit: string | null;
  measurement_type: string | null;
  duration_seconds: number | null;
  purpose_label: string | null;
  movement_family: string | null;
  exercises: {
    name: string | null;
    is_competition_lift: boolean | null;
    competition_lift_type: string | null;
    movement_family: string | null;
    equipment: string | null;
  } | null;
};
export type TrainingResultSrc = LoggedSet & { row_id: string; completed_at: string | null };

export type RowKind =
  | "competition"
  | "variation"
  | "primary"
  | "secondary"
  | "backoff"
  | "accessory"
  | "warmup"
  | "cardio";

export type TrainingRow = {
  id: string;
  name: string;
  kind: RowKind;
  lift: CompLift | null;
  prescription: string;
  logged: string[];
};

export type DayStatus = "done" | "today" | "upcoming" | "missed" | "skipped" | "undated";

export type TrainingDay = {
  id: string;
  date: string | null;
  title: string;
  status: DayStatus;
  optional: boolean;
  main: TrainingRow[];
  accessories: TrainingRow[];
};

export type TrainingWeek = {
  id: string;
  number: number;
  start: string | null;
  end: string | null;
  phase: string | null;
  current: boolean;
  days: TrainingDay[];
};

export type TrainingView = {
  blocks: Array<{
    id: string;
    name: string;
    start: string | null;
    end: string | null;
    current: boolean;
  }>;
  block: { id: string; name: string; start: string | null; end: string | null } | null;
  weeks: TrainingWeek[];
  upcoming: Array<{ dayId: string; date: string; title: string }>;
  recent: Array<{ dayId: string; date: string; title: string }>;
};

const MAIN_KINDS: ReadonlySet<RowKind> = new Set([
  "competition",
  "variation",
  "primary",
  "secondary",
  "backoff",
]);

export function rowKind(r: TrainingRowSrc): { kind: RowKind; lift: CompLift | null } {
  const ex = r.exercises;
  const name = r.exercise_name_override || ex?.name || "";
  const lift = ex
    ? compLiftOfResult({
        is_competition_lift: ex.is_competition_lift === true,
        competition_lift_type: ex.competition_lift_type,
      })
    : null;
  const role = exerciseRole({
    purposeLabel: r.purpose_label,
    cardio: r.measurement_type === "time" && /cardio|walk|bike|treadmill|run/i.test(name),
  });
  if (role === "warmup") return { kind: "warmup", lift };
  if (role === "cardio") return { kind: "cardio", lift };
  if (lift) return { kind: role === "backoff" ? "backoff" : "competition", lift };
  if (rangeLift(r.movement_family ?? ex?.movement_family ?? null, name, ex?.equipment ?? null))
    return { kind: "variation", lift: null };
  if (role === "primary" || role === "top") return { kind: "primary", lift: null };
  if (role === "secondary") return { kind: "secondary", lift: null };
  if (role === "backoff") return { kind: "backoff", lift: null };
  return { kind: "accessory", lift: null };
}

export const KIND_WORD: Record<RowKind, string> = {
  competition: "Competition lift",
  variation: "Variation",
  primary: "Primary",
  secondary: "Secondary",
  backoff: "Back-off",
  accessory: "Accessory",
  warmup: "Warm-up",
  cardio: "Cardio",
};

/** The block running on `today`, else the next one, else the most recent. */
export function currentBlockId(blocks: TrainingBlockSrc[], today: string): string | null {
  const dated = blocks.filter((b) => b.start_date);
  const running = dated.find((b) => b.start_date! <= today && (!b.end_date || b.end_date >= today));
  if (running) return running.id;
  const next = dated
    .filter((b) => b.start_date! > today)
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!))[0];
  if (next) return next.id;
  const last = dated.sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""))[0];
  return last?.id ?? blocks[0]?.id ?? null;
}

function statusOf(date: string | null, done: boolean, optional: boolean, today: string): DayStatus {
  if (done) return "done";
  if (!date) return "undated";
  if (date === today) return "today";
  if (date > today) return "upcoming";
  return optional ? "skipped" : "missed";
}

export function buildTrainingView(input: {
  blocks: TrainingBlockSrc[];
  weeks: TrainingWeekSrc[];
  days: TrainingDaySrc[];
  rows: TrainingRowSrc[];
  results: TrainingResultSrc[];
  /** day ids with a finished workout */
  doneDayIds: ReadonlySet<string>;
  /** a workout moved on the calendar: its date there */
  movedDates?: ReadonlyMap<string, string>;
  today: string;
  /** a block the specialist picked; else the current one */
  blockId?: string | null;
}): TrainingView {
  const today = input.today;
  const currentId = currentBlockId(input.blocks, today);
  const pick =
    input.blockId && input.blocks.some((b) => b.id === input.blockId) ? input.blockId : currentId;
  const blocks = input.blocks
    .slice()
    .sort(
      (a, b) =>
        (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999") ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0),
    )
    .map((b) => ({
      id: b.id,
      name: b.name?.trim() || "Block",
      start: b.start_date,
      end: b.end_date,
      current: b.id === currentId,
    }));

  const resultsByRow = new Map<string, TrainingResultSrc[]>();
  for (const r of input.results) {
    const list = resultsByRow.get(r.row_id) ?? [];
    list.push(r);
    resultsByRow.set(r.row_id, list);
  }
  const rowsByDay = new Map<string, TrainingRowSrc[]>();
  for (const r of input.rows) {
    const list = rowsByDay.get(r.day_id) ?? [];
    list.push(r);
    rowsByDay.set(r.day_id, list);
  }
  const dateOf = (d: TrainingDaySrc) => input.movedDates?.get(d.id) ?? d.scheduled_date ?? null;
  const titleOf = (d: TrainingDaySrc) =>
    d.subtitle?.trim() || d.title?.trim() || `Day ${(d.day_index ?? 0) + 1}`;

  const dayView = (d: TrainingDaySrc): TrainingDay => {
    const rows = (rowsByDay.get(d.id) ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const main: TrainingRow[] = [];
    const accessories: TrainingRow[] = [];
    for (const r of rows) {
      const { kind, lift } = rowKind(r);
      const row: TrainingRow = {
        id: r.id,
        name: (r.exercise_name_override || r.exercises?.name || "Exercise").trim(),
        kind,
        lift,
        prescription: prescriptionLine({ ...r, notes: null, rest_seconds: null, tempo: null }),
        logged: loggedLines(resultsByRow.get(r.id) ?? []),
      };
      (MAIN_KINDS.has(kind) ? main : accessories).push(row);
    }
    const date = dateOf(d);
    return {
      id: d.id,
      date,
      title: titleOf(d),
      status: statusOf(date, input.doneDayIds.has(d.id), d.is_optional === true, today),
      optional: d.is_optional === true,
      main,
      accessories,
    };
  };

  const weeks = input.weeks
    .filter((w) => w.block_id === pick)
    .sort((a, b) => a.week_index - b.week_index)
    .map((w, i) => {
      const days = input.days
        .filter((d) => d.week_id === w.id)
        .sort((a, b) => (a.day_index ?? 0) - (b.day_index ?? 0))
        .map(dayView);
      const current = !!(
        w.start_date &&
        w.start_date <= today &&
        (!w.end_date || w.end_date >= today)
      );
      return {
        id: w.id,
        number: i + 1,
        start: w.start_date,
        end: w.end_date,
        phase: w.phase?.trim() || null,
        current,
        days,
      };
    });

  const block = blocks.find((b) => b.id === pick) ?? null;

  // Across every block: what's next and what was just done.
  const all = input.days.map((d) => ({ d, date: dateOf(d), done: input.doneDayIds.has(d.id) }));
  const upcoming = all
    .filter((x) => !x.done && x.date && x.date >= today)
    .sort((a, b) => a.date!.localeCompare(b.date!))
    .slice(0, 5)
    .map((x) => ({ dayId: x.d.id, date: x.date!, title: titleOf(x.d) }));
  const recent = all
    .filter((x) => x.done && x.date)
    .sort((a, b) => b.date!.localeCompare(a.date!))
    .slice(0, 5)
    .map((x) => ({ dayId: x.d.id, date: x.date!, title: titleOf(x.d) }));

  return {
    blocks,
    block: block ? { id: block.id, name: block.name, start: block.start, end: block.end } : null,
    weeks,
    upcoming,
    recent,
  };
}
