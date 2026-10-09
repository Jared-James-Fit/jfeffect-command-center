-- Photos on posts: scenario. Run after schema.sql and the migration.
\set ON_ERROR_STOP 1
CREATE OR REPLACE FUNCTION pg_temp.ok(_cond boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(_cond, false) THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; RAISE NOTICE 'ok: %', _what; END $$;
CREATE OR REPLACE FUNCTION pg_temp.fails(_sql text, _msg text, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE _sql; EXCEPTION WHEN OTHERS THEN
    IF position(_msg IN SQLERRM) > 0 THEN RAISE NOTICE 'ok: %', _what; RETURN; END IF;
    RAISE EXCEPTION 'FAILED: % (wrong error: %)', _what, SQLERRM;
  END;
  RAISE EXCEPTION 'FAILED: % (no error)', _what;
END $$;

-- people: coach (staff), co-coach (staff), two clients
INSERT INTO public.test_staff VALUES ('00000000-0000-0000-0000-00000000c0ac'), ('00000000-0000-0000-0000-00000000c0c2');
INSERT INTO public.clients (id, user_id, first_name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Ava'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', 'Ben'),
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000c0ac', 'Jared');
INSERT INTO public.community_series_settings (id, author_user_id) VALUES (true, '00000000-0000-0000-0000-00000000c0ac');

-- ── the shared check ─────────────────────────────────────────────────────
SELECT pg_temp.ok(
  (public.community_clean_media(jsonb_build_array(
     jsonb_build_object('path', '00000000-0000-0000-0000-0000000000a1/a.jpg', 'thumb', '00000000-0000-0000-0000-0000000000a1/a_t.jpg', 'type', 'image', 'width', 1080, 'height', '1350.4'),
     jsonb_build_object('path', '00000000-0000-0000-0000-0000000000a1/b.mp4', 'type', 'video')),
   '00000000-0000-0000-0000-0000000000a1')->0->>'height') = '1350', 'normalises sizes');
SELECT pg_temp.fails($$SELECT public.community_clean_media((SELECT jsonb_agg(jsonb_build_object('path', '00000000-0000-0000-0000-0000000000a1/' || g, 'type', 'image')) FROM generate_series(1, 11) g), '00000000-0000-0000-0000-0000000000a1')$$,
  'Up to 10 photos or videos', 'more than 10 refused');
SELECT pg_temp.fails($$SELECT public.community_clean_media((SELECT jsonb_agg(jsonb_build_object('path', '00000000-0000-0000-0000-0000000000a1/' || g, 'type', 'video')) FROM generate_series(1, 4) g), '00000000-0000-0000-0000-0000000000a1')$$,
  'Up to 3 videos', 'a 4th video refused');
SELECT pg_temp.fails($$SELECT public.community_clean_media('[{"path":"someone-else/a.jpg","type":"image"}]', '00000000-0000-0000-0000-0000000000a1')$$,
  'Invalid media', 'someone else''s file refused');
SELECT pg_temp.ok(jsonb_array_length(public.community_clean_media('[{"path":"someone-else/a.jpg","type":"image"}]', '00000000-0000-0000-0000-0000000000a1',
  '[{"path":"someone-else/a.jpg","type":"image"}]')) = 1, 'a file already on the post may stay');
SELECT pg_temp.fails($$SELECT public.community_clean_media('[{"path":"00000000-0000-0000-0000-0000000000a1/a.gif","type":"gif"}]', '00000000-0000-0000-0000-0000000000a1')$$,
  'Invalid media', 'only photos and videos');

-- ── the coach's "+ Post" with photos ──────────────────────────────────────
SET test.uid = '00000000-0000-0000-0000-00000000c0ac';
SELECT set_config('t.note', (public.community_create_note('Saturday session photos', NULL,
  '[{"path":"00000000-0000-0000-0000-00000000c0ac/1.jpg","thumb":"00000000-0000-0000-0000-00000000c0ac/1t.jpg","type":"image"},
    {"path":"00000000-0000-0000-0000-00000000c0ac/2.mp4","type":"video"}]'))->>'id', false);
SELECT pg_temp.ok((SELECT media_path = '00000000-0000-0000-0000-00000000c0ac/1.jpg' AND media_type = 'image' AND jsonb_array_length(extra_media) = 1
                     AND kind = 'note' FROM public.community_posts WHERE id = current_setting('t.note')::uuid), 'note gets a cover and a slide');
SELECT pg_temp.ok((public.community_create_note('words only'))->>'id' IS NOT NULL, 'a note without photos still works (old callers)');
SELECT pg_temp.ok((public.community_create_note('a poll', ARRAY['Yes','No']))->>'id' IS NOT NULL, 'a poll still works');

-- ── swapping photos later ────────────────────────────────────────────────
-- a client's own workout post
SET test.uid = '00000000-0000-0000-0000-0000000000a1';
INSERT INTO public.community_posts (id, author_user_id, client_id, completion_id, caption, media_path, media_type, visibility)
VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1',
        gen_random_uuid(), 'leg day', '00000000-0000-0000-0000-0000000000a1/old.jpg', 'image', 'community');
SELECT public.community_set_post_media('00000000-0000-0000-0000-0000000000f1',
  '[{"path":"00000000-0000-0000-0000-0000000000a1/new.jpg","type":"image"},{"path":"00000000-0000-0000-0000-0000000000a1/old.jpg","type":"image"}]');
SELECT pg_temp.ok((SELECT media_path = '00000000-0000-0000-0000-0000000000a1/new.jpg' AND extra_media->0->>'path' = '00000000-0000-0000-0000-0000000000a1/old.jpg'
                     AND caption = 'leg day' AND visibility = 'community' AND archived_at IS NULL AND edited_at IS NOT NULL
                   FROM public.community_posts WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'author swaps photos; caption and audience untouched');
SELECT public.community_set_post_media('00000000-0000-0000-0000-0000000000f1', '[]');
SELECT pg_temp.ok((SELECT media_path IS NULL AND media_type IS NULL AND extra_media = '[]'::jsonb FROM public.community_posts
                    WHERE id = '00000000-0000-0000-0000-0000000000f1'), 'author can take all photos off');
SET test.uid = '00000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.fails($$SELECT public.community_set_post_media('00000000-0000-0000-0000-0000000000f1', '[]')$$, 'Not allowed', 'another client can''t');
SET test.uid = '00000000-0000-0000-0000-00000000c0c2';
SELECT pg_temp.fails($$SELECT public.community_set_post_media('00000000-0000-0000-0000-0000000000f1', '[]')$$, 'Not allowed', 'staff can''t change a client''s photos');
-- a co-coach can fix the photos on the coach's note, keeping the coach's files
SELECT public.community_set_post_media(current_setting('t.note')::uuid,
  '[{"path":"00000000-0000-0000-0000-00000000c0ac/2.mp4","type":"video"},{"path":"00000000-0000-0000-0000-00000000c0c2/3.jpg","type":"image"}]');
SELECT pg_temp.ok((SELECT media_type = 'video' AND extra_media->0->>'path' = '00000000-0000-0000-0000-00000000c0c2/3.jpg' FROM public.community_posts
                    WHERE id = current_setting('t.note')::uuid), 'staff reorder / add on a coach note');
SELECT pg_temp.fails(format($$SELECT public.community_set_post_media(%L, '[{"path":"00000000-0000-0000-0000-0000000000a1/x.jpg","type":"image"}]')$$, current_setting('t.note')),
  'Invalid media', 'nobody can attach someone else''s upload');

-- ── birthday posts ────────────────────────────────────────────────────────
SET test.uid = '00000000-0000-0000-0000-00000000c0ac';
INSERT INTO public.community_birthday_posts (id, client_id, birthday_year, birthday, body, dm_body, post_at)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 2026, current_date + 1, 'happy birthday Ava', 'hbd!', now() + interval '1 day');
SELECT public.community_birthday_act('00000000-0000-0000-0000-0000000000b1', 'save', 'happy birthday Ava 🎂', NULL,
  '[{"path":"00000000-0000-0000-0000-00000000c0ac/cake.jpg","thumb":"00000000-0000-0000-0000-00000000c0ac/cake_t.jpg","type":"image"}]');
SELECT pg_temp.ok((SELECT jsonb_array_length(media) = 1 AND body = 'happy birthday Ava 🎂' AND status = 'ready'
                     FROM public.community_birthday_posts WHERE id = '00000000-0000-0000-0000-0000000000b1'), 'save keeps text and photo, still a draft');
SELECT pg_temp.ok(jsonb_array_length((public.community_birthday_act('00000000-0000-0000-0000-0000000000b1', 'reroll'))->'media') = 1, 'fresh wording keeps the photo');
SELECT pg_temp.ok((public.community_birthday_act('00000000-0000-0000-0000-0000000000b1', 'approve'))->>'status' = 'scheduled', 'approve schedules it');
SELECT pg_temp.ok(jsonb_array_length((public.community_birthday_act('00000000-0000-0000-0000-0000000000b1', 'unschedule'))->'media') = 1, 'unschedule keeps the photo');
-- staff can preview the draft's photo before it's a post; a client can't
SELECT pg_temp.ok(public.community_post_media_readable('00000000-0000-0000-0000-00000000c0ac/cake.jpg'), 'coach can preview a draft photo');
SET test.uid = '00000000-0000-0000-0000-00000000c0c2';
SELECT pg_temp.ok(public.community_post_media_readable('00000000-0000-0000-0000-00000000c0ac/cake_t.jpg'), 'co-coach can preview it too');
SET test.uid = '00000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.ok(NOT public.community_post_media_readable('00000000-0000-0000-0000-00000000c0ac/cake.jpg'), 'a client can''t see a draft photo');
SET test.uid = '00000000-0000-0000-0000-00000000c0ac';
SELECT public.community_birthday_act('00000000-0000-0000-0000-0000000000b1', 'post_now');
SELECT pg_temp.ok((SELECT p.media_path = '00000000-0000-0000-0000-00000000c0ac/cake.jpg' AND p.media_thumb_path = '00000000-0000-0000-0000-00000000c0ac/cake_t.jpg'
                     AND p.caption = 'fresh wording 1' AND p.kind = 'note'
                   FROM public.community_birthday_posts b JOIN public.community_posts p ON p.id = b.post_id
                  WHERE b.id = '00000000-0000-0000-0000-0000000000b1'), 'the photo goes out on the birthday post');
SET test.uid = '00000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.ok(public.community_post_media_readable('00000000-0000-0000-0000-00000000c0ac/cake.jpg'), 'once posted, the crew can see it');
SET test.uid = '00000000-0000-0000-0000-00000000c0ac';
SELECT pg_temp.fails($$SELECT public.community_birthday_act('00000000-0000-0000-0000-0000000000b1', 'save', 'late edit')$$, 'Already posted', 'posted ones are final here');
-- old callers (4 named args) still resolve
INSERT INTO public.community_birthday_posts (id, client_id, birthday_year, birthday, body, dm_body, post_at)
VALUES ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 2026, current_date + 2, 'hbd Ben', 'hbd', now() + interval '2 days');
SELECT pg_temp.ok((public.community_birthday_act(_id => '00000000-0000-0000-0000-0000000000b2', _action => 'save', _body => 'hbd Ben!', _dm_body => NULL))->'media' = '[]'::jsonb,
  'a save without photos leaves none');
SET test.uid = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.fails($$SELECT public.community_birthday_act('00000000-0000-0000-0000-0000000000b2', 'save', 'x')$$, 'Not allowed', 'clients can''t touch birthday drafts');

-- ── daily posts ───────────────────────────────────────────────────────────
SET test.uid = '00000000-0000-0000-0000-00000000c0ac';
INSERT INTO public.community_series_items (id, series, mentor, body) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'saturday_spirit', 'Coach', 'Saturday energy');
SELECT public.community_series_update_item('00000000-0000-0000-0000-0000000000d1', 'Saturday energy, edited', true,
  '[{"path":"00000000-0000-0000-0000-00000000c0ac/sat.jpg","type":"image"}]');
SELECT pg_temp.ok(public.community_post_media_readable('00000000-0000-0000-0000-00000000c0ac/sat.jpg'), 'coach can preview the next daily post''s photo');
SELECT public.community_series_update_item('00000000-0000-0000-0000-0000000000d1', 'Saturday energy, edited again');
SELECT pg_temp.ok((SELECT jsonb_array_length(media) = 1 AND body = 'Saturday energy, edited again' FROM public.community_series_items
                    WHERE id = '00000000-0000-0000-0000-0000000000d1'), 'a text edit keeps the photo');
SELECT pg_temp.ok((public.community_publish_series('saturday_spirit', true))->>'status' = 'published', 'publishes');
SELECT pg_temp.ok((SELECT p.media_path = '00000000-0000-0000-0000-00000000c0ac/sat.jpg' AND p.caption = 'Saturday energy, edited again'
                   FROM public.community_posts p WHERE p.series_item_id = '00000000-0000-0000-0000-0000000000d1'), 'the photo goes out with it');
SELECT pg_temp.ok((SELECT media = '[]'::jsonb AND body = 'Saturday energy, edited again' FROM public.community_series_items
                    WHERE id = '00000000-0000-0000-0000-0000000000d1'), 'once, then the item is text-only again');

SELECT 'ALL OK' AS result;
