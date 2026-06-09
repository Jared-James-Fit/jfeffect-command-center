
-- chat_sounds
CREATE TABLE public.chat_sounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL DEFAULT 'Hype',
  tags text[] NOT NULL DEFAULT '{}',
  media_url text NOT NULL,
  mime text NOT NULL DEFAULT 'audio/mpeg',
  duration_ms integer,
  is_featured boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_sounds TO authenticated;
GRANT ALL ON public.chat_sounds TO service_role;
ALTER TABLE public.chat_sounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone authed can view active sounds"
  ON public.chat_sounds FOR SELECT TO authenticated
  USING (active = true AND archived = false);
CREATE POLICY "admins/coaches manage sounds"
  ON public.chat_sounds FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role));
CREATE TRIGGER trg_chat_sounds_updated_at
  BEFORE UPDATE ON public.chat_sounds
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- chat_sound_favorites
CREATE TABLE public.chat_sound_favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sound_id uuid NOT NULL REFERENCES public.chat_sounds(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sound_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_sound_favorites TO authenticated;
GRANT ALL ON public.chat_sound_favorites TO service_role;
ALTER TABLE public.chat_sound_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own favorites" ON public.chat_sound_favorites FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- chat_sound_recent
CREATE TABLE public.chat_sound_recent (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sound_id uuid NOT NULL REFERENCES public.chat_sounds(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sound_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_sound_recent TO authenticated;
GRANT ALL ON public.chat_sound_recent TO service_role;
ALTER TABLE public.chat_sound_recent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recent" ON public.chat_sound_recent FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- App settings (sound permissions)
INSERT INTO public.app_settings(key, value) VALUES
  ('chat_sounds_clients_send','true'),
  ('chat_sounds_clients_play','true'),
  ('chat_sounds_app_members_send','false'),
  ('chat_sounds_program_members_send','false')
ON CONFLICT (key) DO NOTHING;

-- Seed starter sound library (royalty-free Mixkit short SFX)
INSERT INTO public.chat_sounds (title, category, tags, media_url, mime, duration_ms, is_featured, sort_order) VALUES
  ('Let''s Go',          'Hype',            ARRAY['hype','energy'],          'https://assets.mixkit.co/active_storage/sfx/2017/2017-preview.mp3', 'audio/mpeg', 1500, true, 10),
  ('Air Horn',           'Hype',            ARRAY['hype','horn'],            'https://assets.mixkit.co/active_storage/sfx/1565/1565-preview.mp3', 'audio/mpeg', 2000, true, 11),
  ('Crowd Cheer',        'Hype',            ARRAY['cheer','win'],            'https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3', 'audio/mpeg', 2500, false, 12),
  ('Fire',               'Hype',            ARRAY['fire','hot'],             'https://assets.mixkit.co/active_storage/sfx/1184/1184-preview.mp3', 'audio/mpeg', 2200, false, 13),
  ('Locked In',          'Hype',            ARRAY['lock','focus'],           'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3', 'audio/mpeg', 1500, false, 14),

  ('PR Bell',            'PR / Wins',       ARRAY['pr','bell','win'],        'https://assets.mixkit.co/active_storage/sfx/1992/1992-preview.mp3', 'audio/mpeg', 2200, true, 20),
  ('Victory',            'PR / Wins',       ARRAY['win','victory'],          'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3', 'audio/mpeg', 2500, true, 21),
  ('Level Up',           'PR / Wins',       ARRAY['win','levelup'],          'https://assets.mixkit.co/active_storage/sfx/2020/2020-preview.mp3', 'audio/mpeg', 2300, false, 22),
  ('Achievement',        'PR / Wins',       ARRAY['win','achieve'],          'https://assets.mixkit.co/active_storage/sfx/270/270-preview.mp3',   'audio/mpeg', 1500, false, 23),

  ('Bruh',               'Funny',           ARRAY['bruh','meme'],            'https://assets.mixkit.co/active_storage/sfx/2940/2940-preview.mp3', 'audio/mpeg', 800,  true, 30),
  ('Vine Boom',          'Funny',           ARRAY['boom','meme'],            'https://assets.mixkit.co/active_storage/sfx/2890/2890-preview.mp3', 'audio/mpeg', 1200, true, 31),
  ('Sad Trombone',       'Funny',           ARRAY['fail','trombone'],        'https://assets.mixkit.co/active_storage/sfx/2954/2954-preview.mp3', 'audio/mpeg', 2400, false, 32),
  ('Crickets',           'Funny',           ARRAY['silent','awkward'],       'https://assets.mixkit.co/active_storage/sfx/1185/1185-preview.mp3', 'audio/mpeg', 3000, false, 33),
  ('Mission Failed',     'Funny',           ARRAY['fail','mission'],         'https://assets.mixkit.co/active_storage/sfx/2032/2032-preview.mp3', 'audio/mpeg', 2000, false, 34),

  ('Reviewed',           'Coach Reactions', ARRAY['review','done'],          'https://assets.mixkit.co/active_storage/sfx/1862/1862-preview.mp3', 'audio/mpeg', 900,  true, 40),
  ('Good Rep',           'Coach Reactions', ARRAY['good','rep'],             'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3', 'audio/mpeg', 1500, false, 41),
  ('Fix This',           'Coach Reactions', ARRAY['fix','redo'],             'https://assets.mixkit.co/active_storage/sfx/2891/2891-preview.mp3', 'audio/mpeg', 1500, false, 42),
  ('Not Bad',            'Coach Reactions', ARRAY['ok','decent'],            'https://assets.mixkit.co/active_storage/sfx/2872/2872-preview.mp3', 'audio/mpeg', 1500, false, 43),
  ('We Need To Talk',    'Coach Reactions', ARRAY['serious','review'],       'https://assets.mixkit.co/active_storage/sfx/2873/2873-preview.mp3', 'audio/mpeg', 1500, false, 44),

  ('Cardio Suffering',   'Cardio',          ARRAY['cardio','pain'],          'https://assets.mixkit.co/active_storage/sfx/2581/2581-preview.mp3', 'audio/mpeg', 2500, true, 50),
  ('Heavy Breathing',    'Cardio',          ARRAY['breath','tired'],         'https://assets.mixkit.co/active_storage/sfx/2582/2582-preview.mp3', 'audio/mpeg', 2500, false, 51),

  ('Leg Day Walk',       'Gym Pain',        ARRAY['legs','pain'],            'https://assets.mixkit.co/active_storage/sfx/2583/2583-preview.mp3', 'audio/mpeg', 2500, true, 60),
  ('Dead Inside',        'Gym Pain',        ARRAY['dead','tired'],           'https://assets.mixkit.co/active_storage/sfx/2584/2584-preview.mp3', 'audio/mpeg', 2500, false, 61),
  ('Cooked',             'Gym Pain',        ARRAY['cooked','done'],          'https://assets.mixkit.co/active_storage/sfx/2585/2585-preview.mp3', 'audio/mpeg', 2200, false, 62);
