-- JF Effect for coaches: early access, launch controls and proposed pricing
-- (Nov 22 2026; src/lib/coach-platform/, docs/COACH_PLATFORM_BUSINESS_2026-11.md).
--
-- Independent coach workspaces are NOT open. Nothing here creates an
-- organization, grants a role, or charges anyone:
--
--   * coach_platform_applications: the early-access waitlist (/coaches/apply).
--     Server-written only (service role, after the page's rate limit); read
--     and worked only by an admin through the server. No client policies.
--     The privacy notice and the separate marketing consent are stored word
--     for word with their version and time (CASL, PIPEDA).
--   * app_settings 'coach_platform': the owner's launch controls. Seat
--     pricing is a proposal until the owner publishes it; only then does
--     coach_platform_public() hand the site a price. There is no setting that
--     opens registration: coach_platform_public() always says it's closed,
--     and opening it is a migration after the release gate passes
--     (docs/COACHING_PLATFORM.md Phase 3 and 6).
--   * coach_platform_pricing_history: every change to that pricing, before
--     and after, who and when. Written only by coach_platform_set_pricing.

-- ── the waitlist ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coach_platform_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  email text NOT NULL CHECK (char_length(email) BETWEEN 5 AND 254 AND email = lower(email)),
  business_name text CHECK (business_name IS NULL OR char_length(business_name) <= 120),
  instagram text CHECK (instagram IS NULL OR instagram ~ '^@[A-Za-z0-9._]{1,30}$'),
  website text CHECK (website IS NULL OR char_length(website) <= 200),
  country text NOT NULL CHECK (country IN ('CA', 'US', 'OTHER')),
  region text CHECK (region IS NULL OR char_length(region) <= 80),
  specialties text[] NOT NULL DEFAULT '{}'
    CHECK (specialties <@ ARRAY['powerlifting','bodybuilding','strength','general','nutrition','running','sport','other']::text[]
           AND cardinality(specialties) BETWEEN 1 AND 8),
  client_band text NOT NULL CHECK (client_band IN ('0', '1-5', '6-15', '16-40', '41+')),
  works_as text NOT NULL CHECK (works_as IN ('solo', 'team')),
  current_platform text CHECK (current_platform IS NULL OR current_platform IN ('trainerize','truecoach','everfit','sheets','other','none')),
  -- what they agreed to, word for word
  privacy_notice_version text NOT NULL,
  privacy_notice_text text NOT NULL,
  privacy_ack_at timestamptz NOT NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  marketing_consent_text text,
  marketing_consent_at timestamptz,
  marketing_withdrawn_at timestamptz,
  -- the owner's side
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'waitlisted', 'invited', 'declined')),
  admin_notes text CHECK (admin_notes IS NULL OR char_length(admin_notes) <= 4000),
  contacted_at timestamptz,
  decided_at timestamptz,
  -- where it came from (never a reason to refuse anyone)
  source_page text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  ip_hash text,
  is_test boolean NOT NULL DEFAULT false,
  CONSTRAINT coach_platform_marketing_consent_recorded
    CHECK (NOT marketing_consent OR (marketing_consent_text IS NOT NULL AND marketing_consent_at IS NOT NULL))
);

COMMENT ON TABLE public.coach_platform_applications IS
  'JF Effect for coaches early-access waitlist (src/lib/coach-platform/apply.ts). Server-written; admin-read through the server. Applying creates no account, organization or charge.';

-- one open application per email: applying again updates it
CREATE UNIQUE INDEX IF NOT EXISTS coach_platform_applications_one_open
  ON public.coach_platform_applications (email) WHERE status IN ('new', 'contacted', 'waitlisted');
CREATE INDEX IF NOT EXISTS coach_platform_applications_created
  ON public.coach_platform_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS coach_platform_applications_ip
  ON public.coach_platform_applications (ip_hash, created_at) WHERE ip_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_coach_platform_applications_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS coach_platform_applications_touch ON public.coach_platform_applications;
CREATE TRIGGER coach_platform_applications_touch
  BEFORE UPDATE ON public.coach_platform_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_coach_platform_applications_touch();

ALTER TABLE public.coach_platform_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_platform_applications FROM anon, authenticated;
GRANT ALL ON public.coach_platform_applications TO service_role;

-- ── launch controls ──────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value)
VALUES ('coach_platform', '{"pricing_published": false, "free_clients": 1, "per_client_cents": 500, "volume_from": null, "volume_cents": null}')
ON CONFLICT (key) DO NOTHING;

/** The owner's settings, cleaned (server and the functions below only). */
CREATE OR REPLACE FUNCTION public.coach_platform_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  raw text;
  j jsonb := '{}'::jsonb;
  free_n int;
  per_c int;
  vol_from int;
  vol_c int;
BEGIN
  SELECT value INTO raw FROM public.app_settings WHERE key = 'coach_platform';
  BEGIN
    j := coalesce(raw::jsonb, '{}'::jsonb);
  EXCEPTION WHEN others THEN
    j := '{}'::jsonb;
  END;
  free_n := least(3, greatest(0, coalesce((j ->> 'free_clients')::int, 1)));
  per_c := least(5000, greatest(100, coalesce((j ->> 'per_client_cents')::int, 500)));
  -- the same rule as cleanPricing (seat-pricing.ts): a volume price is lower, from a paid client on
  -- (greatest / least skip NULLs, so an unset step must stay unset before they run)
  vol_from := (j ->> 'volume_from')::int;
  vol_c := (j ->> 'volume_cents')::int;
  IF vol_from IS NOT NULL AND vol_c IS NOT NULL THEN
    vol_from := least(500, greatest(free_n + 2, vol_from));
    vol_c := least(per_c, greatest(100, vol_c));
  END IF;
  IF vol_from IS NULL OR vol_c IS NULL OR vol_c >= per_c THEN
    vol_from := NULL;
    vol_c := NULL;
  END IF;
  RETURN jsonb_build_object(
    'pricing_published', coalesce((j ->> 'pricing_published')::boolean, false),
    'free_clients', free_n,
    'per_client_cents', per_c,
    'volume_from', vol_from,
    'volume_cents', vol_c,
    'published_at', j ->> 'published_at',
    'published_by', j ->> 'published_by',
    -- never a setting: opening needs the release gate (a migration)
    'registration_open', false
  );
END $$;

REVOKE ALL ON FUNCTION public.coach_platform_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_platform_settings() TO service_role;

/** What the public site may say: the price only once the owner published it, and that registration is closed. */
CREATE OR REPLACE FUNCTION public.coach_platform_public()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH s AS (SELECT public.coach_platform_settings() AS j)
  SELECT jsonb_build_object(
    'pricing', CASE WHEN (s.j ->> 'pricing_published')::boolean
      THEN jsonb_build_object(
        'free_clients', (s.j ->> 'free_clients')::int,
        'per_client_cents', (s.j ->> 'per_client_cents')::int,
        'volume_from', (s.j -> 'volume_from'),
        'volume_cents', (s.j -> 'volume_cents'),
        'currency', 'CAD')
      ELSE NULL END,
    'registration_open', false,
    'early_access', true
  )
  FROM s
$$;

REVOKE ALL ON FUNCTION public.coach_platform_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coach_platform_public() TO anon, authenticated, service_role;

-- ── pricing history ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coach_platform_pricing_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  before jsonb,
  after jsonb NOT NULL
);

ALTER TABLE public.coach_platform_pricing_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coach_platform_pricing_history FROM anon, authenticated;
GRANT SELECT ON public.coach_platform_pricing_history TO authenticated;
GRANT ALL ON public.coach_platform_pricing_history TO service_role;

DROP POLICY IF EXISTS "admins read coach platform pricing history" ON public.coach_platform_pricing_history;
CREATE POLICY "admins read coach platform pricing history" ON public.coach_platform_pricing_history
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

/** The admin reads the settings. */
CREATE OR REPLACE FUNCTION public.coach_platform_get()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only the owner can see the coach platform settings' USING ERRCODE = '42501';
  END IF;
  RETURN public.coach_platform_settings();
END $$;

REVOKE ALL ON FUNCTION public.coach_platform_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_platform_get() TO authenticated, service_role;

/**
 * The admin sets the proposed pricing and whether the site shows it. Showing
 * it is the owner's approval of the price as advertised (who and when kept);
 * it still charges nobody: no coach can be billed until seat billing exists.
 */
CREATE OR REPLACE FUNCTION public.coach_platform_set_pricing(
  _published boolean,
  _free_clients int,
  _per_client_cents int,
  _volume_from int DEFAULT NULL,
  _volume_cents int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  before_j jsonb;
  after_j jsonb;
  free_n int := least(3, greatest(0, coalesce(_free_clients, 1)));
  per_c int := least(5000, greatest(100, coalesce(_per_client_cents, 500)));
  pub boolean := coalesce(_published, false);
  unchanged boolean;
  cleaned jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only the owner can change coach pricing' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('coach_platform_pricing'));
  before_j := public.coach_platform_settings();
  -- write the numbers, then read them back cleaned (one rule for the volume step)
  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES ('coach_platform', jsonb_build_object('free_clients', free_n, 'per_client_cents', per_c, 'volume_from', _volume_from, 'volume_cents', _volume_cents)::text, now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
  cleaned := public.coach_platform_settings();
  -- republishing the same price keeps when and by whom it was first approved
  unchanged := pub
    AND (before_j ->> 'pricing_published')::boolean
    AND (before_j ->> 'free_clients') = (cleaned ->> 'free_clients')
    AND (before_j ->> 'per_client_cents') = (cleaned ->> 'per_client_cents')
    AND (before_j -> 'volume_from') = (cleaned -> 'volume_from')
    AND (before_j -> 'volume_cents') = (cleaned -> 'volume_cents');
  after_j := jsonb_build_object(
    'pricing_published', pub,
    'free_clients', free_n,
    'per_client_cents', per_c,
    'volume_from', cleaned -> 'volume_from',
    'volume_cents', cleaned -> 'volume_cents',
    'published_at', CASE WHEN NOT pub THEN NULL WHEN unchanged THEN before_j ->> 'published_at' ELSE now()::text END,
    'published_by', CASE WHEN NOT pub THEN NULL WHEN unchanged THEN before_j ->> 'published_by' ELSE auth.uid()::text END
  );
  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES ('coach_platform', after_j::text, now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
  IF before_j IS DISTINCT FROM public.coach_platform_settings() THEN
    INSERT INTO public.coach_platform_pricing_history (changed_by, before, after)
    VALUES (auth.uid(), before_j, public.coach_platform_settings());
  END IF;
  RETURN public.coach_platform_settings();
END $$;

REVOKE ALL ON FUNCTION public.coach_platform_set_pricing(boolean, int, int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_platform_set_pricing(boolean, int, int, int, int) TO authenticated, service_role;
