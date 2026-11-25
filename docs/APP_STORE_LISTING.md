# JF Effect: App Store Connect listing pack (draft, Nov 25 2026)

Everything here is a draft for Jared to paste into App Store Connect. Nothing was entered or
submitted. Product facts come from the code and AGENTS.md; check every claim against the release
build before using it. Readiness, blockers and payment decisions: docs/APP_STORE_READINESS.md.

## App information

| Field | Value | Notes |
| --- | --- | --- |
| Name (30) | JF Effect: Strength Coaching | 28 characters. "JF Effect" alone also works if the brand should stand alone. |
| Subtitle (30) | Lift log, coaching & your crew | 30 characters. |
| Bundle ID | com.jfeffect.app | Already used for TestFlight. |
| SKU | jfeffect-ios | Any unique string. |
| Primary category | Health & Fitness | |
| Secondary category | Sports | Optional. |
| Price | Free | No in-app purchases in this version (see the readiness doc's payment mapping). |
| Privacy Policy URL | https://jfeffect.com/legal/privacy-policy | `/privacy` redirects here. Must be updated first (readiness blocker 2). |
| Support URL | https://jfeffect.com/support (to publish) | Must be public and show support@jfeffect.com. The in-app Support page needs a login. |
| Marketing URL | https://jfeffect.com | Optional. |
| Copyright | 2026 JF Effect | Use the legal business name. |
| Keywords (100) | `powerlifting,workout,lifting,personal trainer,program,gym,tracker,PR,macros,RPE,squat,bench,deadlift` | Exactly 100 characters; words already in the name and subtitle (strength, coaching, lift, log, crew) are left out because Apple indexes those already. |

## Promotional text (170, can change without review)

Log every set in seconds, see your PRs and strength trends, and train with a crew that cheers you
on. Coaching clients get their program, check-ins and coach chat in one place.

## Description

JF Effect is a strength training app built by a powerlifting coach: a fast workout log, programs
that progress, honest analytics, and a crew of lifters to train with.

LOG FAST
- Your workout as a list or one exercise at a time. Reps and RPE are filled in; type the weight
  and the sets log.
- Rest timer, warm-ups, notes on every exercise, and your history for each lift.
- Film a set with the in-app camera and see bar speed and technique on the video.

SEE YOUR PROGRESS
- PRs, estimated maxes and strength trends for squat, bench and deadlift.
- How often you train, which muscles you work, and what helps your training, in plain words.

PROGRAMS
- Start a coach-written plan from the library, build your own, or import one you already have.
- Your workouts stay on the days you train, and you can move them any time.

NUTRITION
- Log food, track calories and macros against your targets, and build a meal plan.

THE CREW
- Post your training, share stories, like and comment, follow lifters, and climb the monthly
  League.
- Report or block anyone, any time.

COACHING CLIENTS
- If you're coached by JF Effect, your custom program, weekly check-ins, session bookings and
  coach chat (text, photos, video and voice) live here too.

Membership is by approval. JF Effect gives general fitness information, not medical advice: check
with your doctor before starting a new program or if anything hurts.

Rules for this text: no prices, no "buy on our website" (3.1.1 / 3.1.3 outside the US), no
features that aren't in the submitted build (2.3.1, 2.5.19). Add an Apple Health line only if
`ENABLE_HEALTHKIT` is on for the build.

## Screenshots

6.9-inch iPhone (1320 x 2868), 3 to 10 shots, real app screens with synthetic data from the demo
accounts (never a real person's name, face, body or numbers). Suggested order: workout logger,
PR / strength analytics, set video with bar speed, Crew feed, program, nutrition, coach chat
(client account). 13-inch iPad shots too unless the build is made iPhone-only.

## Age rating questionnaire (Apple's current questionnaire)

| Question | Answer | Why |
| --- | --- | --- |
| Parental controls | No | |
| Age assurance | No today; Yes once the sign-up age gate (readiness item 8) ships | |
| Unrestricted web access | No | The app shows jfeffect.com only; other links open in Safari. |
| User-generated content | Yes | Crew posts, stories, comments, profiles. |
| Messaging and chat | Yes | Direct messages, group chats, coach chat. |
| Advertising | No | |
| Profanity or crude humor | Infrequent / mild | Possible in user content. |
| Horror / fear themes | None | |
| Alcohol, tobacco or drug use or references | None | |
| Medical or treatment information | Infrequent / mild | Pain reports, injury notes, recovery; no diagnosis. |
| Health or wellness topics | Yes | Training, nutrition, body weight. |
| Sexual content or nudity | None | |
| Violence (cartoon, realistic, prolonged, graphic) | None | |
| Simulated gambling, contests, loot boxes | None | The League is a leaderboard with no prizes for money. |

App Store Connect computes the rating from these answers; with user content and messaging expect
13+ or older. Do not lower answers to get a younger rating.

## App Privacy ("nutrition label") answers

Based on what the app collects (clients table, training logs, posts, messages, uploads, analytics
in `app_sessions` / `app_page_views`, page-error reports, Stripe purchase records) and the privacy
manifest `native/ios-app/PrivacyInfo.xcprivacy`, which must stay in step with these answers.

Tracking: **No** (no data is used to track people across other companies' apps or websites, no
advertising SDKs, no data brokers). All data below is **linked to the person's identity**.

| Data type | Collected | Purposes |
| --- | --- | --- |
| Contact Info: Name | Yes | App Functionality |
| Contact Info: Email Address | Yes | App Functionality |
| Contact Info: Phone Number | Yes | App Functionality |
| Contact Info: Physical Address | Yes (optional profile field) | App Functionality |
| Health & Fitness: Health | Yes (injuries, pain reports, health notes, body weight; Apple Health sleep, heart rate, HRV when connected) | App Functionality |
| Health & Fitness: Fitness | Yes (workouts, sets, steps and active energy when connected) | App Functionality |
| Sensitive Info | Yes only if the app stores pregnancy information (the legal memo says "where entered"); check the forms before answering | App Functionality |
| User Content: Photos or Videos | Yes (posts, progress photos, set videos, profile photo) | App Functionality |
| User Content: Audio Data | Yes (voice memos, spoken pain descriptions) | App Functionality |
| User Content: Emails or Text Messages | Yes (in-app messages) | App Functionality |
| User Content: Other User Content | Yes (comments, check-ins, notes, social handles) | App Functionality |
| Identifiers: User ID | Yes | App Functionality |
| Purchases: Purchase History | Yes (coaching and session purchases made on the web) | App Functionality |
| Location: Coarse Location | Yes (city-level from the network address, for usage statistics) | Analytics |
| Usage Data: Product Interaction | Yes (pages opened, features used) | Analytics, App Functionality |
| Diagnostics: Crash Data, Other Diagnostic Data | Yes (page errors, camera failures, device and app build) | App Functionality |
| Other Data | Yes (date of birth, sex, height, emergency contact) | App Functionality |
| Financial Info: Payment Info | No (card details are entered on Stripe's pages, not in the app) | |
| Precise Location, Contacts, Browsing History, Search History, Device ID, Advertising Data | No | |

Third parties that process data for the app (for the privacy policy, not the label's "tracking"):
Supabase (database, files), OpenAI and Google Gemini (AI features, only with the person's
permission), Stripe (payments, on the web), email and SMS providers, hosting.

## Export compliance

The build sets `ITSAppUsesNonExemptEncryption = false`: the app uses only encryption built into
iOS (HTTPS / TLS to jfeffect.com and its services) and no proprietary or non-standard
cryptography. Answer "No" to non-exempt encryption; no export documentation is needed.

## Content rights

Exercise videos, program templates, written content and graphics are JF Effect's own; user posts
are the users' (Terms). If any licensed music or third-party video ships in the app, answer "Yes,
I have the rights" only with those licences in hand.

## App Review notes (draft)

> JF Effect is a strength-training app for the members and coaching clients of JF Effect, a
> personal training business in Manitoba, Canada. The app is free. It contains no purchases and no
> links or buttons to buy anything.
>
> Business model: JF Effect sells 1:1 personal coaching (a named coach writes each client's
> program and talks with them by chat and video call) and in-person personal training sessions.
> These are real-time person-to-person and in-person services between a client and their coach,
> paid outside the app (guideline 3.1.3(d) and (e)). The app is where clients log their training
> and talk to their coach, so a coaching client's program, check-ins, chat and bookings are part
> of that service.
>
> No digital content is sold in the app, and nothing bought outside the app unlocks digital content
> or features in it. Every member who isn't a coaching client gets the same free app in iOS:
> the training log, the free program library, nutrition tools, the community and a monthly
> allowance of free credits for a few automated features. Any digital extras a member may have
> bought on our website (credits, a membership tier) are not available or usable in the iOS app,
> and the app has no price, purchase button, link or wording about buying anything.
> [Update this paragraph if Jared adds IAP.]
>
> AI and data: some features send the person's data to OpenAI (and voice memos to Google Gemini):
> meal estimates, reading imported programs and meal plans, reading a pain description, and drafts
> the coach reviews before anything is sent. The app asks for explicit permission first (a sheet
> that names each provider, shown on first launch and before those features), the server refuses
> those features without it, and the person can withdraw it in Account → Privacy & data → AI
> processing. "Cleo" is the coach's assistant inside the coaching tools; members and clients don't
> chat with an AI.
>
> Account deletion: Account → Privacy & data → Delete my account. The account is held
> for 30 days so the person can restore it, then deleted; payment records are kept as the law
> requires.
>
> Community safety: anything in the Crew can be reported (⋯ → Report) and anyone can be blocked;
> reports go to our staff review queue. [Add the automatic filter once it ships.]
>
> Membership is by approval, so please use these accounts (already approved, synthetic data only):
> 1. Member: [email] / [password]
> 2. Coaching client: [email] / [password]
>
> Camera and microphone are used to film sets and record voice memos; the photo library to post.
> [If Apple Health is enabled: Account → Devices & recovery → Apple Health reads sleep, heart rate,
> HRV, steps and active energy; it never writes.]

## Reviewer demo accounts (plan; synthetic data only)

Never a real client's name, photo, body, health or training data (public repo rules and privacy
law). Create them in production through the normal admin flows, approve them, and keep them
working until the review is done.

| Account | Set up | Synthetic data to add |
| --- | --- | --- |
| Member (free) | Approved JF member, no two-step, weight unit chosen, membership agreement accepted, AI processing **not yet answered** (so the reviewer sees the permission sheet) | A started library plan with 3 to 4 weeks of logged workouts and a couple of PRs; a week of food logs; a profile with a stock or generated avatar; follows two other demo athletes |
| Coaching client | Coaching client of a demo coach login, coaching agreement signed, a booked (fake) session next week | A current program block with logged sets and one filmed set video of an empty-bar lift filmed by staff; two weekly check-ins; a coach chat thread with a few messages, a photo and a voice memo; a nutrition plan |
| Demo athletes (2 or 3, not given to Apple) | Approved members | A few Crew posts and stories with stock images so the feed isn't empty |

### Steps (the data is seeded from the app; the logins are yours)

1. Create the two logins yourself, with addresses you control (defaults
   `appreview.client@jfeffect.com` and `appreview.member@jfeffect.com`; change them by editing the
   `app_review_demo_accounts` row in `app_settings`, JSON text: `{"client_email":"…","member_email":"…"}`).
   Nothing in the app creates a user or sets a password.
   - Coaching client: add them as a coaching client (Admin → Clients) with a demo coach, send the
     invite, set the password, sign the coaching agreement. Leave the AI-processing sheet unanswered.
   - Free member: let them apply and approve them (or invite them), finish the member setup, accept
     the membership agreement, no two-step. Leave AI processing unanswered so the reviewer sees the sheet.
2. Make sure at least one library plan is live (Admin → Member plans); the demo copies it.
3. Admin → Settings → **App Review demo accounts** → **Prepare App Review demo data**. For each of the
   two logins it adds synthetic training: the coaching client gets a program, three logged workouts,
   a completed weekly check-in and a cardio plan; the free member gets a library plan with three logged
   workouts. It refuses (and says why) when a login doesn't exist, is on the wrong plan, or already has
   training of its own, so a real client can't be touched. Running it twice adds nothing.
4. Still by hand (not seeded): the chat thread with a photo and voice memo, the filmed set video, a
   food log, a nutrition plan, the booked session, the demo athletes' Crew posts and stories, avatars.
5. Sign in as each login on a phone and check the screens Apple will open. Put the two emails and
   passwords in App Store Connect's Review Notes only (never in the repo).
6. After review (or to start over): **Remove demo data** deletes exactly the rows the button added
   (every one is listed in `app_review_demo_records`) and leaves the logins and anything else alone.

Migration: `20270527109600_app_review_demo_data.sql` (the list of seeded rows and the default emails).
Not run against a real database here, so check step 3 on staging or on the accounts before submitting.

Use addresses Jared controls (for example appreview.member@jfeffect.com and
appreview.client@jfeffect.com) so password resets work, and keep the passwords out of the repo
(enter them only in App Store Connect). Exclude these logins from Insights if they show up there.
Delete or archive the demo athletes' posts from the real Crew if they would show to real members,
or keep them in a private crew if one exists.
