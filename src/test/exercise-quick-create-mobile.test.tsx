/**
 * Narrow regression guard for the Android "cannot type in Name" blocker.
 * Asserts the input identity/autofill attributes and the touch-aware
 * auto-focus rule — not full form behaviour.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { isCoarsePointer } from "@/hooks/use-touch-viewport";

const formSource = readFileSync("src/components/exercises/exercise-quick-create-form.tsx", "utf8");

describe("exercise quick-create form attributes", () => {
  it("does not auto-focus on touch devices", () => {
    expect(formSource).toContain("autoFocus={!coarsePointer}");
    expect(formSource).not.toMatch(/\n\s+autoFocus\n/);
  });

  it("gives the Name field a non-contact identity so Android autofill stays away", () => {
    expect(formSource).toContain('name="exercise_name"');
    expect(formSource).toContain('autoComplete="off"');
    expect(formSource).toContain('inputMode="text"');
  });

  it("guards against duplicate submits", () => {
    expect(formSource).toContain("submittingRef.current");
  });
});

describe("isCoarsePointer", () => {
  const setMatchMedia = (impl: (q: string) => { matches: boolean }) => {
    vi.stubGlobal("window", { matchMedia: impl });
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true when the device reports a coarse pointer", () => {
    setMatchMedia((q: string) => ({ matches: q.includes("coarse") }));
    expect(isCoarsePointer()).toBe(true);
  });

  it("is false for fine pointers (desktop keeps auto-focus)", () => {
    setMatchMedia(() => ({ matches: false }));
    expect(isCoarsePointer()).toBe(false);
  });

  it("never throws when matchMedia misbehaves", () => {
    setMatchMedia(() => { throw new Error("nope"); });
    expect(isCoarsePointer()).toBe(false);
  });
});
