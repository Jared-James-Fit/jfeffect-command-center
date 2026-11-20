-- ROLLBACK for supabase/migrations/20270423090000_security_hardening.sql
--
-- NOT a migration: it lives outside supabase/migrations so it never runs by
-- itself. Run one section at a time, only for the part that broke something,
-- through the database's SQL runner, then tell the developer. Every section
-- re-opens the hole that part of the migration closed, so prefer fixing
-- forward. Captured from production on Nov 17 2026: every "before" below is
-- exactly what production had then (function bodies match their original
-- migrations byte for byte; grants and policies read from pg_proc / pg_policies).
--
-- Never roll back: the retired checkout switch (keep public_checkout_enabled =
-- false; its server functions refuse anyway) and auth_user_id_for_email
-- (unused by anything else, the recovery code needs it).
--
-- Emergency switch that needs no rollback: if SMS recovery misbehaves,
--   UPDATE public.sms_settings SET security_texts_enabled = false;
-- stops every account-access text (recovery, setup and sign-in links);
-- email recovery keeps working.

-- ── R1. Worker / job functions callable by signed-in users again ────────────
GRANT EXECUTE ON FUNCTION public.claim_scheduled_messages(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_message_for_retry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_message_send(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_message_sending(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_message_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_response_safe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_schedule_send(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_schedule_sending(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_session_for_pt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_sessions_if_paid_in_full(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_overdue_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_lift_uploads() TO authenticated;
GRANT EXECUTE ON FUNCTION public.maybe_refresh_water_target(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_default_member_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_athlete_achievements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_last_contacted_map(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_sessions_due_today() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xp_client_for_user(uuid) TO PUBLIC, anon, authenticated;

-- ── R2. pl_clone_blocks_for_rows without the coach check (June 14 version) ──
CREATE OR REPLACE FUNCTION public.pl_clone_blocks_for_rows(p_mappings jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m record;
  block_row record;
  id_map jsonb := '{}'::jsonb;
  new_block_id uuid;
  total int := 0;
BEGIN
  IF p_mappings IS NULL OR jsonb_array_length(p_mappings) = 0 THEN
    RETURN 0;
  END IF;

  -- Pass 1: clone blocks + children.
  FOR m IN
    SELECT (elem->>'source_row_id')::uuid AS src_row,
           (elem->>'dest_row_id')::uuid   AS dst_row
      FROM jsonb_array_elements(p_mappings) AS elem
  LOOP
    FOR block_row IN
      SELECT * FROM public.pl_exercise_blocks
       WHERE row_id = m.src_row
       ORDER BY sort_order
    LOOP
      INSERT INTO public.pl_exercise_blocks (
        row_id, sort_order, block_type, label, sets, reps_text, rpe, rir,
        load_type, load_value, load_unit, reference_block_id,
        rest_seconds_override, tempo, amrap, notes, config
      ) VALUES (
        m.dst_row, block_row.sort_order, block_row.block_type, block_row.label,
        block_row.sets, block_row.reps_text, block_row.rpe, block_row.rir,
        block_row.load_type, block_row.load_value, block_row.load_unit,
        NULL,
        block_row.rest_seconds_override, block_row.tempo, block_row.amrap,
        block_row.notes, block_row.config
      ) RETURNING id INTO new_block_id;

      id_map := id_map || jsonb_build_object(block_row.id::text, new_block_id::text);

      INSERT INTO public.pl_block_set_rows
        (block_id, sort_order, reps_text, load_value, load_unit, rpe, rir, amrap)
      SELECT new_block_id, sort_order, reps_text, load_value, load_unit, rpe, rir, amrap
        FROM public.pl_block_set_rows
       WHERE block_id = block_row.id
       ORDER BY sort_order;

      INSERT INTO public.pl_block_drop_stages
        (block_id, sort_order, reduction_type, reduction_value, reps_text, rpe, rir, amrap, rest_seconds)
      SELECT new_block_id, sort_order, reduction_type, reduction_value, reps_text, rpe, rir, amrap, rest_seconds
        FROM public.pl_block_drop_stages
       WHERE block_id = block_row.id
       ORDER BY sort_order;

      total := total + 1;
    END LOOP;
  END LOOP;

  -- Pass 2: remap reference_block_id within the same clone batch.
  FOR m IN
    SELECT (elem->>'source_row_id')::uuid AS src_row
      FROM jsonb_array_elements(p_mappings) AS elem
  LOOP
    FOR block_row IN
      SELECT id, reference_block_id
        FROM public.pl_exercise_blocks
       WHERE row_id = m.src_row AND reference_block_id IS NOT NULL
    LOOP
      IF NOT (id_map ? block_row.reference_block_id::text) THEN
        RAISE EXCEPTION 'Cannot copy block %: it references a block outside the copied selection. Copy the referenced block together with this exercise.', block_row.id
          USING ERRCODE = 'check_violation';
      END IF;
      UPDATE public.pl_exercise_blocks
         SET reference_block_id = (id_map->>block_row.reference_block_id::text)::uuid
       WHERE id = (id_map->>block_row.id::text)::uuid;
    END LOOP;
  END LOOP;

  RETURN total;
END;
$$;

-- (R3, R4: the athlete records and the avatars bucket are no longer part of
-- this migration; main's 20270412100000_tighten_open_read_rules.sql owns them.)

-- ── R5. Legal acceptances writable by the user, not stamped or kept ─────────
DROP TRIGGER IF EXISTS trg_legal_acceptance_stamp ON public.legal_acceptances;
DROP TRIGGER IF EXISTS trg_legal_acceptance_keep ON public.legal_acceptances;
DROP FUNCTION IF EXISTS public.tg_legal_acceptance_stamp();
DROP FUNCTION IF EXISTS public.tg_legal_acceptance_keep();
DROP POLICY IF EXISTS "Users insert their own acceptances" ON public.legal_acceptances;
CREATE POLICY "Users insert their own acceptances" ON public.legal_acceptances
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())) AND ((client_id IS NULL) OR (EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id = legal_acceptances.client_id AND c.user_id = (SELECT auth.uid())))));

-- ── R6. Published legal versions lock as before (June 13 version) ──────────
CREATE OR REPLACE FUNCTION public.tg_legal_version_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'published' THEN
    IF NEW.body IS DISTINCT FROM OLD.body
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.signature_method IS DISTINCT FROM OLD.signature_method
       OR NEW.version_number IS DISTINCT FROM OLD.version_number THEN
      RAISE EXCEPTION 'Published legal versions are immutable. Create a new version instead.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ── R7. Any client account may post into the coach chat again ───────────────
DROP POLICY IF EXISTS "Client send own messages" ON public.messages;
CREATE POLICY "Client send own messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK ((sender_role = 'client') AND (is_internal_note = false) AND (priority IS NULL)
    AND (sender_id = (SELECT auth.uid()))
    AND (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = messages.client_id AND c.user_id = (SELECT auth.uid()))));
