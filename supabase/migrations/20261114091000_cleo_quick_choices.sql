-- Cleo's quick questions: the tappable answers under a reply (e.g. "Add to
-- Monday's workout" / "Separate new workout"). Tapping one sends it as the
-- person's next message.
alter table public.summer_messages add column if not exists choices jsonb;
