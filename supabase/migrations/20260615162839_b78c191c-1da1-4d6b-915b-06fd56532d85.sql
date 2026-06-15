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
BEGIN
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

    -- Resolve the acting coach id (if the actor is a coach). If the actor is
    -- the client themselves, this stays NULL — tasks.created_by FKs to
    -- coaches(id), so we must not pass auth.uid() (a user_id) directly.
    SELECT co.id INTO actor_coach_id
    FROM public.coaches co
    WHERE co.user_id = auth.uid()
    LIMIT 1;

    IF client_row.assigned_coach_id IS NOT NULL THEN
      notify_summary := 'Goals & Setup updated for ' || COALESCE(client_row.full_name,'client')
        || ' — ' || array_to_string(changed, ', ');
      INSERT INTO public.tasks (title, notes, quadrant, status, scope, assigned_to, created_by)
      VALUES (
        notify_summary,
        'Client updated their Goals & Setup. Review and adjust their plan if needed.',
        'do',
        'open',
        'admin',
        client_row.assigned_coach_id,
        actor_coach_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;