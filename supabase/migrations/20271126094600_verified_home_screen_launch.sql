-- Legacy setup flags can be set manually. Do not backfill them as verified launches.
alter table public.clients add column if not exists home_screen_verified_at timestamptz;
create or replace function public.guard_home_screen_verification()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.home_screen_verified_at is not null then raise exception 'Installation verification is read-only'; end if;
    elsif new.home_screen_verified_at is distinct from old.home_screen_verified_at then
      raise exception 'Installation verification is read-only';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_home_screen_verification on public.clients;
create trigger guard_home_screen_verification before insert or update on public.clients
for each row execute function public.guard_home_screen_verification();
