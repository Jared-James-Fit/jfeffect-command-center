-- Meal plans pasted from ChatGPT's copy button carry Markdown: a line break
-- copied as a trailing backslash ("75 g Oats (dry weight)\"), escaped
-- punctuation ("1\. Weigh chicken…"), **bold** and "## " headings. Clients
-- saw a slash after every food (Jarrett Simard, Oct 27). Every save of a
-- plan's text now stores the plain text, whatever wrote it (the targets
-- dialog, Cleo, a published review), and what's stored is cleaned once.
-- Same rules as plainPastedText (src/lib/nutrition-targets/plain-paste.ts).

create or replace function public.nutrition_plain_text(s text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when s is null then null else
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            replace(replace(s, E'\r\n', E'\n'), E'\r', E'\n'),
            '[ \t]*\\[ \t]*$', '', 'gn'),
          '\*\*([^*\n]+)\*\*', '\1', 'g'),
        '^#{1,6}[ \t]+', '', 'gn'),
      '\\([!-/:-@[-`{-~])', '\1', 'g')
  end
$$;

create or replace function public.tg_nutrition_target_days_plain_text()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.notes := public.nutrition_plain_text(new.notes);
  return new;
end
$$;

drop trigger if exists nutrition_target_days_plain_text on public.nutrition_target_days;
create trigger nutrition_target_days_plain_text
  before insert or update of notes on public.nutrition_target_days
  for each row execute function public.tg_nutrition_target_days_plain_text();

create or replace function public.tg_nutrition_targets_plain_text()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.food_weighing_rules := public.nutrition_plain_text(new.food_weighing_rules);
  new.client_notes := public.nutrition_plain_text(new.client_notes);
  new.water := public.nutrition_plain_text(new.water);
  return new;
end
$$;

drop trigger if exists nutrition_targets_plain_text on public.nutrition_targets;
create trigger nutrition_targets_plain_text
  before insert or update of food_weighing_rules, client_notes, water on public.nutrition_targets
  for each row execute function public.tg_nutrition_targets_plain_text();

update public.nutrition_target_days
   set notes = public.nutrition_plain_text(notes)
 where notes is distinct from public.nutrition_plain_text(notes);

update public.nutrition_targets
   set food_weighing_rules = public.nutrition_plain_text(food_weighing_rules),
       client_notes = public.nutrition_plain_text(client_notes),
       water = public.nutrition_plain_text(water)
 where food_weighing_rules is distinct from public.nutrition_plain_text(food_weighing_rules)
    or client_notes is distinct from public.nutrition_plain_text(client_notes)
    or water is distinct from public.nutrition_plain_text(water);
