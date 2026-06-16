-- Drop the overly broad "any authenticated user can read" policy.
DROP POLICY IF EXISTS "Authenticated read broadcast media" ON storage.objects;

-- Replacement: only readable by admins/coaches, or by users who can see
-- the specific broadcast that owns this object (matched by voice_path /
-- video_path). Uses the existing user_can_see_broadcast(...) helper so the
-- audience rules stay in one place.
CREATE POLICY "Visible-broadcast read broadcast media"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'broadcast-media'
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.current_coach_id() IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.broadcasts b
        WHERE (b.voice_path = storage.objects.name OR b.video_path = storage.objects.name)
          AND public.user_can_see_broadcast(auth.uid(), b.id)
      )
    )
  );

-- Helpful index so the EXISTS check above stays fast as broadcasts grow.
CREATE INDEX IF NOT EXISTS idx_broadcasts_voice_path
  ON public.broadcasts (voice_path) WHERE voice_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_broadcasts_video_path
  ON public.broadcasts (video_path) WHERE video_path IS NOT NULL;