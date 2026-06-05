
-- Allow clients to delete their own lift videos and check-in media
CREATE POLICY "Client delete own lift_videos"
  ON public.lift_videos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = lift_videos.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Client delete own media_items"
  ON public.media_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = media_items.client_id AND c.user_id = auth.uid()));

-- Auto-delete metadata records older than 14 days for lift videos and check-in media.
-- Drive files are not touched.
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.purge_old_client_media()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.lift_videos WHERE created_at < now() - interval '14 days';
  DELETE FROM public.media_items
   WHERE created_at < now() - interval '14 days'
     AND media_type IN ('Check-In Videos', 'Progress Photos');
END;
$$;

SELECT cron.schedule(
  'purge-old-client-media-daily',
  '0 8 * * *',
  $$SELECT public.purge_old_client_media();$$
);
