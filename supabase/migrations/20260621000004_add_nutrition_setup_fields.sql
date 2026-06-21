-- ============================================================
-- Migration: Add nutrition setup fields
-- Purpose: Support smarter recipe recommendations by adding
--          cooking skill and food dislikes to the setup flow.
-- ============================================================

-- Add to client_goals_setup (for the intake flow)
ALTER TABLE public.client_goals_setup
  ADD COLUMN IF NOT EXISTS cooking_skill TEXT,
  ADD COLUMN IF NOT EXISTS food_dislikes TEXT[];

-- Add to clients (for the active profile used by recommendations)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS cooking_skill TEXT,
  ADD COLUMN IF NOT EXISTS food_dislikes TEXT[];

-- Ensure default empty array for existing rows
UPDATE public.client_goals_setup SET food_dislikes = '{}' WHERE food_dislikes IS NULL;
UPDATE public.clients SET food_dislikes = '{}' WHERE food_dislikes IS NULL;
