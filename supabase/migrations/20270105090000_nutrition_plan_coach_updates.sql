-- The coach's "Change something" on an AI nutrition plan: what they asked
-- the AI to change (waiting, or kept after a failed try), and the last few
-- updates with the plan as it was before each, for Undo. Written only by the
-- server (service role); the table stays staff-read-only, so a coach's
-- instructions never reach the client.
alter table public.nutrition_ai_plans
  add column if not exists revise_instructions text,
  add column if not exists revisions jsonb not null default '[]'::jsonb;

do $$
begin
  alter table public.nutrition_ai_plans
    add constraint nutrition_ai_plans_revise_instructions_len
    check (revise_instructions is null or char_length(revise_instructions) <= 2000);
exception when duplicate_object then null;
end $$;
