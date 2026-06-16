# `src/platform/` — Web today, Capacitor tomorrow

These modules are the only place in the app that talks to the host platform
(notifications, share sheet, haptics, camera, persistent storage). Every
consumer imports the public API from `@/platform/...`, never the underlying
browser or native SDK.

## Why

When we wrap JF Effect in Capacitor (iOS + Android) we want to swap one file
per concern instead of touching dozens of call sites. The shape of each
exported function already matches the Capacitor equivalents so the swap is a
one-line implementation change inside `src/platform/<name>.ts`.

## Current modules

| Module            | Web today                                   | Capacitor swap                                                   |
|-------------------|---------------------------------------------|------------------------------------------------------------------|
| `notifications.ts`| `Notification` permission + display         | `@capacitor/push-notifications` + `@capacitor/local-notifications` |
| `share.ts`        | `navigator.share` w/ clipboard fallback     | `@capacitor/share`                                               |
| `haptics.ts`      | `navigator.vibrate`                         | `@capacitor/haptics`                                             |
| `camera.ts`       | `<input type="file" accept="image/*" capture>` | `@capacitor/camera`                                            |
| `storage.ts`      | `localStorage` keyed read/write/remove      | `@capacitor/preferences` (KV) or `@capacitor-community/sqlite`   |

`isStandalone()` in `index.ts` returns `true` for installed PWAs today; under
Capacitor it must return `true` unconditionally — adjust that helper at the
same time you wire Capacitor.

## When we install Capacitor

1. `npm i @capacitor/core @capacitor/cli`, then `npx cap init "JF Effect" com.jfeffect.app --web-dir=dist`.
2. Add platforms: `npm i @capacitor/ios @capacitor/android && npx cap add ios && npx cap add android`.
3. Install the per-capability plugins listed above as you migrate each
   module — one PR per module so we can test each capability in isolation.
4. Inside each `src/platform/<name>.ts`, replace the body with the Capacitor
   plugin call. Keep the exported function names and types unchanged.
5. Add a runtime detector (`Capacitor.isNativePlatform()`) so the web build
   continues to work for `https://jfeffect.com`.

## Do not

- Import `Notification`, `navigator.share`, `navigator.vibrate`,
  `localStorage`, or `<input capture>` directly from components — go through
  this folder.
- Add SSR-unsafe code at module top level. These files are imported from
  routes that prerender; guard every browser API behind `typeof window`.
- Bundle Capacitor in the web build before the project ships a native shell.
  We ship Capacitor only when we're ready to publish to TestFlight / Play.