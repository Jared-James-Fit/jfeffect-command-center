import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

const UpdatePayment = z.object({
  id: z.string().uuid(),
  payment_status: z.string().min(1).max(60),
  amount_paid: z.number().nonnegative().optional(),
  stripe_receipt_url: z.string().url().max(2000).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

export const updatePurchasePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdatePayment.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const patch: any = {
      payment_status: data.payment_status,
      last_payment_update_source: "manual",
      last_payment_update_at: new Date().toISOString(),
    };
    if (data.amount_paid !== undefined) patch.amount_paid = data.amount_paid;
    if (data.stripe_receipt_url !== undefined) patch.stripe_receipt_url = data.stripe_receipt_url;
    if (data.payment_status === "Paid") {
      patch.paid_at = new Date().toISOString();
    }
    const { error } = await supabase.from("purchase_records").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (data.note) {
      await supabase.from("client_activity_log").insert({
        client_id: (await supabase.from("purchase_records").select("client_id").eq("id", data.id).single()).data?.client_id,
        actor_user_id: userId,
        actor_role: "admin",
        action: "purchase_payment_updated_manually",
        details: { purchase_id: data.id, status: data.payment_status, note: data.note },
      });
    }
    return { ok: true };
  });

const UpdateService = z.object({
  id: z.string().uuid(),
  service_status: z.string().min(1).max(60).optional(),
  term_start_date: z.string().nullable().optional(),
  term_end_date: z.string().nullable().optional(),
});

export const updatePurchaseService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateService.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const patch: any = {};
    if (data.service_status !== undefined) patch.service_status = data.service_status;
    if (data.term_start_date !== undefined) patch.term_start_date = data.term_start_date;
    if (data.term_end_date !== undefined) patch.term_end_date = data.term_end_date;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase.from("purchase_records").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SendLink = z.object({ id: z.string().uuid() });

export const sendPaymentLinkEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendLink.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: rec } = await supabase
      .from("purchase_records")
      .select("*, clients(full_name, email)")
      .eq("id", data.id)
      .single();
    if (!rec) throw new Error("Purchase not found");
    if (!rec.stripe_payment_link) throw new Error("No Stripe payment link on this purchase. Attach one first.");
    if (!rec.clients?.email) throw new Error("Client has no email on file.");

    const { data: settings } = await supabase
      .from("email_sender_settings").select("*").eq("singleton", true).maybeSingle();

    const subject = `Action required: Set up payment for ${rec.offer_name}`;
    const body = [
      `Hi ${rec.clients.full_name?.split(" ")[0] ?? "there"},`,
      ``,
      `Here's your payment link for ${rec.offer_name}:`,
      rec.stripe_payment_link,
      ``,
      `Amount: ${rec.currency ?? "USD"} ${Number(rec.full_payable_amount ?? 0).toLocaleString()}`,
      rec.payment_structure ? `Payment structure: ${rec.payment_structure}` : "",
      ``,
      `Reach out if you have any questions before completing payment.`,
      ``,
      `— Coach Jared / JF Effect`,
    ].filter(Boolean).join("\n");

    if (!settings || settings.provider !== "gmail" || !process.env.GOOGLE_MAIL_API_KEY || !process.env.LOVABLE_API_KEY) {
      return { ok: false, sent: false, reason: "Email sender not configured. Copy the link manually." };
    }

    const from = `${settings.sender_name} <${settings.sender_email}>`;
    const replyTo = settings.reply_to_email;
    const raw = [
      `From: ${from}`,
      `To: ${rec.clients.email}`,
      `Reply-To: ${replyTo}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      body,
    ].join("\r\n");
    const b64 = Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = await fetch("https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": process.env.GOOGLE_MAIL_API_KEY!,
      },
      body: JSON.stringify({ raw: b64 }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Gmail send failed (${res.status}): ${t.slice(0, 200)}`);
    }
    return { ok: true, sent: true };
  });

const CreateLink = z.object({
  offer_id: z.string().uuid(),
});

const STRIPE_API = "https://api.stripe.com/v1";
function formEncode(params: Record<string, string | number | boolean | null | undefined>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    usp.append(k, String(v));
  }
  return usp.toString();
}
async function stripeFetch(path: string, init: { method?: string; body?: string } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY in project secrets.");
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: init.body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error (${res.status})`);
  return json;
}

export const createStripeLinkForOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateLink.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: offer, error: oErr } = await supabase.from("offers").select("*").eq("id", data.offer_id).single();
    if (oErr || !offer) throw new Error("Offer not found");
    const amount = Number(offer.full_payable_amount ?? offer.price ?? 0);
    if (!amount || amount <= 0) throw new Error("Offer needs a price / full payable amount before creating a Stripe link.");
    const currency = (offer.currency ?? "USD").toLowerCase();

    const product = await stripeFetch("/products", {
      method: "POST",
      body: formEncode({ name: offer.name, ...(offer.short_description ? { description: offer.short_description } : {}) }),
    });
    const price = await stripeFetch("/prices", {
      method: "POST",
      body: formEncode({ product: product.id, unit_amount: Math.round(amount * 100), currency }),
    });
    const link = await stripeFetch("/payment_links", {
      method: "POST",
      body: formEncode({ "line_items[0][price]": price.id, "line_items[0][quantity]": 1 }),
    });

    await supabase.from("offers").update({
      stripe_product_id: product.id,
      stripe_price_id: price.id,
      stripe_payment_link: link.url,
    }).eq("id", offer.id);

    await supabase.from("coaching_products").insert({
      name: offer.name,
      description: offer.short_description ?? null,
      details: offer.description ?? null,
      price_cents: Math.round(amount * 100),
      currency,
      stripe_product_id: product.id,
      stripe_price_id: price.id,
      stripe_payment_link_id: link.id,
      payment_link_url: link.url,
      offer_id: offer.id,
      payment_structure: offer.payment_structure ?? null,
      mode: "auto",
      created_by: userId,
    });

    return { ok: true, url: link.url };
  });

const AttachManual = z.object({
  offer_id: z.string().uuid().nullable(),
  title: z.string().min(1).max(200),
  url: z.string().url().max(2000),
  price_cents: z.number().int().min(0).max(100_000_00),
  currency: z.string().min(3).max(3).default("usd"),
  payment_structure: z.string().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const attachManualPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AttachManual.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: row, error } = await supabase.from("coaching_products").insert({
      name: data.title,
      price_cents: data.price_cents,
      currency: data.currency.toLowerCase(),
      payment_link_url: data.url,
      offer_id: data.offer_id,
      payment_structure: data.payment_structure ?? null,
      notes: data.notes ?? null,
      mode: "manual",
      created_by: userId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return { ok: true, product: row };
  });