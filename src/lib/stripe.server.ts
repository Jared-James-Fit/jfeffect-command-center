// Shared Stripe REST helpers (no SDK). Used by JF Membership billing fns.
const STRIPE_API = "https://api.stripe.com/v1";

function key(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY in project secrets.");
  return k;
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

export async function stripeFetch(path: string, init: { method?: string; body?: string; idempotencyKey?: string } = {}): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key()}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const res = await fetch(`${STRIPE_API}${path}`, { method: init.method ?? "GET", headers, body: init.body });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error (${res.status})`);
  return json;
}
