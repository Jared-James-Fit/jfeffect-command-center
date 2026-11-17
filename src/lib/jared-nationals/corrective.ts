/**
 * The Nov 17 2026 corrections to Jared McIntyre's Nationals prep, as a
 * migration: written by scripts/jared-nationals/write-migration.ts;
 * src/test/jared-nationals-corrections.test.ts checks the committed file
 * still matches. The prep itself (program.ts, sql.ts and its migration) is
 * what was applied on Nov 16 and stays as it was; these are the changes on
 * top, each applied only to text and rows still exactly as Nov 16 left them.
 *
 *   1. Optional exercises: `pl_exercise_rows.is_optional` (the app counts an
 *      optional exercise only by what's logged on it), and every row the
 *      program marks optional (`OPTIONAL_ROWS`) marked, found by its block,
 *      week, day and place.
 *   2. The off-season (Blocks 1–2, Sep 27 – Nov 14, trained) gets its own
 *      completed program record, so the Nationals prep is the 12 weeks
 *      ("Week 1 of 12"); its blocks are numbered 1–4. Nothing logged moves.
 *   3. The taper: pl_prep_set_meet_day takes a lift-specific plan
 *      (`_moves`, from meet-taper.ts) as well as the even shift; the Week 11
 *      wording calls 14 / 11 / 9 days out what they are, placeholders.
 *   4. The library template mirrors the 12 weeks, with the coach guide Edit
 *      with AI reads (the taper rules, the Training Max rules).
 */
import { BLOCKS, CLIENT_ID, DAY_INDEX, PREP_ID, TEMPLATE_ID, WEEKS } from "./program";
import { PREP_NOTES, TEMPLATE_NOTES } from "./sql";

export const CORRECTIVE_MIGRATION = "supabase/migrations/20270329090000_jared_nationals_corrections.sql";
export const CORRECTIVE_MARKER = "jared_nationals_corrections_2026_11_17";
/** the off-season's own program record (made by this migration) */
export const OFF_SEASON_PREP_ID = "5a810dd5-4f20-490c-9187-3d69fbd5a3b2";
export const OFF_SEASON_BLOCKS = [
  { id: "8ad4251a-090d-4c57-9bc5-694ec2b0e448", name: "Block 1 — Volume 5s/7s" },
  { id: "74cce272-afde-4d4d-8c11-5214c5a6b3c1", name: "Block 2 — Volume 4s/6s" },
];
export const OFF_SEASON_TITLE = "Jared McIntyre — Off-Season Development";

/**
 * Every row the program marks optional: its block, its week in the block, its
 * day and its place in the day (sort_order, as the Nov 16 migration wrote it).
 */
export const OPTIONAL_ROWS = WEEKS.flatMap((w) => {
  const b = BLOCKS.find((x) => x.weeks.includes(w.n))!;
  return w.days.flatMap((d) =>
    d.rows.flatMap((r, i) =>
      r.optional ? [{ blockId: b.blockId, weekIndex: b.weeks.indexOf(w.n) + 1, dayIndex: DAY_INDEX[d.dow], sort: i, week: w.n, role: r.role }] : [],
    ),
  );
});
export const OPTIONAL_ROW_COUNT = OPTIONAL_ROWS.length;

/** The Nationals blocks numbered 1–4 in their own program (Block 3 — Nationals Base → Block 1 — …). */
export const BLOCK_RENAMES = BLOCKS.map((b, i) => ({
  id: b.blockId,
  key: b.key,
  from: b.name,
  to: b.name.replace(/^Block \d+/, `Block ${i + 1}`),
  order: i,
}));

const W11 = WEEKS.find((w) => w.n === 11)!;
const W12 = WEEKS.find((w) => w.n === 12)!;
const PEAK = BLOCKS.find((b) => b.key === "block-5")!;
const TAPER = BLOCKS.find((b) => b.key === "block-6")!;
const BASE = BLOCKS.find((b) => b.key === "block-3")!;

export type TextFix = { what: string; from: string; to: string };

export const TEXT_FIXES = {
  w11Notes: {
    what: "Week 11 notes",
    from: W11.notes,
    to: "Week 11 of 12. The final meaningful heavy exposure for each lift: squat Monday, bench Thursday, deadlift Saturday. For now they're counted from Feb 8, the conservative anchor (~14, ~11 and ~9 days out), and those are placeholders: once the lifting day is confirmed, each lift's last heavy day is set on its own from Jared's past meets and how he's recovering this prep, so they may move apart or closer. Don't max out.",
  },
  w11Summary: {
    what: "Week 11 roadmap line",
    from: W11.summary,
    to: "The last meaningful heavy single for each lift, strong and clean, never a grinder. For now ~14 / ~11 / ~9 days before Feb 8 (squat / bench / deadlift); each lift gets its own timing once the lifting day is confirmed.",
  },
  w12Notes: {
    what: "Week 12 notes",
    from: W12.notes,
    to: "Week 12 of 12. Taper, anchored on Feb 8 (the earliest day of the Feb 8–13 window). Once the lifting day is confirmed these sessions move with it: the primer stays two days out and the light technique work stays at least two days after each lift's final heavy day. Weeks 1–10 stay as they are.",
  },
  peakGoal: {
    what: "Peak block goal",
    from: PEAK.goal,
    to: "Specificity: competition lifts only, heavy doubles and singles, then each lift's final heavy exposure (placeholders ~14 / 11 / 9 days before Feb 8 until the lifting day is confirmed).",
  },
  peakCoach: {
    what: "Peak block coach notes",
    from: PEAK.coachNotes,
    to: "Nationals prep Weeks 9–11 (Jan 10 – Jan 30). Week 11's sessions are counted back from Feb 8 and locked to their dates. When the lifting day is confirmed, Confirm lifting day (Jared's Training tab) plans each lift's final heavy day from his past meets and this prep's response, or keeps the even shift; nothing in Weeks 1–10 moves.",
  },
  taperCoach: {
    what: "Taper block coach notes",
    from: TAPER.coachNotes,
    to: "Nationals prep Week 12 (Jan 31 – Feb 6), anchored on Feb 8. Locked to meet-relative dates; moves with the confirmed lifting day (Confirm lifting day on the Training tab). Keep a bench exposure close to the meet: Jared responds well to it.",
  },
  baseCoach: {
    what: "Base block coach notes",
    from: BASE.coachNotes,
    to: "Nationals prep Weeks 1–4 (Nov 15 – Dec 12). Squat TM 235 kg / bench TM 150 kg (Sep 20 2026 meet; Nov 9 squat 192.8 × 4 @6 ≈ 245 e1RM, Nov 12 bench 115.7 × 4 @6 ≈ 147). Bench is watched from the first sessions: if % work runs past its RPE caps in 2+ sessions, the Training tab flags it with a slightly lower TM (never from one session). Conventional deadlift TM: not on file (never the 270 kg sumo meet pull); after Saturday Nov 21's single @6 and back-offs the Training tab suggests a conservative one (92.5% of the estimated max) for you to set. Review all three after Week 4.",
  },
} satisfies Record<string, TextFix>;

export const NEW_PREP_NOTES = [
  "2027 Canada Powerlifting National Championships, Nanaimo BC. Window Feb 8–13 2027, lifting day TBD: Feb 8 is the conservative anchor. When the day is confirmed, Confirm lifting day on Jared's Training tab shows each lift's final heavy day planned from his past meets and this prep's response (or the even shift) and moves the Week 11–12 sessions. Weeks 1–10 stay.",
  ...PREP_NOTES.split("\n\n").slice(1),
].join("\n\n");

export const NEW_TEMPLATE_NOTES = [
  "Weekly order: MON Primary Squat + Bench/Triceps Overload; TUE Low-Fatigue Development + optional paused conventional pull; WED rest; THU Secondary Squat + Primary Competition Bench; FRI rest; SAT Primary Competition Deadlift + Secondary Bench; SUN rest.",
  "The 12-week 2027 Nationals prep: Base (W1–4, W4 fatigue reduction), Strength (W5–8, W8 fatigue reduction), Peak (W9–11), Taper (W12). The off-season Jared trained before it (Sep 27 – Nov 14 2026) is its own program.",
  "Loading: top singles by RPE; back-offs and competition-related secondaries as a % of the Training Max with the RPE as the cap (the cap beats the %); accessories by RPE with double progression, 1 hard set (2 for lats, side and rear delts).",
  "Optional exercises are marked optional (Tuesday's paused conventional pull, optional back-offs, accessories and cardio): skipping one never counts against him. Keep the paused pull only while Saturday's deadlift keeps progressing.",
  "Taper (Weeks 11–12): the final heavy squat / bench / deadlift days are placeholders counted from Feb 8 (~14 / ~11 / ~9 days out). Once the lifting day is confirmed, plan each lift on its own: bench recovers fastest and can sit closest (5–11 days out), squat 8–14, deadlift 8–16 and the lift most likely to need the most room. Read his own meets: Aug 5 2026 (NAPF), all three final heavies 10 days out, his best-peaked meet; Sep 20, near-max singles 7 days out, squat and bench peaked lower (he pulled sumo then, conventional now, so the deadlift evidence is weaker). Read this prep too: a lift whose % work keeps running past its RPE caps needs more room. Keep heavy days 2+ days apart (squat and deadlift 3+), light technique work 2+ days after that lift's final heavy, the primer 2 days out, and never rewrite Weeks 1–10 for the taper.",
  "Training Maxes: squat 235 / bench 150 kg, block-scoped and held. Change one only from a trend (2+ sessions past their RPE caps at the planned loads, never one), slightly (5% at most at once), and the coach sets it. Conventional deadlift: none until the Week 1 calibration (Sat Nov 21), then a conservative one from that single and its back-offs, set by the coach, never from the 270 kg sumo meet pull.",
  TEMPLATE_NOTES.split("\n\n").slice(-1)[0],
].join("\n\n");

const lit = (s: string | null | undefined) => (s == null ? "NULL" : `'${s.replace(/'/g, "''")}'`);

const META_FN = String.raw`CREATE OR REPLACE FUNCTION public.pl_apply_template_meta(p_template_id uuid, p_prep_id uuid, p_block_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payload jsonb;
  v_blocks jsonb;
  v_tb jsonb;
  b record;
BEGIN
  SELECT payload INTO v_payload FROM public.pl_templates WHERE id = p_template_id;
  IF v_payload IS NULL THEN
    RETURN;
  END IF;
  v_blocks := COALESCE(
    CASE WHEN jsonb_typeof(v_payload->'blocks_data') = 'array' AND jsonb_array_length(v_payload->'blocks_data') > 0 THEN v_payload->'blocks_data' END,
    CASE WHEN jsonb_typeof(v_payload->'blocks') = 'array' AND jsonb_array_length(v_payload->'blocks') > 0 THEN v_payload->'blocks' END,
    '[]'::jsonb
  );

  FOR b IN
    SELECT id, source_template_block_key
      FROM public.pl_blocks
     WHERE (p_prep_id IS NOT NULL AND prep_id = p_prep_id)
        OR (p_block_id IS NOT NULL AND id = p_block_id)
  LOOP
    v_tb := NULL;
    IF b.source_template_block_key IS NOT NULL THEN
      SELECT val INTO v_tb
        FROM jsonb_array_elements(v_blocks) AS val
       WHERE val->>'id' = b.source_template_block_key
       LIMIT 1;
    END IF;
    IF v_tb IS NULL AND jsonb_array_length(v_blocks) = 0 THEN
      v_tb := v_payload;
    END IF;
    IF v_tb IS NULL THEN
      CONTINUE;
    END IF;

    WITH tw AS (
      SELECT ord::int AS week_no, val AS week
        FROM jsonb_array_elements(COALESCE(v_tb->'weeks_data', v_tb->'weeks', '[]'::jsonb)) WITH ORDINALITY AS t(val, ord)
    ), td AS (
      SELECT tw.week_no, d.ord::int AS day_no, d.val AS day
        FROM tw, jsonb_array_elements(COALESCE(tw.week->'days', '[]'::jsonb)) WITH ORDINALITY AS d(val, ord)
    )
    UPDATE public.pl_days pd
       SET is_optional = true
      FROM public.pl_weeks w, td
     WHERE w.block_id = b.id
       AND pd.week_id = w.id
       AND w.week_index = td.week_no
       AND pd.day_index = td.day_no
       AND lower(COALESCE(td.day->>'is_optional', 'false')) = 'true';

    WITH tw AS (
      SELECT ord::int AS week_no, val AS week
        FROM jsonb_array_elements(COALESCE(v_tb->'weeks_data', v_tb->'weeks', '[]'::jsonb)) WITH ORDINALITY AS t(val, ord)
    ), td AS (
      SELECT tw.week_no, d.ord::int AS day_no, d.val AS day
        FROM tw, jsonb_array_elements(COALESCE(tw.week->'days', '[]'::jsonb)) WITH ORDINALITY AS d(val, ord)
    ), tr AS (
      SELECT td.week_no, td.day_no,
             COALESCE(public.pl_safe_first_int(r.val->>'sort_order'), (r.ord - 1)::int) AS sort_no,
             NULLIF(r.val->>'purpose_label', '') AS label,
             lower(COALESCE(r.val->>'is_optional', 'false')) = 'true' AS optional
        FROM td, jsonb_array_elements(COALESCE(td.day->'rows', '[]'::jsonb)) WITH ORDINALITY AS r(val, ord)
    )
    UPDATE public.pl_exercise_rows er
       SET purpose_label = COALESCE(er.purpose_label, tr.label),
           is_optional = er.is_optional OR tr.optional
      FROM public.pl_weeks w, public.pl_days pd, tr
     WHERE w.block_id = b.id
       AND pd.week_id = w.id
       AND er.day_id = pd.id
       AND w.week_index = tr.week_no
       AND pd.day_index = tr.day_no
       AND er.sort_order = tr.sort_no
       AND ((tr.label IS NOT NULL AND er.purpose_label IS NULL) OR (tr.optional AND NOT er.is_optional));
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pl_apply_template_meta(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;`;

const MEET_DAY_FN = String.raw`-- Confirm the lifting day: the prep's meet-relative sessions (locked days dated in
-- the 15 days before the old anchor that nothing has touched) move to it. With no
-- _moves they all move by the same number of days (each keeps its distance from
-- the meet). With _moves ([{day_id, date}], a lift-specific plan from the app's
-- meet-taper.ts) each named session goes to its own date; any left out keep the
-- even shift. Either way: nothing on or after the lifting day, nothing moved into
-- the past, nothing on or before the last session the taper leaves alone, one
-- session a day. Nothing earlier moves. Preview by default; _apply => true moves
-- them and records the day. Admins, the client's coach, or the server.
DROP FUNCTION IF EXISTS public.pl_prep_set_meet_day(uuid, date, boolean);
CREATE OR REPLACE FUNCTION public.pl_prep_set_meet_day(_prep uuid, _day date, _apply boolean DEFAULT false, _moves jsonb DEFAULT NULL)
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
  v_last date;
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
  IF _moves IS NOT NULL AND jsonb_typeof(_moves) <> 'array' THEN RAISE EXCEPTION '_moves must be a list'; END IF;
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

  IF _moves IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(_moves) e
                WHERE NOT EXISTS (SELECT 1 FROM pl_meet_moves m WHERE m.day_id::text = e->>'day_id')) THEN
      RAISE EXCEPTION 'a planned session isn''t one of this taper''s untouched sessions';
    END IF;
    UPDATE pl_meet_moves m SET new_date = (e->>'date')::date
      FROM jsonb_array_elements(_moves) e WHERE m.day_id::text = e->>'day_id';
  END IF;

  -- the last session the taper leaves alone (anything before the window, or touched in it)
  SELECT max(d.scheduled_date) INTO v_last
    FROM public.pl_days d
    JOIN public.pl_weeks w ON w.id = d.week_id AND w.deleted_at IS NULL
    JOIN public.pl_blocks b ON b.id = w.block_id AND b.prep_id = _prep AND NOT coalesce(b.archived, false)
   WHERE NOT d.archived AND d.deleted_at IS NULL AND d.scheduled_date < p.event_date
     AND d.id NOT IN (SELECT day_id FROM pl_meet_moves);
  IF EXISTS (SELECT 1 FROM pl_meet_moves WHERE new_date >= _day) THEN
    RAISE EXCEPTION 'a session would land on or after the lifting day';
  END IF;
  IF EXISTS (SELECT 1 FROM pl_meet_moves WHERE new_date <> old_date AND (new_date < v_today OR (v_last IS NOT NULL AND new_date <= v_last))) THEN
    RAISE EXCEPTION 'a session would land in the past or before the taper (on or before %)', v_last;
  END IF;
  IF EXISTS (SELECT 1 FROM pl_meet_moves GROUP BY new_date HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'two sessions would land on the same day';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('day_id', day_id, 'title', title, 'from', old_date, 'to', new_date) ORDER BY new_date), '[]'::jsonb)
    INTO v_moves FROM pl_meet_moves;

  IF _apply THEN
    -- a title that starts with its weekday ("Monday — Final Heavy Squat") follows the new date
    UPDATE public.pl_days d
       SET scheduled_date = m.new_date,
           title = regexp_replace(d.title, '^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\M', trim(to_char(m.new_date, 'FMDay')))
      FROM pl_meet_moves m WHERE d.id = m.day_id AND m.new_date <> m.old_date;
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.pl_scheduled_workouts s SET scheduled_date = s.scheduled_date + (m.new_date - m.old_date)
      FROM pl_meet_moves m WHERE s.source_day_id = m.day_id AND m.new_date <> m.old_date;
    UPDATE public.pl_preps SET event_date = _day, event_day_tbd = false WHERE id = _prep;
  END IF;
  RETURN jsonb_build_object('lifting_day', _day, 'delta_days', v_delta, 'applied', _apply, 'moved', n,
                            'plan', CASE WHEN _moves IS NULL THEN 'even' ELSE 'lift' END, 'sessions', v_moves);
END
$fn$;
REVOKE ALL ON FUNCTION public.pl_prep_set_meet_day(uuid, date, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_prep_set_meet_day(uuid, date, boolean, jsonb) TO authenticated;`;

function fixRows(): string {
  const f = TEXT_FIXES;
  return [
    `  -- Week 11 and Week 12 wording (only where it's still exactly as written on Nov 16)
  UPDATE public.pl_weeks w SET notes = ${lit(f.w11Notes.to)}
   WHERE w.block_id = ${lit(PEAK.blockId)} AND w.week_index = ${PEAK.weeks.indexOf(11) + 1} AND w.notes = ${lit(f.w11Notes.from)};
  UPDATE public.pl_weeks w SET notes = ${lit(f.w12Notes.to)}
   WHERE w.block_id = ${lit(TAPER.blockId)} AND w.week_index = ${TAPER.weeks.indexOf(12) + 1} AND w.notes = ${lit(f.w12Notes.from)};
  UPDATE public.pl_roadmap_notes n SET coach_summary = ${lit(f.w11Summary.to)}, edited_at = now()
    FROM public.pl_weeks w
   WHERE n.week_id = w.id AND w.block_id = ${lit(PEAK.blockId)} AND w.week_index = ${PEAK.weeks.indexOf(11) + 1}
     AND n.coach_summary = ${lit(f.w11Summary.from)};
  UPDATE public.pl_blocks SET goal = ${lit(f.peakGoal.to)} WHERE id = ${lit(PEAK.blockId)} AND goal = ${lit(f.peakGoal.from)};
  UPDATE public.pl_blocks SET coach_notes = ${lit(f.peakCoach.to)} WHERE id = ${lit(PEAK.blockId)} AND coach_notes = ${lit(f.peakCoach.from)};
  UPDATE public.pl_blocks SET coach_notes = ${lit(f.taperCoach.to)} WHERE id = ${lit(TAPER.blockId)} AND coach_notes = ${lit(f.taperCoach.from)};
  UPDATE public.pl_blocks SET coach_notes = ${lit(f.baseCoach.to)} WHERE id = ${lit(BASE.blockId)} AND coach_notes = ${lit(f.baseCoach.from)};`,
  ].join("\n");
}

function renameValues(): string {
  return BLOCK_RENAMES.map((r) => `      (${lit(r.id)}::uuid, ${lit(r.key)}, ${lit(r.from)}, ${lit(r.to)}, ${r.order})`).join(",\n");
}

function templatePayloadSql(): string {
  const f = TEXT_FIXES;
  return `  UPDATE public.pl_templates t
     SET weeks = 12,
         tags = ARRAY['12 Weeks', '4 Days/Week', 'Powerlifting', 'Meet Prep', 'Hybrid % + RPE']::text[],
         description = 'The 12-week 2027 Nationals prep: Base, Strength, Peak, Taper. 4 days a week (Mon/Tue/Thu/Sat).',
         notes = ${lit(NEW_TEMPLATE_NOTES)},
         payload = jsonb_set(t.payload, '{blocks}', (
           SELECT jsonb_agg(
                    jsonb_set(jsonb_set(jsonb_set(b, '{name}', to_jsonb(r.to_name)), '{order_index}', to_jsonb(r.ord)), '{weeks}', coalesce((
                      SELECT jsonb_agg(
                               jsonb_set(
                                 CASE WHEN w ->> 'notes' = ${lit(f.w11Notes.from)} THEN jsonb_set(w, '{notes}', to_jsonb(${lit(f.w11Notes.to)}::text))
                                      WHEN w ->> 'notes' = ${lit(f.w12Notes.from)} THEN jsonb_set(w, '{notes}', to_jsonb(${lit(f.w12Notes.to)}::text))
                                      ELSE w END,
                                 '{days}', coalesce((
                                   SELECT jsonb_agg(jsonb_set(d, '{rows}', coalesce((
                                            SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jn_optional o WHERE o.key = r.key AND o.week_no = word AND o.day_index = (d ->> 'day_index')::int AND o.sort_order = xo - 1)
                                                                 THEN x || '{"is_optional": true}'::jsonb ELSE x END ORDER BY xo)
                                              FROM jsonb_array_elements(d -> 'rows') WITH ORDINALITY AS xr(x, xo)), '[]'::jsonb)) ORDER BY dord)
                                     FROM jsonb_array_elements(w -> 'days') WITH ORDINALITY AS dr(d, dord)), '[]'::jsonb))
                               ORDER BY word)
                        FROM jsonb_array_elements(b -> 'weeks') WITH ORDINALITY AS wr(w, word)), '[]'::jsonb))
                    ORDER BY r.ord)
             FROM jsonb_array_elements(t.payload -> 'blocks') b
             JOIN jn_renames r ON r.key = b ->> 'key'))
   WHERE t.id = c_tpl;`;
}

export function correctiveSql(): string {
  return `-- Jared McIntyre's 2027 Nationals prep: the Nov 17 2026 corrections. GENERATED by
-- scripts/jared-nationals/write-migration.ts from src/lib/jared-nationals/corrective.ts;
-- never hand-edited: src/test/jared-nationals-corrections.test.ts fails when they disagree.
--
--   1. Optional exercises (pl_exercise_rows.is_optional): only what's logged on one counts,
--      so skipping it never lowers a workout's completion, adherence or analytics. Template
--      assignment copies it. The prep's ${OPTIONAL_ROW_COUNT} optional rows are marked.
--   2. The off-season (Sep 27 – Nov 14 2026, trained) becomes its own completed program;
--      the Nationals prep is the 12 weeks and its blocks are numbered 1–4. No logged set,
--      workout, date or exercise changes; nothing is deleted.
--   3. pl_prep_set_meet_day takes a lift-specific plan (_moves) as well as the even shift;
--      Week 11's 14 / 11 / 9 days out are worded as the placeholders they are.
--   4. The library template mirrors the 12 weeks with the coach guide Edit with AI reads.
-- Every changed row is backed up in program_loading_update_backup first, and the data part
-- runs once (marker ${lit(CORRECTIVE_MARKER)}).

ALTER TABLE public.pl_exercise_rows ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.pl_exercise_rows.is_optional IS 'The coach made this exercise optional: only the sets logged on it count toward the workout (completion, adherence, analytics); skipping it is never missed work.';

-- A template's optional exercises stay optional on the client's copy (with its roles).
${META_FN}

${MEET_DAY_FN}

DO $jc$
DECLARE
  c_client constant uuid := ${lit(CLIENT_ID)};
  c_prep constant uuid := ${lit(PREP_ID)};
  c_off constant uuid := ${lit(OFF_SEASON_PREP_ID)};
  c_tpl constant uuid := ${lit(TEMPLATE_ID)};
  v_n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.program_loading_update_backup WHERE source_table = 'run' AND row_id = ${lit(CORRECTIVE_MARKER)}) THEN
    RAISE NOTICE 'jared nationals corrections: already applied';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.program_loading_update_backup WHERE source_table = 'run' AND row_id = 'jared_nationals_2027') THEN
    RAISE EXCEPTION 'jared nationals corrections: the Nov 16 prep rewrite has not run';
  END IF;
  IF (SELECT count(*) FROM public.pl_blocks WHERE prep_id = c_prep AND client_id = c_client AND NOT coalesce(archived, false)) <> ${BLOCKS.length + OFF_SEASON_BLOCKS.length} THEN
    RAISE EXCEPTION 'jared nationals corrections: the prep does not hold the ${BLOCKS.length + OFF_SEASON_BLOCKS.length} blocks it should';
  END IF;

  CREATE TEMP TABLE jn_renames (id uuid, key text, from_name text, to_name text, ord int) ON COMMIT DROP;
  INSERT INTO jn_renames VALUES
${renameValues()};
  CREATE TEMP TABLE jn_optional (key text, week_no int, day_index int, sort_order int) ON COMMIT DROP;
  INSERT INTO jn_optional VALUES
${OPTIONAL_ROWS.map((o) => `      (${lit(BLOCKS.find((b) => b.blockId === o.blockId)!.key)}, ${o.weekIndex}, ${o.dayIndex}, ${o.sort})`).join(",\n")};

  -- ── backup of everything this changes ─────────────────────────────────────
  INSERT INTO public.program_loading_update_backup (source_table, row_id, row_data)
  SELECT 'pl_preps', p.id::text, to_jsonb(p) FROM public.pl_preps p WHERE p.id = c_prep
  UNION ALL
  SELECT 'pl_blocks', b.id::text, to_jsonb(b) FROM public.pl_blocks b WHERE b.prep_id = c_prep
  UNION ALL
  SELECT 'pl_templates', t.id::text, to_jsonb(t) FROM public.pl_templates t WHERE t.id = c_tpl
  UNION ALL
  SELECT 'pl_weeks', w.id::text, to_jsonb(w) FROM public.pl_weeks w
   WHERE (w.block_id = ${lit(PEAK.blockId)} AND w.week_index = ${PEAK.weeks.indexOf(11) + 1}) OR (w.block_id = ${lit(TAPER.blockId)} AND w.week_index = ${TAPER.weeks.indexOf(12) + 1})
  UNION ALL
  SELECT 'pl_roadmap_notes', n.id::text, to_jsonb(n) FROM public.pl_roadmap_notes n JOIN public.pl_weeks w ON w.id = n.week_id
   WHERE w.block_id = ${lit(PEAK.blockId)} AND w.week_index = ${PEAK.weeks.indexOf(11) + 1};

  -- ── 1. optional exercises ─────────────────────────────────────────────────
  UPDATE public.pl_exercise_rows r SET is_optional = true
    FROM (VALUES
${OPTIONAL_ROWS.map((o) => `      (${lit(o.blockId)}::uuid, ${o.weekIndex}, ${o.dayIndex}, ${o.sort})`).join(",\n")}
         ) v(block_id, week_index, day_index, sort_order), public.pl_weeks w, public.pl_days d
   WHERE w.block_id = v.block_id AND w.week_index = v.week_index AND d.week_id = w.id AND d.day_index = v.day_index
     AND NOT d.archived AND r.day_id = d.id AND r.sort_order = v.sort_order AND NOT r.is_optional;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> ${OPTIONAL_ROW_COUNT} THEN
    RAISE EXCEPTION 'jared nationals corrections: expected ${OPTIONAL_ROW_COUNT} optional rows, found %', v_n;
  END IF;

  -- ── 2. the off-season is its own (completed) program ─────────────────────
  INSERT INTO public.pl_preps (id, client_id, title, goal_type, status, start_date, end_date, total_weeks, client_visible, coach_notes)
  VALUES (c_off, c_client, ${lit(OFF_SEASON_TITLE)}, 'Off-Season', 'Completed', '2026-09-27', '2026-11-14', 7, true,
          'The first 7 weeks (Blocks 1–2) of the 28-week off-season plan, trained Sep 27 – Nov 14 2026. Ended there for the 2027 Nationals prep, which is its own program.')
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.pl_blocks SET prep_id = c_off
   WHERE prep_id = c_prep AND client_id = c_client AND id IN (${OFF_SEASON_BLOCKS.map((b) => `${lit(b.id)}::uuid`).join(", ")});
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> ${OFF_SEASON_BLOCKS.length} THEN RAISE EXCEPTION 'jared nationals corrections: moved % off-season blocks, expected ${OFF_SEASON_BLOCKS.length}', v_n; END IF;
  -- Block 1 ended Oct 31 and was trained; it still read Active
  UPDATE public.pl_blocks SET status = 'Completed' WHERE id = ${lit(OFF_SEASON_BLOCKS[0].id)} AND status = 'Active' AND end_date < '2026-11-15';

  -- ── the Nationals prep is the 12 weeks, its blocks 1–4 ────────────────────
  UPDATE public.pl_preps
     SET total_weeks = 12, start_date = '2026-11-15',
         coach_notes = CASE WHEN coach_notes = ${lit(PREP_NOTES)} THEN ${lit(NEW_PREP_NOTES)} ELSE coach_notes END
   WHERE id = c_prep;
  UPDATE public.pl_blocks b SET name = r.to_name, sort_order = r.ord
    FROM jn_renames r WHERE b.id = r.id AND b.prep_id = c_prep AND b.name = r.from_name;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> ${BLOCK_RENAMES.length} THEN RAISE EXCEPTION 'jared nationals corrections: renamed % blocks, expected ${BLOCK_RENAMES.length}', v_n; END IF;

  -- ── 3. the taper's wording ────────────────────────────────────────────────
${fixRows()}

  -- ── 4. the library template mirrors the 12 weeks ─────────────────────────
${templatePayloadSql()}

  SELECT count(*) INTO v_n
    FROM public.pl_templates t, jsonb_array_elements(t.payload -> 'blocks') b, jsonb_array_elements(b -> 'weeks') w,
         jsonb_array_elements(w -> 'days') d, jsonb_array_elements(d -> 'rows') x
   WHERE t.id = c_tpl AND (x ->> 'is_optional')::boolean;
  IF v_n <> ${OPTIONAL_ROW_COUNT} THEN RAISE EXCEPTION 'jared nationals corrections: the template marks % optional rows, expected ${OPTIONAL_ROW_COUNT}', v_n; END IF;

  INSERT INTO public.program_loading_update_backup (source_table, row_id, row_data)
  VALUES ('run', ${lit(CORRECTIVE_MARKER)}, jsonb_build_object('optional_rows', ${OPTIONAL_ROW_COUNT}, 'off_season_prep', c_off, 'applied_at', now()));
  RAISE NOTICE 'jared nationals corrections applied';
END
$jc$;
`;
}
