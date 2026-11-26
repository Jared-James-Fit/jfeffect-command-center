/**
 * Server half of the account view guard (src/start.ts): note a change made, or refused, inside an
 * account view on that view's record, with the staff member's own sign-in (admin_pov_touch only
 * accepts their own open view). Never fails the call it's noting.
 */
export async function notePovCall(
  authorization: string | null | undefined,
  sessionId: string,
  kind: "write" | "blocked",
  fnName: string | null | undefined,
): Promise<void> {
  if (!authorization?.startsWith("Bearer ") || !/^[0-9a-f-]{36}$/i.test(sessionId)) return;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await db.rpc("admin_pov_touch" as any, {
      _session: sessionId,
      _events: [{ kind, target: `fn:${fnName ?? "unknown"}`.slice(0, 120), at: new Date().toISOString() }],
    } as any);
  } catch (e) {
    console.warn("[pov] couldn't note the call", (e as Error)?.message);
  }
}
