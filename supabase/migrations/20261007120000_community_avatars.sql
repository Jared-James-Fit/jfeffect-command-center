-- Community profile photos are the athlete's own choice.
--
-- The community used to show the account profile picture (for clients, the
-- camera-only identity photo taken for their coach). Now every community
-- face starts as initials and only shows a photo the person uploaded for the
-- community themselves. Their account / identity photo is never touched.
--
--   * Stored in the existing private `avatars` bucket under `<uid>/community-*`
--     (its policies already let any signed-in user read and only the owner
--     write), so UserAvatar's signed-URL cache works unchanged.
--   * community_author keeps the `avatar_url` key; it now carries that
--     storage path (or NULL), which UserAvatar resolves.

ALTER TABLE public.community_profiles
  ADD COLUMN IF NOT EXISTS avatar_path text CHECK (avatar_path IS NULL OR char_length(avatar_path) <= 300);

CREATE OR REPLACE FUNCTION public.community_author(_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'coach') THEN
      jsonb_build_object(
        'user_id', _user_id,
        'is_coach', true,
        'name', coalesce(
          nullif(btrim(co.first_name), ''),
          nullif(split_part(btrim(coalesce(co.full_name, p.full_name, '')), ' ', 1), ''),
          'Coach'),
        'avatar_url', cp.avatar_path)
    ELSE
      jsonb_build_object(
        'user_id', _user_id,
        'is_coach', false,
        'name', coalesce(
          nullif(btrim(c.preferred_name), ''),
          nullif(btrim(c.first_name), ''),
          nullif(split_part(btrim(coalesce(c.full_name, p.full_name, '')), ' ', 1), ''),
          'Athlete'),
        'avatar_url', cp.avatar_path)
  END
  FROM (SELECT 1) one
  LEFT JOIN public.profiles p ON p.id = _user_id
  LEFT JOIN public.coaches co ON co.user_id = _user_id
  LEFT JOIN public.clients c ON c.user_id = _user_id
  LEFT JOIN public.community_profiles cp ON cp.user_id = _user_id
$$;
REVOKE ALL ON FUNCTION public.community_author(uuid) FROM PUBLIC, anon, authenticated;

-- Set (or clear, with NULL) your own community photo. Only a path in your
-- own avatars folder is accepted. Returns the previous path so the client
-- can delete the old file.
CREATE OR REPLACE FUNCTION public.community_set_avatar(_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_path text := nullif(btrim(coalesce(_path, '')), '');
  v_old text;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_path IS NOT NULL AND (
       left(v_path, length(uid::text || '/community-')) <> uid::text || '/community-'
       OR v_path ~ '\.\.' OR char_length(v_path) > 300) THEN
    RAISE EXCEPTION 'Invalid photo';
  END IF;
  SELECT cp.avatar_path INTO v_old FROM public.community_profiles cp WHERE cp.user_id = uid;
  INSERT INTO public.community_profiles (user_id, avatar_path, updated_at) VALUES (uid, v_path, now())
  ON CONFLICT (user_id) DO UPDATE SET avatar_path = EXCLUDED.avatar_path, updated_at = now();
  RETURN jsonb_build_object('previous', v_old);
END;
$$;
REVOKE ALL ON FUNCTION public.community_set_avatar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_set_avatar(text) TO authenticated;
