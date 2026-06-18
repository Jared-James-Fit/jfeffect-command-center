CREATE POLICY "Coaches manage all member nutrition targets"
  ON public.member_nutrition_targets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coach'))
  WITH CHECK (public.has_role(auth.uid(), 'coach'));