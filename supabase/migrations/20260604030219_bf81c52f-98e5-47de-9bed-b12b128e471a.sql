
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS province text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS profile_picture_url text,
  ADD COLUMN IF NOT EXISTS info_update_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS info_update_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS info_last_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS info_last_updated_by text,
  ADD COLUMN IF NOT EXISTS info_last_updated_fields text[],
  ADD COLUMN IF NOT EXISTS profile_picture_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS timezone_confirmed_at timestamptz;

-- Allow client to update their own row (limited to non-sensitive profile fields via app code; RLS allows row-level access)
DROP POLICY IF EXISTS "Client update own" ON public.clients;
CREATE POLICY "Client update own"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
