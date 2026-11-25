# App Store 3.1.1: in-app purchase decision (for Jared)

App Review **rejected** JF Effect 1.0 (build 35, reviewed June 23 2026 on an iPad Air 11-inch). Three findings:

| # | Guideline | Apple's words | Status after branch `claude/apple-rejection-fixes` |
| --- | --- | --- | --- |
| 1 | 2.3.8 | "the app icons appear to be placeholder icons" | **Fixed in code.** Every build wipes Capacitor's template icon and launch image and rebuilds both from `AppIcon-1024.png` (`native/ios-app/app_art.py`). The build fails if any icon or launch image still looks like Capacitor's, and it checks the icon in the finished app as well. |
| 2 | 3.1.1 | "subscription purchase link-out to Safari via account registration" | **Fixed in code.** The route Apple found was sign-in, then "Apply to join free" (/join), then the public header or footer ("Online coaching", "Pricing", "About"), then /coaching, then the Stripe checkout opening in Safari. `src/lib/native-purchases.ts` now blocks every sales, pricing, checkout and billing page in the app, stops taps and `window.open` calls to them, and hides the links. Details below. |
| 3 | 3.1.1 | "the app accesses digital content purchased outside the app, such as subscription, but that content isn't available to purchase using In-App Purchase" | **Not fixed. This needs your decision (A or B below).** Until you decide, someone who bought a digital tier on the web still gets it in the iPhone app, which is exactly what Apple flagged. Resubmitting without A or B will most likely be rejected again. |

Nothing in App Store Connect, Stripe or the database was changed. No in-app purchase code exists.

---

## 1. Inventory: every paid tier or entitlement a person can hold (from the code)

"P2P" means a real-time person-to-person service (3.1.3(d)) or a service used outside the app (3.1.3(e)). Other payment methods are allowed for these, and the app may not use IAP for them. "Digital" means digital content or features used in the app (3.1.1). These need IAP if they're unlocked in the iOS app.

| # | What a person can hold | Where it lives in code | Sold how today | Class | In the iOS app today |
| --- | --- | --- | --- | --- | --- |
| 1 | **1:1 online coaching**: monthly `coaching_packages` with `kind = 'subscription'`. A named coach, a program written for one person, check-ins, chat and calls. | `coaching_packages`, `plan-engine.ts` (`family: "coaching"`), `clients.service_tier = 'coaching'`, `member_access 'coaching_access'` | Stripe on the web (`/coaching/apply`, plan checkout, payment links in chat) | **P2P, 3.1.3(d)** | Clients sign in and use everything. Nothing is sold, priced or linked (fixed in this branch). |
| 2 | **Coaching extras**: one-time calls (General Call, Discovery Call), `kind = 'one_time'` packages, a coaching client's monthly AI credit allowance (300 by default) | `coaching-packages`, booking, `ai_credit_tier` | Stripe on the web / included with coaching | **P2P, 3.1.3(d)** | Booking a call your coach set up works. No prices are shown. |
| 3 | **In-person personal training session packages** (Selkirk): `purchase_records` session packages, auto-pay, payment plans | `session-sale.ts`, `billing.functions.ts`, `auto-pay.ts` | Stripe links sent in chat, or recorded by the coach | **P2P, 3.1.3(e)** (IAP not allowed) | Chat payment and auto-pay cards show the client no amount and no pay button (fixed in this branch). |
| 4 | **JF Membership, paid self-serve (retired)**: `app_members.subscription_status` of `Trialing`, `Active`, `Active (Cancels at period end)`, `Past Due`, `Past Due (Access Restricted)`, `Payment Failed`, `Hold Plan` (the $9 hold price), `Paused`, `Cancelled`, `Expired`, plus the `member_access` levels it bundled (`jf_membership`, `app_membership`, `program_library`, `powerlifting_plans`, `bodybuilding_plans`, `fat_loss_plans`, `resource_library`, `nutrition_tools`, `community`, `premium_member`) | `jf-lifecycle.server.ts`, `memberAccess.ts`, `jf-billing.functions.ts` | Was Stripe on the web ($29, retired). The free-platform migration notes say one member ever paid and cancelled in June. **Check Stripe for anyone still active.** | **Digital** | No longer sold anywhere. A member with one of these statuses still gets the paid access in the app. |
| 5 | **Paid self-serve membership plan**: `coaching_packages.kind = 'membership'` | `plan-engine.ts` (`family: "membership"`) | Built (Your plan, Stripe Checkout) but **none sold yet** | **Digital** | Your plan is now blocked in the app. A holder would still get the access. |
| 6 | **JF Effect Premium**: `member_access 'jf_premium'`, `premium_active()`. Build with Cleo and the Cleo inbox. | `premium/*`, `20270527108200_premium_groundwork.sql` | **Not sold.** Only complimentary grants by the admin. No price exists. | **Digital** (once sold) | Holders use it. A complimentary grant isn't "purchased outside the app", so it's fine today. It becomes a 3.1.1 problem the day it's sold on the web. |
| 7 | **AI credit packs**: 100 / C$2.99, 300 / C$6.99, 1,000 / C$14.99 before tax. They become `ai_credit_wallets.extra` and never expire. | `ai-credits/packs.ts`, `ai_credits_record_purchase` | Stripe Checkout on the web only | **Digital (consumable)** | Bought credits are spent in the app (AI food log). Nothing about buying is shown (fixed in this branch). |
| 8 | **Free account**: `subscription_status 'Free'`, the member's monthly AI allowance (30 by default) | `free_platform` migration | Free | n/a | Everything works. |
| 9 | **Coach platform subscription** (independent coaches) | decided, not built (`docs/COACHING_PLATFORM.md`) | n/a | B2B. Not a clean fit for 3.1.3(c). | Not in the app. |

Free programs (the lead-magnet downloads, the JF Effect plans and Crew programs) are free. No program is sold on its own. Challenges have no paid entry in code.

**So the digital, bought-outside items Apple is talking about are rows 4, 5, 6 (once sold) and 7.** Rows 1 to 3 are person-to-person and stay outside IAP. Say so in the Review Notes: "1:1 coaching and in-person training by an individual coach are real-time person-to-person services (3.1.3(d)/(e)). Clients pay outside the app, and the app has no purchase, price or link for them."

---

## 2. The two options

### Option A: add StoreKit in-app purchase for the digital tiers

**What it is.** An auto-renewable subscription (one subscription group, "JF Effect Membership" / "Premium") at the same CAD price as Stripe, on Apple's nearest CAD price point. Credit packs become consumable IAPs, or they follow B. Bought in the app, Apple bills the person. Bought on the web, Stripe bills them as today. Both feed the same entitlement.

**Work (outline):**
1. App Store Connect: Paid Applications agreement, banking and tax, **App Store Small Business Program** enrolment (15% instead of 30% while proceeds stay under US$1M a year), the subscription group and products, review screenshots of the paywall, and the subscription's display name and description.
2. Native: a StoreKit 2 plugin (a maintained Capacitor plugin, or one written in `native/` the way `JfPhotos` was). Link it in the workflow's Podfile and `packageClassList`, the same way as `JfPhotosPlugin`. Pass an `appAccountToken` set to the login's UUID with every purchase, so a transaction always maps to one person.
3. In-app paywall (iOS only): price, period, what's included, and auto-renew terms. Add **Restore purchases**, **Manage subscription** (Apple's own sheet), and links to the Terms (EULA) and Privacy Policy, all of which Apple requires on a subscription screen. It must not mention the web price or the web.
4. Server: an App Store Server Notifications V2 endpoint (`/api/public/apple/notifications`) that verifies Apple's signed JWS. Map `SUBSCRIBED`, `DID_RENEW`, `EXPIRED`, `DID_FAIL_TO_RENEW` (grace period), `REFUND` and `REVOKE` onto the **same** entitlement Stripe drives: `app_members.subscription_status` / `member_access 'jf_premium'` with a new `source = 'apple'`. Add a nightly check against the App Store Server API, and `ai_credits_record_purchase` for consumables (refunds take back unused credits, the same as Stripe's `charge.refunded`).
5. No double billing: someone with an active Stripe subscription sees "You're subscribed" in the app and no IAP offer. Someone with an Apple subscription sees "Managed by Apple" on the web Your plan and can't start a Stripe one.
6. Books: Apple pays out monthly, net of commission. Apple is the merchant of record and collects and remits Canadian GST/HST on App Store sales. Taxes & Books needs a fourth revenue source (Apple proceeds), kept apart from Stripe.
7. Tests and review: sandbox testers, StoreKit configuration file tests, and a TestFlight round with real sandbox purchases. IAPs are reviewed together with the binary.

Rough effort: about **2 to 3 weeks** of focused work, plus App Store Connect set-up and one or more extra review rounds. This is an estimate, not measured.

**Money.** On an in-app sale of price P you keep about **0.85 × P** (Small Business Program) instead of about **P − (2.9% × P + C$0.30)** with Stripe. That's roughly 11 to 12 points less per in-app sale on a C$20 to 30 monthly price. Apple handles the tax, so you don't remit it. Web sales are unchanged. In return, people can buy in the app with one tap, and in-app conversion is usually far higher than "go find the website".

### Option B: digital paid tiers are unavailable in the iOS app

**What it is.** In the iPhone app, a self-serve member gets **only the free features**, whatever they bought on the web: no Premium (Build with Cleo, Cleo inbox), no paid-membership-only access, and only the monthly free AI credits (bought `extra` credits can't be spent in the app). They keep everything on the web app. **Coaching clients keep everything** (person-to-person, rows 1 to 3).

**What the app says.** No link and no purchase wording. Suggested text on a locked paid feature: *"This feature isn't part of the iPhone app."* Your brief asked for wording that points members to the web app ("use the web app for paid member features"). That is allowed only if it never reads as directing them to buy. Telling someone where to use something they already have is generally accepted, but App Review has flagged "available on our website" lines before. The neutral sentence above is the safer one, and members who paid will already know about the web app.

**Work (outline, about 2 to 4 days):**
1. One server-side rule: `digitalPaidAllowed(user, platform)`. The platform comes from the build's user-agent stamp `JFEffectApp/<build>`, which the native shell already sends, so requests from the iOS app never unlock `jf_premium`, the paid membership statuses (row 4/5 access beyond Free) or `extra` credits. Enforce it on the server (`premium_active` callers, `withAiCredits` spending only `allowance` for native requests, member-access checks), not only in screens.
2. The screens use the same rule: `isNative()` plus the user's tier hides Premium's rows (BuildWithCleoRow, the Cleo pin) for self-serve members. Coaching clients stay untouched.
3. Tests: a native self-serve member with Premium, the old paid statuses and extra credits sees and spends only free features. A native coaching client sees everything. The web is unchanged.
4. Review Notes: "Digital memberships and credit packs are not offered or unlockable in the iOS app. iOS users get the free app. 1:1 coaching is a person-to-person service (3.1.3(d))."

**Money.** Apple takes nothing. The cost is lost in-app conversion: an iPhone-only member can't buy or use paid digital features in the app. Members who bought on the web lose those features *in the iPhone app* (they keep them on the web), which may annoy them. **Today this costs almost nothing**: Premium has never been sold, the paid membership plan has never been sold, the retired $29 membership has (per the migration notes) no paying member, and only credit-pack buyers would notice.

### Which one Apple is most likely to approve

**Option B, on the next submission.** It removes the thing Apple objected to (digital content bought elsewhere, unlocked in the app) without adding new review surface. Apple usually approves this path ("the iOS app only offers what isn't digital content sold elsewhere"), as long as the app neither points to the web purchase nor unlocks it. Option A is also fully compliant. But it adds paywall, IAP and subscription-metadata review (missing Restore, missing terms links, IAPs not submitted with the binary and similar issues are common first-time rejections), so it usually takes more than one round.

**Recommendation:** ship **B now** to get 1.0 approved, then add **A** when Premium or a paid membership is actually being sold and iPhone buyers matter. A can replace B later without touching the coaching side.

---

## 3. iPad

Build 35 supported iPad (`TARGETED_DEVICE_FAMILY = "1,2"` from Capacitor's template), so App Review tested on an iPad Air. The app is laid out for a phone (portrait-locked on iPhone, phone navigation), and supporting iPad properly means checking every main flow at iPad sizes and in multitasking, plus 13-inch iPad screenshots.

**Recommendation: iPhone only, which this branch now builds by default.** `.github/workflows/ios-build.yml` sets `TARGETED_DEVICE_FAMILY = 1` unless the repository variable **`IOS_SUPPORT_IPAD`** is `true`, and checks `UIDeviceFamily` in the built app. Notes:
- You can still drop iPad because 1.0 was never approved. Once a version that supports iPad is live, Apple doesn't let a later version remove it.
- App Review can still open an iPhone-only app on an iPad (iPhone compatibility mode), so it must not break there. It runs as a phone-sized window, which this app handles.
- iPad screenshots are no longer required for an iPhone-only app.
- If you want iPad later: test every main flow on an iPad first, then set `IOS_SUPPORT_IPAD=true` and add 13-inch screenshots.

---

## 4. What changed in code for findings 1 and 2

- **Icons (2.3.8):** `native/ios-app/app_art.py` and the "Set the app icon and launch image" and "Check the app icon and launch image aren't placeholders" steps in `ios-build.yml`. It covers 18 icons (every iPhone and iPad slot plus the 1024 App Store icon, all RGB with no alpha), deletes Capacitor's leftover `AppIcon-512@2x.png`, and replaces the launch image (Capacitor's logo on white) with the JF icon on `#0B0B0F`. The build fails on a placeholder before archiving and again on the icon inside the built `.app`.
- **Link-outs (3.1.1):** `src/lib/native-purchases.ts` is the single guard:
  - `isShellBlockedPath` blocks /coaching(/apply), /about, /pricing, /membership, /apply, /selkirk, /personal-trainer-selkirk, /pay, /autopay, /m/welcome, /portal/plan, /portal/membership, /portal/purchases and similar pages. They redirect to "/" in the root `beforeLoad`, after a cold open, and before the first paint.
  - `installShellPurchaseGuard` swallows taps and `window.open` calls to those pages or to Stripe payment hosts. Staff keep their payment tools.
  - `goToPayment` sits at every checkout redirect and refuses in the app.
  - Elements marked `data-web-only` (the public header's nav, menu and button, and the footer's sales links) are hidden in the app.
  - /join skips the coaching question and the coaching-call card.
  - `?landing` can't show the pricing page in the app.
  - Account hides Your plan, Billing and Purchases. The portal menus drop My Purchases and Membership. A lapsed member lands on Account.
  - Chat payment and auto-pay cards show the client no amount or button.
  - The booking page has no "Apply for coaching".
  - "Purchases aren't available in the app" and the "Upgrade" wording are gone.
  - Tests: `src/test/native-shell-routes.test.ts` walks every route in `routeTree.gen.ts` and every client-facing link. `native-purchases.test.ts` covers the earlier rules.
- **Not verifiable here:** the actual iOS build (macOS only, so it runs in GitHub Actions), how the icon looks on a device, and a tap-through on a physical iPhone or iPad. Before resubmitting, walk this path in TestFlight as a signed-out new user and as a free member: sign-in, Apply to join free, every link on /join, Account, chat. Nothing should open Safari or show a price.
