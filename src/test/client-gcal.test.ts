import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLIENT_GCAL_SCOPES,
  buildBatchBody,
  batchBoundaryOf,
  connectErrorMessage,
  desiredGoogleEvents,
  googleEventId,
  parseBatchResponse,
  planSync,
  safeReturnPath,
  syncSetHash,
  toGoogleEvent,
} from "@/lib/client-gcal";
import { calendarChoices } from "@/lib/calendar-sync";
import type { FeedEvent } from "@/lib/ics-feed";

const session: FeedEvent = {
  uid: "pt-11111111-2222-3333-4444-555555555555@jfeffect.com",
  start: new Date("2026-10-12T16:00:00Z"),
  end: new Date("2026-10-12T17:00:00Z"),
  summary: "1:1 Training",
  location: "Iron Image Gym",
  description: "Bring your belt",
  url: "https://jfeffect.com/portal/calendar",
};
const workout: FeedEvent = {
  uid: "workout-abc@jfeffect.com",
  start: new Date("2026-10-13T00:00:00Z"),
  end: new Date("2026-10-13T00:00:00Z"),
  allDayDate: "2026-10-13",
  summary: "Workout: Upper B",
  url: "https://jfeffect.com/portal/workouts/x",
};

describe("Google event ids", () => {
  it("are valid base32hex, the same every time, and different per item", () => {
    const id = googleEventId(session.uid);
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(googleEventId(session.uid)).toBe(id);
    expect(googleEventId(workout.uid)).not.toBe(id);
    expect(googleEventId("pt-1@jfeffect.com")).not.toBe(googleEventId("pt-2@jfeffect.com"));
  });
});

describe("feed items as Google events", () => {
  it("sessions are timed, busy, with one alert an hour before", () => {
    const g = toGoogleEvent(session);
    expect(g.start).toEqual({ dateTime: "2026-10-12T16:00:00.000Z" });
    expect(g.end).toEqual({ dateTime: "2026-10-12T17:00:00.000Z" });
    expect(g.transparency).toBe("opaque");
    expect(g.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 60 }] });
    expect(g.location).toBe("Iron Image Gym");
    expect(g.description).toContain("Bring your belt");
    expect(g.description).toContain("https://jfeffect.com/portal/calendar");
    expect(g.extendedProperties.private.jf).toBe("1");
  });

  it("workouts are all-day, free and silent", () => {
    const g = toGoogleEvent(workout);
    expect(g.start).toEqual({ date: "2026-10-13" });
    expect(g.end).toEqual({ date: "2026-10-14" });
    expect(g.transparency).toBe("transparent");
    expect(g.reminders.overrides).toEqual([]);
  });

  it("the change fingerprint moves only when the event does", () => {
    const a = toGoogleEvent(session).extendedProperties.private.jfHash;
    expect(toGoogleEvent({ ...session }).extendedProperties.private.jfHash).toBe(a);
    expect(toGoogleEvent({ ...session, start: new Date("2026-10-12T17:00:00Z"), end: new Date("2026-10-12T18:00:00Z") }).extendedProperties.private.jfHash).not.toBe(a);
  });

  it("drops cancelled and long-past items, one event per id", () => {
    const windowStart = new Date("2026-10-10T00:00:00Z");
    const old: FeedEvent = { ...session, uid: "pt-old@jfeffect.com", start: new Date("2026-10-01T16:00:00Z"), end: new Date("2026-10-01T17:00:00Z") };
    const cancelled: FeedEvent = { ...session, uid: "pt-x@jfeffect.com", cancelled: true };
    const got = desiredGoogleEvents([session, session, workout, old, cancelled], windowStart);
    expect(got.map((g) => g.summary).sort()).toEqual(["1:1 Training", "Workout: Upper B"]);
  });

  it("set fingerprint changes with the calendar, so a recreated calendar gets refilled", () => {
    const d = desiredGoogleEvents([session], new Date("2026-10-10T00:00:00Z"));
    expect(syncSetHash(d, "a")).toBe(syncSetHash(d, "a"));
    expect(syncSetHash(d, "a")).not.toBe(syncSetHash(d, "b"));
  });
});

describe("sync plan", () => {
  const desired = desiredGoogleEvents([session, workout], new Date("2026-10-10T00:00:00Z"));
  const [first, second] = desired;

  it("inserts what's missing, updates what changed or was deleted, removes what's gone", () => {
    const plan = planSync(desired, [
      { id: first.id, status: "confirmed", jf: true, hash: "stale" },
      { id: googleEventId("pt-removed@jfeffect.com"), status: "confirmed", jf: true, hash: "x" },
    ]);
    expect(plan.update.map((e) => e.id)).toEqual([first.id]);
    expect(plan.insert.map((e) => e.id)).toEqual([second.id]);
    expect(plan.remove).toEqual([googleEventId("pt-removed@jfeffect.com")]);

    const revived = planSync([first], [{ id: first.id, status: "cancelled", jf: true, hash: first.extendedProperties.private.jfHash }]);
    expect(revived.update.map((e) => e.id)).toEqual([first.id]);
  });

  it("does nothing when Google already matches", () => {
    const plan = planSync(desired, desired.map((d) => ({ id: d.id, status: "confirmed", jf: true, hash: d.extendedProperties.private.jfHash })));
    expect(plan).toEqual({ insert: [], update: [], remove: [] });
  });

  it("keeps events that already happened when they drop out of the feed", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    const plan = planSync(
      [],
      [
        { id: "jfpast", status: "confirmed", jf: true, hash: "x", endsAt: Date.parse("2026-10-11T17:00:00Z") },
        { id: "jffuture", status: "confirmed", jf: true, hash: "x", endsAt: Date.parse("2026-10-13T17:00:00Z") },
      ],
      now,
    );
    expect(plan.remove).toEqual(["jffuture"]);
  });

  it("never deletes something the client added to the calendar by hand", () => {
    const plan = planSync([], [{ id: "theirown123", status: "confirmed", jf: false, hash: null }]);
    expect(plan.remove).toEqual([]);
  });
});

describe("Google batch requests", () => {
  it("builds one multipart body and reads the replies back by id", () => {
    const body = buildBatchBody(
      [
        { key: "op-0", method: "POST", path: "/calendar/v3/calendars/c%40group/events", body: { id: "jfabc", summary: "A" } },
        { key: "op-1", method: "DELETE", path: "/calendar/v3/calendars/c%40group/events/jfdef" },
      ],
      "b1",
    );
    expect(body).toContain("--b1\r\nContent-Type: application/http\r\nContent-ID: <op-0>");
    expect(body).toContain("POST /calendar/v3/calendars/c%40group/events HTTP/1.1");
    expect(body).toContain('{"id":"jfabc","summary":"A"}');
    expect(body.endsWith("--b1--\r\n")).toBe(true);

    const reply = [
      "--batch_x",
      "Content-Type: application/http",
      "Content-ID: <response-op-0>",
      "",
      "HTTP/1.1 409 Conflict",
      "Content-Type: application/json; charset=UTF-8",
      "",
      '{"error":{"code":409,"message":"The requested identifier already exists."}}',
      "--batch_x",
      "Content-Type: application/http",
      "Content-ID: <response-op-1>",
      "",
      "HTTP/1.1 204 No Content",
      "",
      "",
      "--batch_x--",
    ].join("\r\n");
    expect(batchBoundaryOf("multipart/mixed; boundary=batch_x")).toBe("batch_x");
    const parsed = parseBatchResponse(reply, "batch_x");
    expect(parsed).toEqual([
      { key: "op-0", status: 409, body: { error: { code: 409, message: "The requested identifier already exists." } } },
      { key: "op-1", status: 204, body: null },
    ]);
  });
});

describe("sign-in safety and wording", () => {
  it("asks Google only for the calendar the app creates", () => {
    expect(CLIENT_GCAL_SCOPES).toContain("https://www.googleapis.com/auth/calendar.app.created");
    expect(CLIENT_GCAL_SCOPES.some((s) => /auth\/calendar(\.events)?$/.test(s))).toBe(false);
  });

  it("only ever sends people back inside the app", () => {
    expect(safeReturnPath("/admin/finance?tab=home")).toBe("/admin/finance?tab=home");
    expect(safeReturnPath("https://evil.example")).toBe("/portal/calendar");
    expect(safeReturnPath("//evil.example")).toBe("/portal/calendar");
    expect(safeReturnPath("/\\evil.example")).toBe("/portal/calendar");
    expect(safeReturnPath("/\t/evil.example")).toBe("/portal/calendar");
    expect(safeReturnPath("/\n/evil.example")).toBe("/portal/calendar");
    expect(safeReturnPath("/portal/calendar?view=week#today")).toBe("/portal/calendar?view=week#today");
    expect(safeReturnPath(undefined)).toBe("/portal/calendar");
  });

  it("explains a cancelled sign-in or an unticked calendar box in plain words", () => {
    expect(connectErrorMessage("access_denied")).toMatch(/cancelled/);
    expect(connectErrorMessage("calendar_permission")).toMatch(/calendar box/);
  });
});

describe("Google is one tap once the sign-in app is set up", () => {
  it("on every device", () => {
    for (const p of ["ios", "android", "mac", "windows", "other"] as const) {
      const g = calendarChoices(p, { googleConnect: true }).find((c) => c.id === "google");
      expect(g?.how).toBe("connect");
    }
    expect(calendarChoices("ios").find((c) => c.id === "google")?.how).toBe("web");
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("tokens table is server-only and has its own 5-minute job with a long wait", () => {
    const sql = read("supabase/migrations/20261031120000_client_google_calendars.sql");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("client-google-calendars-tick");
    expect(sql).toContain("/api/public/hooks/client-calendars-tick");
    expect(sql).toContain("timeout_milliseconds := 60000");
  });

  it("the one Google callback serves both the client and the coach flow", () => {
    const cb = read("src/routes/api/public/google/oauth/callback.ts");
    expect(cb).toContain('decoded?.kind === "client_cal"');
    expect(cb).toContain("completeClientConnect");
    expect(cb).toContain("google_calendar_connections");
  });

  it("the hook checks the cron secret and the sheet offers connect and disconnect", () => {
    expect(read("src/routes/api/public/hooks/client-calendars-tick.ts")).toContain("authorizeHookRequest");
    const card = read("src/components/schedule/calendar-sync-card.tsx");
    expect(card).toContain("startGoogleCalendarConnect");
    expect(card).toContain("Disconnect Google Calendar");
  });

  it("starting the sign-in needs no extra secret beyond Google's id and secret", async () => {
    const prev = { s: process.env.GOOGLE_OAUTH_STATE_SECRET, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.GOOGLE_OAUTH_STATE_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x".repeat(40);
    try {
      const { signOAuthState, verifyOAuthState } = await import("@/lib/google-cal.server");
      const state = signOAuthState({ kind: "client_cal", client_id: "c1", user_id: "u1" });
      expect(verifyOAuthState(state)).toMatchObject({ kind: "client_cal", client_id: "c1", user_id: "u1" });
      expect(verifyOAuthState(`${state.split(".")[0]}.forged`)).toBeNull();
    } finally {
      if (prev.s === undefined) delete process.env.GOOGLE_OAUTH_STATE_SECRET;
      else process.env.GOOGLE_OAUTH_STATE_SECRET = prev.s;
      if (prev.k === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prev.k;
    }
  });
});

describe("reading Google's answers about the sign-in setup", () => {
  it("decodes the reason from Google's error page address", async () => {
    const { authErrorCode } = await import("@/lib/client-gcal");
    // Real addresses Google returned for an unknown client and a wrong redirect URI.
    expect(
      authErrorCode("https://accounts.google.com/signin/oauth/error?authError=Cg5pbnZhbGlkX2NsaWVudBIfVGhlIE9BdXRoIGNsaWVudCB3YXMgbm90IGZvdW5kLiCRAw&flowName=GeneralOAuthFlow"),
    ).toBe("invalid_client");
    expect(
      authErrorCode(
        "https://accounts.google.com/signin/oauth/error?authError=ChVyZWRpcmVjdF91cmlfbWlzbWF0Y2gSsAEKWW91IGNhbid0IHNpZ24gaW4gdG8gdGhpcyBhcHAgYmVjYXVzZSBpdCBkb2Vzbid0IGNvbXBseSB3aXRoIEdvb2dsZSdzIE9BdXRoIDIuMCBwb2xpY3kuCgpJZiB5b3U&flowName=GeneralOAuthFlow",
      ),
    ).toBe("redirect_uri_mismatch");
    expect(authErrorCode("https://accounts.google.com/v3/signin/identifier?client_id=x")).toBeNull();
    expect(authErrorCode(null)).toBeNull();
  });

  it("knows a Google client ID when it sees one, and always uses the real site for the redirect", async () => {
    const { looksLikeGoogleClientId, canonicalOrigin, setupProblemMessage } = await import("@/lib/client-gcal");
    expect(looksLikeGoogleClientId("1234567890-abc123def.apps.googleusercontent.com")).toBe(true);
    expect(looksLikeGoogleClientId("GOCSPX-secretlooking")).toBe(false);
    expect(canonicalOrigin(undefined)).toBe("https://jfeffect.com");
    expect(canonicalOrigin("https://jfeffect-command-center.lovable.app")).toBe("https://jfeffect.com");
    expect(canonicalOrigin("https://jfeffect.com/")).toBe("https://jfeffect.com");
    expect(setupProblemMessage({ problem: "redirect_uri_mismatch", redirectUri: "https://jfeffect.com/api/public/google/oauth/callback" })).toContain(
      "https://jfeffect.com/api/public/google/oauth/callback",
    );
  });
});
