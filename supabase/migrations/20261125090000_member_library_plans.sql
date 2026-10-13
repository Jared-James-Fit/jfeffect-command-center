-- Membership + Coaching unification, Phase 2: one program system.
--
-- A JF member's "Start plan" runs the same assign engine a coach uses
-- (pl_assign_template_to_client): the library plan's template is copied into
-- the member's own program (pl_blocks), so the logger, PRs, analytics and
-- history work with no member-only code. member_plans stays as the library
-- listing (title, cover, audience); its frozen published_payload is only a
-- preview now.

-- Who may start a library plan on a client row: the member themselves, on
-- their own self-serve row, with an active membership, for a template that
-- backs a live, published library plan. (Coaches and admins keep their own
-- rule; coaching clients don't start plans: their coach writes the program.)
CREATE OR REPLACE FUNCTION public.member_can_start_plan(p_client_id uuid, p_template_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.clients c
            WHERE c.id = p_client_id
              AND c.user_id = (SELECT auth.uid())
              AND c.service_tier = 'self_serve'
              AND coalesce(c.archived, false) = false)
     AND public.member_can_consume((SELECT auth.uid()))
     AND EXISTS (
           SELECT 1 FROM public.member_plans p
            WHERE p.source_template_id = p_template_id
              AND p.status = 'Published'
              AND p.membership_status = 'live');
$$;
REVOKE ALL ON FUNCTION public.member_can_start_plan(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The assign engine gains that one extra caller; everything else is unchanged.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.pl_assign_template_to_client(uuid,uuid,jsonb,text,boolean,date,date,text[],text)'::regprocedure);
  v_anchor text := 'IF NOT (public.has_role(auth.uid(), ''admin''::app_role) OR public.is_assigned_coach(p_client_id)) THEN';
  v_new text := 'IF NOT (public.has_role(auth.uid(), ''admin''::app_role) OR public.is_assigned_coach(p_client_id) OR public.member_can_start_plan(p_client_id, p_template_id)) THEN';
BEGIN
  IF position('member_can_start_plan' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'pl_assign_template_to_client: auth anchor not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_new);
END $$;

-- Link the membership templates' exercises to the library, so members get
-- demo videos, cues and exercise history. Only rows with no exercise yet; the
-- name on the plan stays exactly as written. Names the library already knows
-- resolve as usual; the rest use this hand-checked map (only inside these
-- templates: no global alias, so a coach's own free-typed names are never
-- re-pointed). Names with no honest match (Glute Ham Raise, Lying Leg Curl,
-- T-Bar Row) stay unlinked.
CREATE OR REPLACE FUNCTION pg_temp.member_plan_exercise_id(_name text)
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT e.id FROM public.exercises e
      WHERE NOT e.archived AND e.name = (
        SELECT target FROM (VALUES
          ('Ab Crunch Machine', 'Abdominal Crunches Machine'),
          ('Assisted Dip Machine', 'Triceps Dip Machine'),
          ('Assisted Pull-Up or Lat Pulldown', 'Assisted Pull Up'),
          ('Back Squat', 'High Bar Squat'),
          ('Bayesian Cable Curl', 'Cable Curl'),
          ('Bench Press', 'Barbell Bench Press'),
          ('Cable Crunch', 'High Cable Kneeling Crunch'),
          ('Cable Lateral Raise', 'Cable Lateral Raises'),
          ('Cable Pressdown', 'Cable Triceps Pushdown'),
          ('Cable Triceps Pressdown', 'Cable Triceps Pushdown'),
          ('Chest-Supported Machine Row', 'Machine Row'),
          ('Chest-Supported T-Bar Row', 'Chest Supported Row'),
          ('Competition-Style Squat', 'Competition Squat'),
          ('Converging Chest Press', 'Chest Press Machine'),
          ('Cross-Body Cable Triceps Extension', 'Cable Alternate Triceps Extension'),
          ('Deadlift', 'Barbell Deadlift'),
          ('Dumbbell Lateral Raise', 'Lateral Raises Dumbbell'),
          ('Flat Dumbbell Press', 'Dumbbell Chest Press Flat'),
          ('Front Squat', 'Barbell Front Squats'),
          ('Hammer Curl', 'Dumbbell Hammer Curl'),
          ('High-Bar Back Squat', 'High Bar Squat'),
          ('Incline Bench Press', 'Barbell Incline Bench Press'),
          ('Incline Machine Chest Press', 'Machine Chest Press Incline'),
          ('Lat Pulldown', 'Wide-Grip Lat Pulldown'),
          ('Leg Extension', 'Leg Extension - Machine'),
          ('Machine Pec Deck', 'Pec Deck Fly Machine Flies'),
          ('Machine Preacher Curl', 'Machine Biceps Curl'),
          ('Machine Triceps Extension', 'Tricep Extension Machine'),
          ('Neutral-Grip Lat Pulldown', 'Cable Twin Handle Parallel Grip Lat Pulldown'),
          ('One-Arm Cable Row', 'Cable Seated One Arm Alternate Row'),
          ('One-Arm Lat Pulldown', 'Cable One Arm Lat Pulldown'),
          ('One-Arm Machine Row', 'Machine Row'),
          ('Overhead Press', 'Barbell Shoulder Press - Standing'),
          ('Overhead Triceps Extension', 'Dumbbell Standing Triceps Extension'),
          ('Rear-Delt Fly', 'Rear Delt Cable Fly'),
          ('Rear-Delt Row', 'Dumbbell Rear Delt Row'),
          ('Rope Triceps Pressdown', 'Tricep Rope Extension On Crossover Machine'),
          ('Seated Cable Row', 'Cable Seated Row'),
          ('Seated Dumbbell Shoulder Press', 'Seated Shoulder Press - Dumbbell'),
          ('Seated Leg Curl', 'Seated Leg Curl Machine'),
          ('Seated Smith Machine Shoulder Press', 'Smith Machine Shoulder Press'),
          ('Skullcrusher', 'Barbell Lying Triceps Skull Crushers'),
          ('Standing Calf Raise', 'Standing Calf Raise - Machine'),
          ('Weighted Pull-Up or Lat Pulldown', 'Weighted Pull-Up')
        ) AS m(name, target) WHERE m.name = _name)
      LIMIT 1),
    public.resolve_exercise_id(_name));
$$;

-- Templates come in a few shapes (blocks / blocks_data, weeks / weeks_data);
-- walk them all and fill every exercise row ("rows" arrays) the same way.
CREATE OR REPLACE FUNCTION pg_temp.member_plan_link(j jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  k text;
  v jsonb;
  e jsonb;
  arr jsonb;
  nm text;
  xid uuid;
  out jsonb;
BEGIN
  IF j IS NULL THEN
    RETURN NULL;
  ELSIF jsonb_typeof(j) = 'array' THEN
    SELECT coalesce(jsonb_agg(pg_temp.member_plan_link(x) ORDER BY o), '[]'::jsonb) INTO out
      FROM jsonb_array_elements(j) WITH ORDINALITY AS t(x, o);
    RETURN out;
  ELSIF jsonb_typeof(j) <> 'object' THEN
    RETURN j;
  END IF;
  out := '{}'::jsonb;
  FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
    IF k = 'rows' AND jsonb_typeof(v) = 'array' THEN
      arr := '[]'::jsonb;
      FOR e IN SELECT x FROM jsonb_array_elements(v) WITH ORDINALITY AS t(x, o) ORDER BY o LOOP
        IF jsonb_typeof(e) = 'object' AND nullif(e ->> 'exercise_id', '') IS NULL THEN
          nm := coalesce(nullif(e ->> 'exercise_name_override', ''), nullif(e ->> 'title', ''), nullif(e ->> 'name', ''), nullif(e ->> 'exercise_name', ''));
          xid := CASE WHEN nm IS NULL THEN NULL ELSE pg_temp.member_plan_exercise_id(nm) END;
          IF xid IS NOT NULL THEN
            e := jsonb_set(e, '{exercise_id}', to_jsonb(xid::text));
          END IF;
        END IF;
        arr := arr || jsonb_build_array(e);
      END LOOP;
      out := out || jsonb_build_object(k, arr);
    ELSE
      out := out || jsonb_build_object(k, pg_temp.member_plan_link(v));
    END IF;
  END LOOP;
  RETURN out;
END $$;

DO $$
DECLARE
  t record;
  v_new jsonb;
  v_rev int;
BEGIN
  FOR t IN
    SELECT tp.id, tp.payload, tp.payload_revision FROM public.pl_templates tp
     WHERE tp.id IN (SELECT source_template_id FROM public.member_plans WHERE source_template_id IS NOT NULL)
  LOOP
    v_new := pg_temp.member_plan_link(t.payload);
    CONTINUE WHEN v_new IS NOT DISTINCT FROM t.payload;
    UPDATE public.pl_templates SET payload = v_new WHERE id = t.id RETURNING payload_revision INTO v_rev;
    -- a plan that was up to date with its template stays up to date (same
    -- program, now with links), so the admin isn't shown a fake "Update Available"
    UPDATE public.member_plans mp
       SET published_payload = pg_temp.member_plan_link(mp.published_payload),
           last_published_version = v_rev
     WHERE mp.source_template_id = t.id
       AND mp.last_published_version = t.payload_revision;
  END LOOP;
END $$;
