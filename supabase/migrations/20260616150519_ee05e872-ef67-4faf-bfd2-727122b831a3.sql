-- 1) Dedupe coach notifications + scrub stale conditional details
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
  updated_existing int := 0;
BEGIN
  -- Scrub conditional details so coaches never see stale text after a "No" answer.
  IF NEW.food_restrictions_has IS DISTINCT FROM true THEN
    NEW.food_restrictions_details := NULL;
  END IF;
  IF NEW.injuries_has IS DISTINCT FROM true THEN
    NEW.injuries_details := NULL;
  END IF;

  -- When the client marks setup complete, clear any pending "please update" banner.
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

      -- Dedupe: refresh the existing open task if one was created in the last 24h.
      UPDATE public.tasks
      SET title = notify_summary,
          updated_at = now()
      WHERE assigned_to = client_row.assigned_coach_id
        AND scope = 'admin'
        AND status = 'open'
        AND notes = notify_notes
        AND created_at > now() - interval '24 hours';
      GET DIAGNOSTICS updated_existing = ROW_COUNT;

      IF updated_existing = 0 THEN
        INSERT INTO public.tasks (title, notes, quadrant, status, scope, assigned_to, created_by)
        VALUES (
          notify_summary,
          notify_notes,
          'do',
          'open',
          'admin',
          client_row.assigned_coach_id,
          actor_coach_id
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- The trigger now scrubs / clears fields, so it must run BEFORE the row is written.
DROP TRIGGER IF EXISTS trg_cgs_audit_and_notify ON public.client_goals_setup;
CREATE TRIGGER trg_cgs_audit_and_notify
BEFORE INSERT OR UPDATE ON public.client_goals_setup
FOR EACH ROW EXECUTE FUNCTION public.cgs_audit_and_notify();