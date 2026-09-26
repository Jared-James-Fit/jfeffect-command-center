CREATE TABLE IF NOT EXISTS public.athlete_badge_catalog (
  badge_key text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  icon_key text NOT NULL,
  rarity text NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
  description text NOT NULL,
  requirement text NOT NULL,
  metric text NOT NULL CHECK (metric IN ('workouts_completed','workouts_fully_logged','xp','days_since_first_workout')),
  threshold integer NOT NULL CHECK (threshold > 0),
  is_public boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.athlete_badge_catalog TO authenticated;
GRANT ALL ON public.athlete_badge_catalog TO service_role;
ALTER TABLE public.athlete_badge_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Catalog readable by authenticated" ON public.athlete_badge_catalog;
CREATE POLICY "Catalog readable by authenticated" ON public.athlete_badge_catalog FOR SELECT TO authenticated USING (true);

INSERT INTO public.athlete_badge_catalog (badge_key, name, category, icon_key, rarity, description, requirement, metric, threshold, sort_order) VALUES
  ('first_workout','First Workout','milestone','flag','common','Where every transformation starts.','Complete 1 workout','workouts_completed',1,10),
  ('workouts_10','Getting Serious','milestone','dumbbell','common','Ten sessions in the books.','Complete 10 workouts','workouts_completed',10,20),
  ('workouts_25','Consistent','consistency','calendar','common','Consistency is the real program.','Complete 25 workouts','workouts_completed',25,30),
  ('workouts_50','Half Century','consistency','flame','rare','Fifty sessions of work.','Complete 50 workouts','workouts_completed',50,40),
  ('workouts_100','Centurion','consistency','shield','epic','One hundred workouts completed.','Complete 100 workouts','workouts_completed',100,50),
  ('workouts_250','Iron Will','consistency','hammer','legendary','A quarter of a thousand sessions.','Complete 250 workouts','workouts_completed',250,60),
  ('logged_10','Detail Oriented','logging','notebook','common','Every set, every time.','Fully log 10 workouts','workouts_fully_logged',10,70),
  ('logged_50','Perfect Logger','logging','chart','rare','Data drives progress.','Fully log 50 workouts','workouts_fully_logged',50,80),
  ('logged_150','Meticulous','logging','target','epic','Elite-level logging discipline.','Fully log 150 workouts','workouts_fully_logged',150,90),
  ('level_trained','Trained','progression','medal','common','Reached the Trained tier.','Earn 1,500 lifetime XP','xp',1500,100),
  ('level_advanced','Advanced','progression','medal','rare','Reached the Advanced tier.','Earn 4,500 lifetime XP','xp',4500,110),
  ('level_elite','Elite','progression','crown','epic','Reached the Elite tier.','Earn 9,000 lifetime XP','xp',9000,120),
  ('level_legend','Legend','progression','crown','legendary','Reached the Legend tier.','Earn 18,000 lifetime XP','xp',18000,130),
  ('half_year','Six Months Strong','tenure','clock','rare','Half a year of training.','180 days since your first workout','days_since_first_workout',180,140),
  ('year_one','One Year Strong','tenure','star','epic','A full year of training.','365 days since your first workout','days_since_first_workout',365,150)
ON CONFLICT (badge_key) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, icon_key = EXCLUDED.icon_key,
  rarity = EXCLUDED.rarity, description = EXCLUDED.description, requirement = EXCLUDED.requirement,
  metric = EXCLUDED.metric, threshold = EXCLUDED.threshold, sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS public.athlete_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  badge_key text NOT NULL REFERENCES public.athlete_badge_catalog(badge_key) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT athlete_achievements_unique UNIQUE (client_id, badge_key)
);
CREATE INDEX IF NOT EXISTS athlete_achievements_client_idx ON public.athlete_achievements (client_id, earned_at DESC);

GRANT SELECT ON public.athlete_achievements TO authenticated;
GRANT ALL ON public.athlete_achievements TO service_role;
ALTER TABLE public.athlete_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Athletes read own achievements" ON public.athlete_achievements;
CREATE POLICY "Athletes read own achievements" ON public.athlete_achievements FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coach')
);

CREATE OR REPLACE FUNCTION public.sync_athlete_achievements(_client_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.athlete_achievements (client_id, badge_key, earned_at)
  SELECT _client_id, b.badge_key, e.met_at
  FROM public.athlete_badge_catalog b
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN b.metric = 'workouts_completed' THEN (
        SELECT x.occurred_at FROM (
          SELECT occurred_at, row_number() OVER (ORDER BY occurred_at) AS rn
          FROM public.athlete_xp_events
          WHERE client_id = _client_id AND event_type = 'workout_completed'
        ) x WHERE x.rn = b.threshold
      )
      WHEN b.metric = 'workouts_fully_logged' THEN (
        SELECT x.occurred_at FROM (
          SELECT occurred_at, row_number() OVER (ORDER BY occurred_at) AS rn
          FROM public.athlete_xp_events
          WHERE client_id = _client_id AND event_type = 'workout_fully_logged'
        ) x WHERE x.rn = b.threshold
      )
      WHEN b.metric = 'xp' THEN (
        SELECT min(x.occurred_at) FROM (
          SELECT occurred_at, sum(xp) OVER (ORDER BY occurred_at, id) AS running
          FROM public.athlete_xp_events WHERE client_id = _client_id
        ) x WHERE x.running >= b.threshold
      )
      WHEN b.metric = 'days_since_first_workout' THEN (
        SELECT min(occurred_at) + make_interval(days => b.threshold)
        FROM public.athlete_xp_events
        WHERE client_id = _client_id AND event_type = 'workout_completed'
      )
    END AS met_at
  ) e
  WHERE b.is_active AND e.met_at IS NOT NULL AND e.met_at <= now()
  ON CONFLICT (client_id, badge_key) DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION public.sync_athlete_achievements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_athlete_achievements(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_sync_athlete_achievements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.sync_athlete_achievements(NEW.client_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_athlete_achievements failed: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.trg_sync_athlete_achievements() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_athlete_achievements_sync ON public.athlete_xp_events;
CREATE TRIGGER trg_athlete_achievements_sync AFTER INSERT ON public.athlete_xp_events
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_athlete_achievements();

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT client_id FROM public.athlete_xp_events LOOP
    PERFORM public.sync_athlete_achievements(r.client_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_athlete_public_badges(_client_id uuid)
RETURNS TABLE (badge_key text, name text, category text, icon_key text, rarity text, description text, requirement text, earned_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.badge_key, b.name, b.category, b.icon_key, b.rarity, b.description, b.requirement, a.earned_at
  FROM public.athlete_achievements a
  JOIN public.athlete_badge_catalog b ON b.badge_key = a.badge_key
  JOIN public.clients c ON c.id = a.client_id
  WHERE auth.uid() IS NOT NULL
    AND a.client_id = _client_id
    AND b.is_public AND b.is_active
    AND (c.user_id = auth.uid() OR (COALESCE(c.archived,false) = false AND c.archived_at IS NULL AND COALESCE(c.status,'') <> 'Archived'))
  ORDER BY a.earned_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_athlete_public_badges(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_athlete_public_badges(uuid) TO authenticated;