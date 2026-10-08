-- Customize Summer: the owner picks Summer Ledger's vibe and can write their
-- own instructions for how she answers. Admin only, like the rest of the
-- business_tax_settings row (RLS unchanged).

alter table public.business_tax_settings
  add column if not exists assistant_tone text not null default 'girly_pop',
  add column if not exists assistant_instructions text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'business_tax_settings_assistant_tone_check'
      and conrelid = 'public.business_tax_settings'::regclass
  ) then
    alter table public.business_tax_settings
      add constraint business_tax_settings_assistant_tone_check
      check (assistant_tone in ('girly_pop', 'chill', 'professional'));
  end if;
end
$$;

alter table public.business_tax_settings
  drop constraint if exists business_tax_settings_assistant_instructions_len;
alter table public.business_tax_settings
  add constraint business_tax_settings_assistant_instructions_len
  check (assistant_instructions is null or char_length(assistant_instructions) <= 2000);

notify pgrst, 'reload schema';
