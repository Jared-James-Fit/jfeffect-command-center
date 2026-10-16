-- Who answered a story's question (or voted, or slid) is only ever the
-- poster's to see, like Instagram: not the crew, not other staff, not
-- anyone who saw the poster answer it on their story. community_sticker_json
-- takes the viewer as an argument, so it must only run inside the functions
-- that pass the signed-in person (community_post_json, community_sticker_answer,
-- community_sticker_mark_answered, all SECURITY DEFINER). Signed-in users
-- could call it directly with the poster's id and read the names; now they
-- can't. The answers table is read only through those functions (RLS on, no
-- policies); its leftover table grants go too.
REVOKE ALL ON FUNCTION public.community_sticker_json(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_sticker_json(uuid, uuid) TO service_role;
REVOKE ALL ON TABLE public.community_sticker_answers FROM anon, authenticated;
