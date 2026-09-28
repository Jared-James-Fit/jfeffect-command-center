-- Persist the athlete's preference for showing the optional velocity column.
alter table public.clients
  add column if not exists velocity_input_default boolean not null default false;

comment on column public.clients.velocity_input_default is
  'When true, mean concentric velocity (m/s) is shown by default in workout set logging.';
