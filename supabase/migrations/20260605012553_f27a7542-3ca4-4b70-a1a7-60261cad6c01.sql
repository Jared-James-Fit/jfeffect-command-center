ALTER TABLE public.signnow_settings
  ADD COLUMN IF NOT EXISTS api_client_id text,
  ADD COLUMN IF NOT EXISTS api_basic_auth_token text,
  ADD COLUMN IF NOT EXISTS redirect_uri text,
  ADD COLUMN IF NOT EXISTS access_token_status text NOT NULL DEFAULT 'Missing',
  ADD COLUMN IF NOT EXISTS refresh_token_status text NOT NULL DEFAULT 'Missing',
  ADD COLUMN IF NOT EXISTS access_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS app_mode_note text;

UPDATE public.signnow_settings
  SET status = 'Manual Mode Only'
  WHERE status IN ('Manual Mode', 'Needs Setup', 'Not Connected') AND status IS NOT NULL;

ALTER TABLE public.signnow_settings
  ALTER COLUMN status SET DEFAULT 'Manual Mode Only';