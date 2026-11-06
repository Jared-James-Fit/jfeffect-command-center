import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { clientWorkoutHref } from "@/components/clients/use-enter-client-pov";
import { todayLocalISO } from "@/lib/today";

const read = (f: string) => readFileSync(f, "utf8");

describe("a coach gets into a client's workout in one tap", () => {
  it("client view on a day's workout is the Workouts page's ?open=<date>, today by default", () => {
    expect(clientWorkoutHref()).toBe(`/portal/workouts?open=${todayLocalISO()}`);
    expect(clientWorkoutHref("2026-11-06")).toBe("/portal/workouts?open=2026-11-06");
  });

  it("the Clients list card has Workout beside View Profile, only with client view allowed and a program", () => {
    const row = read("src/components/clients/client-row.tsx");
    expect(row).toContain("const canOpenWorkout = pov.canPov && !!(r.block_id || r.next_block_id);");
    expect(row).toContain("pov.enter(r.id, { to: clientWorkoutHref(), fallbackName: r.full_name })");
    expect(row).toContain("{canOpenWorkout && (");
    // It sits between View Profile and ⋯.
    const actions = row.slice(row.indexOf(">View Profile</ClientNameLink>"), row.indexOf("<ClientMoreMenu"));
    expect(actions).toContain("Workout");
  });

  it("the client profile shows View as client on a phone and Today's workout in ⋯", () => {
    const page = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
    // The overlay's header used to hide the button below sm, with nothing in ⋯ either.
    const embedded = page.slice(page.indexOf("function EmbeddedIdentityHeader("));
    expect(embedded).toContain('className="h-10 w-10 sm:hidden" aria-label="View as client"');
    expect(page).toContain("void pov.enter(id, { to: clientWorkoutHref(), fallbackName: form.full_name });");
    const menu = page.slice(page.indexOf("const moreMenu = ("), page.indexOf("const links = ["));
    expect(menu).toContain("Today's workout");
    // One way in for both: never a view-only login.
    expect(page).toContain("const canPov = pov.canPov;");
  });
});
