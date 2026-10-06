# Wearables: setup and operations

## Go-live checklist (Oura first)
Do these in order. Nothing shows a Connect button until steps 1 to 4 are done.

1. **Deploy** the branch (merge to `main`). Merges cleanly with `main` as of 6 Oct 2026.
2. **Apply the migrations**, in this order, in the Supabase SQL editor or your normal migration flow:
   - `supabase/migrations/20261006160000_wearables_foundation.sql`
   - `supabase/migrations/20261006170000_client_daily_training_load.sql`
   If step 2 is skipped, Account > Devices shows "Device connections aren't available right now".
3. **Register the app with Oura** (Oura developer portal, "Cloud API" applications):
   - Redirect URI: `https://jfeffect.com/api/public/wearables/oura/callback`
   - Scopes needed: `personal`, `daily`, `heartrate`
   - Copy the client ID and client secret.
   - Oura limits how many users an unapproved app can connect; check the portal for the current cap before inviting everyone.
4. **Set the environment variables** on the deployed app:
   - `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`
   - `WEARABLES_OAUTH_STATE_SECRET`: any random 32+ char string (`openssl rand -hex 32`)
   - `SCHEDULED_WORKER_SECRET`: already used by the other workers; reuse it.
5. **Schedule the sync** (every ~3 hours) by calling `POST https://jfeffect.com/api/public/hooks/wearables-sync`
   with the header `x-worker-secret: <SCHEDULED_WORKER_SECRET>`. Same mechanism as `nutrition-tick`.
6. **Test with your own Oura account**: Account > Devices > Connect. Expect your last 30 days within a minute.
   Compare sleep, HRV and resting HR with what the Oura app shows. The Oura endpoint and field names were
   written without access to Oura's docs, so this is the real verification.
7. **Privacy policy** must mention health data (sleep, HRV, heart rate) before inviting clients.


## What is live
| Source | Path | Status |
|---|---|---|
| Oura | Cloud OAuth, pulled by server | Built, needs env + Oura app registration |
| Apple Health | Phone pushes via `ingestHealthStoreMetrics` | Server + normalizer + bridge built, **native plugin not installed** |
| Health Connect (Android) | Same | Same |

Apple Watch data reaches us through Apple Health. Garmin is more limited, see below.

## Garmin (read this before promising Garmin support)
Status of what I could and could not verify (Garmin's own pages were not reachable when this was written):
- **Direct Garmin Health API**: partner program, legal entities only (no personal use), reportedly paused for new
  applications, and beat-to-beat HRV data needs a commercial license fee. Treat as not available.
- **Garmin Connect -> Health Connect (Android)**: reportedly shares sleep stages, heart rate, resting HR and HRV. Best path.
- **Garmin Connect -> Apple Health (iPhone)**: reportedly shares steps, heart rate, active/resting energy and sleep,
  but NOT HRV. Resting HR is unconfirmed. Low-quality sources, so verify on a real phone:
  Apple Health > Browse > Heart > Heart Rate Variability (and Resting Heart Rate, Sleep) > Data Sources & Access.
  If "Garmin Connect" is not listed, that signal will not arrive.
- Without HRV, recovery is judged from sleep and resting HR only, which is weaker.
- Unofficial Garmin Connect scrapers need the athlete's Garmin password and break Garmin's terms. Do not use.

## Oura
1. Register an app at Oura. Redirect URI: `https://jfeffect.com/api/public/wearables/oura/callback`.
2. Env: `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `WEARABLES_OAUTH_STATE_SECRET` (32+ chars), `SCHEDULED_WORKER_SECRET`.
3. Schedule `POST /api/public/hooks/wearables-sync` (header `x-worker-secret`) about every 3 hours.
4. Endpoint and field names were written without access to Oura's docs. Verify with a real account.

## Apple Health / Health Connect (native app)
Plugin: `@capgo/capacitor-health` 8.x (installed). The web side is live once deployed: in the
phone app, Account > Devices shows Connect for that phone's health store; on the website it says
"Connect in the iPhone app"; on app builds without the native plugin it says "Update the app".
The native half is added by CI and is OFF until you switch it on.

### iPhone (Apple Health, which is also how Garmin data gets in on iPhone)
1. **Accept the pending Apple agreement** (App Store Connect > Business / Agreements). Every iOS
   upload since at least run 1502 fails with `REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`; nothing
   reaches TestFlight until this is done, HealthKit or not.
2. developer.apple.com > Identifiers > `com.jfeffect.app` > enable **HealthKit** > Save.
3. Profiles > "JF Effect App Store Distribution" > Edit > Save (regenerates with HealthKit) >
   Download. Base64 it (`base64 -i profile.mobileprovision | pbcopy`) and replace the GitHub secret
   `PROVISIONING_PROFILE_BASE64`.
4. GitHub > Settings > Secrets and variables > Actions > **Variables** > `ENABLE_HEALTHKIT` = `true`.
5. Actions > "iOS Build and Upload" > Run workflow. If step 3 was missed, the build stops at
   "Check provisioning profile allows HealthKit" with instructions instead of a cryptic signing error.
6. Install the TestFlight build > Account > Devices > Apple Health > Connect > allow access.
7. Garmin users: in Garmin Connect, turn on sharing to Apple Health (Settings > Connected Apps).
   Garmin reportedly does not share HRV to Apple Health; recovery then uses sleep and resting HR
   (falls back to the day's minimum heart rate when no resting HR is written).
8. App Store review: update the App Privacy answers (Health & Fitness data, linked to the user,
   app functionality) and the privacy policy before submitting a public release.

### Android (Health Connect)
1. Play Console > App content > **Health apps** declaration for: steps, active calories, sleep,
   heart rate, resting heart rate, HRV (read only). CI strips every other health permission.
2. GitHub Actions variable `ENABLE_HEALTH_CONNECT` = `true`. The build then raises minSdk to 26
   (Android 8.0+), which Health Connect requires.
3. The Android workflow only produces a signed AAB artifact; upload it to Play as usual.

## Data rules worth remembering
- HRV is not comparable across sources: Apple = SDNN, Oura/Whoop/Health Connect = RMSSD.
  Recovery is always judged from one source's own history (`summarizeRecoveryFromRows`).
- Wearable data never awards Level points (XP stays trigger-only, see AGENTS.md).
- Health Connect reads ~30 days back by default; iOS has no cap.
- iOS does not reveal whether read access was granted; "denied" and "no data" look the same.
