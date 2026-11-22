# JF Effect for coaches: business, pricing and launch plan (Nov 22 2026)

Written for the owner. It answers the brief "Complete platform marketing,
coach business system and monetization" with what was audited, what was
built and shipped to the branch, what was deliberately not built yet, and
what needs his, a lawyer's or an accountant's decision. The technical plan
for isolation lives in `docs/COACHING_PLATFORM.md`; the legal drafts in
`docs/legal/COACH_PLATFORM_DRAFTS_2026-11.md`.

## 1. Where things stand

| Piece | State | Where |
|---|---|---|
| Free app marketing | Built: "Serious tools. Serious progress." then "$0. Yes. Free." inside the app section | `landing-page.tsx` |
| Coaching marketing | Built: the coaching price reveal ("Complete coaching is $130 a month.") from the published packages, never typed | `coachingPriceTitle` |
| Coach marketing | Built: `/coaches` (early access, honest about what exists), a band on the home page, "For coaches" in the nav | `coaches-page.tsx` |
| Coach early-access application | Built: 8 questions, privacy notice ticked, marketing consent separate and unticked, rate limited, owner push | `/coaches/apply`, `coach_platform_applications` |
| Seat pricing engine | Built and tested: who counts, the fee, volume step, proration preview, Stripe tiers and quantity, idempotency key, unit economics | `seat-pricing.ts` |
| Owner's Coach platform page | Built: applications, pricing calculator and recommendation, coach billing preview, publish-a-price switch (with history), launch gates, capability matrix | `/admin/coach-platform` |
| Price shown publicly | **Off** until the owner publishes it from the page above | `app_settings 'coach_platform'` |
| Independent coach workspaces | **Built, not applied.** Only the platform owner can make a pilot workspace, only with the pilot on, which refuses while any client table is unfenced. Registration stays closed | `20270510090000_coach_workspaces.sql`, `/workspace` |
| Organization isolation | **Built, not applied** for the database: the tenant fence on every client table, an allow-list for workspace teams; 131 checks pass. Coach tools beyond programs, definer functions, storage and Cleo still to do | `supabase/tests/coach-workspaces`, `COACHING_PLATFORM.md` §7 |
| Client invitations to a business | **Built, not applied**: link + proven email (login or 6-digit code), consent kept word for word, pause / end / come back, one record per login | `/invite/$token` |
| Seat billing in Stripe | **Built, test mode only** (section 5): never reaches a live key; not yet run against a real Stripe test account | `coach-billing.ts` |
| AI allowance per business | **Built, numbers proposed** (section 5b): credits per feature, monthly allowance from each paid client's price, hard spend cap, real cost kept per call | `ai-allowance.ts` |
| Stripe Connect for coaches' client payments | **Not built**, after the pilot | `COACHING_PLATFORM.md` Phase 5 |
| Coach legal documents | Drafts, need counsel | `docs/legal/` |

Nothing in this change charges anyone, creates a business, grants a role or
lets an outside coach see anything. The only new public promise is the
waitlist, and the page says it's a waitlist.

### Verified before writing the marketing

- **No card to join:** `/join` is an application with no payment step
  (`membership-application.tsx`, `submitMembershipApplication`).
- **"Nothing turns into a charge later":** members pay nothing; AI credits
  beyond the free monthly allowance are optional packs on the web only.
- **Coaching price:** Complete Online Coaching is the only listed paid
  package ($130/month, `coaching_packages`); Nutrition Coaching ($99) and
  Coaching Plus ($249) are drafts. The headline reads "is" until a higher
  plan is listed, then "starts at".
- **Every coach tool on `/coaches`** exists in the app today for JF Effect's
  own coaching (clients list with attention signals, spreadsheet-style
  builder with progress across weeks, nutrition plans and food log, weekly
  check-ins and forms, set videos with load and bar speed, analytics, setup
  links). None is available to an outside coach yet, and the page says so.
- **No autonomous AI exists for anyone:** every Cleo action is a card the
  owner approves; every draft is reviewed. The capability matrix
  (`capabilities.ts`) keeps any future autonomous feature owner-only.

## 2. Pricing

### The brief's proposal

`monthly fee = max(0, billable clients − 1) × $5 CAD`, no base fee, taxes on
top: 1 client free, 5 → $20, 10 → $45, 20 → $95, 50 → $245, 100 → $495.

### What coaches pay elsewhere (CAD a month, seen Nov 22 2026)

Converted at 1.43 CAD/USD (Bank of Canada ~1.4257 on Nov 13). Mostly from
third-party pricing pages (the vendors' own pages couldn't be fetched from
the research session); recheck before quoting.

| | 1 | 5 | 10 | 20 | 50 | 100 | Free tier |
|---|---|---|---|---|---|---|---|
| **Proposal** | **0** | **20** | **45** | **95** | **245** | **495** | 1 client |
| **Recommended** (below) | **0** | **20** | **45** | **95** | **195** | **345** | 1 client |
| Trainerize | 0 | 35.75 | 71.50 | 112.97 | 193.05 | ~286 | 1 client |
| Everfit | 0 | 0 | 41.47 | 70.07 | 135.85 | ~236 | 5 clients, limited |
| Hevy Coach | 35.75 | 35.75 | 35.75 | 71.50 | 128.70 | 228.80 | trial |
| TrueCoach | – | 42.87 | 100.07 | 100.07 | 235.92 | custom | trial |
| CoachRx | 41.47 | 41.47 | 112.97 | 112.97 | 112.97 | 284.57 | trial |
| Kahunas | – | 35.75 | 71.50 | 143.00 | 143.00 | – | none ($5 USD/seat, less at 25+) |
| PT Distinction | 28.46 | 45.62 | 85.66 | 85.66 | 171.46 | 343.06 | listed |
| My PT Hub | – | ~74 | ~74 | ~74 | ~74 | ~74 | trial (unlimited) |

Sources: quickcoach.fit (Trainerize, Everfit 2026), uscreen.tv, fitbudd.com
(Oct 2026), capterra.com, toolradar.com (Hevy Coach, CoachRx, Kahunas, PT
Distinction, My PT Hub, Nov 2026), coachway.io (Kahunas per-seat change).

**Reading:** the proposal is the cheapest paid option from 1 to about 10
clients, mid-pack at 10, and among the most expensive from ~20 up (more than
My PT Hub from ~18 clients, more than Hevy from ~27, most expensive at 50).
Linear per-client pricing punishes exactly the coaches who would be the best
customers.

### Recommendation

1. **Keep the offer the brief wants:** first client free, $5 CAD a client,
   no base fee, no contract, taxes on top. It's simple, it's the cheapest
   way to start, and "Your first client is free" is a true, strong line.
2. **Add one volume step: $3 a client from the 26th.** Still one sentence
   ("Your first client is free. $5 a month for each client after that, $3
   from your 26th. No base fee."). Same price up to 25 clients; $195 at 50
   (competitive with Trainerize's $193), $345 at 100. In Stripe it's a
   graduated tiered price (`stripeTiers`), no custom code.
3. **Include an AI allowance per paid client and meter heavy use.** AI drafts
   (programs, nutrition plans) are the largest cost a client brings. At
   heavy use (~$2.40 a client) a 2-client coach loses money and a 100-client
   coach is at ~3% margin. A monthly allowance that scales with paid clients
   (e.g. a set number of program and nutrition drafts per paid client),
   with the existing AI credits for more, keeps the price honest and the
   business safe. The free client gets a small allowance.
4. **Keep text messages out of the coach plan.** Push and the chat already
   cover reminders; SMS is $0.015–0.017 a segment and was the app's biggest
   messaging cost line before the Nov 13 cost guard.
5. **Founding pricing:** publish it as founding pricing for the pilot and
   promise early coaches 12 months' notice before any increase. That's a
   promise you can keep and costs nothing now.

The owner decides. The calculator on `/admin/coach-platform` → Pricing shows
both, with every cost editable. Nothing is published until he flips the
switch, which records who and when (`coach_platform_pricing_history`).

### Who counts (billable client)

A relationship, not a person on a list: accepted invitation, currently
active (not paused, ended, archived or removed), not the coach's own or a
team member's account, one seat per person however many records. Never:
unaccepted or expired invitations, imports, free members with no
relationship. The free client belongs to the business: drop from 2 to 1
and the one left is free. "Paused" means the coach can't program or message
that client, so it isn't a loophole. (`countSeats`, `BILLABLE_DEFINITION`.)

## 3. Unit economics

### Cost inputs (list prices, Nov 22 2026)

| Item | Price | Source |
|---|---|---|
| Supabase Pro | $25/mo; 8 GB DB, 100 GB files ($0.0213/GB after), 250 GB egress ($0.09/GB after) | supabase.com docs |
| Mux (feed copies) | basic encoding free; ~$0.0024/min/month storage; 100k delivery min free | mux.com/docs/pricing |
| OpenAI | gpt-5-mini $0.25/$2.00 per 1M in/out; GPT-5.5 $5/$30; GPT-6 Astra $10/$50 | OpenAI pricing |
| Stripe Canada | 2.9% + C$0.30 card; Billing 0.7%; Tax 0.5% | stripe.com/en-ca/pricing |
| Stripe Connect | Stripe-priced: no platform fee; platform-priced: C$2/active account + 0.25% + C$0.25 per payout | stripe.com/connect/pricing |
| Twilio SMS (CA) | ~$0.015–0.017 a segment with carrier fees | twilio.com |
| **Manitoba RST** | **7% on software and cloud services from Jan 1 2026**, self-assessed on US vendors that don't collect it | Bill 46 (S.M. 2025 c. 48), Bulletin 033 |

### Per client, a month (moderate use, CAD, estimates)

Database and storage 20¢, AI 100¢ (weekly check-in reads on GPT-5 mini, a
monthly nutrition draft and a quarterly program draft on the top models),
video 15¢ (~8 set videos stored and watched once), support 25¢, plus 7% RST
on the cloud lines and 50¢ per coach account. Fees on the coach's invoice:
2.9% + 0.7% + 0.5% + C$0.30.

| Clients | Pays (recommended) | Cost | Fees | Left | Heavy AI use |
|---|---|---|---|---|---|
| 1 | free | $2.19 | – | **−$2.19** | −$3.69 |
| 2 | $5 | $3.89 | $0.51 | $0.60 (12%) | −$2.40 |
| 5 | $20 | $8.97 | $1.12 | $9.91 (50%) | $2.42 (12%) |
| 10 | $45 | $17.45 | $2.14 | $25.41 (56%) | $10.43 (23%) |
| 20 | $95 | $34.39 | $4.19 | $56.42 (59%) | $26.46 (28%) |
| 50 | $195 | $85.23 | $8.29 | $101.48 (52%) | $26.58 (14%) |
| 100 | $345 | $169.95 | $14.44 | $160.61 (47%) | $10.81 (3%) |

**Free tier exposure:** 1,000 coaches on the free client alone cost about
$2,200 a month. Keep the free client's AI allowance small, and archive a free
workspace's media after 12 months with no activity (with notice).

These are estimates from list prices and the app's own usage patterns, not
measured per-client costs. Once a pilot runs, replace them with measured
numbers from the AI call logs and storage.

## 4. Coach billing dashboard (what the coach will see)

Exactly the brief's layout, from `seatSummary`: "12 Active clients · 1 Free
client · 11 Paid clients · Your monthly platform cost: $55 + tax", then next
billing date, projected next invoice, payment method, invoices, cancel. The
owner's page shows a live preview of it for any client count, plus what
adding one more client would say (`seatChangePreview`).

## 5. Seat billing (built, test mode only)

**Pricing direction (the owner, Nov 22 2026):** no base fee; the first active
client free; CAD $5 a client through the 25th; $3 from the 26th. This is the
default every new workspace's billing row freezes (`organization_billing.pricing`,
from `app_settings 'coach_platform'`), never published until the owner flips
the switch, and no founding-coach guarantee is committed.

What was built differs from the design below in three places, on purpose:

1. **A client is never held up by the coach's card.** The second client is
   accepted straight away; the workspace moves to `needs_setup` and has 14
   days to add a card (`writeAccess` / `org_can_write`). After that it reads
   but can't write. The coach's invite screen still says what the next
   client costs before they send it.
2. **Back to the free tier keeps the subscription at quantity 0** (a $0
   invoice) rather than cancelling, so the next paid client needs no new
   Checkout.
3. **Reconciliation** applies a recorded seat change that never synced, and
   corrects an unexplained difference only downward; anything that would raise
   the bill is flagged for the owner (`reconcile`).

Still to do before a live run: recording consent to the billing terms in
`legal_acceptances` (needs counsel's billing terms), the coach-platform
revenue source in the books, Stripe Tax registrations, and an end-to-end run
on a Stripe test account (needs `STRIPE_SECRET_KEY_TEST` and
`COACH_BILLING_WEBHOOK_SECRET_TEST`, and the webhook endpoint added in
Stripe's test dashboard).

### The original design

Stripe Billing on JF Effect's own Stripe account, kept apart in the books.

- **Product** "JF Effect for coaches", one recurring monthly price in CAD,
  `tax_behavior: exclusive`, graduated tiers from `stripeTiers(pricing)`.
  **Quantity = paid clients** (`stripeQuantity`); the free ones are never a
  line. A price change is a new price; existing subscriptions move only with
  notice (the agreement's 30 days, founding coaches 12 months).
- **First paid client:** before the second client is accepted, the coach
  sees the exact new total and monthly billing in words, ticks an unticked
  box (recorded in `legal_acceptances` with the billing terms' version) and
  completes a Stripe Checkout in subscription mode. The client's seat is
  added only after `checkout.session.completed`. No card is needed for the
  free client.
- **Later changes:** accepting, ending, pausing or archiving a relationship
  bumps the organization's `seat_revision` under a per-organization advisory
  lock and queues a `coach_seat_sync` row. A worker sets the subscription
  quantity with `proration_behavior: create_prorations` (credits and charges
  land on the next invoice; a few dollars charged on its own would lose a
  large share to the 30¢ card fee) and the idempotency key
  `seatSyncKey(sub, revision, quantity)`, so retries are one update and two
  changes are never collapsed. Back to the free tier: the subscription
  cancels at period end.
- **Webhooks:** the existing claim/release idempotency (`stripe_webhook_events`)
  for `invoice.paid`, `invoice.payment_failed`, `customer.subscription.*`;
  a failed payment gets a 14-day grace with notices, then paid seats are
  paused (read-only), never deleted. **Reconciliation:** nightly, Stripe's
  quantity against the database's count; a mismatch is fixed toward the
  database and logged, and anything that would raise a bill is held for the
  owner instead of applied.
- **Never billed:** imports, invitations, duplicates, the coach's own
  account, or a migration that touches relationships.
- **Books:** a `coach_platform` revenue source in `normalizeRevenue`, so
  SaaS revenue is never mixed with coaching revenue or the coach's own sales.
- **Tax:** Stripe Tax with registrations for GST/HST (by the coach's
  province), Manitoba RST, and BC PST / Quebec QST once their thresholds are
  crossed. Foreign coaches are likely zero-rated exports; the accountant
  confirms.

## 5b. AI allowance (built; the numbers are proposals)

Coaches' AI costs more per use than anything a member triggers, and the
spread is wide: a check-in summary on GPT-5 mini is about US$0.005, one
program strategy on GPT-6 Astra measured US$1.20 to 2.50 (Nov 9 benchmark),
a full "Generate a program" run about US$4. Unlimited AI at $5 a client
would lose money on any coach who generates programs often. So
(`src/lib/coach-platform/ai-allowance.ts`, tested):

- **Credits per feature**, fixed so a coach can plan: 1 credit = US$0.05 of
  model cost. Ask Cleo 2, adjust a program 4, adjust a nutrition plan 6, read
  a file 8, draft a nutrition plan 22, generate a program 90. Check-in
  summaries, reply drafts, form drafts and exercise search are included (each
  under a cent). Each price sits near its estimate's 75th percentile
  (estimates from list prices and the token sizes the prompts use).
- **Monthly allowance**: 20 credits for every workspace, plus 23% of each
  paid client's price in credits: 16 for a $5 client, 10 for a $3 one. At
  50 clients that's 654 credits; every credit used would cost about 24% of
  seat revenue, a typical month about half that.
- **Hard cap** on what calls really cost (US$, from tokens), 1.5x the
  credits' value (never under US$3), and 40% of it a day: a runaway loop
  stops the same day whatever the credits say.
- **Credit packs (proposed, web only, never in the native apps)**: 200 for
  C$25 and 600 for C$69 + tax, about 35 to 39% margin even if every credit is
  used.
- **Real costs**: every call's model, tokens and cost is kept per business
  (`org_ai_usage`), and `calibrate()` reprices each feature from its measured
  75th percentile once it has 5 calls. The first calibration should read
  production's existing call logs (`program_intel_job_calls`,
  `nutrition_ai_plans`, `ai_credit_events`), read-only, with the owner's
  approval.

A proposal to decide alongside it: independent workspaces could default to
GPT-5.5 for program strategy and review (about half Astra's cost) and keep
Astra as an option that costs more credits.

## 6. App Store and Google Play

Selling a per-client subscription inside the native apps would require
Apple / Google in-app purchase in Canada (Apple 3.1.1; the enterprise
exception 3.1.3(c) may not cover a solo coach; the US-only link-out rules
don't apply to Canada). So: **coach sign-up, pricing and billing are web
only.** The native apps never show a coach price, an "Add seats", "Upgrade"
or "Buy" button, a link to the coach page or a billing portal, or a
seat-limit message that says where to buy. Hide with `isNative()`, as the AI
credit packs already do. Clients paying their coach for one-on-one training
falls under 3.1.3(d) (real-time person-to-person services) and isn't
affected.

## 7. Cleo and the owner's privileges

Independent coaches get insight, analysis and drafts they review
(`capabilities.ts`). Anything that reaches a client or changes training,
nutrition or money without a person approving it is the platform owner's
only, and today nothing does that for anyone. Platform administration is
never an organization owner's. Enforcement will be in SQL and the server
(`cleo_allowed()` per organization, action kinds mapped to the coach's own
permissions), per `COACHING_PLATFORM.md` Phase 4.

## 8. Legal, privacy and tax

Drafts and the review list are in
`docs/legal/COACH_PLATFORM_DRAFTS_2026-11.md` (sections A–H from the first
pass, I–P added now: fees and recurring billing, acceptable use, subprocessors,
security incidents, retention, minors, the waitlist's privacy notice, tax and
app stores). Nothing there is published; nothing is legal advice. Needs:

- **Canadian lawyer:** the independent coach agreement with billing terms,
  the data processing addendum, the privacy policy update, the AUP, and the
  waitlist notice (already in use: it's short and states purpose, no
  sharing, deletion on request).
- **Accountant:** GST/HST place of supply, Manitoba RST registration and
  self-assessment on cloud bills (likely required now, not only when coaches
  pay), BC PST / QST thresholds, zero-rating for foreign coaches.
- **Owner:** the price, the volume step, the AI allowance, founding pricing,
  and whether independent coaches' clients join the Crew.

CASL: the application's privacy notice covers emails about the application
(implied consent from an inquiry lasts 6 months); marketing needs the
separate unticked box, which is stored word for word with its time, and
every marketing email needs identification and a working unsubscribe.
Anyone can type someone else's email into a public form, so the waitlist's
marketing consent is unverified: confirm it with a one-click email (double
opt-in) before the first marketing email goes to anyone. No marketing sender
exists for the waitlist yet.
PIPEDA: for coaches' clients JF Effect is a service provider; the coach stays
accountable; every breach of safeguards is recorded for 24 months.

## 9. Order of work from here

1. Owner: review this doc and the pricing calculator; publish a price or not.
2. Counsel and accountant on section 8 (in parallel with 3–6).
3. Isolation: tenant fence, org-scoped staff access, server checks
   (`COACHING_PLATFORM.md` Phase 3, steps 1–3).
4. `organization_clients` and client invitations (accept with an existing
   account; end without losing history).
5. Isolation test suite: zero cross-business reads.
6. Seat billing in Stripe test mode (section 5), with the AI allowance.
7. Coach workspace UI on the existing screens, scoped by organization.
8. Pilot with a few coaches from the waitlist; measure real costs.
9. Then Connect for coaches' client payments.

Registration stays closed in SQL (`coach_platform_public()`), and the launch
gates on the owner's page show what's left.
