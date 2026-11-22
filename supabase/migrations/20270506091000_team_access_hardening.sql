-- Team access does what it says (docs/COACHING_PLATFORM.md, "Fixed now").
--
-- 1. A coach's access follows their coach record. Suspending, deactivating
--    or archiving a coach (Team → the coach → status) used to change only the
--    record: their login kept the 'coach' role, and every policy that checks
--    has_role(…, 'coach') kept letting them in. Now the role comes off the
--    moment the record isn't Active (and back when it is), whatever screen or
--    query changed it, and the change is in JF Effect's access record.
--    Coaches already suspended or archived lose the role here.
--
-- 2. Purchase term dates are changed only by the admin or the client's own
--    coach. update_purchase_term_dates let any coach change any client's
--    purchase, and auto_calculate_purchase_term_dates had no check at all
--    (any signed-in account, free members included, could set dates on an
--    undated purchase and read back the whole purchase row).

SET lock_timeout = '5s';

-- ── 1. Coach role follows the coach record ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_coach_access_follows_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  now_active boolean := NEW.user_id IS NOT NULL AND NEW.status = 'Active' AND NOT coalesce(NEW.archived, false);
  was_active boolean := TG_OP = 'UPDATE' AND OLD.user_id IS NOT NULL AND OLD.status = 'Active' AND NOT coalesce(OLD.archived, false);
  who text := coalesce(nullif(btrim(NEW.full_name), ''), NEW.email, 'A coach');
BEGIN
  -- The login moved off this record: the old login keeps the role only through another active record.
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NOT NULL AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    DELETE FROM public.user_roles ur
     WHERE ur.user_id = OLD.user_id AND ur.role = 'coach'
       AND NOT EXISTS (SELECT 1 FROM public.coaches c
                        WHERE c.user_id = OLD.user_id AND c.id <> NEW.id
                          AND c.status = 'Active' AND NOT coalesce(c.archived, false));
  END IF;

  IF now_active THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'coach')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' AND NEW.user_id IS NOT NULL
        AND (NEW.status IS DISTINCT FROM OLD.status
             OR NEW.archived IS DISTINCT FROM OLD.archived
             OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    -- Not active any more: no coach access, unless the same login has another active coach record.
    DELETE FROM public.user_roles ur
     WHERE ur.user_id = NEW.user_id AND ur.role = 'coach'
       AND NOT EXISTS (SELECT 1 FROM public.coaches c
                        WHERE c.user_id = NEW.user_id AND c.id <> NEW.id
                          AND c.status = 'Active' AND NOT coalesce(c.archived, false));
  END IF;

  IF TG_OP = 'UPDATE' AND now_active IS DISTINCT FROM was_active THEN
    PERFORM public._org_audit(
      public.jf_org_id(),
      CASE WHEN now_active THEN 'coach.access_restored' ELSE 'coach.access_removed' END,
      'coach', NEW.id,
      CASE WHEN now_active THEN who || ' can coach again'
           ELSE who || ' lost coach access (' ||
                CASE WHEN coalesce(NEW.archived, false) THEN 'archived' ELSE lower(NEW.status) END || ')'
      END,
      jsonb_build_object('status', NEW.status, 'archived', coalesce(NEW.archived, false), 'user_id', NEW.user_id)
    );
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.tg_coach_access_follows_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coaches_access_follows_status ON public.coaches;
CREATE TRIGGER coaches_access_follows_status
  AFTER INSERT OR UPDATE OF status, archived, user_id ON public.coaches
  FOR EACH ROW EXECUTE FUNCTION public.tg_coach_access_follows_status();

-- Coaches already suspended or archived lose the role now (Inactive and
-- Pending Invite are left as they are: those change on their next status
-- change through the trigger above).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.id, c.user_id, c.status, coalesce(c.archived, false) AS archived,
           coalesce(nullif(btrim(c.full_name), ''), c.email, 'A coach') AS who
      FROM public.coaches c
     WHERE c.user_id IS NOT NULL
       AND (c.status IN ('Suspended', 'Archived') OR coalesce(c.archived, false))
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = c.user_id AND ur.role = 'coach')
       AND NOT EXISTS (SELECT 1 FROM public.coaches o
                        WHERE o.user_id = c.user_id AND o.id <> c.id
                          AND o.status = 'Active' AND NOT coalesce(o.archived, false))
  LOOP
    DELETE FROM public.user_roles WHERE user_id = r.user_id AND role = 'coach';
    PERFORM public._org_audit(public.jf_org_id(), 'coach.access_removed', 'coach', r.id,
      r.who || ' lost coach access (' || CASE WHEN r.archived THEN 'archived' ELSE lower(r.status) END
            || '; the record already said so)',
      jsonb_build_object('status', r.status, 'archived', r.archived, 'user_id', r.user_id, 'backfill', true));
  END LOOP;
END $$;

-- ── 2. Purchase term dates: the admin or the client's own coach ────────────

/** (internal) May the signed-in person change this client's purchase dates? */
CREATE OR REPLACE FUNCTION public._purchase_dates_allowed(_client uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
           WHEN auth.uid() IS NULL THEN coalesce(auth.role(), '') = 'service_role'
           WHEN public.has_role(auth.uid(), 'admin'::public.app_role)
                AND NOT public.is_admin_viewer() THEN true
           WHEN public.has_role(auth.uid(), 'coach'::public.app_role)
                AND _client IN (SELECT public.coached_client_ids()) THEN true
           ELSE false
         END
$$;

REVOKE ALL ON FUNCTION public._purchase_dates_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._purchase_dates_allowed(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.update_purchase_term_dates(
  _purchase_id  uuid,
  _start_date   date,
  _end_date     date,
  _reason       text DEFAULT NULL
)
RETURNS public.purchase_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record  public.purchase_records;
  v_history jsonb;
  v_entry   jsonb;
BEGIN
  SELECT * INTO v_record FROM public.purchase_records WHERE id = _purchase_id;
  -- Same answer for "not there" and "not yours": nothing about another client's purchase leaks.
  IF NOT FOUND OR NOT public._purchase_dates_allowed(v_record.client_id) THEN
    RAISE EXCEPTION 'Only an admin or this client''s coach can change these dates' USING ERRCODE = '42501';
  END IF;

  v_entry := jsonb_build_object(
    'start_date',  v_record.term_start_date,
    'end_date',    v_record.term_end_date,
    'changed_at',  now(),
    'changed_by',  auth.uid(),
    'reason',      COALESCE(_reason, 'Manual update')
  );

  v_history := COALESCE(v_record.term_date_history, '[]'::jsonb) || jsonb_build_array(v_entry);
  IF jsonb_array_length(v_history) > 50 THEN
    v_history := (SELECT jsonb_agg(elem ORDER BY ord) FROM (
      SELECT elem, ord FROM jsonb_array_elements(v_history) WITH ORDINALITY AS t(elem, ord)
      ORDER BY ord DESC LIMIT 50
    ) sub);
  END IF;

  UPDATE public.purchase_records
  SET
    term_start_date      = _start_date,
    term_end_date        = _end_date,
    package_expiry_date  = _end_date,
    term_date_history    = v_history,
    term_auto_calculated = false,
    updated_at           = now()
  WHERE id = _purchase_id
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

REVOKE ALL ON FUNCTION public.update_purchase_term_dates(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_term_dates(uuid, date, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_calculate_purchase_term_dates(
  _purchase_id   uuid,
  _start_date    date DEFAULT CURRENT_DATE,
  _term_length   int  DEFAULT NULL,
  _term_unit     text DEFAULT NULL
)
RETURNS public.purchase_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record   public.purchase_records;
  v_end_date date;
  v_interval interval;
BEGIN
  SELECT * INTO v_record FROM public.purchase_records WHERE id = _purchase_id;
  IF NOT FOUND OR NOT public._purchase_dates_allowed(v_record.client_id) THEN
    RAISE EXCEPTION 'Only an admin or this client''s coach can change these dates' USING ERRCODE = '42501';
  END IF;

  -- Only when no dates are set yet: an existing term is changed through update_purchase_term_dates.
  IF v_record.term_start_date IS NOT NULL THEN
    RETURN v_record;
  END IF;

  IF _term_length IS NOT NULL AND _term_unit IS NOT NULL THEN
    v_interval := CASE lower(_term_unit)
      WHEN 'days'   THEN (_term_length || ' days')::interval
      WHEN 'weeks'  THEN (_term_length || ' weeks')::interval
      WHEN 'months' THEN (_term_length || ' months')::interval
      WHEN 'years'  THEN (_term_length || ' years')::interval
      ELSE NULL
    END;
    IF v_interval IS NOT NULL THEN
      v_end_date := _start_date + v_interval;
    END IF;
  END IF;

  UPDATE public.purchase_records
  SET
    term_start_date      = _start_date,
    term_end_date        = COALESCE(v_end_date, v_record.term_end_date),
    package_expiry_date  = COALESCE(v_end_date, v_record.package_expiry_date),
    term_length_snapshot = _term_length,
    term_unit_snapshot   = _term_unit,
    term_auto_calculated = true,
    updated_at           = now()
  WHERE id = _purchase_id
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_calculate_purchase_term_dates(uuid, date, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_calculate_purchase_term_dates(uuid, date, int, text) TO authenticated, service_role;

RESET lock_timeout;
