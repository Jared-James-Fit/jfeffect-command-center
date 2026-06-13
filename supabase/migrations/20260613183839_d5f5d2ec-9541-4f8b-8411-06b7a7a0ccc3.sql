-- Phase 5B: re-affirm auto-assign trigger covers non-active → Active transitions and add NOTICE logging.
CREATE OR REPLACE FUNCTION public.tg_nf_autoassign_new_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted int := 0;
BEGIN
  IF NEW.archived = true OR COALESCE(NEW.status, 'Active') NOT IN ('Active', 'New Client') THEN
    RETURN NEW;
  END IF;

  BEGIN
    WITH ins AS (
      INSERT INTO public.nf_assignments (form_id, client_id)
      SELECT f.id, NEW.id
        FROM public.nf_forms f
       WHERE f.auto_assign_new_clients = true
         AND f.active = true
         AND f.archived = false
      ON CONFLICT (form_id, client_id) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;

    RAISE NOTICE 'nf_autoassign: client=% status=% op=% inserted=%',
      NEW.id, NEW.status, TG_OP, v_inserted;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'nf_autoassign failed for client=% (op=%): % / %',
      NEW.id, TG_OP, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- Triggers are already in place from the earlier migration; ensure both exist (idempotent).
DROP TRIGGER IF EXISTS nf_autoassign_new_client_insert ON public.clients;
CREATE TRIGGER nf_autoassign_new_client_insert
AFTER INSERT ON public.clients
FOR EACH ROW
WHEN (NEW.archived = false AND COALESCE(NEW.status, 'Active') IN ('Active', 'New Client'))
EXECUTE FUNCTION public.tg_nf_autoassign_new_client();

DROP TRIGGER IF EXISTS nf_autoassign_new_client_update ON public.clients;
CREATE TRIGGER nf_autoassign_new_client_update
AFTER UPDATE OF status, archived ON public.clients
FOR EACH ROW
WHEN (
  NEW.archived = false
  AND COALESCE(NEW.status, 'Active') IN ('Active', 'New Client')
  AND (OLD.archived IS DISTINCT FROM NEW.archived OR OLD.status IS DISTINCT FROM NEW.status)
)
EXECUTE FUNCTION public.tg_nf_autoassign_new_client();