This is a large request, so here's the plan I'll execute. I'll start with an audit pass (read-only — no changes yet), then patch only what's actually missing. The sidebar tweak is a small side task included at the end.

## Phase A — Audit (no code changes)

I'll inspect what already exists across these surfaces and produce a checklist of pass/fail:

1. **Subscription product wiring** — `signup.jf.tsx`, `auth.tsx`, `stripe-webhook.ts`, `stripe.server.ts`, `jf-billing.functions.ts`, `jf-access.server.ts`, `membership.ts`, `app_members` schema + RLS.
2. **Status → access mapping** — confirm Trialing/Active/PastDue/PaymentFailed/Paused/HoldPlan/Cancelled/Expired each gate correctly through `jf_member_has_full_access` and `member_has_access`.
3. **Server-side gating** — every `/m/*` route loader + server function for protected reads (program library, recipes, resources, events, workouts, progress, announcements). Confirm no client-only checks.
4. **Default access checklist** — `apply_default_member_access` + `member_access_defaults` + the auto-trigger when a new JF member is created.
5. **Billing/cancel/freeze/hold/reactivation** — `m/billing.tsx`, the cancellation flow, freeze 30-day, switch-to-Hold-Plan, reactivate. Confirm Stripe price IDs and webhooks for all paths.
6. **Stripe webhook coverage** — `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`, `invoice.paid`, `invoice.payment_action_required`, trial_will_end.
7. **SMS flow** — welcome, trial-ending, payment-failed, cancel/freeze/hold/reactivate, event reminders; consent + history.
8. **Admin dashboard** — list view + per-member actions (Sync Stripe, grant/revoke, freeze, switch hold, reactivate, cancel, send SMS, resend invite, Stripe customer link).
9. **Anti-cheat** — RLS audit on every JF-readable table; verify `account_type='jf_member'` + status checks on the server, not in components.
10. **Welcome/onboarding** — `/m/welcome` exists; confirm the checklist + first-run gating.

Deliverable for Phase A: a single chat reply with an itemized pass/fail list grouped by your 15 parts. No code changes in Phase A.

## Phase B — Fixes (only what's broken or missing)

For each fail from Phase A, I'll patch in the smallest possible way:

- Missing webhook handlers → extend `stripe-webhook.ts` and the `app_members` updater.
- Missing/weak RLS → migrations that tighten policies using `jf_member_has_full_access(auth.uid())`.
- Missing server-side gates → wrap the affected loaders in protected server fns that throw 403 unless full access.
- Missing billing actions (freeze / hold / reactivate) → server functions calling Stripe + an admin "Sync Stripe Status" button.
- Missing SMS templates/triggers → rows in `sms_automations` + webhook hooks.
- Missing admin column on members list → status, plan, next bill, trial end, quick actions.
- Missing upgrade prompt on coaching-only surfaces → reuse `upgrade-to-coaching-prompt.tsx`.

I will NOT touch parts that already work. The audit gates which patches run.

## Phase C — Sidebar: Defaults button + Pinned favorites (side task)

Small, isolated UI changes in `src/components/app-shell.tsx` + a tiny new lib.

- **Defaults button**: a new `src/lib/sidebar-defaults.ts` snapshots the current nav order/groups into localStorage on first paint (per role). A "Restore defaults" button in the sidebar density menu writes that snapshot back to whatever sidebar prefs we already store (collapsed sections, etc.). When new nav items are added in code, the snapshot self-updates on next load if the user hasn't customized.
- **Pinned favorites (up to 5)**: long-press or a star icon on any sidebar row toggles it into a new "Pinned" section pinned to the top of the sidebar. Storage: `jf-sidebar-pins:<role>` → string[] of `to` paths, capped at 5 with a toast when the cap is hit. Star icon on hover; click to unpin. Renders above the grouped sections.

No DB changes needed for Phase C.

## Technical notes

- All Phase B server logic stays in `createServerFn` (auth middleware) or webhook routes. `supabaseAdmin` is loaded inside handlers, never at module scope.
- Any new RLS uses the existing `jf_member_has_full_access(_user_id)` and `member_has_access(_member_id, _key)` helpers — no new auth primitives.
- New migrations follow the GRANT + RLS-policy structure.
- I'll keep the existing JF Membership badge, customizer, and POV toggle intact.

## What I need from you

Approve the plan and I'll start Phase A immediately. Phase A produces a written audit; you can then tell me to proceed with Phase B in full, cherry-pick fixes, or stop. Phase C (sidebar) ships at the same time as Phase B unless you want it sooner — say "sidebar first" and I'll do that as a one-shot before the audit.