import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  RETIRED_NUTRITION_REVIEW_FORM_ID,
  ageLabel,
  classifyKind,
  countByKind,
  filterRequests,
  pickUnfilledFormRequests,
  requestStatus,
  type OutstandingRequest,
} from "@/lib/form-requests";
import { NUTRITION_REQUEST_FORM_ID } from "@/lib/nutrition-ai-prompts";

const H = 3_600_000;
const now = Date.parse("2026-10-06T12:00:00Z");
const ago = (h: number) => new Date(now - h * H).toISOString();

const row = (over: Partial<OutstandingRequest>): OutstandingRequest => ({
  key: "k", source: "checkin", kind: "weekly_checkin", title: "Weekly Check-In", clientId: "c1", clientName: "Alex Smith",
  messageId: "m1", requestId: "r1", formId: null, formKind: null, externalUrl: null, sentAt: ago(5), readAt: null, ...over,
});

describe("request status + labels", () => {
  it("is overdue from 48h, waiting before", () => {
    expect(requestStatus({ sentAt: ago(47) }, now)).toBe("waiting");
    expect(requestStatus({ sentAt: ago(48) }, now)).toBe("overdue");
  });
  it("formats age", () => {
    expect(ageLabel(ago(0.25), now)).toBe("15m");
    expect(ageLabel(ago(5), now)).toBe("5h");
    expect(ageLabel(ago(24 * 6), now)).toBe("6d");
  });
  it("classifies kinds", () => {
    expect(classifyKind("checkin", null)).toBe("weekly_checkin");
    expect(classifyKind("form", NUTRITION_REQUEST_FORM_ID)).toBe("nutrition_update");
    expect(classifyKind("form", "other")).toBe("form");
  });
});

describe("filterRequests", () => {
  const rows = [
    row({ key: "a", clientName: "Alex Smith", sentAt: ago(100), readAt: ago(90) }),
    row({ key: "b", clientName: "Bea Jones", kind: "nutrition_update", source: "form", title: "Nutrition Update Request", sentAt: ago(3) }),
    row({ key: "c", clientName: "Cam Lee", kind: "form", source: "form", title: "Intake", sentAt: ago(60) }),
  ];
  it("orders oldest first so the most overdue is on top", () => {
    expect(filterRequests(rows, DEFAULT_FILTERS, now).map((r) => r.key)).toEqual(["a", "c", "b"]);
  });
  it("filters by type, status, unopened and search", () => {
    expect(filterRequests(rows, { ...DEFAULT_FILTERS, kind: "nutrition_update" }, now).map((r) => r.key)).toEqual(["b"]);
    expect(filterRequests(rows, { ...DEFAULT_FILTERS, status: "overdue" }, now).map((r) => r.key)).toEqual(["a", "c"]);
    expect(filterRequests(rows, { ...DEFAULT_FILTERS, unopenedOnly: true }, now).map((r) => r.key)).toEqual(["c", "b"]);
    expect(filterRequests(rows, { ...DEFAULT_FILTERS, search: "intake" }, now).map((r) => r.key)).toEqual(["c"]);
    expect(filterRequests(rows, { ...DEFAULT_FILTERS, search: "bea" }, now).map((r) => r.key)).toEqual(["b"]);
  });
  it("counts per type", () => {
    expect(countByKind(rows)).toEqual({ all: 3, weekly_checkin: 1, nutrition_update: 1, form: 1 });
  });
});

describe("pickUnfilledFormRequests", () => {
  const msg = (id: string, client: string, formId: string, at: string) => ({
    id, client_id: client, created_at: at,
    attachments: [{ kind: "form_request", form_id: formId, request_title: "T" }],
  });
  it("keeps only the newest request per client + form, and only if unfilled", () => {
    const messages = [msg("new", "c1", "f1", ago(2)), msg("old", "c1", "f1", ago(50)), msg("x", "c2", "f1", ago(10))];
    const subs = [{ client_id: "c2", form_id: "f1", submitted_at: ago(1) }];
    const out = pickUnfilledFormRequests(messages, subs);
    expect(out.map((o) => o.message.id)).toEqual(["new"]);
  });
  it("a submission before the request does not count as filled", () => {
    const out = pickUnfilledFormRequests([msg("m", "c1", "f1", ago(2))], [{ client_id: "c1", form_id: "f1", submitted_at: ago(100) }]);
    expect(out).toHaveLength(1);
  });
  it("never surfaces the retired Nutrition Review form", () => {
    expect(pickUnfilledFormRequests([msg("m", "c1", RETIRED_NUTRITION_REVIEW_FORM_ID, ago(2))], [])).toHaveLength(0);
  });
});
