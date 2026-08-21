UPDATE public.pl_scheduled_workouts sw
SET scheduled_date = v.new_date, updated_at = now()
FROM (VALUES
  ('def42109-ff17-40d1-bec5-d8820da46f51'::uuid, DATE '2026-08-21'),
  ('deac65ce-c9d0-4271-a8fc-0cb193e2dd79'::uuid, DATE '2026-08-24'),
  ('10868ab4-cfe8-4428-906f-a12c7162d50d'::uuid, DATE '2026-08-25'),
  ('7cefb990-dd07-4092-a8e6-de8cec1225d1'::uuid, DATE '2026-08-27'),
  ('00e17261-e010-42b6-b9c2-74a500b578e5'::uuid, DATE '2026-08-28'),
  ('dce56f99-ded8-4480-9392-e1da10c2490b'::uuid, DATE '2026-08-31'),
  ('16e4a73a-3a94-4d1a-bf33-c887b62d5684'::uuid, DATE '2026-09-01'),
  ('d9af9ed6-5187-4cec-bf89-76b75fc0e216'::uuid, DATE '2026-09-03'),
  ('2f56aa5c-7a13-4871-b3e4-f80037fabb0f'::uuid, DATE '2026-09-04'),
  ('9d155d6b-8bb5-4593-81ad-549ddda6aec2'::uuid, DATE '2026-09-11')
) AS v(id, new_date)
WHERE sw.id = v.id
  AND sw.client_id = '3a548c6a-a07c-4832-aa32-92fdfdbe3282';