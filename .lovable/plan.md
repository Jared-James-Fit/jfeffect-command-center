A four-part refactor. I'll ship them as independent commits so each can be reviewed.

## 1. Gear icon + profile picture access (admin / coach / client)

- Add a `Settings` (gear) button in the app shell header (`src/components/app-shell.tsx`) that links to the role's account page:
  - admin → `/admin/account`
  - coach → reuse admin account or coach-specific page if present
  - client → `/portal/account`
  - member → `/m/account`
- Ensure every account page exposes the profile-picture editor:
  - admin/coach: already have `AccountProfileSettings` — make sure `/admin/account` and any coach account route render it (it's currently missing from `admin/account.tsx`).
  - client: surface `ProfilePictureCapture` in `/portal/account` (today only the gate forces it; add a "Replace photo" entry there too).

## 2. Tap-to-expand avatar (app-wide)

- Update `src/components/user-avatar.tsx` to make the avatar clickable. On click, open a dialog (shadcn `Dialog`) that shows the full-resolution signed image centered on a dim backdrop.
- Add an `expandable` prop (default `true`) so call-sites that need a non-interactive avatar (e.g. inside a `<button>`) can opt out.
- Because `UserAvatar` is used everywhere, this single change covers admin/coach/client/member.

## 3. Autosave + inline "Saved" indicator

- New component `src/components/saved-indicator.tsx` — tiny inline `Saving… / Saved ✓ / Error` text that fades after ~1.5s. Uses muted-foreground + a check icon, no toast.
- New hook `src/hooks/use-autosave-field.ts` — debounced (600ms) save wrapper that drives a `SavedIndicator` state.
- Apply to the highest-friction forms first (keep this PR bounded):
  - `AccountProfileSettings` display name → autosave, drop the Save button.
  - `BasicInfoForm` fields (admin client profile + client portal) → autosave per field, keep one Save button only under multi-field grouped sections that genuinely need an explicit commit (e.g. address block where partial values are invalid).
  - Targets / schedules / nutrition panels that currently have per-field save buttons → convert to autosave with indicator.
- Keep explicit Save buttons for: password change, sending invites/links, anything destructive, and forms whose validation requires a complete set (e.g. creating a new client).

## 4. Simplify admin/coach messenger to match client messenger

- Diff `src/components/message-thread.tsx` rendering between admin entry points and the client portal (`/portal/messages`). Strip admin-only chrome (extra panels, action bars, status pills) so it visually matches the client thread: bubbles, composer, send button. Keep underlying message data/sending logic unchanged.

## Technical details (for reference)

- Saved indicator API:
  ```ts
  type SaveState = "idle" | "saving" | "saved" | "error";
  <SavedIndicator state={state} />
  ```
- Autosave hook signature:
  ```ts
  const { state, onChange } = useAutosaveField(value, async (next) => { /* save */ });
  ```
- Avatar lightbox: reuses signed URL already fetched; falls back to initials view (no expansion) when there's no image.
- Gear icon placement: right side of `PageHeader` / shell top bar, hidden on `/auth` and setup routes.

## Out of scope (ask before doing)

- I will NOT touch authentication flows, RLS, or the database. No migrations.
- Won't convert *every* form to autosave — only the ones called out. Tell me if you want a specific screen included.
