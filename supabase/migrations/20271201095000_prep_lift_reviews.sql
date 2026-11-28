-- Small, private per-lift assessment records. Athlete answers remain unchanged.
create table if not exists public.nf_prep_lift_reviews (
 submission_id uuid not null references public.nf_submissions(id) on delete cascade,
 item_id text not null check(char_length(item_id) between 1 and 120),
 fingerprint text check(fingerprint is null or char_length(fingerprint)=64),
 pinned boolean not null default false,
 coach_rpe numeric check(coach_rpe between 0 and 10),
 notes text not null default '' check(char_length(notes)<=2000),
 reviewed_at timestamptz,
 reviewed_by uuid,
 primary key(submission_id,item_id)
);
alter table public.nf_prep_lift_reviews enable row level security;
revoke all on public.nf_prep_lift_reviews from anon, authenticated;
grant select on public.nf_prep_lift_reviews to authenticated;
grant all on public.nf_prep_lift_reviews to service_role;
drop policy if exists "Staff read prep lift reviews" on public.nf_prep_lift_reviews;
create policy "Staff read prep lift reviews" on public.nf_prep_lift_reviews for select to authenticated using (
 (select public.has_role((select auth.uid()),'admin'::public.app_role)) or exists (
 select 1 from public.nf_submissions s where s.id=nf_prep_lift_reviews.submission_id and s.client_id in (select public.coached_client_ids())
 ));
