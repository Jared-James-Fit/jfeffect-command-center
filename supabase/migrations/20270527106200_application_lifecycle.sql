-- An applicant's lifecycle in Applications (Nov 25 2026, src/lib/applications/lifecycle.ts):
-- New → Awaiting review → Awaiting response → Approved → Awaiting payment →
-- Onboarding → Ready to start → Active → Archived is read from what happened
-- (the application and the athlete's record). The one thing the coach sets by
-- hand is Archive: an applicant he's done with, kept, out of his lists.
-- membership_applications stays server-only (no client policies).

ALTER TABLE public.membership_applications ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS membership_applications_client_idx
  ON public.membership_applications (client_id) WHERE client_id IS NOT NULL;
