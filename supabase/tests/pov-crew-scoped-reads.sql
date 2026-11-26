BEGIN;
-- Run after the migration in a privileged test transaction, never commit fixtures.
-- Test real read parity without exposing any account data in the output.
DO $test$
DECLARE
  actor uuid; target uuid; cid uuid; sid uuid := gen_random_uuid(); asid uuid := gen_random_uuid();
  actor_claims text; client_claims text; normal jsonb; preview jsonb; op text; args jsonb; pid uuid;
BEGIN
  SELECT user_id INTO actor FROM public.user_roles WHERE role::text='admin' LIMIT 1;
  SELECT c.id,c.user_id INTO cid,target FROM public.clients c WHERE c.user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=c.user_id AND r.role::text IN ('admin','coach','finance','media_manager'))
    ORDER BY CASE WHEN c.status::text='Active' THEN 0 ELSE 1 END LIMIT 1;
  IF actor IS NULL OR target IS NULL THEN RAISE EXCEPTION 'Missing eligible test fixtures'; END IF;
  actor_claims := jsonb_build_object('sub',actor,'role','authenticated','aal','aal2','session_id',asid)::text;
  client_claims := jsonb_build_object('sub',target,'role','authenticated')::text;
  INSERT INTO public.admin_pov_sessions(id,staff_user_id,client_id,target_user_id,reason,mode,expires_at,max_until,auth_session_id)
    VALUES(sid,actor,cid,target,'rollback parity verification','view',now()+interval '30 minutes',now()+interval '4 hours',asid);
  FOREACH op IN ARRAY ARRAY['feed','ranked','profile','post','follows','activity','follow_list','archived','saved_albums','saved_posts','reposts','crew_notices','direct_threads','crew_threads','chat_prefs','comments','reactors','hints','suggestions','people_search','follow_back','my_settings'] LOOP
    PERFORM set_config('request.jwt.claims',client_claims,true);
    PERFORM set_config('request.jwt.claim.sub',target::text,true);
    args := '{}'::jsonb;
    CASE op
      WHEN 'feed' THEN normal:=public.community_feed(5); args:=jsonb_build_object('_limit',5);
      WHEN 'ranked' THEN normal:=public.community_feed_ranked(5,NULL,now(),true); args:=jsonb_build_object('_limit',5,'_seen_before',now(),'_following',true);
      WHEN 'profile' THEN normal:=public.community_profile(target); args:=jsonb_build_object('_user_id',target);
      WHEN 'post' THEN
        pid := (public.community_feed(1)->'posts'->0->>'id')::uuid;
        IF pid IS NULL THEN RAISE EXCEPTION 'No visible post fixture'; END IF;
        normal:=public.community_post(pid); args:=jsonb_build_object('_post_id',pid);
      WHEN 'comments' THEN normal:=public.community_comments(pid); args:=jsonb_build_object('_post_id',pid);
      WHEN 'reactors' THEN normal:=public.community_post_reactors(pid); args:=jsonb_build_object('_post_id',pid);
      WHEN 'hints' THEN SELECT coalesce(jsonb_agg(hint),'[]'::jsonb) INTO normal FROM public.community_hints_seen WHERE user_id=target;
      WHEN 'suggestions' THEN normal:=public.community_suggestions(NULL,12);
      WHEN 'people_search' THEN normal:=public.community_people_search('a',20); args:=jsonb_build_object('_q','a');
      WHEN 'follow_back' THEN normal:=public.community_follow_back(30);
      WHEN 'my_settings' THEN normal:=public.community_my_settings();
      WHEN 'follows' THEN normal:=public.community_follow_state();
      WHEN 'activity' THEN normal:=public.community_activity();
      WHEN 'follow_list' THEN normal:=public.community_follow_list(target,'following'); args:=jsonb_build_object('_user_id',target,'_kind','following');
      WHEN 'archived' THEN normal:=public.community_my_archived();
      WHEN 'saved_albums' THEN normal:=public.community_saved_albums(NULL);
      WHEN 'saved_posts' THEN normal:=public.community_saved_posts(NULL,24,NULL,NULL);
      WHEN 'reposts' THEN normal:=public.community_user_reposts(target,24,NULL,NULL); args:=jsonb_build_object('_user_id',target);
      WHEN 'crew_notices' THEN
        SELECT coalesce(jsonb_agg(n || jsonb_build_object('unread',NOT EXISTS (SELECT 1 FROM public.notification_state st WHERE st.user_id=target AND st.kind='community' AND st.source_id=n->>'anchor' AND st.read_at >= (n->>'at')::timestamptz))),'[]'::jsonb) INTO normal
        FROM jsonb_array_elements(coalesce(public.community_my_notifications(),'[]'::jsonb)) AS n;
      WHEN 'direct_threads' THEN normal:=public.chat_direct_threads();
      WHEN 'crew_threads' THEN normal:=public.chat_crew_threads();
      WHEN 'chat_prefs' THEN SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) INTO normal FROM (SELECT thread_key,pinned_at,muted,hidden_at,unread_at FROM public.chat_thread_prefs WHERE user_id=target) p;
    END CASE;
    PERFORM set_config('request.jwt.claims',actor_claims,true);
    PERFORM set_config('request.jwt.claim.sub',actor::text,true);
    preview:=public.admin_pov_crew_read(sid,op,args);
    IF normal IS DISTINCT FROM preview THEN RAISE EXCEPTION 'Parity mismatch in %',op; END IF;
    IF auth.uid() IS DISTINCT FROM actor OR current_setting('request.jwt.claims',true) IS DISTINCT FROM actor_claims THEN RAISE EXCEPTION 'Staff claims not restored'; END IF;
  END LOOP;
  preview:=public.admin_pov_crew_read(sid,'member_access');
  IF (preview->'member'->>'id') IS DISTINCT FROM (SELECT id::text FROM public.app_members WHERE user_id=target LIMIT 1) THEN RAISE EXCEPTION 'Membership target mismatch'; END IF;
  preview:=public.admin_pov_crew_read(sid,'nav_data');
  IF preview->'client'->>'id' IS DISTINCT FROM cid::text THEN RAISE EXCEPTION 'Nav target mismatch'; END IF;
  BEGIN
    PERFORM public.admin_pov_crew_read(sid,'arbitrary_write','{}'::jsonb);
    RAISE EXCEPTION 'Unknown read accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims',jsonb_set(actor_claims::jsonb,'{session_id}',to_jsonb(gen_random_uuid()))::text,true);
  BEGIN
    PERFORM public.admin_pov_crew_read(sid,'follows');
    RAISE EXCEPTION 'Wrong auth session accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims',client_claims,true);
  PERFORM set_config('request.jwt.claim.sub',target::text,true);
  BEGIN
    PERFORM public.admin_pov_crew_read(sid,'follows');
    RAISE EXCEPTION 'Wrong actor accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims',actor_claims,true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  UPDATE public.admin_pov_sessions SET expires_at=now()-interval '1 minute' WHERE id=sid;
  BEGIN
    PERFORM public.admin_pov_crew_read(sid,'follows');
    RAISE EXCEPTION 'Expired session accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.admin_pov_sessions SET expires_at=now()+interval '10 minutes',ended_at=now() WHERE id=sid;
  BEGIN
    PERFORM public.admin_pov_crew_read(sid,'follows');
    RAISE EXCEPTION 'Ended session accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;
ROLLBACK;
