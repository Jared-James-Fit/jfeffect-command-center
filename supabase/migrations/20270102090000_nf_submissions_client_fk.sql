-- nf_submissions.client_id never referenced clients, so every PostgREST embed
-- of the client through a submission (`client:client_id(...)`) failed with
-- "Could not find a relationship between 'nf_submissions' and 'client_id'":
-- the Nutrition Update AI plan (loadQAs), the coach's Nutrition Update panel,
-- the form review list, getSubmission and the form file ownership check.
-- Deleting a client cascades, like nutrition_ai_plans and the rest of a
-- client's records (a whole-client delete is a deliberate purge).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.nf_submissions'::regclass
      and conname = 'nf_submissions_client_id_fkey'
  ) then
    alter table public.nf_submissions
      add constraint nf_submissions_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete cascade;
  end if;
end $$;

notify pgrst, 'reload schema';
