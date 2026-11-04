-- Every automated post, rewritten to read at about a 5th grade level in the
-- coach's own texting voice (his ask, Nov 4 2026: "dummy proof like 5th grade
-- reading level & sound like me"). Mostly lowercase, short lines, everyday
-- words, a hook up top; the lesson's card keeps sentence case. Every rewrite
-- passes `plainCheck` (src/lib/plain-words.ts, run by plain-voice-posts.test.ts),
-- and none adds a fact: numbers, names, studies and quotes are the originals'
-- (quotes word for word), some dropped to keep it simple. The sources stay in
-- each lesson's refs.
--
-- What changes, each only while it's still exactly what was there (md5 guard),
-- so anything the coach edited himself stays his:
--   * the library (community_series_items): lessons (body, title, the card's
--     belief / truth / three things, the story poll's wording), Monday and
--     Friday, and Tuesday / Thursday where they read long or point to a
--     screen that moved (Rankings is on Crew, the Cookbook on Nutrition,
--     posting is Crew's +). Mentor quotes never change.
--   * posts already out: a caption still equal to the library text it went out
--     with takes the new text (a Thursday post keeps its numbers line, reworded),
--     and its card data takes the new card words.
--   * Tuesday's crew-numbers posts and Wednesday Wins already out: reworded
--     the way the new templates (20270123090000_plain_voice_templates.sql) write them.
-- Planned lessons have no wording of their own, so they pick up the library's.

CREATE TEMP TABLE plain_voice_rewrite (id uuid PRIMARY KEY, old_md5 text NOT NULL, body text NOT NULL, patch jsonb NOT NULL);

-- the new card words onto a library item's data or a post's copy of it: only
-- the fields it already has, the rest of the card (its kind, a diagram's own
-- settings) and the refs untouched
CREATE FUNCTION pg_temp.plain_merge(d jsonb, patch jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT d
    || CASE WHEN patch ? 'title' AND d ? 'title' THEN jsonb_build_object('title', patch->'title') ELSE '{}'::jsonb END
    || CASE WHEN patch ? 'where' AND d ? 'where' THEN jsonb_build_object('where', patch->'where') ELSE '{}'::jsonb END
    || CASE WHEN patch ? 'visual' AND jsonb_typeof(d->'visual') = 'object'
            THEN jsonb_build_object('visual', (d->'visual') || (patch->'visual')) ELSE '{}'::jsonb END
    || CASE WHEN jsonb_typeof(d->'story') = 'object' AND (patch ? 'story_q' OR patch ? 'labels')
            THEN jsonb_build_object('story', (d->'story')
                   || jsonb_build_object('q', coalesce(patch->'story_q', d->'story'->'q'))
                   || CASE WHEN patch ? 'labels' AND jsonb_typeof(d->'story'->'options') = 'array'
                                AND jsonb_array_length(patch->'labels') = jsonb_array_length(d->'story'->'options')
                           THEN jsonb_build_object('options', (SELECT jsonb_agg(o || jsonb_build_object('label', patch->'labels'->((n - 1)::int)) ORDER BY n)
                                                                FROM jsonb_array_elements(d->'story'->'options') WITH ORDINALITY t(o, n)))
                           ELSE '{}'::jsonb END)
            ELSE '{}'::jsonb END
$f$;

INSERT INTO plain_voice_rewrite (id, old_md5, body, patch) VALUES
  ('50189212-d38d-4f3b-9bb1-1dbbfcb4bc45'::uuid, '750b08068af56c7a72d7bd23543c4203', $l$stuck on the same dumbbells for weeks? add a rep instead

a 2022 study had trained lifters do one of two things. add weight each week, or keep the weight and add reps

after 8 weeks muscle growth was basically the same

dumbbells and machines jump in big steps. so honestly reps are the easier way up a lot of the time

what matters is that something in your log moves over a few weeks

an accessory hasnt budged in a month or two? send it my way 👊$l$, $j${"title": "Stuck on accessories? Add reps, not weight"}$j$::jsonb),
  ('15727fbb-3769-4dfe-8f42-4c537fa37372'::uuid, '060cbb5ec3c89bb2315e5b7c0480a695', $l$slept like 4 hours before meet day? dont panic yet

a 2022 look at 69 studies checked nights of 6 hours or less. strength dropped around 3%. skill stuff like aim dropped way more

an earlier look at lifting research checked one night of no sleep. most studies found it barely hurt strength

a few short nights in a row were the bigger problem

so one rough night might cost you a little & make warmups feel heavier

on the day: normal warmups, normal caffeine, stick to the plan

something feels off? tell me in the warmup room and we adjust 🤝$l$, $j${}$j$::jsonb),
  ('e85172e0-945c-43a7-aa83-86ebd6486d43'::uuid, '8d91a57af75fdf10e71c3313091bac81', $l$an empty bar can drift off midfoot and cost you nothing. your max cant

the real rule: the balance point of you plus the bar sits over your feet. thats why your arms go forward on an air squat

the heavier the bar for your size, the more it decides where you balance

say you weigh 100 kg and the bar drifts an inch. on 50 kg you sit back half an inch. on 250 kg, two and a half

so near your max the bar lives over midfoot

drift makes it harder too. the further your hips sit behind the bar, the more they work. same for your knees in front

hips a foot behind the bar? an inch of drift puts 8% more on your hips and back

low bar leans you over: more on the hips. high bar and front squats sit upright: more on the knees

a 2011 study of 19 powerlifters: the heavier the pull, the less the bar went forward. past 60% of their max it came back toward them (tested up to 80%)

film a light set and a top set from the side
• top set as tight as the light one, or tighter? normal. leave it
• drift grows with the weight or you rock onto your toes? its costing you

my take: midfoot isnt a cue to chase. its what balance looks like once the bar outweighs you$l$, $j${}$j$::jsonb),
  ('be4f3e11-64ec-40ac-9a5e-b5edbbb582bd'::uuid, '4c5d553d383946ef4d694d4cfe008247', $l$butt popping off the bench when it gets heavy?

thats usually leg drive done wrong. not a lack of it

leg drive isnt pushing your hips up. its pushing yourself back along the bench so your upper back stays wedged in

• push like youre sliding yourself toward the rack
• move your feet to where pushing doesnt lift you. often a bit further forward
• do light sets where the only goal is keeping your butt down

in IPF style meets your head, shoulders and butt have to stay on the bench. so this is a red light

foot position is personal though. check with me before you move yours 🤝$l$, $j${}$j$::jsonb),
  ('08e4d378-66f0-4c7e-ac10-23555e0fcc63'::uuid, '377cef6aae6d573ac91a5a6e1f89ef04', $l$bench dies 2 inches from lockout? its not always triceps

a lot of lockout misses are really misses in the middle. the bar just ran out of speed up top

other usual suspects
• the bar drifts toward your feet. finishing over your chest instead of your shoulders makes the top harder
• one arm finishes first because your grip isnt centered

film from the side. look where the bar actually slows, not where it stopped

once its off your chest, think push the bar back toward the rack

send me a side vid of your next heavy single. I can tell you which one it is 👀$l$, $j${}$j$::jsonb),
  ('ce3358c9-ee06-4cbc-b815-0709fe066633'::uuid, 'e8e53ad31a87b28aeac7285283d761cd', $l$the spot where your bench slows down isnt where youre weakest

the bar only slows when your push drops below its weight. so the trouble starts at its fastest point, just off your chest. by the time its slowest your push has caught back up

a 1989 study of elite powerlifters found it wasnt a worse lever or muscles firing less. their guess: the stretch from lowering the bar fades before the stronger spot up top

a 2013 study pressed from a dead stop and still saw it. so its not just the stretch. both were small and only the first used powerlifters

most likely: its a weak spot you coast through on the speed you built below it

film a top single and an RPE 8 single from the side
• same path, slows only near max? everyone has that. nothing to fix
• same path but the bar crawls off your chest? no speed to coast on. build the bottom of the press
• forearms tip off the bar, it drifts to your feet or shoulders roll up. at RPE 8 too? thats technique. fix it light

arch, grip and arm length move where your weak spot sits. so dont copy anyones elbow path

new to benching? just bench more

my take: train the inches before the stall. pins a few inches below it, long pauses, fast first inches$l$, $j${}$j$::jsonb),
  ('cdbf3987-c465-4053-83f9-36ade8433275'::uuid, 'eb6afe485bd6b804b3e3becf7a0339d4', $l$your bar path at 95% looks nothing like your warmups?

super common. a 2025 look at 22 studies on experienced lifters found that as the weight goes up
• the bar slows down
• the press takes longer
• joint movement varies more

so the question isnt did it change. its did it change in a way that costs you

worth fixing: losing your touch point, butt or shoulders coming off, bar drifting to your feet

maybe leave it: a bit more elbow flare late, or a path that keeps moving. that can be your body finding a stronger spot

dont force your 60% path onto a max. big changes we decide together 🤝$l$, $j${"title": "Bar path changing near your max"}$j$::jsonb),
  ('aee40937-dd2b-4505-a301-f863ed98437b'::uuid, '4afb0e8e85ebd03c9bc8256f7373ee3a', $l$shoulders rolling forward a few reps into the set?

it shows up at the shoulders but the cause is usually somewhere else
• the unrack. pressing the bar up out of the hooks pulls your shoulder blades off the bench. thats before rep 1
• reaching at the top. pushing past lockout every rep slowly pulls your shoulder blades loose

set your upper back first. then pull the bar out over your shoulders. dont press it out

each rep is done when your elbows lock. no reaching

take a handoff on heavy sets if someone knows how to give one 👀$l$, $j${}$j$::jsonb),
  ('0afad019-c3ca-43ad-970f-8ef908415f90'::uuid, '894ee6145ae0397fce2654e5352bf1e2', $l$bar dips a tiny bit right as you hear press? refs see that

under IPF style rules the bar has to be dead still on your chest. then you get the press command

sinking or heaving it after that is a red light

it usually happens because the bar was resting on your chest. so you sink it to get tight again or to grab a mini bounce

• touch and freeze. control the last few inches so it stops dead
• have someone call press at random. sometimes right away, sometimes after 2 seconds
• film from the side at chest height. you cant feel a 1cm dip

if your pause already gets whites, dont change it near a meet$l$, $j${}$j$::jsonb),
  ('36cd935d-4844-49f8-94ca-5a751aae2a96'::uuid, '6369ab92955396f6187b4a5ab778bc20', $l$theres no one right touch point. it has to fit how youre built

the anchor: from the side, your forearms are about straight under the bar at the bottom

so touch point and elbows move together. lower touch, more tuck. higher touch, more flare

• long arms mean more distance to press. a wider grip and a bigger arch can win some back
• a deep rib cage already makes the press shorter. so you might need less of both

the mistake at this level is copying someone elses setup. a better position on paper can cost you kilos for months while you relearn it

test changes in the off season over weeks, with video. never mid prep

anyone moved their touch point and had it click? 👀$l$, $j${}$j$::jsonb),
  ('00ee9d30-9778-4d9f-9334-2d074c0de9d9'::uuid, '1871fde384b661f47cec005271cb194e', $l$bar landing somewhere different on your chest every rep?

where your elbows go pretty much decides where the bar lands. tuck one rep, flare the next, and the touch point moves with them

• pick a target and aim for it every rep. around the bottom of your breastbone is a good start for a lot of people
• on lighter sets take 2-3 seconds to lower it. that way you feel where it lands
• film from the side. feel lies on this one

an inch of difference between reps is normal

if we already set up your touch point a certain way, stick with it 🫡$l$, $j${}$j$::jsonb),
  ('46140e72-7cb0-4717-9c73-f08018cffa31'::uuid, '6974451d0f401ea31ea3e71803013950', $l$touch and go flies but paused reps die right off the chest?

part of that is just the stretch. lowering the bar right before you press helps. a pause bleeds some of that off

a 2013 study had lifters press from a dead stop. they handled clearly less than with a normal touch

the part you can fix is the pause itself. people relax on the chest, the bar sinks and the arch goes soft

• touch, dont rest. keep the weight in your hands
• pause rep 1 of every set like comp
• longer 2-3 second pauses on lighter sets

if you dont compete, touch and go is fine 👊$l$, $j${}$j$::jsonb),
  ('0f67ad71-5f56-4997-ad92-30acc2b0d10a'::uuid, '19572fcee7543e2d25e0c7d253cf1aa5', $l$caffeine is one of the few supplements with real research behind it for lifting

a 2018 look at the research found a small boost to max strength and jump power

small is the key word. nice bonus, not a new you

what the ISSN (a sports nutrition group) says
• 3-6 mg per kg of bodyweight, most often about an hour before
• as little as 2 mg per kg might work
• big doses mostly just add side effects

late caffeine can wreck your sleep. heart issues or pregnant? ask your doctor

never try a new dose for the first time on meet day$l$, $j${}$j$::jsonb),
  ('3d74ee17-0977-43fb-afee-84260874fd38'::uuid, '5322a950073d37b1b4f46ca3cfeb90e5', $l$does cardio kill your gains? way less than the gym myths say

a 2022 look at 43 studies compared lifting alone with lifting plus cardio

adding cardio caused no drop they could measure in muscle growth or max strength

what it did hold back was explosive stuff like jump height. mostly when both were done in the same session

where it can bite
• hard leg cardio right before squats or pulls
• so much that it eats into recovery or food

separate days or a few hours apart keeps it out of the way

thinking of adding a lot? tell me first 🤝$l$, $j${}$j$::jsonb),
  ('1e31e56e-15bd-4bf1-832f-9b7f8d66dd00'::uuid, 'e393257745e390749a92df9828f05f4d', $l$same weight, totally different feel from one week to the next. why?

your strength on any day isnt a set number. sleep, stress, food and leftover tiredness all move it

the max written in your program is a ballpark, not a promise

thats why a lot of programs pick top sets by RPE instead of a fixed %. good day, the weight goes up. rough day, it comes down and you still get good work in

a 2021 study had one group pick squat weight by reps left in the tank. over 12 weeks they gained more strength than the group on fixed percentages

not every study finds a difference

a lighter top set on a bad day isnt a failed session. thats the system working 🫡$l$, $j${}$j$::jsonb),
  ('77f02854-3721-4672-be75-e1e99a7869c9'::uuid, '88109d26af6f5d625f24e6f4b773dd65', $l$bar drifting off your legs mid pull? same weight, harder lift

bar drifts in front of midfoot? your hips and back have to fight to hold it. the further, the harder

the drift is usually a sign of something else
• the bar starting over your toes instead of midfoot
• hips shooting up, so your shoulders swing forward and the bar follows
• knees staying forward, so the bar has to go around them

think "drag it up your legs"

paused deadlifts just below the knee teach balance fast. holding a pause with the bar out front is really hard

send me a side vid before you rebuild anything 👊$l$, $j${}$j$::jsonb),
  ('3b590869-3aed-465b-8fc3-d50902864483'::uuid, '3a477887046b8b515e7f7538fddf6627', $l$a gym lockout and a meet lockout arent the same thing

in the gym? nobody red lights a hitch, soft knees or dropping it the second you stand. on the platform all three can

IPF style rules
• finish tall with knees straight and shoulders back
• the bar cant move down on the way up
• no resting it on your thighs
• hold still until the down signal

on heavy singles have someone call "down"

pick attempts you can lock out clean. a hitched gym PR wont count

anyone ever eaten a red light for it? 💀$l$, $j${}$j$::jsonb),
  ('0dbeab54-f659-41e3-bc07-af93cea4817d'::uuid, 'd0d671ebea80807b100b3154c2893840', $l$grip going before your back & legs do? usually very fixable

a lot of grip fails arent a strength problem. the bar sits mid palm, rolls into your fingers when its heavy, and your hand opens

• set the bar low in your hand, near where your fingers start
• chalk every heavy set
• pick one heavy grip (hook or mixed) and use it on warmups too

straps are fine on high rep sets and RDLs. theyre just not allowed on the platform$l$, $j${}$j$::jsonb),
  ('ab631b3e-500f-410f-835f-3176c61eac4b'::uuid, 'd23568bc15639a5ea5d24109bff4891d', $l$your heaviest singles probably dont start like your warmups

the research here is thin. a 2025 review looked at how experienced lifters deadlift as the weight goes up. it found only 2 studies

so nobody can tell you exactly what should change at your max

film every heavy single from the side and compare it to a warmup
• same change every time? you can train that position
• different every time? thats the real problem

still breaks the floor and locks out fast? thats probably just how you pull heavy$l$, $j${}$j$::jsonb),
  ('20623f74-f835-436c-9e22-1e67dabd9992'::uuid, '12776be0609ba7826f31569e6d06012f', $l$hips shoot up and the bar still hasnt left the floor? 👀

super common. and the hips usually arent the real problem
• you set up lower than you can pull from. so your hips rise until they find where you actually start
• no tension before the pull. so the hips move before the bar does

film from the side. where your hips are when the bar leaves the floor is your real start. so set up there

pull the slack out so the bar and your hips move together

short arms or long legs for your height usually means higher hips. thats your build, not a fault$l$, $j${}$j$::jsonb),
  ('9f5fce6b-1f81-4c8c-baf2-2d9dbeafe5ed'::uuid, '2a4fefa96373cea50b72151712dca864', $l$ripping the bar off the floor feels strong. it usually isnt

a loaded bar has some play in it. pull from loose arms and that slack gets taken up mid pull with a jolt. thats often when the back rounds or the hips pop

• pull the slack out first. pull until the bar clicks against the plates and feels heavy. then push
• brace before that slack pull, not after
• squeeze it off the floor. once youre tight, fast is fine

if your program has you on a dynamic start that pulls clean, keep it$l$, $j${}$j$::jsonb),
  ('dbfa319b-e92f-4e9c-bfcc-f4486ca51957'::uuid, '4bb8b35c7a6e7b7158559c65a2b61713', $l$slow off the floor or slow at the knees? different fix

off the floor its often setup. hips too low, slack still in, bar too far out

at the knees is sneakier. a lot of lockout problems start at the floor. hips shot up or the bar drifted? then you reach the knee in a worse spot and stall

the stall shows up late. the cause was early

film from the side. compare your spot at the knee on a slow rep and a fast warmup
• different spot? fix the floor first
• same spot, just slower? thats strength in that part of the pull

ask me before adding accessories off this 🤝$l$, $j${}$j$::jsonb),
  ('02d098fb-58bc-4243-9794-0e75dadd1fca'::uuid, '5ba1539d07f75365607228869aff357c', $l$a faster setup only helps if the bar still breaks the floor as hard

at this level its mostly wasted steps. hip bounces, re-gripping, sitting in the bottom holding your breath. each one can cost you grip and brace

but cut the steps that build tension and the pull gets weaker

in a small 2018 study people pulled on a bar that couldnt move. they tried it closer and further over the foot. which muscles worked harder changed. total force into the floor didnt

• same order every rep, warmup to max. grip, breath, wedge, go
• test changes on heavy singles over weeks, not on warmups

breaks fast and looks the same every time? leave it

whats your setup order? 👀$l$, $j${"title": "A quicker start without losing force"}$j$::jsonb),
  ('f551c7c3-f381-406e-a6db-edc6a1b38ad2'::uuid, '2d3595066dc84b1b8570afbf98f83b67', $l$sumo doesnt mean squatting the bar up

a lot of sumo pullers drop their hips as low as theyll go. why? it feels strong. then the hips rise before the bar moves

• set your hips where they are when the bar leaves the floor. not as low as they go
• shins close to straight up, knees out over your toes before the pull
• knees still in the way? small changes to width or toe angle. one at a time

hip sockets vary a lot. so a stance that works for someone else might not fit you

higher hip sumo is fine if the bar moves well. upright isnt the goal. a strong pull is 💪$l$, $j${}$j$::jsonb),
  ('105cf0d4-49a4-440e-a08c-361f46030bf9'::uuid, 'de87f1bf6bb74ed9ddb046b00a8c37bc', $l$a deload doesnt make you stronger. it lets you show what you built

hard training builds fitness and fatigue. fatigue fades faster when you back off. so a lighter week lets your lifts come back without losing much fitness

a 2024 survey of 246 strength and physique athletes found they deload about every 5-6 weeks

a full week off isnt magic though. in a 2024 trial the group that kept training came out ahead on leg strength

a deload is lighter training. fewer sets, more reps in the tank, same lifts

if one is in your plan, its there for a reason 🫡$l$, $j${}$j$::jsonb),
  ('c8b673f8-ba5c-47c3-8d93-d2844ad50269'::uuid, '4c6550b65dfc1059410ab0f57609eca6', $l$Mike Mentzer took his sets past failure. research says you just need to get close

his Heavy Duty training added forced reps and negatives (just the lowering part) after failure. he won the 1978 Mr. Universe heavyweight class with a perfect 300 score

two big reviews since then
• one found going to failure wasnt clearly better for growth than stopping a bit short
• the other found growth went up the closer sets ended to failure. strength looked about the same across a wide range

so for accessories, ending around 0-3 reps in the tank is a good zone. sets with 5+ reps left probably do less

comp lifts are different. we keep those further from failure on purpose 🫡$l$, $j${}$j$::jsonb),
  ('b463a75f-7533-465e-8e20-5cf98bb55e04'::uuid, 'f148cf155bda2849d7d12e7003cad2e9', $l$how does doing less make you lift more?

every session gives you two things at once. fitness and fatigue. what you can lift on the day is about fitness minus fatigue

fatigue builds fast and clears fast. fitness builds slow and fades slow

so when you pull back for a bit, fatigue drops way quicker than fitness. and the strength you built finally shows up

thats a taper

a 2007 look at the research found what worked best. about 2 weeks of cutting your sets and reps by roughly 40-60%. the weights stayed just as heavy

pull back too long tho and fitness starts fading too. thats why tapers are short 🏆$l$, $j${}$j$::jsonb),
  ('91367cb0-d02e-4a86-b797-ef2e56ddfd64'::uuid, '8548cccc4a59105f35f1a26921e9b22d', $l$your max is supposed to look slow. your push shouldnt be

muscle makes less force the faster it shortens. at a true max you barely push harder than the bar weighs. so it can only crawl

a 2014 study put 20 regular gym-goers on the same 6 week bench plan. one group pushed every rep as fast as they could. the other went half speed on purpose

their max went up 18% vs 10%

a 2023 look at 24 studies found fast ahead too. but only by a little

my read: slowing the way up on purpose costs you a bit. already pushing every rep? theres no extra to find

picture the slow spot in your bench as a gap. you coast through it on the speed you built below it. my bet: thats where the push pays off. faster in, further through

on a grinder that means full push from the first inch. dont save it for the slow spot and never ease off

unless its tempo work, the weight sets how fast it can go. you set the push 💪$l$, $j${}$j$::jsonb),
  ('39dd293e-343c-41f1-a5b8-c36e069d719d'::uuid, '55a1621951192a70acb92f6c073af8e7', $l$is hitting a muscle 3x a week better than 1x? less than you think

a 2019 look at 25 studies checked this. when weekly sets were the same, more sessions didnt clearly grow more muscle. the edge only showed up when more sessions also meant more sets

so training more often is mostly a way to spread your sets out. 15 sets for one muscle in one day gets sloppy. split over 2-3 days, more of them are good sets

it matters more for the lifts themselves. Boris Sheiko became head coach of Russia's national powerlifting team. his lifters squat and bench several times a week. the weights average around 70% of max

thats practice, not just muscle$l$, $j${}$j$::jsonb),
  ('4adeb525-9cb5-4e9c-ade3-4e081fd2cf1e'::uuid, 'e286fa65911fc865ab6406f8752c695a', $l$cutting accessory reps short? the bottom half is the part to keep

when half reps lose to full reps its usually for one reason. they skip the stretched part of the rep

studies looked at leg extensions and calf raises. half reps in the stretched half grew as much or more than full reps. half reps in the other half, where the muscle is short, grew the least

newer work in trained lifters mostly finds the two about equal

so full reps are a safe default. if you go partial, keep the stretched end

accessories only. comp lifts still go to comp depth 🫡$l$, $j${}$j$::jsonb),
  ('98f80851-7bad-4a75-89a2-e37d5ee7d573'::uuid, 'f29c12528c86e5d9c2c49a5d03a4e58d', $l$Bulgarian weightlifters worked up to a heavy single almost every session

their coach Ivan Abadjiev's teams won 57 world titles. not saying copy it. but it shows something. lifting a max is a skill, not just a test

a single has a slower bar, more pressure and more nerves. your positions have to hold the whole way. only feel that on meet day? then youre doing a new skill under max pressure

a small 2017 study had one group just practice their max for 8 weeks. another group did 4 sets to failure. strength gains came out about the same

thats why singles get built in before a meet. not to test. to practice

the ones in your program are there on purpose. this isnt a pass to max every day 💀$l$, $j${}$j$::jsonb),
  ('582e66fa-1685-4497-9f24-3362fcb336d3'::uuid, 'c2e9bb11b71efce4c689b22096257973', $l$Michael Phelps played a perfect race in his head every night and morning

his coach Bob Bowman called it watching the videotape. in the 2008 Olympic 200m butterfly final his goggles filled with water. he counted his strokes and still won gold in world record time 🥇

can picturing a lift make you stronger? kinda. a 2018 look at the research found just picturing it made people stronger than doing nothing. a medium sized boost. real training still beat it

where it fits for us is practicing meet day in your head. the walkout, the commands, your setup, the grind if the rep slows down

• same speed as the real lift
• picture the real place
• put the hard part in, not just the lockout$l$, $j${}$j$::jsonb),
  ('9329b64b-8189-4625-91b9-a6dbcadce0e2'::uuid, 'a3caeaee39c2fb7c3953d715a3b04c63', $l$exams, work chaos, a breakup. your training notices

a 2008 study followed 135 students through 12 weeks of lifting. the ones with less stress in their life gained more on squat and bench

that doesnt prove stress caused it. stressed people might also sleep less or miss more sessions. but later studies tied more stress to slower recovery after hard sessions too

think of recovery as one bank account. the gym and life both spend from it

in a rough week showing up still counts. and tell me. we can change the week so youre not grinding through it 🤝$l$, $j${}$j$::jsonb),
  ('bf26b213-c0b1-4dab-944f-abe04945b937'::uuid, '96d873586b53199fc7d639a6ce56d69a', $l$"Everybody wanna be a bodybuilder, but nobody wants to lift no heavy ass weight"

Ronnie Coleman, 8x Mr. Olympia 🏆

for strength hes right. for growth, light works too. if its hard

a 2017 look at 21 studies tested light vs heavy. light meant 60% of your max or less. sets went to failure. growth came out about the same. max strength went up more with heavy

the catch: a light set only works when it gets hard. the first 10 reps of a 25 rep set are easy. its the grindy reps at the end that count

so comp lifts stay heavy. accessories can live anywhere from about 6 to 20+ reps$l$, $j${}$j$::jsonb),
  ('7e7499c4-2f43-4bbf-b332-5c8dedaee491'::uuid, '9adb96c81c47097656e1d8381b33f6ae', $l$same muscle, different exercise, different amount of growth

two studies had people train one arm or leg each way for 12 weeks
• seated leg curls grew the hamstrings more than lying ones (about 14% vs 9%)
• triceps grew about 1.4x more with the arm overhead than at your side (cable extensions)

in both, the winner worked the muscle more stretched out

small studies, mostly people new to lifting. but picking an accessory? the one that loads the stretch is a good bet

anyone actually feel the difference? 👀$l$, $j${}$j$::jsonb),
  ('df26a831-52bd-4f27-8f62-33e2f8f1c97b'::uuid, 'a628625573c29f9336e9576e9719e85f', $l$machines arent cheating. for growth theyre often the easier pick

a 2023 look at 13 studies compared free weights and machines. muscle growth came out about the same. strength stuck to the tool. free weights did better on free weight tests

thats the part for powerlifting. the barbell builds barbell strength. machines can build the muscle behind it

theyre also easier to take close to failure. youre not spending effort on balance

not every machine fits every body. if one feels awkward swap it 🤝$l$, $j${}$j$::jsonb),
  ('d57b2fe8-5a48-4355-b132-ad669413eaaf'::uuid, 'e000308fa24243daa008fcc5e8b2a5b5', $l$Rafael Nadal lined up his water bottles the same way every match. not superstition

"It's a way of placing myself in a match," he wrote,
"ordering my surroundings to match the order I seek in my head."

thats what a routine does under pressure. pressure makes you think about moves that normally run on autopilot. and thinking your way through a squat youve done 1000 times rarely helps

a routine gives your focus a job

a 2021 look at the research tested routines like this. in experiments people did better with them. under pressure too

build yours in training
• same steps every time. chalk, walk up, hands, breath
• one cue, not five
• keep it short. most feds give you about a minute to start the attempt$l$, $j${}$j$::jsonb),
  ('9c600187-51c2-44e8-8785-5a72733af348'::uuid, '3d9000d6544207a897eec0e417e83434', $l$Arnold paired chest and back in supersets. research says he was onto something

think bench press straight into chin ups. one muscle rests while the other works

pairs that work
• rows + DB bench
• curls + pushdowns
• leg curls + leg extensions

a 2025 look at the research found supersets cut session time. they didnt cost strength or size. opposite muscle pairs even got people more reps than straight sets

the catch: they feel harder. and holding two stations in a busy gym is a pain 😭

keep heavy squat, bench and deadlift as straight sets. pair the accessories after$l$, $j${}$j$::jsonb),
  ('7b6f292f-bd84-4d55-8294-0e072ff45f97'::uuid, '99700e587f3ac509b62eef161420b23f', $l$should you think about the muscle or the bar? depends on the lift 🧠

on squat, bench and deadlift, cues about the bar and the floor usually win. push the floor away. bar to the same spot

a 2021 look at the research found people were a little stronger in the moment. thats when they focused outside the body. how big that edge is still gets argued. but it rarely hurts

small lifts like curls are kinda flipped. in a 2018 study guys new to lifting did curls. one group focused on squeezing the muscle. the other on moving the weight

the squeeze group grew their arms more (12.4% vs 6.9%). quads grew about the same either way

so bar & floor on the big lifts. feel the muscle on curls, raises and flyes$l$, $j${}$j$::jsonb),
  ('d740da28-46d6-4dc3-813a-e40de5d85546'::uuid, 'c3b0011e80c2e808a7452686842cbd34', $l$Arnold used cheat reps on curls. just not the way most people do 🤣

strict until he couldnt get another rep. then just enough body swing to squeeze out a couple more

fine when
• its the last 1-3 reps of curls, lateral raises or rows
• youve already hit failure with clean reps
• the way down stays strict

a waste when
• youre swinging from rep 1. the weight is just too heavy
• its squat, bench or deadlift. theres no cheat rep there, just a bad rep

the cheat should help the muscle finish the set. not do the set for it$l$, $j${}$j$::jsonb),
  ('56a19b2f-af47-4ffe-80e7-4c9d708b6dc4'::uuid, '76ad445442a591c997d1d16433eddd5e', $l$why does rep 5 of a heavy set look so different from rep 1?

bar speed drops through a set as you get tired. so the last reps are the slowest and usually the ugliest

cluster sets put short rests inside the set. instead of a straight 5, you could do singles. 15-30 seconds between each. or 2+2+1

research says they keep bar speed up in the session. long term, strength and size gains come out about the same

so its a tool for cleaner reps, not a strength hack. handy when you want every rep to look like the first one 👊$l$, $j${}$j$::jsonb),
  ('7c6279df-fb5b-455c-9b46-ace09c8f3d51'::uuid, '33b4e0e620a72fe375227808d0da2e9b', $l$drop sets wont build more muscle. but they can save a ton of time

go close to failure. strip about 20-30% of the weight and keep going with no rest. maybe drop once more

two big looks at the research found they grow muscle about as well as regular sets. in some studies they took a half to a third of the time 👀

use them on the last set of a machine or a one muscle move like curls. skip them on the main lifts. stripping plates at failure is a mess

want to try one? a single drop on the last set is plenty$l$, $j${}$j$::jsonb),
  ('06077823-924a-4f43-8e68-348ab0f29781'::uuid, '837f5779cb7d4b36fbc9b7460768e126', $l$in the early 80s SuperSlow had people take about 10 seconds to lift a weight

Ken Hutchins built it during a study that Nautilus paid for. so do slower reps build more muscle? not past a point

a 2015 look at the research checked this. reps lasting from about half a second to 8 seconds all grew muscle about the same. really slow reps (10+ seconds) looked worse. probably because you have to go way lighter

controlling the way down still helps. same position every rep, no bouncing out of the bottom. it just wont double your gains to go from 2 seconds down to 4

got a 3 second way down on squats or a long bench pause in your program? thats there for technique. keep it 🫡$l$, $j${"title": "Super slow reps aren't magic"}$j$::jsonb),
  ('2e21baf1-ee1a-4199-a4f0-e508173f6d3f'::uuid, '2f0f878b4e2cddc381146a0ea17a1693', $l$drop sets and failure sets arent free. you pay for them on squat day

drop sets, rest pause, failure sets on leg press. they add a lot of fatigue for a little extra reason to grow

sets to failure take longer to recover from than stopping short with the same total reps. the gap shows over the next 1-2 days

and strength gains barely change with how close to failure people train

so for strength, failure buys very little and costs a lot of recovery

using them?
• one muscle moves only (curls, raises)
• last set only
• first to go if your main lifts feel flat or a meet is close$l$, $j${"title": "Drop sets and failure aren't free"}$j$::jsonb),
  ('f2e625d9-3140-4cf2-a5fa-2773d4557531'::uuid, 'a5e4884b044f374f67686644859c9d8f', $l$hit failure on full reps? the bottom half might still have more in it

stretched half reps are reps in just the stretched part. bottom half of a curl. bottom of a leg press

to stretch out a set: go to failure with full reps. then grind out 3-5 half reps at the stretched end. more out of the set without adding another one

a 2025 study had trained lifters train one arm each way. both grew about the same

research on doing them after failure is thin. so its a tool, not a must

good on machines, cables, curls and calves. never on squat, bench or deadlift 💀$l$, $j${"title": "Stretched half reps after failure"}$j$::jsonb),
  ('6b534684-090a-4473-ae7e-510643ba285e'::uuid, '55060a9f35cefcb2697654345776290f', $l$short on time but want your accessories to count? try myo reps

Norwegian coach Børge Fagerli came up with them in the mid 2000s
• one starter set, 1-2 reps shy of failure
• rest 3-5 deep breaths, then 3-5 more reps
• repeat until you cant hit the mini set

every mini set lands close to failure. so you get a lot of hard reps fast

an 8 week study in trained guys tested rest pause sets. they grew muscle about as well as regular sets

great for cables, machines, curls, raises and calves. not for heavy barbell lifts

accessories written as straight sets? ask me before you swap. anyone tried these? 👀$l$, $j${}$j$::jsonb),
  ('177d285e-66e4-4b8b-9a87-581deb0fbb53'::uuid, '4a964d5e4e5f7aa460e5b4b4d234e42e', $l$your squat drifts to one side. that doesnt mean the other leg is weak

a 2007 study of 18 everyday lifters looked at squats. one side tended to do more of the work at the hip. the other side did more at the knee

my take: uneven isnt weak. most drifts start in your setup, mobility or habit

check in this order
• pain or an old injury there? that first
• bar centred, hands even, feet measured?
• film it. still there at 60%? nothing is near its limit there. so its likely how you move
• same side near your max and in single leg work, for weeks? thats a real gap

then split squats earn a spot. weak side first, match the reps. also after an injury, or for leg work thats easier on your back

otherwise they cost time. a 2022 look at the research found two leg training builds two leg strength. a bit better than one leg work does. what I think: its partly a skill

send me a vid before you program 5 sets of lunges 👀$l$, $j${}$j$::jsonb),
  ('80cbf126-eb32-4536-82e3-b373604fbcb7'::uuid, 'd39f1a405c5da2c679062664fa9031df', $l$if your warm ups are tiring you out, theyre not warm ups anymore

warm up sets have one job. practice the lift and get you ready for the heavy set

a simple ramp, as a % of your top set
• the empty bar first
• 40% for 5
• 60% for 3
• 75% for 2
• 85-90% for a single

the jumps get smaller and the reps drop as the weight climbs

common mistakes: long sets once the warm ups get heavy. and going straight from your heaviest warm up into the top set. give that one a real rest

program lists specific warm ups? use those 🫡$l$, $j${}$j$::jsonb),
  ('d4752d81-f98f-44ec-b681-86e75bf4a94c'::uuid, '9493da941293e95a1b723f6e32828b3e', $l$ever wonder why your squat looks nothing like someone elses?

its how youre built. the bar has to stay over the middle of your foot or you lose balance

long thighs vs your torso? your hips sit further back and you lean more. shorter thighs, more upright

neither is wrong. more lean puts more of the work on your hips and back. more upright puts more on your quads

so dont copy how much someone leans from their highlight video. what looks off on them might be right for your build

think yours is off? send me a vid first 👀$l$, $j${}$j$::jsonb),
  ('4fe944ea-34ba-43df-9f35-a965bb8c4456'::uuid, '516983f3204b8a50856d8060114f819f', $l$athletes got stronger on fake steroids. old research, wild result 💀

in 1972 researchers told varsity athletes some of them would get steroids. the ones picked got fake pills instead. they gained more in 3 of 4 lifts than in the weeks before

its tiny and over 50 years old. so dont trust the exact numbers

but a 2000 study found something like it in competitive powerlifters. when half were told the truth midway, their extra gains mostly faded

the takeaway isnt go find sugar pills. belief changes how hard you push

reps youve already hit are how you build that belief for real 💪$l$, $j${}$j$::jsonb),
  ('24a13211-5cb4-40b0-a7c9-6aaf45569322'::uuid, '7c49234a07abf4e8cfbcb65227502d31', $l$Nick Saban built 7 national titles on one idea. forget the scoreboard

he called it the Process. do this rep, this play, this day right

research backs him up. a 2022 look at 27 studies in sport found process goals helped performance the most. outcome goals barely moved it

• outcome: hit a total, win
• performance: a 5kg squat PR
• process: fully in your control. pause every first bench rep, hit every session, in bed by 11

keep the big goal. write 2-3 process goals under it for this block 🫡$l$, $j${}$j$::jsonb),
  ('5ad05ebe-9b2f-4609-b3d2-73c8f609d73c'::uuid, 'd4ad911726b4c7bc2456fecdd4e66f63', $l$legend says Milo of Croton carried a calf every day. til it was a full grown bull

its the oldest picture of adding a little over time. ask a bit more of your body as you go

more weight is the obvious way. its not the only one
• same weight, more reps or sets
• same weight, lower RPE or faster bar speed
• same weight, cleaner reps

a single that was RPE 9 last month and moves at RPE 7.5 now? thats real progress 🔥

judge it across a block, not one session$l$, $j${}$j$::jsonb),
  ('89e75668-36c8-4ec1-886c-8b06e2726735'::uuid, '04baa586a53eefb593f6027e6fc6b857', $l$how much protein do you actually need to build muscle?

a 2018 look at 49 studies checked this. gains kept going up until about 1.6 g per kg of bodyweight a day

after that they flattened out

thats about 0.7 g per lb of bodyweight. the top of their range was about 1 g per lb

so a 198 lb lifter wants about 145 to 200 g a day

hitting your total most days matters way more than timing or shakes

on a dietitians plan? follow theirs 🙏$l$, $j${}$j$::jsonb),
  ('56298d4e-dd4b-48cb-9636-3f3db551d74b'::uuid, 'ca65ed5060371729bcbe51a906029fa5', $l$how hyped should you be before a max? depends on you

some lifters scream before a big attempt. some go dead quiet

a 2024 look at 27 studies checked this. getting hyped up helped max force in about 65% of tests

but most of those people were students and newer lifters. so for experienced lifters its less clear

too amped looks like a rushed setup and missed commands

too flat looks like the bar feeling heavy before you even unrack it

where do you land? 👇$l$, $j${}$j$::jsonb),
  ('b0a4830d-1e78-4f56-ab10-d908fe181a6e'::uuid, 'c925e00979854a71a79993b9b6f7ec92', $l$sore doesnt mean youre not recovered. not sore doesnt mean you are

a 2002 study had students do 12, 24 or 60 hard lowering reps for their arms

more reps cost more strength and took longer to come back. but how sore it felt when pressed? about the same in every group

the worst soreness comes from stuff thats new or lowered into a stretch. think RDLs and deep lunges

the second time hurts way less, even months later. so dont judge a program by week one

fatigue is what to track. a small 2023 bench study looked at it

sets that stopped 3 reps short were back in a day

failure and 1 short were still a bit slow. two days after the session they were all even

my test: same warm up weight and reps every session
• usual speed and usual RPE? train
• slower, or a full RPE heavier? back off, sore or not

my take: two days apart, a rep or two short is fine. same muscle the next day? stop 3 short

save failure for before a day off$l$, $j${}$j$::jsonb),
  ('efa3d76c-3dcb-43b5-ae8b-2578ec5a7c56'::uuid, '5c60bc627edd52c2d856f228af83ee06', $l$Sunday reset. clear some noise before the week starts

you cant focus on your training with 40 other things fighting for your attention

tonight
• mute the accounts that leave you feeling behind
• pick ONE goal for the week, not five
• do not disturb on while you train. the texts can wait an hour

a quieter head lifts better 🤝$l$, $j${}$j$::jsonb),
  ('3f8ad278-cd00-4610-af07-b7b2598decd0'::uuid, 'eb9797e72325d931a02e8b85e5a07f21', $l$Sunday reset. before you plan the week, count last weeks wins

most of us remember every missed session and forget the 3 we crushed

• write down 3 wins. a rep PR, a session you almost skipped but did, a week of good sleep. small ones count
• one thing youre proud of
• pick one to repeat this week

you train better from "look what I did" than from "look what I missed" 🙌$l$, $j${}$j$::jsonb),
  ('e80a571e-986a-4279-a802-c6c0a86669d3'::uuid, '5910a14d4a64725b0871f9005474c2a8', $l$Sunday reset. make this weeks food easy before youre hungry

most nutrition goes wrong on a busy Tuesday at 7pm. not at the grocery store. so set Tuesday up now

tonight
• cook 2 protein sources you can grab all week
• buy fruit and veg youll actually eat. not the ones you think you should
• plan Monday and Tuesday meals. the rest gets easier

you dont need perfect meal prep. you need a fridge that makes the good choice the easy one$l$, $j${}$j$::jsonb),
  ('3dbc596d-75ef-4cb1-96ef-a82ea56232c4'::uuid, '9d5605021d4f8dd0f389f944fe427994', $l$Sunday reset. plan for the stuff thats going to go wrong

you already know something will get in the way this week. a late meeting, a kids game, a night out

make an if-then plan for it. "if I work late Tuesday then I train Wednesday at 6am"

a 2006 look pulled together 94 tests of these if-then plans

the boost in people actually reaching their goals was medium to large

tonight
• name your hardest day this week
• write your if-then for it
• pick a backup time

plans that expect problems survive them 💪$l$, $j${}$j$::jsonb),
  ('f94557f3-fb4f-4625-9f65-97f23db9c853'::uuid, '655900931e2e51734a6c8b500f8cab72', $l$Sunday reset. look back before you plan ahead

most people start every week fresh and repeat the same mistakes. two minutes looking back fixes a lot of that

ask yourself
• what went well last week?
• what got in the way?
• whats one thing to do different?

just one. not a whole new life on Monday. one thing, done all week$l$, $j${}$j$::jsonb),
  ('f9ee39e9-ccbe-4626-b71a-32510a75e28b'::uuid, '6fd26c513abfc4515215cb5045d3ead5', $l$Sunday reset. decide your minimum before the week gets busy

some day this week is gonna go sideways. decide now what youll do when it does

that way you dont decide on the spot to do nothing

your bad day plan
• write a 20 minute version of your session
• main lift and one accessory. thats it
• never skip twice in a row

short sessions keep the habit alive. skipped ones dont$l$, $j${"visual": {"items": ["Write your 20 minute version", "Main lift + one accessory", "Never skip twice in a row"]}}$j$::jsonb),
  ('75231436-8dcf-4aa0-bbd1-e3fef6a8f697'::uuid, 'c440b454296be8235c9860b3cb032ff8', $l$Sunday reset. pick one thing to get better at this week

not ten. ONE

• one cue for your main lift. brace before you unrack. push the floor away. same touch point every rep
• one habit outside the gym. protein at breakfast. a daily walk. in bed by 10:30
• write them down where youll see them

a small focus done all week beats a big plan you forget by Wednesday$l$, $j${}$j$::jsonb),
  ('18c28d3b-0e8c-4d3e-ab36-1a86f5da028c'::uuid, 'df9302d792e460d219d6a8d31a8bc4cb', $l$Sunday reset. plan the week before it plans you

if your sessions arent on the calendar theyre fighting with everything that is. work, family and plans win every time

take 5 minutes tonight
• put your training days in the calendar, with times
• pick the one session you wont skip no matter what
• pack your bag so tomorrow is easy

a week you planned on Sunday goes way better than one you figure out on Monday$l$, $j${}$j$::jsonb),
  ('20b4801a-ec84-4f3f-9312-46bcd0024a4c'::uuid, 'bd609e001e78bafe87736c2c846e8b2a', $l$Sunday reset. check in with your body before you ask anything of it

rate these 1 to 5, 5 being good
• sleep
• stress
• soreness, or anything nagging

all 3s and up? train as planned

something at 2 or lower? dont wait til Wednesday to find out. plan an easier day, an extra rest day or a swap for whatevers sore

changing the plan on Sunday is smart. grinding through it on Thursday isnt$l$, $j${}$j$::jsonb),
  ('b161823d-18dc-430b-a2dc-8e1993d6006e'::uuid, '561ce6e65f5a77f2d7f29678651a7365', $l$Sunday reset. plan your rest days as carefully as your training days

rest isnt time off from the program. its part of it

this week
• put your rest days on the calendar on purpose. dont just let them happen
• keep them easy. a walk, some mobility, nothing that leaves you wrecked
• still eat your protein. youre recovering, not off the clock

a good week of training needs a good week of recovery around it$l$, $j${}$j$::jsonb),
  ('47ed63fc-d2d9-4262-878e-939e159eba77'::uuid, '2e2e61e0a40e56a24144d5ef0f86ef74', $l$a bad night costs your max less than you think. a bad week is the problem

a 2022 look at 69 studies checked short or no sleep. strength dropped about 3%. skill tasks dropped about 21%

nights in a row are different. in a 1994 study a small group of men slept 3 hours a night

they did it three nights in a row. their high rep sets dropped by night two

their max bench, leg press and deadlift dropped too

most of this research is small, mostly men and few lifters

how I read it: one short night costs a heavy single a little. a short week costs your reps and your max

this week protect the run
• same wake time every day of the week
• caffeine done 9 hours before bed. training at night? skip the pre
• my take: set a bedtime alarm 8.5 hours before you wake up. you wont sleep every minute of it

slept bad anyway? warm up and judge the bar, not the night$l$, $j${}$j$::jsonb),
  ('ad0034b8-8ba0-49b1-9b80-433848dbf29b'::uuid, 'a9f80844baae9950d4d705e3f17137b1', $l$Sunday reset. you train maybe 4 hours a week. look at the other 164

what you do outside the gym matters. for recovery, for hunger and for how you feel walking into your next session

this week
• pick a daily step goal you can actually hit. not someone elses 10k
• a 10 minute walk after one meal a day
• take the stairs or the long way once a day

easy movement helps you recover. it doesnt take away from your lifting$l$, $j${}$j$::jsonb),
  ('0fd2c916-84d2-4e0a-b234-109c7d42e4d8'::uuid, '6c2d31b83e751524481c31dd59cb977d', $l$Sunday reset. remember why you started

motivation fades. a reason doesnt, if you can see it

• write your why in one line. not "to be healthy". something real. keep up with my kids. total 500 this year. feel strong in my own body
• pick one goal for 12 weeks from now
• put it somewhere youll see it every day

on the days you dont feel like it, your reason does the work 🫡$l$, $j${}$j$::jsonb),
  ('f1f22128-5c52-47be-8fe8-2fdf8212e155'::uuid, 'a70d3ceb7692279c0f994df2763de09d', $l$resting 60 seconds to keep the pump isnt the growth hack it was sold as

in a 2016 study trained guys ran the same program. some rested 1 minute and some rested 3

the longer rest group gained more strength and grew a bit more

probably because they kept more reps and weight on the bar each set

a 2024 look at the research found a small edge for resting longer than a minute. past about a minute and a half there wasnt much difference

so rest long enough that your next set is a real set

big lifts like squats often need 2 to 3+ minutes. curls and raises, 90 seconds is usually plenty$l$, $j${}$j$::jsonb),
  ('3d5e7a89-f364-4990-9a6f-46d3d87bbdc3'::uuid, '731c948fe377b4d30a7d9e4b4b9cd6d9', $l$your RPE 6 is a guess. your RPE 9 is way more accurate

a 2022 look at the research checked how well people guess their reps left

overall people guessed about 1 rep too low. most of us have a bit more in the tank than we think

guesses got better closer to failure, and in sets of 12 or fewer

near failure the bar slows way down. so you can feel it coming

low RPE calls are rough guesses and thats fine. top sets at 8 to 9 are where your call matters most

how close do you think your calls are? 👀$l$, $j${}$j$::jsonb),
  ('5ae9422e-57d1-4121-9a0f-a713b732b0c4'::uuid, 'cd2564d62c46258211983474435a2c7d', $l$RPE 8 doesnt mean 8/10 hard. it means 2 reps left

powerlifting got this version of RPE from a lifter. Mike Tuchscherer, a World Games champ

he tied each number to reps left in The Reactive Training Manual

RPE 10 = nothing left
RPE 9 = 1 left
each number down is one more rep left

researchers built on his work in 2016. they found counting reps left is way clearer than rating how hard a set felt

right after a set ask yourself
if I had to, how many more clean reps could I do?

thats your number. not how tired you are. just whats left in the tank$l$, $j${}$j$::jsonb),
  ('d9a32986-f17d-4633-a332-5723ddb2194e'::uuid, '6906c7e1c44bcbb1ca52d1b85d16f8a4', $l$want to know if something works for YOU? test one thing at a time

change 5 things at once and you cant tell what did it

• pick ONE thing. bedtime, caffeine timing, a warm up tweak
• decide what youll track first. top set RPE, bar speed, a 1 to 5 energy score
• do 2 weeks as normal first so you know where you start. then 4 weeks with the change
• compare the averages, not your best day

one great day is noise. a trend over weeks is info

anything touching your sets, reps or exercises, we set it up together first. what would you test? 👇$l$, $j${}$j$::jsonb),
  ('019ea0d6-ccf1-4445-b401-77ef5ac7193e'::uuid, 'd3e8088b5ab9b2932b98c8f600832873', $l$Muhammad Ali called himself the greatest before he won the heavyweight title

he even put out an album called I Am the Greatest in 1963. months later he beat Sonny Liston as an 8 to 1 underdog 👀

the research on self-talk is less wild. but its real

a 2011 look at 32 studies found it helped performance a moderate amount

it helped most on skills that need to be precise. and on stuff people were still learning

2 kinds
• how-to cues: chest up, push the floor
• hype: lets go, you got this

people who practiced their self-talk ahead of time got more out of it

so pick one short phrase. use it on every top set

whats yours? 👇$l$, $j${}$j$::jsonb),
  ('27c07068-dc67-468a-a851-9155ca3c0ad9'::uuid, '9eea337901fd5f4266f60b10fe68345b', $l$Stanford had its basketball team spend 10 hours a night in bed 👀

11 players slept like normal for a few weeks. then they tried to stay in bed that long for over a month. they ended up sleeping almost 2 hours more a night

their free throws went from 79% to 88%. their sprints got faster too

but its 11 guys on one team with no group to compare to. a clue, not proof

you probably dont need that much. but if youre living on 6, more sleep is the cheapest recovery there is

easy start: same wake up time, bed 20 min earlier 🫡$l$, $j${}$j$::jsonb),
  ('2fd79476-4017-4cca-9fcb-5e550a18a2ff'::uuid, '348c511325bfb6ea903dcb73137eea16', $l$not sore after a session? doesnt mean it didnt work

soreness mostly tracks how new or different the work was. thats why it fades as you get used to a program, even while youre still growing

in a 2011 study one group was eased into a hard program. that way they avoided muscle damage. another group got thrown straight in

the thrown in group was way more sore. both gained the same size and strength

soreness isnt the scoreboard. reps and weight creeping up over the weeks is 💪$l$, $j${}$j$::jsonb),
  ('b0be4a2e-59f7-42a7-ab50-183aad13d9d2'::uuid, '73c2c5d79e60f5bd1d49ac306f0de340', $l$why do we squat to get better at squatting? 👀

your body gets better at exactly what you make it do. it even has a name: SAID

strength isnt just muscle. its muscle plus practice of that exact lift at that kind of weight

thats why a huge leg press doesnt automatically mean a huge squat

a 2017 look at the research compared heavy and light weights. heavy built your max more. and muscle growth was about the same

variations still matter. they build muscle, hit weak spots and give your joints a break

they feed the main lifts. they dont replace them$l$, $j${}$j$::jsonb),
  ('ff2c736a-f5db-48c7-9384-1106a82c1198'::uuid, '5f28d997b46798407e64bc2e68ab64ad', $l$bar sliding down your back on heavy singles but not on lighter sets?

under more weight the shelf your upper back makes can go soft

as the bar slips you lean more to keep it over midfoot. then your wrists and elbows start holding weight

usually its
• the bar a bit lower, or in a different spot set to set
• upper back not squeezed tight before you unrack
• a slippery shirt and no chalk

squeeze the bar into your back in the same spot every set. warm ups too

chalk your shirt where the bar sits

dont move your bar position near a meet without talking to me. it changes the whole squat$l$, $j${}$j$::jsonb),
  ('d629d449-c692-404e-b67c-9ebfc6001907'::uuid, 'ad09aa5bee9182fbb6a8cd7a9cafe705', $l$tight at the top but soft at the bottom?

thats your brace leaking. usually the breath goes into your chest instead of your belly, sides and back

or a little air sneaks out on the way down

a belt gives you something to push against. it doesnt brace for you

• big breath before every rep. belly out into the belt like youre about to get punched
• hold it through the hardest part. breathe at the top
• 2 second pause squats. lose it in the pause and youll lose it in the squat

blood pressure or heart issues? check with your doctor before long breath holds

drop the cue that clicked for you 👇$l$, $j${}$j$::jsonb),
  ('de2f8a6f-2216-4fce-87b1-fdcb92c3b9e8'::uuid, '2062c41cab089d5e8a436b5a91db9bf5', $l$think youre hitting depth? the camera might disagree 👀

in a meet your hip crease has to drop below the top of your knee. thats lower than most people think

why people miss it
• your thighs feel parallel way before youre actually deep
• filming from the front or above makes high squats look deep
• depth slowly creeps up as the weight climbs

film from the side at hip height. hit the same depth every rep, warm ups too

a high warm up wont turn into a deep single

dont compete? then depth is your call, not a rule$l$, $j${}$j$::jsonb),
  ('00168290-f916-4522-bbf9-c651f43afc5f'::uuid, '19a5538c3a9325da8d87e3eeecb23f78', $l$hips shoot up first and your squat turns into a good morning?

usually your quads are the weak link. tipping forward moves the work off your knees and onto your hips and back

or your upper back goes soft. the bar rolls forward and your chest follows it

what helps
• drive your upper back up into the bar so hips & chest rise together
• pause or tempo squats to own the bottom
• front squat way behind your comp squat? quad work beats any cue

long thighs and a short torso need more lean. thats your build, not a fault

only on the last grinder of a set? thats just fatigue. send me a vid before you change anything$l$, $j${}$j$::jsonb),
  ('ca29c6da-58be-4eb7-8de5-bb848f5f9c4d'::uuid, 'b1319db1f613ed5990e0388d16b323fb', $l$heels coming up at the bottom of your squat?

its usually one of three things
• ankles that dont bend enough yet, so your weight rolls forward
• a stance that fights your hips. a bit wider or more toes out helps some people
• starting the squat by shoving your knees forward. sit down between your feet instead

keep your whole foot on the floor. bar over midfoot the whole way down

slow 3 second goblet squats teach you where your balance is

lifting shoes help too. a 2017 study found people squatted with less ankle bend & more knee bend in them

heel pain, or only one side? tell me before you change anything$l$, $j${}$j$::jsonb),
  ('5d09f4b1-0f6f-4229-bc1a-e7d0b7679e64'::uuid, 'c49049e408b77bff0eec2418aa533608', $l$knees caving as you come out of the hole?

its not always a problem. a small knee shift that comes back out halfway up is really common in strong lifters

plenty of them squat big with it and have no pain

worth working on when
• it gets worse rep to rep or set to set
• its one knee only, or your hips shift with it
• it hurts, or it shows up on light sets too

spread the floor with your feet so your knees follow your toes. do tempo or pause squats at the weight where it starts

weak glutes get blamed for everything. its rarely that simple. send me a side & front vid before you chase it 👀$l$, $j${}$j$::jsonb),
  ('1aeef282-00fe-4e47-9ab1-e0add46ccae0'::uuid, 'e4bfbde346823e8e7fe7d33daef13757', $l$bar flies out of the hole then dies a few inches above parallel?

almost everyone has a spot like this. a 2021 study looked at people squatting their 3 rep max

right at that spot the torso leaned more. the hips took more of the work. and the push into the floor dipped

so which one is yours?
• your position changes there. hips shoot, chest drops, bar drifts. thats technique. pause at that height or do tempo squats
• the bar just slows and everything looks the same. thats strength. it needs more heavy practice & time

only on the last rep of a hard set? thats normal fatigue. lets figure out which one it is before you change anything 🤝$l$, $j${}$j$::jsonb),
  ('3c12bc29-7437-4a6f-bc1b-8d2549041bb1'::uuid, '2b86e874989b30d8c0721d7840f0f2b4', $l$near your max the extra weight goes to your hips. your knees dont take more

a 2022 study took trained men from 90% up to a missed 102%. the hips had to work harder as it got heavy. the knees didnt

a 2026 study of 29 elite powerlifters saw the same from 70 to 90%. women and men alike

the first one wasnt on powerlifters. the second never went heavier than that

why? what I think: the knees dont take more. so the weight has to line up closer to them. with the bar over midfoot that means knees & hips back, chest forward

that lean is how the hips take the extra. are your quads maxed out or is it just the easy way? the data cant say

long thighs, stiff ankles and low bar add lean too. so compare you with you

film your opener and your top single from the same spot
• a bit more lean, bar over midfoot, back holds? normal. leave it
• misses stall with your hips up? that spot is your limit. pause or pin squats just below it
• bar drifts to your toes or your upper back rounds? youre losing the bar. fix it light

my take: dont force yourself upright in a prep. it hands the load back to knees that werent taking more$l$, $j${}$j$::jsonb),
  ('26a836a1-789b-4ca9-b27e-9a60ec5bbbc1'::uuid, '5f5c463b1498b640e941ec57c428cf54', $l$how much of your max are you wasting before the squat even starts?

a long walkout costs you tightness. so do shuffling feet and standing half braced waiting for the call

• same walkout every time. usually 2 or 3 steps. back, out, set
• brace before you unrack and stay braced
• practice commands on heavy singles. have someone call squat and rack so a slow call doesnt throw you off

in IPF style meets the squat call only comes once youre still with knees locked

the rules are a bit different in each fed so check yours

if your walkout already works, dont rebuild it the month before a meet$l$, $j${}$j$::jsonb),
  ('4f6a2328-1ff2-4972-9225-2c71ac12e8a0'::uuid, '4ccd2cb9ce3f98d4e739129a431cac72', $l$you dont get stronger in the gym. you get stronger after it

right after a hard session youre actually a bit weaker. then you recover

if the work was hard enough you end up a little better than before. hard work, rest, then better

how long that takes isnt fixed. a heavy deadlift day usually takes longer to recover from than a few crisp bench singles

two ways to mess it up
• too little work, so your body has no reason to get better
• stacking hard sessions before you recover, so the dip keeps getting deeper

thats a big part of why your week is laid out the way it is$l$, $j${"title": "You get stronger after the gym"}$j$::jsonb),
  ('4d198735-569d-4d3b-a239-3f7771761947'::uuid, '2ac74db239fa5d19566af0ca40ab5900', $l$ever notice you always miss in the same spot?

thats your sticking point. in the big 3 youre usually strongest near lockout. the bar slows wherever your levers are worst

bench is the classic. fast off the chest, slow a few inches up, then faster again near lockout

off the chest the stretch helps you. a few inches up that help fades before your levers get better

that slow spot caps how much you can lift. its usually where your form breaks first too

next heavy set notice where the bar slows. thats useful info for us 👀$l$, $j${}$j$::jsonb),
  ('481475a7-6684-4f4d-91a1-b228df717e5b'::uuid, 'cf56ddcc5adbbc51a323c99ea8d412aa', $l$your warm ups and your top set arent quite the same lift

as the weight goes up the bar slows. your body moves a bit different to get it going

your squat leans a touch more. on bench the bar touches a slightly different spot. on deadlifts your hips rise a bit first

some of that is your body finding where its strongest. some of it is form breaking down. video is how we tell them apart

• film your heavy sets, not just warm ups
• set up every warm up like the top set. same stance, grip and brace

something only changes on heavy sets? send it to me before you fix it. might not be a problem at all$l$, $j${}$j$::jsonb),
  ('c5bc075f-fd52-4878-90d0-e2dad2e0016a'::uuid, '12134fbfe445868b595f9440d85eb3b4', $l$a PR shows you your best day. your log shows you your normal one

a 2016 look at 138 experiments found checking your progress helps you hit goals. it helps more when its written down or someone else sees it

those were mostly health goals like weight loss. so it says to look, not what to look for

one day is noisy. a 2022 study found guesses of reps left were off by about a rep. so one 9 when you planned an 8 means little

read a month or two at a time
• same weight, lower RPE? thats strength showing up before a PR
• look at your top set's estimated max as a line, not dots
• RPE creeping up at the same weights for a few weeks? usually thats fatigue building
• more sets, still flat after a lighter week? more might not be the answer
• sessions done vs planned. 8 of 12? thats the story

bad week? check sleep, stress, food, and if it was meant to be hard. my rule: change something only if it repeats

new? ask did I show up and is the weight going up. years in, progress is slow so read months

send me your last 6 weeks, or show a training buddy. thats the someone else sees it part$l$, $j${}$j$::jsonb),
  ('96a946fa-41d2-4cf1-8a74-2ecdde0dee41'::uuid, '3089480fbbea6d2cfe1653ce4e5bbf5b', $l$what works is boring. thats exactly why most people quit it

same lifts. same days. a bit more weight or one more rep than last time. sleep, protein, repeat

theres nothing exciting to post about week 7 of the same squat

but thats where strength comes from. not the new exercise you saw this morning

switching it up has its place. a new version of a lift to fix a weak spot. or one that works around a sore joint

not because you got bored on a Tuesday

training feels boring and the numbers are going up? youre doing it right 💪$l$, $j${"visual": {"truth": "Sticking with the basics works. It's meant to be boring."}}$j$::jsonb),
  ('a88e2cb4-9e3e-4e61-988c-c65460054121'::uuid, '8117c2dd4122da44dfd34b568ebe09f2', $l$skipping cardio to protect your gains? cardio was never really after them

a 2022 look at 43 studies compared lifting with and without cardio added. muscle growth and max strength came out about the same

what took a hit was explosive strength. mostly when both were done in the same session

so
• do cardio on its own day, or at least a few hours away from lifting
• keep most of it easy. you should be able to talk
• dont do a hard run right before squats

getting out of breath on the stairs isnt a flex. your heart is a muscle too 🫡$l$, $j${"visual": {"truth": "Some cardio won't cost you gains. Skipping it costs fitness."}}$j$::jsonb),
  ('5657cc02-16d6-4ab6-bdf2-f19e5680ab19'::uuid, '8c58f057eaca46db9d1ca416de7d7b18', $l$scrolling lifting videos and feeling behind? normal. its also a rigged fight

you see their PR. you dont see the 50 sessions before it where nothing happened

youre putting their best set of the year next to your normal set this week

everyone posts the highlight. nobody posts the Tuesday where the bar felt heavy and they went home

compare this instead
• your top set now vs 3 months ago
• sessions done this month vs last month
• how a weight you used to grind feels now

behind who? youre only racing the you from last year$l$, $j${}$j$::jsonb),
  ('771a1e29-d14b-43b7-bac6-f6e6cc405b66'::uuid, '9e10956a574d7a5baa561cff1deb60da', $l$they just have good genetics? half true. its also an easy excuse

genetics are real. some people grow faster, recover faster, or have a build made for a big bench

thats not fair and it never will be

my take: most people who say it havent trained consistently for even two years. you havent met your genetics yet. youve met your consistency

the only comparison that matters
• you vs you 6 months ago
• your log, not their highlight reel

find your ceiling first. then you can complain about it$l$, $j${"visual": {"truth": "Maybe. Train long enough to find your limit first."}}$j$::jsonb),
  ('3eaeb197-9969-4d71-ab56-ec6bb7b27c70'::uuid, '3808c283ac47c3ae26cb3efb499bdcc0', $l$taking every set to failure feels like hard work. its not the same as good work

a 2022 look at the research compared going to failure with stopping short. strength and size gains came out about the same

what failure does cost you
• more fatigue
• slower reps on the sets after it
• longer before you can train that lift hard again

where it fits
• the last set of a one muscle exercise like curls
• machines and cables, where a missed rep is safe
• rarely on a heavy squat, bench or deadlift

most of your sets should end with 1 to 3 good reps left. thats not soft

thats how you get to train again in two days 💪$l$, $j${"visual": {"truth": "A rep or two short still builds size and strength."}}$j$::jsonb),
  ('ec0713cd-4875-4640-931b-d2e5dede2db3'::uuid, '05eb31ae98579e1b38f66a546e8ff2db', $l$missing one workout doesnt ruin your week. deciding the week is ruined does

a 2010 study followed people building a new daily habit. for the people they could chart, the typical one took 66 days to feel automatic

it ranged anywhere from 18 to 254 days

and missing one day didnt really change how the habit formed

the problem is never the one miss. its the "I'll just start again Monday" after it

missed today?
• do the next session as planned. dont double up
• short on time? do the main lift and leave
• never miss twice in a row

perfect weeks are rare. a long run of decent ones builds lifters 🙌$l$, $j${"visual": {"truth": "One miss does nothing. Quitting the week over it does."}}$j$::jsonb),
  ('82808409-05bb-454a-bd0b-2dd308f9e83e'::uuid, '8e70af0ca43eb073ded699f75b4a250f', $l$almost half the people who mean to work out dont

a 2013 look at 10 studies put that gap at 46%. they meant it. it wasnt enough

my take: feeling flat before a session is a guess, not a verdict

what carries the flat days is habit. a 2014 study found habit made no difference on days people felt like it

on days they didnt, people with stronger habits still got moving

those were students and regular people who work out, not lifters. my bet: it holds under a bar too

so decide once, not every morning
• same days and times, written down
• flat day? warm up and do your first exercise. then decide$l$, $j${"visual": {"truth": "Habit gets you there on flat days. Motivation won't."}}$j$::jsonb),
  ('64691a17-bd50-41ea-b63a-9b92ff749b5b'::uuid, 'ade50743e25b65af6436f20c8c630582', $l$waiting for perfect form is how people get stuck on the same weight for a year

every lift looks a little different at 90% than at 60%. the bar slows down and your position shifts a bit. thats normal

what matters is that its the same every rep. and that its safe

form gets built under weight you can control. not by staring at the empty bar forever

what to look for
• the same setup every rep
• the bar moving about the same way rep to rep
• no new pain, and youd happily do the rep again

film one set a week. compare it to last month, not to a world record lifter$l$, $j${}$j$::jsonb),
  ('d40dfa8f-ef34-4936-84f2-5c8b8b2fb83d'::uuid, '6b7024e92b6521c53f210b6fc911e744', $l$most people dont need a better program. they need to finish the one theyre on

every program looks slow in week 2. thats when the new one you saw online starts looking better

so you switch, start over and get week 1 again. forever 💀

a boring plan run for 12 weeks beats a perfect one run for 3. the progress is in the repeating

same lifts, a bit more weight, a bit better reps

before you change anything ask
• did I actually do the sessions?
• did I push the sets I was meant to push?
• did I sleep and eat like I wanted results?

any answer a no? then the program isnt the problem$l$, $j${}$j$::jsonb),
  ('21ff44fd-b941-49d9-94b0-ee0ed1c918e3'::uuid, '0e1f9e77f23cd929da4db010b11f9c3f', $l$eating clean and eating enough protein are not the same thing

a salad with a bit of chicken is a clean lunch. its also not much protein if its your biggest meal of the day

a 2018 look at the research found extra protein helped lifters gain more muscle

the extra muscle levelled off around 1.6 grams per kilo of bodyweight a day. thats counting everything you eat. about 0.7 grams per pound

try this for 3 days
• log what you actually eat, not what you meant to
• add up the protein
• short? add one high protein meal or a shake. dont change everything

clean food is great. it just cant build muscle from protein that isnt there$l$, $j${"visual": {"truth": "Clean doesn't mean enough. Count protein for three days."}}$j$::jsonb),
  ('90d0fff4-b400-4319-9204-ccc2cd371709'::uuid, 'ace2a3ff4e06114c0cacc7bc99bac307', $l$the scale isnt lying. youre just reading one number like its a trend

water, salt, carbs, stress and whats in your gut all move your weight day to day

a big pizza night can sit on the scale for a couple days. that isnt fat

one weigh in tells you almost nothing. seven of them tell you a lot

how to read it
• weigh in the morning, after the bathroom, before food
• look at the week's average, not today
• compare this week's average to last week's

stop letting Tuesday's number ruin your Tuesday 😭$l$, $j${}$j$::jsonb),
  ('a707ca01-2e11-4654-be62-312006d0ed24'::uuid, '88a2be220ebe06788c4a97968fe5ea2b', $l$need to be sore to feel like it worked? youre grading the wrong thing

soreness mostly shows up when the work is new. a new exercise, a deeper rep, a slower way down. do the same session next week and youre barely sore. you trained just as hard

a 2013 look at the research said soreness is a bad way to judge a workout. it fades when you repeat the work and you keep growing anyway

how to tell its working
• the same weight moves for more reps
• your top sets feel easier at the same RPE
• youre beating your log, not your pain

sore is fine. chasing it wastes good sessions$l$, $j${"visual": {"truth": "Sore means the work was new. Not that you grew."}}$j$::jsonb),
  ('37f12048-3418-4344-aeac-ac005fbd21fb'::uuid, '9f9d534c2ed7c55417a72e7ece28f720', $l$feels like everyone at the gym is watching you? mostly they arent

in a 2000 study students had to walk into a room. they wore an embarrassing Barry Manilow t-shirt

they guessed about half the room could say who was on it. it was closer to 1 in 4

its called the spotlight effect. you think people notice you way more than they do. because youre the one living in your head

the person on the next bench is thinking about their own set. their own form, their own phone

so film your sets. use the empty bar. ask for a spot. do what you came to do 👊$l$, $j${"visual": {"truth": "Most people are too busy with themselves to notice you."}}$j$::jsonb),
  ('10eb40c7-f22f-4c59-b5ec-809c390a6f38'::uuid, '41e6a12733717420bf517d36ae0841b1', $l$Arnold trained twice a day. Dorian Yates did 1 all out set per exercise 👀

Arnold won 7 Mr. Olympias. Yates won 6 in a row. so how many sets do you actually need?

a 2017 look at 15 studies found more sets a week built more muscle

groups doing 10+ hard sets per muscle a week grew the most

my take: it doesnt climb forever. each extra set adds less and fatigue keeps stacking

Yates made very few sets work by taking every one to failure after his warm ups

only count hard sets. warm ups dont count

accessories feel like too much or too little? bring it to me before piling sets on$l$, $j${"title": "How many sets do you actually need?"}$j$::jsonb),
  ('ee5adbbe-a3b1-4efa-996c-1451103200cf'::uuid, '3d5c9e27c14a59a9212b8ed220808725', $l$its friday. youre tired. so is everyone

the session you dont feel like doing is the one that shows who you are

go finish the week 💪$l$, $j${}$j$::jsonb),
  ('8f208f53-3109-4fff-8f65-070399e52d5e'::uuid, '0f118d98c551b94e685376eec0452049', $l$for most of you this week was the offseason. no meet, no show, nobody watching

thats exactly where its won

dont coast the last session just cause nobody sees it$l$, $j${}$j$::jsonb),
  ('65cb9e49-5d0a-4a7e-9e2f-86155722fd48'::uuid, '69919f36b6772ffa3fb123758e33e6a9', $l$last session of the week. last set of the session

thats the one most people coast

no screaming needed. quiet, locked in, every rep clean til the very end$l$, $j${}$j$::jsonb),
  ('17b22a09-6d41-431f-9010-e7cb3c78f964'::uuid, 'c96c920895cc46f6ddc542bdcc81c19f', $l$Kobe played all 20 of his seasons for one team. five titles 🏆

sticking with it isnt exciting. its staying when leaving would be easier

finish this week the way you said you would on monday$l$, $j${}$j$::jsonb),
  ('45c75ad3-35b5-4ee4-83a5-569292cdac84'::uuid, 'afa83cb12d3bea7b1628c1347df74252', $l$ugly is normal at the end of a hard week. slower bar, heavy legs, less patience

train there anyway

getting comfortable in the ugly place is the whole skill$l$, $j${}$j$::jsonb),
  ('d59b4b97-082b-4877-a692-ff505ee8c3ff'::uuid, 'ef28c82da39a7d2380783c4a1248df6b', $l$friday pressure isnt a meet. its the couch, the drinks, the "ill make it up monday"

dont fold to that either

get todays session done 👊$l$, $j${}$j$::jsonb),
  ('f603ce16-6b95-4f8c-bca3-eec458586bb9'::uuid, '12235ce69ba146e14dd18f515fb16ff3', $l$if youre only training cause the program says so, friday is where that breaks

remember why you started

then go train like you want to, not like you have to$l$, $j${}$j$::jsonb),
  ('dec99b6b-6b89-487a-813b-a0ee0eb192dd'::uuid, 'e17babd573249fbbfb0fb25bfe2e9dd1', $l$Dorian Yates won six Olympia titles mostly out of sight. he trained at his own gym in Birmingham

nobody saw the work til he walked on stage

nobody needs to see todays session either. it just needs to get done$l$, $j${}$j$::jsonb),
  ('976ad676-b753-49ab-8117-be7cf3d4f036'::uuid, 'ffd305bc3cb353cc37ce417d4254ca45', $l$the warm ups. the accessories. the food prep. the early night

none of it is exciting and all of it counts

finish the boring stuff this week too$l$, $j${}$j$::jsonb),
  ('a03ed503-1c95-4cb6-a3ad-c18941991a51'::uuid, 'd847de6a2043297ac4c4e8b00c67578a', $l$working hard is just the minimum. paying attention is what moves you

last session this week film a top set

watch it back & fix ONE thing 👀$l$, $j${}$j$::jsonb),
  ('23785024-9eeb-4515-a165-d634016eb5c5'::uuid, '9d5c84eeaeec422c23e626b0ebf24332', $l$looking back on the week usually turns into a list of what went wrong

flip it

name one thing you did right this week. then do it again today$l$, $j${}$j$::jsonb),
  ('abbe2a05-3391-4ebc-9ff9-672647183be6'::uuid, '55a28f724c812dac052bf6e6958274f8', $l$everyone has had enough by friday. thats the point

this is where you pull away from everyone else

one more session. done right$l$, $j${}$j$::jsonb),
  ('5c944e4f-7dec-4f00-84ec-a18586abcb29'::uuid, 'eee1bf345fff8880d5bc655a23bd1a8d', $l$Michael Jordan gave Tim Grover 30 days to prove himself. it turned into about fifteen years

thats what happens when you keep delivering

finish this week like youre still earning the next one$l$, $j${}$j$::jsonb),
  ('836d0772-c032-4535-8059-12521efe913f'::uuid, '250e266cb5b8996fb429c4d343627266', $l$one good session is luck. a whole week of them isnt

the more times you show up the less luck matters

get the last one in 🔥$l$, $j${}$j$::jsonb),
  ('b51b2c1a-0041-49b0-8ce1-c2792e50f682'::uuid, '74ea88b484a3aa54d097c6b1d5fbf1a2', $l$everyone wants the big moment. the PR, the meet, the stage

but great is just consistent for long enough that people start calling it talent

this week isnt about one big session. its about all of them. show up 💪$l$, $j${}$j$::jsonb),
  ('bf645a12-efd5-4405-8f1e-1788708e9ba5'::uuid, '98b4cae7e7bc4b2d277d2fdf79f3bd51', $l$talent gets you noticed. skill gets built one rep at a time, on purpose

you dont need more talent this week

you need to stop wasting reps$l$, $j${}$j$::jsonb),
  ('cff53170-1ae8-4893-8f38-3ccc981809b5'::uuid, 'eef5977d6b1dce0c72110a91ea4e6c11', $l$Dorian Yates won six straight Mr. Olympias doing one or two working sets per exercise

not cause he did less. every set went all the way

most people do five sets at 80% and call it work. pick your hardest set this week & actually finish it$l$, $j${}$j$::jsonb),
  ('4d41344f-a8e9-4a04-ae3c-8eabdbf8ec6c'::uuid, 'd424ec334f0d32d241b18e7f5ed574a3', $l$Kobe didnt make the people around him comfortable. he made them better

thats what a good training partner, coach and crew does

raise the bar for yourself this week. then bring someone with you 🤝$l$, $j${}$j$::jsonb),
  ('17ec0f15-c9c8-4748-841a-bc2d2d298b4c'::uuid, 'd455a28cb840bb2ca6a303562467575e', $l$not "dont miss depth". hit depth
not "dont skip sessions". train four times

the words you tell yourself decide where your head goes under the bar

write this weeks goal as something youll do, not something youll avoid$l$, $j${}$j$::jsonb),
  ('7e6d6b35-3d18-4050-841d-e8e66262de02'::uuid, '6456a6260bb3cc896527690ec0ad4c82', $l$in Relentless, Tim Grover sorts competitors into three groups. Coolers, Closers & Cleaners

Coolers do whats asked. Closers deliver when it counts. Cleaners are never satisfied & dont stop

most people are Coolers who think theyre Cleaners. which one were you?$l$, $j${}$j$::jsonb),
  ('757d0d91-d189-493d-90b5-5da4d8897623'::uuid, '56b2014ab56443d079912d99d6d0fa25', $l$everyone in this crew has big goals. good

but the goal isnt the flex. the work is

anyone can have big goals. lets see the work this week 💪$l$, $j${}$j$::jsonb),
  ('ffab495f-ff25-441d-947e-2d8d77b0866b'::uuid, 'a2b3ca1688ea811c832a2164079a80a7', $l$Kobe scored 81 points in one game in 2006. people still talk about that night

nobody talks about the practice behind it. it was there anyway

this week is practice. treat it like it matters. its the only part you control$l$, $j${}$j$::jsonb),
  ('16005d54-8db5-4c84-a797-64c2fd6a3fd0'::uuid, 'caa4d7dbdb1db36b7a02934df9aed3dd', $l$same weight. same reps. same effort. same body

your body only changes when you give it a reason to

add a rep. add a little weight. something has to go up this week$l$, $j${}$j$::jsonb),
  ('6a9c2767-f878-4065-9525-7a4c0697b439'::uuid, 'a03cfce390efe9720e106c47adc679a9', $l$notice theres nothing in there about feeling motivated

know what you want. then stop arguing with yourself every morning about it

just go get it$l$, $j${}$j$::jsonb),
  ('5bdc0f0d-9791-492f-9968-75e70e1d759e'::uuid, 'f10dc9cb2df158c2136c57813686d950', $l$thats why the best look calm on the platform. theyve already done it in training, over and over

pressure isnt the meet. its finding out on the day that you never practised for it

train this week like the day is coming. cause it is$l$, $j${}$j$::jsonb),
  ('ec89964c-feb2-4d29-b97c-9e8433c2bd9a'::uuid, 'ab037f93ceace4d6d2c371f47d12925b', $l$read that twice

the person ahead of you isnt special. they just stopped arguing with the plan sooner

pick the excuse youre done with this week. then actually be done with it$l$, $j${}$j$::jsonb),
  ('7e6c52c3-7b68-4f53-8a58-ae3ae2ce0b13'::uuid, '1082f3c6e2166d0316d6779310ab6616', $l$Dave Alred coached Jonny Wilkinson's kicking for years. the drop goal that won the 2003 World Cup took a second

the work behind it didnt

you wont get one big moment this week. youll get a few normal sessions. thats where the moment gets built$l$, $j${}$j$::jsonb),
  ('4a043309-d055-4435-bf95-93449f331426'::uuid, '0b622652fa659e0aca08f6faffd5c692', $l$process first. trust second

you cant trust work you didnt do

so do it this week. then youve got something to lean on when it gets heavy 🙏$l$, $j${}$j$::jsonb),
  ('6949f7e9-d51a-40a6-b460-e675788592cf'::uuid, 'd8d326815a1340245f9c0d09796e085a', $l$log your bodyweight. on Home tap Log Weight on the Bodyweight card. first thing in the morning, after the bathroom, before you eat or drink. one weigh in means basically nothing. the trend over a few weeks tells us if your food lines up with your goal. aim for 3-4 mornings a week$l$, $j${}$j$::jsonb),
  ('a06ea417-8e97-4322-a5e0-c3ead6eb12cf'::uuid, 'ff3e57e4f8e6ef4598d7d61e64c9d365', $l$the rest timer. it starts on its own when you check off a set. or tap the ▶ on any exercise to start it yourself. no more guessing how long youve been sitting there on your phone. this week try actually resting the full time on your main lifts. 3-5 min on heavy squats, bench & deads$l$, $j${}$j$::jsonb),
  ('50db2ba0-eb98-409c-b197-063df9a127cc'::uuid, '6fcc79f9df5b9098069935e5285d34df', $l$the review at the end of your workout. it pops up once your last set is logged (or tap Finish Workout). it asks how hard it was and if anything hurt. plus how you slept and your energy going in. about 20 seconds. it tells me the stuff your numbers cant. like a PR on 4 hours of sleep, or a tweak before it turns into something. dont skip it, even on the boring days$l$, $j${"where": ["Workout", "log your last set", "How'd it go?"]}$j$::jsonb),
  ('779bf329-0a75-45ae-b846-dc3ba1e96727'::uuid, 'a906ceeeeae0a405ee0050a3eb7beacf', $l$every exercise in your program has a How To button. tap it for the demo video if theres one, the cues and the most common mistakes. anything on your plan youre not 100% sure about? check it before your first set. even on lifts you know well the cues are worth a look$l$, $j${}$j$::jsonb),
  ('f2510653-1175-4eb0-9fb5-a854853cb3b6'::uuid, '4e4741ae312fc67aba6c76058c04dea8', $l$the RPE on every set. after a set tap how hard it was. 10 means nothing left, 8 means you had 2 more good reps. not sure? tap the ⓘ next to RPE above your sets for the full scale. 2 seconds a set. it shows whether a weight was actually heavy or you were just having a rough day. be honest with it, thats the whole point$l$, $j${"where": ["Workout", "RPE on each set", "ⓘ next to RPE"]}$j$::jsonb),
  ('6b464f89-3ab7-4888-8b6c-f1df358856e3'::uuid, '9017e124c391fe3b0053e299e15811c3', $l$log every set, not just the top one. weight & reps on each set as you go, right after you finish it. the app finds your PRs from what you log. so a set you dont log is a PR nobody ever sees. it also shows me how the whole session actually went. try logging as you go this week instead of all at the end$l$, $j${}$j$::jsonb),
  ('6d33334c-4c6f-4282-9d75-2c053767c87e'::uuid, 'd6d343ca3fa9b51d1a34223ee7cff129', $l$your training analytics. on the Workouts tab scroll down to your month card and tap See all analytics. your lifts over time, your recent all time PRs, all of it. on a rough week its the best reminder of how far youve actually come 📈$l$, $j${"where": ["Workouts", "your month card", "See all analytics"]}$j$::jsonb),
  ('76f38564-aa39-4814-b736-d23741bf6ff5'::uuid, '26f159f182e0128a7f256a11e677b3d5', $l$the weekly check-in. when its due it shows up in Messages as a card, tap Start check-in and go. a couple minutes. its where I hear about the stuff the workout log cant show me. stress, sleep, how your body feels, whats coming up. the bad weeks are the ones I most need to hear about so dont skip those 🤝$l$, $j${}$j$::jsonb),
  ('6a679cb0-e06f-4fcd-8ddc-953f7ac9aec8'::uuid, '50405a0ad59899cf51693907d997cc9d', $l$the note button on each exercise. use it for anything you want to remember. seat height, grip width, which cue clicked, something that felt off. next time you open the note on that exercise your old notes are right there. and I can see them too. saves you figuring it all out again every week$l$, $j${}$j$::jsonb),
  ('da7534a1-0e91-4618-999f-8f5d3d38e0bf'::uuid, 'a321778ec43efd2284bf9ae6b9752e55', $l$the Performance League. tap the trophy on the big Crew button at the bottom for Rankings. every month it ranks the crew on points from training, logging, reviews, check-ins and progress photos. not on who lifts the most, so anyone can win it. you need a bodyweight logged to get in. check where youre at 🏆$l$, $j${"where": ["Crew", "Rankings", "Monthly"]}$j$::jsonb),
  ('e3280c41-b9d5-49bb-aaf1-a3411a41b3f2'::uuid, 'e151d4a6c96ead28ccfe034e8924a356', $l$send me a video of a top set. in Messages tap + then Camera or Photos & Videos. side angle, whole body in the shot, phone around hip height. its the fastest way for me to catch something in your technique. before it turns into a problem or a missed lift$l$, $j${}$j$::jsonb),
  ('66a9ca53-8942-4a26-b6b5-fb0d62c245e6'::uuid, '063763fad374014471f5521f3f103847', $l$the Water Today card on Home. tap +250ml, +500ml or +1L when you drink. most people drink less than they think. it can show up as feeling flat in the gym. try logging it for one week just to see where youre actually at$l$, $j${}$j$::jsonb),
  ('ebb7aead-f6bb-4d63-89d0-8226f833674e'::uuid, '3cc481417062406128f6d5884e7f5758', $l$post a workout in Crew. tap the + at the top left of Crew and pick a session. no pressure to make it look good, its the effort people hype up. the crew sees you showing up. that makes it a lot harder to skip on the days you dont feel like it$l$, $j${"where": ["Crew", "+ top left", "pick a session"]}$j$::jsonb),
  ('2b3e5fba-05f5-4c10-a3ad-a0522ac5405c'::uuid, '7022bdbd7c9680fe4a40d77af406ec60', $l$the Cookbook. on the Nutrition tab tap Open Cookbook. easy meals: air fryer, microwave, no-cook & store-bought. hitting your protein feels like a chore? find 2 or 3 in there you actually like and rotate them. nobody needs 40 recipes, you need a few you will actually make$l$, $j${"where": ["Nutrition", "Open Cookbook"]}$j$::jsonb),
  ('ffc302fc-f612-442a-8f04-a8268c21dfd8'::uuid, '0302a6f7ebb0e7b1ffb553ab18224d41', $l$cue to test on squats this week: spread the floor. push your feet out to the sides like youre trying to rip the floor apart. your feet dont actually move. a lot of people feel their hips kick in more and their knees stop caving. try it on your warm up sets first and see if the bar feels more stable. if it clicks keep it, if not toss it 🤝$l$, $j${}$j$::jsonb),
  ('cb1e4549-94df-4e26-a22b-d57401aa41c6'::uuid, '8727eb7dd0ad5b0d58b6e7bfbc2094d7', $l$workout habit that matters more than people think: do the same warm up every time. same order, same jumps in weight. after a few weeks your body knows exactly what its getting ready for. you stop wasting energy figuring it out. pick one this week and stick to it$l$, $j${}$j$::jsonb),
  ('b407750e-9929-45c6-a150-cfadb8249e5e'::uuid, '3f34ed2b708c521bca62773daea20002', $l$bench cue worth testing: try to bend the bar. grip it tight and think about snapping it in half. for lots of people it locks the shoulder blades back and stops the elbows flaring early. test it on your first couple warm up sets. pay attention to how the bar path feels. only way to know if it works for you is to try it 💪$l$, $j${}$j$::jsonb),
  ('3815d8a6-ca3d-42b5-9319-98fdb52f9334'::uuid, '1f41603dbea02214ce8db2b4c6bcb87c', $l$be honest with your RPE. an 8 means you had 2 more good reps in you. not 2 more if your life depended on it. the whole point is picking the right weight for the day. if the number is off the weight is off. after each top set this week ask how many you actually had left and log that$l$, $j${}$j$::jsonb),
  ('7ae5d783-7d3d-44c5-b2b4-0b7276df4570'::uuid, '2cc79abde275832c3b98f7562cf5027e', $l$try a routine before your heavy sets. same steps every time: chalk, belt, same breath, same setup. it takes the thinking out of it. it gives your brain something to do besides worrying about the weight. pick 3 steps and run them before every working set this week$l$, $j${}$j$::jsonb),
  ('ffa5a864-0c77-4920-a05f-75d90f6c8523'::uuid, 'e1cac328fd33e5f2a6d29bd906279dce', $l$rest longer on your main lifts. 3-5 min between heavy sets isnt lazy. its how the next set actually gets to be heavy. cutting rest short on squats & deads mostly just makes the next set worse. save the short rest for accessories$l$, $j${}$j$::jsonb),
  ('b4cddda4-a8f2-461b-8ff7-1336d12912a8'::uuid, '89743f79cdd8add08e536be23ca8b248', $l$save the hype for the top set. if youre getting fired up for warm ups youre burning it too early. stay calm through the warm ups. then turn it up for the 1 or 2 sets that actually matter. test it next session and see how the top set feels$l$, $j${}$j$::jsonb),
  ('65733bc4-e5f3-40b5-8575-10726c4c5e16'::uuid, 'e71e9d91e2a19c2241b168bacf06b5bd', $l$if everything feels heavy for 2 weeks straight, tell me. thats not you being soft, thats information. sometimes it means we pull back for a week, sometimes its sleep or food. either way I can only adjust what I know about. so put it in your workout review or send me a message 🤝$l$, $j${}$j$::jsonb),
  ('2a4de398-edea-4f77-8b16-25c6e642b393'::uuid, 'c641ce2e6d16d7a89cd4414fa73d1c88', $l$if your deadlift is slow off the floor try this. stop thinking pull and start thinking push the floor away, like a leg press. it tends to keep the hips from shooting up first. it also gets your legs doing more of the work. worth testing on your next pull day. film a set with it and one without if you want to see the difference 🎥$l$, $j${}$j$::jsonb),
  ('d17676d5-38c5-4ee9-a522-d0b2e9a24a2d'::uuid, '71df6e16e1f4c02742e30fdc2bef7a43', $l$the only comparison that matters is you vs you a few months ago. someone elses numbers have nothing to do with your progress. scroll back through your PRs in the app sometime. most people forget how far theyve actually come 🙏$l$, $j${}$j$::jsonb),
  ('627facf0-7ab2-4bd4-84ed-bdece2dfc89b'::uuid, '422fcc4f981d15285ae58cf7ab67a95d', $l$bracing cue worth testing: breathe into your belt, all the way around. not just your stomach, your sides and lower back too, like youre filling a barrel. then lock it in before you move. is your lower back the first thing to give on heavy sets? this is where id start. practice it on a lighter set first so you can feel it$l$, $j${}$j$::jsonb),
  ('805cccf4-56e3-4a86-9588-4b44655d7d5b'::uuid, '028c0c4012d35c78bbd9e34b51782c54', $l$before you walk into the gym, open your workout. know what your top set is supposed to be. takes 30 seconds. showing up with the plan already in your head means less wandering. less guessing weights halfway through, and a better session. try it this week before you leave the house$l$, $j${}$j$::jsonb),
  ('bf8641c7-e138-4f3d-8102-efe612831e02'::uuid, '18e85707b5b9ecb8f205ee969568a284', $l$sleep is the one thing that makes training feel easier without touching your program. 7-9 hours. most people dont need a new program, they need to go to bed earlier. try getting 30 min more a night this week and see how your top sets feel 🫡$l$, $j${}$j$::jsonb),
  ('c080f378-d8f4-4418-8fb5-b17677b78ad5'::uuid, '77567f6019d651317cd47694be7bc423', $l$one for bench. instead of pushing the bar up, think about pushing yourself away from it. down into the bench. sounds like the same thing. but for lots of people it keeps the upper back tight and the leg drive connected. give it a few sets this week and see if the lockout feels any different$l$, $j${}$j$::jsonb),
  ('e007452a-e619-466a-9029-3c7e58af6c6d'::uuid, '164a4a00ededd944a33bff23e1f5889f', $l$for RDLs: pretend theres a wall behind you and try to touch it with your butt. hips go back, bar stays glued to your legs. stop when your hips cant go back any further. most people go too low and turn it into a back exercise. do it right and you should feel your hamstrings way more 🔥$l$, $j${}$j$::jsonb),
  ('afec84d5-c26c-445d-aa01-0f8c2ea8406e'::uuid, 'dd96173e98cebf5c23fab426a98494f4', $l$for pulldowns & rows: think elbows to your back pockets, not hands to your chest. your hands are just hooks. most people feel their lats way more and their biceps way less. try it next back day. drop the weight a bit if you need to, worth it$l$, $j${}$j$::jsonb),
  ('fc70ff2f-3c0b-4095-a960-1eb892592823'::uuid, 'ebac7bba7d313b0b040ddd1a58834bd7', $l$something to test on your accessories. control the way down for 2-3 seconds and dont cut the stretch short at the bottom. research has been leaning toward the stretched part of the rep being really good for growth. youll probably need less weight, thats normal. try it on 1 or 2 exercises for a couple weeks and see how they feel$l$, $j${}$j$::jsonb);

-- posts already out, first (they're matched against the library text they went out with)
UPDATE public.community_posts p
   SET caption = r.body || substr(p.caption, char_length(i.body) + 1),
       series_data = CASE WHEN p.series_data IS NULL THEN NULL ELSE pg_temp.plain_merge(p.series_data, r.patch - 'story_q' - 'labels') END
  FROM plain_voice_rewrite r
  JOIN public.community_series_items i ON i.id = r.id AND md5(i.body) = r.old_md5
 WHERE p.series_item_id = r.id
   AND (p.caption = i.body
        OR (left(p.caption, char_length(i.body)) = i.body AND substr(p.caption, char_length(i.body) + 1, 3) = E'\n\n📊'));

-- the library
UPDATE public.community_series_items i
   SET body = r.body,
       data = pg_temp.plain_merge(coalesce(i.data, '{}'::jsonb), r.patch),
       updated_at = now()
  FROM plain_voice_rewrite r
 WHERE i.id = r.id
   AND md5(i.body) = r.old_md5;

-- a Thursday post's numbers line, the way community_feature_stat now says it
UPDATE public.community_posts p
   SET caption = regexp_replace(regexp_replace(p.caption,
         '📊 the ([0-9]+) of you who (.+?) trained ([0-9.]+)x a week on average over the last 8 weeks\. everyone else: ([0-9.]+)x\. not saying the feature does it for you, the people who use it are just more locked in$',
         '📊 \1 of you \2. those \1 trained about \3 times a week the last 8 weeks. everyone else: \4. the app doesnt do it for you. the people who use it are just more locked in'),
         '📊 the ([0-9]+) of you who (.+?) hit ([0-9.]+) PRs on average over the last 8 weeks\. everyone else: ([0-9.]+)\. not saying the feature does it for you, the people who use it are just more locked in$',
         '📊 \1 of you \2. those \1 hit about \3 PRs each the last 8 weeks. everyone else: about \4. the app doesnt do it for you. the people who use it are just more locked in')
 WHERE p.series = 'try_it_thursday'
   AND p.caption LIKE '%not saying the feature does it for you, the people who use it are just more locked in';

-- Tuesday's crew numbers already out, from their own numbers, the way community_compose_observation now writes them
UPDATE public.community_posts p
   SET caption = CASE p.series_data->>'observation'
     WHEN 'frequency' THEN
       'do the people who train more hit more PRs? I checked the last 8 weeks 📊' || E'\n\n'
       || 'the ' || (p.series_data->>'a') || ' of you training 3+ times a week hit about ' || (p.series_data->>'x') || ' PRs each. the other ' || (p.series_data->>'b') || ': about ' || (p.series_data->>'y') || E'\n\n'
       || 'its not proof. how long youve lifted & whats going on in life matter too. but more good reps at a lift is how you get better at it'
     WHEN 'consistency' THEN
       'does missing a week cost you PRs? I checked the last 8 weeks 📊' || E'\n\n'
       || 'the ' || (p.series_data->>'a') || ' of you who missed 1 week or less: about ' || (p.series_data->>'x') || ' PRs each. the ' || (p.series_data->>'b') || ' who missed 2+ weeks: about ' || (p.series_data->>'y') || E'\n\n'
       || 'its not proof, lots goes into it. but the ones who show up every week keep being the ones with the PRs'
     ELSE p.caption END
 WHERE p.series = 'tuesday_tips'
   AND p.series_data->>'observation' IN ('frequency', 'consistency')
   AND p.series_data ?& ARRAY['a', 'b', 'x', 'y']
   AND p.caption ~ '^(looked through the last 8 weeks of training in the app|something from the app data) 📊';

-- Wednesday Wins already out: lowercase like every other week (only the template's own words;
-- a line that starts with someone's name keeps its capital), a hype word as its own beat
UPDATE public.community_posts p
   SET caption = regexp_replace(
         (SELECT string_agg(CASE WHEN para ~ '^(Thats|New|Everyone|Ayooooo|Sheeeesh|Noo|Big|Last|Most|Good|Some|Few|Not|Yall|Craaazy|Insane|This|So|Tooo|Wilddd|Holy|Gawd) '
                                 THEN lower(left(para, 1)) || substr(para, 2) ELSE para END, E'\n\n' ORDER BY n)
            FROM unnest(string_to_array(p.caption, E'\n\n')) WITH ORDINALITY AS t(para, n)),
         '^(sheeeesh|ayooooo|noo way|thats craaazy|craaazy|insane|this is nuts|so freaking hyped|wilddd) (yall are cooking|big week)', '\1!! \2')
 WHERE p.series = 'wednesday_wins'
   AND p.caption IS NOT NULL;

DROP TABLE plain_voice_rewrite;
