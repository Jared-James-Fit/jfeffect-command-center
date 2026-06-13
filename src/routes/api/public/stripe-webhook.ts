import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { stripeFetch, getStripeKeyForMode, type StripeMode } from "@/lib/stripe.server";
import {
  buildPromoRowFromSession,
  fetchExpandedCheckoutSession,
  upsertPromoRedemption,
} from "@/lib/promo-capture";

// Verify Stripe signature using Web Crypto (HMAC-SHA256).
// Header format: t=timestamp,v1=sig,v1=sig...
async function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300) {
  if (!header) return { ok: false, reason: "missing signature header", ts: null, sigCount: 0 };
  const ts = header.split(",").find((p) => p.startsWith("t="))?.slice(2) ?? null;
  const sigs = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!ts || sigs.length === 0) return { ok: false, reason: "missing timestamp or v1", ts, sigCount: sigs.length };
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(ts)) || Math.abs(now - Number(ts)) > toleranceSec) {
    return { ok: false, reason: "bad timestamp", ts, sigCount: sigs.length };
  }
  const signedPayload = `${ts}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expected = new Uint8Array(sigBuf);
  const matches = sigs.some((s) => {
    if (!/^[a-f0-9]{64}$/i.test(s)) return false;
    const actual = new Uint8Array(s.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ actual[i];
    return diff === 0;
  });
  return { ok: matches, reason: matches ? "matched" : "signature mismatch", ts, sigCount: sigs.length };
}

async function secretFingerprint(secret: string | null) {
  if (!secret) return null;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(hash)).slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function findPurchase(supabase: any, lookup: Record<string, string | null | undefined>) {
  for (const [col, val] of Object.entries(lookup)) {
    if (!val) continue;
    const { data } = await supabase.from("purchase_records").select("*").eq(col, val).maybeSingle();
    if (data) return data;
  }
  return null;
}

/**
 * Resolve the purchase record for a Stripe event.
 * Primary: metadata.purchase_record_id (set by createCheckoutSessionForAssignment).
 * Fallback: lookups by Stripe IDs we ourselves stamped onto the row
 * (checkout session id, subscription id, payment intent id, customer id).
 * NOTE: legacy "build a URL from obj.payment_link" fallback was removed —
 * obj.payment_link is a `plink_…` ID, not a URL slug, so that match never worked.
 */
async function resolvePurchase(
  supabase: any,
  obj: any,
  fallback: Record<string, string | null | undefined>,
) {
  const metaId: string | undefined =
    obj?.metadata?.purchase_record_id ||
    obj?.subscription_details?.metadata?.purchase_record_id;
  if (metaId) {
    const { data } = await supabase
      .from("purchase_records").select("*").eq("id", metaId).maybeSingle();
    if (data) return data;
  }
  return findPurchase(supabase, fallback);
}

/**
 * Cancelled is a terminal state. Once a purchase_record is Cancelled we
 * refuse to flip it back to Active/Active Subscription from a stale
 * `customer.subscription.updated` event (Stripe can deliver events out of
 * order, and the same subscription id may briefly report `active` after
 * `deleted` has already been processed).
 *
 * The only legitimate way to reactivate a Cancelled record is to assign
 * a NEW purchase / NEW subscription — which gets a new purchase_records row.
 */
function isTerminalCancelled(purchase: any): boolean {
  return purchase?.payment_status === "Cancelled" || purchase?.service_status === "Cancelled";
}

/**
 * Capture Stripe promo / discount usage at checkout completion and persist it
 * to the shared promo_code_redemptions table. Promo codes are managed entirely
 * in the Stripe Dashboard — the app just records what was used, regardless of
 * product (JF Membership, coaching, one-time, future products).
 */
async function captureCheckoutPromo(supabase: any, obj: any, eventId: string) {
  try {
    let full: any = obj;
    try {
      full = await fetchExpandedCheckoutSession(obj.id);
    } catch (e) {
      console.warn("[stripe-webhook] session expand fetch failed", (e as any)?.message || e);
    }
    const row = await buildPromoRowFromSession(full, eventId);
    if (!row) return;
    await upsertPromoRedemption(supabase, row);
  } catch (e) {
    console.error("[stripe-webhook] captureCheckoutPromo error", e);
  }
}

/**
 * Sync stripe_customer_id onto the clients row so the Customer Portal
 * can be opened without scanning purchase_records every time.
 */
async function syncClientStripeCustomerId(supabase: any, stripeCustomerId: string | null, clientId: string | null) {
  if (!stripeCustomerId || !clientId) return;
  await supabase
    .from("clients")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", clientId)
    .is("stripe_customer_id", null); // only update if not already set
}

/**
 * Provision App Member / Program-Only access from a purchase_records row.
 * Only runs if the offer has a product_access_grants entry mapping to a
 * non-coaching account type.
 */
async function provisionMemberFromPurchase(supabase: any, purchase: any) {
  if (!purchase?.offer_id) return;
  const { data: grant } = await supabase
    .from("product_access_grants").select("*").eq("offer_id", purchase.offer_id).maybeSingle();
  if (!grant) return;
  if (grant.account_type_granted === "coaching_client") return; // coaching path unchanged

  // Resolve email: prefer the terms_accepted email, else look up the linked client.
  let email: string | null = purchase.terms_accepted_client_email ?? null;
  let fullName: string | null = purchase.terms_accepted_client_name ?? null;
  if (!email && purchase.client_id) {
    const { data: cli } = await supabase
      .from("clients").select("email, full_name").eq("id", purchase.client_id).maybeSingle();
    email = cli?.email ?? null;
    fullName = fullName ?? cli?.full_name ?? null;
  }
  if (!email) return;

  // Upsert app_members row by email
  const { data: existing } = await supabase
    .from("app_members").select("*").ilike("email", email).maybeSingle();

  let memberId: string;
  if (existing) {
    memberId = existing.id;
    const patch: any = {
      status: "Active",
      account_type: existing.account_type === "app_member" ? "app_member" : grant.account_type_granted,
      stripe_customer_id: purchase.stripe_customer_id ?? existing.stripe_customer_id,
    };
    if (!existing.setup_token && !existing.user_id) {
      patch.setup_token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      patch.setup_token_expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    }
    await supabase.from("app_members").update(patch).eq("id", memberId);
  } else {
    const { data: created } = await supabase.from("app_members").insert({
      email,
      full_name: fullName,
      account_type: grant.account_type_granted,
      status: "Active",
      stripe_customer_id: purchase.stripe_customer_id ?? null,
      setup_token: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
      setup_token_expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    }).select("id").single();
    memberId = created!.id;
  }

  // Grant each access_level_key (idempotent — skip ones already active for this offer)
  const keys: string[] = grant.access_level_keys ?? [];
  for (const key of keys) {
    const { data: ex } = await supabase
      .from("member_access").select("id")
      .eq("member_id", memberId).eq("access_level_key", key)
      .eq("offer_id", purchase.offer_id).maybeSingle();
    if (ex) {
      await supabase.from("member_access").update({ active: true, expires_at: null }).eq("id", ex.id);
    } else {
      await supabase.from("member_access").insert({
        member_id: memberId,
        access_level_key: key,
        source: grant.is_subscription ? "subscription" : "one_time",
        offer_id: purchase.offer_id,
        active: true,
      });
    }
  }
}

async function revokeMemberFromPurchase(supabase: any, purchase: any) {
  if (!purchase?.offer_id) return;
  const { data: grant } = await supabase
    .from("product_access_grants").select("*").eq("offer_id", purchase.offer_id).maybeSingle();
  if (!grant || grant.account_type_granted === "coaching_client") return;
  let email: string | null = purchase.terms_accepted_client_email ?? null;
  if (!email && purchase.client_id) {
    const { data: cli } = await supabase.from("clients").select("email").eq("id", purchase.client_id).maybeSingle();
    email = cli?.email ?? null;
  }
  if (!email) return;
  const { data: member } = await supabase.from("app_members").select("id").ilike("email", email).maybeSingle();
  if (!member) return;
  await supabase
    .from("member_access")
    .update({ active: false })
    .eq("member_id", member.id)
    .eq("offer_id", purchase.offer_id);
  // Optional: mark member Cancelled if no remaining active access
  const { data: remaining } = await supabase
    .from("member_access").select("id").eq("member_id", member.id).eq("active", true).limit(1);
  if (!remaining || remaining.length === 0) {
    await supabase.from("app_members").update({ status: "Cancelled" }).eq("id", member.id);
  }
}

/* ───────── JF Membership webhook helpers ───────── */

function jfStatusFromSub(sub: any, holdPriceId: string | null): string {
  if (!sub) return "Cancelled";
  const priceId = sub.items?.data?.[0]?.price?.id;
  if (holdPriceId && priceId === holdPriceId) return "Hold Plan";
  if (sub.pause_collection) return "Paused";
  switch (sub.status) {
    case "trialing": return "Trialing";
    case "active": return "Active";
    case "past_due": return "Past Due";
    case "unpaid": return "Payment Failed";
    case "canceled": return "Cancelled";
    case "incomplete":
    case "incomplete_expired": return "Payment Failed";
    case "paused": return "Paused";
    default: return "Cancelled";
  }
}
const fromUnix = (u?: number | null) => (u ? new Date(u * 1000).toISOString() : null);

async function jfSettings(supabase: any) {
  const { data } = await supabase.from("jf_membership_settings").select("*").eq("id", true).maybeSingle();
  return data;
}

async function isJfMembershipSubscription(supabase: any, sub: any): Promise<boolean> {
  if (!sub) return false;
  if (sub.metadata?.kind === "jf_membership") return true;
  const s = await jfSettings(supabase);
  const priceId = sub.items?.data?.[0]?.price?.id;
  return !!(s && priceId && (priceId === s.monthly_price_id || priceId === s.hold_price_id));
}

async function findJfMemberBySub(supabase: any, sub: any) {
  // 1) by stripe_subscription_id
  let { data } = await supabase.from("app_members").select("*").eq("stripe_subscription_id", sub.id).maybeSingle();
  if (data) return data;
  // 2) by customer
  if (sub.customer) {
    const r = await supabase.from("app_members").select("*").eq("stripe_customer_id", sub.customer).maybeSingle();
    if (r.data) return r.data;
  }
  // 3) by metadata email (fallback for trialing where checkout->member just landed)
  const emailLc = sub.metadata?.email_lc;
  if (emailLc) {
    const r = await supabase.from("app_members").select("*").ilike("email", emailLc).maybeSingle();
    if (r.data) return r.data;
  }
  return null;
}

async function applyJfSubToMember(supabase: any, member: any, sub: any) {
  const s = await jfSettings(supabase);
  const holdId = s?.hold_price_id ?? null;
  const status = jfStatusFromSub(sub, holdId);
  const patch: any = {
    subscription_status: status,
    stripe_subscription_id: sub.id,
    stripe_customer_id: sub.customer ?? null,
    stripe_price_id: sub.items?.data?.[0]?.price?.id ?? null,
    trial_end_at: fromUnix(sub.trial_end),
    current_period_end: fromUnix(sub.current_period_end),
    cancel_at: fromUnix(sub.cancel_at),
    cancelled_at: fromUnix(sub.canceled_at),
    paused_until: fromUnix(sub.pause_collection?.resumes_at),
    last_billing_event_at: new Date().toISOString(),
  };
  if (status === "Hold Plan") patch.hold_plan_started_at = new Date().toISOString();
  if (["Trialing", "Active"].includes(status)) patch.status = "Active";
  else if (status === "Cancelled" || status === "Payment Failed") patch.status = "Cancelled";
  await supabase.from("app_members").update(patch).eq("id", member.id);
  const grants = status === "Trialing" || status === "Active";
  await supabase.from("member_access").update({ active: grants }).eq("member_id", member.id);
}

/** Fire a JF SMS automation; swallow errors so the webhook still returns 200. */
async function fireJfSms(memberId: string, trigger: string, vars: Record<string, string> = {}) {
  try {
    const { fireAutomationTrigger } = await import("@/lib/sms-trigger.server");
    const supabase = admin();
    await fireAutomationTrigger(supabase, { trigger, memberId, vars });
  } catch (e) {
    console.error(`[stripe-webhook] sms ${trigger} failed`, e);
  }
}

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Accept both test and live webhook secrets so test-mode events from
        // the auto-created test endpoint and live-mode events from the live
        // endpoint both verify against their own signing secret.
        const liveSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
        const testSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST?.trim() || null;
        if (!liveSecret && !testSecret) {
          console.warn("[stripe-webhook] verification failed", { reason: "missing secret", testConfigured: false, liveConfigured: false });
          return new Response("Webhook secret not configured", { status: 503 });
        }

        const sig = request.headers.get("stripe-signature");
        const raw = await request.text();
        const rawByteLength = new TextEncoder().encode(raw).length;

        let parsedPreview: any = null;
        try { parsedPreview = JSON.parse(raw); } catch { /* parse fully after verification or return Bad JSON */ }
        const livemode = parsedPreview?.livemode === true ? true : parsedPreview?.livemode === false ? false : null;
        const candidates = livemode === true
          ? [{ name: "LIVE", secret: liveSecret }, { name: "TEST", secret: testSecret }]
          : [{ name: "TEST", secret: testSecret }, { name: "LIVE", secret: liveSecret }];

        let ok = false;
        let matchedSecret: "TEST" | "LIVE" | null = null;
        const attempts: Array<{ name: string; configured: boolean; length: number; startsWithWhsec: boolean; fingerprint: string | null; result: string }> = [];
        for (const c of candidates) {
          const configured = !!c.secret;
          const base = {
            name: c.name,
            configured,
            length: c.secret?.length ?? 0,
            startsWithWhsec: c.secret?.startsWith("whsec_") ?? false,
            fingerprint: await secretFingerprint(c.secret),
          };
          if (!c.secret) {
            attempts.push({ ...base, result: "missing secret" });
            continue;
          }
          const result = await verifyStripeSignature(raw, sig, c.secret);
          attempts.push({ ...base, result: result.reason });
          if (result.ok) {
            ok = true;
            matchedSecret = c.name as "TEST" | "LIVE";
            break;
          }
        }
        if (!ok) {
          console.warn("[stripe-webhook] verification failed", {
            reason: attempts.find((a) => a.result !== "missing secret")?.result ?? "missing secret",
            eventId: parsedPreview?.id ?? null,
            eventType: parsedPreview?.type ?? null,
            livemode,
            headerExists: !!sig,
            rawByteLength,
            attempts,
          });
          return new Response("Invalid signature", { status: 401 });
        }
        console.info("[stripe-webhook] verification passed", {
          eventId: parsedPreview?.id ?? null,
          eventType: parsedPreview?.type ?? null,
          livemode,
          matchedSecret,
          rawByteLength,
        });

        let event: any;
        try { event = parsedPreview ?? JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

        const supabase = admin();
        const obj = event?.data?.object ?? {};
        const now = new Date().toISOString();

        // ── Duplicate-event protection ──────────────────────────────────────
        // Stripe retries delivery on any non-2xx or timeout. We dedupe by
        // event.id so repeated retries can't double-process the same event.
        if (event?.id) {
          const { error: dupErr } = await supabase
            .from("processed_stripe_events")
            .insert({ event_id: event.id, event_type: event.type ?? "unknown" });
          if (dupErr) {
            // 23505 = unique_violation → we've already processed this event.
            if ((dupErr as any).code === "23505") {
              return Response.json({ received: true, duplicate: true });
            }
            console.error("[stripe-webhook] dedupe insert failed", dupErr);
            // Fail closed so Stripe retries rather than silently skipping.
            return new Response("Dedupe store error", { status: 500 });
          }
        }

        try {
          switch (event.type) {

            // ── One-time & subscription checkout completion ─────────────────
            case "checkout.session.completed": {
              // Capture promo/discount usage for EVERY completed checkout
              // (JF Membership, coaching, one-time, member upgrade, future).
              await captureCheckoutPromo(supabase, obj, event.id);

              if (obj?.metadata?.kind === "jf_membership") {
                await supabase.from("jf_billing_events").insert({
                  stripe_event_id: event.id, type: event.type,
                  customer_id: obj.customer ?? null, subscription_id: obj.subscription ?? null, payload: obj,
                }).then(() => {}, () => {});
                break;
              }
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_checkout_session_id: obj.id,
              });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: obj.payment_status === "paid"
                    ? (obj.mode === "subscription" ? "Active Subscription" : "Paid")
                    : "Pending Payment",
                  paid_at: obj.payment_status === "paid" ? now : purchase.paid_at,
                  amount_paid: obj.amount_total ? obj.amount_total / 100 : purchase.amount_paid,
                  stripe_checkout_session_id: obj.id,
                  stripe_payment_intent_id: obj.payment_intent ?? null,
                  stripe_subscription_id: obj.subscription ?? null,
                  stripe_customer_id: obj.customer ?? null,
                  service_status: obj.payment_status === "paid" ? "Active" : purchase.service_status,
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);

                // Sync stripe_customer_id to clients table for portal access
                await syncClientStripeCustomerId(supabase, obj.customer ?? null, purchase.client_id ?? null);

                if (obj.payment_status === "paid") {
                  await provisionMemberFromPurchase(supabase, { ...purchase, stripe_customer_id: obj.customer ?? purchase.stripe_customer_id });
                }
              }
              break;
            }

            // ── Subscription created (new subscriber) ───────────────────────
            case "customer.subscription.created": {
              if (await isJfMembershipSubscription(supabase, obj)) {
                const member = await findJfMemberBySub(supabase, obj);
                if (member) await applyJfSubToMember(supabase, member, obj);
                await supabase.from("jf_billing_events").insert({
                  stripe_event_id: event.id, type: event.type,
                  customer_id: obj.customer ?? null, subscription_id: obj.id,
                  member_id: member?.id ?? null, payload: obj,
                }).then(() => {}, () => {});
                // Fire "subscription_purchased" SMS automations for new JF subs.
                if (member) {
                  try {
                    const { fireAutomationTrigger } = await import("@/lib/sms-trigger.server");
                    const origin = process.env.PUBLIC_APP_URL || process.env.SITE_URL || "";
                    const setupLink = member.setup_token && !member.user_id
                      ? `${origin}/member-setup?token=${member.setup_token}`
                      : `${origin}/auth`;
                    await fireAutomationTrigger(supabase, {
                      trigger: "subscription_purchased",
                      memberId: member.id,
                      vars: { setup_link: setupLink },
                    });
                  } catch (e) { console.error("[stripe-webhook] sms trigger failed", e); }
                }
                break;
              }
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_subscription_id: obj.id,
                stripe_customer_id: obj.customer,
              });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: obj.status === "active" ? "Active Subscription"
                    : obj.status === "trialing" ? "Active Subscription"
                    : "Pending Payment",
                  stripe_subscription_id: obj.id,
                  stripe_customer_id: obj.customer ?? null,
                  service_status: obj.status === "active" || obj.status === "trialing" ? "Active" : purchase.service_status,
                  // Stamp term_end_date immediately so the admin dashboard
                  // shows the next billing date without waiting for the
                  // first customer.subscription.updated event.
                  ...(obj.current_period_end
                    ? { term_end_date: new Date(obj.current_period_end * 1000).toISOString().split("T")[0] }
                    : {}),
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);

                await syncClientStripeCustomerId(supabase, obj.customer ?? null, purchase.client_id ?? null);

                if (obj.status === "active" || obj.status === "trialing") {
                  await provisionMemberFromPurchase(supabase, { ...purchase, stripe_customer_id: obj.customer ?? purchase.stripe_customer_id });
                }
              }
              break;
            }

            // ── Subscription updated (renewal, cancellation, past_due) ──────
            case "customer.subscription.updated": {
              if (await isJfMembershipSubscription(supabase, obj)) {
                const member = await findJfMemberBySub(supabase, obj);
                if (member) await applyJfSubToMember(supabase, member, obj);
                await supabase.from("jf_billing_events").insert({
                  stripe_event_id: event.id, type: event.type,
                  customer_id: obj.customer ?? null, subscription_id: obj.id,
                  member_id: member?.id ?? null, payload: obj,
                }).then(() => {}, () => {});
                break;
              }
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_subscription_id: obj.id,
                stripe_customer_id: obj.customer,
              });
              if (purchase) {
                // Cancelled is terminal — refuse to flip back to Active
                // from a stale .updated arriving after .deleted. The matched
                // row must also be tied to the SAME subscription id; a new
                // subscription gets a new purchase_records row.
                if (
                  isTerminalCancelled(purchase) &&
                  purchase.stripe_subscription_id === obj.id
                ) {
                  break;
                }
                // Map Stripe subscription status to app payment_status
                const statusMap: Record<string, string> = {
                  active: "Active Subscription",
                  trialing: "Active Subscription",
                  past_due: "Overdue",
                  unpaid: "Overdue",
                  canceled: "Cancelled",
                  incomplete: "Pending Payment",
                  incomplete_expired: "Failed",
                  paused: "Paused",
                };
                const newPaymentStatus = statusMap[obj.status] ?? purchase.payment_status;
                const newServiceStatus =
                  obj.status === "active" || obj.status === "trialing" ? "Active"
                  // Fix 2: cancel_at_period_end=true → keep access until subscription.deleted fires
                  : obj.status === "canceled" && !obj.cancel_at_period_end ? "Cancelled"
                  : purchase.service_status;

                await supabase.from("purchase_records").update({
                  payment_status: newPaymentStatus,
                  service_status: newServiceStatus,
                  // Update term_end_date from current_period_end if available
                  ...(obj.current_period_end
                    ? { term_end_date: new Date(obj.current_period_end * 1000).toISOString().split("T")[0] }
                    : {}),
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);

                await syncClientStripeCustomerId(supabase, obj.customer ?? null, purchase.client_id ?? null);

                if (obj.status === "active" || obj.status === "trialing") {
                  await provisionMemberFromPurchase(supabase, { ...purchase, stripe_customer_id: obj.customer ?? purchase.stripe_customer_id });
                } else if (obj.status === "canceled" || obj.status === "unpaid") {
                  await revokeMemberFromPurchase(supabase, purchase);
                }
              }
              break;
            }

            // ── Subscription deleted (hard cancel) ──────────────────────────
            case "customer.subscription.deleted": {
              if (await isJfMembershipSubscription(supabase, obj)) {
                const member = await findJfMemberBySub(supabase, obj);
                if (member) await applyJfSubToMember(supabase, member, { ...obj, status: "canceled" });
                await supabase.from("jf_billing_events").insert({
                  stripe_event_id: event.id, type: event.type,
                  customer_id: obj.customer ?? null, subscription_id: obj.id,
                  member_id: member?.id ?? null, payload: obj,
                }).then(() => {}, () => {});
                break;
              }
              const purchase = await resolvePurchase(supabase, obj, { stripe_subscription_id: obj.id });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Cancelled",
                  service_status: "Cancelled",
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
                await revokeMemberFromPurchase(supabase, purchase);
              }
              break;
            }

            // ── Trial ending soon (Stripe fires ~3 days before trial_end) ───
            case "customer.subscription.trial_will_end": {
              if (await isJfMembershipSubscription(supabase, obj)) {
                const member = await findJfMemberBySub(supabase, obj);
                if (member) {
                  await fireJfSms(member.id, "subscription_trial_ending", {
                    trial_end: obj.trial_end
                      ? new Date(obj.trial_end * 1000).toLocaleDateString()
                      : "",
                  });
                  await supabase.from("jf_billing_events").insert({
                    stripe_event_id: event.id, type: event.type,
                    customer_id: obj.customer ?? null, subscription_id: obj.id,
                    member_id: member.id, payload: obj,
                  }).then(() => {}, () => {});
                }
              }
              break;
            }

            // ── Invoice paid (subscription renewal) ─────────────────────────
            case "invoice.payment_succeeded": {
              if (obj.subscription) {
                const sub = await stripeFetch(`/subscriptions/${obj.subscription}`);
                if (await isJfMembershipSubscription(supabase, sub)) {
                  const member = await findJfMemberBySub(supabase, sub);
                  if (member) {
                    await applyJfSubToMember(supabase, member, sub);
                    await supabase.from("app_members").update({ last_invoice_status: "paid" }).eq("id", member.id);
                    // Fire payment-succeeded SMS only on actual paid renewals
                    // (skip the $0 trial-start invoice).
                    if ((obj.amount_paid ?? 0) > 0) {
                      await fireJfSms(member.id, "subscription_payment_succeeded", {
                        amount: obj.amount_paid ? `$${(obj.amount_paid / 100).toFixed(2)}` : "",
                      });
                    }
                  }
                  break;
                }
              }
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_subscription_id: obj.subscription,
                stripe_customer_id: obj.customer,
              });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Active Subscription",
                  // Fix 3: reactivate service_status on successful renewal (handles Overdue recovery)
                  service_status: "Active",
                  paid_at: now,
                  stripe_receipt_url: obj.hosted_invoice_url ?? purchase.stripe_receipt_url,
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
                await provisionMemberFromPurchase(supabase, { ...purchase, stripe_customer_id: obj.customer ?? purchase.stripe_customer_id });
              }
              break;
            }
            // ── Invoice failed (payment issue) ──────────────────────────────
            case "invoice.payment_failed": {
              if (obj.subscription) {
                const sub = await stripeFetch(`/subscriptions/${obj.subscription}`);
                if (await isJfMembershipSubscription(supabase, sub)) {
                  const member = await findJfMemberBySub(supabase, sub);
                  if (member) {
                    await applyJfSubToMember(supabase, member, sub);
                    await supabase.from("app_members").update({ last_invoice_status: "failed" }).eq("id", member.id);
                    await fireJfSms(member.id, "subscription_payment_failed", {
                      amount: obj.amount_due ? `$${(obj.amount_due / 100).toFixed(2)}` : "",
                    });
                  }
                  break;
                }
              }
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_subscription_id: obj.subscription,
                stripe_customer_id: obj.customer,
              });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Overdue",
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }

            // ── One-time payment intent succeeded ───────────────────────────
            case "payment_intent.succeeded": {
              const purchase = await resolvePurchase(supabase, obj, { stripe_payment_intent_id: obj.id });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Paid",
                  paid_at: now,
                  amount_paid: obj.amount_received ? obj.amount_received / 100 : purchase.amount_paid,
                  stripe_receipt_url: obj.charges?.data?.[0]?.receipt_url ?? purchase.stripe_receipt_url,
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
                await provisionMemberFromPurchase(supabase, purchase);
              }
              break;
            }

            // ── Payment intent failed ────────────────────────────────────────
            case "payment_intent.payment_failed": {
              const purchase = await resolvePurchase(supabase, obj, { stripe_payment_intent_id: obj.id });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Failed",
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }

            // ── Refund ───────────────────────────────────────────────────────
            case "charge.refunded": {
              const purchase = await resolvePurchase(supabase, obj, { stripe_payment_intent_id: obj.payment_intent });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Refunded",
                  // Fix 1: revoke access on refund
                  service_status: "Cancelled",
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
                await revokeMemberFromPurchase(supabase, purchase);
              }
              break;
            }

            default:
              break;
          }
        } catch (e: any) {
          console.error("[stripe-webhook] error", e?.message ?? e);
          return new Response("Internal error", { status: 500 });
        }

        return Response.json({ received: true });
      },
    },
  },
});
