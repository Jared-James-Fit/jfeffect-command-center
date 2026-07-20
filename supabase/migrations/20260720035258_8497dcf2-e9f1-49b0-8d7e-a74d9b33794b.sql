
-- Scope broad coach access policies to assigned coaches only

-- cardio_completions
DROP POLICY IF EXISTS "admin_coach_cardio_completions" ON public.cardio_completions;
CREATE POLICY "admin_coach_cardio_completions" ON public.cardio_completions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR (public.has_role(auth.uid(), 'coach'::app_role) AND public.is_assigned_coach(client_id)))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR (public.has_role(auth.uid(), 'coach'::app_role) AND public.is_assigned_coach(client_id)));

-- member_payment_ledger
DROP POLICY IF EXISTS "admin_coach_full_access_payment_ledger" ON public.member_payment_ledger;
CREATE POLICY "admin_coach_full_access_payment_ledger" ON public.member_payment_ledger
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR (public.has_role(auth.uid(), 'coach'::app_role) AND public.is_assigned_coach_for_member(member_id)))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR (public.has_role(auth.uid(), 'coach'::app_role) AND public.is_assigned_coach_for_member(member_id)));

-- pl_scheduled_workouts
DROP POLICY IF EXISTS "Admins and coaches manage scheduled workouts" ON public.pl_scheduled_workouts;
CREATE POLICY "Admins and coaches manage scheduled workouts" ON public.pl_scheduled_workouts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR (public.has_role(auth.uid(), 'coach'::app_role) AND public.is_assigned_coach(client_id)))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR (public.has_role(auth.uid(), 'coach'::app_role) AND public.is_assigned_coach(client_id)));

-- weekly_checkin_threads (has both client_id and member_id, either may be non-null)
DROP POLICY IF EXISTS "admin_coach_threads_full" ON public.weekly_checkin_threads;
CREATE POLICY "admin_coach_threads_full" ON public.weekly_checkin_threads
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      public.has_role(auth.uid(), 'coach'::app_role)
      AND (
        (client_id IS NOT NULL AND public.is_assigned_coach(client_id))
        OR (member_id IS NOT NULL AND public.is_assigned_coach_for_member(member_id))
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      public.has_role(auth.uid(), 'coach'::app_role)
      AND (
        (client_id IS NOT NULL AND public.is_assigned_coach(client_id))
        OR (member_id IS NOT NULL AND public.is_assigned_coach_for_member(member_id))
      )
    )
  );

-- weekly_checkin_messages: scope via parent thread
DROP POLICY IF EXISTS "admin_coach_messages_full" ON public.weekly_checkin_messages;
CREATE POLICY "admin_coach_messages_full" ON public.weekly_checkin_messages
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      public.has_role(auth.uid(), 'coach'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.weekly_checkin_threads t
        WHERE t.id = weekly_checkin_messages.thread_id
          AND (
            (t.client_id IS NOT NULL AND public.is_assigned_coach(t.client_id))
            OR (t.member_id IS NOT NULL AND public.is_assigned_coach_for_member(t.member_id))
          )
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      public.has_role(auth.uid(), 'coach'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.weekly_checkin_threads t
        WHERE t.id = weekly_checkin_messages.thread_id
          AND (
            (t.client_id IS NOT NULL AND public.is_assigned_coach(t.client_id))
            OR (t.member_id IS NOT NULL AND public.is_assigned_coach_for_member(t.member_id))
          )
      )
    )
  );

-- coaching_applications: restrict anonymous public inserts to only lead-form
-- columns; internal workflow fields must not be settable by anon submitters.
DROP POLICY IF EXISTS "coaching_applications public submit" ON public.coaching_applications;
CREATE POLICY "coaching_applications public submit" ON public.coaching_applications
  FOR INSERT TO anon
  WITH CHECK (
    full_name IS NOT NULL
    AND email IS NOT NULL
    AND char_length(full_name) BETWEEN 1 AND 200
    AND char_length(email) BETWEEN 3 AND 320
    -- Internal workflow / linkage fields must be null on anonymous submission
    AND client_id IS NULL
    AND appointment_id IS NULL
    AND assigned_to IS NULL
    AND application_status IS NULL
    AND lead_score IS NULL
    AND lead_temperature IS NULL
    AND qualification_label IS NULL
    AND recommended_offer IS NULL
    AND call_status IS NULL
    AND follow_up_at IS NULL
    AND notes_admin IS NULL
    AND scoring IS NULL
    AND summary IS NULL
    AND status = 'new'
  );
