-- Assigning a template keeps two things it used to drop (Nov 13 2026):
--
-- 1. A row's role (purpose_label: Primary / Secondary / Tertiary …). The
--    builder lets a coach set it on a template, and the powerlifting-exposure
--    analytics read it on a client's rows, but pl_assign_template_to_client
--    never copied it, so every assigned program lost its competition-lift roles.
-- 2. An optional session (pl_days.is_optional, new). The JF Effect Elite
--    Powerlifting program has three core days and an optional recovery day;
--    skipping an optional day must never read as a missed workout.
--
-- Both are copied by pl_apply_template_meta after the assign function builds
-- the client's blocks, matched by the template block each client block came
-- from (pl_blocks.source_template_block_key), then week, day and row order.
-- The assign function calls it at its four "assigned a whole block or prep"
-- returns; the into-block / week / day modes are untouched. A client's own
-- edits are never overwritten: a role is only filled where none is set.

ALTER TABLE public.pl_days ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.pl_apply_template_meta(p_template_id uuid, p_prep_id uuid, p_block_id uuid)
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
    -- a single-block template keeps its weeks on the payload itself
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
             NULLIF(r.val->>'purpose_label', '') AS label
        FROM td, jsonb_array_elements(COALESCE(td.day->'rows', '[]'::jsonb)) WITH ORDINALITY AS r(val, ord)
    )
    UPDATE public.pl_exercise_rows er
       SET purpose_label = tr.label
      FROM public.pl_weeks w, public.pl_days pd, tr
     WHERE w.block_id = b.id
       AND pd.week_id = w.id
       AND er.day_id = pd.id
       AND w.week_index = tr.week_no
       AND pd.day_index = tr.day_no
       AND er.sort_order = tr.sort_no
       AND tr.label IS NOT NULL
       AND er.purpose_label IS NULL;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.pl_apply_template_meta(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The assign function calls it wherever it has built a whole prep or block.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.pl_assign_template_to_client(uuid,uuid,jsonb,text,boolean,date,date,text[],text)'::regprocedure);
  v_prep text := 'RETURN jsonb_build_object(''prep_id'', v_prep_id);';
  v_block text := 'RETURN jsonb_build_object(''block_id'', v_block_id);';
  n_prep int;
  n_block int;
BEGIN
  IF position('pl_apply_template_meta' in v_def) > 0 THEN
    RETURN;
  END IF;
  n_prep := (length(v_def) - length(replace(v_def, v_prep, ''))) / length(v_prep);
  n_block := (length(v_def) - length(replace(v_def, v_block, ''))) / length(v_block);
  IF n_prep <> 2 OR n_block <> 2 THEN
    RAISE EXCEPTION 'pl_assign_template_to_client: expected 2 prep and 2 block returns, found % and %', n_prep, n_block;
  END IF;
  v_def := replace(v_def, v_prep, 'PERFORM public.pl_apply_template_meta(v_tpl.id, v_prep_id, NULL); ' || v_prep);
  v_def := replace(v_def, v_block, 'PERFORM public.pl_apply_template_meta(v_tpl.id, NULL, v_block_id); ' || v_block);
  EXECUTE v_def;
END $$;

-- The Clients list's "missed workouts" (last 14 days) never counts an optional
-- session: skipping one is a choice, not a miss.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.admin_clients_directory(text,text,text,uuid,text,integer,integer,text,text[],text)'::regprocedure);
  v_anchor text := 'and sw.scheduled_date between v_today - 14 and v_today - 1';
  n int;
BEGIN
  IF position('pd_opt.is_optional' in v_def) > 0 THEN
    RETURN;
  END IF;
  n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF n <> 1 THEN
    RAISE EXCEPTION 'admin_clients_directory: missed-workouts anchor found % times, expected 1', n;
  END IF;
  v_def := replace(v_def, v_anchor, v_anchor || E'\n      and not exists (select 1 from public.pl_days pd_opt where pd_opt.id = sw.source_day_id and pd_opt.is_optional)');
  EXECUTE v_def;
END $$;
