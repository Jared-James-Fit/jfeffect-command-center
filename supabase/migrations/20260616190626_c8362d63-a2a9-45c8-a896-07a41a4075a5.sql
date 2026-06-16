
CREATE TABLE public.member_plan_day_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.member_plan_enrollments(id) ON DELETE CASCADE,
  week_index integer NOT NULL,
  day_index integer NOT NULL,
  scheduled_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, week_index, day_index)
);

CREATE INDEX idx_mpds_enrollment ON public.member_plan_day_schedule(enrollment_id);
CREATE INDEX idx_mpds_date ON public.member_plan_day_schedule(enrollment_id, scheduled_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_plan_day_schedule TO authenticated;
GRANT ALL ON public.member_plan_day_schedule TO service_role;

ALTER TABLE public.member_plan_day_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Member read own schedule"
  ON public.member_plan_day_schedule FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.member_plan_enrollments e
    WHERE e.id = member_plan_day_schedule.enrollment_id
      AND e.member_id = current_member_id()
  ));

CREATE POLICY "Member write own schedule when active"
  ON public.member_plan_day_schedule
  USING (
    member_can_consume(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.member_plan_enrollments e
      WHERE e.id = member_plan_day_schedule.enrollment_id
        AND e.member_id = current_member_id()
    )
  )
  WITH CHECK (
    member_can_consume(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.member_plan_enrollments e
      WHERE e.id = member_plan_day_schedule.enrollment_id
        AND e.member_id = current_member_id()
    )
  );

CREATE POLICY "Admin manage schedule"
  ON public.member_plan_day_schedule
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_mpds_updated_at
  BEFORE UPDATE ON public.member_plan_day_schedule
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
