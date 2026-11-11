import fs from "node:fs";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync("supabase/migrations/20270228090000_renewal_plus_tax.sql", "utf8");

describe("a renewal's description says + tax whenever the business charges it", () => {
  it("reads the business's tax setting, not only what was paid on the package it copies", () => {
    expect(sql).toContain("v_taxed := public.business_charges_tax()");
    expect(sql).toContain("COALESCE(x.amount_tax_paid_cents, 0) > 0");
    expect(sql).not.toContain("v_taxed := COALESCE(p.amount_tax_paid_cents, 0) > 0;");
  });

  it("keeps the renewal itself as it was: admin only, Unpaid, its sessions held from the start", () => {
    expect(sql).toContain("Only an admin can renew a package");
    expect(sql).toContain("'Unpaid', 'Active', 0, 0, 0,");
    expect(sql).toContain("'Renewal: sessions held from the start, paid as it goes'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.renew_session_package(uuid) FROM PUBLIC, anon;");
  });

  it("fixes Marc's package 4 words only while they're still exactly what the renewal wrote", () => {
    expect(sql).toContain("AND short_description = 'Renewal: 16 sessions for $640.00, paid in 4 payments of $160.00.'");
  });
});
