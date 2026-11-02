-- Goals & Setup's "days a week" and "which days" follow the program schedule.
--
-- `clients.committed_training_days` is the one schedule (every workout is
-- dated by it). Goals & Setup's `training_days_per_week` is always its number
-- of days and `available_weekdays` always includes those days (plus any other
-- days the person said they could train). Saving Goals & Setup with new days
-- writes the schedule in the app (`saveGoalsSetupFn`, which also moves upcoming
-- workouts); any change to the schedule from anywhere else (the Training
-- Schedule card, the Workouts chip, starting a plan, the coach's Training tab)
-- is mirrored here. The mirror is audited like any edit but never raises the
-- coach's "Goals & Setup updated" task: nobody changed their goals.

-- "mon" codes they're available on, plus the schedule's "Monday" names, as
-- Goals' codes in week order.
CREATE OR REPLACE FUNCTION public.goals_weekdays_with_schedule(p_available text[], p_days text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(w.code ORDER BY w.ord), '{}'::text[])
  FROM unnest(
    ARRAY['mon','tue','wed','thu','fri','sat','sun'],
    ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
  ) WITH ORDINALITY AS w(code, long_name, ord)
  WHERE w.code = ANY (coalesce(p_available, '{}'::text[]))
     OR w.long_name = ANY (coalesce(p_days, '{}'::text[]));
$$;

-- The schedule's valid days, de-duplicated, Monday first.
CREATE OR REPLACE FUNCTION public.schedule_days_in_order(p_days text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(w.long_name ORDER BY w.ord), '{}'::text[])
  FROM unnest(
    ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
  ) WITH ORDINALITY AS w(long_name, ord)
  WHERE w.long_name = ANY (coalesce(p_days, '{}'::text[]));
$$;

-- Goals & Setup's audit + coach task, unchanged except that a mirror of the
-- schedule (jf.goals_schedule_sync) doesn't notify.
CREATE OR REPLACE FUNCTION public.cgs_audit_and_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed text[] := '{}'::text[];
  notify_fields text[] := ARRAY[
    'main_goal','main_goal_other','goal_target',
    'training_days_per_week','available_weekdays','workout_length_minutes',
    'training_location','equipment','equipment_by_location',
    'injuries_has','injuries_details',
    'nutrition_goal','food_restrictions_has','food_restrictions_details'
  ];
  should_notify boolean := false;
  client_row record;
  actor_coach_id uuid;
  notify_summary text;
  notify_notes constant text := 'Client updated their Goals & Setup. Review and adjust their plan if needed.';
  v_source_key text;
BEGIN
  IF NEW.food_restrictions_has IS DISTINCT FROM true THEN
    NEW.food_restrictions_details := NULL;
  END IF;
  IF NEW.injuries_has IS DISTINCT FROM true THEN
    NEW.injuries_details := NULL;
  END IF;

  IF NEW.completed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.completed_at IS NULL) THEN
    NEW.update_requested_at := NULL;
    NEW.update_requested_by := NULL;
    NEW.update_request_message := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    changed := ARRAY['(created)'];
    should_notify := true;
  ELSE
    IF NEW.main_goal IS DISTINCT FROM OLD.main_goal THEN changed := array_append(changed,'main_goal'); END IF;
    IF NEW.main_goal_other IS DISTINCT FROM OLD.main_goal_other THEN changed := array_append(changed,'main_goal_other'); END IF;
    IF NEW.goal_target IS DISTINCT FROM OLD.goal_target THEN changed := array_append(changed,'goal_target'); END IF;
    IF NEW.training_days_per_week IS DISTINCT FROM OLD.training_days_per_week THEN changed := array_append(changed,'training_days_per_week'); END IF;
    IF NEW.available_weekdays IS DISTINCT FROM OLD.available_weekdays THEN changed := array_append(changed,'available_weekdays'); END IF;
    IF NEW.workout_length_minutes IS DISTINCT FROM OLD.workout_length_minutes THEN changed := array_append(changed,'workout_length_minutes'); END IF;
    IF NEW.training_experience IS DISTINCT FROM OLD.training_experience THEN changed := array_append(changed,'training_experience'); END IF;
    IF NEW.training_styles IS DISTINCT FROM OLD.training_styles THEN changed := array_append(changed,'training_styles'); END IF;
    IF NEW.training_location IS DISTINCT FROM OLD.training_location THEN changed := array_append(changed,'training_location'); END IF;
    IF NEW.equipment IS DISTINCT FROM OLD.equipment THEN changed := array_append(changed,'equipment'); END IF;
    IF NEW.equipment_by_location IS DISTINCT FROM OLD.equipment_by_location THEN changed := array_append(changed,'equipment_by_location'); END IF;
    IF NEW.nutrition_goal IS DISTINCT FROM OLD.nutrition_goal THEN changed := array_append(changed,'nutrition_goal'); END IF;
    IF NEW.nutrition_preference IS DISTINCT FROM OLD.nutrition_preference THEN changed := array_append(changed,'nutrition_preference'); END IF;
    IF NEW.food_restrictions_has IS DISTINCT FROM OLD.food_restrictions_has THEN changed := array_append(changed,'food_restrictions_has'); END IF;
    IF NEW.food_restrictions_details IS DISTINCT FROM OLD.food_restrictions_details THEN changed := array_append(changed,'food_restrictions_details'); END IF;
    IF NEW.nutrition_challenges IS DISTINCT FROM OLD.nutrition_challenges THEN changed := array_append(changed,'nutrition_challenges'); END IF;
    IF NEW.injuries_has IS DISTINCT FROM OLD.injuries_has THEN changed := array_append(changed,'injuries_has'); END IF;
    IF NEW.injuries_details IS DISTINCT FROM OLD.injuries_details THEN changed := array_append(changed,'injuries_details'); END IF;
    IF NEW.final_notes IS DISTINCT FROM OLD.final_notes THEN changed := array_append(changed,'final_notes'); END IF;
    should_notify := changed && notify_fields;
  END IF;

  -- The program schedule moved and Goals & Setup is only following it
  -- (clients_sync_committed_days_to_goals): kept in the audit, no coach task.
  IF coalesce(current_setting('jf.goals_schedule_sync', true), 'off') = 'on' THEN
    should_notify := false;
  END IF;

  IF array_length(changed,1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.client_goals_setup_audit (client_id, changed_by, changed_fields, before, after)
  VALUES (
    NEW.client_id,
    auth.uid(),
    changed,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW)
  );

  IF should_notify THEN
    SELECT c.id AS client_id, c.full_name, c.assigned_coach_id
      INTO client_row
    FROM public.clients c
    WHERE c.id = NEW.client_id;

    SELECT co.id INTO actor_coach_id
    FROM public.coaches co
    WHERE co.user_id = auth.uid()
    LIMIT 1;

    IF client_row.assigned_coach_id IS NOT NULL THEN
      notify_summary := 'Goals & Setup updated for ' || COALESCE(client_row.full_name,'client')
        || ' — ' || array_to_string(changed, ', ');

      -- One task per client for the "created" event, ever.
      -- One task per client per day for edit summaries.
      IF TG_OP = 'INSERT' THEN
        v_source_key := 'cgs:created:' || NEW.client_id::text;
      ELSE
        v_source_key := 'cgs:updated:' || NEW.client_id::text || ':'
          || to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD');
      END IF;

      INSERT INTO public.tasks (title, notes, quadrant, status, scope, assigned_to, created_by, source_key)
      VALUES (
        notify_summary, notify_notes, 'do', 'open', 'admin',
        client_row.assigned_coach_id, actor_coach_id, v_source_key
      )
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL
      DO UPDATE SET title = EXCLUDED.title, updated_at = now()
      WHERE public.tasks.status = 'open';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Any change to the committed schedule is mirrored onto Goals & Setup.
CREATE OR REPLACE FUNCTION public.clients_sync_committed_days_to_goals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_days text[] := public.schedule_days_in_order(NEW.committed_training_days);
BEGIN
  IF cardinality(v_days) = 0 THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('jf.goals_schedule_sync', 'on', true);
  UPDATE public.client_goals_setup g
     SET training_days_per_week = cardinality(v_days),
         available_weekdays = public.goals_weekdays_with_schedule(g.available_weekdays, v_days)
   WHERE g.client_id = NEW.id
     AND (g.training_days_per_week IS DISTINCT FROM cardinality(v_days)
          OR g.available_weekdays IS DISTINCT FROM public.goals_weekdays_with_schedule(g.available_weekdays, v_days));
  PERFORM set_config('jf.goals_schedule_sync', 'off', true);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS clients_sync_committed_days_to_goals ON public.clients;
CREATE TRIGGER clients_sync_committed_days_to_goals
  AFTER UPDATE OF committed_training_days ON public.clients
  FOR EACH ROW
  WHEN (NEW.committed_training_days IS DISTINCT FROM OLD.committed_training_days)
  EXECUTE FUNCTION public.clients_sync_committed_days_to_goals();

REVOKE ALL ON FUNCTION public.clients_sync_committed_days_to_goals() FROM PUBLIC, anon, authenticated;

-- Bring every existing Goals & Setup row in line with its schedule (the
-- schedule is what the program runs on; earlier answers stay in
-- client_goals_setup_audit). One statement, so the no-notify flag holds.
DO $$
BEGIN
  PERFORM set_config('jf.goals_schedule_sync', 'on', true);
  UPDATE public.client_goals_setup g
     SET training_days_per_week = cardinality(s.days),
         available_weekdays = public.goals_weekdays_with_schedule(g.available_weekdays, s.days)
    FROM (
      SELECT c.id, public.schedule_days_in_order(c.committed_training_days) AS days
        FROM public.clients c
    ) s
   WHERE s.id = g.client_id
     AND cardinality(s.days) > 0
     AND (g.training_days_per_week IS DISTINCT FROM cardinality(s.days)
          OR g.available_weekdays IS DISTINCT FROM public.goals_weekdays_with_schedule(g.available_weekdays, s.days));
  PERFORM set_config('jf.goals_schedule_sync', 'off', true);
END
$$;
