-- Which AI service makes Athlete Insights (Lovable AI or OpenAI only) is AI
-- infrastructure: the admin's call, never a coach's. The switch in Crew →
-- Posts → Athlete Insights shows only to the admin; this makes the database
-- refuse anyone else too (it was any community staff). Same body otherwise.
CREATE OR REPLACE FUNCTION public.community_daily_visuals_set_lovable(_on boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an admin can change this' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_series_settings SET daily_visuals_lovable = coalesce(_on, false), updated_at = now() WHERE id;
  -- a maker that was waiting on an AI tries again now
  DELETE FROM public.app_settings WHERE key = 'daily_visuals_status' AND value LIKE '%"blocked"%';
  PERFORM public.community_daily_visuals_kick(false);
  RETURN coalesce(_on, false);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_set_lovable(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_set_lovable(boolean) TO authenticated;
