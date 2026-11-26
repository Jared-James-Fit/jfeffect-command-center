-- Coach-confirmed meet details from the existing private athlete-intel source.
CREATE OR REPLACE FUNCTION public.apply_competition_file_fact(_actor uuid,_competition uuid,_fact uuid,_before text)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE c public.competitions%ROWTYPE; f public.athlete_intel_facts%ROWTYPE; k text; v text; prior text; p jsonb; s jsonb;
BEGIN
 SELECT * INTO c FROM public.competitions WHERE id=_competition FOR UPDATE;
 IF NOT FOUND OR public.cleo_action_target_allowed(_actor,c.client_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Client access denied'; END IF;
 IF c.status <> 'upcoming' THEN RAISE EXCEPTION 'Only upcoming competitions can be updated here'; END IF;
 SELECT * INTO f FROM public.athlete_intel_facts WHERE id=_fact AND client_id=c.client_id AND competition_id=c.id AND status='active' AND scope='meet' AND kind='note' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.athlete_intel_sources WHERE id=f.source_id AND client_id=c.client_id AND competition_id=c.id AND status='ready') THEN RAISE EXCEPTION 'Source changed; review the current file again'; END IF;
 k:=f.data->'meetLogistics'->>'field'; v:=f.data->'meetLogistics'->>'value';
 IF k IS NULL OR k NOT IN ('session_label','flight','weigh_in_at','lifting_start','location','division','equipment_event','weight_class') OR v IS NULL OR btrim(v)='' OR f.quote IS NULL THEN RAISE EXCEPTION 'Invalid source field'; END IF;
 prior:=to_jsonb(c)->>k;
 IF prior IS DISTINCT FROM _before THEN RAISE EXCEPTION 'Meet details changed; review the current value again'; END IF;
 IF k IN ('weigh_in_at','lifting_start') AND v !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Invalid time'; END IF;
 IF prior IS NOT DISTINCT FROM v THEN RETURN false; END IF;
 p:=jsonb_build_object(k,v);
 s:=coalesce(c.schedule,'{}'::jsonb);
 IF k IN ('flight','weigh_in_at','lifting_start') THEN s:=jsonb_set(s,'{verified}',coalesce(s->'verified','{}'::jsonb)||jsonb_build_object(k,true),true); END IF;
 c:=jsonb_populate_record(c,p);
 UPDATE public.competitions SET session_label=c.session_label,flight=c.flight,weigh_in_at=c.weigh_in_at,lifting_start=c.lifting_start,location=c.location,division=c.division,equipment_event=c.equipment_event,weight_class=c.weight_class,schedule=s WHERE id=c.id;
 INSERT INTO public.competition_events(competition_id,client_id,actor_id,actor,action,detail) VALUES(c.id,c.client_id,_actor,'coach','file_logistics_confirmed',jsonb_build_object('source_id',f.source_id,'fact_id',f.id,'quote',f.quote,'field',k,'before',prior,'after',v));
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_competition_file_fact(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_competition_file_fact(uuid,uuid,uuid,text) TO service_role;
