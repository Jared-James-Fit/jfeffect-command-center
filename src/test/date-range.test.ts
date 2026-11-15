import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { billingDay, billingRange, calendarDay } from "@/lib/date-range";
import { dayRange } from "@/lib/session-packages";
import { payDay, period } from "@/components/billing/package-list";
import { termRange } from "@/lib/coaching-plan";

const Y = { thisYear: 2026 };

describe("billing dates", () => {
  it("a range across a new year names both years (Alexander's term read 'Jun 2 – Jun 2, 2027')", () => {
    expect(billingRange("2026-06-02", "2027-06-02", Y)).toBe("Jun 2, 2026 – Jun 2, 2027");
    expect(billingRange("2026-11-27", "2027-01-08", Y)).toBe("Nov 27, 2026 – Jan 8, 2027");
    expect(billingRange("2025-12-20", "2026-01-08", Y)).toBe("Dec 20, 2025 – Jan 8, 2026");
  });

  it("inside this year: no years; one month: the month once", () => {
    expect(billingRange("2026-08-10", "2026-09-04", Y)).toBe("Aug 10 – Sep 4");
    expect(billingRange("2026-11-02", "2026-11-29", Y)).toBe("Nov 2 – 29");
    expect(billingRange("2026-11-02", "2026-11-02", Y)).toBe("Nov 2");
  });

  it("inside another year: the year once, at the end", () => {
    expect(billingRange("2027-01-22", "2027-03-05", Y)).toBe("Jan 22 – Mar 5, 2027");
    expect(billingRange("2025-03-02", "2025-03-30", Y)).toBe("Mar 2 – 30, 2025");
  });

  it("year: always names it on detail pages, once when it's one year", () => {
    expect(billingRange("2026-08-10", "2026-09-04", { ...Y, year: "always" })).toBe("Aug 10 – Sep 4, 2026");
    expect(billingRange("2026-06-02", "2027-06-02", { ...Y, year: "always" })).toBe("Jun 2, 2026 – Jun 2, 2027");
  });

  it("an open end says so, never '?'", () => {
    expect(billingRange("2026-06-02", null, Y)).toBe("from Jun 2");
    expect(billingRange(null, "2027-06-02", Y)).toBe("until Jun 2, 2027");
    expect(billingRange(null, null, Y)).toBeNull();
  });

  it("a stored day is that calendar day, never shifted by UTC (Jun 2 never reads Jun 1 in Manitoba)", () => {
    expect(calendarDay("2026-06-02")).toEqual({ y: 2026, m: 6, d: 2 });
    expect(billingDay("2026-06-02", { ...Y, year: "always" })).toBe("Jun 2, 2026");
    expect(billingDay("2027-01-08", Y)).toBe("Jan 8, 2027");
    expect(billingDay("2026-11-27", { ...Y, weekday: true })).toBe("Fri, Nov 27");
    expect(billingDay("2027-01-08", { ...Y, weekday: true })).toBe("Fri, Jan 8, 2027");
    expect(billingDay("nope", Y)).toBeNull();
  });

  it("every billing helper reads the same way", () => {
    expect(dayRange("2026-12-20", "2027-01-08", 2026)).toBe("Dec 20, 2026 – Jan 8, 2027");
    expect(dayRange("2026-08-10", "2026-09-04", 2026)).toBe("Aug 10 – Sep 4");
    expect(payDay("2026-11-27", 2026)).toBe("Fri, Nov 27");
    expect(termRange("2026-06-02", "2027-06-02", 2026)).toBe("Jun 2, 2026 – Jun 2, 2027");
    expect(termRange("2026-01-05", "2026-07-05", 2026)).toBe("Jan 5 – Jul 5");
    expect(period("2026-06-02", "2027-06-02")).toBe("Jun 2, 2026 – Jun 2, 2027");
  });

  it("no billing screen builds its own range or parses a stored day as UTC", () => {
    const files = [
      "src/components/admin/sale-card.tsx",
      "src/components/billing/package-list.tsx",
      "src/components/admin/client-billing-panel.tsx",
      "src/components/purchase-records-panel.tsx",
      "src/routes/_authenticated/admin/purchases.$id.tsx",
      "src/routes/_authenticated/portal/purchases.$id.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\$\{(payDay|shortDay|fmtDate)\([^)]*\)[^`]*\}? – \$\{/);
      expect(src, f).not.toMatch(/new Date\((r|sale|purchase|raw)\.term_(start|end)_date\)/);
      expect(src, f).not.toContain('"?"} – ');
    }
  });
});
