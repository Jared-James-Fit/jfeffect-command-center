ALTER TABLE public.pl_row_results ADD COLUMN IF NOT EXISTS velocity_uncertainty numeric, ADD COLUMN IF NOT EXISTS velocity_quality text, ADD COLUMN IF NOT EXISTS velocity_excluded boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS velocity_selected_video_id uuid;
ALTER TABLE public.pl_set_video_analyses ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS reviewed boolean NOT NULL DEFAULT false;
CREATE TABLE public.set_velocity_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, subject_id uuid NOT NULL, subject_kind text NOT NULL CHECK(subject_kind IN ('analysis','set')), actor_id uuid, happened_at timestamptz NOT NULL DEFAULT now(), operation text NOT NULL, reason text, before_value jsonb, after_value jsonb);
GRANT SELECT ON public.set_velocity_history TO authenticated;
GRANT ALL ON public.set_velocity_history TO service_role;
ALTER TABLE public.set_velocity_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Velocity history authorized reads" ON public.set_velocity_history FOR SELECT TO authenticated USING (client_id IN (SELECT id FROM public.clients WHERE user_id=(SELECT auth.uid())) OR client_id IN (SELECT public.coached_client_ids()) OR (SELECT public.has_role((SELECT auth.uid()),'admin')));
CREATE INDEX set_velocity_history_subject ON public.set_velocity_history(subject_id,happened_at DESC);
CREATE TABLE public.set_velocity_jobs (set_video_id uuid PRIMARY KEY REFERENCES public.pl_set_videos(id) ON DELETE CASCADE,client_id uuid NOT NULL,exercise_id uuid,exercise_name text NOT NULL DEFAULT '',enabled boolean NOT NULL DEFAULT true,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','needs_calibration','needs_review','failed','cancelled','skipped')),attempts int NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_id uuid,lease_until timestamptz,claimed_by uuid,analysis_base timestamptz,started_at timestamptz,finished_at timestamptz,compute_ms integer,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.set_velocity_jobs TO authenticated;
GRANT ALL ON public.set_velocity_jobs TO service_role;
ALTER TABLE public.set_velocity_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Velocity jobs authorized reads" ON public.set_velocity_jobs FOR SELECT TO authenticated USING (client_id IN (SELECT id FROM public.clients WHERE user_id=(SELECT auth.uid())) OR client_id IN (SELECT public.coached_client_ids()) OR (SELECT public.has_role((SELECT auth.uid()),'admin')));
CREATE INDEX set_velocity_jobs_due ON public.set_velocity_jobs(status,available_at);
CREATE OR REPLACE FUNCTION public._velocity_enqueue(_video uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.pl_set_videos; n text; eq text; en boolean;
BEGIN
 SELECT * INTO s FROM public.pl_set_videos WHERE id=_video;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT coalesce(e.name,r.exercise_name_override,s.exercise_name,''),coalesce(to_jsonb(e)->>'equipment','') INTO n,eq FROM public.pl_exercise_rows r LEFT JOIN public.exercises e ON e.id=r.exercise_id WHERE r.id=s.row_id;
 n:=coalesce(n,s.exercise_name,'');
 en:=s.set_index>0 AND s.deleted_at IS NULL AND coalesce(s.duration_s,0)<=75 AND lower(n||' '||coalesce(eq,'')) !~ '(dumbbell|kettlebell|cable|band|bodyweight|pull.?up|chin.?up|sled|treadmill|bike|walk|running|leg press|hack squat|belt squat|clean|snatch|jerk)' AND lower(n||' '||coalesce(eq,'')) ~ '(barbell|smith|trap bar|bench|squat|deadlift|romanian|rdl|pendlay|row|overhead press|military press|hip thrust|good morning|shrug)' AND (lower(n||' '||coalesce(eq,'')) !~ 'machine' OR lower(n||' '||coalesce(eq,'')) ~ 'smith');
 INSERT INTO public.set_velocity_jobs(set_video_id,client_id,exercise_id,exercise_name,enabled,status) SELECT s.id,s.client_id,r.exercise_id,n,en,CASE WHEN en THEN 'queued' ELSE 'skipped' END FROM public.pl_exercise_rows r WHERE r.id=s.row_id ON CONFLICT(set_video_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public._velocity_enqueue(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.tg_velocity_enqueue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN PERFORM public._velocity_enqueue(NEW.id);
 ELSIF NEW.deleted_at IS NOT NULL THEN UPDATE public.set_velocity_jobs SET status='cancelled',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE set_video_id=NEW.id;
 ELSIF NEW.row_id IS DISTINCT FROM OLD.row_id THEN UPDATE public.set_velocity_jobs SET exercise_id=(SELECT exercise_id FROM public.pl_exercise_rows WHERE id=NEW.row_id),exercise_name=coalesce(NEW.exercise_name,''),status='needs_review',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE set_video_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER set_velocity_upload_enqueue AFTER INSERT OR UPDATE ON public.pl_set_videos FOR EACH ROW EXECUTE FUNCTION public.tg_velocity_enqueue();
REVOKE ALL ON FUNCTION public.tg_velocity_enqueue() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.velocity_job_claim(_video uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.pl_set_videos; j public.set_velocity_jobs;
BEGIN
 s:=public._set_video_for_analysis(_video); PERFORM public._velocity_enqueue(_video);
 UPDATE public.set_velocity_jobs SET status='running',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',claimed_by=(SELECT auth.uid()),started_at=now(),updated_at=now(),analysis_base=(SELECT updated_at FROM public.pl_set_video_analyses WHERE set_video_id=_video) WHERE set_video_id=_video AND enabled AND attempts<3 AND available_at<=now() AND (status='queued' OR (status='running' AND lease_until<now())) RETURNING * INTO j;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN to_jsonb(j)||jsonb_build_object('storage_path',s.storage_path);
END $$;
REVOKE ALL ON FUNCTION public.velocity_job_claim(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.velocity_job_claim(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.velocity_job_retry(_video uuid,_enabled boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public._set_video_for_analysis(_video); PERFORM public._velocity_enqueue(_video);
 UPDATE public.set_velocity_jobs SET enabled=_enabled,status=CASE WHEN _enabled THEN 'queued' ELSE 'skipped' END,attempts=0,available_at=now(),lease_id=NULL,lease_until=NULL,error=NULL,updated_at=now() WHERE set_video_id=_video;
END $$;
REVOKE ALL ON FUNCTION public.velocity_job_retry(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.velocity_job_retry(uuid,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.velocity_job_fail(_video uuid,_lease uuid,_reason text,_retry boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public._set_video_for_analysis(_video);
 UPDATE public.set_velocity_jobs SET status=CASE WHEN _retry AND attempts<3 THEN 'queued' ELSE 'failed' END,available_at=now()+make_interval(secs=>30*power(4,least(attempts-1,2))::integer),error=left(_reason,160),lease_id=NULL,lease_until=NULL,updated_at=now() WHERE set_video_id=_video AND lease_id=_lease AND claimed_by=(SELECT auth.uid()) AND status='running';
END $$;
REVOKE ALL ON FUNCTION public.velocity_job_fail(uuid,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.velocity_job_fail(uuid,uuid,text,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.tg_velocity_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; cid uuid; sid uuid; oldj jsonb; newj jsonb;
BEGIN
 oldj:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END;
 newj:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END;
 k:=CASE WHEN TG_TABLE_NAME='pl_set_video_analyses' THEN 'analysis' ELSE 'set' END;
 cid:=coalesce(newj->>'client_id',oldj->>'client_id')::uuid;
 sid:=(CASE WHEN k='analysis' THEN coalesce(newj->>'set_video_id',oldj->>'set_video_id') ELSE coalesce(newj->>'id',oldj->>'id') END)::uuid;
 IF k='set' THEN
  IF TG_OP='INSERT' AND newj->>'mean_concentric_velocity_mps' IS NULL THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' AND newj->'mean_concentric_velocity_mps' IS NOT DISTINCT FROM oldj->'mean_concentric_velocity_mps' AND newj->'velocity_excluded' IS NOT DISTINCT FROM oldj->'velocity_excluded' AND newj->'velocity_selected_video_id' IS NOT DISTINCT FROM oldj->'velocity_selected_video_id' AND newj->'velocity_set_video_id' IS NOT DISTINCT FROM oldj->'velocity_set_video_id' THEN RETURN NULL; END IF;
 END IF;
 INSERT INTO public.set_velocity_history(client_id,subject_id,subject_kind,actor_id,operation,reason,before_value,after_value) VALUES(cid,sid,k,(SELECT auth.uid()),TG_OP,nullif(current_setting('jf.velocity_reason',true),''),oldj,newj);
 RETURN NULL;
END $$;
CREATE TRIGGER set_velocity_analysis_history AFTER INSERT OR UPDATE OR DELETE ON public.pl_set_video_analyses FOR EACH ROW EXECUTE FUNCTION public.tg_velocity_history();
CREATE TRIGGER set_velocity_value_history AFTER INSERT OR UPDATE ON public.pl_row_results FOR EACH ROW EXECUTE FUNCTION public.tg_velocity_history();
REVOKE ALL ON FUNCTION public.tg_velocity_history() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.velocity_history_keep() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Velocity history is append-only'; END $$;
CREATE TRIGGER set_velocity_history_keep BEFORE UPDATE OR DELETE ON public.set_velocity_history FOR EACH ROW EXECUTE FUNCTION public.velocity_history_keep();
REVOKE ALL ON FUNCTION public.velocity_history_keep() FROM PUBLIC,anon,authenticated;
INSERT INTO public.set_velocity_history(client_id,subject_id,subject_kind,operation,after_value) SELECT client_id,set_video_id,'analysis','BASELINE',to_jsonb(a) FROM public.pl_set_video_analyses a;
INSERT INTO public.set_velocity_history(client_id,subject_id,subject_kind,operation,after_value) SELECT client_id,id,'set','BASELINE',to_jsonb(r) FROM public.pl_row_results r WHERE mean_concentric_velocity_mps IS NOT NULL;
DO $$ DECLARE v uuid; BEGIN FOR v IN SELECT id FROM public.pl_set_videos WHERE deleted_at IS NULL AND created_at>now()-interval '14 days' ORDER BY created_at DESC LIMIT 60 LOOP PERFORM public._velocity_enqueue(v); END LOOP; END $$;
SELECT public.rls_evaluate_once('set_velocity_jobs');
SELECT public.rls_evaluate_once('set_velocity_history');