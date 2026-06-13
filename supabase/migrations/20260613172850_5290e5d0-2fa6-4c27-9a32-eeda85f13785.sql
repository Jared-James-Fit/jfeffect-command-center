-- 1) Add internal notes columns
ALTER TABLE public.submission_reviews
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS internal_notes_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS internal_notes_updated_by uuid,
  ADD COLUMN IF NOT EXISTS draft_origin_generation_id uuid;

-- 2) Expand review_status to include 'no_response'
ALTER TABLE public.submission_reviews
  DROP CONSTRAINT IF EXISTS submission_reviews_review_status_check;

ALTER TABLE public.submission_reviews
  ADD CONSTRAINT submission_reviews_review_status_check
  CHECK (review_status IN (
    'submitted','processing','needs_review','draft_ready','coach_editing',
    'approved','scheduled','sending','sent','delivery_failed','archived',
    'no_response'
  ));

-- 3) Index for assigned-coach filter perf (idempotent)
CREATE INDEX IF NOT EXISTS submission_reviews_assigned_coach_status_idx
  ON public.submission_reviews (assigned_coach_user_id, review_status, submitted_at DESC);
