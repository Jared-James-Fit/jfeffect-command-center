
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO authenticated;
GRANT ALL ON public.recipes TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_client_access TO authenticated;
GRANT ALL ON public.recipe_client_access TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_notifications TO authenticated;
GRANT ALL ON public.recipe_notifications TO service_role;
