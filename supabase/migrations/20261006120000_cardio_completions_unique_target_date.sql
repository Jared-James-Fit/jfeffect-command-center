-- Cardio logs never saved: the client upserts with
--   ON CONFLICT (client_id, cardio_target_id, completed_date)
-- but the only matching unique index was PARTIAL (WHERE cardio_target_id IS NOT NULL).
-- Postgres cannot infer a partial index without its predicate, so every upsert failed
-- (42P10) and the card fell back to "Not started".
--
-- A plain unique index enforces the same rule (NULL target ids are distinct in a
-- unique index, so free-form rows without a target are still allowed) and is
-- inferable by ON CONFLICT. The table had no rows when this was written, so the
-- rebuild cannot hit duplicates.

DROP INDEX IF EXISTS public.idx_cardio_completions_target_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cardio_completions_target_date
  ON public.cardio_completions (client_id, cardio_target_id, completed_date);
