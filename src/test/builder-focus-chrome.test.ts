import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { supersetPartner, withSuperset, withoutSuperset } from "@/lib/program-editor-superset";
import { movementFamilyStyle } from "@/lib/exercise-family";

const read = (p: string) => readFileSync(p, "utf8");
const editor = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");
const blockPage = read("src/routes/_authenticated/admin/blocks.$blockId.tsx");
const chrome = read("src/components/program-editor/builder-chrome.tsx");
const focus = read("src/components/program-editor/builder-focus.tsx");
const styles = read("src/styles.css");
const topBar = read("src/components/admin-top-bar.tsx");

describe("supersets live in the athlete's note, in Generate Next Program's words", () => {
  it("reads, writes and clears the pairing without touching the coach's own words", () => {
    expect(supersetPartner("Superset with Lat Pulldown: one set of each, then rest.")).toBe("Lat Pulldown");
    expect(supersetPartner("Superset with Cable Row: one set of each, then rest. · Elbows tucked")).toBe("Cable Row");
    expect(supersetPartner("Elbows tucked")).toBeNull();
    expect(supersetPartner(null)).toBeNull();
    expect(withSuperset("Elbows tucked", "Cable Row")).toBe("Superset with Cable Row: one set of each, then rest. · Elbows tucked");
    expect(withSuperset(null, "Cable Row")).toBe("Superset with Cable Row: one set of each, then rest.");
    // pairing again replaces the old partner, never stacks two
    expect(withSuperset("Superset with A: one set of each, then rest. · Cue", "B")).toBe("Superset with B: one set of each, then rest. · Cue");
    expect(withoutSuperset("Superset with A: one set of each, then rest. · Cue")).toBe("Cue");
    expect(withoutSuperset("Superset with A: one set of each, then rest.")).toBe("");
  });
});

describe("focus mode is one attribute, never a second editor", () => {
  it("hides only the shell's chrome and what the page marks, and the header owns the toggle", () => {
    expect(styles).toContain("html[data-builder-focus] [data-shell-root] > aside");
    expect(styles).toContain("html[data-builder-focus] [data-focus-hide]");
    expect(chrome).toContain("<BuilderFocusHost />");
    expect(chrome).toContain("<BuilderFocusButton");
    expect(focus).toContain('html.setAttribute("data-builder-focus", "")');
    // leaving the editor gives the admin its menu back
    expect(focus).toContain('return () => html.removeAttribute("data-builder-focus")');
    // the old canvas-only full screen is gone
    expect(editor).not.toContain("setFullscreen");
    // a client's block's schedule, roadmap and warm-ups live in a sheet, so nothing on the page needs hiding
    expect(blockPage).toContain("<BlockSettingsSheet");
  });
});

describe("one navigator row", () => {
  it("puts the client's block picker, the views, the weeks and the status in the toolbar", () => {
    expect(blockPage).toContain('variant="menu"');
    expect(blockPage).toContain("navLeading={");
    expect(editor).toContain("<ProgramBuilderShortcutsButton trigger={false} />");
    expect(editor).not.toContain("BestOnComputerTip");
    expect(editor).toContain("@max-[56rem]/tb:inline-flex");
    // Day is where a coach who has never picked starts
    expect(editor).toContain('if (!raw) return { view: "day", activeIdx: 0, dayIdx: 0 };');
  });

  it("keeps exercise rows neutral: accessories are grey, never the brand red", () => {
    expect(movementFamilyStyle("accessory").dot).not.toMatch(/red/);
    expect(editor).not.toContain('<span className={cn("absolute bottom-2 left-1.5 top-2 w-[3px] rounded-full", accent)}');
    expect(editor).toContain("data-row-columns");
    expect(editor).toContain("Note for the athlete");
  });
});

describe("the admin has no strip above its pages", () => {
  it("drops the global View as client and keyboard buttons", () => {
    expect(topBar).not.toMatch(/<Button|useEnterClientPov|KeyboardShortcutsButton/);
    expect(topBar).toContain("return <KeyboardShortcutsHost />;");
  });
});
