-- App Review demo data (App Store guideline 2.1: the reviewer needs working logins with something to
-- look at). Admin → Settings → "Prepare App Review demo data" seeds clearly synthetic training for
-- two EXISTING logins (found by email, never created here, no password touched) and "Remove demo
-- data" takes it away again. Every row the seed creates is listed here, so removal deletes exactly
-- those rows and a real client's data can never be reached. Service role writes; the admin reads.

CREATE TABLE IF NOT EXISTS public.app_review_demo_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'client' (the coaching client login) or 'member' (the free member login)
  account_key text NOT NULL CHECK (account_key IN ('client', 'member')),
  -- the email the account was found by when it was seeded
  account_email text NOT NULL,
  table_name text NOT NULL CHECK (table_name IN ('pl_blocks', 'pl_preps', 'pl_row_results', 'pl_day_completions', 'messenger_checkins', 'cardio_targets')),
  record_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, record_id)
);
CREATE INDEX IF NOT EXISTS app_review_demo_records_account ON public.app_review_demo_records (account_key, table_name);

ALTER TABLE public.app_review_demo_records ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.app_review_demo_records TO authenticated;
GRANT ALL ON public.app_review_demo_records TO service_role;

DROP POLICY IF EXISTS "app review demo records: admin reads" ON public.app_review_demo_records;
CREATE POLICY "app review demo records: admin reads" ON public.app_review_demo_records
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

-- Which two logins are the demo accounts. Change the emails by editing this app_settings row (JSON
-- text); the app falls back to these two when the row is missing or unreadable.
INSERT INTO public.app_settings (key, value)
VALUES ('app_review_demo_accounts', '{"client_email":"appreview.client@jfeffect.com","member_email":"appreview.member@jfeffect.com"}')
ON CONFLICT (key) DO NOTHING;
