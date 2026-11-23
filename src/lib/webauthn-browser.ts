/**
 * The browser side of passkeys (webauthn.ts): turn the server's options into
 * what navigator.credentials takes, and the browser's answer back into JSON
 * for the server. No app imports, so it's tested in a real Chromium with a
 * virtual authenticator (scripts/two-step/passkey-browser-check.ts).
 */
import {
  fromB64url,
  toB64url,
  type AssertionJSON,
  type CreationOptionsJSON,
  type RegistrationJSON,
  type RequestOptionsJSON,
} from "@/lib/webauthn";

function buf(b64: string): ArrayBuffer {
  const u8 = fromB64url(b64);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export function toCreateOptions(o: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    challenge: buf(o.challenge),
    rp: o.rp,
    user: { id: buf(o.user.id), name: o.user.name, displayName: o.user.displayName },
    pubKeyCredParams: o.pubKeyCredParams,
    timeout: o.timeout,
    attestation: o.attestation,
    authenticatorSelection: o.authenticatorSelection,
    excludeCredentials: o.excludeCredentials.map((c) => ({
      type: c.type,
      id: buf(c.id),
      ...(c.transports ? { transports: c.transports as AuthenticatorTransport[] } : {}),
    })),
    ...({ hints: o.hints } as object),
  };
}

export function toRequestOptions(o: RequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    challenge: buf(o.challenge),
    rpId: o.rpId,
    allowCredentials: o.allowCredentials.map((c) => ({
      type: c.type,
      id: buf(c.id),
      ...(c.transports ? { transports: c.transports as AuthenticatorTransport[] } : {}),
    })),
    userVerification: o.userVerification,
    timeout: o.timeout,
  };
}

export function serializeRegistration(cred: PublicKeyCredential): RegistrationJSON {
  const r = cred.response as AuthenticatorAttestationResponse;
  let transports: string[] = [];
  try {
    transports = typeof r.getTransports === "function" ? r.getTransports() : [];
  } catch {
    transports = [];
  }
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: "public-key",
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      attestationObject: toB64url(r.attestationObject),
      transports,
    },
  };
}

export function serializeAssertion(cred: PublicKeyCredential): AssertionJSON {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: "public-key",
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature),
      userHandle: r.userHandle ? toB64url(r.userHandle) : null,
    },
  };
}

/** Make a passkey (Face ID / Touch ID prompt). Must run inside a tap. */
export async function createPasskey(options: CreationOptionsJSON): Promise<RegistrationJSON> {
  const cred = (await navigator.credentials.create({
    publicKey: toCreateOptions(options),
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException("No passkey was made", "NotAllowedError");
  return serializeRegistration(cred);
}

/** Use a passkey. Must run inside a tap on an iPhone. */
export async function getPasskey(options: RequestOptionsJSON): Promise<AssertionJSON> {
  const cred = (await navigator.credentials.get({
    publicKey: toRequestOptions(options),
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException("No passkey was used", "NotAllowedError");
  return serializeAssertion(cred);
}
