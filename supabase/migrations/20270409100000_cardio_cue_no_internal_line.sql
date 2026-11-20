-- The cardio plan Generate Next Program proposes once ended its athlete cue
-- with the app's own bookkeeping: "Your nutrition plan will adjust this when
-- it's made." (program-intel/cardio.ts). The athlete read it on the cardio
-- card and under every upcoming workout's walk, and it stopped being true the
-- day the nutrition plan took the plan over (Devin Buth, Nov 11 2026). The
-- generator no longer writes it; this takes it off the plans that still carry
-- the generated wording word for word, so a cue anyone edited is never
-- touched. The cardio_targets_program_sync trigger then rewrites the note on
-- upcoming workouts only (started or logged ones keep theirs).
UPDATE public.cardio_targets
   SET client_notes = CASE client_notes
         WHEN 'After lifting, at a pace you can talk but not sing. Your nutrition plan will adjust this when it''s made.'
           THEN 'After lifting, at a pace you can talk but not sing.'
         WHEN 'An easy walk on a day off, at a pace you can talk but not sing. Your nutrition plan will adjust this when it''s made.'
           THEN 'An easy walk on a day off, at a pace you can talk but not sing.'
       END
 WHERE client_notes IN (
   'After lifting, at a pace you can talk but not sing. Your nutrition plan will adjust this when it''s made.',
   'An easy walk on a day off, at a pace you can talk but not sing. Your nutrition plan will adjust this when it''s made.'
 );
