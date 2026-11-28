-- References are IDs, not URLs; check ownership before saving. Other form answers unchanged.
create or replace function public.guard_prep_lift_reference()
returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid; kind text; rid uuid;
begin
 if not exists(select 1 from public.nf_questions q where q.id=new.question_id and q.validation->'lift_request'->>'field'='video') then return new; end if;
 if coalesce(new.value_text,'')='' then return new; end if;
 if new.value_text !~ '^(set|lift):[0-9a-fA-F-]{36}$' then raise exception 'Invalid lift reference'; end if;
 select client_id into cid from public.nf_submissions where id=new.submission_id;
 kind=split_part(new.value_text,':',1);rid=split_part(new.value_text,':',2)::uuid;
 if kind='set' and exists(select 1 from public.pl_set_videos where id=rid and client_id=cid and deleted_at is null) then return new; end if;
 if kind='lift' and exists(select 1 from public.lift_videos where id=rid and client_id=cid and video_storage_path is not null and status<>'Archived') then return new; end if;
 raise exception 'Lift not available for this athlete';
end; $$;
drop trigger if exists guard_prep_lift_reference on public.nf_answers;
create trigger guard_prep_lift_reference before insert or update of value_text,question_id,submission_id on public.nf_answers for each row execute function public.guard_prep_lift_reference();
