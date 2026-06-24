-- Form Assignment Completion Tracking
-- Adds completion tracking fields to nf_assignments for Fillout webhook integration.
-- Primary matching: client_id + assignment_id (hidden fields in Fillout forms).
-- Email is a fallback only.
--
-- Status states:
--   not_assigned  — no assignment record exists
--   assigned      — assigned, not yet completed, not overdue
--   completed     — completed_at is set
--   overdue       — next_due_at < now() AND completed_at IS NULL

-- Add completion tracking columns to nf_assignments
ALTER TABLE nf_assignments
  ADD COLUMN IF NOT EXISTS completed_at         timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completion_status    text        DEFAULT 'assigned'
    CHECK (completion_status IN ('assigned', 'completed', 'overdue')),
  ADD COLUMN IF NOT EXISTS fillout_submission_id text       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fillout_form_id       text       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS assigned_date         date       DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS due_date              date       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completion_source     text       DEFAULT NULL
    CHECK (completion_source IN ('fillout_webhook', 'manual', 'auto') OR completion_source IS NULL);

-- Index for fast webhook lookup by client_id + assignment_id
CREATE INDEX IF NOT EXISTS idx_nf_assignments_client_completion
  ON nf_assignments(client_id, completion_status);

CREATE INDEX IF NOT EXISTS idx_nf_assignments_fillout_submission
  ON nf_assignments(fillout_submission_id)
  WHERE fillout_submission_id IS NOT NULL;

-- Index for compliance dashboard queries (overdue forms)
CREATE INDEX IF NOT EXISTS idx_nf_assignments_due_incomplete
  ON nf_assignments(client_id, next_due_at)
  WHERE completed_at IS NULL;

-- Backfill: mark existing assignments with next_due_at in the past as overdue
UPDATE nf_assignments
SET completion_status = 'overdue'
WHERE completed_at IS NULL
  AND next_due_at IS NOT NULL
  AND next_due_at < NOW()
  AND completion_status = 'assigned';

-- Function to mark a form assignment as completed via webhook
-- Called by the Fillout webhook handler with client_id + assignment_id as primary identifiers.
-- Falls back to email lookup if assignment_id is not provided.
CREATE OR REPLACE FUNCTION mark_form_assignment_completed(
  p_assignment_id   uuid,
  p_client_id       uuid,
  p_submission_id   text,
  p_fillout_form_id text DEFAULT NULL,
  p_completed_at    timestamptz DEFAULT NOW()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_updated int;
BEGIN
  -- Primary: match by assignment_id + client_id
  UPDATE nf_assignments
  SET
    completed_at         = p_completed_at,
    completion_status    = 'completed',
    fillout_submission_id = p_submission_id,
    fillout_form_id      = COALESCE(p_fillout_form_id, fillout_form_id),
    completion_source    = 'fillout_webhook',
    updated_at           = NOW()
  WHERE id = p_assignment_id
    AND client_id = p_client_id
    AND completed_at IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated > 0 THEN
    RETURN jsonb_build_object('success', true, 'matched_by', 'assignment_id', 'rows_updated', v_rows_updated);
  END IF;

  -- Fallback: match by client_id + fillout_form_id (most recent uncompeted assignment)
  IF p_fillout_form_id IS NOT NULL THEN
    UPDATE nf_assignments
    SET
      completed_at          = p_completed_at,
      completion_status     = 'completed',
      fillout_submission_id = p_submission_id,
      fillout_form_id       = p_fillout_form_id,
      completion_source     = 'fillout_webhook',
      updated_at            = NOW()
    WHERE client_id = p_client_id
      AND fillout_form_id = p_fillout_form_id
      AND completed_at IS NULL
      AND id = (
        SELECT id FROM nf_assignments
        WHERE client_id = p_client_id
          AND fillout_form_id = p_fillout_form_id
          AND completed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      );

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated > 0 THEN
      RETURN jsonb_build_object('success', true, 'matched_by', 'client_id+form_id', 'rows_updated', v_rows_updated);
    END IF;
  END IF;

  RETURN jsonb_build_object('success', false, 'matched_by', 'none', 'rows_updated', 0);
END;
$$;

-- Grant execute to service role (used by webhook handler)
GRANT EXECUTE ON FUNCTION mark_form_assignment_completed TO service_role;

COMMENT ON FUNCTION mark_form_assignment_completed IS
  'Marks a form assignment as completed from a Fillout webhook submission.
   Primary matching: assignment_id + client_id (hidden fields in Fillout form).
   Fallback: client_id + fillout_form_id (most recent incomplete assignment).
   Never matches by email to avoid cross-client data leakage.';
