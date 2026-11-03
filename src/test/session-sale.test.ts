import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bookButtonLabel, defaultSaleProduct, money, parseDollars, paymentLineText, saleProducts, saleQuote,
  sessionSaleMessage, shortProductName,
} from "@/lib/session-sale";
import { latestPackage } from "@/lib/client-owed";

const read = (p: string) => readFileSync(p, "utf8");

// The coach's real products (Oct 2026): singles and packs are one-time, the rest aren't sessions.
const rows = [
  { id: "single", name: "Personal Training — Single Session", price_cents: 10000, currency: "cad", sessions_included: 1, stripe_price_id: "price_s", mode: "payment", payment_structure: "One-time payment", status: "Active", active: true },
  { id: "p12", name: "Personal Training — 12 Sessions / 4 Weeks", price_cents: 111000, currency: "cad", sessions_included: 12, stripe_price_id: "price_12", mode: "payment", payment_structure: "One-time payment", status: "Active", active: true },
  { id: "marc", name: "Marc Asugui — 16 Personal Training Sessions", price_cents: 16000, currency: "cad", sessions_included: 16, stripe_price_id: "price_m", mode: "subscription", payment_structure: "Bi-weekly subscription (every 2 weeks) — 4 payments", status: "Active", active: true, is_one_off: true },
  { id: "online", name: "Online Coaching", price_cents: 18000, currency: "cad", sessions_included: 0, stripe_price_id: "price_o", mode: "subscription", payment_structure: "Monthly subscription", status: "Active", active: true },
  { id: "draft16", name: "Personal Training — 16 Sessions / 4 Weeks", price_cents: 20000, currency: "cad", sessions_included: 16, stripe_price_id: "price_d", mode: "subscription", payment_structure: "Bi-weekly subscription (every 2 weeks) — 4 payments", status: "Draft", active: false },
  { id: "noprice", name: "Personal Training — 6 Sessions", price_cents: 60000, currency: "cad", sessions_included: 6, stripe_price_id: null, mode: "payment", payment_structure: "One-time payment", status: "Active", active: true },
];

describe("selling a session with its booking", () => {
  it("offers only one-time session products with a Stripe price, singles first", () => {
    const products = saleProducts(rows);
    expect(products.map((p) => p.id)).toEqual(["single", "p12"]);
    expect(products[0]).toMatchObject({ name: "Single Session", price_cents: 10000, currency: "CAD" });
    expect(shortProductName("Personal Training — 12 Sessions / 4 Weeks")).toBe("12 Sessions / 4 Weeks");
    expect(defaultSaleProduct(products)?.id).toBe("single");
    expect(defaultSaleProduct([])).toBeNull();
  });

  it("reads a typed price and refuses nonsense", () => {
    expect(parseDollars("30")).toBe(3000);
    expect(parseDollars("$100")).toBe(10000);
    expect(parseDollars("1,200.50")).toBe(120050);
    expect(parseDollars("0.25")).toBeNull();
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("20000")).toBeNull();
  });

  it("prices a single per booking, a pack once, and a typed price per session", () => {
    const products = saleProducts(rows);
    expect(saleQuote({ productId: "single", customCents: null }, 1, products)).toMatchObject({ sessions: 1, totalCents: 10000, quantity: 1, name: "Single Session", uncovered: 0 });
    expect(saleQuote({ productId: "single", customCents: null }, 4, products)).toMatchObject({ sessions: 4, totalCents: 40000, quantity: 4, name: "Single Session × 4" });
    expect(saleQuote({ productId: "p12", customCents: null }, 1, products)).toMatchObject({ sessions: 12, totalCents: 111000, quantity: 1 });
    expect(saleQuote({ productId: null, customCents: 3000 }, 1, products, "1:1 Training")).toMatchObject({ sessions: 1, totalCents: 3000, name: "1:1 Training · 1 session" });
    expect(saleQuote({ productId: null, customCents: 3000 }, 3, products)).toMatchObject({ sessions: 3, totalCents: 9000 });
    expect(saleQuote({ productId: null, customCents: null }, 1, products)).toBeNull();
    expect(saleQuote({ productId: "gone", customCents: null }, 1, products)).toBeNull();
    // A pack smaller than the repeat covers what it can; the rest stay owed.
    const small = [{ id: "p2", name: "2 Sessions", price_cents: 18000, currency: "CAD", sessions_included: 2 }];
    expect(saleQuote({ productId: "p2", customCents: null }, 4, small)?.uncovered).toBe(2);
  });

  it("says what Book does", () => {
    const products = saleProducts(rows);
    const one = saleQuote({ productId: "single", customCents: null }, 1, products);
    expect(bookButtonLabel(one, { count: 1, send: true })).toBe("Book & send $100 link");
    expect(bookButtonLabel(saleQuote({ productId: "single", customCents: null }, 4, products), { count: 4, send: false })).toBe("Book 4 & make $400 link");
    expect(bookButtonLabel(null, { count: 1, send: true })).toBe("Book Session");
    expect(money(3050)).toBe("$30.50");
    expect(money(111000)).toBe("$1,110");
  });

  it("leads the chat message with the booking, then the price and the link", () => {
    const body = sessionSaleMessage({
      first: "Marc Asugui", title: "1:1 Training", when: "Tue, Nov 10 at 2:00 PM", booked: 1, sessions: 1,
      totalCents: 10000, currency: "CAD", url: "https://jfeffect.com/pay/abc",
    });
    expect(body.split("\n")[0]).toBe("Hey Marc! 👋 You're booked for 1:1 Training on Tue, Nov 10 at 2:00 PM.");
    expect(body).toContain("($100 + applicable tax)");
    expect(body).toContain("https://jfeffect.com/pay/abc");
    const pack = sessionSaleMessage({ first: "", title: "1:1 Training", when: "Tue, Nov 10 at 2:00 PM", booked: 1, sessions: 12, productName: "12 Sessions / 4 Weeks", totalCents: 111000, url: "u" });
    expect(pack).toMatch(/^Hey! 👋 Your 12 Sessions \/ 4 Weeks is set up, and your first session is booked for Tue, Nov 10/);
  });

  it("reads a session's payment plainly", () => {
    expect(paymentLineText("paid", { priceText: "$105 · Single Session", first: "Marc" })).toEqual({ tone: "paid", text: "Paid · $105 · Single Session" });
    expect(paymentLineText("waiting", { priceText: "$100 + tax · Single Session", first: "Marc" }).text).toBe("Waiting on Marc to pay · $100 + tax · Single Session");
    expect(paymentLineText("left", { priceText: "x", leftText: "$336", first: "Marc" })).toEqual({ tone: "owed", text: "$336 left to pay" });
    expect(paymentLineText("ended", { priceText: "x", first: "" }).tone).toBe("ended");
  });

  it("a single sold on the side doesn't change what a package client renews", () => {
    const pack = { id: "p", sessions_purchased: 16, contract_value_cents: 64000, full_payable_amount: 640, payment_structure: "One-time payment", purchased_at: "2026-09-07" };
    const single = { id: "s", sessions_purchased: 1, contract_value_cents: 10000, full_payable_amount: 100, payment_structure: "One-time payment", purchased_at: "2026-11-03" };
    expect(latestPackage([pack, single] as any)?.sale.id).toBe("p");
    expect(latestPackage([single] as any)?.sale.id).toBe("s");
  });
});

describe("the sale's plumbing", () => {
  const sql = read("supabase/migrations/20270117090000_sell_sessions_with_booking.sql");
  const fns = read("src/lib/session-sale.functions.ts");

  it("only their coach sells, and a retry for the same sessions is the same sale", () => {
    expect(sql).toMatch(/public\.has_role\(v_uid, 'admin'\) OR public\.is_assigned_coach_for_client\(_client_id\)/);
    expect(sql).toMatch(/offer_snapshot->'pt_session_ids'\) \?\| v_ids/);
    expect(sql).toContain("jsonb_build_object('source', 'booking', 'pt_session_ids', to_jsonb(v_ids))");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.sell_booked_sessions\([^)]*\) TO authenticated/);
  });

  it("puts the booked session on the sale before granting, so the credit is that session's", () => {
    const move = sql.indexOf("public._move_session_event(v_res.id, v_id");
    const grant = sql.indexOf("'granted', _sessions");
    expect(move).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(move);
    // only sessions no package is paying for are moved
    expect(sql).toContain("v_res.purchase_id IS NULL");
    // an Unpaid one-time sale holding its sessions, like a renewal
    expect(sql).toMatch(/'Unpaid', 'Active', 0, 0, 0/);
  });

  it("prices on the server from the product or the typed price, never the phone's total", () => {
    expect(fns).toMatch(/saleQuote\(\{ productId: data\.productId \?\? null, customCents: data\.customCents \?\? null \}/);
    expect(fns).not.toMatch(/totalCents: z\./);
    // a product sold once keeps its own Stripe price; anything else gets (or reuses) a price for its amount
    expect(fns).toContain("product && quote.quantity === 1 && product.stripe_price_id");
    expect(fns).toContain('tax_behavior: "exclusive"');
    expect(fns).toMatch(/idempotencyKey: `jf-session-price:/);
  });

  it("a booking's sale always pays through its own checkout, never the product's shared link", () => {
    const share = read("src/lib/payment-share.server.ts");
    expect(share).toContain('offer_snapshot?.source === "booking"');
    expect(share).toContain("requiresClientSpecificCheckout: clientSpecific");
  });

  it("books first, then sells: the booking stands whatever happens to the sale", () => {
    const dialog = read("src/components/pt-session-dialog.tsx");
    const insert = dialog.indexOf('supabase.from("pt_sessions").insert(rows)');
    const sell = dialog.indexOf("await runSessionSale(");
    expect(insert).toBeGreaterThan(0);
    expect(sell).toBeGreaterThan(insert);
    expect(dialog).toContain("const mustConfirmOverbook = overbook && !selling && (outlook?.needsConfirm ?? true);");
    const picker = read("src/components/schedule/session-sale-picker.tsx");
    expect(picker).toContain('label: "Try again"');
    expect(picker).toContain('inputMode="decimal"');
  });

  it("the chat card and the session sheet read the sale live", () => {
    const card = read("src/components/payment-request-card.tsx");
    expect(card).toMatch(/from\("purchase_records"\)\.select\("\*"\)\.eq\("id", purchaseId!\)/);
    expect(card).toContain('table: "purchase_records", filter: `id=eq.${purchaseId}`');
    const line = read("src/components/schedule/session-payment-line.tsx");
    expect(line).toContain('rpc("pt_session_sale_id"');
    expect(read("src/components/schedule/session-actions-sheet.tsx")).toContain("<SessionPaymentLine session={session} first={first} />");
    // and when an already-booked session is opened to edit (Manage Session)
    expect(read("src/components/pt-session-dialog.tsx")).toContain("<SessionPaymentLine session={form} first=");
  });
});
