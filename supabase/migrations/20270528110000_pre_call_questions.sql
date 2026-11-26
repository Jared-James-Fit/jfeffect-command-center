-- Before our call (Nov 25 2026, docs/COACHING_SESSIONS.md): the pre-call
-- questions on the native forms engine. One form, every question tagged with
-- validation.session_key; a send from a coaching session names the keys that
-- session is missing in the assignment's settings.ask_keys
-- (coaching-sessions/questionnaire.ts questionnaireFor), and the athlete's
-- form shows only those (askedQuestions), so it takes one to three minutes.
-- A template, so it never archives itself for going unused, and editable in
-- the form builder like any form. Insert-if-absent: the coach's edits stay.

insert into public.nf_forms (id, title, description, form_type, recurrence, active, archived, kind, visibility, button_label, requires_client_identity, category, is_template, allow_updates, settings)
values (
  'c0a1e7e0-5a7e-4c0d-9f00-000000000e01',
  'Before our call',
  'A few quick questions so we can use our time well. About two minutes.',
  'pre_call',
  'none',
  true,
  false,
  'native',
  'selected',
  'Send to my coach',
  true,
  'Coaching calls',
  true,
  false,
  '{}'::jsonb
)
on conflict (id) do nothing;

insert into public.nf_questions (id, form_id, order_index, question_type, label, help_text, required, options, validation, conditional_logic)
values
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000301', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 0, 'long_text', 'What do you want to cover on our call?', 'Questions, worries, ideas, anything you want from me. This part of the call is yours.', false, '[]'::jsonb, '{"session_key":"topics","quick":["How my training is going","My nutrition","My next meet","Technique"]}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000302', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 1, 'single_choice', 'How''s training feeling lately?', null, false, '["Great","Good","Okay","Rough"]'::jsonb, '{"session_key":"training_feel"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000303', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 2, 'single_choice', 'Sleep and recovery this week', null, false, '["Sleeping and recovering well","Mostly fine","Not great","Struggling"]'::jsonb, '{"session_key":"recovery"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000304', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 3, 'single_choice', 'Anything bothering you physically?', null, false, '["Nothing","Something minor","Something that''s affecting my training"]'::jsonb, '{"session_key":"pain"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000305', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 4, 'long_text', 'Where, and what does it feel like?', null, false, '[]'::jsonb, '{"session_key":"pain_details"}'::jsonb, '{"match":"all","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000304","op":"is_not_empty","value":""},{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000304","op":"not_equals","value":"Nothing"}]}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000306', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 5, 'number', 'Morning bodyweight', 'First thing, after the bathroom, before you eat or drink.', false, '[]'::jsonb, '{"session_key":"bodyweight","units":["lb","kg"],"prefill":"bodyweight"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000307', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 6, 'long_text', 'Anything coming up that affects training?', 'Travel, work, exams, a busy week.', false, '[]'::jsonb, '{"session_key":"life","quick":["Nothing new"],"quick_exclusive":["Nothing new"]}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000308', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 7, 'single_choice', 'Are you registered for the meet?', null, false, '["Yes","Not yet","Not sure"]'::jsonb, '{"session_key":"meet_registered"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000309', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 8, 'single_choice', 'How are you feeling about the meet?', null, false, '["Confident","Good","Unsure","Nervous"]'::jsonb, '{"session_key":"meet_confidence"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000310', 'c0a1e7e0-5a7e-4c0d-9f00-000000000e01', 9, 'long_text', 'What would make this meet a success for you?', 'A number, a feeling, a lift you want. In your own words.', false, '[]'::jsonb, '{"session_key":"meet_success"}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;
