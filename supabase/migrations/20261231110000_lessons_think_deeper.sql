-- Lessons that teach athletes to think, not repeat (docs/EDUCATIONAL_POSTS.md).
--
-- 1. The bench sticking-region lesson (posted Oct 24) rewritten to the new
--    standard: the bar only slows while the push is under its weight, so the
--    trouble starts at its fastest point and is over by its slowest; the 1989
--    study questioned, with a 2013 dead-stop study that still found the
--    slowdown; evidence, interpretation ("Best read") and coaching hypothesis
--    ("My take") told apart; a normal gap, a weak bottom range and technique
--    told apart; its chart now shades fastest → slowest. The live post and its
--    library lesson change only if still exactly as written before (md5).
-- 2. "Why you miss where you miss" (planned Nov 2) said the old version again;
--    it's retired, and Nov 2 gets "Heavy is slow, but intent still matters",
--    which builds on Saturday's point about speed off the chest.
-- 3. The lessons planned Oct 26 to Nov 2 rewritten to the same standard (every
--    study checked, each one's limits in the post), only while still exactly as
--    seeded and never posted (md5 guard), so anything the coach changed stays his.

WITH v(key, seeded_md5, body, data) AS (VALUES
  ('bench-midrange-position', 'c15481620aefc0b2718657b47c2e527f', $l$The spot where your bench slows down isn't where you're weakest.

The bar only slows when your push drops below its weight. So the trouble starts at its fastest moment, just off your chest. By the time it's slowest, your push has caught back up.

A 1989 study of elite powerlifters found it wasn't a worse lever or quieter muscles. Their theory: the stretch from lowering the bar fades before your best leverage kicks in. A 2013 study pressed from a dead stop and still saw it, so it's not just the stretch. Both were small, and only the first used powerlifters.

Best read: a weak position you coast through on the speed you built below it.

Film a top single and an RPE 8 single from the side.

• Same path, slows only near max. Everyone has it. Nothing to fix
• Same path, but the bar crawls off your chest. No speed to coast on. Build the bottom range
• Forearms tip off the bar, it drifts to your feet or shoulders roll up, even at RPE 8. Technique. Fix it light

Arch, grip and arm length move where your gap sits, so don't copy anyone's elbow path. New to benching? Just bench more.

My take: train the inches before the stall. Pins a few inches below it, long pauses, fast first inches.$l$, $j${"key": "bench-midrange-position", "level": "advanced", "lift": "bench", "track": "fix", "title": "Your sticking point starts lower", "tags": ["bench-midrange", "bar-path", "strength-curves"], "refs": [{"label": "Elliott, Wilson & Kerr 1989, Med Sci Sports Exerc 21(4):450-462. 10 elite powerlifters, film + EMG: shoulder moment arm fell through the press, prime movers at peak activity from the start; proposed a force-reduced gap between the stretch-assisted start and the better-leverage top", "url": "https://pubmed.ncbi.nlm.nih.gov/2779404/"}, {"label": "van den Tillaar & Ettema 2013, J Hum Kinet 38:63-71. 11 recreational lifters: a pure concentric 1RM (no lowering) still had a sticking region, so fading stretch isn't the whole story; they favour a poor mechanical position", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC3827767/"}, {"label": "Valverde-Esteve & García-Manso 2021, Cultura, Ciencia y Deporte 16(49):497-503. 11 men: the sticking region showed only at 90% and 100% 1RM", "url": "https://ccd.ucam.edu/index.php/revista/article/view/1605"}, {"label": "Larsen, Gomo & van den Tillaar 2021, Front Sports Act Living. 14 trained men: grip width changed shoulder moments in the sticking region; resultant force fell there at every grip", "url": "https://doi.org/10.3389/fspor.2020.637066"}, {"label": "Mechanics, no study needed: the bar decelerates whenever the upward push is less than its weight, and its slowest point is where the push equals its weight again"}], "story": {"options": [{"label": "Off the chest", "tag": "bench-off-chest"}, {"label": "Mid-range", "tag": "bench-midrange"}, {"label": "Lockout", "tag": "bench-lockout"}], "q": "whats usually your biggest bench issue?", "type": "poll"}, "visual": {"kind": "sticking_point", "lift": "bench", "variant": "window"}}$j$::jsonb)
), item AS (
  UPDATE public.community_series_items i
     SET body = v.body, data = v.data, updated_at = now()
    FROM v
   WHERE i.id = 'ce3358c9-ee06-4cbc-b815-0709fe066633' AND md5(i.body) = v.seeded_md5
  RETURNING i.id
)
UPDATE public.community_posts p
   SET caption = v.body, series_data = v.data - 'story', edited_at = now(), updated_at = now()
  FROM v
 WHERE p.id = '52e3c93b-b519-4fe0-adca-8c5e741473f2' AND md5(p.caption) = v.seeded_md5;

-- Nov 2: the intent lesson instead of the old sticking-points one (only while still planned as that)
UPDATE public.community_lesson_plan
   SET item_id = '91367cb0-d02e-4a86-b797-ef2e56ddfd64', updated_at = now()
 WHERE day = '2026-11-02' AND status = 'planned' AND item_id = '4d198735-569d-4d3b-a239-3f7771761947';
UPDATE public.community_series_items
   SET active = false, updated_at = now()
 WHERE id = '4d198735-569d-4d3b-a239-3f7771761947' AND coalesce(use_count, 0) = 0
   AND NOT EXISTS (SELECT 1 FROM public.community_lesson_plan lp
                    WHERE lp.item_id = '4d198735-569d-4d3b-a239-3f7771761947' AND lp.status NOT IN ('skipped'));

WITH v(key, seeded_md5, body, data) AS (VALUES
  -- bar-over-midfoot, planned 2026-10-26
  ('bar-over-midfoot', '8f6835a3518dbda63aceb325c07d5dae', $l$An empty bar can drift off midfoot and cost you nothing. Your max can't.

The real rule: the centre of mass of you plus the bar sits over your feet. It's why your arms go forward on an air squat.

The heavier the bar for your size, the more it decides. At 100 kg bodyweight, you balance an inch of drift on 50 kg by sitting back half an inch. On 250, two and a half. Near max, the bar lives over midfoot.

Drift costs leverage too. Your hips' lever is their distance behind the bar, your knees' in front. Hips a foot back? An inch of drift is 8% more on hips and back.

Low bar leans you: longer hip lever. High bar and front squats sit upright: longer knee lever. Sumo is upright too. Whether it spares your hips, studies split.

A 2011 study of 19 powerlifters: the heavier the pull, the less the bar went forward. Over 60% it came back toward them (tested to 80%).

Film a light and a top set from the side.
• Top set as tight as the light one, or tighter: normal. Leave it
• Drift grows with weight or you rock to your toes: it's costing you

Best read: midfoot isn't a cue to chase. It's what balance looks like once the bar outweighs you.$l$, $j${"key": "bar-over-midfoot", "track": "strength", "title": "What bar over midfoot really means", "tags": ["bar-path", "squat-balance", "deadlift-bar-path"], "refs": [{"label": "Swinton et al. 2011, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/21659894/"}, {"label": "Escamilla et al. 2000, Med Sci Sports Exerc", "url": "https://pubmed.ncbi.nlm.nih.gov/10912892/"}, {"label": "Hanen et al. 2025, Front Bioeng Biotechnol", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC12148905/"}, {"label": "Glassbrook et al. 2017, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/28570490/"}], "visual": {"kind": "bar_path", "lift": "deadlift", "fault": "forward"}, "story": {"type": "poll", "q": "which lift drifts most on your top sets?", "options": [{"label": "squat", "tag": "squat-balance"}, {"label": "deadlift", "tag": "deadlift-bar-path"}, {"label": "never filmed it 😭", "tag": "video-review"}]}}$j$::jsonb),
  -- force-velocity-intent, planned 2026-11-02
  ('force-velocity-intent', '7132cedc34227536489bf876de3dc96c', $l$Your max is supposed to look slow. Your push shouldn't be.

Muscle makes less force the faster it shortens. At a true max you barely out-push the bar's weight, so it can only crawl.

A 1993 study trained 16 people's ankles. One leg tried to move fast against something fixed. The other really moved fast. Same high-speed gains in both. The trying drove it. Small, and an ankle.

In a 2014 study, 20 recreational lifters ran one six-week bench program, every rep as fast as possible or at half speed on purpose. 1RM: up 18% vs 10%. A 2023 review of 24 studies found fast ahead too, but only by a little.

Best read: slowing the way up on purpose costs you a bit. Already pushing every rep? No extra to find.

Westside gave speed its own day. No trial I know of has tested that against other ways to train powerlifters.

Picture the slow spot in a bench as a gap you coast through on the speed built below it. My bet: that's where intent pays. Faster in, further through.

On a grinder, intent means full push from the first inch, not saved for the slow spot, never eased off. Tempo work aside, the load sets how fast it can go. You set the push.$l$, $j${"key": "force-velocity-intent", "track": "strength", "title": "Slow bar, full push", "tags": ["intent", "bar-speed", "adaptation", "cues"], "refs": [{"label": "Behm & Sale 1993, J Appl Physiol", "url": "https://doi.org/10.1152/jappl.1993.74.1.359"}, {"label": "González-Badillo et al. 2014, Eur J Sport Sci", "url": "https://pubmed.ncbi.nlm.nih.gov/24734902/"}, {"label": "Hermes & Fry 2023, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/37494124/"}, {"label": "Westside Barbell: The WSBB guide to dynamic effort training", "url": "https://www.westside-barbell.com/a/blog/the-wsbb-guide-to-dynamic-effort-training"}], "visual": {"kind": "force_velocity"}, "story": {"type": "poll", "q": "be honest. do your warm-ups get a full push?", "options": [{"label": "every rep"}, {"label": "only the heavy ones", "tag": "intent"}, {"label": "never thought about it", "tag": "intent"}]}}$j$::jsonb),
  -- methods-unilateral-work, planned 2026-10-29
  ('methods-unilateral-work', '3fdabe74a5dad01d49e607df4ea5cc53', $l$Your squat drifts to one side. That doesn't mean the other leg is weak.

A 2018 review of 18 studies tied left-right strength gaps to worse jumping, kicking and cycling. All correlation, no trials.

Which leg tests weaker flips too: in soccer players, often between jump tests and over a season.

In squats, a 2007 study of 18 recreational lifters found one side tended to do more at the hip, the other the knee.

My bet: uneven isn't weak, and most drifts start in setup, mobility or habit.

Check in order:
• Pain or old injury there? That first
• Bar centred, hands even, feet measured?
• Film it. There at 60%? Nothing's near its limit. Likely how you move
• Same side near max and in single-leg work, for weeks? A real gap

Then split squats earn a spot: weak side first, match reps. Also after injury, or for leg work easier on your back.

Otherwise they cost time. A 1991 study found weightlifters pushed harder with both legs than the sum of each alone. Untrained people pushed less. A 2022 review found two-leg training builds two-leg strength a bit better. Best read: it's partly a skill.

Send me a vid before you program 5 sets of lunges 👀$l$, $j${"key": "methods-unilateral-work", "track": "methods", "title": "Before you fix your weak side", "tags": ["exercise-selection", "video-review", "asymmetry"], "refs": [{"label": "Bishop, Turner & Read 2018, J Sports Sci", "url": "https://pubmed.ncbi.nlm.nih.gov/28767317/"}, {"label": "Bishop et al. 2020, J Sports Sci", "url": "https://doi.org/10.1080/02640414.2019.1649525"}, {"label": "Bishop et al. 2022, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/32149878/"}, {"label": "Flanagan & Salem 2007, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/18076249/"}, {"label": "Howard & Enoka 1991, J Appl Physiol", "url": "https://journals.physiology.org/doi/abs/10.1152/jappl.1991.70.1.306"}, {"label": "Liao et al. 2022, Biol Sport", "url": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9331349/"}], "story": {"type": "poll", "q": "does your squat drift to one side?", "options": [{"label": "yep, every rep", "tag": "video-review"}, {"label": "only when it's heavy", "tag": "exercise-selection"}, {"label": "not that i've seen"}]}}$j$::jsonb),
  -- recovery-same-muscle, planned 2026-10-27
  ('recovery-same-muscle', '93d328fade84a0b6a5d3c481cd013dfe', $l$Sore doesn't mean you're not recovered. Not sore doesn't mean you are.

A 2002 study had 110 students do 12, 24 or 60 hard lowering reps for their arms. More reps cost more strength and took longer to come back. Soreness when pressed? About the same in every group.

The worst soreness comes from what's new or lowered in a stretch (RDLs, deep lunges). The second time hits far less, even months later. Don't judge a program by week one.

Fatigue is what to track. A 2017 study had 10 trained men squat and bench the same 30 reps, 3x10 to failure or 6x5 stopping halfway. Failure lagged for a day or two. In a 2023 bench study, sets 3 reps short were back in 24 hours. Failure and 1 short were still a bit slow. By 48 hours, all even. Both small.

My test: same warm-up weight and reps every session. Usual speed, usual RPE? Train. Slower, or a full RPE heavier? Back off, sore or not.

It's personal too. In a 1996 study, ten men did the same arm workout and a damage marker in their blood varied over 100-fold.

My take: two days apart, a rep or two short is fine. Same muscle the next day? Stop 3 short. Save failure for before a day off.$l$, $j${"key": "recovery-same-muscle", "track": "hypertrophy", "title": "Judge recovery by the bar, not the ache", "tags": ["recovery", "fatigue", "failure", "soreness", "readiness"], "refs": [{"label": "Nosaka, Newton & Sacco 2002, Scand J Med Sci Sports", "url": "https://pubmed.ncbi.nlm.nih.gov/12453160/"}, {"label": "Nosaka & Sakamoto 2001, Med Sci Sports Exerc", "url": "https://doi.org/10.1097/00005768-200101000-00005"}, {"label": "Nosaka et al. 2001, Med Sci Sports Exerc", "url": "https://pubmed.ncbi.nlm.nih.gov/11528337/"}, {"label": "Morán-Navarro et al. 2017, Eur J Appl Physiol", "url": "https://pubmed.ncbi.nlm.nih.gov/28965198/"}, {"label": "Refalo et al. 2023, Sports Med Open", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC9908800/"}, {"label": "Nosaka & Clarkson 1996, Int J Sports Med", "url": "https://doi.org/10.1055/s-2007-972819"}], "visual": {"kind": "sra"}, "story": {"type": "poll", "q": "how do you know a muscle's ready to go hard again?", "options": [{"label": "if it's not sore", "tag": "soreness"}, {"label": "how my warm-ups move"}, {"label": "i just follow the plan", "tag": "recovery"}]}}$j$::jsonb),
  -- reset-sleep, planned 2026-11-01
  ('reset-sleep', '450fe04876817d452bce02c5a7fdf747', $l$A bad night costs your max less than you think. A bad week is the problem.

A 2022 review of 69 studies on short or no sleep: strength fell about 3% on average, skill tasks about 21%.

A 2018 review found a night with no sleep did little to strength, but short nights in a row can cut force on compound lifts. In a 1994 study, 8 men slept 3 hours a night for 3 nights. Their 20-rep sets dropped from night 2, and their max bench, leg press and deadlift dropped too.

Small studies, mostly men, few lifters. Best read: one short night costs a single a little. A short week costs your reps and your max.

This week, protect the run:
• Same wake time all 7 days. In a 2017 study, students who slept irregularly got about as much sleep, but their body clocks ran 2.5 hours late
• Caffeine done 9 hours before bed. A 2023 review: it cost about 45 minutes of sleep, and the cutoff was 9 hours for a coffee, 13 for a pre-workout. Training at night? Skip the pre
• My take: bedtime alarm 8.5 hours before you wake. Elite athletes in a 2015 study were in bed 11 to 7:15 and slept 6.8 hours

Slept badly anyway? Warm up and judge the bar, not the night.$l$, $j${"key": "reset-sleep", "track": "reset", "title": "Protect the week, not the night", "tags": ["sleep", "recovery"], "refs": [{"label": "Craven et al. 2022, Sports Med", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC9584849/"}, {"label": "Knowles et al. 2018, J Sci Med Sport", "url": "https://pubmed.ncbi.nlm.nih.gov/29422383/"}, {"label": "Reilly & Piercy 1994, Ergonomics", "url": "https://pubmed.ncbi.nlm.nih.gov/8112265/"}, {"label": "Phillips et al. 2017, Sci Rep", "url": "https://doi.org/10.1038/s41598-017-03171-4"}, {"label": "Gardiner et al. 2023, Sleep Med Rev", "url": "https://doi.org/10.1016/j.smrv.2023.101764"}, {"label": "Lastella et al. 2015, Eur J Sport Sci", "url": "https://doi.org/10.1080/17461391.2014.932016"}], "visual": {"kind": "reset", "items": ["Same wake time all 7 days", "Caffeine done 9 hours before bed", "Bedtime alarm 8.5 hours before waking"]}, "story": {"type": "poll", "q": "what messes with your sleep most?", "options": [{"label": "going to bed late", "tag": "sleep"}, {"label": "late caffeine", "tag": "sleep"}, {"label": "waking up at night", "tag": "sleep"}, {"label": "I sleep fine"}]}}$j$::jsonb),
  -- squat-torso-angle-max, planned 2026-10-31
  ('squat-torso-angle-max', '9a7a48fa7a8bd1b528bd61e79b4b0476', $l$Near max, the extra weight goes to your hips. Your knees don't take more.

A 2022 study took 12 trained men to 90%, 100% and a missed 102%. Hip demand climbed, knee demand stayed flat. A 2026 study of 29 elite powerlifters found the same from 70 to 90%, women and men alike. The first wasn't powerlifters, the second stopped at 90%.

Why? My read: more weight at the same knee torque means a shorter knee lever. With the bar over midfoot, that's knees and hips back, chest forward. Lean is how the hips get the extra. Quads maxed, or just the cheaper route? The data can't say.

A 2021 study of recreational lifters found the hips' lever grows and the knees' shrinks as the bar slows, where squats stall.

Long thighs, stiff ankles and low bar add lean. Compare you with you.

Film your opener and top single, same spot.
• A bit more lean, bar over midfoot, back holds: normal. Leave it
• Misses stall with hips up: that spot's your limit. Pause or pin squats just below it
• Bar drifts to your toes or upper back rounds: you're losing the bar. Fix it light

My take: don't force upright in a prep. It hands load back to knees that weren't taking more.$l$, $j${"key": "squat-torso-angle-max", "track": "fix", "title": "Why you lean more on a max squat", "level": "elite", "lift": "squat", "tags": ["squat-torso", "peaking", "sticking-points", "squat-good-morning"], "refs": [{"label": "Larsen et al. 2022, Sports Biomech", "url": "https://doi.org/10.1080/14763141.2022.2085164"}, {"label": "Pürzel et al. 2026, Sci Rep", "url": "https://pubmed.ncbi.nlm.nih.gov/41826687/"}, {"label": "Larsen et al. 2021, Front Sports Act Living", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8217455/"}], "visual": {"kind": "squat_torso", "variant": "lean"}, "story": {"type": "poll", "q": "when a heavy squat stalls, what happens?", "options": [{"label": "hips shoot up", "tag": "squat-good-morning"}, {"label": "stuck in the hole", "tag": "squat-hole"}, {"label": "chest falls forward", "tag": "squat-torso"}, {"label": "never filmed it", "tag": "video-review"}]}}$j$::jsonb),
  -- training-log-review, planned 2026-10-30
  ('training-log-review', 'a0cd9042fea52b34064b418acfab112d', $l$A PR tells you about your best day. Your log tells you about your normal one.

A 2016 review of 138 experiments found checking progress helps you reach goals. More when it's written down, or someone else sees it. They were mostly health goals like weight loss, so it says look, not what to look for.

One day is noisy. A 2020 review found a typical max varied about 4% test to test. A 2022 one found reps-left guesses were off by about a rep on average. One 9 where you planned an 8 means little.

Read 4-8 weeks at a time:
• Same weight, lower RPE. 140x3 at 9, then 8, then 7.5 is strength before a PR
• Top-set e1RM as a line, not dots
• RPE creeping up at the same weights for 2-3 weeks? Usually fatigue building
• More sets, still flat after a lighter week? More may not be the answer
• Sessions done vs planned. 8 of 12? That's the story

Bad week? Check sleep, stress, food, and if it was meant to be hard. My rule: change something only if it repeats.

New? Ask: did I show up, is the weight going up? Years in, progress is slow, so read months.

Send me your last 6 weeks, or show a training buddy. That's the someone-else-sees-it part.$l$, $j${"key": "training-log-review", "track": "mind", "title": "Read your log like a coach", "tags": ["consistency", "rpe", "reflection", "fatigue"], "refs": [{"label": "Harkin et al. 2016, Psychol Bull", "url": "https://doi.org/10.1037/bul0000025"}, {"label": "Grgic et al. 2020, Sports Med Open", "url": "https://pubmed.ncbi.nlm.nih.gov/32681399/"}, {"label": "Halperin et al. 2022, Sports Med", "url": "https://pubmed.ncbi.nlm.nih.gov/34542869/"}], "story": {"type": "poll", "q": "how often do you look back through your log?", "options": [{"label": "every week"}, {"label": "now and then"}, {"label": "never, honestly", "tag": "reflection"}]}}$j$::jsonb),
  -- truth-motivation, planned 2026-10-28
  ('truth-motivation', '4562af1c1cc70d890b27b0508a5f4b02', $l$Almost half the people who mean to exercise don't.

A 2013 review of 10 studies put the gap at 46%. They meant it. It wasn't enough.

Motivation is a bad plan because it's a bad forecast. In a 2011 study people expected to enjoy a workout less than they did, because they pictured the unpleasant start.

Best read: feeling flat beforehand is a prediction, not a verdict.

What carries the flat days is habit. A 2014 study found habit made no difference on days people felt like it. On days they didn't, stronger habits still got them moving. A 2016 study found the habit that mattered most was starting, not the workout itself.

Students and everyday exercisers, not lifters. My bet: it holds under a bar too.

So decide once, not every morning:
• Same days and times, written down. In a 2002 study a motivational message raised intentions, not exercise. Adding when and where did
• Flat day? Warm up and do your first exercise, then decide

Missed one? One miss didn't undo a habit in a 2010 study.$l$, $j${"key": "truth-motivation", "track": "truth", "title": "Motivated people skip too", "tags": ["consistency", "mindset", "motivation"], "refs": [{"label": "Rhodes & de Bruijn 2013, Br J Health Psychol", "url": "https://doi.org/10.1111/bjhp.12032"}, {"label": "Ruby et al. 2011, Health Psychol", "url": "https://doi.org/10.1037/a0021859"}, {"label": "Rebar et al. 2014, J Sport Exerc Psychol", "url": "https://pure.psu.edu/en/publications/habits-predict-physical-activity-on-days-when-intentions-are-weak/"}, {"label": "Phillips & Gardner 2016, Health Psychol", "url": "https://doi.org/10.1037/hea0000249"}, {"label": "Milne, Orbell & Sheeran 2002, Br J Health Psychol", "url": "https://pubmed.ncbi.nlm.nih.gov/14596707/"}, {"label": "Lally et al. 2010, Eur J Soc Psychol", "url": "https://doi.org/10.1002/ejsp.674"}], "visual": {"kind": "truth", "belief": "I'll train when I feel motivated", "truth": "On the days you don't feel like it, habit gets you there. Motivation won't."}, "story": {"type": "poll", "q": "on a day you don't feel like it, you…", "options": [{"label": "go anyway", "tag": "consistency"}, {"label": "start, then decide", "tag": "consistency"}, {"label": "skip it", "tag": "motivation"}]}}$j$::jsonb)
)
UPDATE public.community_series_items i
   SET body = v.body,
       data = i.data || v.data,
       updated_at = now()
  FROM v
 WHERE i.series = 'lesson'
   AND i.data->>'key' = v.key
   AND md5(i.body) = v.seeded_md5
   AND coalesce(i.use_count, 0) = 0;
