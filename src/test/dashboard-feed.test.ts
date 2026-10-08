import { describe, expect, it } from "vitest";
import { buildNeedsYou, buildSnapshot, waitingOnMe, type FeedClient, type InboxRow } from "@/lib/dashboard-feed";

const client = (id: string, extra: Partial<FeedClient> = {}): FeedClient => ({
  id, full_name: `Client ${id}`, profile_picture_url: null, account_status: "Account Created",
  f_payment_issue: false, f_program_ending: false, block_end: null, ...extra,
});
const inbox = (client_id: string, extra: Partial<InboxRow> = {}): InboxRow => ({
  client_id, archived: false, unread: false, workflow_status: "waiting_on_client",
  last_inbound_at: "2026-10-08T10:00:00Z", last_inbound_kind: "message", ...extra,
});
const empty = { lastClientMessage: new Map<string, string>(), openCheckins: [], openForms: [], liftVideos: [], painFlags: [] };

describe("dashboard Needs you feed", () => {
  it("only lists conversations actually waiting on staff (the old dashboard listed everyone who had messaged)", () => {
    const rows = [inbox("a", { workflow_status: "needs_response" }), inbox("b"), inbox("c", { unread: true }), inbox("d", { archived: true, unread: true })];
    expect(waitingOnMe(rows).map((r) => r.client_id)).toEqual(["a", "c"]);
    const feed = buildNeedsYou({ ...empty, clients: [client("a"), client("b"), client("c"), client("d")], inbox: rows });
    expect(feed.map((f) => f.clientId).sort()).toEqual(["a", "c"]);
  });

  it("shows the client's actual words instead of 'Unread message'", () => {
    const feed = buildNeedsYou({
      ...empty, clients: [client("a")], inbox: [inbox("a", { workflow_status: "needs_response" })],
      lastClientMessage: new Map([["a", "Hey coach   my knee felt off on squats today"]]),
    });
    expect(feed[0].reason).toBe("Hey coach my knee felt off on squats today");
    expect(feed[0].actionLabel).toBe("Reply");
  });

  it("a check-in that came in shows as a check-in and can be closed in one tap", () => {
    const feed = buildNeedsYou({
      ...empty, clients: [client("a")],
      inbox: [inbox("a", { workflow_status: "needs_response", last_inbound_kind: "checkin" })],
      openCheckins: [{ id: "ck1", client_id: "a", task_type: "weekly_checkin", submitted_at: "2026-10-08T09:00:00Z" }],
    });
    expect(feed[0].reason).toBe("Sent their weekly check-in");
    expect(feed[0].checkinId).toBe("ck1");
  });

  it("one row per client: most important first, the rest counted", () => {
    const feed = buildNeedsYou({
      ...empty,
      clients: [client("a", { f_payment_issue: true, f_program_ending: true, block_end: "2026-10-20" }), client("b")],
      inbox: [inbox("a", { workflow_status: "needs_response" }), inbox("b", { unread: true })],
      painFlags: [{ id: "p1", client_id: "b", keyword: "knee" }],
    });
    expect(feed.map((f) => [f.clientId, f.kind, f.more])).toEqual([["b", "pain", 1], ["a", "payment", 2]]);
  });

  it("ignores clients outside the active roster (archived / not mine)", () => {
    const feed = buildNeedsYou({ ...empty, clients: [client("a")], inbox: [inbox("zzz", { unread: true })] });
    expect(feed).toEqual([]);
  });

  it("flags programs ending with nothing queued and unfinished invites", () => {
    const feed = buildNeedsYou({
      ...empty, inbox: [],
      clients: [client("a", { f_program_ending: true, block_end: "2026-10-20" }), client("b", { account_status: "Invite Expired" })],
    });
    expect(feed.find((f) => f.clientId === "a")?.reason).toMatch(/^Program ends Oct 20/);
    expect(feed.find((f) => f.clientId === "b")?.urgent).toBe(true);
  });
});

describe("dashboard snapshot", () => {
  it("uses the Clients page counts and opens the matching filter", () => {
    const tiles = buildSnapshot({
      waitingReplies: 3,
      counts: { needs_review: 1, payment_issues: 0, no_payment: 6, payment_pending: 5, no_contract: 13, program_ending: 2, missed_workouts: 3 },
    });
    const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(by.replies.value).toBe(3);
    expect(by.payments.value).toBe(11);
    expect(by.payments.flag).toBe("no_payment");
    expect(by.payments.hint).toBe("6 not set up · 5 awaiting");
    expect(by.agreements).toMatchObject({ value: 13, flag: "no_contract", label: "Unsigned agreements" });
  });
});
