alter table public.athlete_powerlifting_results add column if not exists gl_points numeric;
alter table public.athlete_powerlifting_results add column if not exists dots_points numeric;
update public.athlete_powerlifting_results set gl_points=points where upper(points_system)='GL' and gl_points is null;
update public.athlete_powerlifting_results set dots_points=points where upper(points_system)='DOTS' and dots_points is null;
-- A meet is one row; GL and DOTS coexist on that row.