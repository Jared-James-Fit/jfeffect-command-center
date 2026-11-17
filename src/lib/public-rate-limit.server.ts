// Per-caller limits for public (signed-out) server functions: the coaching
// application, its saved drafts and online booking. Each of those costs real
// money or reaches real people (an AI lead reply, a text and emails to the
// coach, a Google invitation from the coach's calendar), so one caller must
// not be able to repeat them at will.
//
// Counts live in the database (public._challenge_rate_ok, the live
// challenges' limiter: one row per hit, pruned as it goes, service role only).
// A limiter that can't be reached never blocks a real person: it answers yes.

import { getRequestHeader } from "@tanstack/react-start/server";

/**
 * The caller's IP. Cloudflare sets cf-connecting-ip itself; the first
 * x-forwarded-for value is whatever the caller typed, so it's only a fallback
 * off Cloudflare (local dev).
 */
export function callerIp(): string | null {
  try {
    const cf = getRequestHeader("cf-connecting-ip");
    if (cf && cf.trim()) return cf.trim();
    const real = getRequestHeader("x-real-ip");
    if (real && real.trim()) return real.trim();
    const xff = getRequestHeader("x-forwarded-for");
    if (xff) return xff.split(",")[0]?.trim() || null;
  } catch {
    /* not in a request */
  }
  return null;
}

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** True while `key` has been hit fewer than `max` times in `window` (a Postgres interval, e.g. "1 hour"); counts this hit. */
export async function rateOk(db: RpcClient, key: string, max: number, window: string): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("_challenge_rate_ok", { p_key: key, p_max: max, p_window: window });
    if (error) {
      console.warn("[rate-limit] limiter unavailable", key.split(":")[0], (error as any)?.message ?? error);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.warn("[rate-limit] limiter failed", e);
    return true;
  }
}

/** Every limit must pass; each is counted (so a blocked caller keeps paying into their own window). */
export async function allRatesOk(db: RpcClient, limits: Array<{ key: string | null; max: number; window: string }>): Promise<boolean> {
  let ok = true;
  for (const l of limits) {
    if (!l.key) continue;
    if (!(await rateOk(db, l.key, l.max, l.window))) ok = false;
  }
  return ok;
}
