/**
 * business-books.functions.ts
 *
 * Admin-only server functions for Taxes & Books (Sales hub) and Cleo.
 * Reads and writes go through the caller's RLS-scoped client; the tables and
 * the receipts bucket only admit admins.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXPENSE_CATEGORIES, PICKABLE_CATEGORIES } from "@/lib/business-expense-categories";
import { RECEIPTS_BUCKET, type ExpenseRow } from "@/lib/business-books";
import { businessToday } from "@/lib/billing-schedule";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CategoryKey = z.string().refine((k) => EXPENSE_CATEGORIES.some((c) => c.key === k), "Unknown category");
const ReceiptPath = z.string().min(3).max(300).regex(/^[\w\-./]+$/).refine((p) => !p.includes(".."), "Bad path");

// ---------------------------------------------------------------------------
// Load

export const getBooksData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { assertBusinessOwner, loadBooksData } = await import("@/lib/business-books.server");
    await assertBusinessOwner(supabase, userId);
    return loadBooksData(supabase);
  });

// ---------------------------------------------------------------------------
// Expenses

const ExpenseInput = z.object({
  id: z.string().uuid().optional(),
  expense_date: Day,
  vendor: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  category: CategoryKey,
  amount_minor: z.number().int().min(0).max(100_000_000),
  tax_minor: z.number().int().min(0).max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default("CAD"),
  payment_method: z.string().trim().max(40).nullable().optional(),
  business_use_pct: z.number().min(0).max(100).default(100),
  receipt_path: ReceiptPath.nullable().optional(),
  receipt_mime: z.string().max(80).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).refine((d) => d.tax_minor <= d.amount_minor, { message: "GST/HST can't be more than the total", path: ["tax_minor"] });

export const saveExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExpenseInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertBusinessOwner } = await import("@/lib/business-books.server");
    await assertBusinessOwner(supabase, userId);
    const row = {
      expense_date: data.expense_date,
      vendor: data.vendor || null,
      description: data.description || null,
      category: data.category,
      amount_minor: data.amount_minor,
      tax_minor: data.tax_minor,
      currency: data.currency,
      payment_method: data.payment_method || null,
      business_use_pct: data.business_use_pct,
      notes: data.notes || null,
      // Saving from the form is the owner confirming it.
      status: "reviewed" as const,
      ...(data.receipt_path !== undefined ? { receipt_path: data.receipt_path, receipt_mime: data.receipt_mime ?? null } : {}),
    };
    let replacedReceipt: string | null = null;
    if (data.id && data.receipt_path !== undefined) {
      const { data: before } = await supabase.from("business_expenses").select("receipt_path").eq("id", data.id).maybeSingle();
      if (before?.receipt_path && before.receipt_path !== data.receipt_path) replacedReceipt = before.receipt_path;
    }
    const q = data.id
      ? supabase.from("business_expenses").update(row).eq("id", data.id).select("*").single()
      : supabase.from("business_expenses").insert({ ...row, source: "manual" }).select("*").single();
    const { data: saved, error } = await q;
    if (error) throw new Error(error.message);
    if (replacedReceipt) await supabase.storage.from(RECEIPTS_BUCKET).remove([replacedReceipt]);
    return saved as ExpenseRow;
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertBusinessOwner } = await import("@/lib/business-books.server");
    await assertBusinessOwner(supabase, userId);
    const { data: row } = await supabase.from("business_expenses").select("receipt_path").eq("id", data.id).maybeSingle();
    const { error } = await supabase.from("business_expenses").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (row?.receipt_path) await supabase.storage.from(RECEIPTS_BUCKET).remove([row.receipt_path]);
    return { ok: true };
  });

export const markExpensesReviewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertBusinessOwner } = await import("@/lib/business-books.server");
    await assertBusinessOwner(supabase, userId);
    const { error } = await supabase.from("business_expenses").update({ status: "reviewed" }).in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Receipts: the owner uploads the photo/PDF to the private bucket, then Cleo
// reads it and files an expense. The expense is created even if reading
// fails, so a receipt is never lost; it is just flagged for review.

function receiptPrompt(today: string): string {
  const cats = PICKABLE_CATEGORIES.map((c) => `- ${c.key}: ${c.label}. e.g. ${c.examples}`).join("\n");
  return [
    "You read receipts and invoices for a Canadian fitness coaching business in Manitoba and file them for the bookkeeper.",
    `Today is ${today}.`,
    "Reply with ONE JSON object only (no markdown), exactly these keys:",
    '{"is_receipt": boolean, "vendor": string|null, "date": "YYYY-MM-DD"|null, "total": number|null, "gst_hst": number|null, "pst": number|null,',
    ' "currency": "CAD"|"USD"|..., "category": string, "description": string|null, "payment_method": string|null,',
    ' "business_use_pct": number, "confidence": number, "notes": string|null}',
    "",
    "Rules:",
    "- total: the amount actually paid, taxes and tip included, in dollars (12.34).",
    "- gst_hst: the GST or HST only. Never include PST, RST or QST (put those in pst). If only a combined Manitoba 12% tax is shown, gst_hst = that tax x 5/12. If no tax is shown, 0.",
    "- date: the purchase date on the receipt. Canadian receipts may print DD/MM/YY; use the vendor and context to decide. null if unreadable.",
    "- description: a few words on what was bought (e.g. 'Lifting straps and chalk').",
    "- business_use_pct: 100 unless the item is clearly part personal (phone plan, internet, vehicle: use 50 if unsure).",
    "- category: one key from this list:",
    cats,
    "- Use personal for things that are clearly personal (groceries, own clothing, own gym membership, own supplements).",
    "- confidence: 0 to 1, how sure you are about total, date and category together. Below 0.8 if anything is blurry, cut off or a guess.",
    "- notes: anything the owner should check (e.g. 'Tip handwritten', 'Two receipts in one photo'). null if nothing.",
    "- If the image is not a receipt or invoice, is_receipt false and everything else null/0.",
  ].join("\n");
}

const ScanInput = z.object({
  path: ReceiptPath,
  mime: z.string().max(80),
});

export const scanReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ScanInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const server = await import("@/lib/business-books.server");
    await server.assertBusinessOwner(supabase, userId);
    const today = businessToday();

    let read: import("@/lib/business-books.server").ReceiptRead | null = null;
    let failure: string | null = null;
    try {
      const { data: blob, error } = await supabase.storage.from(RECEIPTS_BUCKET).download(data.path);
      if (error || !blob) throw new Error(error?.message ?? "Receipt file not found");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) throw new Error("File is too large to read automatically");
      const mime = data.mime || blob.type || "image/jpeg";
      const dataUrl = `data:${mime};base64,${server.toBase64(bytes)}`;
      const filePart = mime === "application/pdf"
        ? { type: "file", file: { filename: "receipt.pdf", file_data: dataUrl } }
        : { type: "image_url", image_url: { url: dataUrl } };
      const text = await server.gatewayChat([
        { role: "system", content: receiptPrompt(today) },
        { role: "user", content: [{ type: "text", text: "File this receipt." }, filePart] },
      ]);
      read = server.sanitizeReceiptRead(server.parseJsonLoose(text), today);
    } catch (e: any) {
      failure = e?.message ?? "Could not read the receipt";
    }

    const row = {
      expense_date: read?.date ?? today,
      vendor: read?.vendor ?? null,
      description: read?.description ?? null,
      category: read?.category ?? "uncategorized",
      amount_minor: read?.totalMinor ?? 0,
      tax_minor: read && read.totalMinor != null ? Math.min(read.gstMinor, read.totalMinor) : 0,
      currency: read?.currency ?? "CAD",
      payment_method: read?.paymentMethod ?? null,
      business_use_pct: read?.businessUsePct ?? 100,
      receipt_path: data.path,
      receipt_mime: data.mime || null,
      status: !read || server.receiptNeedsReview(read) ? "needs_review" : "reviewed",
      source: "receipt",
      ai_summary: read
        ? { read: true, confidence: read.confidence, notes: read.notes, pst: read.pstMinor, is_receipt: read.isReceipt }
        : { read: false, notes: failure },
    };
    const { data: saved, error } = await supabase.from("business_expenses").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return { expense: saved as ExpenseRow, read: !!read, failure };
  });

// ---------------------------------------------------------------------------
// Settings and tax payments

const SettingsInput = z.object({
  business_name: z.string().trim().min(1).max(120),
  business_structure: z.enum(["sole_proprietor", "corporation"]),
  gst_registered: z.boolean(),
  gst_number: z.string().trim().max(30).nullable(),
  gst_filing_frequency: z.enum(["monthly", "quarterly", "annual"]),
  other_income_annual_minor: z.number().int().min(0).max(100_000_000_00),
  accountant_name: z.string().trim().max(120).nullable(),
  notes: z.string().trim().max(4000).nullable(),
});

export const saveTaxSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SettingsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertBusinessOwner } = await import("@/lib/business-books.server");
    await assertBusinessOwner(supabase, userId);
    const { error } = await supabase
      .from("business_tax_settings")
      .upsert({ id: true, ...data, gst_number: data.gst_number || null, accountant_name: data.accountant_name || null, notes: data.notes || null, updated_at: new Date().toISOString(), updated_by: userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const PaymentInput = z.object({
  paid_on: Day,
  kind: z.enum(["gst_hst", "income_tax"]),
  tax_year: z.number().int().min(2000).max(2100),
  period_label: z.string().trim().max(60).nullable().optional(),
  amount_minor: z.number().int().min(1).max(100_000_000),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const addTaxPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PaymentInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertBusinessOwner } = await import("@/lib/business-books.server");
    await assertBusinessOwner(supabase, userId);
    const { error } = await supabase.from("business_tax_payments").insert({
      ...data,
      period_label: data.period_label || null,
      reference: data.reference || null,
      notes: data.notes || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTaxPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertBusinessOwner } = await import("@/lib/business-books.server");
    await assertBusinessOwner(supabase, userId);
    const { error } = await supabase.from("business_tax_payments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Stripe fees -> monthly expenses (read-only against Stripe)

export const syncStripeFees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ year: z.number().int().min(2020).max(2100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertBusinessOwner } = await import("@/lib/business-books.server");
    await assertBusinessOwner(supabase, userId);
    const { stripeFetch, getStripeKeyForMode } = await import("@/lib/stripe.server");
    const { aggregateStripeFees, stripeFeesExternalKey } = await import("@/lib/stripe-fees");
    const { MONTH_NAMES } = await import("@/lib/business-tax");

    const apiKey = getStripeKeyForMode("live");
    if (!apiKey) return { ok: false as const, error: "No live Stripe key is configured.", months: 0 };

    // A day of slack on both ends; bucketing into Winnipeg months happens below.
    const from = Math.floor(Date.UTC(data.year, 0, 1) / 1000) - 86400;
    const to = Math.floor(Date.UTC(data.year + 1, 0, 1) / 1000) + 86400;
    const txns: any[] = [];
    let startingAfter: string | null = null;
    for (let page = 0; page < 50; page++) {
      const qs = new URLSearchParams({ limit: "100", "created[gte]": String(from), "created[lt]": String(to) });
      if (startingAfter) qs.set("starting_after", startingAfter);
      const res: any = await stripeFetch(`/balance_transactions?${qs.toString()}`, { apiKey });
      const rows: any[] = res?.data ?? [];
      txns.push(...rows);
      if (!res?.has_more || !rows.length) break;
      startingAfter = rows[rows.length - 1].id;
    }

    const months = aggregateStripeFees(txns).filter((m) => m.month.startsWith(`${data.year}-`));
    const keys = months.map((m) => stripeFeesExternalKey(m.month, m.currency));
    const { data: existing } = keys.length
      ? await supabase.from("business_expenses").select("id, external_key").in("external_key", keys)
      : { data: [] };
    const existingByKey = new Map<string, string>((existing ?? []).map((e: any) => [e.external_key, e.id]));

    let created = 0;
    let updated = 0;
    for (const m of months) {
      const key = stripeFeesExternalKey(m.month, m.currency);
      const [y, mm] = m.month.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
      const parts = [
        m.processingMinor ? `processing $${(m.processingMinor / 100).toFixed(2)}` : null,
        m.serviceMinor ? `Billing/Tax/invoicing $${(m.serviceMinor / 100).toFixed(2)}` : null,
        m.payoutMinor ? `instant payouts $${(m.payoutMinor / 100).toFixed(2)}` : null,
        m.salesTaxMinor ? `sales tax on fees $${(m.salesTaxMinor / 100).toFixed(2)} (GST part $${(m.gstMinor / 100).toFixed(2)})` : null,
      ].filter(Boolean).join(", ");
      const fields = {
        amount_minor: m.totalMinor,
        tax_minor: m.gstMinor,
        currency: m.currency,
        description: `Stripe fees, ${MONTH_NAMES[mm - 1]} ${y}`,
        notes: `${m.count} Stripe transactions: ${parts}. Synced from Stripe.`,
      };
      const id = existingByKey.get(key);
      if (id) {
        // Keep any category or business-use change the owner made.
        const { error } = await supabase.from("business_expenses").update(fields).eq("id", id);
        if (!error) updated++;
      } else {
        const { error } = await supabase.from("business_expenses").insert({
          ...fields,
          expense_date: lastDay > businessToday() ? businessToday() : lastDay,
          vendor: "Stripe",
          category: "bank_fees",
          payment_method: "Stripe",
          status: "reviewed",
          source: "stripe_fees",
          external_key: key,
        });
        if (!error) created++;
      }
    }

    await supabase.from("business_tax_settings").update({ stripe_fees_synced_at: new Date().toISOString() }).eq("id", true);
    return { ok: true as const, months: months.length, created, updated, transactions: txns.length };
  });

// ---------------------------------------------------------------------------
// Cleo

export const getSummerMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { assertAdmin } = await import("@/lib/business-books.server");
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("summer_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ id: string; role: "user" | "assistant"; content: string; created_at: string }>).reverse();
  });

const AskInput = z.object({
  message: z.string().trim().min(1).max(4000),
  year: z.number().int().min(2000).max(2100).optional(),
  route: z.string().max(300).optional(),
  voice: z.boolean().optional(),
});

export const askSummer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AskInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertAdmin } = await import("@/lib/business-books.server");
    await assertAdmin(supabase, userId);
    const { answerSummer } = await import("@/lib/summer.server");
    return answerSummer(supabase, userId, { message: data.message, year: data.year, route: data.route, voice: data.voice });
  });

const VoiceInput = z.object({
  /** Base64 audio (webm/opus on most browsers, mp4/aac on iPhone). ~45s max. */
  audio: z.string().min(16).max(4_000_000),
  mime: z.string().max(80),
  year: z.number().int().min(2000).max(2100).optional(),
  route: z.string().max(300).optional(),
});

/** Talk to Cleo: hear the question, answer it in voice mode. */
export const askSummerVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => VoiceInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertAdmin } = await import("@/lib/business-books.server");
    await assertAdmin(supabase, userId);
    const { answerSummer, transcribeAudio } = await import("@/lib/summer.server");
    const transcript = await transcribeAudio(data.audio, data.mime);
    if (!transcript) return { transcript: "", user: null, assistant: null };
    const res = await answerSummer(supabase, userId, { message: transcript, year: data.year, route: data.route, voice: true });
    return { transcript, ...res };
  });

/** Cleo's voice for a reply. ok:false means the browser should use a device voice. */
export const summerSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        text: z.string().trim().min(1).max(1500),
        rate: z.number().min(0.5).max(1.5).optional(),
        prev: z.string().max(1500).optional(),
        next: z.string().max(1500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertAdmin } = await import("@/lib/business-books.server");
    await assertAdmin(supabase, userId);
    const { synthesizeSpeech } = await import("@/lib/summer.server");
    return synthesizeSpeech(data);
  });

/** Light read for the global Cleo button: this admin's Cleo settings and whether they own the books. */
export const getSummerProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { assertAdmin, isBusinessOwner } = await import("@/lib/business-books.server");
    await assertAdmin(supabase, userId);
    const [{ data }, owner] = await Promise.all([
      supabase.from("summer_profiles").select("tone, instructions").eq("user_id", userId).maybeSingle(),
      isBusinessOwner(supabase, userId),
    ]);
    return { tone: (data?.tone as string | null) ?? null, instructions: (data?.instructions as string | null) ?? null, isOwner: owner };
  });

const SummerSettingsInput = z.object({
  tone: z.enum(["girly_pop", "chill", "professional"]),
  instructions: z.string().trim().max(2000).nullable(),
});

/** Customize Cleo: her vibe and this admin's own instructions. */
export const saveSummerSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SummerSettingsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { assertAdmin } = await import("@/lib/business-books.server");
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("summer_profiles")
      .upsert({ user_id: userId, tone: data.tone, instructions: data.instructions || null, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearSummer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { assertAdmin } = await import("@/lib/business-books.server");
    await assertAdmin(supabase, userId);
    const { error } = await supabase.from("summer_messages").delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
