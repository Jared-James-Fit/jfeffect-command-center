ALTER FUNCTION public.payment_ledger_after_change() SET search_path = public;
ALTER FUNCTION public.prevent_payment_ledger_delete() SET search_path = public;
ALTER FUNCTION public.pl_safe_first_int(text) SET search_path = public;