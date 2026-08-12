ALTER TABLE public.pl_row_results
  ADD COLUMN IF NOT EXISTS load_type text NOT NULL DEFAULT 'external';
ALTER TABLE public.pl_row_results
  DROP CONSTRAINT IF EXISTS pl_row_results_load_type_check;
ALTER TABLE public.pl_row_results
  ADD CONSTRAINT pl_row_results_load_type_check CHECK (load_type IN ('external','bodyweight','assisted'));

ALTER TABLE public.member_set_logs
  ADD COLUMN IF NOT EXISTS load_type text NOT NULL DEFAULT 'external';
ALTER TABLE public.member_set_logs
  DROP CONSTRAINT IF EXISTS member_set_logs_load_type_check;
ALTER TABLE public.member_set_logs
  ADD CONSTRAINT member_set_logs_load_type_check CHECK (load_type IN ('external','bodyweight','assisted'));

UPDATE public.pl_row_results SET load_type = 'bodyweight' WHERE is_bodyweight IS TRUE AND load_type = 'external';
UPDATE public.member_set_logs SET load_type = 'bodyweight' WHERE is_bodyweight IS TRUE AND load_type = 'external';

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS default_load_type text;
ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_default_load_type_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_default_load_type_check CHECK (default_load_type IS NULL OR default_load_type IN ('external','bodyweight','assisted'));

UPDATE public.exercises SET default_load_type = 'assisted'
WHERE id IN (
  'd7fea794-40bc-4041-a6e9-c2359e9f11d5',
  '825c6893-35d7-4e80-965d-9a5c7c51f94e',
  'aa5b59b6-7c36-4bb3-bd29-062a66b4ff08',
  '8aa75504-b3c0-4cc9-a6e7-e6cb2aa19633',
  '09daeed6-eb69-4ddc-bac6-9f4e1caceb1d',
  '423b3874-e6c1-44d4-ae44-d49c9010359d',
  'cd45f111-491c-4f2e-b262-3c3de88b06c7',
  'd0a1549c-788b-4346-a6da-7b22b6545a53',
  'cbdd8073-ce2b-45e6-908b-77124db08379'
);