-- Instagram's Questions: the poster can type into their own question box and
-- send it too; it lands in their own Responses like anyone's (and can be
-- answered with a story the same way). Polls and sliders already let the
-- poster answer. Patched in place so nothing else in the function moves.
SET lock_timeout = '3s';

DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_sticker_answer(uuid,integer,integer,text)'::regprocedure);
  v_old text := E'    IF v_author = v_me THEN RAISE EXCEPTION ''That''''s your own question''; END IF;\n';
BEGIN
  IF position('own question' IN v_def) = 0 THEN RETURN; END IF; -- already patched
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'community_sticker_answer: own-question line not found'; END IF;
  EXECUTE replace(v_def, v_old, '');
END $$;
