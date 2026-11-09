# AI architecture for programming

How Generate Next Program, the coaching review and Edit with AI use models: which one
answers what, how a slow model is waited for, and how the choice was made.

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

- `strategy`, `review`, `interpret` are **strong only**: every model on the route is top tier.
  If none answers, the run stops with a message that says so. A coaching decision is never
  handed to a weaker model quietly.
- `construct`, `repair` may fall back to a cheaper model; the model that answered is logged per
  call (`program_intel_job_calls.model`) and shown in the job inspector.
- `edit` (Edit with AI) keeps its own route.
- `app_settings.ai_routes` (JSON, per task) overrides the defaults without a deploy; an override
  on a strong-only task is filtered to the top tier.

Model refs: `openai:<id>` calls OpenAI directly (`OPENAI_API_KEY`); `gateway:<family>/<id>` goes
through the Lovable AI gateway (chat completions for OpenAI and Google, the native Messages
route for Claude).

## Slow models

A request on the hosting is cut off after a few minutes, and a strong model thinking hard on a
long brief can take longer. Direct OpenAI calls run in **background mode**: the stage submits
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
measured: the OpenAI credits ran out mid-run. Flash builds; GPT-5.5 is its fallback.

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
