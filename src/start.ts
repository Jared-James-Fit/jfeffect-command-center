import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { getTeamPreview, isPreviewSafeFn, PREVIEW_HEADER, PREVIEW_MESSAGE } from "@/lib/team-preview";
import { mfaExemptFn } from "@/lib/mfa-rules";
import { NATIVE_APP_HEADER } from "@/lib/native-purchases";
import { POV_MODE_HEADER, POV_OWN_FNS, POV_SESSION_HEADER, POV_VIEW_ONLY_MESSAGE } from "@/lib/pov/pov-rules";
import { povHeaders } from "@/lib/pov/pov-store";
import { isNative } from "@/platform";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * "View as" a team member (src/lib/team-preview.ts): while the owner previews
 * someone's workspace, the browser marks every server call and the server
 * refuses anything that isn't a read. The mark only takes rights away.
 */
const teamPreviewGuard = createMiddleware({ type: "function" })
  .client(async ({ next }) => next({ headers: getTeamPreview() ? { [PREVIEW_HEADER]: "1" } : {} }))
  .server(async ({ next, serverFnMeta }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    if (getRequest()?.headers.get(PREVIEW_HEADER) && !isPreviewSafeFn(serverFnMeta?.name)) {
      throw new Error(PREVIEW_MESSAGE);
    }
    return next();
  });

/**
 * An account view ("view as", src/lib/pov/pov-rules.ts): every server call made inside one says
 * which view and whether edits are on. While it's view-only the server refuses anything that
 * isn't a read (a GET, or a read by name, the team preview's rule); with edits on, each change is
 * noted on the view's record. The marks only take rights away.
 */
const povGuard = createMiddleware({ type: "function" })
  .client(async ({ next }) => next({ headers: povHeaders() }))
  .server(async ({ next, serverFnMeta }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const session = req?.headers.get(POV_SESSION_HEADER);
    const name = serverFnMeta?.name ?? null;
    if (!session || !req || req.method === "GET" || (name && POV_OWN_FNS.has(name)) || isPreviewSafeFn(name)) return next();
    const { notePovCall } = await import("@/lib/pov/pov-guard.server");
    if (req.headers.get(POV_MODE_HEADER) !== "edit") {
      await notePovCall(req.headers.get("authorization"), session, "blocked", name);
      throw new Error(POV_VIEW_ONLY_MESSAGE);
    }
    await notePovCall(req.headers.get("authorization"), session, "write", name);
    return next();
  });

/**
 * Two-step sign-in (src/lib/mfa-rules.ts): a session from a login that has a
 * way to confirm, not confirmed yet, is refused before any server function
 * runs (many check admin rights themselves and then act as the server).
 */
const staffMfaGuard = createMiddleware({ type: "function" }).server(async ({ next, serverFnMeta }) => {
  // Only the calls that confirm a session are made before it's confirmed.
  if (!mfaExemptFn(serverFnMeta?.name)) {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { checkStaffMfa } = await import("@/lib/mfa-guard.server");
    await checkStaffMfa(getRequest()?.headers.get("authorization"));
  }
  return next();
});

/**
 * Every server call made inside the iPhone app says so (native-purchases.ts,
 * option B), on top of the build's user-agent stamp, so the server keeps paid
 * digital features to the web for self-serve members. The mark only takes
 * rights away.
 */
const nativeAppMark = createMiddleware({ type: "function" }).client(async ({ next }) =>
  next({ headers: isNative() ? { [NATIVE_APP_HEADER]: "1" } : {} }),
);

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, staffMfaGuard, teamPreviewGuard, povGuard, nativeAppMark],
  requestMiddleware: [errorMiddleware],
}));
