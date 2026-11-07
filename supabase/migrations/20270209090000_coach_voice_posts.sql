-- The posts under Jared's name, rewritten as his coaching (his ask, Nov 7
-- 2026: "an elite powerlifting coach explaining something between sets",
-- not a fitness motivation page).
--
-- Every live post the app wrote under his name gets coaching substance in his
-- voice: a hook, the principle, how it shows up in training, a takeaway;
-- natural sentence case; no generic motivation ("there are worse places to
-- lose track of time", "give yourself days like this"); no invented stories,
-- results or claims. Lessons keep every study, number and quote they had
-- (only the writing changes) and their library item takes the same words.
-- Wins keep every name and number. Each post keeps its id, date, author,
-- likes and comments: only the caption changes, and only while it's still
-- exactly what was read (md5 guard), so anything he edited himself stays his.
-- Left as they are: his own words (the Oct 15 lesson he rewrote himself, the
-- caption on his Oct 8 workout) and the birthday messages to members.
--
-- Daily pictures change through their own row (coach_line, which wins over
-- the written line, then community_daily_visual_sync_post: the same post, its
-- updated_at kept, the old words in Versions), including tomorrow's Sunday
-- post, already made in the old voice.

CREATE TEMP TABLE coach_voice_rewrite (id uuid PRIMARY KEY, old_md5 text NOT NULL, body text NOT NULL);

INSERT INTO coach_voice_rewrite (id, old_md5, body) VALUES
-- ── lessons ────────────────────────────────────────────────────────────────
('fe537fcc-19cc-4416-a08e-aeaff3329476', '6194f083a1', $c$Stanford had its basketball team aim for 10 hours a night in bed.

11 players slept normally for a few weeks, then tried to stay in bed that long for over a month. They ended up sleeping almost 2 hours more a night. Free throws went from 79% to 88%, and their sprints got faster too.

Caveat: 11 players on one team, no comparison group. It's a clue, not proof.

You probably don't need 10 hours. But if you're living on 6, sleep is the cheapest recovery tool you're not using. Start simple: keep your wake-up time and go to bed 20 minutes earlier.$c$),
('408b47fe-0dc5-4df7-b9b9-06ed509b52c9', 'a369062cc3', $c$Hips shoot up before the bar leaves the floor? The hips usually aren't the problem.

Two common causes:
• You set up lower than you can actually pull from, so your hips rise until they find your real start position.
• There's no tension before the pull, so the hips move before the bar does.

Film from the side. Wherever your hips are when the bar breaks the floor is your real start. Set up there, and pull the slack out so the bar and your hips move together.

Short arms or long legs for your height usually means a higher hip position. That's your build, not a fault.$c$),
('4ef4d878-0849-46e1-8965-46b264c3b212', '5103982b70', $c$RPE 8 doesn't mean 8/10 hard. It means 2 reps left.

Powerlifting got this version of RPE from Mike Tuchscherer, a World Games champion, who tied each number to reps left in The Reactive Training Manual. RPE 10 is nothing left, RPE 9 is one left, and each number down is one more rep in the tank.

Researchers built on his work in 2016 and found counting reps left is clearer than rating how hard a set felt.

Right after a set, ask yourself: if I had to, how many more clean reps could I do? That's your number. Not how tired you feel.$c$),
('8e98e0ae-e994-42f9-9d90-f9ca6ff7999a', '10cea73088', $c$Arnold trained twice a day. Dorian Yates did one all-out set per exercise. Arnold won 7 Mr. Olympias, Yates won 6 in a row. So how many sets do you actually need?

A 2017 review of 15 studies found more weekly sets built more muscle, and groups doing 10+ hard sets per muscle per week grew the most.

My take: it doesn't climb forever. Each extra set adds less while fatigue keeps stacking. Yates made very few sets work by taking each one to failure after his warm-ups.

Only count hard sets. Warm-ups don't count. If your accessories feel like too much or too little, bring it to me before you pile on sets.$c$),
('2b9b52c0-58c8-413a-a035-5d4c710eaeda', '2bbe95249e', $c$Need to be sore to feel like it worked? You're grading the wrong thing.

Soreness mostly shows up when the work is new: a new exercise, a deeper rep, a slower lowering phase. Repeat the same session next week and you're barely sore, even though you trained just as hard.

A 2013 review concluded soreness is a poor way to judge a workout. It fades as you repeat the work, and you keep growing anyway.

Better signs it's working:
• The same weight moves for more reps
• Your top sets feel easier at the same RPE
• You're beating your log, not your pain$c$),
('da61d12c-f14e-4c5b-91d1-ce718e0b47ef', 'd7bfa6d098', $c$Short on time but want your accessories to count? Try myo-reps.

Norwegian coach Børge Fagerli came up with them in the mid-2000s:
• One starter set, 1-2 reps shy of failure
• Rest 3-5 deep breaths, then 3-5 more reps
• Repeat until you can't hit the mini set

Every mini set lands close to failure, so you get a lot of hard reps in very little time. An 8-week study in trained men found rest-pause sets built muscle about as well as regular sets.

Use them on cables, machines, curls, raises and calves. Not on heavy barbell lifts. If your accessories are written as straight sets, ask me before you swap.$c$),
('86ccddd6-7991-4ee2-b043-4db84abd39d7', '72fea3a382', $c$Rafael Nadal lined up his water bottles the same way every match. Not superstition.

"It's a way of placing myself in a match," he wrote, "ordering my surroundings to match the order I seek in my head."

Pressure makes you think about movements that normally run on autopilot, and thinking your way through a squat you've done 1000 times rarely helps. A routine gives your attention a job. A 2021 review found routines like this helped performance in experiments, under pressure too.

Build yours in training:
• Same steps every time: chalk, walk up, hands, breath
• One cue, not five
• Keep it short. Most federations give you about a minute to start the attempt$c$),
('52e3c93b-b519-4fe0-adca-8c5e741473f2', '9d02ccb958', $c$The spot where your bench slows down isn't where you're weakest.

The bar only slows when your push drops below its weight. So the trouble starts at its fastest point, and by its slowest point your push has caught back up.

A 1989 study of elite powerlifters found it wasn't a worse lever or muscles firing less. A 2013 study pressed from a dead stop and still saw it. Both were small, and only the first used powerlifters.

Most likely it's a weak region you coast through on the speed you built below it.

Film a top single and an RPE 8 single from the side:
• Slows only near max? Normal.
• Crawls off your chest? Build the bottom of the press.
• Position changes at RPE 8 too? That's technique. Fix it light.

My take: train the inches before the stall. Pins just below it, long pauses, fast first inches.$c$),
('75cb8e77-1796-40bc-9056-6453827e923b', '8912a8b876', $c$Plan the week before it plans you.

If your sessions aren't on the calendar, they're competing with everything that is. Work, family and plans win every time.

Take 5 minutes tonight:
• Put your training days in the calendar, with times
• Pick the one session you won't skip no matter what
• Pack your bag so tomorrow is easy

Most missed sessions are a planning problem before they're a motivation problem.$c$),
('7f5a419d-905c-45c8-be4c-61fca5a59f05', 'd65f006f64', $c$An empty bar can drift off midfoot and cost you nothing. Your max can't.

The real rule: the balance point of you plus the bar sits over your feet. The heavier the bar for your size, the more it decides where you balance, so near your max the bar lives over midfoot.

Drift makes it harder too. With your hips a foot behind the bar, an inch of drift puts 8% more on your hips and back.

A 2011 study of 19 powerlifters found the heavier the pull, the less the bar moved forward. Past 60% of their max it came back toward them (tested up to 80%).

Film a light set and a top set from the side:
• Top set as tight as the light one? Normal. Leave it.
• Drift grows with the weight, or you rock onto your toes? It's costing you.

My take: midfoot isn't a cue to chase. It's what balance looks like once the bar outweighs you.$c$),
('ed0b9260-9eba-4245-93db-ac58655eab6e', '6e01236674', $c$Being sore doesn't mean you're not recovered. Not being sore doesn't mean you are.

A 2002 study had students do 12, 24 or 60 hard lowering reps for their arms. More reps cost more strength and took longer to come back, but soreness was about the same in every group.

So track fatigue, not soreness. A small 2023 bench study found sets stopped 3 reps short were recovered within a day. Failure and 1 short took about two.

My test: same warm-up weight and reps every session.
• Usual speed and usual RPE? Train.
• Slower, or a full RPE heavier? Back off, sore or not.

My take: two days apart, a rep or two short is fine. Same muscle the next day? Stop 3 short. Save failure for before a day off.$c$),
('9544b57f-7149-4f69-8d73-6a7051ff0eef', '66c396e7ae', $c$Almost half the people who intend to work out don't.

A 2013 review of 10 studies put that gap at 46%. They meant it. It wasn't enough.

What carries the flat days is habit. A 2014 study found habit made no difference on days people felt like it. On days they didn't, people with stronger habits still got moving.

Those were students and regular exercisers, not lifters. My bet is it holds under a bar too.

My take: how you feel before a session is a guess, not a verdict. So decide once, not every morning:
• Same days and times, written down
• Flat day? Warm up and do your first exercise. Then decide.$c$),
('70df2c7b-8251-4cbe-9aec-32a7be8d1c8d', '03f03157f9', $c$Your squat drifts to one side. That doesn't mean the other leg is weak.

A 2007 study of 18 everyday lifters found one side tended to do more of the work at the hip while the other did more at the knee.

My take: uneven isn't weak. Most drifts start in your setup, mobility or habit.

Check in this order:
• Pain or an old injury there? Deal with that first.
• Bar centred, hands even, feet measured?
• Still there at 60%? Nothing is near its limit there, so it's how you move.
• Same side near your max and in single-leg work, for weeks? That's a real gap.

Then split squats earn a spot: weak side first, match the reps. Send me a video before you program 5 sets of lunges.$c$),
('8b07db4c-0032-4ec2-b8ad-e63a89c0b4d5', '9386c92636', $c$Your max is supposed to look slow. Your push shouldn't be.

Muscle makes less force the faster it shortens. At a true max you're barely pushing harder than the bar weighs, so it can only crawl.

A 2014 study put 20 regular gym-goers on the same 6-week bench plan. One group pushed every rep as fast as they could, the other went half speed on purpose. Their max went up 18% vs 10%. A 2023 review of 24 studies also found fast intent ahead, but only by a little.

My read: slowing the way up on purpose costs you a bit. If you already push every rep, there's no extra to find.

On a grinder that means full push from the first inch. Don't save it for the slow spot. Unless it's tempo work, the weight sets how fast it can go. You set the push.$c$),
('06884af6-45ee-4dfa-89b1-ef22d1f2347b', 'c0a73b5403', $c$Taking every set to failure feels like hard work. It's not the same as good work.

A 2022 review compared going to failure with stopping short. Strength and size gains came out about the same.

What failure does cost you:
• More fatigue
• Slower reps on the sets after it
• Longer before you can train that lift hard again

Where it fits:
• The last set of a one-muscle exercise like curls
• Machines and cables, where a missed rep is safe
• Rarely on a heavy squat, bench or deadlift

Most of your sets should end with 1 to 3 good reps left. That's not soft. That's how you get to train hard again in two days.$c$),
('34d0b12a-ce58-4e88-9fac-c373c7ff8bed', '45e8c443c6', $c$Why does rep 5 of a heavy set look so different from rep 1?

Bar speed drops through a set as you fatigue, so the last reps are the slowest and usually the ugliest.

Cluster sets put short rests inside the set. Instead of a straight 5, do singles with 15-30 seconds between each, or 2+2+1.

Research says they keep bar speed up within the session. Long term, strength and size gains come out about the same.

So it's a tool for cleaner reps, not a strength hack. Use it when you want every rep to look like the first one.$c$),

-- ── Tuesday tips ───────────────────────────────────────────────────────────
('2cc0ce5e-bdbf-4ff7-bdaf-865845731ace', 'c00a44aa6a', $c$Do the people who train more hit more PRs? I checked our last 8 weeks.

The 5 of you training 3+ times a week hit about 22 PRs each. The other 7 averaged about 11.

That's not proof. Training age and what's going on in your life matter too. But more quality reps at a lift is how you get better at it. Frequency is practice.$c$),
('e25e4495-128d-4b51-93b7-2b4014e4fa60', '8aba433c37', $c$Squat cue worth testing: spread the floor.

Drive your feet out to the sides like you're trying to tear the floor apart, without letting them move. For a lot of lifters it gets the hips working harder and stops the knees caving out of the hole.

Test it on your warm-up sets first. If depth and bar path feel better, keep it. If nothing changes, drop it. A cue is only worth keeping if it changes the rep.$c$),
('925ff152-5be7-4884-8789-7740292681cf', 'cb09842456', $c$Run the same warm-up every time: same order, same jumps in weight.

It's not about being robotic. It turns your warm-up into a readiness check. When the same 70% single moves slower than usual or feels a full RPE heavier, you know before your top set and can adjust the load instead of finding out mid-grind.

You can't compare warm-ups that change every session.$c$),

-- ── Try it Thursday ────────────────────────────────────────────────────────
('59678668-6c9f-4f38-8869-240a9d5a75ce', '3d6675fba5', $c$Log your bodyweight 3 or 4 mornings a week. On Home, tap Log Weight on the Bodyweight card. Same conditions every time: after the bathroom, before you eat or drink.

One weigh-in is noise. The trend over a few weeks is the signal, and it's what tells you whether your food actually matches your goal.

📊 5 of you log your bodyweight 2+ times a week. Those 5 trained about 3.8 times a week over the last 8 weeks. Everyone else: 1.9. That's a correlation, not a cause. But the people who track tend to be the people who train.$c$),
('24ca6437-02c0-4375-aa94-3225e71db443', '1f25d469de', $c$The rest timer starts on its own when you check off a set. You can also tap the ▶ on any exercise to start it yourself.

Use it on your main lifts. 3 to 5 minutes between heavy squat, bench and deadlift sets is normal. Cutting rest short there mostly just makes the next set worse. Save the short rest for accessories.$c$),

-- ── the motivation series, as coaching ─────────────────────────────────────
('bac27447-fec0-4e0d-a25e-43bed5b1e2d7', '3340ba78c7', $c$Strength is partly a skill, and every rep is practice. Including the sloppy ones.

If your warm-ups look different from your top sets, you're practising two different lifts. Same setup, same bar path, same brace at 60% as at 90%.

Make your light sets look the way your heavy sets should, and the heavy sets get easier to hit.$c$),
('fd7476be-5315-4534-b672-faa2b12415a9', 'f380906649', $c$The lifters who get strong aren't the ones with the best single session. They're the ones with the fewest missed weeks.

A bad session still gives you practice and information. A missed week gives you nothing.

So stop judging your training by your best day. Judge it by how many of your planned sessions actually happened this month.$c$),
('1ae5b60b-c5b2-4010-a764-787fb568da3a', '5f1fb7e852', $c$Dorian Yates won six straight Mr. Olympias doing one or two working sets per exercise.

The lesson isn't to do less. Every one of those sets went all the way. A set only drives adaptation if it's close enough to failure to matter.

Five sets at RPE 6 can do less than two at RPE 9. Count your hard sets, not your total sets.$c$),
('62ecce1d-f865-48aa-8147-70cae73d935d', 'aa255c3c68', $c$Fridays are where adherence leaks. Not because the program gets harder, but because the week's fatigue and plans pile up.

If your Friday sessions keep getting skipped, willpower isn't the fix. Move the session, shorten it, or make it the one you never miss.

A 45-minute session you actually do beats a 90-minute one you don't.$c$),
('3a56b90f-c422-48de-ba4c-d9d8769ec743', '726de7752c', $c$The last set of the week is where technique gets lazy.

You're tired, the session's almost done, and the reps start drifting. That's exactly when you're practising the worst version of the lift.

Hold the last set to the same standard as the first, or end it early. A rep you wouldn't want on video doesn't need to count.$c$),
('8beb1d60-dd75-486a-9ddc-e9171b9d4aff', 'adcbcbcc06', $c$Most progress happens in unremarkable weeks. No meet, no test day, just sessions at RPE 7 to 8, logged honestly.

Those weeks feel boring because they're working.

If every week needs to feel big, you'll either burn out or start testing instead of training. Save the heavy singles for when they mean something.$c$),
('d6e0aa8e-9c9d-4191-ba81-af47be8306fd', '36ac448793', $c$Most plateaus aren't a wall. They're a block that ended before the adaptation showed up.

Before you change programs, ask whether you ran this one long enough to judge it. Four to six weeks of honest logs tells you more than how your last two sessions felt.$c$),
('4b42a9bd-4e8a-4a6b-9bdb-1a7ebb136a1a', '9e5d12c65b', $c$A lot of early progress doesn't show up in the mirror.

Your first months of training are as much about learning the lifts as building muscle. Better positions, a tighter brace, cleaner bar paths. That's real strength, even when nothing looks different.

Judge the early months by your log, not the mirror.$c$),
('0fe7c986-db1d-41a1-a7d4-093e572d9d38', '289a489ab3', $c$The PR at the end of a block gets all the credit. The six weeks of RPE 7 to 8 work before it did most of the job.

If your training only feels productive on heavy days, you're judging the wrong sessions. The PR is the result, not the work.$c$),

-- ── the week's numbers ─────────────────────────────────────────────────────
('afb07dc2-336b-43ef-8a89-dcef2d3ef3c9', 'a0eb16ac34', $c$That's the week. 7 of 13 of you hit every session you planned.

46 PRs between 12 of you.

Hitting your planned sessions is the number I care about most. The PRs follow it. Full numbers below.$c$),
('667d0031-85cb-4504-8aaa-5be1e9ed63e8', '7a697e35a4', $c$Week recap: 73% of planned sessions got done.

68 PRs between 12 of you.

If you missed sessions, work out why before next week: schedule, sleep or the plan itself. Each one needs a different fix. Full numbers below.$c$),
('ad2bc601-cffc-43cb-af1a-fe80148af57a', '62c7358d3e', $c$End of the week. Here's how we did.

77 PRs between 13 of you.

Full numbers below. Same plan this week: hit your sessions and log every set.$c$),
('79bc1b0a-1595-42c3-ba8a-4ef6e7f174e0', 'a086647f2f', $c$Week recap: 72% of planned sessions got done.

50 PRs between 9 of you.

Hitting the sessions you planned matters more than any single big day. Full numbers below.$c$),
('c66acf21-302f-42c0-9095-c37439830115', 'db8fd91580', $c$41 PRs across the crew last week.

Reecey hit 265lbs x 8 on hack squat, one of 17 PRs in a single week.
Vicky pulled 385lbs x 5 on comp deadlift for an all-time PR.
Nicolas hit 125lbs x 10 on bench, an all-time PR.
Fionna, Alexander and Nicole all set new all-time PRs too.

Shoutout to Colten, Ashley, Marc, Dwayne, Jennifer and Alyssa Amanda for showing up.

12 of you trained last week. Not on here yet? Log every set. The app can't find a PR you didn't record.$c$),
('1f705ca3-bf45-4772-b78e-469cf5b295a5', '0ea3b8dcc6', $c$46 PRs across the crew last week.

Dwayne hit 225lbs x 12 on close-grip bench, an all-time PR plus 3 more PRs.

Jarrett hit 198lbs x 6 on comp bench, an all-time PR.

New all-time PR for Alyssa Amanda on comp deadlift: 187lbs x 4.

Same plan this week: hit your sessions and log every set.$c$),
('262aa78b-bbcf-430a-a4a5-89eb0de502c3', 'a19050b43c', $c$68 PRs across the crew last week.

Marc hit 90lbs x 12 on landmine belt squat, an all-time PR and one of his 6 PRs that week.

New all-time PR for Shaina on comp bench: 207lbs x 5, plus 1 more PR.

Jennifer hasn't missed a week in 18 weeks.

That last one is the one I'd point to. PRs come and go. 18 straight weeks is what builds them.$c$),
('2d7efa5d-6aa6-434b-bbfc-38631540b072', '144afac7fc', $c$78 PRs across the crew last week.

New all-time PR for Jarrett on comp deadlift: 386lbs x 4, one of his 5 PRs that week.

Shaina hit 93lbs x 3 on 2-count pause bench for an all-time PR, plus 2 more PRs.

Ashley hit 145lbs x 8 on BB hip thrust, an all-time PR plus 1 more.

Everyone who showed up last week built that number.$c$),
('6f8ab18c-e66b-4c97-872c-270db35780a5', '3964487c00', $c$50 PRs across the crew last week.

Marc hit 165lbs x 8 on comp squat for an all-time PR, one of his 6 PRs that week.

Colten hit 145lbs x 10 on RDL, an all-time PR and one of his 6 PRs that week.

New all-time PR for Ashley on leg press: 90lbs x 10.

12 of you trained last week. Keep logging every set. It's how these get found.$c$),

-- ── holidays ───────────────────────────────────────────────────────────────
('0336a957-6752-4048-8020-af0eff82dec9', '15008c4482', $c$Happy Thanksgiving. I'm grateful for every one of you.

Before you eat, text one person who helped you get here. Then enjoy the meal. One big dinner doesn't change your progress. What you do the rest of the year does.$c$),
('acf94701-535c-4e83-b365-2d37326528fb', '8d4e970d37', $c$Happy Halloween. Yes, you can have the candy.

Eat a real meal with some protein first and you'll probably eat less of it. One night of candy won't move your bodyweight trend. A week of it will.$c$);

-- a lesson's library item takes the same words (only while it's still the
-- text the post went out with), so the lesson reads the same when it comes round again
UPDATE public.community_series_items i
   SET body = r.body
  FROM coach_voice_rewrite r
  JOIN public.community_posts p ON p.id = r.id
 WHERE i.id = p.series_item_id
   AND p.series = 'lesson'
   AND i.body = p.caption
   AND left(md5(p.caption), 10) = r.old_md5;

UPDATE public.community_posts p
   SET caption = r.body
  FROM coach_voice_rewrite r
 WHERE p.id = r.id
   AND left(md5(p.caption), 10) = r.old_md5;

-- ── the daily pictures: his words on the day, the post updated in place ────
CREATE TEMP TABLE coach_voice_daily (day date PRIMARY KEY, old_md5 text NOT NULL, line text NOT NULL);

INSERT INTO coach_voice_daily (day, old_md5, line) VALUES
('2026-11-06', '9fb51ff74a', $c$Being in the gym for 3 hours doesn't automatically mean you trained harder.

I care about the quality of your working sets, not how long you occupied a bench.

If your main lifts are progressing, your accessories have a purpose, and you're recovering between sessions, we're doing something right.

More work isn't always better work. Stop confusing time spent training with productive training.$c$),
('2026-11-07', '1484e34c46', $c$Your rest day is part of your program. Not a day you failed to train.

You don't get stronger just because you accumulated more fatigue. You get stronger when your body adapts to the training you've already done.

If your performance keeps declining, adding another hard session probably isn't the answer.

The goal isn't to see how much work you can survive. It's to find how much productive work you can recover from.$c$),
('2026-11-08', '', $c$Open your training log from 12 weeks ago.

Find a weight you used to circle. A grinder, maybe a PR you were proud of. Now look at what that same weight looks like in your recent sessions.

That's the progress you don't feel week to week. It's too slow to notice in one session or in the mirror. You see it in the log.

If you're not logging every set, you're throwing that evidence away.$c$);

-- the posted days: only while the post still reads what went out
UPDATE public.community_daily_visuals v
   SET coach_line = d.line, updated_at = now()
  FROM coach_voice_daily d
  JOIN public.community_posts p ON true
 WHERE v.day = d.day AND v.status = 'posted' AND p.id = v.post_id
   AND left(md5(p.caption), 10) = d.old_md5;

SELECT public.community_daily_visual_sync_post(v.id)
  FROM public.community_daily_visuals v
  JOIN coach_voice_daily d ON d.day = v.day
 WHERE v.status = 'posted' AND v.coach_line = d.line;

-- tomorrow's, made but not out yet: his words go out with it (the verse is added as always)
UPDATE public.community_daily_visuals v
   SET coach_line = d.line, updated_at = now()
  FROM coach_voice_daily d
 WHERE v.day = d.day AND v.status = 'ready' AND v.post_id IS NULL AND d.old_md5 = '';
