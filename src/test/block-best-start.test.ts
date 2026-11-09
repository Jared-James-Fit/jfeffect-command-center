import { describe, expect, it } from "vitest";
import { bestNextStart, defaultStartFor, type ScheduleBlock } from "@/lib/block-schedule-model";

const block = (id: string, end: string | null, extra: Partial<ScheduleBlock> = {}) =>
  ({ id, name: id, status_derived: "Upcoming", archived: false, effective_start: null, effective_end: end, ...extra }) as unknown as ScheduleBlock;

// Sunday Nov 8 2026
const TODAY = "2026-11-08";

describe("Add next block starts at the best time (Nov 9 2026)", () => {
  it("the Monday after the most recent block ends", () => {
    const r = bestNextStart([block("Block 1", "2026-12-20"), block("Older", "2026-11-30")], TODAY);
    expect(r.date).toBe("2026-12-21");
    expect(r.after?.id).toBe("Block 1");
    expect(r.why).toBe("the Monday after Block 1 ends");
  });
  it("a block ending midweek: the Monday after, never the day after", () => {
    expect(bestNextStart([block("A", "2026-12-16")], TODAY).date).toBe("2026-12-21");
  });
  it("nothing running past today: next Monday", () => {
    const none = bestNextStart([], TODAY);
    expect(none).toMatchObject({ date: "2026-11-09", after: null, why: "next Monday, with nothing else running" });
    expect(bestNextStart([block("Done", "2026-10-31", { status_derived: "Completed" })], TODAY).date).toBe("2026-11-09");
  });
  it("leaves out the block being scheduled (a draft that already carries dates) and archived ones", () => {
    const blocks = [block("Draft 1", "2026-12-20"), block("Old", "2027-01-31", { status_derived: "Archived", archived: true })];
    expect(bestNextStart(blocks, TODAY, new Set(["Draft 1"])).date).toBe("2026-11-09");
  });
});

describe("a program hidden from the client (Devin, Nov 9 2026)", () => {
  it("never pushes the best start later: it isn't running for them", () => {
    const blocks = [block("Hidden 1", "2026-12-20", { client_visible: false }), block("Hidden 2", "2027-01-31", { client_visible: false })];
    expect(bestNextStart(blocks, TODAY).date).toBe("2026-11-09");
  });
  it("the Start dialog opens on the coach's own date while it's still ahead, else the best start", () => {
    expect(defaultStartFor("2026-11-16", "2026-11-09", TODAY)).toBe("2026-11-16");
    expect(defaultStartFor("2026-11-08", "2026-11-09", TODAY)).toBe("2026-11-08");
    expect(defaultStartFor("2026-11-02", "2026-11-09", TODAY)).toBe("2026-11-09");
    expect(defaultStartFor(null, "2026-11-09", TODAY)).toBe("2026-11-09");
  });
});
