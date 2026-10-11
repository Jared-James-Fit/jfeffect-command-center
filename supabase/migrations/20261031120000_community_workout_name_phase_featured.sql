-- Completed-workout posts say what was trained and lead with what mattered.
--
--   workout_name: the day's own name with its "Day 2 —" / "Friday —" prefix
--     taken off ("Primary Deadlift"). It goes public only when every word in
--     it is plain training language (community_public_day_name): a coach's
--     own nickname ("Upper Girly Pop") never does, and then the card keeps
--     "Block N · Week W". Block and program names are never used.
--   phase: the block's training focus, only when it's a short label
--     ("Hypertrophy", "Volume 5s/7s"), never a coach's sentence.
--   top_lift: the lift the day is about when its name says so ("Primary
--     Deadlift" → the heaviest deadlift), else the session's heaviest lift by
--     estimated 1RM, never just the first exercise. PRs still lead the card.

CREATE OR REPLACE FUNCTION public.community_public_day_name(_title text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v text := nullif(btrim(regexp_replace(btrim(coalesce(_title, '')),
              '^(day\s*\d+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*[—–:\-]\s*', '', 'i')), '');
  vocab text[] := ARRAY[
    'primary','secondary','tertiary','quaternary','main','heavy','light','moderate','volume','intensity','intensification',
    'accumulation','realization','overload','deload','taper','peak','test','testing','max','opener','technique','speed',
    'power','strength','hypertrophy','pump','physique','conditioning','cardio','recovery','mobility','baseline','build',
    'foundation','check','full','upper','lower','body','push','pull','leg','squat','bench','deadlift','press','row',
    'pulldown','pullup','chinup','chin','dip','lunge','hinge','rdl','sumo','conventional','pause','paused','tempo','larsen',
    'spoto','pin','close','grip','wide','narrow','competition','comp','variation','accessory','accessorie','arm','delt',
    'shoulder','chest','back','lat','trap','bicep','tricep','forearm','core','ab','glute','quad','hamstring','ham','calf',
    'calve','posterior','anterior','chain','hip','knee','focus','session','workout','circuit','superset','emphasis',
    'lengthened','shortened','stretch','isolation','compound','bodyweight','dumbbell','barbell','kettlebell','cable',
    'landmine','machine','band','home','gym','and','with','plus','dominant','in','of','the','to','for','only','metcon',
    'hiit','zone','run','bike','overhead','incline','decline','flat','front','goblet','split','bulgarian','hack',
    'extension','curl','raise','fly','flye','olympic','clean','snatch','jerk','touch','day','week','am','pm','short',
    'long','high','low','rep','reps','single','double','triple','top','set','backoff','back-off','day1','day2'
  ];
  w text;
BEGIN
  IF v IS NULL OR v ~* '^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|day\s*\d+)$' THEN RETURN NULL; END IF;
  FOR w IN SELECT x FROM regexp_split_to_table(lower(v), '[^a-z0-9]+') x WHERE x <> '' LOOP
    CONTINUE WHEN w ~ '^\d+[a-z]*$' OR char_length(w) = 1 OR w = ANY (vocab) OR rtrim(w, 's') = ANY (vocab);
    RETURN NULL;  -- a word that isn't plain training language: keep the day's name private
  END LOOP;
  RETURN v;
END;
$function$;

DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_workout_stats(uuid)'::regprocedure);

  def := replace(def, $r$  v_week int := 0;
BEGIN$r$, $r$  v_week int := 0;
  v_name text;
  v_phase text;
  v_daytitle text;
BEGIN$r$);

  def := replace(def, $r$  v_title := public.community_public_session_title(pc.day_id, pc.client_id, pc.completed_at);
$r$, $r$  v_title := public.community_public_session_title(pc.day_id, pc.client_id, pc.completed_at);

  SELECT d.title, public.community_public_day_name(d.title),
         CASE WHEN char_length(btrim(coalesce(b.training_focus, ''))) BETWEEN 3 AND 28
               AND b.training_focus !~ '[,.;→]' THEN btrim(b.training_focus) END
    INTO v_daytitle, v_name, v_phase
    FROM public.pl_days d
    LEFT JOIN public.pl_weeks w ON w.id = d.week_id
    LEFT JOIN public.pl_blocks b ON b.id = w.block_id AND NOT coalesce(b.archived, false)
   WHERE d.id = pc.day_id;
$r$);

  def := replace(def, $r$  primary_lift AS (SELECT qs.exercise_key FROM qs ORDER BY qs.sort_order ASC LIMIT 1)$r$,
    $r$  -- the lift the day is named for, else the heaviest of the session
  per_ex AS (
    SELECT qs.exercise_key, min(qs.exercise_name) AS exercise_name, min(qs.sort_order) AS sort_order,
           max(qs.load_kg * (1 + least(qs.reps, 12) / 30.0)) AS e1rm  -- reps past 12 say little about strength
      FROM qs WHERE qs.load_kg > 0 GROUP BY qs.exercise_key
  ),
  primary_lift AS (
    SELECT pe.exercise_key FROM per_ex pe
     ORDER BY EXISTS (SELECT 1 FROM unnest(ARRAY['squat','bench','deadlift','press','row','pulldown','pull-up','pullup','thrust','lunge','hinge']) kw
                       WHERE lower(coalesce(v_daytitle, '')) LIKE '%' || kw || '%' AND lower(pe.exercise_name) LIKE '%' || kw || '%') DESC,
              pe.e1rm DESC, pe.sort_order ASC
     LIMIT 1
  )$r$);

  def := replace(def, $r$    'workout_title', v_title,$r$, $r$    'workout_title', v_title,
    'workout_name', v_name,
    'phase', v_phase,$r$);

  IF position('per_ex AS' in def) = 0 OR position('''workout_name'', v_name' in def) = 0 OR position('v_phase text;' in def) = 0 OR position('INTO v_daytitle, v_name, v_phase' in def) = 0 THEN
    RAISE EXCEPTION 'community_workout_stats: anchors not found';
  END IF;
  EXECUTE def;
END $$;
