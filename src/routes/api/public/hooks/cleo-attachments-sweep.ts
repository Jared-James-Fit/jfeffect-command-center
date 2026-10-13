import { createFileRoute } from "@tanstack/react-router";
import { authorizeHookRequest } from "@/lib/hook-auth.server";

/**
 * Daily (pg_cron cleo-attachments-sweep): deletes Cleo attachment files whose
 * message is gone (chat deleted, or cleared after a year) and uploads that
 * were never sent. Auth is the same as the other scheduled hooks.
 */
export const Route = createFileRoute("/api/public/hooks/cleo-attachments-sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizeHookRequest(request))) return new Response("Unauthorized", { status: 401 });
        const { sweepAttachments } = await import("@/lib/cleo-attachments.server");
        return Response.json(await sweepAttachments());
      },
    },
  },
});
