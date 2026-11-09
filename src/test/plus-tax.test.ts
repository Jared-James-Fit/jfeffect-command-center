import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

// Nov 9 2026: the Add sale list read "$130.00 · Monthly subscription" while
// every product is priced before tax and checkout adds GST (5% on every
// payment since August). Prices say "+ tax" whenever the business charges it.
describe("product and payment prices say + tax while the business charges tax", () => {
  it("one yes / no from the owner's tax settings, readable by any signed-in person", () => {
    const sql = read("supabase/migrations/20270221090000_business_charges_tax.sql");
    expect(sql).toContain("select coalesce((select bool_or(gst_registered) from public.business_tax_settings), false)");
    expect(sql).toContain("grant execute on function public.business_charges_tax() to authenticated;");
    expect(sql).toContain("revoke all on function public.business_charges_tax() from public, anon;");
    const hook = read("src/hooks/use-charges-tax.ts");
    expect(hook).toContain('rpc("business_charges_tax")');
    expect(hook).toContain("return data === true;");
  });

  it("the label shows only while tax is on", () => {
    const label = read("src/components/billing/plus-tax.tsx");
    expect(label).toContain("if (!on) return null;");
    expect(label).toContain(" + tax</span>");
  });

  it("every product picker, the products page, the sale screen and the chat payment card use it", () => {
    for (const f of [
      "src/components/clients/add-sale-dialog.tsx",
      "src/components/clients/quick-sell-sheet.tsx",
      "src/components/schedule/session-sale-picker.tsx",
      "src/components/price-card-picker-dialog.tsx",
      "src/route-pages/_authenticated/admin/payment-links.tsx",
      "src/components/assign-offer-dialog.tsx",
      "src/components/payment-request-card.tsx",
    ]) expect(read(f), f).toContain("<PlusTax");
    // no hard-coded "+ tax" left on the payment card
    expect(read("src/components/payment-request-card.tsx")).not.toContain('text-muted-foreground">+ tax</span>');
    expect(read("src/components/clients/add-sale-dialog.tsx")).toContain('<Label>Price{chargesTax ? " before tax" : ""}</Label>');
  });
});
