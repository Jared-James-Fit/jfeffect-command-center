# JF Effect PWA — Phased Build Plan

This brief is large enough that doing it as one change would be unsafe (touches auth, caching, sign-out, workouts, onboarding, admin). I'll ship it in 5 verifiable phases. Each phase is independently testable and publishable, and none of them touch existing programs, workouts, payments, or RLS.

I'd like your approval on the phase breakdown before I start — especially Phase 1, which is the foundation everything else builds on.

---

## Phase 1 — Installable PWA foundation (this turn, if approved)

Goal: real install on iPhone + Android, real JF Effect branding, no Lovable placeholders, zero risk to existing portal.

1. **Manifest** at `public/manifest.webmanifest`: name "JF Effect", short_name "JF Effect", `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `orientation: "portrait-primary"`, theme color (brand), background `#0a0a0a`, description, `id: "/"`.
2. **Icons** (generated from existing JF Effect mark): 192, 512, 192-maskable, 512-maskable, apple-touch-icon 180, favicon. Uploaded via `lovable-assets`.
3. **Head tags** in `src/routes/__root.tsx`: `manifest`, `theme-color`, `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-mobile-web-app-title: JF Effect`, viewport with `viewport-fit=cover`.
4. **Safe-area CSS**: global `env(safe-area-inset-*)` padding utilities for header, bottom nav, sticky buttons.
5. **No service worker yet.** Manifest-only install is enough for "Add to Home Screen" on iOS and Android's native install prompt — and it carries zero risk of breaking the live site for existing users. The SW lands in Phase 4 with a kill-switch-ready design.

Verification: Playwright check of `/manifest.webmanifest`, icon URLs 200, head tags rendered, lighthouse-style manifest validation, screenshots of the install sheet on a simulated iPhone viewport.

## Phase 2 — Install flow + device-aware instructions ✅ DONE

- New route `/install` (and a "Install JF Effect" entry from member home).
- `usePlatform()` hook: detects iOS Safari, Android Chrome, in-app browser (FB/IG/Gmail), desktop, already-installed (`display-mode: standalone` + `navigator.standalone`), `beforeinstallprompt` availability.
- iOS: visual Share → Add to Home Screen walkthrough with "I Added JF Effect" confirm + standalone re-check on next open.
- Android: native prompt via captured `beforeinstallprompt`; fallback to menu instructions.
- In-app browser: "Open in Safari/Chrome" guidance.
- Desktop: QR code (qrcode lib) + copy link + short mobile instructions.
- "Install dismissed" + "Install confirmed" persisted in `app_members` (new columns) so admins can see it.

## Phase 3 — Setup checklist + admin visibility (non-blocking) — IN PROGRESS

Done this turn:
- New `app_members` columns: `notifications_status`, `setup_dismissed_until`, `last_setup_error`, `first_workout_opened_at` (install columns landed in Phase 2).
- Member home checklist card "Finish setting up JF Effect" with 5 items (profile, install, notifications, pick program, open first workout), progress bar, dismiss-for-now (4h) and remind-tomorrow (24h).
- Browser notification permission prompt wired through the checklist; result persisted to `app_members.notifications_status`.
- Admin route `/admin/onboarding` with counts, 7 filters (all / not signed in / not installed / setup incomplete / notifications off / errors / ready), search, paginated rows with status pills and a View action linking to the member detail page.
- Admin nav entry under Membership group.

Still to do for Phase 3 (will tackle next turn if you want):
- Email + SMS reminder templates ("Set up your JF Effect app") wired to existing email infra.
- Admin row actions: Send Reminder, Copy Link, Resend Instructions, Clear Error, Mark Browser-Only.
- Goals & Setup save bug audit + fix.

- `member_setup_state` table (or columns on `app_members`) tracking: account_created_at, first_signin_at, install_detected_at, install_platform, goals_setup_status, profile_status, notifications_status, first_workout_opened_at, last_reminder_sent_at, last_setup_error.
- Home checklist card "Finish Setting Up JF Effect" with progress, 5 items, one CTA per item, dismiss-for-now + remind-tomorrow.
- **Never blocks** Workouts, Messages, Nutrition, Account, Help, Sign Out.
- Admin page `/admin/onboarding` with filters (not signed in / not installed / setup incomplete / goals incomplete / notifications off / errors / ready), pagination, actions (Send Reminder, Copy Link, View Client, Resend Instructions, Clear Error, Mark Browser-Only).
- Email + SMS templates: "Set up your JF Effect app" using existing email infra (no new provider).
- Goals & Setup save bug: audit + fix the existing submit flow — reliable save, empty/N/A/No/long answers, retry, Save & Continue Later, persistent completion.

## Phase 4 — Service worker, updates, sign-out cache clearing — IN PROGRESS

Done this turn:
- `vite-plugin-pwa` (`generateSW`, `registerType: autoUpdate`) generates `/sw.js`. Manifest stays hand-managed (Phase 1).
- Guarded register wrapper in `src/lib/pwa/register-sw.ts` — refuses to register in dev, iframe, `id-preview--*`, `preview--*`, `*.lovableproject.com`, `*.lovableproject-dev.com`, `*.beta.lovable.dev`, or `?sw=off`, and unregisters any matching `/sw.js` or `/service-worker.js` when refused.
- `NetworkFirst` for HTML navigations (4s timeout); `CacheFirst` for hashed `/assets/*`; `StaleWhileRevalidate` for images. `/~oauth`, `/api/`, `/_serverFn/`, `/_server/` excluded from navigation fallback.
- "JF Effect has been updated" toast with Update / Later, with a heuristic unsaved-work check (`[data-unsaved="true"]`).
- Online/offline banner at the root.
- Sign-out (`auth.signOut`) clears `jf-*` caches and `jf-*` IndexedDB databases so the next user never sees the previous user's cached data.

Still to do for Phase 4:
- Workout / form draft persistence with idempotency keys (touches workout logger, forms, uploads, message composer, nutrition entry — non-trivial).
- Apply `data-unsaved="true"` markers to those forms so the update prompt actually catches in-flight edits.

- `vite-plugin-pwa` with `generateSW`, `registerType: "autoUpdate"`, `NetworkFirst` for HTML, `CacheFirst` for hashed assets, OAuth + Supabase API excluded.
- **Hard guards**: SW never registers in dev, iframe, `id-preview--*`, `preview--*`, `*.lovableproject.com`, `?sw=off`. Kill-switch worker ready at `/sw.js` if we need to disable.
- "JF Effect Has Been Updated" toast → Update App / Later, with unsaved-work check (workout logger, forms, uploads, message composer, nutrition entry).
- Sign-out clears user-scoped caches + IndexedDB drafts.
- Workout / form draft persistence with idempotency keys.
- Online/offline banner, retry, no false "saved" confirmations.

## Phase 5 — Polish, audit, future-native scaffolding

- Mobile layout audit pass: notch, home indicator, bottom nav, sticky buttons, keyboard, tap targets ≥44px, no 16px-input zoom, no horizontal overflow, no double headers.
- Back-button behaviour + unsaved-work confirmation.
- Deep-link router that preserves intent through sign-in.
- Thin service abstractions (`platform/notifications.ts`, `platform/camera.ts`, etc.) with web impls only — Capacitor-ready, but no Capacitor install.
- Notification permission prompt gated behind explicit user action + value explanation, never on first load, respects denial.

---

## What I will NOT touch

Existing routes, RLS, payments, Stripe, programs, workout logs, messages, agreements, member tiers, auth, $29 trial logic, jfeffect.com checkout, existing analytics, legal records, SEO metadata.

## Technical notes

- Stack is TanStack Start on Cloudflare Workers. Service worker rules per Lovable PWA skill (no SW in preview/dev, kill-switch design, `NetworkFirst` for HTML).
- New DB columns/tables added via migrations with GRANTs + RLS in the same migration.
- Icons go through `lovable-assets` (CDN), not committed binaries.
- Each phase ships behind feature checks so a broken phase can't take down the live portal.

---

**Please confirm**: should I proceed phase-by-phase starting with Phase 1 (manifest + icons + head tags + safe areas)? Or do you want me to bundle Phase 1+2 (install + instructions) into the first deploy?
