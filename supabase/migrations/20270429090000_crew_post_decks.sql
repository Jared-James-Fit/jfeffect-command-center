-- Crew's automated lesson and tip posts as decks (Nov 20 2026, post-decks.ts):
-- slides people swipe through, painted on the phone, and a caption of their own
-- (the coach's take, never the slides again). A deck rides on its library item
-- (`community_series_items.data.deck`) and on the post it became
-- (`community_posts.series_data.deck`); `community_post_json` hands it to the
-- app as `deck`. The publishers post a deck's caption with it, but only a deck
-- made from the words the item has now (`community_deck_current`: its `src`
-- is the sha256 of the item's body), so a lesson the coach rewrote never goes
-- out with slides about the old words. Decks are written in the background by
-- the `post-decks-tick` hook (post-decks.server.ts, OpenAI key only), one job
-- per row of `community_post_decks` (server only; staff can read them).

-- ---------------------------------------------------------------------------
-- A deck that still matches its item's words, or null
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.community_deck_current(_body text, _data jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN _data ? 'deck'
     AND jsonb_typeof(_data->'deck'->'slides') = 'array'
     AND jsonb_array_length(_data->'deck'->'slides') > 0
     AND coalesce(btrim(_data->'deck'->>'caption'), '') <> ''
     AND _data->'deck'->>'src' = encode(sha256(convert_to(coalesce(_body, ''), 'UTF8')), 'hex')
    THEN _data->'deck'
  END
$$;

-- ---------------------------------------------------------------------------
-- The jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_post_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES public.community_series_items(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.community_posts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'review', 'done', 'failed', 'skipped')),
  -- a dry run: the deck is kept on the job (`result`, status 'review') until community_post_deck_apply puts it on
  dry boolean NOT NULL DEFAULT false,
  priority int NOT NULL DEFAULT 100,
  attempts int NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  error text,
  -- every draft's problems and the editor's read, the model that wrote it
  problems jsonb,
  model text,
  -- the closest a failed job got (for the coach to see), and what a post had before (to put back)
  best jsonb,
  result jsonb,
  before jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (item_id IS NOT NULL OR post_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS community_post_decks_item ON public.community_post_decks (item_id) WHERE post_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_post_decks_post ON public.community_post_decks (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_post_decks_due ON public.community_post_decks (status, priority, created_at);

ALTER TABLE public.community_post_decks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_post_decks FROM anon, authenticated;
GRANT SELECT ON public.community_post_decks TO authenticated;
DROP POLICY IF EXISTS "Staff read deck jobs" ON public.community_post_decks;
CREATE POLICY "Staff read deck jobs" ON public.community_post_decks FOR SELECT TO authenticated
  USING ((SELECT public.is_community_staff()));

-- ---------------------------------------------------------------------------
-- What needs a deck: posts already out first, then the lessons planned soonest,
-- the Tuesday tips still to come, then the rest of the lesson library
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.community_post_decks_enqueue()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_n int := 0;
  v_k int;
  v_today date := (public.instant_to_local(now(), 'America/Winnipeg'))::date;
BEGIN
  -- the lessons planned in the next four weeks, the soonest first
  INSERT INTO public.community_post_decks (item_id, priority)
  SELECT DISTINCT ON (i.id) i.id, 10 + (pl.day - v_today)
    FROM public.community_lesson_plan pl
    JOIN public.community_series_items i ON i.id = pl.item_id
   WHERE pl.status IN ('planned', 'approved')
     AND pl.day BETWEEN v_today AND v_today + 28
     AND public.community_deck_current(i.body, i.data) IS NULL
   ORDER BY i.id, pl.day
  ON CONFLICT (item_id) WHERE post_id IS NULL DO NOTHING;
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;

  -- the Tuesday tips still to come
  INSERT INTO public.community_post_decks (item_id, priority)
  SELECT i.id, 40 FROM public.community_series_items i
   WHERE i.series = 'tuesday_tips' AND i.active AND i.use_count = 0
     AND public.community_deck_current(i.body, i.data) IS NULL
  ON CONFLICT (item_id) WHERE post_id IS NULL DO NOTHING;
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;

  -- the rest of the lesson library, in the background
  INSERT INTO public.community_post_decks (item_id, priority)
  SELECT i.id, 100 FROM public.community_series_items i
   WHERE i.series = 'lesson' AND i.active AND i.use_count = 0
     AND public.community_deck_current(i.body, i.data) IS NULL
  ON CONFLICT (item_id) WHERE post_id IS NULL DO NOTHING;
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;

  -- an item whose words changed since its deck was made: made again
  UPDATE public.community_post_decks j
     SET status = 'pending', attempts = 0, error = NULL, run_after = now(), updated_at = now()
    FROM public.community_series_items i
   WHERE j.item_id = i.id AND j.post_id IS NULL AND j.status IN ('done', 'skipped')
     AND i.use_count = 0 AND i.data ? 'deck'
     AND public.community_deck_current(i.body, i.data) IS NULL;
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  RETURN v_n;
END;
$$;

-- Wake the writer while something's due, at most three at once.
CREATE OR REPLACE FUNCTION public.community_post_decks_kick()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.community_post_decks WHERE status = 'pending' AND run_after <= now()) THEN RETURN false; END IF;
  IF (SELECT count(*) FROM public.community_post_decks WHERE status = 'running' AND claimed_at > now() - interval '12 minutes') >= 3 THEN RETURN false; END IF;
  PERFORM net.http_post(
    url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/post-decks-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.community_post_decks_enqueue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_post_decks_kick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_post_decks_enqueue() TO service_role;
GRANT EXECUTE ON FUNCTION public.community_post_decks_kick() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('community-post-decks') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'community-post-decks');
  PERFORM cron.schedule('community-post-decks', '*/10 * * * *', 'select public.community_post_decks_enqueue(); select public.community_post_decks_kick();');
END $$;

-- ---------------------------------------------------------------------------
-- The posts already out: each gets its deck in place (same id, date, likes,
-- comments and views), but only one whose caption is still the library's
-- (the job checks that again before it writes)
-- ---------------------------------------------------------------------------
INSERT INTO public.community_post_decks (post_id, item_id, priority, dry)
SELECT p.id, p.series_item_id, 0, true
  FROM public.community_posts p
 WHERE p.series IN ('lesson', 'tuesday_tips', 'monday_motivation', 'finish_strong_friday')
   AND p.series_item_id IS NOT NULL
   AND p.archived_at IS NULL
   AND coalesce(p.story_only, false) = false
   AND p.edited_at IS NULL
ON CONFLICT (post_id) WHERE post_id IS NOT NULL DO NOTHING;

-- A deck read and approved: onto its post in place (same id, date, likes,
-- comments and views; only its caption and slides, and only while the post
-- still has the caption the deck was made from and the coach hasn't edited it)
-- and onto its library item. The service role only.
CREATE OR REPLACE FUNCTION public.community_post_deck_apply(_job uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j public.community_post_decks%ROWTYPE;
  v_n int;
BEGIN
  SELECT * INTO j FROM public.community_post_decks WHERE id = _job FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF j.status <> 'review' OR j.result IS NULL THEN RETURN 'not ready'; END IF;
  IF j.post_id IS NOT NULL THEN
    UPDATE public.community_posts
       SET caption = j.result->>'caption',
           series_data = coalesce(series_data, '{}'::jsonb) || jsonb_build_object('deck', j.result)
     WHERE id = j.post_id AND edited_at IS NULL AND caption IS NOT DISTINCT FROM j.before->>'caption';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      UPDATE public.community_post_decks SET status = 'skipped', error = 'The post changed since its deck was made', updated_at = now() WHERE id = j.id;
      RETURN 'changed';
    END IF;
  END IF;
  IF j.item_id IS NOT NULL THEN
    UPDATE public.community_series_items SET data = coalesce(data, '{}'::jsonb) || jsonb_build_object('deck', j.result), updated_at = now() WHERE id = j.item_id;
  END IF;
  UPDATE public.community_post_decks SET status = 'done', updated_at = now() WHERE id = j.id;
  RETURN 'applied';
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_deck_apply(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_post_deck_apply(uuid) TO service_role;

-- And back: a post's caption and series data as they were before its deck.
CREATE OR REPLACE FUNCTION public.community_post_deck_undo(_job uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j public.community_post_decks%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.community_post_decks WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR j.before IS NULL OR j.post_id IS NULL THEN RETURN 'nothing to put back'; END IF;
  UPDATE public.community_posts SET caption = j.before->>'caption', series_data = j.before->'series_data'
   WHERE id = j.post_id AND edited_at IS NULL AND caption IS NOT DISTINCT FROM j.result->>'caption';
  UPDATE public.community_post_decks SET status = 'skipped', error = 'Put back', updated_at = now() WHERE id = j.id;
  RETURN 'put back';
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_deck_undo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_post_deck_undo(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- The app reads a post's deck as `deck`; the publishers post one with its own caption
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.patch_fn(_sig text, _pairs text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d text := pg_get_functiondef(_sig::regprocedure);
  i int;
BEGIN
  FOR i IN 1 .. array_length(_pairs, 1) / 2 LOOP
    IF position(_pairs[2 * i] IN d) > 0 THEN
      CONTINUE; -- already applied
    END IF;
    IF position(_pairs[2 * i - 1] IN d) = 0 THEN
      RAISE EXCEPTION '% : fragment % not found', _sig, i;
    END IF;
    d := replace(d, _pairs[2 * i - 1], _pairs[2 * i]);
  END LOOP;
  EXECUTE d;
END $$;

SELECT pg_temp.patch_fn('public.community_post_json(uuid, uuid)', ARRAY[
$old$  SELECT jsonb_build_object('media_focus', n.media_focus, 'story', n.story_only) || jsonb_build_object($old$,
$new$  SELECT jsonb_build_object('media_focus', n.media_focus, 'story', n.story_only,
                            'deck', CASE WHEN n.series IS NOT NULL THEN n.series_data->'deck' END) || jsonb_build_object($new$
]);

SELECT pg_temp.patch_fn('public.community_lesson_post(uuid, boolean)', ARRAY[
$old$  v_media jsonb;
BEGIN$old$,
$new$  v_media jsonb;
  v_deck jsonb;
BEGIN$new$,
$old$  IF NOT FOUND THEN RAISE EXCEPTION 'No lesson picked for this day'; END IF;$old$,
$new$  IF NOT FOUND THEN RAISE EXCEPTION 'No lesson picked for this day'; END IF;
  -- its deck, while it's still about the words the lesson has now
  v_deck := public.community_deck_current(v_item.body, v_item.data);$new$,
$old$          coalesce(r.body, v_item.body), 'lesson', v_key, v_item.id,$old$,
$new$          coalesce(r.body, v_deck->>'caption', v_item.body), 'lesson', v_key, v_item.id,$new$,
$old$            'visual', v_item.data->'visual', 'refs', v_item.data->'refs')),$old$,
$new$            'visual', v_item.data->'visual', 'refs', v_item.data->'refs', 'deck', v_deck)),$new$
]);

SELECT pg_temp.patch_fn('public.community_publish_series(text, boolean, timestamp with time zone)', ARRAY[
$old$  v_caption := v_item.body;
  v_data := v_item.data;$old$,
$new$  -- a deck's own caption goes out with its slides, while the deck is still about these words
  v_caption := coalesce(public.community_deck_current(v_item.body, v_item.data)->>'caption', v_item.body);
  v_data := CASE WHEN public.community_deck_current(v_item.body, v_item.data) IS NULL THEN v_item.data - 'deck' ELSE v_item.data END;$new$
]);

-- the coach's lesson planner shows a lesson's slides (and the caption they go out with)
SELECT pg_temp.patch_fn('public.community_lesson_item_json(public.community_series_items)', ARRAY[
$old$'story', _i.data->'story', 'media', _i.media)$old$,
$new$'story', _i.data->'story', 'media', _i.media,
    'deck', public.community_deck_current(_i.body, _i.data))$new$
]);

SELECT public.rls_evaluate_once('community_post_decks');
