-- The coach's lesson library: 77 lessons across the five lesson days.
--
--   Mon strength 13 · Tue hypertrophy 13 · Thu methods 11 · Fri mind 13
--   Sat Technique & Troubleshooting 27 (squat, bench, deadlift × beginner,
--   advanced, elite: problem → why → fix → when it applies)
--
-- Written in the coach's voice; every study named in a lesson is in its refs
-- (checked against its published record), and lessons are worded as things
-- to understand, not changes to anyone's program. Inserted once per key: a
-- lesson the coach has since edited is never overwritten. sort_order only
-- sets which go first; after that the planner rotates by use.
INSERT INTO public.community_series_items (series, mentor, body, data, sort_order) VALUES
  ('lesson', $m$fix$m$, $l$heels coming up or tipping onto your toes at the bottom?

usually its one of these
• ankles that dont bend enough yet, so your weight rolls forward
• a stance or toe angle that fights your hips. a bit wider or more toe out helps some people, not everyone
• starting the squat by shoving the knees forward instead of sitting down between your feet

try this
• keep the bar over the middle of your foot the whole way down
• feel the whole foot on the floor, heel included
• slow 3 sec goblet squats to learn where balance is

lifting shoes can help too. a 2017 study (Legg & co) found people used less ankle bend and more knee bend squatting in them

only when you rush the way down? thats control, not mobility. heel pain or just one side, tell me before you change stuff$l$, $j${"key": "squat-heels-lift", "track": "fix", "title": "Heels coming up in the squat", "level": "beginner", "lift": "squat", "tags": ["squat-balance", "mobility"], "visual": {"kind": "bar_path", "lift": "squat", "fault": "forward"}, "refs": [{"label": "Legg et al. 2017, J Sports Sci 35(5):508-515", "url": "https://research.stmarys.ac.uk/id/eprint/1142"}], "story": {"type": "poll", "q": "ever get your heels coming up when you squat?", "options": [{"label": "yeah a lot", "tag": "squat-balance"}, {"label": "only when its heavy", "tag": "squat-balance"}, {"label": "nope"}]}}$j$::jsonb, 4),
  ('lesson', $m$fix$m$, $l$feel tight at the top then go soft at the bottom?

thats a brace leaking. usually one of these
• the breath goes into your chest & shoulders instead of your belly, sides and back
• you let a little air out on the way down
• you relax in the hole to get a bounce

a belt gives you something to push against, it doesnt brace for you

try this
• big breath and brace before every rep, belly out into the belt like youre about to get punched
• hold it down and through the hardest part, breathe at the top
• 2 sec pause squats. lose it in the pause, youll lose it in the squat

a little hip tuck right at the bottom is normal for most people. if it grows as the weight climbs send me a vid. blood pressure or heart stuff? check with your doctor before long breath holds

drop the cue that clicked for you 👇$l$, $j${"key": "squat-brace-bottom", "track": "fix", "title": "Losing tightness in the bottom of the squat", "level": "beginner", "lift": "squat", "tags": ["bracing", "squat-hole"], "refs": [], "story": {"type": "question", "q": "whats the one bracing cue that actually works for you?"}}$j$::jsonb, 101),
  ('lesson', $m$fix$m$, $l$think youre hitting depth? the camera might disagree

why it happens
• thighs feel parallel way before youre actually deep. in comp the top of your thigh at the hip crease has to drop below the top of your knee, lower than most people think
• filming from the front or from above makes high squats look deep
• as the weight climbs a lot of people cut depth without noticing

try this
• film from the side at about hip height. thats the angle depth is easiest to judge from
• hit the same depth on every rep, warmups too. a high warmup wont turn into a deep single
• pause squats at depth so you learn what legal actually feels like

if you dont compete, depth is a training choice not a rule. and if your program has box or pin squats in it for a reason, keep doing them$l$, $j${"key": "squat-depth-check", "track": "fix", "title": "Is your squat actually deep enough?", "level": "beginner", "lift": "squat", "tags": ["squat-depth", "video-review", "meet-day"], "refs": [], "story": {"type": "poll", "q": "do you film your squats from the side?", "options": [{"label": "every top set", "tag": "video-review"}, {"label": "sometimes", "tag": "video-review"}, {"label": "never tbh"}]}}$j$::jsonb, 102),
  ('lesson', $m$fix$m$, $l$hips shoot up first and your squat turns into a good morning?

why it happens
• quads are the limiter. tipping forward shifts work off the knees onto the hips & back
• the upper back softens, the bar rolls forward and the chest follows
• or its your build. long thighs + short torso need more lean, thats not a fault

some hip rise is normal, especially low bar. the hips rising while the bar barely moves is what costs you

what helps
• push your upper back up into the bar, hips and chest rise together
• pause or 3 sec tempo squats so you own the bottom without the bounce
• front squat or high bar way behind your comp squat? quads might be it, and quad work beats any cue

only on the last grinder of a set? thats fatigue, not technique. dont force a more upright squat on your own, it changes everything. send me a vid if this is you$l$, $j${"key": "squat-good-morning", "track": "fix", "title": "Hips shooting up out of the hole", "level": "advanced", "lift": "squat", "tags": ["squat-hole", "squat-torso"], "visual": {"kind": "squat_torso"}, "refs": []}$j$::jsonb, 103),
  ('lesson', $m$fix$m$, $l$bar flies out of the hole then dies a few inches above parallel?

thats the sticking region and almost everyone has one. a 2021 study (Larsen & co) on 3RM squats found that right there the torso leaned more, the hips took a bigger share of the work and force into the floor dipped. a tough spot mechanically, not a mystery

which one is it
• positions change there? hips shoot, chest drops, bar drifts forward. thats technical
• bar just slows while everything looks the same? usually strength

what helps
• technical: pause right at that height on the way up, or tempo squats
• strength: more heavy-ish practice and time. pin squats from there can help, just dont expect magic

only on the last rep of a hard set? normal fatigue. we can figure out which one it is before you change anything 🤝$l$, $j${"key": "squat-sticking-above-parallel", "track": "fix", "title": "Stalling just above parallel", "level": "advanced", "lift": "squat", "tags": ["squat-hole", "strength-curves"], "visual": {"kind": "sticking_point", "lift": "squat"}, "refs": [{"label": "Larsen, Kristiansen & van den Tillaar 2021, Front Sports Act Living 3:691459", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8217455/"}], "story": {"type": "poll", "q": "where do your squats usually slow down?", "options": [{"label": "right out of the hole", "tag": "squat-hole"}, {"label": "a few inches up", "tag": "strength-curves"}, {"label": "near the top"}]}}$j$::jsonb, 104),
  ('lesson', $m$fix$m$, $l$knees caving in as you come out of the hole on heavy sets?

not automatically a fault. a small quick knee shift that comes back out by mid range is really common in strong lifters, and plenty squat big pain free with it

worth working on when
• it gets worse rep to rep or set to set
• its one knee only, or the hips shift with it
• it hurts, or shows up on light sets too

causes vary. stance or toe angle not suiting your hips, ankle range, losing position when tired. weak glutes get blamed for everything but its rarely that simple

try this
• spread the floor with your feet, knees follow the toes
• tempo or pause squats at the weight where it starts
• bands round the knees are popular but the research on them is honestly mixed

pain free, even and comes back out? leave it. send me a side and front vid before chasing it 👀$l$, $j${"key": "squat-knee-cave", "track": "fix", "title": "Knees caving on heavy squats", "level": "advanced", "lift": "squat", "tags": ["squat-knees"], "refs": [{"label": "Forman et al. 2023, Int J Sports Phys Ther 18(5):1206-1217", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC10547095/"}]}$j$::jsonb, 105),
  ('lesson', $m$fix$m$, $l$at 95%+ a few degrees of extra lean can turn a make into a miss

with the bar over midfoot, more lean moves your hips further behind it, so more of the job lands on the hips & back. a 2022 study (Larsen & co) took lifters from 90% to 100% to a missed 102%. hip demand climbed with the load, knee demand stayed about the same

a lean that costs nothing at 85% can push the hips past their limit on a max single. sometimes the lean is the cause, sometimes its your body working around tired quads

what to check
• opener vs top single, same camera spot. compare torso angle at the sticking point
• same descent speed every single, rushing the bottom can set up the pitch
• RPE 8-9 singles in training with your exact platform cue

some extra lean near max is normal and might be your strongest pattern. forcing a more upright squat late in a prep often costs more than it gives. ask me first$l$, $j${"key": "squat-torso-angle-max", "track": "fix", "title": "Small torso angle changes at max loads", "level": "elite", "lift": "squat", "tags": ["squat-torso", "peaking"], "visual": {"kind": "squat_torso"}, "refs": [{"label": "Larsen et al. 2022, Sports Biomech", "url": "https://nordopen.nord.no/nord-xmlui/handle/11250/3050067"}]}$j$::jsonb, 3),
  ('lesson', $m$fix$m$, $l$how much of your max are you spending before the squat even starts?

a long walkout, shuffling feet and standing there half braced waiting for the command all cost tightness under a weight you can barely hold

why it happens
• no set walkout, so every attempt looks a bit different
• rack height off, so you half squat it out or tiptoe it up
• rushing, or relaxing when the command is slow

try this
• same walkout every single time. usually 2 or 3 steps, back, out, set
• brace before you unrack and stay braced. in IPF style meets you dont get the squat call till youre still with your knees locked
• practice commands on heavy singles. have someone call squat and rack so a slow call doesnt throw you

rules differ a bit between feds so check yours. and if your walkout already works, dont rebuild it the month before a meet$l$, $j${"key": "squat-walkout-commands", "track": "fix", "title": "Wasted energy in the walkout", "level": "elite", "lift": "squat", "tags": ["squat-setup", "meet-day"], "refs": [], "story": {"type": "poll", "q": "how many steps is your squat walkout?", "options": [{"label": "3 or less", "tag": "squat-setup"}, {"label": "more than 3", "tag": "squat-setup"}, {"label": "never counted"}]}}$j$::jsonb, 107),
  ('lesson', $m$fix$m$, $l$bar sliding down your back on heavy singles but not on lighter sets?

thats a load dependent change. a low bar sits on a shelf your upper back makes, and under more weight that shelf can soften. as the bar slips you lean more to keep it over midfoot, and your wrists & elbows end up holding weight

usually its one of these
• bar a bit too low, or a slightly different spot set to set
• upper back not packed tight before the unrack
• slippy shirt, no chalk

try this
• squeeze the bar down into your back, same spot every set, warmups included
• a grip that keeps your upper back tight without wrecking your elbows. thats individual
• chalk your shirt where the bar sits

only slides on the last grinder of a big set? thats fatigue. and dont move your bar position near a meet without talking to me, it changes the whole squat$l$, $j${"key": "squat-bar-slip", "track": "fix", "title": "Bar sliding down your back when heavy", "level": "elite", "lift": "squat", "tags": ["squat-setup", "fatigue"], "refs": []}$j$::jsonb, 108),
  ('lesson', $m$fix$m$, $l$bar landing somewhere different on your chest every rep?

usually its one of these. you never picked a spot, so every rep is a guess. your elbows tuck one rep & flare the next, and where the elbows go pretty much decides where the bar lands. or your upper back shifts between reps so your chest moves too

what helps
• pick a target & aim the bar there every rep. lower chest around the bottom of the sternum is a good starting point for a lot of people
• lower your lighter sets slower, like 2-3 sec down, so you can feel where it lands
• film from the side. feel lies on this one

an inch of difference between reps is normal. if its only the last grindy rep thats fatigue not technique. and the right spot isnt the same for everyone, so if we already set yours up a certain way stick with it$l$, $j${"key": "bench-touch-point-inconsistent", "track": "fix", "title": "Bar touching a different spot every rep", "level": "beginner", "lift": "bench", "tags": ["bench-touch", "video-review"], "visual": {"kind": "bar_path", "lift": "bench", "fault": "none"}, "refs": [], "story": {"type": "poll", "q": "does your bar touch the same spot every rep?", "options": [{"label": "yeah pretty much"}, {"label": "honestly no idea", "tag": "bench-touch"}, {"label": "nope its all over", "tag": "bench-touch"}]}}$j$::jsonb, 5),
  ('lesson', $m$fix$m$, $l$butt popping off the bench when it gets heavy?

usually thats leg drive done wrong, not a lack of it. leg drive on bench isnt pushing your hips UP, its pushing yourself back along the bench so your upper back stays wedged

why it happens
• you push the floor straight down, so the only place your hips can go is up
• feet tucked way back with heels up can make it easier to do
• building the arch by lifting the hips instead of the chest

what helps
• push like youre sliding yourself back toward the rack, not lifting your hips
• move your feet to where pushing doesnt lift you, often a bit further forward
• light sets where the only goal is your butt staying on the pad

in IPF style meets your head, shoulders & butt have to stay on the bench so this is a red light. foot position is personal tho, so check with me before moving yours$l$, $j${"key": "bench-butt-off-bench", "track": "fix", "title": "Butt coming off the bench", "level": "beginner", "lift": "bench", "tags": ["bench-leg-drive", "bench-setup"], "refs": [{"label": "IPF Technical Rulebook 2026 (effective 1 March 2026), Bench Press", "url": "https://www.powerlifting.sport/fileadmin/ipf/data/rules/technical-rules/english/2026_IPF_Technical_Rulebook__effective_01_March_2026__v3.pdf"}], "story": {"type": "poll", "q": "ever had your butt come up on a heavy bench?", "options": [{"label": "yeah 💀", "tag": "bench-leg-drive"}, {"label": "nah never"}, {"label": "never checked", "tag": "bench-leg-drive"}]}}$j$::jsonb, 110),
  ('lesson', $m$fix$m$, $l$shoulders rolling forward a few reps into the set?

it shows up at the shoulders but the cause is usually somewhere else
• the unrack. pressing the bar UP out of the hooks pulls your shoulder blades off the bench before rep 1
• reaching at the top. pushing past lockout toward the ceiling every rep slowly unpins you
• no tightness built before the bar moves

try this
• set your upper back first, shoulder blades down & back. then pull the bar out over your shoulders instead of pressing it out
• each rep is done when your elbows lock. no reaching
• take a handoff on heavy sets if someone knows how to give one

some shoulder blade movement is normal, especially touch n go & on dumbbells. if your shoulders get cranky or you cant get into a big squeeze, dont force it. send me a vid before you rebuild your setup 👀$l$, $j${"key": "bench-shoulders-rolling-forward", "track": "fix", "title": "Shoulders rolling forward on bench", "level": "beginner", "lift": "bench", "tags": ["bench-setup"], "refs": []}$j$::jsonb, 111),
  ('lesson', $m$fix$m$, $l$bar slows halfway up & your whole position falls apart?

some slowdown there is normal. a 1989 study on elite powerlifters (Elliott & co) described it as a gap between the help from the stretch at the bottom & the better leverages higher up. a 2012 study (van den Tillaar & co) pointed mostly at the weak position itself

the problem is what you do in it. elbows flare early, bar drifts toward your feet, shoulders come off the bench. you look for an easier spot & find a worse one

what helps
• keep your forearms under the bar until its past the slow spot
• think push yourself away from the bar
• pause where it usually slows to practice holding position there

if it only shows up on true max grinders thats probably just where your strength runs out. if your position breaks at RPE 7 its more likely technique. ask me before adding new variations$l$, $j${"key": "bench-midrange-position", "track": "fix", "title": "Losing position in the mid-range", "level": "advanced", "lift": "bench", "tags": ["bench-midrange", "bar-path"], "visual": {"kind": "sticking_point", "lift": "bench"}, "refs": [{"label": "Elliott, Wilson & Kerr 1989, Med Sci Sports Exerc", "url": "https://pubmed.ncbi.nlm.nih.gov/2779404/"}, {"label": "van den Tillaar, Saeterbakken & Ettema 2012, J Sports Sci", "url": "https://www.semanticscholar.org/paper/Is-the-occurrence-of-the-sticking-region-the-result-Tillaar-Saeterbakken/5f2ac62e007a69e1d662505323708480e65f0eca"}], "story": {"type": "poll", "q": "whats usually your biggest bench issue?", "options": [{"label": "Off the chest", "tag": "bench-off-chest"}, {"label": "Mid-range", "tag": "bench-midrange"}, {"label": "Lockout", "tag": "bench-lockout"}]}}$j$::jsonb, 2),
  ('lesson', $m$fix$m$, $l$touch n go flies but paused reps die right off the chest?

part of that is just the stretch. lowering the bar right before you press helps, and a pause bleeds some of that off. in a 2013 study (van den Tillaar & Ettema) lifters pressing from a dead stop at the bottom, no lowering at all, handled noticeably less than with a normal touch. a comp pause lands somewhere in between

the part you can fix is the pause itself. people relax on the chest, the bar sinks in, the arch softens & the press starts loose

what helps
• touch, dont rest. keep the weight in your hands, not on your chest
• give the comp pause regular practice, even just on rep 1 of each set
• longer 2-3 sec pauses on lighter sets to get comfy at the bottom

some gap between paused & touch n go is normal. if you dont compete, touch n go is fine. if your program has pauses set a certain way, run it as written$l$, $j${"key": "bench-weak-after-pause", "track": "fix", "title": "Weak off the chest after the pause", "level": "advanced", "lift": "bench", "tags": ["bench-off-chest", "bench-pause"], "refs": [{"label": "van den Tillaar & Ettema 2013, J Hum Kinet", "url": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3827767/"}]}$j$::jsonb, 113),
  ('lesson', $m$fix$m$, $l$bench dies 2 inches from lockout? its not always triceps

usually its one of these
• it slowed down way earlier. a lot of lockout misses are really mid-range misses, the bar just ran out of speed up top
• the bar drifts toward your feet. finishing over your chest instead of back over your shoulders keeps the bar further from the shoulder joint, so the top gets harder to finish
• your shoulders unpin or your grip isnt centered, so one arm finishes first

what helps
• film from the side & look where the bar actually slows, not where it stopped
• once its off the chest, think push the bar back toward the rack
• check your hands are even using the rings

if the top end really is the weak part, then yeah lockout work makes sense. just dont assume it. send me a side vid of your next heavy single & ill tell you which one it is$l$, $j${"key": "bench-lockout-stall", "track": "fix", "title": "Bench stalling near lockout", "level": "advanced", "lift": "bench", "tags": ["bench-lockout", "bar-path"], "visual": {"kind": "bar_path", "lift": "bench", "fault": "forward"}, "refs": []}$j$::jsonb, 114),
  ('lesson', $m$fix$m$, $l$there isnt one correct touch point. it has to fit how youre built

the anchor is forearms roughly stacked under the bar at the bottom, seen from the side. so touch point & elbows move together. a lower touch usually means more tuck, a higher touch more flare

how your build shifts it
• long arms = more distance to press. a wider grip & a bigger arch can win some of that back
• a deep rib cage already shortens the press, so you might need less arch or grip width
• a bigger arch tilts the lower chest back toward your shoulders, so a lower touch usually doesnt put the bar as far from them

the mistake at this level is copying someone elses setup. a better position on paper can cost you kilos for months while you relearn it. test changes off-season over weeks, with video, bar speed & me. never mid prep

anyone moved their touch point & had it click? 🤔$l$, $j${"key": "bench-touch-elbows-build", "track": "fix", "title": "Touch point & elbows for your build", "level": "elite", "lift": "bench", "tags": ["bench-touch", "bench-setup"], "visual": {"kind": "bench_touch"}, "refs": []}$j$::jsonb, 115),
  ('lesson', $m$fix$m$, $l$bar dips a tiny bit right as you hear press? refs see that

under IPF style rules the bar has to be motionless on your chest before the ref says press. sinking or heaving it after that to help the press is a red light, so is pressing early

why it happens
• the bar was resting on your chest, so on the command you sink it to re-tighten or grab a mini bounce
• youre reacting to a rhythm from training, not the voice
• the bar keeps settling after touch so the ref waits & you lose tightness

what helps
• touch & freeze. control the last few inches so it stops dead on contact. the command usually comes quicker
• have someone call press at random, sometimes instant, sometimes 2 sec
• film at chest height from the side. you usually cant feel a 1cm dip

comp lifters only, and refs vary a bit. if your pause already gets whites, dont change it near a meet without asking me$l$, $j${"key": "bench-sink-on-command", "track": "fix", "title": "Sinking the bar on the press command", "level": "elite", "lift": "bench", "tags": ["bench-pause", "meet-day"], "refs": [{"label": "IPF Technical Rulebook 2026 (effective 1 March 2026), Bench Press", "url": "https://www.powerlifting.sport/fileadmin/ipf/data/rules/technical-rules/english/2026_IPF_Technical_Rulebook__effective_01_March_2026__v3.pdf"}], "story": {"type": "question", "q": "whats your cue for the comp pause?"}}$j$::jsonb, 116),
  ('lesson', $m$fix$m$, $l$your bar path at 95% looks nothing like your warmups?

super common. a 2025 systematic review (Bakhshinejad & co, 22 studies on experienced lifters) found that as load goes up the bar slows, the press takes longer & joint movement gets more variable, especially around the sticking region. lifters also seem to adapt in different ways

so the question isnt did it change. its did it change in a way that costs you
• worth fixing: losing your touch point, butt or shoulders coming off, bar drifting toward your feet
• maybe leave it: a bit more flare late or a slightly different path that keeps moving. that can be your body finding a stronger spot

what helps
• film top singles & warmups from the same side angle
• practice heavy singles around RPE 8-9 so the heavy version gets reps too

dont force your 60% path onto a max. if a change looks big, we decide it together$l$, $j${"key": "bench-path-changes-heavy", "track": "fix", "title": "Bar path changing at max loads", "level": "elite", "lift": "bench", "tags": ["bar-path", "video-review"], "refs": [{"label": "Bakhshinejad et al. 2025, Sports Med Open", "url": "https://pubmed.ncbi.nlm.nih.gov/41085612/"}], "story": {"type": "poll", "q": "ever filmed your top single next to your warmups?", "options": [{"label": "yeah all the time"}, {"label": "no but i should", "tag": "video-review"}, {"label": "never thought of it", "tag": "video-review"}]}}$j$::jsonb, 117),
  ('lesson', $m$fix$m$, $l$hips shoot up & the bar still hasnt left the floor? 👀

super common. hips rise, bar sits there, then it turns into a stiff leg deadlift.

the hips usually arent the real problem
• you set up lower than you can pull from. if your shoulders start behind the bar, your hips tend to rise until they arent
• no tension before the pull, so the hips move before the bar does
• last reps of a hard set, mostly fatigue

what helps
• film from the side. where your hips are when the bar breaks is your real start, so set up there
• pull the slack out so bar & hips move together
• "push the floor away" & keep your back angle the same til the bar passes your knees

short arms or long legs for your height usually means higher hips. thats your build, not a fault. big setup changes, show me a vid first$l$, $j${"key": "deadlift-hips-shoot-up", "track": "fix", "title": "Hips shooting up before the bar moves", "level": "beginner", "lift": "deadlift", "tags": ["deadlift-hips", "deadlift-setup"], "visual": {"kind": "deadlift_start", "fault": "hips_low"}, "refs": [], "story": {"type": "poll", "q": "anyone notice their hips shooting up first on deadlifts?", "options": [{"label": "Yeah", "tag": "deadlift-hips"}, {"label": "Not really"}]}}$j$::jsonb, 1),
  ('lesson', $m$fix$m$, $l$ripping the bar off the floor feels strong. its usually not

a loaded bar has some play. it bends a touch & the plates sit loose on the sleeves. pull from loose arms & that slack gets taken up mid pull with a jolt, which is often when the back rounds or the hips pop up.

usually its trying to be explosive, setting up loose & hoping speed fixes it, or nerves on a heavy one.

try this
• pull the slack out first. pull up til the bar clicks against the plates & feels heavy, then push
• breathe & brace before that slack pull, not after
• squeeze it off the floor. once youre tight, fast is fine

if it only happens on touch n go reps, slow them down or reset each one. & if your program has you on a dynamic start that pulls clean, keep it$l$, $j${"key": "deadlift-jerk-slack", "track": "fix", "title": "Jerking the bar off the floor", "level": "beginner", "lift": "deadlift", "tags": ["deadlift-floor", "deadlift-setup", "bracing"], "refs": []}$j$::jsonb, 119),
  ('lesson', $m$fix$m$, $l$grip going before your back & legs do? usually very fixable

a lot of grip fails arent a strength problem
• the bar sits mid palm & rolls down into your fingers under load, so your hand opens
• no chalk, or a sweaty bar
• a long setup, holding the bar for ages before you pull

try this
• set the bar low in the hand, near where your fingers start. it ends up there anyway
• chalk on every heavy set
• pick one heavy grip (hook or mixed) & use it on warmups too, so a top set isnt the first time. on mixed keep the underhand arm straight, dont curl it

straps are fine on high rep sets & RDLs to save your grip, theyre just not allowed on the platform. if your program has straps on certain sets, thats on purpose$l$, $j${"key": "deadlift-grip-failing", "track": "fix", "title": "Grip giving out on heavy pulls", "level": "beginner", "lift": "deadlift", "tags": ["deadlift-grip"], "refs": [], "story": {"type": "poll", "q": "does your grip give out before your back & legs do?", "options": [{"label": "All the time", "tag": "deadlift-grip"}, {"label": "Sometimes", "tag": "deadlift-grip"}, {"label": "Never"}]}}$j$::jsonb, 120),
  ('lesson', $m$fix$m$, $l$bar drifting off your legs mid pull? same weight, harder lift

the further the bar gets in front of your midfoot, the longer the moment arm on your hips & back. your balance tips toward your toes too.

the drift is usually a symptom
• bar starting over your toes, not midfoot
• hips shooting up, so your shoulders swing out front & the bar follows
• knees still forward as the bar comes up so it goes around them. in sumo its often knees caving

try this
• bar over midfoot, close enough to touch your shins once your knees bend
• "drag it up your legs"
• paused deadlifts just below the knee. holding a pause with the bar out front is really hard, so they teach balance

a little wiggle is normal. if it only drifts on the last rep or a max, thats more fatigue than setup. send me a side vid before you rebuild anything 👊$l$, $j${"key": "deadlift-bar-drift-forward", "track": "fix", "title": "Bar drifting forward during the pull", "level": "advanced", "lift": "deadlift", "tags": ["deadlift-bar-path", "deadlift-setup"], "visual": {"kind": "bar_path", "lift": "deadlift", "fault": "forward"}, "refs": []}$j$::jsonb, 6),
  ('lesson', $m$fix$m$, $l$slow off the floor or slow at the knees? different fix

off the floor its often setup first. hips too low, slack still in, bar too far out. if the position looks good & its still slow, its more likely strength in that range. lots of sumo pullers live here.

at the knees is sneakier. plenty of "lockout problems" start at the floor. if your hips shot up or the bar drifted, you reach the knee in a worse spot & stall. the stall shows up late, the cause was early.

what helps
• film from the side. compare your position at the knee on a slow rep vs a fast warmup. different = fix the floor first
• same position, just slower = strength in that range. paused pulls or deficits low, paused pulls at the knee higher up
• every max slows somewhere. its only a weak point if its the same spot week after week

ask me before adding accessories off this$l$, $j${"key": "deadlift-slow-floor-vs-knees", "track": "fix", "title": "Slow off the floor vs slow at the knees", "level": "advanced", "lift": "deadlift", "tags": ["deadlift-floor", "deadlift-lockout"], "visual": {"kind": "sticking_point", "lift": "deadlift"}, "refs": [], "story": {"type": "poll", "q": "where do your heavy pulls usually slow down?", "options": [{"label": "Off the floor", "tag": "deadlift-floor"}, {"label": "Around the knees", "tag": "deadlift-lockout"}, {"label": "Near lockout", "tag": "deadlift-lockout"}, {"label": "No idea tbh", "tag": "video-review"}]}}$j$::jsonb, 122),
  ('lesson', $m$fix$m$, $l$sumo doesnt mean squatting the bar up

a lot of sumo pullers drop their hips as low as they go cause it feels upright & strong. then the hips rise before the bar moves, or the knees end up forward & the bar goes around them.

usually its one of these
• hips set lower than where they are when the bar actually breaks
• knees drifting forward or caving instead of staying out over the toes
• a stance wider or more turned out than your hips are built for. hip sockets vary a lot, you cant always stretch into it

try this
• film it & set your hips at break-off height, not as low as they go
• shins near vertical, knees out over your toes before the pull. think "spread the floor"
• knees still in the way? small width or toe angle tweaks, one at a time & with me

higher hip sumo is fine if the bar moves well. upright isnt the goal, a strong pull is$l$, $j${"key": "deadlift-sumo-hips-low", "track": "fix", "title": "Sumo: hips too low, knees in the way", "level": "advanced", "lift": "deadlift", "tags": ["deadlift-sumo", "deadlift-hips"], "refs": [], "story": {"type": "poll", "q": "sumo or conventional for you?", "options": [{"label": "Sumo", "tag": "deadlift-sumo"}, {"label": "Conventional"}, {"label": "Still figuring it out", "tag": "deadlift-sumo"}]}}$j$::jsonb, 123),
  ('lesson', $m$fix$m$, $l$a faster setup only helps if the bar still breaks the floor as hard

at this level its mostly about wasted steps. hip bounces, re-gripping, sitting in the bottom holding your breath. each can cost time, grip & brace. but cut the steps that build tension (slack, lats, brace) & the pull gets weaker.

a small 2018 pilot (Edington & co, 10 lifters, isometric pulls) put the bar closer vs further over the foot. joint angles & which muscles worked harder changed, total force into the floor didnt. so a position tweak might just move the work around.

what helps
• same sequence every rep, warmup to max. grip, breath, wedge, go
• a little hip drop to wedge in is fine. sitting way below where the bar breaks is just more to undo
• test changes on heavy singles over weeks, not warmups

breaks fast & looks the same every time? leave it. no new start inside a peak either. whats your setup sequence? 👇$l$, $j${"key": "deadlift-start-efficiency", "track": "fix", "title": "A more efficient start without losing force", "level": "elite", "lift": "deadlift", "tags": ["deadlift-setup", "deadlift-floor"], "refs": [{"label": "Edington et al. 2018, Sports (Basel) 6(3):90", "url": "https://doi.org/10.3390/sports6030090"}]}$j$::jsonb, 124),
  ('lesson', $m$fix$m$, $l$your heaviest singles probably dont start like your warmups

research here is thin. a 2025 review (Bakhshinejad & co) found only 2 studies on how the deadlift changes with heavier loads or fatigue in experienced lifters.

so nobody can tell you exactly what should change at max. some shift is common, question is if it costs you.

what to look for
• film every heavy single from the side, same angle
• compare to a warmup. hips rising before the bar, bar drifting off your legs, upper back rounding more
• if its the same change every time, you can train that position. random every time is the real problem

if it still breaks & locks out fast, thats probably just how you pull max loads. if every rep above RPE 9 looks different, lets look at it together first$l$, $j${"key": "deadlift-heavy-single-shift", "track": "fix", "title": "Position changes on heavy singles", "level": "elite", "lift": "deadlift", "tags": ["video-review", "deadlift-setup"], "refs": [{"label": "Bakhshinejad et al. 2025, Sports Med Open 11:115", "url": "https://doi.org/10.1186/s40798-025-00921-x"}], "story": {"type": "poll", "q": "do you actually watch your heavy singles back?", "options": [{"label": "Always", "tag": "video-review"}, {"label": "Sometimes", "tag": "video-review"}, {"label": "Never", "tag": "video-review"}]}}$j$::jsonb, 125),
  ('lesson', $m$fix$m$, $l$a gym lockout & a meet lockout arent the same thing

in the gym nobody red lights a hitch, soft knees or dropping it the second you stand. on the platform all three can.

IPF style rules (most feds are close, check yours): finish tall with knees straight & shoulders back. no downward movement of the bar on the way up, no resting it on your thighs to ramp it. hold still til the down signal & lower it with both hands.

it creeps in because we rarely wait for a down call in training, & on a grinder a hitch is the only way the bar keeps moving.

what helps
• on heavy singles have someone call "down", or hold a full second at the top
• knees locked as your hips come through. shoulders back means upright, not a backbend
• pick attempts you can lock out clean. a hitched gym PR wont count on a platform

not competing soon? dont stress this. anyone ever eaten a red light for it? 💀$l$, $j${"key": "deadlift-comp-lockout", "track": "fix", "title": "Gym lockouts that fail on the platform", "level": "elite", "lift": "deadlift", "tags": ["deadlift-lockout", "meet-day"], "refs": []}$j$::jsonb, 126),
  ('lesson', $m$strength$m$, $l$why does the bar stay over midfoot on every good squat & pull?

its balance. you and the bar act like one system, and that system is balanced when the bar sits over the middle of your foot. Mark Rippetoe (Starting Strength) built a whole model around this and honestly it explains a ton

when the bar drifts in front of midfoot, the weight is trying to tip you forward. now your hips & back have to fight that on top of lifting it. thats why a deadlift that swings away from your shins feels way heavier than it should

next time you film a set, picture a line going straight up from midfoot. the bar should ride pretty close to it from start to lockout

a little drift on a heavy rep is normal. its the big, repeatable drifts that cost you$l$, $j${"key": "bar-over-midfoot", "track": "strength", "title": "Why the bar lives over midfoot", "tags": ["bar-path", "squat-balance", "deadlift-bar-path"], "visual": {"kind": "bar_path", "lift": "deadlift", "fault": "forward"}, "refs": [{"label": "Rippetoe, Starting Strength: Basic Barbell Training (book)"}], "story": {"type": "poll", "q": "which lift drifts off midfoot most for you?", "options": [{"label": "squat", "tag": "squat-balance"}, {"label": "deadlift", "tag": "deadlift-bar-path"}, {"label": "never filmed it 😭", "tag": "video-review"}]}}$j$::jsonb, 2),
  ('lesson', $m$strength$m$, $l$why do we squat to get better at squatting? 🧠

your body adapts to exactly what you make it do. theres a name for it: SAID, specific adaptation to imposed demands. strength isnt just muscle. its muscle plus the coordination & practice of that exact movement, at that kind of load

thats why a massive leg press doesnt automatically mean a massive squat, and why the comp lifts never leave your program

it shows up in research too. a 2017 meta-analysis (Schoenfeld & co) found heavier loads built more 1RM strength than light loads, even though muscle growth was about the same. similar muscle, but better at showing it heavy

variations still matter. they build muscle, hit weak spots & give your joints a break. they feed the main lifts, they dont replace them$l$, $j${"key": "specificity-said", "track": "strength", "title": "Why we squat to get better at squatting", "tags": ["exercise-selection", "programming", "adaptation"], "refs": [{"label": "Schoenfeld et al. 2017, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/28834797/"}]}$j$::jsonb, 128),
  ('lesson', $m$strength$m$, $l$ever wonder why your squat looks nothing like someone elses?

its mostly leverages. a moment arm is the horizontal distance between a joint and the bar. longer moment arm = more work for that joint

the bar has to stay over midfoot for you to stay balanced. so if your thighs are long compared to your torso, your hips sit further back to keep it there and your torso leans more. shorter thighs, more upright. bar position, stance & ankle mobility matter too (low bar usually = more lean than high bar)

neither is wrong. more lean shifts more of the work to your hips & back, more upright shifts more to your quads

dont copy a torso angle off someone elses video. what looks off on them might be right for your build

think yours is off? send me a vid before changing anything 👀$l$, $j${"key": "moment-arms-build", "track": "strength", "title": "Why your squat looks different from theirs", "lift": "squat", "tags": ["squat-torso", "squat-balance"], "visual": {"kind": "squat_torso"}, "refs": [], "story": {"type": "poll", "q": "which is your squat closer to?", "options": [{"label": "pretty upright", "tag": "squat-torso"}, {"label": "lots of lean", "tag": "squat-torso"}, {"label": "no clue tbh", "tag": "video-review"}]}}$j$::jsonb, 3),
  ('lesson', $m$strength$m$, $l$you dont get stronger in the gym. you get stronger after it

training is a stress. right after a hard session youre actually a bit weaker. then you recover, and if the stress was big enough your body adapts a little past where you started. stimulus, recovery, adaptation. SRA

how long that takes isnt fixed. a heavy deadlift day or a big volume session usually takes longer to bounce back from than a few crisp bench singles. bigger stimulus, deeper dip, longer recovery

two ways to get it wrong
• too little stimulus: you recover fine but theres nothing to adapt to
• stacking hard sessions before you recover: the dip keeps getting deeper

its a simplified model, real bodies are messier. but it explains a lot about how your training week is laid out$l$, $j${"key": "sra-curve", "track": "strength", "title": "Stimulus, recovery, adaptation", "tags": ["adaptation", "recovery", "programming"], "visual": {"kind": "sra"}, "refs": []}$j$::jsonb, 130),
  ('lesson', $m$strength$m$, $l$ever notice you always miss in the same spot?

thats your sticking point. the force you can produce changes through the range of motion. in the big 3 youre usually strongest near lockout, so the bar slows wherever your leverages are worst

bench is the classic. bar comes off the chest fast, slows a few inches up, then speeds up near lockout. the usual explanation: off the chest you get help from the stretch & initial drive. a few inches up that help is fading but your leverages havent improved yet

that slow spot caps how much you can lift. its where misses happen and where form usually breaks first (Kompf & Arandjelović 2016 review)

next heavy set, notice where the bar slows. useful info for us, not a reason to rewrite your accessories tonight$l$, $j${"key": "sticking-points", "track": "strength", "title": "Why you miss where you miss", "tags": ["strength-curves", "bench-midrange"], "visual": {"kind": "sticking_point", "lift": "bench"}, "refs": [{"label": "Kompf & Arandjelović 2016, Sports Med", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4887540/"}], "story": {"type": "poll", "q": "where do you usually miss bench?", "options": [{"label": "off the chest", "tag": "bench-off-chest"}, {"label": "few inches up", "tag": "bench-midrange"}, {"label": "at lockout", "tag": "bench-lockout"}]}}$j$::jsonb, 4),
  ('lesson', $m$strength$m$, $l$RPE 8 doesnt mean 8/10 hard. it means 2 reps left

the scale we use is built on reps in reserve (RIR). RPE 10 = nothing left. 9 = 1 rep left. 8 = 2 left. 7 = 3 left. half points like 8.5 mean maybe 2, definitely 1

this version came out of strength research around 2016 (Zourdos, Helms & co). older RPE scales rated how hard something felt overall, which is pretty vague mid squat. counting reps left is way more concrete

how to rate it: right after the set ask yourself, if i HAD to, how many more reps could i do with the same technique?

thats your number. not how tired you are, not how hard the warmups felt. just whats left in the tank$l$, $j${"key": "rpe-rir-scale", "track": "strength", "title": "What RPE actually means", "tags": ["rpe", "programming"], "visual": {"kind": "rpe_rir"}, "refs": [{"label": "Zourdos et al. 2016, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/26049792/"}, {"label": "Helms et al. 2016, Strength Cond J", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4961270/"}]}$j$::jsonb, 1),
  ('lesson', $m$strength$m$, $l$a max is supposed to look slow. thats physics, not weakness

muscles have a force-velocity tradeoff. the heavier the load, the slower you can move it. light weight flies, a true max grinds. you cant hit max force and max speed at the same time

but trying to move fast still matters, even when the bar cant. in a 1993 ankle study (Behm & Sale) people pushed explosively against resistance that didnt move at all and got the same fast-speed gains as actually moving fast. a small 2014 bench study (González-Badillo & co) found pressing every rep as fast as possible gave close to double the 1RM gains of pressing at half speed on purpose

so every rep on the way up is a fast rep. not rushed, just pushed hard

tempo work is slow on purpose tho, keep that as written$l$, $j${"key": "force-velocity-intent", "track": "strength", "title": "Heavy is slow, but intent still matters", "tags": ["adaptation", "cues"], "visual": {"kind": "force_velocity"}, "refs": [{"label": "Behm & Sale 1993, J Appl Physiol", "url": "https://pubmed.ncbi.nlm.nih.gov/8444715/"}, {"label": "González-Badillo et al. 2014, Eur J Sport Sci", "url": "https://pubmed.ncbi.nlm.nih.gov/24734902/"}]}$j$::jsonb, 133),
  ('lesson', $m$strength$m$, $l$how does doing less make you lift more?

training gives you two things at once: fitness & fatigue. what you can lift on the day is roughly fitness minus fatigue. thats the fitness-fatigue model, from Banister back in the 70s

fatigue builds fast and clears fast. fitness builds slow and fades slow. so when you pull training back for a bit, fatigue drops off way quicker than fitness, and strength you already built finally shows up

thats a taper before a meet. a deload is a mini version. a 2007 meta-analysis (Bosquet & co, mostly endurance athletes) found the biggest effect from about 2 weeks of cutting volume by roughly 40 to 60% while keeping intensity & frequency the same

pull back too long tho and fitness starts fading too. thats why tapers are short 🏆$l$, $j${"key": "fitness-fatigue-taper", "track": "strength", "title": "Why deloads and tapers make you stronger", "tags": ["peaking", "fatigue", "recovery"], "visual": {"kind": "fitness_fatigue"}, "refs": [{"label": "Bosquet et al. 2007, Med Sci Sports Exerc", "url": "https://pubmed.ncbi.nlm.nih.gov/17762369/"}, {"label": "Travis et al. 2020, Sports (Basel)", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC7552788/"}], "story": {"type": "poll", "q": "ever hit a PR right after a deload?", "options": [{"label": "yeah 🔥", "tag": "peaking"}, {"label": "not yet"}, {"label": "never deloaded 💀", "tag": "fatigue"}]}}$j$::jsonb, 134),
  ('lesson', $m$strength$m$, $l$top set didnt go up this week. did you still progress?

progressive overload just means asking a bit more of your body over time. more weight is the obvious way but its not the only one
• same weight, more reps or more sets
• same weight, lower RPE or faster bar speed
• same weight, better reps: deeper, more consistent, cleaner pauses

a single that was a grind at RPE 9 last month and now moves at RPE 7.5 is real progress. the weight didnt change, you did

the catch: not every session has to beat the last one. your program already plans when to push & when to hold, so judge progress across a block, not one day 📊

anyone had a lift go from grindy to easy without the weight changing?$l$, $j${"key": "progressive-overload-beyond-weight", "track": "strength", "title": "Progress is more than adding weight", "tags": ["programming", "consistency"], "refs": []}$j$::jsonb, 135),
  ('lesson', $m$strength$m$, $l$your RPE 6 is a guess. your RPE 9 is way more accurate

a 2022 meta-analysis (Halperin & co) pooled the studies on predicting reps left. on average people underestimated by about 1 rep, so ngl most of us have a bit more in the tank than we think. calls also got more accurate closer to failure and in sets of 12 reps or fewer

part of it is probably that near failure you have more to go on. the bar slows way down on the last couple reps so you can feel it coming. far from failure every rep feels kinda the same

what that means
• low RPE calls are rough guesses, thats fine
• top sets at 8 to 9 are where your call matters most
• high rep sets are harder to read, expect to be off a bit

curious how close you guys think your calls are 🤔$l$, $j${"key": "rpe-accuracy-near-failure", "track": "strength", "title": "RPE calls get sharper near failure", "tags": ["rpe", "failure"], "visual": {"kind": "velocity_loss"}, "refs": [{"label": "Halperin et al. 2022, Sports Med", "url": "https://doi.org/10.1007/s40279-021-01559-x"}], "story": {"type": "slider", "q": "how accurate do you think your RPE calls are?", "emoji": "🤔"}}$j$::jsonb, 136),
  ('lesson', $m$strength$m$, $l$your warmups and your top set arent quite the same lift

as the load goes up the bar slows, every position gets held longer & your body reorganizes to get it moving. the squat might lean a touch more out of the hole. bench leg drive timing or touch point can shift. deadlift hips might rise a bit first

some of that is normal, even useful. your body is finding where its strongest. some of it is breakdown. telling those apart is what video review is for

two things that help
• film your heavy sets, not just warmups. thats where the real technique is
• set up every warmup like the top set. same stance, grip & brace, so the light reps practice the heavy lift

if something only changes on heavy sets, send it to me before fixing it. might not be a problem at all$l$, $j${"key": "technique-changes-with-load", "track": "strength", "title": "Technique changes as the bar gets heavy", "tags": ["video-review", "warmups"], "refs": [], "story": {"type": "question", "q": "what changes most in your lifts when it gets heavy?"}}$j$::jsonb, 137),
  ('lesson', $m$strength$m$, $l$same weight, totally different feel from one week to the next. why?

your strength on any given day isnt a fixed number. sleep, stress, food, leftover fatigue from the last session all move it. the 1RM on paper is more of a ballpark than a promise

thats why a lot of programming is autoregulated: top sets picked by RPE instead of a fixed %. good day, the weight goes up. rough day, it comes down and you still get good work in

in research, Graham & Cleather (2021) found squatting off reps in reserve gave bigger strength gains over 12 weeks than fixed %, and a 2018 study (Helms & co) found RPE loading might give a small edge. not every study finds a difference tho

a lighter top set on a bad day isnt a failed session. thats the system working 🫡$l$, $j${"key": "daily-strength-varies", "track": "strength", "title": "Why your strength changes day to day", "tags": ["rpe", "programming", "stress"], "refs": [{"label": "Graham & Cleather 2021, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/31009432/"}, {"label": "Helms et al. 2018, Front Physiol", "url": "https://pubmed.ncbi.nlm.nih.gov/29628895/"}], "story": {"type": "poll", "q": "RPE top sets or fixed %?", "options": [{"label": "RPE all day", "tag": "rpe"}, {"label": "fixed %", "tag": "programming"}, {"label": "no preference"}]}}$j$::jsonb, 138),
  ('lesson', $m$strength$m$, $l$lifting a max is a skill, not just a strength test

a single is its own thing. slower bar, more pressure, more nerves, and your positions have to hold the whole way. if meet day is the only time you touch that, youre doing a new skill under max pressure

a 2017 study (Mattocks & co) had one group just practice the 1RM test for 8 weeks while another did 4 sets to failure. strength gains were about the same, the volume group just grew more muscle. small study, untrained people, knee extension & chest press, so dont read too much into it. but it fits the idea that practicing heavy is part of being strong

thats why programs usually build singles in before a meet. not to test, to practice

the singles in your program are placed on purpose tho. this isnt a pass for daily maxing 💀$l$, $j${"key": "heavy-singles-skill", "track": "strength", "title": "Heavy singles are a skill", "tags": ["peaking", "meet-day", "programming"], "refs": [{"label": "Mattocks et al. 2017, Med Sci Sports Exerc", "url": "https://doi.org/10.1249/MSS.0000000000001300"}]}$j$::jsonb, 139),
  ('lesson', $m$hypertrophy$m$, $l$does doing more sets actually build more muscle?

theres a 2017 meta-analysis (Schoenfeld, Ogborn & Krieger, 15 studies) that found yes, up to a point. each extra weekly set per muscle added a little more growth, and groups doing 10+ sets a week grew the most on average

but its not a straight line 📊 later research points to diminishing returns. each set adds less than the one before, while fatigue keeps stacking

why we care as powerlifters: a bigger muscle has more potential to produce force. turning that into a bigger total still takes practice on the lifts

only count HARD sets, warmups dont count. and if your accessories feel like too much or too little, bring it to me before you start piling sets on$l$, $j${"key": "weekly-sets-dose-response", "track": "hypertrophy", "title": "Weekly sets: more helps, up to a point", "tags": ["volume", "hypertrophy", "programming"], "visual": {"kind": "dose_response"}, "refs": [{"label": "Schoenfeld, Ogborn & Krieger 2017, J Sports Sci", "url": "https://doi.org/10.1080/02640414.2016.1210197"}], "story": {"type": "poll", "q": "do you know how many hard sets each muscle gets a week?", "options": [{"label": "yep i count", "tag": "volume"}, {"label": "roughly"}, {"label": "no idea honestly", "tag": "programming"}]}}$j$::jsonb, 140),
  ('lesson', $m$hypertrophy$m$, $l$do you have to hit failure to grow? no, but you need to get close

2 meta-analyses worth knowing:
• Refalo & co (2023) found going all the way to failure wasnt clearly better for growth than stopping a bit short
• Robinson & co (2024) estimated reps in reserve across a ton of studies. growth tended to improve the closer sets ended to failure, while strength gains looked similar across a wide range of RIR

the RIR in those studies was estimated, so the exact numbers are fuzzy. but for growth, accessories ending around 0-3 reps in the tank look like a good zone for most people. sets with 5+ left probably do less

comp lifts are different. we keep those further from failure on purpose for strength, technique & fatigue, so dont start grinding top sets off this 🫡$l$, $j${"key": "failure-proximity-growth", "track": "hypertrophy", "title": "How close to failure for muscle growth?", "tags": ["failure", "rpe", "hypertrophy"], "visual": {"kind": "rpe_rir"}, "refs": [{"label": "Refalo et al. 2023, Sports Med", "url": "https://doi.org/10.1007/s40279-022-01784-y"}, {"label": "Robinson et al. 2024, Sports Med", "url": "https://doi.org/10.1007/s40279-024-02069-2"}], "story": {"type": "slider", "q": "how good are you at guessing your reps in the tank?", "emoji": "🤔"}}$j$::jsonb, 141),
  ('lesson', $m$hypertrophy$m$, $l$same muscle, different exercise, different amount of growth

Maeo & co ran 2 studies where people trained one limb each way for 12 weeks:
• seated leg curls grew the hamstrings more than lying leg curls (about 14% vs 9%)
• overhead cable extensions grew the triceps about 1.4x more than with the arm down by your side

in both, the winner trained the muscle at a longer length. sitting stretches the hamstrings at the hip, overhead stretches the long head of the triceps at the shoulder

why long lengths help isnt fully worked out, and these were small studies mostly in people without much lifting experience. but if youre picking an accessory, the version that loads the stretch is a good bet

anyone actually feel the difference between these? 👀$l$, $j${"key": "long-muscle-length", "track": "hypertrophy", "title": "Train muscles where they are stretched", "tags": ["exercise-selection", "range-of-motion", "hypertrophy"], "visual": {"kind": "length_tension"}, "refs": [{"label": "Maeo et al. 2021, Med Sci Sports Exerc", "url": "https://pubmed.ncbi.nlm.nih.gov/33009197/"}, {"label": "Maeo et al. 2023, Eur J Sport Sci", "url": "https://pubmed.ncbi.nlm.nih.gov/35819335/"}], "story": {"type": "poll", "q": "seated or lying leg curls?", "options": [{"label": "seated", "tag": "exercise-selection"}, {"label": "lying"}, {"label": "whatever is free"}]}}$j$::jsonb, 142),
  ('lesson', $m$hypertrophy$m$, $l$cutting accessory reps short? the bottom half is the part to keep

when partials lose to full range of motion, its usually because they skip the stretched part of the rep

a few studies flipped that. Pedrosa & co (2022, leg extensions) and Kassiano & co (2023, calf raises) found partials in the stretched half grew as much or more than full ROM, and partials in the shortened half grew the least

promising but limited. small studies, mostly untrained people, and newer work in trained lifters mostly finds lengthened partials & full ROM about equal

so full ROM is a safe default. if you go partial, keep the stretched end, and dont trade the bottom of the rep for more weight on the stack

this is accessories only btw. comp lifts still follow comp depth$l$, $j${"key": "full-rom-vs-partials", "track": "hypertrophy", "title": "Full range or partials for growth?", "tags": ["range-of-motion", "hypertrophy", "exercise-selection"], "refs": [{"label": "Pedrosa et al. 2022, Eur J Sport Sci", "url": "https://doi.org/10.1080/17461391.2021.1927199"}, {"label": "Kassiano et al. 2023, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/37015016/"}, {"label": "Wolf et al. 2023, Int J Strength Cond (meta-analysis)", "url": "https://doaj.org/article/99e86b317bec40f5abc2f0008358737e"}, {"label": "Wolf et al. 2025, PeerJ", "url": "https://peerj.com/articles/18904"}]}$j$::jsonb, 143),
  ('lesson', $m$hypertrophy$m$, $l$sets of 20 grow muscle about as well as sets of 5. IF theyre hard

a 2017 meta-analysis (Schoenfeld & co, 21 studies) compared light loads (60% 1RM or less) vs heavy loads, with sets taken to failure. growth came out similar. 1RM strength went up more with heavy loads

the catch is a light set only works when it gets hard. the first 10 reps of a 25 rep set are easy. its the slow grindy reps near the end where it starts to feel like a heavy set

for powerlifters it splits nicely:
• comp lifts stay heavy because 1RM strength is specific
• accessories can live anywhere from about 6 to 20+ reps, whatever you can push close to failure & recover from

your program picks rep ranges on purpose, so take this as the why, not a reason to change them$l$, $j${"key": "light-vs-heavy-growth", "track": "hypertrophy", "title": "Light weights build muscle too", "tags": ["hypertrophy", "failure", "programming"], "visual": {"kind": "velocity_loss"}, "refs": [{"label": "Schoenfeld et al. 2017, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/28834797/"}]}$j$::jsonb, 144),
  ('lesson', $m$hypertrophy$m$, $l$is hitting a muscle 3x a week better than 1x? less than you think

a 2016 meta-analysis (Schoenfeld & co) found training a muscle at least twice a week grew more than once a week

then the 2019 follow-up (Schoenfeld, Grgic & Krieger, 25 studies) split it out. when weekly sets were matched, frequency didnt clearly change growth. the edge mostly showed up when more sessions also meant more total sets

so frequency is mostly a way to spread volume out. 15 sets for one muscle in one day gets sloppy by the end. split over 2-3 days, more of those sets are quality sets

thats part of why powerlifters often squat & bench a few times a week. its more practice on the lift, not just more muscle$l$, $j${"key": "frequency-volume-equated", "track": "hypertrophy", "title": "Train a muscle once or 3 times a week?", "tags": ["programming", "volume", "hypertrophy"], "refs": [{"label": "Schoenfeld, Ogborn & Krieger 2016, Sports Med", "url": "https://pubmed.ncbi.nlm.nih.gov/27102172/"}, {"label": "Schoenfeld, Grgic & Krieger 2019, J Sports Sci", "url": "https://doi.org/10.1080/02640414.2018.1555906"}]}$j$::jsonb, 145),
  ('lesson', $m$hypertrophy$m$, $l$resting 60 sec to keep the pump isnt the growth hack it was sold as

in a 2016 study (Schoenfeld & co) trained guys ran the same 8 week program resting either 1 or 3 min between sets. the 3 min group gained more strength & grew a bit more. probably because longer rests let them keep more reps & weight on the bar each set

a 2024 meta-analysis (Singer & co) found a small edge for resting longer than 60 sec, and not much difference once you go past about 90 sec

so rest long enough that the next set is a real set. for big compounds thats often 2-3+ min, for curls or raises 90 sec is usually plenty

supersets & short rests still have a place when youre short on time. just know you might be giving up a little growth$l$, $j${"key": "rest-periods-growth", "track": "hypertrophy", "title": "Short rests do not build more muscle", "tags": ["hypertrophy", "programming", "volume"], "refs": [{"label": "Schoenfeld et al. 2016, J Strength Cond Res", "url": "https://doi.org/10.1519/JSC.0000000000001272"}, {"label": "Singer et al. 2024, Front Sports Act Living", "url": "https://doi.org/10.3389/fspor.2024.1429789"}]}$j$::jsonb, 146),
  ('lesson', $m$hypertrophy$m$, $l$stuck on the same dumbbells for weeks? add a rep instead

a 2022 study (Plotkin & co) had trained lifters either add weight each week in a set rep range, or keep the weight the same & add reps. after 8 weeks muscle growth was basically identical. strength leaned slightly toward the weight group, but the gap was small

so progress on accessories doesnt have to mean more plates. more reps at the same effort counts. so does the same weight through a bigger range of motion

dumbbells & machine stacks jump in big steps, so reps are honestly the easier lever a lot of the time

what matters is that something in your log moves over a few weeks. if an accessory hasnt budged in a month or two, send it my way & we can figure out why 👊$l$, $j${"key": "accessory-progressive-overload", "track": "hypertrophy", "title": "Progressing accessories without more weight", "tags": ["programming", "hypertrophy", "adaptation"], "refs": [{"label": "Plotkin et al. 2022, PeerJ", "url": "https://pubmed.ncbi.nlm.nih.gov/36199287/"}], "story": {"type": "question", "q": "whats an accessory youve been stuck on forever? 😭"}}$j$::jsonb, 147),
  ('lesson', $m$hypertrophy$m$, $l$machines arent cheating. for growth theyre often the easier option

a 2023 meta-analysis (Haugen & co, 13 studies) compared free weight vs machine training. muscle growth came out similar. strength was specific: free weight training improved free weight tests more, and machines trended the other way

thats the powerlifting takeaway. the barbell builds barbell strength, machines can build the muscle behind it

stability helps for growth work too. on a leg press or chest press youre not spending effort balancing, so its usually easier to take a set close to failure & keep the target muscle doing the work

not every machine fits every body, swap one that feels awkward. and if your program has a free weight accessory in there for a reason, keep it 🤝$l$, $j${"key": "machines-arent-cheating", "track": "hypertrophy", "title": "Machines are not cheating", "tags": ["exercise-selection", "hypertrophy"], "refs": [{"label": "Haugen et al. 2023, BMC Sports Sci Med Rehabil", "url": "https://doi.org/10.1186/s13102-023-00713-4"}], "story": {"type": "poll", "q": "accessories: free weights or machines?", "options": [{"label": "free weights", "tag": "exercise-selection"}, {"label": "machines", "tag": "exercise-selection"}, {"label": "bit of both"}]}}$j$::jsonb, 148),
  ('lesson', $m$hypertrophy$m$, $l$not sore after a session doesnt mean it didnt work

soreness mostly tracks how new or unusual the work was. new exercise, lots of lowering in a stretch, first week back. its why it fades as you get used to a program, even while youre still growing

Flann & co (2011) eased one group into a hard eccentric cycling program so they avoided muscle damage, and threw another group straight in. the thrown in group had way more damage markers & soreness. both gained the same size & strength

so soreness can show up alongside growth, its just not the scoreboard. reps & load creeping up over weeks is the better signal 🧠$l$, $j${"key": "soreness-not-growth-signal", "track": "hypertrophy", "title": "Soreness is not a growth signal", "tags": ["recovery", "hypertrophy", "adaptation"], "refs": [{"label": "Flann et al. 2011, J Exp Biol", "url": "https://pubmed.ncbi.nlm.nih.gov/21270317/"}]}$j$::jsonb, 149),
  ('lesson', $m$hypertrophy$m$, $l$how much protein do you actually need to build muscle?

a 2018 meta-analysis (Morton & co, 49 studies) found lean mass gains from lifting kept improving up to about 1.6 g per kg of bodyweight a day, then flattened out. the uncertainty around that number ran up to about 2.2 g/kg, so aiming somewhere between the two covers most people

thats roughly 0.7 to 1 g per lb. for a 90 kg (198 lb) lifter, about 145 to 200 g a day

going way past that isnt doing much extra for muscle. hitting your daily total most days matters more than stressing about timing or shakes

a lot of coaches lean toward the top end during a cut. and if a dietitian has you on a plan, follow theirs 🙏$l$, $j${"key": "protein-how-much", "track": "hypertrophy", "title": "How much protein do you actually need?", "tags": ["nutrition", "hypertrophy"], "refs": [{"label": "Morton et al. 2018, Br J Sports Med", "url": "https://pubmed.ncbi.nlm.nih.gov/28698222/"}], "story": {"type": "poll", "q": "do you hit your protein most days?", "options": [{"label": "yep", "tag": "nutrition"}, {"label": "like half the time", "tag": "nutrition"}, {"label": "no idea honestly"}]}}$j$::jsonb, 150),
  ('lesson', $m$hypertrophy$m$, $l$how soon can you train the same muscle hard again? it depends

after hard training a muscle dips, recovers, then ideally ends up a little better than before. how long that takes isnt fixed. what usually stretches it out:
• sets taken all the way to failure
• lots of lowering under a stretch (RDLs, deep lunges)
• new exercises or a big jump in volume

Morán-Navarro & co (2017) had trained lifters squat & bench the same total reps either to failure or stopping short. the non failure sessions recovered faster between 24 & 48h

so if a muscle still feels flat & weak when its next session comes around, tell me. the fix might be effort or volume, not just adding rest days$l$, $j${"key": "recovery-same-muscle", "track": "hypertrophy", "title": "When is a muscle ready to train again?", "tags": ["recovery", "fatigue", "failure"], "visual": {"kind": "sra"}, "refs": [{"label": "Morán-Navarro et al. 2017, Eur J Appl Physiol", "url": "https://pubmed.ncbi.nlm.nih.gov/28965198/"}], "story": {"type": "question", "q": "which muscle takes you the longest to bounce back?"}}$j$::jsonb, 151),
  ('lesson', $m$hypertrophy$m$, $l$does cardio kill your gains? way less than gym myths say

a 2022 meta-analysis (Schumann & co, 43 studies) compared lifting alone vs lifting + aerobic training. adding cardio didnt measurably reduce muscle growth or max strength. what it did blunt was explosive strength like jump height, mostly when both were done in the same session

that doesnt make unlimited cardio free. but a few sessions a week probably isnt the problem it gets blamed for, and its good for your health

where it can bite:
• hard leg cardio right before squats or pulls
• so much that it eats into recovery or food

separate days or a few hours apart keeps it out of the way. if youre thinking of adding a lot, tell me first so we can work around it$l$, $j${"key": "cardio-interference", "track": "hypertrophy", "title": "Does cardio kill your gains?", "tags": ["cardio", "hypertrophy", "programming"], "refs": [{"label": "Schumann et al. 2022, Sports Med", "url": "https://researchonline.jcu.edu.au/71546/1/Schumann2021_Article_CompatibilityOfConcurrentAerob.pdf"}]}$j$::jsonb, 152),
  ('lesson', $m$methods$m$, $l$should you think about the muscle or the bar? depends on the lift 🧠

on squat, bench and deadlift, external cues usually win. push the floor away, bar to the same spot. a 2021 meta-analysis (Grgic & co) found people were a little stronger in the moment with an external focus. how big that edge is still gets argued, but it rarely hurts

isolation work is kinda flipped. in a 2018 study (Schoenfeld & co) untrained guys curled focusing either on squeezing the muscle or on moving the weight. the squeeze group grew their arms more (12.4% vs 6.9%). quads grew about the same either way

and muscle focus seems to fade once it gets heavy. an EMG study on bench found it raised muscle activity up to 60% of max, not at 80%

so bar & floor on the big lifts, feel the muscle on curls, raises and flyes$l$, $j${"key": "methods-attentional-focus", "track": "methods", "title": "Muscle focus or bar focus?", "tags": ["cues", "mind-muscle"], "refs": [{"label": "Grgic, Mikulic & Mikulic 2021, Sports (Basel)", "url": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8622562/"}, {"label": "Schoenfeld et al. 2018, Eur J Sport Sci", "url": "https://pubmed.ncbi.nlm.nih.gov/29533715/"}, {"label": "Calatayud et al. 2016, Eur J Appl Physiol", "url": "https://pubmed.ncbi.nlm.nih.gov/26700744/"}], "story": {"type": "question", "q": "whats one cue that actually clicked for you on a big lift?"}}$j$::jsonb, 153),
  ('lesson', $m$methods$m$, $l$short on time but want your accessories to count? try myo-reps

its a rest-pause style set for isolation work
• activation set about 1-2 reps shy of failure, usually 12-20 reps
• rest 3-5 deep breaths, do 3-5 more reps, repeat
• stop once you cant match your first mini set

every mini set lands close to failure, so you get a lot of hard reps without 3 full sets and 3 full rests. an 8 week study in trained guys (Enes & co, 2021) compared rest-pause, drop sets and regular sets and growth came out similar

fits: cables, machines, curls, raises, calves

waste: heavy barbell lifts, or anything where form falls apart when youre tired. short rests there just mean uglier reps

if your accessories are written as straight sets, ask before swapping. anyone actually tried these?$l$, $j${"key": "methods-myo-reps", "track": "methods", "title": "Myo-reps for short sessions", "tags": ["hypertrophy", "failure"], "visual": {"kind": "rpe_rir"}, "refs": [{"label": "Enes et al. 2021, Appl Physiol Nutr Metab", "url": "https://pubmed.ncbi.nlm.nih.gov/34260860/"}], "story": {"type": "poll", "q": "ever tried myo-reps?", "options": [{"label": "yeah, love em", "tag": "hypertrophy"}, {"label": "tried em, hated it 💀"}, {"label": "whats a myo-rep 🤔", "tag": "hypertrophy"}]}}$j$::jsonb, 154),
  ('lesson', $m$methods$m$, $l$drop sets wont build more muscle. but they can save a ton of time

go close to failure, strip about 20-30% of the weight, keep going with no rest. maybe drop once more

two meta-analyses (Coleman & co 2022, Sødal & co 2023) found they grow muscle about as well as regular sets, and in some of the studies they took half to a third of the time 👀

use them on the last set of a machine or isolation exercise when youre short on time

skip them on the main lifts (stripping plates at failure is a mess) and dont put them on every set. they feel brutal and the fatigue adds up

not in your program? one drop on the last set is plenty if you want to try it$l$, $j${"key": "methods-drop-sets", "track": "methods", "title": "Drop sets: similar growth, less time", "tags": ["hypertrophy", "volume"], "refs": [{"label": "Coleman et al. 2022, Int J Strength Cond", "url": "https://doi.org/10.47206/ijsc.v2i1.135"}, {"label": "Sødal et al. 2023, Sports Med Open", "url": "https://pubmed.ncbi.nlm.nih.gov/37523092/"}]}$j$::jsonb, 155),
  ('lesson', $m$methods$m$, $l$want your 90 min sessions closer to 60? pair the right exercises

an agonist-antagonist superset = two exercises for opposite muscles back to back, then rest
• chest supported row + DB bench
• curls + pushdowns
• leg curl + leg extension

one muscle rests while the other works. a 2025 meta-analysis (Zhang & co) found supersets cut session time without costing volume or long term strength and size. opposite-muscle pairs even let people get more reps than straight sets

the catch: they feel harder, and holding two stations in a busy gym is a pain

where they dont belong: heavy squat, bench and deadlift work. those need full rest and full focus, so keep them as straight sets and pair up the accessories after. if you want to restructure a session like this, ask me first$l$, $j${"key": "methods-antagonist-supersets", "track": "methods", "title": "Supersets that dont cost you reps", "tags": ["programming", "hypertrophy"], "refs": [{"label": "Zhang et al. 2025, Sports Med", "url": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12011898/"}], "story": {"type": "poll", "q": "how long do your sessions usually run?", "options": [{"label": "under an hour"}, {"label": "60-90 min"}, {"label": "90+ 💀", "tag": "programming"}]}}$j$::jsonb, 156),
  ('lesson', $m$methods$m$, $l$hit failure on full reps? the bottom half might still have more in it

lengthened partials = reps in just the stretched part of the range. bottom half of a curl, bottom of a leg press, arms-up half of a pulldown

a 2023 meta-analysis (Wolf & co) saw a hint that stretched-position partials might beat full ROM for size, not clear cut tho. a 2025 study in trained lifters (also Wolf & co) trained one arm each way and both grew about the same

as a set extender: take the set to failure with full reps, then grind 3-5 stretched-half reps. more out of the set without adding another. research on doing it after failure is thin, so its a tool not a must

good on machines, cables, curls, calves. skip it on squat, bench and deadlift. partials at failure under a loaded bar is not it 💀$l$, $j${"key": "methods-lengthened-partials", "track": "methods", "title": "Lengthened partials as a set extender", "tags": ["range-of-motion", "hypertrophy", "failure"], "refs": [{"label": "Wolf et al. 2023, Int J Strength Cond", "url": "https://doi.org/10.47206/ijsc.v3i1.182"}, {"label": "Wolf et al. 2025, PeerJ", "url": "https://peerj.com/articles/18904"}]}$j$::jsonb, 157),
  ('lesson', $m$methods$m$, $l$do slower reps build more muscle? not really, not past a point

a 2015 meta-analysis (Schoenfeld & co) found similar growth with reps lasting anywhere from about half a second to 8 seconds. really slow reps (10+ sec) looked worse, probably because you have to go way lighter, but theres not much data there

controlling the eccentric is still useful
• same position every rep, so technique stays consistent
• no bouncing out of the bottom on RDLs, curls or flyes
• makes a light weight harder when thats all you have

it just wont double your gains because you went from 2 sec down to 4

default: control it down, lift with intent. if your program has a 3 sec down on squats or a long pause on bench, thats for position and technique, so keep it$l$, $j${"key": "methods-eccentric-tempo", "track": "methods", "title": "Slow eccentrics arent magic", "tags": ["tempo", "hypertrophy"], "refs": [{"label": "Schoenfeld, Ogborn & Krieger 2015, Sports Med", "url": "https://pubmed.ncbi.nlm.nih.gov/25601394/"}]}$j$::jsonb, 158),
  ('lesson', $m$methods$m$, $l$cheat reps get roasted but ngl theres a time and place 🤣

a cheat rep = a bit of body english to get the weight through the hard part, then a slow controlled lowering. think a small swing out of the bottom of a curl

fine when
• its the last 1-3 reps of curls, laterals or rows
• youve already hit failure with clean reps
• the lowering stays strict

a waste when
• youre swinging from rep 1. thats just a weight thats too heavy
• it throws your back or shoulders into a bad spot
• its squat, bench or deadlift. theres no cheat rep there, just a bad rep

the cheat should help the muscle finish the set, not do the set for it$l$, $j${"key": "methods-cheat-reps", "track": "methods", "title": "When cheat reps are actually fine", "tags": ["failure", "hypertrophy"], "refs": [], "story": {"type": "slider", "q": "how much do you cheat on curls? be honest", "emoji": "🤣"}}$j$::jsonb, 159),
  ('lesson', $m$methods$m$, $l$one side always feels weaker? heres where single-side work fits

split squats, single leg RDLs, one arm rows and DB press make each side do its own work. on a barbell the stronger side can quietly take more of the load

• start each set with the weaker side
• match those reps on the strong side, no extras
• keep it after the main lifts

reality check: a small left-right difference is normal for basically everyone. a 2018 review (Bishop & co) found the research linking it to worse performance is all associations, no trials testing it

and a hip shift or uneven lockout isnt always a strength problem. could be setup, mobility, foot position or habit. if your squat drifts to one side, send me a vid before you program 5 sets of lunges for it 👀$l$, $j${"key": "methods-unilateral-work", "track": "methods", "title": "Single-side work for imbalances", "tags": ["exercise-selection", "video-review"], "refs": [{"label": "Bishop, Turner & Read 2018, J Sports Sci", "url": "https://pubmed.ncbi.nlm.nih.gov/28767317/"}], "story": {"type": "poll", "q": "got a side that always feels weaker?", "options": [{"label": "yeah, a lot", "tag": "exercise-selection"}, {"label": "a little"}, {"label": "not really"}]}}$j$::jsonb, 160),
  ('lesson', $m$methods$m$, $l$intensity techniques arent free. lifters pay for them on squat day

drop sets, rest-pause, failure sets on leg press. performance is roughly fitness minus fatigue, and these add a lot of fatigue for a small extra stimulus

• Morán-Navarro & co (2017): sets to failure took longer to recover from than non-failure sets with the same total reps, with the gap showing over the next 1-2 days
• Robinson & co (2024): strength gains barely changed with how close to failure people trained. growth improved a bit closer to failure

so imo for strength, failure buys very little and costs a lot of recovery

if you use them: isolation only, last set only, and first to go if your main lifts feel flat or a meet is close. if your block has them, thats on purpose, run it as written$l$, $j${"key": "methods-intensity-techniques-fatigue", "track": "methods", "title": "Intensity techniques arent free", "tags": ["fatigue", "failure", "recovery"], "visual": {"kind": "fitness_fatigue"}, "refs": [{"label": "Morán-Navarro et al. 2017, Eur J Appl Physiol", "url": "https://pubmed.ncbi.nlm.nih.gov/28965198/"}, {"label": "Robinson et al. 2024, Sports Med", "url": "https://link.springer.com/article/10.1007/s40279-024-02069-2"}]}$j$::jsonb, 161),
  ('lesson', $m$methods$m$, $l$why does rep 5 of a heavy set look so different from rep 1?

bar speed drops through a set as fatigue builds, so the last reps are the slowest and usually the ugliest

cluster sets put short rests inside the set. instead of a straight 5 near your 5RM, you could do 5 singles with 15-30 sec between, or 2+2+1

Latella & co (2019 meta-analysis) found clusters kept bar speed and power up better within the session. long term, Davies & co (2021) found strength and size gains about the same either way

so its a quality tool, not a strength hack. handy for technique work with heavier weight, or when you want every rep to look like rep 1. less useful for size or when time is tight

if your program says straight sets, stick with straight sets 🤝$l$, $j${"key": "methods-cluster-sets", "track": "methods", "title": "Cluster sets for heavy reps", "tags": ["fatigue", "programming"], "visual": {"kind": "velocity_loss"}, "refs": [{"label": "Latella et al. 2019, Sports Med", "url": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6851217/"}, {"label": "Davies et al. 2021, Sports Med", "url": "https://pubmed.ncbi.nlm.nih.gov/33475986/"}]}$j$::jsonb, 162),
  ('lesson', $m$methods$m$, $l$if your warm-ups are tiring you out, theyre not warm-ups anymore

warm-up sets have one job: practice the movement and get you ready for the heavy set. not add volume

a simple ramp, as a % of your top set: bar x 5-10, ~40% x 5, ~60% x 3, ~75% x 2, ~85-90% x 1, then go

the pattern is jumps get smaller and reps drop as the weight climbs. by the last couple youre doing singles or doubles, not sets of 5

common mistakes
• sets of 8-10 once youre past 70%
• a pile of tiny jumps right under your working weight
• 30 sec after your heaviest warm-up then straight into the top set. give that one a real rest

a heavy single usually wants a step or two more than a moderate day. and if your program lists specific warm-ups, use those 🫡$l$, $j${"key": "methods-warmup-sets", "track": "methods", "title": "Warm-up sets that dont waste energy", "tags": ["warmups"], "refs": [], "story": {"type": "question", "q": "how many warm-up sets do you take before a heavy squat?"}}$j$::jsonb, 163),
  ('lesson', $m$mind$m$, $l$stanford asked its basketball team to spend 10 hours a night in bed 👀

in a 2011 study (Mah & co) 11 players kept their normal sleep for a few weeks, then aimed for 10+ hours in bed a night for 5-7 weeks. they ended up sleeping almost 2 hours more per night

by the end their sprints were faster, free throws & 3s both improved about 9%, and reaction time and mood got better

big caveats tho. 11 guys, one team, no control group, and they knew what was being tested. promising, not proof that sleep alone did it

you probably dont need 10 hours. but if youre living on 6, more sleep is about the cheapest recovery tool there is. easiest start: same wake up time, bedtime 20-30 min earlier$l$, $j${"key": "sleep-extension-basketball", "track": "mind", "title": "What extra sleep did for a basketball team", "tags": ["sleep", "recovery", "research"], "refs": [{"label": "Mah et al. 2011, Sleep", "url": "https://pubmed.ncbi.nlm.nih.gov/21731144/"}], "story": {"type": "poll", "q": "how much do you actually sleep on a normal night?", "options": [{"label": "under 6h", "tag": "sleep"}, {"label": "6-7h", "tag": "sleep"}, {"label": "7-8h"}, {"label": "8h+"}]}}$j$::jsonb, 1),
  ('lesson', $m$mind$m$, $l$what you say in your head before a rep matters. a little 🧠

a 2011 meta-analysis (Hatzigeorgiadis & co, 32 studies) found self-talk improved performance by a moderate amount on average

the catch: it helped most on precise skills & stuff people were still learning. on big well-learned movements the effect was smaller. so it wont add 20kg to a squat youve done a thousand times

2 kinds
• instructional: a cue, like chest up or push the floor
• motivational: lets go, you got this

studies where people practiced their self-talk beforehand got better results than ones where they didnt. so pick ONE short phrase and use it on every top set until its automatic

whats yours? drop it below 👇$l$, $j${"key": "self-talk-what-helps", "track": "mind", "title": "Self-talk that actually helps", "tags": ["psychology", "cues"], "refs": [{"label": "Hatzigeorgiadis et al. 2011, Perspect Psychol Sci", "url": "https://pubmed.ncbi.nlm.nih.gov/26167788/"}], "story": {"type": "question", "q": "whats the one thing you say to yourself before a heavy rep?"}}$j$::jsonb, 165),
  ('lesson', $m$mind$m$, $l$a deload doesnt make you stronger. it lets you show what you built

in the classic fitness-fatigue model hard training builds both. fatigue fades faster when you back off, so a lighter week lets performance come back without losing much fitness 📊

what research has so far
• a 2024 survey (Rogerson & co) of 246 strength & physique athletes: all of them deload, roughly every 5-6 weeks for about a week, mostly to manage fatigue
• an early trial (Coleman & co 2024, 39 young adults) gave one group a full week OFF mid program. muscle growth was the same, the group that kept training came out ahead on leg strength

so a week of nothing isnt magic. a deload is lighter training: fewer sets, more reps in the tank, same lifts. its often a mental reset too

if one is in your plan, its there for a reason$l$, $j${"key": "deload-what-it-does", "track": "mind", "title": "What a deload actually does", "tags": ["fatigue", "recovery", "programming"], "visual": {"kind": "fitness_fatigue"}, "refs": [{"label": "Rogerson et al. 2024, Sports Med Open", "url": "https://pubmed.ncbi.nlm.nih.gov/38499934/"}, {"label": "Coleman et al. 2024, PeerJ", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/"}], "story": {"type": "slider", "q": "how cooked do you feel by deload week?", "emoji": "💀"}}$j$::jsonb, 166),
  ('lesson', $m$mind$m$, $l$athletes got stronger on fake steroids. old study, wild result 💀

in 1972 Ariel & Saville told 15 varsity athletes some of them would get a steroid. the 6 picked got placebo pills instead and gained more in 3 of 4 lifts than in the weeks before

caveats: tiny, 50+ years old, and compared to their own earlier weeks, not a real control group. dont trust the exact numbers

a 2000 study (Maganaris & co) found something similar in competitive powerlifters on fake steroids. when half were told the truth midway, their extra gains mostly faded. the ones still in the dark kept them

the takeaway isnt go find sugar pills. its that belief changes how hard you push, and its why supplement studies need placebo groups

a routine you trust & reps youve already hit are how you build that belief for real$l$, $j${"key": "placebo-fake-steroids", "track": "mind", "title": "The steroid study where nobody got steroids", "tags": ["psychology", "research"], "refs": [{"label": "Ariel & Saville 1972, Med Sci Sports", "url": "https://www.doping.nl/filter/doc:7382/"}, {"label": "Maganaris, Collins & Sharp 2000, Sport Psychologist", "url": "https://e-space.mmu.ac.uk/13266/"}]}$j$::jsonb, 167),
  ('lesson', $m$mind$m$, $l$a total goal is great. its just not the goal that gets you there

3 types
• outcome: win, place, hit a total
• performance: a 5kg squat PR
• process: stuff fully in your control. pause every first bench rep, hit every planned session, in bed by 11

a 2022 meta-analysis (Williamson & co, 27 studies in sport) found process goals had the biggest effect on performance, performance goals a smaller one, and outcome goals barely any. 27 studies split 3 ways isnt a ton, so its a lean, not a law

outcome goals still matter. they tell you where youre headed. process goals are what you actually do on a random tuesday

keep the big goal. write 2-3 process goals under it for this block$l$, $j${"key": "process-vs-outcome-goals", "track": "mind", "title": "Process goals vs outcome goals", "tags": ["motivation", "psychology", "consistency"], "refs": [{"label": "Williamson et al. 2022, Int Rev Sport Exerc Psychol", "url": "https://doi.org/10.1080/1750984X.2022.2116723"}]}$j$::jsonb, 168),
  ('lesson', $m$mind$m$, $l$caffeine is one of the few supplements with real evidence for lifting

a 2018 meta-analysis (Grgic & co) found a small boost to 1RM strength & jump power, clearer for upper body than lower. a 2019 umbrella review of 21 meta-analyses backed it for strength, muscular endurance & power, with bigger effects for endurance

small is the key word. nice bonus, not a new you

what the ISSN position stand says
• 3-6 mg per kg bodyweight, most commonly about an hour before
• as little as 2 mg/kg might work
• big doses like 9 mg/kg mostly just add side effects

some people get jittery or anxious, and late caffeine can wreck sleep. heart stuff or pregnant? skip it & ask your doctor

and dont try a new dose for the first time on meet day$l$, $j${"key": "caffeine-for-lifting", "track": "mind", "title": "Caffeine before lifting: what we know", "tags": ["nutrition", "research"], "refs": [{"label": "Grgic et al. 2018, J Int Soc Sports Nutr", "url": "https://pubmed.ncbi.nlm.nih.gov/29527137/"}, {"label": "Grgic et al. 2019, Br J Sports Med (umbrella review)", "url": "https://pubmed.ncbi.nlm.nih.gov/30926628/"}, {"label": "Guest et al. 2021, ISSN position stand, J Int Soc Sports Nutr", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC7777221/"}], "story": {"type": "poll", "q": "what do you usually have before lifting?", "options": [{"label": "coffee", "tag": "nutrition"}, {"label": "pre-workout", "tag": "nutrition"}, {"label": "nothing"}]}}$j$::jsonb, 169),
  ('lesson', $m$mind$m$, $l$the platform makes your brain overthink a lift it already knows

one well-known explanation for choking: pressure makes you consciously control movements that normally run on autopilot. running 6 thoughts through a squat youve done 1000 times rarely helps

a pre-lift routine gives your attention a job. a 2021 meta-analysis (Rupprecht & co) found routines improved performance in experiments, including under pressure. most routine research is skill sports, not lifting, but the idea carries over

build yours in training, not on meet day
• same steps every time: chalk, walk up, hands, breath
• one cue, not five
• short. most feds give you about a minute to start the attempt

automatic on top sets by peak week = there when youre nervous$l$, $j${"key": "meet-day-pre-lift-routine", "track": "mind", "title": "Why a pre-lift routine helps under pressure", "tags": ["meet-day", "psychology"], "refs": [{"label": "Rupprecht, Tran & Gröpel 2021, Int Rev Sport Exerc Psychol", "url": "https://doi.org/10.1080/1750984X.2021.1944271"}], "story": {"type": "poll", "q": "do you have a set routine before heavy lifts?", "options": [{"label": "yep every time", "tag": "meet-day"}, {"label": "kinda"}, {"label": "nope just send it", "tag": "meet-day"}]}}$j$::jsonb, 2),
  ('lesson', $m$mind$m$, $l$exams, work chaos, a breakup. your training notices

a 2008 study (Bartholomew & co) followed 135 students through 12 weeks of lifting classes. those reporting less life stress gained more on squat & bench than the high stress group

thats a correlation, not proof. stressed people might also sleep less or miss more sessions. but small follow-ups (Stults-Kolehmainen & co) linked higher stress to slower strength recovery after hard sessions, in the first hour and over the next 4 days

a lot of coaches think of recovery as one budget that gym & life stress both draw from. simplified, but useful

in a rough week
• one bad session doesnt mean you got weaker
• showing up still counts
• tell me. we can adjust the week instead of you grinding through it$l$, $j${"key": "life-stress-and-gains", "track": "mind", "title": "Stress outside the gym and your progress", "tags": ["stress", "recovery"], "visual": {"kind": "sra"}, "refs": [{"label": "Bartholomew et al. 2008, J Strength Cond Res", "url": "https://pure.psu.edu/en/publications/strength-gains-after-resistance-training-the-effect-of-stressful-/"}, {"label": "Stults-Kolehmainen & Bartholomew 2012, Med Sci Sports Exerc", "url": "https://pubmed.ncbi.nlm.nih.gov/22688829/"}, {"label": "Stults-Kolehmainen et al. 2014, J Strength Cond Res", "url": "https://pubmed.ncbi.nlm.nih.gov/24343323/"}]}$j$::jsonb, 171),
  ('lesson', $m$mind$m$, $l$can just picturing a lift make you stronger? kinda

a 2018 meta-analysis (Paravlic & co, 13 studies, 370 people) found imagery-only training moderately improved max strength compared to doing nothing. real training still beat it

so imagery is a bonus, not a replacement. the authors suggested it as a tool for times you cant train at full intensity

where it fits for us: rehearsing meet day. the walkout, the commands, your setup, the grind if the rep slows down

make it as real as you can
• same speed as the actual lift
• picture the real place, the bar, the brace
• include the hard part, not just the lockout

a few minutes a day in the weeks before a meet is a good start$l$, $j${"key": "imagery-and-strength", "track": "mind", "title": "Can picturing a lift make you stronger?", "tags": ["psychology", "meet-day"], "refs": [{"label": "Paravlic et al. 2018, Sports Med", "url": "https://link.springer.com/article/10.1007/s40279-018-0874-8"}]}$j$::jsonb, 172),
  ('lesson', $m$mind$m$, $l$logging your sets is half of it. reading them back is the other half 📊

a 2016 meta-analysis (Harkin & co, 138 studies, about 20k people) found that getting people to track their progress helped them reach their goals, more so when it was written down or shared. most were health goals, not lifting, but its the same habit

for lifting, log the RPE, not just the weight. 140 for 3 at RPE 7 and 140 for 3 at RPE 9.5 are very different days

once a month, scroll back 4-8 weeks
• same weight, lower RPE = probably stronger, even without a PR
• sessions done vs planned. consistency explains a lot
• bad weeks: what else was going on? sleep, stress, food

its all sitting in the app waiting for you to look$l$, $j${"key": "training-log-review", "track": "mind", "title": "Why rereading your training log helps", "tags": ["consistency", "rpe", "experiments"], "visual": {"kind": "rpe_rir"}, "refs": [{"label": "Harkin et al. 2016, Psychol Bull", "url": "https://doi.org/10.1037/bul0000025"}]}$j$::jsonb, 173),
  ('lesson', $m$mind$m$, $l$how hyped should you be before a max? depends on you

the classic picture is the inverted-U. too flat = slow, too amped = sloppy, the middle = best. handy model, but its not a law and the research behind it is messy

whats better supported: psyching up before a max effort often helps. a 2024 review (Cusimano & co, 27 studies) found it improved max force in about 65% of trials. lots of that research used students & newer lifters tho, so the effect in experienced lifters is less clear

the right amount is personal. some people lift best loud, some lift best calm

too amped usually looks like a rushed setup, losing tightness, missing commands. too flat looks like the bar feeling heavy before you even unrack

curious where you guys land 👇$l$, $j${"key": "psych-up-arousal", "track": "mind", "title": "How hyped should you be for a max?", "tags": ["psychology", "meet-day"], "refs": [{"label": "Cusimano et al. 2024, Strength Cond J", "url": "https://repository.essex.ac.uk/36831/"}, {"label": "Tod, Iredale & Gill 2003, Sports Med", "url": "https://doi.org/10.2165/00007256-200333010-00004"}], "story": {"type": "poll", "q": "before a heavy single youre usually…", "options": [{"label": "full hype mode", "tag": "psychology"}, {"label": "calm & locked in", "tag": "psychology"}, {"label": "depends on the day"}]}}$j$::jsonb, 174),
  ('lesson', $m$mind$m$, $l$want to know if something works for YOU? test one thing at a time

change 5 things at once (new pre-workout, new bedtime, new warmup) and you cant tell what did it

how to run it
• pick ONE variable. bedtime, caffeine timing, a warmup tweak, a pre-lift routine
• decide what youll track first: top set RPE, bar speed, a 1-5 energy score
• 2 weeks as normal for a baseline, then 4 weeks with the change
• compare averages, not your best day

single sessions swing with sleep, food & stress. one great day is noise, a trend over weeks is info. you also know what youre testing, so expectations sneak in. a hint, not proof. still beats guessing

anything touching your sets, reps or exercises we set up together first

what would you test? 👇$l$, $j${"key": "run-a-training-experiment", "track": "mind", "title": "How to run a training experiment on yourself", "tags": ["experiments", "consistency"], "refs": [], "story": {"type": "question", "q": "what would you want to test on yourself?"}}$j$::jsonb, 175),
  ('lesson', $m$mind$m$, $l$slept like 4 hours before meet day? dont panic yet

a 2022 meta-analysis (Craven & co, 69 studies) looked at nights of 6 hours or less. on average strength dropped around 3%, skill stuff like accuracy around 20%. studies varied a lot so take the numbers loosely

an earlier review on lifting (Knowles & co 2018) found one night of no sleep barely touched strength in most studies. several short nights in a row were more likely to cut into big compound lifts

so one rough night might cost a little and make warmups feel heavier. short sleep stacking up all week is the bigger problem

on the day: normal warmups, normal caffeine, stick to the plan. if something feels off tell me in the warmup room and we adjust there$l$, $j${"key": "bad-sleep-before-meet", "track": "mind", "title": "A bad night of sleep before a big day", "tags": ["sleep", "meet-day"], "refs": [{"label": "Craven et al. 2022, Sports Med", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC9584849/"}, {"label": "Knowles et al. 2018, J Sci Med Sport", "url": "https://pubmed.ncbi.nlm.nih.gov/29422383/"}]}$j$::jsonb, 176)
ON CONFLICT ((data->>'key')) WHERE series = 'lesson' DO NOTHING;
