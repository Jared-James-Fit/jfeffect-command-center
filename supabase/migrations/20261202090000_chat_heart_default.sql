-- Double-tap likes a message with a heart, as on Instagram (DEFAULT_REACTION,
-- chat-settings.ts). The live setting was still the original ✅; a coach who
-- picked something else in Chat Settings keeps it.
UPDATE public.app_settings
SET value = '❤️', updated_at = now()
WHERE key = 'chat_default_reaction' AND value = '✅';
