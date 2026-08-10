-- Temporary helpers to rewrite backoff rows inside the template payload JSON
CREATE OR REPLACE FUNCTION public._tmp_fix_rows(rows jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN NULLIF(r->>'rpe','') IS NULL
       AND NULLIF(r->>'rir','') IS NULL
       AND NULLIF(r->>'percentage','') IS NULL
       AND (r->>'notes') ~* 'Backoff:[[:space:]]*[[:digit:]]+(–[[:digit:]]+)?%[[:space:]]*below top-(set|single)'
      THEN jsonb_set(
             jsonb_set(r, '{percentage}',
               to_jsonb(100 - (substring(r->>'notes' from '([[:digit:]]+)%'))::numeric), false),
             '{percentage_basis}', to_jsonb('top_set'::text), false)
      ELSE r
    END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(rows) WITH ORDINALITY AS x(r, ord)
$$;

CREATE OR REPLACE FUNCTION public._tmp_fix_days(days jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(
    CASE WHEN jsonb_typeof(d->'rows') = 'array'
      THEN jsonb_set(d, '{rows}', public._tmp_fix_rows(d->'rows'), false)
      ELSE d END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(days) WITH ORDINALITY AS x(d, ord)
$$;

CREATE OR REPLACE FUNCTION public._tmp_fix_weeks(weeks jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(
    CASE WHEN jsonb_typeof(w->'days') = 'array'
      THEN jsonb_set(w, '{days}', public._tmp_fix_days(w->'days'), false)
      ELSE w END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(weeks) WITH ORDINALITY AS x(w, ord)
$$;

CREATE OR REPLACE FUNCTION public._tmp_fix_blocks(blocks jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(b->'weeks_data') = 'array'
        THEN jsonb_set(b, '{weeks_data}', public._tmp_fix_weeks(b->'weeks_data'), false)
      WHEN jsonb_typeof(b->'weeks') = 'array'
        THEN jsonb_set(b, '{weeks}', public._tmp_fix_weeks(b->'weeks'), false)
      ELSE b END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(blocks) WITH ORDINALITY AS x(b, ord)
$$;

-- 1) Restore the source template (Nicole Yusi — 12 Week Strength Base to Peak)
UPDATE public.pl_templates
SET payload = jsonb_set(payload, '{blocks_data}', public._tmp_fix_blocks(payload->'blocks_data'), false),
    updated_at = now()
WHERE id = 'd49a888c-5cb2-49aa-a304-1ca54e8bc83a'
  AND jsonb_typeof(payload->'blocks_data') = 'array';

-- 2) Restore the cloned rows on Nicole's live program (prep ae8fd700)
UPDATE public.pl_exercise_rows r
SET percentage = 100 - (substring(r.notes from '([[:digit:]]+)%'))::numeric,
    percentage_basis = 'top_set',
    updated_at = now()
FROM public.pl_days d, public.pl_weeks w, public.pl_blocks b
WHERE r.day_id = d.id AND d.week_id = w.id AND w.block_id = b.id
  AND b.prep_id = 'ae8fd700-9de1-48dd-bd83-cd0cd7ced442'
  AND NULLIF(r.rpe::text,'') IS NULL
  AND NULLIF(r.rir::text,'') IS NULL
  AND NULLIF(r.percentage::text,'') IS NULL
  AND r.notes ~* 'Backoff:[[:space:]]*[[:digit:]]+(–[[:digit:]]+)?%[[:space:]]*below top-(set|single)';

-- Clean up temporary helpers
DROP FUNCTION public._tmp_fix_rows(jsonb);
DROP FUNCTION public._tmp_fix_days(jsonb);
DROP FUNCTION public._tmp_fix_weeks(jsonb);
DROP FUNCTION public._tmp_fix_blocks(jsonb);