-- clients.preferred_weight_unit is NOT NULL DEFAULT 'lb', so "lb" can't tell a
-- lifter who chose pounds from one who was never asked. This marks an answer:
-- null = never chosen (the app keeps showing lb and asks once per app open).
alter table public.clients
  add column if not exists weight_unit_confirmed_at timestamptz;

-- kg can only have been picked on purpose (lb is the default), so those
-- lifters are never asked again.
update public.clients
set weight_unit_confirmed_at = coalesce(updated_at, now())
where preferred_weight_unit = 'kg'
  and weight_unit_confirmed_at is null;
