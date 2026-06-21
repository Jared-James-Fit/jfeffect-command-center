-- ============================================================
-- Migration: Add weekly check-in thread/inbox system
-- Purpose: Allow clients and coaches to have threaded conversations
--          tied to each weekly check-in submission.
-- ============================================================

-- Thread: one per check-in submission
CREATE TABLE IF NOT EXISTS weekly_checkin_threads (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Link to the native forms submission (nf_submissions)
  submission_id       UUID        REFERENCES nf_submissions(id) ON DELETE CASCADE,
  client_id           UUID        REFERENCES clients(id) ON DELETE CASCADE,
  member_id           UUID        REFERENCES app_members(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Soft-delete from client view
  client_archived_at  TIMESTAMPTZ,
  -- Auto-archive date (configurable, default 90 days)
  auto_archive_at     TIMESTAMPTZ,
  -- Admin/coach archive
  admin_archived_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_weekly_checkin_threads_client_id
  ON weekly_checkin_threads(client_id);
CREATE INDEX IF NOT EXISTS idx_weekly_checkin_threads_submission_id
  ON weekly_checkin_threads(submission_id);
CREATE INDEX IF NOT EXISTS idx_weekly_checkin_threads_member_id
  ON weekly_checkin_threads(member_id)
  WHERE member_id IS NOT NULL;

-- Messages: individual replies in a thread
CREATE TABLE IF NOT EXISTS weekly_checkin_messages (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           UUID        NOT NULL REFERENCES weekly_checkin_threads(id) ON DELETE CASCADE,
  sender_user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role         TEXT        NOT NULL CHECK (sender_role IN ('client', 'coach', 'admin')),
  message_text        TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Soft-delete from client view only
  client_deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_weekly_checkin_messages_thread_id
  ON weekly_checkin_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_weekly_checkin_messages_sender_user_id
  ON weekly_checkin_messages(sender_user_id);

-- Auto-update updated_at on threads
CREATE OR REPLACE FUNCTION update_weekly_checkin_thread_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_weekly_checkin_threads_updated_at ON weekly_checkin_threads;
CREATE TRIGGER trg_weekly_checkin_threads_updated_at
  BEFORE UPDATE ON weekly_checkin_threads
  FOR EACH ROW EXECUTE FUNCTION update_weekly_checkin_thread_updated_at();

-- When a new message is added, bump the thread's updated_at
CREATE OR REPLACE FUNCTION bump_thread_on_new_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE weekly_checkin_threads
  SET updated_at = NOW()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_thread_on_message ON weekly_checkin_messages;
CREATE TRIGGER trg_bump_thread_on_message
  AFTER INSERT ON weekly_checkin_messages
  FOR EACH ROW EXECUTE FUNCTION bump_thread_on_new_message();

-- RLS
ALTER TABLE weekly_checkin_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_checkin_messages ENABLE ROW LEVEL SECURITY;

-- Admin/coach: full access to all threads
CREATE POLICY "admin_coach_threads_full"
  ON weekly_checkin_threads FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'coach')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'coach')
  ));

-- Client: can read/write their own threads (not admin-archived)
CREATE POLICY "client_own_threads"
  ON weekly_checkin_threads FOR ALL TO authenticated
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
    AND admin_archived_at IS NULL
  )
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- Member: can read/write their own threads
CREATE POLICY "member_own_threads"
  ON weekly_checkin_threads FOR ALL TO authenticated
  USING (
    member_id IN (
      SELECT id FROM app_members WHERE user_id = auth.uid()
    )
    AND admin_archived_at IS NULL
  )
  WITH CHECK (
    member_id IN (
      SELECT id FROM app_members WHERE user_id = auth.uid()
    )
  );

-- Admin/coach: full access to all messages
CREATE POLICY "admin_coach_messages_full"
  ON weekly_checkin_messages FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'coach')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'coach')
  ));

-- Client/member: can read/write messages in their own threads
CREATE POLICY "client_own_messages"
  ON weekly_checkin_messages FOR ALL TO authenticated
  USING (
    thread_id IN (
      SELECT t.id FROM weekly_checkin_threads t
      LEFT JOIN clients c ON c.id = t.client_id
      LEFT JOIN app_members m ON m.id = t.member_id
      WHERE c.user_id = auth.uid() OR m.user_id = auth.uid()
    )
    AND client_deleted_at IS NULL
  )
  WITH CHECK (
    thread_id IN (
      SELECT t.id FROM weekly_checkin_threads t
      LEFT JOIN clients c ON c.id = t.client_id
      LEFT JOIN app_members m ON m.id = t.member_id
      WHERE c.user_id = auth.uid() OR m.user_id = auth.uid()
    )
  );

-- Comments
COMMENT ON TABLE weekly_checkin_threads IS
  'One thread per weekly check-in submission. Connects clients/members to coach replies.';
COMMENT ON TABLE weekly_checkin_messages IS
  'Individual messages in a check-in thread. Supports client, coach, and admin senders.';
