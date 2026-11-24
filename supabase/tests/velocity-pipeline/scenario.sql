-- Real production shape, no lasting mutations. Invoke with psql -v ON_ERROR_STOP=1.
BEGIN;
DO $$
DECLARE
 original public.pl_set_videos;
 raw jsonb;
 uid uuid;
 clip uuid:=gen_random_uuid();
 j jsonb;
 n numeric;
 h uuid;
 count_before int;
BEGIN
 SELECT s.* INTO original FROM public.pl_set_videos s JOIN public.pl_set_video_analyses a ON a.set_video_id=s.id WHERE s.deleted_at IS NULL AND s.result_id IS NOT NULL AND s.set_index=3 AND s.exercise_name='Competition Squat' AND a.reps=4 ORDER BY a.updated_at DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Screenshot regression fixture unavailable'; END IF;
 SELECT a.result INTO raw FROM public.pl_set_video_analyses a WHERE a.set_video_id=original.id;
 SELECT user_id INTO uid FROM public.clients WHERE id=original.client_id;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 -- Copies only a checked file reference; original upload, set and message survive rollback unchanged.
 INSERT INTO public.pl_set_videos(id,client_id,uploaded_by,row_id,day_id,result_id,set_index,exercise_name,workout_title,label,storage_path,thumbnail_path,duration_s,width,height,size_bytes,mime,file_key,client_key)
 VALUES(clip,original.client_id,uid,original.row_id,original.day_id,original.result_id,original.set_index,original.exercise_name,original.workout_title,original.label,original.client_id::text||'/set-videos/'||clip::text||'.mp4',original.thumbnail_path,original.duration_s,original.width,original.height,original.size_bytes,original.mime,'velocity-test-'||clip,'velocity-test-'||clip);
 IF NOT EXISTS(SELECT 1 FROM public.set_velocity_jobs WHERE set_video_id=clip AND status='queued') THEN RAISE EXCEPTION 'Upload did not enqueue'; END IF;
 j:=public.velocity_job_claim(clip);
 IF j IS NULL OR (j->>'attempts')::int<>1 THEN RAISE EXCEPTION 'Claim failed'; END IF;
 IF public.velocity_job_claim(clip) IS NOT NULL THEN RAISE EXCEPTION 'Duplicate claim admitted'; END IF;
 raw:=jsonb_set(raw,'{velocity,accepted}','true');
 raw:=jsonb_set(raw,'{velocity,value}','0.423');
 IF NOT public.velocity_analysis_commit(clip,raw,(j->>'lease_id')::uuid,NULL,2500) THEN RAISE EXCEPTION 'Commit failed'; END IF;
 PERFORM public.velocity_control(clip,'select');
 SELECT mean_concentric_velocity_mps INTO n FROM public.pl_row_results WHERE id=original.result_id;
 IF n IS NOT NULL THEN RAISE EXCEPTION 'Unconfirmed plate populated velocity'; END IF;
 raw:=jsonb_set(raw,'{plate,confirmed}','true');
 PERFORM public.set_video_analysis_save(clip,raw);
 SELECT mean_concentric_velocity_mps INTO n FROM public.pl_row_results WHERE id=original.result_id;
 IF n<>0.423 OR n IS NULL THEN RAISE EXCEPTION 'Expected arithmetic mean 0.423, got %',n; END IF;
 IF (SELECT velocity_quality FROM public.pl_row_results WHERE id=original.result_id)<>'estimated' THEN RAISE EXCEPTION 'Estimated value not marked'; END IF;
 SELECT id INTO h FROM public.set_velocity_history WHERE subject_id=clip AND after_value#>>'{result,plate,confirmed}'='true' ORDER BY happened_at DESC LIMIT 1;
 PERFORM public.velocity_control(clip,'exclude',NULL,'Test inaccurate');
 IF (SELECT mean_concentric_velocity_mps FROM public.pl_row_results WHERE id=original.result_id) IS NOT NULL THEN RAISE EXCEPTION 'Excluded clip still effective'; END IF;
 PERFORM public.velocity_control(clip,'include');
 PERFORM public.velocity_control(clip,'edit',0.52,'Reference device correction');
 PERFORM public.set_video_analysis_save(clip,raw);
 IF (SELECT mean_concentric_velocity_mps FROM public.pl_row_results WHERE id=original.result_id)<>0.52 THEN RAISE EXCEPTION 'Automatic read overwrote manual correction'; END IF;
 PERFORM public.velocity_control(clip,'exclude_set');
 IF NOT (SELECT velocity_excluded FROM public.pl_row_results WHERE id=original.result_id) THEN RAISE EXCEPTION 'Set exclusion not saved'; END IF;
 PERFORM public.velocity_control(clip,'restore',NULL,'Restore raw revision',h);
 IF NOT EXISTS(SELECT 1 FROM public.set_velocity_history WHERE subject_id=clip AND reason='Restore raw revision') THEN RAISE EXCEPTION 'Restore audit missing'; END IF;
 PERFORM public.velocity_job_retry(clip);
 j:=public.velocity_job_claim(clip);
 IF public.velocity_analysis_commit(clip,raw,(j->>'lease_id')::uuid,NULL,100) THEN RAISE EXCEPTION 'Reviewed read overwritten by job'; END IF;
 PERFORM public.velocity_job_retry(clip);
 j:=public.velocity_job_claim(clip);
 PERFORM public.velocity_job_fail(clip,(j->>'lease_id')::uuid,'Network interrupted',true);
 IF public.velocity_job_claim(clip) IS NOT NULL THEN RAISE EXCEPTION 'Immediate retry admitted'; END IF;
 SELECT count(*) INTO count_before FROM public.set_velocity_history WHERE subject_id=clip;
 BEGIN UPDATE public.set_velocity_history SET reason='tampered' WHERE subject_id=clip; RAISE EXCEPTION 'History mutable'; EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN raise_exception THEN IF SQLERRM='History mutable' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 BEGIN PERFORM public.velocity_control(clip,'edit',1,'Unauthorized'); RAISE EXCEPTION 'Stranger admitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: upload enqueue, lease exclusivity, unknown calibration, estimated mean, canonical clip, exclude/include, manual preservation, append-only history, restore, stale-job protection, bounded retry cooldown and stranger refusal (% revisions)',count_before;
END $$;
ROLLBACK;