CREATE TABLE public.member_bodyweight_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  weight numeric(6,2) NOT NULL,
  unit text NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb','kg')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_date)
);

CREATE INDEX member_bodyweight_logs_user_date_idx ON public.member_bodyweight_logs (user_id, entry_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_bodyweight_logs TO authenticated;
GRANT ALL ON public.member_bodyweight_logs TO service_role;

ALTER TABLE public.member_bodyweight_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage own bodyweight logs"
  ON public.member_bodyweight_logs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins manage all member bodyweight logs"
  ON public.member_bodyweight_logs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.tg_member_bodyweight_logs_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER tg_member_bodyweight_logs_updated_at
  BEFORE UPDATE ON public.member_bodyweight_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_bodyweight_logs_updated_at();