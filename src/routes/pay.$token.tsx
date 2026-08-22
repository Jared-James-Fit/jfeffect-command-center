import { createFileRoute } from "@tanstack/react-router";

/**
 * Short, iMessage-safe payment link: https://jfeffect.com/pay/<token>
 *
 * Resolves the token server-side and 302-redirects to the exact canonical
 * Stripe URL (Checkout Session / hosted invoice / reusable Payment Link).
 * Opening this URL never creates a payment, subscription or ledger record.
 */
export const Route = createFileRoute("/pay/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { resolveShareToken } = await import("@/lib/payment-share.server");
        const tok = String((params as any)?.token ?? "");
        console.log("[pay] token=", tok);
        const result = await resolveShareToken(tok);
        if (result.ok) {
          return new Response(null, {
            status: 302,
            headers: { Location: result.url, "Cache-Control": "no-store" },
          });
        }
        return new Response(page(result.message), {
          status: result.status,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      },
    },
  },
});

function page(message: string): string {
  const safe = message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Payment link — JF Effect</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#f5f5f5;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px}
.c{max-width:26rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{opacity:.75;margin:0}</style>
</head><body><div class="c"><h1>Payment link unavailable</h1><p>${safe}</p></div></body></html>`;
}
