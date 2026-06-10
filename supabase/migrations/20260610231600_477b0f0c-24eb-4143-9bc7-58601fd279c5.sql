update public.sales_pages
set
  hero_image_url = '/__l5e/assets-v1/f969c963-8223-436d-9bd1-78813ca7bdbd/hero_join.jpg',
  visuals = '[
    {"slot":"app_preview","alt":"Workout Plans","url":"/__l5e/assets-v1/110ffec8-e5e8-4cd9-8b83-c0c07ffc1f16/preview_workouts.jpg","visible":true},
    {"slot":"app_preview","alt":"Recipes","url":"/__l5e/assets-v1/f1ff9399-1fda-40ae-ae3c-eb4b177c680c/preview_recipes.jpg","visible":true},
    {"slot":"app_preview","alt":"Exercise Library","url":"/__l5e/assets-v1/12f42b2f-6ed4-4d74-9771-44d5761ea352/preview_exercises.jpg","visible":true},
    {"slot":"app_preview","alt":"Progress Tracking","url":"/__l5e/assets-v1/151fdf50-8ad8-483a-964c-bb29f9d8b797/preview_progress.jpg","visible":true}
  ]'::jsonb,
  published = true,
  updated_at = now()
where page_key = 'join';

update public.sales_pages
set
  hero_image_url = '/__l5e/assets-v1/aa1a08a1-b023-4cc1-90cc-9e7860b19f59/hero_coaching.jpg',
  visuals = '[
    {"slot":"app_preview","alt":"Training Plan","url":"/__l5e/assets-v1/110ffec8-e5e8-4cd9-8b83-c0c07ffc1f16/preview_workouts.jpg","visible":true},
    {"slot":"app_preview","alt":"Check-Ins","url":"/__l5e/assets-v1/d928daf5-5487-4a4a-b7b4-a88a17189ba4/preview_checkins.jpg","visible":true},
    {"slot":"app_preview","alt":"Messaging","url":"/__l5e/assets-v1/e82e0949-d353-4ccd-8299-2be1227ed518/preview_messaging.jpg","visible":true},
    {"slot":"app_preview","alt":"Progress Tracking","url":"/__l5e/assets-v1/151fdf50-8ad8-483a-964c-bb29f9d8b797/preview_progress.jpg","visible":true}
  ]'::jsonb,
  published = true,
  updated_at = now()
where page_key = 'coaching';