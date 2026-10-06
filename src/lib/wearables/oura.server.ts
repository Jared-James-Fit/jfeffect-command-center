// Server-only Oura Cloud API v2 client. Do not import from client code.
// OAuth2 authorization-code flow; Oura refresh tokens are SINGLE-USE and rotate,
// so every refresh must persist the new refresh token (see sync.server.ts).

import { createHmac, timingSafeEqual } from "crypto";
import type { OuraCollections } from "./oura-normalize";

const AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";
const API = "https://api.ouraring.com/v2/usercollection";

export const OURA_SCOPES = ["personal", "daily", "heartrate"];

export function ouraConfigured(): boolean {
  return !!(process.env.OURA_CLIENT_ID && process.env.OURA_CLIENT_SECRET && stateSecretOk());
}

function stateSecretOk() {
  return (process.env.WEARABLES_OAUTH_STATE_SECRET ?? "").length >= 32;
}

function stateSecret(): string {
  const s = process.env.WEARABLES_OAUTH_STATE_SECRET;
  if (!s || s.length < 32)
    throw new Error("WEARABLES_OAUTH_STATE_SECRET is not configured (min 32 chars).");
  return s;
}

/** HMAC-signed, 10-minute state binding the callback to the athlete who started it. */
export function signWearableState(payload: { user_id: string; provider: string }): string {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyWearableState(token: string): { user_id: string; provider: string } | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof json.ts !== "number" || Date.now() - json.ts > 10 * 60 * 1000) return null;
    if (typeof json.user_id !== "string" || typeof json.provider !== "string") return null;
    return { user_id: json.user_id, provider: json.provider };
  } catch {
    return null;
  }
}

export function ouraRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/public/wearables/oura/callback`;
}

export function buildOuraAuthorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.OURA_CLIENT_ID || "",
    redirect_uri: ouraRedirectUri(origin),
    scope: OURA_SCOPES.join(" "),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type OuraTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function tokenRequest(body: Record<string, string>): Promise<OuraTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: process.env.OURA_CLIENT_ID || "",
      client_secret: process.env.OURA_CLIENT_SECRET || "",
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const err: Error & { reauth?: boolean } = new Error(
      `Oura token request failed: ${data.error_description || data.error || res.status}`,
    );
    // invalid_grant = refresh token used/revoked -> athlete must reconnect.
    err.reauth = data.error === "invalid_grant" || res.status === 400 || res.status === 401;
    throw err;
  }
  return data as OuraTokens;
}

export const exchangeOuraCode = (code: string, origin: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: ouraRedirectUri(origin) });

export const refreshOuraToken = (refreshToken: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

async function getPaged(
  path: string,
  token: string,
  start: string,
  end: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next: string | null = null;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ start_date: start, end_date: end });
    if (next) qs.set("next_token", next);
    const res = await fetch(`${API}/${path}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      const err: Error & { reauth?: boolean } = new Error("Oura rejected the access token.");
      err.reauth = true;
      throw err;
    }
    if (!res.ok) throw new Error(`Oura ${path} request failed: ${res.status}`);
    const json = (await res.json()) as {
      data?: Record<string, unknown>[];
      next_token?: string | null;
    };
    out.push(...(json.data ?? []));
    next = json.next_token ?? null;
    if (!next) break;
  }
  return out;
}

/** start/end are inclusive YYYY-MM-DD. Sleep periods are fetched one day wider so a night that ends on `start` is complete. */
export async function fetchOuraCollections(
  token: string,
  start: string,
  end: string,
): Promise<OuraCollections> {
  const [daily_sleep, daily_readiness, daily_activity, sleep] = await Promise.all([
    getPaged("daily_sleep", token, start, end),
    getPaged("daily_readiness", token, start, end),
    getPaged("daily_activity", token, start, end),
    getPaged("sleep", token, start, end),
  ]);
  return { daily_sleep, daily_readiness, daily_activity, sleep };
}
