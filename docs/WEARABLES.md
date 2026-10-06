# Wearables: setup and operations

## What is live
| Source | Path | Status |
|---|---|---|
| Oura | Cloud OAuth, pulled by server | Built, needs env + Oura app registration |
| Apple Health | Phone pushes via `ingestHealthStoreMetrics` | Server + normalizer + bridge built, **native plugin not installed** |
| Health Connect (Android) | Same | Same |

Garmin and Apple Watch data reach us through Apple Health / Health Connect.

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
