/**
 * Plan switching against Stripe's TEST mode (the plan-lifecycle-check hook).
 * Exercises exactly the calls plans.server.ts makes (plan-stripe.ts builds
 * them) on throwaway test-clock customers, and checks what the app relies on:
 *
 *   1. An upgrade mid-period charges exactly what create_preview said (same
 *      proration_date), and the price changes once that charge succeeds.
 *   2. With a card that declines, `pending_if_incomplete` leaves the price
 *      where it was, and voiding the invoice drops the pending change (so a
 *      change nobody paid for is never charged later).
 *   3. A downgrade (proration none) charges nothing today, and the renewal
 *      after the period ends is at the new price.
 *   4. A cancel at period end ends the subscription when the period ends;
 *      keeping it (cancel_at_period_end=false) undoes that.
 *   5. A coach's offer accepted on a grandfathered price ($65 → $130 at the
 *      period's end) charges nothing today and renews at the new price.
 *   6. A renewal on a card that fails leaves the subscription past due with
 *      the invoice open; a new card and paying the invoice make it active.
 *   7. The app's own billing page (Customer Portal) lets a client update their
 *      card and details and see invoices, and never change or cancel a plan;
 *      a portal session opens with it.
 *
 * Never runs with a live key. Creates its own test products and prices (CAD,
 * monthly, looked up by key so a second run reuses them) and deletes its test
 * clocks at the end (which deletes their customers and subscriptions).
 */
import { formEncode, getStripeKeyForMode, stripeFetch } from "@/lib/stripe.server";
import { CANCEL_LATER_PARAMS, KEEP_PARAMS, previewParams, readPreview, subState, swapLaterParams, swapNowParams } from "@/lib/plans/plan-stripe";

const DAY = 86_400;
type Step = { step: string; ok: boolean; detail: string };

async function price(apiKey: string, cents: number): Promise<string> {
  const key = `jf_plan_check_${cents}_cad_month`;
  const found = await stripeFetch(`/prices?lookup_keys[]=${key}&active=true&limit=1`, { apiKey });
  if (found?.data?.[0]?.id) return found.data[0].id;
  const product = await stripeFetch("/products", { method: "POST", apiKey, body: formEncode({ name: `Plan check ${cents / 100}`, "metadata[jf_plan_check]": "1" }) });
  const p = await stripeFetch("/prices", {
    method: "POST",
    apiKey,
    body: formEncode({ product: product.id, unit_amount: cents, currency: "cad", "recurring[interval]": "month", lookup_key: key, tax_behavior: "exclusive" }),
  });
  return p.id;
}

async function advance(apiKey: string, clock: string, to: number) {
  await stripeFetch(`/test_helpers/test_clocks/${clock}/advance`, { method: "POST", apiKey, body: formEncode({ frozen_time: to }) });
  for (let i = 0; i < 40; i++) {
    const c = await stripeFetch(`/test_helpers/test_clocks/${clock}`, { apiKey });
    if (c?.status === "ready") return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("test clock didn't finish advancing");
}

async function customerWithSub(apiKey: string, clock: string, priceId: string, card = "pm_card_visa") {
  const cus = await stripeFetch("/customers", {
    method: "POST",
    apiKey,
    body: formEncode({ test_clock: clock, payment_method: card, "invoice_settings[default_payment_method]": card, "metadata[jf_plan_check]": "1" }),
  });
  const sub = await stripeFetch("/subscriptions", { method: "POST", apiKey, body: formEncode({ customer: cus.id, "items[0][price]": priceId }) });
  return { cus: cus.id as string, sub: sub.id as string };
}

export async function runStripeLifecycleCheck(db?: any, part: "core" | "more" | "all" = "all"): Promise<{ ok: boolean; steps: Step[] }> {
  const apiKey = getStripeKeyForMode("test");
  if (!apiKey) return { ok: false, steps: [{ step: "setup", ok: false, detail: "No Stripe TEST key (STRIPE_SECRET_KEY_TEST). This check never runs against live." }] };
  const steps: Step[] = [];
  const add = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail });
  const clocks: string[] = [];
  try {
    const [comp, plus, nut] = await Promise.all([price(apiKey, 13000), price(apiKey, 24900), price(apiKey, 9900)]);
    if (part !== "more") {
    const start = Math.floor(Date.now() / 1000);
    const clock = await stripeFetch("/test_helpers/test_clocks", { method: "POST", apiKey, body: formEncode({ frozen_time: start, name: "JF plan check" }) });
    clocks.push(clock.id);

    // 1 + 2: two customers on $130, half way through the month
    const good = await customerWithSub(apiKey, clock.id, comp);
    const bad = await customerWithSub(apiKey, clock.id, comp);
    await advance(apiKey, clock.id, start + 15 * DAY);
    const at = start + 15 * DAY;

    let s = subState(await stripeFetch(`/subscriptions/${good.sub}`, { apiKey }));
    const preview = readPreview(await stripeFetch("/invoices/create_preview", { method: "POST", apiKey, body: formEncode(previewParams(s, plus, "always_invoice", at)) }));
    const up = await stripeFetch(`/subscriptions/${good.sub}`, { method: "POST", apiKey, body: formEncode(swapNowParams(s, plus, at)) });
    const upInv = typeof up.latest_invoice === "object" ? up.latest_invoice : await stripeFetch(`/invoices/${up.latest_invoice}`, { apiKey });
    const after = subState(up);
    add(
      "upgrade charges the preview",
      upInv.status === "paid" && upInv.total === preview.totalCents && after.priceId === plus && !after.pendingUpdate,
      `preview ${preview.totalCents}, charged ${upInv.total} (${upInv.status}), price ${after.priceId === plus ? "changed" : "not changed"}`,
    );

    await stripeFetch(`/payment_methods/pm_card_chargeCustomerFail/attach`, { method: "POST", apiKey, body: formEncode({ customer: bad.cus }) }).then(
      async (pm: any) => stripeFetch(`/customers/${bad.cus}`, { method: "POST", apiKey, body: formEncode({ "invoice_settings[default_payment_method]": pm.id }) }),
    );
    s = subState(await stripeFetch(`/subscriptions/${bad.sub}`, { apiKey }));
    let declined: any = null;
    try {
      declined = await stripeFetch(`/subscriptions/${bad.sub}`, { method: "POST", apiKey, body: formEncode(swapNowParams(s, plus, at)) });
    } catch (e: any) {
      add("declined upgrade waits", false, `Stripe refused the update: ${e?.message}`);
    }
    if (declined) {
      const d = subState(declined);
      const inv = typeof declined.latest_invoice === "object" ? declined.latest_invoice : null;
      add("declined upgrade waits", d.pendingUpdate && d.priceId === comp && inv?.status === "open", `pending ${d.pendingUpdate}, price ${d.priceId === comp ? "unchanged" : "CHANGED"}, invoice ${inv?.status}`);
      if (inv?.id) await stripeFetch(`/invoices/${inv.id}/void`, { method: "POST", apiKey });
      const v = subState(await stripeFetch(`/subscriptions/${bad.sub}`, { apiKey }));
      add("voiding drops the pending change", !v.pendingUpdate && v.priceId === comp, `pending ${v.pendingUpdate}, price ${v.priceId === comp ? "unchanged" : "CHANGED"}`);
    }

    // 3: a downgrade, then the renewal
    s = subState(await stripeFetch(`/subscriptions/${good.sub}`, { apiKey }));
    const down = await stripeFetch(`/subscriptions/${good.sub}`, { method: "POST", apiKey, body: formEncode({ ...swapLaterParams(s, nut), "expand[0]": "latest_invoice" }) });
    const sameInvoice = (typeof down.latest_invoice === "object" ? down.latest_invoice?.id : down.latest_invoice) === upInv.id;
    add("downgrade charges nothing today", sameInvoice, sameInvoice ? "no new invoice" : "a new invoice was made");

    // 4: cancel and keep on the second customer, cancel on a third
    const keep = await customerWithSub(apiKey, clock.id, comp);
    await stripeFetch(`/subscriptions/${keep.sub}`, { method: "POST", apiKey, body: formEncode(CANCEL_LATER_PARAMS) });
    const kept = await stripeFetch(`/subscriptions/${keep.sub}`, { method: "POST", apiKey, body: formEncode(KEEP_PARAMS) });
    add("keep undoes a cancel", kept.cancel_at_period_end === false && kept.status === "active", `cancel_at_period_end ${kept.cancel_at_period_end}`);
    await stripeFetch(`/subscriptions/${bad.sub}`, { method: "POST", apiKey, body: formEncode(CANCEL_LATER_PARAMS) });

    await advance(apiKey, clock.id, start + 32 * DAY);
    const renewed = await stripeFetch(`/subscriptions/${good.sub}?expand[]=latest_invoice`, { apiKey });
    const rInv = renewed.latest_invoice;
    add("the renewal is at the new price", rInv?.subtotal === 9900 && subState(renewed).priceId === nut, `renewal subtotal ${rInv?.subtotal}`);
    const gone = await stripeFetch(`/subscriptions/${bad.sub}`, { apiKey });
    add("a cancel ends at the period's end", gone.status === "canceled", `status ${gone.status}`);
    }
    if (part === "core") return { ok: steps.every((x) => x.ok), steps };

    // 5 + 6 on a second clock (a test clock holds three customers)
    const legacyPrice = await price(apiKey, 6500);
    const start2 = Math.floor(Date.now() / 1000);
    const clock2 = await stripeFetch("/test_helpers/test_clocks", { method: "POST", apiKey, body: formEncode({ frozen_time: start2, name: "JF plan check 2" }) });
    clocks.push(clock2.id);
    const legacy = await customerWithSub(apiKey, clock2.id, legacyPrice);
    const failing = await customerWithSub(apiKey, clock2.id, comp);
    await advance(apiKey, clock2.id, start2 + 10 * DAY);
    const ls = subState(await stripeFetch(`/subscriptions/${legacy.sub}`, { apiKey }));
    const offered = await stripeFetch(`/subscriptions/${legacy.sub}`, { method: "POST", apiKey, body: formEncode({ ...swapLaterParams(ls, comp), "expand[0]": "latest_invoice" }) });
    const firstInv = await stripeFetch(`/invoices?subscription=${legacy.sub}&limit=5`, { apiKey });
    add("an accepted offer charges nothing today", (firstInv?.data ?? []).length === 1 && subState(offered).priceId === comp, `${(firstInv?.data ?? []).length} invoice(s) so far`);

    const failPm = await stripeFetch(`/payment_methods/pm_card_chargeCustomerFail/attach`, { method: "POST", apiKey, body: formEncode({ customer: failing.cus }) });
    await stripeFetch(`/customers/${failing.cus}`, { method: "POST", apiKey, body: formEncode({ "invoice_settings[default_payment_method]": failPm.id }) });
    await advance(apiKey, clock2.id, start2 + 32 * DAY);
    const lr = await stripeFetch(`/subscriptions/${legacy.sub}?expand[]=latest_invoice`, { apiKey });
    add("the offer renews at the new price", lr.latest_invoice?.subtotal === 13000, `renewal subtotal ${lr.latest_invoice?.subtotal}`);
    const fs = await stripeFetch(`/subscriptions/${failing.sub}?expand[]=latest_invoice`, { apiKey });
    add("a failed renewal is past due", fs.status === "past_due" && fs.latest_invoice?.status === "open", `status ${fs.status}, invoice ${fs.latest_invoice?.status}`);
    const goodPm = await stripeFetch(`/payment_methods/pm_card_visa/attach`, { method: "POST", apiKey, body: formEncode({ customer: failing.cus }) });
    await stripeFetch(`/customers/${failing.cus}`, { method: "POST", apiKey, body: formEncode({ "invoice_settings[default_payment_method]": goodPm.id }) });
    if (fs.latest_invoice?.id) await stripeFetch(`/invoices/${fs.latest_invoice.id}/pay`, { method: "POST", apiKey, body: formEncode({ payment_method: goodPm.id }) }).catch(() => null);
    const fixed = await stripeFetch(`/subscriptions/${failing.sub}`, { apiKey });
    add("a new card brings it back", fixed.status === "active", `status ${fixed.status}`);

    // 7: the billing page
    if (db) {
      const { ensurePortalConfig } = await import("@/lib/plans/billing-portal.server");
      const rep = await ensurePortalConfig(db, "test", { apply: true });
      add("our billing page is locked to billing details", !!rep.ours.check?.ok, rep.ours.check?.problems.join("; ") || `config ${rep.ours.id}${rep.ours.created ? " (made now)" : ""}`);
      add(
        "Stripe's default billing page (read only)",
        true,
        rep.default.check ? (rep.default.check.ok ? "default is billing details only" : `default allows: ${rep.default.check.problems.join("; ")}`) : "no default configuration",
      );
      if (rep.ours.id) {
        const sess = await stripeFetch("/billing_portal/sessions", { method: "POST", apiKey, body: formEncode({ customer: legacy.cus, configuration: rep.ours.id, return_url: "https://jfeffect.com/portal/plan" }) });
        add("a billing page session opens with it", sess?.configuration === rep.ours.id && /^https:\/\//.test(sess?.url ?? ""), `configuration ${sess?.configuration}`);
      }
    }
  } catch (e: any) {
    add("run", false, String(e?.message ?? e));
  } finally {
    for (const c of clocks) await stripeFetch(`/test_helpers/test_clocks/${c}`, { method: "DELETE", apiKey }).catch(() => null);
  }
  return { ok: steps.length > 0 && steps.every((s) => s.ok), steps };
}
