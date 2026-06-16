
-- Notification per-user state (read/archive) for the derived notification feed.
-- The notification "payload" continues to be derived from existing source tables
-- (messages, lift_videos, agreements, pl_exercise_notes, group_messages,
-- manual_check_in_reviews, appointments, etc.). This table only tracks per-user
-- read/archive state, keyed by (user_id, kind, source_id).

CREATE TABLE IF NOT EXISTS public.notification_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  source_id text NOT NULL,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_state_unique UNIQUE (user_id, kind, source_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_state TO authenticated;
GRANT ALL ON public.notification_state TO service_role;

ALTER TABLE public.notification_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own notification state"
  ON public.notification_state FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own notification state"
  ON public.notification_state FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update their own notification state"
  ON public.notification_state FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete their own notification state"
  ON public.notification_state FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS notification_state_user_unread_idx
  ON public.notification_state (user_id, archived_at, read_at);
CREATE INDEX IF NOT EXISTS notification_state_user_kind_idx
  ON public.notification_state (user_id, kind);

CREATE OR REPLACE FUNCTION public.touch_notification_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_state_touch_updated_at ON public.notification_state;
CREATE TRIGGER notification_state_touch_updated_at
  BEFORE UPDATE ON public.notification_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_notification_state_updated_at();

-- ---------------------------------------------------------------------------
-- Bulk RPCs. `items` is jsonb array of { kind: text, source_id: text }.
-- All RPCs scope to auth.uid() and upsert state rows idempotently.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notif_mark_read(items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  n integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF items IS NULL OR jsonb_typeof(items) <> 'array' THEN RETURN 0; END IF;

  WITH input AS (
    SELECT (e->>'kind')::text AS kind, (e->>'source_id')::text AS source_id
    FROM jsonb_array_elements(items) e
  ),
  ins AS (
    INSERT INTO public.notification_state (user_id, kind, source_id, read_at)
    SELECT uid, kind, source_id, now() FROM input
    ON CONFLICT (user_id, kind, source_id)
      DO UPDATE SET read_at = COALESCE(public.notification_state.read_at, EXCLUDED.read_at),
                    updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_mark_unread(items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  n integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF items IS NULL OR jsonb_typeof(items) <> 'array' THEN RETURN 0; END IF;

  WITH input AS (
    SELECT (e->>'kind')::text AS kind, (e->>'source_id')::text AS source_id
    FROM jsonb_array_elements(items) e
  ),
  ins AS (
    INSERT INTO public.notification_state (user_id, kind, source_id, read_at)
    SELECT uid, kind, source_id, NULL FROM input
    ON CONFLICT (user_id, kind, source_id)
      DO UPDATE SET read_at = NULL, updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_archive(items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  n integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF items IS NULL OR jsonb_typeof(items) <> 'array' THEN RETURN 0; END IF;

  WITH input AS (
    SELECT (e->>'kind')::text AS kind, (e->>'source_id')::text AS source_id
    FROM jsonb_array_elements(items) e
  ),
  ins AS (
    INSERT INTO public.notification_state (user_id, kind, source_id, read_at, archived_at)
    SELECT uid, kind, source_id, now(), now() FROM input
    ON CONFLICT (user_id, kind, source_id)
      DO UPDATE SET
        archived_at = COALESCE(public.notification_state.archived_at, EXCLUDED.archived_at),
        read_at = COALESCE(public.notification_state.read_at, EXCLUDED.read_at),
        updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_restore(items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  n integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF items IS NULL OR jsonb_typeof(items) <> 'array' THEN RETURN 0; END IF;

  WITH input AS (
    SELECT (e->>'kind')::text AS kind, (e->>'source_id')::text AS source_id
    FROM jsonb_array_elements(items) e
  )
  UPDATE public.notification_state ns
     SET archived_at = NULL, updated_at = now()
    FROM input i
   WHERE ns.user_id = uid
     AND ns.kind = i.kind
     AND ns.source_id = i.source_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notif_mark_read(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notif_mark_unread(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notif_archive(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notif_restore(jsonb) TO authenticated;
