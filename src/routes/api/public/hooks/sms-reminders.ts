import { createFileRoute } from "@tanstack/react-router";

/**
 * The SMS tick (pg_cron `sms-unread-reminders`, every 10 minutes):
 * 1. the unread-message nudge (push first, text as the fallback),
 * 2. what Twilio did with recent texts (delivered, price, opt-outs),
 * 3. this month's real Twilio bill, at most once an hour.
 * Each part is independent; one failing never stops the others.
 */
export const Route = createFileRoute("/api/public/hooks/sms-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizeWorker(request))) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const out: Record<string, unknown> = { ok: true };
        try {
          const { runReminderSweep } = await import("@/lib/sms-unread-reminders.server");
          out.unread = await runReminderSweep(supabaseAdmin);
        } catch (e: any) {
          out.ok = false;
          out.unread = { error: e?.message ?? String(e) };
        }
        try {
          const { pollSmsStatuses, refreshTwilioUsage } = await import("@/lib/sms-status.server");
          out.statuses = await pollSmsStatuses(supabaseAdmin);
          const usage = await refreshTwilioUsage(supabaseAdmin);
          out.usage = usage ? { month: usage.month, error: usage.error ?? null } : null;
        } catch (e: any) {
          out.statuses = { error: e?.message ?? String(e) };
        }
        return Response.json(out, { status: out.ok ? 200 : 500 });
      },
    },
  },
});

/** Shared hook auth: worker secret (env) or the Vault-held cron secret. */
async function authorizeWorker(request: Request): Promise<boolean> {
  const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
  return authorizeHookRequest(request);
}
