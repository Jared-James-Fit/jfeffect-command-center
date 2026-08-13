import { describe, it, expect } from "vitest";
import { planCascade, type CascadeSetState } from "@/lib/set-cascade";

const s = (index: number, o?: Partial<CascadeSetState>): CascadeSetState =>
  ({ index, hasValue: false, ...o });

describe("planCascade", () => {
  it("fills all blank sets below the source", () => {
    expect(planCascade(1, [s(1, { hasValue: true, origin: "manual" }), s(2), s(3)])).toEqual([2, 3]);
  });
  it("never propagates upward", () => {
    expect(planCascade(2, [s(1), s(2, { hasValue: true }), s(3)])).toEqual([3]);
  });
  it("overwrites auto-derived sets", () => {
    expect(planCascade(2, [s(2), s(3, { hasValue: true, origin: "auto" }), s(4, { hasValue: true, origin: "auto" })])).toEqual([3, 4]);
  });
  it("stops at a manual override and does not skip past it", () => {
    expect(
      planCascade(1, [
        s(1, { hasValue: true, origin: "manual" }),
        s(2, { hasValue: true, origin: "manual" }),
        s(3, { hasValue: true, origin: "manual" }),
        s(4, { hasValue: true, origin: "auto" }),
      ]),
    ).toEqual([]);
  });
  it("cascades from a manual set into its own derived set", () => {
    expect(planCascade(3, [s(3, { hasValue: true, origin: "manual" }), s(4, { hasValue: true, origin: "auto" })])).toEqual([4]);
  });
  it("stops at an untouched set that already holds a value", () => {
    expect(planCascade(1, [s(2), s(3, { hasValue: true }), s(4)])).toEqual([2]);
  });
  it("never touches locked (hand-confirmed) sets", () => {
    expect(planCascade(1, [s(2, { locked: true }), s(3)])).toEqual([]);
  });
});
