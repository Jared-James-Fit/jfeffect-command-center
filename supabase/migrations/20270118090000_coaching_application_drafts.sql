-- Unfinished coaching applications: what someone answered on /coaching/apply
-- before Submit, saved once there's a way to reach them (an email or phone),
-- so an application that never arrives still shows the coach who it was.
-- Devin filled in the form from Instagram on Nov 1 and nothing reached the
-- app, with no way to know he'd tried until he messaged.
--
-- Written only by the server (saveApplicationDraft, the service role), read by
-- admins through listApplicationDrafts; closed to every client.
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.coaching_application_drafts (
  id uuid PRIMARY KEY,
  full_name text CHECK (full_name IS NULL OR char_length(full_name) <= 120),
  main_goal text CHECK (main_goal IS NULL OR char_length(main_goal) <= 40),
  target_outcome text CHECK (target_outcome IS NULL OR char_length(target_outcome) <= 250),
  timeline text CHECK (timeline IS NULL OR char_length(timeline) <= 40),
  email text CHECK (email IS NULL OR char_length(email) <= 200),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 40),
  instagram text CHECK (instagram IS NULL OR char_length(instagram) <= 120),
  step text CHECK (step IS NULL OR char_length(step) <= 40),
  answered integer NOT NULL DEFAULT 0,
  source_page text CHECK (source_page IS NULL OR char_length(source_page) <= 80),
  page_url text CHECK (page_url IS NULL OR char_length(page_url) <= 500),
  referrer text CHECK (referrer IS NULL OR char_length(referrer) <= 500),
  submitted_at timestamptz,
  submitted_application_id uuid REFERENCES public.coaching_applications(id) ON DELETE SET NULL,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_application_drafts_contact CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS coaching_application_drafts_open_idx
  ON public.coaching_application_drafts (updated_at DESC)
  WHERE submitted_at IS NULL AND dismissed_at IS NULL;

ALTER TABLE public.coaching_application_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coaching_application_drafts FROM PUBLIC, anon, authenticated;
-- Admins (and the finance login's view) may read them, e.g. through Cleo; nobody writes but the server.
GRANT SELECT ON public.coaching_application_drafts TO authenticated;
DROP POLICY IF EXISTS "Admins read application drafts" ON public.coaching_application_drafts;
CREATE POLICY "Admins read application drafts" ON public.coaching_application_drafts
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR (SELECT public.is_admin_viewer()));
