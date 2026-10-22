-- Lessons every day of the week: Wednesday's "Uncomfortable truth" and
-- Sunday's "Sunday reset" join the five lesson days.
--
--   Wed truth  13 · challenge an assumption, create tension, leave them
--                   something worth thinking about (the struck-out belief
--                   and the truth, drawn as a card: visual kind 'truth')
--   Sun reset  13 · a short mental and practical reset for the next seven
--                   days (three things to do this week: visual kind 'reset')
--
-- Wednesday Wins and Sunday Recap keep running beside them (the daily series
-- only steps aside on lesson days for the five library series). Written in
-- the coach's voice; every study named in a lesson is in its refs, worded the
-- way its published record supports. Inserted once per key, so a lesson the
-- coach edits is never overwritten.
SET lock_timeout = '3s';

ALTER TABLE public.community_lesson_plan DROP CONSTRAINT IF EXISTS community_lesson_plan_track_check;
ALTER TABLE public.community_lesson_plan ADD CONSTRAINT community_lesson_plan_track_check
  CHECK (track IN ('strength', 'hypertrophy', 'truth', 'methods', 'mind', 'fix', 'reset'));

CREATE OR REPLACE FUNCTION public.community_lesson_track(_day date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE extract(isodow FROM _day)::int
    WHEN 1 THEN 'strength' WHEN 2 THEN 'hypertrophy' WHEN 3 THEN 'truth' WHEN 4 THEN 'methods'
    WHEN 5 THEN 'mind' WHEN 6 THEN 'fix' WHEN 7 THEN 'reset' END
$$;

-- Saving a library item and the planner's overview each list the tracks:
-- add the two new days to whatever version of them is live.
DO $do$
DECLARE
  v_old text := $q$'strength', 'hypertrophy', 'methods', 'mind', 'fix'$q$;
  v_new text := $q$'strength', 'hypertrophy', 'truth', 'methods', 'mind', 'fix', 'reset'$q$;
  v_fn text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.community_lesson_item_save(uuid, text, jsonb, boolean)', 'public.community_lessons_overview()'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position(v_new IN v_def) > 0 THEN CONTINUE; END IF;
    IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'No track list in %', v_fn; END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;
END
$do$;

INSERT INTO public.community_series_items (series, mentor, body, data, sort_order) VALUES
  ('lesson', $m$truth$m$, $l$If you need to be sore to feel like it worked, you're grading the wrong thing

Soreness mostly shows up when the work is new. A new exercise, a new range, more lowering than you're used to. Run the same session again next week and you're barely sore, even though you trained just as hard.

A 2013 review made the case that soreness is a poor gauge of a good workout. It fades when you repeat the same work, and you can keep growing anyway.

What actually tells you it's working
• The same weight moves for more reps
• Your top sets feel easier at the same RPE
• You're beating your log, not your pain tolerance

Sore is fine. Chasing it is a waste of good sessions.$l$, $j${"key": "truth-soreness", "track": "truth", "title": "Soreness isn't proof it worked", "tags": ["soreness", "hypertrophy"], "visual": {"kind": "truth", "belief": "If I'm not sore, it didn't work", "truth": "Soreness tracks how new the work was. Not how much you grew."}, "refs": [{"label": "Schoenfeld & Contreras 2013, Strength Cond J 35(5):16-21 (review)", "url": "https://doi.org/10.1519/SSC.0b013e3182a61820"}], "story": {"type": "poll", "q": "be honest. do you judge a workout by how sore you are?", "options": [{"label": "yeah 100%", "tag": "soreness"}, {"label": "a little", "tag": "soreness"}, {"label": "nope"}]}}$j$::jsonb, 10),
  ('lesson', $m$truth$m$, $l$Waiting to feel motivated is the most popular way to skip a workout

Motivation is a feeling. It shows up after you start way more often than before. The first warmup set is the hard part. By set 3 you're usually glad you came.

The people who train for years aren't more motivated than you. They just stopped asking themselves if they feel like it.

Make the decision once, not every day
• Pick your training days on Sunday
• Treat them like work. You don't ask if you feel like going
• On bad days, do the first exercise and decide after that

You don't need to feel ready. You need to start.$l$, $j${"key": "truth-motivation", "track": "truth", "title": "Motivation isn't coming", "tags": ["consistency", "mindset"], "visual": {"kind": "truth", "belief": "I'll train when I feel motivated", "truth": "Most good sessions start before you feel like it."}, "refs": [], "story": {"type": "poll", "q": "what usually stops you from training?", "options": [{"label": "no motivation", "tag": "motivation"}, {"label": "no time", "tag": "time"}, {"label": "tired or sore", "tag": "recovery"}, {"label": "nothing, I show up"}]}}$j$::jsonb, 11),
  ('lesson', $m$truth$m$, $l$Most people don't need a better program. They need to finish the one they're on

Every program looks slow in week 2. That's when the new one you saw online starts looking better. So you switch, start over, and get week 1 again. Forever.

A boring plan run for 12 weeks beats a perfect one run for 3. The progress is in the repeating. Same lifts, a bit more weight, slightly better reps.

Before you change anything, ask
• Did I actually do the sessions?
• Did I push the sets I was meant to push?
• Did I sleep and eat like I wanted results?

If any answer is no, the program isn't the problem.$l$, $j${"key": "truth-program-hopping", "track": "truth", "title": "The program isn't the problem", "tags": ["consistency", "programming"], "visual": {"kind": "truth", "belief": "I need a better program", "truth": "You need to finish the one you're on."}, "refs": [], "story": {"type": "poll", "q": "how many programs have you started this year?", "options": [{"label": "1, still on it"}, {"label": "2 or 3", "tag": "consistency"}, {"label": "lost count", "tag": "consistency"}]}}$j$::jsonb, 12),
  ('lesson', $m$truth$m$, $l$Taking every set to failure feels like hard work. It isn't the same thing as good work

A 2022 meta-analysis compared training to failure with stopping short. On average, strength and size gains came out about the same.

What failure does cost you. More fatigue, slower reps on the sets after it, and longer before you can train that lift hard again.

Where it fits
• The last set of an isolation exercise
• Machines and cables, where a missed rep is safe
• Rarely on a heavy squat, bench or deadlift

Most of your sets should end with 1 to 3 good reps left. That's not soft. That's how you get to train again in two days.$l$, $j${"key": "truth-grinding", "track": "truth", "title": "Grinding every set isn't hard work", "tags": ["effort", "rpe"], "visual": {"kind": "truth", "belief": "Every set should be a grinder", "truth": "You can stop a rep or two short and still grow and get strong."}, "refs": [{"label": "Grgic et al. 2022, J Sport Health Sci 11(2):202-211", "url": "https://pubmed.ncbi.nlm.nih.gov/33497853/"}], "story": {"type": "poll", "q": "how close to failure are most of your sets?", "options": [{"label": "to failure", "tag": "effort"}, {"label": "1-2 reps left"}, {"label": "3+ reps left", "tag": "effort"}]}}$j$::jsonb, 13),
  ('lesson', $m$truth$m$, $l$Skipping cardio to protect your gains? Cardio was never really after them

A 2022 meta-analysis of 43 studies looked at lifting with and without cardio added. Muscle growth and max strength came out about the same. What took a hit was explosive strength, mostly when both were done in the same session.

So
• Do your cardio on its own day, or at least a few hours from lifting
• Keep most of it easy. You should be able to talk
• Don't do a hard run right before squats

Getting out of breath on the stairs isn't a flex. Your heart is a muscle too.$l$, $j${"key": "truth-cardio", "track": "truth", "title": "Cardio isn't killing your gains", "tags": ["cardio", "recovery"], "visual": {"kind": "truth", "belief": "Cardio kills gains", "truth": "Some cardio won't cost you muscle or strength. Skipping it costs your fitness."}, "refs": [{"label": "Schumann et al. 2022, Sports Med 52(3):601-612", "url": "https://pubmed.ncbi.nlm.nih.gov/34757594/"}], "story": {"type": "poll", "q": "how much cardio do you do a week?", "options": [{"label": "none", "tag": "cardio"}, {"label": "1-2 sessions"}, {"label": "3+"}]}}$j$::jsonb, 14),
  ('lesson', $m$truth$m$, $l$It feels like everyone at the gym is watching you. It's mostly not true

In a 2000 study, students were asked to walk into a room wearing an embarrassing Barry Manilow t-shirt. They guessed about half the room could say who was on it. It was closer to 1 in 4.

Psychologists call it the spotlight effect. You overestimate how much people notice you, because you're the one living in your head.

The person on the next bench is thinking about their own set, their own form, their own phone.

So film your sets. Use the empty bar. Ask for a spot. Do what you came to do.$l$, $j${"key": "truth-spotlight", "track": "truth", "title": "Nobody's watching you lift", "tags": ["confidence", "mindset"], "visual": {"kind": "truth", "belief": "Everyone at the gym is watching me", "truth": "Most people are too busy thinking about themselves to notice you."}, "refs": [{"label": "Gilovich, Medvec & Savitsky 2000, J Pers Soc Psychol 78(2):211-222", "url": "https://pubmed.ncbi.nlm.nih.gov/10707330/"}], "story": {"type": "poll", "q": "ever skipped an exercise because you felt watched?", "options": [{"label": "yeah", "tag": "confidence"}, {"label": "used to", "tag": "confidence"}, {"label": "never"}]}}$j$::jsonb, 15),
  ('lesson', $m$truth$m$, $l$Saying they just have good genetics is half true. It's also a comfortable excuse

Genetics are real. Some people grow faster, recover faster, or have levers made for a big bench. That part isn't fair and never will be.

But most people who say it haven't trained consistently for even two years. You haven't met your genetics yet. You've met your consistency.

The only comparison that matters
• You vs you 6 months ago
• Your log, not their highlight reel

Find your ceiling first. Then you can complain about it.$l$, $j${"key": "truth-genetics", "track": "truth", "title": "You haven't found your ceiling yet", "tags": ["mindset", "consistency"], "visual": {"kind": "truth", "belief": "They're just genetically gifted", "truth": "Maybe. You won't know your limit until you've trained long enough to hit it."}, "refs": [], "story": {"type": "poll", "q": "how long have you trained consistently?", "options": [{"label": "under 1 year"}, {"label": "1-3 years"}, {"label": "3+ years"}]}}$j$::jsonb, 16),
  ('lesson', $m$truth$m$, $l$Missing one workout doesn't ruin your week. Deciding the week is ruined does

A 2010 study followed people building a new daily habit. For the people whose data could be modelled, it took a median of 66 days to feel automatic, anywhere from 18 to 254. And missing one day didn't really change how the habit formed.

The problem is never the one miss. It's the "I'll just start again Monday" after it.

Missed today?
• Do the next session as planned. Don't double up
• Short on time? Do the main lift and leave
• Never miss twice in a row

Perfect weeks are rare. A long run of decent ones builds lifters.$l$, $j${"key": "truth-missed-day", "track": "truth", "title": "One missed day isn't the problem", "tags": ["consistency", "habits"], "visual": {"kind": "truth", "belief": "I missed a day, so the week's ruined", "truth": "One missed session does nothing. Quitting the week because of it does."}, "refs": [{"label": "Lally et al. 2010, Eur J Soc Psychol 40(6):998-1009", "url": "https://doi.org/10.1002/ejsp.674"}], "story": {"type": "poll", "q": "what do you do after a missed session?", "options": [{"label": "get right back on it"}, {"label": "write off the week", "tag": "consistency"}, {"label": "try to make it up", "tag": "consistency"}]}}$j$::jsonb, 17),
  ('lesson', $m$truth$m$, $l$Waiting for perfect form is how people stay on the same weight for a year

Every lift looks a little different at 90% than at 60%. The bar slows down and positions shift a bit. That's normal. What matters is that it's the same every rep, and it's safe.

Form gets built under weight you can control, not by staring at the empty bar forever.

What to look for
• The same setup every rep
• A bar path that looks about the same rep to rep
• No new pain, and you'd happily do the rep again

Film one set a week. Compare it to last month, not to a world record lifter.$l$, $j${"key": "truth-perfect-form", "track": "truth", "title": "Perfect form doesn't exist", "tags": ["technique"], "visual": {"kind": "truth", "belief": "I'll add weight once my form is perfect", "truth": "Perfect form doesn't exist. Repeatable form does."}, "refs": [], "story": {"type": "poll", "q": "do you film your heavy sets?", "options": [{"label": "every week"}, {"label": "sometimes", "tag": "technique"}, {"label": "never", "tag": "technique"}]}}$j$::jsonb, 18),
  ('lesson', $m$truth$m$, $l$The scale isn't lying. You're just reading one number like it's a trend

Water, salt, carbs, stress and whatever's still in your gut all move your weight day to day. A big pizza night can sit on the scale for a couple of days without being fat.

One weigh-in tells you almost nothing. Seven of them tell you a lot.

How to read it
• Weigh in the morning, after the bathroom, before food
• Look at the week's average, not today
• Compare this week's average to last week's

Stop letting Tuesday's number ruin your Tuesday.$l$, $j${"key": "truth-scale", "track": "truth", "title": "The scale isn't lying to you", "tags": ["bodyweight", "nutrition"], "visual": {"kind": "truth", "belief": "The scale went up, so I'm gaining fat", "truth": "One weigh-in is noise. The weekly average is the truth."}, "refs": [], "story": {"type": "poll", "q": "how often do you weigh yourself?", "options": [{"label": "every day"}, {"label": "once a week", "tag": "bodyweight"}, {"label": "never", "tag": "bodyweight"}]}}$j$::jsonb, 19),
  ('lesson', $m$truth$m$, $l$Scrolling lifting videos and feeling behind is normal. It's also a rigged comparison

You see their PR. You don't see the 50 sessions before it where nothing happened. You're putting their best set of the year next to your average set this week.

Everyone posts the highlight. Nobody posts the Tuesday where the bar felt heavy and they went home.

A better comparison
• Your top set now vs 3 months ago
• Sessions done this month vs last month
• How a weight you used to grind feels now

Behind who? You're only racing the version of you from last year.$l$, $j${"key": "truth-comparison", "track": "truth", "title": "You're comparing your Tuesday to their best day", "tags": ["mindset", "confidence"], "visual": {"kind": "truth", "belief": "Everyone's progressing faster than me", "truth": "You're comparing your normal day to their best one."}, "refs": [], "story": {"type": "poll", "q": "does social media make you feel behind?", "options": [{"label": "all the time", "tag": "mindset"}, {"label": "sometimes", "tag": "mindset"}, {"label": "nah"}]}}$j$::jsonb, 20),
  ('lesson', $m$truth$m$, $l$Eating clean and eating enough protein are not the same thing

A salad with a bit of chicken is a clean lunch. It's also not much protein if it's your biggest meal of the day.

A 2018 meta-analysis found extra protein helped people who lift gain more muscle, and the extra muscle levelled off around 1.6 grams per kilo of bodyweight a day, counting everything you eat. That's about 0.7 grams per pound.

Try this for 3 days
• Log what you actually eat, not what you meant to
• Add up the protein
• Short? Add one protein-heavy meal or a shake. Don't overhaul everything

Clean food is great. It just can't build muscle from protein that isn't there.$l$, $j${"key": "truth-protein-clean", "track": "truth", "title": "Eating clean isn't eating enough", "tags": ["protein", "nutrition"], "visual": {"kind": "truth", "belief": "I eat pretty clean, so I'm good", "truth": "Clean isn't the same as enough. Count your protein for three days."}, "refs": [{"label": "Morton et al. 2018, Br J Sports Med 52(6):376-384", "url": "https://pubmed.ncbi.nlm.nih.gov/28698222/"}], "story": {"type": "poll", "q": "do you know how much protein you ate yesterday?", "options": [{"label": "to the gram"}, {"label": "roughly", "tag": "protein"}, {"label": "no idea", "tag": "protein"}]}}$j$::jsonb, 21),
  ('lesson', $m$truth$m$, $l$What works is boring. That's exactly why most people quit it

Same lifts. Same days. A bit more weight or one more rep than last time. Sleep, protein, repeat. There's nothing exciting to post about week 7 of the same squat.

But that's where strength comes from. Not the new exercise you saw this morning.

Variety has a place. A new variation to fix a weak point, or to work around a sore joint. Not because you got bored on a Tuesday.

If your training feels boring and the numbers are going up, you're doing it right.$l$, $j${"key": "truth-boring", "track": "truth", "title": "Consistency is boring. That's the point", "tags": ["consistency", "programming"], "visual": {"kind": "truth", "belief": "I need to switch it up to keep progressing", "truth": "Doing the basics for longer is what works. It's supposed to be boring."}, "refs": [], "story": {"type": "poll", "q": "does your training feel boring right now?", "options": [{"label": "yes and it's working"}, {"label": "yes, I want to switch", "tag": "consistency"}, {"label": "no"}]}}$j$::jsonb, 22),
  ('lesson', $m$reset$m$, $l$Sunday reset. Plan the week before it plans you

If your sessions aren't on the calendar, they're competing with everything that is. Work, family and plans win every time.

Take 5 minutes tonight
• Put your training days in the calendar, with times
• Pick the one session you won't skip, no matter what
• Pack your bag so tomorrow is easy

A week you planned on Sunday goes way better than one you figure out on Monday.$l$, $j${"key": "reset-plan-the-week", "track": "reset", "title": "Plan the week before it plans you", "tags": ["consistency", "planning"], "visual": {"kind": "reset", "items": ["Put your sessions in the calendar", "Pick the one you won't skip", "Pack your gym bag tonight"]}, "refs": [], "story": {"type": "poll", "q": "how many sessions are you planning this week?", "options": [{"label": "2"}, {"label": "3"}, {"label": "4"}, {"label": "5+"}]}}$j$::jsonb, 10),
  ('lesson', $m$reset$m$, $l$Sunday reset. Look back before you plan ahead

Most people start every week fresh and repeat the same mistakes. Two minutes looking back fixes a lot of that.

Ask yourself
• What went well last week?
• What got in the way?
• What's one thing I'll do differently?

Just one. Not a whole new life on Monday. One thing, done all week.$l$, $j${"key": "reset-look-back", "track": "reset", "title": "Look back before you look ahead", "tags": ["reflection", "planning"], "visual": {"kind": "reset", "items": ["What went well last week?", "What got in the way?", "One thing to change"]}, "refs": [], "story": {"type": "question", "q": "what's one thing you're changing this week?"}}$j$::jsonb, 11),
  ('lesson', $m$reset$m$, $l$Sunday reset. Make this week's food easy before you're hungry

Most nutrition goes wrong on a busy Tuesday at 7pm, not at the grocery store. So set Tuesday up now.

Tonight
• Cook 2 protein sources you can grab all week
• Buy fruit and veg you'll actually eat, not the ones you think you should
• Plan Monday and Tuesday's meals. The rest gets easier

You don't need perfect meal prep. You need a fridge that makes the good choice the easy one.$l$, $j${"key": "reset-food-prep", "track": "reset", "title": "Make the week's food easy", "tags": ["nutrition", "planning"], "visual": {"kind": "reset", "items": ["Cook 2 protein sources", "Buy food you'll actually eat", "Plan Monday and Tuesday"]}, "refs": [], "story": {"type": "poll", "q": "do you prep food on Sundays?", "options": [{"label": "every week"}, {"label": "sometimes", "tag": "nutrition"}, {"label": "never", "tag": "nutrition"}]}}$j$::jsonb, 12),
  ('lesson', $m$reset$m$, $l$Sunday reset. This week's training runs on this week's sleep

Sunday night sets up Monday. A late Sunday makes Monday's session feel like a test you didn't study for.

This week
• Same wake up time every day, weekend included
• Set an alarm for 30 minutes before bed, not just for the morning
• Charge your phone outside the bedroom

Nothing fancy. Just give your recovery a chance to show up.$l$, $j${"key": "reset-sleep", "track": "reset", "title": "Set your sleep up for the week", "tags": ["sleep", "recovery"], "visual": {"kind": "reset", "items": ["Same wake up time all 7 days", "An alarm 30 minutes before bed", "Phone charging outside the bedroom"]}, "refs": [], "story": {"type": "poll", "q": "what messes with your sleep most?", "options": [{"label": "going to bed late", "tag": "sleep"}, {"label": "waking up at night", "tag": "sleep"}, {"label": "phone in bed", "tag": "sleep"}, {"label": "I sleep fine"}]}}$j$::jsonb, 13),
  ('lesson', $m$reset$m$, $l$Sunday reset. Decide your minimum before the week gets busy

Some day this week is going to go sideways. Decide now what you'll do when it does, so you don't decide on the spot to do nothing.

Your bad day plan
• Write a 20 minute version of your session
• Main lift and one accessory. That's it
• Never skip twice in a row

Short sessions keep the habit alive. Skipped ones don't.$l$, $j${"key": "reset-minimum-session", "track": "reset", "title": "Decide your minimum now", "tags": ["consistency", "planning"], "visual": {"kind": "reset", "items": ["Write your 20 minute version", "Main lift only on bad days", "Never skip twice in a row"]}, "refs": [], "story": {"type": "poll", "q": "do you have a plan for busy days?", "options": [{"label": "yep"}, {"label": "no", "tag": "consistency"}, {"label": "I just skip", "tag": "consistency"}]}}$j$::jsonb, 14),
  ('lesson', $m$reset$m$, $l$Sunday reset. Clear some noise before the week starts

You can't focus on your training with 40 other things fighting for your attention.

Tonight
• Mute the accounts that leave you feeling behind
• Pick one goal for the week, not five
• Do not disturb on while you train. The texts can wait an hour

A quieter head lifts better.$l$, $j${"key": "reset-clear-the-noise", "track": "reset", "title": "Clear the noise", "tags": ["focus", "mindset"], "visual": {"kind": "reset", "items": ["Mute what makes you feel behind", "Pick one goal for the week", "Do not disturb while you train"]}, "refs": [], "story": {"type": "poll", "q": "what pulls your focus most at the gym?", "options": [{"label": "my phone", "tag": "focus"}, {"label": "people around me", "tag": "confidence"}, {"label": "work stuff", "tag": "stress"}, {"label": "nothing"}]}}$j$::jsonb, 15),
  ('lesson', $m$reset$m$, $l$Sunday reset. Check in with your body before you ask anything of it

Rate these 1 to 5
• Sleep
• Stress
• Soreness, or anything nagging

All 3s and up? Train as planned.

Something at 2 or lower? Don't wait until Wednesday to find out. Plan an easier day, an extra rest day, or a swap for whatever's sore.

Adjusting on Sunday is smart. Grinding through it on Thursday isn't.$l$, $j${"key": "reset-recovery-check", "track": "reset", "title": "Check in with your body", "tags": ["recovery", "planning"], "visual": {"kind": "reset", "items": ["Rate sleep, stress, soreness 1 to 5", "A 2 or lower? Plan around it", "Adjust now, not mid-week"]}, "refs": [], "story": {"type": "slider", "q": "how recovered do you feel going into this week?", "emoji": "🔋"}}$j$::jsonb, 16),
  ('lesson', $m$reset$m$, $l$Sunday reset. Pick one thing to get better at this week

Not ten. One.

• One cue for your main lift. Brace before you unrack. Push the floor away. Same touch point every rep
• One habit outside the gym. Protein at breakfast. A daily walk. In bed by 10:30
• Write them down where you'll see them

A small focus done all week beats a big plan you forget by Wednesday.$l$, $j${"key": "reset-one-focus", "track": "reset", "title": "Pick one thing to get better at", "tags": ["technique", "habits"], "visual": {"kind": "reset", "items": ["One cue for your main lift", "One habit outside the gym", "Write both where you'll see them"]}, "refs": [], "story": {"type": "question", "q": "what's your one focus this week?"}}$j$::jsonb, 17),
  ('lesson', $m$reset$m$, $l$Sunday reset. Plan for the stuff that's going to go wrong

You already know something will get in the way this week. A late meeting, a kid's game, a night out.

Make an if-then plan for it. "If I work late Tuesday, then I train Wednesday at 6am."

A 2006 meta-analysis pooled 94 tests of these if-then plans and found a medium to large boost in people actually reaching their goals.

Tonight
• Name your hardest day this week
• Write your if-then for it
• Pick a backup time

Plans that expect problems survive them.$l$, $j${"key": "reset-if-then", "track": "reset", "title": "Plan for what's going to go wrong", "tags": ["planning", "consistency"], "visual": {"kind": "reset", "items": ["Name your hardest day", "If that happens, then I'll...", "Pick a backup time to train"]}, "refs": [{"label": "Gollwitzer & Sheeran 2006, Adv Exp Soc Psychol 38:69-119", "url": "https://doi.org/10.1016/S0065-2601(06)38002-1"}], "story": {"type": "poll", "q": "what usually wrecks your week?", "options": [{"label": "work", "tag": "time"}, {"label": "family stuff", "tag": "time"}, {"label": "low energy", "tag": "recovery"}, {"label": "social plans"}]}}$j$::jsonb, 18),
  ('lesson', $m$reset$m$, $l$Sunday reset. You train maybe 4 hours a week. Look at the other 164

What you do outside the gym matters for recovery, appetite and how you feel walking into the next session.

This week
• Pick a daily step goal you can actually hit. Not someone else's 10k
• A 10 minute walk after one meal a day
• Take the stairs or the long way once a day

Easy movement helps you recover. It doesn't take away from your lifting.$l$, $j${"key": "reset-steps", "track": "reset", "title": "Move more outside the gym", "tags": ["steps", "recovery"], "visual": {"kind": "reset", "items": ["A daily step goal you can hit", "A short walk after one meal", "Take the long way once a day"]}, "refs": [], "story": {"type": "poll", "q": "how many steps do you average a day?", "options": [{"label": "under 5k", "tag": "steps"}, {"label": "5-8k"}, {"label": "8k+"}]}}$j$::jsonb, 19),
  ('lesson', $m$reset$m$, $l$Sunday reset. Remember why you started

Motivation fades. A reason doesn't, if you can see it.

• Write your why in one line. Not "to be healthy". Something real. Keep up with my kids. Total 500 this year. Feel strong in my own body
• Pick one goal for 12 weeks from now
• Put it somewhere you'll see it every day

On the days you don't feel like it, your reason does the work.$l$, $j${"key": "reset-why", "track": "reset", "title": "Remember why you started", "tags": ["mindset", "goals"], "visual": {"kind": "reset", "items": ["Write your why in one line", "One goal for 12 weeks out", "Put it where you'll see it"]}, "refs": [], "story": {"type": "question", "q": "why did you start lifting? one line"}}$j$::jsonb, 20),
  ('lesson', $m$reset$m$, $l$Sunday reset. Plan your rest days as carefully as your training days

Rest isn't time off from the program. It's part of it.

This week
• Put your rest days on the calendar on purpose. Don't just let them happen
• Keep them easy. A walk, some mobility, nothing that leaves you wrecked
• Still eat your protein. You're recovering, not off the clock

A good week of training needs a good week of recovery around it.$l$, $j${"key": "reset-rest-days", "track": "reset", "title": "Plan your rest days too", "tags": ["recovery", "planning"], "visual": {"kind": "reset", "items": ["Put rest days on the calendar", "A walk or mobility, nothing hard", "Still hit your protein"]}, "refs": [], "story": {"type": "poll", "q": "what do you do on rest days?", "options": [{"label": "full rest"}, {"label": "a walk or easy stuff"}, {"label": "I don't take any", "tag": "recovery"}]}}$j$::jsonb, 21),
  ('lesson', $m$reset$m$, $l$Sunday reset. Before you plan the week, count last week's wins

Most of us remember every missed session and forget the 3 we crushed.

• Write down 3 wins. A rep PR, a session you almost skipped but did, a week of good sleep. Small counts
• One thing you're proud of
• Pick one to repeat this week

You'll train better from "look what I did" than from "look what I missed".$l$, $j${"key": "reset-count-wins", "track": "reset", "title": "Count your wins first", "tags": ["mindset", "reflection"], "visual": {"kind": "reset", "items": ["Write 3 wins from last week", "One thing you're proud of", "Repeat one this week"]}, "refs": [], "story": {"type": "question", "q": "what's one win from last week?"}}$j$::jsonb, 22)
ON CONFLICT ((data->>'key')) WHERE series = 'lesson' DO NOTHING;
