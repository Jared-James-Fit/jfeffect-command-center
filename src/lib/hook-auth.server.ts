/**
 * hook-auth.server.ts
 *
 * One shared check for the scheduled hooks under /api/public/hooks/*.
 *
 * A request is accepted when it carries EITHER
 *   - `x-worker-secret` equal to the SCHEDULED_WORKER_SECRET env var (the original scheme), OR
 *   - `x-hook-secret` equal to the random secret kept in the database's Vault
 *     (`cron_hook_secret`), which is what the pg_cron jobs send.
 *
 * Why the second path exists: the cron jobs only ever had the public anon key
 * (`apikey` header), so once the hooks started requiring the worker secret every
 * scheduled call was rejected (HTTP 401) while pg_cron kept reporting
 * "succeeded". The Vault secret is generated inside the database and read by the
 * cron job itself, so the two sides can't drift apart again. The anon key is
 * public and is deliberately NOT accepted.
 */

/** Constant-time string compare (length mismatch fails fast). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type HookAuthDeps = {
  /** Value of SCHEDULED_WORKER_SECRET (defaults to the env var). */
  workerSecret?: string;
  /** Reads the Vault-held cron secret (defaults to the database RPC). */
  getVaultSecret?: () => Promise<string | null>;
};

async function defaultVaultSecret(): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any).rpc("cron_hook_secret");
  if (error || typeof data !== "string" || !data) return null;
  return data;
}

export async function authorizeHookRequest(request: Request, deps: HookAuthDeps = {}): Promise<boolean> {
  const workerSecret = deps.workerSecret ?? process.env.SCHEDULED_WORKER_SECRET ?? "";
  const providedWorker = request.headers.get("x-worker-secret") ?? "";
  if (workerSecret && providedWorker && timingSafeEqualStr(providedWorker, workerSecret)) return true;

  const providedHook = request.headers.get("x-hook-secret") ?? "";
  if (!providedHook) return false;
  try {
    const expected = await (deps.getVaultSecret ?? defaultVaultSecret)();
    return !!expected && timingSafeEqualStr(providedHook, expected);
  } catch {
    return false;
  }
}
