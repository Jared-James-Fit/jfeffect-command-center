-- The coach's program editor (Nov 23 2026): a back-off at a % of the top set
-- has a "Round to" (load_round 'fine' = 2.5 lb / 1 kg, else 5 lb / 2.5 kg),
-- which the logger reads (backoffRoundStep). A client's block saves it straight
-- onto pl_exercise_rows (the block editor's ROW_FIELDS); a template keeps it on
-- its payload rows, and assigning the template copies it like a row's role:
-- pl_apply_template_meta fills it where the copy has none.
--
-- The live function is patched in place (its body has changed outside this
-- repository since 20270314080000: it also copies a row's is_optional), so
-- this only adds one UPDATE before its loop ends, and does nothing when it's
-- already there.

DO $$
DECLARE
  v_def text := pg_get_functiondef('public.pl_apply_template_meta(uuid,uuid,uuid)'::regprocedure);
  v_anchor text := E'  END LOOP;\nEND';
  v_add text := $add$
    WITH tw AS (
      SELECT ord::int AS week_no, val AS week
        FROM jsonb_array_elements(COALESCE(v_tb->'weeks_data', v_tb->'weeks', '[]'::jsonb)) WITH ORDINALITY AS t(val, ord)
    ), td AS (
      SELECT tw.week_no, d.ord::int AS day_no, d.val AS day
        FROM tw, jsonb_array_elements(COALESCE(tw.week->'days', '[]'::jsonb)) WITH ORDINALITY AS d(val, ord)
    ), tround AS (
      SELECT td.week_no, td.day_no,
             COALESCE(public.pl_safe_first_int(r.val->>'sort_order'), (r.ord - 1)::int) AS sort_no
        FROM td, jsonb_array_elements(COALESCE(td.day->'rows', '[]'::jsonb)) WITH ORDINALITY AS r(val, ord)
       WHERE r.val->>'load_round' = 'fine'
    )
    UPDATE public.pl_exercise_rows er
       SET load_round = 'fine'
      FROM public.pl_weeks w, public.pl_days pd, tround
     WHERE w.block_id = b.id
       AND pd.week_id = w.id
       AND er.day_id = pd.id
       AND w.week_index = tround.week_no
       AND pd.day_index = tround.day_no
       AND er.sort_order = tround.sort_no
       AND er.load_round IS NULL;
$add$;
  n int;
BEGIN
  IF position('load_round' in v_def) > 0 THEN
    RETURN;
  END IF;
  n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF n <> 1 THEN
    RAISE EXCEPTION 'pl_apply_template_meta: loop end found % times, expected 1', n;
  END IF;
  EXECUTE replace(v_def, v_anchor, v_add || v_anchor);
END $$;

REVOKE ALL ON FUNCTION public.pl_apply_template_meta(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
