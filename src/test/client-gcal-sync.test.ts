/**
 * Connect Google Calendar end to end against a fake Google (token endpoint,
 * calendars, events list, batch) and a fake database: connect, first fill,
 * edits, a calendar deleted by hand, access removed, disconnect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedEvent } from "@/lib/ics-feed";

let feed: FeedEvent[] = [];
vi.mock("@/lib/calendar-feed.server", () => ({ buildClientFeedEvents: async () => feed }));

// ---- fake database (just what client-gcal.server uses) ------------------------
function fakeAdmin() {
  const tables = new Map<string, Map<string, any>>();
  const t = (name: string) => tables.get(name) ?? tables.set(name, new Map()).get(name)!;
  return {
    tables,
    from(name: string) {
      const filters: Array<(r: any) => boolean> = [];
      let op: "select" | "update" | "delete" = "select";
      let payload: any = null;
      const keyOf = (r: any) => r.key ?? r.client_id ?? r.id;
      const rows = () => Array.from(t(name).values()).filter((r) => filters.every((f) => f(r)));
      const run = () => {
        if (op === "update") rows().forEach((r) => Object.assign(r, payload));
        if (op === "delete") rows().forEach((r) => t(name).delete(keyOf(r)));
        return { data: op === "select" ? rows().map((r) => ({ ...r })) : null, error: null };
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
        neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), q),
        in: (c: string, vs: any[]) => (filters.push((r) => vs.includes(r[c])), q),
        order: () => q,
        limit: () => q,
        update: (p: any) => ((op = "update"), (payload = p), q),
        delete: () => ((op = "delete"), q),
        upsert: async (p: any) => {
          t(name).set(keyOf(p), { ...(t(name).get(keyOf(p)) ?? {}), ...p });
          return { data: null, error: null };
        },
        insert: async (p: any) => {
          const row = { id: `id-${t(name).size + 1}`, status: "open", ...p };
          t(name).set(keyOf(row), row);
          return { data: null, error: null };
        },
        maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  };
}

// ---- fake Google ------------------------------------------------------------
type GEvent = { id: string; status: string; body: any };
function fakeGoogle() {
  const g = {
    calendars: new Map<string, Map<string, GEvent>>(),
    revokedRefresh: new Set<string>(),
    calls: [] as string[],
    nextCal: 1,
    grantedScope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.app.created",
    clientId: "123-abc.apps.googleusercontent.com",
    clientSecret: "secret",
    redirectUris: ["https://jfeffect.com/api/public/google/oauth/callback"],
  };
  const authError = (code: string) => {
    const bytes = [0x0a, code.length, ...Buffer.from(code)];
    return Buffer.from(bytes).toString("base64url");
  };
  const json = (status: number, body: unknown) =>
    new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

  const applyEvent = (method: string, path: string, body: any): { status: number; body: any } => {
    const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/?]+))?$/.exec(path);
    if (!m) return { status: 400, body: { error: { message: "bad path" } } };
    const cal = g.calendars.get(decodeURIComponent(m[1]));
    if (!cal) return { status: 404, body: { error: { message: "Not Found" } } };
    const id = m[2] ? decodeURIComponent(m[2]) : body?.id;
    if (method === "POST") {
      if (cal.has(id)) return { status: 409, body: { error: { code: 409, message: "The requested identifier already exists." } } };
      cal.set(id, { id, status: "confirmed", body });
      return { status: 200, body: { id } };
    }
    if (method === "PUT") {
      if (!cal.has(id)) return { status: 404, body: { error: { message: "Not Found" } } };
      cal.set(id, { id, status: body?.status ?? "confirmed", body });
      return { status: 200, body: { id } };
    }
    if (method === "DELETE") {
      const ev = cal.get(id);
      if (!ev || ev.status === "cancelled") return { status: 410, body: { error: { message: "Gone" } } };
      ev.status = "cancelled";
      return { status: 204, body: null };
    }
    return { status: 405, body: null };
  };

  const fetchImpl = async (input: any, init: any = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    g.calls.push(`${method} ${url.pathname}`);
    if (url.href.startsWith("https://accounts.google.com/o/oauth2/v2/auth")) {
      const id = url.searchParams.get("client_id");
      const err = id !== g.clientId ? "invalid_client" : !g.redirectUris.includes(url.searchParams.get("redirect_uri") ?? "") ? "redirect_uri_mismatch" : null;
      const location = err
        ? `https://accounts.google.com/signin/oauth/error?authError=${authError(err)}&client_id=${id}`
        : "https://accounts.google.com/v3/signin/identifier?client_id=x";
      return new Response(null, { status: 302, headers: { location } });
    }
    if (url.href.startsWith("https://oauth2.googleapis.com/token")) {
      const p = new URLSearchParams(String(init.body));
      if (p.get("client_id") !== g.clientId) return json(401, { error: "invalid_client", error_description: "The OAuth client was not found." });
      if (p.get("client_secret") !== g.clientSecret) return json(401, { error: "invalid_client", error_description: "The provided client secret is invalid." });
      if (p.get("code") === "jf-setup-check") return json(400, { error: "invalid_grant", error_description: "Malformed auth code." });
      if (p.get("grant_type") === "authorization_code") {
        return json(200, {
          access_token: "at-1",
          refresh_token: `rt-${p.get("code")}`,
          expires_in: 3600,
          scope: g.grantedScope,
          id_token: idToken("fionna@gmail.com"),
        });
      }
      const rt = p.get("refresh_token") ?? "";
      if (g.revokedRefresh.has(rt)) return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      return json(200, { access_token: `at-${Date.now()}`, expires_in: 3600 });
    }
    if (url.href.startsWith("https://oauth2.googleapis.com/revoke")) return json(200, {});
    if (url.pathname === "/calendar/v3/calendars" && method === "POST") {
      const id = `cal${g.nextCal++}@group.calendar.google.com`;
      g.calendars.set(id, new Map());
      return json(200, { id });
    }
    const calOnly = /^\/calendar\/v3\/calendars\/([^/]+)$/.exec(url.pathname);
    if (calOnly) {
      const id = decodeURIComponent(calOnly[1]);
      if (method === "DELETE") return json(g.calendars.delete(id) ? 204 : 404, null);
      return g.calendars.has(id) ? json(200, { id }) : json(404, { error: { message: "Not Found" } });
    }
    const list = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (list && method === "GET") {
      const cal = g.calendars.get(decodeURIComponent(list[1]));
      if (!cal) return json(404, { error: { message: "Not Found" } });
      return json(200, {
        items: Array.from(cal.values()).map((e) => ({
          id: e.id,
          status: e.status,
          start: e.body?.start,
          end: e.body?.end,
          extendedProperties: e.body?.extendedProperties,
        })),
      });
    }
    if (url.pathname === "/batch/calendar/v3") {
      const boundary = /boundary=([^;]+)/.exec(init.headers["Content-Type"])![1];
      const parts = String(init.body).split(`--${boundary}`).map((s) => s.trim()).filter((s) => s && s !== "--");
      const out = parts.map((part) => {
        const key = /Content-ID: <([^>]+)>/.exec(part)![1];
        const [, m, p] = /(POST|PUT|DELETE) (\S+) HTTP\/1\.1/.exec(part)!;
        const bodyText = part.split(/\r\n\r\n/).slice(2).join("\r\n\r\n").trim();
        const r = applyEvent(m, p, bodyText ? JSON.parse(bodyText) : undefined);
        return `--rb\r\nContent-Type: application/http\r\nContent-ID: <response-${key}>\r\n\r\nHTTP/1.1 ${r.status} X\r\nContent-Type: application/json\r\n\r\n${r.body ? JSON.stringify(r.body) : ""}\r\n`;
      });
      return new Response(`${out.join("")}--rb--\r\n`, { status: 200, headers: { "content-type": "multipart/mixed; boundary=rb" } });
    }
    return json(404, { error: { message: `unhandled ${method} ${url.pathname}` } });
  };
  return { g, fetchImpl };
}

const day = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);
const sessionAt = (id: string, d: number): FeedEvent => ({
  uid: `pt-${id}@jfeffect.com`,
  start: day(d),
  end: new Date(day(d).getTime() + 60 * 60 * 1000),
  summary: "1:1 Training",
});
const workoutOn = (id: string, d: number): FeedEvent => {
  const iso = day(d).toISOString().slice(0, 10);
  return { uid: `workout-${id}@jfeffect.com`, start: day(d), end: day(d), allDayDate: iso, summary: "Workout: Lower A" };
};

describe("Connect Google Calendar, end to end against a fake Google", () => {
  let google: ReturnType<typeof fakeGoogle>;
  let admin: ReturnType<typeof fakeAdmin>;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    google = fakeGoogle();
    admin = fakeAdmin();
    globalThis.fetch = google.fetchImpl as any;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "123-abc.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    delete process.env.PUBLIC_APP_URL;
    delete process.env.SITE_URL;
    feed = [sessionAt("a", 2), sessionAt("b", 5), workoutOn("w1", 1), { ...sessionAt("c", 3), cancelled: true }];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const row = () => admin.tables.get("client_google_calendars")!.get("client-1");
  const events = () => {
    const cal = google.g.calendars.get(row().calendar_id)!;
    return Array.from(cal.values()).filter((e) => e.status !== "cancelled");
  };

  it("connect makes a JF Effect calendar and fills it in one go; edits and removals follow", async () => {
    const { completeClientConnect, syncClientCalendar } = await import("@/lib/client-gcal.server");
    const res = await completeClientConnect(admin as any, { code: "c1", origin: "https://jfeffect.com", clientId: "client-1", userId: "user-1" });

    expect(res.email).toBe("fionna@gmail.com");
    expect(res.sync).toMatchObject({ inserted: 3, failed: 0 });
    expect(row()).toMatchObject({ status: "connected", google_email: "fionna@gmail.com", refresh_token: "rt-c1", event_count: 3 });
    expect(events().map((e) => e.body.summary).sort()).toEqual(["1:1 Training", "1:1 Training", "Workout: Lower A"]);
    // All writes went through Google's batch endpoint, not one request each.
    expect(google.g.calls.filter((c) => c.includes("/events") && !c.startsWith("GET")).length).toBe(0);

    // Nothing changed: no Google calls at all.
    const before = google.g.calls.length;
    expect(await syncClientCalendar(admin as any, "client-1")).toEqual({ skipped: "unchanged" });
    expect(google.g.calls.length).toBe(before);

    // Session b moved, session a cancelled, a new workout.
    feed = [sessionAt("b", 6), workoutOn("w1", 1), workoutOn("w2", 4), { ...sessionAt("a", 2), cancelled: true }];
    expect(await syncClientCalendar(admin as any, "client-1")).toMatchObject({ inserted: 1, updated: 1, removed: 1, failed: 0 });
    expect(events().length).toBe(3);

    // Session a comes back: the deleted Google event is revived, not duplicated.
    feed = [...feed.filter((e) => !e.uid.startsWith("pt-a")), sessionAt("a", 2)];
    expect(await syncClientCalendar(admin as any, "client-1")).toMatchObject({ updated: 1, failed: 0 });
    expect(events().length).toBe(4);
  });

  it("something that already happened stays in Google when it leaves the feed", async () => {
    const { completeClientConnect, syncClientCalendar } = await import("@/lib/client-gcal.server");
    const justDone: FeedEvent = { uid: "pt-done@jfeffect.com", start: day(-0.2), end: day(-0.1), summary: "1:1 Training" };
    feed = [justDone, sessionAt("a", 2)];
    await completeClientConnect(admin as any, { code: "c7", origin: "https://jfeffect.com", clientId: "client-1", userId: "user-1" });
    feed = [sessionAt("a", 2)];
    expect(await syncClientCalendar(admin as any, "client-1")).toMatchObject({ removed: 0, failed: 0 });
    expect(events().length).toBe(2);
  });

  it("a run that started on an old connection never overwrites a newer one", async () => {
    const { completeClientConnect, syncClientCalendar } = await import("@/lib/client-gcal.server");
    await completeClientConnect(admin as any, { code: "old", origin: "https://jfeffect.com", clientId: "client-1", userId: "user-1" });
    const stale = { ...row() };
    await completeClientConnect(admin as any, { code: "new", origin: "https://jfeffect.com", clientId: "client-1", userId: "user-1" });
    const fresh = { ...row() };
    feed = [sessionAt("n", 3)];
    await syncClientCalendar(admin as any, "client-1", { row: stale, force: true });
    expect(row().refresh_token).toBe("rt-new");
    expect(row().calendar_id).toBe(fresh.calendar_id);
    expect(row().last_sync_hash).toBe(fresh.last_sync_hash);
  });

  it("a calendar deleted by hand in Google is recreated and refilled", async () => {
    const { completeClientConnect, syncClientCalendar } = await import("@/lib/client-gcal.server");
    await completeClientConnect(admin as any, { code: "c2", origin: "https://jfeffect.com", clientId: "client-1", userId: "user-1" });
    const firstCal = row().calendar_id;
    google.g.calendars.delete(firstCal);
    row().last_sync_hash = "forced-stale";
    expect(await syncClientCalendar(admin as any, "client-1")).toMatchObject({ inserted: 3, failed: 0 });
    expect(row().calendar_id).not.toBe(firstCal);
    expect(events().length).toBe(3);
  });

  it("unticking the calendar box on Google's screen connects nothing", async () => {
    google.g.grantedScope = "openid https://www.googleapis.com/auth/userinfo.email";
    const { completeClientConnect } = await import("@/lib/client-gcal.server");
    await expect(
      completeClientConnect(admin as any, { code: "c3", origin: "https://jfeffect.com", clientId: "client-1", userId: "user-1" }),
    ).rejects.toMatchObject({ code: "calendar_permission" });
    expect(admin.tables.get("client_google_calendars")?.get("client-1")).toBeUndefined();
    expect(google.g.calendars.size).toBe(0);
  });

  it("access removed in Google marks the connection for reconnecting, without errors", async () => {
    const { completeClientConnect, syncClientCalendar, clientGoogleStatus } = await import("@/lib/client-gcal.server");
    await completeClientConnect(admin as any, { code: "c4", origin: "https://jfeffect.com", clientId: "client-1", userId: "user-1" });
    google.g.revokedRefresh.add("rt-c4");
    row().token_expires_at = new Date(Date.now() - 1000).toISOString();
    feed = [sessionAt("z", 3)];
    expect(await syncClientCalendar(admin as any, "client-1")).toEqual({ skipped: "revoked" });
    expect(await clientGoogleStatus(admin as any, "client-1")).toMatchObject({ connected: false, revoked: true });
  });

  it("the 5-minute job checks connected clients and skips revoked ones", async () => {
    const { completeClientConnect, syncDueClientCalendars } = await import("@/lib/client-gcal.server");
    await completeClientConnect(admin as any, { code: "c5", origin: "https://jfeffect.com", clientId: "client-1", userId: "user-1" });
    feed = [sessionAt("q", 2)];
    expect(await syncDueClientCalendars(admin as any)).toMatchObject({ connected: 1, checked: 1, changed: 1, failed: 0 });
    expect(events().map((e) => e.body.summary)).toEqual(["1:1 Training"]);
  });

  it("disconnect removes the calendar from Google and forgets the sign-in", async () => {
    const { completeClientConnect, disconnectClientCalendar } = await import("@/lib/client-gcal.server");
    await completeClientConnect(admin as any, { code: "c6", origin: "https://jfeffect.com", clientId: "client-1", userId: "user-1" });
    const cal = row().calendar_id;
    expect(await disconnectClientCalendar(admin as any, "client-1")).toEqual({ removedCalendar: true });
    expect(google.g.calendars.has(cal)).toBe(false);
    expect(admin.tables.get("client_google_calendars")!.get("client-1")).toBeUndefined();
    expect(google.g.calls).toContain("POST /revoke");
  });

  it("checks the Google keys before offering sign-in, alerts the admin once, and clears when fixed", async () => {
    const { clientGoogleReady, clientGoogleStatus } = await import("@/lib/client-gcal.server");
    // Keys left over from an old setup: Google doesn't know the client.
    process.env.GOOGLE_OAUTH_CLIENT_ID = "999-old.apps.googleusercontent.com";
    expect(await clientGoogleReady(admin as any)).toBe(false);
    expect((await clientGoogleStatus(admin as any, "client-1")).available).toBe(false);
    const alerts = () => Array.from(admin.tables.get("support_alerts")?.values() ?? []);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({ error_type: "google_calendar_setup", status: "open" });
    expect(alerts()[0].error_message).toMatch(/doesn't recognise the client ID/);
    expect(JSON.parse(admin.tables.get("app_settings")!.get("client_google_calendar_check").value)).toMatchObject({
      ok: false,
      problem: "invalid_client",
      redirectUri: "https://jfeffect.com/api/public/google/oauth/callback",
    });

    // Asking again soon doesn't call Google again or add another alert.
    const calls = google.g.calls.length;
    expect(await clientGoogleReady(admin as any)).toBe(false);
    expect(google.g.calls.length).toBe(calls);
    expect(alerts()).toHaveLength(1);

    // Fixed in Lovable (with a stray space pasted in): rechecked straight away, alert resolved.
    process.env.GOOGLE_OAUTH_CLIENT_ID = " 123-abc.apps.googleusercontent.com\n";
    expect(await clientGoogleReady(admin as any)).toBe(true);
    expect(alerts()[0].status).toBe("resolved");
  });

  it("tells a wrong secret and a missing redirect URI apart", async () => {
    const { runGoogleSetupCheck } = await import("@/lib/client-gcal.server");
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "wrong";
    expect(await runGoogleSetupCheck(admin as any)).toMatchObject({ ok: false, problem: "bad_secret" });
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    google.g.redirectUris = ["https://example.com/cb"];
    expect(await runGoogleSetupCheck(admin as any)).toMatchObject({ ok: false, problem: "redirect_uri_mismatch" });
    google.g.redirectUris = ["https://jfeffect.com/api/public/google/oauth/callback"];
    expect(await runGoogleSetupCheck(admin as any)).toMatchObject({ ok: true, problem: null });
  });

  it("the 5-minute job does nothing while the keys are broken", async () => {
    const { syncDueClientCalendars } = await import("@/lib/client-gcal.server");
    process.env.GOOGLE_OAUTH_CLIENT_ID = "not-a-client-id";
    expect(await syncDueClientCalendars(admin as any)).toEqual({ skipped: "setup_problem", problem: "client_id_format" });
  });
});
