# AI architecture for programming

How Generate Next Program, the coaching review, Edit with AI, the Nutrition Update AI and the
roadmap words use models: which one answers what, how a slow model is waited for, and how the
choice was made.

## Stages

| Stage | Who does it | Where |
|---|---|---|
| 1. Athlete intelligence | Code only: training history, adherence, development read, equipment, schedule, the horizon (how many weeks, the deadline, the roadmap) | `buildGeneratorIntel`, `horizon.ts`, `brief.ts` |
| 2. Strategy | The strongest reasoning model (`strategy` route): blocks, phases, deloads, progression, the roadmap past this program | `pipeline.server.ts` strategy stage |
| 3. Construction | An efficient model writes each block's workouts from the approved strategy, one block per request | construct stage |
| 4a. Deterministic audit | Code: weeks, prescriptions, volume like with like, frequency, equipment, the exercise standard, session length. Back-to-back heavy squat / deadlift days are a *fact*, never a finding | `audit.ts` |
| 4b. Coaching review | The strongest model reads the built program like a head coach (fatigue, recovery in context, selection, specificity, progression, this athlete) and reports only genuine problems | `coaching-review.ts`, review stage |
| 5. Targeted corrections | A failed audit item or a review `must_fix` goes back to the efficient model for that block only, at most 2 rounds in total; nothing is rebuilt | repair stage |
| 6. Coach approval | Nothing reaches a client until the coach assigns the hidden draft | `assignIntelDraftFn` |

Simple, deterministic changes (dates, moving a workout, Undo) never reach a model.

## Routing (`src/lib/ai/routing.ts`)

Every default route runs on the OpenAI key (`openai:`), never the Lovable gateway (Nov 9 2026:
the coach doesn't want Lovable credits spent; direct calls also run in background mode, so they
never hit the gateway's 524 or hold a request open).

| Task | Models, in order | Effort |
|---|---|---|
| `strategy` (strong only) | GPT-6 Astra, GPT-5.5 | high |
| `review`, `interpret` (strong only) | GPT-6 Astra, GPT-5.5 | medium |
| `construct`, `repair` | GPT-5.5, GPT-6 Astra | low |
| `edit` (Edit with AI) | GPT-5.5, GPT-5-mini | medium |
| `nutrition` (Nutrition Update targets, strong only) | GPT-6 Astra, GPT-5.5 | medium |
| `nutrition_write` (meal plans, their fix, coach updates) | GPT-5.5, GPT-5-mini | low |
| `roadmap` (block purpose, weekly focus) | GPT-5-mini, GPT-5.5 | low |
| `meal_estimate` (a member's or client's AI food log, metered by AI credits) | GPT-5-mini, GPT-5.5 | low |
| `form_draft` (a coach's Draft with AI form) | GPT-5-mini, GPT-5.5 | low |
| `coach_write` (the weekly check-in recap and suggested reply, AI drafts of a form reply, a lead's first text, the inbox Brief, My Voice's Try it) | GPT-5-mini, GPT-5.5 | low |
| `assistant` (Cleo: chat and voice, live look-ups and the cards the person confirms) | GPT-5.5, GPT-5-mini | low |

- `strategy`, `review`, `interpret`, `nutrition` are **strong only**: every model on the route is
  top tier. If none answers, the run stops with a message that says so. A coaching decision is
  never handed to a weaker model quietly.
- `construct`, `repair` were Gemini 3 Flash first: the benchmark below found Flash and GPT-5.5
  build to the same audit result, Flash 2-5x faster, but Flash only exists through the gateway,
  so GPT-5.5 builds (in the background, slower) with Astra behind it.
- GPT-5-mini is only ever on routes whose output code checks before it's used (Edit with AI's
  `engine.ts`, the meal plan's `prepDrift` / `planTotalsIssues`, `parseRoadmapReply`).
- The model that answered is logged per call (`program_intel_job_calls.model`,
  `program_ai_edit_calls.model`) or kept on the row (`nutrition_ai_plans.model`).
- `app_settings.ai_routes` (JSON, per task) overrides the defaults without a deploy (and can
  still name a `gateway:` model); an override on a strong-only task is filtered to the top tier.

Model refs: `openai:<id>` calls OpenAI directly (`OPENAI_API_KEY`); `gateway:<family>/<id>` goes
through the Lovable AI gateway (chat completions for OpenAI and Google, the native Messages
route for Claude).

## Slow models

A request on the hosting is cut off after a few minutes, and a strong model thinking hard on a
long brief can take longer. Direct OpenAI calls run in **background mode** through one helper,
`stagedCall` (`src/lib/ai/staged-call.server.ts`), shared by Generate Next Program and the
Nutrition Update AI (whose run state is `nutrition_ai_plans.progress`, and whose "still
thinking" puts the row back to `pending`, which calls its hook again): the stage submits
the request, keeps its id in `result.pending[key]`, polls for `pollConfig.ms` (45s), and if it
isn't done throws `WaitingForModel`; the job goes back to `pending` and the next tick polls the same
id (never a second submission), up to `BACKGROUND_LIMIT_MS`. A finished answer is kept in
`result.calls[key]`, so a resumed stage never re-asks. A failed stage clears both, so Try again
asks fresh.

Gateway calls (Claude, and OpenAI / Google through the gateway) are **streamed**: the gateway
answers 524 to a request that sends nothing back for ~125s, which a strong model thinking over a
long brief always hits. Streamed, a call can run up to `SYNC_TIMEOUT_MS` (240s, inside the 300s
the database gives the worker request). A model that fails is saved on the job at once, so a
request cut off while trying the next model never retries the one that failed.

Why requests are kept short: the database sends every hook request through pg_net, which
finishes a whole batch before it starts the next. One generator request held for minutes
delays every scheduled hook in the app (reminders, Google sync, lift archive) by as long; the
benchmark showed 3-5 minute gaps where there are normally none. Background polls hand over
every 45s; only a gateway call holds a request for long, which is one reason the strong tasks
run on OpenAI's background mode.

## Claude via the gateway

Claude Opus 5.5 / Sonnet 5 refuse a thinking budget (`budget_tokens`) and any `temperature`
with a 400. `gatewayMessages` sends `thinking: { type: "adaptive" }` and the route's effort as
`output_config.effort`, and treats `stop_reason: "refusal"` as a failed call.

## Prices on file

Only published prices are used for the cost estimate (`PRICE_PER_MTOK`); anything else shows
"—". GPT-6 Astra $10 / $50 per million tokens in / out; Claude Opus 5.5 $4 / $20; Claude
Sonnet 5 $2 / $10 (Anthropic's model table). Gateway calls bill in Lovable credits.

## Checking and comparing models

- `/api/public/hooks/ai-models-check` (and Check now on `/admin/settings/ai`): lists what each
  provider serves and probes it; saved in `app_settings.ai_models_check`.
- `/api/public/hooks/ai-benchmark`: queues a Generate Next Program run for a real client with
  forced models per task (`models`), an optional setup patch (start date, length, goal
  timeline) and optionally an approved strategy (so construction is compared on the same plan).
  A benchmark run (`options.bench`) never writes a draft and never shows in the coach's list;
  its calls are logged like any run, so the comparison is per call: time, tokens, the audit and
  the review on the same athlete.

## Benchmark (Nov 9 2026, real athletes)

**Strategy** (the coaching decisions). Each model wrote the strategy for the same athlete from
the same brief; an independent grader scored them blind (letters shuffled per athlete, the
grader never saw which model wrote which) on six criteria, 60 points: faithful to the data,
goal and timeline fit, individualization, programming soundness, exercise selection,
actionable. Scores are after the parser fix below.

| Athlete (scenario) | GPT-6 Astra (direct) | GPT-5.5 (gateway) | Gemini 3 Flash (gateway) |
|---|---|---|---|
| Jared (advanced, stalled lifts, leaning out) | **47** | 44 | 22 |
| Alyssa (meet in 4 weeks, patchy attendance) | **51** | 44 | 27 |
| Nicolas (60-min PT sessions, limited recovery) | **51** | 41 | 26 |
| Marc (beginner, fat loss, low-back pain, home gym) | **44** | 41 | 20 |
| Colten (beginner, home gym) | **41** | failed (524) | 25 |
| Devin (first program, cutting, 6 days) | **49** | 46 | 26 |
| Average | **47.2** | 43.2 | 24.3 |

- Astra beat GPT-5.5 on all five athletes where both finished, and was the most faithful to
  the records every time. Time per strategy 154–867 s (about $1.20–2.50 at $10 / $50 per
  million tokens). It never failed to answer; one run crashed with the worker and resumed.
- GPT-5.5 took 155–210 s and failed once: the gateway answers 524 when a reasoning model
  thinks for more than ~125 s before streaming its answer.
- Flash took 12–22 s and was the weakest every time, with unsafe or invented choices (a
  standing press "for the low back", invented stressors, peaks with no meet).
- Claude (Opus 5.5, Fable 5.1) through the gateway never finished a strategy inside one
  request (240 s), at high or medium effort: the gateway has no background mode. Not routed.
- Strategies for Shaina (adherence), Reece (hypertrophy) and Vicky (gaining) were written by
  Astra only.

**Building** from an approved strategy (Jared, Nicolas, Devin; the coaching review fixed):
Flash and GPT-5.5 had the same audit result on every paired build (Devin and Nicolas pass with
review notes; Jared's fails the same frequency checks with either, a strategy-to-build hand-off
issue, not the model), Flash in 31–185 s, GPT-5.5 in 80–480 s. Astra as the builder wasn't
measured: the OpenAI credits ran out mid-run. The benchmark had Flash building; Flash only exists through the
Lovable gateway, so GPT-5.5 builds (the same audit result, slower, in the background) and Astra is its fallback.

**Found and fixed along the way** (each made every model look worse than it was):
- The schemas wiped text over a cap and lists with one bad item, so Astra's detailed
  strategies arrived with their progression model empty on 9 of 9 runs (#876, #878).
- The brief named an abandoned program as Alyssa's previous one; "didn't progress in any
  block" next to +13 %; volume targets counted ½ for secondary muscles while the prompt said
  direct sets; per-exercise loads printed in kg for lb lifters (#874, #877).
- A built block was refused for one 0-set week or a long superset label (#879).

**Costs and limits seen**: the benchmark used about $22 of OpenAI credit (25 Astra calls)
and Lovable AI credit for the gateway runs, and both accounts ran out during it; a run whose
models are all out of credit stops with a message naming which account to top up.

## AI credits (members and clients)

AI that a member or client triggers is metered (`src/lib/ai-credits/`, 20270313090000_ai_credits.sql):
a monthly free allowance by tier (member 30, coaching client 300, staff unlimited; admins change
them on Settings → AI credits & models) and packs bought through Stripe on the web. The credits are
taken before the call and given back if it fails (`withAiCredits`); every use keeps its model,
tokens and estimated cost, so the admin card compares the real AI cost against pack sales. Today
the only metered feature is the AI food log (`meal_estimate`, 1 credit, GPT-5 mini answered inside
the request with `callModelNow`). A new member-facing AI feature gets a cost in `ai_credit_cost` and
`FEATURE_COSTS` and goes through `withAiCredits`.


## Nov 18 2026: one architecture for the coach-side writing, one set of rules

- `coach_write` (above) moved the check-in recap, AI drafts of form replies, lead texts, the inbox Brief and
  My Voice's Try it off Lovable credits (one Gemini Flash call with no fallback) onto the OpenAI key through
  `askRoute` (src/lib/ai/route-call.server.ts: the route's models in order, the next one when a model fails,
  the admin override honoured). They summarise numbers code already worked out (workout counts, the
  weight-management read, the training readout); none makes a new coaching decision.
- The picture jobs (post pictures, lesson covers) no longer fall back to Lovable credits by themselves.
- One rule set across the AIs that touch the same client: a calorie step is the weight-management engine's
  `MAX_STEP_KCAL` (250) in the nutrition targets prompt and Cleo; a training-day walk is the treadmill caps
  (20 min, 15 for a powerlifter, a quarter of a booked PT session) in the nutrition prompt; an e1RM is only read
  from RPE 7+ sets of 10 reps or fewer everywhere (strength-read.ts, the check-in training readout); one hard
  session is one session's read in check-in replies, as in DEVELOPMENT_RULES; Cleo's loads, notes and session
  flow follow the generator's LOADING_RULES, ATHLETE_NOTE_RULES and ACCESSORY_FLOW_RULES.
- Shared context: the training brief (Generate Next Program, Edit with AI) carries the nutrition plan they're on
  (`nutritionNowLine`: phase, each day's calories and protein, what a cut or a gain means for training); the
  interpret job carries the health profile; the nutrition AI's athlete read carries a booked PT session's length;
  Cleo's nutrition look-up carries the weight-management read; Cleo's nutrition cards show the same
  "Check before publishing" list (`coachChecks`) as the Nutrition Update review.
- Kept as it is, on purpose: Edit with AI's GPT-5-mini fallback (every proposal is the coach's to approve;
  Astra as the fallback would time out more). Cleo's own chain moved the same day (below).


## Nov 18 2026: Cleo on the OpenAI key

Cleo (summer.server.ts) answered on Lovable credits: GPT-5.5 through the gateway's chat completions, then
Gemini Flash. Chat completions drop a reasoning model's thinking between tool calls, so every look-up started
its thinking over. Cleo is now the `assistant` route (cleo-model.server.ts):

- The OpenAI key through the Responses API (`@ai-sdk/openai`), `store: false` with
  `include: ["reasoning.encrypted_content"]`: Cleo's reasoning carries from one look-up to the next, and nothing is
  stored at OpenAI. `promptCacheKey` per person, so a follow-up reads Cleo's instructions, the books, the app and the
  chat so far from cache.
- Cleo's tools are `strict: false`. The Responses API makes every field of a strict tool required, and the first
  benchmark filled a calf raise card's optional load and percentage with placeholders (0.0001 lb at 1% of 1RM).
- Cleo's context is read in parallel (the books, who owes what, the app, the coach's voice and the caller's role together, about
  1 s), the stable parts first, and the time goes with the question so the system prompt stays cacheable.
- Every answer logs its model, effort, timings, steps, tools and tokens (`[cleo] answered`), and the
  `cleo-bench` hook (cron secret) runs Cleo's real answer path as the owner with given models and effort, saving
  nothing and deleting any card.
- Cleo's schedule look-ups read the app's two ways a workout is dated (cleo-schedule.ts): Cleo had read only the
  schedule table, which most workouts aren't on, and said "nothing scheduled" for clients who were training.

The live benchmark, two rounds on real data (seconds per answer; the same questions for every setting).
Round 1, six questions from how Cleo has been used: a bodyweight trend, a client's last three weeks, the coaching
policy on ending coaching, adding an exercise to a workout, who owes money, tomorrow's calendar:

| Model and effort | Average | Slowest (the program edit) | Notes |
|---|---|---|---|
| GPT-5.5 low | 11.0 s | 21 s | Right on every question but the edit card, whose placeholder load was the strict-tool problem (every setting had it) |
| GPT-5.5 medium | 17.6 s | 49 s | A little more thorough on analysis; the edit took 9 steps fighting the same problem |
| GPT-5-mini low | 11.7 s | 22 s | Not faster; drafted a message nobody asked for and asked a needless question on a clear edit |

Round 2, after the strict-tool and schedule fixes (Nico's three weeks, the same edit, "who missed workouts
this week and who should I check in with", "is Devin's weekly volume right for his goal"):

| Model and effort | Nico | Edit | Missed | Volume | Notes |
|---|---|---|---|---|---|
| GPT-5.5 low | 15.7 s | 18.1 s | 8.6 s | 24.6 s | Clean edit card (3 x 15 @RPE 8, nothing else); the missed list matched the database exactly |
| GPT-5.5 medium | 19.1 s | 13.0 s | 19.7 s | 31.9 s | Same quality; tied in pain flags and unread messages on "who to check in with" |

GPT-5.5 at low effort is the default: as quick as the small model, as accurate as medium on these questions,
and medium's extra depth cost 25-130% more time on most of them. A system prompt is about 18k tokens, and from
the second step on 90% of it was read from cache.

