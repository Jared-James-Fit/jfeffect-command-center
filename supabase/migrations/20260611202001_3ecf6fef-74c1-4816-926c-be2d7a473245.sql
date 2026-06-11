ALTER TABLE public.jf_membership_settings ALTER COLUMN monthly_price_display SET DEFAULT '$29/month USD';
ALTER TABLE public.jf_membership_settings ALTER COLUMN hold_price_display SET DEFAULT '$9/month USD';
UPDATE public.jf_membership_settings SET monthly_price_display = '$29/month USD' WHERE monthly_price_display IN ('$29/month','$29 / month','$29/mo');
UPDATE public.jf_membership_settings SET hold_price_display = '$9/month USD' WHERE hold_price_display IN ('$9/month','$9 / month','$9/mo');