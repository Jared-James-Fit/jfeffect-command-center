-- ── Logging Level expansion: more point sources, bigger catalog, server-side unseen reveals ──

-- 1. Seen/acknowledged state must be protected (policies existed but RLS was off).
ALTER TABLE public.athlete_achievement_views ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.athlete_achievement_views TO authenticated;
GRANT ALL ON public.athlete_achievement_views TO service_role;

-- 2. Catalog: generic event-count metric + legacy metrics.
ALTER TABLE public.athlete_badge_catalog ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE public.athlete_badge_catalog DROP CONSTRAINT IF EXISTS athlete_badge_catalog_metric_check;
ALTER TABLE public.athlete_badge_catalog ADD CONSTRAINT athlete_badge_catalog_metric_check CHECK (metric = ANY (ARRAY[
  'workouts_completed','workouts_fully_logged','xp','days_since_first_workout',
  'event_count','tracking_weeks','legacy_og','legacy_founding']));

-- 3. Helpers
CREATE OR REPLACE FUNCTION public.xp_client_for_user(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.clients WHERE user_id = _uid
  ORDER BY COALESCE(archived,false), created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.award_athlete_xp(
  _client uuid, _type text, _src_table text, _src_id uuid, _key text, _xp int, _label text, _at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _client IS NULL OR _key IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client) THEN RETURN; END IF;
  INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
  VALUES (_client, _type, _src_table, _src_id, _key, _xp, _label, COALESCE(_at, now()))
  ON CONFLICT DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION public.award_athlete_xp(uuid,text,text,uuid,text,int,text,timestamptz) FROM PUBLIC, anon, authenticated;

-- 4. Source triggers. Keys are per record / per day / per ISO week so edits and
--    repeat entries can never farm points. Failures never block the source write.
CREATE OR REPLACE FUNCTION public.xp_on_workout_feedback() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.award_athlete_xp(NEW.client_id, 'workout_review', 'pl_workout_feedback', NEW.id,
    'workout_review:' || COALESCE(NEW.completion_id, NEW.id)::text, 15, 'Submitted a workout review',
    COALESCE(NEW.review_submitted_at, NEW.created_at));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'xp_on_workout_feedback: %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xp_workout_feedback ON public.pl_workout_feedback;
CREATE TRIGGER trg_xp_workout_feedback AFTER INSERT ON public.pl_workout_feedback
FOR EACH ROW EXECUTE FUNCTION public.xp_on_workout_feedback();

CREATE OR REPLACE FUNCTION public.xp_on_messenger_checkin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _at timestamptz;
BEGIN
  IF NEW.status = 'completed' AND NEW.task_type = 'weekly_checkin' THEN
    _at := COALESCE(NEW.submitted_at, NEW.updated_at, now());
    PERFORM public.award_athlete_xp(NEW.client_id, 'weekly_checkin', 'messenger_checkins', NEW.id,
      'weekly_checkin:' || to_char(_at, 'IYYY-IW'), 75, 'Completed a weekly check-in', _at);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'xp_on_messenger_checkin: %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xp_messenger_checkin ON public.messenger_checkins;
CREATE TRIGGER trg_xp_messenger_checkin AFTER INSERT OR UPDATE OF status ON public.messenger_checkins
FOR EACH ROW EXECUTE FUNCTION public.xp_on_messenger_checkin();

CREATE OR REPLACE FUNCTION public.xp_on_progress_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _at timestamptz; _t text;
BEGIN
  IF NEW.owner_type::text = 'client' AND NEW.client_id IS NOT NULL AND NEW.review_status::text <> 'draft' THEN
    _at := COALESCE(NEW.submitted_at, NEW.created_at);
    _t := CASE WHEN NEW.submission_type::text = 'video' THEN 'progress_video' ELSE 'progress_photo' END;
    PERFORM public.award_athlete_xp(NEW.client_id, _t, 'progress_submissions', NEW.id,
      _t || ':' || to_char(_at, 'IYYY-IW'),
      CASE WHEN _t = 'progress_video' THEN 60 ELSE 50 END,
      CASE WHEN _t = 'progress_video' THEN 'Submitted a progress video' ELSE 'Submitted progress photos' END, _at);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'xp_on_progress_submission: %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xp_progress_submission ON public.progress_submissions;
CREATE TRIGGER trg_xp_progress_submission AFTER INSERT OR UPDATE OF review_status ON public.progress_submissions
FOR EACH ROW EXECUTE FUNCTION public.xp_on_progress_submission();

CREATE OR REPLACE FUNCTION public.xp_on_lift_video() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.award_athlete_xp(NEW.client_id, 'lift_video', 'lift_videos', NEW.id,
    'lift_video:' || to_char(NEW.created_at, 'YYYY-MM-DD'), 25, 'Sent a lift for review', NEW.created_at);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'xp_on_lift_video: %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xp_lift_video ON public.lift_videos;
CREATE TRIGGER trg_xp_lift_video AFTER INSERT ON public.lift_videos
FOR EACH ROW EXECUTE FUNCTION public.xp_on_lift_video();

CREATE OR REPLACE FUNCTION public.xp_on_bodyweight() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _client uuid; _d date;
BEGIN
  IF TG_TABLE_NAME = 'progress_bodyweight' THEN
    _client := public.xp_client_for_user(NEW.user_id); _d := NEW.logged_date;
  ELSE
    IF NEW.bodyweight IS NULL THEN RETURN NEW; END IF;
    _client := NEW.client_id; _d := NEW.entry_date;
  END IF;
  PERFORM public.award_athlete_xp(_client, 'bodyweight', TG_TABLE_NAME, NEW.id,
    'bodyweight:' || _d::text, 5, 'Logged bodyweight', (_d + time '12:00') AT TIME ZONE 'UTC');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'xp_on_bodyweight: %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xp_bodyweight ON public.progress_bodyweight;
CREATE TRIGGER trg_xp_bodyweight AFTER INSERT ON public.progress_bodyweight
FOR EACH ROW EXECUTE FUNCTION public.xp_on_bodyweight();
DROP TRIGGER IF EXISTS trg_xp_metrics_bodyweight ON public.progress_metrics;
CREATE TRIGGER trg_xp_metrics_bodyweight AFTER INSERT OR UPDATE OF bodyweight ON public.progress_metrics
FOR EACH ROW EXECUTE FUNCTION public.xp_on_bodyweight();

CREATE OR REPLACE FUNCTION public.xp_on_water() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _client uuid; _total int; _target int; _at timestamptz;
BEGIN
  _client := public.xp_client_for_user(NEW.user_id);
  IF _client IS NULL THEN RETURN NEW; END IF;
  _at := (NEW.entry_date + time '12:00') AT TIME ZONE 'UTC';
  PERFORM public.award_athlete_xp(_client, 'water_logged', 'progress_water_entries', NEW.id,
    'water_logged:' || NEW.entry_date::text, 2, 'Logged water', _at);
  SELECT COALESCE(sum(amount_ml),0) INTO _total FROM public.progress_water_entries
    WHERE user_id = NEW.user_id AND entry_date = NEW.entry_date;
  SELECT COALESCE(active_ml, suggested_ml) INTO _target FROM public.progress_water_targets WHERE user_id = NEW.user_id;
  IF _target IS NOT NULL AND _target > 0 AND _total >= _target THEN
    PERFORM public.award_athlete_xp(_client, 'water_target', 'progress_water_entries', NEW.id,
      'water_target:' || NEW.entry_date::text, 5, 'Hit water target', _at);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'xp_on_water: %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xp_water ON public.progress_water_entries;
CREATE TRIGGER trg_xp_water AFTER INSERT ON public.progress_water_entries
FOR EACH ROW EXECUTE FUNCTION public.xp_on_water();

CREATE OR REPLACE FUNCTION public.xp_on_measurement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.award_athlete_xp(public.xp_client_for_user(NEW.user_id), 'measurement', 'progress_measurements', NEW.id,
    'measurement:' || to_char(NEW.measured_date, 'IYYY-IW'), 20, 'Logged body measurements',
    (NEW.measured_date + time '12:00') AT TIME ZONE 'UTC');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'xp_on_measurement: %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xp_measurement ON public.progress_measurements;
CREATE TRIGGER trg_xp_measurement AFTER INSERT ON public.progress_measurements
FOR EACH ROW EXECUTE FUNCTION public.xp_on_measurement();

-- 5. Achievement sync (generalised). Legacy cutoffs are fixed dates: JF Effect
--    Command launched in June 2026, so nobody joining later can qualify.
CREATE OR REPLACE FUNCTION public.sync_athlete_achievements(_client_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.athlete_achievements (client_id, badge_key, earned_at)
  SELECT _client_id, b.badge_key, e.met_at
  FROM public.athlete_badge_catalog b
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN b.metric IN ('workouts_completed','workouts_fully_logged','event_count') THEN (
        SELECT x.occurred_at FROM (
          SELECT occurred_at, row_number() OVER (ORDER BY occurred_at, id) AS rn
          FROM public.athlete_xp_events
          WHERE client_id = _client_id AND event_type = CASE b.metric
            WHEN 'workouts_completed' THEN 'workout_completed'
            WHEN 'workouts_fully_logged' THEN 'workout_fully_logged'
            ELSE b.event_type END
        ) x WHERE x.rn = b.threshold)
      WHEN b.metric = 'xp' THEN (
        SELECT min(x.occurred_at) FROM (
          SELECT occurred_at, sum(xp) OVER (ORDER BY occurred_at, id) AS running
          FROM public.athlete_xp_events WHERE client_id = _client_id
        ) x WHERE x.running >= b.threshold)
      WHEN b.metric = 'days_since_first_workout' THEN (
        SELECT min(occurred_at) + make_interval(days => b.threshold)
        FROM public.athlete_xp_events WHERE client_id = _client_id AND event_type = 'workout_completed')
      WHEN b.metric = 'tracking_weeks' THEN (
        SELECT w.first_at FROM (
          SELECT min(occurred_at) AS first_at, row_number() OVER (ORDER BY min(occurred_at)) AS rn
          FROM public.athlete_xp_events WHERE client_id = _client_id
          GROUP BY date_trunc('week', occurred_at)
        ) w WHERE w.rn = b.threshold)
      WHEN b.metric = 'legacy_og' THEN (
        SELECT c.created_at FROM public.clients c
        WHERE c.id = _client_id AND c.created_at < timestamptz '2026-07-01 00:00:00+00')
      WHEN b.metric = 'legacy_founding' THEN (
        SELECT min(occurred_at) FROM public.athlete_xp_events
        WHERE client_id = _client_id AND event_type = 'workout_completed'
        HAVING min(occurred_at) < timestamptz '2026-07-01 00:00:00+00')
    END AS met_at
  ) e
  WHERE b.is_active AND e.met_at IS NOT NULL AND e.met_at <= now()
  ON CONFLICT (client_id, badge_key) DO NOTHING;
END $$;

-- 6. Catalog rows (reference data; upsert keeps this idempotent).
INSERT INTO public.athlete_badge_catalog
  (badge_key, name, category, icon_key, rarity, description, requirement, metric, event_type, threshold, is_public, is_active, sort_order)
VALUES
  ('first_fully_logged','Every Set Counts','first steps','notebook','common','You logged every set of a workout.','Fully log 1 workout','workouts_fully_logged',NULL,1,true,true,12),
  ('first_review','Honest Feedback','first steps','message','common','You told your coach how a session went.','Submit 1 workout review','event_count','workout_review',1,true,true,13),
  ('first_checkin','Checked In','first steps','clipboard','common','Your first weekly check-in is in.','Complete 1 weekly check-in','event_count','weekly_checkin',1,true,true,14),
  ('first_photo','Snapshot','first steps','camera','common','You started your visual progress history.','Submit 1 progress photo check-in','event_count','progress_photo',1,true,true,15),
  ('first_video','On Camera','first steps','video','common','You submitted your first progress video.','Submit 1 progress video check-in','event_count','progress_video',1,true,true,16),
  ('first_lift_video','Form Check','first steps','video','common','You sent a lift to your coach for review.','Send 1 lift video','event_count','lift_video',1,true,true,17),
  ('first_bodyweight','On the Scale','first steps','scale','common','Your first bodyweight is logged.','Log bodyweight once','event_count','bodyweight',1,true,true,18),
  ('first_water','First Sip','first steps','droplet','common','You started tracking hydration.','Log water once','event_count','water_logged',1,true,true,19),
  ('first_water_target','Hydrated','first steps','droplet','common','You hit your daily water target.','Hit your water target once','event_count','water_target',1,true,true,21),
  ('first_measurement','Measured Up','first steps','ruler','common','You logged your first body measurements.','Log measurements once','event_count','measurement',1,true,true,22),

  ('workouts_500','500 Workout Club','prestige','trophy','legendary','Five hundred completed sessions. Rare air.','Complete 500 workouts','workouts_completed',NULL,500,true,true,62),
  ('workouts_1000','1000 Workout Club','prestige','gem','legendary','A thousand sessions logged in JF Effect.','Complete 1,000 workouts','workouts_completed',NULL,1000,true,true,64),
  ('logged_500','Legend Logger','prestige','gem','legendary','Five hundred fully logged workouts.','Fully log 500 workouts','workouts_fully_logged',NULL,500,true,true,95),

  ('reviews_10','Open Book','feedback','message','common','Ten workout reviews submitted.','Submit 10 workout reviews','event_count','workout_review',10,true,true,160),
  ('reviews_50','Coach''s Favourite','feedback','message','rare','Fifty workout reviews submitted.','Submit 50 workout reviews','event_count','workout_review',50,true,true,161),
  ('reviews_150','Feedback Machine','feedback','message','epic','One hundred fifty workout reviews.','Submit 150 workout reviews','event_count','workout_review',150,true,true,162),

  ('checkins_4','Monthly Rhythm','check-ins','clipboard','common','Four weekly check-ins completed.','Complete 4 weekly check-ins','event_count','weekly_checkin',4,true,true,170),
  ('checkins_12','Quarter Committed','check-ins','clipboard','rare','Twelve weekly check-ins completed.','Complete 12 weekly check-ins','event_count','weekly_checkin',12,true,true,171),
  ('checkins_26','Half-Year Honest','check-ins','clipboard','epic','Twenty-six weekly check-ins completed.','Complete 26 weekly check-ins','event_count','weekly_checkin',26,true,true,172),
  ('checkins_52','Year of Check-Ins','check-ins','crown','legendary','A full year of weekly check-ins.','Complete 52 weekly check-ins','event_count','weekly_checkin',52,true,true,173),

  ('photos_4','Picture the Progress','progress','camera','common','Photo check-ins in four different weeks.','Submit photos in 4 different weeks','event_count','progress_photo',4,true,true,180),
  ('photos_12','Visual Timeline','progress','camera','rare','Photo check-ins in twelve different weeks.','Submit photos in 12 different weeks','event_count','progress_photo',12,true,true,181),
  ('photos_26','Transformation Archive','progress','camera','epic','Photo check-ins in twenty-six different weeks.','Submit photos in 26 different weeks','event_count','progress_photo',26,true,true,182),
  ('videos_4','Director''s Cut','progress','video','rare','Progress videos in four different weeks.','Submit videos in 4 different weeks','event_count','progress_video',4,true,true,183),
  ('videos_12','Feature Film','progress','video','epic','Progress videos in twelve different weeks.','Submit videos in 12 different weeks','event_count','progress_video',12,true,true,184),
  ('lift_videos_10','Film Study','progress','video','rare','Lift videos sent on ten different days.','Send lift videos on 10 different days','event_count','lift_video',10,true,true,185),
  ('measure_5','Tape Measure Regular','progress','ruler','rare','Measurements logged in five different weeks.','Log measurements in 5 different weeks','event_count','measurement',5,true,true,186),

  ('bw_10','Scale Regular','tracking','scale','common','Bodyweight logged on ten days.','Log bodyweight on 10 days','event_count','bodyweight',10,true,true,190),
  ('bw_30','Data Driven','tracking','scale','rare','Bodyweight logged on thirty days.','Log bodyweight on 30 days','event_count','bodyweight',30,true,true,191),
  ('bw_100','Trend Master','tracking','chart','epic','Bodyweight logged on one hundred days.','Log bodyweight on 100 days','event_count','bodyweight',100,true,true,192),
  ('bw_365','Year on the Scale','tracking','crown','legendary','Bodyweight logged on 365 days.','Log bodyweight on 365 days','event_count','bodyweight',365,true,true,193),
  ('water_7','Hydration Habit','hydration','droplet','common','Water logged on seven days.','Log water on 7 days','event_count','water_logged',7,true,true,200),
  ('water_30','Well Watered','hydration','droplet','rare','Water logged on thirty days.','Log water on 30 days','event_count','water_logged',30,true,true,201),
  ('water_target_7','Target Hit x7','hydration','droplet','common','Water target hit on seven days.','Hit your water target on 7 days','event_count','water_target',7,true,true,202),
  ('water_target_30','Hydration Pro','hydration','droplet','rare','Water target hit on thirty days.','Hit your water target on 30 days','event_count','water_target',30,true,true,203),
  ('water_target_100','Hydration Elite','hydration','droplet','epic','Water target hit on one hundred days.','Hit your water target on 100 days','event_count','water_target',100,true,true,204),

  ('weeks_4','Four-Week Foundation','consistency','calendar','common','You tracked something in four different weeks.','Earn points in 4 different weeks','tracking_weeks',NULL,4,true,true,210),
  ('weeks_12','Twelve-Week Tracker','consistency','calendar','rare','Twelve different weeks of tracking.','Earn points in 12 different weeks','tracking_weeks',NULL,12,true,true,211),
  ('weeks_26','Half-Year Tracker','consistency','calendar','epic','Twenty-six different weeks of tracking.','Earn points in 26 different weeks','tracking_weeks',NULL,26,true,true,212),
  ('weeks_52','52-Week Legacy','consistency','crown','legendary','A full year of weeks with tracked history.','Earn points in 52 different weeks','tracking_weeks',NULL,52,true,true,213),

  ('two_year_club','Two Year Club','tenure','gem','legendary','Two years since your first JF Effect workout.','730 days since your first workout','days_since_first_workout',NULL,730,true,true,155),

  ('og','OG','legacy','flame','legendary','Here from the very beginning of JF Effect Command.','Client account created before July 1, 2026 (launch month). Can no longer be earned.','legacy_og',NULL,1,true,true,300),
  ('founding_athlete','Founding Athlete','legacy','trophy','legendary','Trained in the app during its launch month.','Completed a workout in the app before July 1, 2026. Can no longer be earned.','legacy_founding',NULL,1,true,true,301)
ON CONFLICT (badge_key) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, icon_key = EXCLUDED.icon_key, rarity = EXCLUDED.rarity,
  description = EXCLUDED.description, requirement = EXCLUDED.requirement, metric = EXCLUDED.metric,
  event_type = EXCLUDED.event_type, threshold = EXCLUDED.threshold, is_public = EXCLUDED.is_public,
  is_active = EXCLUDED.is_active, sort_order = EXCLUDED.sort_order;

UPDATE public.athlete_badge_catalog SET name = 'Year One' WHERE badge_key = 'year_one';

-- 7. Historical backfill (idempotent: unique source keys + ON CONFLICT DO NOTHING).
ALTER TABLE public.athlete_xp_events DISABLE TRIGGER trg_athlete_achievements_sync;

INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT f.client_id, 'workout_review', 'pl_workout_feedback', f.id, 'workout_review:' || COALESCE(f.completion_id, f.id)::text, 15,
  'Submitted a workout review', COALESCE(f.review_submitted_at, f.created_at)
FROM public.pl_workout_feedback f WHERE f.client_id IN (SELECT id FROM public.clients)
ON CONFLICT DO NOTHING;

INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT DISTINCT ON (m.client_id, to_char(COALESCE(m.submitted_at, m.updated_at), 'IYYY-IW'))
  m.client_id, 'weekly_checkin', 'messenger_checkins', m.id,
  'weekly_checkin:' || to_char(COALESCE(m.submitted_at, m.updated_at), 'IYYY-IW'), 75, 'Completed a weekly check-in',
  COALESCE(m.submitted_at, m.updated_at)
FROM public.messenger_checkins m
WHERE m.status = 'completed' AND m.task_type = 'weekly_checkin' AND m.client_id IN (SELECT id FROM public.clients)
ORDER BY m.client_id, to_char(COALESCE(m.submitted_at, m.updated_at), 'IYYY-IW'), COALESCE(m.submitted_at, m.updated_at)
ON CONFLICT DO NOTHING;

INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT DISTINCT ON (s.client_id, t, wk) s.client_id, t, 'progress_submissions', s.id, t || ':' || wk,
  CASE WHEN t = 'progress_video' THEN 60 ELSE 50 END,
  CASE WHEN t = 'progress_video' THEN 'Submitted a progress video' ELSE 'Submitted progress photos' END, at
FROM (
  SELECT ps.*, CASE WHEN ps.submission_type::text = 'video' THEN 'progress_video' ELSE 'progress_photo' END AS t,
    COALESCE(ps.submitted_at, ps.created_at) AS at, to_char(COALESCE(ps.submitted_at, ps.created_at), 'IYYY-IW') AS wk
  FROM public.progress_submissions ps
  WHERE ps.owner_type::text = 'client' AND ps.client_id IN (SELECT id FROM public.clients) AND ps.review_status::text <> 'draft'
) s
ORDER BY s.client_id, t, wk, at
ON CONFLICT DO NOTHING;

INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT DISTINCT ON (l.client_id, to_char(l.created_at, 'YYYY-MM-DD')) l.client_id, 'lift_video', 'lift_videos', l.id,
  'lift_video:' || to_char(l.created_at, 'YYYY-MM-DD'), 25, 'Sent a lift for review', l.created_at
FROM public.lift_videos l WHERE l.client_id IN (SELECT id FROM public.clients)
ORDER BY l.client_id, to_char(l.created_at, 'YYYY-MM-DD'), l.created_at
ON CONFLICT DO NOTHING;

INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT DISTINCT ON (client_id, d) client_id, 'bodyweight', src, id, 'bodyweight:' || d::text, 5, 'Logged bodyweight',
  (d + time '12:00') AT TIME ZONE 'UTC'
FROM (
  SELECT public.xp_client_for_user(b.user_id) AS client_id, b.logged_date AS d, 'progress_bodyweight' AS src, b.id, b.created_at
  FROM public.progress_bodyweight b
  UNION ALL
  SELECT pm.client_id, pm.entry_date, 'progress_metrics', pm.id, pm.created_at
  FROM public.progress_metrics pm WHERE pm.bodyweight IS NOT NULL
) x WHERE client_id IN (SELECT id FROM public.clients)
ORDER BY client_id, d, created_at
ON CONFLICT DO NOTHING;

INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT DISTINCT ON (c, w.entry_date) c, 'water_logged', 'progress_water_entries', w.id, 'water_logged:' || w.entry_date::text, 2,
  'Logged water', (w.entry_date + time '12:00') AT TIME ZONE 'UTC'
FROM (SELECT *, public.xp_client_for_user(user_id) AS c FROM public.progress_water_entries) w
WHERE c IS NOT NULL
ORDER BY c, w.entry_date, w.created_at
ON CONFLICT DO NOTHING;

INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT public.xp_client_for_user(d.user_id), 'water_target', 'progress_water_entries', d.last_id,
  'water_target:' || d.entry_date::text, 5, 'Hit water target', (d.entry_date + time '12:00') AT TIME ZONE 'UTC'
FROM (
  SELECT user_id, entry_date, sum(amount_ml) AS total, (array_agg(id ORDER BY created_at DESC))[1] AS last_id
  FROM public.progress_water_entries GROUP BY user_id, entry_date
) d
JOIN public.progress_water_targets t ON t.user_id = d.user_id
WHERE COALESCE(t.active_ml, t.suggested_ml) > 0 AND d.total >= COALESCE(t.active_ml, t.suggested_ml)
  AND public.xp_client_for_user(d.user_id) IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT DISTINCT ON (c, to_char(m.measured_date, 'IYYY-IW')) c, 'measurement', 'progress_measurements', m.id,
  'measurement:' || to_char(m.measured_date, 'IYYY-IW'), 20, 'Logged body measurements',
  (m.measured_date + time '12:00') AT TIME ZONE 'UTC'
FROM (SELECT *, public.xp_client_for_user(user_id) AS c FROM public.progress_measurements) m
WHERE c IS NOT NULL
ORDER BY c, to_char(m.measured_date, 'IYYY-IW'), m.created_at
ON CONFLICT DO NOTHING;

ALTER TABLE public.athlete_xp_events ENABLE TRIGGER trg_athlete_achievements_sync;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.clients LOOP PERFORM public.sync_athlete_achievements(r.id); END LOOP;
END $$;
-- NOTE: no rows are written to athlete_achievement_views here — every backfilled
-- achievement stays unseen until the athlete acknowledges it in the app.