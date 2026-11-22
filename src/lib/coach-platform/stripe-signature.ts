/**
 * Verify a Stripe webhook signature (the "Stripe-Signature" header: t=…,v1=…)
 * with Web Crypto, in constant time, within a tolerance. The same check JF
 * Effect's payment webhook makes; kept here so coach seat billing has its own
 * endpoint and secret without touching that route (tested in
 * coach-billing.test.ts against signatures made with Node's crypto).
 */
export type SignatureCheck = { ok: boolean; reason: "matched" | "missing" | "bad_timestamp" | "mismatch" };

export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  opts: { toleranceSec?: number; nowSec?: number } = {},
): Promise<SignatureCheck> {
  if (!header || !secret) return { ok: false, reason: "missing" };
  const parts = header.split(",").map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith("t="))?.slice(2) ?? null;
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!ts || !sigs.length) return { ok: false, reason: "missing" };
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (!/^\d+$/.test(ts) || Math.abs(now - Number(ts)) > (opts.toleranceSec ?? 300)) return { ok: false, reason: "bad_timestamp" };
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${payload}`)));
  const ok = sigs.some((s) => {
    if (!/^[a-f0-9]{64}$/i.test(s)) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return diff === 0;
  });
  return { ok, reason: ok ? "matched" : "mismatch" };
}
