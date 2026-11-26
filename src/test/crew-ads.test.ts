import { describe, expect, it } from "vitest";
import { EVERY, SPONSORED_LABEL, firstAfter, promoFor, promoSlots, safePromoPath } from "@/lib/crew-ads/placement";

const base = { sessionKey: "abc", shownToday: 0, workoutGoing: false, available: 3 };

describe("where Crew promos go", () => {
  it("the first after 8 to 10 posts, fixed for the visit", () => {
    for (const k of ["a", "b", "visit-1", "zzz", "12345"]) {
      const n = firstAfter(k);
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(10);
      expect(firstAfter(k)).toBe(n);
    }
  });

  it("then every 12, at most 2 a visit", () => {
    const f = firstAfter("abc");
    expect(promoSlots({ ...base, posts: 100 })).toEqual([f - 1, f - 1 + EVERY]);
  });

  it("never without enough posts of the feed's own", () => {
    const f = firstAfter("abc");
    expect(promoSlots({ ...base, posts: f - 1 })).toEqual([]);
    expect(promoSlots({ ...base, posts: f })).toEqual([f - 1]);
    expect(promoSlots({ ...base, posts: f + EVERY - 1 })).toEqual([f - 1]);
  });

  it("3 a day across visits, none during a workout, none with nothing live", () => {
    expect(promoSlots({ ...base, posts: 100, shownToday: 2 })).toHaveLength(1);
    expect(promoSlots({ ...base, posts: 100, shownToday: 3 })).toEqual([]);
    expect(promoSlots({ ...base, posts: 100, workoutGoing: true })).toEqual([]);
    expect(promoSlots({ ...base, posts: 100, available: 0 })).toEqual([]);
  });

  it("a different promo each time, never the same twice in a visit; links stay in the app", () => {
    const p = (id: string) => ({ id, headline: id, body: null, cta_label: "Go", cta_path: "/coaching" });
    expect(promoFor([p("a"), p("b")], 1)?.id).toBe("b");
    expect(promoFor([p("a")], 1)).toBeNull();
    expect(safePromoPath("/coaching?from=crew")).toBe("/coaching?from=crew");
    expect(safePromoPath("https://example.com")).toBeNull();
    expect(safePromoPath("//example.com")).toBeNull();
    expect(SPONSORED_LABEL).toBe("Sponsored · JF Effect");
  });
});
