CREATE TABLE IF NOT EXISTS public.athlete_xp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source_table text,
  source_id uuid,
  source_key text NOT NULL,
  xp integer NOT NULL CHECK (xp >= 0),
  label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT athlete_xp_events_source_key_unique UNIQUE (client_id, source_key)
);
CREATE INDEX IF NOT EXISTS athlete_xp_events_client_idx ON public.athlete_xp_events (client_id, occurred_at DESC);

GRANT SELECT ON public.athlete_xp_events TO authenticated;
GRANT ALL ON public.athlete_xp_events TO service_role;
ALTER TABLE public.athlete_xp_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Athletes read own xp" ON public.athlete_xp_events;
CREATE POLICY "Athletes read own xp" ON public.athlete_xp_events FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coach')
);

CREATE OR REPLACE FUNCTION public.award_workout_xp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.completed_at IS NULL OR NEW.client_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
  VALUES (NEW.client_id, 'workout_completed', 'pl_day_completions', NEW.id, 'workout_completed:' || NEW.id, 100, 'Completed workout', NEW.completed_at)
  ON CONFLICT (client_id, source_key) DO NOTHING;
  IF NEW.logging_quality::text = 'complete' THEN
    INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
    VALUES (NEW.client_id, 'workout_fully_logged', 'pl_day_completions', NEW.id, 'workout_fully_logged:' || NEW.id, 20, 'Fully logged workout', NEW.completed_at)
    ON CONFLICT (client_id, source_key) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'award_workout_xp failed: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.award_workout_xp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_award_workout_xp ON public.pl_day_completions;
CREATE TRIGGER trg_award_workout_xp AFTER INSERT OR UPDATE OF completed_at, logging_quality ON public.pl_day_completions
FOR EACH ROW EXECUTE FUNCTION public.award_workout_xp();

-- Backfill historical completions
INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT client_id, 'workout_completed', 'pl_day_completions', id, 'workout_completed:' || id, 100, 'Completed workout', completed_at
FROM public.pl_day_completions WHERE completed_at IS NOT NULL AND client_id IS NOT NULL
ON CONFLICT (client_id, source_key) DO NOTHING;
INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
SELECT client_id, 'workout_fully_logged', 'pl_day_completions', id, 'workout_fully_logged:' || id, 20, 'Fully logged workout', completed_at
FROM public.pl_day_completions WHERE completed_at IS NOT NULL AND client_id IS NOT NULL AND logging_quality::text = 'complete'
ON CONFLICT (client_id, source_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_athlete_rankings(_limit integer DEFAULT 10)
RETURNS TABLE (client_id uuid, display_name text, avatar_url text, xp bigint, rank bigint, is_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH totals AS (
    SELECT c.id AS client_id,
      COALESCE(NULLIF(trim(coalesce(c.first_name,'') || ' ' || left(coalesce(c.last_name,''),1)), ''), split_part(coalesce(c.full_name,'Athlete'),' ',1)) AS display_name,
      p.avatar_url,
      COALESCE((SELECT sum(e.xp) FROM public.athlete_xp_events e WHERE e.client_id = c.id), 0)::bigint AS xp,
      (c.user_id = auth.uid()) AS is_me
    FROM public.clients c
    LEFT JOIN public.profiles p ON p.id = c.user_id
    WHERE COALESCE(c.archived, false) = false AND c.archived_at IS NULL AND COALESCE(c.status,'') <> 'Archived'
  ), ranked AS (
    SELECT t.*, rank() OVER (ORDER BY t.xp DESC, t.display_name) AS rank FROM totals t
  )
  SELECT client_id, display_name, avatar_url, xp, rank, COALESCE(is_me,false)
  FROM ranked
  WHERE auth.uid() IS NOT NULL AND (rank <= LEAST(GREATEST(_limit,1),50) OR is_me)
  ORDER BY rank;
$$;
REVOKE EXECUTE ON FUNCTION public.get_athlete_rankings(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_athlete_rankings(integer) TO authenticated;