import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_CHECKOUT_NOTICE,
  AGREEMENT_PUBLIC_URL,
} from "@/lib/coaching-agreement/checkout-notice";

/**
 * Source-level checks that the Coaching Agreement stays plugged in everywhere it has to be
 * (the app has no DOM test environment, so these guard the wiring, not the pixels).
 */
const read = (path: string) => readFileSync(path, "utf8");

describe("client side wiring", () => {
  it("wraps the whole client app in the provider, so the popup and status reach every page", () => {
    const src = read("src/routes/_authenticated/portal/route.tsx");
    const open = src.indexOf("<CoachingAgreementProvider>");
    const close = src.indexOf("</CoachingAgreementProvider>");
    expect(open).toBeGreaterThan(-1);
    expect(open).toBeLessThan(src.indexOf("<AppShell"));
    expect(close).toBeGreaterThan(src.indexOf("</AppShell>"));
  });

  it("shows the dashboard card above the setup checklist, behind its own error boundary", () => {
    const src = read("src/routes/_authenticated/portal/index.tsx");
    const card = src.indexOf("<AgreementDashboardCard");
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(src.indexOf("<SetupChecklistBanner"));
    expect(src.slice(src.lastIndexOf("<SectionErrorBoundary", card), card)).toContain(
      "Coaching agreement",
    );
  });

  it("lets clients open the signed agreement from their account", () => {
    const src = read("src/routes/_authenticated/portal/account.tsx");
    expect(src).toContain("<AgreementAccountCard");
    expect(src).toContain('id="coaching-agreement"');
  });

  it("makes the agreement the first account-setup step, in the checklist and in the setup flow", () => {
    const checklist = read("src/components/portal/setup-checklist-banner.tsx");
    // unshift, not push: the agreement leads the checklist
    expect(checklist).toMatch(/base\.unshift\(\{\s*key: "agreement"/);
    const setup = read("src/routes/setup.tsx");
    expect(setup).toContain('phase === "agreement"');
    expect(setup).toContain("AgreementSignFlow");
  });

  it("keeps agreement status out of the on-device query cache", () => {
    const src = read("src/lib/query-persister.ts");
    const list = src.slice(src.indexOf("DO_NOT_PERSIST_PREFIXES"));
    expect(list).toContain('"coaching-agreement"');
  });

  it("serves the public copy outside the signed-in area", () => {
    expect(read("src/routes/coaching-agreement.tsx")).toContain(
      'createFileRoute("/coaching-agreement")',
    );
  });
});

describe("admin wiring", () => {
  it("adds the roster to the admin navigation and the command palette", () => {
    expect(read("src/lib/internal-nav.ts")).toContain('to: "/admin/coaching-agreements"');
    expect(read("src/lib/admin-route-registry.ts")).toContain('to: "/admin/coaching-agreements"');
  });

  it("keeps the old SignNow pages reachable but clearly marked as old", () => {
    expect(read("src/lib/internal-nav.ts")).toContain("SignNow Agreements (old)");
    expect(read("src/lib/admin-route-registry.ts")).toContain("SignNow Agreements (old)");
  });

  it("puts the per-client panel first in the client's agreements section", () => {
    const src = read("src/routes/_authenticated/admin/clients.$id.tsx");
    const panel = src.indexOf("<ClientAgreementPanel");
    expect(panel).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(src.indexOf("<AgreementStatusPanel"));
  });

  it("shows the client's real agreement status on purchases", () => {
    expect(read("src/components/purchase-agreement-status.tsx")).toContain("<ClientAgreementBadge");
    expect(read("src/routes/_authenticated/admin/purchases.$id.tsx")).toContain(
      "<ClientAgreementBadge",
    );
  });
});

describe("contract-with-payment is retired", () => {
  it("no longer offers to create a draft agreement when assigning an offer", () => {
    const src = read("src/components/assign-offer-dialog.tsx");
    expect(src).not.toContain("createAgreement");
    expect(src).not.toContain("agreement_templates");
    expect(src).not.toContain("Auto-create draft agreement");
  });

  it("no longer lets products, payment links or offers require a contract", () => {
    expect(read("src/components/products/new-product-modal.tsx")).not.toMatch(/agreement/i);
    const offerForm = read("src/components/offer-form.tsx");
    expect(offerForm).not.toContain('set("requires_agreement"');
    expect(offerForm).not.toContain('set("agreement_before_service"');
    expect(offerForm).not.toContain("default_agreement_template_id");
    const links = read("src/routes/_authenticated/admin/payment-links.tsx");
    expect(links).not.toContain("agreementRequired");
    expect(links).not.toContain("agreementTemplateId");
  });

  it("points at the agreement from every Stripe Checkout session it creates", () => {
    const src = read("src/lib/stripe-checkout.functions.ts");
    expect(src.match(/\.\.\.AGREEMENT_CHECKOUT_PARAMS/g) ?? []).toHaveLength(2);
    expect(AGREEMENT_CHECKOUT_NOTICE).toContain(`](${AGREEMENT_PUBLIC_URL})`);
    expect(AGREEMENT_PUBLIC_URL).toMatch(/\/coaching-agreement$/);
    expect(AGREEMENT_CHECKOUT_NOTICE.length).toBeLessThanOrEqual(1200);
  });
});

describe("database", () => {
  const sql = read("supabase/migrations/20261006030000_coaching_agreement.sql");
  const tables = [
    "coaching_agreement_versions",
    "coaching_agreement_signatures",
    "coaching_agreement_client_state",
    "coaching_agreement_events",
  ];

  it.each(tables)("locks down %s with row level security and read-only client access", (table) => {
    expect(sql).toContain(`alter table public.${table} enable row level security;`);
    expect(sql).toContain(`revoke all on public.${table} from anon, authenticated;`);
    expect(sql).toContain(`grant select on public.${table} to authenticated;`);
    expect(sql).not.toMatch(
      new RegExp(
        `grant\\s+(insert|update|delete|all)[^;]*public\\.${table}[^;]*to\\s+(anon|authenticated)`,
        "i",
      ),
    );
  });

  it("records a signature only through the service-role function", () => {
    expect(sql).toContain(
      "revoke all on function public.coaching_agreement_record_signature(jsonb) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.coaching_agreement_record_signature(jsonb) to service_role;",
    );
    expect(sql).toMatch(/security definer/i);
  });
});

describe("signing flow regressions found in the browser", () => {
  it("attaches the end-of-review observer only once the form (and its end marker) exists", () => {
    const src = read("src/components/coaching-agreement/agreement-sign-flow.tsx");
    const effect = src.slice(
      src.indexOf("const formReady"),
      src.indexOf("scrollRef.current?.scrollTo"),
    );
    expect(effect).toContain("!formReady");
    expect(effect).toMatch(/\[open, step, reviewedEnd, ctx, formReady\]/);
  });
});

describe("signed copy printing", () => {
  it("has print styles for the viewer's sheet", () => {
    const css = read("src/styles.css");
    expect(css).toContain("@media print");
    expect(css).toContain(".agreement-print-sheet");
    // Radix renders the sheet and overlay as direct children of <body>: hide siblings, keep the sheet.
    expect(css).toContain("> :not(.agreement-print-sheet):not(:has(.agreement-print-sheet))");
    expect(read("src/components/coaching-agreement/agreement-record-viewer.tsx")).toContain(
      "agreement-print-sheet",
    );
  });
});
