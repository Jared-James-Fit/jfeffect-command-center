import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf8");

describe("the staff header holds no persistent buttons (Nov 23 2026)", () => {
  const bar = read("src/components/admin-top-bar.tsx");
  const keys = read("src/components/keyboard-shortcuts.tsx");
  const palette = read("src/components/command-palette.tsx");

  it("no View as client button and no keyboard icon over every admin page", () => {
    expect(bar).not.toContain("View as client</");
    expect(bar).not.toContain("<Eye");
    expect(bar).not.toMatch(/sticky top-0/);
    expect(keys).not.toContain("export function KeyboardShortcutsButton");
    expect(keys).not.toContain("<DialogTrigger");
  });

  it("their jobs stay one keystroke away: ? and the command palette", () => {
    expect(keys).toContain('e.key === "?"');
    expect(keys).toContain("window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);");
    expect(palette).toContain('event: "open-client-pov-picker", clientPov: true');
    expect(palette).toContain("event: OPEN_SHORTCUTS_EVENT");
    // never for a view-only login, which the server refuses anyway
    expect(palette).toContain('const canClientPov = (role === "admin" || role === "coach") && !viewOnly;');
  });

  it("the shortcuts list only lists shortcuts that work", () => {
    expect(keys).not.toContain('label: "Toggle sidebar"');
    expect(keys).not.toContain("Toggle client preview (POV)");
  });
});
