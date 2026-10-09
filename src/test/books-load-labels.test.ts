import { describe, it, expect } from "vitest";
import { loadBooksData } from "@/lib/business-books.server";

// Fake RLS-scoped client: table reads return canned rows, rpc() answers the
// two books functions. Records which tables were read.
function fakeSupabase(opts: { labelsError?: boolean } = {}) {
  const reads: string[] = [];
  const rows: Record<string, any[]> = {
    business_tax_settings: [],
    payment_ledger: [{
      id: "l1", txn_type: "payment", method: "card", amount_minor: 11300, tax_minor: 1300, currency: "CAD",
      transaction_date: "2026-03-01", voided: false, reversal_of: null, stripe_mode: "live",
      client_id: "c1", purchase_id: "p1",
    }],
    member_payment_ledger: [{
      id: "m1", amount_cents: 2000, currency: "CAD", payment_date: "2026-03-02", status: "succeeded",
      payment_method: "stripe", stripe_mode: "live", service_product: "JF Membership", member_id: "mem1",
    }],
    business_expenses: [],
    business_tax_payments: [],
  };
  const sb: any = {
    reads,
    from(table: string) {
      reads.push(table);
      const res = { data: table === "business_tax_settings" ? null : rows[table], error: null };
      const q: any = { select: () => q, order: () => q, limit: () => q, maybeSingle: async () => res, then: (r: any) => r(res) };
      return q;
    },
    async rpc(fn: string, args: any) {
      if (fn === "books_open_sales") {
        expect(args._statuses).toContain("Unpaid");
        return { data: [{ id: "p2", offer_name: "Coaching", payment_status: "Unpaid", amount_outstanding_cents: 5000, created_at: "2026-03-03T00:00:00Z", client_full_name: "Alex" }], error: null };
      }
      if (fn === "books_labels") {
        expect(args).toEqual({ _client_ids: ["c1"], _purchase_ids: ["p1"], _member_ids: ["mem1"] });
        if (opts.labelsError) return { data: null, error: { message: "Forbidden" } };
        return { data: { clients: { c1: "Alex Client" }, purchases: { p1: "Coaching 12wk" }, members: { mem1: "Mo Member" } }, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return sb;
}

describe("loadBooksData", () => {
  it("never reads client, member or purchase tables directly (finance can't)", async () => {
    const sb = fakeSupabase();
    await loadBooksData(sb);
    for (const t of ["clients", "app_members", "purchase_records"]) expect(sb.reads).not.toContain(t);
  });

  it("puts payer names and open sales back from the books functions", async () => {
    const data = await loadBooksData(fakeSupabase());
    const json = JSON.stringify(data.revenue);
    expect(json).toContain("Alex Client");
    expect(json).toContain("Mo Member");
    expect(data.openSales).toEqual([{ id: "p2", client: "Alex", offer: "Coaching", status: "Unpaid", outstandingMinor: 5000, createdOn: "2026-03-03" }]);
  });

  it("still returns the numbers when names can't be loaded", async () => {
    const data = await loadBooksData(fakeSupabase({ labelsError: true }));
    expect(data.revenue.length).toBeGreaterThan(0);
  });
});
