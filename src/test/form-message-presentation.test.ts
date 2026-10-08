import { describe, expect, it } from "vitest";
import { planFormMessages } from "@/lib/form-message-presentation";

let n = 0;
const req = (id: string, type: "weekly_checkin", at: string, read: string | null = null) => ({
  id: `req-${id}-${n++}`, created_at: at, read_by_client_at: read, deleted_at: null,
  attachments: [{ type: "file", url: "", kind: "checkin_request", checkin_submission_id: id, checkin_task_type: type }] as any,
});
const sub = (id: string, type: "weekly_checkin", at: string) => ({
  id: `sub-${id}-${n++}`, created_at: at, read_by_client_at: null, deleted_at: null,
  attachments: [{ type: "file", url: "", kind: "checkin_submission", checkin_submission_id: id, checkin_task_type: type }] as any,
});
const chat = (at: string) => ({ id: `m-${n++}`, created_at: at, read_by_client_at: null, deleted_at: null, attachments: [] as any });

describe("planFormMessages", () => {
  it("first weekly check-in is expanded", () => {
    const r1 = req("w1", "weekly_checkin", "2026-09-18T15:00:00Z");
    const plan = planFormMessages([r1], "client");
    expect(plan.get(r1.id)).toMatchObject({ mode: "expanded", state: "pending" });
  });

  it("a newer check-in collapses the older one and marks it superseded (no CTA)", () => {
    const r1 = req("w1", "weekly_checkin", "2026-09-18T15:00:00Z", "2026-09-18T16:00:00Z");
    const r2 = req("w2", "weekly_checkin", "2026-09-25T15:00:00Z");
    const plan = planFormMessages([r1, chat("2026-09-20T00:00:00Z"), r2], "client");
    expect(plan.get(r1.id)).toMatchObject({ mode: "compact", state: "superseded", readAt: "2026-09-18T16:00:00Z" });
    expect(plan.get(r2.id)).toMatchObject({ mode: "expanded", state: "pending" });
    expect(plan.size).toBe(2); // normal chat messages untouched
  });

  it("completed newest: compact for the client, expanded recap for the coach; keeps request timestamps", () => {
    const r2 = req("w2", "weekly_checkin", "2026-09-25T15:00:00Z", "2026-09-25T18:00:00Z");
    const s2 = sub("w2", "weekly_checkin", "2026-09-25T19:42:00Z");
    const client = planFormMessages([r2, s2], "client");
    const coach = planFormMessages([r2, s2], "admin");
    expect(client.get(s2.id)).toMatchObject({ mode: "compact", state: "completed", sentAt: r2.created_at, submittedAt: s2.created_at, readAt: r2.read_by_client_at });
    expect(coach.get(s2.id)).toMatchObject({ mode: "expanded", state: "completed" });
  });

  it("third check-in: all older compact, newest expanded, for coach too", () => {
    const r1 = req("w1", "weekly_checkin", "2026-09-18T15:00:00Z");
    const r2 = req("w2", "weekly_checkin", "2026-09-25T15:00:00Z");
    const s2 = sub("w2", "weekly_checkin", "2026-09-26T15:00:00Z");
    const r3 = req("w3", "weekly_checkin", "2026-10-02T15:00:00Z");
    for (const role of ["client", "admin"] as const) {
      const plan = planFormMessages([r1, r2, s2, r3], role);
      expect(plan.get(r1.id)?.mode).toBe("compact");
      expect(plan.get(s2.id)).toMatchObject({ mode: "compact", state: "completed" });
      expect(plan.get(r3.id)).toMatchObject({ mode: "expanded", state: "pending" });
    }
  });

  it("ignores deleted messages and tolerates overlapping pages", () => {
    const r1 = req("w1", "weekly_checkin", "2026-09-18T15:00:00Z");
    const r2 = { ...req("w2", "weekly_checkin", "2026-09-25T15:00:00Z"), deleted_at: "2026-09-25T16:00:00Z" };
    const plan = planFormMessages([r1, r1, r2], "client");
    expect(plan.get(r1.id)?.mode).toBe("expanded");
    expect(plan.has(r2.id)).toBe(false);
  });
});

import { groupFormHistory } from "@/lib/form-message-presentation";

describe("groupFormHistory", () => {
  it("collapses 2+ older units of a type into one summary with filled / missed counts", () => {
    const r1 = req("w1", "weekly_checkin", "2026-09-04T15:00:00Z"); // never answered -> missed
    const r2 = req("w2", "weekly_checkin", "2026-09-11T15:00:00Z");
    const s2 = sub("w2", "weekly_checkin", "2026-09-12T10:00:00Z"); // answered -> filled
    const r3 = req("w3", "weekly_checkin", "2026-09-18T15:00:00Z"); // newest, pending (stays expanded)
    const all = [r1, r2, s2, r3];
    const plan = planFormMessages(all, "admin");
    // thread hides a request once it's answered, so the visible order is r1, s2, r3
    const { leaders, hidden } = groupFormHistory(plan, [r1.id, s2.id, r3.id]);
    expect(leaders.size).toBe(1);
    const g = leaders.get(r1.id)!;
    expect(g).toMatchObject({ taskType: "weekly_checkin", filled: 1, missed: 1 });
    expect(g.units.map((u) => u.submissionId)).toEqual(["w2", "w1"]); // newest first
    expect(hidden.has(s2.id)).toBe(true);
    expect(hidden.has(r3.id)).toBe(false); // current request is never grouped
  });

  it("a single older unit keeps its own row", () => {
    const r1 = req("w1", "weekly_checkin", "2026-09-11T15:00:00Z");
    const r2 = req("w2", "weekly_checkin", "2026-09-18T15:00:00Z");
    const plan = planFormMessages([r1, r2], "client");
    const { leaders, hidden } = groupFormHistory(plan, [r1.id, r2.id]);
    expect(leaders.size).toBe(0);
    expect(hidden.size).toBe(0);
  });
});
