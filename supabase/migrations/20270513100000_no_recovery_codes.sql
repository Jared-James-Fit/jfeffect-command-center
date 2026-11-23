-- Two-step sign-in has no recovery codes (Nov 23 2026).
--
-- The owner found the "lost your phone" codes one more thing to keep track of:
-- a password, a texted code, Face ID / Touch ID, the authenticator app and
-- trusted devices are enough. A lost phone is another way on another device
-- (Face ID syncs with their Apple account, a trusted computer), the same
-- number on a new phone, or the owner's Reset two-step on Team
-- (staff_mfa_reset_record, kept). The app no longer makes or takes codes, so
-- the codes saved so far are deleted and the functions that made, used and
-- counted them go. The table stays (empty) for the reset's history.
--
-- Rollback: re-run the three function definitions from
-- 20270424093000_staff_mfa_recovery.sql (the deleted codes don't come back;
-- new ones would be made).

DELETE FROM public.staff_mfa_recovery_codes;

DROP FUNCTION IF EXISTS public.staff_mfa_recovery_replace(uuid, text[]);
DROP FUNCTION IF EXISTS public.staff_mfa_recovery_use(uuid, text);
DROP FUNCTION IF EXISTS public.staff_mfa_recovery_left();
