/**
 * "Ready to start" on the site (direct-checkout.ts has the rules): whether it's
 * offered for a package, and the short intake that opens Stripe Checkout. The
 * intake is a lead like any application (one client record by email or phone,
 * upsertApplicantClient; one coaching_applications row, source direct_checkout,
 * on the Leads page), and the purchase is the plan system's own checkout
 * (startDirectCheckout), applied only once Stripe's signed webhook says paid.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { APPLY_GOALS, OUTCOME_MAX, phoneOk } from "@/lib/apply-form";
import { cleanIntake, consentText, directCheckoutGate, intakeError, recurringTerms, type Gate } from "./direct-checkout";

const SlugInput = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60) });

type PackageRow = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  status: string;
  is_public: boolean;
  direct_checkout: boolean;
  price_cents: number | null;
  currency: string | null;
  billing_interval: string | null;
  product_id: string | null;
};

async function gateFor(db: any, slug: string): Promise<{ gate: Gate; pkg: PackageRow | null }> {
  const { data: pkg } = await db
    .from("coaching_packages")
    .select("id, slug, name, kind, status, is_public, direct_checkout, price_cents, currency, billing_interval, product_id")
    .eq("slug", slug)
    .maybeSingle();
  const row = (pkg ?? null) as PackageRow | null;
  const packageOn = !!row && row.kind === "subscription" && row.status === "active" && row.is_public && row.direct_checkout;
  let problem: string | null = null;
  if (row && packageOn) {
    const { configProblem } = await import("@/lib/plans/plan-engine");
    const { data: product } = row.product_id
      ? await db.from("coaching_products").select("id, name, price_cents, currency, stripe_price_id, mode, payment_structure, active, archived").eq("id", row.product_id).maybeSingle()
      : { data: null };
    problem = configProblem(row as any, product as any);
  }
  const { detectStripeKeyMode } = await import("@/lib/stripe.server");
  const { data: setting } = await db.from("app_settings").select("value").eq("key", "coaching_direct_checkout.live_enabled").maybeSingle();
  const gate = directCheckoutGate({
    packageOn,
    problem,
    keyMode: detectStripeKeyMode(process.env.STRIPE_SECRET_KEY ?? null),
    liveEnabled: String(setting?.value ?? "").toLowerCase() === "true",
  });
  return { gate, pkg: row };
}

export type DirectCheckoutOffer = {
  available: boolean;
  name: string | null;
  priceCents: number | null;
  currency: string;
  terms: string[];
};

/** Is "Ready to start" offered for this package? Public; says nothing private. */
export const getDirectCheckout = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => SlugInput.parse(d))
  .handler(async ({ data }): Promise<DirectCheckoutOffer> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { gate, pkg } = await gateFor(supabaseAdmin, data.slug);
      if (!gate.available || !pkg) return { available: false, name: null, priceCents: null, currency: "CAD", terms: [] };
      const terms = recurringTerms({ name: pkg.name, priceCents: pkg.price_cents, currency: pkg.currency });
      return { available: true, name: pkg.name, priceCents: pkg.price_cents, currency: (pkg.currency || "CAD").toUpperCase(), terms };
    } catch {
      return { available: false, name: null, priceCents: null, currency: "CAD", terms: [] };
    }
  });

const StartInput = z
  .object({
    package: SlugInput.shape.slug,
    full_name: z.string().max(200),
    email: z.string().max(254),
    phone: z.string().max(60).optional().default(""),
    main_goal: z.enum(APPLY_GOALS.map((g) => g.v) as [string, ...string[]]),
    target_outcome: z.string().max(OUTCOME_MAX + 50).optional().default(""),
    agree: z.literal(true),
    honeypot: z.string().max(0).optional().default(""),
    origin: z.string().max(200).optional(),
    source_page: z.string().max(200).optional().default(""),
    page_url: z.string().max(1000).optional().default(""),
    referrer: z.string().max(1000).optional().default(""),
  })
  .refine((d) => !d.honeypot, { message: "Spam detected" });

const PER_IP_PER_HOUR = 6;
const PER_EMAIL_PER_DAY = 4;

export type StartResult = { ok: true; url: string } | { ok: false; message: string; book?: boolean };

/** The intake → one lead → Stripe Checkout. Nothing is charged or granted here. */
export const startDirectCoachingCheckout = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => StartInput.parse(d))
  .handler(async ({ data }): Promise<StartResult> => {
    const intake = cleanIntake({
      full_name: data.full_name,
      email: data.email,
      phone: data.phone ?? "",
      main_goal: data.main_goal,
      target_outcome: data.target_outcome ?? "",
    });
    const problem = intakeError(intake);
    if (problem) return { ok: false, message: problem };
    if (intake.phone && !phoneOk(intake.phone)) return { ok: false, message: "Add a phone number with the area code." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { allRatesOk, callerIp } = await import("@/lib/public-rate-limit.server");
    const ip = callerIp();
    const allowed = await allRatesOk(db, [
      { key: ip ? `direct:ip:${ip}` : null, max: PER_IP_PER_HOUR, window: "1 hour" },
      { key: `direct:email:${intake.email}`, max: PER_EMAIL_PER_DAY, window: "1 day" },
    ]);
    if (!allowed) return { ok: false, message: "Too many tries for now. Try again later, or book a call instead.", book: true };

    const { gate, pkg } = await gateFor(db, data.package);
    if (!gate.available || !pkg) return { ok: false, message: "This package can't be bought on the site right now. Book a call instead.", book: true };

    // One lead: the same client record every application and booking uses.
    const { upsertApplicantClient } = await import("@/lib/crm.functions");
    const [first, ...rest] = intake.full_name.split(" ");
    const lead = await upsertApplicantClient(db, {
      first_name: first ?? intake.full_name,
      last_name: rest.join(" "),
      email: intake.email,
      phone: intake.phone || null,
      source: "direct_checkout",
      recommended_offer: pkg.name,
    });
    if (lead.conflict) {
      // the email and the phone belong to two different people: the coach sorts it out on a call
      return { ok: false, message: "We couldn't match that email and phone number. Book a call and we'll sort it out.", book: true };
    }

    const { resolveAttribution } = await import("@/lib/application-attribution");
    const attribution = resolveAttribution({
      from: data.source_page || null,
      page_url: data.page_url || null,
      referrer: data.referrer || null,
      form_name: "Ready to start",
      default_source_label: "Website",
    });
    const now = new Date().toISOString();
    const terms = consentText({ name: pkg.name, priceCents: pkg.price_cents, currency: pkg.currency });
    const { data: app, error: appErr } = await db
      .from("coaching_applications")
      .insert({
        client_id: lead.client_id,
        first_name: first ?? intake.full_name,
        last_name: rest.join(" ") || null,
        full_name: intake.full_name,
        email: intake.email,
        phone: intake.phone || null,
        main_goal: intake.main_goal,
        target_outcome: intake.target_outcome || null,
        timeline: "asap",
        coaching_interest: pkg.name,
        package_slug: pkg.slug,
        package_snapshot: { slug: pkg.slug, name: pkg.name, price_cents: pkg.price_cents, billing_interval: "month" },
        application_source: "direct_checkout",
        source: "coaching_application",
        source_label: attribution.source_label,
        form_name: "Ready to start",
        page_path: attribution.page_path,
        page_url: attribution.page_url,
        referrer: attribution.referrer,
        utm_source: attribution.utm_source,
        utm_medium: attribution.utm_medium,
        utm_campaign: attribution.utm_campaign,
        application_status: "submitted",
        call_status: "not_booked",
        status: "Checkout started",
        summary: `Ready to start: ${pkg.name} · checkout opened`,
        consent_contact_at: now,
        is_test: gate.available && gate.mode === "test",
        submitted_at: now,
        goals: [intake.main_goal, intake.target_outcome].filter(Boolean).join("\n\n") || null,
      })
      .select("id")
      .single();
    if (appErr) throw new Error(appErr.message);
    await db
      .from("client_crm_activities")
      .insert({
        client_id: lead.client_id,
        activity_type: "checkout_started",
        title: `Started checkout: ${pkg.name}`,
        details: { application_id: app.id, package: pkg.slug, terms },
        source: "public_form",
        application_id: app.id,
        dedupe_key: `direct_checkout:${app.id}`,
      })
      .then(() => {}, () => {});

    const { startDirectCheckout, PlanError } = await import("@/lib/plans/plans.server");
    const { safeOrigin } = await import("@/lib/plans/plans.functions");
    try {
      const r = await startDirectCheckout(db, lead.client_id, pkg.slug, {
        origin: safeOrigin(data.origin),
        consentText: terms,
        applicationId: app.id,
      });
      return { ok: true, url: r.url };
    } catch (e) {
      const message = e instanceof PlanError ? e.message : "Checkout couldn't be opened. Nothing was charged; please try again.";
      await db.from("coaching_applications").update({ status: "New", summary: `Ready to start: ${pkg.name} · ${message}`.slice(0, 500) }).eq("id", app.id);
      return { ok: false, message, book: !(e instanceof PlanError) || /call/i.test(message) };
    }
  });
