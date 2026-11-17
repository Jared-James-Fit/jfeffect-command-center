-- A weight unit is "confirmed" only when the person chose it.
--
-- 20261116090000_weight_unit_confirmed.sql stamped weight_unit_confirmed_at on
-- every client whose preferred_weight_unit was 'kg', on the assumption that kg
-- could only have been picked on purpose. It wasn't always: Jared McIntyre's
-- account said kg (no audit record of anyone choosing it) while all 68 of his
-- weigh-ins and 148 of his last 150 sets were lb, so the app never asked him.
--
-- A choice made in the app is stamped by saveWeightUnitChoice with a
-- JavaScript timestamp (millisecond precision); that migration stamped
-- updated_at / now() (microsecond precision). Clearing only stamps with a
-- sub-millisecond part removes exactly the ones nobody chose. The unit itself
-- is kept: the "Pounds or kilograms?" prompt asks once, and their answer is
-- the real choice. Idempotent: an answer given in the app never matches.
update public.clients
set weight_unit_confirmed_at = null
where weight_unit_confirmed_at is not null
  and preferred_weight_unit = 'kg'
  and (extract(microseconds from weight_unit_confirmed_at)::bigint % 1000) <> 0;
