-- Powerlifting results: compute total, IPF GL (classic, 3-lift) and DOTS from
-- bodyweight + sex whenever they aren't supplied, so manually entered meets
-- (Athlete Records → Add result) rank in the GL / DOTS tabs like imported ones.

CREATE OR REPLACE FUNCTION public.ipf_gl_points(_sex text, _bw numeric, _total numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _bw IS NULL OR _bw <= 0 OR _total IS NULL OR _total <= 0 THEN NULL
    WHEN lower(_sex) LIKE 'f%' THEN round(_total * 100 / (610.32796 - 1045.59282 * exp(-0.03048 * _bw)), 2)
    ELSE round(_total * 100 / (1199.72839 - 1025.18162 * exp(-0.00921 * _bw)), 2) END
$$;

CREATE OR REPLACE FUNCTION public.dots_points(_sex text, _bw numeric, _total numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _bw IS NULL OR _bw <= 0 OR _total IS NULL OR _total <= 0 THEN NULL
    WHEN lower(_sex) LIKE 'f%' THEN round(_total * 500 / (-57.96288 + 13.6175032 * _bw - 0.1126655495 * _bw^2 + 0.0005158568 * _bw^3 - 0.0000010706 * _bw^4), 2)
    ELSE round(_total * 500 / (-307.75076 + 24.0900756 * _bw - 0.1918759221 * _bw^2 + 0.0007391293 * _bw^3 - 0.000001093 * _bw^4), 2) END
$$;

CREATE OR REPLACE FUNCTION public.tg_powerlifting_result_points()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.total_kg IS NULL OR NEW.total_kg = 0 THEN
    NEW.total_kg := coalesce(NEW.squat_kg, 0) + coalesce(NEW.bench_kg, 0) + coalesce(NEW.deadlift_kg, 0);
  END IF;
  IF NEW.gl_points IS NULL THEN NEW.gl_points := public.ipf_gl_points(NEW.sex, NEW.bodyweight_kg, NEW.total_kg); END IF;
  IF NEW.dots_points IS NULL THEN NEW.dots_points := public.dots_points(NEW.sex, NEW.bodyweight_kg, NEW.total_kg); END IF;
  IF NEW.points IS NULL THEN
    NEW.points := CASE WHEN upper(coalesce(NEW.points_system, 'GL')) = 'DOTS' THEN NEW.dots_points ELSE NEW.gl_points END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_powerlifting_result_points ON public.athlete_powerlifting_results;
CREATE TRIGGER trg_powerlifting_result_points BEFORE INSERT OR UPDATE OF sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, total_kg, gl_points, dots_points
ON public.athlete_powerlifting_results FOR EACH ROW EXECUTE FUNCTION public.tg_powerlifting_result_points();
