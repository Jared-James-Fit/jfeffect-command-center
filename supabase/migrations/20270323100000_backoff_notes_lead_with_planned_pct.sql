-- Jared McIntyre's back-off notes lead with the % the card fills in (Nov 15 2026).
--
-- His hybrid program (20270318090000_jared_hybrid_loading.sql) plans each
-- back-off at one % of the day's top set or single (92.5%, 90%, 82.5%, 80%)
-- and gives a range in the note: "Back-offs: 92.5–95% of today's top set. The
-- app works out 92.5% from the weight you log on the top set." The card shows
-- the note's first sentence as its one line, so under "2 × 4 @ 92.5%" it read
-- "Back-offs: 92.5–95% of today's top set", which looked like a second,
-- different prescription. Same words, reordered so the first line says what
-- the card does and the range follows:
--   "Back-offs start at 92.5% of today's top set (the app works it out from
--    the weight you log), up to 95%."
-- Every other sentence (the cap, when to go up or under, rest, the back-pain
-- line) is untouched. Only notes still exactly in that form change, only on
-- workouts with nothing logged, and the template's copies the same way; the old
-- text is kept in program_note_backoff_wording_backup.

CREATE TABLE IF NOT EXISTS public.program_note_backoff_wording_backup (
  row_id uuid,
  template_id uuid,
  old_notes text,
  old_payload jsonb,
  fixed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.program_note_backoff_wording_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_note_backoff_wording_backup FROM anon, authenticated;

DO $$
DECLARE
  -- a note still in the old form: the range, then the % the app works out
  pat constant text := '^Back-offs: ([0-9.]+)–([0-9.]+)% of today''s (top set|single)\. The app works out \1% from the weight you log on the \3\.';
  rep constant text := 'Back-offs start at \1% of today''s \3 (the app works it out from the weight you log), up to \2%.';
  -- the same sentence inside a template's JSON (a JSON string starts with ")
  jpat constant text := '"Back-offs: ([0-9.]+)–([0-9.]+)% of today''s (top set|single)\. The app works out \1% from the weight you log on the \3\.';
  jrep constant text := '"Back-offs start at \1% of today''s \3 (the app works it out from the weight you log), up to \2%.';
BEGIN
  INSERT INTO public.program_note_backoff_wording_backup (row_id, old_notes)
  SELECT r.id, r.notes
  FROM public.pl_exercise_rows r
  WHERE r.notes ~ pat
    AND NOT EXISTS (SELECT 1 FROM public.pl_row_results rr WHERE rr.row_id = r.id AND rr.completed_at IS NOT NULL);

  UPDATE public.pl_exercise_rows r
  SET notes = regexp_replace(r.notes, pat, rep)
  WHERE r.notes ~ pat
    AND NOT EXISTS (SELECT 1 FROM public.pl_row_results rr WHERE rr.row_id = r.id AND rr.completed_at IS NOT NULL);

  INSERT INTO public.program_note_backoff_wording_backup (template_id, old_payload)
  SELECT t.id, t.payload FROM public.pl_templates t WHERE t.payload::text ~ jpat;

  UPDATE public.pl_templates t
  SET payload = regexp_replace(t.payload::text, jpat, jrep, 'g')::jsonb,
      payload_revision = coalesce(t.payload_revision, 0) + 1,
      updated_at = now()
  WHERE t.payload::text ~ jpat;
END $$;
