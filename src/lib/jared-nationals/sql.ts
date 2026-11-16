/**
 * Jared McIntyre's 2027 Nationals prep migration, as text: written by
 * scripts/jared-nationals/write-migration.ts from program.ts and catalog.ts;
 * src/test/jared-nationals-prep.test.ts checks the committed file still matches.
 */
import { EX, NEW_EXERCISE, type ExKey } from "./catalog";
import {
  BLOCKS,
  CLIENT_ID,
  DAY_INDEX,
  DOW_OFFSET,
  FROM_DATE,
  HISTORY_BLOCK_ID,
  MEET,
  PREP_CHANGES,
  PREP_ID,
  RUN_MARKER,
  TEMPLATE_ID,
  WEEK1_START,
  WEEKS,
  type RowDef,
} from "./program";

export const PREP_MIGRATION = "supabase/migrations/20270328090000_jared_nationals_prep.sql";

const lit = (s: string | null | undefined) => (s == null ? "NULL" : `'${s.replace(/'/g, "''")}'`);
const num = (n: number | null | undefined) => (n == null ? "NULL" : String(n));
const bool = (b: boolean | undefined) => (b ? "true" : "false");

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const weekStart = (n: number) => addDays(WEEK1_START, (n - 1) * 7);
export const dayDate = (n: number, dow: keyof typeof DOW_OFFSET) =>
  addDays(weekStart(n), DOW_OFFSET[dow]);

const MAIN: ExKey[] = ["compSquat", "compBench", "compDeadlift"];
const SECONDARY: ExKey[] = [
  "highBar",
  "pauseSquat",
  "closeGripBlock",
  "pauseBench2ct",
  "pausedDeadlift",
];
const COMPOUND_ACC: ExKey[] = [
  "beltSquat",
  "latPulldown",
  "verticalPull",
  "latRow",
  "horizontalRow",
  "legCurl",
];
export function timeProfile(ex: ExKey): string {
  if (ex === "walk") return "conditioning";
  if (MAIN.includes(ex)) return "main_lift";
  if (SECONDARY.includes(ex)) return "secondary_lift";
  if (COMPOUND_ACC.includes(ex)) return "accessory_compound";
  return "accessory_isolation";
}

/** Every row of the 12 weeks, flattened, with the sort order of the single a top-set back-off reads. */
export function planRows() {
  const out: Array<RowDef & { date: string; sort: number; topSort: number | null; week: number }> =
    [];
  for (const w of WEEKS) {
    for (const d of w.days) {
      const date = dayDate(w.n, d.dow);
      d.rows.forEach((r, i) => {
        let topSort: number | null = null;
        if (r.basis === "top_set") {
          for (let j = i - 1; j >= 0; j--)
            if (d.rows[j].ex === r.ex) {
              topSort = j;
              break;
            }
          if (topSort == null)
            throw new Error(`top_set row with no single before it: week ${w.n} ${d.dow}`);
        }
        out.push({ ...r, date, sort: i, topSort, week: w.n });
      });
    }
  }
  return out;
}

const blockOfWeek = (n: number) => {
  const b = BLOCKS.find((x) => x.weeks.includes(n));
  if (!b) throw new Error(`week ${n} has no block`);
  return b;
};

function blockValues(): string {
  return BLOCKS.map((b, i) => {
    const start = weekStart(b.weeks[0]);
    const end = addDays(weekStart(b.weeks[b.weeks.length - 1]), 6);
    return `  (${lit(b.blockId)}::uuid, ${lit(b.templateBlockId)}, ${lit(b.key)}, ${i + 2}, ${lit(b.name)}, ${lit(b.focus)}, ${lit(b.goal)}, ${lit(b.label)}, ${lit(b.summary)}, ${lit(b.coachNotes)}, ${lit(b.status)}, ${lit(start)}::date, ${lit(end)}::date, ${b.weeks.length})`;
  }).join(",\n");
}

function weekValues(): string {
  return WEEKS.map((w) => {
    const b = blockOfWeek(w.n);
    return `  (${w.n}, ${lit(weekStart(w.n))}::date, ${lit(addDays(weekStart(w.n), 6))}::date, ${lit(b.blockId)}::uuid, ${b.weeks.indexOf(w.n) + 1}, ${lit(w.phase)}, ${lit(w.notes)}, ${lit(w.label)}, ${lit(w.summary)})`;
  }).join(",\n");
}

/** Week 11–12 sessions are counted back from the meet: locked so an automatic re-plan never slides them. */
export const LOCKED_FROM_WEEK = 11;

function dayValues(): string {
  const ids = noteIds();
  const rows: string[] = [];
  for (const w of WEEKS) {
    for (const d of w.days) {
      rows.push(
        `  (${w.n}, ${DAY_INDEX[d.dow]}, ${lit(d.title)}, ${lit(d.focus)}, ${ids.get(d.notes)}, ${bool(d.optional)})`,
      );
    }
  }
  return rows.join(",\n");
}

/** Each distinct note once (most repeat across weeks): rows point at them by number. */
function noteIds(): Map<string, number> {
  const ids = new Map<string, number>();
  for (const r of planRows()) if (!ids.has(r.note)) ids.set(r.note, ids.size + 1);
  for (const w of WEEKS)
    for (const d of w.days) if (!ids.has(d.notes)) ids.set(d.notes, ids.size + 1);
  return ids;
}

function exValues(): string {
  return (Object.keys(EX) as ExKey[])
    .map((k) => `  (${lit(k)}, ${lit(EX[k].id)}::uuid, ${lit(timeProfile(k))})`)
    .join(",\n");
}

function noteValues(): string {
  return [...noteIds()].map(([text, id]) => `  (${id}, ${lit(text)})`).join(",\n");
}

function rowValues(): string {
  const ids = noteIds();
  const dayNo = (date: string) => {
    for (const w of WEEKS)
      for (const d of w.days) if (dayDate(w.n, d.dow) === date) return [w.n, DAY_INDEX[d.dow]];
    throw new Error(date);
  };
  return planRows()
    .map((r) => {
      const [w, d] = dayNo(r.date);
      const timed = r.minutes != null;
      return `  (${w},${d},${r.sort},${lit(r.ex)},${r.sets},${lit(timed ? null : (r.reps ?? null))},${lit(r.rpe ?? null)},${num(r.pct ?? null)},${lit(r.basis ?? null)},${num(r.topSort)},${num(r.rest ?? null)},${lit(r.role)},${ids.get(r.note)},${num(r.minutes ?? null)})`;
    })
    .join(",\n");
}

/** the rows, one statement a week (each can be sent on its own and sent again) */
function rowStatements(): string {
  const byWeek = rowValues().split(",\n");
  const rows = planRows();
  const out: string[] = [];
  for (const w of WEEKS) {
    const lines = byWeek.filter((_, i) => rows[i].week === w.n);
    out.push(
      `DELETE FROM jn_stage.row WHERE n = ${w.n};\nINSERT INTO jn_stage.row VALUES\n${lines.join(",\n")};`,
    );
  }
  return out.join("\n\n");
}

const dayCount = () => WEEKS.reduce((a, w) => a + w.days.length, 0);

const PREP_TITLE = "Jared McIntyre — 2027 Canadian Nationals Prep";
const PREP_NOTES = [
  `${MEET.name}, ${MEET.location}. Window Feb 8–13 2027, lifting day TBD: Feb 8 is the conservative anchor; when the day is confirmed run public.pl_prep_set_meet_day(prep, day) (preview first, then with _apply => true) to move the Week 11–12 sessions with it. Weeks 1–10 stay.`,
  "Nationals weight class: needs confirmation (66 kg or 74 kg). Bodyweight was 66.3 kg on Sep 20 and 76.3 kg on Nov 14 (trend up ~0.7 kg a week since late Oct). 74 kg: stop the gain now, ~2.5 kg to lose by weigh-in, no extra workload needed. 66 kg: ~10 kg, a separate targeted plan.",
  "Training Maxes: squat 235 kg and bench 150 kg (Sep 20 2026 meet, block-scoped, held for the block); conventional deadlift set after the Week 1 calibration single (Sat Nov 21). Reviewed after Weeks 4 and 8 from trends, never from one session.",
  "Tuesday's paused conventional pull is optional and stays only while Saturday's deadlift keeps progressing.",
  `Changes from the written program (Nov 16 2026):\n${PREP_CHANGES.map((c) => `- ${c}`).join("\n")}`,
].join("\n\n");

const TEMPLATE_NOTES = [
  "Weekly order: MON Primary Squat + Bench/Triceps Overload; TUE Low-Fatigue Development + optional paused conventional pull; WED rest; THU Secondary Squat + Primary Competition Bench; FRI rest; SAT Primary Competition Deadlift + Secondary Bench; SUN rest.",
  "Blocks 1–2 are the off-season weeks trained Sep 27 – Nov 14 2026. Blocks 3–6 are the 12-week 2027 Nationals prep: Base (W1–4, W4 fatigue reduction), Strength (W5–8, W8 fatigue reduction), Peak (W9–11), Taper (W12).",
  "Loading: top singles by RPE; back-offs and competition-related secondaries as a % of the Training Max with the RPE as the cap (the cap beats the %); accessories by RPE with double progression, 1 hard set (2 for lats, side and rear delts).",
  `Changes from the written program, and why:\n${PREP_CHANGES.map((c) => `- ${c}`).join("\n")}`,
].join("\n\n");

/** The roadmap card and the meet-day tool: a meet that's a window, and a lifting day still to confirm. */
function meetDaySql(): string {
  return `-- A meet can be a window with the lifting day still to confirm (Nationals: Feb 8–13).
ALTER TABLE public.pl_preps ADD COLUMN IF NOT EXISTS event_end_date date;
ALTER TABLE public.pl_preps ADD COLUMN IF NOT EXISTS event_day_tbd boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.pl_preps.event_end_date IS 'Last day of the meet window when the event runs several days (event_date is its first day, or the lifting day once confirmed).';
COMMENT ON COLUMN public.pl_preps.event_day_tbd IS 'The athlete''s lifting day inside the window isn''t confirmed yet: event_date is the conservative (earliest) anchor the taper is counted from.';

-- Confirm the lifting day: the prep's meet-relative sessions (locked days dated in
-- the 15 days before the old anchor that nothing has touched) move by the same
-- number of days, so every one keeps its distance from the meet (final heavy
-- squat ~14 days out ... primer 2 days out). Nothing earlier moves. Preview by
-- default; _apply => true moves them and records the day. Admins, the client's
-- coach, or the server.
CREATE OR REPLACE FUNCTION public.pl_prep_set_meet_day(_prep uuid, _day date, _apply boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  p public.pl_preps;
  v_tz text;
  v_today date;
  v_delta int;
  v_moves jsonb;
  n int := 0;
BEGIN
  SELECT * INTO p FROM public.pl_preps WHERE id = _prep;
  IF p.id IS NULL THEN RAISE EXCEPTION 'prep not found'; END IF;
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT (public.has_role((SELECT auth.uid()), 'admin') OR p.client_id IN (SELECT public.coached_client_ids())) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p.event_date IS NULL THEN RAISE EXCEPTION 'this prep has no meet date'; END IF;
  IF _day < p.event_date OR (p.event_end_date IS NOT NULL AND _day > p.event_end_date) THEN
    RAISE EXCEPTION 'that day is outside the meet window (% to %)', p.event_date, coalesce(p.event_end_date, p.event_date);
  END IF;
  SELECT coalesce(nullif(c.timezone, ''), 'America/Winnipeg') INTO v_tz FROM public.clients c WHERE c.id = p.client_id;
  v_today := public.pt_local_today(v_tz);
  v_delta := _day - p.event_date;

  CREATE TEMP TABLE IF NOT EXISTS pl_meet_moves (day_id uuid, title text, old_date date, new_date date) ON COMMIT DROP;
  DELETE FROM pl_meet_moves;
  INSERT INTO pl_meet_moves
  SELECT d.id, d.title, d.scheduled_date, d.scheduled_date + v_delta
    FROM public.pl_days d
    JOIN public.pl_weeks w ON w.id = d.week_id AND w.deleted_at IS NULL
    JOIN public.pl_blocks b ON b.id = w.block_id AND b.prep_id = _prep AND NOT coalesce(b.archived, false)
   WHERE d.schedule_locked AND NOT d.archived AND d.deleted_at IS NULL
     AND d.scheduled_date >= p.event_date - 15 AND d.scheduled_date < p.event_date
     AND NOT public.pl_day_touched(d.id, d.scheduled_date, v_today);
  SELECT coalesce(jsonb_agg(jsonb_build_object('day_id', day_id, 'title', title, 'from', old_date, 'to', new_date) ORDER BY old_date), '[]'::jsonb)
    INTO v_moves FROM pl_meet_moves;

  IF _apply THEN
    IF v_delta <> 0 THEN
      -- a title that starts with its weekday ("Monday — Final Heavy Squat") follows the new date
      UPDATE public.pl_days d
         SET scheduled_date = m.new_date,
             title = regexp_replace(d.title, '^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\M', trim(to_char(m.new_date, 'FMDay')))
        FROM pl_meet_moves m WHERE d.id = m.day_id;
      GET DIAGNOSTICS n = ROW_COUNT;
      UPDATE public.pl_scheduled_workouts s SET scheduled_date = s.scheduled_date + v_delta
        FROM pl_meet_moves m WHERE s.source_day_id = m.day_id;
    END IF;
    UPDATE public.pl_preps SET event_date = _day, event_day_tbd = false WHERE id = _prep;
  END IF;
  RETURN jsonb_build_object('lifting_day', _day, 'delta_days', v_delta, 'applied', _apply, 'moved', n, 'sessions', v_moves);
END
$fn$;
REVOKE ALL ON FUNCTION public.pl_prep_set_meet_day(uuid, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_prep_set_meet_day(uuid, date, boolean) TO authenticated;`;
}

function exerciseSql(): string {
  const e = NEW_EXERCISE;
  return `-- The one new library exercise (there was no cable hip adduction): only while none of that name exists.
INSERT INTO public.exercises (id, name, category, equipment, muscle_group, primary_muscle_group, muscle_groups, exercise_family,
                              exercise_category, movement_family, default_measurement_type, cues, primary_movement_pattern)
SELECT ${lit(e.id)}::uuid, ${lit(e.name)}, ${lit(e.category)}, ${lit(e.equipment)}, ${lit(e.muscle_group)}, ${lit(e.primary_muscle_group)},
       ARRAY['adductors']::text[], ${lit(e.exercise_family)}, 'assistance', 'accessory', 'reps', ${lit(e.cues)}, 'other'
 WHERE NOT EXISTS (SELECT 1 FROM public.exercises x WHERE lower(x.name) = lower(${lit(e.name)}) AND NOT coalesce(x.archived, false))
ON CONFLICT (id) DO NOTHING;`;
}

export function prepSql(): string {
  return `-- Jared McIntyre: 2027 Canada Powerlifting National Championships prep (Nanaimo BC,
-- Feb 8–13 2027, lifting day TBD). GENERATED by scripts/jared-nationals/write-migration.ts
-- from src/lib/jared-nationals (program.ts, catalog.ts); never hand-edited:
-- src/test/jared-nationals-prep.test.ts fails when they disagree.
--
-- Updates Jared's existing program in place (prep ${PREP_ID}, no new program):
--   * Block 2 (Volume 4s/6s) keeps its two trained weeks (Nov 1–14) and ends there.
--   * Its three untrained weeks and Blocks 3–4 (Nov 15 – Feb 6, 12 weeks, 48 workouts
--     on Mon / Tue / Thu / Sat) become the prep: Block 3 Nationals Base (W1–4),
--     Block 4 Nationals Strength (W5–8), Block 5 Nationals Peak (W9–11), Block 6
--     Nationals Taper (W12). Same block, week and day records (dates, the calendar and
--     Monday's opened workout keep their ids); each workout's rows are rewritten.
--   * The off-season weeks after the meet (Feb 7 – Apr 10, never trained) are removed.
--   * Squat / bench Training Maxes stay 235 / 150 kg (block-scoped, Sep 20 meet); the
--     conventional deadlift TM is set after Week 1's calibration single, never invented.
--   * Cardio: the program's own Zone 2 sessions are the training-day cardio plan; the
--     nutrition plan's 15-min walk after every workout ends Nov 15.
--   * The library template (${TEMPLATE_ID}) mirrors the program.
-- Only workouts nothing has touched (on/after ${FROM_DATE}, no logged set, not started or
-- finished; an opened workout with nothing logged is fine) change: the run stops with an
-- error otherwise. Completed workouts, logged sets, notes, PRs, bodyweight and analytics
-- are not touched. Everything changed is copied into program_loading_update_backup first.
-- Runs once (marker '${RUN_MARKER}').

${meetDaySql()}

${exerciseSql()}

CREATE TABLE IF NOT EXISTS public.program_loading_update_backup (
  id bigserial PRIMARY KEY,
  source_table text NOT NULL,
  row_id text,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.program_loading_update_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_loading_update_backup FROM anon, authenticated;

-- ── the plan, staged in a private schema (not exposed to the API) so it can be loaded in parts;
--    the DO block below checks it's complete, applies it and the last statement drops it ──
CREATE SCHEMA IF NOT EXISTS jn_stage;
REVOKE ALL ON SCHEMA jn_stage FROM PUBLIC;
CREATE TABLE IF NOT EXISTS jn_stage.block (block_id uuid PRIMARY KEY, tpl_block_id text, key text, order_index int, name text, focus text,
                                           goal text, label text, summary text, coach_notes text, status text, start_date date,
                                           end_date date, weeks int);
CREATE TABLE IF NOT EXISTS jn_stage.week (n int PRIMARY KEY, start_date date, end_date date, block_id uuid, week_index int, phase text,
                                          notes text, label text, summary text);
CREATE TABLE IF NOT EXISTS jn_stage.note (id int PRIMARY KEY, body text NOT NULL);
CREATE TABLE IF NOT EXISTS jn_stage.ex (key text PRIMARY KEY, id uuid NOT NULL, time_profile text);
-- (week, day 1–4 = Mon / Tue / Thu / Sat, title, focus, note, optional)
CREATE TABLE IF NOT EXISTS jn_stage.day (n int, d int, title text, focus text, note_id int, is_optional boolean, PRIMARY KEY (n, d));
-- (week, day, order, exercise, sets, reps, RPE, %, basis, the single a top-set back-off reads, rest s, role, note, minutes)
CREATE TABLE IF NOT EXISTS jn_stage.row (n int, d int, sort_order int, ex text, sets int, reps_text text, rpe text, percentage numeric,
                                         percentage_basis text, top_sort int, rest_seconds int, purpose_label text, note_id int,
                                         minutes int, PRIMARY KEY (n, d, sort_order));

TRUNCATE jn_stage.block;
INSERT INTO jn_stage.block VALUES
${blockValues()};

TRUNCATE jn_stage.week;
INSERT INTO jn_stage.week VALUES
${weekValues()};

TRUNCATE jn_stage.ex;
INSERT INTO jn_stage.ex VALUES
${exValues()};

TRUNCATE jn_stage.note;
INSERT INTO jn_stage.note VALUES
${noteValues()};

TRUNCATE jn_stage.day;
INSERT INTO jn_stage.day VALUES
${dayValues()};

${rowStatements()}

DO $jn$
DECLARE
  c_client uuid := ${lit(CLIENT_ID)};
  c_prep uuid := ${lit(PREP_ID)};
  c_tpl uuid := ${lit(TEMPLATE_ID)};
  c_hist uuid := ${lit(HISTORY_BLOCK_ID)};
  c_from date := ${lit(FROM_DATE)};
  c_new_ex uuid := ${lit(NEW_EXERCISE.id)};
  v_add uuid;
  v_cardio uuid;
  v_bad int;
  n_days int;
  n_rows int;
  n_after int;
  n_after_days int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pl_preps WHERE id = c_prep AND client_id = c_client) THEN
    RAISE NOTICE 'jared nationals: prep not here, skipped';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.program_loading_update_backup WHERE source_table = 'run' AND row_id = ${lit(RUN_MARKER)}) THEN
    RAISE NOTICE 'jared nationals: already applied';
    RETURN;
  END IF;

  -- ── the plan (staged above): complete, or nothing happens ──────────────
  IF (SELECT count(*) FROM jn_stage.block) <> ${BLOCKS.length} OR (SELECT count(*) FROM jn_stage.week) <> ${WEEKS.length}
     OR (SELECT count(*) FROM jn_stage.day) <> ${dayCount()} OR (SELECT count(*) FROM jn_stage.row) <> ${planRows().length}
     OR (SELECT count(*) FROM jn_stage.note) <> ${noteIds().size} OR (SELECT count(*) FROM jn_stage.ex) <> ${Object.keys(EX).length} THEN
    RAISE EXCEPTION 'jared nationals: the staged plan is incomplete; nothing changed';
  END IF;
  CREATE TEMP TABLE jn_block ON COMMIT DROP AS SELECT * FROM jn_stage.block;
  CREATE TEMP TABLE jn_week ON COMMIT DROP AS SELECT * FROM jn_stage.week;
  CREATE TEMP TABLE jn_day ON COMMIT DROP AS
  SELECT p.n, ${lit(WEEK1_START)}::date + (p.n - 1) * 7 + (ARRAY[1, 2, 4, 6])[p.d] AS on_date, p.d AS day_index, p.title, p.focus,
         n.body AS notes, p.is_optional, p.n >= ${LOCKED_FROM_WEEK} AS locked
    FROM jn_stage.day p JOIN jn_stage.note n ON n.id = p.note_id;
  CREATE TEMP TABLE jn_row ON COMMIT DROP AS
  SELECT ${lit(WEEK1_START)}::date + (r.n - 1) * 7 + (ARRAY[1, 2, 4, 6])[r.d] AS on_date, r.sort_order, x.id AS exercise_id, r.sets,
         r.reps_text, r.rpe, r.percentage, coalesce(r.percentage_basis, 'none') AS percentage_basis, r.top_sort, r.rest_seconds,
         r.purpose_label, n.body AS notes,
         CASE WHEN r.minutes IS NULL THEN 'reps' ELSE 'time' END AS measurement_type,
         CASE WHEN r.minutes IS NULL THEN 'reps_weight' ELSE 'time' END AS tracking_type,
         r.minutes * 60 AS duration_seconds, x.time_profile, r.ex = 'walk' AS is_cardio
    FROM jn_stage.row r JOIN jn_stage.ex x ON x.key = r.ex JOIN jn_stage.note n ON n.id = r.note_id;

  -- the new exercise is the library's own by name (just made, or one that already existed)
  SELECT x.id INTO v_add FROM public.exercises x
   WHERE lower(x.name) = lower(${lit(NEW_EXERCISE.name)}) AND NOT coalesce(x.archived, false)
   ORDER BY (x.id = c_new_ex) DESC, x.created_at LIMIT 1;
  IF v_add IS NULL THEN RAISE EXCEPTION 'jared nationals: % is missing from the library', ${lit(NEW_EXERCISE.name)}; END IF;
  UPDATE jn_row SET exercise_id = v_add WHERE exercise_id = c_new_ex;
  SELECT count(*) INTO v_bad FROM jn_row r LEFT JOIN public.exercises e ON e.id = r.exercise_id
   WHERE e.id IS NULL OR coalesce(e.archived, false);
  IF v_bad > 0 THEN RAISE EXCEPTION 'jared nationals: % rows name an exercise that is missing or archived', v_bad; END IF;

  -- ── the program's own weeks and days this becomes ────────────────────────
  CREATE TEMP TABLE jn_wmap ON COMMIT DROP AS
  SELECT p.n, w.id AS week_id, w.block_id AS old_block
    FROM jn_week p
    JOIN public.pl_weeks w ON w.start_date = p.start_date AND w.deleted_at IS NULL AND NOT coalesce(w.archived, false)
    JOIN public.pl_blocks b ON b.id = w.block_id AND b.prep_id = c_prep AND b.client_id = c_client AND NOT coalesce(b.archived, false);
  IF (SELECT count(*) FROM jn_wmap) <> ${WEEKS.length} OR (SELECT count(DISTINCT n) FROM jn_wmap) <> ${WEEKS.length} THEN
    RAISE EXCEPTION 'jared nationals: expected ${WEEKS.length} program weeks from %, found %', ${lit(WEEK1_START)}, (SELECT count(*) FROM jn_wmap);
  END IF;

  CREATE TEMP TABLE jn_dmap ON COMMIT DROP AS
  SELECT p.on_date, d.id AS day_id, m.week_id
    FROM jn_day p
    JOIN jn_wmap m ON m.n = p.n
    JOIN public.pl_days d ON d.week_id = m.week_id AND d.scheduled_date = p.on_date AND NOT d.archived AND d.deleted_at IS NULL;
  SELECT count(*) INTO n_days FROM jn_dmap;
  IF n_days <> (SELECT count(*) FROM jn_day) OR (SELECT count(DISTINCT on_date) FROM jn_dmap) <> n_days THEN
    RAISE EXCEPTION 'jared nationals: expected one workout on each of the % planned dates, found %', (SELECT count(*) FROM jn_day), n_days;
  END IF;
  SELECT count(*) INTO v_bad FROM public.pl_days d
   WHERE d.week_id IN (SELECT week_id FROM jn_wmap) AND NOT d.archived AND d.deleted_at IS NULL
     AND d.id NOT IN (SELECT day_id FROM jn_dmap);
  IF v_bad > 0 THEN RAISE EXCEPTION 'jared nationals: % workouts in these weeks are not on the plan''s dates', v_bad; END IF;

  -- nothing on these days was trained (an opened workout with nothing logged is fine)
  SELECT count(*) INTO v_bad FROM jn_dmap m
   WHERE m.on_date < c_from
      OR EXISTS (SELECT 1 FROM public.pl_day_completions c
                  WHERE c.day_id = m.day_id AND (c.completed_at IS NOT NULL OR c.started_at IS NOT NULL OR c.in_progress_at IS NOT NULL))
      OR EXISTS (SELECT 1 FROM public.pl_exercise_rows r JOIN public.pl_row_results x ON x.row_id = r.id WHERE r.day_id = m.day_id);
  IF v_bad > 0 THEN RAISE EXCEPTION 'jared nationals: % of these workouts were already trained; nothing changed', v_bad; END IF;

  -- the off-season weeks after the meet
  CREATE TEMP TABLE jn_after ON COMMIT DROP AS
  SELECT w.id AS week_id FROM public.pl_weeks w JOIN public.pl_blocks b ON b.id = w.block_id
   WHERE b.prep_id = c_prep AND b.client_id = c_client AND w.start_date > (SELECT max(start_date) FROM jn_week);
  SELECT count(*) INTO v_bad FROM public.pl_days d
   WHERE d.week_id IN (SELECT week_id FROM jn_after) AND public.pl_day_touched(d.id, d.scheduled_date, c_from);
  IF v_bad > 0 THEN RAISE EXCEPTION 'jared nationals: % workouts after the meet were trained; nothing changed', v_bad; END IF;

  -- ── back up everything this changes ──────────────────────────────────────
  INSERT INTO public.program_loading_update_backup (source_table, row_id, row_data)
  SELECT 'pl_preps', p.id::text, to_jsonb(p) FROM public.pl_preps p WHERE p.id = c_prep
  UNION ALL SELECT 'pl_blocks', b.id::text, to_jsonb(b) FROM public.pl_blocks b WHERE b.prep_id = c_prep
  UNION ALL SELECT 'pl_weeks', w.id::text, to_jsonb(w) FROM public.pl_weeks w
             WHERE w.id IN (SELECT week_id FROM jn_wmap UNION SELECT week_id FROM jn_after)
  UNION ALL SELECT 'pl_days', d.id::text, to_jsonb(d) FROM public.pl_days d
             WHERE d.week_id IN (SELECT week_id FROM jn_wmap UNION SELECT week_id FROM jn_after)
  UNION ALL SELECT 'pl_exercise_rows', r.id::text, to_jsonb(r) FROM public.pl_exercise_rows r JOIN public.pl_days d ON d.id = r.day_id
             WHERE d.week_id IN (SELECT week_id FROM jn_wmap UNION SELECT week_id FROM jn_after)
  UNION ALL SELECT 'pl_day_completions', c.id::text, to_jsonb(c) FROM public.pl_day_completions c
             WHERE c.day_id IN (SELECT day_id FROM jn_dmap)
  UNION ALL SELECT 'pl_client_maxes', m.id::text, to_jsonb(m) FROM public.pl_client_maxes m WHERE m.client_id = c_client
  UNION ALL SELECT 'pl_templates', t.id::text, to_jsonb(t) FROM public.pl_templates t WHERE t.id = c_tpl
  UNION ALL SELECT 'cardio_targets', t.id::text, to_jsonb(t) FROM public.cardio_targets t WHERE t.client_id = c_client
  UNION ALL SELECT 'pl_roadmap_notes', n.id::text, to_jsonb(n) FROM public.pl_roadmap_notes n
             JOIN public.pl_blocks b ON b.id = n.block_id WHERE b.prep_id = c_prep;

  -- ── cardio first (a block update runs the cardio sync): the program's Zone 2 sessions are the plan ──
  PERFORM set_config('jf.cardio_sync', 'on', true);
  UPDATE public.cardio_targets t
     SET end_date = c_from - 1,
         admin_notes = concat_ws(E'\\n', nullif(t.admin_notes, ''),
           'Ended Nov 15 2026 for the Nationals prep: cardio is the program''s own Zone 2 (Tuesday, plus an optional second short session). A 15-min walk after every workout was more than the prep calls for.')
   WHERE t.client_id = c_client AND t.status = 'Active' AND t.program_name IS NULL
     AND public.cardio_day_kind(t.day_type) = 'training' AND coalesce(t.source, '') <> 'program_rows'
     AND (t.end_date IS NULL OR t.end_date >= c_from);
  INSERT INTO public.cardio_targets (client_id, day_type, cardio_type, duration_minutes, frequency_per_week, scheduled_weekdays,
                                     status, enabled, visible_to_client, start_date, end_date, completion_rule, source, intensity,
                                     heart_rate_zone, client_notes, admin_notes, last_updated_at)
  VALUES (c_client, 'Training Day', 'Treadmill Walk', 10, 2, ARRAY['Tuesday', 'Thursday']::text[],
          'Active', true, true, c_from, ${lit(MEET.windowEnd)}::date, 'any_target', 'program_rows', 'Zone 2',
          'Zone 2', 'Easy Zone 2: incline walk or bike at a conversational pace, 10–15 min. 10 minutes done beats 30 skipped.',
          'Nationals prep: the program''s own Zone 2 sessions (Tuesday, plus an optional short one in the accumulation weeks).', now())
  RETURNING id INTO v_cardio;

  -- ── the weeks and blocks ─────────────────────────────────────────────────
  SELECT count(*) INTO n_after_days FROM public.pl_days d WHERE d.week_id IN (SELECT week_id FROM jn_after);
  DELETE FROM public.pl_weeks WHERE id IN (SELECT week_id FROM jn_after);
  GET DIAGNOSTICS n_after = ROW_COUNT;

  DELETE FROM public.pl_roadmap_notes n
   WHERE n.week_id IN (SELECT week_id FROM jn_wmap) OR n.block_id IN (SELECT block_id FROM jn_block);

  UPDATE public.pl_weeks SET week_index = week_index + 1000 WHERE id IN (SELECT week_id FROM jn_wmap);
  UPDATE public.pl_weeks w
     SET block_id = p.block_id, week_index = p.week_index, phase = p.phase, notes = p.notes,
         start_date = p.start_date, end_date = p.end_date
    FROM jn_wmap m JOIN jn_week p ON p.n = m.n
   WHERE w.id = m.week_id;

  -- ── the workouts ─────────────────────────────────────────────────────────
  UPDATE public.pl_days d
     SET title = p.title, subtitle = NULL, focus = p.focus, notes = p.notes, notes_client_visible = true,
         day_index = p.day_index, is_optional = p.is_optional, schedule_locked = p.locked, duration_override_min = NULL
    FROM jn_dmap m JOIN jn_day p ON p.on_date = m.on_date
   WHERE d.id = m.day_id;

  DELETE FROM public.pl_exercise_rows WHERE day_id IN (SELECT day_id FROM jn_dmap);
  INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, percentage,
                                       percentage_basis, rest_seconds, purpose_label, notes, measurement_type, tracking_type,
                                       duration_seconds, time_profile, manual_override, cardio_target_id)
  SELECT m.day_id, r.sort_order, r.exercise_id, e.name, r.sets, r.reps_text, r.rpe, r.percentage,
         r.percentage_basis, r.rest_seconds, r.purpose_label, r.notes, r.measurement_type, r.tracking_type,
         r.duration_seconds, r.time_profile, false, CASE WHEN r.is_cardio THEN v_cardio END
    FROM jn_row r
    JOIN jn_dmap m ON m.on_date = r.on_date
    JOIN public.exercises e ON e.id = r.exercise_id;
  GET DIAGNOSTICS n_rows = ROW_COUNT;

  -- a back-off read from today's single points at it
  UPDATE public.pl_exercise_rows r
     SET basis_row_id = t.id
    FROM jn_row p
    JOIN jn_dmap m ON m.on_date = p.on_date
    JOIN public.pl_exercise_rows t ON t.day_id = m.day_id AND t.sort_order = p.top_sort
   WHERE p.top_sort IS NOT NULL AND r.day_id = m.day_id AND r.sort_order = p.sort_order;

  UPDATE public.pl_blocks b
     SET name = p.name, training_focus = p.focus, goal = p.goal, coach_notes = p.coach_notes, status = p.status,
         start_date = p.start_date, end_date = p.end_date, weeks = p.weeks, client_visible = true, archived = false,
         week_duration_days = 7
    FROM jn_block p
   WHERE b.id = p.block_id AND b.prep_id = c_prep;
  UPDATE public.pl_blocks
     SET end_date = ${lit(addDays(WEEK1_START, -1))}::date, weeks = 2, status = 'Completed'
   WHERE id = c_hist AND prep_id = c_prep;

  -- ── the prep: the meet, a window with the lifting day to confirm ─────────
  UPDATE public.pl_preps
     SET title = ${lit(PREP_TITLE)}, goal_type = 'Meet Prep', status = 'Active',
         event_name = ${lit(MEET.name)}, event_location = ${lit(MEET.location)}, federation = ${lit(MEET.federation)},
         event_date = ${lit(MEET.windowStart)}::date, event_end_date = ${lit(MEET.windowEnd)}::date, event_day_tbd = true,
         weight_class = NULL, end_date = ${lit(MEET.windowEnd)}::date, total_weeks = 19,
         current_focus = 'Nationals Base · Week 1 of 12', coach_notes = ${lit(PREP_NOTES)}
   WHERE id = c_prep;

  -- ── Training Maxes: the values stay; the notes say what they are and when they're reviewed ──
  UPDATE public.pl_client_maxes m
     SET notes = CASE m.lift
           WHEN 'Competition Squat' THEN 'Training Max 235 kg: the Sep 20 2026 meet squat (Nov 9: 192.8 kg × 4 @6, ≈ 245 e1RM, so ≈ 96%). Held for the block; reviewed after Weeks 4 and 8 from the trend, never one session.'
           ELSE 'Training Max 150 kg: the Sep 20 2026 meet bench (Nov 12: 115.7 kg × 4 @6, ≈ 147 e1RM). Held for the block; reviewed after Weeks 4 and 8 from the trend, never one session.'
         END
   WHERE m.client_id = c_client AND m.block_id IN (SELECT block_id FROM jn_block)
     AND m.lift IN ('Competition Squat', 'Competition Bench Press') AND m.training_max IS NOT NULL;

  -- ── roadmap: the coach's words for each block and week (Cleo's never overwrite them) ──
  INSERT INTO public.pl_roadmap_notes (client_id, block_id, week_id, coach_label, coach_summary, hidden, edited_at)
  SELECT c_client, p.block_id, NULL, p.label, p.summary, false, now() FROM jn_block p
  UNION ALL
  SELECT c_client, p.block_id, m.week_id, p.label, p.summary, false, now() FROM jn_week p JOIN jn_wmap m ON m.n = p.n;

  -- ── the library template mirrors the program ─────────────────────────────
  UPDATE public.pl_templates t
     SET name = ${lit(PREP_TITLE)},
         tags = ARRAY['19 Weeks', '4 Days/Week', 'Powerlifting', 'Meet Prep', 'Hybrid % + RPE']::text[],
         weeks = 19, days_per_week = 4, training_focus = 'Nationals Prep',
         goal = 'Peak for the 2027 Canada Powerlifting National Championships (Feb 8–13 2027).',
         description = 'Two off-season blocks (Sep 27 – Nov 14 2026), then the 12-week Nationals prep: Base, Strength, Peak, Taper. 4 days a week (Mon/Tue/Thu/Sat).',
         notes = ${lit(TEMPLATE_NOTES)},
         payload = jsonb_build_object(
           'schema_version', t.payload -> 'schema_version',
           'blocks',
           jsonb_build_array(
             (SELECT b FROM jsonb_array_elements(t.payload -> 'blocks') b WHERE b ->> 'key' = 'block-1'),
             (SELECT jsonb_set(b, '{weeks}', coalesce((SELECT jsonb_agg(w ORDER BY (w ->> 'week_index')::int)
                                                        FROM jsonb_array_elements(b -> 'weeks') w
                                                       WHERE (w ->> 'week_index')::int <= 2), '[]'::jsonb))
                FROM jsonb_array_elements(t.payload -> 'blocks') b WHERE b ->> 'key' = 'block-2')
           ) || (
             SELECT jsonb_agg(jsonb_build_object(
                      'id', p.tpl_block_id, 'key', p.key, 'name', p.name, 'goal', p.goal, 'notes', '', 'phase', p.focus,
                      'training_focus', p.focus, 'order_index', p.order_index, 'archived', false, 'deleted_at', NULL,
                      'archived_at', NULL, 'estimated_minutes', NULL,
                      'weeks', (
                        SELECT jsonb_agg(jsonb_build_object(
                                 'week_index', w.week_index, 'notes', w.notes, 'phase', w.phase,
                                 'days', (
                                   SELECT jsonb_agg(jsonb_build_object(
                                            'day_index', d.day_index, 'title', d.title, 'notes', d.notes, 'is_optional', d.is_optional,
                                            'rows', (
                                              SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                                       'sort_order', r.sort_order, 'exercise_id', r.exercise_id, 'exercise_name_override', e.name,
                                                       'sets', r.sets, 'reps_text', r.reps_text, 'rpe', r.rpe, 'percentage', r.percentage,
                                                       'percentage_basis', r.percentage_basis, 'rest_seconds', r.rest_seconds,
                                                       'purpose_label', r.purpose_label, 'notes', r.notes, 'measurement_type', r.measurement_type,
                                                       'tracking_type', r.tracking_type, 'duration_seconds', r.duration_seconds)) ORDER BY r.sort_order)
                                                FROM jn_row r JOIN public.exercises e ON e.id = r.exercise_id
                                               WHERE r.on_date = d.on_date)) ORDER BY d.day_index)
                                     FROM jn_day d WHERE d.n = w.n)) ORDER BY w.week_index)
                          FROM jn_week w WHERE w.block_id = p.block_id)) ORDER BY p.order_index)
               FROM jn_block p
           ))
   WHERE t.id = c_tpl;

  -- one cardio pass now that the program is in place (links only the program's own Zone 2 rows)
  PERFORM public.program_cardio_sync(c_client);

  INSERT INTO public.program_loading_update_backup (source_table, row_id, row_data)
  VALUES ('run', ${lit(RUN_MARKER)}, jsonb_build_object('workouts', n_days, 'rows', n_rows, 'weeks_removed_after_meet', n_after,
                                                    'workouts_removed_after_meet', n_after_days, 'cardio_target', v_cardio, 'applied_at', now()));
  RAISE NOTICE 'jared nationals: % workouts rewritten (% rows), % post-meet weeks removed', n_days, n_rows, n_after;
END
$jn$;

DROP SCHEMA IF EXISTS jn_stage CASCADE;
`;
}
