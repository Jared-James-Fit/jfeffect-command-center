CREATE TABLE public.admin_dashboard_prefs (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  section_order JSONB NOT NULL DEFAULT '["priority","quick_actions","metrics","clients_needing_action","today_schedule","payment_issues"]'::jsonb,
  hidden_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_dashboard_prefs TO authenticated;
GRANT ALL ON public.admin_dashboard_prefs TO service_role;

ALTER TABLE public.admin_dashboard_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own dashboard prefs"
  ON public.admin_dashboard_prefs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_admin_dashboard_prefs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_admin_dashboard_prefs_updated_at
  BEFORE UPDATE ON public.admin_dashboard_prefs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_admin_dashboard_prefs_updated_at();