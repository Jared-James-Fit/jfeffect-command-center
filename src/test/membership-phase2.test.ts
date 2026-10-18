import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeTrainingDays } from "@/lib/member-plan-start.functions";
import { memberPathToPortal } from "@/lib/member-redirect";

const read = (p: string) => readFileSync(p, "utf8");

describe("one program system: a member's Start plan runs the coach's assign engine", () => {
  const sql = read("supabase/migrations/20261125090000_member_library_plans.sql");

  it("only the member, on their own self-serve row, with live access, for a live library plan", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.member_can_start_plan(p_client_id uuid, p_template_id uuid)");
    expect(sql).toContain("AND c.user_id = (SELECT auth.uid())");
    expect(sql).toContain("AND c.service_tier = 'self_serve'");
    expect(sql).toContain("AND public.member_can_consume((SELECT auth.uid()))");
    expect(sql).toContain("AND p.status = 'Published'");
    expect(sql).toContain("AND p.membership_status = 'live'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.member_can_start_plan(uuid, uuid) FROM PUBLIC, anon, authenticated;");
  });

  it("the engine gains one caller, patched in place (anchor exactly once, idempotent)", () => {
    expect(sql).toContain("OR public.is_assigned_coach(p_client_id) OR public.member_can_start_plan(p_client_id, p_template_id)) THEN");
    expect(sql).toContain("auth anchor not found exactly once");
    expect(sql).toContain("IF position('member_can_start_plan' in v_def) > 0 THEN");
  });

  it("links the library plans' exercises inside those templates only, never by a global alias", () => {
    expect(sql).toContain("('Bench Press', 'Barbell Bench Press')");
    expect(sql).toContain("public.resolve_exercise_id(_name)");
    expect(sql).toContain("WHERE tp.id IN (SELECT source_template_id FROM public.member_plans WHERE source_template_id IS NOT NULL)");
    expect(sql).toContain("IF k = 'rows' AND jsonb_typeof(v) = 'array' THEN");
    expect(sql).toContain("nullif(e ->> 'exercise_id', '') IS NULL");
    expect(sql).not.toMatch(/INSERT INTO public\.exercise_aliases/i);
  });

  it("start dialog days ('Mon') are saved as committed days ('Monday'), in week order, no repeats", () => {
    expect(normalizeTrainingDays(["Thu", "mon", "Monday", "x"])).toEqual(["Monday", "Thursday"]);
    expect(normalizeTrainingDays(["sunday", "Sat"])).toEqual(["Saturday", "Sunday"]);
    expect(normalizeTrainingDays(undefined)).toEqual([]);
  });

  it("the server calls the RPC as the member, owns what they started, and archives (never deletes) a replaced plan", () => {
    const fn = read("src/lib/member-plan-start.functions.ts");
    expect(fn).toContain('(client as any).service_tier !== "self_serve"');
    expect(fn).toContain('await (supabase as any).rpc("pl_assign_template_to_client", {');
    expect(fn).toContain('p_placement: { mode: "standalone_block" }');
    expect(fn).toContain('.update({ created_by: userId } as any).eq("prep_id", result.prep_id)');
    expect(fn).toContain('.eq("created_by", userId)');
    expect(fn).toContain("return { conflict: true as const, currentName: running[0].name };");
    expect(fn).toContain('status: "Archived", archived: true');
    expect(fn).not.toMatch(/\.delete\(/);
    expect(fn).toContain("realignClientToCommittedDays({ clientId: (client as any).id, userId, role: \"client\", includePinned: false })");
  });
});

describe("the Plan Library lives in the portal", () => {
  it("/m/plans lands on the portal library and detail", () => {
    expect(memberPathToPortal("/m/plans")).toBe("/portal/plans");
    expect(memberPathToPortal("/m/plans/abc")).toBe("/portal/plans/abc");
  });

  it("library and detail start plans through one dialog, preview from the real payload shape", () => {
    const lib = read("src/route-pages/_authenticated/portal/plans.tsx");
    expect(read("src/routes/_authenticated/portal/plans.index.tsx")).toContain('createFileRoute("/_authenticated/portal/plans/")');
    expect(lib).toContain('previewTo={{ to: "/portal/plans/$planId", params: { planId: p.id } }}');
    expect(lib).toContain("<StartPlanDialog plan={starting}");
    expect(lib).toContain("if (isCoaching) return <CoachWritesYourProgram />;");
    expect(lib).not.toContain("/portal/goals-setup");
    const detail = read("src/routes/_authenticated/portal/plans.$planId.tsx");
    expect(detail).toContain('createFileRoute("/_authenticated/portal/plans/$planId")');
    expect(detail).toContain("flatBlocks(plan?.published_payload)");
    expect(detail).not.toContain("published_payload?.weeks_data");
    const dialog = read("src/components/programs/start-plan-dialog.tsx");
    expect(dialog).toContain("startLibraryPlan");
    expect(dialog).toContain('navigate({ to: "/portal/workouts" })');
    expect(dialog).toContain("disabled={pending || isImpersonating || !plan || !daysReady}");
  });

  it("a plan starts on the days they train: fitted to its workouts a week, saved as the committed schedule", () => {
    const fn = read("src/lib/member-plan-start.functions.ts");
    // every workout of the week gets a day, so none lands off the schedule
    expect(fn).toContain("if (perWeek && days.length && days.length !== perWeek) {");
    // the setup wizard's days count when the schedule has none yet
    expect(fn).toContain('.from("app_members")\n        .select("committed_training_days")');
    expect(fn).toContain('await writeCommittedDays({ clientId: (client as any).id, userId, role: "client", days: days as WeekDay[] });');
    const dialog = read("src/components/programs/start-plan-dialog.tsx");
    expect(dialog).toContain("const f = fitTrainingDays(mine, perWeek);");
    expect(dialog).toContain("const daysReady = perWeek ? short === 0 : true;");
    // the setup wizard's days are the committed schedule the calendar runs on
    const setup = read("src/lib/member-setup.functions.ts");
    expect(setup).toContain("await writeCommittedDays({ clientId: c.id, userId, role: \"client\", days });");
    expect(setup).toContain("await realignClientToCommittedDays({ clientId: c.id, userId, role: \"client\", includePinned: true });");
  });

  it("a member with no program is pointed at the library on Home and Workouts; coaching clients still wait on their coach", () => {
    const home = read("src/routes/_authenticated/portal/index.tsx");
    expect(home).toMatch(/\{client\?\.id && isSelfServe && \(\s*<SectionErrorBoundary label="Pick a plan">/);
    const workouts = read("src/components/workouts/WorkoutsExperience.tsx");
    expect(workouts).toContain('if (mode === "self") return <SelfEmptyState />;');
    expect(workouts).toContain("Your coach will publish your block soon.");
    expect(workouts).toContain('<Link to="/portal/plans">Browse plans</Link>');
  });
});
