import { describe, expect, it } from "vitest";
import { meetIntakeParams, meetLogisticsFields, logisticsBefore, logisticsChanges } from "@/lib/competition/attachment-intake";
import { routeFor } from "@/lib/cleo-actions";

describe("meet attachment intake", () => {
  it("accepts the schedule in canonical competition fields", () => {
    const patch = meetLogisticsFields.parse({
      session_label: "Session 2", flight: "C", weigh_in_at: "07:45",
      lifting_start: "09:45", location: "NXT LVL Performance",
      division: "F-O-U", equipment_event: "Unequipped (3 Lift)", weight_class: "57 kg",
    });
    expect(patch.weight_class).toBe("57");
    expect(patch.lifting_start).toBe("09:45");
    expect(patch.session_label).toBe("Session 2");
  });
  it("refuses invalid times, nulls, empty updates and unknown fields", () => {
    for (const value of [{ lifting_start: "24:00" }, { weigh_in_at: "07:99" },
      { flight: null }, {}, { client_id: "other", flight: "C" }]) {
      expect(meetLogisticsFields.safeParse(value).success).toBe(false);
    }
  });
  it("displays conflicts and snapshots only fields being changed", () => {
    const patch = meetLogisticsFields.parse({ lifting_start: "09:45", session_label: "Session 2" });
    const before = logisticsBefore({ lifting_start: "10:00", session_label: null, location: "Old venue" }, patch);
    expect(before).toEqual({ lifting_start: "10:00", session_label: null });
    expect(logisticsChanges(before, patch)).toContain("Lifting starts: 10:00 → 09:45 (replaces existing value)");
    expect(logisticsChanges(before, patch)).toContain("Session: Session 2");
  });
  it("allows the saved action metadata without trusting it as model input", () => {
    const raw = { client_id: "00000000-0000-4000-8000-000000000001", competition_id: "00000000-0000-4000-8000-000000000002", fields: { flight: "C" }, attachment_number: 1, confidence: "high", evidence: "Flight C", _meet_before: { flight: "B" } };
    expect(meetIntakeParams.parse(raw)).not.toHaveProperty("_meet_before");
  });
  it("keeps the existing coach approval and role gates", () => {
    expect(routeFor("update_meet_from_attachment", { isAdmin: true, permissions: [] })).toBe("run");
    expect(routeFor("update_meet_from_attachment", { isAdmin: false, isCoach: true, permissions: [] })).toBe("ask_owner");
    expect(routeFor("update_meet_from_attachment", { isAdmin: false, permissions: [] })).toBe("not_allowed");
  });
});
