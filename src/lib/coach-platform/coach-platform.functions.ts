/**
 * JF Effect for coaches on the server (early access only; nothing here
 * creates a business, a login or a charge).
 *
 *   Public (no sign-in): what the site may say (coach_platform_public(): a
 *     price only once the owner published one, registration always closed),
 *     and the early-access application (rate limited per connection, a bot
 *     gets the same answer and nothing is saved).
 *   Admin: the waitlist (read and worked through the service role after the
 *     admin check; the table has no client policies), the launch settings and
 *     the pricing (through the caller's own login: the SQL checks the admin).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COACH_NOTICE_VERSION,
  COACH_STEPS,
  EMPTY_COACH_ANSWERS,
  MARKETING_CONSENT,
  PRIVACY_NOTICE,
  APPLICATION_STATUSES,
  cleanAnswers,
  firstNameFrom,
  firstProblem,
  stepProblem,
  type ApplicationStatus,
  type CoachAnswers,
} from "./apply";
import { pricingFromRow, type SeatPricing } from "./seat-pricing";

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

let anonClient: any = null;
/** The public's own access (anon key): coach_platform_public() is granted to anon. */
async function publicDb() {
  if (anonClient) return anonClient;
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase isn't configured.");
  anonClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return anonClient;
}

async function assertAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Only the owner can see this.");
}

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|headless|lighthouse/i;
const TEST_EMAIL = (email: string) =>
  /@(example\.(com|org|net))$/i.test(email) || /\.(test|example|invalid|localhost)$/i.test(email);

/* ───────────────────────── public ───────────────────────── */

export type CoachPlatformPublic = { pricing: SeatPricing | null; registrationOpen: false };

/** What the coach page may say. Anything unreadable reads as no price (the page still works). */
export const getCoachPlatformPublic = createServerFn({ method: "GET" }).handler(async (): Promise<CoachPlatformPublic> => {
  try {
    const db = await publicDb();
    const { data, error } = await db.rpc("coach_platform_public");
    if (error || !data) return { pricing: null, registrationOpen: false };
    return { pricing: pricingFromRow((data as any).pricing ?? null), registrationOpen: false };
  } catch {
    return { pricing: null, registrationOpen: false };
  }
});

const optText = (max: number) => z.string().max(max).optional().nullable();

const ApplyInput = z.object({
  specialties: z.array(z.string().max(20)).max(8),
  client_band: z.string().max(10),
  works_as: z.string().max(10),
  current_platform: z.string().max(20).optional().default(""),
  full_name: z.string().max(200),
  business_name: z.string().max(200).optional().default(""),
  link: z.string().max(300).optional().default(""),
  country: z.string().max(10),
  region: z.string().max(120).optional().default(""),
  email: z.string().max(254),
  privacy_ack: z.boolean(),
  marketing_ok: z.boolean().optional().default(false),
  // bot traps and attribution: never shown, never a reason to refuse a person
  honeypot: z.string().max(200).optional().default(""),
  elapsed_ms: z.number().int().min(0).max(86_400_000).optional().default(0),
  source_page: optText(80),
  referrer: optText(500),
  utm_source: optText(120),
  utm_medium: optText(120),
  utm_campaign: optText(120),
});

/** Faster than a person could read eight screens: a script. */
const MIN_HUMAN_MS = 4000;

export type CoachApplyResult = { ok: true; status: "received" | "updated"; firstName: string };

export const submitCoachApplication = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ApplyInput.parse(i))
  .handler(async ({ data }): Promise<CoachApplyResult> => {
    const answers: CoachAnswers = {
      ...EMPTY_COACH_ANSWERS,
      specialties: data.specialties,
      client_band: data.client_band,
      works_as: data.works_as,
      current_platform: data.current_platform ?? "",
      full_name: data.full_name,
      business_name: data.business_name ?? "",
      link: data.link ?? "",
      country: data.country,
      region: data.region ?? "",
      email: data.email,
      privacy_ack: data.privacy_ack,
      marketing_ok: !!data.marketing_ok,
    };
    const bad = firstProblem(answers);
    if (bad >= 0) throw new Error(stepProblem(COACH_STEPS[bad]!, answers)!.message);
    const clean = cleanAnswers(answers);
    const firstName = firstNameFrom(clean.full_name);

    // A bot gets the same answer a person does, and nothing is saved.
    if (data.honeypot || data.elapsed_ms < MIN_HUMAN_MS || BOT_UA.test(getRequestHeader("user-agent") ?? "")) {
      return { ok: true, status: "received", firstName };
    }

    const sb = await admin();
    const { callerIp, allRatesOk } = await import("@/lib/public-rate-limit.server");
    const { ipHash } = await import("@/lib/membership-activation.server");
    const ip = ipHash(callerIp());
    const allowed = await allRatesOk(sb, [
      { key: ip ? `coach_apply:ip:${ip}` : null, max: 5, window: "1 hour" },
      { key: `coach_apply:email:${clean.email}`, max: 5, window: "1 day" },
    ]);
    if (!allowed) throw new Error("A few applications just came from here. Try again in an hour.");

    const now = new Date().toISOString();
    const row = {
      full_name: clean.full_name,
      email: clean.email,
      business_name: clean.business_name,
      instagram: clean.instagram,
      website: clean.website,
      country: clean.country,
      region: clean.region,
      specialties: clean.specialties,
      client_band: clean.client_band,
      works_as: clean.works_as,
      current_platform: clean.current_platform,
      privacy_notice_version: COACH_NOTICE_VERSION,
      privacy_notice_text: PRIVACY_NOTICE,
      privacy_ack_at: now,
      marketing_consent: clean.marketing_ok,
      marketing_consent_text: clean.marketing_ok ? MARKETING_CONSENT : null,
      marketing_consent_at: clean.marketing_ok ? now : null,
      source_page: data.source_page ?? null,
      referrer: data.referrer ?? null,
      utm_source: data.utm_source ?? null,
      utm_medium: data.utm_medium ?? null,
      utm_campaign: data.utm_campaign ?? null,
      ip_hash: ip,
      is_test: TEST_EMAIL(clean.email),
    };

    // Applying again while it's open updates the one they have.
    const { data: open } = await sb
      .from("coach_platform_applications")
      .select("id, marketing_consent")
      .eq("email", clean.email)
      .in("status", ["new", "contacted", "waitlisted"])
      .limit(1)
      .maybeSingle();
    if (open) {
      // a later "no" to marketing is a withdrawal, kept as one; a later "yes" is new consent
      const patch: Record<string, unknown> = { ...row };
      if (open.marketing_consent && !clean.marketing_ok) {
        patch.marketing_withdrawn_at = now;
      }
      const { error } = await sb.from("coach_platform_applications").update(patch).eq("id", open.id);
      if (error) throw new Error("That didn't send. Your answers are saved: tap Send again.");
      return { ok: true, status: "updated", firstName };
    }

    const { data: ins, error } = await sb.from("coach_platform_applications").insert(row).select("id").single();
    if (error) {
      if (error.code === "23505") return { ok: true, status: "updated", firstName };
      console.warn("[coach-apply] insert failed", error.message);
      throw new Error("That didn't send. Your answers are saved: tap Send again.");
    }
    if (!row.is_test) await pushNewCoachApplication(sb, { id: ins.id, full_name: clean.full_name });
    return { ok: true, status: "received", firstName };
  });

/** One content-free push to each admin; a burst collapses into one. Never throws. */
async function pushNewCoachApplication(sb: any, app: { id: string; full_name: string }) {
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const { safeDisplayName } = await import("@/lib/push/notification-payload");
    const { data: admins } = await sb.from("user_roles").select("user_id").eq("role", "admin");
    const name = safeDisplayName(app.full_name, "A coach");
    for (const a of (admins ?? []) as any[]) {
      if (!a.user_id) continue;
      await sendWebPushToUser(
        sb,
        a.user_id,
        {
          title: `Coach early access: ${name}`,
          body: "A coach asked for early access to JF Effect for coaches.",
          url: `/admin/coach-platform?app=${app.id}`,
          tag: "coach_platform_application",
          data: { kind: "coach_platform_application", sourceId: app.id },
        },
        {
          category: "coaching_apps",
          eventKey: `coach_platform_application:${app.id}:${a.user_id}`,
          rateKey: "coach_platform_application",
          rateWindowMinutes: 30,
          priority: "normal",
        },
      );
    }
  } catch (e) {
    console.warn("[coach-apply] push failed", e);
  }
}

/* ───────────────────────── admin ───────────────────────── */

export const COACH_APPLICATION_COLUMNS =
  "id, created_at, updated_at, full_name, email, business_name, instagram, website, country, region, specialties, client_band, works_as, current_platform, marketing_consent, marketing_consent_at, marketing_withdrawn_at, privacy_ack_at, status, admin_notes, contacted_at, decided_at, source_page, utm_source, utm_campaign, is_test";

export type CoachApplication = {
  id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
  business_name: string | null;
  instagram: string | null;
  website: string | null;
  country: string;
  region: string | null;
  specialties: string[];
  client_band: string;
  works_as: string;
  current_platform: string | null;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  marketing_withdrawn_at: string | null;
  privacy_ack_at: string;
  status: ApplicationStatus;
  admin_notes: string | null;
  contacted_at: string | null;
  decided_at: string | null;
  source_page: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  is_test: boolean;
};

export const listCoachApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CoachApplication[]> => {
    await assertAdmin(context);
    const sb = await admin();
    const { data, error } = await sb
      .from("coach_platform_applications")
      .select(COACH_APPLICATION_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as CoachApplication[];
  });

export const updateCoachApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(APPLICATION_STATUSES).optional(),
        admin_notes: z.string().max(4000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<CoachApplication> => {
    await assertAdmin(context);
    const sb = await admin();
    const { data: cur, error: readErr } = await sb
      .from("coach_platform_applications")
      .select("id, status, contacted_at")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!cur) throw new Error("That application isn't there any more.");
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};
    if (data.admin_notes !== undefined) patch.admin_notes = data.admin_notes?.trim() ? data.admin_notes.trim() : null;
    if (data.status && data.status !== cur.status) {
      patch.status = data.status;
      if (data.status === "contacted" && !cur.contacted_at) patch.contacted_at = now;
      patch.decided_at = data.status === "invited" || data.status === "declined" ? now : null;
    }
    if (!Object.keys(patch).length) {
      const { data: same } = await sb.from("coach_platform_applications").select(COACH_APPLICATION_COLUMNS).eq("id", data.id).single();
      return same as CoachApplication;
    }
    const { data: row, error } = await sb
      .from("coach_platform_applications")
      .update(patch)
      .eq("id", data.id)
      .select(COACH_APPLICATION_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("This person already has another open application. Close one of them first.");
      throw new Error(error.message);
    }
    return row as CoachApplication;
  });

export type CoachPlatformSettings = {
  published: boolean;
  pricing: SeatPricing;
  publishedAt: string | null;
  history: Array<{ changed_at: string; before: any; after: any }>;
};

function settingsFrom(j: any, history: any[]): CoachPlatformSettings {
  return {
    published: !!j?.pricing_published,
    pricing: pricingFromRow(j)!,
    publishedAt: j?.published_at ?? null,
    history: history ?? [],
  };
}

export const getCoachPlatformSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CoachPlatformSettings> => {
    const sb = (context as any).supabase;
    const { data, error } = await sb.rpc("coach_platform_get");
    if (error) throw new Error(error.message);
    const { data: hist } = await sb
      .from("coach_platform_pricing_history")
      .select("changed_at, before, after")
      .order("changed_at", { ascending: false })
      .limit(20);
    return settingsFrom(data, hist ?? []);
  });

export const setCoachPlatformPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        published: z.boolean(),
        freeClients: z.number().int().min(0).max(3),
        perClientCents: z.number().int().min(100).max(5000),
        volumeFrom: z.number().int().min(2).max(500).nullable(),
        volumeCents: z.number().int().min(100).max(5000).nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<CoachPlatformSettings> => {
    const sb = (context as any).supabase;
    const { data: saved, error } = await sb.rpc("coach_platform_set_pricing", {
      _published: data.published,
      _free_clients: data.freeClients,
      _per_client_cents: data.perClientCents,
      _volume_from: data.volumeFrom,
      _volume_cents: data.volumeCents,
    });
    if (error) throw new Error(error.message);
    const { data: hist } = await sb
      .from("coach_platform_pricing_history")
      .select("changed_at, before, after")
      .order("changed_at", { ascending: false })
      .limit(20);
    return settingsFrom(saved, hist ?? []);
  });
