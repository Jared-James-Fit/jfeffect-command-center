// Server-only: "Connect Google Calendar" for clients (see client-gcal.ts).
//
// Uses the client's own Google sign-in (scope calendar.app.created), not the
// workspace connector: the app can only touch the "JF Effect" calendar it
// created in their account. Rows live in client_google_calendars (service
// role only, it holds tokens).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BATCH_MAX,
  CLIENT_GCAL_DESCRIPTION,
  CLIENT_GCAL_NAME,
  CLIENT_GCAL_SCOPE,
  CLIENT_GCAL_SCOPES,
  FULL_CHECK_MS,
  SYNC_WINDOW_PAST_MS,
  authErrorCode,
  canonicalOrigin,
  googleEventEndMs,
  looksLikeGoogleClientId,
  setupProblemMessage,
  batchBoundaryOf,
  buildBatchBody,
  desiredGoogleEvents,
  parseBatchResponse,
  planSync,
  syncSetHash,
  type BatchOp,
  type BatchResult,
  type ExistingGoogleEvent,
  type GoogleEventBody,
  type GoogleSetupCheck,
} from "@/lib/client-gcal";
import { buildOAuthRedirectUri, googleClientCreds } from "@/lib/google-cal.server";
import { DEFAULT_TZ } from "@/lib/schedule-time";

type Admin = SupabaseClient<any, any, any>;

const API = "https://www.googleapis.com/calendar/v3";
const BATCH_URL = "https://www.googleapis.com/batch/calendar/v3";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TABLE = "client_google_calendars";

export class ConnectError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}
class RevokedError extends Error {}

/** The Google sign-in app's id and secret are in the project secrets (not yet checked with Google). */
export function clientGoogleConfigured(): boolean {
  const { clientId, clientSecret } = googleClientCreds();
  return !!(clientId && clientSecret);
}

/** Where calendar items link back to (same as the feed links). */
function appOrigin(): string {
  return (process.env.PUBLIC_APP_URL || process.env.SITE_URL || "https://jfeffect.com").replace(/\/$/, "");
}

/**
 * The one address Google sends people back to. Fixed (the real site, never
 * a preview host), so it's the single redirect URI registered with Google,
 * and the start, the check and the callback all use the same one.
 */
export function oauthOrigin(): string {
  return canonicalOrigin(process.env.PUBLIC_APP_URL || process.env.SITE_URL);
}

export async function clientAuthorizeUrl(origin: string, state: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: googleClientCreds().clientId,
    redirect_uri: buildOAuthRedirectUri(origin),
    response_type: "code",
    scope: CLIENT_GCAL_SCOPES.join(" "),
    access_type: "offline",
    // Always hand back a refresh token, and let people with several Google
    // accounts pick the one their phone uses.
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// ---- Setup check ---------------------------------------------------------------
//
// Asks Google whether the configured client id, secret and redirect URI work,
// without anyone signing in: the authorize endpoint answers with its error
// page for a bad client or redirect URI, and the token endpoint tells a bad
// secret (invalid_client) from a fine one (invalid_grant for a fake code).
// Cached in app_settings so the button only shows when sign-in will work, and
// a broken setup raises one admin alert (cleared once it works) instead of
// sending clients to Google's error page.

const SETUP_KEY = "client_google_calendar_check";
const SETUP_ALERT = "google_calendar_setup";
const RECHECK_OK_MS = 60 * 60 * 1000;
const RECHECK_FAILED_MS = 5 * 60 * 1000;

async function probeGoogleSetup(): Promise<{ ok: boolean; problem: string | null }> {
  const { clientId, clientSecret } = googleClientCreds();
  if (!clientId || !clientSecret) return { ok: false, problem: "missing" };
  if (!looksLikeGoogleClientId(clientId)) return { ok: false, problem: "client_id_format" };
  const redirectUri = buildOAuthRedirectUri(oauthOrigin());

  const auth = await fetch(
    `${AUTH_URL}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: CLIENT_GCAL_SCOPES.join(" ") })}`,
    { redirect: "manual" },
  );
  const location = auth.headers.get("location");
  let code = authErrorCode(location);
  if (!location) {
    const body = await auth.text().catch(() => "");
    if (/signin\/oauth\/error/.test(body)) {
      code = /(invalid_client|redirect_uri_mismatch|unauthorized_client|deleted_client|disabled_client|invalid_request)/.exec(body)?.[1] ?? "authorize_error";
    }
  }
  if (code) return { ok: false, problem: code };

  const token = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "jf-setup-check",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });
  const data: any = await token.json().catch(() => ({}));
  if (data?.error === "invalid_grant") return { ok: true, problem: null };
  if (data?.error === "invalid_client") return { ok: false, problem: /secret/i.test(data?.error_description ?? "") ? "bad_secret" : "invalid_client" };
  return { ok: false, problem: String(data?.error || `token_${token.status}`) };
}

async function readSetupCheck(admin: Admin): Promise<GoogleSetupCheck | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", SETUP_KEY).maybeSingle();
  try {
    return data?.value ? (JSON.parse(data.value) as GoogleSetupCheck) : null;
  } catch {
    return null;
  }
}

/** Run the check now, store it, and raise or clear the admin alert. */
export async function runGoogleSetupCheck(admin: Admin): Promise<GoogleSetupCheck> {
  let result: { ok: boolean; problem: string | null };
  try {
    result = await probeGoogleSetup();
  } catch (e: any) {
    // Couldn't reach Google: keep what we knew, try again next time.
    const prev = await readSetupCheck(admin);
    if (prev) return prev;
    result = { ok: false, problem: "unreachable" };
  }
  const check: GoogleSetupCheck = {
    ok: result.ok,
    problem: result.problem,
    clientId: googleClientCreds().clientId || null,
    redirectUri: buildOAuthRedirectUri(oauthOrigin()),
    checkedAt: new Date().toISOString(),
  };
  await admin
    .from("app_settings")
    .upsert({ key: SETUP_KEY, value: JSON.stringify(check), updated_at: check.checkedAt }, { onConflict: "key" });
  await syncSetupAlert(admin, check).catch(() => {});
  return check;
}

async function syncSetupAlert(admin: Admin, check: GoogleSetupCheck): Promise<void> {
  const { data: open } = await admin
    .from("support_alerts")
    .select("id, error_message")
    .eq("error_type", SETUP_ALERT)
    .in("status", ["open", "in_progress"])
    .limit(1);
  const current = (open ?? [])[0] as { id: string; error_message: string | null } | undefined;
  const now = new Date().toISOString();
  if (check.ok) {
    if (current) {
      await admin.from("support_alerts").update({ status: "resolved", resolved_at: now, updated_at: now }).eq("id", current.id);
    }
    return;
  }
  // "Not set up" isn't a fault: no alert until someone has added keys.
  if (check.problem === "missing") return;
  const message = `Clients can't connect Google Calendar: ${setupProblemMessage(check)}`;
  const details = { problem: check.problem, client_id: check.clientId, redirect_uri: check.redirectUri, checked_at: check.checkedAt };
  if (current) {
    if (current.error_message !== message) {
      await admin.from("support_alerts").update({ error_message: message, details, updated_at: now }).eq("id", current.id);
    }
    return;
  }
  await admin.from("support_alerts").insert({ error_type: SETUP_ALERT, error_message: message, details, page_route: "/admin" });
}

/**
 * Google sign-in will work: keys present and Google accepted them on the
 * last check. Re-checks when the keys changed, hourly when fine, and every 5
 * minutes while broken (so a fix in Lovable shows up quickly).
 */
export async function clientGoogleReady(admin: Admin): Promise<boolean> {
  if (!clientGoogleConfigured()) return false;
  const prev = await readSetupCheck(admin);
  const age = prev ? Date.now() - Date.parse(prev.checkedAt) : Infinity;
  const keysChanged = !prev || prev.clientId !== googleClientCreds().clientId || prev.redirectUri !== buildOAuthRedirectUri(oauthOrigin());
  const due = keysChanged || age > (prev?.ok ? RECHECK_OK_MS : RECHECK_FAILED_MS);
  const check = due ? await runGoogleSetupCheck(admin) : prev!;
  return check.ok;
}

// ---- Tokens -------------------------------------------------------------------

async function refreshToken(refresh: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientCreds().clientId,
      client_secret: googleClientCreds().clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant: they removed access in their Google account (or the
    // sign-in app is still in Google's 7-day "Testing" mode).
    if (data?.error === "invalid_grant") throw new RevokedError(data?.error_description || "invalid_grant");
    throw new Error(`Google token refresh failed: ${data?.error_description || data?.error || res.status}`);
  }
  return data;
}

async function accessTokenFor(admin: Admin, row: any): Promise<string> {
  if (row.access_token && row.token_expires_at && Date.parse(row.token_expires_at) > Date.now() + 60_000) {
    return row.access_token as string;
  }
  try {
    const t = await refreshToken(row.refresh_token);
    const expires = new Date(Date.now() + (Number(t.expires_in || 3600) - 30) * 1000).toISOString();
    await admin
      .from(TABLE)
      .update({ access_token: t.access_token, token_expires_at: expires })
      .eq("client_id", row.client_id)
      .eq("refresh_token", row.refresh_token);
    row.access_token = t.access_token;
    row.token_expires_at = expires;
    return t.access_token;
  } catch (e) {
    if (e instanceof RevokedError) {
      await admin
        .from(TABLE)
        .update({ status: "revoked", last_error: "Google access was removed. Connect Google Calendar again.", updated_at: new Date().toISOString() })
        .eq("client_id", row.client_id)
        .eq("refresh_token", row.refresh_token);
    }
    throw e;
  }
}

async function google(token: string, url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

// ---- Calendar -------------------------------------------------------------------

async function createCalendar(token: string): Promise<string> {
  const r = await google(token, `${API}/calendars`, {
    method: "POST",
    body: JSON.stringify({ summary: CLIENT_GCAL_NAME, description: CLIENT_GCAL_DESCRIPTION, timeZone: DEFAULT_TZ }),
  });
  if (!r.ok || !r.data?.id) throw new Error(`Couldn't create the JF Effect calendar (${r.data?.error?.message || r.status})`);
  return r.data.id as string;
}

async function calendarExists(token: string, calendarId: string): Promise<boolean> {
  const r = await google(token, `${API}/calendars/${encodeURIComponent(calendarId)}?fields=id`);
  return r.ok;
}

/** Events in our calendar that haven't long ended, including ones deleted (cancelled). */
async function listEvents(token: string, calendarId: string, timeMin: Date): Promise<{ notFound: boolean; items: ExistingGoogleEvent[] }> {
  const items: ExistingGoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 4; page++) {
    const q = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      showDeleted: "true",
      singleEvents: "true",
      maxResults: "2500",
      fields: "nextPageToken,items(id,status,start,end,extendedProperties/private)",
    });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await google(token, `${API}/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    if (r.status === 404 || r.status === 410) return { notFound: true, items: [] };
    if (!r.ok) throw new Error(`Google list failed (${r.data?.error?.message || r.status})`);
    for (const it of (r.data?.items ?? []) as any[]) {
      const priv = it.extendedProperties?.private ?? {};
      items.push({ id: it.id, status: it.status, jf: priv.jf === "1", hash: priv.jfHash ?? null, endsAt: googleEventEndMs(it.end) });
    }
    pageToken = r.data?.nextPageToken;
    if (!pageToken) break;
  }
  return { notFound: false, items };
}

async function runBatch(token: string, ops: BatchOp[]): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  for (let i = 0; i < ops.length; i += BATCH_MAX) {
    const chunk = ops.slice(i, i + BATCH_MAX);
    const boundary = `jf_batch_${Date.now().toString(36)}_${i}`;
    const res = await fetch(BATCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/mixed; boundary=${boundary}` },
      body: buildBatchBody(chunk, boundary),
    });
    const text = await res.text();
    const replyBoundary = batchBoundaryOf(res.headers.get("content-type"));
    if (!res.ok || !replyBoundary) {
      for (const op of chunk) out.push({ key: op.key, status: res.status || 500, body: text.slice(0, 300) });
      continue;
    }
    const parsed = new Map(parseBatchResponse(text, replyBoundary).map((r) => [r.key, r]));
    for (const op of chunk) out.push(parsed.get(op.key) ?? { key: op.key, status: 500, body: "missing from batch reply" });
  }
  return out;
}

function eventsPath(calendarId: string, eventId?: string): string {
  return `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;
}

/** Apply a plan. Returns how many calls failed (they're retried on the next run). */
async function applyPlan(
  token: string,
  calendarId: string,
  plan: { insert: GoogleEventBody[]; update: GoogleEventBody[]; remove: string[] },
): Promise<{ inserted: number; updated: number; removed: number; failed: number; firstError: string | null }> {
  const ops: BatchOp[] = [];
  const kind = new Map<string, { type: "insert" | "update" | "remove"; event?: GoogleEventBody }>();
  const add = (type: "insert" | "update" | "remove", event: GoogleEventBody | null, id: string) => {
    const key = `op-${ops.length}`;
    kind.set(key, { type, event: event ?? undefined });
    if (type === "insert") ops.push({ key, method: "POST", path: eventsPath(calendarId), body: event });
    else if (type === "update") ops.push({ key, method: "PUT", path: eventsPath(calendarId, id), body: event });
    else ops.push({ key, method: "DELETE", path: eventsPath(calendarId, id) });
  };
  plan.insert.forEach((e) => add("insert", e, e.id));
  plan.update.forEach((e) => add("update", e, e.id));
  plan.remove.forEach((id) => add("remove", null, id));

  let inserted = 0, updated = 0, removed = 0, failed = 0;
  let firstError: string | null = null;
  const retryAsUpdate: GoogleEventBody[] = [];
  const fail = (r: BatchResult) => {
    failed++;
    firstError ??= String(r.body?.error?.message || r.body || `HTTP ${r.status}`).slice(0, 200);
  };
  for (const r of await runBatch(token, ops)) {
    const k = kind.get(r.key);
    if (!k) continue;
    const ok = r.status >= 200 && r.status < 300;
    if (k.type === "insert") {
      if (ok) inserted++;
      // Same id already there (an older copy outside the window, or deleted):
      // update it instead, which also brings a deleted one back.
      else if (r.status === 409 && k.event) retryAsUpdate.push(k.event);
      else fail(r);
    } else if (k.type === "update") {
      if (ok) updated++;
      else fail(r);
    } else if (ok || r.status === 404 || r.status === 410) removed++;
    else fail(r);
  }
  if (retryAsUpdate.length) {
    const second = await applyPlan(token, calendarId, { insert: [], update: retryAsUpdate, remove: [] });
    updated += second.updated;
    failed += second.failed;
    firstError ??= second.firstError;
  }
  return { inserted, updated, removed, failed, firstError };
}

// ---- Sync -----------------------------------------------------------------------

export type ClientCalendarSync =
  | { skipped: "not_connected" | "unchanged" | "revoked" }
  | { inserted: number; updated: number; removed: number; failed: number; events: number };

/**
 * Make the client's JF Effect calendar match their feed. Cheap when nothing
 * changed: compares a fingerprint and only calls Google once a day then.
 */
export async function syncClientCalendar(admin: Admin, clientId: string, opts: { force?: boolean; row?: any } = {}): Promise<ClientCalendarSync> {
  const now = new Date();
  const row =
    opts.row ?? (await admin.from(TABLE).select("*").eq("client_id", clientId).maybeSingle()).data;
  if (!row) return { skipped: "not_connected" };
  if (row.status === "revoked") return { skipped: "revoked" };

  const { buildClientFeedEvents } = await import("@/lib/calendar-feed.server");
  const windowStart = new Date(now.getTime() - SYNC_WINDOW_PAST_MS);
  const desired = desiredGoogleEvents(await buildClientFeedEvents(admin, clientId, appOrigin()), windowStart);
  const recentlyChecked = row.last_synced_at && now.getTime() - Date.parse(row.last_synced_at) < FULL_CHECK_MS;
  if (!opts.force && row.status === "connected" && recentlyChecked && row.last_sync_hash === syncSetHash(desired, row.calendar_id)) {
    await admin.from(TABLE).update({ last_checked_at: now.toISOString() }).eq("client_id", clientId).eq("refresh_token", row.refresh_token);
    return { skipped: "unchanged" };
  }

  let token: string;
  try {
    token = await accessTokenFor(admin, row);
  } catch (e) {
    if (e instanceof RevokedError) return { skipped: "revoked" };
    throw e;
  }

  // They deleted the calendar in Google: make a fresh one.
  let calendarId: string | null = row.calendar_id;
  let listed = calendarId ? await listEvents(token, calendarId, windowStart) : { notFound: true, items: [] as ExistingGoogleEvent[] };
  if (listed.notFound) {
    // Still the same connection? (Not disconnected or switched to another
    // Google account while this ran: never leave an orphan calendar behind.)
    const { data: current } = await admin.from(TABLE).select("refresh_token").eq("client_id", clientId).maybeSingle();
    if (current?.refresh_token !== row.refresh_token) return { skipped: "not_connected" };
    calendarId = await createCalendar(token);
    listed = { notFound: false, items: [] };
  }
  const result = await applyPlan(token, calendarId as string, planSync(desired, listed.items));

  await admin
    .from(TABLE)
    .update({
      calendar_id: calendarId,
      status: result.failed ? "error" : "connected",
      last_error: result.failed ? `${result.failed} change${result.failed === 1 ? "" : "s"} didn't go through: ${result.firstError}` : null,
      // Only remember the fingerprint when everything landed, so failures retry.
      last_sync_hash: result.failed ? null : syncSetHash(desired, calendarId),
      last_synced_at: now.toISOString(),
      last_checked_at: now.toISOString(),
      event_count: desired.length,
      updated_at: now.toISOString(),
    })
    .eq("client_id", clientId)
    // Only onto the connection this run started with.
    .eq("refresh_token", row.refresh_token);

  return { inserted: result.inserted, updated: result.updated, removed: result.removed, failed: result.failed, events: desired.length };
}

/** The 5-minute job: least recently checked connections first, within a time budget. */
export async function syncDueClientCalendars(admin: Admin, opts: { max?: number; budgetMs?: number } = {}) {
  if (!clientGoogleConfigured()) return { skipped: "not_configured" };
  if (!(await clientGoogleReady(admin))) {
    const check = await readSetupCheck(admin);
    return { skipped: "setup_problem", problem: check?.problem ?? null };
  }
  const started = Date.now();
  const { data: rows, error } = await admin
    .from(TABLE)
    .select("*")
    .neq("status", "revoked")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(opts.max ?? 20);
  if (error) throw new Error(error.message);
  let checked = 0, changed = 0, failed = 0;
  for (const row of (rows ?? []) as any[]) {
    if (Date.now() - started > (opts.budgetMs ?? 25_000)) break;
    checked++;
    try {
      const r = await syncClientCalendar(admin, row.client_id, { row });
      if ("events" in r) {
        changed++;
        if (r.failed) failed++;
      }
    } catch (e: any) {
      failed++;
      await admin
        .from(TABLE)
        .update({ status: "error", last_error: String(e?.message ?? e).slice(0, 300), last_checked_at: new Date().toISOString() })
        .eq("client_id", row.client_id)
        .eq("refresh_token", row.refresh_token);
    }
  }
  return { connected: (rows ?? []).length, checked, changed, failed };
}

// ---- Connect / disconnect -------------------------------------------------------

/** OAuth callback: store the sign-in, make (or reuse) their JF Effect calendar, fill it. */
export async function completeClientConnect(
  admin: Admin,
  args: { code: string; origin: string; clientId: string; userId: string },
): Promise<{ email: string | null; sync: ClientCalendarSync | { error: string } }> {
  const { exchangeCode, decodeIdTokenEmail } = await import("@/lib/google-cal.server");
  const tokens = await exchangeCode(args.code, args.origin);
  if (!(tokens.scope ?? "").split(/\s+/).includes(CLIENT_GCAL_SCOPE)) throw new ConnectError("calendar_permission");
  if (!tokens.refresh_token) throw new ConnectError("no_refresh_token");
  const email = decodeIdTokenEmail(tokens.id_token);

  const { data: prev } = await admin.from(TABLE).select("calendar_id, google_email, refresh_token").eq("client_id", args.clientId).maybeSingle();
  let calendarId: string | null = prev?.calendar_id && prev.google_email === email ? prev.calendar_id : null;
  if (calendarId && !(await calendarExists(tokens.access_token, calendarId))) calendarId = null;
  if (!calendarId) calendarId = await createCalendar(tokens.access_token);
  // Switched Google accounts: let go of the old one.
  if (prev?.refresh_token && prev.google_email !== email) await revoke(prev.refresh_token);

  const now = new Date().toISOString();
  const { error } = await admin.from(TABLE).upsert(
    {
      client_id: args.clientId,
      connected_by: args.userId,
      google_email: email,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      token_expires_at: new Date(Date.now() + (Number(tokens.expires_in || 3600) - 30) * 1000).toISOString(),
      calendar_id: calendarId,
      status: "connected",
      last_sync_hash: null,
      last_error: null,
      updated_at: now,
    },
    { onConflict: "client_id" },
  );
  if (error) throw new Error(error.message);

  // Fill it now so it's there by the time they look. A failure here is only
  // a delay: the 5-minute job retries.
  let sync: ClientCalendarSync | { error: string };
  try {
    sync = await syncClientCalendar(admin, args.clientId, { force: true });
  } catch (e: any) {
    sync = { error: String(e?.message ?? e) };
    await admin.from(TABLE).update({ last_error: sync.error.slice(0, 300) }).eq("client_id", args.clientId);
  }
  return { email, sync };
}

async function revoke(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    /* best effort */
  }
}

/** Remove the JF Effect calendar from their Google account and forget the sign-in. */
export async function disconnectClientCalendar(admin: Admin, clientId: string): Promise<{ removedCalendar: boolean }> {
  const { data: row } = await admin.from(TABLE).select("*").eq("client_id", clientId).maybeSingle();
  if (!row) return { removedCalendar: false };
  let removedCalendar = false;
  if (row.calendar_id && row.status !== "revoked") {
    try {
      const token = await accessTokenFor(admin, row);
      const r = await google(token, `${API}/calendars/${encodeURIComponent(row.calendar_id)}`, { method: "DELETE" });
      removedCalendar = r.ok || r.status === 404 || r.status === 410;
    } catch {
      /* access already gone: nothing to remove */
    }
  }
  await revoke(row.refresh_token);
  await admin.from(TABLE).delete().eq("client_id", clientId);
  return { removedCalendar };
}

/** What the Setup card shows. No tokens leave the server. */
export async function clientGoogleStatus(admin: Admin, clientId: string) {
  const { data: row } = await admin
    .from(TABLE)
    .select("google_email, status, last_synced_at, last_error, event_count")
    .eq("client_id", clientId)
    .maybeSingle();
  const available = await clientGoogleReady(admin).catch(() => false);
  return {
    available,
    connected: !!row && row.status !== "revoked",
    revoked: row?.status === "revoked",
    email: (row?.google_email as string | null) ?? null,
    lastSyncedAt: (row?.last_synced_at as string | null) ?? null,
    error: row?.status === "error" ? ((row?.last_error as string | null) ?? null) : null,
    events: Number(row?.event_count ?? 0),
  };
}
