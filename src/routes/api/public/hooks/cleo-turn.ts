import { createFileRoute } from "@tanstack/react-router";

/**
 * One of Cleo's answers, written in the background (Nov 24 2026). Called by the
 * database the moment a question is saved (`cleo_turn_dispatch`, with
 * `{ messageId }` and the asker's session token in `x-cleo-session`), and again
 * by the app's poll when an answer was never picked up. The hook secret proves
 * the call came from the database; the token decides who it answers as (it
 * must be the message's owner, with Cleo and a confirmed two-step), so every
 * read is that person's own (RLS). See runTurn in src/lib/cleo-turns.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/cleo-turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const token = (request.headers.get("x-cleo-session") ?? "").trim();
        let messageId: string | null = null;
        try {
          const body = (await request.json()) as { messageId?: unknown };
          if (typeof body?.messageId === "string" && /^[0-9a-f-]{36}$/i.test(body.messageId)) messageId = body.messageId;
        } catch {
          // no body
        }
        if (!token || !messageId) return Response.json({ error: "messageId and a session are required" }, { status: 400 });
        const { runTurn } = await import("@/lib/cleo-turns.server");
        try {
          return Response.json(await runTurn(messageId, token));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
