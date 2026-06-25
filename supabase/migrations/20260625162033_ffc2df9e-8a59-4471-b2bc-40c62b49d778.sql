
-- =========================================================
-- MEDIA CAMPAIGNS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.media_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  objective text,
  offer text,
  target_audience text,
  owner_id uuid,
  team_member_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'planning',
  priority integer NOT NULL DEFAULT 3,
  description text,
  landing_page_url text,
  promo_link_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  lead_magnet_url text,
  notes text,
  results text,
  archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_campaigns TO authenticated;
GRANT ALL ON public.media_campaigns TO service_role;

ALTER TABLE public.media_campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='media_campaigns' AND policyname='media_campaigns staff read') THEN
    CREATE POLICY "media_campaigns staff read" ON public.media_campaigns FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager') OR public.has_role(auth.uid(),'coach'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='media_campaigns' AND policyname='media_campaigns manager write') THEN
    CREATE POLICY "media_campaigns manager write" ON public.media_campaigns FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager'))
      WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS media_campaigns_status_idx ON public.media_campaigns (status) WHERE archived = false;
CREATE INDEX IF NOT EXISTS media_campaigns_owner_idx ON public.media_campaigns (owner_id);

-- =========================================================
-- MEDIA PAGES (registry of pages & promo links)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.media_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  page_type text NOT NULL DEFAULT 'other',
  campaign_id uuid REFERENCES public.media_campaigns(id) ON DELETE SET NULL,
  offer text,
  owner_id uuid,
  status text NOT NULL DEFAULT 'active',
  notes text,
  last_reviewed_at timestamptz,
  sales_page_key text,
  booking_link_id uuid,
  archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_pages TO authenticated;
GRANT ALL ON public.media_pages TO service_role;

ALTER TABLE public.media_pages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='media_pages' AND policyname='media_pages staff read') THEN
    CREATE POLICY "media_pages staff read" ON public.media_pages FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager') OR public.has_role(auth.uid(),'coach'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='media_pages' AND policyname='media_pages manager write') THEN
    CREATE POLICY "media_pages manager write" ON public.media_pages FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager'))
      WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS media_pages_campaign_idx ON public.media_pages (campaign_id);
CREATE INDEX IF NOT EXISTS media_pages_type_idx ON public.media_pages (page_type) WHERE archived = false;

-- =========================================================
-- MEDIA PERFORMANCE ENTRIES
-- =========================================================
CREATE TABLE IF NOT EXISTS public.media_performance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid REFERENCES public.media_content_records(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.media_campaigns(id) ON DELETE SET NULL,
  platform text NOT NULL,
  publish_date date,
  views integer,
  reach integer,
  likes integer,
  comments integer,
  shares integer,
  saves integer,
  watch_time_seconds integer,
  leads integer,
  applications integer,
  sales integer,
  revenue_cents integer,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_performance_entries TO authenticated;
GRANT ALL ON public.media_performance_entries TO service_role;

ALTER TABLE public.media_performance_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='media_performance_entries' AND policyname='media_performance staff read') THEN
    CREATE POLICY "media_performance staff read" ON public.media_performance_entries FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager') OR public.has_role(auth.uid(),'coach'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='media_performance_entries' AND policyname='media_performance manager write') THEN
    CREATE POLICY "media_performance manager write" ON public.media_performance_entries FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager'))
      WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS media_performance_content_idx ON public.media_performance_entries (content_id);
CREATE INDEX IF NOT EXISTS media_performance_platform_idx ON public.media_performance_entries (platform, publish_date DESC);

-- =========================================================
-- updated_at triggers
-- =========================================================
CREATE OR REPLACE FUNCTION public.media_phase4_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='media_campaigns_touch') THEN
    CREATE TRIGGER media_campaigns_touch BEFORE UPDATE ON public.media_campaigns
      FOR EACH ROW EXECUTE FUNCTION public.media_phase4_touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='media_pages_touch') THEN
    CREATE TRIGGER media_pages_touch BEFORE UPDATE ON public.media_pages
      FOR EACH ROW EXECUTE FUNCTION public.media_phase4_touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='media_performance_touch') THEN
    CREATE TRIGGER media_performance_touch BEFORE UPDATE ON public.media_performance_entries
      FOR EACH ROW EXECUTE FUNCTION public.media_phase4_touch_updated_at();
  END IF;
END $$;
