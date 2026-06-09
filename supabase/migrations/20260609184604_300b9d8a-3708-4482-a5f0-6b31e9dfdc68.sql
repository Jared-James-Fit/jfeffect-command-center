
CREATE TABLE public.client_birthday_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  template_key text,
  headline text,
  message text,
  quote text,
  coach_message text,
  celebration_effect boolean NOT NULL DEFAULT true,
  show_message_coach_button boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_birthday_cards TO authenticated;
GRANT ALL ON public.client_birthday_cards TO service_role;

ALTER TABLE public.client_birthday_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and coaches can view birthday cards"
  ON public.client_birthday_cards FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));

CREATE POLICY "Admins and coaches can insert birthday cards"
  ON public.client_birthday_cards FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));

CREATE POLICY "Admins and coaches can update birthday cards"
  ON public.client_birthday_cards FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));

CREATE POLICY "Admins can delete birthday cards"
  ON public.client_birthday_cards FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Clients can view their own birthday card"
  ON public.client_birthday_cards FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_birthday_cards.client_id AND c.user_id = auth.uid()));

CREATE TRIGGER trg_birthday_cards_updated_at
  BEFORE UPDATE ON public.client_birthday_cards
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


CREATE TABLE public.client_birthday_card_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  birthday_year integer NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, birthday_year)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_birthday_card_views TO authenticated;
GRANT ALL ON public.client_birthday_card_views TO service_role;

ALTER TABLE public.client_birthday_card_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients manage own birthday card views"
  ON public.client_birthday_card_views FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_birthday_card_views.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_birthday_card_views.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Admins and coaches can view birthday card views"
  ON public.client_birthday_card_views FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));
