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
