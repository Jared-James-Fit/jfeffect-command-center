import { createFileRoute } from "@tanstack/react-router";

/**
 * Back-office: send a client an auto-pay setup link (a new auto-pay, or one
 * that replaces theirs once they finish it), exactly as Billing → Auto-pay →
 * Send the setup link does, posted in their chat as `actor_user_id` (an
 * admin). Called from the database with the vault's cron_hook_secret, never
 * from a browser. A preview unless `apply: true`. Nothing is charged: Stripe
 * charges only from the first payment date the client agrees to at checkout.
 */
export const Route = createFileRoute("/api/public/hooks/auto-pay-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = await request.json().catch(() => ({}));
        const { StartChange } = await import("@/lib/auto-pay.functions");
        const parsed = StartChange.safeParse(body?.change);
        const actor = String(body?.actor_user_id ?? "");
        if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(actor)) {
          return Response.json({ error: "change { clientId, saleId, eachWithTaxCents, every, firstDate } and actor_user_id are required" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any;
        const { data: role } = await admin.from("user_roles").select("role").eq("user_id", actor).eq("role", "admin").maybeSingle();
        if (!role) return Response.json({ error: "actor_user_id must be an admin" }, { status: 400 });
        const { sendAutoPayChange } = await import("@/lib/auto-pay.server");
        try {
          const r = await sendAutoPayChange({
            admin,
            db: admin,
            actorUserId: actor,
            input: parsed.data,
            origin: "https://jfeffect.com",
            preview: body?.apply !== true,
          });
          return Response.json({ ok: true, applied: body?.apply === true, ...r });
        } catch (e: any) {
          return Response.json({ error: e?.message ?? String(e) }, { status: 400 });
        }
      },
    },
  },
});
