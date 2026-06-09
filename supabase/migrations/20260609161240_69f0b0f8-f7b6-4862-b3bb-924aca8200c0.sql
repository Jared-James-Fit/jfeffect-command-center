
-- App settings: ensure chat defaults rows exist (insert via app, no schema change needed beyond existing table)
-- Chat GIFs library
CREATE TABLE public.chat_gifs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  media_url text NOT NULL,
  media_type text NOT NULL DEFAULT 'image/gif',
  thumb_url text,
  is_featured boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.chat_gifs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_gifs TO authenticated;
GRANT ALL ON public.chat_gifs TO service_role;
ALTER TABLE public.chat_gifs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view active gifs"
  ON public.chat_gifs FOR SELECT TO authenticated
  USING (active = true AND archived = false);
CREATE POLICY "Admins/coaches manage gifs"
  ON public.chat_gifs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'coach'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'coach'));

CREATE TRIGGER chat_gifs_updated_at BEFORE UPDATE ON public.chat_gifs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX chat_gifs_category_idx ON public.chat_gifs(category) WHERE active AND NOT archived;

-- Per-user favorites
CREATE TABLE public.chat_gif_favorites (
  user_id uuid NOT NULL,
  gif_id uuid NOT NULL REFERENCES public.chat_gifs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gif_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_gif_favorites TO authenticated;
GRANT ALL ON public.chat_gif_favorites TO service_role;
ALTER TABLE public.chat_gif_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own gif favorites"
  ON public.chat_gif_favorites FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Per-user recent
CREATE TABLE public.chat_gif_recent (
  user_id uuid NOT NULL,
  gif_id uuid NOT NULL REFERENCES public.chat_gifs(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gif_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_gif_recent TO authenticated;
GRANT ALL ON public.chat_gif_recent TO service_role;
ALTER TABLE public.chat_gif_recent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own gif recents"
  ON public.chat_gif_recent FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Seed default chat reaction and permission settings (uses existing app_settings(key,value))
INSERT INTO public.app_settings(key, value) VALUES
  ('chat_default_reaction', '✅'),
  ('chat_gifs_clients_send', 'true'),
  ('chat_gifs_app_members_send', 'false'),
  ('chat_gifs_program_members_send', 'false')
ON CONFLICT (key) DO NOTHING;

-- Starter library (curated public Giphy/Tenor)
INSERT INTO public.chat_gifs (title, category, tags, media_url, media_type, is_featured, sort_order) VALUES
  ('Fire', 'Hype', ARRAY['fire','hype','lit'], 'https://media.tenor.com/cYHihP-1FBQAAAAi/fire-emoji.gif', 'image/gif', true, 1),
  ('Let''s Go', 'Hype', ARRAY['lets go','hype','energy'], 'https://media.tenor.com/UqgkpgGuLuoAAAAi/lets-go.gif', 'image/gif', true, 2),
  ('Locked In', 'Hype', ARRAY['locked in','focused'], 'https://media.tenor.com/wjs_C4kw3hMAAAAi/locked-in-focus.gif', 'image/gif', false, 3),
  ('Big Energy', 'Hype', ARRAY['energy','hype'], 'https://media.tenor.com/zMxLI7AYW2YAAAAi/excited-yes.gif', 'image/gif', false, 4),
  ('PR Celebration', 'PR / Wins', ARRAY['pr','win','celebrate'], 'https://media.tenor.com/iHFHFqAXxIIAAAAi/yes-celebrate.gif', 'image/gif', true, 1),
  ('Trophy', 'PR / Wins', ARRAY['trophy','win'], 'https://media.tenor.com/ZsbSnZBT-fEAAAAi/winner-trophy.gif', 'image/gif', false, 2),
  ('Strong Work', 'PR / Wins', ARRAY['strong','great work'], 'https://media.tenor.com/RD79YAOC-RsAAAAi/strong-flex.gif', 'image/gif', false, 3),
  ('Reviewed', 'Reviewed', ARRAY['reviewed','checked','done'], 'https://media.tenor.com/PvFGRb4HfTEAAAAi/check-mark.gif', 'image/gif', true, 1),
  ('Approved', 'Reviewed', ARRAY['approved','stamp'], 'https://media.tenor.com/JxXpZHJyL30AAAAi/approved-stamp.gif', 'image/gif', false, 2),
  ('Clap', 'Support', ARRAY['clap','support'], 'https://media.tenor.com/I0CWqDe7jHwAAAAi/clap-applause.gif', 'image/gif', true, 1),
  ('Proud', 'Support', ARRAY['proud','support'], 'https://media.tenor.com/UQfV7BSlpaYAAAAi/proud-of-you.gif', 'image/gif', false, 2),
  ('Keep Going', 'Support', ARRAY['keep going','motivate'], 'https://media.tenor.com/HBhPpqWHm8MAAAAi/keep-going-you-got-this.gif', 'image/gif', false, 3),
  ('Confetti', 'Celebration', ARRAY['confetti','celebrate'], 'https://media.tenor.com/UFiE2-A6q4UAAAAi/confetti-celebrate.gif', 'image/gif', true, 1),
  ('Party', 'Celebration', ARRAY['party','celebrate'], 'https://media.tenor.com/aAd44wcytScAAAAi/party-time-confetti.gif', 'image/gif', false, 2),
  ('LOL', 'Funny', ARRAY['lol','funny','laugh'], 'https://media.tenor.com/yxFy3OGuq14AAAAi/lol-laughing.gif', 'image/gif', true, 1),
  ('Crying Laughing', 'Funny', ARRAY['laugh','funny'], 'https://media.tenor.com/k0KbvAd7zCAAAAAi/laugh-crying.gif', 'image/gif', false, 2),
  ('Dead', 'Gym Pain', ARRAY['gym pain','dead','cooked'], 'https://media.tenor.com/IBzCDxqOWLEAAAAi/exhausted-tired.gif', 'image/gif', true, 1),
  ('Leg Day Pain', 'Gym Pain', ARRAY['leg day','pain'], 'https://media.tenor.com/qhWj2T8tBpAAAAAi/leg-day-pain.gif', 'image/gif', false, 2),
  ('Everything Hurts', 'Gym Pain', ARRAY['hurts','sore'], 'https://media.tenor.com/SwDR5sgIkAEAAAAi/pain-sore.gif', 'image/gif', false, 3),
  ('Cardio Suffering', 'Cardio', ARRAY['cardio','suffering'], 'https://media.tenor.com/yIuhtsXi-Y8AAAAi/treadmill-tired.gif', 'image/gif', true, 1),
  ('Dying On Treadmill', 'Cardio', ARRAY['cardio','treadmill'], 'https://media.tenor.com/IcOM4u1H8YkAAAAi/cardio-tired.gif', 'image/gif', false, 2),
  ('I Forgot', 'Excuses', ARRAY['excuse','forgot'], 'https://media.tenor.com/D0EhdvKpe7gAAAAi/i-forgot.gif', 'image/gif', true, 1),
  ('I Was Busy', 'Excuses', ARRAY['excuse','busy'], 'https://media.tenor.com/UeAuxJ-FZA8AAAAi/busy.gif', 'image/gif', false, 2),
  ('Sure Jan', 'Excuses', ARRAY['sure jan','doubt'], 'https://media.tenor.com/yJVHb5wfNqcAAAAi/sure-jan-brady-bunch.gif', 'image/gif', false, 3),
  ('Side Eye', 'Coach Reactions', ARRAY['side eye','suspicious'], 'https://media.tenor.com/Q8Xkdh-OvP4AAAAi/side-eye-suspicious.gif', 'image/gif', true, 1),
  ('Be Serious', 'Coach Reactions', ARRAY['serious','focus'], 'https://media.tenor.com/JmZ4lXkU8u8AAAAi/be-serious.gif', 'image/gif', false, 2),
  ('Thinking', 'Coach Reactions', ARRAY['thinking','hmm'], 'https://media.tenor.com/7tszWyx1Wb4AAAAi/thinking-hmm.gif', 'image/gif', false, 3),
  ('Starving', 'Food / Diet', ARRAY['food','hungry','starving'], 'https://media.tenor.com/o0HHQDYAFhsAAAAi/hungry-starving.gif', 'image/gif', true, 1),
  ('Chicken & Rice Again', 'Food / Diet', ARRAY['diet','meal prep'], 'https://media.tenor.com/qxFvm-zkDxAAAAAi/meal-prep.gif', 'image/gif', false, 2),
  ('Zombie Mode', 'Deload / Dead', ARRAY['tired','dead','zombie'], 'https://media.tenor.com/hLI13_3rGN0AAAAi/zombie-tired.gif', 'image/gif', false, 1);
