import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("the app-wide standard: dashboards summarize, full-screen pages to interact", () => {
  const page = read("src/components/full-screen-page.tsx");
  it("a full-screen page has one header with Back, Escape, the phone's Back and a swipe back", () => {
    expect(page).toContain("<SwipeBack enabled target={layer}");
    expect(page).toContain('if (e.key !== "Escape" || e.defaultPrevented) return;');
    expect(page).toContain("data-full-screen-back");
    // never a dialog: SwipeBack stands down for dialogs, and sheets opened from it must stack above
    expect(page).not.toMatch(/role="dialog"\s/);
  });
  it("the opener stays mounted and its place is kept: the layer lives in the address, the scroll is never reset", () => {
    expect(page).toContain("export function useFullScreenLayer");
    expect(page).toContain("resetScroll: false");
    expect(page).toContain("router.history.back();");
    expect(page).toContain("scrollMemory.set(id,");
  });
  it("the rule is written down once in AGENTS.md", () => {
    const rules = read("AGENTS.md");
    expect(rules.match(/^- Dashboards summarize; full-screen pages are where you work with something; sheets are for quick actions/gm)?.length).toBe(1);
    expect(rules).not.toContain("one neutral Week · Month · Block control");
  });
});

describe("Workouts: the week, today, Recovery & Performance, the program", () => {
  const wo = read("src/components/workouts/WorkoutsExperience.tsx");
  const route = read("src/routes/_authenticated/portal/workouts.index.tsx");
  it("the month, the Training plan and recovery are full-screen pages kept in the address", () => {
    expect(wo).toContain('export const WORKOUTS_LAYERS = ["month", "plan", "recovery"] as const;');
    expect(wo).toContain('<FullScreenPage open={layer === "month"}');
    expect(wo).toContain('open={layer === "plan"}');
    expect(wo).toContain('<FullScreenPage open={layer === "recovery"}');
    expect(route).toContain("WORKOUTS_LAYERS as readonly string[]).includes(s.layer)");
  });
  it("Recovery & Performance is lazy, after the day; the body opens recovery full screen", () => {
    expect(wo).toContain('import("@/components/workouts/recovery-performance")');
    expect(wo).toMatch(/<DeferRender[\s\S]{0,200}<RecoveryPerformanceSection/);
    expect(wo).toContain('onOpenRecovery={() => openLayer("recovery")}');
    const sec = read("src/components/workouts/recovery-performance.tsx");
    expect(sec).toContain("<BodyView colorOf={colorOf} picked={null} onPick={() => {}} dark={dark} preview");
    expect(sec).toContain("data-recovery-pain");
    expect(sec).toContain("View all analytics");
    // measured vs estimated is said on the page and on each factor
    expect(sec).toContain('r.basis === "measured" ? "From your check-out and training" : "Estimated from your training"');
    expect(sec).toContain("data-factor-kind={f.kind}");
  });
  it("Programs (build, import, crew, my programs) are a secondary place: the Training plan's end and ⋯", () => {
    expect(wo).not.toMatch(/!isLoading && <ProgramsCard/);
    expect(wo).toContain('programs={mode === "self" ? <ProgramsCard isSelfServe={isSelfServe} /> : null}');
    expect(wo).toContain("data-menu-programs");
  });
});
