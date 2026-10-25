# JF Effect educational posts: the standard

Every lesson in Crew (`series = 'lesson'`, the library in `community_series_items`,
planned in `community_lesson_plan`) is held to this. The goal is not an app that
repeats powerlifting information. It teaches athletes how to think about their
lifting at a higher level.

## How a lesson is thought through (before a word is written)

Research → Question → Analyze the mechanics → Consider competing explanations →
Apply coaching experience → Reach your own conclusion → Work out what an athlete
actually does with it.

1. **Research.** Find the primary sources. Read what was measured, not just the
   abstract's conclusion.
2. **Question it.** Who were the subjects (elite powerlifters, recreational
   lifters, untrained students)? How many? What was actually measured (bar
   speed, EMG, joint moments, force) and what was only inferred? Would it hold
   for a competitive lifter with a comp setup, at comp loads, under fatigue?
3. **Mechanics.** Work through the physics and anatomy: force vs load, moment
   arms, leverages, muscle length, bar velocity, fatigue, what changes between
   lifters (limb lengths, arch, grip, stance).
4. **Competing explanations.** List the plausible causes. Say which the evidence
   favours, which it rules out, and which are still open.
5. **Coaching experience.** What do you actually see on video and in training
   logs? Where does real-world coaching agree or disagree with the paper?
6. **Your own conclusion.** Go past the paper when the reasoning supports it. Never
   past the evidence: an idea of your own is labelled as one.
7. **Application.** How does an athlete tell which cause is theirs, and what
   should they investigate or try? What changes for a beginner vs an elite lifter?

## What every lesson must do

- **Teach one real idea** the reader didn't have before: a new way to see their
  lift, a test they can run, a concept to experiment with. A tip they've heard a
  hundred times isn't a lesson.
- **Explain why**, not just what. Name the cause, then how to tell causes apart,
  then what to do. "Do paused reps" is not a conclusion; why, for whom, and how
  you'd know it's working is.
- **Separate evidence from interpretation.** Plain words, in the post itself:
  - what a study found ("A 1989 study of elite powerlifters found…"),
  - its limits when they matter ("Both were small, and only the first used
    powerlifters"),
  - your interpretation ("Best read: …"),
  - your coaching hypothesis ("My take: …").
- **Don't force certainty.** When several explanations fit, say so. Challenge an
  established idea when the reasoning or newer evidence justifies it.
- **Never invent or stretch evidence.** Every study, number, athlete or coach
  fact is checked against its source before it goes in, and that source goes in
  the lesson's `refs` (only the coach sees them). Physics or anatomy you reason
  out yourself needs no study, but it has to be right.
- **Respect individual differences and skill levels.** Don't present one
  lifter's technique preference as a rule. Say who it applies to: a beginner
  usually needs practice and consistency, an elite lifter a specific diagnosis.

## How it reads

- **The hook earns the tap.** The first line is a reason to keep reading: a
  surprising claim, a question the reader has felt, a real athlete or coach when
  one makes the point. The feed shows about four lines before "more".
- **Short lines, sentence case, plain words.** Explain hard ideas simply ("the bar
  only slows when your push drops below its weight"), skip jargon unless it's
  explained in the same line, no science-paper voice.
- **Studies by year, not author** ("a 2013 study pressed from a dead stop…"),
  never "(Author & co)". Sources, disclaimers and series labels stay out of the
  post (see the lesson rules in AGENTS.md).
- **No fixed template.** Structure follows the subject: a myth-buster, a
  diagnostic test, a mechanism explained, an experiment to run, a story. Bullets
  only where they help scanning.
- **End on something memorable**: the conclusion in one line, a test to run this
  week, or a reframe they'll remember at the bar.
- **Length:** up to 1200 characters (the database's limit for a post and a library
  lesson). Most land between 600 and 1200. Cut words, never the reasoning.
- **The picture agrees with the words.** A diagram (`visual`) must show what the
  post claims, drawn accurately (e.g. the sticking region runs from the bar's
  fastest point to its slowest, `sticking_point` with `variant: "window"`).

## Worked example: the bench sticking region (Oct 2026 rewrite)

The first version said the 1989 study explained the slow spot as the bounce
fading before leverage improves, then told people to keep their forearms under
the bar and pause where it slows. The rewrite:

- **Mechanics first:** the bar only slows while the push is under its weight, so
  the trouble starts at the bar's fastest moment and is over by its slowest.
  The slowest point is where you're winning again.
- **Questioned the paper:** the 1989 study (10 elite powerlifters) ruled out a
  worse lever and quieter muscles. A 2013 study pressing from a dead stop still
  found the slowdown, so the bounce can't be the whole story. Both were small,
  and only the first used powerlifters.
- **Own conclusion, labelled:** a weak position you coast through on the speed
  built below it ("Best read"), so train the inches before the stall, not the
  stall ("My take").
- **Told the causes apart:** normal (same path, only near max), a weak bottom
  range (the bar crawls off the chest, no speed to coast on), technique
  (position changes in the slow part even at RPE 8).
- **Individual and level:** arch, grip and arm length move where the gap sits;
  a beginner should just bench more.
