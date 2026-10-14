import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("a coach opens the client's workout from a session", () => {
  it("the session sheet leads with Open <first>'s workout, into client view on that day", () => {
    const sheet = read("src/components/schedule/session-actions-sheet.tsx");
    expect(sheet).toContain("Open {first}'s workout");
    expect(sheet).toContain("pov.enter(session.client_id, { to: `/portal/workouts?open=${session.session_date}`");
    // Only when client view is allowed (not a view-only login or a preview).
    expect(sheet).toContain("{pov.canPov && (");
  });

  it("entering client view is one shared hook, with a full page load and a way back", () => {
    const hook = read("src/components/clients/use-enter-client-pov.ts");
    expect(hook).toContain("impersonation.start(");
    expect(hook).toContain("window.location.pathname + window.location.search");
    expect(hook).toContain('window.location.href = opts.to ?? "/portal";');
  });

  it("the Workouts page opens ?open=<date>'s workout once, the way its card's main button would", () => {
    const route = read("src/routes/_authenticated/portal/workouts.index.tsx");
    expect(route).toContain("validateSearch");
    expect(route).toContain("openDate={open ?? null}");
    const exp = read("src/components/workouts/WorkoutsExperience.tsx");
    expect(exp).toContain("handledOpenDates.has(openDate)");
    expect(exp).toContain("if (onDay.length !== 1) return;");
    expect(exp).toContain("const cta = primaryCtaFor(item, getWorkoutStatus(item).status);");
    // Waits for the client's training days, or dates could resolve wrong.
    expect(exp).toContain("isLoading || !clientFetched");
  });
});
