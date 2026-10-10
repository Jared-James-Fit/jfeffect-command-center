import { createFileRoute } from "@tanstack/react-router";

/**
 * Google sign-in callback (the one redirect URI registered with Google).
 * Two flows share it, told apart by the signed state:
 *   - kind "client_cal": a client's Connect Google Calendar
 *     (src/lib/client-gcal.server.ts). Ends on a small page instead of a
 *     redirect: from the installed app on iPhone, Google's sign-in opens in a
 *     browser sheet that isn't signed in to the app, so "you're connected, go
 *     back" is what works everywhere.
 *   - otherwise: the older per-coach connection (admin Google Calendar page).
 */
export const Route = createFileRoute("/api/public/google/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const origin = `${url.protocol}//${url.host}`;
        const { verifyOAuthState, exchangeCode, decodeIdTokenEmail } = await import("@/lib/google-cal.server");

        let decoded: Record<string, any> | null = null;
        try {
          decoded = state ? verifyOAuthState(state) : null;
        } catch {
          decoded = null;
        }

        if (decoded?.kind === "client_cal" || (!decoded && state && isClientState(state))) {
          return clientCallback({ code, error, decoded, origin });
        }

        if (error) {
          return htmlRedirect(`/admin/google-calendar?error=${encodeURIComponent(error)}`);
        }
        if (!code || !state) {
          return htmlRedirect("/admin/google-calendar?error=missing_code");
        }
        if (!decoded?.coach_id) {
          return htmlRedirect("/admin/google-calendar?error=invalid_state");
        }
        try {
          const tokens = await exchangeCode(code, origin);
          const email = decodeIdTokenEmail(tokens.id_token);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("google_calendar_connections").upsert({
            coach_id: decoded.coach_id,
            user_id: decoded.user_id,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token ?? null,
            token_expires_at: new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString(),
            google_account_email: email,
            selected_calendar_id: "primary",
            selected_calendar_name: "Primary calendar",
            scopes: tokens.scope ?? null,
            status: "connected",
            last_synced_at: new Date().toISOString(),
            last_error: null,
          }, { onConflict: "coach_id" });
          return htmlRedirect("/admin/google-calendar?connected=1");
        } catch (e: any) {
          return htmlRedirect(`/admin/google-calendar?error=${encodeURIComponent(e?.message ?? "exchange_failed")}`);
        }
      },
    },
  },
});

/** An expired client state still says what it was for, so the client gets the right page. */
function isClientState(state: string): boolean {
  try {
    const body = JSON.parse(Buffer.from(state.split(".")[0] ?? "", "base64url").toString("utf8"));
    return body?.kind === "client_cal";
  } catch {
    return false;
  }
}

async function clientCallback(args: {
  code: string | null;
  error: string | null;
  decoded: Record<string, any> | null;
  origin: string;
}): Promise<Response> {
  const { safeReturnPath, connectErrorMessage } = await import("@/lib/client-gcal");
  const back = safeReturnPath(args.decoded?.ret);
  if (args.error) return resultPage({ ok: false, message: connectErrorMessage(args.error), back });
  if (!args.decoded?.client_id || !args.decoded?.user_id || !args.code) {
    return resultPage({ ok: false, message: connectErrorMessage("invalid_state"), back });
  }
  const { clientGoogleConfigured, completeClientConnect, ConnectError, oauthOrigin } = await import("@/lib/client-gcal.server");
  if (!clientGoogleConfigured()) return resultPage({ ok: false, message: connectErrorMessage("not_configured"), back });
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { email } = await completeClientConnect(supabaseAdmin as any, {
      code: args.code,
      // The same fixed address the sign-in started with (Google requires an exact match).
      origin: oauthOrigin(),
      clientId: String(args.decoded.client_id),
      userId: String(args.decoded.user_id),
    });
    return resultPage({
      ok: true,
      message: `Your sessions and workouts are now in a "JF Effect" calendar${email ? ` in ${email}` : ""}. Changes show up on their own within a few minutes.`,
      back,
    });
  } catch (e: any) {
    console.error("[client-gcal] connect failed", e);
    const code = e instanceof ConnectError ? e.code : null;
    return resultPage({ ok: false, message: connectErrorMessage(code), back });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function resultPage(opts: { ok: boolean; message: string; back: string }): Response {
  const title = opts.ok ? "Google Calendar connected" : "Google Calendar not connected";
  const icon = opts.ok
    ? '<path d="M20 6 9 17l-5-5"/>'
    : '<path d="M12 8v5"/><path d="M12 16.5h.01"/><circle cx="12" cy="12" r="9"/>';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>${title} · JF Effect</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0b0b0c;color:#f4f4f5;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
.card{max-width:420px;width:100%;text-align:center}
.icon{width:56px;height:56px;margin:0 auto 16px;border-radius:999px;display:grid;place-items:center;background:${opts.ok ? "rgba(16,185,129,.15)" : "rgba(245,158,11,.15)"};color:${opts.ok ? "#10b981" : "#f59e0b"}}
h1{font-size:22px;margin:0 0 8px}
p{color:#a1a1aa;margin:0 0 24px}
a.btn{display:block;padding:14px 16px;border-radius:12px;background:#ef4444;color:#fff;font-weight:700;text-decoration:none}
small{display:block;margin-top:14px;color:#71717a}
</style></head>
<body><main class="card">
<div class="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></div>
<h1>${title}</h1>
<p>${escapeHtml(opts.message)}</p>
<a class="btn" href="${escapeHtml(opts.back)}">Back to JF Effect</a>
<small>Using the app from your home screen? Tap Done to go back to it.</small>
</main></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function htmlRedirect(to: string): Response {
  return new Response(
    `<!doctype html><meta http-equiv="refresh" content="0;url=${to}"><script>location.replace(${JSON.stringify(to)})</script><p>Redirecting…</p>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
