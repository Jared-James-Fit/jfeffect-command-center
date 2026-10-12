-- Cleo's "Like me" tone: she talks the way the owner texts (Admin → My Voice).
-- It becomes the default, and the owner's saved girly_pop switches to it.
alter table public.summer_profiles drop constraint if exists summer_profiles_tone_check;
alter table public.summer_profiles
  add constraint summer_profiles_tone_check check (tone in ('like_me', 'girly_pop', 'chill', 'professional'));
alter table public.summer_profiles alter column tone set default 'like_me';

update public.summer_profiles sp
set tone = 'like_me'
where sp.tone = 'girly_pop'
  and exists (select 1 from public.business_owners b where b.user_id = sp.user_id);
