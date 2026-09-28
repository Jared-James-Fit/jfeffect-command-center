-- Optional velocity-based training metric.
-- Mean concentric velocity (MCV / average concentric velocity) is stored in m/s
-- per completed set so it can be trended beside load, reps and RPE.
alter table public.pl_row_results
  add column if not exists mean_concentric_velocity_mps numeric(5,3);

alter table public.pl_row_results
  add constraint pl_row_results_velocity_range
  check (
    mean_concentric_velocity_mps is null
    or (mean_concentric_velocity_mps > 0 and mean_concentric_velocity_mps <= 3.5)
  ) not valid;

comment on column public.pl_row_results.mean_concentric_velocity_mps is
  'Optional mean concentric bar velocity in metres/second for the set.';
