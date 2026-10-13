import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { isCoachingOnlyPath, isLapsedMemberPath, tierAllows } from "@/lib/service-tier";
import { memberPathToPortal } from "@/lib/member-redirect";
import { selfServeBottomNav, selfServeNav } from "@/lib/admin-nav";

const read = (p: string) => readFileSync(p, "utf8");

describe("one athlete record, the service tier decides the coach's layer", () => {
  it("coaching keeps the human layer; members keep their own screens; tools are shared", () => {
    for (const k of ["coach_chat", "custom_programming", "check_ins", "lift_review", "coach_notes", "agreements", "pt_sessions", "goals_setup", "purchases"] as const) {
      expect(tierAllows("coaching", k)).toBe(true);
      expect(tierAllows("self_serve", k)).toBe(false);
    }
    for (const k of ["membership_billing", "plan_library", "support_inbox"] as const) {
      expect(tierAllows("self_serve", k)).toBe(true);
      expect(tierAllows("coaching", k)).toBe(false);
    }
  });

  it("members are sent home from the coach's screens, and a lapsed member can still fix billing", () => {
    expect(isCoachingOnlyPath("/portal/messages")).toBe(true);
    expect(isCoachingOnlyPath("/portal/check-ins/abc")).toBe(true);
    expect(isCoachingOnlyPath("/portal/agreements")).toBe(true);
    expect(isCoachingOnlyPath("/portal/workouts")).toBe(false);
    expect(isCoachingOnlyPath("/portal/community")).toBe(false);
    expect(isLapsedMemberPath("/portal/membership")).toBe(true);
    expect(isLapsedMemberPath("/portal/support")).toBe(true);
    expect(isLapsedMemberPath("/portal/workouts")).toBe(false);
  });

  it("members get the same app with Crew in the middle, Support instead of Messages", () => {
    const paths = selfServeNav.map((i) => i.to);
    expect(paths).toEqual(expect.arrayContaining(["/portal", "/portal/workouts", "/portal/plans", "/portal/community", "/portal/support", "/portal/membership", "/portal/nutrition-targets"]));
    expect(paths.some((p) => isCoachingOnlyPath(p))).toBe(false);
    expect(selfServeBottomNav.map((i) => i.to)).toEqual(["/portal", "/portal/workouts", "/portal/community", "/portal/nutrition-targets", "/portal/support"]);
    expect(selfServeBottomNav.find((i) => i.to === "/portal/community")?.featured).toBe(true);
  });
});

describe("/m lands on the same screen in the portal", () => {
  it("maps every member path, keeps the Fillout landing", () => {
    expect(memberPathToPortal("/m")).toBe("/portal");
    expect(memberPathToPortal("/m/")).toBe("/portal");
    expect(memberPathToPortal("/m/billing")).toBe("/portal/membership");
    expect(memberPathToPortal("/m/upgrade")).toBe("/portal/upgrade");
    expect(memberPathToPortal("/m/support")).toBe("/portal/support");
    expect(memberPathToPortal("/m/plans/abc")).toBe("/portal/plans/abc");
    expect(memberPathToPortal("/m/resources/guide")).toBe("/portal/resources/guide");
    expect(memberPathToPortal("/m/nutrition/r1")).toBe("/portal/recipes/r1");
    expect(memberPathToPortal("/m/workouts/e/1/2")).toBe("/portal/workouts");
    expect(memberPathToPortal("/m/forms/x/complete")).toBeNull();
    const layout = read("src/routes/_authenticated/m/route.tsx");
    expect(layout).toContain("navigate({ href: `${target}${searchStr ?? \"\"}`, replace: true })");
  });

  it("signup, login and Stripe returns all land in the portal", () => {
    expect(read("src/routes/m.welcome.tsx")).not.toContain('navigate({ to: "/m"');
    expect(read("src/routes/auth.tsx")).toContain('role === "member" || role === "client" ? "/portal"');
    const billing = read("src/lib/jf-billing.functions.ts");
    expect(billing).toContain("/portal/membership?restarted=1");
    expect(read("src/lib/member-checkout.functions.ts")).toContain("/portal?upgrade=success");
  });
});

describe("the database side", () => {
  const sql = read("supabase/migrations/20261124090000_member_service_tier.sql");

  it("members get a self_serve client row on signup, never touching a real coaching client", () => {
    expect(sql).toContain("CHECK (service_tier IN ('coaching', 'self_serve'))");
    expect(sql).toContain("AFTER INSERT OR UPDATE OF account_type, user_id ON public.app_members");
    expect(sql).toContain("'Member', 'self_serve', 'Account Created'");
    expect(sql).toContain("IF v_status = 'Lead' AND v_coach IS NULL THEN");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.ensure_my_member_client() TO authenticated");
  });

  it("only an admin (or the server) changes the tier", () => {
    expect(sql).toContain("BEFORE UPDATE OF service_tier ON public.clients");
    expect(sql).toContain("Only an admin can change a client''s service tier");
  });

  it("weekly check-ins, the client directory and the dashboard roster are coaching-only", () => {
    for (const fn of ["seed_messenger_checkin_occurrences()", "admin_clients_directory(", "admin_dashboard_overview()"]) expect(sql).toContain(fn);
    expect(sql).toContain("and c.service_tier = ''coaching''");
  });
});

describe("the app keeps the coach's layer to coaching clients", () => {
  it("home hides the agreement, coaching setup, PT sessions and check-in bootstrapping from members", () => {
    const home = read("src/routes/_authenticated/portal/index.tsx");
    expect(home).toContain("const coaching = !isSelfServe && !tierLoading;");
    expect(home).toContain("if (!client?.id || !coaching) return;");
    expect(home).toMatch(/\{coaching && \(\s*<SectionErrorBoundary label="Coaching agreement">/);
  });

  it("server-side too: no check-ins, no coaching agreement, out of coach intel / billing / agreement roster", () => {
    expect(read("src/lib/action-centre.functions.ts")).toContain('reason: "self_serve" as const');
    expect(read("src/lib/messenger-checkins.functions.ts")).toContain('if ((tierRow as any)?.service_tier === "self_serve") return { ok: false as const, created: 0 };');
    expect(read("src/lib/coaching-agreement.functions.ts")).toContain('reason: "self_serve" };');
    expect(read("src/lib/coaching-agreement.functions.ts")).toContain('.eq("service_tier", "coaching")');
    expect(read("src/lib/coach-intel.ts")).toContain('.eq("service_tier", "coaching")');
    expect(read("src/lib/billing-sources.functions.ts")).toContain('.eq("service_tier", "coaching")');
  });

  it("Admin → Members still lists members (their own client row doesn't hide them); one step to coaching", () => {
    expect(read("src/lib/members.functions.ts")).toContain('supabaseAdmin.from("clients").select("user_id, email").eq("service_tier", "coaching")');
    expect(read("src/lib/members.functions.ts")).toContain('update({ service_tier: "coaching", status: "New Client", assigned_coach_id: data.coachId } as any)');
    expect(read("src/route-pages/_authenticated/admin/members.$memberId.tsx")).toContain('<MoveToCoachingCard memberId={memberId} />');
  });

  it("member screens moved into the portal; resources are shared, coaching clients see everything", () => {
    for (const f of ["support", "membership", "upgrade", "tools", "resources.index", "resources.$slug"]) {
      expect(read(`src/routes/_authenticated/portal/${f}.tsx`)).toContain('createFileRoute("/_authenticated/portal/');
    }
    expect(read("src/lib/member-resources.functions.ts")).toContain("locked: !coaching && !accessKeys.includes(r.required_access_level)");
    expect(read("src/routes/_authenticated/portal/nutrition-targets.tsx")).toContain('tier === "self_serve" ? <MemberNutritionPage /> : <PortalNutrition />');
  });
});
