# Admin "Something went wrong loading this page" — diagnosis

## Findings so far (nothing changed)
- Build log: last build carries two type errors, `src/components/sms-personal-dialog.tsx(34,33)` and `src/lib/onboarding-admin.functions.ts(107,46)` (TS2589 "Type instantiation is excessively deep"). These are type-check only and do not stop the page from running.
- Preview/published browser logs: none captured for this message (no console, runtime or network log files exist).
- Server function logs (published, last hour): empty — no server-side errors recorded.
- Backend: database and login both reachable and healthy.
- Local reproduction signed in as jaredjamesfit@gmail.com: /admin stays on "Loading your dashboard… Checking your account…" without reaching the error screen; no console or network errors fired.

The exact error message and file/line are therefore not yet confirmed.

## Next steps (read-only)
1. Open the published /admin pages signed in, expand "Error details" on the error screen and capture the message and stack.
2. Capture failed server calls on those pages and match them to the server function logs.
3. Report the exact error and the file/line it points to. No code edits or migrations.

Fastest help from you: on the error screen, tap "Error details" and paste the text here.
