
-- =========================================================
-- sales_pages: CMS for public marketing pages
-- =========================================================
CREATE TABLE public.sales_pages (
  page_key             text PRIMARY KEY,
  published            boolean NOT NULL DEFAULT true,
  hero_headline        text NOT NULL DEFAULT '',
  hero_subheadline     text NOT NULL DEFAULT '',
  hero_image_url       text,
  primary_cta_label    text NOT NULL DEFAULT '',
  primary_cta_kind     text NOT NULL DEFAULT 'application',  -- checkout | application | booking | external | lead_form
  primary_cta_url      text,
  secondary_cta_label  text,
  secondary_cta_href   text,
  sections             jsonb NOT NULL DEFAULT '{}'::jsonb,
  visuals              jsonb NOT NULL DEFAULT '[]'::jsonb,
  testimonials         jsonb NOT NULL DEFAULT '[]'::jsonb,
  promo_message        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid
);

GRANT SELECT ON public.sales_pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_pages TO authenticated;
GRANT ALL ON public.sales_pages TO service_role;

ALTER TABLE public.sales_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_pages public read when published"
  ON public.sales_pages FOR SELECT
  USING (published = true);

CREATE POLICY "sales_pages admin read all"
  ON public.sales_pages FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sales_pages admin insert"
  ON public.sales_pages FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sales_pages admin update"
  ON public.sales_pages FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sales_pages admin delete"
  ON public.sales_pages FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER tg_sales_pages_updated_at
  BEFORE UPDATE ON public.sales_pages
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- coaching_applications: lead capture from /coaching/apply
-- =========================================================
CREATE TABLE public.coaching_applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  full_name         text NOT NULL,
  email             text NOT NULL,
  phone             text,
  goals             text,
  training_history  text,
  schedule          text,
  budget_range      text,
  timeline          text,
  source            text NOT NULL DEFAULT 'coaching_page',
  status            text NOT NULL DEFAULT 'New',  -- New | Contacted | Approved | Rejected
  notes_admin       text
);

GRANT INSERT ON public.coaching_applications TO anon;
GRANT INSERT ON public.coaching_applications TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.coaching_applications TO authenticated;
GRANT ALL ON public.coaching_applications TO service_role;

ALTER TABLE public.coaching_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_applications public insert"
  ON public.coaching_applications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "coaching_applications admin read"
  ON public.coaching_applications FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "coaching_applications admin update"
  ON public.coaching_applications FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "coaching_applications admin delete"
  ON public.coaching_applications FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER tg_coaching_applications_updated_at
  BEFORE UPDATE ON public.coaching_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX coaching_applications_status_idx
  ON public.coaching_applications(status, created_at DESC);

-- =========================================================
-- Seed: /join (JF Membership)
-- =========================================================
INSERT INTO public.sales_pages (
  page_key, published,
  hero_headline, hero_subheadline,
  primary_cta_label, primary_cta_kind,
  secondary_cta_label, secondary_cta_href,
  sections, promo_message
) VALUES (
  'join', true,
  'Train with the JF Effect system without full coaching.',
  'Get self-guided workout plans, tracking tools, exercise demos, recipes, nutrition resources, events, and member-only updates inside the JF Effect app.',
  'Start 3-Day Free Trial', 'checkout',
  'Apply for Coaching', '/coaching',
  jsonb_build_object(
    'features', jsonb_build_array(
      jsonb_build_object('title','Workout Plans','body','Self-guided plans you can follow at your pace.'),
      jsonb_build_object('title','Workout Tracking','body','Log sets, reps and weights with progress over time.'),
      jsonb_build_object('title','Exercise Library','body','Demos and cues for every exercise in your plan.'),
      jsonb_build_object('title','Recipes','body','Member recipe library with macros.'),
      jsonb_build_object('title','Nutrition Resources','body','Education to take the guess work out.'),
      jsonb_build_object('title','Events','body','Member-only events and challenges.'),
      jsonb_build_object('title','Progress Tracking','body','See your stats, lifts, and check-ins improve.'),
      jsonb_build_object('title','Member Updates','body','Announcements, drops, and member news.')
    ),
    'included', jsonb_build_array(
      'Self-guided workout plans','Workout tracking','Exercise library','Recipe library',
      'Nutrition resources','Resource library','Events','Announcements',
      'Progress tracking','Community / group chats'
    ),
    'not_included', jsonb_build_array(
      '1:1 coaching','Custom programming','Custom nutrition','Lift reviews',
      'Weekly check-ins','Direct coach feedback'
    ),
    'comparison', jsonb_build_object(
      'left',  jsonb_build_object('title','JF Membership','body','Best for self-guided training and resources.','cta_label','Join Membership','cta_href','#cta'),
      'right', jsonb_build_object('title','Private Coaching','body','Best for custom plans, accountability, feedback, and direct support.','cta_label','Apply for Coaching','cta_href','/coaching')
    ),
    'faq', jsonb_build_array(
      jsonb_build_object('q','What do I get with JF Membership?','a','Self-guided workout plans, tracking, exercise library, recipes, nutrition resources, events, and announcements.'),
      jsonb_build_object('q','Is this coaching?','a','No. Membership is self-guided. Private Coaching includes check-ins, custom programming, and direct coach feedback.'),
      jsonb_build_object('q','How does the free trial work?','a','3 days free, cancel anytime. Card is charged $29/month after the trial unless you cancel.'),
      jsonb_build_object('q','Can I cancel anytime?','a','Yes — manage your subscription from your account page anytime.'),
      jsonb_build_object('q','Do I get a profile and progress tracking?','a','Yes. Your account stores workouts, lifts, and progress over time.')
    )
  ),
  E'Join JF Membership here: https://jfeffect.com/join\n\nThis is for self-guided workout plans, tracking tools, recipes, resources, events, and member-only updates.'
)
ON CONFLICT (page_key) DO NOTHING;

-- =========================================================
-- Seed: /coaching (Private Coaching)
-- =========================================================
INSERT INTO public.sales_pages (
  page_key, published,
  hero_headline, hero_subheadline,
  primary_cta_label, primary_cta_kind,
  secondary_cta_label, secondary_cta_href,
  sections, promo_message
) VALUES (
  'coaching', true,
  'Private Coaching for people who are done guessing.',
  'Get structure, accountability, training, nutrition, check-ins, adjustments, and direct support inside the JF Effect coaching system.',
  'Apply for Coaching', 'lead_form',
  'Not ready for coaching? Join JF Membership', '/join',
  jsonb_build_object(
    'who_for', jsonb_build_array(
      'You want structure',
      'You want accountability',
      'You are tired of guessing',
      'You want a plan adjusted around real life',
      'You want coaching support',
      'You want training and nutrition organized',
      'You want someone watching the process'
    ),
    'included', jsonb_build_array(
      'Custom training program','Custom nutrition targets','Weekly check-ins','Coach feedback',
      'Plan adjustments','Progress tracking','Direct messaging','Lift review support if included',
      'Accountability','Goal planning','App access'
    ),
    'not_included', jsonb_build_array(
      'A random PDF program','A generic workout plan','A cheap app subscription',
      'Something you do halfway','For people who do not want accountability'
    ),
    'options', jsonb_build_array(
      jsonb_build_object('title','Coaching Plus','body','Full coaching system with training, nutrition, check-ins, plan adjustments, messaging, and accountability.','badge','Application Required','cta_label','Apply for Coaching'),
      jsonb_build_object('title','Private Coaching','body','Higher-access coaching with more direct support, faster planning help, and higher priority.','badge','Application Required','cta_label','Apply for Coaching')
    ),
    'how_it_works', jsonb_build_array(
      jsonb_build_object('step',1,'title','Apply for coaching','body','Tell us where you are and where you want to go.'),
      jsonb_build_object('step',2,'title','Fill out the application','body','Quick questions about training, nutrition, and schedule.'),
      jsonb_build_object('step',3,'title','Book a call or wait for approval','body','We make sure it''s a fit before we start.'),
      jsonb_build_object('step',4,'title','Get set up inside the app','body','Plan, tracking, check-ins, and direct messaging.'),
      jsonb_build_object('step',5,'title','Start executing the plan','body','Train. Check in. Adjust. Repeat.')
    ),
    'comparison', jsonb_build_object(
      'left',  jsonb_build_object('title','Private Coaching','body','Custom plan, check-ins, accountability, direct support.','cta_label','Apply for Coaching','cta_href','#cta'),
      'right', jsonb_build_object('title','JF Membership','body','Best for self-guided training and resources.','cta_label','Join Membership','cta_href','/join')
    ),
    'faq', jsonb_build_array(
      jsonb_build_object('q','Is coaching customized?','a','Yes. Coaching is built around your goals, schedule, training, nutrition, and progress.'),
      jsonb_build_object('q','Is this different from JF Membership?','a','Yes. JF Membership is self-guided. Private Coaching includes direct coaching, check-ins, and custom adjustments.'),
      jsonb_build_object('q','Do I get nutrition help?','a','Yes. Coaching can include nutrition targets, meal structure, and adjustments depending on your plan.'),
      jsonb_build_object('q','Do I get messaging?','a','Yes. Coaching includes direct support inside the app.'),
      jsonb_build_object('q','Can I start if I am busy?','a','Yes. The coaching system is built to create structure around real life.'),
      jsonb_build_object('q','How do I start?','a','Apply for coaching and follow the next steps.')
    ),
    'final_cta', jsonb_build_object(
      'headline','If you already know you need coaching, stop waiting.',
      'primary_label','Apply for Coaching',
      'secondary_label','Join JF Membership Instead',
      'secondary_href','/join'
    )
  ),
  E'Apply for JF Effect Coaching here: https://jfeffect.com/coaching\n\nThis is for people who want structure, accountability, training, nutrition, and direct coaching support.'
)
ON CONFLICT (page_key) DO NOTHING;
