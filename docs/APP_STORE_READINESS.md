# JF Effect iPhone app: App Store readiness (Nov 25 2026)

Scope: the iOS build (`com.jfeffect.app`, Capacitor 8 shell that loads `https://jfeffect.com`,
built and uploaded to TestFlight by `.github/workflows/ios-build.yml`), measured against Apple's
current App Review Guidelines. Nothing here was submitted, and nothing in App Store Connect,
pricing or payments was changed.

Guideline sources (read Nov 25 2026):
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Nov 13 2025 update (5.1.2(i) third-party AI, 1.2.1(a) creator content, 4.1(c), 4.7):
  https://developer.apple.com/news/?id=ey6d8onl
- Oct 16 2026 update (2.5.19 bait-and-switch / undocumented features): https://developer.apple.com/news?id=vvzx6cul
- Jun 2026 update (1.2 UGC compliance plans, 4.3(b)): https://macrumors.com/2026/06/09/app-store-guidelines-low-quality-apps/
- Privacy manifests: https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests

## App Review rejection of 1.0 (build 35, June 23 2026)

Rejected for 2.3.8 (placeholder icons), 3.1.1 (purchase link-out to Safari via account
registration) and 3.1.1 (digital content bought outside the app used in it, not offered as
IAP). The first two are fixed in code (app_art.py and the icon checks in ios-build.yml;
`src/lib/native-purchases.ts`, walked by `native-shell-routes.test.ts`). The third is fixed by
option B, Jared's choice on Nov 25 2026: in the iOS app nothing digital bought outside the app is
unlocked, and self-serve members get the free app while coaching clients keep everything
(**docs/APPLE_IAP_DECISION.md**, section 5; `native-option-b.test.ts`). The build is now
iPhone only unless `IOS_SUPPORT_IPAD` is "true".

## Score

**65 / 100, and NOT READY: the critical blockers below override the score.** Submit only when
every critical blocker is closed, and only with Jared's explicit approval.

| Category | Score | Why |
| --- | --- | --- |
| Payments & business model (3.1.1, 3.1.3) | 14 / 20 | Nothing is sold or pointed to in the app (fixed today: three screens named jfeffect.com as the place to pay). 1:1 coaching fits 3.1.3(d), in-person training 3.1.3(e). Option B (Nov 25 2026): web-bought digital extras (credit packs, Premium, paid membership access) are neither shown nor usable in the app for self-serve members, enforced on the server too. |
| Privacy & data (5.1.1, 5.1.2, 5.1.3) | 14 / 20 | Built today: explicit, server-enforced, revocable consent before data goes to OpenAI / Google; privacy manifest now actually in the build. Already there: in-app account deletion. Open: migration not applied yet, privacy policy must name the AI providers, some coach-side AI paths not yet gated. |
| Minimum functionality / native value (4.2, 2.5.2, 2.5.19) | 8 / 15 | The app is the live website in a web view. Native parts: its own camera-roll plugin, camera and microphone, Apple Health (off by default), portrait lock. No native push, no offline screen. Website changes reach the app without review. |
| User-generated content & safety (1.2, 1.2.1(a), 1.4.1) | 8 / 10 | Built today: a server-side word filter on every Crew post, story, comment, bio and message request; Report on every post, story, comment and profile with Block in the same sheet; auto-hide after 3 reports; a staff queue with Remove / Keep / Warn / Suspend and a 24-hour clock; one-time Community rules; contact email in Help; blocks now also hide comments, opened posts and Rankings. Membership is approval-gated. Open: migration not applied yet, photos and clips are report-based (no image screening), no declared-age gate. |
| Stability & completeness (2.1) | 6 / 10 | Large vitest suite, CI web build; on-device regression not done here. Blank screen with no network. Stack traces were shown to users on a failed page (fixed today). |
| Build, signing, SDK (2.5, 2.4.1) | 8 / 10 | Xcode 26 / iOS 26 SDK, manual signing, purpose strings checked in the built app, export-compliance key, build number from the run. iPad is a supported device family by default (template `TARGETED_DEVICE_FAMILY = "1,2"`) but the app is phone-first. |
| Metadata & review readiness (2.1, 2.3) | 5 / 10 | Listing pack drafted (docs/APP_STORE_LISTING.md). No reviewer demo accounts, screenshots or public support page yet. |
| Release process | 2 / 5 | Every push to main uploads a TestFlight build; no release candidates, version bumps or rollback plan for the binary. Proposed below. |

## Critical blockers (any one of these means "do not submit")

1. **AI consent must be live before submission (5.1.2(i)).** The code is done (below), but it
   depends on migration `20270527107000_ai_data_consent.sql`. The server fails closed: deploy
   the code before the migration is applied and every client/member AI feature stops. Apply the
   migration first, then deploy.
2. **Privacy policy must match (5.1.1(i), 5.1.2(i)).** The published policy (`/legal/privacy-policy`)
   must name OpenAI and Google (Gemini) as processors of personal data for AI features, say the data
   may be processed outside Canada, describe the in-app permission and how to withdraw it
   (Account → Privacy & data → AI processing), and describe deletion (30-day Recently deleted, then
   deleted; payment and session records kept by law). docs/legal/COACH_PLATFORM_DRAFTS_2026-11.md
   section E has the redline points. Jared + counsel. Drafted: migration `20270527109400_privacy_policy_service_providers.sql` saves the next Privacy Policy version as a draft with a "Service providers and AI processing" section and "Last updated: November 25, 2026"; read it in Admin → Legal, have counsel check it, then publish.
3. **~~Objectionable-content filter for Crew (1.2).~~ RESOLVED in code (Nov 25 2026); apply
   `20270527109000_crew_ugc_safety.sql` before the code deploys** (the queue's actions and the
   rules prompt call its functions; old builds' Report and Remove / Dismiss keep working). What
   Apple's four musts now map to:
   - *Filter before posting:* `crew_text_verdict` (same lists and steps as
     `src/lib/crew-content-filter.ts`, tested for parity) runs in database triggers on every Crew
     post / story caption, quote and sticker text, comment, bio and message request. Slurs, sexual
     content and threats are refused with a neutral message; borderline words (insults, sexual
     spam, possible threats, self-harm) are saved and flagged into the queue. Case, accents,
     l33t, stretched, spaced or dotted letters and zero-width characters can't get round it;
     whole words only. Photos and clips are report-based (no image screening).
   - *Report with a timely response:* Report on every post, story, comment and profile (⋯),
     reasons (spam, harassment, hate, sexual content, violence, self-harm, dangerous advice,
     other), a confirmation, and Block from the same sheet. What you report disappears for you at
     once; 3 independent reports (configurable, 2 to 20) hide it for everyone until staff decide.
     Staff get a push (held through quiet hours) and work it in Crew → Manage → Needs you →
     Reports: Remove, Keep, Warn, Suspend posting (1 / 7 / 30 days), each item showing its
     24-hour response clock; every action is logged (`community_moderation_actions`).
   - *Block abusive users:* Block on profiles, posts, stories and in the report sheet; it hides
     both people's posts, stories, comments, opened posts, profiles, messages and Rankings rows
     from each other.
   - *Published contact:* support@jfeffect.com in Account → Help & Tutorials and in the
     Community rules, which everyone accepts once (zero tolerance) before a first post or comment.
   - *Moderation plan for App Review (June 2026), proposed, Jared to confirm:* the four points
     above, plus: every report answered within 24 hours by Jared or staff (the queue shows the
     clock), a removal can't be undone by its author, and repeat offenders are warned, then
     suspended, then removed from Crew.
4. **Reviewer access (2.1).** Membership needs Jared's approval, so App Review cannot sign up and
   get in. Create the two demo accounts in docs/APP_STORE_LISTING.md (synthetic data only), make
   sure they are approved, not two-step, and say so in the Review Notes.

## High (fix before submission or accept the rejection risk knowingly)

5. **Minimum functionality (4.2) and remote code (2.5.2 / 2.5.19).** A web view of the website is
   the most common rejection pattern for this kind of app. What helps the case, in order of value:
   native push notifications (APNs through `@capacitor/push-notifications`; web push doesn't work
   inside the app's web view, so today the iPhone app gets no notifications at all), Apple Health on
   (`ENABLE_HEALTHKIT`, needs the App ID capability and a regenerated profile), an offline screen
   (Capacitor `server.errorPath` with a bundled page; not added today because WebKit also reports
   cancelled navigations as failures, which would need on-device testing), native haptics.
   Because the site updates the app without review, never ship a significant new feature to the app
   without describing it in the next submission's Review Notes (2.3.1(a), 2.5.19).
6. **Remaining coach-side AI paths are not yet consent-gated.** Gated today: Generate Next Program
   (and retry, and Interpret), Adjust program, Nutrition Update plans / revisions / plan edits,
   Cardio's Cleo, the client brief, form reply drafts, check-in recaps, coaching automation drafts,
   Cleo in a client's own conversation, voice-memo transcripts, pain reading. Not yet: Cleo's
   general conversation (its look-ups can read any client the coach sees), athlete roadmap words,
   nutrition roadmap words, Athlete Insights / Crew lesson posts that use athletes' numbers,
   competition assessments and roster extraction. Fix: filter Cleo's client look-ups by
   `ai_consent_ok_for_client`, and call `requireClientAiConsent` in each remaining writer.
7. **iPad (2.4.1). DONE: iPhone only by default.** Build 35 was reviewed on an iPad. The workflow
   now sets `TARGETED_DEVICE_FAMILY = 1` unless the repository variable `IOS_SUPPORT_IPAD` is
   "true" (then test every main flow on an iPad and supply 13-inch screenshots first).
8. **Age gate (1.2.1(a)) and age rating.** Crew is open user content and private messaging. Add a
   declared date of birth (or "I'm 16 or older") at sign-up, keep under-age accounts out of Crew and
   direct messages, and answer the age-rating questionnaire as in the listing pack.
9. **AI credits bought on the web are used in the app.** See the payment mapping; needs a decision.

## Medium / low

- Pods are built for iOS 16 while the app target keeps the template's 15.0: set
  `IPHONEOS_DEPLOYMENT_TARGET = 16.0` on the app target in the pbxproj patch.
- `openTestFlight()` ("Update in TestFlight") shows only to builds older than 1842, so never in an
  App Store build; once the app is live, point it at the App Store page instead.
- Coaching agreement's "AI-Assisted Coaching Disclosure" names no provider: update it with the
  privacy policy (blocker 2) so the two say the same thing.
- Medical framing (1.4.1): pain map, injury and recovery features already carry the medical
  disclaimer; keep "check with a doctor" wording on pain reports.

## Fixed in this change

| Fix | Where |
| --- | --- |
| Explicit permission before personal data goes to third-party AI: names OpenAI and Google (Gemini) and what each is used for; asked once per app open until answered (clients and members), and again at the point of use when the server refuses; Allow re-runs the action; withdraw or give it any time in Account → Privacy & data → AI processing; every answer recorded with its wording version | `supabase/migrations/20270527107000_ai_data_consent.sql`, `src/lib/ai-consent/`, `src/components/ai-consent/ai-consent.tsx`, portal layout, signed-in layout, Account page |
| Server enforcement, failing closed, before any model call: the person's own features (meal estimates via `withAiCredits`, program and meal-plan imports and Create with Cleo, pain reading and pain voice, voice-memo transcripts by speaker) and the coach-side paths listed in item 6 | `consent.server.ts` and the callers; tested in `src/test/ai-consent.test.ts` |
| Graceful degradation: pain reading keeps the app's own reader, pain voice says to type it, a voice memo stays a memo, coach-side drafting fails with the coach's words ("<name> hasn't allowed … do it by hand"), Nutrition Update plans show that reason on the coach's card, coaching automation items fail with it | same |
| Privacy manifest actually shipped: it lived under `ios/`, which the build deletes before `cap add ios`, so no build ever contained it. Moved to `native/ios-app/PrivacyInfo.xcprivacy`, rewritten from what the app collects, copied in and added to the App target's Resources every build, and checked in the built app | `.github/workflows/ios-build.yml` |
| Apple Health write purpose string no longer reads like a placeholder | same workflow |
| App Store build no longer points to an outside purchase ("Available at jfeffect.com", "Upgrades are made on the web at jfeffect.com", "Manage billing at jfeffect.com") | `upgrade-cta.tsx`, `portal/plan.tsx`, `portal/membership.tsx` |
| A failed page no longer shows a JavaScript stack trace to the person (still reported) | `router-error-fallback.tsx` |

Account deletion was verified, not changed: Account → Privacy & data → Delete my account
(`DeleteAccountPanel` → `requestAccountDeletion`), available to every client and member in the
app, with a 30-day restore window that the sheet states. Staff logins can't delete themselves in
the app; they are not self-signup accounts, so 5.1.1(v) doesn't require it.

Purpose strings verified (set every build, checked in the built app): camera, microphone, photo
library read and add; Apple Health read and update when `ENABLE_HEALTHKIT` is on. iOS has no
Info.plist purpose string for notifications (and the app has no native push yet); location,
contacts and tracking are not used, so no strings are declared for them.

Client-reachable dev-only UI: none found beyond the stack trace above. Admin test tools (Send test
email / SMS) are behind staff routes; the Lovable email preview routes are server endpoints with a
secret.

## Payment mapping

**Decision (Jared, Nov 25 2026): Premium is web-only.** JF Effect Premium and any other digital
product (paid membership, credit packs) is bought on the website only; there is no in-app purchase
in the launch version. The iPhone app (the Capacitor shell, `isNative()`) never shows a purchase
button, a price or a link to buy it, and never says where else to buy. Someone who already has
Premium, credits or a paid membership gets the free app in iOS unless they're a coaching client
or staff (option B, below). Enforced by `src/lib/native-purchases.ts` (tested in
`native-purchases.test.ts`): Your plan lists no plan that needs a purchase and prints no price for
one the person isn't on (the refusal reads "Not available in the app", no longer "Upgrade on the
web at jfeffect.com"), Crew promos that point at a sales page are not shown in the app, and the
locked-feature card and credit packs already say it isn't available. App Review raised it
(build 35's second 3.1.1 finding): a holder who bought on the web used it in the app. Jared chose
option B: `digitalPaidAllowed` (native-purchases.ts) keeps Premium, paid access keys and bought
credits off for self-serve members in the app, on the screens and on the server
(docs/APPLE_IAP_DECISION.md, section 5). Since that rejection the app also opens no sales, pricing,
checkout or billing page at all and says nothing about buying (native-purchases.ts).

Table below: the mapping as analysed before the decision (rows for membership, credit packs and
paid programs are now "web only, hidden in the app").

| What is sold today (Stripe, on the web) | Apple rule | Status in the app today | Most sensible compliant structure |
| --- | --- | --- | --- |
| 1:1 online coaching (monthly `coaching_packages` subscriptions, custom programming, check-ins, chat, calls with a named coach) | 3.1.3(d) Person-to-Person Services: "real-time person-to-person services between two individuals (for example … fitness training)" may use other payment methods | Not sold in the app; existing clients sign in | Keep Stripe, sold outside the app. Review Notes describe it as personal training by an individual coach. Risk: App Review may treat the asynchronous parts (programs in the app) as digital content; the answer is that the program is written by and for one person by their coach. |
| In-person personal training packages (Selkirk) | 3.1.3(e) Goods and Services Outside of the App: must NOT use in-app purchase | Not sold in the app | Keep Stripe. Could even be sold in the app later with Apple Pay / card entry, no IAP. |
| 1:1 calls (General Call, Discovery Call) | 3.1.3(d) | Booked on the web | Keep as is. |
| Self-serve paid membership (`membership` package kind; none sold yet) | 3.1.1: unlocking features or content needs in-app purchase; 3.1.3(b) lets web purchases be used in the app only if also offered as IAP | Not sold | Before selling it to anyone who uses the iPhone app: add it as an auto-renewable IAP at the same price (Apple Small Business Program: 15%), or keep it web-only and accept rejection risk. Decision for Jared. |
| AI credit packs (100 / 300 / 1,000, web only) | 3.1.1 consumables; 3.1.3(b) | Not sold in the app; a self-serve member in the app spends and sees only the month's free credits (option B) | Done: option B. Consumable IAPs only if in-app sales are wanted later (option A). |
| Coach platform subscription for independent coaches (decided, not built) | B2B; closest fit 3.1.3(c) is for organisations' employees, so not a clean fit | Not built | Sell on the web only; the app stays a free client with no purchase or mention of price. Re-check before launch. |
| Paid programs or plans as digital products (if ever sold) | 3.1.1 | None sold | IAP, or web-only and not unlockable in the iOS app. |

US storefront only: since 2025 apps on the US storefront may include buttons and links to web
checkout (3.1.1(a)). JF Effect's main market is Canada, where that is not allowed, so the app says
nothing about buying anywhere. A US-only "Upgrade on the web" button would need native storefront
detection; not worth it now.

## Manual actions only Jared can do

1. Approve and apply migration `20270527107000_ai_data_consent.sql` before deploying this code.
2. Update and publish the Privacy Policy (blocker 2) and the AI disclosure; have counsel review.
3. Decide the payment questions above (membership IAP, credit packs).
4. App Store Connect: app record details, Health & Fitness category, age-rating questionnaire,
   App Privacy answers, price Free, availability (countries), screenshots (6.9-inch iPhone; 13-inch
   iPad unless iPhone-only), support URL, Review Notes, demo accounts, contact person.
5. Create the two reviewer demo accounts with synthetic data (plan in the listing pack) and keep
   them approved and working through review.
6. Publish a public support page (for example jfeffect.com/support) with support@jfeffect.com;
   the in-app Support page needs a login, which App Store Connect's Support URL can't.
7. HealthKit: enable the capability on the `com.jfeffect.app` App ID, regenerate
   "JF Effect App Store Distribution", update `PROVISIONING_PROFILE_BASE64`, set
   `ENABLE_HEALTHKIT=true`. Only if Apple Health is in the first release.
8. Native push (if pursued): APNs key and Push Notifications capability on the App ID.
9. EU distribution only: Digital Services Act trader status in App Store Connect.
10. Final go / no-go and the submit button.

## Release process

**Versioning.** `package.json` `version` is the marketing version (`MARKETING_VERSION`, SemVer:
1.0.0 for launch, minor for a release with new native capability or a notable feature, patch for
fixes). The build number is the GitHub run number (`CURRENT_PROJECT_VERSION`), always increasing.
Bump `version` in the same commit that starts a release candidate; never reuse a version that
reached the App Store.

**Builds and release candidates.**
- Every push to `main` keeps uploading a build to TestFlight (internal testers only).
- A release candidate is a manual run of "iOS Build and Upload" (`workflow_dispatch`, upload on)
  from a commit tagged `ios-vX.Y.Z-rcN`, after the web build check passed on that commit.
- The RC goes to the external TestFlight group (Jared, staff, two or three clients) for at least
  48 hours; any crash or blocker means a new RC.
- Submit the RC build to App Review only with Jared's explicit go, with Review Notes updated for
  everything new since the last approved version (2.3.1(a)).

**Regression checklist (on a physical iPhone, on the RC build, as a member and as a client).**
Sign in, sign out, password reset; cold start lands on Crew; AI-processing prompt (Allow, Don't
allow, change in Account); log a workout in list and Focus view, PR celebration, rest timer
sound; film a set (camera and microphone prompts, upload, velocity view); New post from the
camera roll (photo prompt, limited access, Manage); story with sticker; Crew like, comment,
report (post, story, comment, profile) and block; Community rules on a first post; a refused
word and a flagged one; staff Remove / Keep / Warn / Suspend; coach chat text, photo and voice memo; meal estimate (consent prompt if not
allowed) and food log; program import; pain map; Account: Your plan (upgrade says not available in
the app), Credits (no packs), Privacy & data (AI processing, Delete my account up to the confirm
step), Deactivate; portrait lock while rotating; no network at launch and mid-session; dark and
light mode; Apple Health connect if enabled.

**Crash and error monitoring.** App Store Connect / Xcode Organizer crash reports and TestFlight
feedback for the native shell; `report_page_error` support alerts (with the build stamp
`JFEffectApp/<build>` in the user agent) for page failures and camera trouble
(`reportCameraTrouble`); Insights → App & website for adoption by platform. Check all three daily
for the first week after release.

**Migration safety.** The app loads the live site, so a web deploy reaches every installed
version at once: migrations are additive and idempotent, applied before the code that needs them
(this change's consent migration is the example: its code fails closed without it), and never
remove a column, function or route an older page still in someone's web view calls until a
release later. Native changes (plugins, plist keys, entitlements) must keep working against the
current website and the website must keep working in the previous binary (`nativeAppBuild()`
gates features by build number).

**Rollback.**
- Website / server: redeploy the previous commit; database changes have their rollback script in
  `docs/rollback/` (this change: `2026-11-25-ai-data-consent-rollback.sql`, with an emergency
  switch that is not compliant and only for an outage).
- Binary: an approved App Store version can't be rolled back. Fix forward with an expedited review,
  or temporarily remove the app from sale in App Store Connect; use phased release (7 days) for
  every update so it can be paused. Keep the previous archive (the workflow keeps it 7 days as an
  artifact; download it for each App Store release).
