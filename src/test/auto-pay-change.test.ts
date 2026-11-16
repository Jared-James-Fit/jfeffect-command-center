import { describe, expect, it } from "vitest";
import {
  autoPayOptions,
  beforeTax,
  changeProblem,
  changeSentence,
  paceAmount,
  paymentsToCover,
  priceLookupKey,
  setupMessage,
  stripeFirstCharge,
  structureText,
  withTax,
} from "@/lib/auto-pay";
import { depositLabel, needsAccount, paymentHow, pickableAccounts, proofPath, proofPathOk, proofProblem } from "@/lib/payment-proof";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const MARC = "5b3a1e1c-1111-4c2a-9a55-000000000001";

// Marc on Nov 16 2026: Package 2 carries a $168 bi-weekly auto-pay (Stripe's
// own next charge Nov 27), Package 3 is paid by his e-transfer, Package 4
// ($672) is owed and paid by nothing of its own.
const sales: any[] = [
  { id: "p2", sessions_purchased: 16, stripe_subscription_id: "sub_old", stripe_subscription_status: "active", installment_amount: 160, payment_frequency: "biweekly", next_billing_date: "2026-11-27" },
  { id: "p3", sessions_purchased: 16 },
  { id: "p4", sessions_purchased: 16, term_start_date: "2026-11-30", term_end_date: "2026-12-27", contract_value_cents: 64000 },
];
const p: any = {
  autoPay: { saleId: "p2", state: "on" },
  packages: [
    { saleId: "p2", label: "Package 2", balanceCents: 0, payment: "paid" },
    { saleId: "p3", label: "Package 3", balanceCents: 0, payment: "paid" },
    { saleId: "p4", label: "Package 4", balanceCents: 67200, payment: "scheduled" },
  ],
};

describe("auto-pay change", () => {
  it("starts from the running auto-pay and pays the package nothing else pays", () => {
    const o = autoPayOptions({ p, sales, rate: 0.05, today: "2026-11-16" });
    expect(o.current).toMatchObject({ saleId: "p2", subscriptionId: "sub_old", eachCents: 16000, eachWithTaxCents: 16800, every: "2 weeks", next: "2026-11-27" });
    expect(o.targets.map((t) => t.saleId)).toEqual(["p4"]);
    expect(o.target).toBe("p4");
    // The first payment lines up with the current one, so nothing changes until then.
    expect(o.firstDate).toBe("2026-11-27");
  });

  it("never offers the package carrying the current auto-pay, or one that pays itself", () => {
    const withLink = sales.map((s) => (s.id === "p4" ? { ...s, stripe_payment_link: "https://buy.stripe.com/x" } : s));
    expect(autoPayOptions({ p, sales: withLink, rate: 0.05, today: "2026-11-16" }).targets).toEqual([]);
  });

  it("with nothing running, starts a week out on an owed package", () => {
    const o = autoPayOptions({ p: { ...p, autoPay: null }, sales: sales.filter((s) => s.id !== "p2"), rate: 0.05, today: "2026-11-16" });
    expect(o.current).toBeNull();
    expect(o.target).toBe("p4");
    expect(o.firstDate).toBe("2026-11-23");
  });

  it("keeps pace with the training: a 4-week $672 package is $336 every 2 weeks", () => {
    expect(paceAmount({ totalWithTaxCents: 67200, from: "2026-11-30", to: "2026-12-27", every: "2 weeks" })).toBe(33600);
    expect(paceAmount({ totalWithTaxCents: 67200, from: null, to: "2026-12-27", every: "2 weeks" })).toBeNull();
    expect(paymentsToCover(67200, 33600)).toBe(2);
    expect(paymentsToCover(67200, 16800)).toBe(4);
  });

  it("stores the price before tax and shows it with tax", () => {
    expect(beforeTax(33600, 0.05)).toBe(32000);
    expect(withTax(32000, 0.05)).toBe(33600);
    expect(priceLookupKey("prod_x", 32000, "2 weeks")).toBe("jf_autopay_prod_x_32000_2weeks");
    expect(structureText("2 weeks", 2)).toBe("Bi-weekly subscription (every 2 weeks) — 2 payments");
  });

  it("only asks Stripe to wait when the first charge is far enough out", () => {
    expect(stripeFirstCharge("2026-11-27", "2026-11-16")).toBe("2026-11-27");
    expect(stripeFirstCharge("2026-11-18", "2026-11-16")).toBeNull();
    expect(stripeFirstCharge(null, "2026-11-16")).toBeNull();
  });

  it("says what's wrong in the coach's words", () => {
    const target = { saleId: "p4", label: "Package 4", leftCents: 67200 };
    expect(changeProblem({ eachWithTaxCents: 33600, firstDate: "2026-11-27", today: "2026-11-16", target })).toBeNull();
    expect(changeProblem({ eachWithTaxCents: 0, firstDate: "2026-11-27", today: "2026-11-16", target })).toMatch(/how much/);
    expect(changeProblem({ eachWithTaxCents: 33600, firstDate: "2026-11-01", today: "2026-11-16", target })).toMatch(/past/);
    expect(changeProblem({ eachWithTaxCents: 33600, firstDate: "2026-11-27", today: "2026-11-16", target: null })).toMatch(/package/);
  });

  it("reads the plan and the message plainly, and promises no double charge", () => {
    const o = autoPayOptions({ p, sales, rate: 0.05, today: "2026-11-16" });
    const sentence = changeSentence({ eachWithTaxCents: 33600, every: "2 weeks", firstDate: "2026-11-27", today: "2026-11-16", target: o.targets[0], current: o.current, money });
    expect(sentence).toBe(
      "$336.00 every 2 weeks from Nov 27, paying Package 4 ($672.00) in 2 payments. It stops once nothing's owed, unless you add their next package. The $168.00 auto-pay keeps going until they set this up, then it stops.",
    );
    const msg = setupMessage({ firstName: "Marc Asugui", eachWithTaxCents: 33600, every: "2 weeks", firstDate: "2026-11-27", today: "2026-11-16", replacing: o.current, url: "https://jfeffect.com/autopay/abc", money });
    expect(msg).toContain("Hey Marc!");
    expect(msg).toContain("$336.00 every 2 weeks, starting Nov 27 (tax included)");
    expect(msg).toContain("https://jfeffect.com/autopay/abc");
    expect(msg).toContain("never charged twice");
  });
});

describe("payment proofs", () => {
  it("keeps a proof in the client's own folder", () => {
    expect(proofPathOk(`${MARC}/2026-11-16-ab12.jpg`, MARC)).toBe(true);
    expect(proofPathOk(null, MARC)).toBe(true);
    expect(proofPathOk("other/2026-11-16-ab12.jpg", MARC)).toBe(false);
    expect(proofPathOk(`${MARC}/../x.jpg`, MARC)).toBe(false);
    expect(proofPathOk(`${MARC}/sub/x.jpg`, MARC)).toBe(false);
    expect(proofPathOk(`${MARC}/.hidden`, MARC)).toBe(false);
    expect(proofPath(MARC, "image/png", "2026-11-16", "a/b-c!d")).toBe(`${MARC}/2026-11-16-abcd.png`);
  });

  it("takes photos, screenshots and PDFs up to 10 MB", () => {
    expect(proofProblem({ type: "image/jpeg", size: 59_401 })).toBeNull();
    expect(proofProblem({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(proofProblem({ type: "text/html", size: 10 })).toMatch(/photo/);
    expect(proofProblem({ type: "image/png", size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
  });

  it("names the account by its last 4 digits only", () => {
    const accounts = [
      { id: "b", label: "Business savings", last4: "1111" },
      { id: "a", label: "Simplii Chequing", last4: "6360", is_default: true },
      { id: "c", label: "Old account", last4: "9999", archived_at: "2026-01-01" },
    ];
    expect(pickableAccounts(accounts).map((a) => a.id)).toEqual(["a", "b"]);
    expect(depositLabel(accounts[1])).toBe("Simplii Chequing ••6360");
    expect(paymentHow({ method: "etransfer", deposit_account_id: "a" }, accounts)).toBe("E-transfer into Simplii Chequing ••6360");
    expect(paymentHow({ method: "stripe" }, accounts)).toBe("Card through Stripe");
    expect(needsAccount("etransfer")).toBe(true);
    expect(needsAccount("cash")).toBe(false);
  });
});
