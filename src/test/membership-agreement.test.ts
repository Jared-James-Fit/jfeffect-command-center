import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEMBERSHIP_AGREEMENT_ACKS, membershipAckText } from "@/lib/membership-agreement/acks";

const read = (p: string) => readFileSync(p, "utf8");

describe("JF members sign their own Membership Agreement, never the Coaching Agreement", () => {
  it("every tick is required and recorded word for word", () => {
    expect(membershipAckText(["terms", "health"])).toBeNull();
    const text = membershipAckText(MEMBERSHIP_AGREEMENT_ACKS.map((a) => a.id))!;
    for (const a of MEMBERSHIP_AGREEMENT_ACKS) expect(text).toContain(a.text);
  });

  it("the server only takes a member's signature on the live version, with their typed name and the exact text", () => {
    const fn = read("src/lib/membership-agreement.functions.ts");
    expect(fn).toContain('if (!client || (client as any).service_tier !== "self_serve") return { applicable: false as const };');
    expect(fn).toContain("if (!current || current.id !== data.versionId) {");
    expect(fn).toContain('signature_method: "typed_name",');
    expect(fn).toContain("rendered_snapshot: current.body,");
    // checkout's box accepts the terms; v3+ also needs the in-app signature
    expect(fn).toContain("needsSigning: !signed && current.version_number >= IN_APP_SIGNING_FROM_VERSION,");
  });

  it("the prompt waits for setup, never shows in View as client, and the Account page keeps the copy", () => {
    const route = read("src/routes/_authenticated/portal/route.tsx");
    expect(route).toContain("{!isImpersonating && <MemberAgreementGate />}");
    const gate = read("src/components/member/member-agreement.tsx");
    expect(gate).toContain("data.needsSigning && setup?.complete !== false");
    expect(read("src/routes/_authenticated/portal/account.tsx")).toContain("{!isImpersonating && <MemberAgreementCard />}");
  });

  it("the Coaching Agreement refuses a member wherever it can be reached (/setup, signing, a coach's request)", () => {
    const fn = read("src/lib/coaching-agreement.functions.ts");
    expect(fn).toContain('if (client.service_tier === "self_serve") throw new Error("JF Membership accounts don\'t sign the Coaching Agreement.");');
    expect(fn).toContain('if ((client as any).service_tier === "self_serve") throw new Error("JF Membership accounts don\'t sign the Coaching Agreement.");');
    expect(fn).toContain("they accept the Membership Agreement in the app, not the Coaching Agreement.");
  });

  it("checkout names every document it records", () => {
    const page = read("src/route-pages/membership.tsx");
    expect(page).toContain('<DocLink slug="terms-of-service">Terms of Service</DocLink>');
    expect(page).toContain("I agree to the JF Membership Agreement, Terms of Service, recurring billing, and cancellation policy");
  });

  it("v3 goes in as a draft for the owner to review and publish, with the release and health terms", () => {
    const sql = read("supabase/migrations/20261213090000_member_plan_schedule_agreement_nutrition.sql");
    expect(sql).toContain("SELECT d.id, 3, 'draft', 'JF Membership Agreement',");
    expect(sql).toContain("'typed_name', true, 'all_clients', DATE '2026-10-18', true,");
    expect(sql).toContain("7. Assumption of Risk");
    expect(sql).toContain("This includes claims related to negligence, where permitted by law");
    expect(sql).toContain("$29 USD per month plus applicable taxes");
  });
});

describe("one committed schedule for members", () => {
  const sql = read("supabase/migrations/20261213090000_member_plan_schedule_agreement_nutrition.sql");
  it("clients is the schedule; app_members mirrors it and never fails the save", () => {
    expect(sql).toContain("AFTER INSERT OR UPDATE OF committed_training_days, committed_training_frequency ON public.clients");
    expect(sql).toContain("RAISE WARNING 'clients_sync_committed_days_to_member: %', SQLERRM;");
  });
});
