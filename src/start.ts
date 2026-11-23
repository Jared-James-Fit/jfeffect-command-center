import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { getTeamPreview, isPreviewSafeFn, PREVIEW_HEADER, PREVIEW_MESSAGE } from "@/lib/team-preview";
import { mfaExemptFn } from "@/lib/mfa-rules";

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

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, staffMfaGuard, teamPreviewGuard],
  requestMiddleware: [errorMiddleware],
}));
