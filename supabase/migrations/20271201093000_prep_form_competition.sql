-- Native submissions remain the canonical evidence. Never infer a meet by date alone.
alter table public.nf_submissions add column if not exists competition_id uuid references public.competitions(id) on delete set null;
create unique index if not exists nf_submissions_one_per_competition on public.nf_submissions(form_id,client_id,competition_id) where competition_id is not null and period_start is null;
create index if not exists nf_submissions_competition_lookup on public.nf_submissions(competition_id,client_id) where competition_id is not null;
create or replace function public.check_nf_submission_competition()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.competition_id is not null then
    if not exists(select 1 from public.competitions c where c.id=new.competition_id and c.client_id=new.client_id) then
      raise exception 'Competition does not belong to this athlete';
    end if;
    if not exists(select 1 from public.nf_assignments a where a.form_id=new.form_id and a.client_id=new.client_id and a.settings->>'competition_id'=new.competition_id::text) then
      raise exception 'Competition is not assigned to this form';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists check_nf_submission_competition on public.nf_submissions;
create trigger check_nf_submission_competition before insert or update of competition_id, client_id, form_id on public.nf_submissions for each row execute function public.check_nf_submission_competition();
