
CREATE TABLE public.coach_faqs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('nutrition','workouts','cardio')),
  question text NOT NULL,
  answer text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX coach_faqs_category_idx ON public.coach_faqs(category, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_faqs TO authenticated;
GRANT ALL ON public.coach_faqs TO service_role;

ALTER TABLE public.coach_faqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view active FAQs"
  ON public.coach_faqs FOR SELECT TO authenticated
  USING (active = true OR public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'coach'::app_role));

CREATE POLICY "Admins and coaches can insert FAQs"
  ON public.coach_faqs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'coach'::app_role));

CREATE POLICY "Admins and coaches can update FAQs"
  ON public.coach_faqs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'coach'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'coach'::app_role));

CREATE POLICY "Admins and coaches can delete FAQs"
  ON public.coach_faqs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'coach'::app_role));

CREATE TRIGGER coach_faqs_set_updated_at
  BEFORE UPDATE ON public.coach_faqs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
