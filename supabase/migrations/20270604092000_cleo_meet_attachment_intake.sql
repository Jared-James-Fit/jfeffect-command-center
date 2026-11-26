-- Confirmed meet attachment intake. Only the server can invoke this transaction.
-- Re-check access and the exact reviewed old values while holding a row lock.
CREATE OR REPLACE FUNCTION public.cleo_apply_meet_intake(
  _requester uuid, _client uuid, _competition uuid,
  _before jsonb, _patch jsonb, _source_path text, _source_name text,
  _confidence text, _evidence text
) RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  old_row public.competitions%ROWTYPE;
  next_row public.competitions%ROWTYPE;
  field_key text;
  schedule_patch jsonb;
BEGIN
  IF public.cleo_action_target_allowed(_requester, _client) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Client access denied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.summer_attachments
    WHERE path = _source_path AND user_id = _requester AND message_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Source attachment is unavailable';
  END IF;
  IF jsonb_typeof(_patch) IS DISTINCT FROM 'object' OR _patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'No meet fields supplied';
  END IF;
  SELECT * INTO old_row FROM public.competitions
    WHERE id = _competition AND client_id = _client FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Competition not found'; END IF;
  FOR field_key IN SELECT jsonb_object_keys(_patch) LOOP
    IF field_key NOT IN ('session_label','flight','weigh_in_at','lifting_start','location','division','equipment_event','weight_class')
      OR NOT (_before ? field_key) OR jsonb_typeof(_patch -> field_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid meet field';
    END IF;
    IF (to_jsonb(old_row) -> field_key) IS DISTINCT FROM (_before -> field_key) THEN
      RAISE EXCEPTION 'Meet details changed since review. Ask Cleo for a new card.';
    END IF;
  END LOOP;
  next_row := jsonb_populate_record(old_row, _patch);
  schedule_patch := coalesce(old_row.schedule, '{}'::jsonb);
  FOR field_key IN SELECT jsonb_object_keys(_patch) LOOP
    IF field_key IN ('flight','weigh_in_at','lifting_start') THEN
      schedule_patch := jsonb_set(schedule_patch, '{verified}',
        coalesce(schedule_patch -> 'verified', '{}'::jsonb) || jsonb_build_object(field_key,true), true);
    END IF;
  END LOOP;
  UPDATE public.competitions SET
    session_label = next_row.session_label, flight = next_row.flight,
    weigh_in_at = next_row.weigh_in_at, lifting_start = next_row.lifting_start,
    location = next_row.location, division = next_row.division,
    equipment_event = next_row.equipment_event, weight_class = next_row.weight_class,
    schedule = schedule_patch
    WHERE id = _competition;
  INSERT INTO public.competition_events(competition_id,client_id,actor_id,actor,action,detail)
    VALUES (_competition,_client,_requester,'coach','cleo_attachment_confirmed',
      jsonb_build_object('source_path',_source_path,'source_name',_source_name,
        'confidence',_confidence,'evidence',_evidence,'before',_before,'after',_patch));
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_apply_meet_intake(uuid,uuid,uuid,jsonb,jsonb,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_apply_meet_intake(uuid,uuid,uuid,jsonb,jsonb,text,text,text,text) TO service_role;
