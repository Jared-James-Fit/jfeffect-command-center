
REVOKE ALL ON FUNCTION public.enforce_purchase_agreement_block() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_purchase_agreement_block() TO service_role;
