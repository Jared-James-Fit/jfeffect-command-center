-- A session's own `notes` are the note TO the client: clients read every column
-- of their own pt_sessions rows (client_visible_notes only hid it in the app),
-- and the calendar feed puts it in their phone's calendar. The coach's reasons
-- live in pt_session_coach_notes (staff only). The session editor used to call
-- the client's note just "Notes", so a reason typed there reached the client
-- and never showed where the coach reads his notes.

-- 1. Colten's Oct 29 cancel: the reason went into the client's note.
--    Exact-text guard, so this only ever moves that one note.
WITH moved AS (
  SELECT id, btrim(notes) AS note
  FROM public.pt_sessions
  WHERE id = 'c0e851ae-310e-4bfe-b7cc-61da7cd02c8c'
    AND btrim(notes) = 'Colten booked a foot tattoo friday'
)
INSERT INTO public.pt_session_coach_notes (pt_session_id, client_id, note)
SELECT m.id, s.client_id, m.note
FROM moved m JOIN public.pt_sessions s ON s.id = m.id
ON CONFLICT (pt_session_id) DO UPDATE
  SET note = left(public.pt_session_coach_notes.note || E'\n' || EXCLUDED.note, 2000),
      updated_at = now()
  WHERE position(EXCLUDED.note IN public.pt_session_coach_notes.note) = 0;

UPDATE public.pt_sessions
SET notes = NULL
WHERE id = 'c0e851ae-310e-4bfe-b7cc-61da7cd02c8c'
  AND btrim(notes) = 'Colten booked a foot tattoo friday';

-- 2. Any note "hidden" from the client was never private: it's the coach's note.
INSERT INTO public.pt_session_coach_notes (pt_session_id, client_id, note)
SELECT s.id, s.client_id, left(btrim(s.notes), 2000)
FROM public.pt_sessions s
WHERE s.client_visible_notes = false AND nullif(btrim(s.notes), '') IS NOT NULL
ON CONFLICT (pt_session_id) DO UPDATE
  SET note = left(public.pt_session_coach_notes.note || E'\n' || EXCLUDED.note, 2000),
      updated_at = now()
  WHERE position(EXCLUDED.note IN public.pt_session_coach_notes.note) = 0;

UPDATE public.pt_sessions
SET notes = NULL, client_visible_notes = true
WHERE client_visible_notes = false AND nullif(btrim(notes), '') IS NOT NULL;
