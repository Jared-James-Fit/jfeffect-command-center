# Taxes & Books and Cleo

Business owner only. Sales hub > Taxes & Books (`/admin/sales?tab=taxes`).
Owners are listed in `business_owners` (`is_business_owner()`); RLS on the
books tables and the receipts bucket uses it, and the section and its menu
entry are hidden from other admins. Adding an admin does not make them an
owner.

## Where the numbers come from

| What | Source |
|---|---|
| Sales and GST/HST collected | `payment_ledger` (payments, deposits, refunds; voided, test-mode, credit and reversal rows are skipped) plus paid rows in `member_payment_ledger` |
| Expenses and ITCs | `business_expenses` (receipts, manual entries, monthly Stripe fees) |
| Tax already paid | `business_tax_payments` |
| Province, GST number, filing frequency, other income | `business_tax_settings` (one row) |

Revenue is counted when received. All figures run through one pure engine,
`src/lib/business-tax.ts`, so the dashboard, the PDFs and Cleo agree.

## Rules baked in

- T2125 line per category: `src/lib/business-expense-categories.ts`.
- Meals: 50% deductible and 50% ITC. Personal: kept, never deducted.
- Capital items: first-year CCA at the class rate (8: 20%, 50: 55%), no
  half-year rule for property available for use 2024-2027.
- GST/HST tax on an expense means GST/HST only. PST/RST is part of the cost.
  Stripe's own fees carry GST + Manitoba RST (12%); only 5/12 is claimed.
- Income tax and CPP: 2026 federal + Manitoba brackets and credits, CPP and
  CPP2 for the self-employed, stacked on any other income from settings.
  Corporation: 9% small business rate, no CPP.
- Projection: year to date plus the last 90 days' pace (or since the first
  sale if newer), without repeating payments over 5x the median payment.

Add next year's rates to `TAX_TABLES` in `business-tax.ts` each January;
until then the estimate uses the latest year loaded and says so.

## Receipts

The browser shrinks photos to 2000px JPEG and uploads to the private
`business-receipts` bucket. `scanReceipt` sends the file to the Lovable AI
Gateway, validates the JSON it gets back, and always creates the expense; if
the read fails or confidence is under 0.8 it is flagged "needs review".

## Stripe fees

`syncStripeFees` reads balance transactions (read-only) and keeps one expense
per month and currency (`external_key = stripe-fees:YYYY-MM:cur`). The page
syncs automatically when the last sync is older than 12 hours. Re-syncing
updates amounts and keeps any category change.

## Cleo

Cleo is she/her. Her voice is a preset the owner picks (Girly pop by
default, Chill, Straight business) plus optional custom instructions, both
set in Customize Cleo (chat header or Settings tab) and stored per admin in
`summer_profiles` (the old `business_tax_settings.assistant_*` columns are
unused). The
voice text lives in `src/lib/summer-persona.ts`. Custom instructions are
placed after the facts rules and can't override them.

`askSummer` builds a plain-text copy of the books for the selected year
(`src/lib/summer-context.ts`) and sends it with the last 16 messages. Cleo
reads; she cannot write. Messages are saved per admin in `summer_messages`
only after a reply comes back.

## Cleo as the admin assistant

She is available on every admin page, admin role only (`SummerAssistant`,
mounted in the admin layout):

- Floating button: tap to open or close her chat, press and hold to start a
  voice call. It sits above the mobile tab bar, moves up when a page has its
  own floating button (`html[data-page-fab]`), and hides on chat screens so
  it never covers the composer. There she is pinned at the top of the
  Messages inbox instead (row plus a call button).
- Top bar "Cleo" button and ⌘/Ctrl+Shift+S.
- Other screens open her with `openSummer({ year?, call? })`
  (`window` events `summer:open`, `summer:toggle`, `summer:close`).

What she sees (read-only, `src/lib/summer.server.ts` + `src/lib/summer-app.ts`):
the books plus clients (with ids), the next 14 days of calendar, check-ins
waiting, unread client messages, latest applications, open tasks and open
support alerts, the page the owner is on, and the admin pages she can link.
Links are markdown `[label](/admin/...)`; the chat only opens `/admin` paths
(and https in a new tab), so a made-up or unsafe link is shown as plain text.

Voice:
- Talking: the browser records (`useSummerMic`), stops by itself after a
  pause, and `askSummerVoice` transcribes through the AI gateway and answers
  in voice mode (short spoken answers). In a call she listens again after
  each answer; two silent turns end the call.
- Her voice: `summerSpeech` tries text-to-speech providers in order
  (ElevenLabs if `ELEVENLABS_API_KEY` is set, then gateway
  `openai/gpt-4o-mini-tts` with the `marin` voice, gateway Gemini TTS, then
  `OPENAI_API_KEY` if set) with a calm, neutral assistant style.
  `ELEVENLABS_VOICE_ID` (default Sarah) and `ELEVENLABS_MODEL` (default
  `eleven_multilingual_v2`) override the ElevenLabs voice. Longer replies are
  generated as an opening sentence plus the rest in parallel, so she starts
  talking sooner; the speed setting is sent to the voice instead of
  time-stretching the audio. If none answers, the browser speaks with the
  device's most natural English voice. Voice, auto-play and speed are per
  device (Customize Cleo).
- Giving her an accent: pick or design a voice that has it natively in
  ElevenLabs (Voice Library, or Voice Design from a description) and put its
  ID in `ELEVENLABS_VOICE_ID`. Don't prompt an accent into the OpenAI/Gemini
  style; prompted accents drift and sound put on. The fallback voices stay
  neutral on purpose. Keep `eleven_multilingual_v2`: it holds a voice's
  accent better than the faster models.
- Health check: `POST /api/public/hooks/summer-voice-check` with
  `x-hook-secret` reports which provider works.

Every admin gets their own Cleo: chat history (`summer_messages`) and
vibe/instructions (`summer_profiles`) are per person. Only the owner's Cleo
gets the BOOKS section; other admins get the app data plus unpaid sales, and
she tells them the books are private to the owner.

Staff invites (`/staff-setup?token=…`) create a separate login. Use an email
that isn't on a client account (for example a `+admin` Gmail alias), because
redeeming an invite for an existing email adds the role to that account.

