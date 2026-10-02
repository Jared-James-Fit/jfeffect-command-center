# Admin Client Setup & Access Cleanup

## Goal
Replace the overlapping “Coaching Setup” and “Login & Access” experiences with a clear client setup workflow that shows what is complete, what is waiting on the client, and the single next action an admin should take.

## What will change
- Turn Coaching Setup into a task-oriented overview with grouped statuses for coach assignment, client details/intake, training schedule, program, nutrition, and account access.
- Keep each setup capability in its existing specialist section; this overview will link to the canonical editor instead of duplicating controls.
- Separate account authentication from service/feature access so login health, portal availability, and coaching access cannot be confused.
- Make one context-aware account action primary: send setup for no account, resend for an expired setup link, or password recovery for an existing account.
- Keep manual copy/send choices available through one secondary menu, and move password setting, help flags, client POV, deactivation, and deletion into clearly labeled advanced areas.
- Remove duplicate setup/reset controls from the page header, Summary, and Login & Access while retaining status references where useful.

## Link and status reliability
- Establish one shared account-status model for the Summary and Login & Access views.
- Stop treating a stale stored invite expiry as meaningful after an account exists or has signed in.
- Ensure sending or copying a setup link records and refreshes the current link status consistently.
- Avoid presenting a fabricated validity window as authoritative; show only status that the app can support accurately.
- Preserve the current secure, prefetch-resistant setup and password-recovery link formats.

## Technical details
- Refactor the large client workspace into focused setup/access presentation components while preserving existing server authorization and client data.
- Reuse existing program, schedule, goals/intake, nutrition, billing, communication, and account functions; no parallel setup system or schema is planned.
- Add regression tests for account-state derivation, valid/expired setup presentation, canonical action visibility, and removal of duplicate entry points.
- Test representative existing client states in the signed-in admin workspace on desktop and mobile, including send/copy behavior without delivering messages to real clients.
- Run focused tests, typecheck, and the production build; report unrelated failures separately.

## Scope boundary
The Marc Asugui sale/payment-link reconciliation is already present in the current code and data. This cleanup will not perform financial mutations, alter billing terms, or change unrelated client-management areas.