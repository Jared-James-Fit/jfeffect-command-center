import { createFileRoute } from "@tanstack/react-router";
import { birthdayPushYear } from "@/lib/birthday-push";

/**
 * Fires web push notifications for every active client whose birthday is
 * today. Deduped per (user_id, year) via push_notification_dedupe so it's
 * safe to run hourly from pg_cron across timezones.
 *
 * Also: birthday posts (drafts for the coach to review, approved ones going
 * out at 8am their time; birthday-posts.server.ts), and the hourly push tick:
 * releases pushes held during quiet hours, the
 * 8am-local daily game plan and the monthly recap-ready push.
 */
export const Route = createFileRoute("/api/public/hooks/birthday-notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ---------- Shared hook auth (worker secret or Vault cron secret) ----------
        if (!(await authorizeWorker(request))) return new Response("unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendWebPushToUser } = await import("@/lib/push/push.server");

        const now = new Date();

        const { data: clients, error } = await supabaseAdmin
          .from("clients")
          .select("id, user_id, first_name, preferred_name, full_name, date_of_birth, timezone")
          .eq("archived", false)
          .not("date_of_birth", "is", null)
          .not("user_id", "is", null);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        // Due when it is the client's birthday in THEIR timezone and morning or
        // later for them (not the UTC date, which fired the evening before).
        const todays = (clients ?? [])
          .map((c) => ({ c, year: birthdayPushYear(c.date_of_birth, (c as any).timezone, now) }))
          .filter((x): x is { c: typeof x.c; year: number } => x.year !== null);

        let sent = 0;
        let skipped = 0;
        const results: any[] = [];

        for (const { c, year } of todays) {
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
            { category: "wins", eventKey: `bday:${c.user_id}:${year}` },
          );
          if (r.sent > 0) sent++;
          else if (r.skipped) skipped++;
          results.push({ clientId: c.id, ...r });
        }

        // Birthday posts: drafts for the coach to review, approved ones going out at 8am theirs.
        let birthdayPosts: unknown = null;
        try {
          const { runBirthdayPosts } = await import("@/lib/birthday-posts.server");
          const { notifyAppEvent } = await import("@/lib/push/app-events.server");
          birthdayPosts = await runBirthdayPosts(supabaseAdmin, { notifyAppEvent, sendWebPushToUser });
        } catch (e: any) {
          birthdayPosts = { error: String(e?.message ?? e) };
        }

        let tick: unknown = null;
        try {
          const { runPushTick } = await import("@/lib/push/scheduled-pushes.server");
          tick = await runPushTick(supabaseAdmin);
        } catch (e: any) {
          tick = { error: String(e?.message ?? e) };
        }

        return Response.json({ ok: true, day: now.toISOString().slice(0, 10), considered: todays.length, sent, skipped, results, birthdayPosts, tick });
      },
    },
  },
});

/** Shared hook auth: worker secret (env) or the Vault-held cron secret. */
async function authorizeWorker(request: Request): Promise<boolean> {
  const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
  return authorizeHookRequest(request);
}