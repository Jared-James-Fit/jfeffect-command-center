
-- =========================================================
-- Helper: can the current auth user access this user's progress data?
-- True if: same user, admin, or assigned coach of a client whose user_id = target.
-- =========================================================
CREATE OR REPLACE FUNCTION public.user_can_access_progress(_target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() = _target_user
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      JOIN public.coaches co ON co.id = c.assigned_coach_id
      WHERE c.user_id = _target_user
        AND co.user_id = auth.uid()
    );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_progress(uuid) TO authenticated, service_role;

-- =========================================================
-- progress_water_targets
-- =========================================================
CREATE TABLE IF NOT EXISTS public.progress_water_targets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  suggested_ml integer NOT NULL DEFAULT 3000,
  active_ml integer NOT NULL DEFAULT 3000,
  target_source text NOT NULL DEFAULT 'default'
    CHECK (target_source IN ('default','auto','user','coach','admin')),
  mode text NOT NULL DEFAULT 'auto'
    CHECK (mode IN ('auto','custom')),
  calc_bodyweight_kg numeric(6,2),
  calc_formula_version integer NOT NULL DEFAULT 1,
  last_recalculated_at timestamptz,
  set_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_water_targets TO authenticated;
GRANT ALL ON public.progress_water_targets TO service_role;
ALTER TABLE public.progress_water_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "water_targets_select" ON public.progress_water_targets
  FOR SELECT TO authenticated
  USING (public.user_can_access_progress(user_id));
CREATE POLICY "water_targets_insert" ON public.progress_water_targets
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_progress(user_id));
CREATE POLICY "water_targets_update" ON public.progress_water_targets
  FOR UPDATE TO authenticated
  USING (public.user_can_access_progress(user_id))
  WITH CHECK (public.user_can_access_progress(user_id));
CREATE POLICY "water_targets_delete" ON public.progress_water_targets
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- progress_water_entries
-- =========================================================
CREATE TABLE IF NOT EXISTS public.progress_water_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_ml integer NOT NULL CHECK (amount_ml > 0 AND amount_ml <= 5000),
  entry_at timestamptz NOT NULL DEFAULT now(),
  entry_date date NOT NULL GENERATED ALWAYS AS ((entry_at AT TIME ZONE 'UTC')::date) STORED,
  source text NOT NULL DEFAULT 'quick_add'
    CHECK (source IN ('quick_add','custom','check_in','admin','imported')),
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_water_entries_user_date
  ON public.progress_water_entries (user_id, entry_date DESC, entry_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_water_entries TO authenticated;
GRANT ALL ON public.progress_water_entries TO service_role;
ALTER TABLE public.progress_water_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "water_entries_select" ON public.progress_water_entries
  FOR SELECT TO authenticated
  USING (public.user_can_access_progress(user_id));
CREATE POLICY "water_entries_insert" ON public.progress_water_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_progress(user_id));
CREATE POLICY "water_entries_update" ON public.progress_water_entries
  FOR UPDATE TO authenticated
  USING (public.user_can_access_progress(user_id))
  WITH CHECK (public.user_can_access_progress(user_id));
CREATE POLICY "water_entries_delete" ON public.progress_water_entries
  FOR DELETE TO authenticated
  USING (public.user_can_access_progress(user_id));

-- =========================================================
-- progress_consents (media marketing opt-in)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.progress_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('marketing_photos','marketing_videos','testimonials')),
  granted boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, version)
);

CREATE INDEX IF NOT EXISTS idx_progress_consents_user
  ON public.progress_consents (user_id, kind, version DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_consents TO authenticated;
GRANT ALL ON public.progress_consents TO service_role;
ALTER TABLE public.progress_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consents_select" ON public.progress_consents
  FOR SELECT TO authenticated
  USING (public.user_can_access_progress(user_id));
CREATE POLICY "consents_insert" ON public.progress_consents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "consents_update" ON public.progress_consents
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "consents_delete" ON public.progress_consents
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- clients: lock flag for coach-set water targets
-- =========================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS water_target_locked_by_coach boolean NOT NULL DEFAULT false;

-- =========================================================
-- updated_at triggers (reuse existing update_updated_at_column helper if present, else create)
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_water_targets_updated ON public.progress_water_targets;
CREATE TRIGGER trg_water_targets_updated
  BEFORE UPDATE ON public.progress_water_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_water_entries_updated ON public.progress_water_entries;
CREATE TRIGGER trg_water_entries_updated
  BEFORE UPDATE ON public.progress_water_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_consents_updated ON public.progress_consents;
CREATE TRIGGER trg_consents_updated
  BEFORE UPDATE ON public.progress_consents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- Auto-recalc of suggested water target when bodyweight changes >= 2 kg
-- Suggested = bodyweight_kg * 35 mL, clamped 2000..5000, rounded to nearest 100.
-- Only updates active_ml if mode='auto'.
-- =========================================================
CREATE OR REPLACE FUNCTION public.maybe_refresh_water_target(_user_id uuid, _bodyweight_kg numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.progress_water_targets;
  v_suggested integer;
BEGIN
  IF _bodyweight_kg IS NULL OR _bodyweight_kg <= 0 THEN
    RETURN;
  END IF;

  v_suggested := GREATEST(2000, LEAST(5000, (ROUND((_bodyweight_kg * 35.0) / 100.0) * 100)::integer));

  SELECT * INTO v_existing FROM public.progress_water_targets WHERE user_id = _user_id;

  IF NOT FOUND THEN
    INSERT INTO public.progress_water_targets (
      user_id, suggested_ml, active_ml, target_source, mode,
      calc_bodyweight_kg, last_recalculated_at
    )
    VALUES (
      _user_id, v_suggested, v_suggested, 'auto', 'auto',
      _bodyweight_kg, now()
    );
    RETURN;
  END IF;

  -- Only refresh if mode is auto AND bodyweight delta >= 2kg (or never calculated)
  IF v_existing.mode = 'auto'
     AND (v_existing.calc_bodyweight_kg IS NULL
          OR abs(_bodyweight_kg - v_existing.calc_bodyweight_kg) >= 2)
  THEN
    UPDATE public.progress_water_targets
       SET suggested_ml = v_suggested,
           active_ml = v_suggested,
           target_source = 'auto',
           calc_bodyweight_kg = _bodyweight_kg,
           last_recalculated_at = now()
     WHERE user_id = _user_id;
  ELSE
    -- still keep suggested up-to-date for display, even if not applied to active
    UPDATE public.progress_water_targets
       SET suggested_ml = v_suggested
     WHERE user_id = _user_id
       AND suggested_ml IS DISTINCT FROM v_suggested;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.maybe_refresh_water_target(uuid, numeric) TO authenticated, service_role;

-- Trigger on progress_bodyweight: when a new bodyweight is logged, refresh water target.
-- Convert lb → kg before calling the helper.
CREATE OR REPLACE FUNCTION public.tg_progress_bodyweight_refresh_water()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kg numeric;
BEGIN
  IF NEW.weight_value IS NULL THEN RETURN NEW; END IF;
  IF NEW.weight_unit = 'kg' THEN
    v_kg := NEW.weight_value;
  ELSE
    v_kg := NEW.weight_value * 0.45359237;
  END IF;
  PERFORM public.maybe_refresh_water_target(NEW.user_id, v_kg);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_progress_bodyweight_refresh_water ON public.progress_bodyweight;
CREATE TRIGGER trg_progress_bodyweight_refresh_water
  AFTER INSERT ON public.progress_bodyweight
  FOR EACH ROW EXECUTE FUNCTION public.tg_progress_bodyweight_refresh_water();
