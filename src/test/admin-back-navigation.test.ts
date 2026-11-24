import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("admin back never bounces between two pages", () => {
  it("a page's back goes through the app's own history, else its fallback replacing", () => {
    const shell = read("src/components/app-shell.tsx");
    const fn = shell.slice(shell.indexOf("export function usePageBack"), shell.indexOf("export function usePageBack") + 500);
    expect(fn).toContain("router.history.canGoBack()");
    expect(fn).not.toContain("window.history.length");
    expect(fn).toContain("replace: true");
  });

  it("nothing links to the old Training Program page but the Training tab's All programs & blocks", () => {
    const callers = [
      "src/components/intel-actions.tsx",
      "src/components/assigned-programs-card.tsx",
      "src/components/program-planner/ProgramAssignmentPlanner.tsx",
      "src/components/analytics/client-analytics-dashboard.tsx",
      "src/components/analytics/graph-dot-detail.tsx",
      "src/components/analytics/training-time-card.tsx",
      "src/components/quick-assign-template-dialog.tsx",
      "src/components/messages/client-workout-peek.tsx",
      "src/route-pages/_authenticated/admin/clients.$id.tsx",
      "src/route-pages/_authenticated/admin/program-library.tsx",
      "src/components/program-intel/ProgramIntelligencePage.tsx",
      "src/components/program-intel/generator/workstation.tsx",
      "src/routes/_authenticated/admin/client-programs.$clientId.history.tsx",
    ];
    for (const f of callers) {
      const s = read(f);
      expect(s, f).not.toMatch(/client-programs\/\$clientId"/);
      expect(s, f).not.toContain("client-programs/${clientId}`");
    }
  });

  it("no push link labelled back on the program pages", () => {
    const legacy = read("src/routes/_authenticated/admin/client-programs.$clientId_.tsx");
    expect(legacy).not.toContain("Back to client");
    expect(read("src/routes/_authenticated/admin/client-programs.$clientId.history.tsx")).not.toContain("Back to programs");
  });
});
