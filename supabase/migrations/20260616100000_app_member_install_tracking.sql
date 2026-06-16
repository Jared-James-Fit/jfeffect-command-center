-- Phase 2: PWA install tracking columns on app_members.
ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS install_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS install_platform text,
  ADD COLUMN IF NOT EXISTS install_dismissed_at timestamptz;
