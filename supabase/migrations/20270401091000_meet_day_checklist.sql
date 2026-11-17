-- GENERATED from src/lib/meet-checklist-template.ts by
-- scripts/forms/write-meet-checklist-migration.ts. Do not edit by hand:
-- src/test/meet-checklist.test.ts fails when the two disagree.
--
-- Meet Day — Final Preparation Checklist: a template in the coach's form
-- library (category Powerlifting & Competitions), editable in the form
-- builder like any form. Checklist questions (Ready / Still need / N/A by
-- item, each item critical, important or optional), readiness by area for
-- the coach (form-checklist.ts, meet-checklist.ts) and updates after it's
-- sent (allow_updates, every change kept in nf_answer_history).

insert into public.nf_forms (id, title, description, form_type, recurrence, active, archived, kind, visibility, button_label, requires_client_identity, category, is_template, allow_updates, settings)
values (
  'c0a1e7e0-5a7e-4c0d-9f00-000000000d01',
  'Meet Day — Final Preparation Checklist',
  'Make sure everything is ready before competition day.',
  'meet_checklist',
  'none',
  true,
  false,
  'native',
  'selected',
  'Save my checklist',
  true,
  'Powerlifting & Competitions',
  true,
  true,
  '{"readiness":{"areas":[{"key":"documents","label":"Documents","ok":"Complete","attention":"Needs attention"},{"key":"equipment","label":"Equipment","ok":"Complete","attention":"Needs attention"},{"key":"handler","label":"Handler","ok":"Confirmed","attention":"Unresolved"},{"key":"weight","label":"Weight","ok":"No concern reported","attention":"Coach review needed"},{"key":"logistics","label":"Meet logistics","ok":"Complete","attention":"Needs attention"},{"key":"final","label":"Final preparation","ok":"Complete","attention":"Incomplete"}]},"reminders":true}'::jsonb
)
on conflict (id) do nothing;

insert into public.nf_questions (id, form_id, order_index, question_type, label, help_text, required, options, validation, conditional_logic)
values
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000201', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 0, 'info', 'Your meet and weight', 'What we already know is filled in. Fix anything that''s changed.', false, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000202', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 1, 'short_text', 'Your name', null, true, '[]'::jsonb, '{"prefill":"full_name","meet_key":"name","compact":true}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000203', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 2, 'short_text', 'Which meet is this for?', null, true, '[]'::jsonb, '{"prefill":"meet_name","meet_key":"meet_name"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000204', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 3, 'date', 'Meet date', null, true, '[]'::jsonb, '{"prefill":"meet_date","meet_key":"meet_date"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000205', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 4, 'single_choice', 'Weight class', null, true, '["Men''s 53 kg (sub-junior & junior only)","Men''s 59 kg","Men''s 66 kg","Men''s 74 kg","Men''s 83 kg","Men''s 93 kg","Men''s 105 kg","Men''s 120 kg","Men''s 120 kg+","Women''s 43 kg (sub-junior & junior only)","Women''s 47 kg","Women''s 52 kg","Women''s 57 kg","Women''s 63 kg","Women''s 69 kg","Women''s 76 kg","Women''s 84 kg","Women''s 84 kg+"]'::jsonb, '{"prefill":"meet_weight_class","group_prefixes":["Men''s ","Women''s "],"meet_key":"weight_class","area":"weight"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000206', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 5, 'number', 'Morning bodyweight', 'First thing, after the bathroom, before you eat or drink.', true, '[]'::jsonb, '{"units":["lb","kg"],"prefill":"bodyweight","meet_key":"bodyweight","area":"weight"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000207', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 6, 'single_choice', 'Any concerns about making weight?', null, true, '["No concerns","Slightly concerned","Need to discuss with coach"]'::jsonb, '{"flag_options":["Slightly concerned","Need to discuss with coach"],"meet_key":"weight_concern","area":"weight"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000208', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 7, 'long_text', 'What''s going on with your weight?', 'Where you''re at and what''s changed. Your coach will go through it with you.', false, '[]'::jsonb, '{"meet_key":"weight_details"}'::jsonb, '{"match":"all","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000207","op":"is_not_empty","value":""},{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000207","op":"not_equals","value":"No concerns"}]}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000209', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 8, 'info', 'Handler and logistics', null, false, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000210', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 9, 'single_choice', 'Your handler', 'Who''s with you on the day to keep you on time and hand in your attempts.', true, '["Yes, my handler is confirmed","My coach is handling me","I''m handling myself","I need help finding a handler","Not confirmed yet"]'::jsonb, '{"flag_options":["I need help finding a handler","Not confirmed yet"],"meet_key":"handler","area":"handler"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000211', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 10, 'short_text', 'Handler''s name', null, true, '[]'::jsonb, '{"remember":true,"meet_key":"handler_name"}'::jsonb, '{"match":"all","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000210","op":"equals","value":"Yes, my handler is confirmed"}]}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000212', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 11, 'short_text', 'Handler''s phone', null, false, '[]'::jsonb, '{"remember":true,"input":"tel","meet_key":"handler_phone"}'::jsonb, '{"match":"all","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000210","op":"equals","value":"Yes, my handler is confirmed"}]}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000213', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 12, 'short_text', 'Handler''s email', null, false, '[]'::jsonb, '{"remember":true,"input":"email","meet_key":"handler_email"}'::jsonb, '{"match":"all","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000210","op":"equals","value":"Yes, my handler is confirmed"}]}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000214', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 13, 'checklist', 'Meet logistics', null, true, '[]'::jsonb, '{"area":"logistics","items":[{"key":"registered","label":"Registered for the meet","priority":"critical"},{"key":"weigh-in","label":"Weigh-in day and time known","priority":"critical","help":"On your meet''s schedule. At IPF / CPU meets it''s usually 2 hours before your session."},{"key":"venue","label":"Venue and how you''re getting there","priority":"important"},{"key":"travel","label":"Travel and where you''re staying","priority":"important","help":"N/A if it''s close to home."},{"key":"rules","label":"Rules and commands reviewed","priority":"important","help":"Squat: “Squat”, “Rack”. Bench: “Start”, “Press”, “Rack”. Deadlift: “Down”. Check your meet''s rulebook."},{"key":"kit","label":"Gear on the approved list, and you know if there''s a kit check","priority":"important","help":"Singlet, belt, sleeves and wraps need to be on your federation''s approved list."}]}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000215', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 14, 'checklist', 'Documents and eligibility', null, true, '[]'::jsonb, '{"area":"documents","items":[{"key":"membership","label":"CPU membership, printed or PDF","priority":"critical"},{"key":"cces","label":"CCES True Sport Clean course, printed or proof you finished it","priority":"critical","help":"Where your meet requires it. N/A if it doesn''t."},{"key":"photo-id","label":"Valid photo ID","priority":"critical"}]}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000216', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 15, 'single_choice', 'Your lifting shoes', null, true, '["One pair for all three lifts","Different shoes for some lifts"]'::jsonb, '{"remember":true,"meet_key":"shoes"}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000217', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 16, 'checklist', 'Clothing and equipment', null, true, '[]'::jsonb, '{"area":"equipment","ready_label":"Packed","items":[{"key":"singlet","label":"Singlet","priority":"critical"},{"key":"shirt","label":"Competition shirt","priority":"critical","help":"For squat and bench at IPF / CPU meets."},{"key":"underwear","label":"Underwear","priority":"important"},{"key":"belt","label":"Belt","priority":"critical"},{"key":"knee-sleeves","label":"Knee sleeves","priority":"optional"},{"key":"wrist-wraps","label":"Wrist wraps","priority":"optional"},{"key":"shoes","label":"Lifting shoes","priority":"critical","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000216","op":"equals","value":"One pair for all three lifts"}]},{"key":"squat-shoes","label":"Squat shoes","priority":"critical","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000216","op":"equals","value":"Different shoes for some lifts"}]},{"key":"bench-shoes","label":"Bench shoes","priority":"optional","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000216","op":"equals","value":"Different shoes for some lifts"}]},{"key":"deadlift-shoes","label":"Deadlift shoes","priority":"optional","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000216","op":"equals","value":"Different shoes for some lifts"}]},{"key":"squat-socks","label":"Squat socks","priority":"optional"},{"key":"bench-socks","label":"Bench socks","priority":"optional"},{"key":"deadlift-socks","label":"Deadlift socks","priority":"important","help":"Long enough to cover your shins at IPF / CPU meets."}]}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000218', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 17, 'checklist', 'Food, drinks and accessories', null, true, '[]'::jsonb, '{"area":"equipment","ready_label":"Packed","items":[{"key":"food","label":"Food and drinks for the day","priority":"important"},{"key":"meds","label":"Any medication or personal supplies you need","priority":"important","help":"N/A if there''s nothing."},{"key":"chalk","label":"Chalk","priority":"important","help":"Not every meet supplies it."},{"key":"powder","label":"Baby powder","priority":"optional","help":"For deadlift, where your meet allows it."},{"key":"food-scale","label":"Food scale","priority":"optional","help":"If you''re weighing food."},{"key":"bw-scale","label":"Bodyweight scale","priority":"optional","help":"To check your weight before weigh-in."},{"key":"hair-ties","label":"Hair ties","priority":"optional","help":"If you have long hair."},{"key":"headphones","label":"Headphones or earbuds","priority":"optional"}]}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000219', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 18, 'checklist', 'Final meet-day confirmation', null, true, '[]'::jsonb, '{"area":"final","items":[{"key":"openers-written","label":"Opening attempts written down","priority":"important"},{"key":"openers-coach","label":"Openers confirmed with your coach","priority":"important"},{"key":"warm-ups","label":"Warm-up plan reviewed","priority":"important"},{"key":"schedule","label":"Flight and session times known","priority":"important"},{"key":"handler-plan","label":"Handler knows your attempts, warm-ups and timing","priority":"important","show_if":[{"question_id":"c0a1e7e0-5a7e-4c0d-9f00-000000000210","op":"equals","value":"Yes, my handler is confirmed"}]},{"key":"sleep","label":"Sleep and the night before planned","priority":"optional"}]}'::jsonb, '{}'::jsonb),
  ('c0a1e7e0-5a7e-4c0d-9f00-000000000220', 'c0a1e7e0-5a7e-4c0d-9f00-000000000d01', 19, 'long_text', 'Anything else I should know?', 'Travel, nerves, a niggle, anything that could affect the day.', false, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

-- Meet-day reminders (meet-checklist-reminders.server.ts): once a day at 9:11
-- in Winnipeg (14:11 UTC; Manitoba is a fixed UTC-5 from Nov 1, 2026). A push
-- to the athlete two weeks out if they haven't started, and two days and one
-- day out while something critical or important is still open; each one once.
-- Free (push only, never a text). The coach turns them off per send or per form.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'meet-checklist-reminders';
  perform cron.schedule(
    'meet-checklist-reminders',
    '11 14 * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/meet-checklist-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
    $cmd$
  );
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end
$$;
