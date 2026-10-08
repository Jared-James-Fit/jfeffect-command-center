import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sheet = readFileSync("src/components/schedule/MoveWorkoutSheet.tsx", "utf8");
const server = readFileSync("src/lib/schedule-manager.functions.ts", "utf8");

describe("move workout picker", () => {
  it("opens with nothing picked (the old default was a no-op move to the same day)", () => {
    expect(sheet).toContain("setTarget(initialTargetDate ?? null);");
    expect(sheet).not.toContain("initialFromCtx");
    expect(sheet).toContain('"Pick a day"');
  });

  it("shows what's on every day: a week list by default, month grid for longer moves", () => {
    expect(sheet).toContain('const [view, setView] = useState<"week" | "month">("week");');
    expect(sheet).toContain('data-testid="move-day"');
    expect(sheet).toContain('data-testid="move-month-day"');
    expect(sheet).toContain("usual training day");
    expect(sheet).not.toContain('from "@/components/ui/calendar"');
  });

  it("reads days from the same source the move writes: instances, or legacy day dates", () => {
    expect(sheet).toContain("for (const s of (ctx.siblingInstances ?? []) as any[])");
    expect(sheet).toContain("for (const d of ctx.allBlockDays ?? [])");
    expect(server).toContain("siblingInstances = (sibs ?? []).map((s: any) => ({ ...s, title: titleById.get(s.source_day_id) ?? null }));");
  });

  it("a taken day asks swap or do both, and the button says exactly what happens", () => {
    expect(sheet).toContain('const willSwap = canSwap && conflictChoice === "swap";');
    expect(sheet).toContain("swapMutation.mutate(sameDayConflict!.payload!.otherDayId as string);");
    expect(sheet).toContain('`Move to ${format(effectiveTarget, "EEE, MMM d")}`');
    expect(sheet).toContain('? "Swap days"');
  });
});
