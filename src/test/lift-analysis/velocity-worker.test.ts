/**
 * The server's bar-speed reader: who may call the hook (a GitHub OIDC token
 * from this repository's own workflow on main, and nothing else), and what it
 * does with a read (only what the server's own rule would put on the set).
 */
import { describe, expect, it } from "vitest";
import { verifyWorkerToken, workerClaimsProblem, WORKER_AUDIENCE, OIDC_ISSUER, type OidcClaims } from "@/lib/lift-analysis/worker-oidc";
import { fallbackOf, reasonWords, wouldLog } from "@/lib/lift-analysis/worker-plan";
import { calibrate, DEFAULT_PLATE } from "@/lib/lift-analysis/calibrate";
import { guideLift, repDirection } from "@/lib/lift-analysis/exercise";

const NOW = 1_800_000_000;
const good: OidcClaims = {
  iss: OIDC_ISSUER,
  aud: WORKER_AUDIENCE,
  exp: NOW + 300,
  nbf: NOW - 10,
  iat: NOW - 10,
  repository: "Jared-James-Fit/jfeffect-command-center",
  repository_id: "1261494398",
  repository_owner_id: "291368398",
  ref: "refs/heads/main",
  event_name: "schedule",
  job_workflow_ref: "Jared-James-Fit/jfeffect-command-center/.github/workflows/velocity-worker.yml@refs/heads/main",
  runner_environment: "github-hosted",
};

const b64url = (b: ArrayBuffer | Uint8Array) =>
  Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function signed(claims: OidcClaims, kid = "k1") {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as { n: string; e: string };
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return { token: `${head}.${body}.${b64url(sig)}`, keys: [{ kid, kty: "RSA", n: jwk.n, e: jwk.e }] };
}

describe("velocity worker: who may call the hook", () => {
  it("accepts this repository's workflow on main, scheduled or started by hand", () => {
    expect(workerClaimsProblem(good, NOW)).toBeNull();
    expect(workerClaimsProblem({ ...good, event_name: "workflow_dispatch" }, NOW)).toBeNull();
  });

  it.each([
    ["a fork or another repository", { repository_id: "1" }, "repository"],
    ["another owner", { repository_owner_id: "2" }, "owner"],
    ["a branch", { ref: "refs/heads/claude/x" }, "ref"],
    ["a pull request", { event_name: "pull_request" }, "event"],
    ["another workflow", { job_workflow_ref: "Jared-James-Fit/jfeffect-command-center/.github/workflows/ci.yml@refs/heads/main" }, "workflow"],
    ["a self-hosted runner", { runner_environment: "self-hosted" }, "runner"],
    ["another audience", { aud: "sts.amazonaws.com" }, "audience"],
    ["an expired token", { exp: NOW - 120 }, "expired"],
    ["another issuer", { iss: "https://example.com" }, "issuer"],
  ] as const)("refuses %s", (_what, patch, why) => {
    expect(workerClaimsProblem({ ...good, ...patch } as OidcClaims, NOW)).toBe(why);
  });

  it("checks GitHub's signature, never just the claims", async () => {
    const { token, keys } = await signed(good);
    expect(await verifyWorkerToken(token, keys, NOW)).toMatchObject({ ok: true });
    const other = await signed(good);
    expect(await verifyWorkerToken(token, other.keys, NOW)).toEqual({ ok: false, why: "signature" });
    const [h, , s] = token.split(".");
    const forged = `${h}.${b64url(new TextEncoder().encode(JSON.stringify({ ...good, repository_id: "1" })))}.${s}`;
    expect(await verifyWorkerToken(forged, keys, NOW)).toEqual({ ok: false, why: "signature" });
    expect(await verifyWorkerToken(token, [{ ...keys[0], kid: "nope" }], NOW)).toEqual({ ok: false, why: "key" });
    expect(await verifyWorkerToken("not.a.jwt", keys, NOW)).toEqual({ ok: false, why: "malformed" });
  });
});

const read = (over: Record<string, unknown> = {}): any => ({
  units: "mm",
  calibration: { ok: true },
  plate: { confirmed: false, view: "front" },
  reps: [{ complete: true }, { complete: true }, { complete: true }],
  velocity: { accepted: true, value: 0.45, tier: "estimated", plateCheck: true },
  ...over,
});

describe("velocity worker: what goes on the set", () => {
  const job = { reps: 3, load_kg: 180, bodyweight: false };
  it("logs a read the server's rule would log", () => {
    expect(wouldLog(read(), job)).toBe(true);
  });
  it("never logs a refused, uncalibrated, pixel-only or incomplete read", () => {
    expect(wouldLog(read({ velocity: { accepted: false, value: 0.45 } }), job)).toBe(false);
    expect(wouldLog(read({ calibration: { ok: false } }), job)).toBe(false);
    expect(wouldLog(read({ units: "px" }), job)).toBe(false);
    expect(wouldLog(read({ reps: [{ complete: true }, { complete: false }, { complete: true }] }), job)).toBe(false);
  });
  it("needs the reps to match the logged reps within one", () => {
    expect(wouldLog(read(), { ...job, reps: 4 })).toBe(true);
    expect(wouldLog(read(), { ...job, reps: 5 })).toBe(false);
  });
  it("needs a reason to trust the plate's size", () => {
    const unsure = read({ velocity: { accepted: true, value: 0.45 } });
    expect(wouldLog(unsure, { ...job, load_kg: 40 })).toBe(false);
    expect(wouldLog(unsure, job)).toBe(true); // 180 kg means full-size plates
    expect(wouldLog(unsure, { ...job, bodyweight: true })).toBe(false);
  });
  it("keeps the most useful read and says why in words when nothing logs", () => {
    const fb = fallbackOf({ analysis: null, why: "no_plate" }, { analysis: read({ velocity: { accepted: false } }), why: ["reps_differ"] });
    expect(fb.outcome.outcome).toBe("no_reading");
    expect(fb.outcome.message).toMatch(/reps/);
    const none = fallbackOf({ analysis: null, why: "unreadable" }, { analysis: null, why: [] });
    expect((none.result as any).status).toBe("failed");
    expect(reasonWords([])).toMatch(/No reliable bar speed/);
  });
});

describe("front-on plates", () => {
  it("scales from the plates' height when they're seen edge-on", () => {
    const c = calibrate([], DEFAULT_PLATE, { a: 9, b: 40, relA: 0.05, relB: 0.02, frames: 10, faint: false, edgeOn: true });
    expect(c.ok).toBe(true);
    expect(c.view).toBe("front");
    expect(c.mmPerPxY).toBeCloseTo(DEFAULT_PLATE.mm / 80, 6);
    expect(c.relErr).toBeLessThan(0.06);
  });
  it("reads an incline or block press as a press from the bottom", () => {
    expect(guideLift("Smith Machine Press Incline")).toBe("bench");
    expect(guideLift("Close-Grip Block Press")).toBe("bench");
    expect(repDirection("Incline Bench Press")).toBe("lower_first");
  });
});
