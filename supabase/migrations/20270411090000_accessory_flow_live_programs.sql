-- Accessory flow pass on live client programs (Nov 18 2026; accessory-flow.ts).
-- The coach asked for accessory work that flows (fewer trips back to a station),
-- with main lifts, loads, sets and reps untouched. Reviewed by hand, workout by
-- workout; only the sessions below change, and only their order (plus three cues
-- that named the wrong station). Every change:
--   * touches only a workout nothing has been logged in, that isn't finished and
--     isn't in the past (public.pl_day_touched), checked again here at apply time;
--   * applies to a workout only while every row it moves still sits where it was
--     read (a workout the coach or athlete has changed since is left alone);
--   * is backed up first in public.accessory_flow_backup (row, old and new value),
--     so it can be put back exactly.
-- Re-running it changes nothing.

CREATE TABLE IF NOT EXISTS public.accessory_flow_backup (
  id bigserial PRIMARY KEY,
  batch text NOT NULL,
  row_id uuid NOT NULL,
  day_id uuid NOT NULL,
  client_id uuid,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.accessory_flow_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accessory_flow_backup FROM anon, authenticated;

DO $$
DECLARE
  _today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  _moved int := 0;
  _notes int := 0;
BEGIN
  CREATE TEMP TABLE _flow_plan (row_id uuid, day_id uuid, old_sort int, new_sort int) ON COMMIT DROP;
  INSERT INTO _flow_plan VALUES ('7adfec30-c476-4c2a-b973-b983e7b27715','f8c6758e-38bb-45a0-82af-00316fdbf1f3',4,3),('6fb6474b-a620-4b52-b6d1-824b5d2bba01','f8c6758e-38bb-45a0-82af-00316fdbf1f3',3,4),('afc14dc3-aec9-499c-a58b-06e5fbb32308','97b1601d-883a-4d63-83bd-043de4795d9a',3,2),('a9d32951-dcb7-4cc0-adee-3986e6d330c6','97b1601d-883a-4d63-83bd-043de4795d9a',2,3),('9b85414b-ca84-4625-9bb6-a7962d1c08a9','49a7ff96-c844-432a-b7ec-acf362f21e42',3,2),('38981437-6af6-4a4c-a27b-dad332198f81','49a7ff96-c844-432a-b7ec-acf362f21e42',2,3),('0958d51e-09ee-4885-aa3b-e01ad1d11946','3024c3c4-a1b0-431e-b4d6-39bc1861771c',3,2),('184b8509-5e66-401e-8d73-0181234e7635','3024c3c4-a1b0-431e-b4d6-39bc1861771c',2,3),('a63da4a3-5133-4ad7-be71-c52116aff834','c2277b70-c190-4397-b10d-9c81f558474e',3,2),('75174f9d-8ee4-4e65-b349-e5571db11e76','c2277b70-c190-4397-b10d-9c81f558474e',2,3),('5c1ff730-18c8-4295-8c1f-6784fb79620c','c135f8eb-1aff-4bfc-9a4c-e31e28acaeeb',3,2),('053d4040-1a3b-4488-ad6d-a864fcf46544','c135f8eb-1aff-4bfc-9a4c-e31e28acaeeb',2,3),('ea9eb744-dd0d-4f95-98b5-2d85ae5bdb8a','009dd300-7cae-45cb-8491-779905083bd9',3,2),('dab8c1fd-ab0c-4606-b280-8d9b9b5749ec','009dd300-7cae-45cb-8491-779905083bd9',2,3),('27e313ac-fdd6-430c-a13c-cb7cc588bae1','2bddd202-bfb9-4e26-bb49-f67af3f45fd0',5,4),('f7b6d5eb-9944-4564-a965-5d9263c2e0f0','2bddd202-bfb9-4e26-bb49-f67af3f45fd0',4,5),('ef8684bc-f2d2-49f9-9869-59a8375948f9','a342783a-0b31-4467-81f7-9e3dfe25a9c4',7,6),('9892a6dc-5e21-435e-a911-df9108f1357e','a342783a-0b31-4467-81f7-9e3dfe25a9c4',6,7),('d3c0b581-7b47-4bf8-a859-48e0fcadf79f','72e9f001-0d76-4404-8872-9252ea5b5ee7',5,4),('7ea3b360-a1d7-4b63-aed0-5b1b1beebb6c','72e9f001-0d76-4404-8872-9252ea5b5ee7',4,5),('2d7bbe21-41d7-4272-8425-ba8d7f3b9c29','950c5f28-cf67-4360-9a75-06d7a50c2d67',7,6),('52a153d0-cf7c-40ef-b368-f4e4b4a4f0dc','950c5f28-cf67-4360-9a75-06d7a50c2d67',6,7),('2c487210-a35c-49d3-ae5f-d3a67a33fba9','fa1ac679-f0a4-4f99-8035-45ae096e924a',5,4),('9b85f315-105e-4618-8a29-6b266193545f','fa1ac679-f0a4-4f99-8035-45ae096e924a',4,5),('7762e40d-fcb7-4474-9ed3-8bedf6ab9e24','0cd2b51b-417c-4e05-98f6-466225f55d09',7,6),('98581901-6a2e-4009-b03a-518f39d75c67','0cd2b51b-417c-4e05-98f6-466225f55d09',6,7),('04121a47-5b3c-462e-95b6-8bd92c1b7bae','44950777-1208-4533-8b73-4df0ebec8ed9',5,4),('e84a2b94-457c-4b63-a693-0076e0d9a30a','44950777-1208-4533-8b73-4df0ebec8ed9',4,5),('56fa69a1-a9dc-4e51-be79-09771f1fcd8c','17270f0f-581d-49fe-8bc0-50f0a1a478a6',7,6),('81e0699d-36e6-42bd-b6b6-fc95ed2609a2','17270f0f-581d-49fe-8bc0-50f0a1a478a6',6,7),('4588f6c0-01fa-47cf-85f5-2ff14408eec7','ac529537-fd6e-4293-8c2c-65a5c57c0006',5,4),('dc4b8f20-3dfb-4915-99fc-780d5c56631f','ac529537-fd6e-4293-8c2c-65a5c57c0006',4,5),('2c4044af-6d19-441d-9948-b95823e30a6b','96221d32-4d71-4837-a99a-713e437e5015',7,6),('235f899a-8cf7-4184-a31f-329b5aacd7ea','96221d32-4d71-4837-a99a-713e437e5015',6,7),('fc96cb57-f028-4ad5-88aa-6ea6092c8a34','1002dd1f-c8da-4b73-9298-0d334adf164c',3,2),('c70897bf-5f07-49f4-a8d8-5950e9bbcc09','1002dd1f-c8da-4b73-9298-0d334adf164c',2,3),('5dd29bf8-6607-46a1-b49c-831f13348e80','896f5258-2d34-40f2-af59-5645545418c1',4,3),('d88fee27-07c2-47f1-ab6d-743b85209d0e','896f5258-2d34-40f2-af59-5645545418c1',3,4),('20d27086-040b-463e-b1a4-ff2fa4e45149','2470d484-27c1-4f59-ac08-12bc7e75e0c4',7,6),('c0431bbb-23f5-4ebd-93a8-68856fef7c01','2470d484-27c1-4f59-ac08-12bc7e75e0c4',6,7),('c9fcd429-7b4c-47d4-851b-121af89d6a76','5589b32e-93b1-4e18-b64c-2f6ce4cd7587',4,3),('f899762f-4533-485d-9369-36b867f8b16d','5589b32e-93b1-4e18-b64c-2f6ce4cd7587',3,4),('82c8b997-e9a9-49b6-9e85-0b7530160eee','de75c173-5179-4295-8645-0a995bef775f',7,6),('bae29c50-7dba-4211-b64e-ead16d8e549d','de75c173-5179-4295-8645-0a995bef775f',6,7),('13399701-731b-4754-b291-ca79c61db215','97764e7b-fd8d-418d-a7a3-b56e2e4e1315',3,2),('fd801b04-4259-46d3-a440-cfc7794cff0e','97764e7b-fd8d-418d-a7a3-b56e2e4e1315',2,3),('4fdf4545-bffc-4186-b46e-e9f80b0f4e42','e21c8ca6-2ba4-4647-8c7f-6af577d81d41',4,3),('2a5818b4-c20a-4fa8-ab21-185ad3023ff9','e21c8ca6-2ba4-4647-8c7f-6af577d81d41',3,4),('84e5668e-9458-4af6-a40f-3775510c8b61','f793964a-84cc-4ff1-be3d-07317b731504',5,4),('3572ed39-20c0-4e87-aba6-76da006a792b','f793964a-84cc-4ff1-be3d-07317b731504',4,5),('1362b86b-f92b-45b9-b2d0-6cdda265f3a2','8a83994b-c86c-4b9e-bfb3-6caa72cf9bca',2,1),('574f7646-885c-4ff5-b8bc-8456366db0bd','8a83994b-c86c-4b9e-bfb3-6caa72cf9bca',1,2),('b197e892-632b-4182-b589-4bc1d5e1fdf1','8a83994b-c86c-4b9e-bfb3-6caa72cf9bca',5,4),('f10d217b-6205-4d90-a51f-dfede43aed6f','8a83994b-c86c-4b9e-bfb3-6caa72cf9bca',4,5),('810964f2-068c-47fd-a0cf-d60f177ec3ea','82a33644-0b66-4174-9acd-f26c4c497b47',4,3),('98481bcf-9d12-4974-be91-bfcc4e1bff14','82a33644-0b66-4174-9acd-f26c4c497b47',3,4),('a8d70461-dcda-4d16-b3b8-b37d1256ae7b','279c16a9-2c3f-4e5d-8628-7f8ee7dab074',4,3),('1a8914f1-a50d-4211-af1f-3860753d1239','279c16a9-2c3f-4e5d-8628-7f8ee7dab074',3,4),('8b740a45-244c-4ff6-ac1c-76d82017e85d','35d24b05-ca89-49a2-8af5-5c600f85fa69',4,3),('3d00d959-ba6a-4dc4-8e47-0e6cbe120bae','35d24b05-ca89-49a2-8af5-5c600f85fa69',3,4),('286031c1-ef1b-48d3-a3ea-3e705f5cf364','7291b2e3-463d-4c93-9de4-8b19f6aa65ae',4,3),('5fe621a0-d40e-448f-81d7-c1466700a1db','7291b2e3-463d-4c93-9de4-8b19f6aa65ae',3,4),('883db977-d512-43f5-b48a-f5cf0f1cda86','e39be306-f2c0-45e0-8f9e-e2da4ac491e0',5,4),('46cb254d-90f3-4eab-92f0-2d754d00d9bd','e39be306-f2c0-45e0-8f9e-e2da4ac491e0',4,5),('f2e795ea-78cf-4b58-b56d-e3f80120bf87','b4e6a977-3f36-4c96-ab63-7b772cfc467f',5,4),('c4cbce70-1599-4146-a393-84738e833fc6','b4e6a977-3f36-4c96-ab63-7b772cfc467f',4,5),('6f70e061-7375-4199-b811-052dc05afd62','b8358570-258b-4930-b9c2-5d30774be0d6',5,4),('b451ac6d-60f7-41bd-82e9-9803154f002c','b8358570-258b-4930-b9c2-5d30774be0d6',4,5),('1db9b37b-7fb1-47a3-8e78-62216076e3b4','e64aced9-33dc-4ecd-83ce-527960c1569f',5,4),('b1900c24-0b86-4eed-bbf8-3086e7b6a8cb','e64aced9-33dc-4ecd-83ce-527960c1569f',4,5);

  -- workouts still untouched, with every planned row exactly where it was read
  CREATE TEMP TABLE _flow_ok ON COMMIT DROP AS
  SELECT p.day_id
    FROM _flow_plan p
    JOIN public.pl_days d ON d.id = p.day_id AND d.deleted_at IS NULL AND NOT coalesce(d.archived, false)
   GROUP BY p.day_id, d.id, d.scheduled_date
  HAVING NOT public.pl_day_touched(d.id, coalesce((SELECT min(s.scheduled_date) FROM public.pl_scheduled_workouts s WHERE s.source_day_id = d.id), d.scheduled_date), _today)
     AND bool_and(EXISTS (SELECT 1 FROM public.pl_exercise_rows r WHERE r.id = p.row_id AND r.day_id = p.day_id AND r.sort_order = p.old_sort));

  INSERT INTO public.accessory_flow_backup (batch, row_id, day_id, client_id, field, old_value, new_value)
  SELECT 'accessory_flow_2026_11_18', p.row_id, p.day_id, b.client_id, 'sort_order', p.old_sort::text, p.new_sort::text
    FROM _flow_plan p JOIN _flow_ok k ON k.day_id = p.day_id
    JOIN public.pl_days d ON d.id = p.day_id JOIN public.pl_weeks w ON w.id = d.week_id JOIN public.pl_blocks b ON b.id = w.block_id;

  UPDATE public.pl_exercise_rows r SET sort_order = p.new_sort
    FROM _flow_plan p JOIN _flow_ok k ON k.day_id = p.day_id
   WHERE r.id = p.row_id AND r.sort_order = p.old_sort;
  GET DIAGNOSTICS _moved = ROW_COUNT;

  -- three cues that named the wrong station (the exercise on the card is what they train)
  CREATE TEMP TABLE _flow_notes (row_id uuid, old_text text, new_text text) ON COMMIT DROP;
  INSERT INTO _flow_notes VALUES
    -- Marc, Upper A (Nov 25): the row is pull-ups, which he did last week, not the high cable
    ('d8095268-e916-4a45-9d0e-c50307dfea29', 'Station 3. High cable.', 'Station 3. Pull-up bar.'),
    -- Colten, Full Body B (Nov 25): the lateral raises are dumbbells (5 lb last week), done beside the belt squat
    ('afcb7c88-c23c-4601-93cd-9e51fca81321', 'One arm at a time, cable at hand height behind you, lead with the elbow.', 'One arm at a time, lead with the elbow.'),
    ('528100cd-9d59-464e-bc0d-38e6ac7c4eb4', 'Superset with cable lateral raises:', 'Superset with dumbbell lateral raises:');

  INSERT INTO public.accessory_flow_backup (batch, row_id, day_id, client_id, field, old_value, new_value)
  SELECT 'accessory_flow_2026_11_18', r.id, r.day_id, b.client_id, 'notes', r.notes, replace(r.notes, n.old_text, n.new_text)
    FROM _flow_notes n
    JOIN public.pl_exercise_rows r ON r.id = n.row_id
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
   WHERE position(n.old_text in coalesce(r.notes, '')) > 0
     AND NOT public.pl_day_touched(d.id, coalesce((SELECT min(s.scheduled_date) FROM public.pl_scheduled_workouts s WHERE s.source_day_id = d.id), d.scheduled_date), _today);

  UPDATE public.pl_exercise_rows r SET notes = bk.new_value
    FROM public.accessory_flow_backup bk
   WHERE bk.batch = 'accessory_flow_2026_11_18' AND bk.field = 'notes' AND bk.row_id = r.id AND r.notes = bk.old_value;
  GET DIAGNOSTICS _notes = ROW_COUNT;

  RAISE NOTICE 'accessory flow: % rows moved in % workouts, % cues fixed', _moved, (SELECT count(*) FROM _flow_ok), _notes;
END $$;
