
ALTER TABLE public.nf_submissions
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.nf_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fillout_submission_id text,
  ADD COLUMN IF NOT EXISTS client_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_source text;

CREATE UNIQUE INDEX IF NOT EXISTS nf_submissions_fillout_submission_id_uniq
  ON public.nf_submissions (fillout_submission_id)
  WHERE fillout_submission_id IS NOT NULL;

-- One submitted/reviewed row per (assignment, period) to prevent dupes when the
-- webhook and a client tap both write.
CREATE UNIQUE INDEX IF NOT EXISTS nf_submissions_assignment_period_submitted_uniq
  ON public.nf_submissions (assignment_id, period_start)
  WHERE assignment_id IS NOT NULL
    AND period_start IS NOT NULL
    AND status IN ('submitted','pending_review','reviewed');

CREATE INDEX IF NOT EXISTS nf_submissions_assignment_id_idx
  ON public.nf_submissions (assignment_id);

CREATE INDEX IF NOT EXISTS nf_submissions_client_form_period_idx
  ON public.nf_submissions (client_id, form_id, period_start);
