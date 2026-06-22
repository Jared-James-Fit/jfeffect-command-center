-- ============================================================
-- Migration: Add missing fields for Client Profile & Goals system
-- Only adds fields that don't already exist in the clients table
-- Preserves all existing data, permissions, and RLS policies
-- ============================================================

ALTER TABLE public.clients
  -- Basic Info additions
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS preferred_contact_method text DEFAULT NULL,

  -- Goals additions (goals text field already exists)
  ADD COLUMN IF NOT EXISTS secondary_goal text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS goal_target_date date DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS goal_success_looks_like text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS goal_why_it_matters text DEFAULT NULL,

  -- Training Setup additions
  -- (intake_training_experience, committed_training_days, injuries already exist)
  ADD COLUMN IF NOT EXISTS gym_location text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS available_equipment text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS training_style text DEFAULT NULL,

  -- Nutrition additions (nutrition_notes already exists)
  ADD COLUMN IF NOT EXISTS dietary_restrictions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS food_allergies text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS foods_avoided text DEFAULT NULL,

  -- Emergency Contact additions (name + phone already exist)
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text DEFAULT NULL,

  -- Profile completion tracking
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS profile_last_updated_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS profile_last_updated_by text DEFAULT NULL;

-- Index for profile completion queries
CREATE INDEX IF NOT EXISTS clients_profile_completed_at_idx
  ON public.clients (profile_completed_at DESC NULLS LAST);

-- Allow clients to update their own profile fields via the existing RLS policies
-- The clients table already has RLS enabled with appropriate policies
-- No additional policy changes needed — existing policies cover these new columns
