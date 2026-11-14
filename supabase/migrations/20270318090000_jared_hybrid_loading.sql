-- Jared McIntyre — 28 Week Off-Season Development: hybrid % + RPE loading
-- (Nov 14 2026). A precision update to loading only: no exercise, set, rep,
-- split or day changes, no new exercises, nothing logged touched.
--
--   Primary top sets      RPE (unchanged)
--   Primary back-offs     % of that day's top set (`top_set`, linked to it by
--                         basis_row_id) with the row's RPE as the cap:
--                         Blocks 2/4/5 squat + bench 92.5–95%, deadlift 90–92.5%;
--                         check-in Blocks 3/6 squat + bench 82.5–87.5% of the
--                         single, deadlift 80–85%. The app works out the low end.
--   High Bar Squat        % of the Competition Squat Training Max (235 kg,
--   2ct Paused Bench      Sep 20 2026 meet) / Competition Bench TM (150 kg),
--                         block-scoped maxes so each block's reference is
--                         reviewed at its end and never moves with an e1RM.
--   Paused Sumo           % of a sumo TM in the library template only: since
--                         Nov 9 the live program has no Paused Sumo (deadlift
--                         1x/week), and there's no reliable current sumo e1RM,
--                         so no TM is set.
--   Close-Grip Block Press, accessories: unchanged (RPE / RIR).
--
-- Live rows change only on workouts nothing has touched (pl_day_touched as of
-- Nov 13 2026: not dated before it, no completion, no logged set). The
-- template changes from Block 2 Week 2 on. Everything changed is copied into
-- program_loading_update_backup first (closed to clients and staff).

CREATE TABLE IF NOT EXISTS public.program_loading_update_backup (
  id bigserial PRIMARY KEY,
  source_table text NOT NULL,
  row_id text,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.program_loading_update_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_loading_update_backup FROM anon, authenticated;

-- What one row becomes, or NULL when the row isn't part of the update.
-- _bno = block number (Block N), _wk = week in the block.
CREATE OR REPLACE FUNCTION pg_temp.jl_plan(_bno int, _wk int, _purpose text, _exid text, _rpe text, _notes text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  sec jsonb := '{
    "Secondary Squat":    {"2":{"2":60,"3":62.5,"4":65,"5":67.5},"3":{"1":62.5,"2":65,"3":65,"4":62.5},"4":{"1":62.5,"2":65,"3":67.5,"4":70,"5":70},"5":{"1":65,"2":67.5,"3":70,"4":70,"5":72.5},"6":{"1":65,"2":67.5,"3":67.5,"4":65}},
    "Secondary Bench":    {"2":{"2":62.5,"3":65,"4":67.5,"5":70},"3":{"1":65,"2":67.5,"3":67.5,"4":67.5},"4":{"1":65,"2":67.5,"3":70,"4":70,"5":72.5},"5":{"1":67.5,"2":70,"3":72.5,"4":72.5,"5":75},"6":{"1":67.5,"2":70,"3":70,"4":67.5}},
    "Secondary Deadlift": {"2":{"2":60,"3":62.5,"4":65,"5":67.5},"3":{"1":60,"2":62.5,"3":62.5,"4":60},"4":{"1":60,"2":62.5,"3":65,"4":65,"5":67.5},"5":{"1":62.5,"2":65,"3":65,"4":67.5,"5":67.5},"6":{"1":62.5,"2":62.5,"3":62.5,"4":60}}
  }';
  -- a week written as a range: the app loads the low end, the notes give the top
  rng jsonb := '{
    "Secondary Squat":    {"4":{"5":72.5},"5":{"4":72.5}},
    "Secondary Bench":    {"4":{"4":72.5},"5":{"4":75}},
    "Secondary Deadlift": {"4":{"4":67.5},"5":{"3":67.5,"5":70}}
  }';
  -- the coach's caps for Paused Sumo in Block 2 (the template's were lower)
  sumo_rpe jsonb := '{"2":"5","3":"5-6","4":"6","5":"6"}';
  back_pain text := 'Sharp low-back pain getting out of your bench setup (as reported Oct 23)? Stop — don''t push through it. Use a lower-back-friendly setup for the day and flag it for your coach.';
  two_sets text := '1–2 sets: do the 2nd only if the 1st felt at or under target.';
  checkin boolean := _bno IN (3, 6);
  r text; r_cap text;
  lo numeric; hi numeric; pct_txt text; basis_word text; rest text; lift text;
  out_notes text; new_rpe text := _rpe;
BEGIN
  IF _bno < 2 OR _bno > 6 OR (_bno = 2 AND _wk < 2) THEN RETURN NULL; END IF;

  -- primary back-offs: % of today's top set (or single), the RPE a cap
  IF (_purpose = 'Primary Squat Backoff' AND _exid = 'e6ae87a4-29ae-4547-9916-5a61ca507bae')
     OR (_purpose = 'Primary Bench Backoff' AND _exid = '2ccdba15-4237-4123-93be-8e502a0b1b22')
     OR (_purpose = 'Primary Deadlift Backoff' AND _exid = 'c01ef5f7-9d97-4296-939d-306acc5bc1c9') THEN
    lift := split_part(_purpose, ' ', 2);
    r := replace(coalesce(_rpe, '6'), '-', '–');
    r_cap := regexp_replace(coalesce(_rpe, '6'), '^.*-', '');
    basis_word := CASE WHEN checkin THEN 'single' ELSE 'top set' END;
    IF lift = 'Deadlift' THEN
      lo := CASE WHEN checkin THEN 80 ELSE 90 END; hi := CASE WHEN checkin THEN 85 ELSE 92.5 END;
      rest := '6–8 min';
    ELSE
      lo := CASE WHEN checkin THEN 82.5 ELSE 92.5 END; hi := CASE WHEN checkin THEN 87.5 ELSE 95 END;
      rest := CASE WHEN lift = 'Bench' THEN '4–5 min' ELSE '5–7 min' END;
    END IF;
    out_notes := 'Back-offs: ' || lo || '–' || hi || '% of today''s ' || basis_word
      || '. The app works out ' || lo || '% from the weight you log on the ' || basis_word
      || '. RPE cap @' || r_cap || CASE WHEN r <> r_cap THEN ' (aim for @' || r || ')' ELSE '' END
      || ': the cap beats the percentage, so if the first back-off is over @' || r_cap || ', take weight off right away. '
      || CASE WHEN lift = 'Deadlift'
           THEN 'If the ' || basis_word || ' went over its RPE or fatigue is clearly up, go under ' || lo || '%. '
           ELSE 'Only go up toward ' || hi || '% if the ' || basis_word || ' moved well and technique stays the same. ' END
      || 'Rest ' || rest || '.'
      || CASE WHEN position(two_sets IN coalesce(_notes, '')) > 0 THEN ' ' || two_sets ELSE '' END
      || CASE WHEN lift = 'Bench' THEN ' ' || back_pain ELSE '' END;
    RETURN jsonb_build_object('percentage', lo, 'percentage_basis', 'top_set', 'notes', out_notes, 'rpe', _rpe, 'link_top', true);
  END IF;

  -- secondaries: % of a stable Training Max, the RPE a cap
  IF (_purpose = 'Secondary Squat' AND _exid = 'c778e088-c9c5-46a9-832e-7a415cc9acfb')
     OR (_purpose = 'Secondary Bench' AND _exid = '6fe9d279-7f8e-4a17-943a-f7bc54357920')
     OR (_purpose = 'Secondary Deadlift' AND _exid = '32a8e1d3-def5-40ac-90a2-07666297bec4') THEN
    lo := (sec -> _purpose -> _bno::text ->> _wk::text)::numeric;
    IF lo IS NULL THEN RETURN NULL; END IF;
    hi := (rng -> _purpose -> _bno::text ->> _wk::text)::numeric;
    IF _purpose = 'Secondary Deadlift' AND _bno = 2 THEN new_rpe := coalesce(sumo_rpe ->> _wk::text, _rpe); END IF;
    r := replace(coalesce(new_rpe, '6'), '-', '–');
    r_cap := regexp_replace(coalesce(new_rpe, '6'), '^.*-', '');
    pct_txt := CASE WHEN hi IS NULL THEN lo::text ELSE lo || '–' || hi END;
    out_notes := CASE _purpose
        WHEN 'Secondary Squat' THEN 'SECONDARY SQUAT. Upright torso, controlled depth — crisp reps, not a grind. Load: ' || pct_txt || '% of your Competition Squat Training Max'
        WHEN 'Secondary Bench' THEN 'SECONDARY BENCH. Full 2-count pause on the chest, controlled exposure. Load: ' || pct_txt || '% of your Competition Bench Training Max'
        ELSE 'SECONDARY DEADLIFT — technique only. Comp sumo stance and grip, normal wedge and slack pull, pause 1–2 s just off the floor holding position and tension, then finish. Reset every rep. Load: ' || pct_txt || '% of your sumo Training Max (95% of a reliable current competition sumo deadlift e1RM, set by your coach and held for the block; never an old conventional max). No sumo Training Max on file yet? Go by the RPE cap'
      END
      || CASE WHEN hi IS NULL THEN '' ELSE '. The app loads ' || lo || '%; go up to ' || hi || '% only if last week''s sets were crisp and under the cap' END
      || '. RPE cap @' || r_cap || CASE WHEN r <> r_cap THEN ' (aim for @' || r || ')' ELSE '' END
      || ': the cap beats the percentage, so if the first set is over @' || r_cap || ', take weight off. '
      || CASE WHEN _purpose = 'Secondary Deadlift'
           THEN 'It must stay easier than Saturday. Max 2 working sets. Rest 4–5 min.'
           ELSE 'If it feels easier, don''t make a big jump just to make it harder. Rest ' || CASE WHEN _purpose = 'Secondary Squat' THEN '4–5' ELSE '3–4' END || ' min.' END
      || CASE WHEN position(two_sets IN coalesce(_notes, '')) > 0 THEN ' ' || two_sets ELSE '' END
      || CASE WHEN _purpose = 'Secondary Bench' THEN ' ' || back_pain ELSE '' END;
    RETURN jsonb_build_object('percentage', lo, 'percentage_basis', 'training_max', 'notes', out_notes, 'rpe', new_rpe, 'link_top', false);
  END IF;

  RETURN NULL;
END
$f$;

DO $$
DECLARE
  c_client uuid := '3a548c6a-a07c-4832-aa32-92fdfdbe3282';
  c_prep   uuid := '5c15b431-6dd1-4741-94a0-f8b94a5aca4b';
  c_tpl    uuid := 'ba654f72-19f0-4fcd-b726-9a37cec79a22';
  c_from   date := '2026-11-13';
  blk record;
  n_rows int; n_days int; n_max int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = c_client)
     OR NOT EXISTS (SELECT 1 FROM public.pl_templates WHERE id = c_tpl) THEN
    RAISE NOTICE 'jared hybrid loading: client or template not here, skipped';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.program_loading_update_backup WHERE source_table = 'run' AND row_id = 'jared_hybrid_2026_11') THEN
    RAISE NOTICE 'jared hybrid loading: already applied';
    RETURN;
  END IF;

  -- the live rows this changes: untouched workouts in Blocks 2-6
  CREATE TEMP TABLE jl_live ON COMMIT DROP AS
  SELECT r.id, r.day_id, r.exercise_id, r.purpose_label, p.plan
    FROM public.pl_blocks b
    JOIN public.pl_weeks w ON w.block_id = b.id
    JOIN public.pl_days d ON d.week_id = w.id
    JOIN public.pl_exercise_rows r ON r.day_id = d.id
    CROSS JOIN LATERAL (SELECT pg_temp.jl_plan((regexp_match(b.name, '^Block (\d+)'))[1]::int, w.week_index,
                                              r.purpose_label, r.exercise_id::text, r.rpe, r.notes) AS plan) p
   WHERE b.client_id = c_client AND b.prep_id = c_prep AND NOT b.archived
     AND NOT d.archived AND d.deleted_at IS NULL
     AND d.scheduled_date IS NOT NULL
     AND NOT public.pl_day_touched(d.id, d.scheduled_date, c_from)
     AND p.plan IS NOT NULL;

  -- back up first: every row changed, the template as it was, the run marker
  INSERT INTO public.program_loading_update_backup (source_table, row_id, row_data)
  SELECT 'pl_exercise_rows', r.id::text, to_jsonb(r) FROM public.pl_exercise_rows r WHERE r.id IN (SELECT id FROM jl_live)
  UNION ALL
  SELECT 'pl_templates', t.id::text, to_jsonb(t) FROM public.pl_templates t WHERE t.id = c_tpl
  UNION ALL
  SELECT 'pl_client_maxes', m.id::text, to_jsonb(m) FROM public.pl_client_maxes m WHERE m.client_id = c_client;

  UPDATE public.pl_exercise_rows r
     SET percentage = (j.plan ->> 'percentage')::numeric,
         percentage_basis = j.plan ->> 'percentage_basis',
         basis_row_id = CASE WHEN (j.plan ->> 'link_top')::boolean THEN (
             SELECT t.id FROM public.pl_exercise_rows t
              WHERE t.day_id = r.day_id AND t.exercise_id = r.exercise_id
                AND t.purpose_label = replace(r.purpose_label, ' Backoff', '')
                AND t.sort_order < r.sort_order
              ORDER BY t.sort_order DESC LIMIT 1)
           ELSE NULL END,
         rpe = j.plan ->> 'rpe',
         notes = j.plan ->> 'notes',
         manual_override = false,
         override_of_pct = NULL,
         load_kg = NULL,
         load_lb = NULL,
         updated_at = now()
    FROM jl_live j
   WHERE r.id = j.id;
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  SELECT count(DISTINCT day_id) INTO n_days FROM jl_live;

  -- the library template: the same rules from Block 2 Week 2 on
  UPDATE public.pl_templates t
     SET payload = jsonb_set(t.payload, '{blocks}', coalesce((
           SELECT jsonb_agg(
                    CASE WHEN coalesce((regexp_match(b ->> 'name', '^Block (\d+)'))[1]::int, 0) BETWEEN 2 AND 6 THEN
                      jsonb_set(b, '{weeks}', coalesce((
                        SELECT jsonb_agg(
                                 jsonb_set(w, '{days}', coalesce((
                                   SELECT jsonb_agg(
                                            jsonb_set(d, '{rows}', coalesce((
                                              SELECT jsonb_agg(
                                                       CASE WHEN pl.plan IS NULL THEN rr
                                                            ELSE rr || jsonb_build_object(
                                                                   'percentage', (pl.plan ->> 'percentage')::numeric,
                                                                   'percentage_basis', pl.plan ->> 'percentage_basis',
                                                                   'rpe', pl.plan ->> 'rpe',
                                                                   'notes', pl.plan ->> 'notes') END
                                                       ORDER BY ro)
                                                FROM jsonb_array_elements(d -> 'rows') WITH ORDINALITY y(rr, ro)
                                                CROSS JOIN LATERAL (SELECT pg_temp.jl_plan(
                                                    (regexp_match(b ->> 'name', '^Block (\d+)'))[1]::int,
                                                    (w ->> 'week_index')::int, rr ->> 'purpose_label', rr ->> 'exercise_id',
                                                    rr ->> 'rpe', rr ->> 'notes') AS plan) pl), '[]'::jsonb))
                                            ORDER BY dord)
                                     FROM jsonb_array_elements(w -> 'days') WITH ORDINALITY z(d, dord)), '[]'::jsonb))
                                 ORDER BY word)
                          FROM jsonb_array_elements(b -> 'weeks') WITH ORDINALITY q(w, word)), '[]'::jsonb))
                    ELSE b END
                  ORDER BY bord)
             FROM jsonb_array_elements(t.payload -> 'blocks') WITH ORDINALITY x(b, bord)), t.payload -> 'blocks')),
         -- payload_revision moves by its own trigger
         updated_at = now()
   WHERE t.id = c_tpl;

  -- stable references per block (Blocks 2-6): reviewed at block end, never
  -- moved by an e1RM; the variations read their competition lift at 100%
  FOR blk IN
    SELECT id FROM public.pl_blocks
     WHERE client_id = c_client AND prep_id = c_prep AND NOT archived
       AND coalesce((regexp_match(name, '^Block (\d+)'))[1]::int, 0) BETWEEN 2 AND 6
  LOOP
    INSERT INTO public.pl_client_maxes (client_id, block_id, lift, exercise_id, one_rm, training_max, unit, source, tested_at,
                                        source_lift, source_exercise_id, variation_modifier, manual_override, rounding_step, rounding_mode, active, notes)
    SELECT c_client, blk.id, v.lift, v.exid, v.one_rm, v.tm, 'kg', v.src, v.tested, v.source_lift, v.source_exid, v.modifier, false, 2.5, 'nearest', true, v.notes
      FROM (VALUES
        ('Competition Squat', 'e6ae87a4-29ae-4547-9916-5a61ca507bae'::uuid, 235::numeric, 235::numeric, 'tested', '2026-09-20'::date, NULL::text, NULL::uuid, NULL::numeric,
         'Training Max for this block: 235 kg, the Sep 20 2026 meet squat. High Bar Squat loads from it. Held for the block, reviewed at its end, never moved by an e1RM.'),
        ('Competition Bench Press', NULL::uuid, 150::numeric, 150::numeric, 'tested', '2026-09-20'::date, NULL::text, NULL::uuid, NULL::numeric,
         'Training Max for this block: 150 kg, the Sep 20 2026 meet bench. 2ct Paused Bench loads from it. Held for the block, reviewed at its end, never moved by an e1RM.'),
        ('High Bar Squat', 'c778e088-c9c5-46a9-832e-7a415cc9acfb'::uuid, NULL::numeric, NULL::numeric, 'manual', NULL::date, 'Competition Squat', 'e6ae87a4-29ae-4547-9916-5a61ca507bae'::uuid, 100::numeric,
         'Loads from the Competition Squat Training Max (100%).'),
        ('2-Count Pause Bench Press', '6fe9d279-7f8e-4a17-943a-f7bc54357920'::uuid, NULL::numeric, NULL::numeric, 'manual', NULL::date, 'Competition Bench Press', NULL::uuid, 100::numeric,
         'Loads from the Competition Bench Training Max (100%).')
      ) AS v(lift, exid, one_rm, tm, src, tested, source_lift, source_exid, modifier, notes)
     WHERE NOT EXISTS (SELECT 1 FROM public.pl_client_maxes m
                        WHERE m.client_id = c_client AND m.block_id = blk.id AND lower(m.lift) = lower(v.lift));
    n_max := n_max + 1;
  END LOOP;

  INSERT INTO public.program_loading_update_backup (source_table, row_id, row_data)
  VALUES ('run', 'jared_hybrid_2026_11', jsonb_build_object('rows', n_rows, 'days', n_days, 'blocks_with_maxes', n_max, 'from', c_from));
  RAISE NOTICE 'jared hybrid loading: % rows on % workouts, maxes on % blocks', n_rows, n_days, n_max;
END
$$;
