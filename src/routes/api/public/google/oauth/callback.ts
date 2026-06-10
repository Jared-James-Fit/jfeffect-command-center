import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/google/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const origin = `${url.protocol}//${url.host}`;
        if (error) {
          return htmlRedirect(`/admin/google-calendar?error=${encodeURIComponent(error)}`);
        }
        if (!code || !state) {
          return htmlRedirect("/admin/google-calendar?error=missing_code");
        }
        const { verifyOAuthState, exchangeCode, decodeIdTokenEmail } = await import("@/lib/google-cal.server");
        const decoded = verifyOAuthState(state);
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

function htmlRedirect(to: string): Response {
  return new Response(
    `<!doctype html><meta http-equiv="refresh" content="0;url=${to}"><script>location.replace(${JSON.stringify(to)})</script><p>Redirecting…</p>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}