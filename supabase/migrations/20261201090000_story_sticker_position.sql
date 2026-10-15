-- A story sticker can be moved: `y` is where its middle sits, as a share of
-- the story's height, kept to the band between the name at the top and the
-- reply bar (0.20–0.66, 2 places; STICKER_Y_MIN / STICKER_Y_MAX in
-- lessons.ts). Missing = the usual spot just above the reply bar.
--
-- Every sticker is stored through this cleaner (a planned lesson's, a library
-- entry's, one put on your own post), so it's the one change: the same
-- sticker as before plus its spot. Moving one keeps its answers
-- (community_set_sticker only starts over for a different type or answers).
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.community_sticker_clean(_s jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  v_type text := _s->>'type';
  v_q text := btrim(coalesce(_s->>'q', ''));
  v_opts jsonb := '[]'::jsonb;
  v_o jsonb;
  v_label text;
  v_tag text;
  v_emoji text;
  v_at jsonb := '{}'::jsonb;
BEGIN
  IF _s IS NULL OR jsonb_typeof(_s) <> 'object' THEN RETURN NULL; END IF;
  IF v_type IS NULL OR v_type NOT IN ('poll', 'slider', 'question') THEN RAISE EXCEPTION 'Pick a poll, a slider or a question'; END IF;
  IF char_length(v_q) < 1 OR char_length(v_q) > 80 THEN RAISE EXCEPTION 'Keep the question to 80 characters'; END IF;
  -- where it sits on the story (anything that isn't a number: the usual spot)
  IF jsonb_typeof(_s->'y') = 'number' THEN
    v_at := jsonb_build_object('y', round(least(greatest((_s->>'y')::numeric, 0.20), 0.66), 2));
  END IF;
  IF v_type = 'poll' THEN
    IF jsonb_typeof(_s->'options') <> 'array' OR jsonb_array_length(_s->'options') NOT BETWEEN 2 AND 4 THEN
      RAISE EXCEPTION 'A poll needs 2 to 4 answers';
    END IF;
    FOR v_o IN SELECT * FROM jsonb_array_elements(_s->'options') LOOP
      v_label := btrim(coalesce(CASE WHEN jsonb_typeof(v_o) = 'string' THEN v_o #>> '{}' ELSE v_o->>'label' END, ''));
      v_tag := CASE WHEN jsonb_typeof(v_o) = 'object' THEN nullif(lower(btrim(coalesce(v_o->>'tag', ''))), '') END;
      IF char_length(v_label) < 1 OR char_length(v_label) > 24 THEN RAISE EXCEPTION 'Keep each answer to 24 characters'; END IF;
      IF v_tag IS NOT NULL AND v_tag !~ '^[a-z0-9-]{1,32}$' THEN v_tag := NULL; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_opts) e WHERE lower(e->>'label') = lower(v_label)) THEN
        RAISE EXCEPTION 'Each answer needs to be different';
      END IF;
      v_opts := v_opts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('label', v_label, 'tag', v_tag)));
    END LOOP;
    RETURN jsonb_build_object('type', 'poll', 'q', v_q, 'options', v_opts) || v_at;
  ELSIF v_type = 'slider' THEN
    v_emoji := btrim(coalesce(_s->>'emoji', ''));
    IF v_emoji = '' OR char_length(v_emoji) > 8 THEN v_emoji := '🔥'; END IF;
    RETURN jsonb_build_object('type', 'slider', 'q', v_q, 'emoji', v_emoji) || v_at;
  END IF;
  RETURN jsonb_build_object('type', 'question', 'q', v_q) || v_at;
END;
$$;
