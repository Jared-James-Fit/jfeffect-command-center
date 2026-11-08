/**
 * The training report's data: every block a client trained or was given,
 * read whole, then cut down to the blocks the person picked.
 *
 * Read in pages and chunks (never one `.in()` over every exercise row: a
 * client with a few programs has 1,000+ rows, and a URL that long is refused
 * by the server, which is why "Download Training Report" failed; and never
 * one capped request: Supabase stops at 1,000 rows without saying so).
 * Logged sets, workout completions and exercise notes are read by the
 * client's id, so their count never depends on how many rows the program has.
 *
 * Pure apart from `loadTrainingReportSource`, which takes the Supabase client
 * it reads with (the person's own login: RLS decides what they may see).
 */
import { chunk, fetchAllPages } from "@/lib/supabase-paginate";
import { isAtHomeBackupDefinitionsBlock, isAtHomeBackupReservedBlock } from "@/lib/at-home-backup";
import { formatDaySubtitle } from "@/lib/workout-day-label";
import type { FullTrainingReportBlock, FullTrainingReportData, LoggedSet } from "@/lib/workouts/workout-pdf";

/* ───────────────────────────── Records ───────────────────────────── */

export type SrcBlock = {
  id: string;
  name: string | null;
  status: string | null;
  archived?: boolean | null;
  client_visible?: boolean | null;
  start_date: string | null;
  end_date: string | null;
  created_at?: string | null;
  source_template_block_key?: string | null;
};
export type SrcWeek = { id: string; block_id: string; week_index: number; notes?: string | null; archived?: boolean | null; deleted_at?: string | null };
export type SrcDay = {
  id: string;
  week_id: string;
  day_index: number;
  title?: string | null;
  subtitle?: string | null;
  notes?: string | null;
  notes_client_visible?: boolean | null;
  scheduled_date?: string | null;
  archived?: boolean | null;
  deleted_at?: string | null;
};
export type SrcRow = { id: string; day_id: string; sort_order?: number | null; exercises?: { name?: string | null } | null; [k: string]: unknown };
export type SrcCompletion = {
  id?: string;
  day_id: string;
  scheduled_workout_id?: string | null;
  started_at?: string | null;
  in_progress_at?: string | null;
  completed_at?: string | null;
  client_notes?: string | null;
};
export type SrcResult = LoggedSet & { id?: string; row_id: string; scheduled_workout_id?: string | null };
export type SrcNote = {
  id?: string;
  day_id: string;
  row_id?: string | null;
  exercise_name?: string | null;
  content: string;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ReportSource = {
  blocks: SrcBlock[];
  weeks: SrcWeek[];
  days: SrcDay[];
  rows: SrcRow[];
  completions: SrcCompletion[];
  results: SrcResult[];
  notes: SrcNote[];
  /** Sources that couldn't be read (the report is made without them, and says so). */
  missing: string[];
};

/** Who the report is for: a coach sees their private day notes, a client never does. */
export type ReportAudience = "coach" | "client";

/* ───────────────────────────── Reading ───────────────────────────── */

/** Its query key (in memory only: query-persister never writes "training-report-" keys to the phone). */
export const trainingReportSourceKey = (clientId: string) => ["training-report-source", clientId] as const;

const BLOCK_COLS = "id, name, status, archived, client_visible, start_date, end_date, created_at, source_template_block_key";
const WEEK_COLS = "id, block_id, week_index, notes, archived, deleted_at";
const DAY_COLS = "id, week_id, day_index, title, subtitle, notes, notes_client_visible, scheduled_date, archived, deleted_at";
const ROW_COLS =
  "id, day_id, sort_order, exercise_name_override, sets, reps_text, rpe, rir, percentage, percentage_basis, load_kg, load_lb, rest_seconds, tempo, notes, measurement_type, duration_seconds, purpose_label, movement_family, exercises(name)";
const COMPLETION_COLS = "id, day_id, scheduled_workout_id, started_at, in_progress_at, completed_at, client_notes";
const RESULT_COLS =
  "id, row_id, scheduled_workout_id, set_index, actual_reps, actual_load, actual_load_lb, actual_load_kg, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, actual_rpe, actual_rpe_num, actual_rir, completed_duration_seconds, actual_calories, notes";
const NOTE_COLS = "id, day_id, row_id, exercise_name, content, status, created_at, updated_at";

type Db = any;
type Page<T> = PromiseLike<{ data: T[] | null; error: any }>;

/** An `.in(column, ids)` read over any number of ids: chunks side by side, each paged to its end. */
async function readByIds<T>(ids: string[], build: (chunk: string[], from: number, to: number) => Page<T>): Promise<T[]> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return [];
  const parts = await Promise.all(chunk(uniq).map((c) => fetchAllPages<T>((from, to) => build(c, from, to))));
  return parts.flat();
}

export async function loadTrainingReportSource(sb: Db, clientId: string): Promise<ReportSource> {
  const missing: string[] = [];
  const byClient = <T>(table: string, cols: string) =>
    fetchAllPages<T>((from, to) => sb.from(table).select(cols).eq("client_id", clientId).order("id").range(from, to));

  // What the athlete did doesn't depend on the program's shape: start it now.
  const completionsP = byClient<SrcCompletion>("pl_day_completions", COMPLETION_COLS);
  const resultsP = byClient<SrcResult>("pl_row_results", RESULT_COLS);
  const notesP = byClient<SrcNote>("pl_exercise_notes", NOTE_COLS).catch(() => {
    missing.push("exercise notes");
    return [] as SrcNote[];
  });
  // Don't leave a rejection unhandled while the program loads.
  completionsP.catch(() => {});
  resultsP.catch(() => {});

  const blocks = await byClient<SrcBlock>("pl_blocks", BLOCK_COLS);
  const weeks = await readByIds<SrcWeek>(blocks.map((b) => b.id), (ids, f, t) =>
    sb.from("pl_weeks").select(WEEK_COLS).in("block_id", ids).order("id").range(f, t),
  );
  const days = await readByIds<SrcDay>(weeks.map((w) => w.id), (ids, f, t) =>
    sb.from("pl_days").select(DAY_COLS).in("week_id", ids).order("id").range(f, t),
  );
  const rows = await readByIds<SrcRow>(days.map((d) => d.id), (ids, f, t) =>
    sb.from("pl_exercise_rows").select(ROW_COLS).in("day_id", ids).order("id").range(f, t),
  );
  const [completions, results, notes] = await Promise.all([completionsP, resultsP, notesP]);
  return { blocks, weeks, days, rows, completions, results, notes, missing };
}

/* ───────────────────────────── Reading a set ───────────────────────────── */

const filled = (v: unknown) => v != null && v !== "";
const positive = (v: unknown) => v != null && Number.isFinite(Number(v)) && Number(v) > 0;

/** A set with something actually logged on it (reps, a time, a load, effort, calories or a note). */
export function loggedSetHasInput(s: LoggedSet): boolean {
  return (
    positive(s.actual_reps) ||
    positive(s.completed_duration_seconds) ||
    positive(s.actual_calories) ||
    [s.entered_value, s.actual_load, s.actual_load_lb, s.actual_load_kg, s.normalized_lb, s.normalized_kg].some((v) => v != null) ||
    filled(s.actual_rpe_num) ||
    filled(s.actual_rpe) ||
    filled(s.actual_rir) ||
    !!s.notes?.trim()
  );
}

export function isArchivedBlock(b: Pick<SrcBlock, "archived" | "status">): boolean {
  return !!b.archived || b.status === "Archived";
}

/* ───────────────────────────── Shaping ───────────────────────────── */

function groupBy<T>(list: T[], key: (t: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    if (!k) continue;
    const l = out.get(k);
    if (l) l.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * The session a workout day stands for. A day can carry two completion rows
 * (the old per-day one and its calendar instance's); the finished one wins,
 * and among those the instance's (that's where its sets were logged).
 */
export function pickCompletion(list: SrcCompletion[] | undefined): SrcCompletion | null {
  if (!list?.length) return null;
  const rank = (c: SrcCompletion) => (c.completed_at ? 2 : 0) + (c.scheduled_workout_id ? 1 : 0);
  const best = list.slice().sort((a, b) => rank(b) - rank(a) || String(b.completed_at ?? b.started_at ?? "").localeCompare(String(a.completed_at ?? a.started_at ?? "")))[0];
  const note = best.client_notes?.trim() ? best.client_notes : list.find((c) => c.client_notes?.trim())?.client_notes ?? null;
  return { ...best, client_notes: note };
}

/** A row's sets for that session: the instance's when it has any, else every set on the row; in set order. */
export function setsForSession(sets: SrcResult[] | undefined, instanceId: string | null | undefined): SrcResult[] {
  const all = sets ?? [];
  const mine = instanceId ? all.filter((s) => s.scheduled_workout_id === instanceId) : [];
  return (mine.length ? mine : all).slice().sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0));
}

type Indexed = {
  weeksByBlock: Map<string, SrcWeek[]>;
  daysByWeek: Map<string, SrcDay[]>;
  rowsByDay: Map<string, SrcRow[]>;
  completionsByDay: Map<string, SrcCompletion[]>;
  resultsByRow: Map<string, SrcResult[]>;
  notesByDay: Map<string, SrcNote[]>;
};

function index(src: ReportSource): Indexed {
  return {
    weeksByBlock: groupBy(src.weeks, (w) => w.block_id),
    daysByWeek: groupBy(src.days, (d) => d.week_id),
    rowsByDay: groupBy(src.rows, (r) => r.day_id),
    completionsByDay: groupBy(src.completions, (c) => c.day_id),
    resultsByRow: groupBy(src.results, (r) => r.row_id),
    notesByDay: groupBy(src.notes, (n) => n.day_id),
  };
}

type DayFacts = { day: SrcDay; completion: SrcCompletion | null; done: boolean; sets: number; trained: boolean };

function dayFacts(day: SrcDay, ix: Indexed): DayFacts {
  const completion = pickCompletion(ix.completionsByDay.get(day.id));
  let sets = 0;
  for (const r of ix.rowsByDay.get(day.id) ?? []) {
    sets += setsForSession(ix.resultsByRow.get(r.id), completion?.scheduled_workout_id).filter(loggedSetHasInput).length;
  }
  const done = !!completion?.completed_at;
  return { day, completion, done, sets, trained: done || sets > 0 };
}

/**
 * A block's days in the report. A live block shows its whole program; an
 * archived block, an at-home backup or one hidden from the client shows only
 * the days that were trained, and so does a removed day or week.
 */
function blockDays(block: SrcBlock, ix: Indexed): Array<{ week: SrcWeek; days: DayFacts[] }> {
  const historyOnly = isArchivedBlock(block) || isAtHomeBackupReservedBlock(block) || block.client_visible === false;
  return (ix.weeksByBlock.get(block.id) ?? [])
    .slice()
    .sort((a, b) => (a.week_index ?? 0) - (b.week_index ?? 0))
    .map((week) => {
      const weekGone = !!week.archived || !!week.deleted_at;
      const days = (ix.daysByWeek.get(week.id) ?? [])
        .slice()
        .sort((a, b) => (a.day_index ?? 0) - (b.day_index ?? 0))
        .map((d) => dayFacts(d, ix))
        .filter((f) => f.trained || !(historyOnly || weekGone || f.day.archived || f.day.deleted_at));
      return { week, days };
    })
    .filter((w) => w.days.length > 0);
}

/* ───────────────────────────── The picker ───────────────────────────── */

export type ReportBlockOption = {
  id: string;
  name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  workouts: number;
  done: number;
  sets: number;
  archived: boolean;
  /** Running today. */
  current: boolean;
  /** Not started and nothing trained yet (left out of the default pick). */
  upcoming: boolean;
};

function byDateAsc(a: SrcBlock, b: SrcBlock): number {
  const as = a.start_date ?? "9999-12-31";
  const bs = b.start_date ?? "9999-12-31";
  return as.localeCompare(bs) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

/** The blocks a report can cover: everything given to the client, plus any other block they trained. */
export function reportBlockOptions(src: ReportSource, today: string): ReportBlockOption[] {
  const ix = index(src);
  const out: Array<ReportBlockOption & { _b: SrcBlock }> = [];
  for (const b of src.blocks) {
    if (isAtHomeBackupDefinitionsBlock(b)) continue;
    const weeks = blockDays(b, ix);
    const days = weeks.flatMap((w) => w.days);
    const done = days.filter((d) => d.done).length;
    const sets = days.reduce((n, d) => n + d.sets, 0);
    const trained = days.some((d) => d.trained);
    const offered = !isArchivedBlock(b) && b.client_visible !== false && !isAtHomeBackupReservedBlock(b);
    if (!trained && !offered) continue;
    if (!days.length) continue;
    const started = trained || (!!b.start_date && b.start_date <= today);
    out.push({
      _b: b,
      id: b.id,
      name: (b.name ?? "").trim() || "Training block",
      status: isArchivedBlock(b) ? "Archived" : b.status ?? null,
      start_date: b.start_date,
      end_date: b.end_date,
      workouts: days.length,
      done,
      sets,
      archived: isArchivedBlock(b),
      current: !isArchivedBlock(b) && !!b.start_date && b.start_date <= today && (!b.end_date || b.end_date >= today),
      upcoming: !started,
    });
  }
  // What's running and what's done first (newest first), then what hasn't started (soonest first).
  return out
    .sort((a, b) => Number(a.upcoming) - Number(b.upcoming) || (a.upcoming ? byDateAsc(a._b, b._b) : byDateAsc(b._b, a._b)))
    .map(({ _b, ...o }) => o);
}

/** What's ticked when the picker opens: every block that has started or been trained (all of them for a client who hasn't started). */
export function defaultReportSelection(options: ReportBlockOption[]): string[] {
  const started = options.filter((o) => !o.upcoming).map((o) => o.id);
  return started.length ? started : options.map((o) => o.id);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/** "Sep 27 – Oct 31" this year, "Jun 15 – Jul 5, 2025" another year, "Starts Dec 6", or null with no dates. */
export function blockRangeLabel(start: string | null, end: string | null, today: string): string | null {
  const year = today.slice(0, 4);
  if (start && end) {
    const sameYear = start.slice(0, 4) === year && end.slice(0, 4) === year;
    return `${shortDate(start, false)} – ${shortDate(end, !sameYear)}`;
  }
  if (start) return `${start > today ? "Starts" : "Started"} ${shortDate(start, start.slice(0, 4) !== year)}`;
  return null;
}

/* ───────────────────────────── The report ───────────────────────────── */

/** The report for the picked blocks, oldest first. */
export function buildTrainingReport(
  src: ReportSource,
  blockIds: string[],
  opts: { clientName?: string | null; audience: ReportAudience; generatedAt?: Date },
): FullTrainingReportData {
  const ix = index(src);
  const wanted = new Set(blockIds);
  const blocks: FullTrainingReportBlock[] = src.blocks
    .filter((b) => wanted.has(b.id) && !isAtHomeBackupDefinitionsBlock(b))
    .sort(byDateAsc)
    .map((b) => ({
      block_name: (b.name ?? "").trim() || "Training block",
      block_status: isArchivedBlock(b) ? "Archived" : b.status ?? null,
      block_start: b.start_date,
      block_end: b.end_date,
      weeks: blockDays(b, ix).map(({ week, days }) => ({
        id: week.id,
        week_index: week.week_index,
        notes: week.notes ?? null,
        days: days.map(({ day, completion }) => {
          const showNote = opts.audience === "coach" || day.notes_client_visible === true;
          const instance = completion?.scheduled_workout_id ?? null;
          return {
            id: day.id,
            day_index: day.day_index,
            title: formatDaySubtitle(day),
            notes: showNote ? day.notes ?? null : null,
            notes_client_visible: day.notes_client_visible ?? null,
            scheduled_date: day.scheduled_date ?? null,
            started_at: completion?.started_at ?? null,
            in_progress_at: completion?.in_progress_at ?? null,
            completed_at: completion?.completed_at ?? null,
            completion_note: completion?.client_notes ?? null,
            rows: (ix.rowsByDay.get(day.id) ?? []).map((r) => ({
              ...(r as any),
              logged_sets: setsForSession(ix.resultsByRow.get(r.id), instance),
            })),
            client_exercise_notes: (ix.notesByDay.get(day.id) ?? [])
              .slice()
              .sort((a, b) => String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? ""))),
          };
        }),
      })),
    }));
  return {
    client_name: opts.clientName ?? null,
    generated_at: opts.generatedAt ?? new Date(),
    audience: opts.audience,
    blocks,
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** "jared-mcintyre-training-report.pdf", or with the block's name when it's one block. */
export function trainingReportFileName(clientName: string | null | undefined, blockNames: string[]): string {
  const parts = [clientName ?? "", blockNames.length === 1 ? blockNames[0] : "", "training-report"];
  return `${slug(parts.filter(Boolean).join(" ")) || "training-report"}.pdf`;
}
