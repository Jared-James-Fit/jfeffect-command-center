/**
 * Passkeys (webauthn.ts): the server's checks, on a real browser's bytes
 * (Chromium's virtual authenticator, scripts/two-step/passkey-browser-check.ts,
 * src/test/fixtures/passkey-chromium.json) and on keys made here for what a
 * browser won't do on request (RS256, a passkey without Face ID, a copied key).
 */
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/passkey-chromium.json";
import {
  coseToJwk,
  creationOptions,
  decodeCbor,
  derToRawEcdsa,
  fromB64url,
  originMatchesRp,
  parseAuthData,
  requestOptions,
  rpIdForOrigin,
  toB64url,
  verifyAssertion,
  verifyRegistration,
  type AssertionJSON,
  type RegistrationJSON,
} from "@/lib/webauthn";

// ── A small CBOR encoder, for building authenticator answers here ───────────
function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  if (n < 65536) return [(major << 5) | 25, n >> 8, n & 255];
  return [(major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function cbor(v: unknown): number[] {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") {
    const b = [...new TextEncoder().encode(v)];
    return [...head(3, b.length), ...b];
  }
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  if (Array.isArray(v)) return [...head(4, v.length), ...v.flatMap(cbor)];
  if (v instanceof Map)
    return [...head(5, v.size), ...[...v].flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];
  if (v === true) return [0xf5];
  if (v === false) return [0xf4];
  if (v === null) return [0xf6];
  throw new Error("cbor: " + typeof v);
}

const sha = async (b: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
const enc = (s: string) => new TextEncoder().encode(s);
const ORIGIN = "https://jfeffect.com";
const RP = "jfeffect.com";

async function authData(opts: {
  rpId?: string;
  up?: boolean;
  uv?: boolean;
  counter?: number;
  cred?: { id: Uint8Array; cose: Map<number, unknown> };
}) {
  const flags = (opts.up === false ? 0 : 1) | (opts.uv === false ? 0 : 4) | (opts.cred ? 0x40 : 0);
  const counter = opts.counter ?? 0;
  const out = [
    ...(await sha(enc(opts.rpId ?? RP))),
    flags,
    (counter >>> 24) & 255,
    (counter >> 16) & 255,
    (counter >> 8) & 255,
    counter & 255,
  ];
  if (opts.cred) {
    out.push(
      ...new Array(16).fill(0),
      opts.cred.id.length >> 8,
      opts.cred.id.length & 255,
      ...opts.cred.id,
      ...cbor(opts.cred.cose),
    );
  }
  return new Uint8Array(out);
}

function clientData(type: string, challenge: string, origin = ORIGIN) {
  return enc(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

type Made = { cose: Map<number, unknown>; sign: (data: Uint8Array) => Promise<Uint8Array> };

async function es256(): Promise<Made> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const cose = new Map<number, unknown>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, fromB64url(jwk.x!)],
    [-3, fromB64url(jwk.y!)],
  ]);
  return {
    cose,
    sign: async (data) => {
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          kp.privateKey,
          data as BufferSource,
        ),
      );
      // raw r||s → DER, as authenticators send it
      const int = (b: Uint8Array) => {
        let i = 0;
        while (i < b.length - 1 && b[i] === 0) i++;
        let x = [...b.slice(i)];
        if (x[0] & 0x80) x = [0, ...x];
        return [2, x.length, ...x];
      };
      const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
      return new Uint8Array([0x30, body.length, ...body]);
    },
  };
}

async function rs256(): Promise<Made> {
  const kp = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const cose = new Map<number, unknown>([
    [1, 3],
    [3, -257],
    [-1, fromB64url(jwk.n!)],
    [-2, fromB64url(jwk.e!)],
  ]);
  return {
    cose,
    sign: async (data) =>
      new Uint8Array(
        await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, data as BufferSource),
      ),
  };
}

async function register(
  key: Made,
  opts: { uv?: boolean; rpId?: string; origin?: string; challenge?: string } = {},
) {
  const id = crypto.getRandomValues(new Uint8Array(20));
  const challenge = opts.challenge ?? toB64url(crypto.getRandomValues(new Uint8Array(32)));
  const att = new Map<string, unknown>([
    ["fmt", "none"],
    ["attStmt", new Map()],
    ["authData", await authData({ uv: opts.uv, rpId: opts.rpId, cred: { id, cose: key.cose } })],
  ]);
  const credential: RegistrationJSON = {
    id: toB64url(id),
    rawId: toB64url(id),
    type: "public-key",
    response: {
      clientDataJSON: toB64url(clientData("webauthn.create", challenge, opts.origin)),
      attestationObject: toB64url(new Uint8Array(cbor(att))),
      transports: ["internal", "made-up"],
    },
  };
  return { credential, challenge };
}

async function assert(
  key: Made,
  id: string,
  opts: { counter?: number; uv?: boolean; challenge?: string; origin?: string; rpId?: string } = {},
) {
  const challenge = opts.challenge ?? toB64url(crypto.getRandomValues(new Uint8Array(32)));
  const ad = await authData({ counter: opts.counter, uv: opts.uv, rpId: opts.rpId });
  const cd = clientData("webauthn.get", challenge, opts.origin);
  const signed = new Uint8Array([...ad, ...(await sha(cd))]);
  const credential: AssertionJSON = {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: toB64url(cd),
      authenticatorData: toB64url(ad),
      signature: toB64url(await key.sign(signed)),
    },
  };
  return { credential, challenge };
}

describe("a real browser's passkey (Chromium's virtual authenticator)", () => {
  it("registers and signs in", async () => {
    const saved = await verifyRegistration({
      credential: fixture.registration.credential as RegistrationJSON,
      challenge: fixture.registration.challenge,
      rpId: fixture.rpId,
    });
    expect(saved.alg).toBe(-7);
    expect(saved.transports).toEqual(["internal"]);
    const used = await verifyAssertion({
      credential: fixture.assertion.credential as AssertionJSON,
      challenge: fixture.assertion.challenge,
      rpId: fixture.rpId,
      jwk: saved.jwk,
      alg: saved.alg,
      storedSignCount: saved.signCount,
    });
    expect(used.signCount).toBeGreaterThan(saved.signCount);
  });

  it("refuses the same answer for another challenge, another site, or as the wrong kind of answer", async () => {
    const reg = fixture.registration.credential as RegistrationJSON;
    await expect(
      verifyRegistration({
        credential: reg,
        challenge: fixture.assertion.challenge,
        rpId: fixture.rpId,
      }),
    ).rejects.toThrow(/ran out/);
    await expect(
      verifyRegistration({
        credential: reg,
        challenge: fixture.registration.challenge,
        rpId: "jfeffect.com",
      }),
    ).rejects.toThrow(/another site/);
    const saved = await verifyRegistration({
      credential: reg,
      challenge: fixture.registration.challenge,
      rpId: fixture.rpId,
    });
    const asReg = {
      ...fixture.assertion.credential,
      response: {
        ...fixture.assertion.credential.response,
        attestationObject: reg.response.attestationObject,
      },
    } as any;
    await expect(
      verifyRegistration({
        credential: asReg,
        challenge: fixture.assertion.challenge,
        rpId: fixture.rpId,
      }),
    ).rejects.toThrow(/different request/);
    // the counter only moves forward
    await expect(
      verifyAssertion({
        credential: fixture.assertion.credential as AssertionJSON,
        challenge: fixture.assertion.challenge,
        rpId: fixture.rpId,
        jwk: saved.jwk,
        alg: saved.alg,
        storedSignCount: 99,
      }),
    ).rejects.toThrow(/counter/);
  });

  it("refuses a signature that's been changed", async () => {
    const saved = await verifyRegistration({
      credential: fixture.registration.credential as RegistrationJSON,
      challenge: fixture.registration.challenge,
      rpId: fixture.rpId,
    });
    const sig = fromB64url(fixture.assertion.credential.response.signature);
    sig[sig.length - 1] ^= 1;
    const bad = {
      ...fixture.assertion.credential,
      response: { ...fixture.assertion.credential.response, signature: toB64url(sig) },
    } as AssertionJSON;
    await expect(
      verifyAssertion({
        credential: bad,
        challenge: fixture.assertion.challenge,
        rpId: fixture.rpId,
        jwk: saved.jwk,
        alg: saved.alg,
        storedSignCount: 0,
      }),
    ).rejects.toThrow();
  });
});

describe("keys made here", () => {
  it("ES256: registers, signs in, and keeps only the transports browsers know", async () => {
    const key = await es256();
    const { credential, challenge } = await register(key);
    const saved = await verifyRegistration({ credential, challenge, rpId: RP });
    expect(saved.transports).toEqual(["internal"]);
    const a = await assert(key, saved.credentialId, { counter: 0 });
    // a synced passkey keeps its counter at 0: allowed
    await expect(
      verifyAssertion({
        credential: a.credential,
        challenge: a.challenge,
        rpId: RP,
        jwk: saved.jwk,
        alg: -7,
        storedSignCount: 0,
      }),
    ).resolves.toEqual({ signCount: 0 });
  });

  it("RS256 (Windows Hello) works", async () => {
    const key = await rs256();
    const { credential, challenge } = await register(key);
    const saved = await verifyRegistration({ credential, challenge, rpId: RP });
    expect(saved.alg).toBe(-257);
    const a = await assert(key, saved.credentialId, { counter: 5 });
    await expect(
      verifyAssertion({
        credential: a.credential,
        challenge: a.challenge,
        rpId: RP,
        jwk: saved.jwk,
        alg: -257,
        storedSignCount: 4,
      }),
    ).resolves.toEqual({ signCount: 5 });
  });

  it("never without Face ID / Touch ID / the device lock (user verification)", async () => {
    const key = await es256();
    const r = await register(key, { uv: false });
    await expect(
      verifyRegistration({ credential: r.credential, challenge: r.challenge, rpId: RP }),
    ).rejects.toThrow(/Face ID/);
    const ok = await register(key);
    const saved = await verifyRegistration({
      credential: ok.credential,
      challenge: ok.challenge,
      rpId: RP,
    });
    const a = await assert(key, saved.credentialId, { uv: false, counter: 1 });
    await expect(
      verifyAssertion({
        credential: a.credential,
        challenge: a.challenge,
        rpId: RP,
        jwk: saved.jwk,
        alg: -7,
        storedSignCount: 0,
      }),
    ).rejects.toThrow(/Face ID/);
  });

  it("never from a look-alike site, and never another site's passkey", async () => {
    const key = await es256();
    const r = await register(key, { origin: "https://jfeffect.com.evil.example" });
    await expect(
      verifyRegistration({ credential: r.credential, challenge: r.challenge, rpId: RP }),
    ).rejects.toThrow(/another site/);
    const ok = await register(key);
    const saved = await verifyRegistration({
      credential: ok.credential,
      challenge: ok.challenge,
      rpId: RP,
    });
    const phish = await assert(key, saved.credentialId, { rpId: "evil.example", counter: 1 });
    await expect(
      verifyAssertion({
        credential: phish.credential,
        challenge: phish.challenge,
        rpId: RP,
        jwk: saved.jwk,
        alg: -7,
        storedSignCount: 0,
      }),
    ).rejects.toThrow(/another site/);
    // www is the same site
    const www = await assert(key, saved.credentialId, {
      origin: "https://www.jfeffect.com",
      counter: 2,
    });
    await expect(
      verifyAssertion({
        credential: www.credential,
        challenge: www.challenge,
        rpId: RP,
        jwk: saved.jwk,
        alg: -7,
        storedSignCount: 0,
      }),
    ).resolves.toEqual({ signCount: 2 });
  });

  it("a signature from another key never checks out", async () => {
    const key = await es256();
    const other = await es256();
    const ok = await register(key);
    const saved = await verifyRegistration({
      credential: ok.credential,
      challenge: ok.challenge,
      rpId: RP,
    });
    const a = await assert(other, saved.credentialId, { counter: 1 });
    await expect(
      verifyAssertion({
        credential: a.credential,
        challenge: a.challenge,
        rpId: RP,
        jwk: saved.jwk,
        alg: -7,
        storedSignCount: 0,
      }),
    ).rejects.toThrow(/didn't check out/);
  });
});

describe("the pieces", () => {
  it("reads CBOR maps with number keys, byte strings and nested maps", () => {
    const bytes = new Uint8Array(
      cbor(
        new Map<unknown, unknown>([
          [1, 2],
          [-1, new Uint8Array([9, 8])],
          ["k", [true, null, "x"]],
        ]),
      ),
    );
    const { value, end } = decodeCbor(bytes);
    expect(end).toBe(bytes.length);
    const m = value as Map<unknown, unknown>;
    expect(m.get(1)).toBe(2);
    expect([...(m.get(-1) as Uint8Array)]).toEqual([9, 8]);
    expect(m.get("k")).toEqual([true, null, "x"]);
    expect(() => decodeCbor(new Uint8Array([0x5f]))).toThrow(/indefinite/);
    expect(() => decodeCbor(new Uint8Array([0x44, 1]))).toThrow(/truncated/);
  });

  it("only P-256 ES256 and RS256 keys", () => {
    expect(() =>
      coseToJwk(
        new Map<any, any>([
          [1, 1],
          [3, -8],
        ]),
      ),
    ).toThrow(/isn't supported/);
    expect(() =>
      coseToJwk(
        new Map<any, any>([
          [1, 2],
          [3, -7],
          [-1, 2],
          [-2, new Uint8Array(48)],
          [-3, new Uint8Array(48)],
        ]),
      ),
    ).toThrow(/P-256/);
  });

  it("turns a DER signature with leading zeros into r||s", () => {
    const der = new Uint8Array([0x30, 0x08, 0x02, 0x02, 0x00, 0x81, 0x02, 0x02, 0x00, 0x7f]);
    const raw = derToRawEcdsa(der);
    expect(raw.length).toBe(64);
    expect(raw[31]).toBe(0x81);
    expect(raw[63]).toBe(0x7f);
  });

  it("reads authenticator data flags and the counter", async () => {
    const ad = parseAuthData(await authData({ counter: 258, uv: false }));
    expect(ad.up).toBe(true);
    expect(ad.uv).toBe(false);
    expect(ad.signCount).toBe(258);
  });

  it("knows which site a passkey belongs to", () => {
    expect(rpIdForOrigin("https://jfeffect.com")).toBe("jfeffect.com");
    expect(rpIdForOrigin("https://www.jfeffect.com")).toBe("jfeffect.com");
    expect(rpIdForOrigin("https://id-preview--5f1f.lovable.app")).toBe(
      "id-preview--5f1f.lovable.app",
    );
    expect(rpIdForOrigin("http://localhost:5173")).toBe("localhost");
    expect(rpIdForOrigin("http://jfeffect.com")).toBeNull();
    expect(rpIdForOrigin("capacitor://localhost")).toBeNull();
    expect(rpIdForOrigin(null)).toBeNull();
    expect(originMatchesRp("https://www.jfeffect.com", "jfeffect.com")).toBe(true);
    expect(originMatchesRp("https://jfeffect.com.evil.example", "jfeffect.com")).toBe(false);
    expect(originMatchesRp("https://notjfeffect.com", "jfeffect.com")).toBe(false);
  });

  it("asks for Face ID (user verification) and a discoverable key, with the right site", () => {
    const c = creationOptions({
      challenge: "c".repeat(43),
      rpId: RP,
      userId: "u",
      email: "a@example.com",
      name: "",
      exclude: [{ id: "x".repeat(22), transports: ["internal"] }],
    });
    expect(c.rp).toEqual({ name: "JF Effect", id: RP });
    expect(c.authenticatorSelection.userVerification).toBe("required");
    expect(c.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
    expect(c.user.displayName).toBe("a@example.com");
    expect(c.excludeCredentials).toHaveLength(1);
    const r = requestOptions({
      challenge: "c".repeat(43),
      rpId: RP,
      allow: [{ id: "x".repeat(22) }],
    });
    expect(r.userVerification).toBe("required");
    expect(r.allowCredentials[0]).toEqual({ type: "public-key", id: "x".repeat(22) });
  });
});
