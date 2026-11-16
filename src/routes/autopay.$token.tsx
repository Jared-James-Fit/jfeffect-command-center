import { createFileRoute } from "@tanstack/react-router";

/**
 * A client's "set up auto-pay" link: https://jfeffect.com/autopay/<token>
 * (auto-pay.functions.ts sends it in their chat). Resolves the change on the
 * server and 302-redirects to its Stripe Checkout, minting a fresh one when
 * the last has expired, so the link works until they finish it. Opening it
 * never charges anything: Stripe charges on the first payment date they agree
 * to at checkout.
 */
export const Route = createFileRoute("/autopay/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = String((params as any).token ?? "");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: change } = token.length >= 16
          ? await (supabaseAdmin as any).from("auto_pay_changes").select("*").eq("token", token).maybeSingle()
          : { data: null };
        if (!change) return html(404, "Link not found", "This auto-pay link doesn't exist. Ask your coach for a new one.");
        if (change.status === "completed") return html(200, "Auto-pay is set up", "You're all set. Nothing more to do.");
        if (change.status !== "pending") return html(410, "Link no longer needed", "Your coach replaced or cancelled this auto-pay link. Check your messages for the newest one.");
        try {
          const { mintAutoPayCheckout } = await import("@/lib/auto-pay.server");
          const { url } = await mintAutoPayCheckout(supabaseAdmin as any, change, "https://jfeffect.com");
          return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
        } catch (e: any) {
          console.error("[autopay] mint failed", e);
          return html(503, "Couldn't open the payment page", "Stripe didn't answer. Try again in a minute, or message your coach.");
        }
      },
    },
  },
});

function html(status: number, title: string, message: string): Response {
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Auto-pay — JF Effect</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#f5f5f5;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px}
.c{max-width:26rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{opacity:.75;margin:0}</style>
</head><body><div class="c"><h1>${esc(title)}</h1><p>${esc(message)}</p></div></body></html>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
