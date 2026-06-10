
-- ============================================================
-- 1) Lock down SECURITY DEFINER helpers
--    Revoke EXECUTE from PUBLIC on every helper, then re-grant
--    only where the client actually needs to call it.
-- ============================================================

-- Internal-only helpers (used by RLS, triggers, cron, or server code)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_assigned_coach(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_coach_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_member_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.member_has_access(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_can_see_recipe(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_can_see_broadcast(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_access_chat_presence(text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.pl_week_required_workouts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pl_week_completed_workouts(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pl_recompute_week_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pl_recompute_block_status(uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.purge_old_client_media() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;

-- Trigger functions (never called directly)
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_pt_session_compute_ts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_message_touch_conversation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_purchase_agreement_block() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_agreement_block_override() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_agreement_bump_template_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_offer_bump_version() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_pl_day_completion_recompute() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_nf_autoassign_new_client() FROM PUBLIC, anon, authenticated;

-- Client-callable helpers (signed-in users only)
REVOKE EXECUTE ON FUNCTION public.mark_client_signed_in() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_client_signed_in() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.ping_client_activity(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ping_client_activity(text) TO authenticated;

-- ============================================================
-- 2) Realtime: require authenticated user for any subscription,
--    and keep the existing presence-channel ownership check.
-- ============================================================

-- Block anonymous realtime subscriptions entirely.
-- (Existing chat-presence policies still apply via can_access_chat_presence.)
DROP POLICY IF EXISTS "deny_anon_realtime" ON realtime.messages;
CREATE POLICY "deny_anon_realtime"
ON realtime.messages
AS RESTRICTIVE
FOR SELECT
TO anon
USING (false);

DROP POLICY IF EXISTS "deny_anon_realtime_write" ON realtime.messages;
CREATE POLICY "deny_anon_realtime_write"
ON realtime.messages
AS RESTRICTIVE
FOR INSERT
TO anon
WITH CHECK (false);
