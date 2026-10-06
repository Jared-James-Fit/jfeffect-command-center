-- Fix: upserts silently failing because their only unique index was PARTIAL.
--
-- Postgres can't use a partial unique index as an ON CONFLICT target unless the
-- statement repeats the index predicate, and PostgREST/supabase-js can't send
-- one. Every upsert({ onConflict: ... }) against these four tables therefore
-- failed with 42P10 ("no unique or exclusion constraint matching the ON
-- CONFLICT specification") — the same bug 20261005170000 fixed for
-- payment_ledger.
--
--   cardio_completions     client "Log cardio" never saved, so coaches saw
--                          "Not started" while the client saw "Cardio logged!"
--   nf_submissions         Fillout nutrition-form submissions (webhook logged
--                          the error and moved on)
--   client_crm_activities  appointment activity entries (dedupe_key)
--   featured_member_items  "Feature a resource"
--
-- Each partial index was `WHERE <col> IS NOT NULL`. A plain unique index
-- enforces exactly the same rule (NULLs never conflict) and IS a valid
-- ON CONFLICT target, so the existing app code works unchanged. Existing rows
-- already satisfy it. New index first, then the old one, so uniqueness is
-- never unenforced. Idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS cardio_completions_client_target_date_key
  ON public.cardio_completions (client_id, cardio_target_id, completed_date);
DROP INDEX IF EXISTS public.idx_cardio_completions_target_date;

CREATE UNIQUE INDEX IF NOT EXISTS nf_submissions_fillout_submission_id_key
  ON public.nf_submissions (fillout_submission_id);
DROP INDEX IF EXISTS public.nf_submissions_fillout_submission_id_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS client_crm_activities_client_dedupe_key
  ON public.client_crm_activities (client_id, dedupe_key);
DROP INDEX IF EXISTS public.uq_client_crm_activities_dedupe;

CREATE UNIQUE INDEX IF NOT EXISTS featured_member_items_resource_key
  ON public.featured_member_items (resource_id);
DROP INDEX IF EXISTS public.featured_member_items_resource_unique;
