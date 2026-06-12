
ALTER TABLE public.coaching_applications
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS location_timezone text,
  ADD COLUMN IF NOT EXISTS main_goal text,
  ADD COLUMN IF NOT EXISTS why_now text,
  ADD COLUMN IF NOT EXISTS tried_before text,
  ADD COLUMN IF NOT EXISTS biggest_struggle text,
  ADD COLUMN IF NOT EXISTS current_weight text,
  ADD COLUMN IF NOT EXISTS target_outcome text,
  ADD COLUMN IF NOT EXISTS seriousness smallint,
  ADD COLUMN IF NOT EXISTS ready_to_invest boolean,
  ADD COLUMN IF NOT EXISTS monthly_investment text,
  ADD COLUMN IF NOT EXISTS can_follow_plan boolean,
  ADD COLUMN IF NOT EXISTS days_per_week smallint,
  ADD COLUMN IF NOT EXISTS gym_access text,
  ADD COLUMN IF NOT EXISTS injuries text,
  ADD COLUMN IF NOT EXISTS win_90_days text,
  ADD COLUMN IF NOT EXISTS lead_score smallint,
  ADD COLUMN IF NOT EXISTS lead_temperature text,
  ADD COLUMN IF NOT EXISTS application_status text DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS recommended_offer text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS appointment_id uuid,
  ADD COLUMN IF NOT EXISTS booking_link_slug text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamp with time zone DEFAULT now();

-- Seed default settings (admin can change later)
INSERT INTO public.app_settings (key, value)
VALUES
  ('coaching_apply.booking_link_slug', ''),
  ('coaching_apply.allow_cold_booking', 'false')
ON CONFLICT (key) DO NOTHING;
