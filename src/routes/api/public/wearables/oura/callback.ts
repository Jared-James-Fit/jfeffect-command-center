import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/wearables/oura/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (url.searchParams.get("error")) return redirect("oura_denied");
        if (!code || !state) return redirect("oura_error");

        const { verifyWearableState, exchangeOuraCode } =
          await import("@/lib/wearables/oura.server");
        // The signed state is the only link between this public GET and the athlete who started it.
        const decoded = verifyWearableState(state);
        if (!decoded || decoded.provider !== "oura") return redirect("oura_error");

        try {
          const tokens = await exchangeOuraCode(code, url.origin);
          const { supabaseAdmin: typedAdmin } =
            await import("@/integrations/supabase/client.server");
          const supabaseAdmin = typedAdmin as any; // generated types predate the wearable tables
          const { data: conn, error } = await supabaseAdmin
            .from("wearable_connections")
            .upsert(
              {
                user_id: decoded.user_id,
                provider: "oura",
                status: "connected",
                scopes: null,
                last_error: null,
                sync_started_at: null,
              },
              { onConflict: "user_id,provider" },
            )
            .select("id")
            .single();
          if (error || !conn) throw new Error(error?.message ?? "connection_save_failed");
          await supabaseAdmin.from("wearable_connection_secrets").upsert({
            connection_id: conn.id,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token ?? null,
            token_expires_at: new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          });
          // Backfill ~30 days now so the athlete sees data immediately.
          const { syncConnection } = await import("@/lib/wearables/sync.server");
          await syncConnection(conn.id);
          return redirect("oura_connected");
        } catch {
          return redirect("oura_error");
        }
      },
    },
  },
});

function redirect(result: string): Response {
  const to = `/portal?wearable=${result}`;
  return new Response(
    `<!doctype html><meta http-equiv="refresh" content="0;url=${to}"><script>location.replace(${JSON.stringify(to)})</script><p>Redirecting…</p>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
