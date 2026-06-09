CREATE TABLE public.client_birthday_wishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  birthday_year int NOT NULL,
  wished_at timestamptz NOT NULL DEFAULT now(),
  wished_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, birthday_year)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_birthday_wishes TO authenticated;
GRANT ALL ON public.client_birthday_wishes TO service_role;

ALTER TABLE public.client_birthday_wishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view birthday wishes"
  ON public.client_birthday_wishes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));

CREATE POLICY "Admins/coaches can insert birthday wishes"
  ON public.client_birthday_wishes FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));

CREATE POLICY "Admins/coaches can update birthday wishes"
  ON public.client_birthday_wishes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));

CREATE POLICY "Admins can delete birthday wishes"
  ON public.client_birthday_wishes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX client_birthday_wishes_client_year_idx
  ON public.client_birthday_wishes (client_id, birthday_year);