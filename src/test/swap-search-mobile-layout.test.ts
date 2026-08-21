import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(
  path.resolve(process.cwd(), "src/components/workout-day/QuickSwapButton.tsx"),
  "utf8",
);

describe("in-workout swap sheet — mobile search layout", () => {
  it("keeps search inside the same sheet (no navigation)", () => {
    expect(src).not.toMatch(/useNavigate|router\.navigate|<Link/);
    expect(src).toMatch(/setMode\("search"\)/);
  });

  it("renders the search header outside the scrolling result area", () => {
    const headerIdx = src.indexOf('placeholder="Search exercises…"');
    const scrollIdx = src.indexOf("min-h-0 flex-1 overflow-y-auto overscroll-contain");
    expect(headerIdx).toBeGreaterThan(0);
    expect(scrollIdx).toBeGreaterThan(headerIdx);
  });

  it("sizes the sheet off the visual viewport and lifts it above the keyboard", () => {
    expect(src).toContain("var(--vv-h, 100dvh)");
    expect(src).toContain("var(--keyboard-inset, 0px)");
    expect(src).toContain("env(safe-area-inset-top)");
    expect(src).toContain("env(safe-area-inset-bottom)");
  });

  it("uses an iOS-safe 16px input that does not autozoom or autocorrect", () => {
    expect(src).toMatch(/className="h-11 text-base"/);
    expect(src).toContain('autoCorrect="off"');
    expect(src).toContain('autoCapitalize="none"');
    expect(src).toContain('enterKeyHint="search"');
  });

  it("focuses the input deliberately via a ref, not autoFocus", () => {
    expect(src).toContain("searchInputRef.current?.focus()");
    expect(src).not.toMatch(/\n\s+autoFocus\b/);
  });

  it("appends results instead of paginating so the list never jumps", () => {
    expect(src).toContain("searchRows.slice(0, (page + 1) * PAGE_SIZE)");
    expect(src).not.toContain("Previous");
  });

  it("does not mutate workout state while searching", () => {
    const searchBlock = src.slice(src.indexOf('mode === "search"'));
    expect(searchBlock).not.toMatch(/\.update\(|startWorkout|completeWorkout/);
  });

  it("searches the full eligible cache instead of the Best Match subset", () => {
    expect(src).toContain("searchEligibleExercises(searchPool, debouncedSearch");
    expect(src).not.toContain("searchEligibleExercises(filteredSuggestions");
    expect(src).not.toContain("searchExercises(filteredSuggestions");
  });

  it("fetches the complete eligible library in bounded pages", () => {
    expect(src).toContain("fetchEligibleExerciseLibrary");
    expect(src).toContain(".range(from, from + LIBRARY_FETCH_PAGE_SIZE - 1)");
    expect(src).not.toContain(".limit(5000)");
  });
});
