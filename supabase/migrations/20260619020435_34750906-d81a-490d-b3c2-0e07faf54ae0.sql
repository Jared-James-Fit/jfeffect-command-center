UPDATE public.coaches c
SET profile_picture_url = p.avatar_url
FROM public.profiles p
WHERE c.user_id = p.id
  AND c.profile_picture_url IS NULL
  AND p.avatar_url IS NOT NULL;