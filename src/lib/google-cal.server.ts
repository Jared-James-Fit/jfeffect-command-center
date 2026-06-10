// Server-only helpers for per-coach Google Calendar OAuth + Calendar API.
// Do not import this from client code.

import { createHmac, timingSafeEqual } from "crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";
const GATEWAY_BASE = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";

function gatewayHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const lov = process.env.LOVABLE_API_KEY;
  const key = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!lov || !key) throw new Error("Google Calendar connector is not configured.");
  return {
    Authorization: `Bearer ${lov}`,
    "X-Connection-Api-Key": key,
    ...extra,
  };
}

export function workspaceCalendarConfigured(): boolean {
  return !!(process.env.LOVABLE_API_KEY && process.env.GOOGLE_CALENDAR_API_KEY);
}

async function selectedCalendarIdForCoach(coachId: string | null): Promise<string> {
  if (!coachId) return "primary";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn } = await supabaseAdmin
    .from("google_calendar_connections")
    .select("selected_calendar_id")
    .eq("coach_id", coachId)
    .maybeSingle();
  return (conn?.selected_calendar_id as string) || "primary";
}
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
  // Legacy shape kept for compatibility. Returns the shared workspace token
  // via the Lovable connector gateway; the "token" here is the gateway key.
  if (!workspaceCalendarConfigured()) return null;
  const calendarId = await selectedCalendarIdForCoach(coachId);
  return { token: "__gateway__", calendarId };
}

export async function gcalListCalendars(_accessToken?: string) {
  const res = await fetch(`${GATEWAY_BASE}/users/me/calendarList`, {
    headers: gatewayHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Google API error ${res.status}`);
  return (data.items ?? []) as Array<{ id: string; summary: string; primary?: boolean; accessRole: string; backgroundColor?: string }>;
}

export async function gcalCreateEvent(
  coachId: string | null,
  payload: {
    summary: string;
    description?: string;
    startISO?: string;
    endISO?: string;
    startDate?: string;
    endDate?: string;
    timezone?: string;
    location?: string;
    attendees?: Array<{ email: string; displayName?: string }>;
    meet?: boolean;
    transparency?: "opaque" | "transparent";
  },
): Promise<{ id: string; htmlLink?: string; meetLink?: string } | null> {
  if (!workspaceCalendarConfigured()) return null;
  const calendarId = await selectedCalendarIdForCoach(coachId);
  const body: any = {
    summary: payload.summary,
    description: payload.description,
    location: payload.location,
    start: payload.startISO
      ? { dateTime: payload.startISO, timeZone: payload.timezone }
      : { date: payload.startDate },
    end: payload.endISO
      ? { dateTime: payload.endISO, timeZone: payload.timezone }
      : { date: payload.endDate },
    attendees: payload.attendees,
    transparency: payload.transparency ?? "opaque",
  };
  if (payload.meet) {
    body.conferenceData = {
      createRequest: { requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  const url = `${GATEWAY_BASE}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
  const res = await fetch(url, {
    method: "POST",
    headers: gatewayHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Google create event failed ${res.status}`);
  const meetLink: string | undefined =
    data.hangoutLink ||
    data.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri;
  return { id: data.id, htmlLink: data.htmlLink, meetLink };
}

function normalizeEventPatch(patch: Record<string, unknown>) {
  if (patch.startISO || patch.endISO || patch.startDate || patch.endDate) {
    const { startISO, endISO, startDate, endDate, timezone, ...rest } = patch as any;
    return {
      ...rest,
      start: startISO ? { dateTime: startISO, timeZone: timezone } : { date: startDate },
      end: endISO ? { dateTime: endISO, timeZone: timezone } : { date: endDate },
    };
  }
  return patch;
}

export async function gcalUpdateEvent(coachId: string | null, eventId: string, patch: Record<string, unknown>) {
  if (!workspaceCalendarConfigured()) return null;
  const calendarId = await selectedCalendarIdForCoach(coachId);
  const url = `${GATEWAY_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: gatewayHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(normalizeEventPatch(patch)),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Google update failed ${res.status}`);
  }
  return await res.json();
}

export async function gcalDeleteEvent(coachId: string | null, eventId: string) {
  if (!workspaceCalendarConfigured()) return null;
  const calendarId = await selectedCalendarIdForCoach(coachId);
  const url = `${GATEWAY_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  const res = await fetch(url, { method: "DELETE", headers: gatewayHeaders() });
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Google delete failed ${res.status}`);
  }
  return true;
}

// Returns busy windows from Google for a coach across a range.
export async function gcalFreeBusy(coachId: string, timeMinISO: string, timeMaxISO: string): Promise<Array<{ start: string; end: string }>> {
  if (!workspaceCalendarConfigured()) return [];
  const calendarId = await selectedCalendarIdForCoach(coachId);
  const res = await fetch(`${GATEWAY_BASE}/freeBusy`, {
    method: "POST",
    headers: gatewayHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: calendarId }] }),
  });
  const data = await res.json();
  if (!res.ok) return [];
  const cal = data.calendars?.[calendarId];
  return cal?.busy ?? [];
}

// Returns Google Calendar events for a range (read-only view).
export async function gcalListEvents(
  coachId: string | null,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<Array<{ id: string; summary: string; start: string; end: string; allDay: boolean; htmlLink?: string; location?: string; status?: string; hangoutLink?: string }>> {
  if (!workspaceCalendarConfigured()) return [];
  const calendarId = await selectedCalendarIdForCoach(coachId);
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(`${GATEWAY_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
    headers: gatewayHeaders(),
  });
  const data = await res.json();
  if (!res.ok) return [];
  return (data.items ?? [])
    .filter((e: any) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date))
    .map((e: any) => ({
      id: e.id,
      summary: e.summary || "(busy)",
      start: e.start.dateTime || e.start.date,
      end: e.end?.dateTime || e.end?.date,
      allDay: !e.start.dateTime,
      htmlLink: e.htmlLink,
      location: e.location,
      status: e.status,
      hangoutLink: e.hangoutLink,
    }));
}