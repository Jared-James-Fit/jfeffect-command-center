import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Behaviour verified in a browser harness (iPhone UA): hiding the app blurs
// the active field and flushes every field without changing values; returning
// flushes again; the idle flush still runs while typing.
describe("iOS Undo Typing guard", () => {
  const src = readFileSync("src/lib/shake-undo-guard.ts", "utf8");
  it("clears undo history when the app is backgrounded and when it returns", () => {
    expect(src).toContain('addEventListener("visibilitychange", onVisibility)');
    expect(src).toContain('addEventListener("pagehide", onLeave)');
    expect(src).toContain('addEventListener("pageshow", onReturn)');
    expect(src).toMatch(/const onLeave = \(\) => \{[\s\S]*active\.blur\(\);[\s\S]*flushAllFields\(\);/);
  });
  it("still flushes after typing pauses and when leaving a field", () => {
    expect(src).toContain('addEventListener("input", onInput, true)');
    expect(src).toContain('addEventListener("focusout", onFocusOut, true)');
  });
  it("is installed app-wide", () => {
    expect(readFileSync("src/routes/__root.tsx", "utf8")).toContain("installShakeUndoGuard()");
  });
});
