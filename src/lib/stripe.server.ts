// Shared Stripe REST helpers (no SDK). Used by JF Membership billing fns.
const STRIPE_API = "https://api.stripe.com/v1";

function key(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY in project secrets.");
  return k;
}

export type StripeMode = "test" | "live";

export function detectStripeKeyMode(k: string | null | undefined): StripeMode | null {
  if (!k) return null;
  if (k.startsWith("sk_test_")) return "test";
  if (k.startsWith("sk_live_") || k.startsWith("rk_live_")) return "live";
  return null;
}

/** Returns the secret key for the requested mode, or null if not configured. */
export function getStripeKeyForMode(mode: StripeMode): string | null {
  if (mode === "test") {
    const k = process.env.STRIPE_SECRET_KEY_TEST;
    if (k && detectStripeKeyMode(k) === "test") return k;
    // Allow default key if it actually is a test key
    const def = process.env.STRIPE_SECRET_KEY;
    if (def && detectStripeKeyMode(def) === "test") return def;
    return null;
  }
  // live
  const def = process.env.STRIPE_SECRET_KEY;
  if (def && detectStripeKeyMode(def) === "live") return def;
  return null;
}

export function getStripeKeyDiagnostics() {
  const def = process.env.STRIPE_SECRET_KEY ?? null;
  const test = process.env.STRIPE_SECRET_KEY_TEST ?? null;
  return {
    default_mode: detectStripeKeyMode(def),
    test_key_present: !!test && detectStripeKeyMode(test) === "test",
    live_key_available: !!getStripeKeyForMode("live"),
    test_key_available: !!getStripeKeyForMode("test"),
  };
}

export function formEncode(
  params: Record<string, string | number | boolean | undefined | null | Array<any> | Record<string, any>>,
  prefix = "",
): string {
  const usp = new URLSearchParams();
  const add = (k: string, v: any) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => add(`${k}[${i}]`, item));
    } else if (typeof v === "object") {
      for (const [kk, vv] of Object.entries(v)) add(`${k}[${kk}]`, vv);
    } else {
      usp.append(k, String(v));
    }
  };
  for (const [k, v] of Object.entries(params)) add(prefix ? `${prefix}[${k}]` : k, v);
  return usp.toString();
}

export async function stripeFetch(
  path: string,
  init: { method?: string; body?: string; idempotencyKey?: string; apiKey?: string } = {},
): Promise<any> {
  const apiKey = init.apiKey ?? key();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const res = await fetch(`${STRIPE_API}${path}`, { method: init.method ?? "GET", headers, body: init.body });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error (${res.status})`);
  return json;
}
