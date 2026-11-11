import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const pushes: Array<{ event: string; clientId: string }> = [];
vi.mock("@/lib/push/app-events.server", () => ({
  notifyAppEvent: vi.fn(async (_db: unknown, event: string, input: { clientId: string }) => {
    pushes.push({ event, clientId: input.clientId });
    return { sent: 1 };
  }),
}));

import {
  BOOKED_QUIET_MS,
  SELF_OR_IMPORTED_VIA,
  bookedCard,
  bookedDay,
  bookedMessageBody,
  bookedPlace,
  bookedTimes,
  bookedToast,
  quietWaitMs,
  shouldAnnounceBooking,
  type BookedSessionRow,
} from "@/lib/session-booked";
import { announceBookedSessions } from "@/lib/session-booked.server";

const read = (f: string) => readFileSync(f, "utf8");

// Nov 10 2026, 9:39 PM in Winnipeg: the coach booked Devin for 4 PM the next
// day and Devin got nothing from the app; five minutes later Book ahead wrote
// Marc's next 9 sessions, one insert every ~90 ms.
const BOOKED_AT = "2026-11-11T02:39:44.389Z";
const devin: BookedSessionRow = {
  id: "s-devin", client_id: "devin", title: "1:1 Meeting", session_type: "Consultation",
  session_date: "2026-11-11", start_time: "16:00:00", end_time: "16:30:00", starts_at: "2026-11-11T21:00:00Z",
  created_at: BOOKED_AT, status: "Scheduled", location: "Phone / Video", wants_meet: true, booked_via: null,
  visible_to_client: true, send_confirmation_email: true, confirmation_sent_at: null,
};
const MARC_DAYS: Array<[string, string]> = [
  ["2026-11-16", "10:30"], ["2026-11-18", "17:30"], ["2026-11-19", "17:30"], ["2026-11-20", "17:30"],
  ["2026-11-23", "10:30"], ["2026-11-25", "17:30"], ["2026-11-26", "17:30"], ["2026-11-27", "17:30"], ["2026-11-30", "10:30"],
];
const marc = (startMs: number): BookedSessionRow[] =>
  MARC_DAYS.map(([date, time], i) => ({
    id: `s-marc-${i}`, client_id: "marc", title: "1:1 Training", session_type: "Personal Training",
    session_date: date, start_time: `${time}:00`, end_time: `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}:00`,
    starts_at: `${date}T${String(Number(time.slice(0, 2)) + 5).padStart(2, "0")}${time.slice(2)}:00Z`,
    created_at: new Date(startMs + i * 90).toISOString(), status: "Scheduled",
    location: "800 Vaughan Ave Unit 404, Selkirk, MB", booked_via: null,
    visible_to_client: true, send_confirmation_email: true, confirmation_sent_at: null,
  }));

describe("who hears about a booking", () => {
  const now = new Date("2026-11-11T02:40:00Z");

  it("a session the coach booked for them, still ahead", () => {
    expect(shouldAnnounceBooking(devin, now)).toBe(true);
  });

  it("never one they booked themselves, the coach's Google brought in, already told, hidden, off, done or past", () => {
    for (const via of SELF_OR_IMPORTED_VIA) expect(shouldAnnounceBooking({ ...devin, booked_via: via }, now)).toBe(false);
    expect(shouldAnnounceBooking({ ...devin, confirmation_sent_at: BOOKED_AT }, now)).toBe(false);
    expect(shouldAnnounceBooking({ ...devin, visible_to_client: false }, now)).toBe(false);
    expect(shouldAnnounceBooking({ ...devin, send_confirmation_email: false }, now)).toBe(false);
    expect(shouldAnnounceBooking({ ...devin, status: "Cancelled" }, now)).toBe(false);
    expect(shouldAnnounceBooking(devin, new Date("2026-11-11T21:00:00Z"))).toBe(false);
    // booked 3 days ago and never announced: history, not news
    expect(shouldAnnounceBooking({ ...devin, created_at: "2026-11-08T02:00:00Z" }, now)).toBe(false);
  });

  it("waits for a booking spree to finish, but never forever", () => {
    const t = Date.parse(BOOKED_AT);
    expect(quietWaitMs([BOOKED_AT], new Date(t + 1000), 0)).toBe(BOOKED_QUIET_MS - 1000);
    expect(quietWaitMs([BOOKED_AT], new Date(t + BOOKED_QUIET_MS), 0)).toBe(0);
    expect(quietWaitMs([BOOKED_AT], new Date(t), 19_000)).toBe(1000);
    expect(quietWaitMs([], new Date(t), 0)).toBe(0);
  });
});

describe("what the client reads", () => {
  it("one session: what, when, where", () => {
    expect(bookedMessageBody([devin])).toBe(
      "✅ Booked: 1:1 Meeting · Wed, Nov 11 · 4:00–4:30 PM · Video call. It's in your calendar.",
    );
  });

  it("a spree is one message, earliest first, the rest counted", () => {
    expect(bookedMessageBody(marc(0).reverse())).toBe(
      "✅ Booked 9 sessions (1:1 Training): Mon, Nov 16 · 10:30 AM, Wed, Nov 18 · 5:30 PM, Thu, Nov 19 · 5:30 PM, Fri, Nov 20 · 5:30 PM and 5 more. They're in your calendar.",
    );
    expect(bookedMessageBody(marc(0).slice(0, 2))).toBe(
      "✅ Booked 2 sessions (1:1 Training): Mon, Nov 16 · 10:30 AM and Wed, Nov 18 · 5:30 PM. They're in your calendar.",
    );
  });

  it("days, times and places read plainly", () => {
    expect(bookedDay("2026-11-30")).toBe("Mon, Nov 30");
    expect(bookedTimes("11:30:00", "12:30:00")).toBe("11:30 AM–12:30 PM");
    expect(bookedTimes("16:00", null)).toBe("4:00 PM");
    expect(bookedPlace({ location: "800 Vaughan Ave Unit 404, Selkirk, MB" })).toBe("800 Vaughan Ave Unit 404");
    expect(bookedPlace({ location: "Phone call" })).toBe("Phone call");
    expect(bookedPlace({ location: "", wants_meet: true })).toBe("Video call");
  });

  it("the card lists the sessions earliest first", () => {
    const card = bookedCard(marc(0).reverse());
    expect(card.kind).toBe("session_booked");
    expect(card.session_ids[0]).toBe("s-marc-0");
    expect(card.session_ids).toHaveLength(9);
  });

  it("the coach's toast says the client is told only when they are", () => {
    expect(bookedToast(1, "Devin", true)).toBe("Session booked · Devin gets a message in their chat");
    expect(bookedToast(9, "Marc", true)).toBe("Booked 9 sessions · Marc gets a message in their chat");
    expect(bookedToast(1, "Devin", false)).toBe("Session booked");
  });
});

/** Just enough of the Supabase query builder for the sender. */
function fakeDb(sessions: BookedSessionRow[], clients: Record<string, { user_id: string | null; assigned_coach_id: string | null }>) {
  const messages: any[] = [];
  const from = (table: string) => {
    const q: { op: string; payload: any; filters: Array<[string, string, any]> } = { op: "select", payload: null, filters: [] };
    const match = (r: any) =>
      q.filters.every(([k, c, v]) =>
        k === "is" ? (r[c] ?? null) === v
        : k === "eq" ? r[c] === v
        : k === "gt" ? String(r[c]) > String(v)
        : k === "in" ? (v as unknown[]).includes(r[c])
        : true);
    const run = () => {
      if (table === "pt_sessions" && q.op === "select") return { data: sessions.filter(match).map((s) => ({ ...s })), error: null };
      if (table === "pt_sessions" && q.op === "update") {
        const hit = sessions.filter(match);
        hit.forEach((s) => Object.assign(s, q.payload));
        return { data: hit.map((s) => ({ ...s })), error: null };
      }
      if (table === "clients") {
        const id = q.filters.find(([, c]) => c === "id")?.[2];
        return { data: clients[id] ? { id, ...clients[id] } : null, error: null };
      }
      if (table === "coaches") return { data: { user_id: "coach-jared" }, error: null };
      if (table === "user_roles") return { data: { user_id: "admin" }, error: null };
      if (table === "messages") {
        const row = { id: `m${messages.length + 1}`, ...q.payload };
        messages.push(row);
        return { data: { id: row.id }, error: null };
      }
      return { data: null, error: null };
    };
    const b: any = {
      select: () => b,
      update: (p: any) => ((q.op = "update"), (q.payload = p), b),
      insert: (p: any) => ((q.op = "insert"), (q.payload = p), b),
      is: (c: string, v: any) => (q.filters.push(["is", c, v]), b),
      eq: (c: string, v: any) => (q.filters.push(["eq", c, v]), b),
      gt: (c: string, v: any) => (q.filters.push(["gt", c, v]), b),
      in: (c: string, v: any) => (q.filters.push(["in", c, v]), b),
      order: () => b,
      limit: () => b,
      maybeSingle: () => b,
      single: () => b,
      then: (res: (v: unknown) => void) => res(run()),
    };
    return b;
  };
  return { db: { from }, messages };
}

describe("sending", () => {
  it("one message per client once the spree is over, each session claimed once, a push each", async () => {
    pushes.length = 0;
    const t = Date.parse(BOOKED_AT);
    const marcRows = marc(t + 270_000);
    const self = { ...devin, id: "s-self", client_id: "self", booked_via: "client_app" };
    const nologin = { ...devin, id: "s-nologin", client_id: "nologin", created_at: BOOKED_AT };
    const rows = [devin, ...marcRows, self, nologin];
    const { db, messages } = fakeDb(rows, {
      devin: { user_id: "u-devin", assigned_coach_id: "c1" },
      marc: { user_id: "u-marc", assigned_coach_id: "c1" },
      nologin: { user_id: null, assigned_coach_id: "c1" },
    });

    // The hook is called 1 s after Marc's first insert, mid-spree.
    let clock = t + 271_000;
    const waits: number[] = [];
    const res = await announceBookedSessions(db, {
      now: () => new Date(clock),
      wait: async (ms) => { waits.push(ms); clock += ms; },
    });

    expect(waits.length).toBeGreaterThan(0);
    expect(res.messages).toBe(2);
    expect(res.announced).toBe(10);
    expect(res.skipped).toEqual([{ clientId: "nologin", reason: "no_login" }]);
    const marcMsg = messages.find((m) => m.client_id === "marc");
    expect(marcMsg.body).toMatch(/^✅ Booked 9 sessions/);
    expect(marcMsg.attachments[0].session_ids).toHaveLength(9);
    expect(marcMsg).toMatchObject({ sender_id: "coach-jared", sender_role: "admin", message_type: "Scheduling", is_automated: true });
    expect(messages.find((m) => m.client_id === "devin").body).toContain("1:1 Meeting · Wed, Nov 11 · 4:00–4:30 PM");
    expect(pushes).toEqual([
      { event: "session_booked", clientId: "devin" },
      { event: "session_booked", clientId: "marc" },
    ]);
    expect(self.confirmation_sent_at).toBeNull();
    expect(nologin.confirmation_sent_at).not.toBeNull();

    // Run again (pg_cron, or the next booking's kick): nothing is told twice.
    const again = await announceBookedSessions(db, { now: () => new Date(clock), wait: async () => {} });
    expect(again.messages).toBe(0);
    expect(messages).toHaveLength(2);
  });
});

describe("every booking path", () => {
  const sql = read("supabase/migrations/20270227090000_session_booked_message.sql");

  it("the database wakes the sender on any insert, the first of a spree, and pg_cron backs it up", () => {
    expect(sql).toContain("referencing new table as new_rows");
    expect(sql).toContain("for each statement execute function public.pt_sessions_booked_kick()");
    expect(sql).toContain("/api/public/hooks/session-bookings-tick");
    expect(sql).toContain("'session-bookings-tick',\n    '* * * * *'");
    // the same "booked it themselves / Google" list as shouldAnnounceBooking
    const list = `('${SELF_OR_IMPORTED_VIA.join("', '")}')`;
    expect(sql.split(list).length - 1).toBe(3);
    // what was booked before is never announced late
    expect(sql).toContain("set confirmation_sent_at = created_at");
  });

  it("an approved request's own message is its confirmation, and Book ahead tells them in one message", () => {
    expect(read("src/lib/session-requests.functions.ts")).toContain("insert({ ...insert, confirmation_sent_at: new Date().toISOString() })");
    expect(read("src/lib/session-prebook.server.ts")).toContain("send_confirmation_email: true");
  });

  it("the chat draws the card, both sides", () => {
    const thread = read("src/components/message-thread.tsx");
    expect(thread).toContain('att.kind === "session_booked" && att.session_ids?.length');
    expect(thread).toContain('a?.kind === "session_booked"');
    expect(read("src/routeTree.gen.ts")).toContain("/api/public/hooks/session-bookings-tick");
  });
});
