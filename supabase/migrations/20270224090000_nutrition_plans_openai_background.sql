-- Nutrition Update AI plans run on the OpenAI key in background mode, like
-- Generate Next Program: a run submits a call, polls it for up to 45 s and, if
-- the model is still thinking, goes back to 'pending' (which calls the
-- nutrition-plans-tick hook again through nutrition_ai_plans_queue_run) instead
-- of holding a request open for minutes. `progress` keeps the run's prompts,
-- the answers it already has and the call it's waiting on, so a resumed run
-- never asks twice. Cleared when the run finishes or fails, and when a new run
-- is queued.
--
-- Staff-only like the rest of the row (existing RLS): it holds the client's
-- answers and the prompts built from them.

alter table public.nutrition_ai_plans
  add column if not exists progress jsonb;

comment on column public.nutrition_ai_plans.progress is
  'The run in flight: prompts, finished calls and the OpenAI background call being polled (staged-call.server.ts). Null when no run is in flight.';
