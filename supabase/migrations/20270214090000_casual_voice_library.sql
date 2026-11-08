-- The library behind the posts under Jared's name, in his own casual voice
-- (his ask, Nov 8 2026: "Don't make every caption grammatically perfect. I
-- want the posts to feel naturally written by me, not professionally edited
-- by AI"). Nov 7's pass (20270210090000_coach_voice_libraries.sql) put every
-- lesson into sentence case and the same shape: a question hook, the
-- explanation, bullets, a sign-off. This is what goes out next, rewritten the
-- way he'd type it, varied post to post (some lowercase, some with capitals,
-- one paragraph or a few short thoughts, fewer question hooks and bullets),
-- every fact, number, study, name and quote kept word for word:
--
--   1. the lessons that haven't gone out yet,
--   2. all 22 Tuesday Tips,
--   3. the holidays (two short lines each, one emoji at most),
--   4. the posts already out under his name (he said to publish them all,
--      Nov 8): lessons, Wins and Recaps (every name, number and PR kept),
--      tips, holidays and the old daily series, in place: same post, date,
--      likes and comments, and a tag on a name already there stays as it
--      was (community_posts_sync_mentions keeps it, so nobody's notified
--      again). A lesson or tip that went out also gets its library text
--      changed to match, so it reads the same if it comes round again.
--
-- Every text changes only while it's still exactly what was read (md5), so
-- anything the coach edited stays his. His own words (the Athlete Insights
-- he wrote, his own notes and workouts) aren't touched. The switched-off
-- series' library items, the Recap and the Wins / numbers templates are left
-- as they are.

-- ── 1 + 2. Lessons and Tuesday Tips ─────────────────────────────────────────
CREATE TEMP TABLE casual_voice_items (id uuid PRIMARY KEY, old_md5 text NOT NULL, body text NOT NULL);

INSERT INTO casual_voice_items (id, old_md5, body) VALUES
('d4752d81-f98f-44ec-b681-86e75bf4a94c', 'c6aee024f77e599f7f32f015b2a988cc', $l$If your squat looks nothing like someone else's, it's how you're built.

The bar has to stay over the middle of your foot or you lose balance. Long thighs vs your torso means your hips sit further back and you lean more. Shorter thighs, more upright.

Neither one is wrong. More lean puts more of the work on your hips and back. More upright puts more on your quads.

So don't copy how much someone leans in their highlight video. What looks off on them might be right for your build. If you think yours is off, send me a video first 👀$l$),
('ca29c6da-58be-4eb7-8de5-bb848f5f9c4d', '16ddcf57427c3c7c1abf8cb96486c2ed', $l$heels coming up at the bottom of your squat is usually one of three things. your ankles don't bend enough yet so your weight rolls forward. or your stance is fighting your hips. a bit wider or more toes out helps some people. or you're starting the squat by shoving your knees forward. sit down between your feet instead.

keep your whole foot on the floor with the bar over midfoot the whole way down. slow 3 second goblet squats teach you where your balance is. lifting shoes help too. a 2017 study found people squatted with less ankle bend and more knee bend in them.

heel pain, or only one side? tell me before you change anything$l$),
('00ee9d30-9778-4d9f-9334-2d074c0de9d9', '6d1c2caea12bab415e1195fd94b0ca64', $l$Where your elbows go pretty much decides where the bar lands on your chest. tuck one rep, flare the next, and the touch point moves with them. that's how it ends up somewhere different every rep.

Pick a target and aim for it every rep. around the bottom of your breastbone is a good start for a lot of people. On lighter sets take 2-3 seconds to lower it so you feel where it lands. and film from the side, feel lies on this one.

An inch of difference between reps is normal. if we already set up your touch point a certain way, stick with it 🫡$l$),
('77f02854-3721-4672-be75-e1e99a7869c9', 'e0707087029af1fb4c661f4e076a35bd', $l$The same weight gets harder when the bar drifts off your legs mid pull. Once it's in front of midfoot your hips and back have to fight to hold it. The further it goes, the harder.

The drift is usually a sign of something else. The bar started over your toes instead of midfoot. Or your hips shot up, so your shoulders swung forward and the bar followed. Or your knees stayed forward and the bar had to go around them.

Think "drag it up your legs".

Paused deadlifts just below the knee teach balance fast. Holding a pause with the bar out front is really hard. Send me a side video before you rebuild anything.$l$),
('f94557f3-fb4f-4625-9f65-97f23db9c853', 'dd63ec0a3e6204e8e68c8d8f825c7687', $l$look back at last week before you plan the next one. most people start every week fresh and repeat the same mistakes. two minutes looking back fixes a lot of that. what went well? what got in the way? what's one thing to do different? just one. not a whole new life on Monday, one thing done all week$l$),
('d40dfa8f-ef34-4936-84f2-5c8b8b2fb83d', '32a660c897f456c59c68654dddd6fa30', $l$Most people don't need a better program, they need to finish the one they're on.

every program looks slow in week 2. that's when the new one you saw online starts looking better. so you switch, start over and get week 1 again. forever lol

A boring plan run for 12 weeks beats a perfect one run for 3. the progress is in the repeating. same lifts, a bit more weight, a bit better reps.

Before you change anything, ask yourself if you actually did the sessions. Did you push the sets you were meant to push? Did you sleep and eat like you wanted results? If any answer's a no, the program isn't the problem.$l$),
('e80a571e-986a-4279-a802-c6c0a86669d3', 'fb2d4f0cdb8cad2326787fcd0e66051f', $l$Sunday's the day to make this week's food easy, before you're hungry. Most nutrition goes wrong on a busy Tuesday at 7pm, not at the grocery store. So set Tuesday up now.

Tonight, cook 2 protein sources you can grab all week. Buy fruit and veg you'll actually eat, not the ones you think you should. And plan Monday and Tuesday meals. The rest gets easier.

You don't need perfect meal prep. You need a fridge that makes the good choice the easy one.$l$),
('a88e2cb4-9e3e-4e61-988c-c65460054121', 'c97aa02ce2beb6584f4119a27c478c39', $l$skipping cardio to protect your gains? cardio was never really after them.

A 2022 look at 43 studies compared lifting with and without cardio added. muscle growth and max strength came out about the same. what took a hit was explosive strength, mostly when both were done in the same session.

so do cardio on its own day, or at least a few hours away from lifting. Keep most of it easy, you should be able to talk. and don't do a hard run right before squats.

Getting out of breath on the stairs isn't a flex. your heart is a muscle too$l$),
('f9ee39e9-ccbe-4626-b71a-32510a75e28b', '40ff251c7650de3a5f1cde918d61748b', $l$decide your minimum before the week gets busy. some day this week is gonna go sideways. figure out now what you'll do when it does. that way you don't decide on the spot to do nothing. for your bad day plan, write a 20 minute version of your session. main lift and one accessory, that's it. and never skip twice in a row. short sessions keep the habit alive. skipped ones don't$l$),
('37f12048-3418-4344-aeac-ac005fbd21fb', '2a6efedd95a8faa6b4a7cbe2f6b114eb', $l$It can feel like everyone at the gym is watching you. Mostly they aren't.

A 2000 study had students walk into a room wearing an embarrassing Barry Manilow t-shirt. They guessed about half the room could say who was on it. It was closer to 1 in 4.

That's called the spotlight effect. You think people notice you way more than they do. You're the one living in your head. The person on the next bench is thinking about their own set. Their own form, their own phone.

So film your sets. Use the empty bar, ask for a spot, do what you came to do 👊$l$),
('efa3d76c-3dcb-43b5-ae8b-2578ec5a7c56', '7469e732b2e011cb87144318815247d9', $l$sunday reset, clear some noise before the week starts. you can't focus on your training with 40 other things fighting for your attention.

mute the accounts that leave you feeling behind. pick ONE goal for the week, not five. and put do not disturb on while you train, the texts can wait an hour lol

a quieter head lifts better$l$),
('20b4801a-ec84-4f3f-9312-46bcd0024a4c', '5d0b67992aaaad395e1f073a87708724', $l$Before you ask anything of your body this week, check in with it. Rate these 1 to 5, 5 being good:
• Sleep
• Stress
• Soreness, or anything nagging

All 3s and up, train as planned. Something at 2 or lower? Don't wait until Wednesday to find out. Plan an easier day, an extra rest day or a swap for whatever's sore.

Changing the plan on Sunday is smart. Grinding through it on Thursday isn't.$l$),
('771a1e29-d14b-43b7-bac6-f6e6cc405b66', '893db26204acf5ca0aec67869c165fde', $l$Genetics are real. some people grow faster, recover faster, or have a build made for a big bench. that's not fair and it never will be.

But "they just have good genetics" is only half true. It's also an easy excuse. My take: most people who say it haven't trained consistently for even two years. you haven't met your genetics yet, you've met your consistency.

The only comparison that matters is you vs you 6 months ago. your log, not their highlight reel. find your ceiling first, then you can complain about it.$l$),
('75231436-8dcf-4aa0-bbd1-e3fef6a8f697', '5bf405cad83f9993b161913e227ab362', $l$Pick one thing to get better at this week. Not ten, ONE.

One cue for your main lift. brace before you unrack, push the floor away, or the same touch point every rep. One habit outside the gym too. protein at breakfast, a daily walk, or in bed by 10:30. then write them down where you'll see them.

A small focus done all week beats a big plan you forget by Wednesday.$l$),
('ec0713cd-4875-4640-931b-d2e5dede2db3', '82c0b3f9087ec55b7ff284d8550de8f2', $l$One missed workout doesn't ruin your week. Deciding the week is ruined does.

A 2010 study followed people building a new daily habit. For the people they could chart, the typical one took 66 days to feel automatic. It ranged anywhere from 18 to 254 days. And missing one day didn't really change how the habit formed.

The problem is never the one miss, it's the "I'll just start again Monday" after it. So if you missed today, do the next session as planned and don't double up. Short on time? Do the main lift and leave. Just never miss twice in a row.

Perfect weeks are rare. A long run of decent ones is what builds lifters 🙌$l$),
('3dbc596d-75ef-4cb1-96ef-a82ea56232c4', '8207a1bcc09f48b7de82f1859c74365a', $l$you already know something's going to get in the way this week. a late meeting, a kids game, a night out. so plan for it now. make an if-then plan like "if I work late Tuesday then I train Wednesday at 6am".

A 2006 look pulled together 94 tests of these if-then plans. The boost in people actually reaching their goals was medium to large.

tonight, name your hardest day this week and write your if-then for it. then pick a backup time. Plans that expect problems survive them$l$),
('64691a17-bd50-41ea-b63a-9b92ff749b5b', 'a6d1908bf17d03ba481d65b31624f37a', $l$People get stuck on the same weight for a year waiting for perfect form.

Every lift looks a little different at 90% than at 60%. The bar slows down, your position shifts a bit, and that's normal. What matters is that it's the same every rep, and that it's safe. Form gets built under weight you can control, not by staring at the empty bar forever.

What I'd look for:
• the same setup every rep
• the bar moving about the same way rep to rep
• no new pain, and you'd happily do the rep again

Film one set a week and compare it to last month. Not to a world record lifter.$l$),
('90d0fff4-b400-4319-9204-ccc2cd371709', '5b678a5deed7e78d136d8f9bb8c6abc2', $l$the scale isn't lying, you're just reading one number like it's a trend.

water, salt, carbs, stress and what's in your gut all move your weight day to day. a big pizza night can sit on the scale for a couple days. that isn't fat. one weigh in tells you almost nothing, seven of them tell you a lot.

so weigh in the morning after the bathroom, before food. look at the week's average instead of today, and compare it to last week's average.

stop letting Tuesday's number ruin your Tuesday lol$l$),
('ad0034b8-8ba0-49b1-9b80-433848dbf29b', '49766774136a4432464804558fcdcd7c', $l$You train maybe 4 hours a week. Look at the other 164.

What you do outside the gym matters. For recovery, for hunger, and for how you feel walking into your next session.

So this week pick a daily step goal you can actually hit, not someone else's 10k. Take a 10 minute walk after one meal a day. And take the stairs or the long way once a day.

Easy movement helps you recover. It doesn't take away from your lifting.$l$),
('0fd2c916-84d2-4e0a-b234-109c7d42e4d8', '4cdc885d2d0b6cd5c7e4de083f44f1d9', $l$sunday reset, remember why you started. motivation fades but a reason doesn't, if you can see it. so write your why in one line. not "to be healthy", something real. keep up with my kids. total 500 this year. feel strong in my own body. then pick one goal for 12 weeks from now. put it somewhere you'll see it every day. on the days you don't feel like it, your reason does the work$l$),
('5657cc02-16d6-4ab6-bdf2-f19e5680ab19', '7a469e85433c332b122d4193ff6fd37c', $l$Feeling behind when you scroll lifting videos is normal. it's also a rigged fight.

you see their PR. you don't see the 50 sessions before it where nothing happened. you're putting their best set of the year next to your normal set this week. Everyone posts the highlight. nobody posts the Tuesday where the bar felt heavy and they went home.

Compare this instead:
• your top set now vs 3 months ago
• sessions done this month vs last month
• how a weight you used to grind feels now

Behind who? you're only racing the you from last year.$l$),
('21ff44fd-b941-49d9-94b0-ee0ed1c918e3', 'd5a629d305b8a68f62fa8e73332193bc', $l$A salad with a bit of chicken is a clean lunch. If it's your biggest meal of the day, it's also not much protein. Eating clean and eating enough protein are not the same thing.

A 2018 look at the research found extra protein helped lifters gain more muscle. The extra muscle levelled off around 1.6 grams per kilo of bodyweight a day. That's counting everything you eat, about 0.7 grams per pound.

Try this for 3 days. Log what you actually eat, not what you meant to, and add up the protein. If you're short, add one high protein meal or a shake. Don't change everything.

Clean food is great. It just can't build muscle from protein that isn't there.$l$),
('b161823d-18dc-430b-a2dc-8e1993d6006e', 'cde912edac8c8447c11ef170ffc1e44d', $l$plan your rest days as carefully as your training days. rest isn't time off from the program, it's part of it. so put them on the calendar on purpose instead of just letting them happen. keep them easy, a walk, some mobility, nothing that leaves you wrecked. and still eat your protein, you're recovering, not off the clock. a good week of training needs a good week of recovery around it$l$),
('3f8ad278-cd00-4610-af07-b7b2598decd0', '5e82517a5b87e876443cd8e895a46cec', $l$Before you plan the week, count last week's wins. most of us remember every missed session and forget the 3 we crushed.

write down 3 wins. a rep PR, a session you almost skipped but did, a week of good sleep. small ones count. then one thing you're proud of, and pick one to repeat this week.

You train better from "look what I did" than from "look what I missed" 🙌$l$),
('96a946fa-41d2-4cf1-8a74-2ecdde0dee41', '45af652fbe8a39ebbeece4c230ae91fd', $l$Honestly, what works is boring. That's exactly why most people quit it.

Same lifts, same days, a bit more weight or one more rep than last time. Sleep, protein, repeat. There's nothing exciting to post about week 7 of the same squat. But that's where strength comes from, not the new exercise you saw this morning.

Switching it up has its place. A new version of a lift to fix a weak spot. Or one that works around a sore joint. Just not because you got bored on a Tuesday.

If training feels boring and the numbers are going up, you're doing it right.$l$),
('d629d449-c692-404e-b67c-9ebfc6001907', '1c9ead8e860e9a9f7135300ac2d8f375', $l$if you're tight at the top but soft at the bottom, that's your brace leaking. usually the breath goes into your chest instead of your belly, sides and back. or a little air sneaks out on the way down.

a belt gives you something to push against. it doesn't brace for you.

big breath before every rep. belly out into the belt like you're about to get punched. hold it through the hardest part and breathe at the top. and do 2 second pause squats. lose it in the pause and you'll lose it in the squat.

blood pressure or heart issues? check with your doctor before long breath holds$l$),
('de2f8a6f-2216-4fce-87b1-fdcb92c3b9e8', '51a2e5b1e385983ed40fab86fa788449', $l$In a meet your hip crease has to drop below the top of your knee. That's lower than most people think, so the camera might disagree with you on depth 👀

your thighs feel parallel way before you're actually deep. filming from the front or above makes high squats look deep. and depth slowly creeps up as the weight climbs.

So film from the side at hip height. Hit the same depth every rep, warm ups too. a high warm up won't turn into a deep single.

Don't compete? then depth is your call, not a rule.$l$),
('00168290-f916-4522-bbf9-c651f43afc5f', 'd20ff1adf1cf259d3621276a118e5189', $l$Hips shoot up first and your squat turns into a good morning? Usually your quads are the weak link. Tipping forward moves the work off your knees and onto your hips and back. Or your upper back goes soft, the bar rolls forward and your chest follows it.

Drive your upper back up into the bar so hips and chest rise together. Pause or tempo squats help you own the bottom. And if your front squat is way behind your comp squat, quad work beats any cue.

Long thighs and a short torso need more lean though. That's your build, not a fault. And if it's only on the last grinder of a set, that's just fatigue.

Send me a video before you change anything.$l$),
('1aeef282-00fe-4e47-9ab1-e0add46ccae0', 'fed625f4885e5790542bd0f7b74b4915', $l$The bar flies out of the hole then dies a few inches above parallel. Almost everyone has a spot like this.

A 2021 study looked at people squatting their 3 rep max. right at that spot the torso leaned more and the hips took more of the work. the push into the floor dipped too.

So which one is yours? if your position changes there (hips shoot, chest drops, bar drifts) that's technique. pause at that height or do tempo squats. if the bar just slows and everything looks the same, that's strength. it needs more heavy practice and time.

Only on the last rep of a hard set? that's normal fatigue. let's figure out which one it is before you change anything 🤝$l$),
('5d09f4b1-0f6f-4229-bc1a-e7d0b7679e64', '98d20ef0c041d0bd7ec51d7e5f3c7dbb', $l$Knees caving as you come out of the hole isn't always a problem. A small knee shift that comes back out halfway up is really common in strong lifters. Plenty of them squat big with it and have no pain.

It's worth working on when it gets worse rep to rep or set to set. Same if it's one knee only, or your hips shift with it. Or if it hurts, or it shows up on light sets too.

Spread the floor with your feet so your knees follow your toes. Do tempo or pause squats at the weight where it starts.

Weak glutes get blamed for everything. It's rarely that simple. Send me a side and front video before you chase it 👀$l$),
('26a836a1-789b-4ca9-b27e-9a60ec5bbbc1', '844f883919ed047d5ea419fcdba4a99f', $l$a long walkout costs you tightness. so does shuffling your feet, or standing half braced waiting for the call. that's part of your max gone before the squat even starts.

same walkout every time, usually 2 or 3 steps. back, out, set. brace before you unrack and stay braced. and practice commands on heavy singles. have someone call squat and rack so a slow call doesn't throw you off.

in IPF style meets the squat call only comes once you're still with knees locked. the rules are a bit different in each fed so check yours.

if your walkout already works, don't rebuild it the month before a meet$l$),
('ff2c736a-f5db-48c7-9384-1106a82c1198', '42e6b2a222d0925f12bf418dba1df4ff', $l$Bar sliding down your back on heavy singles but fine on lighter sets? Under more weight the shelf your upper back makes can go soft. As the bar slips you lean more to keep it over midfoot. Then your wrists and elbows start holding weight.

Usually it's the bar sitting a bit lower, or in a different spot set to set. Or your upper back isn't squeezed tight before you unrack. Or it's a slippery shirt and no chalk.

Squeeze the bar into your back in the same spot every set, warm ups too. And chalk your shirt where the bar sits.

Don't move your bar position near a meet without talking to me though. It changes the whole squat.$l$),
('be4f3e11-64ec-40ac-9a5e-b5edbbb582bd', '2d97668f4b244ab91afecae681115b1e', $l$Butt popping off the bench when it gets heavy is usually leg drive done wrong. Not a lack of it.

leg drive isn't pushing your hips up. it's pushing yourself back along the bench so your upper back stays wedged in. push like you're sliding yourself toward the rack. then move your feet to where pushing doesn't lift you, often a bit further forward. and do some light sets where the only goal is keeping your butt down.

In IPF style meets your head, shoulders and butt have to stay on the bench. So this is a red light. foot position is personal though, check with me before you move yours 🤝$l$),
('aee40937-dd2b-4505-a301-f863ed98437b', 'b70e5076d647587f14da3b6ba94fff2a', $l$Shoulders rolling forward a few reps into the set? The cause usually isn't your shoulders.

One cause is the unrack. Pressing the bar up out of the hooks pulls your shoulder blades off the bench. That's before rep 1. The other is reaching at the top. Pushing past lockout every rep slowly pulls your shoulder blades loose.

So set your upper back first, then pull the bar out over your shoulders. Don't press it out. Each rep is done when your elbows lock, no reaching.

Take a handoff on heavy sets if someone knows how to give one 👀$l$),
('46140e72-7cb0-4717-9c73-f08018cffa31', 'c3d8659a2f76df54c0f9b450cf077293', $l$touch and go flies but your paused reps die right off the chest. part of that is just the stretch. lowering the bar right before you press helps, and a pause bleeds some of that off. a 2013 study had lifters press from a dead stop. they handled clearly less than with a normal touch.

the part you can fix is the pause itself. people relax on the chest, the bar sinks and the arch goes soft. so touch, don't rest, and keep the weight in your hands. pause rep 1 of every set like comp. and do longer 2-3 second pauses on lighter sets.

if you don't compete, touch and go is fine$l$),
('08e4d378-66f0-4c7e-ac10-23555e0fcc63', 'ff7167da55e7b8ace30e37d0056cef65', $l$When your bench dies 2 inches from lockout it's not always triceps. a lot of lockout misses are really misses in the middle. the bar just ran out of speed up top.

other usual suspects? the bar drifting toward your feet. finishing over your chest instead of your shoulders makes the top harder. or one arm finishing first because your grip isn't centered.

Film from the side and look where the bar actually slows, not where it stopped. Once it's off your chest, think push the bar back toward the rack.

Send me a side video of your next heavy single. I can tell you which one it is 👀$l$),
('36cd935d-4844-49f8-94ca-5a751aae2a96', '2921f57eb6e029238e4a657e7cfbdae9', $l$There's no one right touch point. It has to fit how you're built.

Start from this. From the side, your forearms are about straight under the bar at the bottom. So touch point and elbows move together. Lower touch, more tuck. Higher touch, more flare.

Long arms mean more distance to press. A wider grip and a bigger arch can win some back. A deep rib cage already makes the press shorter, so you might need less of both.

I think the mistake at this level is copying someone else's setup. A better position on paper can cost you kilos for months while you relearn it. Test changes in the off season over weeks, with video. Never mid prep.

Anyone moved their touch point and had it click?$l$),
('0afad019-c3ca-43ad-970f-8ef908415f90', 'f25a532b47d75c440077e9f796d5dbf2', $l$if the bar dips a tiny bit right as you hear press, refs see that.

under IPF style rules the bar has to be dead still on your chest. then you get the press command. sinking or heaving it after that is a red light.

it usually happens because the bar was resting on your chest. so you sink it to get tight again, or to grab a mini bounce. touch and freeze instead. control the last few inches so it stops dead. have someone call press at random, sometimes right away and sometimes after 2 seconds. and film from the side at chest height because you can't feel a 1cm dip.

if your pause already gets whites, don't change it near a meet$l$),
('cdbf3987-c465-4053-83f9-36ade8433275', 'aad0c71a23e8fd85421f593784966bc8', $l$If your bar path at 95% looks nothing like your warmups, that's super common.

A 2025 look at 22 studies on experienced lifters found that as the weight goes up:
• the bar slows down
• the press takes longer
• joint movement varies more

What matters isn't whether it changed, it's whether it changed in a way that costs you.

Some of it's worth fixing. losing your touch point, your butt or shoulders coming off, the bar drifting to your feet. Some I'd maybe leave. a bit more elbow flare late, or a path that keeps moving. That can be your body finding a stronger spot.

Don't force your 60% path onto a max. Big changes we decide together 🤝$l$),
('9f5fce6b-1f81-4c8c-baf2-2d9dbeafe5ed', 'b503b150ace86453005ed7bda8e65403', $l$i get why ripping the bar off the floor feels strong, but it usually isn't.

A loaded bar has some play in it. Pull from loose arms and that slack gets taken up mid pull with a jolt. That's often when the back rounds or the hips pop.

So pull the slack out first. pull until the bar clicks against the plates and feels heavy, then push. Brace before that slack pull, not after. squeeze it off the floor, and once you're tight, fast is fine.

If your program has you on a dynamic start that pulls clean, keep it.$l$),
('0dbeab54-f659-41e3-bc07-af93cea4817d', 'a02a46a2c6079f14b0a3591471f149f2', $l$grip going before your back and legs do? that's usually very fixable. a lot of grip fails aren't a strength problem. the bar sits mid palm, rolls into your fingers when it's heavy and your hand opens. so set the bar low in your hand, near where your fingers start. chalk every heavy set. and pick one heavy grip (hook or mixed) and use it on warmups too. straps are fine on high rep sets and RDLs, they're just not allowed on the platform$l$),
('dbfa319b-e92f-4e9c-bfcc-f4486ca51957', 'a4eb9ad80549c551431323e5c1597bb6', $l$Slow off the floor and slow at the knees are two different fixes.

Off the floor it's often setup. hips too low, slack still in, bar too far out.

At the knees is sneakier, because a lot of lockout problems start at the floor. Hips shot up or the bar drifted? then you reach the knee in a worse spot and stall. the stall shows up late but the cause was early.

Film from the side. compare your spot at the knee on a slow rep and a fast warmup. if it's a different spot, fix the floor first. Same spot, just slower? that's strength in that part of the pull.

ask me before adding accessories off this 🤝$l$),
('f551c7c3-f381-406e-a6db-edc6a1b38ad2', 'e6808f797d40a0c3d39fe8c9b1f226e3', $l$lots of sumo pullers drop their hips as low as they'll go because it feels strong. then the hips rise before the bar even moves. sumo doesn't mean squatting the bar up.

set your hips where they are when the bar leaves the floor. not as low as they go. shins close to straight up and knees out over your toes before the pull. knees still in the way? small changes to width or toe angle, one at a time.

hip sockets vary a lot. a stance that works for someone else might not fit you. higher hip sumo is fine if the bar moves well. upright isn't the goal, a strong pull is$l$),
('02d098fb-58bc-4243-9794-0e75dadd1fca', 'ae6853a98a280e95c835774544411bbe', $l$I think a faster setup only helps if the bar still breaks the floor as hard.

At this level it's mostly wasted steps. Hip bounces, re-gripping, sitting in the bottom holding your breath. Each one can cost you grip and brace. But if you cut the steps that build tension, the pull gets weaker.

In a small 2018 study people pulled on a bar that couldn't move. They tried it closer and further over the foot. Which muscles worked harder changed, but total force into the floor didn't.

So use the same order every rep, warmup to max. Grip, breath, wedge, go. Test changes on heavy singles over weeks, not on warmups. If it breaks fast and looks the same every time, leave it.$l$),
('ab631b3e-500f-410f-835f-3176c61eac4b', '8d2253f17a7498cedab55a8d57a29dc5', $l$your heaviest singles probably don't start like your warmups, and the research on it is thin. a 2025 review looked at how experienced lifters deadlift as the weight goes up. it found only 2 studies. so nobody can tell you exactly what should change at your max.

film every heavy single from the side and compare it to a warmup. if it's the same change every time, you can train that position. if it's different every time, that's the real problem.

still breaks the floor and locks out fast? that's probably just how you pull heavy$l$),
('3b590869-3aed-465b-8fc3-d50902864483', 'c3319c070a4cdb0956390b4327ebd17d', $l$A hitched gym PR won't count on the platform.

In the gym? nobody red lights a hitch, soft knees or dropping it the second you stand. in a meet all three can. a gym lockout and a meet lockout just aren't the same thing.

IPF style rules:
• finish tall with knees straight and shoulders back
• the bar can't move down on the way up
• no resting it on your thighs
• hold still until the down signal

so on heavy singles have someone call "down", and pick attempts you can lock out clean.

anyone ever eaten a red light for it? lol$l$),
('b0be4a2e-59f7-42a7-ab50-183aad13d9d2', '6d7c73faf912614ca13c14657e37c6c9', $l$There's a reason we squat to get better at squatting. your body gets better at exactly what you make it do. it even has a name, SAID.

Strength isn't just muscle. it's muscle plus practice of that exact lift at that kind of weight. That's why a huge leg press doesn't automatically mean a huge squat.

A 2017 look at the research compared heavy and light weights. heavy built your max more, and muscle growth was about the same.

variations still matter. they build muscle, hit weak spots and give your joints a break. they feed the main lifts, they just don't replace them.$l$),
('4f6a2328-1ff2-4972-9225-2c71ac12e8a0', 'cfd14c6d5f44452426c7f9dde1e8430a', $l$you don't get stronger in the gym, you get stronger after it. right after a hard session you're actually a bit weaker. then you recover. if the work was hard enough you end up a little better than before. hard work, rest, then better. how long that takes isn't fixed though. a heavy deadlift day usually takes longer to recover from than a few crisp bench singles. and there's two ways to mess it up. too little work, so your body has no reason to get better. or stacking hard sessions before you recover, so the dip keeps getting deeper. that's a big part of why your week is laid out the way it is$l$),
('b463a75f-7533-465e-8e20-5cf98bb55e04', 'ed41409a274cdb4980ddf785aa538dbf', $l$Every session gives you two things at once, fitness and fatigue. What you can lift on the day is about fitness minus fatigue.

Fatigue builds fast and clears fast. Fitness builds slow and fades slow. So when you pull back for a bit, fatigue drops way quicker than fitness. And the strength you built finally shows up. That's a taper, and it's how doing less makes you lift more.

A 2007 look at the research found what worked best. About 2 weeks of cutting your sets and reps by roughly 40-60%. The weights stayed just as heavy.

Pull back too long though and fitness starts fading too. That's why tapers are short.$l$),
('5ad05ebe-9b2f-4609-b3d2-73c8f609d73c', 'f05af1fe57235fcc436f7cd69c00e3d0', $l$Legend says Milo of Croton carried a calf every day. he kept at it until it was a full grown bull. it's the oldest picture of adding a little over time. ask a bit more of your body as you go.

more weight is the obvious way but it's not the only one. Same weight for more reps or sets counts. So does the same weight at a lower RPE or faster bar speed. or just cleaner reps.

a single that was RPE 9 last month and moves at RPE 7.5 now? that's real progress. judge it across a block, not one session.$l$),
('3d5e7a89-f364-4990-9a6f-46d3d87bbdc3', '624b30bf076dc989a9bf2ace412fc7cc', $l$your RPE 6 is a guess. your RPE 9 is way more accurate.

a 2022 look at the research checked how well people guess their reps left. overall people guessed about 1 rep too low. most of us have a bit more in the tank than we think. guesses got better closer to failure, and in sets of 12 or fewer. near failure the bar slows way down, so you can feel it coming.

low RPE calls are rough guesses and that's fine. top sets at 8 to 9 are where your call matters most$l$),
('481475a7-6684-4f4d-91a1-b228df717e5b', '3f102cc4bda2706cdfa90efb976a4e2d', $l$As the weight goes up the bar slows. Your body moves a bit different to get it going. So your warm ups and your top set aren't quite the same lift.

Your squat leans a touch more. On bench the bar touches a slightly different spot. On deadlifts your hips rise a bit first.

Some of that is your body finding where it's strongest. Some of it is form breaking down, and video is how we tell them apart. Film your heavy sets, not just warm ups. Set up every warm up like the top set, same stance, grip and brace.

If something only changes on heavy sets, send it to me before you fix it. Might not be a problem at all.$l$),
('1e31e56e-15bd-4bf1-832f-9b7f8d66dd00', '3447398b9e4378e4dab62acdde1d452c', $l$Some weeks the same weight feels totally different. your strength on any day isn't a set number. sleep, stress, food and leftover tiredness all move it. so the max written in your program is a ballpark, not a promise.

That's why a lot of programs pick top sets by RPE instead of a fixed %. good day, the weight goes up. rough day, it comes down and you still get good work in.

A 2021 study had one group pick squat weight by reps left in the tank. Over 12 weeks they gained more strength than the group on fixed percentages. not every study finds a difference though.

a lighter top set on a bad day isn't a failed session. it's the system working$l$),
('98f80851-7bad-4a75-89a2-e37d5ee7d573', '8858189b8b8267361fe0bc26a2547c0f', $l$Lifting a max is a skill, not just a test.

Bulgarian weightlifters worked up to a heavy single almost every session. Their coach Ivan Abadjiev's teams won 57 world titles. I'm not saying copy it, but it shows something.

A single has a slower bar, more pressure and more nerves. Your positions have to hold the whole way. If you only feel that on meet day, you're doing a new skill under max pressure.

A small 2017 study had one group just practice their max for 8 weeks. Another group did 4 sets to failure, and strength gains came out about the same.

That's why singles get built in before a meet. To practice, not to test. The ones in your program are there on purpose. This isn't a pass to max every day.$l$),
('c8b673f8-ba5c-47c3-8d93-d2844ad50269', '163cb33cbb9fc60d027f105d21c322dc', $l$Mike Mentzer took his sets past failure. His Heavy Duty training added forced reps and negatives (just the lowering part) after failure. He won the 1978 Mr. Universe heavyweight class with a perfect 300 score.

research says you just need to get close though. there's two big reviews since then. one found going to failure wasn't clearly better for growth than stopping a bit short. the other found growth went up the closer sets ended to failure. strength looked about the same across a wide range.

so for accessories, ending around 0-3 reps in the tank is a good zone. sets with 5+ reps left probably do less.

comp lifts are different. we keep those further from failure on purpose$l$),
('4adeb525-9cb5-4e9c-ade3-4e081fd2cf1e', 'd7123943782419dd096dfde7bb73ad33', $l$if you're gonna cut accessory reps short, the bottom half is the part to keep.

when half reps lose to full reps it's usually for one reason. they skip the stretched part of the rep. studies looked at leg extensions and calf raises. half reps in the stretched half grew as much or more than full reps. half reps in the other half, where the muscle is short, grew the least.

newer work in trained lifters mostly finds the two about equal. so full reps are a safe default, and if you go partial keep the stretched end.

accessories only though. comp lifts still go to comp depth$l$),
('bf26b213-c0b1-4dab-944f-abe04945b937', '950d872d2b5d54ae031b246cfc884abf', $l$"Everybody want to be a bodybuilder, but nobody wants to lift no heavy ass weight"
Ronnie Coleman, 8x Mr. Olympia

He's right for strength. For growth, light works too if it's hard.

A 2017 look at 21 studies tested light vs heavy. Light meant 60% of your max or less, and sets went to failure. Growth came out about the same but max strength went up more with heavy.

The catch is a light set only works when it gets hard. The first 10 reps of a 25 rep set are easy. It's the grindy reps at the end that count.

So comp lifts stay heavy, and accessories can live anywhere from about 6 to 20+ reps.$l$),
('39dd293e-343c-41f1-a5b8-c36e069d719d', 'b8899a282fd52267656c63583b215a7e', $l$hitting a muscle 3x a week instead of 1x matters less than you'd think.

A 2019 look at 25 studies checked this. When weekly sets were the same, more sessions didn't clearly grow more muscle. the edge only showed up when more sessions also meant more sets.

So training more often is mostly a way to spread your sets out. 15 sets for one muscle in one day gets sloppy. split over 2-3 days, more of them are good sets.

where it matters more is the lifts themselves. Boris Sheiko became head coach of Russia's national powerlifting team. his lifters squat and bench several times a week. the weights average around 70% of max. that's practice, not just muscle.$l$),
('f1f22128-5c52-47be-8fe8-2fdf8212e155', '86c114a35e3e5551ce6bdfaf806e6b42', $l$resting 60 seconds to keep the pump isn't the growth hack it was sold as. in a 2016 study trained guys ran the same program. some rested 1 minute and some 3. the longer rest group gained more strength and grew a bit more. probably because they kept more reps and weight on the bar each set.

a 2024 look at the research found a small edge for resting longer than a minute. past about a minute and a half there wasn't much difference. so just rest long enough that your next set is a real set. big lifts like squats often need 2 to 3+ minutes. for curls and raises 90 seconds is usually plenty$l$),
('50189212-d38d-4f3b-9bb1-1dbbfcb4bc45', 'e4932f5786795816fa405b0ba0cdc2d4', $l$Stuck on the same dumbbells for weeks? Add a rep instead. Dumbbells and machines jump in big steps. honestly reps are the easier way up a lot of the time.

A 2022 study had trained lifters do one of two things. Add weight each week, or keep the weight and add reps. After 8 weeks muscle growth was basically the same.

What matters is that something in your log moves over a few weeks. If an accessory hasn't budged in a month or two, send it my way.$l$),
('df26a831-52bd-4f27-8f62-33e2f8f1c97b', '6d413bf7514765aef4bc1c760e8670b6', $l$machines aren't cheating, and for growth they're often the easier pick. a 2023 look at 13 studies compared free weights and machines. muscle growth came out about the same. strength stuck to the tool though, so free weights did better on free weight tests. that's the part that matters for powerlifting. the barbell builds barbell strength and machines can build the muscle behind it. they're also easier to take close to failure since you're not spending effort on balance. not every machine fits every body, so if one feels awkward swap it$l$),
('2fd79476-4017-4cca-9fcb-5e550a18a2ff', '568cb9afda154560643f518b6d2b7069', $l$Soreness mostly tracks how new or different the work was. That's why it fades as you get used to a program, even while you're still growing. so not being sore after a session doesn't mean it didn't work.

In a 2011 study one group got eased into a hard program. that way they avoided muscle damage. another group got thrown straight in. the thrown in group was way more sore and both gained the same size and strength.

soreness isn't the scoreboard. Reps and weight creeping up over the weeks is.$l$),
('89e75668-36c8-4ec1-886c-8b06e2726735', 'cf62bfee47763bc4822bf6ae523521d4', $l$A 2018 look at 49 studies checked how much protein you actually need to build muscle. Gains kept going up until about 1.6 g per kg of bodyweight a day. After that they flattened out.

That's about 0.7 g per lb of bodyweight. The top of their range was about 1 g per lb. So a 198 lb lifter wants about 145 to 200 g a day.

Hitting your total most days matters way more than timing or shakes. If you're on a dietitian's plan though, follow theirs.$l$),
('3d74ee17-0977-43fb-afee-84260874fd38', '272f18bc37984db13c2e6d2dcf53c19f', $l$cardio hurts your gains way less than the gym myths say.

a 2022 look at 43 studies compared lifting alone with lifting plus cardio. adding cardio caused no drop they could measure in muscle growth or max strength. what it did hold back was explosive stuff like jump height. mostly when both were done in the same session.

where it can bite is hard leg cardio right before squats or pulls. or doing so much that it eats into recovery or food. separate days or a few hours apart keeps it out of the way. and if you're thinking of adding a lot, tell me first$l$),
('7c6279df-fb5b-455c-9b46-ace09c8f3d51', 'f128473714c9465fa71141cf657718e0', $l$Drop sets won't build more muscle but they can save a ton of time.

Go close to failure, strip about 20-30% of the weight and keep going with no rest. Maybe drop once more. Two big looks at the research found they grow muscle about as well as regular sets. In some studies they took a half to a third of the time.

Use them on the last set of a machine or a one muscle move like curls. Skip them on the main lifts because stripping plates at failure is a mess. If you want to try one, a single drop on the last set is plenty.$l$),
('9c600187-51c2-44e8-8785-5a72733af348', 'd42b77f6f64387bfef21f711c269ead9', $l$Arnold paired chest and back in supersets and the research says he was onto something. think bench press straight into chin ups, one muscle rests while the other works. rows + DB bench, curls + pushdowns and leg curls + leg extensions all pair well too.

A 2025 look at the research found supersets cut session time without costing strength or size. opposite muscle pairs even got people more reps than straight sets.

the catch is they feel harder. and holding two stations in a busy gym is a pain lol

keep heavy squat, bench and deadlift as straight sets and pair the accessories after.$l$),
('f2e625d9-3140-4cf2-a5fa-2773d4557531', '720e7357829d7ce0b2f309df80a4e1c8', $l$Hit failure on full reps? The bottom half might still have more in it.

Stretched half reps are reps in just the stretched part. Think the bottom half of a curl, or the bottom of a leg press. To stretch out a set, go to failure with full reps. Then grind out 3-5 half reps at the stretched end. You get more out of the set without adding another one.

A 2025 study had trained lifters train one arm each way. Both grew about the same. Research on doing them after failure is thin though, so it's a tool, not a must.

They're good on machines, cables, curls and calves. Never on squat, bench or deadlift 💀$l$),
('06077823-924a-4f43-8e68-348ab0f29781', 'eb2dacadbe4733a7a7701396095fcb9a', $l$In the early 80s SuperSlow had people take about 10 seconds to lift a weight. Ken Hutchins built it during a study that Nautilus paid for.

so do slower reps build more muscle? not past a point. a 2015 look at the research checked this. reps from about half a second to 8 seconds all grew muscle about the same. really slow reps (10+ seconds) looked worse, probably because you have to go way lighter.

controlling the way down still helps. same position every rep, no bouncing out of the bottom. it just won't double your gains to go from 2 seconds down to 4.

got a 3 second way down on squats or a long bench pause in your program? that's there for technique, so keep it.$l$),
('d740da28-46d6-4dc3-813a-e40de5d85546', 'b65432ba9bc71f8f4031b45c3f7c4468', $l$Arnold used cheat reps on curls, just not the way most people do lol. he was strict until he couldn't get another rep. then he used just enough body swing to squeeze out a couple more.

fine when:
• it's the last 1-3 reps of curls, lateral raises or rows
• you've already hit failure with clean reps
• the way down stays strict

It's a waste when you're swinging from rep 1, because the weight is just too heavy. And on squat, bench or deadlift there's no cheat rep, just a bad rep.

the cheat should help the muscle finish the set, not do the set for it.$l$),
('2e21baf1-ee1a-4199-a4f0-e508173f6d3f', '9b7e65bbbba3f1ec7276c3391d30439e', $l$You pay for drop sets and failure sets on squat day. Drop sets, rest pause, failure sets on leg press. They add a lot of fatigue for a little extra reason to grow.

Sets to failure take longer to recover from than stopping short with the same total reps. The gap shows over the next 1-2 days. And strength gains barely change with how close to failure people train. So for strength, failure buys very little and costs a lot of recovery.

Using them? keep them to one muscle moves (curls, raises), last set only. They're first to go if your main lifts feel flat or a meet is close.$l$),
('80cbf126-eb32-4536-82e3-b373604fbcb7', '4e4e90c110bc5de0deb00d966c901e22', $l$if your warm ups are tiring you out they're not warm ups anymore. they have one job. practice the lift and get you ready for the heavy set.

a simple ramp as a % of your top set:
• empty bar first
• 40% for 5
• 60% for 3
• 75% for 2
• 85-90% for a single

the jumps get smaller and the reps drop as the weight climbs. the common mistakes are long sets once the warm ups get heavy. and going straight from your heaviest warm up into the top set. give that one a real rest.

if your program lists specific warm ups, use those$l$),
('019ea0d6-ccf1-4445-b401-77ef5ac7193e', 'cf0247b84e8779ee7070b2240a2a0327', $l$Muhammad Ali called himself the greatest before he'd even won the heavyweight title. He put out an album called I Am the Greatest in 1963. Months later he beat Sonny Liston as an 8 to 1 underdog.

The research on self-talk is less wild but it's real. A 2011 look at 32 studies found it helped performance a moderate amount. It helped most on skills that need to be precise. And on stuff people were still learning.

There's 2 kinds. How-to cues like chest up, push the floor. And hype, like let's go, you got this. People who practiced their self-talk ahead of time got more out of it.

So pick one short phrase and use it on every top set. What's yours?$l$),
('105cf0d4-49a4-440e-a08c-361f46030bf9', 'a7d79fd188b65cedb74c5f28be30fbef', $l$a deload doesn't make you stronger. it lets you show what you built. hard training builds fitness and fatigue, and fatigue fades faster when you back off. so a lighter week lets your lifts come back without losing much fitness.

a 2024 survey of 246 strength and physique athletes found they deload about every 5-6 weeks. a full week off isn't magic though. in a 2024 trial the group that kept training came out ahead on leg strength.

so a deload is lighter training. fewer sets, more reps in the tank, same lifts. if there's one in your plan it's there for a reason$l$),
('4fe944ea-34ba-43df-9f35-a965bb8c4456', 'db1fc5920a28e61f264591171f2aeef7', $l$Old research, wild result. In 1972 researchers told varsity athletes some of them would get steroids. The ones picked got fake pills instead. They still gained more in 3 of 4 lifts than in the weeks before.

It's tiny and over 50 years old, so don't trust the exact numbers. But a 2000 study found something like it in competitive powerlifters. When half were told the truth midway, their extra gains mostly faded.

The point isn't to go find sugar pills. Belief changes how hard you push. Reps you've already hit are how you build that belief for real 💪$l$),
('24a13211-5cb4-40b0-a7c9-6aaf45569322', '03e41fbc40bd8c4d5f1521a39360abf9', $l$Nick Saban built 7 national titles on one idea. forget the scoreboard. he called it the Process, do this rep, this play, this day right.

research backs him up. a 2022 look at 27 studies in sport found process goals helped performance the most. outcome goals barely moved it.

an outcome goal is hitting a total or winning. a performance goal is something like a 5kg squat PR. a process goal is fully in your control. pause every first bench rep, hit every session, in bed by 11.

keep the big goal but write 2-3 process goals under it for this block$l$),
('0f67ad71-5f56-4997-ad92-30acc2b0d10a', '0335c4798765f84f10f153758d94d21c', $l$Caffeine is one of the few supplements with real research behind it for lifting. A 2018 look at the research found a small boost to max strength and jump power. Small is the key word though. It's a nice bonus, not a new you.

The ISSN (a sports nutrition group) says 3-6 mg per kg of bodyweight. Most often about an hour before. As little as 2 mg per kg might work. Big doses mostly just add side effects.

Late caffeine can wreck your sleep. If you've got heart issues or you're pregnant, ask your doctor. And never try a new dose for the first time on meet day.$l$),
('9329b64b-8189-4625-91b9-a6dbcadce0e2', 'a69814288d5d9d2c56663802e6703ed6', $l$exams, work chaos, a breakup. your training notices all of it.

a 2008 study followed 135 students through 12 weeks of lifting. the ones with less stress in their life gained more on squat and bench. that doesn't prove stress caused it. stressed people might also sleep less or miss more sessions. but later studies tied more stress to slower recovery after hard sessions too.

i think of recovery as one bank account that the gym and life both spend from. in a rough week showing up still counts. and tell me, we can change the week so you're not grinding through it$l$),
('582e66fa-1685-4497-9f24-3362fcb336d3', '30ca67afcb6b69cbbe59b891e514ec62', $l$Michael Phelps played a perfect race in his head every night and morning. His coach Bob Bowman called it watching the videotape. In the 2008 Olympic 200m butterfly final his goggles filled with water. He counted his strokes and still won gold in world record time.

Can picturing a lift make you stronger? Kind of. A 2018 look at the research found just picturing it made people stronger than doing nothing. It was a medium sized boost and real training still beat it.

Where it fits for us is practicing meet day in your head. The walkout, the commands, your setup, the grind if the rep slows down. Do it at the same speed as the real lift and picture the real place. Put the hard part in, not just the lockout.$l$),
('56298d4e-dd4b-48cb-9636-3f3db551d74b', '4f3422323afe9a31013bdec1a22c797d', $l$how hyped should you be before a max? depends on you. some lifters scream before a big attempt and some go dead quiet.

a 2024 look at 27 studies checked it. getting hyped up helped max force in about 65% of tests. but most of those people were students and newer lifters. so for experienced lifters it's less clear.

too amped looks like a rushed setup and missed commands. too flat looks like the bar feeling heavy before you even unrack it. where do you land?$l$),
('d9a32986-f17d-4633-a332-5723ddb2194e', 'c8ed868ca99b8abedc68168674139d56', $l$Change 5 things at once and you can't tell what did it. If you want to know if something works for YOU, test one thing at a time.

Pick ONE thing, like bedtime, caffeine timing or a warm up tweak. decide what you'll track first. top set RPE, bar speed, a 1 to 5 energy score. do 2 weeks as normal first so you know where you start. then 4 weeks with the change, and compare the averages, not your best day. one great day is noise, a trend over weeks is info.

anything touching your sets, reps or exercises, we set it up together first.$l$),
('15727fbb-3769-4dfe-8f42-4c537fa37372', 'baa5481ae8f376a42856569872cc91e6', $l$Slept like 4 hours before meet day? Don't panic yet.

A 2022 look at 69 studies checked nights of 6 hours or less. Strength dropped around 3%, and skill stuff like aim dropped way more. An earlier look at lifting research checked one night of no sleep. Most studies found it barely hurt strength. A few short nights in a row were the bigger problem.

So one rough night might cost you a little and make warmups feel heavier. On the day it's normal warmups, normal caffeine, stick to the plan. If something feels off, tell me in the warmup room and we'll adjust.$l$),
('ffc302fc-f612-442a-8f04-a8268c21dfd8', '5d93c155995d058a25c93e510ed4a268', $t$squat cue to try this week: spread the floor. push your feet out to the sides like you're trying to rip the floor apart, even though they don't actually move. for a lot of lifters it gets the hips working and stops the knees caving on the way up

try it on your warm-up sets first. if the bar moves better keep it, and if it doesn't, drop it. a cue only earns its place if it changes the rep$t$),
('cb1e4549-94df-4e26-a22b-d57401aa41c6', '9fd555833dd0805513a629815c0dcf38', $t$Your warm-up should look the same every session. Same order, same jumps in weight. After a few weeks it's as much a test as a warm-up. When the same weight moves slower than usual, you know before your top set that today needs adjusting.

Pick one this week and keep it for the whole block.$t$),
('c7aeb209-03e5-425c-960e-f0e6f158dcd8', '3c76cf81ea135c2205d521d434beddf9', $t$One bad session doesn't tell you much. sleep, stress, food and a long day at work all show up on the bar. The trend over 4 to 6 weeks is what tells you whether the program's working, so judge it there and not on one Tuesday that felt heavy.

next time a session feels off just log it honestly, write a quick note on why and move on$t$),
('0c3570c8-2c8f-43de-a2a4-0f07db940975', '6a4370998e7d1a08da251bd34a51a252', $t$gym packed and someone's on your rack? have a plan B before you need it. if the rack's taken do your accessories first. if the machine's gone use the closest thing that trains the same muscle. a session done at 80% of the plan still moves you forward, a skipped one doesn't. the main lifts are the priority and everything else can move around them$t$),
('b407750e-9929-45c6-a150-cfadb8249e5e', 'c87ec587d56e33a40fda3a785c7db1ac', $t$Next time you bench, try to bend the bar. Grip it hard and think about snapping it in half. A lot of lifters find it pins the shoulder blades back and keeps the elbows from flaring early, so the bar path gets more consistent.

Test it on your first couple of warm-up sets and film one from the side. If the touch point and the path tighten up, keep it.$t$),
('3815d8a6-ca3d-42b5-9319-98fdb52f9334', 'fcf0b7df9d37cf0e4694954cb22d1367', $t$Quick one on RPE. an 8 means you had 2 more good reps in you, not 2 more if your life depended on it.

RPE is there so you pick the right weight for the day. if your 8s are really 9.5s then every weight built off them is off too and the fatigue piles up. After each top set this week ask how many clean reps you really had left and log that number.$t$),
('7ae5d783-7d3d-44c5-b2b4-0b7276df4570', 'f7b72a2cda7553d2673799362b9cae10', $t$Chalk, belt, same breath, same setup. Run the same routine before every heavy set.

It takes the decisions out of the rep. Your attention goes on the steps instead of the number on the bar, and your setup stops changing from set to set. Pick 3 steps this week and do them before every working set.$t$),
('d646c653-8618-4212-a476-8cbeac3d6875', '431f7082a7828a8e60f85273842b28c5', $t$you can't control how your body feels on any given day. you can control showing up, sleeping, eating enough and giving an honest effort. those are the inputs and if you do them for long enough the numbers usually follow. so on the days you feel rough just show up and run the plan. adjust the load if your warm-ups say so but get the work in$t$),
('1919cb29-609d-4bba-8e38-e01ec0ffb565', '908795755e052b507b84e72c3e7c07d0', $t$On deadlifts, pull the slack out before the bar leaves the floor. grip it, pull up just enough to hear the plates click, get tight, then push.

Yanking it off the floor costs you position in the first inch and that usually shows up as your hips shooting up or the bar drifting forward. do it on every warm-up set this week so it's automatic by your top set$t$),
('ffa5a864-0c77-4920-a05f-75d90f6c8523', 'a36186ad0b79b303aa7e815787bc74fc', $t$rest longer on your main lifts. 3 to 5 minutes between heavy sets isn't lazy lol, it's how the next set gets to be heavy too. cutting rest short on squats and deadlifts mostly just lowers the quality of the next set, so you get less practice at the weights that matter. save the short rest for accessories$t$),
('b4cddda4-a8f2-461b-8ff7-1336d12912a8', '5a02877fb3c3cfb280bf2dc87861537a', $t$If you're getting fired up for warm-ups, you're spending the hype too early. Save it for the top set.

Warm-ups are for practice and for reading how the bar's moving today. Stay calm through them, then turn it up for the 1 or 2 sets that actually matter. Try it next session and compare how the top set feels.$t$),
('65733bc4-e5f3-40b5-8575-10726c4c5e16', '09e1073fee558a9fc1e35935f02f3673', $t$For my coaching clients: if everything feels heavy for 2 weeks straight, tell me. that's useful information, not you being soft. Sometimes it means we pull back for a week, sometimes it's sleep or food, and either way I can only adjust what I know about. Put it in your workout review or just send me a message.$t$),
('2a4de398-edea-4f77-8b16-25c6e642b393', '2379d7066b5d7da423e3afae736899b4', $t$Deadlift slow off the floor? try changing the thought. Stop thinking pull and start thinking push the floor away, like a leg press.

for a lot of lifters that stops the hips shooting up first, so the legs do more of the work in the first few inches. Film one set with the cue and one without and the video will tell you which one to keep.$t$),
('61382fd2-3c48-4a4e-bc90-3d52e516c0d0', 'cc5abdc0bd6d0d55b32a2f99bc3742f7', $t$Training on an empty tank rarely shows up in the first set. It shows up in the last few, when the reps slow down and the back-off sets turn into grinders.

Eat something 1 to 3 hours before you train. Some carbs and some protein, nothing complicated. If you train early and can't eat much, a banana or some toast beats nothing.$t$),
('d17676d5-38c5-4ee9-a522-d0b2e9a24a2d', 'f109db761e35a63b4fc78fa763b036dc', $t$i think the only comparison that tells you anything is you against you a few months ago. someone else has different limb lengths, a different training age and a different life outside the gym, so their numbers aren't your benchmark. your log is. scroll back through your PRs in the app this week and compare the same lifts 12 weeks apart$t$),
('627facf0-7ab2-4bd4-84ed-bdece2dfc89b', '0e914182a1e79e77d4a41d3e909ec054', $t$If your lower back is the first thing to give on heavy sets, your brace is where I'd start. breathe into your belt all the way around. not just your stomach, your sides and lower back too, like you're filling a barrel, then lock it in before you move.

Practise it on a lighter set first so you can feel the difference, then carry it into your working sets.$t$),
('805cccf4-56e3-4a86-9588-4b44655d7d5b', '746c98add7b84c718219ddcaf78fc749', $t$Open your workout before you walk into the gym and know what your top set is supposed to be. It takes about 30 seconds.

Having the plan in your head means less wandering, less guessing weights halfway through and warm-ups that build to the right number. Make it part of your routine this week.$t$),
('bf8641c7-e138-4f3d-8102-efe612831e02', '804bb8496e6e9c2301326bdeee1d1775', $t$sleep is the one thing that makes training feel easier without touching your program. 7 to 9 hours is the usual target. a short night shows up as slower warm-ups and a higher RPE at the same weight

a lot of lifters don't need a new program, they need to go to bed earlier lol. try 30 more minutes a night this week and watch how your top sets move$t$),
('c080f378-d8f4-4418-8fb5-b17677b78ad5', '2b1d4baa411b72b27c55aee89e534ee4', $t$On bench, push yourself away from the bar and down into the bench instead of pushing the bar up. sounds like the same thing. For a lot of lifters though it keeps the upper back tight and the leg drive connected, so the press starts from a stable base. give it a few sets this week and see if the lockout feels any different$t$),
('e007452a-e619-466a-9029-3c7e58af6c6d', 'dd5e341464cd8436fa421fa274479767', $t$Pretend there's a wall behind you on RDLs and try to touch it with your butt. Hips go back, the bar stays close to your legs, and you stop when your hips can't go back any further.

Going lower than that usually just rounds your back and turns it into a different exercise. Done right you'll feel your hamstrings way more, which is the whole point of the lift.$t$),
('afec84d5-c26c-445d-aa01-0f8c2ea8406e', '705bc60b279a6275752d5845875eb171', $t$elbows to your back pockets, not hands to your chest. that's the cue for pulldowns and rows, your hands are just hooks. most lifters feel their lats a lot more and their biceps a lot less, which matters when the back work is there to support your bench and deadlift. try it next back day and drop the weight a bit if you need to$t$),
('fc70ff2f-3c0b-4095-a960-1eb892592823', '95c52b65e968a76416e9ba863bb0f0a3', $t$Something to try on your accessories. control the way down for 2 to 3 seconds and don't cut the stretch short at the bottom. My read of where the research is heading is that the stretched part of the rep matters a lot for growth.

you're probably gonna need less weight and that's normal. Try it on 1 or 2 exercises for a couple of weeks and compare how they feel.$t$);

UPDATE public.community_series_items i
   SET body = r.body, updated_at = now()
  FROM casual_voice_items r
 WHERE i.id = r.id AND md5(i.body) = r.old_md5;

-- ── 3. Holidays ──────────────────────────────────────────────────────────────
CREATE TEMP TABLE casual_voice_holidays (key text PRIMARY KEY, old_md5 text NOT NULL, body text NOT NULL);

INSERT INTO casual_voice_holidays (key, old_md5, body) VALUES
('new_year', '5da6537cfbfc0d96675fa7417869cbf9', $h$Happy New Year 🎉 and thank you for every rep last year.

pick one habit for this year, not ten. then set a reminder to check on it next week$h$),
('valentines', '4a9cd0d18d328d2d6ce21165157003cb', $h$happy Valentine's Day ❤️ love this crew a lot

leave a real comment on someone's post today. takes 30 seconds and it'll make their day$h$),
('mothers_day', 'c30ddd9c2685c483f3f91bb48894276a', $h$Happy Mother's Day to all the moms in here 💐

Text your mom one thing she taught you that you still use, it'll mean more than the card.$h$),
('fathers_day', 'a2f127254cd15a0c70bc985187faf2e8', $h$Happy Father's Day to the dads 👊

get 15 minutes of movement in today with your kid or your dad. a walk or a game of catch is plenty$h$),
('canada_day', '7134b9fb2eb6ef7f2974e493ec40cf50', $h$Happy Canada Day 🇨🇦 enjoy the long weekend everyone.

Have a glass of water before every drink today, you'll train a lot better tomorrow.$h$),
('labour_day', '55b1082682c6b8a98d757a57a62e955f', $h$Happy Labour Day, and thanks for putting the work in all summer.

put this week's sessions in your calendar now. if it isn't scheduled it usually doesn't happen$h$),
('halloween', '48df85d2c77569416a5b3bee657fc328', $h$happy Halloween 🎃 and yes, you can have the candy

eat a real meal with some protein first and you'll probably eat less of it. one night won't move your trend$h$),
('thanksgiving', 'acd63f4db561d4b4648b376623dab270', $h$Happy Thanksgiving, grateful for every one of you.

Before you eat, text one person who helped you get here. then go enjoy the meal$h$),
('christmas', 'b073ebe650a5781e5b29804b1f3f0297', $h$merry Christmas 🎄 thank you for every session this year

one big meal doesn't change your progress. leave the tracking for a day and just be there for it$h$),
('easter', '398300a42b26dcb515d1d60f7292299b', $h$Happy Easter 🐣 so grateful for every one of you.

after the big meal go for a 20 minute walk with the family, then enjoy the chocolate.$h$);

UPDATE public.community_holidays h
   SET body = r.body
  FROM casual_voice_holidays r
 WHERE h.key = r.key AND md5(h.body) = r.old_md5;

-- ── 4. Posts already out, in place ──────────────────────────────────────────
CREATE TEMP TABLE casual_voice_posts (post_id uuid PRIMARY KEY, series text NOT NULL, old_md5 text NOT NULL, caption text NOT NULL);

INSERT INTO casual_voice_posts (post_id, series, old_md5, caption) VALUES
('c66acf21-302f-42c0-9095-c37439830115', 'wednesday_wins', 'aa4b8474c595efa1ae76131dd7bbe385', $p$41 PRs across the crew last week, here's some of them.

Reecey hit 265lbs x 8 on hack squat, one of 17 PRs in a single week.
Vicky pulled 385lbs x 5 on comp deadlift for an all-time PR.
Nicolas hit 125lbs x 10 on bench, an all-time PR.
Fionna, Alexander and Nicole all set new all-time PRs too.

and a shoutout to Colten, Ashley, Marc, Dwayne, Jennifer and Alyssa Amanda for showing up.

12 of you trained last week. not on here yet? log every set, the app can't find a PR you didn't record$p$),
('62ecce1d-f865-48aa-8147-70cae73d935d', 'finish_strong_friday', 'd9569c8cd3f549c532e84d78627dffec', $p$fridays are where adherence leaks. not because the program gets harder, it's the week's fatigue and plans piling up by then.

if your Friday session keeps getting skipped, willpower isn't the fix. move it, shorten it, or make it the one you never miss. a 45-minute session you actually do beats a 90-minute one you don't$p$),
('d6e0aa8e-9c9d-4191-ba81-af47be8306fd', 'saturday_spirit', '0a71b2dd750397a483211b9aae6fced8', $p$Before you change programs, ask yourself if you actually ran this one long enough to judge it. Most plateaus aren't a wall. They're a block that ended before the adaptation showed up. Four to six weeks of honest logs tells you way more than how your last two sessions felt lol$p$),
('afb07dc2-336b-43ef-8a89-dcef2d3ef3c9', 'sunday_recap', '9b4acf2c59d2b40a7171a641ae39a77e', $p$that's the week. 7 of 13 of you hit every session you planned.

46 PRs between 12 of you.

honestly hitting your planned sessions is the number i care about most, the PRs follow it. full numbers below$p$),
('bac27447-fec0-4e0d-a25e-43bed5b1e2d7', 'monday_motivation', 'bc633c59ee75fbb3db43d7ec55063925', $p$Every rep you do is practice, the sloppy ones too. Strength is partly a skill.

If your warm-ups look different from your top sets, you're practising two different lifts. I want the same setup, same bar path and same brace at 60% as at 90%. Make your light sets look the way your heavy sets should and the heavy ones get easier to hit.$p$),
('0336a957-6752-4048-8020-af0eff82dec9', 'holiday', '727d94e51a5c46e9cfe7f3939367cf49', $p$Happy Thanksgiving, grateful for every one of you

text one person who helped you get here before you eat. one dinner doesn't change your progress, enjoy it$p$),
('2cc0ce5e-bdbf-4ff7-bdaf-865845731ace', 'tuesday_tips', '7315c1c95c29b4f1426d37f7377c2f10', $p$do the people who train more hit more PRs? i checked our last 8 weeks. the 5 of you training 3+ times a week hit about 22 PRs each and the other 7 averaged about 11.

that's not proof, training age and what's going on in your life matter too. but more quality reps at a lift is how you get better at it. frequency is practice$p$),
('1f705ca3-bf45-4772-b78e-469cf5b295a5', 'wednesday_wins', 'ac13d52fe1bb13347bcac93a2e28828e', $p$Last week the crew hit 46 PRs.

Dwayne hit 225lbs x 12 on close-grip bench, an all-time PR plus 3 more PRs.

Jarrett hit 198lbs x 6 on comp bench, an all-time PR.

New all-time PR for Alyssa Amanda on comp deadlift: 187lbs x 4.

Same plan this week. Hit your sessions and log every set.$p$),
('7c1d6a7c-4a7d-4a86-997e-3625aa98cfa5', 'lesson', '81001479aaf26a5dbe6fca26ab56e992', $p$What you focus on, the muscle or moving the weight, depends on the exercise.

for squat, bench and deadlift I generally prefer external cues. push the floor away, keep the bar path consistent. focus on executing the lift instead of thinking about every muscle involved. Research suggests an external focus can have a small advantage for strength performance.

isolation work is a little different. A 2018 study found squeezing the biceps during curls led to more growth than just moving the weight (12.4% vs 6.9%). that was in untrained lifters though.

So on your main lifts, think movement and force production. on curls, raises and flyes, focusing on the muscle can be useful. the cue should match what you're trying to do.$p$),
('fe537fcc-19cc-4416-a08e-aeaff3329476', 'lesson', 'de21d4ad6444aab0da6a64e0d3b20832', $p$Stanford had its basketball team aim for 10 hours a night in bed. 11 players slept normally for a few weeks, then tried to stay in bed that long for over a month. They ended up sleeping almost 2 hours more a night. Free throws went from 79% to 88%, and their sprints got faster too.

Big caveat. 11 players on one team and no comparison group, so it's a clue, not proof.

Honestly you probably don't need 10 hours. But if you're living on 6, sleep is the cheapest recovery tool you're not using. Start simple. Keep your wake-up time and go to bed 20 minutes earlier.$p$),
('408b47fe-0dc5-4df7-b9b9-06ed509b52c9', 'lesson', 'ffc98dbfe317f7c9a1a2d6076df3b67e', $p$when your hips shoot up before the bar leaves the floor, the hips usually aren't the problem. there are two common causes. you set up lower than you can actually pull from, so your hips rise until they find your real start position. or there's no tension before the pull, so the hips move before the bar does.

film it from the side. wherever your hips are when the bar breaks the floor is your real start. set up there and pull the slack out so the bar and your hips move together.

short arms or long legs for your height usually means a higher hip position. that's just your build, not a fault$p$),
('667d0031-85cb-4504-8aaa-5be1e9ed63e8', 'sunday_recap', '5001d805ae6e3f3a90cdb85ff6c750df', $p$73% of planned sessions got done this week.

68 PRs between 12 of you.

If you missed some, work out why before next week. Was it your schedule, sleep or the plan itself? Each one needs a different fix. Full numbers below.$p$),
('4ef4d878-0849-46e1-8965-46b264c3b212', 'lesson', 'b5e20f415c18199a73af168fcc2eecc2', $p$RPE 8 isn't 8/10 hard. it means 2 reps left.

Powerlifting got this version of RPE from Mike Tuchscherer, a World Games champion. He tied each number to reps left in The Reactive Training Manual. so RPE 10 is nothing left, RPE 9 is one left, and each number down is one more rep in the tank.

Researchers built on his work in 2016 and found counting reps left is clearer than rating how hard a set felt.

right after a set, ask yourself: if I had to, how many more clean reps could I do? that's your number, not how tired you feel.$p$),
('8e98e0ae-e994-42f9-9d90-f9ca6ff7999a', 'lesson', '7f34f08ccd53a369179d8019ea60ae3e', $p$Arnold trained twice a day and won 7 Mr. Olympias. Dorian Yates did one all-out set per exercise and won 6 in a row. So how many sets do you actually need?

A 2017 review of 15 studies found more weekly sets built more muscle. Groups doing 10+ hard sets per muscle per week grew the most.

My take is it doesn't climb forever. Each extra set adds less while fatigue keeps stacking. Yates made very few sets work by taking each one to failure after his warm-ups.

Only count hard sets, warm-ups don't count. If your accessories feel like too much or too little, bring it to me before you pile on sets.$p$),
('262aa78b-bbcf-430a-a4a5-89eb0de502c3', 'wednesday_wins', '126c3e5a6537dce83d633525f80dd0b4', $p$the crew hit 68 PRs last week

Marc hit 90lbs x 12 on landmine belt squat, an all-time PR and one of his 6 PRs that week.

New all-time PR for Shaina on comp bench: 207lbs x 5, plus 1 more PR.

Jennifer hasn't missed a week in 18 weeks.

that last one's the one i'd point to. PRs come and go, 18 straight weeks is what builds them$p$),
('2b9b52c0-58c8-413a-a035-5d4c710eaeda', 'lesson', '84ec2532ebd3794b17f631b307581397', $p$Need to be sore to feel like it worked? you're grading the wrong thing.

soreness mostly shows up when the work is new. a new exercise, a deeper rep, a slower lowering phase. Repeat the same session next week and you're barely sore, even though you trained just as hard.

A 2013 review concluded soreness is a poor way to judge a workout. it fades as you repeat the work and you keep growing anyway.

better signs it's working: the same weight moves for more reps. your top sets feel easier at the same RPE. you're beating your log, not your pain.$p$),
('59678668-6c9f-4f38-8869-240a9d5a75ce', 'try_it_thursday', '44153b4134868585c946f304f807775c', $p$5 of you log your bodyweight 2+ times a week. Those 5 trained about 3.8 times a week over the last 8 weeks, everyone else 1.9. That's a correlation, not a cause, but the people who track tend to be the people who train.

If you want to start, log it 3 or 4 mornings a week. On Home, tap Log Weight on the Bodyweight card. Same conditions every time, after the bathroom and before you eat or drink.

One weigh-in is noise. The trend over a few weeks is the signal, it's what tells you whether your food actually matches your goal.$p$),
('da61d12c-f14e-4c5b-91d1-ce718e0b47ef', 'lesson', 'a4666109fa01de20d7a934d7eef68c4e', $p$myo-reps are a good one if you're short on time and want your accessories to count. Norwegian coach Børge Fagerli came up with them in the mid-2000s.

you do one starter set, 1-2 reps shy of failure. rest 3-5 deep breaths, then do 3-5 more reps. repeat that until you can't hit the mini set.

every mini set lands close to failure, so you get a lot of hard reps in very little time. an 8-week study in trained men found rest-pause sets built muscle about as well as regular sets.

use them on cables, machines, curls, raises and calves, not on heavy barbell lifts. if your accessories are written as straight sets, ask me before you swap$p$),
('3a56b90f-c422-48de-ba4c-d9d8769ec743', 'finish_strong_friday', 'a5fbe73b2571a866776139227b2edd42', $p$Technique gets lazy on the last set of the week. you're tired, the session's almost done and the reps start drifting, which is exactly when you're practising the worst version of the lift. Hold the last set to the same standard as the first or just end it early. a rep you wouldn't want on video doesn't need to count.$p$),
('86ccddd6-7991-4ee2-b043-4db84abd39d7', 'lesson', 'e567b3ee68918a12368e873ae923de1f', $p$Rafael Nadal lined up his water bottles the same way every match, and it wasn't superstition.

"It's a way of placing myself in a match," he wrote, "ordering my surroundings to match the order I seek in my head."

Pressure makes you think about movements that normally run on autopilot. Thinking your way through a squat you've done 1000 times rarely helps. A routine gives your attention a job. A 2021 review found routines like this helped performance in experiments, under pressure too.

So build yours in training. Same steps every time: chalk, walk up, hands, breath. One cue, not five. And keep it short. Most federations give you about a minute to start the attempt.$p$),
('4b42a9bd-4e8a-4a6b-9bdb-1a7ebb136a1a', 'saturday_spirit', 'a2271693da75ac6eb91c7b1cdbd80fd0', $p$your first months of training are as much about learning the lifts as building muscle. better positions, a tighter brace, cleaner bar paths. that's real strength even if nothing looks different, so a lot of early progress just won't show up in the mirror. judge those months by your log, not the mirror$p$),
('52e3c93b-b519-4fe0-adca-8c5e741473f2', 'lesson', '94566f0b59ddde9c4e270f48fb72c56c', $p$Where your bench slows down isn't where you're weakest. the bar only slows once your push drops below its weight, so the trouble starts at its fastest point. by its slowest point your push has caught back up.

A 1989 study of elite powerlifters found it wasn't a worse lever or muscles firing less. A 2013 study pressed from a dead stop and still saw it. both were small and only the first used powerlifters. Most likely it's a weak region you coast through on the speed you built below it.

film a top single and an RPE 8 single from the side.
• Slows only near max? that's normal.
• Crawls off your chest? build the bottom of the press.
• Position changes at RPE 8 too? that's technique, fix it light.

My take: train the inches before the stall. pins just below it, long pauses, fast first inches.$p$),
('75cb8e77-1796-40bc-9056-6453827e923b', 'lesson', 'a5ee9a9389207549b0d35d54c3dc7d0d', $p$most missed sessions are a planning problem before they're a motivation problem. if your sessions aren't on the calendar, they're competing with everything that is. work, family and plans win that every time.

so take 5 minutes tonight. put your training days in the calendar, with times. pick the one session you won't skip no matter what. and pack your bag so tomorrow is easy$p$),
('ad2bc601-cffc-43cb-af1a-fe80148af57a', 'sunday_recap', 'b128017c25eb3a7b90f358b72c7b11ad', $p$Here's how the week went.

77 PRs between 13 of you.

full numbers below. same plan this week, hit your sessions and log every set$p$),
('fd7476be-5315-4534-b672-faa2b12415a9', 'monday_motivation', '7e015c8b267370c91fddc0e81c51df54', $p$I think the lifters who get strong are the ones with the fewest missed weeks, not the best single session. A bad session still gives you practice and information. A missed week gives you nothing.

So stop judging your training by your best day. Count how many of your planned sessions actually happened this month.$p$),
('7f5a419d-905c-45c8-be4c-61fca5a59f05', 'lesson', 'e1855949412d754ee05100a24f3349a9', $p$an empty bar can drift off midfoot and cost you nothing. your max can't.

what actually matters is that the balance point of you plus the bar sits over your feet. the heavier the bar for your size, the more it decides where you balance. so near your max the bar lives over midfoot. drift makes it harder too. with your hips a foot behind the bar, an inch of drift puts 8% more on your hips and back.

a 2011 study of 19 powerlifters found the heavier the pull, the less the bar moved forward. past 60% of their max it came back toward them (tested up to 80%).

so film a light set and a top set from the side. if the top set's as tight as the light one, that's normal, leave it. if the drift grows with the weight or you rock onto your toes, it's costing you.

my take: midfoot isn't a cue to chase. it's what balance looks like once the bar outweighs you$p$),
('e25e4495-128d-4b51-93b7-2b4014e4fa60', 'tuesday_tips', 'cfd4bdf6a5cfdba8487d789fd97a0972', $p$Spread the floor is a squat cue worth testing. drive your feet out to the sides like you're trying to tear the floor apart, without letting them actually move. for a lot of lifters it gets the hips working harder and stops the knees caving out of the hole.

test it on your warm-up sets first. if depth and bar path feel better keep it, if nothing changes drop it. a cue's only worth keeping if it changes the rep.$p$),
('ed0b9260-9eba-4245-93db-ac58655eab6e', 'lesson', 'e807bb5b7c03d7be0f8e25714797d04e', $p$Soreness is a bad way to tell if you've recovered. Being sore doesn't mean you're not recovered, and not being sore doesn't mean you are.

A 2002 study had students do 12, 24 or 60 hard lowering reps for their arms. More reps cost more strength and took longer to come back. Soreness was about the same in every group.

So track fatigue instead. A small 2023 bench study found sets stopped 3 reps short were recovered within a day. Failure and 1 short took about two.

Here's how I test it. Same warm-up weight and reps every session. If the speed and RPE are what they usually are, train. If it's slower or a full RPE heavier, back off, sore or not.

My take: two days apart, a rep or two short is fine. Training the same muscle the next day? Stop 3 short. Save failure for before a day off.$p$),
('2d7efa5d-6aa6-434b-bbfc-38631540b072', 'wednesday_wins', '2c11b0c248f17989c0875952a86c58c0', $p$we had 78 PRs across the crew last week

New all-time PR for Jarrett on comp deadlift: 386lbs x 4, one of his 5 PRs that week.

Shaina hit 93lbs x 3 on 2-count pause bench for an all-time PR, plus 2 more PRs.

Ashley hit 145lbs x 8 on BB hip thrust, an all-time PR plus 1 more.

everyone who showed up last week built that number$p$),
('9544b57f-7149-4f69-8d73-6a7051ff0eef', 'lesson', '65dcec24482e5b79682df7ab36145c2a', $p$Almost half the people who mean to work out don't. A 2013 review of 10 studies put that gap at 46%. they meant it and it wasn't enough.

habit is what carries the flat days. A 2014 study found habit made no difference on days people felt like it. On days they didn't, people with stronger habits still got moving. those were students and regular exercisers, not lifters. my bet is it holds under a bar too.

My take: how you feel before a session is a guess, not a verdict. so decide once, not every morning. same days and times, written down. and on a flat day, warm up and do your first exercise, then decide.$p$),
('24ca6437-02c0-4375-aa94-3225e71db443', 'try_it_thursday', 'bc38aa852c998b6d1691a9ce4b95f776', $p$Your rest timer starts on its own when you check off a set, or you can tap the ▶ on any exercise to start it yourself.

I'd use it on your main lifts. 3 to 5 minutes between heavy squat, bench and deadlift sets is normal, and cutting rest short there mostly just makes the next set worse. Save the short rest for accessories.$p$),
('70df2c7b-8251-4cbe-9aec-32a7be8d1c8d', 'lesson', '7da75a655aafdb9a68fbc808a40588eb', $p$a squat that drifts to one side doesn't mean the other leg is weak. a 2007 study of 18 everyday lifters found one side tended to do more of the work at the hip, while the other did more at the knee.

my take: uneven isn't weak. most drifts start in your setup, mobility or habit. so check it in this order
• pain or an old injury there? deal with that first
• bar centred, hands even, feet measured?
• still there at 60%? nothing is near its limit there, so it's how you move
• same side near your max and in single-leg work, for weeks? that's a real gap

then split squats earn a spot, weak side first and match the reps. send me a video before you program 5 sets of lunges$p$),
('8beb1d60-dd75-486a-9ddc-e9171b9d4aff', 'finish_strong_friday', '5485c5cf89742a8fcdda46b3e117ae02', $p$Boring weeks are where most progress happens. no meet, no test day, just sessions at RPE 7 to 8 logged honestly. they feel boring because they're working.

If every week has to feel big you're gonna either burn out or start testing instead of training. save the heavy singles for when they mean something$p$),
('0fe7c986-db1d-41a1-a7d4-093e572d9d38', 'saturday_spirit', '7ca9f1dab6f1c8891473bf84fe830dfb', $p$the PR at the end of a block gets all the credit, but the six weeks of RPE 7 to 8 work before it did most of the job. if your training only feels productive on heavy days you're judging the wrong sessions. the PR is the result, not the work$p$),
('acf94701-535c-4e83-b365-2d37326528fb', 'holiday', '9b7d11076fddc3cf5040493facbf60b6', $p$Happy Halloween. You can have the candy

Eat a meal with protein first, you'll probably eat less of it. One night won't move your bodyweight trend, a week will.$p$),
('79bc1b0a-1595-42c3-ba8a-4ef6e7f174e0', 'sunday_recap', '2d1733635fb3a523358e3034ce1ddc1c', $p$week recap, 72% of planned sessions got done

50 PRs between 9 of you

hitting the sessions you planned matters more than any one big day. full numbers below$p$),
('1ae5b60b-c5b2-4010-a764-787fb568da3a', 'monday_motivation', 'a8c600f4ffcc029de6c4f5d4a8bc6bce', $p$Five sets at RPE 6 can do less than two at RPE 9.

Dorian Yates won six straight Mr. Olympias doing one or two working sets per exercise. That doesn't mean do less. Every one of those sets went all the way, and a set only drives adaptation if it's close enough to failure to matter. Count your hard sets, not your total sets.$p$),
('8b07db4c-0032-4ec2-b8ad-e63a89c0b4d5', 'lesson', '73d79d136c7adbb2423995afe4ebef94', $p$Your max is supposed to look slow, your push shouldn't be. muscle makes less force the faster it shortens. at a true max you're barely pushing harder than the bar weighs, so it can only crawl.

A 2014 study put 20 regular gym-goers on the same 6-week bench plan. One group pushed every rep as fast as they could, the other went half speed on purpose. their max went up 18% vs 10%. A 2023 review of 24 studies also found fast intent ahead, but only by a little.

My read: slowing the way up on purpose costs you a bit. if you already push every rep there's no extra to find.

so on a grinder, full push from the first inch. don't save it for the slow spot. Unless it's tempo work the weight sets how fast it goes, you set the push.$p$),
('925ff152-5be7-4884-8789-7740292681cf', 'tuesday_tips', 'f23e876b2fc4e5c3961c387040e0e84a', $p$run the same warm-up every time, same order and same jumps in weight. the point isn't to be robotic lol. it turns your warm-up into a readiness check.

if the same 70% single moves slower than usual or feels a full RPE heavier, you know before your top set. then you can adjust the load instead of finding out mid-grind. you can't compare warm-ups that change every session$p$),
('6f8ab18c-e66b-4c97-872c-270db35780a5', 'wednesday_wins', '6199dcb3f62bffbf9ec7e289a7536044', $p$50 PRs across the crew last week.

Marc hit 165lbs x 8 on comp squat for an all-time PR, one of his 6 PRs that week.

Colten hit 145lbs x 10 on RDL, an all-time PR and one of his 6 PRs that week.

New all-time PR for Ashley on leg press: 90lbs x 10.

12 of you trained last week. keep logging every set, that's how these get found$p$),
('06884af6-45ee-4dfa-89b1-ef22d1f2347b', 'lesson', 'bd5a6e6ca7e801fdc0c866ae840a3aef', $p$Most of your sets should end with 1 to 3 good reps left. Failure on every set feels like hard work, but it's not the same as good work.

A 2022 review compared going to failure with stopping short. Strength and size gains came out about the same. Failure does cost you though. You get more fatigue and slower reps on the sets after it. And it takes longer before you can train that lift hard again.

Where it fits is the last set of a one-muscle exercise like curls. Or machines and cables, where a missed rep is safe. Rarely on a heavy squat, bench or deadlift.

Stopping short isn't soft. It's how you get to train hard again in two days.$p$),
('34d0b12a-ce58-4e88-9fac-c373c7ff8bed', 'lesson', '38904bcff92bf501a7f8952b8a4514db', $p$rep 5 of a heavy set looks so different from rep 1. that's because bar speed drops through a set as you fatigue. the last reps are the slowest and usually the ugliest.

cluster sets put short rests inside the set. instead of a straight 5, do singles with 15-30 seconds between each, or 2+2+1. research says they keep bar speed up within the session. long term, strength and size gains come out about the same.

so it's a tool for cleaner reps, not a strength hack. use it when you want every rep to look like the first one$p$);

-- a lesson or tip that went out reads the same if the library brings it round again
UPDATE public.community_series_items i
   SET body = r.caption, updated_at = now()
  FROM casual_voice_posts r
 WHERE r.series IN ('lesson', 'tuesday_tips') AND i.series = r.series AND md5(i.body) = r.old_md5;

-- the caption only: its date, place in the feed, likes and comments stay
UPDATE public.community_posts p
   SET caption = r.caption
  FROM casual_voice_posts r
 WHERE p.id = r.post_id AND md5(p.caption) = r.old_md5;
