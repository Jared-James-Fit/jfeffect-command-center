-- Atomic coach-reviewed batch. Original evidence remains in the source and audit.
CREATE OR REPLACE FUNCTION public.apply_competition_file_facts(_actor uuid,_competition uuid,_updates jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE c public.competitions%ROWTYPE; f public.athlete_intel_facts%ROWTYPE;
 item jsonb; k text; v text; extracted text; prior text; s jsonb; patch jsonb:='{}'::jsonb;
 seen text[]:=ARRAY[]::text[]; count_updated integer:=0; max_len integer;
BEGIN
 IF jsonb_typeof(_updates) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid updates'; END IF;
 IF jsonb_array_length(_updates) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Select 1 to 30 updates'; END IF;
 SELECT * INTO c FROM public.competitions WHERE id=_competition FOR UPDATE;
 IF NOT FOUND OR public.cleo_action_target_allowed(_actor,c.client_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Client access denied'; END IF;
 IF c.status <> 'upcoming' THEN RAISE EXCEPTION 'Only upcoming competitions can be updated here'; END IF;
 s:=coalesce(c.schedule,'{}'::jsonb);
 FOR item IN SELECT value FROM jsonb_array_elements(_updates) LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT (item ? 'before') OR jsonb_typeof(item->'value') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'extracted') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid update'; END IF;
   SELECT * INTO f FROM public.athlete_intel_facts WHERE id=(item->>'factId')::uuid AND client_id=c.client_id AND competition_id=c.id AND status='active' AND scope='meet' AND kind='note' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Source changed; review the current file again'; END IF;
   PERFORM 1 FROM public.athlete_intel_sources WHERE id=f.source_id AND client_id=c.client_id AND competition_id=c.id AND status='ready' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Source changed; review the current file again'; END IF;
   k:=f.data->'meetLogistics'->>'field';
   extracted:=f.data->'meetLogistics'->>'value';
   v:=btrim(item->>'value');
   max_len:=CASE k WHEN 'session_label' THEN 40 WHEN 'flight' THEN 40 WHEN 'weigh_in_at' THEN 5 WHEN 'lifting_start' THEN 5 WHEN 'location' THEN 160 WHEN 'division' THEN 80 WHEN 'equipment_event' THEN 100 WHEN 'weight_class' THEN 20 ELSE 0 END;
   IF max_len=0 OR extracted IS NULL OR btrim(extracted)='' OR f.quote IS NULL OR extracted IS DISTINCT FROM (item->>'extracted') THEN RAISE EXCEPTION 'Source changed; review the current file again'; END IF;
   IF k=ANY(seen) THEN RAISE EXCEPTION 'Choose only one value per field'; END IF;
   seen:=array_append(seen,k);
   prior:=to_jsonb(c)->>k;
   IF prior IS DISTINCT FROM (item->>'before') THEN RAISE EXCEPTION 'Meet details changed; review the current value again'; END IF;
   IF v IS NULL OR v='' OR char_length(v)>max_len THEN RAISE EXCEPTION 'Invalid value for %',k; END IF;
   IF k IN ('weigh_in_at','lifting_start') AND v !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Invalid time'; END IF;
   patch:=patch||jsonb_build_object(k,v);
   IF k IN ('flight','weigh_in_at','lifting_start') THEN s:=jsonb_set(s,'{verified}',coalesce(s->'verified','{}'::jsonb)||jsonb_build_object(k,true),true); END IF;
   IF v IS DISTINCT FROM extracted THEN
     -- Keep original evidence/quote for audit; stop proposing the same corrected extraction.
     UPDATE public.athlete_intel_facts SET status='dismissed'
       WHERE client_id=c.client_id AND competition_id=c.id AND status='active' AND scope='meet' AND kind='note'
         AND data->'meetLogistics'->>'field'=k AND lower(btrim(data->'meetLogistics'->>'value'))=lower(btrim(extracted));
   END IF;
   INSERT INTO public.competition_events(competition_id,client_id,actor_id,actor,action,detail)
     VALUES(c.id,c.client_id,_actor,'coach','file_logistics_confirmed',jsonb_build_object('source_id',f.source_id,'fact_id',f.id,'quote',f.quote,'field',k,'before',prior,'extracted',extracted,'after',v,'edited',v IS DISTINCT FROM extracted));
   count_updated:=count_updated+1;
 END LOOP;
 c:=jsonb_populate_record(c,patch);
 UPDATE public.competitions SET session_label=c.session_label,flight=c.flight,weigh_in_at=c.weigh_in_at,lifting_start=c.lifting_start,location=c.location,division=c.division,equipment_event=c.equipment_event,weight_class=c.weight_class,schedule=s,schedule_dirty=true WHERE id=c.id;
 RETURN count_updated;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_competition_file_facts(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_competition_file_facts(uuid,uuid,jsonb) TO service_role;
