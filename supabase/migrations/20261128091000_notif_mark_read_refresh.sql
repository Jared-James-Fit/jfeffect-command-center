-- Marking a notification read again moves its read time to now. It kept the
-- first read time, so a source that came back with something new (another
-- like on the same post, a new comment on the same thread) could never be
-- marked read again: it stayed "new" in the bell and Crew Activity for good.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.notif_mark_read(jsonb)'::regprocedure);
  IF position('DO UPDATE SET read_at = EXCLUDED.read_at' in def) > 0 THEN RETURN; END IF;
  def := replace(def,
    'DO UPDATE SET read_at = COALESCE(public.notification_state.read_at, EXCLUDED.read_at),',
    'DO UPDATE SET read_at = EXCLUDED.read_at,');
  IF position('DO UPDATE SET read_at = EXCLUDED.read_at,' in def) = 0 THEN
    RAISE EXCEPTION 'notif_mark_read: anchor not found';
  END IF;
  EXECUTE def;
END $$;
