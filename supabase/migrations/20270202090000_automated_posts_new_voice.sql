-- The coach's automated posts in his new voice (his ask, Nov 5 2026: "if I
-- wouldn't naturally write it as a social media post, it shouldn't be
-- published on my platform"). The daily pictures got it first (#811-#816);
-- this is everything else the app writes for him:
--
--   * the five library series (Monday Motivation, Tuesday Tips, Try it
--     Thursday, Finish Strong Friday, Saturday Spirit) rewritten the way he'd
--     post them: plain sentences with their apostrophes and normal
--     punctuation, lowercase where it suits, no slogans, kickers or forced
--     slang, his opinions as his ("i think") and never a story he didn't
--     live. Every fact stays the original's (Kobe, Dorian Yates, Tim Grover,
--     Dave Alred, the 2003 drop goal) and every Thursday path to a screen is
--     unchanged. Three Mondays pointed at a quote the post doesn't carry
--     ("read that twice", "notice theres nothing in there") and are written
--     whole; the two Thursdays only coaching clients can use say so.
--   * the lessons keep their words and casing and get their apostrophes back
--     ("dont" -> "don't", "its not" -> "it's not"), and " & " reads "and";
--     the card's title and the story question / poll options too.
--   * the holiday captions: the same two short lines, with apostrophes and
--     without "yall", "v", "rn", "lol" or "w".
--   * the Wins, Recap, Tuesday numbers, Thursday stat line and birthday
--     templates: the same sentences with their apostrophes and commas back
--     ("didnt miss a single session" -> ", didn't miss a single session"),
--     "lowkey" and "yall are cooking" gone.
--
-- Each library and holiday rewrite replaces only the exact text it was
-- written against (md5 guard), and a post already out takes it only while its
-- caption is still that text (a Thursday keeps its numbers line), so anything
-- the coach wrote or edited himself stays his. Lesson plan rows have no
-- wording of their own. Wins, Recaps and birthdays already out keep theirs
-- (their words were composed from that week's numbers). A story poll that's
-- out keeps its wording (people answered it).

-- ---------------------------------------------------------------------------
-- 1. The library series
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE voice_rewrite (
  series text NOT NULL,
  sort_order int NOT NULL,
  old_md5 text NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (series, sort_order)
);

INSERT INTO voice_rewrite (series, sort_order, old_md5, body) VALUES
('monday_motivation', 1, 'e7eb4d6ac6', $v$everyone wants the big moment. the PR, the meet, the stage.

i think most of what people call talent is just someone who stayed consistent for a really long time.

so don't worry about one big session this week. just show up for all of them 💪$v$),
('monday_motivation', 2, '4781f60b1a', $v$skill gets built one rep at a time, on purpose.

most people don't need more talent. they need fewer wasted reps. this week, try making every rep look like the best one you did last week.$v$),
('monday_motivation', 3, '58a2226165', $v$Dorian Yates won six straight Mr. Olympias doing one or two working sets per exercise.

it wasn't that he did less. every one of those sets went all the way.

a lot of people do five sets at about 80% effort. this week, pick your hardest set and really finish it.$v$),
('monday_motivation', 4, 'a51110a85d', $v$Kobe didn't make the people around him comfortable. he made them better.

i think that's what a good training partner does too. this week, push your own standard a little, and bring someone along with you 🤝$v$),
('monday_motivation', 5, '99aad8a190', $v$small thing that helps: write your goals as something you'll do, not something you'll avoid.

"hit depth" instead of "don't miss depth". "train four times" instead of "don't skip sessions".

what you tell yourself is usually what you end up thinking about under the bar.$v$),
('monday_motivation', 6, '79fdd592b3', $v$in Relentless, Tim Grover sorts competitors into three groups. Coolers, Closers and Cleaners.

Coolers do what's asked. Closers deliver when it counts. Cleaners are never satisfied and don't stop.

fun one to think about on a monday. which one were you last week?$v$),
('monday_motivation', 7, '2177e40b28', $v$everyone in this crew has big goals, which i love.

the goal is the easy part though. the work is what gets you there, so let's see some of it this week 💪$v$),
('monday_motivation', 8, '39f8ccd4a5', $v$Kobe scored 81 points in one game in 2006. people still talk about that night.

nobody really mentions the practice behind it, but it was there either way.

most weeks are practice weeks. they're also the only part any of us actually control.$v$),
('monday_motivation', 9, 'f6f45f2b49', $v$same weight, same reps, same effort usually means the same body.

your body changes when you give it a reason to. this week, try to add a rep or a little weight somewhere.$v$),
('monday_motivation', 10, '7b08ce7b7d', $v$you don't need to feel motivated every morning to train well.

it helps a lot to know what you want, and then stop debating it with yourself every day. you just go.$v$),
('monday_motivation', 11, '114431d550', $v$the best lifters usually look calm on the platform. they've already done it in training, over and over.

most of the pressure on meet day comes from finding out you never practised for it. treat this week's training like the day is coming.$v$),
('monday_motivation', 12, '7689f5687c', $v$the person ahead of you usually isn't special. they just stopped arguing with the plan sooner.

if there's an excuse you're tired of hearing from yourself, this could be a good week to drop it.$v$),
('monday_motivation', 13, '27145f903a', $v$Dave Alred coached Jonny Wilkinson's kicking for years. the drop goal that won the 2003 World Cup took a second.

the work behind it took a lot longer than that.

most of us won't get one big moment this week, just a few normal sessions. that's where the big moments get built anyway.$v$),
('monday_motivation', 14, '1c04bc971f', $v$it's hard to trust work you didn't do.

that's why the boring sessions matter. when a weight gets heavy later on, they're what you get to lean on 🙏$v$),

('finish_strong_friday', 1, 'a1e346144d', $v$it's friday and everyone's a little tired.

i think the session you don't feel like doing is the one that matters most. it keeps the whole week from slipping.

get it in 💪$v$),
('finish_strong_friday', 2, 'd16432d2ee', $v$for most of us this was a normal week. no meet, no show, nobody watching.

that's where most of the progress actually happens. the regular weeks add up way more than the big days.

so don't coast the last session just because nobody's watching.$v$),
('finish_strong_friday', 3, '95287551a4', $v$the last set of the last session of the week is usually the one people coast through.

you don't need to get hyped for it. just keep every rep as clean as the first one.$v$),
('finish_strong_friday', 4, 'a22e3e6ee4', $v$Kobe played all 20 of his seasons for one team and won five titles 🏆

sticking with something isn't very exciting most of the time. it's mostly just not leaving when leaving would be easier.

finish this week the way you planned it on monday.$v$),
('finish_strong_friday', 5, '9ea3c3ced4', $v$end of a hard week, the bar usually moves slower and your legs feel heavy. that's normal.

a session that feels a bit ugly still counts. getting used to training on those days is a big part of getting good at this.$v$),
('finish_strong_friday', 6, 'cf003507b0', $v$the hardest part of friday usually isn't the session. it's the couch, the plans, and the "i'll make it up monday" thought.

if you can, get today's session done first. the rest of the night feels better after 👊$v$),
('finish_strong_friday', 7, 'c38612fde0', $v$if you're only training because the program says so, friday is usually where that runs out.

it helps to think about why you started. most people train better when it's something they want, not something they owe.$v$),
('finish_strong_friday', 8, '0efcd8b50e', $v$Dorian Yates won six Olympia titles while training mostly out of sight, at his own gym in Birmingham.

nobody saw most of that work until he was on stage. today's session doesn't need an audience either. it just needs to get done.$v$),
('finish_strong_friday', 9, '7cc556aac5', $v$warm-ups, accessories, food prep, getting to bed on time. none of it is exciting, but it all counts.

if you've got some of the boring stuff left this week, today's a good day to finish it.$v$),
('finish_strong_friday', 10, 'd9e6883be6', $v$working hard gets you a long way, but paying attention is what keeps you improving.

in your last session this week, try filming a top set. watch it back and pick one thing to work on 👀$v$),
('finish_strong_friday', 11, 'ac78ddeb48', $v$when people look back on their week it usually turns into a list of what went wrong.

try it the other way for once. pick one thing you did right this week and do it again today.$v$),
('finish_strong_friday', 12, '8e1d617287', $v$most people have had enough by friday. that's normal.

it's also why a good friday session goes a long way. one more and the week's done.$v$),
('finish_strong_friday', 13, '29dc22c8fd', $v$Michael Jordan gave Tim Grover 30 days to prove himself, and it turned into about fifteen years.

i like that story because it wasn't one big moment. he just kept showing up and doing the job well. that's a good way to finish a week too.$v$),
('finish_strong_friday', 14, '5bbe82200d', $v$one good session can be luck. a whole week of them usually isn't.

the more you show up, the less you need things to go perfectly. get the last one in 🔥$v$),

('saturday_spirit', 1, '936c498ae1', $v$you never really know how close you are, so it's worth one more swing ⛏️$v$),
('saturday_spirit', 2, 'ce2f689208', $v$a lot of progress happens before you can see it. that still counts.$v$),
('saturday_spirit', 3, '0d9f454642', $v$it wasn't the last hit that split the rock. it was all the ones before it too.$v$),
('saturday_spirit', 4, 'd551f496f7', $v$people see the PR. they don't usually see everything that went into it.$v$),
('saturday_spirit', 5, 'd1e4dc05be', $v$you don't need to see the top yet. the next step is enough for today.$v$),
('saturday_spirit', 6, 'a4e0577ba7', $v$water wears down stone by showing up a lot, not by hitting hard. training works a bit like that.$v$),
('saturday_spirit', 7, '641791290c', $v$most great training years have plenty of missed days. they just don't usually have two in a row.$v$),
('saturday_spirit', 8, '5a35ab370c', $v$the slow way up is still up.$v$),
('saturday_spirit', 9, '497d3b593c', $v$early sessions are a different kind of peaceful. the gym's quiet and the day hasn't started yet.$v$),
('saturday_spirit', 10, '61f0dd0499', $v$it takes the time it takes. the work is what moves it along.$v$),

('try_it_thursday', 1, '1073d4e75c', $v$logging your bodyweight: on Home, tap Log Weight on the Bodyweight card. first thing in the morning works best, after the bathroom and before you eat or drink.

one weigh-in doesn't mean much on its own. the trend over a few weeks is what tells you if your food lines up with your goal. 3 or 4 mornings a week is plenty.$v$),
('try_it_thursday', 2, '7a167341d2', $v$the rest timer starts on its own when you check off a set. you can also tap the ▶ on any exercise to start it yourself.

this week, try actually resting the full time on your main lifts. 3 to 5 minutes on heavy squats, bench and deadlifts is normal.$v$),
('try_it_thursday', 3, 'd984e9d4bd', $v$the review at the end of your workout pops up once your last set is logged (or when you tap Finish Workout). it asks how hard it was, if anything hurt, and how you slept and felt going in.

it takes about 20 seconds. it catches the stuff your numbers can't, like a PR on 4 hours of sleep or a tweak before it turns into something. it's worth doing even on the boring days.$v$),
('try_it_thursday', 4, 'ba7b03a36e', $v$every exercise in your program has a How To button. tap it for the demo video if there's one, the cues and the most common mistakes.

if you're not 100% sure about something on your plan, give it a look before your first set. even on lifts you know well, the cues are worth a read.$v$),
('try_it_thursday', 5, 'cabe8f96a7', $v$progress photos: on Home, tap Add Photos on the Progress card. same spot, same lighting, same time of day, every few weeks.

you see yourself in the mirror every day, so you rarely notice the change. side by side photos make it a lot easier to see. if you're coached by me, tap Send to Coach and they come straight to me.$v$),
('try_it_thursday', 6, '4830948406', $v$rating your sets: after a set, tap how hard it was. 10 means nothing left, 8 means you had 2 more good reps. if you're not sure, the ⓘ next to RPE above your sets shows the full scale.

it takes about 2 seconds a set. it shows whether a weight was actually heavy or you were just having a rough day, but only if you're honest with it.$v$),
('try_it_thursday', 7, 'c242587e8a', $v$log every set, not just the top one. weight and reps on each set as you go, right after you finish it.

the app finds your PRs from what you log, so a set you don't log is a PR nobody ever sees. this week, try logging as you go instead of all at the end.$v$),
('try_it_thursday', 8, '2932ab1f34', $v$your training analytics: on the Workouts tab, scroll down to your month card and tap See all analytics. your lifts over time, your recent PRs, all of it.

on a rough week it's a nice reminder of how far you've actually come 📈$v$),
('try_it_thursday', 9, 'b3f7121404', $v$for my coaching clients: the weekly check-in shows up in Messages as a card when it's due. tap Start check-in and it takes a couple of minutes.

it's where i hear about what your workout log can't show me, like stress, sleep, how your body feels and what's coming up. the bad weeks are the ones i most need to hear about, so don't skip those 🤝$v$),
('try_it_thursday', 10, '73a27b3fc7', $v$the note button on each exercise is handy for anything you want to remember. seat height, grip width, which cue clicked, something that felt off.

next time you open that exercise, your old notes are right there, so you're not figuring it all out again every week. if you're coached, i can see them too.$v$),
('try_it_thursday', 11, '12d9ac7d58', $v$the Performance League: tap the trophy on the big Crew button at the bottom for Rankings.

every month it ranks the crew on points from training, logging, reviews, check-ins and progress photos. who lifts the most doesn't matter, so anyone can win it. you need a bodyweight logged to get in 🏆$v$),
('try_it_thursday', 12, '9676a103d4', $v$for my coaching clients: send me a video of a top set. in Messages tap +, then Camera or Photos & Videos.

film from the side with your whole body in the shot and the phone around hip height. it's the fastest way for me to catch something in your technique before it turns into a problem or a missed lift.$v$),
('try_it_thursday', 13, '20288e2f50', $v$the Water Today card on Home: tap +250ml, +500ml or +1L when you drink.

most people drink less than they think, and it can show up as feeling flat in the gym. try logging it for one week just to see where you're at.$v$),
('try_it_thursday', 14, 'b9cbad328e', $v$to post a workout in Crew, tap the + at the top left of Crew and pick a session. no pressure to make it look good, it's the effort people get excited about.

it's also harder to skip on the days you don't feel like it when the crew is used to seeing you show up.$v$),
('try_it_thursday', 15, '09ecca6358', $v$the Cookbook: on the Nutrition tab, tap Open Cookbook. it's full of easy meals, air fryer, microwave, no-cook and store-bought.

if hitting your protein feels like a chore, find 2 or 3 in there you actually like and rotate them. you don't need 40 recipes, just a few you'll actually make.$v$),

('tuesday_tips', 1, '6049a3c7d7', $v$a squat cue worth testing this week: spread the floor. push your feet out to the sides like you're trying to rip the floor apart, even though they don't actually move.

a lot of people feel their hips kick in more and their knees stop caving. try it on your warm-up sets first. if it clicks keep it, if not toss it 🤝$v$),
('tuesday_tips', 2, 'c5c715749c', $v$a habit that matters more than people think: do the same warm-up every time. same order, same jumps in weight.

after a few weeks your body knows exactly what it's getting ready for, and you stop wasting energy figuring it out. pick one this week and stick with it.$v$),
('tuesday_tips', 3, 'a99a19ad53', $v$one bad session doesn't mean much. sleep, stress, food and a long day at work all show up on the bar.

what matters is the trend over 4 to 6 weeks. next time a session feels off, log it honestly, leave your review and move on 🤝$v$),
('tuesday_tips', 4, 'cc4f221a34', $v$gym packed, no rack open, someone's on your bench? it helps to have a backup.

rack taken, do your accessories first. machine gone, swap it for the closest thing. a session done 80% as planned is still way better than a session skipped.$v$),
('tuesday_tips', 5, '3f874976f1', $v$a bench cue worth testing: try to bend the bar. grip it tight and think about snapping it in half.

for a lot of people it locks the shoulder blades back and stops the elbows flaring early. test it on your first couple of warm-up sets and pay attention to how the bar path feels 💪$v$),
('tuesday_tips', 6, 'e8e8bb369d', $v$a quick one on RPE. an 8 means you had 2 more good reps in you, not 2 more if your life depended on it.

the whole point is picking the right weight for the day, so if the number's off, the weight's off. after each top set this week, ask yourself how many you really had left and log that.$v$),
('tuesday_tips', 7, 'b9a473ec4f', $v$a routine before your heavy sets helps more than you'd think. same steps every time: chalk, belt, same breath, same setup.

it takes the thinking out of it and gives your brain something to do besides worry about the weight. pick 3 steps and run them before every working set this week.$v$),
('tuesday_tips', 8, 'a19fb1ce3a', $v$you can't control how your body feels every day. you can control showing up, sleeping, eating and giving honest effort.

do those for long enough and the numbers usually follow. on the days you feel rough, still show up and do what the plan says.$v$),
('tuesday_tips', 9, 'ceeffb6207', $v$a deadlift cue to try: pull the slack out before the bar leaves the floor. grip it, pull up just enough to hear the plates click, get tight, then push.

yanking the bar off the floor is one of the fastest ways to lose position. do it on every warm-up set this week so it's automatic by your top set.$v$),
('tuesday_tips', 10, 'dc8c202b9c', $v$rest longer on your main lifts. 3 to 5 minutes between heavy sets isn't lazy, it's how the next set gets to be heavy too.

cutting rest short on squats and deadlifts mostly just makes the next set worse. save the short rest for accessories.$v$),
('tuesday_tips', 11, '87b656afdd', $v$save the hype for the top set. if you're getting fired up for warm-ups, you're burning it too early.

stay calm through the warm-ups and turn it up for the 1 or 2 sets that actually matter. try it next session and see how the top set feels.$v$),
('tuesday_tips', 12, 'b9298925ce', $v$if you're coached by me and everything feels heavy for 2 weeks straight, tell me. that's not you being soft, it's useful information.

sometimes it means we pull back for a week, sometimes it's sleep or food. either way i can only adjust what i know about, so put it in your workout review or send me a message 🤝$v$),
('tuesday_tips', 13, '553d126e03', $v$if your deadlift is slow off the floor, try this. stop thinking pull and start thinking push the floor away, like a leg press.

it tends to keep the hips from shooting up first and gets your legs doing more of the work. film a set with it and one without if you want to see the difference 🎥$v$),
('tuesday_tips', 14, '3d58020929', $v$eat something 1 to 3 hours before you train. some carbs and some protein, nothing crazy.

training on an empty tank usually shows up in the last few sets, not the first. if you train early and can't eat much, a banana or some toast beats nothing.$v$),
('tuesday_tips', 15, '92574a514d', $v$the only comparison that really matters is you against you a few months ago. someone else's numbers have nothing to do with your progress.

scroll back through your PRs in the app sometime. most people forget how far they've actually come 🙏$v$),
('tuesday_tips', 16, '32a0a06c58', $v$a bracing cue worth testing: breathe into your belt all the way around. not just your stomach, your sides and lower back too, like you're filling a barrel. then lock it in before you move.

if your lower back is the first thing to give on heavy sets, this is where i'd start. practise it on a lighter set first so you can feel it.$v$),
('tuesday_tips', 17, '328573d2d3', $v$before you walk into the gym, open your workout and know what your top set is supposed to be. it takes about 30 seconds.

showing up with the plan already in your head means less wandering, less guessing weights halfway through, and usually a better session.$v$),
('tuesday_tips', 18, '38ae7fe52b', $v$sleep is the one thing that makes training feel easier without touching your program. 7 to 9 hours is the usual target.

a lot of people don't need a new program, they need to go to bed earlier. try getting 30 minutes more a night this week and see how your top sets feel 🫡$v$),
('tuesday_tips', 19, 'fddd5748e4', $v$one for bench: instead of pushing the bar up, think about pushing yourself away from it, down into the bench.

it sounds like the same thing, but for a lot of people it keeps the upper back tight and the leg drive connected. give it a few sets this week and see if the lockout feels different.$v$),
('tuesday_tips', 20, 'f91b211a63', $v$for RDLs, pretend there's a wall behind you and try to touch it with your butt. hips go back, and the bar stays close to your legs. stop when your hips can't go back any further.

a lot of people go too low and turn it into a back exercise. done right, you should feel your hamstrings way more 🔥$v$),
('tuesday_tips', 21, '73b5bedb27', $v$for pulldowns and rows, think elbows to your back pockets, not hands to your chest. your hands are just hooks.

most people feel their lats a lot more and their biceps a lot less. try it next back day, and drop the weight a bit if you need to.$v$),
('tuesday_tips', 22, '224fb8d9bc', $v$something to test on your accessories: control the way down for 2 to 3 seconds and don't cut the stretch short at the bottom.

research has been leaning toward the stretched part of the rep being really good for growth. you'll probably need less weight, which is normal. try it on 1 or 2 exercises for a couple of weeks.$v$);

-- the apostrophes a texting shorthand dropped, and " & " as "and". Only the
-- sure ones: "were", "well", "ill", "id", "wed" are real words, "lets you"
-- is right as it is, and "its" stays possessive unless the word after it
-- makes it "it is" (never after "at", "by", "on", "of"…: "at its slowest")
CREATE FUNCTION pg_temp.voice_apostrophes(t text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  pair text[];
BEGIN
  IF t IS NULL THEN RETURN NULL; END IF;
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['dont', 'don''t'], ['doesnt', 'doesn''t'], ['didnt', 'didn''t'], ['isnt', 'isn''t'],
    ['arent', 'aren''t'], ['wasnt', 'wasn''t'], ['werent', 'weren''t'], ['hasnt', 'hasn''t'],
    ['havent', 'haven''t'], ['hadnt', 'hadn''t'], ['couldnt', 'couldn''t'], ['wouldnt', 'wouldn''t'],
    ['shouldnt', 'shouldn''t'], ['cant', 'can''t'], ['wont', 'won''t'],
    ['youre', 'you''re'], ['youve', 'you''ve'], ['youll', 'you''ll'], ['youd', 'you''d'],
    ['theyre', 'they''re'], ['theyve', 'they''ve'], ['theyll', 'they''ll'],
    ['thats', 'that''s'], ['whats', 'what''s'], ['theres', 'there''s'], ['heres', 'here''s'],
    ['wheres', 'where''s'], ['weve', 'we''ve'], ['itll', 'it''ll'], ['thatll', 'that''ll'], ['whos', 'who''s']
  ] LOOP
    t := regexp_replace(t, '\m' || pair[1] || '\M', pair[2], 'g');
    t := regexp_replace(t, '\m' || upper(left(pair[1], 1)) || substr(pair[1], 2) || '\M',
                        upper(left(pair[2], 1)) || substr(pair[2], 2), 'g');
  END LOOP;
  t := regexp_replace(t, '\m([Ll])ets (go|figure)\M', '\1et''s \2', 'g');
  -- "at its fastest", "by its slowest", "on its own": hold the possessive aside first
  t := regexp_replace(t, '\m(at|by|on|has|had|near|below|in|of|to) its\M', '\1 i§ts', 'gi');
  t := regexp_replace(t,
    '\m([Ii])ts (a|also|called|costing|did|hard|heavy|how|less|mostly|not|often|one|pushing|rarely|real|safe|the|there|tiny|usually|what|working|written|your|muscle|part|squat|off|tempo|strongest)\M',
    '\1t''s \2', 'g');
  t := regexp_replace(t, '\m([Ii])ts ([0-9])', '\1t''s \2', 'g');
  t := replace(t, 'i§ts', 'its');
  t := replace(t, ' & ', ' and ');
  RETURN t;
END
$f$;

-- posts already out: only while the caption is still the library text it went
-- out with (a Thursday's numbers line after it keeps its numbers)
UPDATE public.community_posts p
   SET caption = r.body || pg_temp.voice_apostrophes(substr(p.caption, char_length(i.body) + 1))
  FROM voice_rewrite r
  JOIN public.community_series_items i
    ON i.series = r.series AND i.sort_order = r.sort_order AND left(md5(i.body), 10) = r.old_md5
 WHERE p.series_item_id = i.id
   AND starts_with(p.caption, i.body)
   AND (p.caption = i.body OR substr(p.caption, char_length(i.body) + 1, 3) = E'\n\n📊');

UPDATE public.community_series_items i
   SET body = r.body
  FROM voice_rewrite r
 WHERE i.series = r.series AND i.sort_order = r.sort_order AND left(md5(i.body), 10) = r.old_md5;

-- ---------------------------------------------------------------------------
-- 2. The lessons: the same words, with their apostrophes
-- ---------------------------------------------------------------------------

-- the card's title, the story question and a poll's options (never the refs,
-- the diagram's own settings or anything else on the card)
CREATE FUNCTION pg_temp.voice_card(d jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT d
    || CASE WHEN jsonb_typeof(d->'title') = 'string'
            THEN jsonb_build_object('title', pg_temp.voice_apostrophes(d->>'title')) ELSE '{}'::jsonb END
    || CASE WHEN jsonb_typeof(d->'story') = 'object' THEN jsonb_build_object('story',
         (d->'story')
         || CASE WHEN jsonb_typeof(d->'story'->'q') = 'string'
                 THEN jsonb_build_object('q', pg_temp.voice_apostrophes(d->'story'->>'q')) ELSE '{}'::jsonb END
         || CASE WHEN jsonb_typeof(d->'story'->'options') = 'array' THEN jsonb_build_object('options',
              (SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(o->'label') = 'string'
                                              THEN o || jsonb_build_object('label', pg_temp.voice_apostrophes(o->>'label'))
                                              ELSE o END ORDER BY n), '[]'::jsonb)
                 FROM jsonb_array_elements(d->'story'->'options') WITH ORDINALITY x(o, n)))
            ELSE '{}'::jsonb END)
       ELSE '{}'::jsonb END
$f$;

-- lessons already out: the caption while it's still the library's, the card's
-- title while it's still the library's (the story sticker people answered stays)
UPDATE public.community_posts p
   SET caption = pg_temp.voice_apostrophes(p.caption)
  FROM public.community_series_items i
 WHERE i.id = p.series_item_id AND i.series = 'lesson' AND p.series = 'lesson'
   AND p.caption = i.body
   AND pg_temp.voice_apostrophes(i.body) <> i.body;

UPDATE public.community_posts p
   SET series_data = jsonb_set(p.series_data, '{title}', to_jsonb(pg_temp.voice_apostrophes(i.data->>'title')))
  FROM public.community_series_items i
 WHERE i.id = p.series_item_id AND i.series = 'lesson' AND p.series = 'lesson'
   AND jsonb_typeof(p.series_data->'title') = 'string'
   AND p.series_data->>'title' = i.data->>'title'
   AND pg_temp.voice_apostrophes(i.data->>'title') <> i.data->>'title';

UPDATE public.community_series_items
   SET body = pg_temp.voice_apostrophes(body),
       data = pg_temp.voice_card(data)
 WHERE series = 'lesson'
   AND (pg_temp.voice_apostrophes(body) <> body OR pg_temp.voice_card(data) <> data);

-- ---------------------------------------------------------------------------
-- 3. The holidays: two short lines, ≤160 characters
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE holiday_rewrite (key text PRIMARY KEY, old_md5 text NOT NULL, body text NOT NULL);

INSERT INTO holiday_rewrite (key, old_md5, body) VALUES
('new_year', '09be6adf90', $h$happy new year 🎉 thank you for every rep last year 🙏

pick one habit for this year, not ten. set a reminder to check on it next week 💪$h$),
('valentines', 'ab9ed852d5', $h$happy valentine's day ❤️ i love this crew

leave a comment on someone's post in here today. it takes 30 seconds and it'll make their day 🤝$h$),
('mothers_day', '72bd2ebe16', $h$happy mother's day to all the moms in here 💐 you never miss 🙌

text your mom one thing she taught you that you still use, not just happy mother's day 🫶$h$),
('fathers_day', 'c99a038d91', $h$happy father's day to the dads in here 👊 the kids are watching 💪

get 15 minutes of movement in with your kid (or your dad) today. a walk or catch is plenty$h$),
('canada_day', '687c3b7cfe', $h$happy canada day 🇨🇦 enjoy the long weekend

have a glass of water before every drink today. you'll feel a lot better tomorrow 🔥$h$),
('labour_day', '19fa828528', $h$happy labour day 💪 proud of you all for training all summer

put this week's sessions in your calendar now. if it's not scheduled it usually doesn't happen 🔥$h$),
('thanksgiving', '11680b1135', $h$happy thanksgiving 🦃 i'm grateful for every one of you 🙏

before you eat today, text one person who helped you get here. then enjoy the meal, no guilt 💪$h$),
('halloween', '19350cebe6', $h$happy halloween 🎃 and yes, you can have the candy

eat a real meal with some protein before trick or treating and you'll probably eat way less of it 🤣$h$),
('christmas', '6f4e9ade24', $h$merry christmas 🎄 thank you for this year 🙏

leave your phone in another room for one meal today and just be there. no tracking, no guilt 💪$h$),
('easter', '93ccb6390e', $h$happy easter 🐣 grateful for every one of you 🙏

go for a 20 minute walk with the family after the big meal. then enjoy the chocolate, no guilt 🫡$h$);

UPDATE public.community_posts p
   SET caption = r.body
  FROM holiday_rewrite r
  JOIN public.community_holidays h ON h.key = r.key AND left(md5(h.body), 10) = r.old_md5
 WHERE p.series = 'holiday' AND p.caption = h.body;

UPDATE public.community_holidays h
   SET body = r.body, updated_at = now()
  FROM holiday_rewrite r
 WHERE h.key = r.key AND left(md5(h.body), 10) = r.old_md5;

-- ---------------------------------------------------------------------------
-- 4. The templates: the same sentences, with their apostrophes and commas
-- ---------------------------------------------------------------------------
-- Each fix is an exact piece of the live function (quotes doubled, as in its
-- source) and what it becomes. A piece that's gone and wasn't replaced stops
-- the migration; one already replaced is skipped, so it can run again.

DO $do$
DECLARE
  fixes text[] := ARRAY[
    -- Wednesday Wins: each person's line
    ['community_week_wins', $o$' PRd ' || v_lift || CASE pr.scope WHEN 'atpr' THEN ' best ever' WHEN 'program_pr' THEN ' best of the program' ELSE ' best of the block' END$o$,
                            $n$' PR''d ' || v_lift || CASE pr.scope WHEN 'atpr' THEN ', best ever' WHEN 'program_pr' THEN ', best of the program' ELSE ', best of the block' END$n$],
    ['community_week_wins', $o$' on ' || v_lift || ' ' || v_set$o$, $n$' on ' || v_lift || ', ' || v_set$n$],
    ['community_week_wins', $o$' best of the program so far'$o$, $n$', best of the program so far'$n$],
    ['community_week_wins', $o$' on ' || v_lift || ' best of the block']$o$, $n$' on ' || v_lift || ', best of the block']$n$],
    ['community_week_wins', $o$' PRs in 1 week thats insane'$o$, $n$' PRs in 1 week, that''s insane'$n$],
    ['community_week_wins', $o$' PRs in 1 week crazy'$o$, $n$' PRs in 1 week, crazy'$n$],
    ['community_week_wins', $o$' PRs on the week lowkey insane'$o$, $n$' PRs on the week, honestly kind of insane'$n$],
    ['community_week_wins', $o$'welcome to the crew ' || v_name$o$, $n$'welcome to the crew, ' || v_name$n$],
    ['community_week_wins', $o$'first week done ' || v_sessions$o$, $n$'first week done, ' || v_sessions$n$],
    ['community_week_wins', $o$' days off. first one back is the hardest and its done'$o$, $n$' days off. the first one back is the hardest and it''s done'$n$],
    ['community_week_wins', $o$' didnt miss a single session'$o$, $n$', didn''t miss a single session'$n$],
    ['community_week_wins', $o$' hit every session on the plan ' || v_done$o$, $n$' hit every session on the plan, ' || v_done$n$],
    ['community_week_wins', $o$' weeks straight no misses'$o$, $n$' weeks straight, no misses'$n$],
    ['community_week_wins', $o$'. thats how its done'$o$, $n$'. that''s how it''s done'$n$],
    ['community_week_wins', $o$' hasnt missed a week in '$o$, $n$' hasn''t missed a week in '$n$],
    ['community_week_wins', $o$'% more total volume vs the week before'$o$, $n$'% more total volume than the week before'$n$],
    -- Wednesday Wins: the opening and closing lines
    ['community_compose_wins', $o$'yall are cooking. ' || v_prs || ' PRs last week'$o$, $n$'what a week. ' || v_prs || ' PRs last week'$n$],
    ['community_compose_wins', $o$'few highlights from last week'$o$, $n$'a few highlights from last week'$n$],
    ['community_compose_wins', $o$'thats the standard. lets go again this week'$o$, $n$'that''s the standard. let''s go again this week'$n$],
    ['community_compose_wins', $o$'not on here yet? you will be. lets go'$o$, $n$'not on here yet? you will be. let''s go'$n$],
    ['community_compose_wins', $o$'everyone who showed up last week built this. keep stacking'$o$, $n$'everyone who showed up last week built this. same again this week'$n$],
    -- Sunday Recap
    ['community_compose_recap', $o$'% of workouts had every set logged. weight & reps on every set, its how your PRs get found'$o$,
                                $n$'% of workouts had every set logged. weight and reps on every set is how your PRs get found'$n$],
    ['community_compose_recap', $o$' weekly check-ins came in. a couple minutes, and its how I hear how your week actually went'$o$,
                                $n$' weekly check-ins came in. they take a couple of minutes, and it''s how i hear how your week actually went'$n$],
    ['community_compose_recap', $o$' was our quietest day. if its on your plan this week, thats the one to protect'$o$,
                                $n$' was our quietest day. if it''s on your plan this week, that''s the one to protect'$n$],
    ['community_compose_recap', $o$'thats a wrap on the week. '$o$, $n$'that''s a wrap on the week. '$n$],
    ['community_compose_recap', $o$'end of the week. heres how we did'$o$, $n$'end of the week. here''s how we did'$n$],
    ['community_compose_recap', $o$'numbers below 👇 lets go again this week'$o$, $n$'numbers below 👇 let''s go again this week'$n$],
    ['community_compose_recap', $o$' sessions short of the plan. if your week gets packed, message me and we move days around instead of skipping'$o$,
                                $n$' sessions short of the plan. if your week gets packed, message me and we''ll move days around instead of skipping'$n$],
    -- Tuesday's crew numbers
    ['community_compose_observation', $o$'its not proof. how long youve lifted & whats going on in life matter too. but more good reps at a lift is how you get better at it'$o$,
                                      $n$'it''s not proof. how long you''ve lifted and what''s going on in life matter too. but more good reps at a lift is how you get better at it'$n$],
    ['community_compose_observation', $o$'its not proof, lots goes into it. but the ones who show up every week keep being the ones with the PRs'$o$,
                                      $n$'it''s not proof, a lot goes into it. but the ones who show up every week keep being the ones with the PRs'$n$],
    ['community_compose_observation', $o$'/5. thats '$o$, $n$'/5. that''s '$n$],
    ['community_compose_observation', $o$'its a pattern, not proof. rough night? keep the top set honest & dont chase a PR that day'$o$,
                                      $n$'it''s a pattern, not proof. rough night? keep the top set honest and don''t chase a PR that day'$n$],
    -- Thursday's stat line
    ['community_feature_stat', $o$'. the app doesnt do it for you. the people who use it are just more locked in'$o$,
                               $n$'. the app doesn''t do it for you. the people who use it are just more locked in'$n$],
    -- birthdays
    ['community_birthday_compose', $o$v_lw[1] || ' & ' || v_lw[2]$o$, $n$v_lw[1] || ' and ' || v_lw[2]$n$],
    ['community_birthday_compose', $o$v_lw[2] || ' & ' || v_lw[3]$o$, $n$v_lw[2] || ' and ' || v_lw[3]$n$],
    ['community_birthday_compose', $o$'its ' || v_name || '''s birthday today 🎂🎉'$o$, $n$'it''s ' || v_name || '''s birthday today 🎂🎉'$n$],
    ['community_birthday_compose', $o$' sessions & '$o$, $n$' sessions and '$n$],
    ['community_birthday_compose', $o$'thats what showing up looks like 🔥🔥🔥'$o$, $n$'that''s what showing up looks like 🔥🔥🔥'$n$],
    ['community_birthday_compose', $o$'proud of the work youve been putting in 🙌'$o$, $n$'proud of the work you''ve been putting in 🙌'$n$],
    ['community_birthday_compose', $o$'so glad youre part of this crew 🙌'$o$, $n$'so glad you''re part of this crew 🙌'$n$]
  ];
  f text[];
  fn record;
  src text;
  def text;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('community_week_wins', 'community_compose_wins', 'community_compose_recap',
                         'community_compose_observation', 'community_feature_stat', 'community_birthday_compose')
  LOOP
    src := pg_get_functiondef(fn.oid);
    def := src;
    FOREACH f SLICE 1 IN ARRAY fixes LOOP
      CONTINUE WHEN f[1] <> fn.proname;
      IF position(f[2] IN def) > 0 THEN
        def := replace(def, f[2], f[3]);
      ELSIF position(f[3] IN def) = 0 THEN
        RAISE EXCEPTION 'automated voice: % no longer has %', fn.proname, f[2];
      END IF;
    END LOOP;
    IF def <> src THEN EXECUTE def; END IF;
  END LOOP;
END
$do$;
