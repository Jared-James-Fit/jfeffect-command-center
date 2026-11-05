import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { clientNav, selfServeNav } from "@/lib/admin-nav";
import { buildInternalNavCollapsed } from "@/lib/internal-nav";

const read = (f: string) => readFileSync(f, "utf8");

// Pages nobody used (from the data, Nov 2026): 0 broadcasts ever, 0 client action
// requests, 1 resource ("Configure Fillout"), 3 blank "New Event"s, and pages that
// were only ever "coming soon" or a one-time launch / migration tool.
const REDIRECTS: Array<[file: string, to: string]> = [
  ["portal/announcements.tsx", "/portal"],
  ["portal/resources.index.tsx", "/portal"],
  ["portal/resources.$slug.tsx", "/portal"],
  ["admin/broadcasts.tsx", "/admin/communication"],
  ["admin/broadcasts.$broadcastId.tsx", "/admin/communication"],
  ["admin/client-action-requests.tsx", "/admin/coaching"],
  ["admin/events.index.tsx", "/admin/calendar"],
  ["admin/events.format-guide.tsx", "/admin/calendar"],
  ["admin/business-systems.tsx", "/admin/team"],
  ["admin/sops.tsx", "/admin/settings"],
  ["admin/membership.stripe-sync.tsx", "/admin/membership"],
  ["admin/membership.launch-readiness.tsx", "/admin/membership"],
  ["admin/membership.refund-policy.tsx", "/admin/membership/checkout-settings"],
  ["admin/legacy-migration.tsx", "/admin/clients"],
  ["admin/content-ideas.tsx", "/admin"],
  ["admin/testimonials.tsx", "/admin"],
  ["admin/programs.tsx", "/admin/programming"],
  ["admin/membership.challenges.tsx", "/admin/membership"],
  ["admin/membership.welcome-messages.tsx", "/admin/membership"],
  ["admin/membership.promo-tools.tsx", "/admin/membership"],
];

describe("pages nobody used are gone, and their old addresses never 404", () => {
  it("each old address only redirects to the closest live page", () => {
    for (const [file, to] of REDIRECTS) {
      const src = read(`src/routes/_authenticated/${file}`);
      expect(src, file).toContain(`throw redirect({ to: "${to}", replace: true });`);
      expect(src, file).not.toContain("component:");
    }
  });

  it("their code is deleted, not just hidden", () => {
    for (const f of [
      "src/lib/broadcasts.ts",
      "src/components/broadcast-composer.tsx",
      "src/components/broadcast-media-player.tsx",
      "src/components/broadcast-popup-gate.tsx",
      "src/components/events/event-popup-gate.tsx",
      "src/lib/client-action-requests.ts",
      "src/components/client-action-request-composer.tsx",
      "src/components/client-action-request-modal.tsx",
      "src/route-pages/_authenticated/admin/broadcasts.tsx",
      "src/route-pages/_authenticated/admin/client-action-requests.tsx",
      "src/route-pages/_authenticated/admin/events.index.tsx",
      "src/route-pages/_authenticated/admin/business-systems.tsx",
      "src/lib/member-resources.functions.ts",
    ]) {
      expect(existsSync(f), f).toBe(false);
    }
    expect(read("src/lib/launch-readiness.functions.ts")).not.toContain("getLaunchReadiness");
  });

  it("no menu, tab, palette or search lists them", () => {
    for (const nav of [clientNav, selfServeNav]) {
      const tos = nav.map((n) => n.to);
      expect(tos).not.toContain("/portal/announcements");
      expect(tos).not.toContain("/portal/resources");
    }
    const gone = [
      "/admin/broadcasts", "/admin/client-action-requests", "/admin/events", "/admin/business-systems", "/admin/sops",
      "/admin/membership/stripe-sync", "/admin/membership/launch-readiness", "/admin/membership/refund-policy",
    ];
    for (const role of ["admin", "coach"] as const) {
      const all = buildInternalNavCollapsed(role).flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)]);
      for (const to of gone) expect(all, `${role} ${to}`).not.toContain(to);
    }
    const palette = read("src/lib/admin-route-registry.ts");
    for (const to of gone) expect(palette).not.toContain(`to: "${to}`);
    expect(read("src/components/settings/settings-tabs.tsx")).not.toContain("/admin/sops");
    expect(read("src/lib/global-search.functions.ts")).not.toContain('from("broadcasts")');

    expect(read("src/routes/_authenticated/admin/communication.tsx")).not.toContain('value: "broadcasts"');
    expect(read("src/routes/_authenticated/admin/coaching.tsx")).not.toContain('value: "requests"');
    expect(read("src/routes/_authenticated/admin/team.tsx")).not.toContain('value: "operations"');
    expect(read("src/routes/_authenticated/admin/calendar.tsx")).toContain('const TAB_VALUES = ["board", "booking", "sessions", "upcoming"] as const;');
  });

  it("clients no longer load popups that could never have anything in them", () => {
    const layout = read("src/routes/_authenticated/portal/route.tsx");
    expect(layout).not.toContain("BroadcastPopupGate");
    expect(layout).not.toContain("EventPopupGate");
    expect(read("src/routes/_authenticated/portal/index.tsx")).not.toContain("ClientActionRequestModal");
    const popups = read("src/route-pages/_authenticated/admin/popups.tsx");
    expect(popups).not.toContain('from("broadcasts")');
    expect(popups).not.toContain('from("events")');
  });
});

// Round 3 (Nov 5 2026), from the data: native agreement packages 0 ever sent or
// signed; Training Phases 7 rows all made Jun 9 and never touched; the client's
// Check-Ins & Forms list only repeated what the coach chat sends, and its
// "Check-In Responses" were last written Aug 13; the client's Agreements page was
// Account's Coaching Agreement card again (its one SignNow record never sent).
describe("round 3: dead pages gone, live forms still open", () => {
  const REDIRECTS_3: Array<[file: string, to: string]> = [
    ["_authenticated/portal/check-ins.tsx", "/portal/messages"],
    ["_authenticated/portal/check-in.tsx", "/portal/messages"],
    ["_authenticated/portal/media.tsx", "/portal/progress"],
    ["_authenticated/portal/agreements-native.$packageId.tsx", "/portal/account"],
    ["_authenticated/admin/training-phases.tsx", "/admin/programming"],
    ["_authenticated/admin/agreements-native.index.tsx", "/admin/coaching-agreements"],
    ["_authenticated/admin/agreements-native.new.tsx", "/admin/coaching-agreements"],
    ["_authenticated/admin/agreements-native.$packageId.tsx", "/admin/coaching-agreements"],
    ["sign.$token.tsx", "/"],
  ];

  it("each old address only redirects", () => {
    for (const [file, to] of REDIRECTS_3) {
      const src = read(`src/routes/${file}`);
      expect(src, file).toContain(`throw redirect({ to: "${to}", replace: true });`);
      expect(src, file).not.toContain("component:");
    }
  });

  it("a form opens on its own page, not under the list (which had no outlet)", () => {
    const form = read("src/routes/_authenticated/portal/check-ins_.$formId.tsx");
    expect(form).toContain('createFileRoute("/_authenticated/portal/check-ins_/$formId")');
    expect(form).toContain("<ClientFormRenderer formId={formId} />");
    expect(existsSync("src/routes/_authenticated/portal/check-ins.$formId.tsx")).toBe(false);
    const tree = read("src/routeTree.gen.ts");
    expect(tree).not.toContain("AuthenticatedPortalCheckInsRouteWithChildren");
    expect(read("src/components/forms/client-form-renderer.tsx")).not.toContain('"/portal/check-ins"');
  });

  it("/portal/agreements lands on Account's agreement and ?sign=1 still opens signing", () => {
    const src = read("src/routes/_authenticated/portal/agreements.index.tsx");
    expect(src).toContain('{ to: "/portal/account", hash: "coaching-agreement", replace: true }');
    expect(src).toContain('if (search.sign !== "1") throw redirect(ACCOUNT_AGREEMENT);');
    expect(src).toContain("if (needsSignature && canSign) openSignFlow();");
  });

  it("their code is deleted", () => {
    for (const f of [
      "src/route-pages/_authenticated/portal/check-ins.tsx",
      "src/lib/training-phases.ts",
      "src/components/phase-dialog.tsx",
      "src/components/portal/training-block-card.tsx",
      "src/lib/native-agreements.functions.ts",
      "src/lib/native-agreement-client.functions.ts",
      "src/lib/native-agreements-pdf.server.ts",
      "src/lib/native-agreement-contract.ts",
    ]) expect(existsSync(f), f).toBe(false);
  });

  it("the client app no longer reads tables nothing writes", () => {
    const badges = read("src/hooks/use-client-nav-badges.ts");
    expect(badges).not.toContain('"training_phases"');
    expect(badges).not.toContain('"media_comments"');
    expect(read("src/routes/_authenticated/portal/index.tsx")).not.toContain('"training_phases"');
  });

  it("menus drop them; set-once pages are search-only", () => {
    const tos = clientNav.map((n) => n.to);
    expect(tos).not.toContain("/portal/check-ins");
    expect(tos).not.toContain("/portal/agreements");
    const admin = buildInternalNavCollapsed("admin");
    const listed = admin.flatMap((i) => [i.to, ...(i.children ?? []).filter((c) => !c.searchOnly).map((c) => c.to)]);
    const found = admin.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)]);
    for (const to of [
      "/admin/crm", "/admin/crm/contacts", "/admin/popups", "/admin/onboarding", "/admin/feature-flags", "/admin/archives",
      "/admin/membership/billing-events", "/admin/membership/calendar", "/admin/membership/setup-links",
      "/admin/membership/reset-links", "/admin/membership/onboarding-email", "/admin/membership/notifications",
      "/admin/membership/access-checklist", "/admin/membership/signup-link",
    ]) {
      expect(listed, to).not.toContain(to);
      expect(found, to).toContain(to);
    }
    const palette = read("src/lib/admin-route-registry.ts");
    expect(palette).not.toContain('to: "/admin/training-phases"');
    expect(palette).not.toContain('to: "/admin/agreements-native"');
  });
});
