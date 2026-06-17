CREATE INDEX IF NOT EXISTS notification_state_user_kind_source_idx
  ON public.notification_state (user_id, kind, source_id);