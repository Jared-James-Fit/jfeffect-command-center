-- Saturday Spirit posts carry a drawn scene (series_data.scene) instead of a
-- photo. The coach can take it off (to post the words alone, or a photo of
-- their own as the cover): same people as editing the note's words.
CREATE OR REPLACE FUNCTION public.community_remove_note_scene(_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.community_posts p
     SET series_data = CASE WHEN p.series_data ? 'scene' THEN nullif(p.series_data - 'scene', '{}'::jsonb) ELSE p.series_data END,
         edited_at = now(), updated_at = now()
   WHERE p.id = _post_id AND p.kind = 'note'
     AND (p.author_user_id = public.community_main_account(uid) OR public.is_community_staff());
  IF NOT FOUND THEN RAISE EXCEPTION 'Post not found'; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.community_remove_note_scene(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_remove_note_scene(uuid) TO authenticated;
