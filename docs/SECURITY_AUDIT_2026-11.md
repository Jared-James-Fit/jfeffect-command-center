# JF Effect security, IP and agreements audit (Nov 17 2026)

Scope: the whole production app (TanStack Start on Lovable/Cloudflare, Supabase project `ojrsinmwkqfuukfmtryx`), its database as it runs in production (read-only catalog queries and anonymous, count-only probes; no personal data read), the client bundle as built, the public attack surface, the agreements and the acceptance system. Nothing intrusive was run against production, and nothing was deployed.

Companion documents: `docs/legal/AGREEMENT_UPDATES_DRAFT_2026-11.md` (draft agreement language for legal review), `supabase/migrations/20270423090000_security_hardening.sql` (database fixes), `src/test/security-hardening.test.ts` (tests).

## 1. Summary

The foundations are better than average for an app this size: all 446 tables have RLS on, policies are written per role, storage buckets are private, webhooks verify signatures in constant time, cron hooks share one constant-time secret check, tokens are long and hashed, there are no secrets in the repo and no source maps in the build.

The serious problems were in the glue between those pieces, and two of them allowed account takeover:

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | SMS password recovery took the phone number from any client record sharing the email, and the public application form could create one. Anyone could have the admin's (or a member's) reset link texted to their own phone. Live in production (the admin login has no client record with its email; SMS resets were working). | Critical | Fixed (code + migration) |
| 2 | The retired paid checkout was still switched on in production. It reused any existing login with the typed email and, after a checkout (3-day trial, no charge), returned a sign-in link for that email, the admin's included. | Critical | Fixed (code + migration) |
| 3 | Any signed-in account (anyone can sign up free) could call `claim_scheduled_messages()` and get every due scheduled coach message (its words and client), while stalling its delivery. 18 other worker/job functions had no caller check. | High | Fixed (migration) |
| 4 | Any signed-in account could list and download every file in the `avatars` bucket: 19 clients' account photos (the setup photo meant for the coach), not just Crew photos. | High | Fixed (migration) |
| 5 | Any signed-in account could read the athlete records table, including the coach's tracking notes on all 25 athletes and their coaching-period notes. | Medium | Fixed (migration) |
| 6 | The nutrition AI's full prompts (targets and meal plan, ~23,000 characters of method) shipped to every coaching client's phone and were publicly downloadable from jfeffect.com. | High (IP) | Fixed (moved server-side, verified in a build) |
| 7 | A user could insert their own legal acceptance with any timestamp, snapshot or acknowledgement text; nothing stopped edits or deletes; an archived version's text could be rewritten. | Medium (legal) | Fixed (migration + code) |
| 8 | Public application form: no rate limit, and each submission texts and emails the coach, emails any address and queues an AI reply; it also told strangers whether an email belonged to a client. | Medium | Fixed (limits, response trimmed) |
| 9 | A client could trigger the coach's Google event deletion, a package credit refund and Google writes on their own appointment (the RLS update silently matched nothing, then the service-role side effects ran). | Medium | Fixed |
| 10 | Drive media steps took any client id; `finalizeMediaUpload` let any account attach a media item to any client and read back a Drive file's name and link. | Medium | Fixed |
| 11 | Voice transcription: any coaching client could re-run it at will (unmetered AI), and its path check trusted the sender's own attachment data. | Medium | Fixed |
| 12 | Repeated Nutrition Update submissions each started a top-tier AI plan. | Medium (cost) | Fixed (one automatic plan per client per day) |
| 13 | Free members could post into the coach-chat table (and push the coach). | Low-medium | Fixed (migration) |
| 14 | Check-in thread reply/archive acted on any thread id; staff-login guard on setup links missed the finance and media roles and paged logins 50 at a time; member setup link could reset a team login's password. | Low-medium | Fixed |
| 15 | No `frame-ancestors`: jfeffect.com could be framed by another site while signed in (clickjacking). | Medium | Fixed (headers) |
| 16 | Critical advisories in production dependencies: TanStack Start (reflected XSS in server-function responses), seroval (deserialization), DOMPurify (XSS), Capacitor iOS/Android (remote content at the app origin). | Critical | **Not changed: needs your approval** (framework upgrade) |
| 17 | Free members have no recorded acceptance of anything; the live Terms and Membership Agreement describe the retired $29 product; IP, scraping, screenshot and confidentiality terms are missing or weak. | High (legal) | **Drafts for legal review**, nothing published |

## 2. Verified vulnerabilities and what changed

### Critical

**Account takeover through SMS recovery.** `lookupUser` (account-recovery.functions.ts) matched an email to a phone across `app_members`, `clients` and `coaches` without requiring the row to belong to the login, and fell back to listing logins to get the user id. The public coaching application (`upsertApplicantClient`) creates a Lead row with any email and phone, or fills a blank phone on an existing record. The `ilike` email match also treated `_` as a wildcard.
Fix: `account-recovery-lookup.server.ts` finds the login first, exactly (`auth_user_id_for_email`, a service-role-only SQL function, with an exact `profiles.email` fallback until the migration runs), reads a phone only from that login's own records, refuses ambiguity for phone lookups, and never texts a team login (admin, coach, finance, media manager get email resets only). The public form no longer writes phone or Instagram onto an existing record. The IP rate limit now reads Cloudflare's `cf-connecting-ip` instead of a header the caller sets.

**Retired paid checkout.** `createJfSignupCheckout` / `completeJfSignup` (jf-billing.functions.ts) refuse at the top (`PAID_SIGNUP_ENABLED = false`) and the migration sets `public_checkout_enabled = false`. Nothing links to them (`/membership` redirects to `/join`). No pending sign-ups existed, so the hourly cleanup job had nothing it could have deleted.

### High and medium (database)

All in `20270423090000_security_hardening.sql`, each caller traced in the live database first:

- **Worker and job functions** (`claim_scheduled_messages`, `claim_message_for_retry`, `finalize_message_send`, `mark_message_sending`, `release_message_claim`, `cancel_scheduled_message`, `cancel_scheduled_response_safe`, `finalize_schedule_send`, `mark_schedule_sending`, `consume_session_for_pt`, `grant_sessions_due_today`, `grant_sessions_if_paid_in_full`, `expire_overdue_sessions`, `mark_stale_lift_uploads`, `maybe_refresh_water_target`, `apply_default_member_access`, `sync_athlete_achievements`, `crm_last_contacted_map`, `xp_client_for_user`): revoked from `PUBLIC`, `anon`, `authenticated`; granted to `service_role`. Every caller is the service role, pg_cron or a SECURITY DEFINER function/trigger. The admin's "retry a failed message" (`retryFailedMessage`) checks the caller and now calls its two functions as the server.
- **`pl_clone_blocks_for_rows`**: now checks the caller can coach every program on both sides (the same rule as `pl_exercise_blocks`' own policies). Unused today (0 rows), so nothing changes in practice.
- **Athlete records**: `powerlifting_athletes` readable by staff and by the athlete for their own row (the analytics card reads `id, sex`); `powerlifting_coaching_periods` staff only. Careers, Hall of Strength and the strength board read them through SECURITY DEFINER functions and are unchanged.
- **`avatars` bucket**: readable for your own files, staff, and photos other people are meant to see (Crew profile photos, coach team photos: what `community_avatar()` hands out). Uploads and deletes were already owner-only.
- **Legal acceptances**: the users' own insert policy is gone (every insert already came from a server function, which now writes as the server); a trigger stamps every row with the published version's own text and the database's time and refuses unpublished or mismatched versions; another refuses edits (except revoking/superseding) and deletes (except with the login, through the existing cascade, or the admin-only history escape hatch). A version that was ever published keeps its words even after it's archived.
- **Coach chat**: only a coaching client can insert a client message (all 711 client-sent messages on file are from coaching clients).

### Medium (code)

- **Appointments** (appointments.functions.ts): cancel and status changes `.select()` their update and stop before any side effect when it changed nothing; Google resync is an admin's or the host coach's.
- **Drive** (drive.functions.ts): one `assertCanUploadForClient` (createSubmission's existing rule: admin, active assigned coach, or the client) now runs in all four upload steps.
- **Check-in threads** (weekly-checkin-threads.functions.ts): create, reply and archive read the thread or submission as the caller first; archiving for the team needs a staff role.
- **Voice transcription** (voice-transcribe.functions.ts): path must be inside the chat's own folder; a message is transcribed once; coaching chats only; 25 MB cap.
- **Nutrition plans** (push/app-events.functions.ts): at most one automatic plan per client per 24 hours; the coach still gets the "submitted" push and the panel writes a missing plan when he opens it.
- **Staff guard on setup links** (clients.functions.ts) refuses every team role and finds the login exactly; **member setup links** (members.functions.ts) never reset a team login and need 8+ characters.
- **Rate limits** (public-rate-limit.server.ts, reusing `_challenge_rate_ok`): coaching application 5 per connection per hour and 3 per email per day, drafts 60 per connection per hour, public bookings 4 per connection per hour. They fail open, so a limiter outage never blocks a real person.
- **Security headers** (security-headers.ts, src/server.ts): `Content-Security-Policy: frame-ancestors 'self'` on jfeffect.com (plus the Lovable editor on preview hosts), a Permissions-Policy switching off geolocation/USB/serial/HID/Bluetooth/MIDI (camera and microphone left alone for set videos, voice memos and Fillout photos). HSTS, nosniff and referrer policy were already set by the host.

### Existing protections confirmed

RLS on all 446 tables; all 3 views run with the caller's rights; every storage bucket private except `challenge-media` (public by design); anonymous visitors see only legal documents, access-level names and published sales pages; Stripe webhook HMAC with timestamp tolerance and event dedupe; SignNow HMAC; one constant-time hook secret check that refuses when unset; Google and Oura OAuth state signed and time-limited; open redirects blocked; recovery tokens 256-bit, hashed, 30 min, 5 attempts; setup, booking and payment links signed and expiring; Coaching Agreement signatures immutable at the database level; SMS cost guard; AI credits for member-triggered AI; coach-only AI behind role checks.

## 3. Intellectual property

**Protected assets**: the app and its code; program engines (load suggestions, Program Intelligence, the generator); AI prompts and orchestration (Program generation, Edit with AI, nutrition, Cleo, Athlete Insights, lead replies); the JF Effect program library (15 programs, defined in code and stored as templates); exercise library (2,076 exercises with cues, common mistakes and Vimeo demos); recipes; brand and design.

**What's protected well already**: the program-generation, Edit with AI, Cleo, Athlete Insights and lead-reply prompts were already server-only. The 15 library programs ship only as a member's own copy when they start one.

**What changed**: the nutrition prompts moved to `nutrition-ai-prompts.server.ts` (the build refuses to put a `.server.ts` module in a browser bundle). Screens use `nutrition-request.ts` for the form's own helpers; the coach's "run it yourself" and ChatGPT-paste copy tools ask a staff-only server function (`getManualNutritionPromptFn`) and copy in the tap (`copyWhenReady`, so iPhones still copy). Verified in a production build: 0 of 926 browser chunks contain the prompt text.

**Remaining copying risks (not changed)**:

| Item | Exposure | Recommendation |
|---|---|---|
| Program Intelligence engine (~190 KB: starting doses, goal logic, progression signals) | Downloadable from the admin chunks | Medium value, coach-only, no offline need: run `buildGeneratorIntel` / `buildIntelReport` in a server function and return JSON (it also replaces paging the whole history to the phone). |
| Load-suggestion engine (18 KB, backtested constants) | Ships to every athlete | Must stay on the phone (offline logging). Accept; the agreements cover copying. |
| Program Intelligence "AI prompt" export, Athlete Insights topic list, coach voice defaults, Cleo tone prompts | Admin chunks | Low value. The coach voice defaults include paraphrased real client messages (privacy, not just IP): move them server-side. |
| Exercise library (cues, common mistakes, Vimeo ids) | Any signed-in account can page through it | Set the Vimeo videos' privacy to "only embed on jfeffect.com" (free, Vimeo settings). That protects the videos, which are the costly part; the text is ordinary coaching cues. |
| Any client chunk | Every chunk, admin ones too, is downloadable signed out | Normal for a web app. Keep anything valuable in `*.server.ts` (now a rule in AGENTS.md). |

Absolute protection against copying a web app isn't possible: anything rendered on a screen can be recorded. What's been done keeps the business logic and the private data behind the server, and the agreements cover the rest.

## 4. Ownership

| Item | Finding |
|---|---|
| GitHub repo | Owned by your account; you're the only collaborator. History scan found no committed secrets, but the clone is shallow (100 commits), so older history wasn't scanned. |
| Lovable project | In your own workspace ("Jared's Lovable"), you're the owner. |
| Database, auth, storage | Run by Lovable Cloud (Supabase project `ojrsinmwkqfuukfmtryx`). You don't hold the Supabase organization directly. **Gap**: confirm you can export a full backup (database and storage) on demand and how point-in-time recovery works on your plan; keep a periodic off-platform export. |
| Third-party accounts | Stripe, Twilio, Google Cloud (OAuth clients), OpenAI, Vimeo, the domain registrar, Apple/Google developer accounts: confirm each is in the business's name with MFA on, and that you, not a contractor, are the owner. |
| Dependencies | 85 direct runtime dependencies: 81 MIT/ISC/Apache, 3 MPL-2.0 (`web-push`, `mediabunny`, `@capgo/capacitor-health`; fine to use; obligations apply only if you modify those files). |
| Generated code | Code written by Lovable's AI and by Claude Code belongs to you under their terms as currently published; have the lawyer confirm against the versions you agreed to. Get written IP assignments from anyone else who contributed code, design, video or content. |

## 5. Agreements

Full findings and draft language: `docs/legal/AGREEMENT_UPDATES_DRAFT_2026-11.md`. In short:

- Free members have never had an acceptance recorded (sign-up says "by joining you agree"); the Membership Agreement v3 that would ask them is unpublished; every gate is dismissible.
- The live Terms v3, Membership Agreement v2, Recurring Billing Disclosure and Cancellation Policy describe the retired $29 paid membership.
- Missing everywhere: reverse engineering, screenshots/recordings and sharing other people's information, confidentiality, an IP complaint process. The Coaching Agreement lacks an app licence and scraping terms, and its content licence doesn't cover the Crew.
- Drafted: Terms v4 sections (licence, ownership and what isn't claimed, user content, acceptable use with the Copyright Act's exceptions preserved, sharing and screenshots, narrow confidentiality, account security, proportionate enforcement, lawful competition, IP complaints), Membership Agreement changes, Coaching Agreement 2.4 changes, a plain-language screenshot and sharing policy, an acceptance UX plan, and Manitoba/Canada questions for the lawyer.
- Screenshot policy: allow personal saving and sharing of your own training and results; prohibit sharing other people's information, reselling content and systematic capture for another product. No technical screenshot blocking.

## 6. Tests and results

- **Migration**, on a local PostgreSQL 16 stub of the live schema (same function signatures and policy names, Supabase's roles and claims), applied twice (idempotent), then exercised as anonymous, a free member, a coaching client, a coach, an admin and the service role: worker functions refused to members and visitors but working for the server and from definer triggers; block copying only within coached programs; athlete records own-only for athletes; avatars bucket shows others only Crew and coach photos; acceptances refused from users, stamped with the published text, unchangeable and undeletable while the login exists, removed with the login; archived versions immutable; exact email lookup (case and spaces handled, `_` not a wildcard) service-only; checkout off; coach chat refused to free members. All as expected.
- **Unit and source tests**: `src/test/security-hardening.test.ts`, 38 tests, all passing (recovery lookup against a fake database that proves no client row is read by email; staff never texted; ambiguity refused; headers; rate limiter; prompts never imported by a browser module; each code fix in place; the migration's content).
- **Full suite**: 6,354 tests; the same 12 failures fail on the untouched code (UI tests unrelated to this work); one test I broke (`quick-paste-prompt`) was updated to the new server path.
- **Type check**: the same 13 pre-existing errors before and after; none introduced.
- **Production build**: succeeds; nutrition prompt text in 0 browser chunks, present only in the server bundle; no source maps.
- **Not tested**: the built Cloudflare worker locally (it doesn't run under plain Node). After deploying, check headers once with `curl -sI https://jfeffect.com/ | grep -i -E "content-security|permissions-policy"`.

## 7. Performance and cost

No measurable performance cost: the new checks are one indexed lookup each, the avatar policy is two small indexed lookups through SECURITY DEFINER helpers (34 files in the bucket), the rate limiter is one indexed insert per public submission, and the headers are added to HTML responses only. No new services or recurring costs. Fewer paid calls: one automatic nutrition plan per client per day, one transcription per voice memo, rate-limited public forms.

## 8. Approvals needed before this goes live

1. **Merge and deploy**: the migration and code ship together. Order doesn't matter (the email lookup falls back until the migration runs), but the migration must run for the database fixes to exist.
2. **Dependency upgrades** (finding 16), separately, with a full build and test run, to at least the first releases outside each advisory's range: `@tanstack/react-start` 1.168.60 (with `@tanstack/start-server-core` 1.169.39 and `@tanstack/start-plugin-core` 1.171.49), `seroval` 1.6.8, `dompurify` 3.4.17 (transitive), `@capacitor/ios` and `@capacitor/android` 8.4.3 (then a new App Store build). Installed today: react-start 1.168.40, start-server-core 1.169.23, seroval 1.6.2, dompurify 3.4.8, Capacitor 8.4.0. All are within the declared version ranges, but the framework upgrade can change build behaviour, so it shouldn't ride along with this change.
3. **Agreements**: lawyer review of the drafts, then publish from Admin → Legal and ship Coaching Agreement 2.4.

## 9. Recommendations

**Immediately**
1. Approve and run the dependency upgrades (critical advisories in production).
2. Turn on MFA for the admin and finance logins (Supabase supports TOTP; today `aal1` is enough everywhere), and on Stripe, Twilio, Google Cloud, OpenAI, Vimeo, GitHub, Lovable and the domain registrar.
3. Merge this change.
4. Set Vimeo demo videos to embed on jfeffect.com only.

**Soon**
5. Get the agreements reviewed and published; add the sign-up checkbox and server-recorded acceptance; switch the Terms to a hard gate after a grace period.
6. Move the Program Intelligence engine and the remaining admin prompts server-side (coach voice defaults first: they contain paraphrased client messages).
7. Don't persist other people's data in staff devices' query cache (add the staff-only prefixes to `query-persister.ts`'s blocklist, or persist nothing for staff), and shorten chat-attachment signed links from 24 hours.
8. Public bookings: don't send the Google invitation until the booker's email is confirmed (`sendUpdates=none` until then), and don't attach a booking to a client by a typed email.
9. Confirm database and storage export/backup with Lovable Cloud; keep a periodic off-platform copy.

**Lower**
10. Fillout hook: don't trust `client_id` from the form's hidden fields; prefer the respondent's verified identity.
11. Google OAuth: bind `state` to the signed-in session as well as signing it.
12. Ignore Stripe test-mode events in production.
13. AI meal estimate: don't refund a credit for a reply the model produced but the app couldn't read more than a few times a day.
14. The coach's check-in replies are labelled "client" (`replyToCheckinThread` reads a `profiles.role` column that doesn't exist): a display bug, not security.

**Long-term**
- Keep the rules added to AGENTS.md: service-role code checks the caller; `*.server.ts` for anything valuable; worker SQL functions service-role only; public functions rate-limited.
- Re-run the anonymous probe and the catalog checks in this report after any large change (they take minutes and touch no data).
- Keep `security/findings.json` current with the Lovable scanner; it's wired into the test suite.

## 10. Final pre-deploy verification (Nov 17 2026, PR #1038)

- **Two bypasses found by an independent review and closed in this PR.**
  - SMS recovery could still reach an attacker's phone. The attacker applies for coaching with the victim's email and their own phone *before* the victim joins, and the application record is linked to the victim's login when they sign up. Recovery now ignores a phone from a public application record no coach has taken on (`recoveryPhoneTrusted`). On production this changes nothing for 23 of the 24 logins with SMS recovery, and moves one converted applicant with no coach on their record to email-only.
  - Staff "Text sign-in / reset link" built the link from the client record's editable email. It's now only for the record's own login, by that login's own email, and never a team login.
- **Exploitation check (production, read-only).** Recovery texts ever sent: 3 (Jun 16, Sep 18, Oct 12), each to a phone on that person's own linked record, none for a team login. Retired checkout: 4 trials ever (Jun 11–15), 3 in Stripe test mode, 1 live member; none since and none on a team login. No live recovery or sign-in tokens. Team logins: admin 2 sessions, finance 1, all opened by password. No open staff or coach invites. Nothing indicates either hole was used, and nothing needs revoking.
- **Migration against production.** Every function it recreates matches production byte for byte before the change. Every policy it replaces is production's current one. Every caller of a revoked function is a SECURITY DEFINER function or a cron job running as `postgres`. All 406 client messages in the coach chat over 60 days came from coaching clients. Re-run twice on the local stub, plus every role's behaviour, plus the rollback and a re-apply. #1034's and #1035's migrations are already live in production.
- **Rollback.** `docs/rollback/2026-11-17-security-hardening-rollback.sql`, by section, tested.
- **Still open, not blocking.**
  - A coach-assigned planted lead's phone becomes trusted (the coach has dealt with the person).
  - The public "new setup link" request can reset the password of the one confirmed non-staff login with no client record (the owner gets the email).
  - Two unescaped email `ilike` lookups (nutrition dashboard, Stripe member provisioning).
  - Program Intelligence method text, Cleo's tones, Athlete Insights topics, lesson tracks and the coach-voice default still ship in admin chunks (no credentials or client data).

## 11. Deployed (Nov 20 2026)

- PR #1038 merged and published. `20270423090000_security_hardening.sql` was applied by hand (production doesn't run repo migrations on sync) and checked: every function it recreates matches the file, and a set of rolled-back tests on production passed. A coaching client can post in their chat, a free member can't, a client can't write their own legal acceptance, and the server's acceptance is stamped with the published text and can't be edited or deleted. The worker function is refused to users. `20270422090000_set_video_analyses.sql` (#1087, merged just before) was applied the same way so the published code had its table.
- The live site serves `frame-ancestors 'self'` and the Permissions-Policy. Recovery and setup texts are back on (`sms_settings.security_texts_enabled`). The retired checkout stays off (`public_checkout_enabled = false`).

## 12. Two-step sign-in (admin and finance logins)

- **What it does.** The admin and finance logins set up an authenticator app (TOTP) the first time they open the app after this ships. After that they enter a 6-digit code once per sign-in on each device. Supabase keeps the session at that level ("aal2") through its refreshes, so it isn't asked on every open. Clients and members see nothing new.
- **Why it's real and not just a screen.** Once a login has an authenticator, a password alone (a stolen one) gets no staff rights anywhere.
  - **The app** shows only the code screen (`StaffMfaGate`).
  - **Every server function** refuses the session (`staffMfaGuard` in `src/start.ts` → `mfa-guard.server.ts`). This covers the roughly 70 admin checks that read `user_roles` themselves and then act as the service role.
  - **The database** says no in `has_role`, `has_permission`, `is_admin_viewer` and `is_business_owner` (`caller_mfa_ok`, `20270424091500_staff_mfa.sql`), so direct API calls and realtime are covered too.
  - **Cost and timing.** The rule only applies to logins that have an authenticator, so nothing changes for anyone until they set one up. It costs clients nothing: the server reads the two-person list once a minute per instance, and the database checks only after a staff role is found.
- **Backups.** Account → Two-step sign-in adds a second authenticator, such as a password manager or another phone. Add one: Supabase TOTP has no recovery codes.
- **Locked out.** If a login has lost every authenticator, the owner (or Claude, through Lovable's database access) removes its factors and the person sets up a new one on their next open:
  `DELETE FROM auth.mfa_factors WHERE user_id = '<login id>';`
- **Known friction.**
  - Changing your password re-checks it by signing in again, so you'll be asked for a code afterwards.
  - The finance login had this step until Oct 9 2026 and it was removed at the owner's request. It's back for the finance login because the owner asked for MFA on both logins on Nov 17 2026.
- **Rollback.** `docs/rollback/2026-11-20-staff-mfa-rollback.sql` puts the four functions back as production had them on Nov 20 2026 and drops the two new ones (tested on the local copy). Then take `staffMfaGuard` out of `src/start.ts` and `<StaffMfaGate>` out of `src/routes/_authenticated/route.tsx`.
