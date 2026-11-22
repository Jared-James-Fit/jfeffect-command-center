-- Rollback for 20270506090000_lift_video_notes.sql (film notes on set videos).
-- The chat messages that carried a note stay (they're the client's chat record);
-- only the notes on the video and their functions go.
BEGIN;
DROP FUNCTION IF EXISTS public.lift_video_note_remove(uuid, boolean, boolean);
DROP FUNCTION IF EXISTS public.lift_video_note_sent(uuid, uuid);
DROP FUNCTION IF EXISTS public.lift_video_note_save(uuid, uuid, numeric, jsonb, text, jsonb);
DROP FUNCTION IF EXISTS public._lift_video_note_shapes_ok(jsonb);
DROP TABLE IF EXISTS public.lift_video_notes;
COMMIT;
