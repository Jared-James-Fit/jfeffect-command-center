-- The libraries and templates behind the posts under Jared's name, in his
-- coaching voice (his ask, Nov 7 2026: "an elite powerlifting coach
-- explaining something between sets", natural sentence casing, no fitness
-- motivation lines). 20270209090000_coach_voice_posts.sql rewrote what was
-- already out; this is what goes out next:
--
--   1. Tuesday Tips (on): all 22 rewritten as coaching: the cue or habit, why
--      it works, what to do this week. Every number kept (3 to 5 minutes, 7
--      to 9 hours, 1 to 3 hours); the stretch tip's research said as his read.
--   2. The lesson library: the 87 lessons still in texting lowercase get
--      normal sentence case and full stops, the words unchanged (checked
--      before this was written: lowercased, without the added full stops and
--      colons, each is its old text exactly), except texting shorthand ("til",
--      "vid", "gonna", "wanna", "tho", "kinda") and dropped apostrophes ("hes",
--      "elses", "whatevers", "usually its", "last weeks wins", "this weeks food",
--      "dietitians plan"). Studies, numbers and
--      quotes stay word for word. Upcoming lessons read their item, so the
--      planned ones change with it.
--   3. Holidays: the same two lines each, in sentence case, one emoji at most,
--      no "no guilt".
--   4. The templates (Wednesday Wins, Tuesday's numbers, a feature's stat,
--      birthdays): sentence case and full stops, no hype word in front of the
--      numbers ("thats craaazy!!"), no "that's insane", single emojis. Wins
--      now reads its week through local_to_instant (a bare AT TIME ZONE had
--      Manitoba's weeks an hour off since Nov 1).
--
-- Every text changes only while it's still exactly what was read (md5), so
-- anything the coach edited stays his. The switched-off series (Monday
-- Motivation, Try it Thursday, Finish Strong Friday, Saturday Spirit) and the
-- Sunday Recap are off and left as they are.

-- ── 1. Tuesday Tips ──────────────────────────────────────────────────────────
CREATE TEMP TABLE coach_voice_items (id uuid PRIMARY KEY, old_md5 text NOT NULL, body text NOT NULL);

INSERT INTO coach_voice_items (id, old_md5, body) VALUES
('ffc302fc-f612-442a-8f04-a8268c21dfd8', '8aba433c373fb1836b8fec3719c92b49', $t$Squat cue worth testing this week: spread the floor.

Push your feet out to the sides like you're trying to rip the floor apart, even though they don't move. For a lot of lifters it gets the hips working and stops the knees caving on the way up.

Try it on your warm-up sets first. If the bar moves better, keep it. If it doesn't, drop it. A cue only earns its place if it changes the rep.$t$),
('cb1e4549-94df-4e26-a22b-d57401aa41c6', 'cb0984245646c20b375d9f5e1568856d', $t$Run the same warm-up every session. Same order, same jumps in weight.

After a few weeks it works as a test as much as a warm-up. When the same weight moves slower than usual, you know before your top set that today needs adjusting.

Pick one warm-up this week and keep it for the whole block.$t$),
('c7aeb209-03e5-425c-960e-f0e6f158dcd8', '097a30d378ac4900281e7bf19eb97fd5', $t$One bad session tells you very little. Sleep, stress, food and a long day at work all show up on the bar.

The trend over 4 to 6 weeks is what tells you whether the program is working. Judge it there, not on one Tuesday that felt heavy.

Next time a session feels off, log it honestly, write a quick note on why, and move on.$t$),
('0c3570c8-2c8f-43de-a2a4-0f07db940975', '7d2af643198c57a30bb893ef351d046e', $t$Gym packed and your rack is taken? Have a plan B before you need it.

Rack taken, do your accessories first. Machine gone, use the closest thing that trains the same muscle. A session done at 80% of the plan still moves you forward. A skipped one doesn't.

The main lifts are the priority. Everything else can move around them.$t$),
('b407750e-9929-45c6-a150-cfadb8249e5e', '7e158c77aafc43aff4124b4c3200d826', $t$Bench cue worth testing: try to bend the bar.

Grip it hard and think about snapping it in half. For a lot of lifters it pins the shoulder blades back and keeps the elbows from flaring early. The bar path gets more consistent.

Test it on your first couple of warm-up sets and film one from the side. If the touch point and the path tighten up, keep it.$t$),
('3815d8a6-ca3d-42b5-9319-98fdb52f9334', 'a5e4e5235cfc03a3e25da0bcefa0f7f3', $t$Quick one on RPE. An 8 means you had 2 more good reps in you, not 2 more if your life depended on it.

RPE is there to pick the right weight for the day. If your 8s are really 9.5s, every weight built off them is off too, and the fatigue piles up.

After each top set this week, ask how many clean reps you really had left and log that number.$t$),
('7ae5d783-7d3d-44c5-b2b4-0b7276df4570', 'd24868ae464d7b4933dc36b58683b0fe', $t$Run the same routine before every heavy set. Chalk, belt, same breath, same setup.

It takes the decisions out of the rep. Your attention goes to the steps instead of the number on the bar, and your setup stops changing from set to set.

Pick 3 steps and run them before every working set this week.$t$),
('d646c653-8618-4212-a476-8cbeac3d6875', 'c355e23ac6bd625033a62b22426fe791', $t$You can't control how your body feels on a given day. You can control showing up, sleeping, eating enough and giving honest effort.

Those are the inputs. Do them for long enough and the numbers usually follow.

On the days you feel rough, show up and run the plan. Adjust the load if the warm-ups say so, but get the work in.$t$),
('1919cb29-609d-4bba-8e38-e01ec0ffb565', 'f42a6b9bd3ef5ea013c05b82a6f4148b', $t$Deadlift cue: pull the slack out before the bar leaves the floor.

Grip it, pull up just enough to hear the plates click, get tight, then push. Yanking the bar off the floor costs you position in the first inch. That usually shows up as the hips shooting up or the bar drifting forward.

Do it on every warm-up set this week so it's automatic by your top set.$t$),
('ffa5a864-0c77-4920-a05f-75d90f6c8523', 'd4f8b41183e08c9e2d273d1f383e8cc8', $t$Rest longer on your main lifts. 3 to 5 minutes between heavy sets isn't lazy. It's how the next set gets to be heavy too.

Cutting rest short on squats and deadlifts mostly lowers the quality of the next set, which means less practice at the weights that matter.

Save the short rest for accessories.$t$),
('b4cddda4-a8f2-461b-8ff7-1336d12912a8', '6ee5953bfc49a2f54023716015011336', $t$Save the hype for the top set. If you're getting fired up for warm-ups, you're spending it too early.

Warm-ups are for practice and for reading how the bar moves today. Stay calm through them, then turn it up for the 1 or 2 sets that actually matter.

Try it next session and compare how the top set feels.$t$),
('65733bc4-e5f3-40b5-8575-10726c4c5e16', 'e2c466aff02cb65a50aac13dd7b731f6', $t$For my coaching clients: if everything feels heavy for 2 weeks straight, tell me. That's useful information, not you being soft.

Sometimes it means we pull back for a week. Sometimes it's sleep or food. Either way, I can only adjust what I know about.

Put it in your workout review or send me a message.$t$),
('2a4de398-edea-4f77-8b16-25c6e642b393', 'fcaa5b9f6994cc5183d25acca5e89ef6', $t$Deadlift slow off the floor? Change the thought. Stop thinking pull and start thinking push the floor away, like a leg press.

For a lot of lifters it stops the hips shooting up first. The legs do more of the work in the first few inches.

Film one set with the cue and one without. The video will tell you which one to keep.$t$),
('61382fd2-3c48-4a4e-bc90-3d52e516c0d0', 'f9a9a37ded1fd6cfae2f2dc1c42ce4f8', $t$Eat something 1 to 3 hours before you train. Some carbs and some protein, nothing complicated.

Training on an empty tank rarely shows up in the first set. It shows up in the last few, when your reps get slower and the back-off sets turn into grinders.

If you train early and can't eat much, a banana or some toast beats nothing.$t$),
('d17676d5-38c5-4ee9-a522-d0b2e9a24a2d', 'a65a3ba86ee2c90b30ff8280a40f0558', $t$The only comparison that tells you anything is you against you a few months ago.

Someone else has different limb lengths, a different training age and a different life outside the gym. Their numbers aren't your benchmark. Your log is.

Scroll back through your PRs in the app this week and compare the same lifts 12 weeks apart.$t$),
('627facf0-7ab2-4bd4-84ed-bdece2dfc89b', '398ef51f9cf920feaf6327de12b30ee5', $t$Bracing cue worth testing: breathe into your belt all the way around. Not just your stomach, your sides and lower back too, like you're filling a barrel. Then lock it in before you move.

If your lower back is the first thing to give on heavy sets, this is where I'd start.

Practise it on a lighter set first so you can feel the difference, then carry it into your working sets.$t$),
('805cccf4-56e3-4a86-9588-4b44655d7d5b', '3fca1c48f3afb1bc40182f37913109dc', $t$Before you walk into the gym, open your workout and know what your top set is supposed to be. It takes about 30 seconds.

Showing up with the plan in your head means less wandering, less guessing weights halfway through, and warm-ups that build to the right number.

Make it part of your routine this week.$t$),
('bf8641c7-e138-4f3d-8102-efe612831e02', 'd196543cbcab0ce0115893d7aa42790d', $t$Sleep is the one thing that makes training feel easier without touching your program. 7 to 9 hours is the usual target.

A short night shows up as slower warm-ups and a higher RPE at the same weight. A lot of lifters don't need a new program. They need to go to bed earlier.

Try 30 more minutes a night this week and watch how your top sets move.$t$),
('c080f378-d8f4-4418-8fb5-b17677b78ad5', 'e2618c445c69a6409a232d871aa3eea4', $t$Bench cue: instead of pushing the bar up, push yourself away from it, down into the bench.

It sounds like the same thing. For a lot of lifters it keeps the upper back tight and the leg drive connected, so the press starts from a stable base.

Give it a few sets this week and see if the lockout feels different.$t$),
('e007452a-e619-466a-9029-3c7e58af6c6d', '2c0df01a63946ff995dd9b590021f6ec', $t$For RDLs, pretend there's a wall behind you and try to touch it with your butt. Hips go back, the bar stays close to your legs, and you stop when your hips can't go back any further.

Going lower than that usually just rounds the back and turns it into a different exercise.

Done right, you'll feel your hamstrings far more. That's the point of the lift.$t$),
('afec84d5-c26c-445d-aa01-0f8c2ea8406e', '10cdf663adef935fa3ab75854e6de5a6', $t$For pulldowns and rows, think elbows to your back pockets, not hands to your chest. Your hands are just hooks.

Most lifters feel their lats far more and their biceps far less. That matters when the back work is there to support your bench and deadlift.

Try it next back day and drop the weight a bit if you need to.$t$),
('fc70ff2f-3c0b-4095-a960-1eb892592823', 'b5094479c9141f2906120d170d909abf', $t$Something to test on your accessories: control the way down for 2 to 3 seconds and don't cut the stretch short at the bottom.

My read of where the research is heading is that the stretched part of the rep matters a lot for growth. You'll probably need less weight, and that's normal.

Try it on 1 or 2 exercises for a couple of weeks and compare how they feel.$t$);

-- ── 2. The lesson library: sentence case and full stops, the words unchanged ──
INSERT INTO coach_voice_items (id, old_md5, body) VALUES
('00168290-f916-4522-bbf9-c651f43afc5f', '5b6688b671a32d4345b6c421a808a617', $l$Hips shoot up first and your squat turns into a good morning?

Usually your quads are the weak link. Tipping forward moves the work off your knees and onto your hips and back.

Or your upper back goes soft. The bar rolls forward and your chest follows it.

What helps:
• Drive your upper back up into the bar so hips and chest rise together.
• Pause or tempo squats to own the bottom.
• Front squat way behind your comp squat? Quad work beats any cue.

Long thighs and a short torso need more lean. That's your build, not a fault.

Only on the last grinder of a set? That's just fatigue. Send me a video before you change anything.$l$),
('00ee9d30-9778-4d9f-9334-2d074c0de9d9', 'dc902bbf48e0d79a8adba331324cc6c4', $l$Bar landing somewhere different on your chest every rep?

Where your elbows go pretty much decides where the bar lands. Tuck one rep, flare the next, and the touch point moves with them.

• Pick a target and aim for it every rep. Around the bottom of your breastbone is a good start for a lot of people.
• On lighter sets take 2-3 seconds to lower it. That way you feel where it lands.
• Film from the side. Feel lies on this one.

An inch of difference between reps is normal.

If we already set up your touch point a certain way, stick with it 🫡$l$),
('019ea0d6-ccf1-4445-b401-77ef5ac7193e', '690867f04de4b0a30f12bd13af5d8e4e', $l$Muhammad Ali called himself the greatest before he won the heavyweight title.

He even put out an album called I Am the Greatest in 1963. Months later he beat Sonny Liston as an 8 to 1 underdog 👀

The research on self-talk is less wild. But it's real.

A 2011 look at 32 studies found it helped performance a moderate amount.

It helped most on skills that need to be precise. And on stuff people were still learning.

2 kinds:
• How-to cues: chest up, push the floor.
• Hype: let's go, you got this.

People who practiced their self-talk ahead of time got more out of it.

So pick one short phrase. Use it on every top set.

What's yours? 👇$l$),
('02d098fb-58bc-4243-9794-0e75dadd1fca', '24c89b104cc5470bd8c0735f87c55080', $l$A faster setup only helps if the bar still breaks the floor as hard.

At this level it's mostly wasted steps. Hip bounces, re-gripping, sitting in the bottom holding your breath. Each one can cost you grip and brace.

But cut the steps that build tension and the pull gets weaker.

In a small 2018 study people pulled on a bar that couldn't move. They tried it closer and further over the foot. Which muscles worked harder changed. Total force into the floor didn't.

• Same order every rep, warmup to max. Grip, breath, wedge, go.
• Test changes on heavy singles over weeks, not on warmups.

Breaks fast and looks the same every time? Leave it.

What's your setup order? 👀$l$),
('06077823-924a-4f43-8e68-348ab0f29781', 'b4452e0796da2cefa079d40d7a44b70e', $l$In the early 80s SuperSlow had people take about 10 seconds to lift a weight.

Ken Hutchins built it during a study that Nautilus paid for. So do slower reps build more muscle? Not past a point.

A 2015 look at the research checked this. Reps lasting from about half a second to 8 seconds all grew muscle about the same. Really slow reps (10+ seconds) looked worse. Probably because you have to go way lighter.

Controlling the way down still helps. Same position every rep, no bouncing out of the bottom. It just won't double your gains to go from 2 seconds down to 4.

Got a 3 second way down on squats or a long bench pause in your program? That's there for technique. Keep it 🫡$l$),
('08e4d378-66f0-4c7e-ac10-23555e0fcc63', 'd019a712b4a3d6a5701ffee1c650e223', $l$Bench dies 2 inches from lockout? It's not always triceps.

A lot of lockout misses are really misses in the middle. The bar just ran out of speed up top.

Other usual suspects:
• The bar drifts toward your feet. Finishing over your chest instead of your shoulders makes the top harder.
• One arm finishes first because your grip isn't centered.

Film from the side. Look where the bar actually slows, not where it stopped.

Once it's off your chest, think push the bar back toward the rack.

Send me a side video of your next heavy single. I can tell you which one it is 👀$l$),
('0afad019-c3ca-43ad-970f-8ef908415f90', '0497a3691a7a35ed4fbda1759fbd479d', $l$Bar dips a tiny bit right as you hear press? Refs see that.

Under IPF style rules the bar has to be dead still on your chest. Then you get the press command.

Sinking or heaving it after that is a red light.

It usually happens because the bar was resting on your chest. So you sink it to get tight again or to grab a mini bounce.

• Touch and freeze. Control the last few inches so it stops dead.
• Have someone call press at random. Sometimes right away, sometimes after 2 seconds.
• Film from the side at chest height. You can't feel a 1cm dip.

If your pause already gets whites, don't change it near a meet.$l$),
('0dbeab54-f659-41e3-bc07-af93cea4817d', 'b86c45d16ec3484ca21c519c6ccf4658', $l$Grip going before your back and legs do? Usually very fixable.

A lot of grip fails aren't a strength problem. The bar sits mid palm, rolls into your fingers when it's heavy, and your hand opens.

• Set the bar low in your hand, near where your fingers start.
• Chalk every heavy set.
• Pick one heavy grip (hook or mixed) and use it on warmups too.

Straps are fine on high rep sets and RDLs. They're just not allowed on the platform.$l$),
('0f67ad71-5f56-4997-ad92-30acc2b0d10a', '9f51ca4d5a1e4d1038a1dfbaac271be9', $l$Caffeine is one of the few supplements with real research behind it for lifting.

A 2018 look at the research found a small boost to max strength and jump power.

Small is the key word. Nice bonus, not a new you.

What the ISSN (a sports nutrition group) says:
• 3-6 mg per kg of bodyweight, most often about an hour before.
• As little as 2 mg per kg might work.
• Big doses mostly just add side effects.

Late caffeine can wreck your sleep. Heart issues or pregnant? Ask your doctor.

Never try a new dose for the first time on meet day.$l$),
('0fd2c916-84d2-4e0a-b234-109c7d42e4d8', '0c1db568cff89f161336944d48076ecf', $l$Sunday reset. Remember why you started.

Motivation fades. A reason doesn't, if you can see it.

• Write your why in one line. Not "to be healthy". Something real. Keep up with my kids. Total 500 this year. Feel strong in my own body.
• Pick one goal for 12 weeks from now.
• Put it somewhere you'll see it every day.

On the days you don't feel like it, your reason does the work 🫡$l$),
('105cf0d4-49a4-440e-a08c-361f46030bf9', '3452bf969656c324ceb0ff651e41b3f4', $l$A deload doesn't make you stronger. It lets you show what you built.

Hard training builds fitness and fatigue. Fatigue fades faster when you back off. So a lighter week lets your lifts come back without losing much fitness.

A 2024 survey of 246 strength and physique athletes found they deload about every 5-6 weeks.

A full week off isn't magic though. In a 2024 trial the group that kept training came out ahead on leg strength.

A deload is lighter training. Fewer sets, more reps in the tank, same lifts.

If one is in your plan, it's there for a reason 🫡$l$),
('15727fbb-3769-4dfe-8f42-4c537fa37372', '3cfa76f9a349b351977a7baf77845a4b', $l$Slept like 4 hours before meet day? Don't panic yet.

A 2022 look at 69 studies checked nights of 6 hours or less. Strength dropped around 3%. Skill stuff like aim dropped way more.

An earlier look at lifting research checked one night of no sleep. Most studies found it barely hurt strength.

A few short nights in a row were the bigger problem.

So one rough night might cost you a little and make warmups feel heavier.

On the day: normal warmups, normal caffeine, stick to the plan.

Something feels off? Tell me in the warmup room and we adjust 🤝$l$),
('1aeef282-00fe-4e47-9ab1-e0add46ccae0', 'a234fadbac595918ad377bc34ef4cf10', $l$Bar flies out of the hole then dies a few inches above parallel?

Almost everyone has a spot like this. A 2021 study looked at people squatting their 3 rep max.

Right at that spot the torso leaned more. The hips took more of the work. And the push into the floor dipped.

So which one is yours?
• Your position changes there. Hips shoot, chest drops, bar drifts. That's technique. Pause at that height or do tempo squats.
• The bar just slows and everything looks the same. That's strength. It needs more heavy practice and time.

Only on the last rep of a hard set? That's normal fatigue. Let's figure out which one it is before you change anything 🤝$l$),
('1e31e56e-15bd-4bf1-832f-9b7f8d66dd00', 'a086e33bd5b7920b6ebde89caef70a6c', $l$Same weight, totally different feel from one week to the next. Why?

Your strength on any day isn't a set number. Sleep, stress, food and leftover tiredness all move it.

The max written in your program is a ballpark, not a promise.

That's why a lot of programs pick top sets by RPE instead of a fixed %. Good day, the weight goes up. Rough day, it comes down and you still get good work in.

A 2021 study had one group pick squat weight by reps left in the tank. Over 12 weeks they gained more strength than the group on fixed percentages.

Not every study finds a difference.

A lighter top set on a bad day isn't a failed session. That's the system working 🫡$l$),
('20b4801a-ec84-4f3f-9312-46bcd0024a4c', '62f0c2e1858b67a69824f9082ce53725', $l$Sunday reset. Check in with your body before you ask anything of it.

Rate these 1 to 5, 5 being good:
• Sleep.
• Stress.
• Soreness, or anything nagging.

All 3s and up? Train as planned.

Something at 2 or lower? Don't wait until Wednesday to find out. Plan an easier day, an extra rest day or a swap for whatever's sore.

Changing the plan on Sunday is smart. Grinding through it on Thursday isn't.$l$),
('21ff44fd-b941-49d9-94b0-ee0ed1c918e3', '278f4345736c305686691bcda2b5279d', $l$Eating clean and eating enough protein are not the same thing.

A salad with a bit of chicken is a clean lunch. It's also not much protein if it's your biggest meal of the day.

A 2018 look at the research found extra protein helped lifters gain more muscle.

The extra muscle levelled off around 1.6 grams per kilo of bodyweight a day. That's counting everything you eat. About 0.7 grams per pound.

Try this for 3 days:
• Log what you actually eat, not what you meant to.
• Add up the protein.
• Short? Add one high protein meal or a shake. Don't change everything.

Clean food is great. It just can't build muscle from protein that isn't there.$l$),
('24a13211-5cb4-40b0-a7c9-6aaf45569322', '3ae212356f81cc0f847eef2fd0d65633', $l$Nick Saban built 7 national titles on one idea. Forget the scoreboard.

He called it the Process. Do this rep, this play, this day right.

Research backs him up. A 2022 look at 27 studies in sport found process goals helped performance the most. Outcome goals barely moved it.

• Outcome: hit a total, win.
• Performance: a 5kg squat PR.
• Process: fully in your control. Pause every first bench rep, hit every session, in bed by 11.

Keep the big goal. Write 2-3 process goals under it for this block 🫡$l$),
('26a836a1-789b-4ca9-b27e-9a60ec5bbbc1', '24e4fb27051b399e8173be71b57d750a', $l$How much of your max are you wasting before the squat even starts?

A long walkout costs you tightness. So do shuffling feet and standing half braced waiting for the call.

• Same walkout every time. Usually 2 or 3 steps. Back, out, set.
• Brace before you unrack and stay braced.
• Practice commands on heavy singles. Have someone call squat and rack so a slow call doesn't throw you off.

In IPF style meets the squat call only comes once you're still with knees locked.

The rules are a bit different in each fed so check yours.

If your walkout already works, don't rebuild it the month before a meet.$l$),
('2e21baf1-ee1a-4199-a4f0-e508173f6d3f', '206001c94ff948e3d08d0187e692b453', $l$Drop sets and failure sets aren't free. You pay for them on squat day.

Drop sets, rest pause, failure sets on leg press. They add a lot of fatigue for a little extra reason to grow.

Sets to failure take longer to recover from than stopping short with the same total reps. The gap shows over the next 1-2 days.

And strength gains barely change with how close to failure people train.

So for strength, failure buys very little and costs a lot of recovery.

Using them?
• One muscle moves only (curls, raises).
• Last set only.
• First to go if your main lifts feel flat or a meet is close.$l$),
('2fd79476-4017-4cca-9fcb-5e550a18a2ff', 'c661a7e46bbc947edf19fae9a5ac6207', $l$Not sore after a session? Doesn't mean it didn't work.

Soreness mostly tracks how new or different the work was. That's why it fades as you get used to a program, even while you're still growing.

In a 2011 study one group was eased into a hard program. That way they avoided muscle damage. Another group got thrown straight in.

The thrown in group was way more sore. Both gained the same size and strength.

Soreness isn't the scoreboard. Reps and weight creeping up over the weeks is 💪$l$),
('36cd935d-4844-49f8-94ca-5a751aae2a96', '459338fd3fac5be3edccd8925c66902d', $l$There's no one right touch point. It has to fit how you're built.

The anchor: from the side, your forearms are about straight under the bar at the bottom.

So touch point and elbows move together. Lower touch, more tuck. Higher touch, more flare.

• Long arms mean more distance to press. A wider grip and a bigger arch can win some back.
• A deep rib cage already makes the press shorter. So you might need less of both.

The mistake at this level is copying someone else's setup. A better position on paper can cost you kilos for months while you relearn it.

Test changes in the off season over weeks, with video. Never mid prep.

Anyone moved their touch point and had it click? 👀$l$),
('37f12048-3418-4344-aeac-ac005fbd21fb', '0e000fbd7395901f96d139013c705757', $l$Feels like everyone at the gym is watching you? Mostly they aren't.

In a 2000 study students had to walk into a room. They wore an embarrassing Barry Manilow t-shirt.

They guessed about half the room could say who was on it. It was closer to 1 in 4.

It's called the spotlight effect. You think people notice you way more than they do. Because you're the one living in your head.

The person on the next bench is thinking about their own set. Their own form, their own phone.

So film your sets. Use the empty bar. Ask for a spot. Do what you came to do 👊$l$),
('39dd293e-343c-41f1-a5b8-c36e069d719d', '76c5acd6cb9ca2655320d67b3afd5119', $l$Is hitting a muscle 3x a week better than 1x? Less than you think.

A 2019 look at 25 studies checked this. When weekly sets were the same, more sessions didn't clearly grow more muscle. The edge only showed up when more sessions also meant more sets.

So training more often is mostly a way to spread your sets out. 15 sets for one muscle in one day gets sloppy. Split over 2-3 days, more of them are good sets.

It matters more for the lifts themselves. Boris Sheiko became head coach of Russia's national powerlifting team. His lifters squat and bench several times a week. The weights average around 70% of max.

That's practice, not just muscle.$l$),
('3b590869-3aed-465b-8fc3-d50902864483', 'e43bcc30cff70d90219205899766357a', $l$A gym lockout and a meet lockout aren't the same thing.

In the gym? Nobody red lights a hitch, soft knees or dropping it the second you stand. On the platform all three can.

IPF style rules:
• Finish tall with knees straight and shoulders back.
• The bar can't move down on the way up.
• No resting it on your thighs.
• Hold still until the down signal.

On heavy singles have someone call "down".

Pick attempts you can lock out clean. A hitched gym PR won't count.

Anyone ever eaten a red light for it? 💀$l$),
('3c12bc29-7437-4a6f-bc1b-8d2549041bb1', 'f809b0be9a30c3239c1be59ac1826fd5', $l$Near your max the extra weight goes to your hips. Your knees don't take more.

A 2022 study took trained men from 90% up to a missed 102%. The hips had to work harder as it got heavy. The knees didn't.

A 2026 study of 29 elite powerlifters saw the same from 70 to 90%. The first wasn't on powerlifters. The second never went heavier.

What I think: that lean is how the hips take the extra.

Film your opener and your top single from the same spot:
• A bit more lean, bar over midfoot, back holds? Normal.
• Misses stall with your hips up? Pause or pin squats just below that spot.
• Bar drifts to your toes or your upper back rounds? Fix it light.

My take: don't force yourself upright in a prep. It hands the load back to knees that weren't taking more.$l$),
('3d5e7a89-f364-4990-9a6f-46d3d87bbdc3', '6138f584fc4456ce9fd9ca736be8d377', $l$Your RPE 6 is a guess. Your RPE 9 is way more accurate.

A 2022 look at the research checked how well people guess their reps left.

Overall people guessed about 1 rep too low. Most of us have a bit more in the tank than we think.

Guesses got better closer to failure, and in sets of 12 or fewer.

Near failure the bar slows way down. So you can feel it coming.

Low RPE calls are rough guesses and that's fine. Top sets at 8 to 9 are where your call matters most.

How close do you think your calls are? 👀$l$),
('3d74ee17-0977-43fb-afee-84260874fd38', '5df7fffa26aa2a88c007b7da8815fd4e', $l$Does cardio kill your gains? Way less than the gym myths say.

A 2022 look at 43 studies compared lifting alone with lifting plus cardio.

Adding cardio caused no drop they could measure in muscle growth or max strength.

What it did hold back was explosive stuff like jump height. Mostly when both were done in the same session.

Where it can bite:
• Hard leg cardio right before squats or pulls.
• So much that it eats into recovery or food.

Separate days or a few hours apart keeps it out of the way.

Thinking of adding a lot? Tell me first 🤝$l$),
('3dbc596d-75ef-4cb1-96ef-a82ea56232c4', '44507d288401561213e88d1a4f37d865', $l$Sunday reset. Plan for the stuff that's going to go wrong.

You already know something will get in the way this week. A late meeting, a kids game, a night out.

Make an if-then plan for it. "if I work late Tuesday then I train Wednesday at 6am".

A 2006 look pulled together 94 tests of these if-then plans.

The boost in people actually reaching their goals was medium to large.

Tonight:
• Name your hardest day this week.
• Write your if-then for it.
• Pick a backup time.

Plans that expect problems survive them 💪$l$),
('3f8ad278-cd00-4610-af07-b7b2598decd0', '8f79b95fb59f8b89d12d506a77a5f0d6', $l$Sunday reset. Before you plan the week, count last week's wins.

Most of us remember every missed session and forget the 3 we crushed.

• Write down 3 wins. A rep PR, a session you almost skipped but did, a week of good sleep. Small ones count.
• One thing you're proud of.
• Pick one to repeat this week.

You train better from "look what I did" than from "look what I missed" 🙌$l$),
('46140e72-7cb0-4717-9c73-f08018cffa31', '2507784f9b51d91f4266bf3c5f232309', $l$Touch and go flies but paused reps die right off the chest?

Part of that is just the stretch. Lowering the bar right before you press helps. A pause bleeds some of that off.

A 2013 study had lifters press from a dead stop. They handled clearly less than with a normal touch.

The part you can fix is the pause itself. People relax on the chest, the bar sinks and the arch goes soft.

• Touch, don't rest. Keep the weight in your hands.
• Pause rep 1 of every set like comp.
• Longer 2-3 second pauses on lighter sets.

If you don't compete, touch and go is fine 👊$l$),
('47ed63fc-d2d9-4262-878e-939e159eba77', 'f162202f8478cdd6a7b1a108271c2385', $l$A bad night costs your max less than you think. A bad week is the problem.

A 2022 look at 69 studies checked short or no sleep. Strength dropped about 3%. Skill tasks dropped about 21%.

Nights in a row are different. In a 1994 study a small group of men slept 3 hours a night. Three nights in a row. Their high rep sets dropped by night two. Then their max bench, leg press and deadlift did too.

All small, mostly men, few lifters.

This week protect the run:
• Same wake time every day.
• Caffeine done 9 hours before bed.
• My take: set a bedtime alarm 8.5 hours before you wake up.

Slept bad anyway? Warm up and judge the bar, not the night.$l$),
('481475a7-6684-4f4d-91a1-b228df717e5b', 'c20e9fde8cffec8fdb63833777a85d13', $l$Your warm ups and your top set aren't quite the same lift.

As the weight goes up the bar slows. Your body moves a bit different to get it going.

Your squat leans a touch more. On bench the bar touches a slightly different spot. On deadlifts your hips rise a bit first.

Some of that is your body finding where it's strongest. Some of it is form breaking down. Video is how we tell them apart.

• Film your heavy sets, not just warm ups.
• Set up every warm up like the top set. Same stance, grip and brace.

Something only changes on heavy sets? Send it to me before you fix it. Might not be a problem at all.$l$),
('4adeb525-9cb5-4e9c-ade3-4e081fd2cf1e', 'f13eef4091ce36f7d6aa3c61aadda29b', $l$Cutting accessory reps short? The bottom half is the part to keep.

When half reps lose to full reps it's usually for one reason. They skip the stretched part of the rep.

Studies looked at leg extensions and calf raises. Half reps in the stretched half grew as much or more than full reps. Half reps in the other half, where the muscle is short, grew the least.

Newer work in trained lifters mostly finds the two about equal.

So full reps are a safe default. If you go partial, keep the stretched end.

Accessories only. Comp lifts still go to comp depth 🫡$l$),
('4d198735-569d-4d3b-a239-3f7771761947', 'aaa4f718946f34908a6f687dcf0be214', $l$Ever notice you always miss in the same spot?

That's your sticking point. In the big 3 you're usually strongest near lockout. The bar slows wherever your levers are worst.

Bench is the classic. Fast off the chest, slow a few inches up, then faster again near lockout.

Off the chest the stretch helps you. A few inches up that help fades before your levers get better.

That slow spot caps how much you can lift. It's usually where your form breaks first too.

Next heavy set notice where the bar slows. That's useful info for us 👀$l$),
('4f6a2328-1ff2-4972-9225-2c71ac12e8a0', '16428d0726b945658b105606b956335c', $l$You don't get stronger in the gym. You get stronger after it.

Right after a hard session you're actually a bit weaker. Then you recover.

If the work was hard enough you end up a little better than before. Hard work, rest, then better.

How long that takes isn't fixed. A heavy deadlift day usually takes longer to recover from than a few crisp bench singles.

Two ways to mess it up:
• Too little work, so your body has no reason to get better.
• Stacking hard sessions before you recover, so the dip keeps getting deeper.

That's a big part of why your week is laid out the way it is.$l$),
('4fe944ea-34ba-43df-9f35-a965bb8c4456', '1c9bf4b730e4007b73934ae8c5f2884e', $l$Athletes got stronger on fake steroids. Old research, wild result 💀

In 1972 researchers told varsity athletes some of them would get steroids. The ones picked got fake pills instead. They gained more in 3 of 4 lifts than in the weeks before.

It's tiny and over 50 years old. So don't trust the exact numbers.

But a 2000 study found something like it in competitive powerlifters. When half were told the truth midway, their extra gains mostly faded.

The takeaway isn't go find sugar pills. Belief changes how hard you push.

Reps you've already hit are how you build that belief for real 💪$l$),
('50189212-d38d-4f3b-9bb1-1dbbfcb4bc45', '343081b6b1e0ddd156f6334cffd9b044', $l$Stuck on the same dumbbells for weeks? Add a rep instead.

A 2022 study had trained lifters do one of two things. Add weight each week, or keep the weight and add reps.

After 8 weeks muscle growth was basically the same.

Dumbbells and machines jump in big steps. So honestly reps are the easier way up a lot of the time.

What matters is that something in your log moves over a few weeks.

An accessory hasn't budged in a month or two? Send it my way 👊$l$),
('56298d4e-dd4b-48cb-9636-3f3db551d74b', '4b5e268e0a28950f9984d1e81b826ce0', $l$How hyped should you be before a max? Depends on you.

Some lifters scream before a big attempt. Some go dead quiet.

A 2024 look at 27 studies checked this. Getting hyped up helped max force in about 65% of tests.

But most of those people were students and newer lifters. So for experienced lifters it's less clear.

Too amped looks like a rushed setup and missed commands.

Too flat looks like the bar feeling heavy before you even unrack it.

Where do you land? 👇$l$),
('5657cc02-16d6-4ab6-bdf2-f19e5680ab19', '9e7081d28191c6ec37526727683df4a3', $l$Scrolling lifting videos and feeling behind? Normal. It's also a rigged fight.

You see their PR. You don't see the 50 sessions before it where nothing happened.

You're putting their best set of the year next to your normal set this week.

Everyone posts the highlight. Nobody posts the Tuesday where the bar felt heavy and they went home.

Compare this instead:
• Your top set now vs 3 months ago.
• Sessions done this month vs last month.
• How a weight you used to grind feels now.

Behind who? You're only racing the you from last year.$l$),
('582e66fa-1685-4497-9f24-3362fcb336d3', '85e2bac069b536a6a824c7ab929ac215', $l$Michael Phelps played a perfect race in his head every night and morning.

His coach Bob Bowman called it watching the videotape. In the 2008 Olympic 200m butterfly final his goggles filled with water. He counted his strokes and still won gold in world record time 🥇

Can picturing a lift make you stronger? Kind of. A 2018 look at the research found just picturing it made people stronger than doing nothing. A medium sized boost. Real training still beat it.

Where it fits for us is practicing meet day in your head. The walkout, the commands, your setup, the grind if the rep slows down.

• Same speed as the real lift.
• Picture the real place.
• Put the hard part in, not just the lockout.$l$),
('5ad05ebe-9b2f-4609-b3d2-73c8f609d73c', 'a5bce6fbb1a56a91501a4d1eeb9dbbf1', $l$Legend says Milo of Croton carried a calf every day. Until it was a full grown bull.

It's the oldest picture of adding a little over time. Ask a bit more of your body as you go.

More weight is the obvious way. It's not the only one:
• Same weight, more reps or sets.
• Same weight, lower RPE or faster bar speed.
• Same weight, cleaner reps.

A single that was RPE 9 last month and moves at RPE 7.5 now? That's real progress 🔥

Judge it across a block, not one session.$l$),
('5d09f4b1-0f6f-4229-bc1a-e7d0b7679e64', '4e59b57b0bd7c3ba2206efb4db5844fc', $l$Knees caving as you come out of the hole?

It's not always a problem. A small knee shift that comes back out halfway up is really common in strong lifters.

Plenty of them squat big with it and have no pain.

Worth working on when:
• It gets worse rep to rep or set to set.
• It's one knee only, or your hips shift with it.
• It hurts, or it shows up on light sets too.

Spread the floor with your feet so your knees follow your toes. Do tempo or pause squats at the weight where it starts.

Weak glutes get blamed for everything. It's rarely that simple. Send me a side and front video before you chase it 👀$l$),
('64691a17-bd50-41ea-b63a-9b92ff749b5b', '05e35909f3a58c9b1ab9738305148945', $l$Waiting for perfect form is how people get stuck on the same weight for a year.

Every lift looks a little different at 90% than at 60%. The bar slows down and your position shifts a bit. That's normal.

What matters is that it's the same every rep. And that it's safe.

Form gets built under weight you can control. Not by staring at the empty bar forever.

What to look for:
• The same setup every rep.
• The bar moving about the same way rep to rep.
• No new pain, and you'd happily do the rep again.

Film one set a week. Compare it to last month, not to a world record lifter.$l$),
('75231436-8dcf-4aa0-bbd1-e3fef6a8f697', '8881edcc4ee6add8b4edd906c5bde460', $l$Sunday reset. Pick one thing to get better at this week.

Not ten. ONE.

• One cue for your main lift. Brace before you unrack. Push the floor away. Same touch point every rep.
• One habit outside the gym. Protein at breakfast. A daily walk. In bed by 10:30.
• Write them down where you'll see them.

A small focus done all week beats a big plan you forget by Wednesday.$l$),
('771a1e29-d14b-43b7-bac6-f6e6cc405b66', '6ee331ce4e4c2c57daa4e44622a29124', $l$They just have good genetics? Half true. It's also an easy excuse.

Genetics are real. Some people grow faster, recover faster, or have a build made for a big bench.

That's not fair and it never will be.

My take: most people who say it haven't trained consistently for even two years. You haven't met your genetics yet. You've met your consistency.

The only comparison that matters:
• You vs you 6 months ago.
• Your log, not their highlight reel.

Find your ceiling first. Then you can complain about it.$l$),
('77f02854-3721-4672-be75-e1e99a7869c9', '3af7c4bdb97721a1185c2cee378f8fb3', $l$Bar drifting off your legs mid pull? Same weight, harder lift.

Bar drifts in front of midfoot? Your hips and back have to fight to hold it. The further, the harder.

The drift is usually a sign of something else:
• The bar starting over your toes instead of midfoot.
• Hips shooting up, so your shoulders swing forward and the bar follows.
• Knees staying forward, so the bar has to go around them.

Think "drag it up your legs".

Paused deadlifts just below the knee teach balance fast. Holding a pause with the bar out front is really hard.

Send me a side video before you rebuild anything 👊$l$),
('7b6f292f-bd84-4d55-8294-0e072ff45f97', '1b4a7adcb2ed2f3800b9715a182a7c26', $l$Should you think about the muscle or the bar? Depends on the lift 🧠

On squat, bench and deadlift, cues about the bar and the floor usually win. Push the floor away. Bar to the same spot.

A 2021 look at the research found people were a little stronger in the moment. That's when they focused outside the body. How big that edge is still gets argued. But it rarely hurts.

Small lifts like curls are kind of flipped. In a 2018 study guys new to lifting did curls. One group focused on squeezing the muscle. The other on moving the weight.

The squeeze group grew their arms more (12.4% vs 6.9%). Quads grew about the same either way.

So bar and floor on the big lifts. Feel the muscle on curls, raises and flyes.$l$),
('7c6279df-fb5b-455c-9b46-ace09c8f3d51', '772c60392fe9191758207a6a6c77d2d6', $l$Drop sets won't build more muscle. But they can save a ton of time.

Go close to failure. Strip about 20-30% of the weight and keep going with no rest. Maybe drop once more.

Two big looks at the research found they grow muscle about as well as regular sets. In some studies they took a half to a third of the time 👀

Use them on the last set of a machine or a one muscle move like curls. Skip them on the main lifts. Stripping plates at failure is a mess.

Want to try one? A single drop on the last set is plenty.$l$),
('7e7499c4-2f43-4bbf-b332-5c8dedaee491', '86a3793f6920a08dc34e78c9d0d88a1c', $l$Same muscle, different exercise, different amount of growth.

Two studies had people train one arm or leg each way for 12 weeks:
• Seated leg curls grew the hamstrings more than lying ones (about 14% vs 9%).
• Triceps grew about 1.4x more with the arm overhead than at your side (cable extensions).

In both, the winner worked the muscle more stretched out.

Small studies, mostly people new to lifting. But picking an accessory? The one that loads the stretch is a good bet.

Anyone actually feel the difference? 👀$l$),
('80cbf126-eb32-4536-82e3-b373604fbcb7', '02606e4088e8a3ce19d2384ff1257cbc', $l$If your warm ups are tiring you out, they're not warm ups anymore.

Warm up sets have one job. Practice the lift and get you ready for the heavy set.

A simple ramp, as a % of your top set:
• The empty bar first.
• 40% for 5.
• 60% for 3.
• 75% for 2.
• 85-90% for a single.

The jumps get smaller and the reps drop as the weight climbs.

Common mistakes: long sets once the warm ups get heavy. And going straight from your heaviest warm up into the top set. Give that one a real rest.

Program lists specific warm ups? Use those 🫡$l$),
('89e75668-36c8-4ec1-886c-8b06e2726735', '54fe777d3c919e9ab2277833edbde9aa', $l$How much protein do you actually need to build muscle?

A 2018 look at 49 studies checked this. Gains kept going up until about 1.6 g per kg of bodyweight a day.

After that they flattened out.

That's about 0.7 g per lb of bodyweight. The top of their range was about 1 g per lb.

So a 198 lb lifter wants about 145 to 200 g a day.

Hitting your total most days matters way more than timing or shakes.

On a dietitian's plan? Follow theirs 🙏$l$),
('90d0fff4-b400-4319-9204-ccc2cd371709', 'cd11f681b630b7475130d2e42c63a0bd', $l$The scale isn't lying. You're just reading one number like it's a trend.

Water, salt, carbs, stress and what's in your gut all move your weight day to day.

A big pizza night can sit on the scale for a couple days. That isn't fat.

One weigh in tells you almost nothing. Seven of them tell you a lot.

How to read it:
• Weigh in the morning, after the bathroom, before food.
• Look at the week's average, not today.
• Compare this week's average to last week's.

Stop letting Tuesday's number ruin your Tuesday 😭$l$),
('9329b64b-8189-4625-91b9-a6dbcadce0e2', 'd3967416cfbf3ab31a97b98ff767d519', $l$Exams, work chaos, a breakup. Your training notices.

A 2008 study followed 135 students through 12 weeks of lifting. The ones with less stress in their life gained more on squat and bench.

That doesn't prove stress caused it. Stressed people might also sleep less or miss more sessions. But later studies tied more stress to slower recovery after hard sessions too.

Think of recovery as one bank account. The gym and life both spend from it.

In a rough week showing up still counts. And tell me. We can change the week so you're not grinding through it 🤝$l$),
('96a946fa-41d2-4cf1-8a74-2ecdde0dee41', '9ca2c326ab211922ca15c5e59a91ce98', $l$What works is boring. That's exactly why most people quit it.

Same lifts. Same days. A bit more weight or one more rep than last time. Sleep, protein, repeat.

There's nothing exciting to post about week 7 of the same squat.

But that's where strength comes from. Not the new exercise you saw this morning.

Switching it up has its place. A new version of a lift to fix a weak spot. Or one that works around a sore joint.

Not because you got bored on a Tuesday.

Training feels boring and the numbers are going up? You're doing it right 💪$l$),
('98f80851-7bad-4a75-89a2-e37d5ee7d573', '6b7232b57bce0492ec143fac60d02e94', $l$Bulgarian weightlifters worked up to a heavy single almost every session.

Their coach Ivan Abadjiev's teams won 57 world titles. Not saying copy it. But it shows something. Lifting a max is a skill, not just a test.

A single has a slower bar, more pressure and more nerves. Your positions have to hold the whole way. Only feel that on meet day? Then you're doing a new skill under max pressure.

A small 2017 study had one group just practice their max for 8 weeks. Another group did 4 sets to failure. Strength gains came out about the same.

That's why singles get built in before a meet. Not to test. To practice.

The ones in your program are there on purpose. This isn't a pass to max every day 💀$l$),
('9c600187-51c2-44e8-8785-5a72733af348', '9eff8481693080905d11f52fa601b525', $l$Arnold paired chest and back in supersets. Research says he was onto something.

Think bench press straight into chin ups. One muscle rests while the other works.

Pairs that work:
• Rows + DB bench.
• Curls + pushdowns.
• Leg curls + leg extensions.

A 2025 look at the research found supersets cut session time. They didn't cost strength or size. Opposite muscle pairs even got people more reps than straight sets.

The catch: they feel harder. And holding two stations in a busy gym is a pain 😭

Keep heavy squat, bench and deadlift as straight sets. Pair the accessories after.$l$),
('9f5fce6b-1f81-4c8c-baf2-2d9dbeafe5ed', 'e4dbe3c234ba9140a1b6e7bad2f3962f', $l$Ripping the bar off the floor feels strong. It usually isn't.

A loaded bar has some play in it. Pull from loose arms and that slack gets taken up mid pull with a jolt. That's often when the back rounds or the hips pop.

• Pull the slack out first. Pull until the bar clicks against the plates and feels heavy. Then push.
• Brace before that slack pull, not after.
• Squeeze it off the floor. Once you're tight, fast is fine.

If your program has you on a dynamic start that pulls clean, keep it.$l$),
('a88e2cb4-9e3e-4e61-988c-c65460054121', 'ddc65f0386dfa90f28f72b812b812460', $l$Skipping cardio to protect your gains? Cardio was never really after them.

A 2022 look at 43 studies compared lifting with and without cardio added. Muscle growth and max strength came out about the same.

What took a hit was explosive strength. Mostly when both were done in the same session.

So:
• Do cardio on its own day, or at least a few hours away from lifting.
• Keep most of it easy. You should be able to talk.
• Don't do a hard run right before squats.

Getting out of breath on the stairs isn't a flex. Your heart is a muscle too 🫡$l$),
('ab631b3e-500f-410f-835f-3176c61eac4b', 'c2e911d63f92ad26066774adff0f3625', $l$Your heaviest singles probably don't start like your warmups.

The research here is thin. A 2025 review looked at how experienced lifters deadlift as the weight goes up. It found only 2 studies.

So nobody can tell you exactly what should change at your max.

Film every heavy single from the side and compare it to a warmup:
• Same change every time? You can train that position.
• Different every time? That's the real problem.

Still breaks the floor and locks out fast? That's probably just how you pull heavy.$l$),
('ad0034b8-8ba0-49b1-9b80-433848dbf29b', 'd2808d7cb95678bb634fd519efc3fe94', $l$Sunday reset. You train maybe 4 hours a week. Look at the other 164.

What you do outside the gym matters. For recovery, for hunger and for how you feel walking into your next session.

This week:
• Pick a daily step goal you can actually hit. Not someone else's 10k.
• A 10 minute walk after one meal a day.
• Take the stairs or the long way once a day.

Easy movement helps you recover. It doesn't take away from your lifting.$l$),
('aee40937-dd2b-4505-a301-f863ed98437b', 'ea758fde8d3dc1157389d578499b2392', $l$Shoulders rolling forward a few reps into the set?

It shows up at the shoulders but the cause is usually somewhere else:
• The unrack. Pressing the bar up out of the hooks pulls your shoulder blades off the bench. That's before rep 1.
• Reaching at the top. Pushing past lockout every rep slowly pulls your shoulder blades loose.

Set your upper back first. Then pull the bar out over your shoulders. Don't press it out.

Each rep is done when your elbows lock. No reaching.

Take a handoff on heavy sets if someone knows how to give one 👀$l$),
('b0be4a2e-59f7-42a7-ab50-183aad13d9d2', 'de6f7ca6ce54605c1b6d5c1a8c999395', $l$Why do we squat to get better at squatting? 👀

Your body gets better at exactly what you make it do. It even has a name: SAID.

Strength isn't just muscle. It's muscle plus practice of that exact lift at that kind of weight.

That's why a huge leg press doesn't automatically mean a huge squat.

A 2017 look at the research compared heavy and light weights. Heavy built your max more. And muscle growth was about the same.

Variations still matter. They build muscle, hit weak spots and give your joints a break.

They feed the main lifts. They don't replace them.$l$),
('b161823d-18dc-430b-a2dc-8e1993d6006e', '74ef8e63cf696d2cf6e653f5c1aa785a', $l$Sunday reset. Plan your rest days as carefully as your training days.

Rest isn't time off from the program. It's part of it.

This week:
• Put your rest days on the calendar on purpose. Don't just let them happen.
• Keep them easy. A walk, some mobility, nothing that leaves you wrecked.
• Still eat your protein. You're recovering, not off the clock.

A good week of training needs a good week of recovery around it.$l$),
('b463a75f-7533-465e-8e20-5cf98bb55e04', '482d2d6c11f175fd5713128589ee26c6', $l$How does doing less make you lift more?

Every session gives you two things at once. Fitness and fatigue. What you can lift on the day is about fitness minus fatigue.

Fatigue builds fast and clears fast. Fitness builds slow and fades slow.

So when you pull back for a bit, fatigue drops way quicker than fitness. And the strength you built finally shows up.

That's a taper.

A 2007 look at the research found what worked best. About 2 weeks of cutting your sets and reps by roughly 40-60%. The weights stayed just as heavy.

Pull back too long though and fitness starts fading too. That's why tapers are short 🏆$l$),
('be4f3e11-64ec-40ac-9a5e-b5edbbb582bd', '28771ef887e6b7eca1331ab5ecc487f4', $l$Butt popping off the bench when it gets heavy?

That's usually leg drive done wrong. Not a lack of it.

Leg drive isn't pushing your hips up. It's pushing yourself back along the bench so your upper back stays wedged in.

• Push like you're sliding yourself toward the rack.
• Move your feet to where pushing doesn't lift you. Often a bit further forward.
• Do light sets where the only goal is keeping your butt down.

In IPF style meets your head, shoulders and butt have to stay on the bench. So this is a red light.

Foot position is personal though. Check with me before you move yours 🤝$l$),
('bf26b213-c0b1-4dab-944f-abe04945b937', '4c023444955b1c33803347a8d6b2ff62', $l$"Everybody want to be a bodybuilder, but nobody wants to lift no heavy ass weight"

Ronnie Coleman, 8x Mr. Olympia 🏆

For strength he's right. For growth, light works too. If it's hard.

A 2017 look at 21 studies tested light vs heavy. Light meant 60% of your max or less. Sets went to failure. Growth came out about the same. Max strength went up more with heavy.

The catch: a light set only works when it gets hard. The first 10 reps of a 25 rep set are easy. It's the grindy reps at the end that count.

So comp lifts stay heavy. Accessories can live anywhere from about 6 to 20+ reps.$l$),
('c5bc075f-fd52-4878-90d0-e2dad2e0016a', 'f2d9770e8b5fb1c4a2dbcdba3b8430b2', $l$A PR shows you your best day. Your log shows you your normal one.

A 2016 look at 138 experiments found checking your progress helps you hit goals. More when it's written down or someone else sees it. Those were mostly health goals, not lifting.

One day is noisy. So read a month or two at a time:
• Same weight, lower RPE? That's strength showing up before a PR.
• RPE creeping up at the same weights for a few weeks? Usually fatigue building.
• Sessions done vs planned. 8 of 12? That's the story.

Bad week? Check sleep, stress, food, and if it was meant to be hard. My rule: change something only if it repeats.

Send me your last 6 weeks, or show a training buddy. That's the someone else sees it part.$l$),
('c8b673f8-ba5c-47c3-8d93-d2844ad50269', '7622cdb1ec060a69e6e83645be3e9ab2', $l$Mike Mentzer took his sets past failure. Research says you just need to get close.

His Heavy Duty training added forced reps and negatives (just the lowering part) after failure. He won the 1978 Mr. Universe heavyweight class with a perfect 300 score.

Two big reviews since then:
• One found going to failure wasn't clearly better for growth than stopping a bit short.
• The other found growth went up the closer sets ended to failure. Strength looked about the same across a wide range.

So for accessories, ending around 0-3 reps in the tank is a good zone. Sets with 5+ reps left probably do less.

Comp lifts are different. We keep those further from failure on purpose 🫡$l$),
('ca29c6da-58be-4eb7-8de5-bb848f5f9c4d', '20f5a2bef3e64814bf98efaf030924a7', $l$Heels coming up at the bottom of your squat?

It's usually one of three things:
• Ankles that don't bend enough yet, so your weight rolls forward.
• A stance that fights your hips. A bit wider or more toes out helps some people.
• Starting the squat by shoving your knees forward. Sit down between your feet instead.

Keep your whole foot on the floor. Bar over midfoot the whole way down.

Slow 3 second goblet squats teach you where your balance is.

Lifting shoes help too. A 2017 study found people squatted with less ankle bend and more knee bend in them.

Heel pain, or only one side? Tell me before you change anything.$l$),
('cdbf3987-c465-4053-83f9-36ade8433275', 'eb88964611b01e0df5595c9ac9820f3e', $l$Your bar path at 95% looks nothing like your warmups?

Super common. A 2025 look at 22 studies on experienced lifters found that as the weight goes up:
• The bar slows down.
• The press takes longer.
• Joint movement varies more.

So the question isn't did it change. It's did it change in a way that costs you.

Worth fixing: losing your touch point, butt or shoulders coming off, bar drifting to your feet.

Maybe leave it: a bit more elbow flare late, or a path that keeps moving. That can be your body finding a stronger spot.

Don't force your 60% path onto a max. Big changes we decide together 🤝$l$),
('d40dfa8f-ef34-4936-84f2-5c8b8b2fb83d', 'a4d539a207e928e88ecc1f9b6e5eea5b', $l$Most people don't need a better program. They need to finish the one they're on.

Every program looks slow in week 2. That's when the new one you saw online starts looking better.

So you switch, start over and get week 1 again. Forever 💀

A boring plan run for 12 weeks beats a perfect one run for 3. The progress is in the repeating.

Same lifts, a bit more weight, a bit better reps.

Before you change anything ask:
• Did I actually do the sessions?
• Did I push the sets I was meant to push?
• Did I sleep and eat like I wanted results?

Any answer a no? Then the program isn't the problem.$l$),
('d4752d81-f98f-44ec-b681-86e75bf4a94c', '6a9ccd108a7802c33b5d8b8733abc144', $l$Ever wonder why your squat looks nothing like someone else's?

It's how you're built. The bar has to stay over the middle of your foot or you lose balance.

Long thighs vs your torso? Your hips sit further back and you lean more. Shorter thighs, more upright.

Neither is wrong. More lean puts more of the work on your hips and back. More upright puts more on your quads.

So don't copy how much someone leans from their highlight video. What looks off on them might be right for your build.

Think yours is off? Send me a video first 👀$l$),
('d629d449-c692-404e-b67c-9ebfc6001907', 'c1bf1bfff5792a25eb4117936871b4d4', $l$Tight at the top but soft at the bottom?

That's your brace leaking. Usually the breath goes into your chest instead of your belly, sides and back.

Or a little air sneaks out on the way down.

A belt gives you something to push against. It doesn't brace for you.

• Big breath before every rep. Belly out into the belt like you're about to get punched.
• Hold it through the hardest part. Breathe at the top.
• 2 second pause squats. Lose it in the pause and you'll lose it in the squat.

Blood pressure or heart issues? Check with your doctor before long breath holds.

Drop the cue that clicked for you 👇$l$),
('d740da28-46d6-4dc3-813a-e40de5d85546', 'bf659fc7facaedd47e6aa95a64dc0010', $l$Arnold used cheat reps on curls. Just not the way most people do 🤣

Strict until he couldn't get another rep. Then just enough body swing to squeeze out a couple more.

Fine when:
• It's the last 1-3 reps of curls, lateral raises or rows.
• You've already hit failure with clean reps.
• The way down stays strict.

A waste when:
• You're swinging from rep 1. The weight is just too heavy.
• It's squat, bench or deadlift. There's no cheat rep there, just a bad rep.

The cheat should help the muscle finish the set. Not do the set for it.$l$),
('d9a32986-f17d-4633-a332-5723ddb2194e', '7f66a34eecb5ab6c56ce6e97515f54c8', $l$Want to know if something works for YOU? Test one thing at a time.

Change 5 things at once and you can't tell what did it.

• Pick ONE thing. Bedtime, caffeine timing, a warm up tweak.
• Decide what you'll track first. Top set RPE, bar speed, a 1 to 5 energy score.
• Do 2 weeks as normal first so you know where you start. Then 4 weeks with the change.
• Compare the averages, not your best day.

One great day is noise. A trend over weeks is info.

Anything touching your sets, reps or exercises, we set it up together first. What would you test? 👇$l$),
('dbfa319b-e92f-4e9c-bfcc-f4486ca51957', 'db10cb49ed0929be08d57e492b5d4b1a', $l$Slow off the floor or slow at the knees? Different fix.

Off the floor it's often setup. Hips too low, slack still in, bar too far out.

At the knees is sneakier. A lot of lockout problems start at the floor. Hips shot up or the bar drifted? Then you reach the knee in a worse spot and stall.

The stall shows up late. The cause was early.

Film from the side. Compare your spot at the knee on a slow rep and a fast warmup:
• Different spot? Fix the floor first.
• Same spot, just slower? That's strength in that part of the pull.

Ask me before adding accessories off this 🤝$l$),
('de2f8a6f-2216-4fce-87b1-fdcb92c3b9e8', 'c6a10bae4d365c97bf97095893b8a614', $l$Think you're hitting depth? The camera might disagree 👀

In a meet your hip crease has to drop below the top of your knee. That's lower than most people think.

Why people miss it:
• Your thighs feel parallel way before you're actually deep.
• Filming from the front or above makes high squats look deep.
• Depth slowly creeps up as the weight climbs.

Film from the side at hip height. Hit the same depth every rep, warm ups too.

A high warm up won't turn into a deep single.

Don't compete? Then depth is your call, not a rule.$l$),
('df26a831-52bd-4f27-8f62-33e2f8f1c97b', '807da46860b1fd01be7b430b2c671660', $l$Machines aren't cheating. For growth they're often the easier pick.

A 2023 look at 13 studies compared free weights and machines. Muscle growth came out about the same. Strength stuck to the tool. Free weights did better on free weight tests.

That's the part for powerlifting. The barbell builds barbell strength. Machines can build the muscle behind it.

They're also easier to take close to failure. You're not spending effort on balance.

Not every machine fits every body. If one feels awkward swap it 🤝$l$),
('e80a571e-986a-4279-a802-c6c0a86669d3', '9bc9c788acb47df198ec2edf4349184b', $l$Sunday reset. Make this week's food easy before you're hungry.

Most nutrition goes wrong on a busy Tuesday at 7pm. Not at the grocery store. So set Tuesday up now.

Tonight:
• Cook 2 protein sources you can grab all week.
• Buy fruit and veg you'll actually eat. Not the ones you think you should.
• Plan Monday and Tuesday meals. The rest gets easier.

You don't need perfect meal prep. You need a fridge that makes the good choice the easy one.$l$),
('ec0713cd-4875-4640-931b-d2e5dede2db3', '1f2c9511fe299c4ef8e866d19df343d4', $l$Missing one workout doesn't ruin your week. Deciding the week is ruined does.

A 2010 study followed people building a new daily habit. For the people they could chart, the typical one took 66 days to feel automatic.

It ranged anywhere from 18 to 254 days.

And missing one day didn't really change how the habit formed.

The problem is never the one miss. It's the "I'll just start again Monday" after it.

Missed today?
• Do the next session as planned. Don't double up.
• Short on time? Do the main lift and leave.
• Never miss twice in a row.

Perfect weeks are rare. A long run of decent ones builds lifters 🙌$l$),
('efa3d76c-3dcb-43b5-ae8b-2578ec5a7c56', '1bd2aeefaf138c82eac920f12b90fb2c', $l$Sunday reset. Clear some noise before the week starts.

You can't focus on your training with 40 other things fighting for your attention.

Tonight:
• Mute the accounts that leave you feeling behind.
• Pick ONE goal for the week, not five.
• Do not disturb on while you train. The texts can wait an hour.

A quieter head lifts better 🤝$l$),
('f1f22128-5c52-47be-8fe8-2fdf8212e155', '71274cd9489b99cc88046ee640ee7ff0', $l$Resting 60 seconds to keep the pump isn't the growth hack it was sold as.

In a 2016 study trained guys ran the same program. Some rested 1 minute and some rested 3.

The longer rest group gained more strength and grew a bit more.

Probably because they kept more reps and weight on the bar each set.

A 2024 look at the research found a small edge for resting longer than a minute. Past about a minute and a half there wasn't much difference.

So rest long enough that your next set is a real set.

Big lifts like squats often need 2 to 3+ minutes. Curls and raises, 90 seconds is usually plenty.$l$),
('f2e625d9-3140-4cf2-a5fa-2773d4557531', '08e450c64a080e520c0b8ffb3d03a04e', $l$Hit failure on full reps? The bottom half might still have more in it.

Stretched half reps are reps in just the stretched part. Bottom half of a curl. Bottom of a leg press.

To stretch out a set: go to failure with full reps. Then grind out 3-5 half reps at the stretched end. More out of the set without adding another one.

A 2025 study had trained lifters train one arm each way. Both grew about the same.

Research on doing them after failure is thin. So it's a tool, not a must.

Good on machines, cables, curls and calves. Never on squat, bench or deadlift 💀$l$),
('f551c7c3-f381-406e-a6db-edc6a1b38ad2', 'de81256d382088a91b66a7cdd9611e3f', $l$Sumo doesn't mean squatting the bar up.

A lot of sumo pullers drop their hips as low as they'll go. Why? It feels strong. Then the hips rise before the bar moves.

• Set your hips where they are when the bar leaves the floor. Not as low as they go.
• Shins close to straight up, knees out over your toes before the pull.
• Knees still in the way? Small changes to width or toe angle. One at a time.

Hip sockets vary a lot. So a stance that works for someone else might not fit you.

Higher hip sumo is fine if the bar moves well. Upright isn't the goal. A strong pull is 💪$l$),
('f94557f3-fb4f-4625-9f65-97f23db9c853', '3de8c4e98e806f4a350836050ad9c543', $l$Sunday reset. Look back before you plan ahead.

Most people start every week fresh and repeat the same mistakes. Two minutes looking back fixes a lot of that.

Ask yourself:
• What went well last week?
• What got in the way?
• What's one thing to do different?

Just one. Not a whole new life on Monday. One thing, done all week.$l$),
('f9ee39e9-ccbe-4626-b71a-32510a75e28b', 'c36e12d9ef62d947a826ef98fff0d9e3', $l$Sunday reset. Decide your minimum before the week gets busy.

Some day this week is going to go sideways. Decide now what you'll do when it does.

That way you don't decide on the spot to do nothing.

Your bad day plan:
• Write a 20 minute version of your session.
• Main lift and one accessory. That's it.
• Never skip twice in a row.

Short sessions keep the habit alive. Skipped ones don't.$l$),
('ff2c736a-f5db-48c7-9384-1106a82c1198', '884a2d5b7293f109cf189d7813e47777', $l$Bar sliding down your back on heavy singles but not on lighter sets?

Under more weight the shelf your upper back makes can go soft.

As the bar slips you lean more to keep it over midfoot. Then your wrists and elbows start holding weight.

Usually it's:
• The bar a bit lower, or in a different spot set to set.
• Upper back not squeezed tight before you unrack.
• A slippery shirt and no chalk.

Squeeze the bar into your back in the same spot every set. Warm ups too.

Chalk your shirt where the bar sits.

Don't move your bar position near a meet without talking to me. It changes the whole squat.$l$);

UPDATE public.community_series_items i
   SET body = r.body, updated_at = now()
  FROM coach_voice_items r
 WHERE i.id = r.id AND md5(i.body) = r.old_md5;

-- ── 3. Holidays ──────────────────────────────────────────────────────────────
CREATE TEMP TABLE coach_voice_holidays (key text PRIMARY KEY, old_md5 text NOT NULL, body text NOT NULL);

INSERT INTO coach_voice_holidays (key, old_md5, body) VALUES
('canada_day', 'a8cc246e6865ee1ae6ebe1b671392361', $h$Happy Canada Day 🇨🇦 Enjoy the long weekend.

Have a glass of water before every drink today. You'll train a lot better tomorrow.$h$),
('christmas', '49a049b1c8c6bea21557d7d635ea3a13', $h$Merry Christmas 🎄 Thank you for every session this year.

One big meal doesn't change your progress. Leave the tracking for a day and be there for it.$h$),
('easter', '2922600aaf5aa8f5623c268939f54a1c', $h$Happy Easter 🐣 Grateful for every one of you.

Go for a 20 minute walk with the family after the big meal. Then enjoy the chocolate.$h$),
('fathers_day', '32c0cbd2378c38066c8a2777f7987f34', $h$Happy Father's Day to the dads in here 👊

Get 15 minutes of movement in with your kid or your dad today. A walk or a game of catch is plenty.$h$),
('halloween', '8d4e970d377c3a68eaf1fb5a4309fe57', $h$Happy Halloween 🎃 Yes, you can have the candy.

Eat a real meal with some protein first and you'll probably eat less of it. One night won't move your trend.$h$),
('labour_day', '14a1bd1e859ab278b7e6c74bc315d745', $h$Happy Labour Day. Thanks for putting the work in all summer.

Put this week's sessions in your calendar now. If it isn't scheduled, it usually doesn't happen.$h$),
('mothers_day', 'f93907a481473e52869999e7f4f89678', $h$Happy Mother's Day to the moms in here 💐

Text your mom one thing she taught you that you still use. It means more than the card.$h$),
('new_year', 'd44e418a44ca39af68d2dd9d44c80c0e', $h$Happy New Year 🎉 Thank you for every rep last year.

Pick one habit for this year, not ten, and set a reminder to check on it next week.$h$),
('thanksgiving', '15008c44820ddba8bd74339dd5d59d69', $h$Happy Thanksgiving. I'm grateful for every one of you.

Before you eat, text one person who helped you get here. Then enjoy the meal.$h$),
('valentines', 'e5fb904d5d5990451d40afeb5f9d4b66', $h$Happy Valentine's Day ❤️ I love this crew.

Leave a real comment on someone's post today. It takes 30 seconds and it'll make their day.$h$);

UPDATE public.community_holidays h
   SET body = r.body
  FROM coach_voice_holidays r
 WHERE h.key = r.key AND md5(h.body) = r.old_md5;

-- ── 4. The templates ────────────────────────────────────────────────────────
-- Each fix is an exact piece of the live function (quotes doubled, as in its
-- source) and what it becomes. A piece that's gone and wasn't replaced stops
-- the migration; one already replaced is skipped, so it can run again.

DO $do$
DECLARE
  fixes text[] := ARRAY[
    ['community_week_wins', $o$v_from timestamptz := (_week_start::timestamp AT TIME ZONE tz);$o$,
      $n$v_from timestamptz := public.local_to_instant(_week_start::timestamp, tz);$n$],
    ['community_week_wins', $o$v_to timestamptz := ((_week_start + 7)::timestamp AT TIME ZONE tz);$o$,
      $n$v_to timestamptz := public.local_to_instant((_week_start + 7)::timestamp, tz);$n$],
    ['community_week_wins', $o$pc.completed_at >= ((_week_start - 7 * v_streak)::timestamp AT TIME ZONE tz)$o$,
      $n$pc.completed_at >= public.local_to_instant((_week_start - 7 * v_streak)::timestamp, tz)$n$],
    ['community_week_wins', $o$pc.completed_at < ((_week_start - 7 * v_streak + 7)::timestamp AT TIME ZONE tz)$o$,
      $n$pc.completed_at < public.local_to_instant((_week_start - 7 * v_streak + 7)::timestamp, tz)$n$],
    ['community_week_wins', $o$'new ' || CASE pr.scope WHEN 'atpr' THEN 'all time' WHEN 'program_pr' THEN 'program' ELSE 'block' END || ' PR for '$o$,
      $n$'New ' || CASE pr.scope WHEN 'atpr' THEN 'all-time' WHEN 'program_pr' THEN 'program' ELSE 'block' END || ' PR for '$n$],
    ['community_week_wins', $o$' just hit a new ' || CASE pr.scope WHEN 'atpr' THEN 'all time' WHEN$o$,
      $n$' just hit a new ' || CASE pr.scope WHEN 'atpr' THEN 'all-time' WHEN$n$],
    ['community_week_wins', $o$'. all time PR',$o$,
      $n$'. All-time PR',$n$],
    ['community_week_wins', $o$'new all time PR for '$o$,
      $n$'New all-time PR for '$n$],
    ['community_week_wins', $o$' for an all time PR']$o$,
      $n$' for an all-time PR']$n$],
    ['community_week_wins', $o$'. program PR',$o$,
      $n$'. Program PR',$n$],
    ['community_week_wins', $o$'program PR for '$o$,
      $n$'Program PR for '$n$],
    ['community_week_wins', $o$'. block PR',$o$,
      $n$'. Block PR',$n$],
    ['community_week_wins', $o$'block PR for '$o$,
      $n$'Block PR for '$n$],
    ['community_week_wins', $o$v_texts[1] || '. ' || v_pr_lifts || ' PRs in 1 week, that''s insane',$o$,
      $n$v_texts[1] || ', one of ' || v_pr_lifts || ' PRs in a single week',$n$],
    ['community_week_wins', $o$v_texts[2] || '. ' || v_pr_lifts || ' PRs in 1 week, crazy',$o$,
      $n$v_texts[2] || '. ' || v_pr_lifts || ' PRs in one week',$n$],
    ['community_week_wins', $o$v_texts[3] || '. ' || v_pr_lifts || ' PRs on the week, honestly kind of insane']$o$,
      $n$v_texts[3] || ', ' || v_pr_lifts || ' PRs on the week']$n$],
    ['community_week_wins', $o$'welcome to the crew, ' || v_name || '. ' || CASE WHEN v_sessions = 1 THEN 'first session in the books' ELSE 'first week done, '$o$,
      $n$'Welcome to the crew, ' || v_name || '. ' || CASE WHEN v_sessions = 1 THEN 'First session in the books' ELSE 'First week done, '$n$],
    ['community_week_wins', $o$'first week done for ' || v_name || CASE WHEN v_sessions = 1 THEN '. first one is always the hardest'$o$,
      $n$'First week done for ' || v_name || CASE WHEN v_sessions = 1 THEN '. The first one is always the hardest'$n$],
    ['community_week_wins', $o$' days off. the first one back is the hardest and it''s done',$o$,
      $n$' days off. The first one back is the hardest, and it''s done',$n$],
    ['community_week_wins', $o$'good to have ' || v_name$o$,
      $n$'Good to have ' || v_name$n$],
    ['community_week_wins', $o$' days off. hardest part done']$o$,
      $n$' days off. Hardest part done']$n$],
    ['community_week_wins', $o$'. every session done']$o$,
      $n$'. Every session done']$n$],
    ['community_week_wins', $o$'. that''s how it''s done',$o$,
      $n$'. That''s how it''s done',$n$],
    ['community_week_wins', $o$' got a session in and that counts'$o$,
      $n$' got a session in'$n$],
    ['community_compose_wins', $o$(ARRAY['what a week. ' || v_prs || ' PRs last week', 'big week. ' || v_prs || ' PRs between everyone last week'])$o$,
      $n$(ARRAY[v_prs || ' PRs across the crew last week', 'Big week. ' || v_prs || ' PRs between everyone last week'])$n$],
    ['community_compose_wins', $o$(ARRAY['big week. ' || v_prs || ' PRs between everyone', 'last week was a good one. ' || v_prs || ' PRs across the crew'])$o$,
      $n$(ARRAY['Big week. ' || v_prs || ' PRs between everyone', 'Last week was a good one. ' || v_prs || ' PRs across the crew'])$n$],
    ['community_compose_wins', $o$(ARRAY['most of the crew showed up last week', 'good week from this group'])$o$,
      $n$(ARRAY['Most of the crew showed up last week', 'Good week from this group'])$n$],
    ['community_compose_wins', $o$(ARRAY['some wins from last week', 'a few highlights from last week'])$o$,
      $n$(ARRAY['Some wins from last week', 'A few highlights from last week'])$n$],
    ['community_compose_wins', $o$v_outro := (ARRAY[v_n || ' of you got after it last week. proud of this crew 🔥',
                    'that''s the standard. let''s go again this week',
                    'not on here yet? you will be. let''s go',
                    'everyone who showed up last week built this. same again this week'])[1 + v_wk % 4];$o$,
      $n$v_outro := (ARRAY[v_n || ' of you trained last week. Not on here yet? Log every set. The app can''t find a PR you didn''t record.',
                    'Same plan this week: do the sets as written and log them honestly.',
                    'Not on here yet? Run your program as written and log every set. That''s how you end up on this list.',
                    'Everyone who showed up last week built these numbers. Same again this week.'])[1 + v_wk % 4];$n$],
    ['community_compose_wins', $o$ARRAY['🔥🔥🔥','🔥','💪','🙌','🏆','🥇','🫡','👊']$o$,
      $n$ARRAY['🔥','💪','🏆','🫡','👊']$n$],
    ['community_compose_wins', $o$  IF v_prs >= 25 AND coalesce(array_length(v_hype, 1), 0) > 0 THEN
    -- its own beat: "thats craaazy!! big week", never "thats craaazy big week"
    v_hype_word := lower(v_hype[1 + v_wk % array_length(v_hype, 1)]);
    v_intro := v_hype_word || CASE WHEN v_hype_word ~ '[!?.]$' THEN ' ' ELSE '!! ' END || v_intro;
  END IF;
$o$,
      $n$  -- no hype word in front of the numbers (Nov 7 2026): the numbers are the hook
$n$],
    ['community_compose_wins', $o$string_agg(coalesce(w->'texts'->>((pos - 1 + v_wk)::int % 3), w->>'text'), E'\n\n' ORDER BY pos)$o$,
      $n$string_agg(coalesce(w->'texts'->>((pos - 1 + v_wk)::int % 3), w->>'text') || '.', E'\n\n' ORDER BY pos)$n$],
    ['community_compose_wins', $o$  -- lowercase every week, the way he texts (names in the win lines keep their capitals)
  v_caption := v_intro || E'\n\n' || v_lines$o$,
      $n$  -- sentence case, the way he writes a post (Nov 7 2026)
  v_caption := v_intro || '.' || E'\n\n' || v_lines$n$],
    ['community_compose_observation', $o$'do the people who train more hit more PRs? I checked the last 8 weeks 📊'$o$,
      $n$'Do the people who train more hit more PRs? I checked the last 8 weeks 📊'$n$],
    ['community_compose_observation', $o$'the ' || (v_best->>'a') || ' of you training 3+ times a week hit about '$o$,
      $n$'The ' || (v_best->>'a') || ' of you training 3+ times a week hit about '$n$],
    ['community_compose_observation', $o$' PRs each. the other ' || (v_best->>'b') || ': about ' || (v_best->>'y') || E'\n\n'$o$,
      $n$' PRs each. The other ' || (v_best->>'b') || ': about ' || (v_best->>'y') || '.' || E'\n\n'$n$],
    ['community_compose_observation', $o$'it''s not proof. how long you''ve lifted and what''s going on in life matter too. but more good reps at a lift is how you get better at it'$o$,
      $n$'It''s not proof. How long you''ve lifted and what''s going on in life matter too. But more good reps at a lift is how you get better at it.'$n$],
    ['community_compose_observation', $o$'does missing a week cost you PRs? I checked the last 8 weeks 📊'$o$,
      $n$'Does missing a week cost you PRs? I checked the last 8 weeks 📊'$n$],
    ['community_compose_observation', $o$'the ' || (v_best->>'a') || ' of you who missed 1 week or less: about ' || (v_best->>'x') || ' PRs each. the ' || (v_best->>'b') || ' who missed 2+ weeks: about ' || (v_best->>'y') || E'\n\n'$o$,
      $n$'The ' || (v_best->>'a') || ' of you who missed 1 week or less: about ' || (v_best->>'x') || ' PRs each. The ' || (v_best->>'b') || ' who missed 2+ weeks: about ' || (v_best->>'y') || '.' || E'\n\n'$n$],
    ['community_compose_observation', $o$'it''s not proof, a lot goes into it. but the ones who show up every week keep being the ones with the PRs'$o$,
      $n$'It''s not proof, a lot goes into it. But the ones who show up every week keep being the ones with the PRs.'$n$],
    ['community_compose_observation', $o$'slept under 5 hours? your workout reviews say the session feels it 📊'$o$,
      $n$'Slept under 5 hours? Your workout reviews say the session feels it 📊'$n$],
    ['community_compose_observation', $o$'those sessions got rated ' || (v_best->>'x') || '/5. the rest: ' || (v_best->>'y') || '/5. that''s ' || (v_best->>'a') || ' sessions from ' || (v_best->>'people') || ' of you' || E'\n\n'$o$,
      $n$'Those sessions got rated ' || (v_best->>'x') || '/5. The rest: ' || (v_best->>'y') || '/5. That''s ' || (v_best->>'a') || ' sessions from ' || (v_best->>'people') || ' of you.' || E'\n\n'$n$],
    ['community_compose_observation', $o$'it''s a pattern, not proof. rough night? keep the top set honest and don''t chase a PR that day'$o$,
      $n$'It''s a pattern, not proof. Rough night? Keep the top set honest and don''t chase a PR that day.'$n$],
    ['community_feature_stat', $o$'. those ' || (v_c->>'a') || ' hit about ' || (v_c->>'x') || ' PRs each the last 8 weeks. everyone else: about ' || (v_c->>'y')$o$,
      $n$'. Those ' || (v_c->>'a') || ' hit about ' || (v_c->>'x') || ' PRs each the last 8 weeks. Everyone else: about ' || (v_c->>'y')$n$],
    ['community_feature_stat', $o$'. those ' || (v_c->>'a') || ' trained about ' || (v_c->>'x') || ' times a week the last 8 weeks. everyone else: ' || (v_c->>'y')$o$,
      $n$'. Those ' || (v_c->>'a') || ' trained about ' || (v_c->>'x') || ' times a week the last 8 weeks. Everyone else: ' || (v_c->>'y')$n$],
    ['community_feature_stat', $o$'. the app doesn''t do it for you. the people who use it are just more locked in'$o$,
      $n$'. The app doesn''t do it for you. The people who use it are just more consistent.'$n$],
    ['community_birthday_compose', $o$v_since := ' since ' || lower(to_char($o$,
      $n$v_since := ' since ' || (to_char($n$],
    ['community_birthday_compose', $o$    'happy birthday ' || v_name || ' 🎂',
    'happy birthday to ' ||$o$,
      $n$    'Happy birthday ' || v_name || ' 🎂',
    'Happy birthday to ' ||$n$],
    ['community_birthday_compose', $o$    'it''s ' || v_name || '''s birthday today 🎂🎉',
    'HBD ' || v_name || ' 🎉',
    'big happy birthday to ' || v_name || ' today 🎂'];$o$,
      $n$    'It''s ' || v_name || '''s birthday today 🎂',
    'Happy birthday, ' || v_name || ' 🎉',
    'Big happy birthday to ' || v_name || ' today 🎂'];$n$],
    ['community_birthday_compose', $o$ARRAY['does NOT miss 💪🔥🔥🔥', 'the consistency is crazy 💪', 'that''s what showing up looks like 🔥🔥🔥']$o$,
      $n$ARRAY['That''s what consistency looks like.', 'Week after week, that adds up.', 'That''s what showing up looks like.']$n$],
    ['community_birthday_compose', $o$ARRAY['getting stronger and it shows 💪', 'the strength is going up 🔥', 'proud of the work you''ve been putting in 🙌']$o$,
      $n$ARRAY['Getting stronger, and it shows.', 'The numbers are moving the right way.', 'Proud of the work you''ve been putting in.']$n$],
    ['community_birthday_compose', $o$ARRAY['showing up week after week 💪', 'love the consistency 🙌']$o$,
      $n$ARRAY['Showing up week after week.', 'Love the consistency.']$n$],
    ['community_birthday_compose', $o$ARRAY['so glad you''re part of this crew 🙌', 'glad to have you in the crew 🙏']$o$,
      $n$ARRAY['So glad you''re part of this crew.', 'Glad to have you in the crew.']$n$],
    ['community_birthday_compose', $o$    'enjoy today, eat the cake. then we go again',
    'hope today is a great one, enjoy it 🙌',
    'have the best day, you deserve it 🙏',
    'go enjoy your day, the gym can wait (for today) 🤣',
    'eat the cake. all of it 🤤'];$o$,
      $n$    'Enjoy today and eat the cake. Then we go again.',
    'Hope today is a great one.',
    'Have the best day.',
    'Go enjoy your day. The gym can wait, for today.',
    'Eat the cake. All of it.'];$n$]
  ];
  f text[];
  fn record;
  src text;
  def text;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('community_week_wins', 'community_compose_wins', 'community_compose_observation',
                         'community_feature_stat', 'community_birthday_compose')
  LOOP
    src := pg_get_functiondef(fn.oid);
    def := src;
    FOREACH f SLICE 1 IN ARRAY fixes LOOP
      CONTINUE WHEN f[1] <> fn.proname;
      IF position(f[2] IN def) > 0 THEN
        def := replace(def, f[2], f[3]);
      ELSIF position(f[3] IN def) = 0 THEN
        RAISE EXCEPTION 'coach voice: % no longer has %', fn.proname, f[2];
      END IF;
    END LOOP;
    IF def <> src THEN EXECUTE def; END IF;
  END LOOP;
END
$do$;
