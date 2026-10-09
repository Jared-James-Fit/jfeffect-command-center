-- Fionna's tasks and feed photos: scenario. Run after schema.sql and the migration.
\set ON_ERROR_STOP 1
-- helpers live in their own schema so the app role can call them too
CREATE SCHEMA t;
CREATE OR REPLACE FUNCTION t.ok(_cond boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(_cond, false) THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; RAISE NOTICE 'ok: %', _what; END $$;
CREATE OR REPLACE FUNCTION t.fails(_sql text, _msg text, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE _sql; EXCEPTION WHEN OTHERS THEN
    IF position(_msg IN SQLERRM) > 0 THEN RAISE NOTICE 'ok: %', _what; RETURN; END IF;
    RAISE EXCEPTION 'FAILED: % (wrong error: %)', _what, SQLERRM;
  END;
  RAISE EXCEPTION 'FAILED: % (no error)', _what;
END $$;
-- rows an UPDATE or DELETE touched (row security hides the rest without an error)
CREATE OR REPLACE FUNCTION t.touched(_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int; BEGIN EXECUTE _sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT USAGE ON SCHEMA t TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

-- people: the admin, Fionna (finance), a coach, a client, a stranger
INSERT INTO public.user_roles VALUES
  ('00000000-0000-0000-0000-0000000000ad', 'admin'),
  ('00000000-0000-0000-0000-0000000000f1', 'finance'),
  ('00000000-0000-0000-0000-0000000000c0', 'coach');
INSERT INTO public.coaches (id, user_id) VALUES ('00000000-0000-0000-0000-00000000c0c0', '00000000-0000-0000-0000-0000000000c0');
INSERT INTO public.clients (user_id) VALUES ('00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.tasks (id, title, scope) VALUES
  ('00000000-0000-0000-0000-000000000071', 'Send the GST filing', 'admin');
INSERT INTO public.tasks (id, title, scope) VALUES ('00000000-0000-0000-0000-000000000072', 'Film the squat cue reel', 'media');

-- ── the task board ───────────────────────────────────────────────────────
SELECT t.ok(EXISTS (SELECT 1 FROM public.role_permissions WHERE role = 'finance' AND permission = 'tasks.manage'), 'finance holds tasks.manage');

SET ROLE authenticated;
SET test.uid = '00000000-0000-0000-0000-0000000000f1';
SET test.aal = 'aal2';
SELECT t.ok((SELECT count(*) FROM public.tasks) = 1, 'Fionna sees the team board, not the media board');
INSERT INTO public.tasks (title) VALUES ('Reconcile September');
SELECT t.ok((SELECT count(*) FROM public.tasks WHERE title = 'Reconcile September') = 1, 'Fionna adds a task');
SELECT t.ok(t.touched($$UPDATE public.tasks SET status = 'done', completed_at = now() WHERE id = '00000000-0000-0000-0000-000000000071'$$) = 1, 'Fionna ticks one off');
SELECT t.ok(t.touched($$DELETE FROM public.tasks WHERE title = 'Reconcile September'$$) = 1, 'Fionna removes one');
SELECT t.ok(t.touched($$UPDATE public.tasks SET title = 'x' WHERE id = '00000000-0000-0000-0000-000000000072'$$) = 0, 'the media board stays out of reach');
SELECT t.fails($$INSERT INTO public.tasks (title, scope) VALUES ('sneaky', 'media')$$, 'row-level security', 'Fionna can''t add to the media board');
SELECT t.fails($$UPDATE public.tasks SET scope = 'media' WHERE id = '00000000-0000-0000-0000-000000000071'$$, 'row-level security', 'or move a task onto it');

SET test.aal = 'aal1';
SELECT t.ok((SELECT count(*) FROM public.tasks) = 0, 'not before MFA');
SELECT t.fails($$INSERT INTO public.tasks (title) VALUES ('no mfa')$$, 'row-level security', 'no adding before MFA');

SET test.uid = '00000000-0000-0000-0000-0000000000a1';
SET test.aal = 'aal2';
SELECT t.ok((SELECT count(*) FROM public.tasks) = 0, 'a client sees no tasks');
SELECT t.fails($$INSERT INTO public.tasks (title) VALUES ('client')$$, 'row-level security', 'a client can''t add one');

SET test.uid = '00000000-0000-0000-0000-0000000000c0';
SELECT t.ok((SELECT count(*) FROM public.tasks) = 2, 'a coach still sees both boards, as before');
SET test.uid = '00000000-0000-0000-0000-0000000000ad';
SELECT t.ok(t.touched($$UPDATE public.tasks SET status = 'open' WHERE id = '00000000-0000-0000-0000-000000000071'$$) = 1, 'the admin still works the board');
RESET ROLE;

-- ── feed photos ──────────────────────────────────────────────────────────
INSERT INTO public.community_posts (id, author_user_id, visibility, media_path, media_thumb_path, extra_media) VALUES
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-0000000000a1', 'community', 'a1/squat.mp4', 'a1/squat_t.jpg',
   '[{"path":"a1/two.jpg","thumb":null,"type":"image"}]'),
  ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-0000000000a1', 'coach', 'a1/form.jpg', NULL, '[]');
INSERT INTO public.community_comments (post_id, author_user_id, media_path, hidden_at) VALUES
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-0000000000a1', 'a1/comment.jpg', NULL),
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-0000000000a1', 'a1/hidden.jpg', now());
INSERT INTO public.community_birthday_posts (status, media) VALUES ('ready', '[{"path":"ad/cake.jpg","type":"image"}]');

SET ROLE authenticated;
SET test.uid = '00000000-0000-0000-0000-0000000000f1';
SET test.aal = 'aal2';
SELECT t.ok(public.community_post_media_readable('a1/squat.mp4') AND public.community_post_media_readable('a1/squat_t.jpg')
                  AND public.community_post_media_readable('a1/two.jpg'), 'Fionna sees a post''s photos and video');
SELECT t.ok(public.community_post_media_readable('a1/form.jpg'), 'and a client''s coach-only post, as the admin does');
SELECT t.ok(public.community_comment_media_readable('a1/comment.jpg'), 'and photos in comments');
SELECT t.ok(NOT public.community_post_media_readable('ad/cake.jpg'), 'not a birthday draft that hasn''t gone out');
SELECT t.ok(NOT public.community_post_media_readable('a1/nothing.jpg'), 'not a file on no post');
SET test.aal = 'aal1';
SELECT t.ok(NOT public.community_post_media_readable('a1/squat.mp4'), 'not before MFA');

SET test.uid = '00000000-0000-0000-0000-0000000000a1';
SET test.aal = 'aal1';
SELECT t.ok(public.community_post_media_readable('a1/two.jpg'), 'clients see the crew''s photos as before');
SET test.uid = '00000000-0000-0000-0000-0000000000a2';
SELECT t.ok(NOT public.community_post_media_readable('a1/two.jpg') AND NOT public.community_comment_media_readable('a1/comment.jpg'),
                  'a stranger sees none');
SET test.uid = '00000000-0000-0000-0000-0000000000ad';
SET test.aal = 'aal2';
SELECT t.ok(public.community_post_media_readable('ad/cake.jpg') AND public.community_comment_media_readable('a1/hidden.jpg'),
                  'the admin still previews drafts and hidden comments');
RESET ROLE;

SELECT 'ALL OK' AS result;
