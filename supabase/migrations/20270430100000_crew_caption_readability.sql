-- Crew captions that read on a phone (Nov 21 2026): the automated captions already in the feed that
-- went out as one block (lessons, Tuesday tips, Monday Motivation, Finish Strong Friday, Saturday Spirit),
-- and the deck captions in the library that haven't gone out yet, rewritten by hand in short paragraphs
-- with the opening line on its own, filler and repeated kickers cut. Every fact, number, study and opinion
-- is kept; nothing is added. Captions only: each post keeps its id, date, likes, comments, views and slides,
-- and nothing moves in the feed (no updated_at, no edited_at). A post is changed only while its caption
-- (and a library deck only while its caption) is still exactly the text it was read as (md5), so anything
-- the coach changed since stays his. Members' own posts and comments are never touched.
-- Every old caption is kept in community_caption_readability_backup (server only); rollback:
-- docs/rollback/2026-11-21-crew-caption-readability-rollback.sql

CREATE TABLE IF NOT EXISTS public.community_caption_readability_backup (
  kind text NOT NULL CHECK (kind IN ('post', 'item')),
  target_id uuid NOT NULL,
  before text NOT NULL,
  after text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, target_id)
);
ALTER TABLE public.community_caption_readability_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_caption_readability_backup FROM anon, authenticated;

-- the posts already in the feed
WITH v(id, old_md5, caption) AS (VALUES
('1cfd4da0-473d-4f5e-aba2-ec95abd91c03'::uuid, 'f8314661583ca5d5c45553f10f20059b', 'Changing your cue every heavy set is like changing your setup every heavy set.

If you want it to show up when the bar gets heavy, use it in normal training first.

Decide it before you’re fired up, not when the top set is already loaded.'),
('bd829920-02dd-4705-b1cc-2a275c0bd6ce'::uuid, '8bdb9d8f40e35324d1a23ec3f106205f', 'Perfect conditions are a bad requirement for training.

If the gym doesn’t match the spreadsheet, make the closest useful swap and keep the session going.

The only real miss is letting a busy gym talk you into doing nothing.'),
('91d63de2-1fa3-4d8b-98aa-257ce35dfeeb'::uuid, 'a33aa60604b2b3e2e6b2ab8c6442d94f', 'The shake isn’t the magic trick.

I see lifters stress over the post workout window, then end the day nowhere near their target.

If a dietitian gave you numbers, use those. If not, pick the range and make hitting it boring.'),
('3ff46edf-df38-4706-9f74-ecd01ba6834f'::uuid, 'e14964ecb290c1129d80cf7c05dedfb7', '75% doesn’t need a full rehearsal.

Once the bar is moving fine, you’ve got what you need from it, so stop collecting extra reps.

If your program gives you exact warm-ups, run them as written instead of turning the ramp into another workout.'),
('27e8a3b1-45cc-4b7a-9918-7a5cddbd0254'::uuid, '44540522251a741ee12db217be1faabb', 'Bar feels heavier than it should? Don’t start rewriting the whole block in your head.

Sleep, stress, food and work can all make a normal session feel ugly.

Write it in your log while you still remember it, then give the trend time to say something useful.'),
('82622995-9f16-4c04-934f-b98d8999096d'::uuid, '6b9c39b843b150c9497d09ad90a7b99a', 'Most taper mistakes are overcorrections.

Some lifters keep all the work because they’re scared their strength will disappear. Others back off so long that fitness starts leaking too.

Keep the heavy lifts familiar, trim what piles up fatigue, and don’t turn a short taper into time off.'),
('34d0b12a-ce58-4e88-9fac-c373c7ff8bed'::uuid, '66de0045d2839068365d0cd29d703d8e', 'I’d use clusters when technique is the priority and fatigue is turning the last couple reps into a different lift.

If the extra rest just becomes permission to add weight and grind anyway, you missed the point.

Keep the load honest and make the reps match.'),
('06884af6-45ee-4dfa-89b1-ef22d1f2347b'::uuid, 'bce149ede8574d5919a70c5a936cb631', 'Meet prep shows this fast.

The lifter who trains best is usually the one who can hit the next heavy day with some pop.

If a set turns the rest of your day into damage control, that wasn’t toughness. It was bad timing.'),
('925ff152-5be7-4884-8789-7740292681cf'::uuid, '4fe04e6be2c924cf28ddbabbc337eb24', 'Random warm-up jumps make RPE way noisier than it needs to be.

I’m not trying to turn training into a spreadsheet ritual. I want the early sets to tell you whether today is normal, cooked or worth pushing, before the real work starts.'),
('8b07db4c-0032-4ec2-b8ad-e63a89c0b4d5'::uuid, '89a882b915d6e20606494ab406db4e4b', 'Where I see this go wrong is lifters being patient off the chest, then turning it on at the hard part.

That just gives the rep less time with full intent behind it.

Heavy bench this week? Every rep that isn’t tempo work is an attempt to launch the bar, even when the plates make it look boring.'),
('1ae5b60b-c5b2-4010-a764-787fb568da3a'::uuid, 'bd2f27b99f93e96f588db1a56c4beb0e', 'Padding the log is easy.

Add a few clean, comfortable sets and you can convince yourself the work went up.

Sometimes it did. Sometimes you just got better at avoiding the reps that would actually make you adapt.'),
('8beb1d60-dd75-486a-9ddc-e9171b9d4aff'::uuid, 'c82e57c795fab6f4fc9ea1c94a2c78f0', 'Friday is a bad day to audition for confidence.

When the work is done, close the log. Don’t sneak in a single because training felt too normal.

The block works when you can stack weeks you recover from.'),
('70df2c7b-8251-4cbe-9aec-32a7be8d1c8d'::uuid, '8868eb93c657cd80a9509d51d053ea91', 'I don’t add weak side work off one ugly rep.

If your squat shifts on a top single but your feet were set differently and the bar was crooked, more accessories won’t fix it.

Clean up the setup, film some lighter work, then decide. Split squats come in when the case is actually built.'),
('9544b57f-7149-4f69-8d73-6a7051ff0eef'::uuid, 'd4106d019f038ecf6a7954eba6492b45', 'Renegotiating your training time every day is how your mood ends up coaching you.

Injured or sick? Different conversation.

Just flat? I’d keep the appointment, get under the bar for the first lift, and make the call once you’ve got better information.'),
('ed0b9260-9eba-4245-93db-ac58655eab6e'::uuid, '10c5fa6bb0a3618e3530a4a0e1602bad', 'A sore chest can still press fine. A chest that feels great can still have slow bar speed.

This week, keep one repeatable warm-up in your log and use it as a readiness check.

The point isn’t to dodge hard work. It’s to stop letting DOMS write the program.'),
('e25e4495-128d-4b51-93b7-2b4014e4fa60'::uuid, '009de1dcd910ea9b663c39b9ee05255d', 'A cue isn’t a personality trait.

Try it before the weight gets distracting. If your hips do more and your knees stop caving in, cool.

If it just gives you one more thing to think about, bin it.'),
('7f5a419d-905c-45c8-be4c-61fca5a59f05'::uuid, '865f49eafe4c606d76cb34fc9a424d3a', 'Not every side video is a technique emergency.

If your warm-ups swing a bit but your heavy pulls stack clean, don’t rebuild your setup for a prettier bar path.

I’d only change something this week if the path gets worse as the load goes up, or your pressure rolls to your toes.'),
('fd7476be-5315-4534-b672-faa2b12415a9'::uuid, 'c19a566f480cb9873aceb358eaa06349', 'Most lifters overreact to the ugly day and undercount the zeros.

If the plan is slipping, I’d rather see a scaled version done than a perfect week that only exists in your notes.

Count the sessions you actually finished this month before you rewrite the program.'),
('75cb8e77-1796-40bc-9056-6453827e923b'::uuid, '00eba8448783e21f5450df29435e247c', 'A session with a time has a fighting chance.

The one you’ll squeeze in later is usually the first thing traded when the day gets busy.

I’d rather make one lift non-negotiable and adjust the rest than pretend every day is equally protected.'),
('86ccddd6-7991-4ee2-b043-4db84abd39d7'::uuid, '3acc7451a435589481aeea72d9855620', 'Meet day isn’t the place to invent your routine.

Pick the order now and use it on warm-ups, top sets, and the boring back-off sets you don’t care about.

If it only shows up when the bar is heavy, it’s not a routine yet. It’s a hope.'),
('3a56b90f-c422-48de-ba4c-d9d8769ec743'::uuid, '9eacae09ef32bf8b4969b7fab07d69cc', 'A lot of lifters turn the last few reps into a negotiation with themselves.

If a rep only exists so the log looks finished, it’s probably not helping much.

Finish the week with reps you’d be happy to watch back, not ones you need to explain away.'),
('da61d12c-f14e-4c5b-91d1-ce718e0b47ef'::uuid, 'b7833aa16a60ab20daec4ca6c9ec9095', 'Myo-reps belong on the stuff where technique won''t fall apart when you''re tired.

Myo-rep squats aren''t efficient. They''re a bad idea that feels productive.

Start with one accessory slot and keep the main work normal.'),
('2b9b52c0-58c8-413a-a035-5d4c710eaeda'::uuid, 'f3036c325a3c1d4e12d45160c77160e9', 'Chasing soreness is how good training turns into random training.

If every week has to wreck you, you’ll keep swapping the exercise, the tempo or the depth just to feel something.

In prep I’d rather see boring weeks where the same work gets cleaner and more predictable.'),
('8e98e0ae-e994-42f9-9d90-f9ca6ff7999a'::uuid, '88223b208957579a0590ffac77f94f32', 'If you’re counting every ramp-up set as hypertrophy work, your volume number is lying to you.

This week, pick one muscle you’re trying to grow and count only the sets that actually took effort.

If adding more makes the rest of the session worse, that’s fatigue debt, not ambition.'),
('4ef4d878-0849-46e1-8965-46b264c3b212'::uuid, '7cf75960a60716eba21eb9ee5bfc4194', 'A lot of bad RPE calls come from rating the burn, the nerves or how cooked the session feels.

If the rep was technically there, it was there. If it would''ve turned into a hitchy mess, don''t count it.

Make the call before your mood starts writing your log.'),
('408b47fe-0dc5-4df7-b9b9-06ed509b52c9'::uuid, 'cd64bfb3651e2c736be6abc1e25f27e4', 'Some lifters are built to pull with higher hips.

Shorter arms or longer legs for your height? Chasing the low hip look can make the rep worse.

I’d rather see a boring start position that holds when the bar leaves the floor.'),
('fe537fcc-19cc-4416-a08e-aeaff3329476'::uuid, 'fb233583832a7a42f4937e382734f91f', 'Sleep isn’t sexy, which is probably why lifters skip it and buy the weird stuff first.

If your nights are already solid, this isn’t the lever I’d obsess over.

If they’re short, I’d fix the evening before adding another recovery toy.'),
('bac27447-fec0-4e0d-a25e-43bed5b1e2d7'::uuid, 'ec1a6a5d4866e68e34c6079eb12eed58', 'Treat the empty bar like it counts.

Not with max effort. With actual attention.

This week, make your first warm-up the first clean rep of the day, then keep that same shape as the weight climbs.'),
('62ecce1d-f865-48aa-8147-70cae73d935d'::uuid, '69d624d07f14770c4b3b7ab6d795a1ab', 'By Friday the session has to fit the life around it.

I’d rather see you trim accessories and get the main work in than keep pretending the full session will happen after a full week.

If it keeps falling off, change the time or change the dose.'),
('0fe7c986-db1d-41a1-a7d4-093e572d9d38'::uuid, '7a0eae8e8119083d8ee796d023251874', 'the PR at the end of a block gets all the credit, but the six weeks of RPE 7 to 8 work before it did most of the job.

if your training only feels productive on heavy days you''re judging the wrong sessions. the PR is the result, not the work'),
('4b42a9bd-4e8a-4a6b-9bdb-1a7ebb136a1a'::uuid, 'ebb7c4d5a21154aa2dd2e1ff7e1f1f55', 'your first months of training are as much about learning the lifts as building muscle.

better positions, a tighter brace, cleaner bar paths. that''s real strength even if nothing looks different, so a lot of early progress just won''t show up in the mirror.

judge those months by your log, not the mirror')
), saved AS (
  INSERT INTO public.community_caption_readability_backup (kind, target_id, before, after)
  SELECT 'post', p.id, p.caption, v.caption
    FROM public.community_posts p JOIN v ON v.id = p.id
   WHERE md5(p.caption) = v.old_md5
  ON CONFLICT (kind, target_id) DO NOTHING
  RETURNING target_id
)
UPDATE public.community_posts p
   SET caption = v.caption,
       -- its deck keeps the caption it goes out with (only while that copy was the same text)
       series_data = CASE
         WHEN p.series_data ? 'deck' AND md5(coalesce(p.series_data->'deck'->>'caption', '')) = v.old_md5
           THEN jsonb_set(p.series_data, '{deck,caption}', to_jsonb(v.caption))
         ELSE p.series_data END
  FROM v
 WHERE p.id = v.id AND md5(p.caption) = v.old_md5;

-- the library's decks (what goes out next, and the posts' own library items)
WITH v(id, old_md5, caption) AS (VALUES
('019ea0d6-ccf1-4445-b401-77ef5ac7193e'::uuid, 'f8314661583ca5d5c45553f10f20059b', 'Changing your cue every heavy set is like changing your setup every heavy set.

If you want it to show up when the bar gets heavy, use it in normal training first.

Decide it before you’re fired up, not when the top set is already loaded.'),
('0c3570c8-2c8f-43de-a2a4-0f07db940975'::uuid, '8bdb9d8f40e35324d1a23ec3f106205f', 'Perfect conditions are a bad requirement for training.

If the gym doesn’t match the spreadsheet, make the closest useful swap and keep the session going.

The only real miss is letting a busy gym talk you into doing nothing.'),
('89e75668-36c8-4ec1-886c-8b06e2726735'::uuid, 'a33aa60604b2b3e2e6b2ab8c6442d94f', 'The shake isn’t the magic trick.

I see lifters stress over the post workout window, then end the day nowhere near their target.

If a dietitian gave you numbers, use those. If not, pick the range and make hitting it boring.'),
('80cbf126-eb32-4536-82e3-b373604fbcb7'::uuid, 'e14964ecb290c1129d80cf7c05dedfb7', '75% doesn’t need a full rehearsal.

Once the bar is moving fine, you’ve got what you need from it, so stop collecting extra reps.

If your program gives you exact warm-ups, run them as written instead of turning the ramp into another workout.'),
('c7aeb209-03e5-425c-960e-f0e6f158dcd8'::uuid, '44540522251a741ee12db217be1faabb', 'Bar feels heavier than it should? Don’t start rewriting the whole block in your head.

Sleep, stress, food and work can all make a normal session feel ugly.

Write it in your log while you still remember it, then give the trend time to say something useful.'),
('b463a75f-7533-465e-8e20-5cf98bb55e04'::uuid, '6b9c39b843b150c9497d09ad90a7b99a', 'Most taper mistakes are overcorrections.

Some lifters keep all the work because they’re scared their strength will disappear. Others back off so long that fitness starts leaking too.

Keep the heavy lifts familiar, trim what piles up fatigue, and don’t turn a short taper into time off.'),
('56a19b2f-af47-4ffe-80e7-4c9d708b6dc4'::uuid, '66de0045d2839068365d0cd29d703d8e', 'I’d use clusters when technique is the priority and fatigue is turning the last couple reps into a different lift.

If the extra rest just becomes permission to add weight and grind anyway, you missed the point.

Keep the load honest and make the reps match.'),
('3eaeb197-9969-4d71-ab56-ec6bb7b27c70'::uuid, 'bce149ede8574d5919a70c5a936cb631', 'Meet prep shows this fast.

The lifter who trains best is usually the one who can hit the next heavy day with some pop.

If a set turns the rest of your day into damage control, that wasn’t toughness. It was bad timing.'),
('cb1e4549-94df-4e26-a22b-d57401aa41c6'::uuid, '4fe04e6be2c924cf28ddbabbc337eb24', 'Random warm-up jumps make RPE way noisier than it needs to be.

I’m not trying to turn training into a spreadsheet ritual. I want the early sets to tell you whether today is normal, cooked or worth pushing, before the real work starts.'),
('91367cb0-d02e-4a86-b797-ef2e56ddfd64'::uuid, '89a882b915d6e20606494ab406db4e4b', 'Where I see this go wrong is lifters being patient off the chest, then turning it on at the hard part.

That just gives the rep less time with full intent behind it.

Heavy bench this week? Every rep that isn’t tempo work is an attempt to launch the bar, even when the plates make it look boring.'),
('cff53170-1ae8-4893-8f38-3ccc981809b5'::uuid, 'bd2f27b99f93e96f588db1a56c4beb0e', 'Padding the log is easy.

Add a few clean, comfortable sets and you can convince yourself the work went up.

Sometimes it did. Sometimes you just got better at avoiding the reps that would actually make you adapt.'),
('8f208f53-3109-4fff-8f65-070399e52d5e'::uuid, 'c82e57c795fab6f4fc9ea1c94a2c78f0', 'Friday is a bad day to audition for confidence.

When the work is done, close the log. Don’t sneak in a single because training felt too normal.

The block works when you can stack weeks you recover from.'),
('177d285e-66e4-4b8b-9a87-581deb0fbb53'::uuid, '8868eb93c657cd80a9509d51d053ea91', 'I don’t add weak side work off one ugly rep.

If your squat shifts on a top single but your feet were set differently and the bar was crooked, more accessories won’t fix it.

Clean up the setup, film some lighter work, then decide. Split squats come in when the case is actually built.'),
('82808409-05bb-454a-bd0b-2dd308f9e83e'::uuid, 'd4106d019f038ecf6a7954eba6492b45', 'Renegotiating your training time every day is how your mood ends up coaching you.

Injured or sick? Different conversation.

Just flat? I’d keep the appointment, get under the bar for the first lift, and make the call once you’ve got better information.'),
('b0a4830d-1e78-4f56-ab10-d908fe181a6e'::uuid, '10c5fa6bb0a3618e3530a4a0e1602bad', 'A sore chest can still press fine. A chest that feels great can still have slow bar speed.

This week, keep one repeatable warm-up in your log and use it as a readiness check.

The point isn’t to dodge hard work. It’s to stop letting DOMS write the program.'),
('ffc302fc-f612-442a-8f04-a8268c21dfd8'::uuid, '009de1dcd910ea9b663c39b9ee05255d', 'A cue isn’t a personality trait.

Try it before the weight gets distracting. If your hips do more and your knees stop caving in, cool.

If it just gives you one more thing to think about, bin it.'),
('e85172e0-945c-43a7-aa83-86ebd6486d43'::uuid, '865f49eafe4c606d76cb34fc9a424d3a', 'Not every side video is a technique emergency.

If your warm-ups swing a bit but your heavy pulls stack clean, don’t rebuild your setup for a prettier bar path.

I’d only change something this week if the path gets worse as the load goes up, or your pressure rolls to your toes.'),
('b51b2c1a-0041-49b0-8ce1-c2792e50f682'::uuid, 'c19a566f480cb9873aceb358eaa06349', 'Most lifters overreact to the ugly day and undercount the zeros.

If the plan is slipping, I’d rather see a scaled version done than a perfect week that only exists in your notes.

Count the sessions you actually finished this month before you rewrite the program.'),
('18c28d3b-0e8c-4d3e-ab36-1a86f5da028c'::uuid, '00eba8448783e21f5450df29435e247c', 'A session with a time has a fighting chance.

The one you’ll squeeze in later is usually the first thing traded when the day gets busy.

I’d rather make one lift non-negotiable and adjust the rest than pretend every day is equally protected.'),
('d57b2fe8-5a48-4355-b132-ad669413eaaf'::uuid, '3acc7451a435589481aeea72d9855620', 'Meet day isn’t the place to invent your routine.

Pick the order now and use it on warm-ups, top sets, and the boring back-off sets you don’t care about.

If it only shows up when the bar is heavy, it’s not a routine yet. It’s a hope.'),
('65cb9e49-5d0a-4a7e-9e2f-86155722fd48'::uuid, '9eacae09ef32bf8b4969b7fab07d69cc', 'A lot of lifters turn the last few reps into a negotiation with themselves.

If a rep only exists so the log looks finished, it’s probably not helping much.

Finish the week with reps you’d be happy to watch back, not ones you need to explain away.'),
('6b534684-090a-4473-ae7e-510643ba285e'::uuid, 'b7833aa16a60ab20daec4ca6c9ec9095', 'Myo-reps belong on the stuff where technique won''t fall apart when you''re tired.

Myo-rep squats aren''t efficient. They''re a bad idea that feels productive.

Start with one accessory slot and keep the main work normal.'),
('a707ca01-2e11-4654-be62-312006d0ed24'::uuid, 'f3036c325a3c1d4e12d45160c77160e9', 'Chasing soreness is how good training turns into random training.

If every week has to wreck you, you’ll keep swapping the exercise, the tempo or the depth just to feel something.

In prep I’d rather see boring weeks where the same work gets cleaner and more predictable.'),
('10eb40c7-f22f-4c59-b5ec-809c390a6f38'::uuid, '88223b208957579a0590ffac77f94f32', 'If you’re counting every ramp-up set as hypertrophy work, your volume number is lying to you.

This week, pick one muscle you’re trying to grow and count only the sets that actually took effort.

If adding more makes the rest of the session worse, that’s fatigue debt, not ambition.'),
('5ae9422e-57d1-4121-9a0f-a713b732b0c4'::uuid, '7cf75960a60716eba21eb9ee5bfc4194', 'A lot of bad RPE calls come from rating the burn, the nerves or how cooked the session feels.

If the rep was technically there, it was there. If it would''ve turned into a hitchy mess, don''t count it.

Make the call before your mood starts writing your log.'),
('20623f74-f835-436c-9e22-1e67dabd9992'::uuid, 'cd64bfb3651e2c736be6abc1e25f27e4', 'Some lifters are built to pull with higher hips.

Shorter arms or longer legs for your height? Chasing the low hip look can make the rep worse.

I’d rather see a boring start position that holds when the bar leaves the floor.'),
('27c07068-dc67-468a-a851-9155ca3c0ad9'::uuid, 'fb233583832a7a42f4937e382734f91f', 'Sleep isn’t sexy, which is probably why lifters skip it and buy the weird stuff first.

If your nights are already solid, this isn’t the lever I’d obsess over.

If they’re short, I’d fix the evening before adding another recovery toy.'),
('bf645a12-efd5-4405-8f1e-1788708e9ba5'::uuid, 'ec1a6a5d4866e68e34c6079eb12eed58', 'Treat the empty bar like it counts.

Not with max effort. With actual attention.

This week, make your first warm-up the first clean rep of the day, then keep that same shape as the weight climbs.'),
('ee5adbbe-a3b1-4efa-996c-1451103200cf'::uuid, '69d624d07f14770c4b3b7ab6d795a1ab', 'By Friday the session has to fit the life around it.

I’d rather see you trim accessories and get the main work in than keep pretending the full session will happen after a full week.

If it keeps falling off, change the time or change the dose.'),
('00ee9d30-9778-4d9f-9334-2d074c0de9d9'::uuid, 'ea6ae0183865a31e5f2f359dacb10b4f', 'This is a beginner fix, not a reason to rebuild a touch point that already works.

A little variation is normal. Fix it on lighter sets, then leave it alone.'),
('0f67ad71-5f56-4997-ad92-30acc2b0d10a'::uuid, '24b95265587462997b1059801443e5ab', 'Caffeine is useful. It’s not a personality change in a scoop.

If you need more and more just to feel normal under the bar, the problem probably isn’t your pre-workout.

Pick a dose you can repeat in training before you ever bring it into a meet.'),
('15727fbb-3769-4dfe-8f42-4c537fa37372'::uuid, '5c90017ffecb4884c17420163bcdf3f3', 'Bad sleep gets worse when you start coaching scared.

I don’t want a lifter doubling caffeine, rushing attempts or rewriting openers because they woke up annoyed.

Tell your coach early, take the warm-ups seriously, and make the first change off the bar, not the pillow.'),
('1aeef282-00fe-4e47-9ab1-e0add46ccae0'::uuid, '57022541b4e26ff6b96943d90c0adf13', 'A lot of lifters see one ugly rep and immediately add another accessory.

If the miss only shows up when you’re gassed, I’m not rebuilding your squat over it.

I want video from the same load, same angle, and the rep before the breakdown. Then we can see if it’s a pattern or just fatigue.'),
('26a836a1-789b-4ca9-b27e-9a60ec5bbbc1'::uuid, '4b613a459c033655d6341a81db840b06', 'A messy setup turns a strong squat into a worse attempt before you''ve had a chance to show it.

Close to a meet and your walkout is stable? Leave it alone.

If it''s costing you tightness, clean up the routine and rehearse the wait before the platform does it for you.'),
('39dd293e-343c-41f1-a5b8-c36e069d719d'::uuid, 'a224ec50075dd46270b63f0312a233bf', 'Adding another touch a week should solve a problem.

If your work is already clean and your weekly sets stay the same, don’t expect a new schedule to do much by itself.

If the later work turns into survival reps, move some of it to another day and make those reps better.'),
('3dbc596d-75ef-4cb1-96ef-a82ea56232c4'::uuid, 'aaac6d1ccb65c1dcb7846b463aa60615', 'Assume your calendar is going to throw one punch this week.

You don''t need a perfect schedule. You need a decision made before you''re tired, annoyed and bargaining with yourself.

For most lifters the fix is moving the session, not pretending the conflict won''t happen.'),
('5ad05ebe-9b2f-4609-b3d2-73c8f609d73c'::uuid, 'de15fe6c24573e5e8e8b2edfd83495be', 'Plates are the loudest number in your log, so they get most of the attention.

If you only track load, you miss the quiet stuff that tells you training is working.

This week, don’t just write down what you lifted. Write down what it cost you.'),
('64691a17-bd50-41ea-b63a-9b92ff749b5b'::uuid, 'b183eacc4dba1e68e03950efacef5102', 'The lifters who need this most usually aren’t reckless.

They’re the ones who can tell you 12 things wrong with a rep but haven’t put five pounds on the bar in months.

If the rep is consistent enough to train, training it is part of how it gets better.'),
('77f02854-3721-4672-be75-e1e99a7869c9'::uuid, 'e945549184b74b1ae1b82b20421d8c13', 'A side angle saves a lot of guessing.

If the bar leaves your legs, don’t start by changing everything about your pull. Find out whether it was the start, the hips or the knees, then make the fix obvious with pauses.'),
('7c6279df-fb5b-455c-9b46-ace09c8f3d51'::uuid, 'c0689483fbd7aa9cf9b57c994ef8b2ca', 'A drop set on squats is basically cardio plus plate math at the worst possible moment.

The point is density, not hero reps. I’d keep them to simple accessories where changing the load is fast, and leave the main lifts alone.'),
('96a946fa-41d2-4cf1-8a74-2ecdde0dee41'::uuid, 'c2a9aa9cc7aaeb13c2f97e59f8a6fa74', 'Novelty is useful when it solves something.

The mistake is swapping movements the second training feels stale, then wondering why nothing is easy to measure.

If your top sets and back-offs are still moving, I’d squeeze that setup longer before rebuilding it for entertainment.'),
('a88e2cb4-9e3e-4e61-988c-c65460054121'::uuid, 'ae32b50c0df01cc8aadd953e5c99fc88', 'Plenty of strong lifters treat being winded as proof they train hard.

Usually it just means their conditioning is lagging behind their strength.

If the lower body session is the priority, don’t open with the run. Do the easy work somewhere it won’t steal from the lift.'),
('d4752d81-f98f-44ec-b681-86e75bf4a94c'::uuid, '8017ac9f74a4d1104a035e6ab74496d6', 'Don’t force an upright squat just because it looks cleaner.

If your proportions push you into more torso angle, hammering the same cue every week just makes the lift feel worse.

Before you rebuild it, get a side video and see what’s actually happening.'),
('d9a32986-f17d-4633-a332-5723ddb2194e'::uuid, '5a1cd68bbbd0c8c58ba4181bc19fa439', 'The annoying part is you have to stay boring long enough to learn anything.

If you’re testing caffeine, don’t also overhaul your sleep, swap accessories and add conditioning, then pretend you found the answer.

Programming changes get planned, not freestyled mid block.'),
('dbfa319b-e92f-4e9c-bfcc-f4486ca51957'::uuid, 'e796b90172142a0859bbb2d526b239d9', 'When the bar dies at the knees, most lifters add more work for that range.

If your hips are shooting up or the bar is drifting before it gets there, you’re building around the wrong problem.

Clean up the start first. Then decide if that range actually needs more strength work.'),
('e80a571e-986a-4279-a802-c6c0a86669d3'::uuid, '2dfc8d7faf9c0e3957471748bfa3e813', 'A lot of people make the plan harder than it needs to be.

You don’t need seven matching containers and a full week scripted out. Get a couple protein options ready, buy the produce you’ll actually reach for, and make the next two days obvious.'),
('ec0713cd-4875-4640-931b-d2e5dede2db3'::uuid, '417412255f3f5a62957b16b659928b98', 'All or nothing thinking wrecks more training than the missed day itself.

If life clips a session, don’t try to make up the whole workout with junk fatigue. Keep the next one boring, hit what matters and move on.'),
('f1f22128-5c52-47be-8fe8-2fdf8212e155'::uuid, '2352fe0a6ba442ad7e9570822da51b16', 'Short rests aren’t evil. They just stop being useful when they make the training worse.

On big lifts like squats, I’m not impressed that you got back under the bar in 60 seconds if the load or reps crater right after.

Accessories can move quicker, as long as the work still looks like what you planned.'),
('f551c7c3-f381-406e-a6db-edc6a1b38ad2'::uuid, '306da786092dd66f546e9fba3a00b3fb', 'I''m fine with a higher hip sumo if it''s the position you actually pull from.

The mistake is chasing the clean, upright screenshot, then losing it the second you load the bar.

Next deadlift session, film the break off the floor and build your setup from that frame.'),
('1919cb29-609d-4bba-8e38-e01ec0ffb565'::uuid, '889596f14c2ccb1c9aef2e144a249470', 'Your setup shouldn’t change the second the bar feels heavy.

Don’t make this a hype cue. Make the start quiet enough that the heavy pull doesn’t surprise you.'),
('2a4de398-edea-4f77-8b16-25c6e642b393'::uuid, '6872410f83422038d440428a20a595ff', 'If “pull” keeps turning into hips-up-and-pray, try the other thought.

Compare the actual rep, not the feeling, and use the one that makes the start cleaner.'),
('3815d8a6-ca3d-42b5-9319-98fdb52f9334'::uuid, 'b86eddfa853a5ccc6be8ede1fce730b4', 'Honest RPE usually feels a little boring. You’re leaving weight on the bar on purpose.

The mistake is rating the set you wish you had, then acting surprised when the back-offs feel cooked.

If the last rep got ugly, don’t log the fantasy version.'),
('61382fd2-3c48-4a4e-bc90-3d52e516c0d0'::uuid, '5bc1d4231d3860e0b4640767d9d67733', 'Lots of lifters judge pre-workout food off the top set, then blame conditioning when the later work feels like punishment.

If your main work is fine but your volume falls apart, try the boring fix before you rewrite the program.

Eat something before you lift.'),
('627facf0-7ab2-4bd4-84ed-bdece2dfc89b'::uuid, '7c7e9fa9b510bd2bdfcbd39f7b98be46', 'Your low back lights up and you go straight to hunting for a new stance or another accessory.

I’d check the brace first. If you can’t create pressure into the belt on a lighter set, adding load usually just makes the same problem louder.'),
('65733bc4-e5f3-40b5-8575-10726c4c5e16'::uuid, '63efb4b29c38056e118ffb3cf8d03659', 'Toughing it out only helps when I know that’s what you’re doing.

If every lift feels like there’s a plate hiding on the bar, write it down and send it.

I can work with a pattern. I can’t coach the part you keep off the log.'),
('7ae5d783-7d3d-44c5-b2b4-0b7276df4570'::uuid, 'cf3e037ea47aa89a9329570c623ec919', 'Getting organized once the weight is scary is too late.

Make the checklist boring on normal sets, so the heavy ones don’t turn into a debate with yourself.'),
('afec84d5-c26c-445d-aa01-0f8c2ea8406e'::uuid, '4c0793277c3d9d3e2eaafeab2f7b9041', 'I don’t care how much you can heave on back work if your lats never get invited.

When it’s there for your powerlifting, take the weight down, make the cue obvious, then build the load back up.'),
('b407750e-9929-45c6-a150-cfadb8249e5e'::uuid, '69b5e851321e6c3cea4a6e725b9cb5f3', 'A cue has to earn its spot. Sounding coachy doesn’t count.

Run it early, when the weight is light enough to notice what changed, not when you’re already fighting a top set.

If the rep gets tighter on video, it stays.'),
('bf8641c7-e138-4f3d-8102-efe612831e02'::uuid, '64e264b5d9d9e405bf56bb014dabe180', 'A bad sleep week is a terrible time to play program detective.

If the same weights suddenly feel stupid heavy, I’m checking the simple stuff before I touch sets or percentages.

Earlier nights won’t fix everything. They’re just a lot cheaper than rewriting the whole block.'),
('c080f378-d8f4-4418-8fb5-b17677b78ad5'::uuid, '1bcbe307aff90626f313eca9b3ae549e', 'Does your bench feel like your arms pressing off a loose setup instead of your whole body staying connected?

That’s when I’d test this one. A cue doesn’t need to sound complicated to work.

If your upper back stays put and your legs stay in the press, see if lockout feels different.'),
('d17676d5-38c5-4ee9-a522-d0b2e9a24a2d'::uuid, '7a1100bcbac8fb067c5aa64e4f292ebf', 'Borrow standards from better lifters if it gets you fired up.

Just don’t use their total as proof your plan is failing. Pull up your own old entries before you change your training because another lifter made you feel behind.'),
('d646c653-8618-4212-a476-8cbeac3d6875'::uuid, '386bd9d80bdd198df66e3f6933c809ac', 'Don’t give a rough morning more authority than the bar.

Let the warm-ups make the call on load, not your mood in the parking lot. Then keep the session boring and honest.

That’s how a bad-feeling day still counts.'),
('e007452a-e619-466a-9029-3c7e58af6c6d'::uuid, '7ecf23181df61d3114697c10aef105f1', 'RDLs are for loading the hamstrings, not proving the plates can get closer to the floor.

If your last few inches come from your spine instead of your hips, I’m cutting the rep there and making you own that range.

Depth only helps if it’s still the lift you meant to do.'),
('fc70ff2f-3c0b-4095-a960-1eb892592823'::uuid, '1c883657c7e11c811e96444f59c13547', 'Accessories turn into little ego lifts fast.

I wouldn’t do this on everything. On a couple movements where you can actually get into the bottom position, make the rep honest and let the weight drop if it has to.

That’s not losing strength. That’s the accessory doing its job.'),
('ffa5a864-0c77-4920-a05f-75d90f6c8523'::uuid, 'f7c0d6b44303796fbdaa5b8423429eb1', 'Short on time? Keep the longer rests for squats and deadlifts and squeeze the accessory work instead.

Superset curls, not heavy pulls.')
), saved AS (
  INSERT INTO public.community_caption_readability_backup (kind, target_id, before, after)
  SELECT 'item', i.id, i.data->'deck'->>'caption', v.caption
    FROM public.community_series_items i JOIN v ON v.id = i.id
   WHERE md5(coalesce(i.data->'deck'->>'caption', '')) = v.old_md5
  ON CONFLICT (kind, target_id) DO NOTHING
  RETURNING target_id
)
UPDATE public.community_series_items i
   SET data = jsonb_set(i.data, '{deck,caption}', to_jsonb(v.caption))
  FROM v
 WHERE i.id = v.id AND md5(coalesce(i.data->'deck'->>'caption', '')) = v.old_md5;
