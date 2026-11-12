-- A coach's nutrition notes on a client are notes in the one list
-- (client_file_notes), tagged with a topic: the Nutrition tab's Food & diet
-- card shows and adds the 'nutrition' ones, they still show on Summary and in
-- the chat's Notes like every other note, and the nutrition AI reads them.
-- Access is the table's own (admins and the client's own coach, never the client).

ALTER TABLE public.client_file_notes
  ADD COLUMN IF NOT EXISTS topic text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_file_notes_topic_check'
  ) THEN
    ALTER TABLE public.client_file_notes
      ADD CONSTRAINT client_file_notes_topic_check CHECK (topic IS NULL OR topic IN ('nutrition'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS client_file_notes_topic_idx
  ON public.client_file_notes (client_id, topic)
  WHERE topic IS NOT NULL AND archived_at IS NULL;
