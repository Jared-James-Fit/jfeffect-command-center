import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CLEO_ACTION_PARAMS, routeFor } from "@/lib/cleo-actions";
const id = "00000000-0000-4000-8000-000000000001";
const params = { client_id: id, goal_id: id, expected_version: 1, value: 102.5, unit: "kg", client_facing: false };
describe("Cleo goal actions", () => {
  it("requires a known goal version, numeric weight, explicit unit and visibility", () => {
    expect(CLEO_ACTION_PARAMS.approve_goal_target.safeParse(params).success).toBe(true);
    for (const key of ["goal_id", "expected_version", "unit", "client_facing"]) {
      expect(CLEO_ACTION_PARAMS.approve_goal_target.safeParse({ ...params, [key]: undefined }).success).toBe(false);
    }
  });
  it("uses the existing staff approval and denies non-staff", () => {
    for (const kind of ["approve_goal_target", "recover_meeting_goals"] as const) {
      expect(routeFor(kind, { isAdmin: false, permissions: [] })).toBe("not_allowed");
      expect(routeFor(kind, { isAdmin: false, isCoach: true, permissions: [] })).toBe("ask_owner");
    }
  });
  it("uses the goal ledger with version and client checks", () => {
    const s = readFileSync("src/lib/cleo-actions.server.ts", "utf8");
    expect(s).toContain('.eq("id", p.goal_id).eq("client_id", p.client_id)');
    expect(s).toContain("g.version !== p.expected_version");
    expect(s).toContain("expectedVersion: p.expected_version");
    expect(s).toContain("await assertRequesterReaches(admin, actor.userId, p.client_id)");
    expect(s).toContain('s.status !== "done" || s.analysis_status !== "ready"');
  });
});
