-- Daily pictures: one look, a still frame from a premium hand-drawn 2D
-- animated film (daily-visuals.ts FILM_LOOK / FILM_AVOID), never a 3D render,
-- a photo or vector clip art; the review names what each picture actually is
-- and anything but hand-drawn 2D fails. Variety comes from the moment, the
-- shot (stored in `style`: wide_moment … phone_story) and the light
-- (concept.light), never from switching media.
--
-- Test posts (the daily-visuals-tick hook's { test: … }) run the whole
-- pipeline and land in community_daily_visual_tests for the coach's card,
-- never on a day or in the feed.
--
-- Every day there is gets its picture remade in the 2D film look with its
-- caption kept (versions keep what each had, reason 'restyle'); Nov 5 is
-- made whole again (its last line didn't read right).

-- ── the shots ──────────────────────────────────────────────────────────────
ALTER TABLE public.community_daily_visuals DROP CONSTRAINT IF EXISTS community_daily_visuals_style_check;
ALTER TABLE public.community_daily_visuals ADD CONSTRAINT community_daily_visuals_style_check CHECK (style IS NULL OR style IN (
  'wide_moment', 'medium_candid', 'two_people', 'close_detail', 'over_shoulder', 'low_angle', 'framed_view', 'backlit',
  'overhead', 'two_frames', 'phone_story',
  -- earlier looks, kept for their history
  'cinematic_photo', 'minimal_illustration', 'pencil_sketch', 'ink_drawing', 'watercolor', 'vintage_fitness',
  'editorial_illustration', 'conceptual', 'comic', 'typography', 'mixed_media', 'graphic_design', 'photo', 'illustration'));

-- ── test posts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_daily_visual_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_daily_visual_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read daily picture tests" ON public.community_daily_visual_tests;
CREATE POLICY "Staff read daily picture tests" ON public.community_daily_visual_tests
  FOR SELECT TO authenticated USING ((SELECT public.is_community_staff()));
REVOKE INSERT, UPDATE, DELETE ON public.community_daily_visual_tests FROM anon, authenticated;

-- ── the coach's view: + the light, the look and the latest tests ─────────
CREATE OR REPLACE FUNCTION public.community_daily_visuals_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'on', coalesce((SELECT daily_visuals_on FROM public.community_series_settings WHERE id), true),
    'paused', coalesce((SELECT paused FROM public.community_series_settings WHERE id), false),
    'lovable', coalesce((SELECT daily_visuals_lovable FROM public.community_series_settings WHERE id), false),
    'today', v_today,
    'learned', (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_learned'),
    'maker', (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_status'),
    'tests', coalesce((
      SELECT jsonb_agg(t.data || jsonb_build_object('id', t.id, 'at', t.created_at) ORDER BY t.created_at DESC)
        FROM (SELECT * FROM public.community_daily_visual_tests ORDER BY created_at DESC LIMIT 9) t), '[]'::jsonb),
    'days', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'day', v.day, 'theme', v.theme, 'audience', v.audience, 'faith', v.faith,
               'style', v.style, 'light', v.concept->>'light', 'format', v.format, 'topic', v.topic,
               'message', v.concept->>'message', 'situation', v.concept->>'situation',
               'line', coalesce(nullif(btrim(v.coach_line), ''), v.ai_line), 'own', nullif(btrim(v.coach_line), '') IS NOT NULL,
               'verse_ref', v.verse_ref, 'verse_text', v.verse_text, 'picture', v.picture->>'path',
               'review', v.review, 'status', v.status, 'error', v.error, 'post_id', v.post_id,
               'regen', v.regen, 'regen_style', v.regen_style, 'working', v.candidate IS NOT NULL,
               'step', CASE WHEN v.candidate IS NULL THEN NULL WHEN v.candidate ? 'caption' THEN 'picture' ELSE 'concept' END,
               'approved', v.approved_at IS NOT NULL, 'made_at', v.made_at,
               'versions', (SELECT count(*) FROM public.community_daily_visual_versions x WHERE x.visual_id = v.id),
               'likes', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r WHERE r.post_id = v.post_id) END,
               'comments', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(*) FROM public.community_comments c WHERE c.post_id = v.post_id AND c.hidden_at IS NULL) END,
               'views', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(DISTINCT pv.viewer_user_id) FROM public.community_post_views pv WHERE pv.post_id = v.post_id) END
             ) ORDER BY v.day)
        FROM public.community_daily_visuals v
       WHERE v.day BETWEEN v_today - 13 AND v_today + 6), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_overview() TO authenticated;

-- ── the coach's changes: the shot he picks is one of the 2D film shots ───
CREATE OR REPLACE FUNCTION public.community_daily_visual_act(_id uuid, _action text, _line text DEFAULT NULL, _style text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.community_daily_visuals;
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_line text := nullif(btrim(coalesce(_line, '')), '');
  v_action text := CASE WHEN _action = 'words' THEN 'caption' ELSE _action END;
  v_style text := nullif(btrim(coalesce(_style, '')), '');
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.community_daily_visuals WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That day isn''t planned'; END IF;

  IF v_action = 'post' THEN
    IF r.day <> v_today THEN RAISE EXCEPTION 'Only today''s can go out early'; END IF;
    RETURN public.community_daily_visual_post(r.day, false);
  END IF;

  IF v_action IN ('full', 'caption', 'picture', 'reject') THEN
    IF r.status = 'skipped' THEN RAISE EXCEPTION 'Bring the day back first'; END IF;
    IF v_style IS NOT NULL AND v_style NOT IN ('wide_moment', 'medium_candid', 'two_people', 'close_detail', 'over_shoulder',
        'low_angle', 'framed_view', 'backlit', 'overhead', 'two_frames', 'phone_story') THEN
      RAISE EXCEPTION 'Unknown shot';
    END IF;
    IF v_action = 'caption' AND r.picture IS NULL THEN v_action := 'full'; END IF;
    UPDATE public.community_daily_visuals v SET
      regen = CASE WHEN v_action = 'reject' THEN 'full' ELSE v_action END,
      regen_style = CASE WHEN v_action = 'caption' THEN NULL ELSE v_style END,
      regen_reason = CASE WHEN v_action = 'reject' THEN 'rejected' ELSE 'coach' END,
      candidate = NULL, attempts = 0, error = NULL, approved_at = NULL, approved_by = NULL,
      status = CASE WHEN v.status = 'failed' THEN 'planned' ELSE v.status END,
      updated_at = now()
     WHERE v.id = r.id;
    PERFORM public.community_daily_visuals_kick(true);
    RETURN jsonb_build_object('status', 'queued');
  END IF;

  IF v_action = 'line' THEN
    IF v_line IS NOT NULL AND char_length(v_line) > 600 THEN RAISE EXCEPTION 'Keep it under 600 characters'; END IF;
    PERFORM set_config('jf.daily_visual_reason', 'edited', true);
    UPDATE public.community_daily_visuals v SET
      coach_line = v_line,
      status = CASE WHEN v.status IN ('planned', 'failed') AND coalesce(v_line, v.ai_line) IS NOT NULL AND v.picture IS NOT NULL
                    THEN 'ready' ELSE v.status END,
      updated_at = now()
     WHERE v.id = r.id
    RETURNING * INTO r;
    PERFORM public.community_daily_visual_sync_post(r.id);
    RETURN jsonb_build_object('status', r.status);
  END IF;

  IF v_action IN ('approve', 'unapprove') THEN
    UPDATE public.community_daily_visuals v SET
      approved_at = CASE WHEN v_action = 'approve' THEN now() END,
      approved_by = CASE WHEN v_action = 'approve' THEN auth.uid() END,
      updated_at = now()
     WHERE v.id = r.id
    RETURNING * INTO r;
    RETURN jsonb_build_object('status', r.status, 'approved', r.approved_at IS NOT NULL);
  END IF;

  IF v_action = 'skip' THEN
    IF r.status = 'posted' THEN RAISE EXCEPTION 'Already posted. Archive it from the post instead.'; END IF;
    UPDATE public.community_daily_visuals SET status = 'skipped', updated_at = now() WHERE id = r.id;
    RETURN jsonb_build_object('status', 'skipped');
  END IF;

  IF v_action = 'unskip' THEN
    UPDATE public.community_daily_visuals v SET
      status = CASE WHEN v.picture IS NOT NULL AND coalesce(nullif(btrim(v.coach_line), ''), v.ai_line) IS NOT NULL THEN 'ready' ELSE 'planned' END,
      regen = CASE WHEN v.picture IS NULL OR coalesce(nullif(btrim(v.coach_line), ''), v.ai_line) IS NULL THEN 'full' ELSE v.regen END,
      regen_reason = coalesce(v.regen_reason, 'new'),
      attempts = 0, error = NULL, updated_at = now()
     WHERE v.id = r.id AND v.status IN ('skipped', 'failed')
    RETURNING * INTO r;
    PERFORM public.community_daily_visuals_kick(true);
    RETURN jsonb_build_object('status', r.status);
  END IF;

  RAISE EXCEPTION 'Unknown change';
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_act(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visual_act(uuid, text, text, text) TO authenticated;

-- ── every day there is: its picture remade in the 2D film look ───────────
-- (applied once the test posts passed). The caption stays; Nov 5 is made
-- whole again. Days not made yet are already queued whole.
UPDATE public.community_daily_visuals
   SET regen = CASE WHEN day = date '2026-11-05' THEN 'full' ELSE 'picture' END,
       regen_reason = 'restyle', regen_style = NULL, candidate = NULL, attempts = 0, error = NULL, approved_at = NULL,
       updated_at = now()
 WHERE status IN ('ready', 'posted') AND picture IS NOT NULL
   AND coalesce(concept->>'look', '') <> '2d_film';
