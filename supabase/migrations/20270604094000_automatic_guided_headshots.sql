-- Allow automatic publication of server-checked guided captures by their current owner.
-- Keep the earlier staff-only overload during rolling deployment.
CREATE OR REPLACE FUNCTION public.commit_account_headshot(
  _headshot uuid, _actor uuid, _display_path text, _note text, _decided_at timestamptz, _automatic boolean
) RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  h public.account_headshots%ROWTYPE;
  c public.clients%ROWTYPE;
  cid uuid;
  previous text;
BEGIN
  SELECT client_id INTO cid FROM public.account_headshots WHERE id = _headshot;
  IF NOT FOUND THEN RAISE EXCEPTION 'Capture not found'; END IF;
  -- Serialize all acceptances for the same client.
  SELECT * INTO c FROM public.clients WHERE id = cid FOR UPDATE;
  IF NOT FOUND OR c.user_id IS NULL THEN RAISE EXCEPTION 'Client login not found'; END IF;
  SELECT * INTO h FROM public.account_headshots WHERE id = _headshot AND client_id = c.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Capture not found'; END IF;
  IF _automatic IS TRUE THEN
    IF _actor IS NULL OR h.user_id IS DISTINCT FROM _actor OR c.user_id IS DISTINCT FROM _actor
       OR c.service_tier IS DISTINCT FROM 'coaching' OR c.archived IS TRUE
       OR c.status IN ('Deactivated', 'Deleted', 'Archived')
       OR h.method IS DISTINCT FROM 'guided'
       OR NOT (h.flags <@ ARRAY['exif','same_as_before']::text[])
       OR h.server_checks #> '{blink,confirmed}' IS DISTINCT FROM 'true'::jsonb
       OR h.server_checks #> '{turn,confirmed}' IS DISTINCT FROM 'true'::jsonb
       OR h.server_checks -> 'deviceProblems' IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'Capture does not qualify for automatic saving' USING ERRCODE = '42501'; END IF;
  ELSIF public.cleo_action_target_allowed(_actor, c.id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Coach access required' USING ERRCODE = '42501';
  END IF;
  IF _display_path IS DISTINCT FROM c.user_id::text || '/headshot-' || h.id::text || '.jpg' THEN
    RAISE EXCEPTION 'Invalid headshot destination';
  END IF;
  IF h.status = 'accepted' AND h.display_path = _display_path AND c.profile_picture_url = _display_path THEN
    RETURN NULL;
  END IF;
  IF h.status <> 'pending' OR h.photo_path IS NULL THEN
    RAISE EXCEPTION 'That headshot was already reviewed or is missing';
  END IF;
  previous := c.profile_picture_url;
  UPDATE public.clients SET
    profile_picture_url = _display_path,
    profile_picture_updated_at = _decided_at,
    profile_picture_updated_by = CASE WHEN h.method = 'coach_assisted' THEN 'coach' ELSE 'client' END,
    profile_picture_source = CASE h.method WHEN 'coach_assisted' THEN 'coach_assisted' WHEN 'guided' THEN 'camera_verified' ELSE 'camera_reviewed' END,
    profile_picture_needs_update = false,
    profile_picture_needs_update_at = NULL,
    profile_picture_needs_update_reason = NULL
    WHERE id = c.id;
  UPDATE public.account_headshots SET status = 'superseded'
    WHERE client_id = c.id AND status = 'accepted';
  UPDATE public.account_headshots SET status = 'accepted', decided_by = _actor,
    decided_at = _decided_at, decision_note = _note, display_path = _display_path
    WHERE id = h.id;
  UPDATE public.account_headshot_requests SET resolved_at = _decided_at,
    resolved_headshot_id = h.id, snoozed_until = NULL
    WHERE client_id = c.id AND resolved_at IS NULL AND cancelled_at IS NULL;
  INSERT INTO public.account_headshot_events(client_id, headshot_id, actor, kind, detail, at)
    VALUES (c.id, h.id, _actor, 'accepted', jsonb_build_object('method',h.method,'note',_note,'automatic',_automatic IS TRUE), _decided_at);
  RETURN previous;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_account_headshot(uuid,uuid,text,text,timestamptz,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_account_headshot(uuid,uuid,text,text,timestamptz,boolean) TO service_role;
