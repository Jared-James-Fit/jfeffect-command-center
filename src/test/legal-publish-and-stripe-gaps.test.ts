import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
import { refundEndsSale } from "@/routes/api/public/stripe-webhook";
import { customerIdempotencyKey, fnv1a } from "@/lib/stripe-idempotency";

describe("Admin → Legal: Publish works the way it reads", () => {
  const page = readFileSync("src/routes/_authenticated/admin/legal.tsx", "utf8");

  it("Publish is there for every draft, never greyed out by a switch that had to be saved first", () => {
    expect(page).not.toContain("Turn off 'Still needs professional legal review'");
    expect(page).not.toMatch(/editing && !editing\.needs_legal_review &&/);
    expect(page).toContain("{editing && (");
    expect(page).toContain("data-legal-publish");
  });

  it("the review is confirmed in the dialog with an unticked box, and unsaved edits are saved first", () => {
    expect(page).toContain("const [reviewed, setReviewed] = useState(false);");
    expect(page).toContain("setReviewed(false);");
    expect(page).toContain('disabled={confirmBusy || (confirmState?.kind === "publish" && !reviewed)}');
    expect(page).toContain("if (!reviewed) return;");
    expect(page).toContain("await saveFn({ data: { ...draftPayload(), needs_legal_review: false } });");
  });

  it("an older draft can be archived from the history", () => {
    expect(page).toContain('(v.status === "published" || (v.status === "draft" && v.id !== editing?.id))');
  });
});

describe("publishing the current legal set", () => {
  const sql = readFileSync("supabase/migrations/20270601093000_legal_publish_current_versions.sql", "utf8");
  it("builds each version from its exact draft and stops on anything unexpected", () => {
    for (const md5 of ["36020d706f175345e19cd28720e3f1a1", "bd9cc9d591ce97d980b40297356fc4fb", "eacf63b12531a07def698922d556c3b0",
                       "3cbbb1406a552e39b56eb31778898933", "5d98adf6c6217d5ad3ecad9d462897fb", "b147b2a7df1304f1cdef41bd4ae15907"]) {
      expect(sql).toContain(md5);
    }
    expect(sql).toContain("RAISE EXCEPTION 'terms: stale wording left'");
    expect(sql).toContain("'\\$29|3-day trial|/m/billing|Keep Membership|gmail'");
  });
  it("never publishes the June starter templates or deletes anything", () => {
    for (const slug of ["ai-assisted-coaching-disclosure", "coaching-disclaimer", "communication-consent", "medical-injury-disclaimer",
                        "nutrition-disclaimer", "media-and-testimonial-release", "upload-and-progress-photo-consent"]) {
      expect(sql).not.toContain(slug);
    }
    expect(sql).not.toMatch(/\bDELETE\b/);
  });
  it("asks nobody to accept again except members signing the membership agreement in the app", () => {
    const inserts = sql.match(/requires_reacceptance, reacceptance_audience[\s\S]*?RETURNING/g) ?? [];
    expect(inserts.length).toBe(4);
    expect(sql).toContain("r_body, m_v4.signature_method, true,");
  });
});

describe("a refund only ends a one-time sale refunded in full", () => {
  const oneTime = { is_recurring: false, stripe_subscription_id: null };
  const subscription = { is_recurring: true, stripe_subscription_id: "sub_1" };
  it("full refund of a one-time purchase ends it", () => {
    expect(refundEndsSale({ refunded: true, amount: 5000, amount_refunded: 5000 }, oneTime)).toBe(true);
    expect(refundEndsSale({ amount: 5000, amount_refunded: 5000 }, oneTime)).toBe(true);
  });
  it("a partial refund is recorded and nothing else changes", () => {
    expect(refundEndsSale({ refunded: false, amount: 5000, amount_refunded: 500 }, oneTime)).toBe(false);
  });
  it("one monthly charge refunded never ends a subscription", () => {
    expect(refundEndsSale({ refunded: true, amount: 13000, amount_refunded: 13000 }, subscription)).toBe(false);
    expect(refundEndsSale({ refunded: true, amount: 13000, amount_refunded: 13000 }, { is_recurring: false, stripe_subscription_id: "sub_2" })).toBe(false);
  });
  it("the webhook only cancels and revokes when it does", () => {
    const hook = readFileSync("src/routes/api/public/stripe-webhook.ts", "utf8");
    expect(hook).toContain("const endsSale = refundEndsSale(obj, purchase);");
    expect(hook).toContain("if (endsSale) await revokeMemberFromPurchase(supabase, purchase);");
  });
});

describe("a Stripe customer is made once", () => {
  it("the same request gives the same key; a different body a different one", () => {
    const a = customerIdempotencyKey("client", "c1", "email=a%40x.com&name=Ann");
    expect(customerIdempotencyKey("client", "c1", "email=a%40x.com&name=Ann")).toBe(a);
    expect(customerIdempotencyKey("client", "c1", "email=a%40x.com&name=Anne")).not.toBe(a);
    expect(customerIdempotencyKey("member", "c1", "email=a%40x.com&name=Ann")).not.toBe(a);
    expect(fnv1a("")).toBe("811c9dc5");
    expect(a.length).toBeLessThanOrEqual(255);
  });
  it("every place the app creates a customer sends a key", () => {
    for (const f of ["src/lib/stripe-checkout.functions.ts", "src/lib/member-checkout.functions.ts"]) {
      const src = readFileSync(f, "utf8");
      const creates = src.match(/stripeFetch\("\/customers", \{[\s\S]*?\}\);/g) ?? [];
      expect(creates.length).toBeGreaterThan(0);
      for (const c of creates) expect(c, f).toContain("idempotencyKey: customerIdempotencyKey(");
      expect(src).toContain('"Idempotency-Key": init.idempotencyKey');
    }
  });
});
