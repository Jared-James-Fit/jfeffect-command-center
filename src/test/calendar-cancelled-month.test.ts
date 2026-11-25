import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { monthChipOrder } from "@/lib/calendar-timeline";

// Cancelled and missed sessions show on every calendar, crossed out (Nov 25 2026:
// Amanda's late-cancelled Nov 13 session wasn't anywhere on the Home calendar's month).
describe("cancelled sessions in the month", () => {
  it("sorts what's still on first, then what was cancelled or missed", () => {
    const day = [
      { id: "cancelled", family: "people", startsAt: "2026-11-13T23:00:00Z", status: "Cancelled" },
      { id: "google", family: "google", startsAt: "2026-11-13T15:00:00Z", status: null },
      { id: "marc", family: "people", startsAt: "2026-11-13T16:00:00Z", status: "Scheduled" },
      { id: "missed", family: "people", startsAt: "2026-11-13T14:00:00Z", status: "Missed" },
    ];
    expect([...day].sort(monthChipOrder).map((x) => x.id)).toEqual(["marc", "google", "missed", "cancelled"]);
  });

  it("keeps cancelled sessions in both Home cards' months and crosses them out", () => {
    for (const f of ["src/components/admin-calendar/dashboard-schedule-card.tsx", "src/components/home/upcoming-schedule-card.tsx"]) {
      const src = readFileSync(f, "utf8");
      const month = src.slice(src.indexOf("const namesByDay"), src.indexOf("const namesByDay") + 400);
      expect(month).not.toContain('"Cancelled") continue');
    }
    const views = readFileSync("src/components/schedule/home-calendar-views.tsx", "utf8");
    expect(views).toContain('statusMark(r.status) === "struck" && "border-dashed text-muted-foreground line-through opacity-60"');
  });
});
