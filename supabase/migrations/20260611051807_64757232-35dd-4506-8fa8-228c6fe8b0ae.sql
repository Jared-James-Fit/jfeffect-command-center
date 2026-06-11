
CREATE TABLE public.setup_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  video_embed_url text,
  video_url text,
  link_url text,
  link_label text,
  ios_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  android_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  audience_scope text NOT NULL DEFAULT 'everyone',
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.setup_prompts TO authenticated;
GRANT ALL ON public.setup_prompts TO service_role;
ALTER TABLE public.setup_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "setup_prompts read enabled" ON public.setup_prompts
  FOR SELECT TO authenticated USING (enabled = true OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "setup_prompts admin manage" ON public.setup_prompts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER tg_setup_prompts_updated_at BEFORE UPDATE ON public.setup_prompts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.setup_prompt_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid NOT NULL REFERENCES public.setup_prompts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'remind',
  remind_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.setup_prompt_dismissals TO authenticated;
GRANT ALL ON public.setup_prompt_dismissals TO service_role;
ALTER TABLE public.setup_prompt_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "setup_prompt_dismissals own" ON public.setup_prompt_dismissals
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER tg_setup_prompt_dismissals_updated_at BEFORE UPDATE ON public.setup_prompt_dismissals
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.setup_prompts (title, body, video_embed_url, video_url, ios_steps, android_steps, audience_scope, enabled, sort_order)
VALUES (
  'Add JF Effect to Your Home Screen',
  'Save the app to your home screen so you can open it like any other app — faster and full-screen.',
  'https://www.youtube.com/embed/jDOH1oJuWrc',
  'https://youtu.be/jDOH1oJuWrc',
  '["Tap the Share button in Safari.","Tap Add to Home Screen.","Tap Add in the top right — done."]'::jsonb,
  '["Tap the menu (⋮) in Chrome.","Tap Install app or Add to Home Screen.","Confirm — the app icon appears on your home screen."]'::jsonb,
  'everyone',
  true,
  0
);
