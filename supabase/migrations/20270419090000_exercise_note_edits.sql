-- Exercise notes are edited in place, any time, and nothing they said is lost.
--
-- A note is one row per exercise per workout (pl_exercise_notes, unique on
-- client + day + row). Editing it, today's or one from a past workout, block
-- or program, changes that same row: never a second note. Before the words
-- change, the version being replaced is kept in pl_exercise_note_revisions
-- (the original included), so every earlier wording stays readable.
--
--  * edited_at: when its words last changed. updated_at isn't that: the
--    coach marking a note seen moves it too.
--  * The day it was written (created_at) and the workout it belongs to
--    (client, day, exercise row) never change once it exists.
--  * The coach's card follows the note: an edit updates the card the coach
--    already has (its words and the inbox preview), as the server, with no
--    second card and no push. Only a note's first words post a card.
--
-- Revisions are written only by the trigger; the athlete, their coach and
-- admins can read them. They hang off the client, not the note, so a note
-- that goes to the trash with its exercise (pl_trash_exercise_row) and comes
-- back (pl_restore_exercise_row, same id) still has its history.

ALTER TABLE public.pl_exercise_notes ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Notes edited before this kept no earlier wording; the last change is the best date there is.
ALTER TABLE public.pl_exercise_notes DISABLE TRIGGER tg_pl_exercise_notes_updated;
UPDATE public.pl_exercise_notes
   SET edited_at = updated_at
 WHERE status = 'edited' AND edited_at IS NULL;
ALTER TABLE public.pl_exercise_notes ENABLE TRIGGER tg_pl_exercise_notes_updated;

CREATE TABLE IF NOT EXISTS public.pl_exercise_note_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  content text NOT NULL,
  -- when this wording was saved (the note's created_at for the original)
  written_at timestamptz NOT NULL,
  -- when an edit replaced it, and who made that edit
  replaced_at timestamptz NOT NULL DEFAULT now(),
  replaced_by uuid
);
CREATE INDEX IF NOT EXISTS pl_exercise_note_revisions_note_idx ON public.pl_exercise_note_revisions (note_id, written_at);
CREATE INDEX IF NOT EXISTS pl_exercise_note_revisions_client_idx ON public.pl_exercise_note_revisions (client_id);

ALTER TABLE public.pl_exercise_note_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pl_exercise_note_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pl_exercise_note_revisions TO authenticated;
GRANT ALL ON public.pl_exercise_note_revisions TO service_role;

DROP POLICY IF EXISTS "Athlete reads own note versions" ON public.pl_exercise_note_revisions;
CREATE POLICY "Athlete reads own note versions" ON public.pl_exercise_note_revisions
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff read note versions" ON public.pl_exercise_note_revisions;
CREATE POLICY "Staff read note versions" ON public.pl_exercise_note_revisions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
         OR client_id IN (SELECT public.coached_client_ids()));

-- Before an update: the note keeps its day and workout, and the wording an
-- edit replaces is kept.
CREATE OR REPLACE FUNCTION public.tg_pl_exercise_note_keep_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  -- the app never moves a note to another workout (a server repair still can)
  IF (SELECT auth.uid()) IS NOT NULL THEN
    NEW.client_id := OLD.client_id;
    NEW.day_id := OLD.day_id;
    -- an exercise row's delete sets row_id to null (FK); a note never moves to another row
    IF NEW.row_id IS NOT NULL AND NEW.row_id IS DISTINCT FROM OLD.row_id THEN
      NEW.row_id := OLD.row_id;
    END IF;
  END IF;

  IF btrim(coalesce(NEW.content, '')) IS DISTINCT FROM btrim(coalesce(OLD.content, '')) THEN
    IF nullif(btrim(coalesce(OLD.content, '')), '') IS NOT NULL THEN
      INSERT INTO public.pl_exercise_note_revisions (note_id, client_id, content, written_at, replaced_by)
      VALUES (OLD.id, OLD.client_id, OLD.content, coalesce(OLD.edited_at, OLD.created_at), (SELECT auth.uid()));
    END IF;
    NEW.edited_at := now();
    NEW.status := 'edited';
  ELSE
    -- nothing was reworded (a seen mark, a re-save): it isn't an edit
    NEW.edited_at := OLD.edited_at;
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_pl_exercise_note_keep_version() FROM PUBLIC, anon, authenticated;

-- Named to run first among the BEFORE UPDATE triggers (alphabetical), so the
-- coach trigger sees the edit's edited_at.
DROP TRIGGER IF EXISTS tg_pl_exercise_notes_keep_version ON public.pl_exercise_notes;
CREATE TRIGGER tg_pl_exercise_notes_keep_version
  BEFORE UPDATE ON public.pl_exercise_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_exercise_note_keep_version();

-- The coach's card: a note's first words post it (a coaching client writing
-- it themselves, as before); an edit updates that same card and its preview.
CREATE OR REPLACE FUNCTION public.tg_exercise_note_to_coach()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sender uuid;
  v_note text := nullif(btrim(coalesce(NEW.content, '')), '');
  v_old text;
  v_title text;
  v_msg uuid;
  v_claims text;
  v_sub text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := nullif(btrim(coalesce(OLD.content, '')), '');
    IF v_note IS NOT DISTINCT FROM v_old THEN RETURN NEW; END IF;

    IF NEW.coach_message_id IS NOT NULL THEN
      -- as the server: an athlete can't rewrite their own message, and this
      -- one only follows their note (no edited mark on the bubble, no unread)
      v_claims := current_setting('request.jwt.claims', true);
      v_sub := current_setting('request.jwt.claim.sub', true);
      PERFORM set_config('request.jwt.claims', '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      UPDATE public.messages m
         SET body = left('📝 ' || coalesce(nullif(NEW.exercise_name, '') || ': ', '') || coalesce(v_note, 'note removed'), 400),
             attachments = (
               SELECT jsonb_agg(
                        CASE WHEN a ->> 'kind' = 'workout_note' AND a ->> 'note_id' = NEW.id::text
                             THEN a || jsonb_build_object('note', v_note, 'edited_at', NEW.edited_at)
                             ELSE a END
                        ORDER BY t.ord)
                 FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS t(a, ord))
       WHERE m.id = NEW.coach_message_id
         AND m.deleted_at IS NULL
         AND jsonb_typeof(m.attachments) = 'array'
         AND jsonb_array_length(m.attachments) > 0;
      PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
      RETURN NEW;
    END IF;

    -- rewording a note never posts a card: only its first words do
    IF v_old IS NOT NULL THEN RETURN NEW; END IF;
  END IF;

  IF v_note IS NULL THEN RETURN NEW; END IF;
  -- a note put back from the trash keeps the card it had
  IF NEW.coach_message_id IS NOT NULL THEN RETURN NEW; END IF;
  v_sender := public.workout_note_sender(NEW.client_id);
  IF v_sender IS NULL THEN RETURN NEW; END IF;

  SELECT d.title INTO v_title FROM public.pl_days d WHERE d.id = NEW.day_id;
  INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, delivery_status, sent_at, read_by_client_at)
  VALUES (
    NEW.client_id, v_sender, 'client',
    left('📝 ' || coalesce(nullif(NEW.exercise_name, '') || ': ', '') || v_note, 400),
    jsonb_build_array(jsonb_build_object(
      'type', 'file', 'url', '', 'kind', 'workout_note', 'source', 'exercise',
      'note_id', NEW.id, 'day_id', NEW.day_id, 'row_id', NEW.row_id,
      'exercise', NEW.exercise_name, 'workout', v_title, 'at', coalesce(NEW.created_at, now()),
      'note', v_note)),
    'Workout Note', 'sent', now(), now())
  RETURNING id INTO v_msg;
  NEW.coach_message_id := v_msg;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_exercise_note_to_coach() FROM PUBLIC, anon, authenticated;

-- The coach's notes log: an exercise note's edited date is when its words
-- changed, and how many earlier versions it has.
CREATE OR REPLACE FUNCTION public.client_workout_notes(_client_id uuid, _limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT (public.has_role(uid, 'admin') OR public.is_assigned_coach(_client_id)
          OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.user_id = uid)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(s.x ORDER BY s.at DESC)
      FROM (
        SELECT u.x, u.at
          FROM (
            SELECT coalesce(pc.completed_at, f.review_submitted_at, f.created_at) AS at,
                   jsonb_build_object(
                     'id', f.id, 'source', 'review', 'at', coalesce(pc.completed_at, f.review_submitted_at, f.created_at),
                     'edited_at', f.review_last_edited_at, 'day_id', f.day_id, 'row_id', NULL, 'workout', d.title, 'exercise', NULL,
                     'note', nullif(btrim(coalesce(f.client_note, '')), ''),
                     'pain', CASE WHEN f.pain THEN jsonb_build_object('area', f.pain_area, 'level', f.pain_level) END,
                     'rpe', f.session_rpe, 'message_id', f.coach_message_id, 'versions', 0) AS x
              FROM public.pl_workout_feedback f
              LEFT JOIN public.pl_days d ON d.id = f.day_id
              LEFT JOIN public.pl_day_completions pc ON pc.id = f.completion_id
             WHERE f.client_id = _client_id AND (f.pain OR nullif(btrim(coalesce(f.client_note, '')), '') IS NOT NULL)
            UNION ALL
            SELECT n.created_at,
                   jsonb_build_object(
                     'id', n.id, 'source', 'exercise', 'at', n.created_at,
                     'edited_at', coalesce(n.edited_at, CASE WHEN n.status = 'edited' THEN n.updated_at END),
                     'day_id', n.day_id, 'row_id', n.row_id,
                     'workout', d.title, 'exercise', n.exercise_name, 'note', nullif(btrim(coalesce(n.content, '')), ''),
                     'pain', NULL, 'rpe', NULL, 'message_id', n.coach_message_id,
                     'versions', (SELECT count(*) FROM public.pl_exercise_note_revisions r WHERE r.note_id = n.id)) AS x
              FROM public.pl_exercise_notes n
              LEFT JOIN public.pl_days d ON d.id = n.day_id
             WHERE n.client_id = _client_id AND nullif(btrim(coalesce(n.content, '')), '') IS NOT NULL
          ) u
         ORDER BY u.at DESC
         LIMIT greatest(1, least(coalesce(_limit, 200), 500))
      ) s
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.client_workout_notes(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_workout_notes(uuid, int) TO authenticated, service_role;
