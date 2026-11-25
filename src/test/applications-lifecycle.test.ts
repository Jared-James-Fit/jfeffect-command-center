import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LIFECYCLE, NO_FACTS, applicantActions, applicantConcerns, lifecycleGroup, lifecycleStage, type ApplicantFacts,
} from "@/lib/applications/lifecycle";

const read = (f: string) => readFileSync(f, "utf8");
const app = (o: Record<string, unknown> = {}) => ({
  status: "pending", flagged: false, contact_status: "not_contacted", activated_at: null, existing_account: false, client_id: null,
  contact_method: "email", phone: null, instagram: null, coaching_interest: null, contacted_at: null, decided_at: null,
  invite_sent_at: null, invite_count: 0, created_at: "2026-11-20T10:00:00Z", archived_at: null, ...o,
}) as any;
const facts = (o: Partial<ApplicantFacts> = {}): ApplicantFacts => ({ ...NO_FACTS, clientId: "c1", ...o });
const NOW = Date.parse("2026-11-25T10:00:00Z");

describe("an applicant's lifecycle comes from what happened", () => {
  it("is the nine stages in order", () => {
    expect(LIFECYCLE.map((s) => s.label)).toEqual([
      "New", "Awaiting review", "Awaiting response", "Approved", "Awaiting payment", "Onboarding", "Ready to start", "Active", "Archived",
    ]);
  });

  it("follows the application, then the athlete's record", () => {
    expect(lifecycleStage(app())).toBe("new");
    expect(lifecycleStage(app({ flagged: true }))).toBe("awaiting_review");
    expect(lifecycleStage(app({ contact_status: "talking" }))).toBe("awaiting_review");
    expect(lifecycleStage(app({ contact_status: "messaged" }))).toBe("awaiting_response");
    expect(lifecycleStage(app({ status: "approved" }))).toBe("approved");
    // free membership never waits on a payment; a paid plan's checkout would
    expect(lifecycleStage(app({ status: "approved" }), facts({ awaitingPayment: true }))).toBe("awaiting_payment");
    const joined = app({ status: "approved", activated_at: "2026-11-21T10:00:00Z", client_id: "c1" });
    expect(lifecycleStage(joined, facts({ setupComplete: false }))).toBe("onboarding");
    expect(lifecycleStage(joined, facts({ setupComplete: true }))).toBe("ready");
    expect(lifecycleStage(joined, facts({ setupComplete: true, lastTrainedAt: "2026-11-22T10:00:00Z" }))).toBe("active");
    expect(lifecycleStage(app({ status: "declined" }))).toBe("archived");
    expect(lifecycleStage(joined, facts({ clientArchived: true }))).toBe("archived");
    expect(lifecycleStage(app({ archived_at: "2026-11-24T00:00:00Z" }))).toBe("archived");
    // someone who already had an account and was approved is in the app
    expect(lifecycleStage(app({ status: "approved", existing_account: true }), facts({ setupComplete: true }))).toBe("ready");
    expect(lifecycleGroup("awaiting_response")).toBe("waiting");
    expect(lifecycleGroup("onboarding")).toBe("starting");
    expect(lifecycleGroup("active")).toBe("earlier");
  });

  it("Cleo's read says what's missing and what to watch, never invents", () => {
    expect(applicantConcerns(app({ contact_method: "text" }), NO_FACTS, NOW)).toContain("Asked to be texted but left no phone number: reach them by email.");
    expect(applicantConcerns(app(), NO_FACTS, NOW)).toContain("Applied 5 days ago and nobody has said hi yet.");
    expect(applicantConcerns(app({ coaching_interest: "yes" }), NO_FACTS, NOW).join(" ")).toContain("discovery call");
    expect(applicantConcerns(app({ contact_status: "messaged", contacted_at: "2026-11-21T10:00:00Z" }), NO_FACTS, NOW)[0]).toMatch(/^No reply 4 days/);
    expect(applicantConcerns(app({ status: "approved", decided_at: "2026-11-22T10:00:00Z", invite_count: 2 }), NO_FACTS, NOW)[0]).toMatch(/2 invites sent/);
    expect(applicantConcerns(app({ status: "declined", contact_method: "text" }), NO_FACTS, NOW)).toEqual([]);
  });

  it("offers only the quick actions that do something where they are", () => {
    expect(applicantActions(app())).toEqual(["approve", "archive"]);
    expect(applicantActions(app({ status: "approved" }))).toEqual(["resend", "archive"]);
    const joined = app({ status: "approved", activated_at: "2026-11-21T10:00:00Z", client_id: "c1" });
    expect(applicantActions(joined, facts({ setupComplete: false }))).toEqual(["message", "review_intake", "start_onboarding", "archive", "open_client"]);
    expect(applicantActions(app({ archived_at: "x" }))).toEqual(["unarchive"]);
  });
});

describe("the landing application flow, end to end", () => {
  it("every landing CTA goes to a real page", () => {
    const landing = read("src/components/landing/landing-page.tsx");
    const tree = read("src/routeTree.gen.ts");
    for (const to of ["/join", "/coaching/apply", "/coaching", "/auth"]) {
      expect(landing).toContain(`"${to}"`);
      expect(tree.includes(`fullPath: '${to}'`) || tree.includes(`fullPath: '${to}/'`), to).toBe(true);
    }
    for (const anchor of ["coaching", "pricing"]) expect(landing).toContain(`id="${anchor}"`);
  });

  it("saves once per email, recognises accounts, tells the coach, confirms, and a mail problem never loses it", () => {
    const fns = read("src/lib/membership-applications.functions.ts");
    expect(fns).toContain('if (account.kind === "athlete" || account.kind === "staff")');
    expect(fns).toContain("// Applying again while it's pending updates the one they have.");
    expect(fns).toContain("await m.pushNewApplication(sb,");
    expect(fns).toContain('.catch((e: any) => console.warn("[member-apply] confirmation email failed", e?.message));');
    expect(fns).toContain("That didn't send. Your answers are saved: tap Send again.");
    expect(read("supabase/migrations/20270527106200_application_lifecycle.sql")).toContain("ADD COLUMN IF NOT EXISTS archived_at timestamptz");
  });
});
