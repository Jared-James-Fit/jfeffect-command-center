import { describe, expect, it } from "vitest";
import { classifyOutbound, waitingState } from "@/lib/inbox-waiting";
import { deriveRequests, latestToReview, requestChip } from "@/lib/inbox-requests";

const H = 3_600_000;
const now = Date.parse("2026-10-06T12:00:00Z");
const ago = (h: number) => new Date(now - h * H).toISOString();

describe("classifyOutbound", () => {
  it("treats closers and acknowledgements as needing no reply", () => {
    for (const body of ["Perf thanks!", "Perf 👍", "Great work staying locked in on your nutrition and training this week.", "Sounds good"]) {
      expect(classifyOutbound({ body, attachments: [] }), body).toBe("fyi");
    }
  });
  it("expects a reply to questions, asks and requests", () => {
    for (const body of ["How did squats feel?", "Let me know if that works", "Please send your weight", "Can you film the next set"]) {
      expect(classifyOutbound({ body, attachments: [] }), body).toBe("expects_reply");
    }
    expect(classifyOutbound({ body: "", attachments: [{ kind: "checkin_request" }] })).toBe("expects_reply");
    expect(classifyOutbound({ body: "Fill this in", attachments: [{ kind: "form_request" }] })).toBe("expects_reply");
    expect(classifyOutbound({ body: "", attachments: [{ kind: "signature_request" }] })).toBe("expects_reply");
  });
});

describe("waitingState", () => {
  const q = (h: number) => ({ body: "How was it?", attachments: [], created_at: ago(h) });
  it("is waiting when recent and overdue after 48h", () => {
    expect(waitingState({ last: q(5), now })).toBe("waiting");
    expect(waitingState({ last: q(47), now })).toBe("waiting");
    expect(waitingState({ last: q(48), now })).toBe("overdue");
    expect(waitingState({ last: q(120), now })).toBe("overdue");
  });
  it("stays quiet for a closer however old it is", () => {
    expect(waitingState({ last: { body: "Perf thanks!", attachments: [], created_at: ago(300) }, now })).toBe("fyi");
  });
  it("an unfilled request means waiting even if my last text asked nothing, aged from the request", () => {
    const last = { body: "Thanks!", attachments: [], created_at: ago(2) };
    expect(waitingState({ last, hasPendingRequest: true, oldestPendingSince: ago(60), now })).toBe("overdue");
    expect(waitingState({ last, hasPendingRequest: true, oldestPendingSince: ago(10), now })).toBe("waiting");
  });
});

describe("deriveRequests / requestChip", () => {
  it("flags the newest unanswered check-in per type, and ignores superseded or completed ones", () => {
    const r = deriveRequests({
      checkins: [
        { client_id: "a", task_type: "weekly_checkin", status: "pending", created_at: ago(200) }, // superseded
        { client_id: "a", task_type: "weekly_checkin", status: "completed", created_at: ago(30) },
        { client_id: "b", task_type: "weekly_checkin", status: "pending", created_at: ago(5) },
      ],
      submissions: [], messages: [], toReview: [],
    });
    expect(r.get("a")?.pending ?? []).toEqual([]);
    expect(r.get("b")!.pending).toHaveLength(1);
    expect(requestChip(r.get("b"), now)).toEqual({ tone: "pending", text: "Weekly check-in not filled" });
  });

  it("turns amber once a request has sat 48h+", () => {
    const r = deriveRequests({
      checkins: [{ client_id: "b", task_type: "nutrition_review", status: "pending", created_at: ago(49) }],
      submissions: [], messages: [], toReview: [],
    });
    expect(requestChip(r.get("b"), now)).toEqual({ tone: "overdue", text: "Nutrition review not filled" });
  });

  it("form sent in chat is not filled until a submission lands after it", () => {
    const msg = { client_id: "c", created_at: ago(20), attachments: [{ kind: "form_request", form_id: "f1", request_title: "Intake" }] };
    const unfilled = deriveRequests({ checkins: [], messages: [msg], toReview: [], submissions: [{ client_id: "c", form_id: "f1", submitted_at: ago(100) }] });
    expect(unfilled.get("c")!.pending[0]).toMatchObject({ kind: "form", title: "Intake" });
    const filled = deriveRequests({ checkins: [], messages: [msg], toReview: [], submissions: [{ client_id: "c", form_id: "f1", submitted_at: ago(3) }] });
    expect(filled.get("c")?.pending ?? []).toEqual([]);
  });

  it("collapses several outstanding requests, and shows 'Filled · review' only when nothing is outstanding", () => {
    const many = deriveRequests({
      checkins: [{ client_id: "d", task_type: "weekly_checkin", status: "pending", created_at: ago(2) }],
      messages: [{ client_id: "d", created_at: ago(2), attachments: [{ kind: "form_request", form_id: "f2", request_title: "Goals" }] }],
      submissions: [], toReview: [{ client_id: "d", kind: "form", submitted_at: ago(1) }],
    });
    expect(requestChip(many.get("d"), now)?.text).toBe("2 requests not filled");
    const review = deriveRequests({ checkins: [], messages: [], submissions: [], toReview: [{ client_id: "e", kind: "checkin", submitted_at: ago(1) }] });
    expect(requestChip(review.get("e"), now)).toEqual({ tone: "filled", text: "Filled · review" });
    expect(requestChip(undefined, now)).toBeNull();
  });
});

describe("missed requests", () => {
  const sup = (client: string, h: number) => ({ client_id: client, task_type: "weekly_checkin", status: "superseded", created_at: ago(h) });
  it("counts recent unanswered-and-replaced requests, ignores ones older than 28 days", () => {
    const r = deriveRequests({
      checkins: [sup("a", 24 * 7), sup("a", 24 * 14), sup("a", 24 * 40), { client_id: "a", task_type: "weekly_checkin", status: "completed", created_at: ago(2) }],
      submissions: [], messages: [], toReview: [], now,
    });
    expect(r.get("a")!.missed).toBe(2);
    expect(requestChip(r.get("a"), now)).toEqual({ tone: "pending", text: "2 missed" });
  });
  it("appends missed to the not-filled chip", () => {
    const r = deriveRequests({
      checkins: [sup("b", 24 * 8), { client_id: "b", task_type: "weekly_checkin", status: "pending", created_at: ago(5) }],
      submissions: [], messages: [], toReview: [], now,
    });
    expect(requestChip(r.get("b"), now)).toEqual({ tone: "pending", text: "Weekly check-in not filled · 1 missed" });
  });
});

describe("latestToReview", () => {
  const row = (client: string, h: number, type = "weekly_checkin", kind: "checkin" | "form" = "checkin") =>
    ({ client_id: client, kind, type, submitted_at: ago(h) });
  it("counts only the latest filled check-in per type, not the whole history", () => {
    const rows = [row("a", 24 * 2), row("a", 24 * 9), row("a", 24 * 12)];
    expect(latestToReview(rows, new Map(), now)).toHaveLength(1);
  });
  it("a check-in stops needing review once I reply after it, or after 14 days", () => {
    expect(latestToReview([row("a", 30)], new Map([["a", ago(10)]]), now)).toHaveLength(0);
    expect(latestToReview([row("a", 30)], new Map([["a", ago(40)]]), now)).toHaveLength(1);
    expect(latestToReview([row("a", 24 * 15)], new Map(), now)).toHaveLength(0);
  });
  it("forms rely on reviewed_at (filtered upstream): latest per form, no reply rule", () => {
    const rows = [row("a", 5, "f1", "form"), row("a", 50, "f1", "form"), row("a", 6, "f2", "form")];
    expect(latestToReview(rows, new Map([["a", ago(1)]]), now)).toHaveLength(2);
  });
});

import { readFileSync } from "node:fs";
describe("inbox wiring", () => {
  const route = readFileSync("src/route-pages/_authenticated/admin/messages.tsx", "utf8");
  it("splits Waiting on Client into waiting / follow up, and keeps closers out of it", () => {
    expect(route).toContain('"Follow Up"');
    expect(route).toContain('it.workflow.state === "waiting_on_client" && it.waiting !== "fyi"');
    expect(route).toContain("<WaitingPill state={waiting} />");
    expect(route).toContain('"Not read yet"');
  });
  it("shows a forms / check-ins status chip and counts it in Forms & Check-ins", () => {
    expect(route).toContain("<RequestStatusChip chip={chip} />");
    expect(route).toContain("it.workflow.isFormOrCheckin || it.hasRequests");
    expect(route).toContain('queryKey: ["message-form-checkin-inbox", "status"]');
  });
  it("pins chats waiting on me to the top of the Inbox and lets me clear waiting chats with a swipe", () => {
    expect(route).toContain('a.workflow.state === "needs_response" ? 0 : 1');
    expect(route).toContain('workflow.state === "needs_response" || workflow.state === "waiting_on_client"');
  });
});
