import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("the exercise card's ⋯ is a bottom sheet on a phone", () => {
  const menu = read("src/components/workout-day/card-menu.tsx");
  const wdv = read("src/components/workout-day/WorkoutDayView.tsx");

  it("phones get a bottom sheet within a thumb's reach, wide screens the dropdown", () => {
    expect(menu).toContain("const phone = useIsMobile();");
    expect(menu).toContain('side="bottom"');
    expect(menu).toContain("max-h-[85dvh] overflow-y-auto");
    expect(menu).toContain("pb-[calc(env(safe-area-inset-bottom,0px)+12px)]");
    // the dropdown never runs off the screen: it scrolls inside the room it has
    expect(menu).toContain("max-h-[var(--radix-dropdown-menu-content-available-height)]");
  });

  it("the items are written once and work in either; Undo / Redo keep the sheet open", () => {
    expect(menu).toContain("if (!keepOpen) mode.close();");
    expect(wdv).toContain('import { CardMenuItem, CardMenuSeparator } from "@/components/workout-day/card-menu";');
    const items = wdv.slice(wdv.indexOf("moreMenu={("), wdv.indexOf("rest={(exerciseId || name)"));
    expect(items).not.toContain("DropdownMenuContent");
    expect(items).not.toContain("<DropdownMenuItem");
    expect(items).toContain('data-testid="card-undo"');
    expect(items).toContain("onSelect={(e) => { e.preventDefault(); void runCardHistory(\"undo\"); }}");
    expect(items).toContain("Move to position");
    expect(items).toContain('data-testid="card-remove"');
    expect(read("src/components/workout-tools/workout-tools.tsx")).toContain("<CardMenuItem");
  });

  it("Focus doesn't take a swipe while it's open (it's a dialog)", () => {
    expect(read("src/components/workout-day/workout-story.tsx")).toContain('[role="dialog"][data-state="open"]');
  });
});
