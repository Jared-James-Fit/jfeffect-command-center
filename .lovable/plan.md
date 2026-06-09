# Premium Birthdays System

A large, multi-part feature. Here's how I'd ship it cleanly.

## 1. Data model (new migration)

New table `client_birthday_cards` — per-client customization:
- `client_id` (FK, unique)
- `enabled` (bool, default true)
- `headline`, `message`, `quote`, `coach_message` (text, nullable = use default)
- `template_key` (text, nullable — strong, simple, jf_effect, client_win)
- `celebration_effect` (bool, default true)
- `show_message_coach_button` (bool, default true)
- `updated_at`, `updated_by`

New table `client_birthday_card_views` — track per-year dismissal:
- `client_id`, `birthday_year` (unique pair), `seen_at`, `dismissed_at`

Both: GRANTs + RLS (admin/coach manage cards; clients read their own card + write their own view).

## 2. Admin dashboard — Upcoming Birthdays widget

Rewrite `src/components/upcoming-birthdays-widget.tsx`:
- Premium card per client with `UserAvatar` (uses the new shimmer)
- Name, formatted birthday, "Turning X", "X days away" / "Today" / "Tomorrow"
- 4 quick actions: Message · Customize Card · Preview · View Profile
- Sort soonest first, 30-day window default
- Clean empty state
- Keeps existing "Wished" / overdue logic
- Today's birthdays get a subtle red/primary accent stripe

## 3. Customize + Preview dialogs

New `src/components/birthday-card-editor.tsx`:
- Loads/saves `client_birthday_cards` row
- Template picker (4 templates with default copy)
- Editable fields: headline, message, quote, coach message
- Toggles: enabled, celebration effect, message-coach button
- "Reset to default" + "Save"

New `src/components/birthday-card-preview.tsx`:
- Renders the exact client-facing card with current draft values
- Mobile-frame preview
- Respects `prefers-reduced-motion`
- Reusable in both the Customize dialog and the standalone Preview button

## 4. Client-side birthday card

New `src/components/client-birthday-card.tsx`:
- Modal-style card shown to client on their birthday
- Uses defaults unless admin customized
- Subtle confetti (lightweight inline canvas/CSS — no new dep), respects reduced motion
- Buttons: "Thank you", optional "Message Coach", optional "View Today's Plan"
- On dismiss: insert `client_birthday_card_views` row → won't reappear
- Mounted in the client portal root layout, gated by `date_of_birth` matching today + `enabled` + not-yet-dismissed-this-year

## 5. Send Birthday Message action

Hook into existing messaging — open the message thread for the client with a prefilled draft (no auto-send).

## 6. Admin notification

Lightweight: today's-birthday clients automatically pin to the top of the widget with a "Today 🎂" accent + a single toast on dashboard mount (deduped via sessionStorage per day). No new notification table.

## Out of scope (call out)
- No email/push notifications to admin (toast + dashboard pin only).
- No "Announcements history" entry on dismissal — just the views table.
- No iPad-specific layout beyond responsive defaults.

## Files

New:
- `supabase/migrations/<ts>_birthday_cards.sql`
- `src/components/birthday-card-editor.tsx`
- `src/components/birthday-card-preview.tsx`
- `src/components/client-birthday-card.tsx`
- `src/lib/birthday-templates.ts`

Edited:
- `src/components/upcoming-birthdays-widget.tsx` (rewrite)
- Client portal root layout (mount `ClientBirthdayCard`)
- `src/routes/_authenticated/admin/index.tsx` (dashboard toast for today's birthdays)

Want me to proceed with all of this, or cut/reorder any parts first?
