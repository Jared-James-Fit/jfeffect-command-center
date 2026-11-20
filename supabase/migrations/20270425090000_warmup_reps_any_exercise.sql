-- Warm-ups can be logged on any exercise (Nov 20 2026): an accessory's warm-up is
-- often 10–15 easy reps (a light leg press, a cable row), which the 1–8 limit
-- refused. The suggestion engine still reads only warm-ups of 8 reps or fewer
-- (WARMUP_MAX_REPS, load-suggestion.ts); anything longer is logged, never read.
-- Idempotent.
ALTER TABLE public.pl_warmup_sets DROP CONSTRAINT IF EXISTS pl_warmup_sets_reps_check;
ALTER TABLE public.pl_warmup_sets ADD CONSTRAINT pl_warmup_sets_reps_check CHECK (reps BETWEEN 1 AND 30);
