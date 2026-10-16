-- Repost notes keep their line breaks (Return starts a new line, like
-- Instagram's): blank lines stay, but none at the ends; spaces inside a line
-- fold to one; at most 6 lines (extra ones join the last) and 60 characters,
-- a line break counting as one. Mirrors cleanRepostNote (src/lib/community.ts).
-- Notes already kept are one line, so they read the same.
CREATE OR REPLACE FUNCTION public.community_repost_note_clean(_note text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  v_lines text[];
  v_n int;
BEGIN
  SELECT array_agg(btrim(regexp_replace(t.l, '\s+', ' ', 'g')) ORDER BY t.i)
    INTO v_lines
    FROM unnest(string_to_array(regexp_replace(coalesce(_note, ''), '\r\n?', E'\n', 'g'), E'\n')) WITH ORDINALITY AS t(l, i);
  -- no blank lines at the ends
  WHILE coalesce(array_length(v_lines, 1), 0) > 0 AND v_lines[1] = '' LOOP
    v_lines := v_lines[2:];
  END LOOP;
  WHILE coalesce(array_length(v_lines, 1), 0) > 0 AND v_lines[array_length(v_lines, 1)] = '' LOOP
    v_lines := v_lines[1:array_length(v_lines, 1) - 1];
  END LOOP;
  v_n := coalesce(array_length(v_lines, 1), 0);
  IF v_n = 0 THEN RETURN NULL; END IF;
  IF v_n > 6 THEN
    v_lines := v_lines[1:5] || btrim(regexp_replace(array_to_string(v_lines[6:], ' '), '\s+', ' ', 'g'));
  END IF;
  RETURN nullif(regexp_replace(left(array_to_string(v_lines, E'\n'), 60), '\s+$', ''), '');
END;
$$;

REVOKE ALL ON FUNCTION public.community_repost_note_clean(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_repost_note_clean(text) TO service_role;
