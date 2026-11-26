-- Crew user-generated-content safety (App Review Guideline 1.2), Nov 25 2026.
--
-- Apple asks every app with user content for four things: a way to filter
-- objectionable material before it's posted, a way to report it with a
-- timely response, a way to block abusive people, and published contact
-- details. Crew had report (posts and programs), block and contact; this adds
-- the rest and closes the gaps:
--
--   1. A word filter (`crew_text_verdict`) checked on the server before every
--      Crew post caption, story text, comment, bio and message request is
--      saved: a slur, sexual content or a threat is refused with a short
--      neutral message; borderline words are saved and put in the coach's
--      queue (`community_reports.source = 'filter'`). The lists and steps are
--      the same as src/lib/crew-content-filter.ts (stored ROT13; the test
--      fails if the two drift apart).
--   2. Reports on comments, stories and profiles as well as posts; what you
--      report is hidden from you at once (feed, stories, comments), and after
--      N independent reports (`community_moderation_settings.auto_hide_reports`,
--      default 3) it's hidden for everyone until the team decides.
--   3. One moderation queue with Remove, Keep, Warn and Suspend posting
--      (`community_moderate`), a 24-hour response target, every action logged.
--   4. Blocks now also hide comments and opened posts both ways (they already
--      hid the feed, stories, profiles and messages), and Rankings can drop
--      blocked people (`community_blocked_client_ids`).
--   5. A one-time "Community rules" acceptance before the first Crew post or
--      comment, stored here (`community_rules_acceptances`).
--
-- Nothing is ever posted by the filter or the queue on anyone's behalf, and
-- staff (coaches, admins) and the system (no signed-in user) are never
-- filtered, held to the rules or suspended. A write made inside another
-- trigger (a finished workout's automatic story) is never refused: a match
-- there goes to the queue instead, so a workout can always be saved.

-- ---------------------------------------------------------------------------
-- 1. The word filter (same lists and steps as src/lib/crew-content-filter.ts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crew_filter_tokens(_text text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  s text;
  run text;
  w text;
  words text[] := '{}';
  toks text[] := '{}';
  letters text := '';
BEGIN
  IF _text IS NULL THEN RETURN toks; END IF;
  s := translate(lower(_text), 'àáâãäåèéêëìíîïòóôõöùúûüýÿñç', 'aaaaaaeeeeiiiiooooouuuuyync');
  s := regexp_replace(s, '[\u200B-\u200D\uFEFF\u00AD]', '', 'g');
  s := regexp_replace(s, '[''’‘`]', '', 'g');
  FOREACH run IN ARRAY regexp_split_to_array(s, '[^a-z0-9@$!|]+') LOOP
    run := regexp_replace(run, '^[!|]+|[!|]+$', '', 'g');
    -- no letter (a set count, a weight): dropped, unless one l33t character between spaced letters ("f 4 g")
    CONTINUE WHEN run !~ '[a-z]' AND NOT (char_length(run) = 1 AND position(run IN '0134578@$!|') > 0);
    words := words || translate(run, '0134578@$!|', 'oieastbasii');
  END LOOP;
  -- letters typed one at a time are joined back up ("k y s" → "kys")
  FOREACH w IN ARRAY words LOOP
    IF char_length(w) = 1 THEN
      letters := letters || w;
      CONTINUE;
    END IF;
    IF letters <> '' THEN toks := toks || letters; END IF;
    letters := '';
    toks := toks || w;
  END LOOP;
  IF letters <> '' THEN toks := toks || letters; END IF;
  RETURN toks;
END;
$$;

/** 'ok', or 'block' / 'flag' with the category and the term it matched. Whole words only. */
CREATE OR REPLACE FUNCTION public.crew_text_verdict(_text text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  -- ROT13 "category:term", lower case, letters and single spaces only
  v_block constant text[] := ARRAY[
    'hate:avttre', 'hate:avttref', 'hate:avttn', 'hate:avttnf', 'hate:avttnm', 'hate:fnaqavttre',
    'hate:snttbg', 'hate:snttbgf', 'hate:sntbg', 'hate:snt', 'hate:sntf', 'hate:xvxr', 'hate:xvxrf',
    'hate:fcvp', 'hate:fcvpf', 'hate:tbbx', 'hate:tbbxf', 'hate:jrgonpx',
    'hate:jrgonpxf', 'hate:ornare', 'hate:ornaref', 'hate:enturnq', 'hate:enturnqf', 'hate:gbjryurnq',
    'hate:gbjryurnqf', 'hate:genaal', 'hate:genaavrf', 'hate:ergneq', 'hate:ergneqf', 'hate:ergneqrq',
    'hate:cnxv', 'hate:cnxvf', 'hate:wvtnobb', 'hate:cbepu zbaxrl', 'hate:urvy uvgyre', 'hate:juvgr cbjre',
    'hate:tnf gur wrjf', 'sexual:cbeauho', 'sexual:oybjwbo',
    'sexual:oybjwbof', 'sexual:unaqwbo', 'sexual:unaqwbof', 'sexual:phzfubg', 'sexual:tnatonat',
    'sexual:fraq ahqrf', 'sexual:fraq zr ahqrf', 'sexual:qvpx cvp', 'sexual:qvpx cvpf', 'sexual:encr lbh',
    'sexual:v jvyy encr', 'violence:xvyy lbhefrys', 'violence:xvyy hefrys', 'violence:xvyy lbhe frys',
    'violence:xvyy lbhefryirf', 'violence:xlf', 'violence:ubcr lbh qvr',
    'violence:v ubcr lbh qvr', 'violence:v jvyy xvyy lbh', 'violence:vyy xvyy lbh',
    'violence:v jvyy svaq lbh', 'violence:fubbg lbh', 'violence:fgno lbh',
    'violence:fyvg lbhe guebng', 'violence:unat lbhefrys', 'violence:arpx lbhefrys', 'violence:qevax oyrnpu'
  ];
  v_flag constant text[] := ARRAY[
    'sexual:ahqrf', 'sexual:cbea', 'sexual:cbeab', 'hate:puvax', 'hate:puvaxf', 'violence:tb qvr', 'sexual:ubeal', 'sexual:chffl', 'sexual:pbpx', 'sexual:qvpx', 'sexual:qvpxf',
    'sexual:gvgf', 'sexual:gvggvrf', 'sexual:phz', 'sexual:baylsnaf', 'sexual:fyhg', 'sexual:fyhgf',
    'sexual:juber', 'sexual:juberf', 'sexual:gubg', 'sexual:zvys', 'sexual:qvyqb', 'sexual:frkgvat',
    'sexual:encr', 'sexual:encrq', 'sexual:encvfg', 'harassment:phag', 'harassment:phagf',
    'harassment:qvpxurnq', 'harassment:sngnff', 'harassment:sng nff', 'harassment:sng cvt',
    'harassment:sng pbj', 'harassment:htyl ovgpu', 'harassment:fghcvq ovgpu', 'harassment:qhzo ovgpu',
    'harassment:lbh ovgpu', 'harassment:abobql yvxrf lbh', 'harassment:lbher htyl',
    'harassment:lbh ner htyl', 'harassment:lbher qvfthfgvat', 'harassment:lbh ner qvfthfgvat',
    'harassment:gjng', 'harassment:jnaxre', 'hate:qlxr', 'hate:qlxrf', 'hate:ubzb', 'hate:ubzbf',
    'hate:pbba', 'hate:pbbaf', 'hate:anmv', 'hate:anmvf', 'violence:xvyy lbh', 'violence:xvyy h',
    'violence:orng lbh hc', 'violence:chapu lbh', 'violence:uheg lbh', 'violence:zheqre lbh',
    'violence:oernx lbhe yrtf', 'self_harm:xvyy zlfrys', 'self_harm:xvyyvat zlfrys', 'self_harm:jnag gb qvr',
    'self_harm:jnaan qvr', 'self_harm:fhvpvqr', 'self_harm:fhvpvqny', 'self_harm:phg zlfrys',
    'self_harm:phggvat zlfrys', 'self_harm:frys unez', 'self_harm:raq zl yvsr', 'self_harm:raq vg nyy',
    'self_harm:uheg zlfrys', 'self_harm:fgneir zlfrys', 'self_harm:znxr zlfrys guebj hc'
  ];
  toks text[];
  v_raw text;
  v_col text;
  v_str text;
  v_tier text;
  e text;
  v_term text;
BEGIN
  IF _text IS NULL OR btrim(_text) = '' THEN RETURN '{"verdict": "ok"}'::jsonb; END IF;
  toks := public.crew_filter_tokens(_text);
  IF coalesce(array_length(toks, 1), 0) = 0 THEN RETURN '{"verdict": "ok"}'::jsonb; END IF;
  v_raw := ' ' || array_to_string(toks, ' ') || ' ';
  v_col := ' ' || (SELECT string_agg(regexp_replace(t, '([a-z])\1+', '\1', 'g'), ' ' ORDER BY i)
                     FROM unnest(toks) WITH ORDINALITY u(t, i)) || ' ';
  -- words stretched with three of a letter in a row ("kiiill"), folded
  v_str := ' ' || coalesce((SELECT string_agg(regexp_replace(t, '([a-z])\1+', '\1', 'g'), ' ' ORDER BY i)
                              FROM unnest(toks) WITH ORDINALITY u(t, i) WHERE t ~ '([a-z])\1\1'), '') || ' ';
  FOREACH v_tier IN ARRAY ARRAY['block', 'flag'] LOOP
    FOREACH e IN ARRAY CASE WHEN v_tier = 'block' THEN v_block ELSE v_flag END LOOP
      v_term := translate(split_part(e, ':', 2), 'abcdefghijklmnopqrstuvwxyz', 'nopqrstuvwxyzabcdefghijklm');
      IF position(' ' || v_term || ' ' IN v_raw) > 0
         OR position(' ' || regexp_replace(v_term, '([a-z])\1+', '\1', 'g') || ' '
                     IN CASE WHEN position(' ' IN v_term) > 0 THEN v_col ELSE v_str END) > 0 THEN
        RETURN jsonb_build_object('verdict', v_tier, 'category', split_part(e, ':', 1), 'term', v_term);
      END IF;
    END LOOP;
  END LOOP;
  RETURN '{"verdict": "ok"}'::jsonb;
END;
$$;
REVOKE ALL ON FUNCTION public.crew_filter_tokens(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crew_text_verdict(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_filter_tokens(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crew_text_verdict(text) TO authenticated, service_role;

/** Every string inside a sticker (a poll's question and options, a question box's prompt). */
CREATE OR REPLACE FUNCTION public.crew_json_text(_j jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT string_agg(x #>> '{}', ' ')
    FROM jsonb_path_query(coalesce(_j, 'null'::jsonb), 'strict $.**') AS x
   WHERE jsonb_typeof(x) = 'string'
$$;
REVOKE ALL ON FUNCTION public.crew_json_text(jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Settings, rules, warnings and suspensions, the action log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_moderation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  auto_hide_reports integer NOT NULL DEFAULT 3 CHECK (auto_hide_reports BETWEEN 2 AND 20),
  response_hours integer NOT NULL DEFAULT 24 CHECK (response_hours BETWEEN 1 AND 168),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.community_moderation_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.community_moderation_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_moderation_settings FROM anon, authenticated;
GRANT SELECT ON public.community_moderation_settings TO authenticated;
GRANT ALL ON public.community_moderation_settings TO service_role;
DROP POLICY IF EXISTS "Staff read moderation settings" ON public.community_moderation_settings;
CREATE POLICY "Staff read moderation settings" ON public.community_moderation_settings FOR SELECT TO authenticated
  USING ((SELECT public.is_community_staff()));

-- The one-time "Community rules" acceptance before a first Crew post or comment.
CREATE TABLE IF NOT EXISTS public.community_rules_acceptances (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_rules_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_rules_acceptances FROM anon, authenticated;
GRANT SELECT ON public.community_rules_acceptances TO authenticated;
GRANT ALL ON public.community_rules_acceptances TO service_role;
DROP POLICY IF EXISTS "Own rules acceptance" ON public.community_rules_acceptances;
CREATE POLICY "Own rules acceptance" ON public.community_rules_acceptances FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_community_staff()));

-- A warning and a posting suspension, per person (main account). Written only by community_moderate.
CREATE TABLE IF NOT EXISTS public.community_member_sanctions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  warnings integer NOT NULL DEFAULT 0,
  warned_at timestamptz,
  warning_note text CHECK (warning_note IS NULL OR char_length(warning_note) <= 500),
  warning_seen_at timestamptz,
  posting_suspended_until timestamptz,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_member_sanctions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_member_sanctions FROM anon, authenticated;
GRANT SELECT ON public.community_member_sanctions TO authenticated;
GRANT ALL ON public.community_member_sanctions TO service_role;
DROP POLICY IF EXISTS "Own sanctions, staff all" ON public.community_member_sanctions;
CREATE POLICY "Own sanctions, staff all" ON public.community_member_sanctions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_community_staff()));

-- Every moderation decision, append-only. Staff read; the RPCs write.
CREATE TABLE IF NOT EXISTS public.community_moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kind text NOT NULL,
  target_id uuid NOT NULL,
  target_owner uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('remove', 'keep', 'warn', 'suspend', 'unsuspend', 'auto_hide')),
  note text,
  days integer,
  acted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_moderation_actions_target_idx ON public.community_moderation_actions (target_kind, target_id, created_at DESC);
ALTER TABLE public.community_moderation_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_moderation_actions FROM anon, authenticated;
GRANT SELECT ON public.community_moderation_actions TO authenticated;
GRANT ALL ON public.community_moderation_actions TO service_role;
DROP POLICY IF EXISTS "Staff read moderation actions" ON public.community_moderation_actions;
CREATE POLICY "Staff read moderation actions" ON public.community_moderation_actions FOR SELECT TO authenticated
  USING ((SELECT public.is_community_staff()));

CREATE OR REPLACE FUNCTION public.crew_rules_version()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;

CREATE OR REPLACE FUNCTION public.crew_rules_accepted(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_rules_acceptances a
                  WHERE a.user_id IN (_uid, public.community_main_account(_uid))
                    AND a.version >= public.crew_rules_version())
$$;
REVOKE ALL ON FUNCTION public.crew_rules_accepted(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crew_posting_paused_until(_uid uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(s.posting_suspended_until) FROM public.community_member_sanctions s
   WHERE s.user_id IN (_uid, public.community_main_account(_uid)) AND s.posting_suspended_until > now()
$$;
REVOKE ALL ON FUNCTION public.crew_posting_paused_until(uuid) FROM PUBLIC, anon, authenticated;

/** Raises when this person can't post in Crew right now: suspended, or (when asked) the rules not yet accepted. */
CREATE OR REPLACE FUNCTION public.crew_assert_can_post(_uid uuid, _need_rules boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_until timestamptz := public.crew_posting_paused_until(_uid);
BEGIN
  IF v_until IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Posting in Crew is paused on your account until ' || to_char(v_until AT TIME ZONE 'America/Winnipeg', 'FMMon FMDD') || '.',
      ERRCODE = '42501', HINT = 'crew_suspended';
  END IF;
  IF _need_rules AND NOT public.crew_rules_accepted(_uid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Accept the Crew community rules to post.', ERRCODE = 'P0001', HINT = 'crew_rules';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.crew_assert_can_post(uuid, boolean) FROM PUBLIC, anon, authenticated;

/** Accept the Crew community rules (once; a newer version asks again). */
CREATE OR REPLACE FUNCTION public.community_accept_rules(_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.community_rules_acceptances (user_id, version, accepted_at)
  VALUES (uid, greatest(coalesce(_version, 0), public.crew_rules_version()), now())
  ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version, accepted_at = now();
  RETURN jsonb_build_object('ok', true, 'version', public.crew_rules_version());
END;
$$;
REVOKE ALL ON FUNCTION public.community_accept_rules(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_accept_rules(integer) TO authenticated;

/** Me in Crew: rules accepted, posting paused, a warning not yet seen. */
CREATE OR REPLACE FUNCTION public.community_my_moderation()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'rules_version', public.crew_rules_version(),
    'rules_accepted', auth.uid() IS NOT NULL AND (public.community_is_staff(auth.uid()) OR public.crew_rules_accepted(auth.uid())),
    'posting_paused_until', public.crew_posting_paused_until(auth.uid()),
    'warning', (SELECT jsonb_build_object('note', s.warning_note, 'at', s.warned_at)
                  FROM public.community_member_sanctions s
                 WHERE s.user_id IN (auth.uid(), public.community_main_account(auth.uid()))
                   AND s.warned_at IS NOT NULL AND (s.warning_seen_at IS NULL OR s.warning_seen_at < s.warned_at)
                 ORDER BY s.warned_at DESC LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.community_my_moderation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_my_moderation() TO authenticated;

CREATE OR REPLACE FUNCTION public.community_ack_warning()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.community_member_sanctions SET warning_seen_at = now()
   WHERE user_id IN (auth.uid(), public.community_main_account(auth.uid())) AND warned_at IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.community_ack_warning() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_ack_warning() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reports: automatic flags, messages, own rows, a hold that sticks
-- ---------------------------------------------------------------------------
ALTER TABLE public.community_reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE public.community_reports ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'member';
ALTER TABLE public.community_reports ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE public.community_reports DROP CONSTRAINT IF EXISTS community_reports_source_check;
ALTER TABLE public.community_reports ADD CONSTRAINT community_reports_source_check
  CHECK (source IN ('member', 'filter') AND (source = 'filter' OR reporter_id IS NOT NULL));
-- the original check was written inline (its name is Postgres's choice): drop whichever one checks target_kind
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.community_reports'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%target_kind%' LOOP
    EXECUTE format('ALTER TABLE public.community_reports DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.community_reports ADD CONSTRAINT community_reports_target_kind_check
  CHECK (target_kind IN ('post', 'comment', 'program', 'profile', 'message'));
CREATE UNIQUE INDEX IF NOT EXISTS community_reports_filter_once ON public.community_reports (target_kind, target_id) WHERE source = 'filter';
CREATE INDEX IF NOT EXISTS community_reports_target_idx ON public.community_reports (target_kind, target_id);
COMMENT ON COLUMN public.community_reports.source IS
  'member: someone reported it (reporter_id); filter: the word filter flagged it as it was posted (no reporter).';

-- People file their own reports (reporter_id is always them; the trigger
-- below fills in whose it is and what it said) and see their own; staff read
-- everything and act through community_moderate.
GRANT INSERT (reporter_id, target_kind, target_id, reason, details) ON public.community_reports TO authenticated;
DROP POLICY IF EXISTS "Reporters file their own reports" ON public.community_reports;
CREATE POLICY "Reporters file their own reports" ON public.community_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()) AND source = 'member' AND status = 'open');
DROP POLICY IF EXISTS "Reporters read their own reports" ON public.community_reports;
CREATE POLICY "Reporters read their own reports" ON public.community_reports FOR SELECT TO authenticated
  USING (reporter_id = (SELECT auth.uid()));

-- A hold: hidden for everyone pending review ('reported'), or taken down by the team ('removed').
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_archived_reason_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_archived_reason_check
  CHECK (archived_reason IS NULL OR archived_reason IN ('workout_card', 'feed_fit', 'reported', 'removed'));
ALTER TABLE public.community_comments ADD COLUMN IF NOT EXISTS held_reason text;
ALTER TABLE public.community_comments DROP CONSTRAINT IF EXISTS community_comments_held_reason_check;
ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_held_reason_check
  CHECK (held_reason IS NULL OR held_reason IN ('reported', 'removed'));

/** A post on hold stays archived whatever path tries to bring it back, until staff decide. */
CREATE OR REPLACE FUNCTION public.tg_crew_post_keep_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.archived_reason IN ('reported', 'removed') AND NEW.archived_at IS NULL
     AND auth.uid() IS NOT NULL AND NOT public.community_is_staff(auth.uid()) THEN
    NEW.visibility := OLD.visibility;
    NEW.archived_at := OLD.archived_at;
    NEW.archived_from := OLD.archived_from;
    NEW.archived_reason := OLD.archived_reason;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS community_posts_moderation_hold ON public.community_posts;
CREATE TRIGGER community_posts_moderation_hold BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.tg_crew_post_keep_hold();

/** A comment on hold can't be shown again (or its hold cleared) by anyone but staff. */
CREATE OR REPLACE FUNCTION public.tg_crew_comment_keep_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.held_reason IS NOT NULL AND (NEW.hidden_at IS NULL OR NEW.held_reason IS DISTINCT FROM OLD.held_reason)
     AND auth.uid() IS NOT NULL AND NOT public.community_is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'The JF Effect team is reviewing this comment' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS community_comments_moderation_hold ON public.community_comments;
CREATE TRIGGER community_comments_moderation_hold BEFORE UPDATE ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_crew_comment_keep_hold();

/** Who owns a reportable thing and what it said, if the signed-in person can see it (raises otherwise). */
CREATE OR REPLACE FUNCTION public.community_report_target(_kind text, _target uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post record;
  v_comment record;
  v_prog public.athlete_programs%ROWTYPE;
BEGIN
  IF _kind = 'post' THEN
    SELECT id, author_user_id, client_id, visibility, caption, media_path, media_type, kind, story_only, created_at
      INTO v_post FROM public.community_posts WHERE id = _target;
    IF NOT FOUND OR NOT public.community_post_visible(v_post.visibility, v_post.author_user_id, v_post.client_id) THEN
      RAISE EXCEPTION 'Post not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('owner', v_post.author_user_id,
      'snapshot', jsonb_build_object('caption', left(v_post.caption, 500), 'media_path', v_post.media_path,
                                     'media_type', v_post.media_type, 'kind', v_post.kind, 'story', v_post.story_only,
                                     'posted_at', v_post.created_at));
  ELSIF _kind = 'comment' THEN
    SELECT c.id, c.author_user_id, c.body, c.post_id, p.visibility, p.author_user_id AS post_author, p.client_id, p.caption
      INTO v_comment
      FROM public.community_comments c JOIN public.community_posts p ON p.id = c.post_id
     WHERE c.id = _target;
    IF NOT FOUND OR NOT public.community_post_visible(v_comment.visibility, v_comment.post_author, v_comment.client_id) THEN
      RAISE EXCEPTION 'Comment not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('owner', v_comment.author_user_id,
      'snapshot', jsonb_build_object('body', left(v_comment.body, 500), 'post_id', v_comment.post_id,
                                     'post_caption', left(v_comment.caption, 200)));
  ELSIF _kind = 'program' THEN
    SELECT * INTO v_prog FROM public.athlete_programs WHERE id = _target;
    IF NOT FOUND OR NOT public.athlete_program_visible(v_prog.owner_id, v_prog.visibility, v_prog.hidden_at, v_prog.archived_at) THEN
      RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('owner', v_prog.owner_id,
      'snapshot', jsonb_build_object('title', v_prog.title, 'description', left(v_prog.description, 500)));
  ELSIF _kind = 'profile' THEN
    IF NOT EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.user_id = _target) THEN
      RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('owner', _target,
      'snapshot', public.community_author(_target)
                  || jsonb_build_object('bio', (SELECT left(cp.bio, 200) FROM public.community_profiles cp WHERE cp.user_id = _target)));
  END IF;
  RAISE EXCEPTION 'Unknown report' USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.community_report_target(text, uuid) FROM PUBLIC, anon, authenticated;

/** A member's report: always filed as them, about something they can see that isn't theirs. */
CREATE OR REPLACE FUNCTION public.tg_community_report_fill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NEW.source <> 'member' THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND NEW.reporter_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NEW.target_kind = 'message' THEN RAISE EXCEPTION 'Unknown report' USING ERRCODE = '22023'; END IF;
  v := public.community_report_target(NEW.target_kind, NEW.target_id);
  NEW.target_owner := (v->>'owner')::uuid;
  NEW.snapshot := coalesce(v->'snapshot', '{}'::jsonb);
  NEW.details := left(nullif(btrim(coalesce(NEW.details, '')), ''), 500);
  IF public.community_main_account(NEW.target_owner) = public.community_main_account(NEW.reporter_id) THEN
    RAISE EXCEPTION 'That''s yours' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS community_reports_fill ON public.community_reports;
CREATE TRIGGER community_reports_fill BEFORE INSERT ON public.community_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_community_report_fill();

/**
 * How many independent people have an open report on something: different
 * people (linked logins count once), not staff, accounts at least a week old
 * (so one person can't do it with fresh sign-ups).
 */
CREATE OR REPLACE FUNCTION public.community_report_count(_kind text, _target uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT public.community_main_account(r.reporter_id))::int
    FROM public.community_reports r JOIN auth.users au ON au.id = r.reporter_id
   WHERE r.target_kind = _kind AND r.target_id = _target AND r.status = 'open' AND r.source = 'member'
     AND au.created_at < now() - interval '7 days'
     AND NOT public.community_is_staff(r.reporter_id)
$$;
REVOKE ALL ON FUNCTION public.community_report_count(text, uuid) FROM PUBLIC, anon, authenticated;

/** N independent reports (the setting, default 3) hide it for everyone until staff decide. Staff's own content is never auto-hidden. */
CREATE OR REPLACE FUNCTION public.tg_community_report_auto_hide()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  IF NEW.source <> 'member' OR NEW.status <> 'open' OR NEW.target_kind NOT IN ('post', 'comment', 'program') THEN RETURN NULL; END IF;
  IF NEW.target_owner IS NOT NULL AND public.community_is_staff(NEW.target_owner) THEN RETURN NULL; END IF;
  SELECT s.auto_hide_reports INTO v_n FROM public.community_moderation_settings s WHERE s.id;
  IF public.community_report_count(NEW.target_kind, NEW.target_id) < coalesce(v_n, 3) THEN RETURN NULL; END IF;
  IF NEW.target_kind = 'post' THEN
    UPDATE public.community_posts
       SET archived_from = visibility, visibility = 'private', archived_at = now(), archived_reason = 'reported', updated_at = now()
     WHERE id = NEW.target_id AND archived_at IS NULL;
  ELSIF NEW.target_kind = 'comment' THEN
    UPDATE public.community_comments SET hidden_at = coalesce(hidden_at, now()), held_reason = 'reported'
     WHERE id = NEW.target_id AND held_reason IS NULL;
  ELSE
    UPDATE public.athlete_programs SET hidden_at = now(), hidden_reason = 'Reported by several people'
     WHERE id = NEW.target_id AND hidden_at IS NULL;
  END IF;
  IF FOUND THEN
    INSERT INTO public.community_moderation_actions (target_kind, target_id, target_owner, action)
    VALUES (NEW.target_kind, NEW.target_id, NEW.target_owner, 'auto_hide');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS community_reports_auto_hide ON public.community_reports;
CREATE TRIGGER community_reports_auto_hide AFTER INSERT OR UPDATE OF reason, status ON public.community_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_community_report_auto_hide();

/** Report something you can see in Crew (a post or story, a comment, a program, a profile). Hidden from you at once. */
CREATE OR REPLACE FUNCTION public.community_report(_kind text, _target uuid, _reason text, _details text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR _reason NOT IN ('spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'misinformation', 'other') THEN
    RAISE EXCEPTION 'Pick a reason' USING ERRCODE = '22023';
  END IF;
  IF _kind IS NULL OR _kind NOT IN ('post', 'comment', 'program', 'profile') THEN
    RAISE EXCEPTION 'Unknown report' USING ERRCODE = '22023';
  END IF;
  -- Re-sending updates an open report; one the team already settled stays settled.
  -- (community_reports_fill fills in whose it is and what it said; auto_hide counts.)
  INSERT INTO public.community_reports (reporter_id, source, target_kind, target_id, reason, details)
  VALUES (v_uid, 'member', _kind, _target, _reason, _details)
  ON CONFLICT (reporter_id, target_kind, target_id) DO UPDATE
     SET reason = EXCLUDED.reason, details = EXCLUDED.details, snapshot = EXCLUDED.snapshot
   WHERE community_reports.status = 'open';
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.community_report(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_report(text, uuid, text, text) TO authenticated;

/** What I've reported (posts and comments), so the app can hide it from me straight away. */
CREATE OR REPLACE FUNCTION public.community_my_reported()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', r.target_kind, 'id', r.target_id)), '[]'::jsonb)
    FROM public.community_reports r
   WHERE r.reporter_id = auth.uid() AND r.target_kind IN ('post', 'comment')
$$;
REVOKE ALL ON FUNCTION public.community_my_reported() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_my_reported() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The filter on every write
-- ---------------------------------------------------------------------------
/** The filter's flag in the coach's queue (one open per thing; a new match reopens it). */
CREATE OR REPLACE FUNCTION public.crew_filter_flag(_kind text, _target uuid, _owner uuid, _verdict jsonb, _snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.community_reports (reporter_id, source, target_kind, target_id, target_owner, reason, details, snapshot)
  VALUES (NULL, 'filter', _kind, _target, _owner,
          CASE _verdict->>'category' WHEN 'hate' THEN 'hate' WHEN 'sexual' THEN 'nudity' WHEN 'violence' THEN 'violence'
                                     WHEN 'harassment' THEN 'harassment' WHEN 'self_harm' THEN 'self_harm' ELSE 'other' END,
          left('Word filter: "' || coalesce(_verdict->>'term', '') || '"', 500), coalesce(_snapshot, '{}'::jsonb))
  ON CONFLICT (target_kind, target_id) WHERE source = 'filter' DO UPDATE
     SET reason = EXCLUDED.reason, details = EXCLUDED.details, snapshot = EXCLUDED.snapshot, status = 'open',
         created_at = now(), reviewed_by = NULL, reviewed_at = NULL, notified_at = NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.crew_filter_flag(text, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crew_filter_refuse()
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  RAISE EXCEPTION USING MESSAGE = 'This can''t be posted. It goes against the Crew community rules.',
                        ERRCODE = 'P0001', HINT = 'crew_filter';
END;
$$;

/** Posts and stories: the caption, a quote and a sticker's words. */
CREATE OR REPLACE FUNCTION public.tg_crew_post_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_direct boolean := pg_trigger_depth() <= 1;
  v_text text;
  v jsonb;
BEGIN
  IF uid IS NULL OR public.community_is_staff(uid) THEN RETURN NEW; END IF;
  v_text := concat_ws(' ', NEW.caption, NEW.quote, public.crew_json_text(NEW.sticker));
  IF TG_OP = 'INSERT' AND v_direct AND NOT coalesce(NEW.auto_shared, false) THEN
    PERFORM public.crew_assert_can_post(uid, true);
  END IF;
  IF TG_OP = 'UPDATE' AND v_text IS NOT DISTINCT FROM concat_ws(' ', OLD.caption, OLD.quote, public.crew_json_text(OLD.sticker)) THEN
    RETURN NEW;
  END IF;
  v := public.crew_text_verdict(v_text);
  IF v->>'verdict' = 'block' AND v_direct THEN PERFORM public.crew_filter_refuse(); END IF;
  IF v->>'verdict' IN ('block', 'flag') THEN
    PERFORM public.crew_filter_flag('post', NEW.id, NEW.author_user_id, v,
      jsonb_build_object('caption', left(NEW.caption, 500), 'media_path', NEW.media_path, 'media_type', NEW.media_type,
                         'kind', NEW.kind, 'story', NEW.story_only, 'posted_at', coalesce(NEW.created_at, now())));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS community_posts_crew_guard ON public.community_posts;
CREATE TRIGGER community_posts_crew_guard BEFORE INSERT OR UPDATE OF caption, quote, sticker ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.tg_crew_post_guard();

CREATE OR REPLACE FUNCTION public.tg_crew_comment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_direct boolean := pg_trigger_depth() <= 1;
  v jsonb;
BEGIN
  IF uid IS NULL OR public.community_is_staff(uid) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND v_direct THEN PERFORM public.crew_assert_can_post(uid, true); END IF;
  IF TG_OP = 'UPDATE' AND NEW.body IS NOT DISTINCT FROM OLD.body THEN RETURN NEW; END IF;
  v := public.crew_text_verdict(NEW.body);
  IF v->>'verdict' = 'block' AND v_direct THEN PERFORM public.crew_filter_refuse(); END IF;
  IF v->>'verdict' IN ('block', 'flag') THEN
    PERFORM public.crew_filter_flag('comment', NEW.id, NEW.author_user_id, v,
      jsonb_build_object('body', left(NEW.body, 500), 'post_id', NEW.post_id,
                         'post_caption', (SELECT left(p.caption, 200) FROM public.community_posts p WHERE p.id = NEW.post_id)));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS community_comments_crew_guard ON public.community_comments;
CREATE TRIGGER community_comments_crew_guard BEFORE INSERT OR UPDATE OF body ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_crew_comment_guard();

/** A message request (a 1:1 to someone who hasn't accepted yet): the first words a stranger gets. */
CREATE OR REPLACE FUNCTION public.tg_crew_request_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  g record;
  v jsonb;
BEGIN
  IF uid IS NULL OR NEW.sender_id IS DISTINCT FROM uid OR public.community_is_staff(uid) THEN RETURN NEW; END IF;
  SELECT cg.kind, cg.direct_status, cg.requested_by INTO g FROM public.chat_groups cg WHERE cg.id = NEW.group_id;
  IF NOT FOUND OR g.kind IS DISTINCT FROM 'direct' OR g.direct_status IS DISTINCT FROM 'request' OR g.requested_by IS DISTINCT FROM uid THEN
    RETURN NEW;
  END IF;
  PERFORM public.crew_assert_can_post(uid, false);
  v := public.crew_text_verdict(NEW.body);
  IF v->>'verdict' = 'block' THEN PERFORM public.crew_filter_refuse(); END IF;
  IF v->>'verdict' = 'flag' THEN
    PERFORM public.crew_filter_flag('message', NEW.id, uid, v, jsonb_build_object('body', left(NEW.body, 500), 'group_id', NEW.group_id));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS group_messages_crew_request_guard ON public.group_messages;
CREATE TRIGGER group_messages_crew_request_guard BEFORE INSERT ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_crew_request_guard();

/** A Crew bio: refused or flagged like a post. */
CREATE OR REPLACE FUNCTION public.tg_crew_bio_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v jsonb;
BEGIN
  IF uid IS NULL OR public.community_is_staff(uid) OR NEW.bio IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.bio IS NOT DISTINCT FROM OLD.bio THEN RETURN NEW; END IF;
  v := public.crew_text_verdict(NEW.bio);
  IF v->>'verdict' = 'block' AND pg_trigger_depth() <= 1 THEN PERFORM public.crew_filter_refuse(); END IF;
  IF v->>'verdict' IN ('block', 'flag') THEN
    PERFORM public.crew_filter_flag('profile', NEW.user_id, NEW.user_id, v, jsonb_build_object('bio', left(NEW.bio, 200)));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS community_profiles_crew_bio_guard ON public.community_profiles;
CREATE TRIGGER community_profiles_crew_bio_guard BEFORE INSERT OR UPDATE OF bio ON public.community_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_crew_bio_guard();

-- ---------------------------------------------------------------------------
-- 5. The queue and its four actions
-- ---------------------------------------------------------------------------
/** Staff: everything open, one row per reported or flagged thing, oldest first (the 24-hour clock). */
CREATE OR REPLACE FUNCTION public.community_reports_open()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN NOT public.is_community_staff() THEN '[]'::jsonb ELSE coalesce((
    SELECT jsonb_agg(g ORDER BY g->>'first_at')
      FROM (
        SELECT jsonb_build_object(
                 'target_kind', r.target_kind,
                 'target_id', r.target_id,
                 'owner_id', max(r.target_owner::text)::uuid,
                 'owner', public.community_author(max(r.target_owner::text)::uuid),
                 'reports', count(*) FILTER (WHERE r.source = 'member'),
                 'flagged', bool_or(r.source = 'filter'),
                 'reasons', jsonb_agg(DISTINCT r.reason),
                 'details', (SELECT jsonb_agg(x.details ORDER BY x.created_at) FROM public.community_reports x
                              WHERE x.target_kind = r.target_kind AND x.target_id = r.target_id
                                AND x.status = 'open' AND x.details IS NOT NULL),
                 'snapshot', (array_agg(r.snapshot ORDER BY r.created_at DESC))[1],
                 'first_at', min(r.created_at),
                 'last_at', max(r.created_at),
                 'due_at', min(r.created_at) + make_interval(hours => (SELECT s.response_hours FROM public.community_moderation_settings s WHERE s.id)),
                 'held', CASE r.target_kind
                           WHEN 'post' THEN EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = r.target_id AND p.archived_reason = 'reported')
                           WHEN 'comment' THEN EXISTS (SELECT 1 FROM public.community_comments c WHERE c.id = r.target_id AND c.held_reason = 'reported')
                           WHEN 'program' THEN EXISTS (SELECT 1 FROM public.athlete_programs ap WHERE ap.id = r.target_id AND ap.hidden_at IS NOT NULL)
                           ELSE false END,
                 'owner_status', (SELECT jsonb_build_object('warnings', s.warnings, 'warned_at', s.warned_at,
                                                            'posting_paused_until', CASE WHEN s.posting_suspended_until > now() THEN s.posting_suspended_until END)
                                    FROM public.community_member_sanctions s
                                   WHERE s.user_id = public.community_main_account(max(r.target_owner::text)::uuid))) AS g
          FROM public.community_reports r
         WHERE r.status = 'open'
         GROUP BY r.target_kind, r.target_id) s), '[]'::jsonb) END
$$;
REVOKE ALL ON FUNCTION public.community_reports_open() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_reports_open() TO authenticated;

CREATE OR REPLACE FUNCTION public.community_moderation_settings_get()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.is_community_staff() THEN NULL ELSE
    (SELECT jsonb_build_object('auto_hide_reports', s.auto_hide_reports, 'response_hours', s.response_hours)
       FROM public.community_moderation_settings s WHERE s.id) END
$$;
REVOKE ALL ON FUNCTION public.community_moderation_settings_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_moderation_settings_get() TO authenticated;

CREATE OR REPLACE FUNCTION public.community_moderation_settings_set(_auto_hide_reports integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.community_moderation_settings
     SET auto_hide_reports = least(greatest(coalesce(_auto_hide_reports, 3), 2), 20), updated_by = auth.uid(), updated_at = now()
   WHERE id;
  RETURN public.community_moderation_settings_get();
END;
$$;
REVOKE ALL ON FUNCTION public.community_moderation_settings_set(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_moderation_settings_set(integer) TO authenticated;

/**
 * Staff act on one reported or flagged thing:
 *   remove  — out of Crew for good (a post to its author's archive, which they
 *             can't undo; a comment hidden; a program taken down; a message
 *             request deleted). Settles its reports.
 *   keep    — it stays (anything the reports hid comes back). Settles its reports.
 *   warn    — the author sees a one-time notice in Crew (`_note`, optional).
 *   suspend — the author can't post, comment or send message requests for
 *             `_days` (default 7; 0 lifts it).
 * Warn and suspend leave the item in the queue, so Remove + Warn is two taps.
 */
CREATE OR REPLACE FUNCTION public.community_moderate(_kind text, _target uuid, _action text, _days integer DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_owner uuid;
  v_person uuid;
  v_days int;
  v_note text := left(nullif(btrim(coalesce(_note, '')), ''), 500);
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('remove', 'keep', 'warn', 'suspend') THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023'; END IF;
  SELECT r.target_owner INTO v_owner FROM public.community_reports r
   WHERE r.target_kind = _kind AND r.target_id = _target AND r.target_owner IS NOT NULL
   ORDER BY r.created_at DESC LIMIT 1;

  IF _action = 'remove' THEN
    IF _kind = 'post' THEN
      UPDATE public.community_posts
         SET archived_from = CASE WHEN archived_at IS NULL THEN visibility ELSE archived_from END,
             visibility = 'private', archived_at = coalesce(archived_at, now()), archived_reason = 'removed', updated_at = now()
       WHERE id = _target;
    ELSIF _kind = 'comment' THEN
      UPDATE public.community_comments SET hidden_at = coalesce(hidden_at, now()), hidden_by = uid, held_reason = 'removed'
       WHERE id = _target;
    ELSIF _kind = 'program' THEN
      UPDATE public.athlete_programs SET hidden_at = coalesce(hidden_at, now()), hidden_by = uid,
             hidden_reason = 'Taken down by the JF Effect team'
       WHERE id = _target;
    ELSIF _kind = 'message' THEN
      DELETE FROM public.group_messages WHERE id = _target;
    ELSE
      RAISE EXCEPTION 'An account can''t be removed here: warn them or suspend their posting' USING ERRCODE = '22023';
    END IF;
  ELSIF _action = 'keep' THEN
    IF _kind = 'post' THEN
      UPDATE public.community_posts
         SET visibility = coalesce(archived_from, 'community'), archived_from = NULL, archived_at = NULL, archived_reason = NULL, updated_at = now()
       WHERE id = _target AND archived_reason = 'reported';
    ELSIF _kind = 'comment' THEN
      UPDATE public.community_comments
         SET hidden_at = CASE WHEN hidden_by IS NULL THEN NULL ELSE hidden_at END, held_reason = NULL
       WHERE id = _target AND held_reason = 'reported';
    ELSIF _kind = 'program' THEN
      UPDATE public.athlete_programs SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL
       WHERE id = _target AND hidden_reason = 'Reported by several people';
    END IF;
  ELSE
    IF v_owner IS NULL THEN RAISE EXCEPTION 'Nobody to %', _action USING ERRCODE = 'P0002'; END IF;
    IF public.community_is_staff(v_owner) THEN RAISE EXCEPTION 'Coaches can''t be warned or suspended' USING ERRCODE = '22023'; END IF;
    v_person := public.community_main_account(v_owner);
    IF _action = 'warn' THEN
      INSERT INTO public.community_member_sanctions (user_id, warnings, warned_at, warning_note, warning_seen_at, updated_by, updated_at)
      VALUES (v_person, 1, now(), v_note, NULL, uid, now())
      ON CONFLICT (user_id) DO UPDATE
         SET warnings = community_member_sanctions.warnings + 1, warned_at = now(), warning_note = EXCLUDED.warning_note,
             warning_seen_at = NULL, updated_by = uid, updated_at = now();
    ELSE
      v_days := least(greatest(coalesce(_days, 7), 0), 365);
      INSERT INTO public.community_member_sanctions (user_id, posting_suspended_until, updated_by, updated_at)
      VALUES (v_person, CASE WHEN v_days > 0 THEN now() + make_interval(days => v_days) END, uid, now())
      ON CONFLICT (user_id) DO UPDATE
         SET posting_suspended_until = EXCLUDED.posting_suspended_until, updated_by = uid, updated_at = now();
    END IF;
  END IF;

  IF _action IN ('remove', 'keep') THEN
    UPDATE public.community_reports
       SET status = CASE WHEN _action = 'remove' THEN 'removed' ELSE 'dismissed' END, reviewed_by = uid, reviewed_at = now()
     WHERE target_kind = _kind AND target_id = _target AND status = 'open';
  END IF;
  INSERT INTO public.community_moderation_actions (target_kind, target_id, target_owner, action, note, days, acted_by)
  VALUES (_kind, _target, v_owner,
          CASE WHEN _action = 'suspend' AND v_days = 0 THEN 'unsuspend' ELSE _action END,
          v_note, v_days, uid);
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.community_moderate(text, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_moderate(text, uuid, text, integer, text) TO authenticated;

-- Older builds' Remove / Dismiss go through the same actions.
CREATE OR REPLACE FUNCTION public.community_report_resolve(_kind text, _target uuid, _action text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _action NOT IN ('remove', 'dismiss') THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023'; END IF;
  PERFORM public.community_moderate(_kind, _target, CASE WHEN _action = 'remove' AND _kind <> 'profile' THEN 'remove' ELSE 'keep' END);
END;
$$;
REVOKE ALL ON FUNCTION public.community_report_resolve(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_report_resolve(text, uuid, text) TO authenticated;

/** Restore from your archive, unless the team is reviewing or removed it. */
CREATE OR REPLACE FUNCTION public.community_archive_post(_post_id uuid, _archive boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.community_is_post_author(_post_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(_archive, true) THEN
    UPDATE public.community_posts SET archived_from = visibility, visibility = 'private', archived_at = now(), archived_reason = NULL, updated_at = now()
     WHERE id = _post_id AND archived_at IS NULL;
  ELSE
    IF EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id AND p.archived_reason = 'reported') THEN
      RAISE EXCEPTION 'The JF Effect team is reviewing this post' USING ERRCODE = '42501', HINT = 'crew_held';
    END IF;
    IF EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id AND p.archived_reason = 'removed') THEN
      RAISE EXCEPTION 'The JF Effect team removed this post from Crew' USING ERRCODE = '42501', HINT = 'crew_held';
    END IF;
    IF public.community_is_workout_card(_post_id) THEN
      RAISE EXCEPTION 'Add a photo or clip to share this workout again' USING ERRCODE = 'P0001', HINT = 'workout_needs_media';
    END IF;
    UPDATE public.community_posts SET visibility = coalesce(archived_from, 'community'), archived_from = NULL, archived_at = NULL, archived_reason = NULL, updated_at = now()
     WHERE id = _post_id AND archived_at IS NOT NULL;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Blocks both ways, and what you reported, in the reads
-- ---------------------------------------------------------------------------
/**
 * A post's comments. Hidden ones (and replies under a hidden one) only for the
 * writer, the post's owner and staff; one on hold for review or removed only
 * for its writer and staff; never a comment by someone blocked either way
 * (staff see everything), and never one you reported.
 */
CREATE OR REPLACE FUNCTION public.community_comments(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_staff boolean := public.is_community_staff();
  v_owner uuid;
  v_vis text;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.author_user_id, p.visibility INTO v_owner, v_vis FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
     AND (v_staff OR p.author_user_id = uid OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()));
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Post not found'; END IF;
  RETURN coalesce((
    WITH blocked AS (SELECT public.community_blocked_authors() AS id WHERE NOT v_staff),
    reported AS (SELECT r.target_id AS id FROM public.community_reports r
                  WHERE r.reporter_id = uid AND r.target_kind = 'comment')
    SELECT jsonb_agg(public.community_comment_json(cc, uid, v_owner, v_staff, v_vis = 'community') ORDER BY cc.created_at)
      FROM public.community_comments cc
     WHERE cc.id IN (
       SELECT c.id FROM public.community_comments c
        WHERE c.post_id = _post_id
          AND (v_staff OR (
                (c.held_reason IS NULL OR public.community_main_account(c.author_user_id) = v_me)
                AND (v_owner = v_me OR c.hidden_at IS NULL OR public.community_main_account(c.author_user_id) = v_me)
                AND (c.parent_id IS NULL OR EXISTS (
                      SELECT 1 FROM public.community_comments pc WHERE pc.id = c.parent_id
                         AND (pc.held_reason IS NULL OR public.community_main_account(pc.author_user_id) = v_me)
                         AND (v_owner = v_me OR pc.hidden_at IS NULL OR public.community_main_account(pc.author_user_id) = v_me)
                         AND pc.author_user_id NOT IN (SELECT id FROM blocked)
                         AND pc.id NOT IN (SELECT id FROM reported)))))
          AND c.author_user_id NOT IN (SELECT id FROM blocked)
          AND c.id NOT IN (SELECT id FROM reported)
        ORDER BY c.created_at
        LIMIT 300)
  ), '[]'::jsonb);
END;
$$;

/** One post, opened: never across a block (staff see everything). */
CREATE OR REPLACE FUNCTION public.community_post(_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_completion uuid;
  v_hide boolean;
  v_found boolean := false;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT true, p.completion_id, p.hide_loads AND p.author_user_id <> uid INTO v_found, v_completion, v_hide FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
     AND (p.author_user_id = uid OR public.community_is_staff(uid)
          OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()));
  IF NOT coalesce(v_found, false) THEN RAISE EXCEPTION 'Post not found'; END IF;
  IF public.community_lockin_has_finish(_post_id) THEN v_completion := NULL; END IF;
  RETURN public.community_post_json(_post_id, uid)
         || jsonb_build_object('exercises', CASE WHEN v_completion IS NULL THEN '[]'::jsonb WHEN v_hide THEN public.community_hide_exercise_loads(public.community_workout_exercises(v_completion))
                                                ELSE public.community_workout_exercises(v_completion) END);
END;
$function$;

/** Rankings: the client records of people blocked either way (none for staff), so the boards can leave them out. */
CREATE OR REPLACE FUNCTION public.community_blocked_client_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.clients c
   WHERE NOT public.community_is_staff(auth.uid())
     AND c.user_id IN (SELECT public.community_blocked_authors())
$$;
REVOKE ALL ON FUNCTION public.community_blocked_client_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_blocked_client_ids() TO authenticated;

-- The feeds (and so the story rail and profiles, which read community_feed):
-- copied from their latest definitions with one line added, so a post or
-- story you reported leaves your feed at once:
--   AND NOT EXISTS (... community_reports rr WHERE rr.reporter_id = uid AND rr.target_kind = 'post' AND rr.target_id = p.id)
CREATE OR REPLACE FUNCTION public.community_feed(_limit integer DEFAULT 10, _before_at timestamptz DEFAULT NULL::timestamptz,
                                                _before_id uuid DEFAULT NULL::uuid, _author_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_staff boolean := public.community_is_staff(auth.uid());
  lim int := least(greatest(coalesce(_limit, 10), 1), 30);
  result jsonb;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  WITH blocked AS (SELECT public.community_blocked_authors() AS id),
  followed AS (SELECT public.community_followed_authors() AS id),
  -- reposts this viewer may see (none on a profile's own grid): their own, a
  -- public account's or one they follow (staff: all), never across a block
  seen_reposts AS (
    SELECT r.user_id, r.post_id, r.note, r.created_at
      FROM public.community_reposts r
      JOIN public.community_posts rp ON rp.id = r.post_id
      LEFT JOIN public.community_profiles cp ON cp.user_id = r.user_id
     WHERE _author_user_id IS NULL
       AND (v_staff OR r.user_id NOT IN (SELECT id FROM blocked))
       AND (r.user_id = v_me OR v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT id FROM followed))
       AND NOT public.chat_has_blocked(rp.author_user_id, r.user_id)
       AND NOT public.chat_has_blocked(r.user_id, rp.author_user_id)
       AND public.community_is_member(r.user_id)
  ),
  bumped AS (SELECT sr.post_id, max(sr.created_at) AS at FROM seen_reposts sr GROUP BY sr.post_id),
  page AS (
    SELECT p.id, greatest(p.created_at, coalesce(b.at, p.created_at)) AS at FROM public.community_posts p
      LEFT JOIN bumped b ON b.post_id = p.id
     WHERE (p.visibility = 'community'
            OR (p.visibility = 'coach' AND p.author_user_id <> uid AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
            OR (p.visibility = 'followers' AND (p.author_user_id = uid OR v_staff
                                                OR p.author_user_id IN (SELECT id FROM followed)))
            OR (p.visibility = 'close_friends' AND (p.author_user_id = uid OR v_staff
                                                    OR p.author_user_id IN (SELECT public.community_close_friend_authors())))
            OR (p.author_user_id = uid AND _author_user_id = uid))
       AND p.archived_at IS NULL
       AND (v_staff OR p.author_user_id NOT IN (SELECT id FROM blocked))
       AND NOT EXISTS (SELECT 1 FROM public.community_reports rr
                        WHERE rr.reporter_id = uid AND rr.target_kind = 'post' AND rr.target_id = p.id)
       AND (_author_user_id IS NULL OR p.author_user_id = _author_user_id
            OR _author_user_id = ANY (public.community_post_collab_ids(p.id)))
       AND (_before_at IS NULL OR (greatest(p.created_at, coalesce(b.at, p.created_at)), p.id)
                                  < (_before_at, coalesce(_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     ORDER BY 2 DESC, p.id DESC
     LIMIT lim + 1
  ),
  numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.at DESC, page.id DESC) rn FROM page)
  SELECT jsonb_build_object(
           'posts', coalesce((
             SELECT jsonb_agg(public.community_post_json(n.id, uid)
                              || jsonb_build_object(
                                   'feed_at', n.at,
                                   -- who reposted it, people you follow first, then you, then the newest
                                   'reposted_by', (SELECT jsonb_agg(public.community_author(x.user_id)
                                                                    || jsonb_build_object('note', x.note, 'at', x.created_at, 'is_me', x.user_id = v_me)
                                                                    ORDER BY x.rk, x.created_at DESC)
                                                     FROM (SELECT sr.user_id, sr.note, sr.created_at,
                                                                  CASE WHEN sr.user_id IN (SELECT id FROM followed) THEN 0 WHEN sr.user_id = v_me THEN 1 ELSE 2 END AS rk
                                                             FROM seen_reposts sr WHERE sr.post_id = n.id
                                                            ORDER BY rk, sr.created_at DESC LIMIT 3) x),
                                   'reposters_count', (SELECT count(*) FROM seen_reposts sr WHERE sr.post_id = n.id))
                              ORDER BY n.rn)
               FROM numbered n WHERE n.rn <= lim), '[]'::jsonb),
           'has_more', (SELECT count(*) FROM page) > lim)
    INTO result;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_feed_ranked(
  _limit integer DEFAULT 5,
  _cursor jsonb DEFAULT NULL,
  _seen_before timestamptz DEFAULT NULL,
  _following boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_staff boolean := public.community_is_staff(auth.uid());
  lim int := least(greatest(coalesce(_limit, 5), 1), 30);
  v_seen timestamptz := least(coalesce(nullif(_cursor->>'seen_before', '')::timestamptz, _seen_before, now()), now());
  v_phase text := CASE WHEN _cursor->>'phase' = 'rest' THEN 'rest' ELSE 'fresh' END;
  v_score numeric := nullif(_cursor->>'score', '')::numeric;
  v_at timestamptz := nullif(_cursor->>'at', '')::timestamptz;
  v_id uuid := coalesce(nullif(_cursor->>'id', '')::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
  v_following boolean := coalesce(_following, false);
  v_rows jsonb;
  v_fresh_total int;
  v_rest boolean;
  v_n int;
  v_last jsonb;
  v_next jsonb;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;

  WITH blocked AS (SELECT public.community_blocked_authors() AS id),
  followed AS (SELECT public.community_followed_authors() AS id),
  fans AS (SELECT f.follower_id AS id FROM public.community_follows f WHERE f.followee_id = v_me),
  seen_reposts AS (
    SELECT r.user_id, r.post_id, r.created_at
      FROM public.community_reposts r
      JOIN public.community_posts rp ON rp.id = r.post_id
      LEFT JOIN public.community_profiles cp ON cp.user_id = r.user_id
     WHERE (v_staff OR r.user_id NOT IN (SELECT id FROM blocked))
       AND (r.user_id = v_me OR v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT id FROM followed))
       AND NOT public.chat_has_blocked(rp.author_user_id, r.user_id)
       AND NOT public.chat_has_blocked(r.user_id, rp.author_user_id)
       AND public.community_is_member(r.user_id)
  ),
  bumped AS (SELECT sr.post_id, max(sr.created_at) AS at FROM seen_reposts sr GROUP BY sr.post_id),
  -- Following only: posts someone you follow is a collaborator on (the app's `collaborators`)
  followed_collabs AS (
    SELECT DISTINCT m.post_id
      FROM public.community_post_mentions m
     WHERE v_following
       AND m.removed_at IS NULL
       AND m.user_id IN (SELECT id FROM followed)
       AND m.user_id = ANY (public.community_post_collab_ids(m.post_id))
  ),
  cand AS (
    SELECT p.id, p.author_user_id, p.series, greatest(p.created_at, coalesce(b.at, p.created_at)) AS at
      FROM public.community_posts p
      LEFT JOIN bumped b ON b.post_id = p.id
     WHERE (p.visibility = 'community'
            OR (p.visibility = 'coach' AND p.author_user_id <> uid AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
            OR (p.visibility = 'followers' AND (p.author_user_id = uid OR v_staff OR p.author_user_id IN (SELECT id FROM followed)))
            OR (p.visibility = 'close_friends' AND (p.author_user_id = uid OR v_staff
                                                    OR p.author_user_id IN (SELECT public.community_close_friend_authors()))))
       AND p.archived_at IS NULL
       AND NOT p.story_only
       AND NOT coalesce(p.auto_shared, false)
       AND (v_staff OR p.author_user_id NOT IN (SELECT id FROM blocked))
       AND NOT EXISTS (SELECT 1 FROM public.community_reports rr
                        WHERE rr.reporter_id = uid AND rr.target_kind = 'post' AND rr.target_id = p.id)
       -- Following: people's own posts (no automated ones), yours, someone you follow's, a collab
       -- with them, or reposted by you or them
       AND (NOT v_following
            OR (p.series IS NULL AND p.series_data -> 'birthday' IS NULL
                AND (p.author_user_id IN (uid, v_me)
                     OR p.author_user_id IN (SELECT id FROM followed)
                     OR p.id IN (SELECT post_id FROM followed_collabs)
                     OR p.id IN (SELECT sr.post_id FROM seen_reposts sr
                                  WHERE sr.user_id = v_me OR sr.user_id IN (SELECT id FROM followed)))))
  ),
  marked AS (
    SELECT c.*,
           CASE WHEN c.author_user_id IN (uid, v_me) THEN c.at > v_seen - interval '12 hours'
                ELSE c.at > v_seen - interval '7 days'
                     AND NOT EXISTS (SELECT 1 FROM public.community_post_views v
                                      WHERE v.post_id = c.id AND v.viewer_user_id = v_me AND v.viewed_at < v_seen)
           END AS fresh
      FROM cand c
  ),
  scored AS (
    SELECT m.id, m.at, m.fresh, m.author_user_id,
           CASE WHEN m.fresh THEN round((
               - greatest(extract(epoch FROM (v_seen - m.at)), 0) / 86400.0
               + CASE WHEN m.author_user_id IN (uid, v_me) THEN 3 ELSE 0 END
               + CASE WHEN m.series IS NULL THEN 1 ELSE 0 END
               + CASE WHEN m.series IS NULL AND m.author_user_id NOT IN (uid, v_me)
                           AND (m.author_user_id IN (SELECT id FROM followed) OR m.author_user_id IN (SELECT id FROM fans)) THEN 1 ELSE 0 END
               + CASE WHEN m.series IN ('wednesday_wins', 'sunday_recap') THEN 0.5 WHEN m.series = 'daily_visual' THEN 0.25 ELSE 0 END
               + 0.4 * ln(1
                   + (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r
                       WHERE r.post_id = m.id AND r.created_at < v_seen AND r.user_id NOT IN (uid, v_me))
                   + 2 * (SELECT count(*) FROM public.community_comments cm
                           WHERE cm.post_id = m.id AND cm.hidden_at IS NULL AND cm.created_at < v_seen AND cm.author_user_id NOT IN (uid, v_me)))
             )::numeric, 4) END AS score
      FROM marked m
  ),
  phase AS (
    SELECT CASE WHEN v_phase = 'fresh' AND _cursor IS NULL AND NOT EXISTS (SELECT 1 FROM scored WHERE fresh) THEN 'rest' ELSE v_phase END AS ph
  ),
  pick AS (
    SELECT s.*, ph.ph FROM scored s CROSS JOIN phase ph
     WHERE CASE WHEN ph.ph = 'fresh' THEN s.fresh AND (v_score IS NULL OR (s.score, s.id) < (v_score, v_id))
                ELSE NOT s.fresh AND (v_at IS NULL OR (s.at, s.id) < (v_at, v_id)) END
     ORDER BY CASE WHEN ph.ph = 'fresh' THEN s.score END DESC NULLS LAST,
              CASE WHEN ph.ph = 'rest' THEN s.at END DESC NULLS LAST,
              s.id DESC
     LIMIT lim + 1
  )
  SELECT (SELECT count(*) FROM scored WHERE fresh),
         EXISTS (SELECT 1 FROM scored WHERE NOT fresh),
         (SELECT jsonb_agg(jsonb_build_object('id', k.id, 'at', k.at, 'fresh', k.fresh, 'score', k.score, 'author', k.author_user_id, 'phase', k.ph)
                           ORDER BY CASE WHEN k.ph = 'fresh' THEN k.score END DESC NULLS LAST,
                                    CASE WHEN k.ph = 'rest' THEN k.at END DESC NULLS LAST, k.id DESC)
            FROM pick k)
    INTO v_fresh_total, v_rest, v_rows;

  v_n := coalesce(jsonb_array_length(v_rows), 0);
  IF v_n > lim THEN
    v_last := v_rows->(lim - 1);
    v_next := CASE WHEN v_last->>'phase' = 'fresh'
                   THEN jsonb_build_object('phase', 'fresh', 'seen_before', v_seen, 'score', v_last->'score', 'id', v_last->'id')
                   ELSE jsonb_build_object('phase', 'rest', 'seen_before', v_seen, 'at', v_last->'at', 'id', v_last->'id') END;
  ELSIF coalesce(v_rows->0->>'phase', v_phase) = 'fresh' AND v_rest THEN
    v_next := jsonb_build_object('phase', 'rest', 'seen_before', v_seen);
  END IF;

  RETURN jsonb_build_object(
    'posts', coalesce((
      SELECT jsonb_agg(public.community_post_json((e->>'id')::uuid, uid)
                       || jsonb_build_object(
                            'feed_at', e->'at',
                            'fresh', e->'fresh',
                            'reposted_by', (SELECT jsonb_agg(public.community_author(x.user_id)
                                                             || jsonb_build_object('note', x.note, 'at', x.created_at, 'is_me', x.user_id = v_me)
                                                             ORDER BY x.rk, x.created_at DESC)
                                              FROM (SELECT r.user_id, r.note, r.created_at,
                                                           CASE WHEN r.user_id IN (SELECT public.community_followed_authors()) THEN 0 WHEN r.user_id = v_me THEN 1 ELSE 2 END AS rk
                                                      FROM public.community_reposts r
                                                      LEFT JOIN public.community_profiles cp ON cp.user_id = r.user_id
                                                     WHERE r.post_id = (e->>'id')::uuid
                                                       AND (v_staff OR r.user_id NOT IN (SELECT public.community_blocked_authors()))
                                                       AND (r.user_id = v_me OR v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT public.community_followed_authors()))
                                                       AND NOT public.chat_has_blocked((e->>'author')::uuid, r.user_id)
                                                       AND NOT public.chat_has_blocked(r.user_id, (e->>'author')::uuid)
                                                       AND public.community_is_member(r.user_id)
                                                     ORDER BY rk, r.created_at DESC LIMIT 3) x),
                            'reposters_count', (SELECT count(*) FROM public.community_reposts r
                                                  LEFT JOIN public.community_profiles cp ON cp.user_id = r.user_id
                                                 WHERE r.post_id = (e->>'id')::uuid
                                                   AND (v_staff OR r.user_id NOT IN (SELECT public.community_blocked_authors()))
                                                   AND (r.user_id = v_me OR v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT public.community_followed_authors()))
                                                   AND NOT public.chat_has_blocked((e->>'author')::uuid, r.user_id)
                                                   AND NOT public.chat_has_blocked(r.user_id, (e->>'author')::uuid)
                                                   AND public.community_is_member(r.user_id)))
                       ORDER BY t.n)
        FROM jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) WITH ORDINALITY t(e, n)
       WHERE t.n <= lim), '[]'::jsonb),
    'has_more', v_next IS NOT NULL,
    'cursor', v_next,
    'seen_before', v_seen,
    'fresh_total', CASE WHEN _cursor IS NULL THEN v_fresh_total END);
END;
$$;

SELECT public.rls_evaluate_once('community_reports');
SELECT public.rls_evaluate_once('community_moderation_settings');
SELECT public.rls_evaluate_once('community_rules_acceptances');
SELECT public.rls_evaluate_once('community_member_sanctions');
SELECT public.rls_evaluate_once('community_moderation_actions');
