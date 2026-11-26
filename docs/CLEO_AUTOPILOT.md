# Cleo Autopilot

Nov 25 2026. One weekly assessment per coaching client across training, nutrition and cardio, built on the systems that already exist. It is safe by default: every client and every domain starts on **Draft Only** with **shadow mode on**, so nothing reaches a client unless the coach turns on Smart Autopilot or Advanced for that client and turns shadow mode off.

## What runs, and when

| When | What | Model calls |
| --- | --- | --- |
| A weekly check-in's recap is written (`recapCheckin`) | `runAssessment` with the weight-management read the recap already loaded, then the recap and suggested reply are written **from that assessment**, then the drafts | the recap's own call (it existed before), plus any draft that needs a model |
| Hourly (`cleo-autopilot-hourly` → `coach-automation-tick` with `{"scan":"autopilot"}`) | publish what's allowed or approved, judge outcomes on their reassessment date, and assess any coaching client whose week went without one (a missed check-in) | none for the assessment |
| Coach taps Reassess | a new version of the record | none for the assessment |
| Coach taps Re-create | new wording for the reply only | one `coach_write` call |

## The assessment (src/lib/autopilot/assess.ts, pure)

Inputs, all from existing reads: the weight-management engine's recommendation (`decide`: the calorie step, the treadmill step, the data and safety gates), the coordinated check-in recommendation (`consolidate`: cardio's recovery read), the program in force (`loadProgramContext`: block, week, what's next), planned vs completed workouts over 14 days, the check-in's training rating, the lower lifts from comparable sets, pain history (`buildPainHistory`), the next competition, and whether the coach already has an unpublished draft in a builder.

Output: a category, a headline, evidence (measured / reported / estimated), the rationale, the expected outcome, a reassessment date, and per domain whether it holds, proposes a change or needs the coach to look first.

| Category | When |
| --- | --- |
| Intervene | pain or injury, a health concern, an unsafe weight target |
| Investigate | missing information, low adherence, digestion or a plan/goal conflict to look at first |
| Accelerate | a change that moves them toward the goal faster |
| Optimize | a change that eases off for recovery or a better pace |
| Extend | the block ends within a week with nothing next while they're progressing |
| Maintain | everything on track (the usual answer) |

**Protected** (always the coach's, whatever the settings): pain or injury, a health concern, an unsafe weight target, a bigger restructure (no next block, an outsized change), a competition within 14 days, and the coach's own draft in progress (never written over). Training also respects the program's intent: a proposal only touches workouts not yet trained or started (Edit with AI's own locks enforce it) and never comes within 7 days of the last program change.

## Drafts, not text

| Domain | Draft | Applied by | Undone by |
| --- | --- | --- | --- |
| Training | an Edit with AI turn (`program_ai_edits`, "[Autopilot]" instruction, the client's coach as author) | `applyEdit` → `program_ai_apply` with a restore point (the coach's own session) | `undoVersion` → `program_ai_restore` |
| Nutrition | Change it with AI on the current plan (`queuePlanEdit`) | `applyPlanEdit` (refuses if the plan changed since) | `undoPlanEdit` |
| Cardio | the cardio draft (`saveCardioDraft`): the engine's one-variable treadmill step applied in code (`applyCardioStep`), else Cleo — Cardio from the same words | `publishCardioPlan` with `notify: false` | the previous plan published back (`source: "restore"`) |

## Autonomy (src/lib/autopilot/autonomy.ts, pure)

Global row plus a row per client (`autopilot_settings`); a client's empty field follows the global one.

- **Draft Only** (default): every change is a draft for the coach.
- **Smart Autopilot**: a routine nutrition or cardio step inside the permitted range may publish by itself (defaults: 100 kcal a day, 15 cardio minutes a week).
- **Advanced**: wider (defaults: 250 kcal, the engine's own step; 30 minutes).
- The coach's permitted ranges narrow either; nothing ever goes past Advanced's ceiling.
- **Training never publishes by itself** in this version: its apply runs with the coach's own session.
- A cardio plan written by a model (not the engine's step) always waits for the coach.
- **Locks** keep a domain the coach's alone. **Pause** (everyone, or one client, optionally until a date) stops anything new. **Shadow mode** (on by default) keeps what would have published as a draft marked "would have published".

## Publishing (run.server.ts `publishDecision`)

Only a coach's Approve, or Smart/Advanced with shadow off. Right before publishing it re-runs the assessment on the latest records and requires the same change (same direction, same cardio variable) with no new protection, and the draft as autopilot left it (a draft the coach edited waits for their approval). Never while a workout is in progress (`pl_day_completions` started or touched in the last 3 hours and not finished); by itself it also waits while the client is in the app (`clients.last_active_at` within 10 minutes), up to 6 hours. Then **one** system card in the client's coach chat for everything that went live together ("Your nutrition targets have been updated.", before → after, from when, Open my plan): `is_automated`, never the coach's first person, once per decision, never for a change that failed or didn't publish. A rollback posts the same card the other way.

## The reply (reply.ts, reply.server.ts)

Written in the coach's existing saved voice (My Voice, `voicePromptForClient`; no new profile), in the recap's own call, from the same assessment. Lengths: system card 5–20 words, quick reply 15–50, weekly check-in reply 40–80, complex (pain, a protected decision, a request for help) up to 120. No generic openers ("Thanks for checking in", "Based on the data"), and nothing claiming the coach typed it. `fitReply` enforces both after the model. **Re-create** (the check-in card's button, replacing Redo) rewrites the wording only from what's stored, with an optional style (Make shorter, More like me, More direct, More supportive, Custom); every version is kept in `autopilot_reply_versions` (append-only) and can be shown again; nothing already sent changes.

## Records and outcomes

`autopilot_decisions` is one versioned record per assessment (`version` per client, `supersedes_id`; the decision itself is never rewritten, `tg_autopilot_decisions_keep`; nothing is deleted). Each keeps a baseline (bodyweight trend and the pace the goal needs, the lower lifts, adherence); on its reassessment date the hourly pass judges it (`judgeOutcome`: worked / partly / didn't / can't tell) on what it was for. Outcomes say what happened after, never that the change caused it.

## Cost

The assessment itself is code: it costs nothing. Calls and tokens it causes are recorded on each decision (`cost`) and summed for the last 30 days on the Coaching updates page.

Estimates (`costTable()`, cost.ts): prices from `AI_PRICES` (sourced in ai-usage.ts); token sizes and how often each happens are estimates.

| Call | Model | Tokens in / out (est.) | Per client per week (est.) |
| --- | --- | --- | --- |
| Check-in reply (the recap's call, existed before) | GPT-5 mini | 6,000 / 900 | 1 |
| Nutrition draft (targets + menus) | GPT-5.5 | 18,000 / 5,000 | 0.7 (a change about every 3 weeks, 2 calls) |
| Training draft (Edit with AI) | GPT-5.5 | 22,000 / 4,000 | 0.15 |
| Cardio draft the treadmill step can't express | GPT-5.5 | 9,000 / 2,000 | 0.05 |
| Re-create | GPT-5 mini | 4,000 / 400 | 0.3 |

| Clients | Calls a week | Tokens a week | US$ a week | US$ a month |
| --- | --- | --- | --- | --- |
| 25 | 55 | 0.72 M | 5.29 | 22.90 |
| 50 | 110 | 1.44 M | 10.58 | 45.81 |
| 100 | 220 | 2.88 M | 21.16 | 91.62 |
| 250 | 550 | 7.19 M | 52.90 | 229.05 |
| 500 | 1,100 | 14.39 M | 105.80 | 458.09 |

About 80% of it is the nutrition drafts (GPT-5.5 writing new menus); the reply is under $0.01 a client a week. All on the OpenAI key, never Lovable credits.

## Not in this version

- Training never auto-publishes (needs the coach's session; Approve on the dashboard applies it).
- "Learns from edits" for the reply beyond My Voice's own examples is not built.
- Nothing here has been run against the live database; the migration is applied by the orchestrator.
