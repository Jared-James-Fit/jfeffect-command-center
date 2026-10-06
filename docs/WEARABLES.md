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
Plugin: `@capgo/capacitor-health` (v8 line = Capacitor 8). It is the only maintained Capacitor 8
plugin that reads sleep, HRV and resting HR on both platforms.

1. `bun add @capgo/capacitor-health` (commit the updated lockfile), then `bun run cap:sync`.
2. iOS: enable the HealthKit capability; add `NSHealthShareUsageDescription` to Info.plist
   (explain it is for coaching: sleep, HRV, resting HR, steps). Update `PrivacyInfo.xcprivacy`.
3. Android: Health Connect read permissions for sleep, HRV, resting HR, steps, active calories
   only, plus the privacy-policy rationale activity the plugin README describes.
4. Call site (for example behind a "Connect Apple Health" button, from a user tap):
   ```ts
   import { Health } from "@capgo/capacitor-health";
   import { syncHealthStore } from "@/platform/health";
   const r = await syncHealthStore(Health as any, { requestAccess: true });
   ```
   Then call `syncHealthStore(Health as any)` on app foreground to top up.
5. In `providers.ts` set `live: true` for `apple_health` / `health_connect` and render the
   connect button for them in `wearables-card.tsx` (it currently only wires OAuth).
6. Update the privacy policy for health data before shipping.

## Data rules worth remembering
- HRV is not comparable across sources: Apple = SDNN, Oura/Whoop/Health Connect = RMSSD.
  Recovery is always judged from one source's own history (`summarizeRecoveryFromRows`).
- Wearable data never awards Level points (XP stays trigger-only, see AGENTS.md).
- Health Connect reads ~30 days back by default; iOS has no cap.
- iOS does not reveal whether read access was granted; "denied" and "no data" look the same.
