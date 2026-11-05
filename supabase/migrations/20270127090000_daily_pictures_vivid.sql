-- Daily pictures, the vivid look (daily-visuals.ts FILM_LOOK_VERSION 'film_v2'):
-- colourful, crisp, hand-drawn 2D animated-film frames in two art directions
-- (concept.art: 'graphic' = A vibrant graphic 2D, 'anime' = B cinematic 2D
-- anime), vivid colour and light (concept.light), and the review failing
-- anything muted, dark or soft (review.colour / review.clarity).
--
-- The coach can give one style reference per art direction (Crew → Posts →
-- Daily pictures → Style references): an image he uploads under his own
-- folder, stored in community_series_settings.daily_visuals_refs, handed to
-- the image model to match and to the review to judge against.
--
-- Existing days move to the new look only when the coach approves it from the
-- card (community_daily_visuals_restyle: their pictures remade with their
-- captions kept, each before kept as a version); new days are made in it.

-- ── the shots: + group and in action, the phone shot retired ──────────────
ALTER TABLE public.community_daily_visuals DROP CONSTRAINT IF EXISTS community_daily_visuals_style_check;
ALTER TABLE public.community_daily_visuals ADD CONSTRAINT community_daily_visuals_style_check CHECK (style IS NULL OR style IN (
  'wide_moment', 'medium_candid', 'two_people', 'group', 'in_action', 'close_detail', 'over_shoulder', 'low_angle',
  'framed_view', 'backlit', 'overhead', 'two_frames',
  -- earlier looks, kept for their history
  'phone_story', 'cinematic_photo', 'minimal_illustration', 'pencil_sketch', 'ink_drawing', 'watercolor', 'vintage_fitness',
  'editorial_illustration', 'conceptual', 'comic', 'typography', 'mixed_media', 'graphic_design', 'photo', 'illustration'));

-- ── style references ───────────────────────────────────────────────────────
ALTER TABLE public.community_series_settings ADD COLUMN IF NOT EXISTS daily_visuals_refs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One reference per art direction: a picture the coach uploaded under his own
-- folder of the Crew bucket (null clears it).
CREATE OR REPLACE FUNCTION public.community_daily_visuals_set_ref(_art text, _path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_path text := nullif(btrim(coalesce(_path, '')), '');
  v_refs jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _art NOT IN ('graphic', 'anime') THEN RAISE EXCEPTION 'Unknown art direction'; END IF;
  IF v_path IS NOT NULL AND (v_path NOT LIKE ((SELECT auth.uid())::text || '/%') OR v_path LIKE '%..%') THEN
    RAISE EXCEPTION 'Upload the picture first';
  END IF;
  UPDATE public.community_series_settings s
     SET daily_visuals_refs = CASE WHEN v_path IS NULL THEN s.daily_visuals_refs - _art
                                   ELSE s.daily_visuals_refs || jsonb_build_object(_art, v_path) END,
         updated_at = now()
   WHERE id
  RETURNING daily_visuals_refs INTO v_refs;
  RETURN coalesce(v_refs, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_set_ref(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_set_ref(text, text) TO authenticated;

-- ── approve the look: every day not in it gets its picture remade ─────────
-- (its caption kept; the before kept as a version, reason 'restyle').
CREATE OR REPLACE FUNCTION public.community_daily_visuals_restyle(_look text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(_look), '') = '' THEN RAISE EXCEPTION 'Which look?'; END IF;
  UPDATE public.community_daily_visuals
     SET regen = 'picture', regen_reason = 'restyle', regen_style = NULL, candidate = NULL, attempts = 0, error = NULL,
         approved_at = NULL, updated_at = now()
   WHERE status IN ('ready', 'posted') AND picture IS NOT NULL AND regen IS NULL
     AND coalesce(concept->>'look', '') <> _look;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN PERFORM public.community_daily_visuals_kick(true); END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_restyle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_restyle(text) TO authenticated;

-- ── the coach's view: + the references, each day's look and art ──────────
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
    'refs', coalesce((SELECT daily_visuals_refs FROM public.community_series_settings WHERE id), '{}'::jsonb),
    'today', v_today,
    'learned', (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_learned'),
    'maker', (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_status'),
    'tests', coalesce((
      SELECT jsonb_agg(t.data || jsonb_build_object('id', t.id, 'at', t.created_at) ORDER BY t.created_at DESC)
        FROM (SELECT * FROM public.community_daily_visual_tests ORDER BY created_at DESC LIMIT 9) t), '[]'::jsonb),
    'days', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'day', v.day, 'theme', v.theme, 'audience', v.audience, 'faith', v.faith,
               'style', v.style, 'light', v.concept->>'light', 'art', v.concept->>'art', 'look', v.concept->>'look',
               'format', v.format, 'topic', v.topic,
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

-- ── the coach's changes: the shots he can pick now ────────────────────────
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
    IF v_style IS NOT NULL AND v_style NOT IN ('wide_moment', 'medium_candid', 'two_people', 'group', 'in_action', 'close_detail',
        'over_shoulder', 'low_angle', 'framed_view', 'backlit', 'overhead', 'two_frames') THEN
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
