-- Account access tracking fields on clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'Invite Not Sent',
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_last_resent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_reset_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_admin_help boolean NOT NULL DEFAULT false;

-- Update handle_new_user so that when a newly signed-up auth user matches a
-- client row by email, the client row is automatically linked + marked as
-- account-created. Client role is always assigned; never admin.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client')
  ON CONFLICT DO NOTHING;

  -- Auto-link to existing client profile by email
  UPDATE public.clients
     SET user_id = NEW.id,
         account_status = 'Account Created',
         account_created_at = now()
   WHERE lower(email) = lower(NEW.email)
     AND user_id IS NULL;

  RETURN NEW;
END;
$function$;