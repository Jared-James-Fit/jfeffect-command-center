-- Coaching packages (Nov 22 2026): one source of truth for what JF Effect
-- sells and what the public site says about it, plus the included video calls
-- of a package like Coaching Plus.
--
--   * coaching_packages: each package as advertised (name, price, what's
--     included, status, listed on the site or not, order). The public reads it
--     only through coaching_packages_public() / coaching_package_public(slug),
--     which return public fields (never the admin note or the product).
--     A package's price is the advertised price: it never changes a sale, a
--     Stripe product or a subscription. product_id only names the Stripe-backed
--     product it's sold with (read, never written).
--   * coaching_package_versions: every change a visitor or client could see,
--     before and after, written only by the trigger (the pricing history).
--   * coaching_package_enrollments: which package a client is on, with what
--     they pay (contracted_price_cents, grandfathered or custom) and the
--     billing anchor their included calls run from. Only ever set by staff;
--     nothing moves a client onto a package by itself.
--   * Included calls: a package with included_calls > 0 names its booking type
--     (call_booking_card_id, "Coaching Plus Call", video, no PT credit). A
--     client books one only while they're on that package and have calls left
--     in the billing period the call falls in (coaching_call_usage); the
--     pt_sessions guard checks it under a per-client lock, so two taps can't
--     book past it. A coach booking or moving a call is never blocked.
--   * coaching_call_topics: what the client wants to cover (written by the
--     server for the client); coaching_call_reviews: the coach's action items
--     and next priorities after a call (staff only; shared to the client only
--     when the coach sends them in the chat). The coach's private notes stay
--     pt_session_coach_notes.
--   * coaching_applications.package_slug / package_snapshot: the package an
--     application was for (the card they tapped), as it was when they applied.
--
-- Seeds: the free app and Complete Online Coaching ($130/month) are active and
-- listed; Nutrition Coaching ($99), Coaching Plus ($249) and the one-time calls
-- are drafts, not listed and not bookable, until the coach approves them.

SET lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Packages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coaching_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 48),
  kind text NOT NULL CHECK (kind IN ('free', 'subscription', 'one_time')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  tagline text CHECK (tagline IS NULL OR char_length(tagline) <= 120),
  description text CHECK (description IS NULL OR char_length(description) <= 600),
  best_for text CHECK (best_for IS NULL OR char_length(best_for) <= 160),
  features text[] NOT NULL DEFAULT '{}',
  price_cents integer CHECK (price_cents IS NULL OR price_cents BETWEEN 0 AND 1000000),
  currency text NOT NULL DEFAULT 'CAD',
  billing_interval text CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'once')),
  recommended boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  is_public boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  cta_label text CHECK (cta_label IS NULL OR char_length(cta_label) <= 40),
  included_calls integer NOT NULL DEFAULT 0 CHECK (included_calls BETWEEN 0 AND 8),
  call_minutes integer NOT NULL DEFAULT 30 CHECK (call_minutes BETWEEN 15 AND 90),
  call_booking_card_id uuid REFERENCES public.booking_cards(id) ON DELETE SET NULL,
  call_cancel_hours integer NOT NULL DEFAULT 24 CHECK (call_cancel_hours BETWEEN 0 AND 168),
  product_id uuid REFERENCES public.coaching_products(id) ON DELETE SET NULL,
  admin_note text CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000),
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid(),
  -- only an active package is on the site, and a paid one only with a price
  CONSTRAINT coaching_packages_public_active CHECK (NOT is_public OR status = 'active'),
  CONSTRAINT coaching_packages_public_priced CHECK (NOT is_public OR kind = 'free' OR coalesce(price_cents, 0) > 0)
);

COMMENT ON TABLE public.coaching_packages IS
  'What JF Effect sells and what the site says about it (src/lib/coaching-packages). The advertised price only: sales and Stripe never change with it.';

-- one recommended package at a time
CREATE UNIQUE INDEX IF NOT EXISTS coaching_packages_one_recommended
  ON public.coaching_packages ((true)) WHERE recommended;
CREATE INDEX IF NOT EXISTS coaching_packages_call_card_idx
  ON public.coaching_packages (call_booking_card_id) WHERE call_booking_card_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_coaching_packages_clean()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  f text;
  cleaned text[] := '{}';
  was_listed boolean := false;
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.tagline := nullif(btrim(coalesce(NEW.tagline, '')), '');
  NEW.description := nullif(btrim(coalesce(NEW.description, '')), '');
  NEW.best_for := nullif(btrim(coalesce(NEW.best_for, '')), '');
  NEW.cta_label := nullif(btrim(coalesce(NEW.cta_label, '')), '');
  NEW.admin_note := nullif(btrim(coalesce(NEW.admin_note, '')), '');
  NEW.currency := upper(coalesce(nullif(btrim(NEW.currency), ''), 'CAD'));
  FOREACH f IN ARRAY coalesce(NEW.features, '{}') LOOP
    f := btrim(f);
    IF f <> '' THEN
      IF char_length(f) > 120 THEN
        RAISE EXCEPTION 'Keep each included item under 120 characters.' USING ERRCODE = '22023';
      END IF;
      cleaned := cleaned || f;
    END IF;
  END LOOP;
  IF coalesce(array_length(cleaned, 1), 0) > 12 THEN
    RAISE EXCEPTION 'Keep it to 12 included items.' USING ERRCODE = '22023';
  END IF;
  NEW.features := cleaned;

  IF NEW.kind = 'free' THEN
    NEW.price_cents := 0;
    NEW.billing_interval := NULL;
    NEW.included_calls := 0;
  ELSIF NEW.kind = 'one_time' THEN
    NEW.billing_interval := 'once';
  ELSE
    NEW.billing_interval := coalesce(NEW.billing_interval, 'month');
  END IF;

  -- a draft or archived package is never on the site, and an archived one is never recommended
  IF NEW.status <> 'active' THEN
    NEW.is_public := false;
  END IF;
  IF NEW.status = 'archived' THEN
    NEW.recommended := false;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    was_listed := OLD.status = 'active' AND OLD.is_public;
  END IF;
  IF NEW.status = 'active' AND NEW.is_public AND (
       NOT was_listed
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
       OR NEW.features IS DISTINCT FROM OLD.features
       OR NEW.tagline IS DISTINCT FROM OLD.tagline
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.best_for IS DISTINCT FROM OLD.best_for
       OR NEW.recommended IS DISTINCT FROM OLD.recommended
       OR NEW.cta_label IS DISTINCT FROM OLD.cta_label
       OR NEW.included_calls IS DISTINCT FROM OLD.included_calls
       OR NEW.call_minutes IS DISTINCT FROM OLD.call_minutes) THEN
    NEW.published_at := now();
    NEW.published_by := auth.uid();
  END IF;

  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coaching_packages_clean ON public.coaching_packages;
CREATE TRIGGER coaching_packages_clean
  BEFORE INSERT OR UPDATE ON public.coaching_packages
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_packages_clean();

-- ---------------------------------------------------------------------------
-- History: every change a visitor or client could see (sort order aside)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coaching_package_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.coaching_packages(id) ON DELETE CASCADE,
  before jsonb,
  after jsonb NOT NULL,
  live_before boolean NOT NULL DEFAULT false,
  live_after boolean NOT NULL DEFAULT false,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coaching_package_versions_pkg_idx
  ON public.coaching_package_versions (package_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.coaching_package_snapshot(p public.coaching_packages)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'name', p.name, 'tagline', p.tagline, 'description', p.description, 'best_for', p.best_for,
    'features', to_jsonb(p.features), 'price_cents', p.price_cents, 'currency', p.currency,
    'billing_interval', p.billing_interval, 'recommended', p.recommended, 'cta_label', p.cta_label,
    'included_calls', p.included_calls, 'call_minutes', p.call_minutes,
    'status', p.status, 'is_public', p.is_public, 'kind', p.kind, 'slug', p.slug)
$$;

CREATE OR REPLACE FUNCTION public.tg_coaching_packages_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  b jsonb := NULL;
  a jsonb := public.coaching_package_snapshot(NEW);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    b := public.coaching_package_snapshot(OLD);
    IF b = a THEN
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO public.coaching_package_versions (package_id, before, after, live_before, live_after, changed_by)
  VALUES (
    NEW.id, b, a,
    TG_OP = 'UPDATE' AND OLD.status = 'active' AND OLD.is_public,
    NEW.status = 'active' AND NEW.is_public,
    auth.uid());
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_coaching_packages_version() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coaching_packages_version ON public.coaching_packages;
CREATE TRIGGER coaching_packages_version
  AFTER INSERT OR UPDATE ON public.coaching_packages
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_packages_version();

ALTER TABLE public.coaching_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_package_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read coaching packages" ON public.coaching_packages;
CREATE POLICY "Staff read coaching packages" ON public.coaching_packages
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR (SELECT public.has_role((SELECT auth.uid()), 'coach')));
DROP POLICY IF EXISTS "Admins manage coaching packages" ON public.coaching_packages;
CREATE POLICY "Admins manage coaching packages" ON public.coaching_packages
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Admins read package history" ON public.coaching_package_versions;
CREATE POLICY "Admins read package history" ON public.coaching_package_versions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
REVOKE INSERT, UPDATE, DELETE ON public.coaching_package_versions FROM anon, authenticated;
GRANT SELECT ON public.coaching_package_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_packages TO authenticated;

-- ---------------------------------------------------------------------------
-- What the public sees
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coaching_package_json(p public.coaching_packages)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'slug', p.slug, 'kind', p.kind, 'name', p.name, 'tagline', p.tagline,
    'description', p.description, 'best_for', p.best_for, 'features', to_jsonb(p.features),
    'price_cents', p.price_cents, 'currency', p.currency, 'billing_interval', p.billing_interval,
    'recommended', p.recommended, 'cta_label', p.cta_label,
    'included_calls', p.included_calls, 'call_minutes', p.call_minutes,
    'sort_order', p.sort_order, 'listed', p.status = 'active' AND p.is_public)
$$;
REVOKE ALL ON FUNCTION public.coaching_package_json(public.coaching_packages) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coaching_package_snapshot(public.coaching_packages) FROM PUBLIC, anon, authenticated;

-- The packages on the site, in order.
CREATE OR REPLACE FUNCTION public.coaching_packages_public()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(public.coaching_package_json(p) ORDER BY p.sort_order, p.name), '[]'::jsonb)
    FROM public.coaching_packages p
   WHERE p.status = 'active' AND p.is_public
$$;

-- One active package by its link (an unlisted one too: a custom offer reached by its link). Never a draft.
CREATE OR REPLACE FUNCTION public.coaching_package_public(_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.coaching_package_json(p)
    FROM public.coaching_packages p
   WHERE p.slug = lower(btrim(_slug)) AND p.status = 'active'
   LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.coaching_packages_public() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_package_public(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who's on which package
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coaching_package_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.coaching_packages(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  starts_on date NOT NULL DEFAULT current_date,
  ends_on date,
  -- the sale they pay through (its subscription's billing date anchors their periods)
  sale_id uuid REFERENCES public.purchase_records(id) ON DELETE SET NULL,
  -- the anchor when there's no sale (a period runs a month from this day)
  period_anchor date,
  -- what they pay, when it isn't the advertised price (grandfathered or custom)
  contracted_price_cents integer CHECK (contracted_price_cents IS NULL OR contracted_price_cents BETWEEN 0 AND 1000000),
  -- their own number of included calls a period (null = the package's)
  included_calls integer CHECK (included_calls IS NULL OR included_calls BETWEEN 0 AND 8),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT coaching_package_enrollments_dates CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS coaching_package_enrollments_one_active
  ON public.coaching_package_enrollments (client_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS coaching_package_enrollments_pkg_idx
  ON public.coaching_package_enrollments (package_id, status);

CREATE OR REPLACE FUNCTION public.tg_coaching_package_enrollments_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pkg_status text;
  sale_client uuid;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.package_id IS DISTINCT FROM OLD.package_id THEN
    SELECT status INTO pkg_status FROM public.coaching_packages WHERE id = NEW.package_id;
    IF pkg_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Only an active package can take clients. Set it to Active first.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.sale_id IS NOT NULL THEN
    SELECT client_id INTO sale_client FROM public.purchase_records WHERE id = NEW.sale_id;
    IF sale_client IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION 'That sale is another client''s.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.status = 'ended' AND (TG_OP = 'INSERT' OR OLD.status <> 'ended') THEN
    NEW.ended_at := now();
    NEW.ends_on := coalesce(NEW.ends_on, greatest(current_date, NEW.starts_on));
  END IF;
  NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_coaching_package_enrollments_check() FROM PUBLIC, anon, authenticated;

-- The client's "Coaching package" (the free-text field on their profile, Account and Cleo read) follows
-- the package they're put on, so the two never disagree. Never fails the enrollment.
CREATE OR REPLACE FUNCTION public.tg_coaching_package_enrollments_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active' OR OLD.package_id IS DISTINCT FROM NEW.package_id) THEN
    BEGIN
      UPDATE public.clients c
         SET coaching_package = p.name
        FROM public.coaching_packages p
       WHERE c.id = NEW.client_id AND p.id = NEW.package_id
         AND c.coaching_package IS DISTINCT FROM p.name;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_coaching_package_enrollments_mirror() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coaching_package_enrollments_mirror ON public.coaching_package_enrollments;
CREATE TRIGGER coaching_package_enrollments_mirror
  AFTER INSERT OR UPDATE OF status, package_id ON public.coaching_package_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_package_enrollments_mirror();

DROP TRIGGER IF EXISTS coaching_package_enrollments_check ON public.coaching_package_enrollments;
CREATE TRIGGER coaching_package_enrollments_check
  BEFORE INSERT OR UPDATE ON public.coaching_package_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_package_enrollments_check();

ALTER TABLE public.coaching_package_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read package enrollments" ON public.coaching_package_enrollments;
CREATE POLICY "Staff read package enrollments" ON public.coaching_package_enrollments
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Staff add package enrollments" ON public.coaching_package_enrollments;
CREATE POLICY "Staff add package enrollments" ON public.coaching_package_enrollments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Staff change package enrollments" ON public.coaching_package_enrollments;
CREATE POLICY "Staff change package enrollments" ON public.coaching_package_enrollments
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));
GRANT SELECT, INSERT, UPDATE ON public.coaching_package_enrollments TO authenticated;
REVOKE DELETE ON public.coaching_package_enrollments FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- Included calls: the billing period and what's used of it
-- ---------------------------------------------------------------------------
-- The anchor's day in a month, clamped to that month (31 → Feb 28).
CREATE OR REPLACE FUNCTION public.coaching_anchor_in(_y integer, _m integer, _day integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT make_date(_y, _m, least(_day, extract(day FROM (make_date(_y, _m, 1) + interval '1 month - 1 day'))::integer))
$$;

-- The billing period [start, end) holding _on, a month at a time from the anchor's day. Mirrors callPeriod (call-period.ts).
CREATE OR REPLACE FUNCTION public.coaching_call_period(_anchor date, _on date, OUT period_start date, OUT period_end date)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  d integer := extract(day FROM _anchor)::integer;
  s date;
  base date;
BEGIN
  s := public.coaching_anchor_in(extract(year FROM _on)::integer, extract(month FROM _on)::integer, d);
  IF _on < s THEN
    base := (date_trunc('month', _on) - interval '1 month')::date;
    s := public.coaching_anchor_in(extract(year FROM base)::integer, extract(month FROM base)::integer, d);
  END IF;
  base := (date_trunc('month', s) + interval '1 month')::date;
  period_end := public.coaching_anchor_in(extract(year FROM base)::integer, extract(month FROM base)::integer, d);
  period_start := s;
END;
$$;

-- A client's included calls on a booking type for the period holding _on (null when they have none).
CREATE OR REPLACE FUNCTION public.coaching_call_usage(_client uuid, _card uuid, _on date, _exclude uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  e record;
  anchor date;
  ps date;
  pe date;
  used integer;
  included integer;
BEGIN
  SELECT en.id, en.package_id, en.starts_on, en.period_anchor, en.included_calls AS own_calls,
         p.included_calls AS pkg_calls, p.name, p.call_cancel_hours, p.call_minutes,
         (SELECT pr.next_billing_date FROM public.purchase_records pr WHERE pr.id = en.sale_id) AS billing
    INTO e
    FROM public.coaching_package_enrollments en
    JOIN public.coaching_packages p ON p.id = en.package_id
   WHERE en.client_id = _client
     AND en.status = 'active'
     AND p.call_booking_card_id = _card
     AND en.starts_on <= _on
     AND (en.ends_on IS NULL OR en.ends_on >= _on)
   ORDER BY en.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  anchor := coalesce(e.billing, e.period_anchor, e.starts_on);
  SELECT cp.period_start, cp.period_end INTO ps, pe FROM public.coaching_call_period(anchor, _on) cp;
  included := coalesce(e.own_calls, e.pkg_calls, 0);
  SELECT count(*) INTO used
    FROM public.pt_sessions s
   WHERE s.client_id = _client
     AND s.booking_card_id = _card
     AND s.status IN ('Scheduled', 'Completed', 'Missed')
     AND s.session_date >= ps AND s.session_date < pe
     AND (_exclude IS NULL OR s.id <> _exclude);
  RETURN jsonb_build_object(
    'enrollment_id', e.id, 'package_id', e.package_id, 'package_name', e.name,
    'included', included, 'used', used, 'left', greatest(included - used, 0),
    'period_start', ps, 'period_end', pe, 'anchor', anchor,
    'cancel_hours', e.call_cancel_hours, 'call_minutes', e.call_minutes);
END;
$$;
REVOKE ALL ON FUNCTION public.coaching_call_usage(uuid, uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_call_period(date, date) TO anon, authenticated;

-- A client's own booking of an included call: only on the package, only with a call left in that period.
CREATE OR REPLACE FUNCTION public.tg_pt_sessions_included_call_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  u jsonb;
BEGIN
  IF NEW.booking_card_id IS NULL
     OR NEW.status IS DISTINCT FROM 'Scheduled'
     OR coalesce(NEW.booked_via, '') NOT IN ('client_app', 'booking_page') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.coaching_packages WHERE call_booking_card_id = NEW.booking_card_id) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('coaching_calls:' || NEW.client_id::text, 0));
  u := public.coaching_call_usage(NEW.client_id, NEW.booking_card_id, NEW.session_date, NULL);
  IF u IS NULL THEN
    RAISE EXCEPTION 'This call is included with a coaching package. Ask your coach about adding it.' USING ERRCODE = 'P0001';
  END IF;
  IF (u ->> 'left')::integer <= 0 THEN
    RAISE EXCEPTION 'You''ve booked all % of your included calls for this billing period (it ends %). Pick a day after that.',
      u ->> 'included', to_char(((u ->> 'period_end')::date - 1), 'Mon FMDD') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_pt_sessions_included_call_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pt_sessions_included_call_guard ON public.pt_sessions;
CREATE TRIGGER pt_sessions_included_call_guard
  BEFORE INSERT ON public.pt_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_sessions_included_call_guard();

-- A package's call booking type takes bookings only while the package is active
-- (with calls) or someone is still on it; a draft's type is never bookable.
CREATE OR REPLACE FUNCTION public.coaching_call_card_sync(_card uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.booking_cards b
     SET is_active = (
           EXISTS (SELECT 1 FROM public.coaching_packages p
                    WHERE p.call_booking_card_id = b.id AND p.status = 'active' AND p.included_calls > 0)
        OR EXISTS (SELECT 1 FROM public.coaching_package_enrollments en
                     JOIN public.coaching_packages p ON p.id = en.package_id
                    WHERE p.call_booking_card_id = b.id AND en.status = 'active')),
         updated_at = now()
   WHERE b.id = _card
     AND b.is_active IS DISTINCT FROM (
           EXISTS (SELECT 1 FROM public.coaching_packages p
                    WHERE p.call_booking_card_id = b.id AND p.status = 'active' AND p.included_calls > 0)
        OR EXISTS (SELECT 1 FROM public.coaching_package_enrollments en
                     JOIN public.coaching_packages p ON p.id = en.package_id
                    WHERE p.call_booking_card_id = b.id AND en.status = 'active'))
$$;
REVOKE ALL ON FUNCTION public.coaching_call_card_sync(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_coaching_call_card_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  card uuid;
BEGIN
  IF TG_TABLE_NAME = 'coaching_packages' THEN
    IF NEW.call_booking_card_id IS NOT NULL THEN PERFORM public.coaching_call_card_sync(NEW.call_booking_card_id); END IF;
    IF TG_OP = 'UPDATE' AND OLD.call_booking_card_id IS NOT NULL AND OLD.call_booking_card_id IS DISTINCT FROM NEW.call_booking_card_id THEN
      PERFORM public.coaching_call_card_sync(OLD.call_booking_card_id);
    END IF;
  ELSE
    SELECT p.call_booking_card_id INTO card FROM public.coaching_packages p WHERE p.id = NEW.package_id;
    IF card IS NOT NULL THEN PERFORM public.coaching_call_card_sync(card); END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_coaching_call_card_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coaching_packages_call_card_sync ON public.coaching_packages;
CREATE TRIGGER coaching_packages_call_card_sync
  AFTER INSERT OR UPDATE OF status, included_calls, call_booking_card_id ON public.coaching_packages
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_call_card_sync();
DROP TRIGGER IF EXISTS coaching_package_enrollments_call_card_sync ON public.coaching_package_enrollments;
CREATE TRIGGER coaching_package_enrollments_call_card_sync
  AFTER INSERT OR UPDATE OF status, package_id ON public.coaching_package_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_call_card_sync();

-- ---------------------------------------------------------------------------
-- Before and after a call
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coaching_call_topics (
  pt_session_id uuid PRIMARY KEY REFERENCES public.pt_sessions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  topics text NOT NULL CHECK (char_length(btrim(topics)) BETWEEN 1 AND 1500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS coaching_call_topics_client_idx ON public.coaching_call_topics (client_id);
ALTER TABLE public.coaching_call_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read call topics" ON public.coaching_call_topics;
CREATE POLICY "Staff read call topics" ON public.coaching_call_topics
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));
-- the client writes theirs through the server (getMyCoachingCalls / saveCallTopics)
REVOKE INSERT, UPDATE, DELETE ON public.coaching_call_topics FROM anon, authenticated;
GRANT SELECT ON public.coaching_call_topics TO authenticated;

CREATE TABLE IF NOT EXISTS public.coaching_call_reviews (
  pt_session_id uuid PRIMARY KEY REFERENCES public.pt_sessions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(action_items) = 'array' AND jsonb_array_length(action_items) <= 12),
  next_priorities text CHECK (next_priorities IS NULL OR char_length(next_priorities) <= 1000),
  shared_at timestamptz,
  shared_by uuid,
  shared_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS coaching_call_reviews_client_idx ON public.coaching_call_reviews (client_id);

CREATE OR REPLACE FUNCTION public.tg_coaching_call_reviews_fill()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  SELECT s.client_id INTO NEW.client_id FROM public.pt_sessions s WHERE s.id = NEW.pt_session_id;
  NEW.next_priorities := nullif(btrim(coalesce(NEW.next_priorities, '')), '');
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS coaching_call_reviews_fill ON public.coaching_call_reviews;
CREATE TRIGGER coaching_call_reviews_fill
  BEFORE INSERT OR UPDATE ON public.coaching_call_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_call_reviews_fill();

ALTER TABLE public.coaching_call_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff manage call reviews" ON public.coaching_call_reviews;
CREATE POLICY "Staff manage call reviews" ON public.coaching_call_reviews
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_call_reviews TO authenticated;

-- ---------------------------------------------------------------------------
-- Applications say which package they were for
-- ---------------------------------------------------------------------------
ALTER TABLE public.coaching_applications ADD COLUMN IF NOT EXISTS package_slug text;
ALTER TABLE public.coaching_applications ADD COLUMN IF NOT EXISTS package_snapshot jsonb;
ALTER TABLE public.coaching_application_drafts ADD COLUMN IF NOT EXISTS package_slug text;
COMMENT ON COLUMN public.coaching_applications.package_slug IS
  'The coaching package the application was for (the card they tapped), if any. An application is never a sale.';

-- ---------------------------------------------------------------------------
-- Seeds: only the free app and Complete Online Coaching are live
-- ---------------------------------------------------------------------------
-- The included calls' booking type: a video call with no PT credit, off until a package with calls is active.
INSERT INTO public.booking_cards (
  name, session_type, duration_minutes, location_mode, uses_credit, is_active, online_enabled, show_in_app,
  audience, follows_smart, slug, description, collect_phone, collect_notes, min_notice_hours,
  max_advance_days, buffer_minutes, sort_order, visible_to_client, client_visible_notes,
  reminders_enabled, send_confirmation_email, timezone)
SELECT 'Coaching Plus Call', 'Consultation', 30, 'video', false, false, true, true,
       'clients', true, 'coaching-plus-call',
       'A 30-minute video call with me, included with your coaching. Tell me what you want to cover.',
       false, true, 12, 45, 10, 3, true, true, true, true, 'America/Winnipeg'
 WHERE NOT EXISTS (SELECT 1 FROM public.booking_cards WHERE slug = 'coaching-plus-call');

INSERT INTO public.coaching_packages
  (slug, kind, name, tagline, description, best_for, features, price_cents, billing_interval,
   recommended, status, is_public, sort_order, cta_label, included_calls, call_minutes,
   call_booking_card_id, product_id, admin_note)
VALUES
  ('free', 'free', 'Free app',
   'Train on your own with the app.',
   'My programs or your own, every set and PR logged, nutrition targets and the Crew. No card.',
   'Anyone who wants to train on their own.',
   ARRAY['Follow my programs, build your own or upload one', 'Every set, PR and progression logged',
         '2,000+ exercises with how-to videos', 'Nutrition targets and a food log', 'The Crew and a monthly League'],
   0, NULL, false, 'active', true, 10, 'Join free', 0, 30, NULL, NULL, NULL),
  ('nutrition', 'subscription', 'Nutrition Coaching',
   'I run your nutrition. You run your training.',
   'Calories, macros and a meal plan built around the food you eat, adjusted every week from your check-in and your bodyweight. Your training stays in the free app.',
   'People who train on their own and want their nutrition handled.',
   ARRAY['Calories, macros and a meal plan built for you', 'Weekly check-ins with my feedback',
         'Adjusted as your bodyweight moves', 'Chat with me in the app', 'The full free app for your training'],
   9900, 'month', false, 'draft', false, 20, 'Apply for coaching', 0, 30, NULL, NULL,
   'Proposed price. Not on the site until approved; no Stripe product yet.'),
  ('complete', 'subscription', 'Complete Online Coaching',
   'Your training and nutrition, run by me.',
   'I write your program and your nutrition around your goal, your schedule and your equipment. Every week I read your check-in, go through what you logged and decide what changes.',
   'Anyone who wants a coach running their training and nutrition.',
   ARRAY['Your program, written for you and changed as you progress',
         'Calories, macros and a meal plan built around your food', 'Weekly check-ins with my feedback',
         'Technique feedback on the sets you film', 'Chat with me in the app', 'Meet prep if you compete'],
   13000, 'month', true, 'active', true, 30, 'Apply for coaching', 0, 30, NULL,
   (SELECT id FROM public.coaching_products WHERE id = '70bfbedb-30bb-4b94-a889-a121b22948cf' AND NOT coalesce(archived, false)),
   NULL),
  ('plus', 'subscription', 'Coaching Plus',
   'Complete coaching, plus time with me on video.',
   'Everything in Complete Online Coaching, plus two 30-minute video calls a month that you book yourself. I go through your training before each call and send you the next steps after it.',
   'Lifters who want to talk things through face to face every couple of weeks.',
   ARRAY['Everything in Complete Online Coaching', 'Two 30-minute video calls with me a month',
         'Book your calls yourself in the app', 'Your next steps written up after every call'],
   24900, 'month', false, 'draft', false, 40, 'Apply for coaching', 2, 30,
   (SELECT id FROM public.booking_cards WHERE slug = 'coaching-plus-call' LIMIT 1), NULL,
   'Proposed price. Not on the site until approved; no Stripe product yet. The older "Coaching Plus" products in Products are unrelated legacy offers.'),
  ('technique-review', 'one_time', 'Technique Review Call',
   'One lift, broken down with you on video.',
   'Send me your videos first. We go through them together on a call, and I write up the cues and drills after.',
   NULL,
   ARRAY['Send me your videos before the call', 'We go through them together on video', 'Cues and drills written up after'],
   NULL, 'once', false, 'draft', false, 110, 'Apply for a call', 0, 30, NULL, NULL,
   'One-time call. Set a price and a booking type before it can go live.'),
  ('competition-strategy', 'one_time', 'Competition Strategy Call',
   'Attempts, warm-ups and your weight class, planned with me.',
   'We plan your meet together: attempts, warm-ups, your weight class and the day itself.',
   NULL,
   ARRAY['Attempt selection and a warm-up plan', 'Weight class and weigh-in plan', 'A timeline for meet day'],
   NULL, 'once', false, 'draft', false, 120, 'Apply for a call', 0, 45, NULL, NULL,
   'One-time call. Set a price and a booking type before it can go live.'),
  ('training-consultation', 'one_time', 'Training Consultation',
   'A second opinion on your program.',
   'I go through your program and what you''ve logged, and we talk through what to change.',
   NULL,
   ARRAY['I go through your program and your logs first', 'We talk through what to change', 'A written summary after'],
   NULL, 'once', false, 'draft', false, 130, 'Apply for a call', 0, 45, NULL, NULL,
   'One-time call. Set a price and a booking type before it can go live.'),
  ('nutrition-review', 'one_time', 'Nutrition Review Call',
   'Your nutrition, looked at with you.',
   'I go through your intake and your bodyweight trend, and we set targets that fit your goal.',
   NULL,
   ARRAY['I go through your intake and bodyweight first', 'We set targets that fit your goal', 'A written summary after'],
   NULL, 'once', false, 'draft', false, 140, 'Apply for a call', 0, 30, NULL, NULL,
   'One-time call. Set a price and a booking type before it can go live.')
ON CONFLICT (slug) DO NOTHING;

-- The public reads packages only through coaching_packages_public() / coaching_package_public().
REVOKE ALL ON public.coaching_packages, public.coaching_package_versions, public.coaching_package_enrollments,
  public.coaching_call_topics, public.coaching_call_reviews FROM anon;

SELECT public.rls_evaluate_once('coaching_packages');
SELECT public.rls_evaluate_once('coaching_package_enrollments');
SELECT public.rls_evaluate_once('coaching_call_reviews');
