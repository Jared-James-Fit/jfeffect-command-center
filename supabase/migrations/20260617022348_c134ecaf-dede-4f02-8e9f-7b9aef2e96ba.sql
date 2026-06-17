CREATE OR REPLACE FUNCTION public.discount_codes_require_expiry_before_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active'
     AND NEW.expires_at IS NULL
     AND NEW.category = 'promotion' THEN
    RAISE EXCEPTION 'discount_codes: promotion codes require expires_at before activation (code=%)', NEW.public_code;
  END IF;
  RETURN NEW;
END;
$function$;