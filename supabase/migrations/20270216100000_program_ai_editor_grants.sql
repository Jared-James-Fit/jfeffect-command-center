-- Edit with AI: proposals and their model logs are written only by the
-- background worker and the apply / restore functions. Supabase's default
-- grants gave signed-in users UPDATE / DELETE on new tables; RLS already
-- matched no rows (no policies), and now the privilege itself is gone too.
revoke update, delete, truncate, references, trigger on public.program_ai_edits from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.program_ai_edit_calls from authenticated;
revoke truncate, references, trigger on public.program_rules from authenticated;
