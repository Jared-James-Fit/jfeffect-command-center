ALTER FUNCTION public.set_video_analysis_save(uuid,jsonb) RENAME TO _velocity_analysis_store;
REVOKE ALL ON FUNCTION public._velocity_analysis_store(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._velocity_analysis_store(uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public._apply_video_velocity(_set_video_id uuid) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.pl_set_videos; a public.pl_set_video_analyses; r public.pl_row_results; v numeric; u numeric; tier text; nr int; ng int; picked uuid; raw jsonb; q jsonb; err numeric;
BEGIN
 SELECT * INTO s FROM public.pl_set_videos WHERE id=_set_video_id;
 UPDATE public.pl_row_results SET mean_concentric_velocity_mps=NULL,velocity_source=NULL,velocity_set_video_id=NULL,velocity_quality=NULL,velocity_uncertainty=NULL WHERE velocity_set_video_id=_set_video_id AND velocity_source='video' AND (s.deleted_at IS NOT NULL OR s.result_id IS DISTINCT FROM id);
 IF s.result_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.pl_row_results WHERE id=s.result_id FOR UPDATE;
 IF r.velocity_source='device' AND r.mean_concentric_velocity_mps IS NOT NULL THEN RETURN r.mean_concentric_velocity_mps; END IF;
 SELECT x.* INTO a FROM public.pl_set_video_analyses x JOIN public.pl_set_videos sv ON sv.id=x.set_video_id WHERE sv.result_id=r.id AND sv.deleted_at IS NULL AND sv.set_index>0 AND x.status='done' AND NOT x.excluded AND x.velocity_accepted AND x.units='mm' AND (r.velocity_selected_video_id IS NULL OR r.velocity_selected_video_id=x.set_video_id) AND coalesce((x.result#>>'{plate,confirmed}')::boolean,false) ORDER BY sv.created_at,sv.id LIMIT 1;
 IF FOUND AND NOT r.velocity_excluded THEN
  raw:=a.result;
  nr:=0; ng:=0; v:=0; u:=0;
  FOR q IN SELECT value FROM jsonb_array_elements(raw->'reps') LOOP
   nr:=nr+1;
   IF (q->>'complete')::boolean AND q#>>'{mcv,tier}' IN ('measured','estimated') AND (q#>>'{mcv,v}')::numeric>0 AND (q#>>'{mcv,v}')::numeric<=3.5 AND (q#>>'{mcv,u}')::numeric>=0 THEN ng:=ng+1; v:=v+(q#>>'{mcv,v}')::numeric; u:=u+power((q#>>'{mcv,u}')::numeric,2); END IF;
  END LOOP;
  IF nr>0 AND nr=ng THEN
   v:=v/nr; err:=(raw#>>'{calibration,relErr}')::numeric;
   u:=sqrt(u/power(nr,2)+power(2*err*v,2));
   tier:=CASE WHEN u/v<=0.08 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(raw->'reps') z WHERE z#>>'{mcv,tier}'<>'measured') THEN 'measured' ELSE 'estimated' END;
   IF nr IS DISTINCT FROM r.actual_reps OR NOT coalesce((raw#>>'{calibration,ok}')::boolean,false) OR (raw->>'fps')::numeric<24 OR (raw#>>'{quality,tracked}')::numeric<0.75 OR err>0.1 OR (raw#>>'{plate,ratio}')::numeric<(CASE WHEN raw#>>'{plate,view}'='turned' THEN 0.77 ELSE 0.9 END) OR (coalesce(raw#>'{quality,notes}','[]'::jsonb) ? 'camera_moved') OR u/v>0.25 OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(raw#>'{track,lost}','[]'::jsonb)) g WHERE (g->>'end')::numeric-(g->>'start')::numeric>1) THEN v:=NULL; END IF;
  ELSE v:=NULL; END IF;
  picked:=a.set_video_id;
 END IF;
 UPDATE public.pl_row_results SET mean_concentric_velocity_mps=round(v,3),velocity_source=CASE WHEN v IS NOT NULL THEN 'video' END,velocity_set_video_id=CASE WHEN v IS NOT NULL THEN picked END,velocity_uncertainty=CASE WHEN v IS NOT NULL THEN u END,velocity_quality=CASE WHEN v IS NOT NULL THEN tier END WHERE id=r.id AND (mean_concentric_velocity_mps IS DISTINCT FROM round(v,3) OR velocity_set_video_id IS DISTINCT FROM (CASE WHEN v IS NOT NULL THEN picked END) OR velocity_quality IS DISTINCT FROM (CASE WHEN v IS NOT NULL THEN tier END));
 RETURN round(v,3);
END $$;
REVOKE ALL ON FUNCTION public._apply_video_velocity(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.velocity_analysis_commit(_video uuid,_result jsonb,_lease uuid DEFAULT NULL,_expected timestamptz DEFAULT NULL,_compute_ms integer DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.set_velocity_jobs; a public.pl_set_video_analyses;
BEGIN
 PERFORM public._set_video_for_analysis(_video);
 PERFORM pg_advisory_xact_lock(hashtextextended(_video::text,9));
 SELECT * INTO a FROM public.pl_set_video_analyses WHERE set_video_id=_video;
 IF _lease IS NOT NULL THEN
  SELECT * INTO j FROM public.set_velocity_jobs WHERE set_video_id=_video FOR UPDATE;
  IF j.lease_id IS DISTINCT FROM _lease OR j.claimed_by IS DISTINCT FROM (SELECT auth.uid()) OR j.status<>'running' OR j.lease_until<now() THEN RETURN false; END IF;
  IF a.reviewed OR a.updated_at IS DISTINCT FROM j.analysis_base THEN UPDATE public.set_velocity_jobs SET status='needs_review',lease_id=NULL,lease_until=NULL,updated_at=now(),error='A newer reviewed read was kept' WHERE set_video_id=_video; RETURN false; END IF;
 ELSIF a.updated_at IS DISTINCT FROM _expected THEN RAISE EXCEPTION 'This analysis changed. Open it again before saving.'; END IF;
 PERFORM public._velocity_analysis_store(_video,_result);
 UPDATE public.pl_set_video_analyses SET reviewed=(_lease IS NULL),excluded=false WHERE set_video_id=_video;
 UPDATE public.set_velocity_jobs SET status=CASE WHEN coalesce(_result->>'status','done')<>'done' THEN 'needs_review' WHEN NOT coalesce((_result#>>'{plate,confirmed}')::boolean,false) THEN 'needs_calibration' ELSE 'done' END,finished_at=now(),compute_ms=greatest(0,least(_compute_ms,120000)),lease_id=NULL,lease_until=NULL,error=NULL,updated_at=now() WHERE set_video_id=_video;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.velocity_analysis_commit(uuid,jsonb,uuid,timestamptz,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.velocity_analysis_commit(uuid,jsonb,uuid,timestamptz,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.set_video_analysis_save(_set_video_id uuid,_result jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t timestamptz; idv uuid;
BEGIN
 PERFORM public._set_video_for_analysis(_set_video_id);
 SELECT updated_at INTO t FROM public.pl_set_video_analyses WHERE set_video_id=_set_video_id;
 PERFORM public.velocity_analysis_commit(_set_video_id,_result,NULL,t,NULL);
 SELECT id INTO idv FROM public.pl_set_video_analyses WHERE set_video_id=_set_video_id;
 RETURN idv;
END $$;
REVOKE ALL ON FUNCTION public.set_video_analysis_save(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_video_analysis_save(uuid,jsonb) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.velocity_control(_video uuid,_action text,_value numeric DEFAULT NULL,_reason text DEFAULT NULL,_history uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.pl_set_videos; h public.set_velocity_history; expected timestamptz;
BEGIN
 s:=public._set_video_for_analysis(_video);
 PERFORM pg_advisory_xact_lock(hashtextextended(_video::text,9));
 PERFORM set_config('jf.velocity_reason',left(coalesce(_reason,_action),240),true);
 IF _action IN ('exclude','include') THEN UPDATE public.pl_set_video_analyses SET excluded=(_action='exclude'),reviewed=true WHERE set_video_id=_video;
 ELSIF _action='select' THEN UPDATE public.pl_row_results SET velocity_selected_video_id=_video,velocity_excluded=false WHERE id=s.result_id;
 ELSIF _action='edit' THEN
  IF _value IS NULL OR NOT (_value>0 AND _value<=3.5) OR nullif(trim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Enter a speed and why it changed'; END IF;
  UPDATE public.pl_row_results SET mean_concentric_velocity_mps=_value,velocity_source='device',velocity_set_video_id=NULL,velocity_quality='manual',velocity_uncertainty=NULL,velocity_excluded=false WHERE id=s.result_id;
 ELSIF _action IN ('exclude_set','include_set') THEN UPDATE public.pl_row_results SET velocity_excluded=(_action='exclude_set') WHERE id=s.result_id;
 ELSIF _action='restore' THEN
  SELECT * INTO h FROM public.set_velocity_history WHERE id=_history AND client_id=s.client_id AND subject_id=_video AND subject_kind='analysis';
  IF NOT FOUND OR h.after_value->'result' IS NULL THEN RAISE EXCEPTION 'That revision is unavailable'; END IF;
  SELECT updated_at INTO expected FROM public.pl_set_video_analyses WHERE set_video_id=_video;
  PERFORM public.velocity_analysis_commit(_video,h.after_value->'result',NULL,expected,NULL);
 ELSE RAISE EXCEPTION 'Unknown velocity action'; END IF;
 PERFORM public._apply_video_velocity(_video);
END $$;
REVOKE ALL ON FUNCTION public.velocity_control(uuid,text,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.velocity_control(uuid,text,numeric,text,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.set_video_analysis_delete(_set_video_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM public.velocity_control(_set_video_id,'exclude',NULL,'Removed from use',NULL); END $$;
REVOKE ALL ON FUNCTION public.set_video_analysis_delete(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_video_analysis_delete(uuid) TO authenticated,service_role;
UPDATE public.set_velocity_jobs j SET status=CASE WHEN a.units='px' OR NOT coalesce((a.result#>>'{plate,confirmed}')::boolean,false) THEN 'needs_calibration' ELSE 'done' END FROM public.pl_set_video_analyses a WHERE a.set_video_id=j.set_video_id AND a.status='done';