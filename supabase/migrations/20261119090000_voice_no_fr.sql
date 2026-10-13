-- The coach doesn't say "fr". Take it out of everything the app writes in
-- his voice: the Wednesday Wins streak line, birthday posts and holiday posts.
-- The functions are re-created from their live definitions with only these
-- exact phrases changed, so nothing else about them moves.

DO $$
DECLARE
  f regprocedure;
  def text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.community_week_wins(date,uuid)'::regprocedure,
    'public.community_birthday_compose(uuid,integer,jsonb)'::regprocedure
  ] LOOP
    def := pg_get_functiondef(f);
    def := replace(def, ' weeks fr''', ' weeks''');
    def := replace(def, 'the consistency is crazy fr 💪', 'the consistency is crazy 💪');
    def := replace(def, 'the strength is going up fr 🔥', 'the strength is going up 🔥');
    def := replace(def, 'eat the cake fr. then', 'eat the cake. then');
    EXECUTE def;
  END LOOP;
END $$;

UPDATE public.community_holidays
   SET body = regexp_replace(body, '[ ]+fr\M', '', 'g'), updated_at = now()
 WHERE body ~ '\mfr\M';
