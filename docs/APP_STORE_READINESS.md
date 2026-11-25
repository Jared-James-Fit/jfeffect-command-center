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

## Score

**63 / 100, and NOT READY: the critical blockers below override the score.** Submit only when
every critical blocker is closed, and only with Jared's explicit approval.

| Category | Score | Why |
| --- | --- | --- |
| Payments & business model (3.1.1, 3.1.3) | 14 / 20 | Nothing is sold or pointed to in the app (fixed today: three screens named jfeffect.com as the place to pay). 1:1 coaching fits 3.1.3(d), in-person training 3.1.3(e). Open: web-bought AI credit packs and any future paid membership are digital and used in the app (3.1.1 / 3.1.3(b)). |
| Privacy & data (5.1.1, 5.1.2, 5.1.3) | 14 / 20 | Built today: explicit, server-enforced, revocable consent before data goes to OpenAI / Google; privacy manifest now actually in the build. Already there: in-app account deletion. Open: migration not applied yet, privacy policy must name the AI providers, some coach-side AI paths not yet gated. |
| Minimum functionality / native value (4.2, 2.5.2, 2.5.19) | 8 / 15 | The app is the live website in a web view. Native parts: its own camera-roll plugin, camera and microphone, Apple Health (off by default), portrait lock. No native push, no offline screen. Website changes reach the app without review. |
| User-generated content & safety (1.2, 1.2.1(a), 1.4.1) | 6 / 10 | Report, block, staff review queue and published contact exist; membership is approval-gated. No automatic objectionable-content filter; no declared-age gate. |
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
3. **Objectionable-content filter for Crew (1.2).** Apple lists four musts for UGC apps; JF Effect
   has report, block and contact, but no method that filters objectionable material before it is
   posted. Minimum fix: a server-side word/phrase filter on posts, comments, captions, story text
   and chat messages that holds a match for staff review (reuse `community_reports` and the coach's
   Crew "Needs you" queue), plus image screening for posted media if feasible. Also have the
   one-page moderation plan ready (June 2026 change: Apple may ask for a compliance plan).
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
7. **iPad (2.4.1).** The build supports iPad, so App Review may test on one and iPad screenshots
   are required. Either test every main flow on an iPad and supply 13-inch screenshots, or make the
   app iPhone-only (`TARGETED_DEVICE_FAMILY = 1` in the workflow's pbxproj patch). Jared's call.
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

## Payment mapping (no change made; needs Jared's approval)

| What is sold today (Stripe, on the web) | Apple rule | Status in the app today | Most sensible compliant structure |
| --- | --- | --- | --- |
| 1:1 online coaching (monthly `coaching_packages` subscriptions, custom programming, check-ins, chat, calls with a named coach) | 3.1.3(d) Person-to-Person Services: "real-time person-to-person services between two individuals (for example … fitness training)" may use other payment methods | Not sold in the app; existing clients sign in | Keep Stripe, sold outside the app. Review Notes describe it as personal training by an individual coach. Risk: App Review may treat the asynchronous parts (programs in the app) as digital content; the answer is that the program is written by and for one person by their coach. |
| In-person personal training packages (Selkirk) | 3.1.3(e) Goods and Services Outside of the App: must NOT use in-app purchase | Not sold in the app | Keep Stripe. Could even be sold in the app later with Apple Pay / card entry, no IAP. |
| 1:1 calls (General Call, Discovery Call) | 3.1.3(d) | Booked on the web | Keep as is. |
| Self-serve paid membership (`membership` package kind; none sold yet) | 3.1.1: unlocking features or content needs in-app purchase; 3.1.3(b) lets web purchases be used in the app only if also offered as IAP | Not sold | Before selling it to anyone who uses the iPhone app: add it as an auto-renewable IAP at the same price (Apple Small Business Program: 15%), or keep it web-only and accept rejection risk. Decision for Jared. |
| AI credit packs (100 / 300 / 1,000, web only) | 3.1.1 consumables; 3.1.3(b) | Not sold in the app ("Purchases aren't available in the app"); web-bought credits work in the app | Lowest effort: leave as is (risk is App Review noticing extra credits used in the app). Compliant: add consumable IAPs for the packs on iOS. Decision for Jared. |
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
report, block; coach chat text, photo and voice memo; meal estimate (consent prompt if not
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
