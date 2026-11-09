-- A dated long-term goal on the athlete's Program Intelligence profile (coach-managed, like the
-- equipment profile): { "text": "600 kg total", "date": "2027-11-01", "savedAt": "…" }.
-- Generate Next Program's "Goal timeline" reads it with the next meet (pl_preps) to decide how
-- many weeks to write now and how they fit the longer road (src/lib/program-intel/horizon.ts).
-- Set once by the coach; never asked for again while it's on file.
alter table public.program_intel_profiles add column if not exists long_term_goal jsonb;

comment on column public.program_intel_profiles.long_term_goal is
  'A dated long-term goal ({text, date, savedAt}) the program horizon plans toward; coach-set once.';
