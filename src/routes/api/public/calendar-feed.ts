import { createFileRoute } from "@tanstack/react-router";

/**
 * A client's private, read-only calendar feed (?t=<token>), for subscribing
 * from Google, Apple or Outlook Calendar. The token is the only key, so it's
 * long and random, and the client can reset it from their Schedule.
 *
 * Contains their sessions from the last 30 days on (cancelled ones stay in as
 * CANCELLED so subscribed calendars remove them) and coach events they're in.
 */
export const Route = createFileRoute("/api/public/calendar-feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("t")?.replace(/\.ics$/i, "") ?? "";
        if (!/^[a-f0-9]{48}$/.test(token)) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { buildIcsFeed } = await import("@/lib/ics-feed");
        const { wallTimeToUtc } = await import("@/lib/schedule-time");
        const admin = supabaseAdmin as any;

        const { data: client } = await admin
          .from("clients")
          .select("id, first_name, full_name")
          .eq("calendar_feed_token", token)
          .maybeSingle();
        if (!client) return new Response("Not found", { status: 404 });

        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const today = new Date().toISOString().slice(0, 10);
        const [{ data: sessions }, { data: assigned }] = await Promise.all([
          admin
            .from("pt_sessions")
            .select("id, title, session_type, starts_at, ends_at, location, notes, client_visible_notes, status, updated_at")
            .eq("client_id", client.id)
            .eq("visible_to_client", true)
            .gte("starts_at", since)
            .order("starts_at", { ascending: true })
            .limit(500),
          admin.from("event_assignments").select("event_id").eq("client_id", client.id),
        ]);
        const assignedIds = ((assigned ?? []) as any[]).map((r) => r.event_id);
        const { data: events } = await admin
          .from("events")
          .select("id, name, event_type, event_date, start_time, end_time, timezone, location, client_facing_notes, status, audience_scope, updated_at")
          .in("status", ["Active", "Completed"])
          .gte("event_date", today)
          .limit(200);

        const origin = new URL(request.url).origin;
        const feedEvents = [
          ...((sessions ?? []) as any[])
            .filter((s) => s.status !== "Rescheduled")
            .map((s) => ({
              uid: `pt-${s.id}@jfeffect.com`,
              start: new Date(s.starts_at),
              end: new Date(s.ends_at),
              summary: s.title || s.session_type || "Training session",
              location: s.location,
              description: s.client_visible_notes && s.notes ? s.notes : null,
              url: `${origin}/portal/calendar`,
              cancelled: s.status === "Cancelled",
              lastModified: s.updated_at ? new Date(s.updated_at) : null,
            })),
          ...((events ?? []) as any[])
            .filter((e) => assignedIds.includes(e.id) || e.audience_scope === "all_coaching")
            .filter((e) => e.start_time)
            .map((e) => {
              const tz = e.timezone || "America/Winnipeg";
              const start = wallTimeToUtc(e.event_date, String(e.start_time).slice(0, 5), tz);
              const end = e.end_time
                ? wallTimeToUtc(e.event_date, String(e.end_time).slice(0, 5), tz)
                : new Date(start.getTime() + 60 * 60 * 1000);
              return {
                uid: `event-${e.id}@jfeffect.com`,
                start,
                end: end > start ? end : new Date(start.getTime() + 60 * 60 * 1000),
                summary: e.name,
                location: e.location,
                description: e.client_facing_notes,
                url: `${origin}/portal/events/${e.id}`,
                lastModified: e.updated_at ? new Date(e.updated_at) : null,
              };
            }),
        ];

        const first = (client.first_name || client.full_name?.split(" ")[0] || "").trim();
        const ics = buildIcsFeed({ name: first ? `JF Effect · ${first}` : "JF Effect", events: feedEvents });
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
