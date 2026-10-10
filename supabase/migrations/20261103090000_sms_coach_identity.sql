-- SMS identity: every text introduces itself as "{coach} from {brand}".
--   {coach}  = the client's assigned coach's first name, else sms_settings.default_coach_name
--   {brand}  = sms_settings.brand_name (the business)
-- Both are edited in Settings → SMS. Stock templates are reworded only where they still
-- match the shipped text, so anything already customised is left alone.

ALTER TABLE public.sms_settings
  ADD COLUMN IF NOT EXISTS default_coach_name text NOT NULL DEFAULT '';

UPDATE public.sms_settings
   SET default_coach_name = 'Jared'
 WHERE singleton AND default_coach_name = '';

UPDATE public.sms_settings
   SET brand_name = 'JF Effect'
 WHERE singleton AND brand_name = 'Jared James Coaching';

ALTER TABLE public.sms_settings
  ALTER COLUMN brand_name SET DEFAULT 'JF Effect';

UPDATE public.sms_settings
   SET manual_default_template = 'Hi {first_name}, this is {coach} from {brand}. You have a new message from me in your coaching app — open it when you can.'
 WHERE singleton AND manual_default_template IN (
   'Hi {first_name}, this is {brand}. You have a new message in your coaching app — please open it when you can.',
   'Hi {first_name}, this is {brand}. You have a new message in your coaching app — please open it when you can. Reply STOP to opt out.'
 );

UPDATE public.sms_settings s
   SET reminder_steps = (
     SELECT jsonb_agg(
              CASE e->>'template'
                WHEN 'Hi {first_name}, this is {brand}. You have an unread message in your coaching app from your coach. Please open the app to read it. Reply STOP to opt out.'
                  THEN jsonb_set(e, '{template}', to_jsonb('Hi {first_name}, this is {coach} from {brand}. You have an unread message from me in your coaching app. Open the app to read it. Reply STOP to opt out.'::text))
                WHEN 'Hi {first_name}, this is a reminder from {brand}. Your coach is still waiting for you to read their message in the coaching app. Reply STOP to opt out.'
                  THEN jsonb_set(e, '{template}', to_jsonb('Hi {first_name}, it''s {coach} from {brand} again. I''m still waiting for you to read my message in the coaching app. Reply STOP to opt out.'::text))
                ELSE e
              END ORDER BY ord)
       FROM jsonb_array_elements(s.reminder_steps) WITH ORDINALITY AS t(e, ord)
   )
 WHERE singleton AND jsonb_typeof(reminder_steps) = 'array' AND jsonb_array_length(reminder_steps) > 0;

-- Automations: stock wording → coach + business. Only rows still on the shipped text.
UPDATE public.sms_automations SET body = v.new_body
  FROM (VALUES
    ('account_created',
     'Hi {first_name}! Welcome to {brand}. Tap this link to finish setting up your account and log in: {setup_link}',
     'Hi {first_name}! It''s {coach} from {brand} — welcome! Tap this link to finish setting up your account and log in: {setup_link}'),
    ('subscription_purchased',
     'Thanks for joining {brand}, {first_name}! Your JF Membership is active. Set up your app account here: {setup_link}',
     'Hi {first_name}, it''s {coach} from {brand} — thanks for joining! Your membership is active. Set up your app account here: {setup_link}'),
    ('subscription_cancelled',
     'Hi {first_name}, your JF Effect membership is set to end on {period_end}. You''ll keep full access until then. Change of heart? {billing_link}',
     'Hi {first_name}, it''s {coach} from {brand}. Your membership is set to end on {period_end}. You''ll keep full access until then. Change of heart? {billing_link}'),
    ('subscription_trial_ending',
     'Hi {first_name}, your JF Effect trial ends in {days_left} days. Manage your membership: {billing_link}',
     'Hi {first_name}, it''s {coach} from {brand}. Your trial ends in {days_left} days. Manage your membership: {billing_link}'),
    ('subscription_grace_warning',
     'Hi {first_name}, your JF Effect access ends in {days_left} days unless your payment goes through. Update card: {billing_link}',
     'Hi {first_name}, it''s {coach} from {brand}. Your access ends in {days_left} days unless your payment goes through. Update card: {billing_link}'),
    ('subscription_payment_recovered',
     'Hi {first_name}, your JF Effect payment went through. Thanks for staying with us!',
     'Hi {first_name}, it''s {coach} from {brand}. Your payment went through — thanks for staying with us!'),
    ('subscription_payment_failed',
     'Hi {first_name}, we couldn''t process your JF Effect payment. Please update your card within 5 days to keep access: {billing_link}',
     'Hi {first_name}, it''s {coach} from {brand}. We couldn''t process your payment. Please update your card within 5 days to keep access: {billing_link}'),
    ('subscription_ended',
     'Hi {first_name}, your JF Effect membership has ended. We''d love to have you back any time: {restart_link}',
     'Hi {first_name}, it''s {coach} from {brand}. Your membership has ended — we''d love to have you back any time: {restart_link}'),
    ('subscription_restarted',
     'Welcome back to JF Effect, {first_name}! Your membership is active again.',
     'Welcome back, {first_name}! It''s {coach} from {brand} — your membership is active again.'),
    ('email_change_requested',
     'Hi {first_name}, we got a request to change your {brand} account email to {new_email}. If this was not you, reply STOP and contact support immediately.',
     'Hi {first_name}, it''s {coach} from {brand}. We got a request to change your account email to {new_email}. If this wasn''t you, contact us right away.')
  ) AS v(trigger_type, old_body, new_body)
 WHERE sms_automations.trigger_type = v.trigger_type AND sms_automations.body = v.old_body;
