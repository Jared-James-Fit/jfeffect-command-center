import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny window/document: what guardNativeHold touches.
const listeners = new Map<string, Set<() => void>>();
let attrs: Record<string, string> = {};
let removed = 0;
let selectionCollapsed = false;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  listeners.clear();
  attrs = {};
  removed = 0;
  selectionCollapsed = false;
  (globalThis as any).document = {
    documentElement: {
      setAttribute: (k: string, v: string) => { attrs[k] = v; },
      removeAttribute: (k: string) => { delete attrs[k]; },
    },
  };
  (globalThis as any).window = {
    addEventListener: (t: string, f: () => void) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f); },
    removeEventListener: (t: string, f: () => void) => { listeners.get(t)?.delete(f); },
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    getSelection: () => ({
      rangeCount: selectionCollapsed ? 0 : 1,
      isCollapsed: selectionCollapsed,
      removeAllRanges: () => { removed += 1; selectionCollapsed = true; },
    }),
  };
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).window;
  delete (globalThis as any).document;
});

const fire = (t: string) => { for (const f of [...(listeners.get(t) ?? [])]) f(); };

describe("holding a message never selects the page (iOS)", () => {
  it("makes the page unselectable from the press until just after the lift, clearing any selection", async () => {
    const { guardNativeHold } = await import("@/lib/hold-guard");
    guardNativeHold();
    expect(attrs["data-holding"]).toBe("");
    expect(removed).toBe(1); // a stale selection is cleared at once

    // iOS's own long-press selects everything while the menu opens
    selectionCollapsed = false;
    fire("touchend");
    expect(removed).toBe(2);
    expect(attrs["data-holding"]).toBe(""); // still guarded for the moment after the lift
    selectionCollapsed = false;
    vi.advanceTimersByTime(300);
    expect(removed).toBe(3);
    expect(attrs["data-holding"]).toBeUndefined();
    expect([...listeners.values()].every((s) => s.size === 0)).toBe(true);
  });

  it("never leaves the page stuck unselectable", async () => {
    const { guardNativeHold } = await import("@/lib/hold-guard");
    guardNativeHold();
    vi.advanceTimersByTime(8300);
    expect(attrs["data-holding"]).toBeUndefined();
  });

  it("is wired into every hold-to-open menu, for touch only, and leaves text fields alone", () => {
    const read = (f: string) => readFileSync(f, "utf8");
    expect(read("src/components/message-thread.tsx")).toContain('if (e.pointerType !== "mouse") guardNativeHold();');
    expect(read("src/components/group-message-thread.tsx")).toContain('if (e.pointerType !== "mouse") guardNativeHold();');
    expect(read("src/hooks/use-long-press.ts")).toContain('if (e.pointerType !== "mouse") guardNativeHold();');
    const css = read("src/styles.css");
    expect(css).toContain('html[data-holding] *:not(input):not(textarea):not([contenteditable="true"])');
    expect(css).toContain("-webkit-user-select: none !important;");
  });
});
