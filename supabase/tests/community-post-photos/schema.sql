-- Minimal stand-ins for the tables and helpers 20261027100000_community_post_photos.sql
-- touches. auth.uid() reads the test.uid setting; staff are rows in test_staff.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

CREATE TABLE public.test_staff (uid uuid PRIMARY KEY);
CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, preferred_name text, first_name text,
  last_name text, full_name text, timezone text);
CREATE TABLE public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_user_id uuid NOT NULL, client_id uuid, completion_id uuid,
  kind text NOT NULL DEFAULT 'workout', visibility text NOT NULL DEFAULT 'community', caption text,
  media_path text, media_thumb_path text, media_type text CHECK (media_type IN ('image', 'video')), media_width int, media_height int,
  extra_media jsonb NOT NULL DEFAULT '[]'::jsonb, quote text, quote_author text, quote_source text,
  series text, series_key text, series_item_id uuid, series_data jsonb,
  edited_at timestamptz, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_posts_media_consistent CHECK ((media_path IS NULL) = (media_type IS NULL)),
  CONSTRAINT community_posts_extra_media_check CHECK (jsonb_typeof(extra_media) = 'array' AND jsonb_array_length(extra_media) <= 9));
CREATE UNIQUE INDEX community_posts_series_key ON public.community_posts (series_key) WHERE series_key IS NOT NULL;
CREATE TABLE public.community_poll_options (post_id uuid, pos int, label text);
CREATE TABLE public.community_birthday_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, birthday_year int NOT NULL, birthday date NOT NULL,
  body text NOT NULL, dm_body text NOT NULL, slot int NOT NULL DEFAULT 0, facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready', post_at timestamptz NOT NULL, approved_by uuid, approved_at timestamptz,
  post_id uuid, message_id uuid, posted_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, sender_id uuid, sender_role text, body text,
  attachments jsonb, message_type text, is_internal_note boolean, read_by_admin_at timestamptz);
CREATE TABLE public.client_birthday_wishes (client_id uuid, birthday_year int, wished_by uuid, UNIQUE (client_id, birthday_year));
CREATE TABLE public.community_series_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), series text NOT NULL, mentor text, body text NOT NULL,
  quote text, quote_source text, sort_order int DEFAULT 0, active boolean DEFAULT true, last_used_at timestamptz, use_count int DEFAULT 0,
  data jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.community_series_settings (id boolean PRIMARY KEY DEFAULT true, paused boolean DEFAULT false, author_user_id uuid);
CREATE TABLE public.community_series_runs (series_key text PRIMARY KEY, series text, item_id uuid, post_id uuid);
CREATE TABLE public.community_series_features (series_key text, client_id uuid, win_type text, featured_at timestamptz);

CREATE FUNCTION public.is_community_staff() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.test_staff WHERE uid = auth.uid()) $$;
CREATE FUNCTION public.community_is_coach(_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.test_staff WHERE uid = _uid) $$;
CREATE FUNCTION public.community_main_account(_uid uuid) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT _uid $$;
CREATE FUNCTION public.community_post_visible(_v text, _a uuid, _c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _v = 'community' AND auth.uid() IS NOT NULL $$;
CREATE FUNCTION public.community_author(_uid uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('avatar_url', null) $$;
CREATE FUNCTION public.community_birthday_compose(_client uuid, _slot int, _facts jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('body', 'fresh wording ' || _slot, 'dm_body', 'fresh dm ' || _slot) $$;
CREATE FUNCTION public.community_compose_wins(_week date, _author uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.community_compose_recap(_week date, _author uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.community_compose_observation(_author uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.community_feature_stat(_data jsonb, _author uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.community_series_next(_series text) RETURNS public.community_series_items LANGUAGE sql STABLE AS $$
  SELECT i.* FROM public.community_series_items i WHERE i.series = _series AND i.active ORDER BY i.last_used_at ASC NULLS FIRST, i.sort_order LIMIT 1 $$;
-- the real one (20261009090000_community_edit_archive)
CREATE FUNCTION public.community_is_post_author(_post_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.community_posts p
     WHERE p.id = _post_id
       AND (p.author_user_id = auth.uid() OR p.author_user_id = public.community_main_account(auth.uid()))) $$;
-- the carousel-era read check the migration rebuilds
CREATE FUNCTION public.community_post_media_readable(_name text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
