/**
 * Passkeys (WebAuthn) for two-step sign-in: Face ID, Touch ID, Windows Hello,
 * an Android phone's screen lock (two-step.ts). The browser makes the key and
 * signs with it; the server checks every answer here, with no library: the
 * CBOR the authenticator sends, the authenticator data, the public key and
 * the signature (Web Crypto: the server and the tests alike).
 *
 * What a passkey proves, checked on every use:
 *   - the browser was on our site (clientData.origin, never trusted alone);
 *   - the authenticator signed for our site (rpIdHash = SHA-256 of the rp id
 *     the key was made for, so a phishing site's request can't produce one);
 *   - the person was there and unlocked it (UP and UV flags: Face ID, Touch
 *     ID, a PIN), never just a tap;
 *   - it answered our one-time challenge;
 *   - it's the key saved when it was set up (signature by that public key),
 *     and its counter never went backwards (a copied key).
 * Only ES256 (every platform authenticator) and RS256 (Windows Hello) keys.
 *
 * Pure: no Supabase, no React.
 */

export const PASSKEY_ALGS = [-7, -257] as const;
export const PASSKEY_TIMEOUT_MS = 120_000;
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const RP_NAME = "JF Effect";

// ── base64url ───────────────────────────────────────────────────────────────
export function toB64url(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(u8).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error("Not base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === "function") {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

// ── CBOR (the subset WebAuthn uses: canonical, definite lengths) ────────────
export type CborValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | undefined
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>;

export function decodeCbor(bytes: Uint8Array, offset = 0): { value: CborValue; end: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = offset;
  let depth = 0;

  function need(n: number) {
    if (pos + n > bytes.length) throw new Error("CBOR: truncated");
  }
  function readLength(info: number): number {
    if (info < 24) return info;
    if (info === 24) {
      need(1);
      return bytes[pos++];
    }
    if (info === 25) {
      need(2);
      const v = view.getUint16(pos);
      pos += 2;
      return v;
    }
    if (info === 26) {
      need(4);
      const v = view.getUint32(pos);
      pos += 4;
      return v;
    }
    if (info === 27) {
      need(8);
      const v = view.getBigUint64(pos);
      pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("CBOR: number too large");
      return Number(v);
    }
    throw new Error("CBOR: indefinite lengths aren't used by WebAuthn");
  }
  function item(): CborValue {
    if (++depth > 32) throw new Error("CBOR: too deep");
    need(1);
    const first = bytes[pos++];
    const major = first >> 5;
    const info = first & 31;
    let out: CborValue;
    switch (major) {
      case 0:
        out = readLength(info);
        break;
      case 1:
        out = -1 - readLength(info);
        break;
      case 2: {
        const n = readLength(info);
        need(n);
        out = bytes.slice(pos, pos + n);
        pos += n;
        break;
      }
      case 3: {
        const n = readLength(info);
        need(n);
        out = new TextDecoder().decode(bytes.subarray(pos, pos + n));
        pos += n;
        break;
      }
      case 4: {
        const n = readLength(info);
        if (n > 10_000) throw new Error("CBOR: array too long");
        const arr: CborValue[] = [];
        for (let i = 0; i < n; i++) arr.push(item());
        out = arr;
        break;
      }
      case 5: {
        const n = readLength(info);
        if (n > 10_000) throw new Error("CBOR: map too long");
        const map = new Map<CborValue, CborValue>();
        for (let i = 0; i < n; i++) {
          const k = item();
          map.set(k, item());
        }
        out = map;
        break;
      }
      case 6:
        readLength(info);
        out = item();
        break;
      default: {
        if (info === 20) out = false;
        else if (info === 21) out = true;
        else if (info === 22) out = null;
        else if (info === 23) out = undefined;
        else if (info === 25) {
          need(2);
          out = halfToNumber(view.getUint16(pos));
          pos += 2;
        } else if (info === 26) {
          need(4);
          out = view.getFloat32(pos);
          pos += 4;
        } else if (info === 27) {
          need(8);
          out = view.getFloat64(pos);
          pos += 8;
        } else throw new Error("CBOR: unsupported simple value");
      }
    }
    depth--;
    return out;
  }
  const value = item();
  return { value, end: pos };
}

function halfToNumber(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

// ── Authenticator data ──────────────────────────────────────────────────────
export type AuthData = {
  rpIdHash: Uint8Array;
  up: boolean;
  uv: boolean;
  /** Backup eligible / backed up: a synced passkey (iCloud Keychain, Google Password Manager). */
  be: boolean;
  bs: boolean;
  signCount: number;
  credential?: { aaguid: Uint8Array; id: Uint8Array; publicKey: Map<CborValue, CborValue> };
};

export function parseAuthData(data: Uint8Array): AuthData {
  if (data.length < 37) throw new Error("Authenticator data is too short");
  const flags = data[32];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: AuthData = {
    rpIdHash: data.slice(0, 32),
    up: !!(flags & 0x01),
    uv: !!(flags & 0x04),
    be: !!(flags & 0x08),
    bs: !!(flags & 0x10),
    signCount: view.getUint32(33),
  };
  if (flags & 0x40) {
    if (data.length < 55) throw new Error("Authenticator data has no credential");
    const aaguid = data.slice(37, 53);
    const idLen = view.getUint16(53);
    if (idLen < 16 || idLen > 1023 || data.length < 55 + idLen)
      throw new Error("Credential id is the wrong length");
    const id = data.slice(55, 55 + idLen);
    const { value } = decodeCbor(data, 55 + idLen);
    if (!(value instanceof Map)) throw new Error("Credential public key isn't a COSE key");
    out.credential = { aaguid, id, publicKey: value };
  }
  return out;
}

// ── COSE key → JWK ──────────────────────────────────────────────────────────
export type PasskeyJwk =
  | { kty: "EC"; crv: "P-256"; x: string; y: string }
  | { kty: "RSA"; n: string; e: string };

export function coseToJwk(cose: Map<CborValue, CborValue>): { jwk: PasskeyJwk; alg: number } {
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7) {
    const crv = cose.get(-1);
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (
      crv !== 1 ||
      !(x instanceof Uint8Array) ||
      !(y instanceof Uint8Array) ||
      x.length !== 32 ||
      y.length !== 32
    ) {
      throw new Error("Only P-256 EC keys are accepted");
    }
    return { jwk: { kty: "EC", crv: "P-256", x: toB64url(x), y: toB64url(y) }, alg: -7 };
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1);
    const e = cose.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256)
      throw new Error("RSA key is too short");
    return { jwk: { kty: "RSA", n: toB64url(n), e: toB64url(e) }, alg: -257 };
  }
  throw new Error("This kind of passkey isn't supported");
}

/** An ECDSA signature from DER (what authenticators send) to raw r||s (what Web Crypto checks). */
export function derToRawEcdsa(der: Uint8Array, size = 32): Uint8Array {
  let p = 0;
  if (der[p++] !== 0x30) throw new Error("Signature isn't DER");
  let len = der[p++];
  if (len & 0x80) p += len & 0x7f; // long form (never for P-256, but be safe)
  const out = new Uint8Array(size * 2);
  for (let k = 0; k < 2; k++) {
    if (der[p++] !== 0x02) throw new Error("Signature isn't DER");
    len = der[p++];
    let int = der.subarray(p, p + len);
    p += len;
    while (int.length > size && int[0] === 0) int = int.subarray(1);
    if (int.length > size) throw new Error("Signature integer too long");
    out.set(int, k * size + (size - int.length));
  }
  return out;
}

async function verifySignature(
  jwk: PasskeyJwk,
  alg: number,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  if (alg === -7 && jwk.kty === "EC") {
    const key = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    let raw: Uint8Array;
    try {
      raw = derToRawEcdsa(signature);
    } catch {
      return false;
    }
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      raw as BufferSource,
      data as BufferSource,
    );
  }
  if (alg === -257 && jwk.kty === "RSA") {
    const key = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature as BufferSource,
      data as BufferSource,
    );
  }
  return false;
}

// ── Which site a passkey is for ─────────────────────────────────────────────
/**
 * The relying-party id for the page that asked: jfeffect.com for the site and
 * its www (and the iPhone app, which loads jfeffect.com), else the page's own
 * host (Lovable's preview). http only on localhost (development). Null for
 * anything else: no passkey there.
 */
export function rpIdForOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol === "http:") return host === "localhost" ? "localhost" : null;
  if (u.protocol !== "https:") return null;
  if (host === "jfeffect.com" || host === "www.jfeffect.com") return "jfeffect.com";
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return host;
  return null;
}

/** Whether an origin may use a passkey made for rpId (the host is it or under it). */
export function originMatchesRp(origin: string, rpId: string): boolean {
  const rp = rpIdForOrigin(origin);
  if (!rp) return false;
  const host = new URL(origin).hostname.toLowerCase();
  return host === rpId || host.endsWith(`.${rpId}`);
}

// ── What the browser sends back ─────────────────────────────────────────────
export type RegistrationJSON = {
  id: string;
  rawId: string;
  type: "public-key";
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
};

export type AssertionJSON = {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
};

type ClientData = { type: string; challenge: string; origin: string; crossOrigin?: boolean };

function readClientData(b64: string): { data: ClientData; bytes: Uint8Array } {
  const bytes = fromB64url(b64);
  const data = JSON.parse(new TextDecoder().decode(bytes)) as ClientData;
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.type !== "string" ||
    typeof data.challenge !== "string" ||
    typeof data.origin !== "string"
  ) {
    throw new Error("The browser's answer is incomplete");
  }
  return { data, bytes };
}

function checkClientData(data: ClientData, type: string, challenge: string, rpId: string) {
  if (data.type !== type) throw new Error("The browser answered a different request");
  if (data.challenge !== challenge) throw new Error("That passkey request ran out. Try again.");
  if (data.crossOrigin === true)
    throw new Error("A passkey can't be used from inside another site");
  if (!originMatchesRp(data.origin, rpId))
    throw new Error("That passkey request came from another site");
}

export const KNOWN_TRANSPORTS = new Set([
  "internal",
  "hybrid",
  "usb",
  "nfc",
  "ble",
  "smart-card",
  "cable",
]);

/**
 * Check a new passkey. Returns what to save: its id, public key, algorithm,
 * counter and transports. Throws (with words a person can act on) when any
 * check fails.
 */
export async function verifyRegistration(input: {
  credential: RegistrationJSON;
  challenge: string;
  rpId: string;
}): Promise<{
  credentialId: string;
  jwk: PasskeyJwk;
  alg: number;
  signCount: number;
  transports: string[];
  synced: boolean;
}> {
  const { credential, challenge, rpId } = input;
  if (!credential || credential.type !== "public-key" || !credential.response)
    throw new Error("That isn't a passkey");
  const { data } = readClientData(credential.response.clientDataJSON);
  checkClientData(data, "webauthn.create", challenge, rpId);
  const { value } = decodeCbor(fromB64url(credential.response.attestationObject));
  if (!(value instanceof Map)) throw new Error("The passkey's answer is malformed");
  const authBytes = value.get("authData");
  if (!(authBytes instanceof Uint8Array)) throw new Error("The passkey's answer is malformed");
  const auth = parseAuthData(authBytes);
  if (!sameBytes(auth.rpIdHash, await sha256(new TextEncoder().encode(rpId))))
    throw new Error("That passkey was made for another site");
  if (!auth.up) throw new Error("The passkey wasn't confirmed");
  if (!auth.uv)
    throw new Error("Use Face ID, Touch ID or your device's lock to set up the passkey");
  if (!auth.credential) throw new Error("The passkey's answer has no key");
  const credentialId = toB64url(auth.credential.id);
  if (credential.rawId && credential.rawId !== credentialId)
    throw new Error("The passkey's answer doesn't match itself");
  const { jwk, alg } = coseToJwk(auth.credential.publicKey);
  const transports = (credential.response.transports ?? [])
    .filter((t) => typeof t === "string" && KNOWN_TRANSPORTS.has(t))
    .slice(0, 6);
  return { credentialId, jwk, alg, signCount: auth.signCount, transports, synced: auth.be };
}

/** Check a passkey sign-in against the saved key. Returns the new counter. */
export async function verifyAssertion(input: {
  credential: AssertionJSON;
  challenge: string;
  rpId: string;
  jwk: PasskeyJwk;
  alg: number;
  storedSignCount: number;
}): Promise<{ signCount: number }> {
  const { credential, challenge, rpId, jwk, alg, storedSignCount } = input;
  if (!credential || credential.type !== "public-key" || !credential.response)
    throw new Error("That isn't a passkey");
  const { data, bytes: clientBytes } = readClientData(credential.response.clientDataJSON);
  checkClientData(data, "webauthn.get", challenge, rpId);
  const authBytes = fromB64url(credential.response.authenticatorData);
  const auth = parseAuthData(authBytes);
  if (!sameBytes(auth.rpIdHash, await sha256(new TextEncoder().encode(rpId))))
    throw new Error("That passkey is for another site");
  if (!auth.up) throw new Error("The passkey wasn't confirmed");
  if (!auth.uv) throw new Error("Use Face ID, Touch ID or your device's lock to confirm");
  const signed = new Uint8Array(authBytes.length + 32);
  signed.set(authBytes, 0);
  signed.set(await sha256(clientBytes), authBytes.length);
  const ok = await verifySignature(jwk, alg, fromB64url(credential.response.signature), signed);
  if (!ok) throw new Error("That passkey didn't check out");
  // A counter that goes backwards means a copied key. Synced passkeys keep 0.
  if ((auth.signCount !== 0 || storedSignCount !== 0) && auth.signCount <= storedSignCount) {
    throw new Error("That passkey's counter went backwards. Remove it and set it up again.");
  }
  return { signCount: auth.signCount };
}

// ── Options for the browser ─────────────────────────────────────────────────
export type CreationOptionsJSON = {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
  timeout: number;
  attestation: "none";
  authenticatorSelection: {
    residentKey: "preferred";
    requireResidentKey: false;
    userVerification: "required";
  };
  excludeCredentials: Array<{ type: "public-key"; id: string; transports?: string[] }>;
  hints: string[];
};

export type RequestOptionsJSON = {
  challenge: string;
  rpId: string;
  allowCredentials: Array<{ type: "public-key"; id: string; transports?: string[] }>;
  userVerification: "required";
  timeout: number;
};

export function creationOptions(input: {
  challenge: string;
  rpId: string;
  userId: string;
  email: string;
  name: string;
  exclude: Array<{ id: string; transports?: string[] }>;
}): CreationOptionsJSON {
  return {
    challenge: input.challenge,
    rp: { name: RP_NAME, id: input.rpId },
    user: {
      id: toB64url(new TextEncoder().encode(input.userId)),
      name: input.email,
      displayName: input.name || input.email,
    },
    pubKeyCredParams: PASSKEY_ALGS.map((alg) => ({ type: "public-key" as const, alg })),
    timeout: PASSKEY_TIMEOUT_MS,
    attestation: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      requireResidentKey: false,
      userVerification: "required",
    },
    excludeCredentials: input.exclude.map((c) => ({
      type: "public-key" as const,
      id: c.id,
      ...(c.transports?.length ? { transports: c.transports } : {}),
    })),
    hints: ["client-device"],
  };
}

export function requestOptions(input: {
  challenge: string;
  rpId: string;
  allow: Array<{ id: string; transports?: string[] }>;
}): RequestOptionsJSON {
  return {
    challenge: input.challenge,
    rpId: input.rpId,
    allowCredentials: input.allow.map((c) => ({
      type: "public-key" as const,
      id: c.id,
      ...(c.transports?.length ? { transports: c.transports } : {}),
    })),
    userVerification: "required",
    timeout: PASSKEY_TIMEOUT_MS,
  };
}

/** A fresh challenge: 32 random bytes. */
export function newChallenge(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)));
}
