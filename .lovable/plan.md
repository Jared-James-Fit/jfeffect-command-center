## Goal

Combine the admin client profile's **Overview** and **Account** sections into a single top-level section called **Client Profile** with 5 sub-tabs, while preserving every field, action, modal, server function, and role check that exists today. No backend changes. No data migration. No removed functionality.

## What stays the same

- Top-level sections: **Client Profile** (new, merged), **Training**, **Nutrition**, **Communication**, **Business**.
- All Supabase tables, RLS, and server functions (`inviteClient`, `getSetupLink`, `sendPasswordReset`, `setClientPassword`, `markSetupComplete`, `setNeedsAdminHelp`, `sendAuthLinkBySms`, `deactivateClient`, `reactivateClient`, `deleteClient`).
- The persistent `SetupStatusBanner` at the top of every tab.
- The global header (Message / Training Program / Nutrition / Client POV / More Actions) and the floating **Save** button — but Save will be made sticky while scrolling.
- All `canPov` and other permission gates.
- Existing edit modals (Set Password, Deactivate, Reactivate, Delete, PriceCardPickerDialog, SendBookingLinkDialog, SendPasswordResetDialog).
- All deep-link URLs: existing `?tab=summary|info|goals-setup|coaching|account` values keep working — only the section grouping changes.

## The 5 Client Profile sub-tabs

| # | Sub-tab label | URL tab value | Source today |
|---|---|---|---|
| 1 | Overview | `summary` | Already exists as Overview tab |
| 2 | Personal Info | `info` | Already exists under Overview section |
| 3 | Goals & Intake | `goals-setup` | Already exists under Overview section |
| 4 | Coaching Setup | `coaching` | Already exists under Overview section |
| 5 | Login & Access | `account` | Already exists as Account section |

## Changes

### 1. Regroup (`src/routes/_authenticated/admin/clients.$id.tsx`, lines 192–226)

Update `SECTIONS` and `TAB_TO_SECTION`:

- Remove the standalone `overview` and `account` top-level sections.
- Add a single `client-profile` section containing the 5 sub-tabs above in that order.
- Other top-level sections (`training`, `nutrition`, `communication`, `business`) untouched.
- Default tab on first load becomes `summary` under `client-profile`.

### 2. Redesign Overview tab as large action cards (`ClientOverviewSnapshot`, lines 1753–1927)

Keep the identity header, profile completion card, personal snapshot, App Activity card, and Training Schedule card. Replace the current small quick-action button row with a **6-card grid of large clickable action cards** (min height ~96px, single column on mobile, 2 cols at iPad landscape `md:`, 3 cols at `lg:`):

1. **Open Client POV** — gated by `canPov` (admin/coach only); same `impersonation.start()` flow.
2. **Message Client** — navigates to `tab=messages`.
3. **Manage Schedule** — links to `/admin/clients/$id/schedule`.
4. **View Intake & Goals** — navigates to `tab=goals-setup`.
5. **Request Client Update** — toggles `clients.info_update_requested`; label flips to "Update requested" when set.
6. **Assign Program** — links to `/admin/client-programs/$clientId`.

Each card: icon + title + one-line description, full card is a tap target ≥44px tall.

### 3. Personal Info tab — wrap existing fields in titled cards with large Edit buttons

The `info` tab already renders these fields. Group into 5 cards, each with its own visible **Edit** button (≥44px) that scrolls/focuses the relevant input group; no new modals required:

- Name & Identity (first/last/preferred/full, profile picture)
- Contact (email, phone, instagram)
- Personal (date of birth, height, timezone)
- Address (address, city, province, postal, country)
- Emergency Contact (name, phone)

### 4. Goals & Intake tab — keep existing `goals-setup` content as-is

No structural change. Already shows intake answers, goals, training experience, equipment, injuries, nutrition goals, best lifts, OpenPowerlifting (`PowerlifterSection`).

### 5. Coaching Setup tab — keep existing `coaching` content as-is

Already shows assigned coach, status, package, program phase, start/renewal dates, payment summary, schedule, Drive folder link, quick links.

### 6. Redesign Login & Access tab as large action cards (`account` tab, lines 1144–1192)

Keep the metadata fields (email, invite sent, last resent, account created, password reset sent, linked auth user) in a header card. Replace the dense button row with **labeled action cards** grouped into:

- **Setup link** — Send/Resend setup email, Copy setup link, SMS setup link
- **Password reset** — Send password reset, Copy reset link, SMS reset link, Secure password reset (opens existing `SendPasswordResetDialog`)
- **Sign-in & access** — SMS sign-in link, Set password (opens existing AlertDialog), Mark setup complete, Mark / Clear "needs admin help"
- **App installation** — Mark Installed (from existing `AppActivityCard`)
- **Client POV** — Open Client POV (gated by `canPov`)

Every action button ≥44px, full-width on mobile.

### 7. Sticky Save bar

Today the global Save button is in the page header. Add a `sticky bottom-0` Save bar (or pin the existing button) that stays visible while scrolling any sub-tab, with safe-area padding on mobile. Disabled when no unsaved changes; spinner while saving.

### 8. Responsive rules

- Mobile (`<md`): single-column cards, full-width buttons.
- iPad landscape (`md:` ~≥768px): two-column card grid.
- Desktop (`lg:`): three columns on the Overview action grid.
- All tap targets ≥44px high.

## Out of scope

- No changes to Training / Nutrition / Communication / Business sections.
- No new fields, no schema changes.
- No changes to server functions or RLS.
- Not extracting the 1,948-line route file into smaller modules (that's a separate refactor).

## Risks & mitigations

- **Deep links** that point at `?section=overview` or `?section=account` break. Mitigation: keep `tab` values stable (the section dropdown isn't in URLs today, only `tab` is). Verified in current `validateSearch`.
- **Save-button discoverability** changes if it moves. Mitigation: keep it in the header too — the sticky bar is additive on mobile.
- **Permission drift** — every gated action (Client POV, destructive actions) keeps its existing `canPov` / role check; the card wrapper does not bypass them.

## Acceptance check before publishing

- Open an existing client. Confirm all 5 sub-tabs load, every field from the inventory renders, every button still triggers its existing server fn or modal.
- Confirm `SetupStatusBanner` still appears on all tabs.
- Confirm Client POV, Deactivate, Reactivate, Delete, Drive folder, Assign offer, Send booking link, all SMS variants, password set/reset all still work.
- Confirm sticky Save persists across scroll on mobile.
- Then publish to https://jfeffect.com.
