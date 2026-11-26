-- Existing published nutrition plan edits must be atomic, and retain the exact
-- prior prescription. This is an additive, staff-only history; no existing
-- rows are changed or guessed during migration.
CREATE TABLE IF NOT EXISTS public.nutrition_plan_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prior_updated_at timestamptz,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('coach','cleo','undo')),
  snapshot jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS nutrition_plan_revisions_client_at_idx
  ON public.nutrition_plan_revisions(client_id, captured_at DESC);
ALTER TABLE public.nutrition_plan_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read nutrition revisions" ON public.nutrition_plan_revisions;
CREATE POLICY "Staff read nutrition revisions" ON public.nutrition_plan_revisions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));
REVOKE ALL ON public.nutrition_plan_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nutrition_plan_revisions TO authenticated;
GRANT SELECT ON public.nutrition_plan_revisions TO service_role;

-- A single transaction checks the expected version, records the old state,
-- writes the plan metadata and replaces all day rows. If any insert or update
-- fails, the original plan and the history remain unchanged.
CREATE OR REPLACE FUNCTION public.update_nutrition_plan_revision(
  _target_id uuid,
  _client_id uuid,
  _expected_updated_at timestamptz,
  _patch jsonb,
  _days jsonb,
  _source text DEFAULT 'coach',
  _actor_id uuid DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  old_plan public.nutrition_targets%ROWTYPE;
  new_plan public.nutrition_targets%ROWTYPE;
  prior_days jsonb;
  written_at timestamptz := clock_timestamp();
  actor uuid;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    actor := _actor_id;
  ELSE
    IF auth.uid() IS NULL OR NOT (
      coalesce(public.has_role(auth.uid(), 'admin'), false)
      OR EXISTS (SELECT 1 FROM public.coached_client_ids() AS c(id) WHERE c.id = _client_id)
    ) THEN
      RAISE EXCEPTION 'Coach access required' USING ERRCODE = '42501';
    END IF;
    actor := auth.uid();
    IF _source <> 'coach' THEN
      RAISE EXCEPTION 'Invalid revision source' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _source NOT IN ('coach','cleo','undo') THEN RAISE EXCEPTION 'Invalid revision source'; END IF;
  IF jsonb_typeof(_patch) IS DISTINCT FROM 'object' OR jsonb_typeof(_days) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid nutrition plan payload';
  END IF;
  IF jsonb_array_length(_days) > 100 THEN RAISE EXCEPTION 'Too many nutrition day types'; END IF;
  IF _patch ? 'client_id' AND (_patch->>'client_id')::uuid IS DISTINCT FROM _client_id THEN
    RAISE EXCEPTION 'Cannot move a plan to another client';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_client_id::text, 0));
  SELECT * INTO old_plan FROM public.nutrition_targets
  WHERE id = _target_id AND client_id = _client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nutrition plan not found'; END IF;
  IF old_plan.status = 'Archived' THEN RAISE EXCEPTION 'Historical plans are read-only. Copy this plan into a new draft.'; END IF;
  IF coalesce(old_plan.last_updated_at, old_plan.updated_at) IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'The plan changed since it was opened. Reopen it and try again.' USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.sort_order, d.id), '[]'::jsonb)
    INTO prior_days FROM public.nutrition_target_days d WHERE d.target_id = _target_id;
  INSERT INTO public.nutrition_plan_revisions(client_id, plan_id, captured_at, prior_updated_at, actor_id, source, snapshot)
    VALUES (_client_id, _target_id, written_at, coalesce(old_plan.last_updated_at, old_plan.updated_at), actor, _source,
      to_jsonb(old_plan) || jsonb_build_object('nutrition_target_days', prior_days));

  new_plan := jsonb_populate_record(old_plan, _patch);
  IF new_plan.start_date IS NOT NULL AND new_plan.end_date IS NOT NULL AND new_plan.end_date < new_plan.start_date THEN
    RAISE EXCEPTION 'Plan end must not precede its start';
  END IF;
  IF new_plan.status <> 'Archived' AND new_plan.start_date IS DISTINCT FROM old_plan.start_date AND new_plan.start_date >
    (SELECT (now() AT TIME ZONE coalesce(nullif(timezone,''),'America/Winnipeg'))::date FROM public.clients WHERE id=_client_id)
    THEN RAISE EXCEPTION 'Future plans require scheduling; the current plan was not changed'; END IF;
  UPDATE public.nutrition_targets SET
    phase = new_plan.phase, custom_phase = new_plan.custom_phase,
    goal = new_plan.goal, custom_goal = new_plan.custom_goal,
    structure = new_plan.structure, start_date = new_plan.start_date,
    end_date = new_plan.end_date, status = new_plan.status,
    ending_soon_days = new_plan.ending_soon_days,
    client_notes = new_plan.client_notes, food_weighing_rules = new_plan.food_weighing_rules,
    admin_notes = new_plan.admin_notes, visible_to_client = new_plan.visible_to_client,
    pdf_url = new_plan.pdf_url, pdf_name = new_plan.pdf_name,
    water = new_plan.water, supplements = new_plan.supplements,
    last_updated_at = written_at
  WHERE id = _target_id AND client_id = _client_id;
  DELETE FROM public.nutrition_target_days WHERE target_id = _target_id;
  INSERT INTO public.nutrition_target_days(target_id, day_label, calories, protein, carbs, fats, fibre, notes, sort_order, use_on, weekdays, steps)
    SELECT _target_id, d.day_label, d.calories, d.protein, d.carbs, d.fats, d.fibre, d.notes, d.sort_order, d.use_on, d.weekdays, d.steps
    FROM jsonb_populate_recordset(NULL::public.nutrition_target_days, _days) AS d;
  RETURN written_at;
END;
$$;
REVOKE ALL ON FUNCTION public.update_nutrition_plan_revision(uuid,uuid,timestamptz,jsonb,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_nutrition_plan_revision(uuid,uuid,timestamptz,jsonb,jsonb,text,uuid) TO authenticated, service_role;

-- Future plans must not be inserted in the live nutrition table before activation.
-- Immediate publication creates plan + day records and archives superseded rows
-- under the same client advisory lock used by existing-plan revisions.
CREATE OR REPLACE FUNCTION public.publish_nutrition_plan_atomic(
  _client_id uuid, _payload jsonb, _days jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.nutrition_targets%ROWTYPE;
  new_id uuid := gen_random_uuid();
  archived_count int := 0;
  local_today date;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND (
    auth.uid() IS NULL OR NOT (
      coalesce(public.has_role(auth.uid(), 'admin'), false)
      OR EXISTS (SELECT 1 FROM public.coached_client_ids() AS c(id) WHERE c.id = _client_id)
    )
  ) THEN RAISE EXCEPTION 'Coach access required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(_days) IS DISTINCT FROM 'array'
    OR jsonb_array_length(_days) > 100 THEN RAISE EXCEPTION 'Invalid nutrition plan payload'; END IF;
  IF (_payload->>'client_id')::uuid IS DISTINCT FROM _client_id THEN RAISE EXCEPTION 'Client mismatch'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_client_id::text, 0));
  SELECT (now() AT TIME ZONE coalesce(nullif(timezone,''),'America/Winnipeg'))::date
    INTO local_today FROM public.clients WHERE id = _client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  p := jsonb_populate_record(NULL::public.nutrition_targets, _payload);
  IF p.start_date IS NULL OR (p.end_date IS NOT NULL AND p.end_date < p.start_date)
    THEN RAISE EXCEPTION 'Check plan dates'; END IF;
  IF p.status NOT IN ('Active','Ending Soon','Due Today','Past Due','Archived') OR p.status IS NULL
    THEN RAISE EXCEPTION 'Invalid plan status'; END IF;
  IF p.status <> 'Archived' AND p.start_date > local_today THEN
    RAISE EXCEPTION 'Future plans require scheduling; the current plan was not changed';
  END IF;
  IF p.status <> 'Archived' AND EXISTS (
    SELECT 1 FROM public.nutrition_targets n WHERE n.client_id = _client_id
    AND n.status <> 'Archived' AND n.start_date > p.start_date
  ) THEN RAISE EXCEPTION 'A newer live plan exists. Review its dates before publishing'; END IF;
  INSERT INTO public.nutrition_targets (
    id, client_id, phase, custom_phase, goal, custom_goal, structure, start_date,
    end_date, status, ending_soon_days, client_notes, food_weighing_rules, admin_notes,
    visible_to_client, pdf_url, pdf_name, water, supplements, assigned_coach_id, last_updated_at
  ) VALUES (
    new_id, _client_id, coalesce(p.phase,'Maintenance'), p.custom_phase,
    coalesce(p.goal,'Maintain bodyweight'), p.custom_goal, coalesce(p.structure,'Same Every Day'),
    p.start_date, p.end_date, p.status, coalesce(p.ending_soon_days,7), p.client_notes,
    p.food_weighing_rules,p.admin_notes,coalesce(p.visible_to_client,true),p.pdf_url,p.pdf_name,
    p.water,p.supplements,p.assigned_coach_id,clock_timestamp()
  );
  INSERT INTO public.nutrition_target_days(target_id,day_label,calories,protein,carbs,fats,fibre,notes,sort_order,use_on,weekdays,steps)
    SELECT new_id,d.day_label,d.calories,d.protein,d.carbs,d.fats,d.fibre,d.notes,coalesce(d.sort_order,0),d.use_on,d.weekdays,d.steps
    FROM jsonb_populate_recordset(NULL::public.nutrition_target_days,_days) d;
  IF p.status <> 'Archived' THEN
    UPDATE public.nutrition_targets n SET status='Archived',
      end_date=greatest(n.start_date,least(coalesce(n.end_date,p.start_date-1),p.start_date-1))
      WHERE n.client_id=_client_id AND n.id<>new_id AND n.status<>'Archived';
    GET DIAGNOSTICS archived_count = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('targetId',new_id,'archived',archived_count);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_nutrition_plan_atomic(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_nutrition_plan_atomic(uuid,jsonb,jsonb) TO authenticated,service_role;

-- Scheduled nutrition is separate from the live prescription. A coach reviews
-- and explicitly activates it on/after the requested date; no silent publish.
CREATE TABLE IF NOT EXISTS public.nutrition_scheduled_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  payload jsonb NOT NULL,
  days jsonb NOT NULL,
  state text NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','activated','cancelled')),
  baseline jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_plan_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS nutrition_scheduled_client_idx ON public.nutrition_scheduled_plans(client_id,state,start_date);
ALTER TABLE public.nutrition_scheduled_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read scheduled nutrition" ON public.nutrition_scheduled_plans;
CREATE POLICY "Staff read scheduled nutrition" ON public.nutrition_scheduled_plans FOR SELECT TO authenticated
 USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));
REVOKE ALL ON public.nutrition_scheduled_plans FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.nutrition_scheduled_plans TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.manage_scheduled_nutrition(
 _client_id uuid, _id uuid, _expected_updated_at timestamptz, _action text,
 _payload jsonb DEFAULT NULL, _days jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 d public.nutrition_scheduled_plans%ROWTYPE;
 live_snapshot jsonb;
 local_today date;
 start_on date;
 result jsonb;
 out_id uuid;
BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' AND (
  auth.uid() IS NULL OR NOT (coalesce(public.has_role(auth.uid(),'admin'),false)
   OR EXISTS(SELECT 1 FROM public.coached_client_ids() c(id) WHERE c.id=_client_id))
 ) THEN RAISE EXCEPTION 'Coach access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_client_id::text,0));
 SELECT (now() AT TIME ZONE coalesce(nullif(timezone,''),'America/Winnipeg'))::date INTO local_today
 FROM public.clients WHERE id=_client_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_array(n.id,n.last_updated_at) ORDER BY n.id),'[]'::jsonb) INTO live_snapshot
 FROM public.nutrition_targets n WHERE n.client_id=_client_id AND n.status<>'Archived';
 IF _id IS NOT NULL THEN
  SELECT * INTO d FROM public.nutrition_scheduled_plans WHERE id=_id AND client_id=_client_id FOR UPDATE;
  IF NOT FOUND OR d.state<>'scheduled' THEN RAISE EXCEPTION 'Scheduled plan is no longer available'; END IF;
  IF d.updated_at IS DISTINCT FROM _expected_updated_at THEN RAISE EXCEPTION 'Draft changed. Reopen it.' USING ERRCODE='40001'; END IF;
 END IF;
 IF _action='cancel' AND _id IS NOT NULL THEN
  UPDATE public.nutrition_scheduled_plans SET state='cancelled',updated_at=clock_timestamp() WHERE id=_id;
  RETURN jsonb_build_object('id',_id);
 END IF;
 IF _action NOT IN ('save','activate') OR jsonb_typeof(_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(_days) IS DISTINCT FROM 'array'
  OR jsonb_array_length(_days)>100 OR (_payload->>'client_id')::uuid IS DISTINCT FROM _client_id
  THEN RAISE EXCEPTION 'Invalid scheduled plan'; END IF;
 start_on := (_payload->>'start_date')::date;
 IF start_on IS NULL OR (_payload->>'end_date')::date < start_on THEN RAISE EXCEPTION 'Check plan dates'; END IF;
 IF _payload->>'status' IS DISTINCT FROM 'Active' THEN RAISE EXCEPTION 'Scheduled plan must be Active when published'; END IF;
 IF _action='save' THEN
  IF EXISTS(SELECT 1 FROM public.nutrition_scheduled_plans s WHERE s.client_id=_client_id AND s.state='scheduled'
    AND s.start_date=start_on AND s.id IS DISTINCT FROM _id) THEN RAISE EXCEPTION 'A scheduled plan already starts on this date'; END IF;
  IF _id IS NULL THEN
   INSERT INTO public.nutrition_scheduled_plans(client_id,start_date,payload,days,baseline,created_by)
   VALUES(_client_id,start_on,_payload,_days,live_snapshot,auth.uid()) RETURNING id INTO out_id;
  ELSE
   UPDATE public.nutrition_scheduled_plans SET start_date=start_on,payload=_payload,days=_days,baseline=live_snapshot,updated_at=clock_timestamp() WHERE id=_id;
   out_id := _id;
  END IF;
  RETURN jsonb_build_object('id',out_id);
 END IF;
 IF _id IS NULL OR d.start_date>local_today OR start_on>local_today THEN RAISE EXCEPTION 'Scheduled plan is not due'; END IF;
 IF d.baseline IS DISTINCT FROM live_snapshot THEN RAISE EXCEPTION 'Current plan changed since scheduling. Review the comparison, save draft, then reopen to publish'; END IF;
 -- Never retroactively change the recorded timeline if approval is delayed.
 IF (_payload->>'end_date')::date < local_today THEN RAISE EXCEPTION 'Review date has passed. Update the end date first'; END IF;
 result := public.publish_nutrition_plan_atomic(_client_id,_payload || jsonb_build_object('start_date',local_today),_days);
 UPDATE public.nutrition_scheduled_plans SET state='activated',activated_plan_id=(result->>'targetId')::uuid,updated_at=clock_timestamp() WHERE id=_id;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_scheduled_nutrition(uuid,uuid,timestamptz,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_scheduled_nutrition(uuid,uuid,timestamptz,text,jsonb,jsonb) TO authenticated,service_role;
