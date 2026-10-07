import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { focusOverlayOnOpen } from "@/lib/overlay-focus";

/** Minimal stand-in for the Radix focus container and its first control. */
function openEvent(firstTag: string | null) {
  const focus = vi.fn();
  const container = {
    querySelector: () => (firstTag ? { tagName: firstTag } : null),
    focus,
  };
  let prevented = false;
  const e = {
    target: container,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as Event;
  return { e, focus, prevented: () => prevented };
}

describe("where focus lands when a sheet or dialog opens", () => {
  it("on the sheet itself when the first control is a button, so Back never shows a ring on open", () => {
    const { e, focus, prevented } = openEvent("BUTTON");
    focusOverlayOnOpen(e);
    expect(prevented()).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("a sheet that opens on a field keeps that field's autofocus", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      const { e, focus, prevented } = openEvent(tag);
      focusOverlayOnOpen(e);
      expect(prevented()).toBe(false);
      expect(focus).not.toHaveBeenCalled();
    }
  });

  it("a caller's own onOpenAutoFocus still wins", () => {
    const { e, focus } = openEvent("BUTTON");
    focusOverlayOnOpen(e, (ev) => ev.preventDefault());
    expect(focus).not.toHaveBeenCalled();
  });

  it("is wired into every Sheet and Dialog, and the check-out's own Back is keyboard-only", () => {
    for (const f of ["src/components/ui/sheet.tsx", "src/components/ui/dialog.tsx"]) {
      expect(readFileSync(f, "utf8")).toContain(
        "onOpenAutoFocus={(e) => focusOverlayOnOpen(e, onOpenAutoFocus)}",
      );
    }
    const checkout = readFileSync(
      "src/components/workout/shared/workout-review-editor.tsx",
      "utf8",
    );
    expect(checkout).not.toContain("focus:ring-2 focus:ring-ring");
  });
});
