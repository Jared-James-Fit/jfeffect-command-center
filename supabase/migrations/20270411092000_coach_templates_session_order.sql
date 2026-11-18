-- The coach's own library templates (Apex, Girl Pop) get the same session-order fixes made to the client
-- programs copied from them on Nov 18 2026 (20270411090000_accessory_flow_live_programs.sql):
--   * Apex 5-Day Day 5, Apex 4-Day Day 4, Apex Glute Specialization Day 3: the two lying leg curl slots were
--     split by the split squats (or the back extension), a walk back to the same machine; the compound now
--     comes first and both curls are done back to back on one machine;
--   * Girl Pop Day 2 (Upper Body + Glute Pump): cable, dumbbells, cable, dumbbells, cable, dumbbells became
--     the cable pulls together, the dumbbell work together, then the pushdown and kickbacks on the cable.
-- Only the order changes (no exercise, set, rep or load), only while a template is still exactly as read
-- (md5 of its payload), it's backed up first in public.template_flow_backup, and the result is checked
-- (every row of a changed session is one the plan names, in the planned order) or the migration rolls back.
-- Copies already running for clients are their own (handled in the client migration). Re-running does nothing.

CREATE TABLE IF NOT EXISTS public.template_flow_backup (
  id bigserial PRIMARY KEY,
  batch text NOT NULL,
  template_id uuid NOT NULL,
  plan_id uuid,
  payload jsonb,
  published_payload jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.template_flow_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.template_flow_backup FROM anon, authenticated;

-- An exercise row's name as the template shows it.
CREATE OR REPLACE FUNCTION pg_temp.row_name(_r jsonb) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce((SELECT e.name FROM public.exercises e WHERE e.id::text = _r->>'exercise_id'), _r->>'exercise_name_override', _r->>'exercise_name')
$f$;

-- The named sessions' rows put in the given name order (rows with the same name keep their order), renumbered.
CREATE OR REPLACE FUNCTION pg_temp.order_by_names(_payload jsonb, _orders jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_set(_payload, '{blocks_data}', coalesce((
    SELECT jsonb_agg(b || jsonb_build_object('weeks_data', coalesce((
      SELECT jsonb_agg(w || jsonb_build_object('days', coalesce((
        SELECT jsonb_agg(CASE WHEN _orders ? (d->>'title') THEN d || jsonb_build_object('rows', (
            SELECT jsonb_agg(x.r || jsonb_build_object('sort_order', x.n - 1) ORDER BY x.n)
              FROM (SELECT r, row_number() OVER (ORDER BY coalesce((SELECT min(o.i) FROM jsonb_array_elements_text(_orders->(d->>'title')) WITH ORDINALITY o(e, i) WHERE o.e = pg_temp.row_name(r)), 1000), ro) n
                      FROM jsonb_array_elements(d->'rows') WITH ORDINALITY q(r, ro)) x))
          ELSE d END ORDER BY dord)
        FROM jsonb_array_elements(w->'days') WITH ORDINALITY dd(d, dord)), '[]'::jsonb)) ORDER BY word)
      FROM jsonb_array_elements(b->'weeks_data') WITH ORDINALITY ww(w, word)), '[]'::jsonb)) ORDER BY bord)
    FROM jsonb_array_elements(_payload->'blocks_data') WITH ORDINALITY bb(b, bord)), '[]'::jsonb))
$f$;

-- Every row of every named session is named in the plan and sits in the planned order.
CREATE OR REPLACE FUNCTION pg_temp.order_ok(_payload jsonb, _orders jsonb) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT coalesce(bool_and(ok), true) FROM (
    SELECT (SELECT bool_and(pos IS NOT NULL) AND coalesce(bool_and(pos >= prev), true)
              FROM (SELECT pos, lag(pos, 1, 0) OVER (ORDER BY ro) prev
                      FROM (SELECT ro, (SELECT min(o.i) FROM jsonb_array_elements_text(_orders->(d->>'title')) WITH ORDINALITY o(e, i) WHERE o.e = pg_temp.row_name(r)) pos
                              FROM jsonb_array_elements(d->'rows') WITH ORDINALITY q(r, ro)) a) z) ok
      FROM jsonb_array_elements(_payload->'blocks_data') b, jsonb_array_elements(b->'weeks_data') w, jsonb_array_elements(w->'days') d
     WHERE _orders ? (d->>'title')) s
$f$;

CREATE OR REPLACE FUNCTION pg_temp.reorder_template(_id uuid, _md5 text, _orders jsonb) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE _n int;
BEGIN
  INSERT INTO public.template_flow_backup (batch, template_id, payload, notes)
  SELECT 'coach_templates_session_order_2026_11_18', t.id, t.payload, t.notes
    FROM public.pl_templates t WHERE t.id = _id AND md5(t.payload::text) = _md5;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RETURN; END IF;
  UPDATE public.pl_templates SET payload = pg_temp.order_by_names(payload, _orders), payload_revision = coalesce(payload_revision, 0) + 1 WHERE id = _id;
  IF NOT (SELECT pg_temp.order_ok(payload, _orders) FROM public.pl_templates WHERE id = _id) THEN
    RAISE EXCEPTION 'session order: template % did not come out in the planned order', _id;
  END IF;
END
$f$;

-- Apex Hypertrophy System, Elite, 5-Day: Day 5
SELECT pg_temp.reorder_template('9716e074-b4e5-4f79-9e8e-d79f18123fe5', 'bfe4b09b2cf3e533804d36c9cd0799a6', jsonb_build_object(
  'Day 5 — Posterior Chain and Glutes', '["Romanian Deadlift","Hip Thrust - Barbell","Bulgarian Split Squats","Lying Hamstring Curl - Machine","Abduction Machine","Seated Calf Raise"]'::jsonb,
  'Day 5 — Posterior Overload', '["Romanian Deadlift","Hip Thrust - Barbell","Bulgarian Split Squats","Lying Hamstring Curl - Machine","Abduction Machine","Seated Calf Raise"]'::jsonb,
  'Day 5 — Posterior Chain Intensification', '["Romanian Deadlift","Hip Thrust - Barbell","Bulgarian Split Squats","Lying Hamstring Curl - Machine","Abduction Machine","Seated Calf Raise"]'::jsonb));

-- Apex Hypertrophy, Advanced–Elite, 4-Day: Day 4
SELECT pg_temp.reorder_template('8040462e-2900-4d8f-a217-64cbac6b49a3', '5c889d056063985cd78c07efb4fdd54b', jsonb_build_object(
  'Day 4 — Posterior Chain, Glutes and Chest', '["Romanian Deadlift","Hip Thrust - Barbell","Incline Dumbbell Press","Bulgarian Split Squats","Lying Hamstring Curl - Machine","Abduction Machine","Seated Calf Raise"]'::jsonb,
  'Day 4 — Posterior Overload', '["Romanian Deadlift","Hip Thrust - Barbell","Incline Dumbbell Press","Bulgarian Split Squats","Lying Hamstring Curl - Machine","Abduction Machine","Seated Calf Raise"]'::jsonb,
  'Day 4 — Posterior Chain and Chest Intensification', '["Romanian Deadlift","Hip Thrust - Barbell","Incline Dumbbell Press","Bulgarian Split Squats","Lying Hamstring Curl - Machine","Abduction Machine","Seated Calf Raise"]'::jsonb));

-- Apex Glute Specialization, Advanced–Elite, 4-Day: Day 3
SELECT pg_temp.reorder_template('f9f7b059-bfd1-4692-b550-30450456f3b7', '86b50f394b49d4209a9267c202e0aa5c', jsonb_build_object(
  'Day 3 — Lengthened Glutes and Hamstrings', '["Romanian Deadlift","Bulgarian Split Squats","45-Degree Back Extension","Lying Hamstring Curl - Machine","Seated Calf Raise","Pallof Press"]'::jsonb,
  'Day 3 — Lengthened Glute Overload', '["Romanian Deadlift","Bulgarian Split Squats","45-Degree Back Extension","Lying Hamstring Curl - Machine","Seated Calf Raise","Pallof Press"]'::jsonb,
  'Day 3 — Lengthened Glute Intensification', '["Romanian Deadlift","Bulgarian Split Squats","45-Degree Back Extension","Lying Hamstring Curl - Machine","Seated Calf Raise","Pallof Press"]'::jsonb));

-- Girl Pop Lower Body Build: Day 2 (each block's own exercises, one order for all of them)
SELECT pg_temp.reorder_template('bb346639-7090-4917-97b0-98d1c417b68f', 'e41a39d86f555cc5fa2656a7ddda42ee', jsonb_build_object(
  'Day 2 — Upper Body + Glute Pump', '["Wide-Grip Lat Pulldown","Seated Cable Row V Bar Machine","Incline Dumbbell Press","Chest Supported Row","Lateral Raises Dumbbell","Dumbbell Curl","Cable Triceps Pushdown","Cable Individual Glute Kickbacks","Abduction Machine"]'::jsonb));
