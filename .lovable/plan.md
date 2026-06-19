## Offline Mode v1 — implementation plan

### Architecture (one shared layer, used by all features)

```
┌─ Service Worker (vite-plugin-pwa, NetworkFirst HTML, CacheFirst assets) ─┐
│  Caches: app shell + last-fetched API responses for whitelisted reads     │
└────────────────────────────────────────────────────────────────────────────┘
              ▲                                       ▲
              │ navigation                            │ data reads
              │                                       │
        React app  ◄──── useOnlineStatus() ────►  OfflineBanner / chips
              │
              ▼ writes
┌─ offline-queue (IndexedDB via idb) ───────────────────────────────────────┐
│  enqueue({ kind, payload, clientOpId, createdAt })                        │
│  drain() runs on online + every 30s + on focus                            │
│  per-kind handlers call existing server fns; idempotent via clientOpId    │
└────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
        React Query optimistic updates → UI stays consistent
```

One queue, one banner, one status hook. Every feature plugs in by registering a handler.

### What gets cached by the service worker

- App shell (HTML, JS, CSS, fonts, logos, icons)
- Last-seen GET responses for:
  - `/portal` dashboard data
  - today's workout day (`pl_days`, `pl_exercise_rows`, `pl_block_set_rows`, completion)
  - bodyweight + water + nutrition latest reads
- Excluded: auth, payments, admin, messaging, uploads, anything POST/PUT/DELETE

Stale-while-revalidate so the user always sees their last known state offline.

### IndexedDB queue (one table)

`pending_ops` rows:
- `id` (uuid), `client_op_id` (uuid — server-side dedup key)
- `kind` — e.g. `set_log`, `workout_complete`, `bodyweight`, `water`, `nutrition_log`, `habit_tick`, `progress_metric`, `note`
- `payload` (JSON)
- `created_at`, `attempts`, `last_error`, `status` (`pending` | `syncing` | `failed`)

Per-kind handler maps `payload` → existing server function call. Server functions get a small change: accept optional `client_op_id`, upsert on it to prevent duplicates.

### Feature wiring (each is ~30 lines once queue exists)

| Feature | Queue kind | Server fn touched |
|---|---|---|
| Workout set logs | `set_log` | upsert `member_set_logs` / `pl_row_results` by `client_op_id` |
| Workout completion + duration | `workout_complete` | `pl_day_completions` upsert |
| Workout review/notes | `workout_review` | existing review fn |
| Bodyweight | `bodyweight` | `progress_bodyweight` insert |
| Water | `water` | `progress_water_entries` insert |
| Nutrition meal log | `nutrition_log` | `member_meal_logs` insert |
| Habits / supplements | `habit_tick` | `member_supplement_logs` insert |
| Progress metric | `progress_metric` | `progress_metrics` insert |
| Progress photo *metadata only* | `progress_photo_meta` | `progress_media` row (binary upload deferred until online) |

Progress photo blobs are NOT queued — too risky for IndexedDB quotas. Metadata + a "Pending upload" marker is queued; the file itself is held in memory only while the tab is open, with a clear "this photo will upload when you're back online — don't close the tab" warning.

### Action gating (no codebase-wide audit)

A small `<RequiresOnline>` wrapper + `useRequireOnline()` hook. Applied surgically to: payments buttons, signup CTA, messaging composer, video upload, coach/admin program edits. Offline → disabled + tooltip + toast.

### UI status

- Top banner when offline: "Offline — your changes are saved and will sync when you're back online."
- Per-action chip on save: "Saved offline" → "Syncing" → "Synced" / "Sync failed — Retry"
- Sync queue drawer (`/portal/settings/offline`) shows pending ops + manual retry

### Conflict policy (per your choice)

Always save. If `client_op_id` upsert hits a target row that was archived/reassigned, server fn still writes the log but stamps `needs_review = true` on the parent so coach sees it. No client-side block.

### Phasing (this is what I'll actually do, in order)

**Phase 1 — Foundations (this batch)**
1. `vite-plugin-pwa` set up with the preview-safe registration guard from the PWA skill.
2. `src/lib/offline/queue.ts` — IndexedDB queue + `useOfflineQueue`.
3. `src/lib/offline/online-status.ts` — `useOnlineStatus` hook.
4. `OfflineBanner` mounted in `_authenticated/route.tsx`.
5. `<RequiresOnline>` wrapper + `useRequireOnline` hook.
6. Migration: add `client_op_id` (uuid, unique nullable) to the 8 target write tables.

**Phase 2 — Wire workout logging (the most important flow)**
7. Set logging in `WorkoutDayView` enqueues when offline; server fn dedups by `client_op_id`.
8. Workout completion + duration enqueue when offline.
9. Save chips on each set row.

**Phase 3 — Wire the rest**
10. Bodyweight, water, nutrition log, habit tick, progress metric.
11. Progress photo metadata path + "don't close tab" warning.

**Phase 4 — Polish**
12. Sync queue drawer at `/portal/settings/offline`.
13. Apply `<RequiresOnline>` to payments, signup, messaging, uploads, coach edits.
14. Test airplane-mode flow end to end.

### Out of scope (will not do)

- No new offline-first design pages.
- No real-time conflict resolution UI for clients.
- No offline support for admin dashboards, analytics, or coach inboxes.
- No background sync via Periodic Background Sync API (browser support too patchy).
- No photo binary persistence across tab closes.

### Credit estimate

Phase 1+2 alone is substantial — service worker setup, IndexedDB layer, migration on 8 tables, and one feature wired end to end is the bulk of the work. Phases 3 and 4 are mostly repetition once Phase 2 lands.

I will commit Phase 1 and 2 in this turn, then check in before continuing to Phase 3 so you can see it working in airplane mode first. If anything looks off, we adjust before I template the same pattern across the remaining features — that's the credit-cheapest path.

Approve to proceed.