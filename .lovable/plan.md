# Published app blank screen — diagnosis (nothing changed)

## What was found
- **Build:** the latest builds for the current commit succeeded ("build OK" at 20:27 and 20:35 UTC). No build errors.
- **Published files:** jfeffect.com serves `styles-CNR8slBJ.css`, `index-PMChnbkT.js`, `index-B-YM3NyC.js`, `launch-home-DOWelA_w.js` and `view-mode-D_yRcBph.js`. All return 200, so no missing JS/CSS files.
- **Signed out, /auth on jfeffect.com:** the page paints "Opening your dashboard…" for about a second, then the browser tab **freezes**. It stops answering at all, so even a debugger pause or profiler stop can't get in. No console errors, no page errors and no failed requests are logged before the freeze. This is the blank or stuck screen.
- **Same page with the offline helper blocked** (`/sw.js` and `/push-sw.js`): it loads normally and shows "Welcome back · Sign in to JF Effect". Blocking only Lovable's own analytics scripts does **not** fix it.
- **Local preview** (the offline helper is off there): no freeze.
- I couldn't run the signed-in checks (/, /admin/community, /portal/community), because the tab already freezes before sign-in matters.

## Likely cause (not confirmed)
The freeze starts when the offline helper (`sw.js`, set up in `vite.config.ts` and registered by `src/lib/pwa/register-sw.ts`) takes control of the page. A good suspect is the `controllerchange` → `window.location.reload()` handler in `register-sw.ts` (around lines 80–88), together with `skipWaiting` + `clientsClaim`. Another is the imported `/push-sw.js?v=20261014-open-link`. Neither of the last two Crew/Lessons commits touched these files. The latest unpublished work-in-progress commit only bumped `@lovable.dev/vite-tanstack-config` 2.25.3 → 2.26.5, which builds this offline helper. That makes it the main suspect if that version went into the last publish. There's no error text or file/line to quote, because the tab freezes without throwing anything.

## Next steps (read-only, need approval)
1. Repeat the load with only `/push-sw.js` blocked, then with only `/sw.js` blocked, to find which one causes it.
2. Log offline-helper events (install, activate, controllerchange, reloads) to see if it's a reload loop or a freeze inside the helper.
3. Check the published build against the `vite-tanstack-config` version.

**Workaround for you right now:** open `https://jfeffect.com/?sw=off`. This stops the app from registering the offline helper on that device.
