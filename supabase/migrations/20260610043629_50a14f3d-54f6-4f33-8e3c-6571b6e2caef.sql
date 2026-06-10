-- Background sweep: flip stuck client lift uploads to "Upload Failed" so the
-- card unfreezes and the client can resend. Safe to run repeatedly; only
-- targets rows that:
--   * are still in "Uploading" state
--   * are older than 15 minutes
--   * have neither a Supabase Storage path NOR a Drive/link URL
-- so we can't accidentally mark a successful upload as failed.
CREATE OR REPLACE FUNCTION public.mark_stale_lift_uploads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH upd AS (
    UPDATE public.lift_videos
       SET upload_status = 'Upload Failed',
           playback_error = COALESCE(
             playback_error,
             'Upload did not finish in time. Please re-send this clip.'
           )
     WHERE upload_status = 'Uploading'
       AND created_at < now() - interval '15 minutes'
       AND video_storage_path IS NULL
       AND video_url IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN COALESCE(v_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_stale_lift_uploads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_stale_lift_uploads() TO service_role;