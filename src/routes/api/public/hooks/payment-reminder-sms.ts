import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled hook (pg_cron, every 30 minutes) that (1) pushes the payment setup
 * reminders the database just inserted and (2) sends the single
 * "check your app messages" text for unpaid payment links.
 *
 * Auth: the cron job sends `x-reminder-secret`, a random secret kept in the
 * database's Vault and compared here via payment_reminder_hook_secret(). It is
 * independent of the worker-secret env var the other hooks use.
 */
export const Route = createFileRoute("/api/public/hooks/payment-reminder-sms")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const provided = request.headers.get("x-reminder-secret") ?? "";
        const { data: expected } = await supabaseAdmin.rpc("payment_reminder_hook_secret");
        if (!provided || typeof expected !== "string" || !expected || !timingSafeEqualStr(provided, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          // Push for the reminders the database just inserted. Best-effort: it
          // must never stop the text from going out.
          let push = { pushed: 0, skipped: 0 };
          try {
            const { pushNewPaymentReminders } = await import("@/lib/payment-reminder-push.server");
            const { sendWebPushToUser } = await import("@/lib/push/push.server");
            push = await pushNewPaymentReminders(supabaseAdmin, { sendWebPushToUser });
          } catch (e: any) {
            console.error("[payment-reminder-sms] push step failed", e?.message ?? e);
          }

          const { runPaymentSmsSweep } = await import("@/lib/payment-sms.server");
          const { sendViaTwilio, normalizePhone } = await import("@/lib/sms.functions");
          const result = await runPaymentSmsSweep(supabaseAdmin, { sendSms: sendViaTwilio, normalizePhone });
          return Response.json({ ok: true, ...result, push });
        } catch (e: any) {
          console.error("[payment-reminder-sms] sweep failed", e?.message ?? e);
          return Response.json({ ok: false, error: "sweep_failed" }, { status: 500 });
        }
      },
    },
  },
});

/** Constant-time string compare (length mismatch fails fast). */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
