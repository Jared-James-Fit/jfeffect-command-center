import { createFileRoute } from "@tanstack/react-router";

/**
 * A client's private, read-only calendar feed (?t=<token>), for subscribing
 * from Google, Apple or Outlook Calendar. The token is the only key, so it's
 * long and random, and the client can reset it from their Schedule.
 *
 * Contents: their 1:1 sessions, scheduled workouts and coach events
 * (src/lib/calendar-feed.server.ts). Each fetch by a real calendar app is
 * recorded on the client; that's what turns the Setup card green.
 */
export const Route = createFileRoute("/api/public/calendar-feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("t")?.replace(/\.ics$/i, "") ?? "";
        if (!/^[a-f0-9]{48}$/.test(token)) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { buildIcsFeed } = await import("@/lib/ics-feed");
        const { buildClientFeedEvents } = await import("@/lib/calendar-feed.server");
        const { calendarAppFromUserAgent } = await import("@/lib/calendar-sync");
        const admin = supabaseAdmin as any;

        const { data: client } = await admin
          .from("clients")
          .select("id, first_name, full_name")
          .eq("calendar_feed_token", token)
          .maybeSingle();
        if (!client) return new Response("Not found", { status: 404 });

        const origin = new URL(request.url).origin;
        const events = await buildClientFeedEvents(admin, client.id, origin);

        // Proof of sync for the Setup card. Browsers and link previews don't
        // count; writes are throttled to one per 10 minutes per client.
        const app = calendarAppFromUserAgent(request.headers.get("user-agent"));
        if (app) {
          const { data: prev } = await admin
            .from("client_calendar_sync")
            .select("last_fetch_at, app, fetch_count")
            .eq("client_id", client.id)
            .maybeSingle();
          const last = prev?.last_fetch_at ? new Date(prev.last_fetch_at).getTime() : 0;
          if (!prev || Date.now() - last > 10 * 60 * 1000 || prev.app !== app) {
            await admin.from("client_calendar_sync").upsert(
              {
                client_id: client.id,
                last_fetch_at: new Date().toISOString(),
                app,
                fetch_count: Number(prev?.fetch_count ?? 0) + 1,
              },
              { onConflict: "client_id" },
            );
          }
        }

        const first = (client.first_name || client.full_name?.split(" ")[0] || "").trim();
        const ics = buildIcsFeed({ name: first ? `JF Effect · ${first}` : "JF Effect", events });
        return new Response(ics, {
          status: 200,
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'inline; filename="jf-effect.ics"',
            "Cache-Control": "private, max-age=300",
            "X-Robots-Tag": "noindex",
          },
        });
      },
    },
  },
});
