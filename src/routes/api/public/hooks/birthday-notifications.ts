import { createFileRoute } from "@tanstack/react-router";

/**
 * Fires web push notifications for every active client whose birthday is
 * today. Deduped per (user_id, year) via push_notification_dedupe so it's
 * safe to run hourly from pg_cron across timezones.
 */
export const Route = createFileRoute("/api/public/hooks/birthday-notifications")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendWebPushToUser } = await import("@/lib/push/push.server");

        const now = new Date();
        const month = now.getUTCMonth() + 1;
        const day = now.getUTCDate();
        const year = now.getUTCFullYear();

        const { data: clients, error } = await supabaseAdmin
          .from("clients")
          .select("id, user_id, first_name, preferred_name, full_name, date_of_birth")
          .eq("archived", false)
          .not("date_of_birth", "is", null)
          .not("user_id", "is", null);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const todays = (clients ?? []).filter((c) => {
          if (!c.date_of_birth) return false;
          const d = new Date(c.date_of_birth + "T00:00:00Z");
          return d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
        });

        let sent = 0;
        let skipped = 0;
        const results: any[] = [];

        for (const c of todays) {
          if (!c.user_id) continue;

          // Respect enabled flag if a per-client card row exists.
          const { data: card } = await supabaseAdmin
            .from("client_birthday_cards")
            .select("enabled")
            .eq("client_id", c.id)
            .maybeSingle();
          if (card && card.enabled === false) { skipped++; continue; }

          const first = c.first_name || c.preferred_name || (c.full_name?.split(" ")[0] ?? "there");
          const r = await sendWebPushToUser(
            supabaseAdmin,
            c.user_id,
            {
              title: `Happy Birthday, ${first}! 🎂`,
              body: "Your JF Effect coach left you a birthday message — tap to open it.",
              url: "/portal",
              tag: `bday:${year}`,
              data: { kind: "birthday", clientId: c.id, year },
            },
            { eventKey: `bday:${c.user_id}:${year}` },
          );
          if (r.sent > 0) sent++;
          else if (r.skipped) skipped++;
          results.push({ clientId: c.id, ...r });
        }

        return Response.json({ ok: true, day: `${year}-${month}-${day}`, considered: todays.length, sent, skipped, results });
      },
    },
  },
});