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
the request, keeps its id in `result.pending[key]`, polls for `pollConfig.ms`, and if it isn't
done throws `WaitingForModel`; the job goes back to `pending` and the next tick polls the same
id (never a second submission), up to `BACKGROUND_LIMIT_MS`. A finished answer is kept in
`result.calls[key]`, so a resumed stage never re-asks. A failed stage clears both, so Try again
asks fresh.

Gateway calls (Claude, and OpenAI / Google through the gateway) are **streamed**: the gateway
answers 524 to a request that sends nothing back for ~125s, which a strong model thinking over a
long brief always hits. Streamed, a call can run up to `SYNC_TIMEOUT_MS` (240s, inside the 300s
the database gives the worker request). A model that fails is saved on the job at once, so a
request cut off while trying the next model never retries the one that failed.

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

## Benchmark

Pending: the runs on real athletes (advanced powerlifter gaining with stalled lifts, beginners
in a home gym and cutting with low-back pain, an intermediate with limited recovery in 60-min
sessions, a first program, two lifters 4 weeks out from a meet) decide the defaults above.
