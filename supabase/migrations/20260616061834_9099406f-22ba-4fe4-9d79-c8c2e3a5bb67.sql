ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS last_setup_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS setup_browser_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_members.last_setup_reminder_at IS 'Last time an admin (or system) sent this member a "finish setting up the app" reminder via email/SMS.';
COMMENT ON COLUMN public.app_members.setup_browser_only IS 'Admin flag: this member intentionally uses the site in a browser only — hide install nudges and exclude from "not installed" follow-ups.';