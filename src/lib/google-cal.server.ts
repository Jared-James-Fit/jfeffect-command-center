// Server-only helpers for per-coach Google Calendar OAuth + Calendar API.
// Do not import this from client code.

import { createHmac, timingSafeEqual } from "crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

function signingSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "fallback-state-secret";
}

export function signOAuthState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(token: string): Record<string, any> | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch { return null; }
  try {
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof json.ts !== "number" || Date.now() - json.ts > 10 * 60 * 1000) return null;
    return json;
  } catch { return null; }
}

export function buildOAuthRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/public/google/oauth/callback`;
}

export function buildAuthorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    redirect_uri: buildOAuthRedirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string, origin: string): Promise<{
  access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope?: string;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      redirect_uri: buildOAuthRedirectUri(origin),
      grant_type: "authorization_code",
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${data.error_description || data.error || res.status}`);
  return data;
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number; scope?: string; }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed: ${data.error_description || data.error || res.status}`);
  return data;
}

function decodeIdTokenEmail(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return json.email || null;
  } catch { return null; }
}

export { decodeIdTokenEmail };

// Get a fresh access token for a coach (auto-refresh if near expiry).
export async function getValidAccessTokenForCoach(coachId: string): Promise<{ token: string; calendarId: string } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn } = await supabaseAdmin
    .from("google_calendar_connections")
    .select("*")
    .eq("coach_id", coachId)
    .maybeSingle();
  if (!conn || conn.status === "disconnected") return null;
  let token = conn.access_token as string | null;
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (!token || Date.now() > expiresAt - 60_000) {
    if (!conn.refresh_token) {
      await supabaseAdmin.from("google_calendar_connections")
        .update({ status: "reconnect_required", last_error: "missing refresh_token" })
        .eq("id", conn.id);
      return null;
    }
    try {
      const refreshed = await refreshAccessToken(conn.refresh_token);
      token = refreshed.access_token;
      await supabaseAdmin.from("google_calendar_connections").update({
        access_token: token,
        token_expires_at: new Date(Date.now() + (refreshed.expires_in - 30) * 1000).toISOString(),
        status: "connected",
        last_error: null,
      }).eq("id", conn.id);
    } catch (e: any) {
      await supabaseAdmin.from("google_calendar_connections")
        .update({ status: "reconnect_required", last_error: String(e?.message ?? e) })
        .eq("id", conn.id);
      return null;
    }
  }
  return { token: token!, calendarId: conn.selected_calendar_id || "primary" };
}

export async function gcalListCalendars(accessToken: string) {
  const res = await fetch(`${GOOGLE_API_BASE}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Google API error ${res.status}`);
  return (data.items ?? []) as Array<{ id: string; summary: string; primary?: boolean; accessRole: string; backgroundColor?: string }>;
}

export async function gcalCreateEvent(
  coachId: string,
  payload: {
    summary: string;
    description?: string;
    startISO: string;
    endISO: string;
    timezone: string;
    location?: string;
    attendees?: Array<{ email: string; displayName?: string }>;
    meet?: boolean;
  },
): Promise<{ id: string; htmlLink?: string; meetLink?: string } | null> {
  const cred = await getValidAccessTokenForCoach(coachId);
  if (!cred) return null;
  const body: any = {
    summary: payload.summary,
    description: payload.description,
    location: payload.location,
    start: { dateTime: payload.startISO, timeZone: payload.timezone },
    end: { dateTime: payload.endISO, timeZone: payload.timezone },
    attendees: payload.attendees,
  };
  if (payload.meet) {
    body.conferenceData = {
      createRequest: { requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  const url = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(cred.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Google create event failed ${res.status}`);
  const meetLink: string | undefined =
    data.hangoutLink ||
    data.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri;
  return { id: data.id, htmlLink: data.htmlLink, meetLink };
}

export async function gcalUpdateEvent(coachId: string, eventId: string, patch: Record<string, unknown>) {
  const cred = await getValidAccessTokenForCoach(coachId);
  if (!cred) return null;
  const url = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(cred.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Google update failed ${res.status}`);
  }
  return await res.json();
}

export async function gcalDeleteEvent(coachId: string, eventId: string) {
  const cred = await getValidAccessTokenForCoach(coachId);
  if (!cred) return null;
  const url = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(cred.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${cred.token}` } });
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Google delete failed ${res.status}`);
  }
  return true;
}

// Returns busy windows from Google for a coach across a range.
export async function gcalFreeBusy(coachId: string, timeMinISO: string, timeMaxISO: string): Promise<Array<{ start: string; end: string }>> {
  const cred = await getValidAccessTokenForCoach(coachId);
  if (!cred) return [];
  const res = await fetch(`${GOOGLE_API_BASE}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: cred.calendarId }] }),
  });
  const data = await res.json();
  if (!res.ok) return [];
  const cal = data.calendars?.[cred.calendarId];
  return cal?.busy ?? [];
}