import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memberPathToPortal } from "@/lib/member-redirect";

const read = (p: string) => readFileSync(p, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("/m is only a redirect now (plus the Fillout landing)", () => {
  it("the old member screens are gone; an index and a catch-all keep every old link working", () => {
    expect(readdirSync("src/routes/_authenticated/m").sort()).toEqual(
      ["$.tsx", "forms.$assignmentId.complete.tsx", "index.tsx", "route.tsx"].sort(),
    );
    expect(read("src/routes/_authenticated/m/$.tsx")).toContain('createFileRoute("/_authenticated/m/$")');
    expect(read("src/routes/_authenticated/m/index.tsx")).toContain('createFileRoute("/_authenticated/m/")');
    expect(existsSync("src/route-pages/_authenticated/m")).toBe(false);
    for (const [from, to] of [
      ["/m/billing", "/portal/membership"],
      ["/m/workouts/e/1/2", "/portal/workouts"],
      ["/m/my-plans/abc", "/portal/workouts"],
      ["/m/nutrition/r1", "/portal/recipes/r1"],
      ["/m/anything-else", "/portal"],
    ]) expect(memberPathToPortal(from)).toBe(to);
    expect(read("src/routes/_authenticated/m/forms.$assignmentId.complete.tsx")).toContain('navigate({ to: "/portal" })');
  });

  it("no live screen links into /m any more", () => {
    const offenders = walk("src")
      .filter((f) => !f.startsWith(join("src", "test")) && !f.startsWith(join("src", "routes", "_authenticated", "m")) && !f.endsWith("routeTree.gen.ts"))
      .filter((f) => /\bto[=:]\s*["'`]\/m(\/|["'`])|href=\{?`\/m\//.test(read(f)));
    expect(offenders).toEqual([]);
    // members' recipes open in the portal
    expect(read("src/components/nutrition/CookbookContent.tsx")).toContain('const detailPath = "/portal/recipes/$recipeId";');
    expect(read("src/components/nutrition/RecipeBrowser.tsx")).toContain('const detailPath = "/portal/recipes/$recipeId";');
  });
});

describe("the member-only workout system is retired", () => {
  it("one workout adapter: everyone trains on the shared program system", () => {
    expect(existsSync("src/lib/workout-context/member-adapter.ts")).toBe(false);
    const ctx = read("src/lib/workout-context/index.ts");
    expect(ctx).not.toContain("createMemberAdapter");
    expect(ctx).toContain("return createClientAdapter(ref);");
  });

  it("no member start / log / complete / reschedule / enroll server functions remain", () => {
    const plans = read("src/lib/member-plans.functions.ts");
    for (const fn of ["startPlan", "restartPlan", "completeWorkout", "uncompleteWorkout", "logSet", "getEnrollmentSchedule", "rescheduleDay", "swapDays", "resetDaySchedule"]) {
      expect(plans).not.toContain(`export const ${fn} `);
    }
    for (const fn of ["createMemberPlan", "publishFromTemplate", "updateMemberPlan", "setPlanStatus", "duplicateMemberPlan", "deleteMemberPlan"]) {
      expect(plans).toContain(`export const ${fn} `);
    }
    const lib = read("src/lib/membership-library.functions.ts");
    expect(lib).not.toContain("export const enrollLibraryPlan");
    expect(lib).not.toContain("export const checkForUpdates");
    expect(lib).not.toContain('from("member_plan_enrollments")');
    expect(read("src/routes/_authenticated/admin/membership.calendar.tsx")).toContain('.eq("event_type", "import")');
  });

  it("the old tables become read-only history for members: write policies dropped, admin kept, nothing deleted", () => {
    const sql = read("supabase/migrations/20261126090000_member_workout_tables_read_only.sql");
    for (const p of [
      '"Member write own enrollments when active"',
      '"Member write own set logs when active"',
      '"Member write own completions when active"',
      '"Member insert own member_workout_reviews"',
      '"members manage own swaps"',
    ]) expect(sql).toContain(`DROP POLICY IF EXISTS ${p}`);
    expect(sql).toContain('CREATE POLICY "Members read own swaps" ON public.member_exercise_swaps\n  FOR SELECT');
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE|"Admin manage/i);
  });

  it("members get the one-time sex prompt in the portal too", () => {
    expect(read("src/routes/_authenticated/portal/index.tsx")).toContain('<SexPromptCard enabled={role === "client" || role === "member"} />');
  });
});
