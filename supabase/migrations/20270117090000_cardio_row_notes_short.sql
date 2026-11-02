-- The cardio plan's session in a workout says what it is in one short line.
--
-- The note program_cardio_sync wrote onto each workout's cardio row ran past
-- the logger's 140-character cut-off ("Complete the session when ANY ONE target
-- is reached…" plus a sentence about logging), so the card hid it behind "Read
-- notes" and the incline, speed and zone were out of sight. Now it's the plan's
-- incline · speed · zone and its first real cue, never the steps / calories
-- "whichever comes first" wording (the logger logs time, calories and RPE), and
-- the logger's own "Your cardio plan" tag says it counts as the day's cardio.
CREATE OR REPLACE FUNCTION public.cardio_row_notes(t public.cardio_targets)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH parts AS (
    SELECT
      nullif(concat_ws(' · ',
        CASE WHEN t.incline IS NOT NULL THEN 'Incline ' || trim_scale(t.incline)::text || '%' END,
        CASE WHEN t.speed_min_mph IS NOT NULL AND t.speed_max_mph IS NOT NULL AND t.speed_max_mph <> t.speed_min_mph
               THEN trim_scale(t.speed_min_mph)::text || '–' || trim_scale(t.speed_max_mph)::text || ' mph'
             WHEN coalesce(t.speed_min_mph, t.speed_max_mph) IS NOT NULL
               THEN trim_scale(coalesce(t.speed_min_mph, t.speed_max_mph))::text || ' mph' END,
        nullif(trim(coalesce(t.heart_rate_zone, '')), '')
      ), '') AS rx,
      -- the coach's own cues (up to two sentences), never the "whichever target comes first" wording
      -- and never a repeat of the incline / speed already said
      (SELECT string_agg(rtrim(trim(x.sentence), '.'), '. ' ORDER BY x.n)
         FROM (
           SELECT sentence, n
             FROM regexp_split_to_table(coalesce(t.client_notes, ''), '(?<=[.!?])\s+') WITH ORDINALITY AS s(sentence, n)
            WHERE trim(sentence) <> ''
              AND trim(sentence) !~* '(any one target|whichever target|target comes first|targets? (is|are) reached)'
              AND NOT (t.incline IS NOT NULL AND trim(sentence) ~* '^incline\M')
            ORDER BY n
            LIMIT 2
         ) x) AS cue
  )
  SELECT coalesce(
    nullif(left(concat_ws('. ', rx, nullif(cue, '')) || CASE WHEN rx IS NOT NULL OR cue IS NOT NULL THEN '.' ELSE '' END, 140), ''),
    'Easy pace: you can talk, but not sing.'
  )
  FROM parts;
$$;

-- Rewrite the note on every linked, unlogged upcoming row now (the sync updates a row whose note differs).
SELECT public.program_cardio_sync_all();
