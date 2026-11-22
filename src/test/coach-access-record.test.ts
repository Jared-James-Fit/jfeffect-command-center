import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { coachRecordFilter } from "@/components/admin/coach-access-record";

describe("a coach's access record", () => {
  it("reads lines about their record, their login and clients moved to or from them", () => {
    expect(coachRecordFilter("c1", "u1")).toBe(
      "target_id.eq.c1,detail->>to_coach_id.eq.c1,detail->>from_coach_id.eq.c1,target_id.eq.u1",
    );
    expect(coachRecordFilter("c1", null)).not.toContain("null");
  });
  it("is on the coach's page, which says what a status does", () => {
    const page = readFileSync("src/routes/_authenticated/admin/coaches.$id.tsx", "utf8");
    expect(page).toMatch(/<CoachAccessRecord/);
    expect(page).toMatch(/data-coach-status-note/);
  });
});
