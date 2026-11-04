-- Lessons stay under 800 characters (LESSON_MAX_CHARS, plain-words.ts), from
-- the crew's own numbers (45 days of Crew's attention tracker, coaches left
-- out): automated posts over 800 characters got the longest reads (19s against
-- 11-14s) but the fewest likes (0.25 against 0.5-0.7) and the most people
-- leaving the app right after (77% against 57-65%). Long only pays while it
-- keeps people around, and past 800 it doesn't. The eight lessons still over it
-- keep their evidence, its limits and the coach's take, in fewer words; no fact
-- added. Each only while it's still exactly the text it replaces (md5), and a
-- lesson already out only while its caption is still that text.
WITH v(id, old_md5, body) AS (VALUES
  ('e85172e0-945c-43a7-aa83-86ebd6486d43'::uuid, 'aff4e9b88a9ed0e40b08319ba890f988', $l$an empty bar can drift off midfoot and cost you nothing. your max cant

the real rule: the balance point of you plus the bar sits over your feet. the heavier the bar for your size, the more it decides where you balance

so near your max the bar lives over midfoot

drift makes it harder too. hips a foot behind the bar? an inch of drift puts 8% more on your hips and back

a 2011 study of 19 powerlifters: the heavier the pull, the less the bar went forward. past 60% of their max it came back toward them (tested up to 80%)

film a light set and a top set from the side
• top set as tight as the light one? normal. leave it
• drift grows with the weight or you rock onto your toes? its costing you

my take: midfoot isnt a cue to chase. its what balance looks like once the bar outweighs you$l$),
  ('ce3358c9-ee06-4cbc-b815-0709fe066633'::uuid, 'a4517089ec24986a4e8b93dbcf7136f4', $l$the spot where your bench slows down isnt where youre weakest

the bar only slows when your push drops below its weight. so the trouble starts at its fastest point. by its slowest your push has caught back up

a 1989 study of elite powerlifters found it wasnt a worse lever or muscles firing less. a 2013 study pressed from a dead stop and still saw it. both were small and only the first used powerlifters

most likely: its a weak spot you coast through on the speed you built below it

film a top single and an RPE 8 single from the side
• slows only near max? normal
• bar crawls off your chest? build the bottom of the press
• your position changes at RPE 8 too? thats technique. fix it light

my take: train the inches before the stall. pins just below it, long pauses, fast first inches$l$),
  ('91367cb0-d02e-4a86-b797-ef2e56ddfd64'::uuid, '9edbdf8d07bf23958ddbd5eb67caa04a', $l$your max is supposed to look slow. your push shouldnt be

muscle makes less force the faster it shortens. at a true max you barely push harder than the bar weighs. so it can only crawl

a 2014 study put 20 regular gym-goers on the same 6 week bench plan. one group pushed every rep as fast as they could. the other went half speed on purpose. their max went up 18% vs 10%

a 2023 look at 24 studies found fast ahead too. but only by a little

my read: slowing the way up on purpose costs you a bit. already pushing every rep? theres no extra to find

on a grinder that means full push from the first inch. dont save it for the slow spot

unless its tempo work, the weight sets how fast it can go. you set the push 💪$l$),
  ('177d285e-66e4-4b8b-9a87-581deb0fbb53'::uuid, '3351d6211fbd303c5f8e869cd79633c1', $l$your squat drifts to one side. that doesnt mean the other leg is weak

a 2007 study of 18 everyday lifters looked at squats. one side tended to do more of the work at the hip. the other side did more at the knee

my take: uneven isnt weak. most drifts start in your setup, mobility or habit

check in this order
• pain or an old injury there? that first
• bar centred, hands even, feet measured?
• still there at 60%? nothing is near its limit there. so its how you move
• same side near your max and in single leg work, for weeks? thats a real gap

then split squats earn a spot. weak side first, match the reps

send me a vid before you program 5 sets of lunges 👀$l$),
  ('b0a4830d-1e78-4f56-ab10-d908fe181a6e'::uuid, 'c6f54dbe0215d2b599d12e0d6af5c541', $l$sore doesnt mean youre not recovered. not sore doesnt mean you are

a 2002 study had students do 12, 24 or 60 hard lowering reps for their arms. more reps cost more strength and took longer to come back. but how sore it felt? about the same in every group

so track fatigue, not soreness. a small 2023 bench study looked at it. sets that stopped 3 reps short were back in a day. failure and 1 short took about two

my test: same warm up weight and reps every session
• usual speed and usual RPE? train
• slower, or a full RPE heavier? back off, sore or not

my take: two days apart, a rep or two short is fine. same muscle the next day? stop 3 short. save failure for before a day off$l$),
  ('47ed63fc-d2d9-4262-878e-939e159eba77'::uuid, '48b20bc68e9c2d2f44fd78a4ac3c66b7', $l$a bad night costs your max less than you think. a bad week is the problem

a 2022 look at 69 studies checked short or no sleep. strength dropped about 3%. skill tasks dropped about 21%

nights in a row are different. in a 1994 study a small group of men slept 3 hours a night. three nights in a row. their high rep sets dropped by night two. then their max bench, leg press and deadlift did too

all small, mostly men, few lifters

this week protect the run
• same wake time every day
• caffeine done 9 hours before bed
• my take: set a bedtime alarm 8.5 hours before you wake up

slept bad anyway? warm up and judge the bar, not the night$l$),
  ('3c12bc29-7437-4a6f-bc1b-8d2549041bb1'::uuid, '5aa159fe516ff5fe7b1cca1ed964c65d', $l$near your max the extra weight goes to your hips. your knees dont take more

a 2022 study took trained men from 90% up to a missed 102%. the hips had to work harder as it got heavy. the knees didnt

a 2026 study of 29 elite powerlifters saw the same from 70 to 90%. the first wasnt on powerlifters. the second never went heavier

what I think: that lean is how the hips take the extra

film your opener and your top single from the same spot
• a bit more lean, bar over midfoot, back holds? normal
• misses stall with your hips up? pause or pin squats just below that spot
• bar drifts to your toes or your upper back rounds? fix it light

my take: dont force yourself upright in a prep. it hands the load back to knees that werent taking more$l$),
  ('c5bc075f-fd52-4878-90d0-e2dad2e0016a'::uuid, '282eb86a0083bfcd4b006dc8b7532240', $l$a PR shows you your best day. your log shows you your normal one

a 2016 look at 138 experiments found checking your progress helps you hit goals. more when its written down or someone else sees it. those were mostly health goals, not lifting

one day is noisy. so read a month or two at a time
• same weight, lower RPE? thats strength showing up before a PR
• RPE creeping up at the same weights for a few weeks? usually fatigue building
• sessions done vs planned. 8 of 12? thats the story

bad week? check sleep, stress, food, and if it was meant to be hard. my rule: change something only if it repeats

send me your last 6 weeks, or show a training buddy. thats the someone else sees it part$l$)
), posts AS (
  UPDATE public.community_posts p
     SET caption = v.body
    FROM v JOIN public.community_series_items i ON i.id = v.id AND md5(i.body) = v.old_md5
   WHERE p.series_item_id = v.id AND p.caption = i.body
  RETURNING p.id
)
UPDATE public.community_series_items i
   SET body = v.body, updated_at = now()
  FROM v
 WHERE i.id = v.id AND md5(i.body) = v.old_md5;
