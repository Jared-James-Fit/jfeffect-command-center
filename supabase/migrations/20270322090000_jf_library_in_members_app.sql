-- The 15 JF Effect library programs (the 12 strength / physique / at-home
-- programs and the 3 running programs) go into the members' app, Nov 14 2026,
-- the coach's call ("list all 15"). Exactly what Programs → ⋯ → Membership
-- app → Add for members writes (upsertLibraryListing + publishLibraryListing):
-- a live, published listing every member with access sees (audience
-- all_active, free members included), the program as it is now as its
-- published payload, and an audit row. No pl_template_shares row: the library
-- reads listings (#952), and that table's unique key is a partial expression
-- index the app's own share upsert never matches.
--
-- Insert-if-absent by template: a program already listed (or listed, edited
-- and taken out by the coach) is never touched, so re-running adds nothing.
--
-- days_per_week is the core workouts a week (listingDaysPerWeek, core-days.ts):
-- an optional day (Elite Powerlifting's recovery day, the running programs'
-- extra easy runs) goes on a free day around them, so a member picks 3 days
-- for Distance Builder, not 5. workouts_total counts every block's workouts
-- (countPayloadWorkouts), optional ones included.

WITH t AS (
  SELECT id, name, description, training_style, goal, training_focus, tags, est_duration_min, weeks, payload, payload_revision
  FROM public.pl_templates
  WHERE id IN (
    '642972ad-d197-51d1-b272-85f37b3b0911', -- Strength Foundation
    '10791be4-dd5b-5183-b724-75d750971b25', -- Strength Development
    '4df8c2ce-476e-5a99-9550-6244dd931111', -- Elite Powerlifting
    '2f3cbdab-36f4-5e9b-b491-a4fcfe496a81', -- Muscle Foundation
    'ce5ba49b-7172-59dd-8623-879c00872982', -- Muscle & Strength
    '2c6afad5-83b8-5197-a9e4-0cbaae09442c', -- Physique Specialization
    '7dcc2281-fcf3-51ac-ae3f-6cfcb559ea6a', -- Fitness Foundation
    'f6125bc9-966d-5886-aed6-b35123edc9ba', -- Glute & Physique Builder
    'f75d80f5-2a09-562a-9c9c-bbdbb55b9261', -- Advanced Physique
    '0d6dc03d-cd4f-5ab1-9e53-f1cfeda2232e', -- Bodyweight Foundation
    '9ef5e4b4-ac6f-5fad-b51f-d3390cc999e9', -- Dumbbell Muscle Builder
    '967ca531-3098-5501-b3b7-9c2c571d2c4c', -- At-Home Physique Builder
    '95bbbe24-052d-5f0e-ac70-2d5936332b83', -- Run Foundation
    '7c8f6059-fa93-5bbb-af11-f8312ac3b18d', -- Distance Builder
    '0801019d-2cb4-5a6a-8595-d7e73b1c7af4'  -- Marathon Performance
  )
    AND NOT EXISTS (SELECT 1 FROM public.member_plans mp WHERE mp.source_template_id = pl_templates.id)
),
wk AS (
  SELECT t.id, w
  FROM t
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.payload->'blocks_data', '[]'::jsonb)) b
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(b->'weeks_data', '[]'::jsonb)) w
  WHERE NOT COALESCE((b->>'archived')::boolean, false) AND NOT COALESCE((b->>'deleted')::boolean, false)
),
counts AS (
  SELECT id,
    max((SELECT count(*) FROM jsonb_array_elements(COALESCE(w->'days', '[]'::jsonb)) d
         WHERE NOT COALESCE((d->>'is_optional')::boolean, false)))::int AS core_days,
    sum(jsonb_array_length(COALESCE(w->'days', '[]'::jsonb)))::int AS workouts
  FROM wk GROUP BY id
),
ins AS (
  INSERT INTO public.member_plans (
    name, public_title, description, cover_image_url, difficulty, goal, training_style, tags, equipment_needed,
    est_minutes_per_workout, required_access_level, audience_mode, eligible_plan_ids, allow_full_program,
    allow_partial_imports, allow_pdf_download, notify_on_publish, change_notes, featured,
    weeks, days_per_week, workouts_total, source_template_id, published_payload,
    status, membership_status, published_version, last_published_version, published_by, published_at, created_by
  )
  SELECT
    -- "JF Effect | Run Foundation — Beginner — 3 days/week" → "Run Foundation"
    split_part(split_part(t.name, ' | ', 2), ' — ', 1),
    split_part(split_part(t.name, ' | ', 2), ' — ', 1),
    t.description,
    NULL,
    CASE
      WHEN 'Beginner' = ANY (t.tags) THEN 'Beginner'
      WHEN 'Intermediate' = ANY (t.tags) THEN 'Intermediate'
      WHEN 'Advanced' = ANY (t.tags) THEN 'Advanced'
      ELSE 'All Levels'
    END,
    COALESCE(t.goal, t.training_focus),
    COALESCE(t.training_style, 'custom'),
    COALESCE(t.tags, '{}'),
    '{}',
    t.est_duration_min,
    'app_membership',
    'all_active',
    '{}',
    true, false, true, false, NULL,
    -- the first program on a member's shelf: a beginner start in each kind
    t.id IN ('642972ad-d197-51d1-b272-85f37b3b0911', '2f3cbdab-36f4-5e9b-b491-a4fcfe496a81',
             '7dcc2281-fcf3-51ac-ae3f-6cfcb559ea6a', '95bbbe24-052d-5f0e-ac70-2d5936332b83'),
    COALESCE(t.weeks, 12),
    COALESCE(c.core_days, 3),
    COALESCE(c.workouts, 0),
    t.id,
    t.payload,
    'Published', 'live', 1, t.payload_revision,
    '0076110b-cd9c-4459-9ac4-42df8bee5ca5', now(), '0076110b-cd9c-4459-9ac4-42df8bee5ca5'
  FROM t JOIN counts c ON c.id = t.id
  RETURNING id
),
audit AS (
  INSERT INTO public.member_plan_audit (plan_id, action, version, actor_user_id)
  SELECT id, 'publish', 1, '0076110b-cd9c-4459-9ac4-42df8bee5ca5' FROM ins
  RETURNING plan_id
)
SELECT count(*) AS listed FROM audit;
