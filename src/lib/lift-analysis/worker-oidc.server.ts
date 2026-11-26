/**
 * GitHub's published OIDC keys (cached an hour per server instance, fetched
 * again once when a token names a key that isn't cached: GitHub rotates them),
 * and the check of a worker's bearer token (worker-oidc.ts).
 */
import { OIDC_ISSUER, verifyWorkerToken, type Jwk, type OidcClaims } from "./worker-oidc";

let cache: { at: number; keys: Jwk[] } | null = null;

async function githubKeys(force = false): Promise<Jwk[]> {
  if (!force && cache && Date.now() - cache.at < 3600_000) return cache.keys;
  const res = await fetch(`${OIDC_ISSUER}/.well-known/jwks`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  cache = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
  return cache.keys;
}

export async function authorizeWorker(
  request: Request,
): Promise<{ ok: true; claims: OidcClaims } | { ok: false; why: string }> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.length > 8000) return { ok: false, why: "missing" };
  let res = await verifyWorkerToken(token, await githubKeys());
  if (!res.ok && res.why === "key") res = await verifyWorkerToken(token, await githubKeys(true));
  return res;
}
