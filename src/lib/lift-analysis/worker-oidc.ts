/**
 * Who may read set videos on the server (pure): only this repository's own
 * velocity worker, run by GitHub Actions on GitHub's runners from `main`.
 * GitHub signs a short-lived OIDC token for each job (id-token: write); the
 * hook checks its signature against GitHub's published keys
 * (worker-oidc.server.ts) and these claims. Nothing is stored anywhere to
 * leak: no secret in GitHub, none in the app.
 *
 * Pinned by GitHub's numeric ids (a renamed or transferred repository, or a
 * fork, never matches), the default branch, the workflow file and a
 * GitHub-hosted runner, and only for scheduled or hand-started runs (never a
 * pull request's).
 */
export const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const WORKER_AUDIENCE = "jfeffect-velocity-worker";
export const WORKER_REPO = {
  id: "1261494398",
  ownerId: "291368398",
  name: "jared-james-fit/jfeffect-command-center",
} as const;
export const WORKER_WORKFLOW = ".github/workflows/velocity-worker.yml";
export const WORKER_EVENTS = ["schedule", "workflow_dispatch"] as const;

export type OidcClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  repository?: string;
  repository_id?: string;
  repository_owner_id?: string;
  ref?: string;
  event_name?: string;
  job_workflow_ref?: string;
  workflow_ref?: string;
  runner_environment?: string;
  run_id?: string;
};

/** Why a token's claims aren't this repository's worker (null: they are). */
export function workerClaimsProblem(c: OidcClaims, nowS: number): string | null {
  if (c.iss !== OIDC_ISSUER) return "issuer";
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(WORKER_AUDIENCE)) return "audience";
  if (typeof c.exp !== "number" || c.exp < nowS - 30) return "expired";
  if (typeof c.nbf === "number" && c.nbf > nowS + 60) return "not_yet";
  if (typeof c.iat === "number" && c.iat > nowS + 60) return "not_yet";
  if (String(c.repository_id) !== WORKER_REPO.id) return "repository";
  if (String(c.repository_owner_id) !== WORKER_REPO.ownerId) return "owner";
  if ((c.repository ?? "").toLowerCase() !== WORKER_REPO.name) return "repository";
  if (c.ref !== "refs/heads/main") return "ref";
  if (!(WORKER_EVENTS as readonly string[]).includes(c.event_name ?? "")) return "event";
  const wf = (c.job_workflow_ref ?? c.workflow_ref ?? "").toLowerCase();
  if (wf !== `${WORKER_REPO.name}/${WORKER_WORKFLOW}@refs/heads/main`) return "workflow";
  if (c.runner_environment !== "github-hosted") return "runner";
  return null;
}

const b64urlBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4 ? "=".repeat(4 - (b.length % 4)) : "";
  const bin = atob(b + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export type Jwk = { kid?: string; kty: string; n: string; e: string; alg?: string };

/**
 * A GitHub Actions OIDC token verified (RS256, WebCrypto) against the given
 * keys, then its claims checked (workerClaimsProblem).
 */
export async function verifyWorkerToken(
  token: string,
  keys: Jwk[],
  nowS = Math.floor(Date.now() / 1000),
): Promise<{ ok: true; claims: OidcClaims } | { ok: false; why: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, why: "malformed" };
  let header: { alg?: string; kid?: string };
  let claims: OidcClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  } catch {
    return { ok: false, why: "malformed" };
  }
  if (header.alg !== "RS256") return { ok: false, why: "alg" };
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) return { ok: false, why: "key" };
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return { ok: false, why: "signature" };
  } catch {
    return { ok: false, why: "signature" };
  }
  const problem = workerClaimsProblem(claims, nowS);
  return problem ? { ok: false, why: problem } : { ok: true, claims };
}
