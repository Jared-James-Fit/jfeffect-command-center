-- The lesson library, second pass: written the way the coach rewrote the first
-- lesson before it went out (sentence case, short lines, "a 2018 study found"
-- instead of author names in the post; the studies stay in refs for him),
-- about a quarter shorter, and with a real athlete or coach up top where one
-- makes the point. Every athlete fact is in that lesson's refs.
--
-- Only a lesson still exactly as seeded (md5 of the seeded body) and never
-- posted is rewritten, so anything the coach edited or already posted stays
-- his. Planned days without their own wording pick up the new text.
WITH v(key, seeded_md5, body, data) AS (VALUES
  ('squat-heels-lift', '30dbcb377827413ab0c924eb2b6b858a', $l$Heels coming up at the bottom of your squat?

Usually one of three things.
• Ankles that don't bend enough yet, so your weight rolls forward
• A stance that fights your hips. A bit wider or more toe out helps some people
• Starting the squat by shoving your knees forward instead of sitting down between your feet

Keep the whole foot on the floor and the bar over midfoot the whole way down. Slow 3 second goblet squats teach you where balance is.

Lifting shoes help too. A 2017 study found people squatted with less ankle bend and more knee bend in them.

Heel pain, or only one side? Tell me before you change anything.$l$, $j${"key":"squat-heels-lift"}$j$::jsonb),
  ('squat-brace-bottom', 'de0b49b0f6eb386e9a35dea60a177f78', $l$Tight at the top, soft at the bottom?

That's a brace leaking. Usually the breath goes into your chest instead of your belly, sides and back. Or a little air sneaks out on the way down.

A belt gives you something to push against. It doesn't brace for you.

• Big breath before every rep, belly out into the belt like you're about to get punched
• Hold it through the hardest part, breathe at the top
• 2 second pause squats. Lose it in the pause, you'll lose it in the squat

Blood pressure or heart issues? Check with your doctor before long breath holds.

Drop the cue that clicked for you 👇$l$, $j${"key":"squat-brace-bottom"}$j$::jsonb),
  ('squat-depth-check', '29e8afef8487bae94689a4a9a82e0938', $l$Think you're hitting depth? The camera might disagree 👀

In competition the top of your thigh at the hip crease has to drop below the top of your knee. Lower than most people think.

Why people miss it
• Thighs feel parallel way before you're actually deep
• Filming from the front or above makes high squats look deep
• Depth quietly creeps up as the weight climbs

Film from the side at hip height. Hit the same depth on every rep, warmups included. A high warmup won't turn into a deep single.

Don't compete? Then depth is a training choice, not a rule.$l$, $j${"key":"squat-depth-check"}$j$::jsonb),
  ('squat-good-morning', 'dfaafd49b212b57da9869614e112c92c', $l$Hips shoot up first and your squat turns into a good morning?

Usually your quads are the limiter. Tipping forward shifts the work off your knees and onto your hips and back.

Or your upper back softens, the bar rolls forward and your chest follows.

What helps
• Drive your upper back up into the bar so hips and chest rise together
• Pause or tempo squats to own the bottom
• Front squat way behind your comp squat? Quad work beats any cue

Long thighs and a short torso need more lean. That's your build, not a fault.

Only on the last grinder of a set? That's fatigue. Send me a vid before you change anything.$l$, $j${"key":"squat-good-morning"}$j$::jsonb),
  ('squat-sticking-above-parallel', '7584f701888e6be58c49c0d8c9919d1c', $l$Bar flies out of the hole then dies a few inches above parallel?

Almost everyone has a spot like this. A 2021 study on 3RM squats found that right there the torso leaned more, the hips took a bigger share of the work and force into the floor dipped.

So which one is yours?
• Your position changes there (hips shoot, chest drops, bar drifts). That's technique. Pause at that height or use tempo squats
• The bar just slows while everything looks the same. That's strength. More heavy practice and time

Only on the last rep of a hard set? Normal fatigue. Let's figure out which one it is before you change anything 🤝$l$, $j${"key":"squat-sticking-above-parallel"}$j$::jsonb),
  ('squat-knee-cave', 'd30bf54767473bcedf3f8ea6e8f48830', $l$Knees caving as you come out of the hole?

Not automatically a problem. A small knee shift that comes back out by mid range is really common in strong lifters, and plenty of them squat big with it pain free.

Worth working on when
• It gets worse rep to rep or set to set
• It's one knee only, or your hips shift with it
• It hurts, or it shows up on light sets too

Spread the floor with your feet so your knees follow your toes. Tempo or pause squats at the weight where it starts.

Weak glutes get blamed for everything. It's rarely that simple. Send me a side and front vid before chasing it 👀$l$, $j${"key":"squat-knee-cave"}$j$::jsonb),
  ('squat-torso-angle-max', '711646be83f103bc839eecac3bc6f5e8', $l$At 95%+ a few degrees of extra lean can turn a make into a miss

More lean puts your hips further behind the bar, so more of the job lands on your hips and back. A 2022 study took lifters from 90% to 100% to a missed 102%. Hip demand climbed with the load. Knee demand stayed about the same.

So a lean that costs nothing at 85% can push your hips past their limit on a max.

What to check
• Opener vs top single, same camera spot. Compare torso angle at the sticking point
• Same descent speed on every single
• RPE 8-9 singles in training with your exact platform cue

Some extra lean near max is normal and might be your strongest pattern. Forcing a more upright squat late in a prep usually costs more than it gives. Ask me first.$l$, $j${"key":"squat-torso-angle-max"}$j$::jsonb),
  ('squat-walkout-commands', '2ad416c5e0867f60f07c391f5dc8f24b', $l$How much of your max are you spending before the squat even starts?

A long walkout, shuffling feet and standing half braced waiting for the command all cost tightness.

• Same walkout every time. Usually 2 or 3 steps. Back, out, set
• Brace before the unrack and stay braced
• Practice commands on heavy singles. Have someone call squat and rack so a slow call doesn't throw you

In IPF style meets you don't get the squat call until you're still with your knees locked. Rules differ a bit between feds, so check yours.

If your walkout already works, don't rebuild it the month before a meet.$l$, $j${"key":"squat-walkout-commands"}$j$::jsonb),
  ('squat-bar-slip', 'a697ddb1eb55ca72e97d3612a9b74e25', $l$Bar sliding down your back on heavy singles but not lighter sets?

Under more weight the shelf your upper back makes can soften. As the bar slips you lean more to keep it over midfoot, and your wrists and elbows start holding weight.

Usually it's
• The bar a bit lower, or in a different spot set to set
• Upper back not packed tight before the unrack
• A slippery shirt and no chalk

Squeeze the bar into your back in the same spot every set, warmups included. Chalk your shirt where the bar sits.

Don't move your bar position near a meet without talking to me. It changes the whole squat.$l$, $j${"key":"squat-bar-slip"}$j$::jsonb),
  ('bench-touch-point-inconsistent', '1ba3953dec709f9b24f59f170014a12f', $l$Bar landing somewhere different on your chest every rep?

Where your elbows go pretty much decides where the bar lands. Tuck one rep, flare the next, and the touch point moves with them.

• Pick a target and aim for it every rep. Around the bottom of the sternum is a good start for a lot of people
• Lower your lighter sets over 2-3 seconds so you can feel where it lands
• Film from the side. Feel lies on this one

An inch of difference between reps is normal. If we already set your touch point up a certain way, stick with it.$l$, $j${"key":"bench-touch-point-inconsistent"}$j$::jsonb),
  ('bench-butt-off-bench', '002050bdfb02964338838d17b4c22349', $l$Butt popping off the bench when it gets heavy?

That's usually leg drive done wrong, not a lack of it. Leg drive isn't pushing your hips up. It's pushing yourself back along the bench so your upper back stays wedged.

• Push like you're sliding yourself toward the rack
• Move your feet to where pushing doesn't lift you, often a bit further forward
• Do light sets where the only goal is your butt staying down

In IPF style meets your head, shoulders and butt have to stay on the bench, so this is a red light. Foot position is personal though. Check with me before you move yours.$l$, $j${"key":"bench-butt-off-bench"}$j$::jsonb),
  ('bench-shoulders-rolling-forward', '062baac5ccfc250fc1edcb6c63b0d57a', $l$Shoulders rolling forward a few reps into the set?

It shows up at the shoulders, but the cause is usually somewhere else.
• The unrack. Pressing the bar up out of the hooks pulls your shoulder blades off the bench before rep 1
• Reaching at the top. Pushing past lockout every rep slowly unpins you

Set your upper back first. Then pull the bar out over your shoulders instead of pressing it out. Each rep is done when your elbows lock. No reaching.

Take a handoff on heavy sets if someone knows how to give one 👀$l$, $j${"key":"bench-shoulders-rolling-forward"}$j$::jsonb),
  ('bench-midrange-position', '2bf878d5488a49c3d2621b8624f64485', $l$Bar slows halfway up and your whole position falls apart?

Some slowdown there is normal. A 1989 study on elite powerlifters described it as the gap between the help from the stretch at the bottom and the better leverages higher up.

The problem is what you do in it. Elbows flare early, the bar drifts toward your feet, shoulders come off the bench. You look for an easier spot and find a worse one.

• Keep your forearms under the bar until it's past the slow spot
• Think push yourself away from the bar
• Pause where it usually slows to practice holding position there

Only on true max grinders? That's probably just where your strength runs out. Breaking down at RPE 7? More likely technique.$l$, $j${"key":"bench-midrange-position"}$j$::jsonb),
  ('bench-weak-after-pause', '7572c5a1d9154066f0f55d11be058123', $l$Touch and go flies but paused reps die right off the chest?

Part of that is just the stretch. Lowering the bar right before you press helps, and a pause bleeds some of that off. In a 2013 study, lifters pressing from a dead stop handled noticeably less than with a normal touch.

The part you can fix is the pause itself. People relax on the chest, the bar sinks and the arch softens.

• Touch, don't rest. Keep the weight in your hands
• Pause rep 1 of every set like comp
• Longer 2-3 second pauses on lighter sets

If you don't compete, touch and go is fine.$l$, $j${"key":"bench-weak-after-pause"}$j$::jsonb),
  ('bench-lockout-stall', '8389bc8b86abdfd1c79551a84d60c5a6', $l$Bench dies 2 inches from lockout? It's not always triceps

A lot of lockout misses are really mid-range misses. The bar just ran out of speed up top.

Other usual suspects
• The bar drifts toward your feet. Finishing over your chest instead of your shoulders makes the top harder
• One arm finishes first because your grip isn't centered

Film from the side and look where the bar actually slows, not where it stopped. Once it's off your chest, think push the bar back toward the rack.

Send me a side vid of your next heavy single and I'll tell you which one it is.$l$, $j${"key":"bench-lockout-stall"}$j$::jsonb),
  ('bench-touch-elbows-build', 'ef20f95013c86b62f259d677ba44e841', $l$There isn't one correct touch point. It has to fit how you're built

The anchor is forearms roughly stacked under the bar at the bottom, seen from the side. So touch point and elbows move together. Lower touch, more tuck. Higher touch, more flare.

• Long arms mean more distance to press. A wider grip and a bigger arch can win some back
• A deep rib cage already shortens the press, so you might need less of both

The mistake at this level is copying someone else's setup. A better position on paper can cost you kilos for months while you relearn it.

Test changes off-season over weeks, with video. Never mid prep.

Anyone moved their touch point and had it click? 🤔$l$, $j${"key":"bench-touch-elbows-build"}$j$::jsonb),
  ('bench-sink-on-command', 'fa27e95efe39fe7c18b94a1638912f66', $l$Bar dips a tiny bit right as you hear press? Refs see that

Under IPF style rules the bar has to be motionless on your chest before the press command. Sinking or heaving it after that is a red light.

It usually happens because the bar was resting on your chest, so you sink it to get tight again or to grab a mini bounce.

• Touch and freeze. Control the last few inches so it stops dead
• Have someone call press at random, sometimes instantly, sometimes after 2 seconds
• Film from the side at chest height. You can't feel a 1cm dip

If your pause already gets whites, don't change it near a meet.$l$, $j${"key":"bench-sink-on-command"}$j$::jsonb),
  ('bench-path-changes-heavy', 'd496356e2bbcc23e3f692b23ff10342a', $l$Your bar path at 95% looks nothing like your warmups?

Super common. A 2025 review of 22 studies on experienced lifters found that as the load goes up the bar slows, the press takes longer and joint movement gets more variable.

So the question isn't did it change. It's did it change in a way that costs you.
• Worth fixing: losing your touch point, butt or shoulders coming off, the bar drifting toward your feet
• Maybe leave it: a bit more flare late, or a path that keeps moving. That can be your body finding a stronger spot

Don't force your 60% path onto a max. Big changes we decide together.$l$, $j${"key":"bench-path-changes-heavy"}$j$::jsonb),
  ('deadlift-hips-shoot-up', '7e095c07e80ca233d46ddd1cf2f8a0c0', $l$Hips shoot up and the bar still hasn't left the floor? 👀

Super common. And the hips usually aren't the real problem.
• You set up lower than you can pull from, so your hips rise until they find where you actually start
• No tension before the pull, so the hips move before the bar does

Film from the side. Where your hips are when the bar breaks is your real start, so set up there. Pull the slack out so the bar and your hips move together.

Short arms or long legs for your height usually means higher hips. That's your build, not a fault.$l$, $j${"key":"deadlift-hips-shoot-up"}$j$::jsonb),
  ('deadlift-jerk-slack', '2c3fd09c2e9c74fa07b3fd8de67e347f', $l$Ripping the bar off the floor feels strong. It usually isn't

A loaded bar has some play. Pull from loose arms and that slack gets taken up mid pull with a jolt. That's often when the back rounds or the hips pop.

• Pull the slack out first. Pull until the bar clicks against the plates and feels heavy, then push
• Brace before that slack pull, not after
• Squeeze it off the floor. Once you're tight, fast is fine

If your program has you on a dynamic start that pulls clean, keep it.$l$, $j${"key":"deadlift-jerk-slack"}$j$::jsonb),
  ('deadlift-grip-failing', 'f46188991483680d6bb69d958f9a620f', $l$Grip going before your back and legs do? Usually very fixable

A lot of grip fails aren't a strength problem. The bar sits mid palm, rolls into your fingers under load, and your hand opens.

• Set the bar low in your hand, near where your fingers start
• Chalk every heavy set
• Pick one heavy grip (hook or mixed) and use it on warmups too

Straps are fine on high rep sets and RDLs. They're just not allowed on the platform.$l$, $j${"key":"deadlift-grip-failing"}$j$::jsonb),
  ('deadlift-bar-drift-forward', '32977ccfcb749eb579c61aa0d97c2f21', $l$Bar drifting off your legs mid pull? Same weight, harder lift

The further the bar gets in front of midfoot, the more your hips and back have to fight to hold it.

The drift is usually a symptom
• The bar starting over your toes instead of midfoot
• Hips shooting up, so your shoulders swing forward and the bar follows
• Knees staying forward so the bar has to go around them

Think "drag it up your legs." Paused deadlifts just below the knee teach balance fast, because holding a pause with the bar out front is really hard.

Send me a side vid before you rebuild anything 👊$l$, $j${"key":"deadlift-bar-drift-forward"}$j$::jsonb),
  ('deadlift-slow-floor-vs-knees', 'f422712bf347109537f8d4b07b14b3bf', $l$Slow off the floor or slow at the knees? Different fix

Off the floor it's often setup. Hips too low, slack still in, bar too far out.

At the knees is sneakier. A lot of lockout problems start at the floor. If your hips shot up or the bar drifted, you reach the knee in a worse spot and stall. The stall shows up late. The cause was early.

Film from the side and compare your position at the knee on a slow rep and a fast warmup. Different position? Fix the floor first. Same position, just slower? That's strength in that range.

Ask me before adding accessories off this.$l$, $j${"key":"deadlift-slow-floor-vs-knees"}$j$::jsonb),
  ('deadlift-sumo-hips-low', '816b4f3efc492777a69e8a654a5cb1dd', $l$Sumo doesn't mean squatting the bar up

A lot of sumo pullers drop their hips as low as they'll go because it feels strong. Then the hips rise before the bar moves.

• Set your hips at break-off height, not as low as they go
• Shins near vertical, knees out over your toes before the pull
• Knees still in the way? Small width or toe angle tweaks, one at a time

Hip sockets vary a lot, so a stance that works for someone else might not fit you.

Higher hip sumo is fine if the bar moves well. Upright isn't the goal. A strong pull is.$l$, $j${"key":"deadlift-sumo-hips-low"}$j$::jsonb),
  ('deadlift-start-efficiency', 'ecca18e170ef0780800fe53084869854', $l$A faster setup only helps if the bar still breaks the floor as hard

At this level it's mostly wasted steps. Hip bounces, re-gripping, sitting in the bottom holding your breath. Each one can cost grip and brace. But cut the steps that build tension and the pull gets weaker.

A small 2018 pilot moved the bar closer or further over the foot on isometric pulls. Which muscles worked harder changed. Total force into the floor didn't.

• Same sequence every rep, warmup to max. Grip, breath, wedge, go
• Test changes on heavy singles over weeks, not on warmups

Breaks fast and looks the same every time? Leave it. What's your setup sequence? 👇$l$, $j${"key":"deadlift-start-efficiency"}$j$::jsonb),
  ('deadlift-heavy-single-shift', 'a0642ed01b04a5e5257174e93dee8bc8', $l$Your heaviest singles probably don't start like your warmups

Research here is thin. A 2025 review found only 2 studies on how the deadlift changes with heavier loads in experienced lifters. So nobody can tell you exactly what should change at max.

Film every heavy single from the side and compare it to a warmup.
• Same change every time? You can train that position
• Different every time? That's the real problem

If it still breaks and locks out fast, that's probably just how you pull max loads.$l$, $j${"key":"deadlift-heavy-single-shift"}$j$::jsonb),
  ('deadlift-comp-lockout', '1497c455798321e06747e2c7a520d1dc', $l$A gym lockout and a meet lockout aren't the same thing

In the gym nobody red lights a hitch, soft knees or dropping it the second you stand. On the platform all three can.

IPF style rules: finish tall with knees straight and shoulders back. No downward bar movement on the way up, no resting it on your thighs. Hold still until the down signal.

• On heavy singles, have someone call "down"
• Pick attempts you can lock out clean. A hitched gym PR won't count

Anyone ever eaten a red light for it? 💀$l$, $j${"key":"deadlift-comp-lockout"}$j$::jsonb),
  ('bar-over-midfoot', '19d16ebc6c81b9129a87e44ec1b5327d', $l$Why does the bar stay over midfoot on every good squat and pull?

Balance. You and the bar act like one system, and that system is balanced when the bar sits over the middle of your foot. Mark Rippetoe built most of Starting Strength around this idea.

When the bar drifts forward, the weight is trying to tip you over. Now your hips and back have to fight that on top of lifting it. That's why a deadlift that swings away from your shins feels way heavier than it should.

Next time you film a set, picture a line straight up from midfoot. The bar should ride close to it the whole way.

A little drift on a heavy rep is normal. Big, repeatable drifts are what cost you.$l$, $j${"key":"bar-over-midfoot"}$j$::jsonb),
  ('specificity-said', '90910b5f4084db3ee8ef6aede917e1a4', $l$Why do we squat to get better at squatting? 🧠

Your body adapts to exactly what you make it do. It even has a name: SAID, specific adaptation to imposed demands.

Strength isn't just muscle. It's muscle plus practice of that exact movement at that kind of load. That's why a huge leg press doesn't automatically mean a huge squat.

A 2017 review found heavy loads built more 1RM strength than light loads, even with about the same muscle growth.

Variations still matter. They build muscle, hit weak spots and give your joints a break. They feed the main lifts. They don't replace them.$l$, $j${"key":"specificity-said"}$j$::jsonb),
  ('moment-arms-build', '00b91ce11284f935f0b9163d766f1afc', $l$Ever wonder why your squat looks nothing like someone else's?

Leverages. The bar has to stay over midfoot for you to stay balanced. Long thighs compared to your torso? Your hips sit further back and you lean more. Shorter thighs, more upright.

Neither is wrong. More lean shifts the work to your hips and back. More upright shifts it to your quads.

So don't copy a torso angle off someone's highlight video. What looks off on them might be right for your build.

Think yours is off? Send me a vid first 👀$l$, $j${"key":"moment-arms-build"}$j$::jsonb),
  ('sra-curve', '29069bea0aaeca3469236d646dd4fefc', $l$You don't get stronger in the gym. You get stronger after it

Right after a hard session you're actually a bit weaker. Then you recover, and if the stress was big enough you end up slightly better than before. Stimulus, recovery, adaptation.

How long that takes isn't fixed. A heavy deadlift day usually takes longer to bounce back from than a few crisp bench singles.

Two ways to get it wrong
• Too little stimulus, so there's nothing to adapt to
• Stacking hard sessions before you recover, so the dip keeps getting deeper

That's a big part of why your week is laid out the way it is.$l$, $j${"key":"sra-curve"}$j$::jsonb),
  ('sticking-points', '75189ee42ec3d3ab7f4376deb3c44890', $l$Ever notice you always miss in the same spot?

That's your sticking point. In the big 3 you're usually strongest near lockout, so the bar slows wherever your leverages are worst.

Bench is the classic. Fast off the chest, slow a few inches up, then faster again near lockout. Off the chest you get help from the stretch. A few inches up that help fades before your leverages improve.

That slow spot caps how much you can lift, and it's usually where form breaks first.

Next heavy set, notice where the bar slows. That's useful info for us.$l$, $j${"key":"sticking-points"}$j$::jsonb),
  ('rpe-rir-scale', '0447cc633f86f7c09b0fe8120c6a1151', $l$RPE 8 doesn't mean 8/10 hard. It means 2 reps left

Powerlifting got this version of RPE from a lifter. Mike Tuchscherer, a 2009 World Games champion, tied each number to reps left in The Reactive Training Manual.

RPE 10 = nothing left
RPE 9 = 1 left
RPE 8 = 2 left
RPE 7 = 3 left

Researchers built on his work in 2016 and found counting reps left is way more concrete than rating how hard a set felt.

Right after a set ask yourself: if I had to, how many more clean reps could I do?

That's your number. Not how tired you are. Just what's left in the tank.$l$, $j${"key":"rpe-rir-scale","refs":[{"label":"Zourdos et al. 2016, J Strength Cond Res","url":"https://pubmed.ncbi.nlm.nih.gov/26049792/"},{"label":"Helms et al. 2016, Strength Cond J","url":"https://pmc.ncbi.nlm.nih.gov/articles/PMC4961270/"},{"label":"IPF results: 2009 World Games, men's statistics (Tuchscherer, super heavyweight gold)","url":"https://www.powerlifting.sport/fileadmin/ipf/data/results/2009/world_games_2009/men/statistics.htm"},{"label":"Reactive Training Systems: Mike Tuchscherer bio (The Reactive Training Manual)","url":"https://store.reactivetrainingsystems.com/pages/mike-tuchscherer"},{"label":"Zourdos, MASS Research Review 2023: RPE and RIR, the complete guide","url":"https://massresearchreview.com/2023/05/22/rpe-and-rir-the-complete-guide/"}]}$j$::jsonb),
  ('force-velocity-intent', 'e990ede7d0a235cecb69b0ccbb9a28bd', $l$A max is supposed to look slow. That's physics, not weakness

The heavier the load, the slower you can move it. Light weight flies. A true max grinds.

Trying to move fast still matters though. Louie Simmons gave it a whole day at Westside Barbell. Lifters moved about half their max, often with bands or chains, as fast as possible.

Research backs the intent part. In a 2014 bench study, pressing every rep as fast as possible gave close to double the 1RM gains of pressing at half speed on purpose.

So every rep on the way up is a fast rep. Not rushed. Just pushed hard.

Tempo work is slow on purpose though. Keep that as written.$l$, $j${"key":"force-velocity-intent","refs":[{"label":"Behm & Sale 1993, J Appl Physiol","url":"https://pubmed.ncbi.nlm.nih.gov/8444715/"},{"label":"González-Badillo et al. 2014, Eur J Sport Sci","url":"https://pubmed.ncbi.nlm.nih.gov/24734902/"},{"label":"Westside Barbell: The WSBB guide to dynamic effort training","url":"https://www.westside-barbell.com/blogs/the-blog/the-wsbb-guide-to-dynamic-effort-training"}]}$j$::jsonb),
  ('fitness-fatigue-taper', '51a2aeaace9d268683388a769e1ad555', $l$How does doing less make you lift more?

Training gives you fitness and fatigue at the same time. What you can lift on the day is roughly fitness minus fatigue.

Fatigue builds fast and clears fast. Fitness builds slow and fades slow. So when you pull back for a bit, fatigue drops way quicker than fitness, and the strength you built finally shows up.

That's a taper. A 2007 review found the biggest effect from about 2 weeks of cutting volume by roughly 40-60% while keeping intensity the same.

Pull back too long though and fitness starts fading too. That's why tapers are short 🏆$l$, $j${"key":"fitness-fatigue-taper"}$j$::jsonb),
  ('progressive-overload-beyond-weight', '9a9b845030c3db5bfee736c4fd174427', $l$Legend says Milo of Croton carried a calf every day until it was a full grown bull

It's the oldest picture of progressive overload. Ask a bit more of your body over time.

More weight is the obvious way. It's not the only one.
• Same weight, more reps or sets
• Same weight, lower RPE or faster bar speed
• Same weight, cleaner reps

A single that was RPE 9 last month and moves at RPE 7.5 now is real progress.

Judge it across a block, not one session 📊$l$, $j${"key":"progressive-overload-beyond-weight","refs":[{"label":"Encyclopaedia Britannica: Milo of Croton","url":"https://www.britannica.com/biography/Milo-of-Croton"},{"label":"Quintilian, Institutio Oratoria 1.9.5 (the calf story)","url":"https://cts.perseids.org/read/latinLit/phi1002/phi001/perseus-eng2/1.9.5-1.10.3"}]}$j$::jsonb),
  ('rpe-accuracy-near-failure', '8a6b5e6805e31c01fcb737a881ce5012', $l$Your RPE 6 is a guess. Your RPE 9 is way more accurate

A 2022 review pooled the studies on predicting reps left. On average people underestimated by about 1 rep. Most of us have a bit more in the tank than we think.

Calls got more accurate closer to failure and in sets of 12 or fewer. Near failure the bar slows way down, so you can feel it coming.

So low RPE calls are rough guesses, and that's fine. Top sets at 8-9 are where your call matters most.

How close do you think your calls are? 🤔$l$, $j${"key":"rpe-accuracy-near-failure"}$j$::jsonb),
  ('technique-changes-with-load', 'c898593b749bb86c2ce3c10d817995ea', $l$Your warmups and your top set aren't quite the same lift

As the load goes up the bar slows and your body reorganizes to get it moving. The squat leans a touch more. The bench touch point shifts. Deadlift hips rise a bit first.

Some of that is your body finding where it's strongest. Some of it is breakdown. Video is how we tell them apart.

• Film your heavy sets, not just warmups
• Set up every warmup like the top set. Same stance, grip and brace

Something only changes on heavy sets? Send it to me before fixing it. Might not be a problem at all.$l$, $j${"key":"technique-changes-with-load"}$j$::jsonb),
  ('daily-strength-varies', '1fcad7177597c18c88326fb45a8d6a6e', $l$Same weight, totally different feel from one week to the next. Why?

Your strength on any given day isn't a fixed number. Sleep, stress, food and leftover fatigue all move it. The 1RM on paper is a ballpark, not a promise.

That's why a lot of programming picks top sets by RPE instead of a fixed %. Good day, the weight goes up. Rough day, it comes down and you still get good work in.

A 2021 study found squatting off reps in reserve gave bigger strength gains over 12 weeks than fixed percentages. Not every study finds a difference.

A lighter top set on a bad day isn't a failed session. That's the system working 🫡$l$, $j${"key":"daily-strength-varies"}$j$::jsonb),
  ('heavy-singles-skill', 'fe650d7a2e832f16eae45948ab146b02', $l$Bulgarian weightlifters worked up to a heavy single almost every session

Their coach Ivan Abadjiev's teams won 57 world titles. Not saying you should copy it. But it shows something. Lifting a max is a skill, not just a test.

A single has a slower bar, more pressure and more nerves, and your positions have to hold the whole way. If meet day is the only time you touch that, you're doing a new skill under max pressure.

A small 2017 study had one group just practice the 1RM for 8 weeks while another did 4 sets to failure. Strength gains came out about the same.

That's why singles get built in before a meet. Not to test. To practice.

The ones in your program are placed on purpose. This isn't a pass for daily maxing 💀$l$, $j${"key":"heavy-singles-skill","refs":[{"label":"Mattocks et al. 2017, Med Sci Sports Exerc","url":"https://doi.org/10.1249/MSS.0000000000001300"},{"label":"IWF: Ivan Abadzhiev died at 85 (2017)","url":"https://iwf.sport/2017/03/27/ivan-abadzhiev-died-at-85/"},{"label":"BTA: Bulgarian weightlifting legend Ivan Abadjiev dies","url":"https://www.bta.bg/en/news/129958-Bulgarian-Weightlifting-Legend-Ivan-Abadjiev-Dies"}]}$j$::jsonb),
  ('weekly-sets-dose-response', '3ec53714c173cfbec12bd0d387dd8e0d', $l$Arnold trained twice a day. Dorian Yates did 1 all-out set per exercise 🤔

Arnold won 7 Mr. Olympias. Yates won 6 straight. So how much volume do you actually need?

A 2017 review of 15 studies found more weekly sets built more muscle, up to a point. Groups doing 10+ hard sets per muscle a week grew the most on average.

But each extra set adds less than the one before, while fatigue keeps stacking. Yates made very few sets work by taking every one to failure after his warmups.

Only count hard sets. Warmups don't count.

Accessories feel like too much or too little? Bring it to me before piling sets on.$l$, $j${"key":"weekly-sets-dose-response","refs":[{"label":"Schoenfeld, Ogborn & Krieger 2017, J Sports Sci","url":"https://doi.org/10.1080/02640414.2016.1210197"},{"label":"Encyclopaedia Britannica: Mr. Olympia (Schwarzenegger 1970-75 and 1980, Yates 1992-97)","url":"https://www.britannica.com/topic/Mr-Olympia"},{"label":"Schwarzenegger.com: Don't forget the dumbbell pullover (his double-split routines)","url":"https://www.schwarzenegger.com/fitness/post/dont-forget-the-dumbbell-pullover"},{"label":"Fitness Volt: Dorian Yates explains why he cut back from 2 to 1 working sets","url":"https://fitnessvolt.com/dorian-yates-working-sets/"}]}$j$::jsonb),
  ('failure-proximity-growth', '0e475fa18d502379e4debf55e9472e45', $l$Mike Mentzer took his sets past failure. Research says you just need to get close

His Heavy Duty training added forced reps and negatives after failure, and he won the 1978 Mr. Universe heavyweight class with a perfect 300 score.

Two big reviews since then. One found going all the way to failure wasn't clearly better for growth than stopping a bit short. The other found growth improved the closer sets ended to failure, while strength looked similar across a wide range.

So for accessories, ending around 0-3 reps in the tank is a good zone. Sets with 5+ left probably do less.

Comp lifts are different. We keep those further from failure on purpose 🫡$l$, $j${"key":"failure-proximity-growth","refs":[{"label":"Refalo et al. 2023, Sports Med","url":"https://doi.org/10.1007/s40279-022-01784-y"},{"label":"Robinson et al. 2024, Sports Med","url":"https://doi.org/10.1007/s40279-024-02069-2"},{"label":"Iron Man: The 1980 Mr. Olympia controversy (Mentzer's perfect 300 at the 1978 Mr. Universe)","url":"https://www.ironmanmagazine.com/the-1980-mr-olympia-controversy/"},{"label":"Iron Man: Heavy Duty, Mike Mentzer's most productive routine","url":"https://www.ironmanmagazine.com/heavy-duty-mike-mentzers-most-productive-routine/"}]}$j$::jsonb),
  ('long-muscle-length', '49ff8cead207e213926d6c272a93e441', $l$Same muscle, different exercise, different amount of growth

Two studies had people train one limb each way for 12 weeks.
• Seated leg curls grew the hamstrings more than lying ones (about 14% vs 9%)
• Overhead cable extensions grew the triceps about 1.4x more than the same extension with the arm at your side

In both, the winner trained the muscle in a longer, more stretched position.

Small studies, mostly people new to lifting. But if you're picking an accessory, the version that loads the stretch is a good bet.

Anyone actually feel the difference? 👀$l$, $j${"key":"long-muscle-length"}$j$::jsonb),
  ('full-rom-vs-partials', 'cba2772dd39a4b29599b730a9c805ddd', $l$Cutting accessory reps short? The bottom half is the part to keep

When partials lose to full range of motion, it's usually because they skip the stretched part of the rep.

Studies on leg extensions and calf raises found partials in the stretched half grew as much or more than full reps. Partials in the shortened half grew the least. Newer work in trained lifters mostly finds the two about equal.

So full ROM is a safe default. If you go partial, keep the stretched end.

Accessories only. Comp lifts still follow comp depth.$l$, $j${"key":"full-rom-vs-partials"}$j$::jsonb),
  ('light-vs-heavy-growth', '1cd168bd197e882489411c8d0169c855', $l$"Everybody wanna be a bodybuilder, but nobody wants to lift no heavy ass weight"

Ronnie Coleman, 8x Mr. Olympia. For strength he's right. For growth, light works too. If it's hard.

A 2017 review of 21 studies compared light loads (60% or less) with heavy loads, sets taken to failure. Growth came out similar. Max strength went up more with heavy.

The catch: a light set only works when it gets hard. The first 10 reps of a 25 rep set are easy. It's the grindy reps at the end that count.

So comp lifts stay heavy. Accessories can live anywhere from about 6 to 20+ reps.$l$, $j${"key":"light-vs-heavy-growth","refs":[{"label":"Schoenfeld et al. 2017, J Strength Cond Res","url":"https://pubmed.ncbi.nlm.nih.gov/28834797/"},{"label":"RonnieColeman.net: How to be hardcore (the quote)","url":"https://ronniecoleman.net/blogs/articles/how-to-be-hardcore"},{"label":"Encyclopaedia Britannica: Mr. Olympia (Coleman 1998-2005)","url":"https://www.britannica.com/topic/Mr-Olympia"}]}$j$::jsonb),
  ('frequency-volume-equated', '3390da16774fd63d5bd98376200c7a49', $l$Is hitting a muscle 3x a week better than 1x? Less than you think

When weekly sets were matched, a 2019 review of 25 studies found frequency didn't clearly change growth. The edge showed up when more sessions also meant more total sets.

So frequency is mostly a way to spread volume out. 15 sets for one muscle in one day gets sloppy. Split over 2-3 days, more of them are quality sets.

It matters more for the lifts themselves. Boris Sheiko, who became head coach of Russia's national powerlifting team in 1998, has lifters squat and bench several times a week at loads averaging around 70%.

That's practice, not just muscle.$l$, $j${"key":"frequency-volume-equated","refs":[{"label":"Schoenfeld, Ogborn & Krieger 2016, Sports Med","url":"https://pubmed.ncbi.nlm.nih.gov/27102172/"},{"label":"Schoenfeld, Grgic & Krieger 2019, J Sports Sci","url":"https://doi.org/10.1080/02640414.2018.1555906"},{"label":"Stronger by Science: Interview with coach Boris Sheiko","url":"https://www.strongerbyscience.com/interview-with-coach-boris-sheiko/"}]}$j$::jsonb),
  ('rest-periods-growth', '9ee16b06749989c5accbd263bb87ba8f', $l$Resting 60 seconds to keep the pump isn't the growth hack it was sold as

In a 2016 study trained guys ran the same 8 week program resting either 1 or 3 minutes. The 3 minute group gained more strength and grew a bit more, probably because they kept more reps and weight on the bar each set.

A 2024 review found a small edge for resting longer than 60 seconds, and not much difference past about 90.

So rest long enough that the next set is a real set. Big compounds often need 2-3+ minutes. Curls and raises, 90 seconds is usually plenty.$l$, $j${"key":"rest-periods-growth"}$j$::jsonb),
  ('accessory-progressive-overload', 'dfd2efba261957d8f78ff2824d4546a7', $l$Stuck on the same dumbbells for weeks? Add a rep instead

A 2022 study had trained lifters either add weight each week or keep the weight the same and add reps. After 8 weeks, muscle growth was basically identical.

Dumbbells and machine stacks jump in big steps, so reps are honestly the easier lever a lot of the time.

What matters is that something in your log moves over a few weeks. If an accessory hasn't budged in a month or two, send it my way 👊$l$, $j${"key":"accessory-progressive-overload"}$j$::jsonb),
  ('machines-arent-cheating', '88c8b92f639af06425244ebd5190f2e0', $l$Machines aren't cheating. For growth they're often the easier option

A 2023 review of 13 studies compared free weights and machines. Muscle growth came out similar. Strength was specific. Free weights improved free weight tests more.

That's the powerlifting takeaway. The barbell builds barbell strength. Machines can build the muscle behind it.

They also make it easier to take a set close to failure, since you're not spending effort balancing.

Not every machine fits every body. Swap one that feels awkward 🤝$l$, $j${"key":"machines-arent-cheating"}$j$::jsonb),
  ('soreness-not-growth-signal', 'b224b319e2a006ddff19336c7c2d37ae', $l$Not sore after a session doesn't mean it didn't work

Soreness mostly tracks how new or unusual the work was. That's why it fades as you get used to a program, even while you're still growing.

In a 2011 study one group was eased into a hard program so they avoided muscle damage. Another was thrown straight in. The thrown in group was way more sore. Both gained the same size and strength.

Soreness isn't the scoreboard. Reps and load creeping up over weeks is 🧠$l$, $j${"key":"soreness-not-growth-signal"}$j$::jsonb),
  ('protein-how-much', 'b337f69c8f1eee85ff1b8607f7c51440', $l$How much protein do you actually need to build muscle?

A 2018 review of 49 studies found gains kept improving up to about 1.6 g per kg of bodyweight a day, then flattened out. The upper end of the range ran to about 2.2 g/kg.

That's roughly 0.7 to 1 g per lb. For a 90 kg (198 lb) lifter, about 145 to 200 g a day.

Hitting your daily total most days matters way more than timing or shakes.

On a dietitian's plan? Follow theirs 🙏$l$, $j${"key":"protein-how-much"}$j$::jsonb),
  ('recovery-same-muscle', '675d09e8bf8a9f6d835a5998d9c4f133', $l$How soon can you train the same muscle hard again? It depends

What usually stretches recovery out
• Sets taken all the way to failure
• Lots of lowering under a stretch (RDLs, deep lunges)
• New exercises or a big jump in volume

A 2017 study had trained lifters squat and bench the same total reps, either to failure or stopping short. The non-failure sessions recovered faster over the next 24-48 hours.

So if a muscle still feels flat when its next session comes around, tell me. The fix might be effort or volume, not more rest days.$l$, $j${"key":"recovery-same-muscle"}$j$::jsonb),
  ('cardio-interference', 'abcf6ef6433ca756ca6e8c2423fd3bbb', $l$Does cardio kill your gains? Way less than the gym myths say

A 2022 review of 43 studies compared lifting alone with lifting plus cardio. Adding cardio didn't measurably reduce muscle growth or max strength. What it did blunt was explosive stuff like jump height, mostly when both were done in the same session.

Where it can bite
• Hard leg cardio right before squats or pulls
• So much that it eats into recovery or food

Separate days or a few hours apart keeps it out of the way. Thinking of adding a lot? Tell me first.$l$, $j${"key":"cardio-interference"}$j$::jsonb),
  ('methods-myo-reps', '1489ae1b47f84e971e8aaf4658a89ebd', $l$Short on time but want your accessories to count? Try myo-reps

Norwegian coach Børge Fagerli came up with them in the mid-2000s.
• One activation set, 1-2 reps shy of failure
• Rest 3-5 deep breaths, then 3-5 more reps
• Repeat until you can't hit the mini set

Every mini set lands close to failure, so you get a lot of hard reps fast. An 8 week study in trained guys found rest-pause sets grew muscle about as well as regular sets.

Great for cables, machines, curls, raises and calves. Not for heavy barbell lifts.

Accessories written as straight sets? Ask before swapping. Anyone tried these?$l$, $j${"key":"methods-myo-reps","refs":[{"label":"Enes et al. 2021, Appl Physiol Nutr Metab","url":"https://pubmed.ncbi.nlm.nih.gov/34260860/"},{"label":"Barbell Medicine: Myo-reps","url":"https://www.barbellmedicine.com/blog/myo-reps/"},{"label":"StrengthLog: Myo-reps","url":"https://www.strengthlog.com/myo-reps/"}]}$j$::jsonb),
  ('methods-drop-sets', '1bce57188e33577911daa8c7a79417c6', $l$Drop sets won't build more muscle. But they can save a ton of time

Go close to failure, strip about 20-30% of the weight and keep going with no rest. Maybe drop once more.

Two reviews found they grow muscle about as well as regular sets, and in some studies they took a half to a third of the time 👀

Use them on the last set of a machine or isolation exercise. Skip them on the main lifts. Stripping plates at failure is a mess.

Want to try one? A single drop on the last set is plenty.$l$, $j${"key":"methods-drop-sets"}$j$::jsonb),
  ('methods-antagonist-supersets', 'f7a9d47614def5f1633dd99d99649d4c', $l$Arnold paired chest and back in supersets. Research says he was onto something

Think bench press straight into chin-ups. One muscle rests while the other works.

Pairs that work
• Rows + DB bench
• Curls + pushdowns
• Leg curls + leg extensions

A 2025 review found supersets cut session time without costing strength or size. Opposite muscle pairs even let people get more reps than straight sets.

The catch: they feel harder, and holding two stations in a busy gym is a pain.

Keep heavy squat, bench and deadlift as straight sets. Pair the accessories after.$l$, $j${"key":"methods-antagonist-supersets","refs":[{"label":"Zhang et al. 2025, Sports Med","url":"https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12011898/"},{"label":"Bodybuilding.com: Arnold A to Z, superset man","url":"https://bodybuilding.com/fun/arnold-a-to-z-superset-man.html"},{"label":"T3: Arnold Schwarzenegger shares his Golden Era chest and back workout","url":"https://www.t3.com/news/arnold-schwarzenegger-shares-his-golden-era-chest-and-back-workout-and-its-insane"}]}$j$::jsonb),
  ('methods-lengthened-partials', '566b581a78835e5e698886f151d600e0', $l$Hit failure on full reps? The bottom half might still have more in it

Lengthened partials are reps in just the stretched part of the range. Bottom half of a curl. Bottom of a leg press.

As a set extender, take the set to failure with full reps, then grind out 3-5 stretched half reps. More out of the set without adding another.

A 2025 study in trained lifters trained one arm each way and both grew about the same. Research on doing it after failure is thin, so it's a tool, not a must.

Good on machines, cables, curls and calves. Never on squat, bench or deadlift 💀$l$, $j${"key":"methods-lengthened-partials"}$j$::jsonb),
  ('methods-eccentric-tempo', 'bfa72ebc7873d20944bbbcea3c0c41a9', $l$In the early 80s, SuperSlow had people take about 10 seconds to lift a weight

Ken Hutchins built it during a Nautilus-funded study, with 5-10 seconds back down. So do slower reps build more muscle? Not past a point.

A 2015 review found similar growth with reps lasting anywhere from about half a second to 8 seconds. Really slow reps (10+ seconds) looked worse, probably because you have to go way lighter.

Controlling the way down is still useful. Same position every rep, no bouncing out of the bottom. It just won't double your gains because you went from 2 seconds down to 4.

A 3 second down on squats or a long pause on bench in your program is there for technique. Keep it.$l$, $j${"key":"methods-eccentric-tempo","refs":[{"label":"Schoenfeld, Ogborn & Krieger 2015, Sports Med","url":"https://pubmed.ncbi.nlm.nih.gov/25601394/"},{"label":"Kravitz, University of New Mexico: SuperSlow training","url":"https://www.unm.edu/~lkravitz/Article%20folder/superslow.html"}]}$j$::jsonb),
  ('methods-cheat-reps', '03b596bb104ac8fa6d3113d264f61527', $l$Arnold used cheat reps on curls. Just not the way most people do 🤣

Strict until he couldn't get another rep, then just enough body english to squeeze out a couple more.

Fine when
• It's the last 1-3 reps of curls, laterals or rows
• You've already hit failure with clean reps
• The lowering stays strict

A waste when
• You're swinging from rep 1. The weight's just too heavy
• It's squat, bench or deadlift. There's no cheat rep there, just a bad rep

The cheat should help the muscle finish the set, not do the set for it.$l$, $j${"key":"methods-cheat-reps","refs":[{"label":"Bodybuilding.com: Arnold Schwarzenegger's secrets for building arms","url":"https://amp.bodybuilding.com/content/arnold_arm_secrets.html"},{"label":"Schwarzenegger.com: The science of advanced bodybuilding exercise prescription","url":"https://www.schwarzenegger.com/fitness/post/the-science-of-advanced-bodybuilding-exercise-prescription"}]}$j$::jsonb),
  ('methods-unilateral-work', '0e05e40e536882886ce9de1820754ad0', $l$One side always feels weaker? Here's where single side work fits

On a barbell the stronger side can quietly take more of the load. Split squats, single leg RDLs and one arm rows make each side do its own work.

• Start each set with the weaker side
• Match those reps on the strong side, no extras

Reality check: a small left-right difference is normal for basically everyone. The research linking it to worse performance is all associations, no trials.

Squat drifting to one side? Send me a vid before you program 5 sets of lunges for it 👀$l$, $j${"key":"methods-unilateral-work"}$j$::jsonb),
  ('methods-intensity-techniques-fatigue', 'd8561bc2932430ac82f22fb9e08d203b', $l$Intensity techniques aren't free. You pay for them on squat day

Drop sets, rest-pause, failure sets on leg press. They add a lot of fatigue for a small extra stimulus.

Sets to failure take longer to recover from than stopping short with the same total reps, with the gap showing over the next 1-2 days. And strength gains barely change with how close to failure people train.

So for strength, failure buys very little and costs a lot of recovery.

Using them? Isolation only, last set only, and first to go if your main lifts feel flat or a meet is close.$l$, $j${"key":"methods-intensity-techniques-fatigue"}$j$::jsonb),
  ('methods-cluster-sets', 'da41f532d77b0e82cea0af41ce59b7b5', $l$Why does rep 5 of a heavy set look so different from rep 1?

Bar speed drops through a set as fatigue builds, so the last reps are the slowest and usually the ugliest.

Cluster sets put short rests inside the set. Instead of a straight 5, you could do 5 singles with 15-30 seconds between, or 2+2+1.

Research says they keep bar speed up within the session. Long term, strength and size gains come out about the same.

So it's a quality tool, not a strength hack. Handy when you want every rep to look like rep 1.$l$, $j${"key":"methods-cluster-sets"}$j$::jsonb),
  ('methods-warmup-sets', '496ea689ffe0a484cc29c8fa065694ba', $l$If your warmups are tiring you out, they're not warmups anymore

Warmup sets have one job. Practice the movement and get you ready for the heavy set.

A simple ramp, as a % of your top set
Bar x 5-10
40% x 5
60% x 3
75% x 2
85-90% x 1

Jumps get smaller and reps drop as the weight climbs.

Common mistakes: sets of 8-10 past 70%, and going straight from your heaviest warmup into the top set. Give that one a real rest.

Program lists specific warmups? Use those 🫡$l$, $j${"key":"methods-warmup-sets"}$j$::jsonb),
  ('sleep-extension-basketball', '05dacce50b8dff86b11df0d307641c3a', $l$Stanford asked its basketball team to spend 10 hours a night in bed 👀

11 players kept their normal sleep for a few weeks, then aimed for 10+ hours in bed for 5-7 weeks. They ended up sleeping almost 2 hours more a night.

Free throws went from 79% to 88%. Threes went from 68% to 77%. Sprints got faster too.

Big caveats. 11 guys, one team, no control group. Promising, not proof.

LeBron has talked about his trainer asking if he got his 8 or 9 hours. You probably don't need 10. But if you're living on 6, more sleep is the cheapest recovery tool there is.

Easiest start: same wake up time, bedtime 20-30 minutes earlier.$l$, $j${"key":"sleep-extension-basketball","refs":[{"label":"Mah et al. 2011, Sleep","url":"https://pubmed.ncbi.nlm.nih.gov/21731144/"},{"label":"The Tim Ferriss Show #349 transcript: LeBron James and Mike Mancias (2018)","url":"https://tim.blog/2018/11/30/the-tim-ferriss-show-transcripts-lebron-james-and-mike-mancias/"}]}$j$::jsonb),
  ('self-talk-what-helps', '92870a9db5bb8449057c2d4d14e63381', $l$Muhammad Ali called himself the greatest before he won the heavyweight title

He even put out an album called I Am the Greatest in 1963. Months later he beat Sonny Liston as an 8 to 1 underdog.

Research on self-talk is less dramatic, but it's real. A 2011 review of 32 studies found it improved performance by a moderate amount, most on precise skills and things people were still learning.

Two kinds
• Instructional: chest up, push the floor
• Motivational: let's go, you got this

People who practiced their self-talk beforehand got more out of it. Pick one short phrase and use it on every top set.

What's yours? 👇$l$, $j${"key":"self-talk-what-helps","refs":[{"label":"Hatzigeorgiadis et al. 2011, Perspect Psychol Sci","url":"https://pubmed.ncbi.nlm.nih.gov/26167788/"},{"label":"Andscape: Muhammad Ali's I Am the Greatest album (1963)","url":"https://andscape.com/features/muhammad-ali-i-am-the-greatest-album/"},{"label":"NBC News: Fifty years ago, Cassius Clay shook the world (Liston fight, 1964)","url":"https://www.nbcnews.com/news/photo/fifty-years-ago-cassius-clay-shook-world-n38071"}]}$j$::jsonb),
  ('deload-what-it-does', '3e7d67ad051aefa7c8f37be5096724f2', $l$A deload doesn't make you stronger. It lets you show what you built

Hard training builds fitness and fatigue. Fatigue fades faster when you back off, so a lighter week lets performance come back without losing much fitness 📊

A 2024 survey of 246 strength and physique athletes found all of them deload, roughly every 5-6 weeks.

A full week off isn't magic though. In a 2024 trial, the group that kept training came out ahead on leg strength.

A deload is lighter training. Fewer sets, more reps in the tank, same lifts. If one is in your plan, it's there for a reason.$l$, $j${"key":"deload-what-it-does"}$j$::jsonb),
  ('placebo-fake-steroids', '20ac54aea96437b80c41f07d7b770615', $l$Athletes got stronger on fake steroids. Old study, wild result 💀

In 1972 researchers told varsity athletes some of them would get steroids. The ones picked got placebo pills instead and gained more in 3 of 4 lifts than in the weeks before.

Tiny study, 50+ years old, so don't trust the exact numbers. But a 2000 study found something similar in competitive powerlifters. When half were told the truth midway, their extra gains mostly faded.

The takeaway isn't go find sugar pills. Belief changes how hard you push.

Reps you've already hit are how you build that belief for real.$l$, $j${"key":"placebo-fake-steroids"}$j$::jsonb),
  ('process-vs-outcome-goals', '0e8827887f354026edc98e02e72c8ab3', $l$Nick Saban built 7 national titles on one idea: forget the scoreboard

He called it the Process. Do this rep, this play, this day right.

Research backs him up. A 2022 review of 27 studies in sport found process goals had the biggest effect on performance. Outcome goals barely had any.
• Outcome: hit a total, win
• Performance: a 5kg squat PR
• Process: fully in your control. Pause every first bench rep, hit every session, in bed by 11

Keep the big goal. Write 2-3 process goals under it for this block.$l$, $j${"key":"process-vs-outcome-goals","refs":[{"label":"Williamson et al. 2022, Int Rev Sport Exerc Psychol","url":"https://doi.org/10.1080/1750984X.2022.2116723"},{"label":"AP via KSL: Alabama's Nick Saban retires after 7 national titles (2024)","url":"https://www.ksl.com/article/50841236/alabamas-nick-saban-retires-after-7-national-titles-most-in-major-college-football-history"},{"label":"FootballScoop: Nick Saban on where the Process began","url":"https://footballscoop.com/news/nick-saban-breaks-process-really-belief-began"}]}$j$::jsonb),
  ('caffeine-for-lifting', 'e3c5925be0cd1011a5d1c957b4f547c4', $l$Caffeine is one of the few supplements with real evidence for lifting

A 2018 review found a small boost to 1RM strength and jump power. A 2019 umbrella review of 21 reviews backed it for strength, endurance and power.

Small is the key word. Nice bonus, not a new you.

What the ISSN position stand says
• 3-6 mg per kg of bodyweight, most commonly about an hour before
• As little as 2 mg/kg might work
• Big doses mostly just add side effects

Late caffeine can wreck sleep. Heart issues or pregnant? Ask your doctor.

Never try a new dose for the first time on meet day.$l$, $j${"key":"caffeine-for-lifting"}$j$::jsonb),
  ('meet-day-pre-lift-routine', '80fc4fa9bdfbd226b3059acab5759b96', $l$Rafael Nadal lined up his water bottles the same way every match. Not superstition

"It's a way of placing myself in a match," he wrote, "ordering my surroundings to match the order I seek in my head."

That's what a routine does under pressure. Pressure makes you consciously control movements that normally run on autopilot, and thinking your way through a squat you've done 1000 times rarely helps. A routine gives your attention a job.

A 2021 review found pre-performance routines improved performance in experiments, including under pressure.

Build yours in training
• Same steps every time. Chalk, walk up, hands, breath
• One cue, not five
• Short. Most feds give you about a minute to start the attempt$l$, $j${"key":"meet-day-pre-lift-routine","refs":[{"label":"Rupprecht, Tran & Gröpel 2021, Int Rev Sport Exerc Psychol","url":"https://doi.org/10.1080/1750984X.2021.1944271"},{"label":"Nadal & Carlin, Rafa (2011), as quoted in The National","url":"https://www.thenationalnews.com/sport/superstition-or-habits-falling-in-place-if-rafael-nadal-breaks-the-curse-of-the-ninth-1.652911"}]}$j$::jsonb),
  ('life-stress-and-gains', 'a769c3d9e86039134f9a17068d410fdb', $l$Exams, work chaos, a breakup. Your training notices

A 2008 study followed 135 students through 12 weeks of lifting. The ones reporting less life stress gained more on squat and bench.

That's a correlation, not proof. Stressed people might also sleep less or miss more sessions. But later studies linked higher stress to slower recovery after hard sessions too.

Think of recovery as one budget that the gym and life both draw from.

In a rough week, showing up still counts. And tell me. We can adjust the week instead of you grinding through it.$l$, $j${"key":"life-stress-and-gains"}$j$::jsonb),
  ('imagery-and-strength', 'd60184132bcd08ac0cf150ed1967a343', $l$Michael Phelps played a perfect race in his head every night and morning

His coach Bob Bowman called it watching the videotape. In the 2008 Olympic 200m butterfly final his goggles filled with water. He counted his strokes and still won gold in world record time.

Can picturing a lift make you stronger? Kinda. A 2018 review found imagery alone moderately improved max strength compared to doing nothing. Real training still beat it.

Where it fits for us is rehearsing meet day. The walkout, the commands, your setup, the grind if the rep slows down.

Same speed as the real lift. Picture the real place. Include the hard part, not just the lockout.$l$, $j${"key":"imagery-and-strength","refs":[{"label":"Paravlic et al. 2018, Sports Med","url":"https://link.springer.com/article/10.1007/s40279-018-0874-8"},{"label":"Duhigg, The Power of Habit (2012), Random House (Bowman's \"watch the videotape\")"},{"label":"China Daily / AP: Phelps on swimming the 200m fly final with water-filled goggles (2008)","url":"https://language.chinadaily.com.cn/news/2008-08/15/content_6938062.htm"}]}$j$::jsonb),
  ('training-log-review', '8dd04b9ebe19326508035a0ba12473e5', $l$Logging your sets is half of it. Reading them back is the other half 📊

A 2016 review of 138 studies found tracking progress helped people reach their goals, more so when it was written down.

Log the RPE, not just the weight. 140 for 3 at RPE 7 and 140 for 3 at RPE 9.5 are very different days.

Once a month, scroll back 4-8 weeks.
• Same weight, lower RPE? Probably stronger, even without a PR
• Sessions done vs planned. Consistency explains a lot

It's all sitting in the app waiting for you.$l$, $j${"key":"training-log-review"}$j$::jsonb),
  ('psych-up-arousal', '0862c9f0011bb7e6d887588c1a150cab', $l$How hyped should you be before a max? Depends on you

Some lifters scream before a big attempt. Some go dead quiet.

A 2024 review of 27 studies found psyching up improved max force in about 65% of trials. Most of that research used students and newer lifters, so the effect in experienced lifters is less clear.

Too amped looks like a rushed setup and missed commands. Too flat looks like the bar feeling heavy before you even unrack it.

Where do you land? 👇$l$, $j${"key":"psych-up-arousal"}$j$::jsonb),
  ('run-a-training-experiment', 'b4946cb67a326da749b66a4e73281649', $l$Want to know if something works for YOU? Test one thing at a time

Change 5 things at once and you can't tell what did it.
• Pick ONE thing. Bedtime, caffeine timing, a warmup tweak
• Decide what you'll track first. Top set RPE, bar speed, a 1-5 energy score
• 2 weeks as normal for a baseline, then 4 weeks with the change
• Compare averages, not your best day

One great day is noise. A trend over weeks is info.

Anything touching your sets, reps or exercises, we set up together first. What would you test? 👇$l$, $j${"key":"run-a-training-experiment"}$j$::jsonb),
  ('bad-sleep-before-meet', 'e47cb0ad3d6349db14653f521bb3c4fd', $l$Slept like 4 hours before meet day? Don't panic yet

A 2022 review of 69 studies looked at nights of 6 hours or less. On average strength dropped around 3%. Skill stuff like accuracy dropped way more.

An earlier review on lifting found one night of no sleep barely touched strength in most studies. Several short nights in a row were the bigger problem.

So one rough night might cost a little and make warmups feel heavier.

On the day: normal warmups, normal caffeine, stick to the plan. Something feels off? Tell me in the warmup room and we adjust.$l$, $j${"key":"bad-sleep-before-meet"}$j$::jsonb)
)
UPDATE public.community_series_items i
   SET body = v.body,
       data = i.data || (v.data - 'key'),
       updated_at = now()
  FROM v
 WHERE i.series = 'lesson'
   AND i.data->>'key' = v.key
   AND md5(i.body) = v.seeded_md5
   AND coalesce(i.use_count, 0) = 0;
