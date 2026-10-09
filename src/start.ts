import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { getTeamPreview, isPreviewSafeFn, PREVIEW_HEADER, PREVIEW_MESSAGE } from "@/lib/team-preview";

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

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, teamPreviewGuard],
  requestMiddleware: [errorMiddleware],
}));
