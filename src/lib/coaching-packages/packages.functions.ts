import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PovInput, isPovRequest, resolvePovClientId } from "@/lib/client-pov.server";
import {
  LIMITS,
  SLUG_RE,
  fromPublicRow,
  packageProblems,
  publishProblems,
  actionTexts,
  type CoachingPackage,
  type PublicPackage,
} from "./packages";

/**
 * Coaching packages on the server.
 *   Public (no sign-in): the packages on the site and one by its link, public
 *     fields only, through coaching_packages_public() / coaching_package_public().
 *   Staff: packages (admins write, coaches read), their history and who's on
 *     them, through the caller's own login so RLS decides.
 *   A client: their included calls and what they want to cover on them.
 * Nothing here touches a sale, a Stripe product or a subscription.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

let anonClient: any = null;
/** The public's own access (anon key): the package reads are granted to anon, so they need nothing more. */
async function publicDb() {
  if (anonClient) return anonClient;
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase isn't configured.");
  anonClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return anonClient;
}

async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return !!data;
}

async function assertAdmin(supabase: any, userId: string) {
  if (!(await isAdmin(supabase, userId))) throw new Error("Only the owner can change coaching packages.");
}

/* ───────────────────────── public ───────────────────────── */

/** The packages on the site, in order (empty when they can't be read: the page still works). */
export const getPublicPackages = createServerFn({ method: "GET" }).handler(async (): Promise<PublicPackage[]> => {
  try {
    const db = await publicDb();
    const { data, error } = await db.rpc("coaching_packages_public");
    if (error || !Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).map(fromPublicRow);
  } catch {
    return [];
  }
});

/**
 * How many JF Effect programs are live in the members' app (public_program_count():
 * Published and listed, the library's own rule), for the home page's proof
 * strip. Null when it can't be read: the page shows another true number.
 */
export const getPublicProgramCount = createServerFn({ method: "GET" }).handler(async (): Promise<number | null> => {
  try {
    const db = await publicDb();
    const { data, error } = await db.rpc("public_program_count");
    const n = Number(data);
    return error || !Number.isFinite(n) || n <= 0 ? null : n;
  } catch {
    return null;
  }
});

/** One active package by its link (listed or not). Null for a draft, an archived one or no such link. */
export const getPublicPackage = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().trim().max(60) }).parse(d))
  .handler(async ({ data }): Promise<PublicPackage | null> => {
    const slug = data.slug.toLowerCase();
    if (!SLUG_RE.test(slug)) return null;
    try {
      const db = await publicDb();
      const { data: row, error } = await db.rpc("coaching_package_public", { _slug: slug });
      if (error || !row) return null;
      return fromPublicRow(row as Record<string, unknown>);
    } catch {
      return null;
    }
  });

/* ───────────────────────── staff ───────────────────────── */

export type PackageProduct = {
  id: string;
  name: string;
  price_cents: number;
  payment_structure: string | null;
  stripe_price_id: string | null;
  archived: boolean;
};

export type AdminPackage = CoachingPackage & {
  activeClients: number;
  product: PackageProduct | null;
  callTypeSlug: string | null;
};

export const listCoachingPackages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const owner = await isAdmin(supabase, userId);
    const { data, error } = await supabase.from("coaching_packages").select("*").order("sort_order").order("name");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CoachingPackage[];
    const ids = rows.map((r) => r.id);
    const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))] as string[];
    const cardIds = [...new Set(rows.map((r) => r.call_booking_card_id).filter(Boolean))] as string[];
    const [enr, prods, cards] = await Promise.all([
      ids.length
        ? supabase.from("coaching_package_enrollments").select("package_id").eq("status", "active").in("package_id", ids)
        : Promise.resolve({ data: [] }),
      productIds.length && owner
        ? supabase
            .from("coaching_products")
            .select("id, name, price_cents, payment_structure, stripe_price_id, archived")
            .in("id", productIds)
        : Promise.resolve({ data: [] }),
      cardIds.length ? supabase.from("booking_cards").select("id, slug").in("id", cardIds) : Promise.resolve({ data: [] }),
    ]);
    const counts = new Map<string, number>();
    for (const e of (enr.data ?? []) as any[]) counts.set(e.package_id, (counts.get(e.package_id) ?? 0) + 1);
    const prodById = new Map(((prods.data ?? []) as any[]).map((p) => [p.id, p as PackageProduct]));
    const slugById = new Map(((cards.data ?? []) as any[]).map((c) => [c.id, c.slug as string | null]));
    return {
      canEdit: owner,
      packages: rows.map(
        (r): AdminPackage => ({
          ...r,
          features: r.features ?? [],
          activeClients: counts.get(r.id) ?? 0,
          product: r.product_id ? (prodById.get(r.product_id) ?? null) : null,
          callTypeSlug: r.call_booking_card_id ? (slugById.get(r.call_booking_card_id) ?? null) : null,
        }),
      ),
    };
  });

const PackageInput = z.object({
  id: z.string().uuid().optional().nullable(),
  slug: z.string().trim().toLowerCase().max(LIMITS.slug),
  kind: z.enum(["free", "membership", "subscription", "one_time"]),
  name: z.string().trim().max(LIMITS.name),
  tagline: z.string().trim().max(LIMITS.tagline).nullable().optional(),
  description: z.string().trim().max(LIMITS.description).nullable().optional(),
  best_for: z.string().trim().max(LIMITS.bestFor).nullable().optional(),
  features: z.array(z.string().trim().max(LIMITS.feature)).max(LIMITS.features),
  price_cents: z.number().int().min(0).max(LIMITS.priceCents).nullable(),
  cta_label: z.string().trim().max(LIMITS.cta).nullable().optional(),
  included_calls: z.number().int().min(0).max(LIMITS.includedCalls).default(0),
  call_minutes: z.number().int().min(15).max(90).default(30),
  call_cancel_hours: z.number().int().min(0).max(168).default(24),
  call_booking_card_id: z.string().uuid().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  admin_note: z.string().trim().max(LIMITS.adminNote).nullable().optional(),
});

/**
 * Saves a package's words, price and what's included. On a package that's on
 * the site this is publishing: the editor shows the card as it will look and
 * asks first. Status and the site are separate (setCoachingPackageState).
 */
export const saveCoachingPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PackageInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const features = data.features.map((f) => f.trim()).filter(Boolean);
    const problems = packageProblems({ ...data, features, price_cents: data.price_cents });
    if (problems.length) throw new Error(problems[0]);
    const row = {
      slug: data.slug,
      kind: data.kind,
      name: data.name,
      tagline: data.tagline || null,
      description: data.description || null,
      best_for: data.best_for || null,
      features,
      price_cents: data.kind === "free" ? 0 : data.price_cents,
      cta_label: data.cta_label || null,
      included_calls: data.kind === "subscription" ? data.included_calls : 0,
      call_minutes: data.call_minutes,
      call_cancel_hours: data.call_cancel_hours,
      call_booking_card_id: data.call_booking_card_id ?? null,
      product_id: data.product_id ?? null,
      admin_note: data.admin_note || null,
    };
    if (data.id) {
      const { data: cur, error: readErr } = await supabase.from("coaching_packages").select("*").eq("id", data.id).maybeSingle();
      if (readErr) throw new Error(readErr.message);
      if (!cur) throw new Error("That package isn't there any more.");
      if (cur.status === "active" && cur.is_public) {
        const block = publishProblems({ ...cur, ...row } as CoachingPackage);
        if (block.length) throw new Error(`It's on the site, so: ${block[0].toLowerCase()}`);
      }
      const { data: saved, error } = await supabase.from("coaching_packages").update(row).eq("id", data.id).select("*").maybeSingle();
      if (error) throw new Error(friendly(error.message));
      if (!saved) throw new Error("That didn't save.");
      return saved as CoachingPackage;
    }
    const { data: saved, error } = await supabase
      .from("coaching_packages")
      .insert({ ...row, status: "draft", is_public: false, sort_order: await nextOrder(supabase) })
      .select("*")
      .maybeSingle();
    if (error) throw new Error(friendly(error.message));
    if (!saved) throw new Error("That didn't save.");
    return saved as CoachingPackage;
  });

function friendly(msg: string): string {
  if (/coaching_packages_slug_key|duplicate key/.test(msg)) return "Another package already uses that link name.";
  if (/coaching_packages_one_recommended/.test(msg)) return "Only one package can be recommended.";
  if (/coaching_packages_public_priced/.test(msg)) return "A paid package needs a price before it goes on the site.";
  return msg;
}

async function nextOrder(supabase: any): Promise<number> {
  const { data } = await supabase.from("coaching_packages").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  return ((data?.[0]?.sort_order as number | undefined) ?? 0) + 10;
}

/** Status, the site and "recommended": each one tap, the site asked first in the editor. */
export const setCoachingPackageState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["draft", "active", "archived"]).optional(),
        is_public: z.boolean().optional(),
        recommended: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: cur, error: readErr } = await supabase.from("coaching_packages").select("*").eq("id", data.id).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!cur) throw new Error("That package isn't there any more.");
    const next = { ...cur, ...data } as CoachingPackage;
    if (data.status && data.status !== "active") next.is_public = false;
    if (next.is_public) {
      const block = publishProblems(next);
      if (block.length) throw new Error(block[0]);
    }
    if (data.recommended) {
      if (next.status === "archived") throw new Error("An archived package can't be recommended.");
      if (next.kind === "free") throw new Error("Recommend a coaching package, not the free app.");
      await supabase.from("coaching_packages").update({ recommended: false }).eq("recommended", true).neq("id", data.id);
    }
    const patch: Record<string, unknown> = {};
    if (data.status) patch.status = data.status;
    if (data.is_public !== undefined) patch.is_public = data.is_public;
    if (data.recommended !== undefined) patch.recommended = data.recommended;
    const { data: saved, error } = await supabase.from("coaching_packages").update(patch).eq("id", data.id).select("*").maybeSingle();
    if (error) throw new Error(friendly(error.message));
    if (!saved) throw new Error("That didn't save.");
    return saved as CoachingPackage;
  });

/** Up or down one place in the order the site shows them. */
export const moveCoachingPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), direction: z.enum(["up", "down"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: rows, error } = await supabase.from("coaching_packages").select("id, sort_order, name").order("sort_order").order("name");
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as { id: string; sort_order: number }[];
    const i = list.findIndex((r) => r.id === data.id);
    const j = data.direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return { moved: false };
    // re-number so a tie never sticks
    const order = list.map((r) => r.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    for (let k = 0; k < order.length; k++) {
      const want = (k + 1) * 10;
      const was = list.find((r) => r.id === order[k])!.sort_order;
      if (was !== want) {
        const { error: e } = await supabase.from("coaching_packages").update({ sort_order: want }).eq("id", order[k]);
        if (e) throw new Error(e.message);
      }
    }
    return { moved: true };
  });

/** A copy to change (a custom offer for one person, a new version): always a draft, off the site. */
export const duplicateCoachingPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: cur, error } = await supabase.from("coaching_packages").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!cur) throw new Error("That package isn't there any more.");
    const suffix = Math.random().toString(36).slice(2, 6);
    const slug = `${String(cur.slug).slice(0, LIMITS.slug - 12)}-copy-${suffix}`;
    const { id: _id, created_at: _c, updated_at: _u, published_at: _p, published_by: _pb, updated_by: _ub, ...rest } = cur;
    const { data: saved, error: e } = await supabase
      .from("coaching_packages")
      .insert({
        ...rest,
        slug,
        name: `${String(cur.name).slice(0, LIMITS.name - 7)} (copy)`,
        status: "draft",
        is_public: false,
        recommended: false,
        sort_order: await nextOrder(supabase),
      })
      .select("*")
      .maybeSingle();
    if (e) throw new Error(friendly(e.message));
    return saved as CoachingPackage;
  });

/** A package as it was (coaching_package_snapshot). */
export type PackageSnapshot = Record<string, string | number | boolean | null | string[]>;

export type PackageVersion = {
  id: string;
  before: PackageSnapshot | null;
  after: PackageSnapshot;
  live_before: boolean;
  live_after: boolean;
  changed_at: string;
  changed_by_name: string | null;
};

/** What changed on a package and when (the pricing history). */
export const listPackageHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: rows, error } = await supabase
      .from("coaching_package_versions")
      .select("id, before, after, live_before, live_after, changed_at, changed_by")
      .eq("package_id", data.id)
      .order("changed_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const ids = [...new Set(((rows ?? []) as any[]).map((r) => r.changed_by).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      for (const p of (ps ?? []) as any[]) if (p.full_name) names.set(p.id, p.full_name);
    }
    return ((rows ?? []) as any[]).map(
      (r): PackageVersion => ({ ...r, changed_by_name: r.changed_by ? (names.get(r.changed_by) ?? null) : null }),
    );
  });

/* ───────────────────────── who's on a package ───────────────────────── */

export type Enrollment = {
  id: string;
  client_id: string;
  client_name: string | null;
  package_id: string;
  package_name: string;
  status: "active" | "ended";
  starts_on: string;
  ends_on: string | null;
  sale_id: string | null;
  sale_name: string | null;
  period_anchor: string | null;
  contracted_price_cents: number | null;
  included_calls: number | null;
  note: string | null;
};

export const listEnrollments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ packageId: z.string().uuid().optional(), clientId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    let q = supabase
      .from("coaching_package_enrollments")
      .select(
        "id, client_id, package_id, status, starts_on, ends_on, sale_id, period_anchor, contracted_price_cents, included_calls, note, created_at",
      )
      .order("status")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.packageId) q = q.eq("package_id", data.packageId);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];
    const clientIds = [...new Set(list.map((r) => r.client_id))];
    const pkgIds = [...new Set(list.map((r) => r.package_id))];
    const saleIds = [...new Set(list.map((r) => r.sale_id).filter(Boolean))];
    const [cs, ps, ss] = await Promise.all([
      clientIds.length ? supabase.from("clients").select("id, full_name").in("id", clientIds) : Promise.resolve({ data: [] }),
      pkgIds.length ? supabase.from("coaching_packages").select("id, name").in("id", pkgIds) : Promise.resolve({ data: [] }),
      saleIds.length ? supabase.from("purchase_records").select("id, offer_name").in("id", saleIds) : Promise.resolve({ data: [] }),
    ]);
    const cn = new Map(((cs.data ?? []) as any[]).map((c) => [c.id, c.full_name as string | null]));
    const pn = new Map(((ps.data ?? []) as any[]).map((p) => [p.id, p.name as string]));
    const sn = new Map(((ss.data ?? []) as any[]).map((s) => [s.id, s.offer_name as string | null]));
    return list.map(
      (r): Enrollment => ({
        ...r,
        client_name: cn.get(r.client_id) ?? null,
        package_name: pn.get(r.package_id) ?? "Package",
        sale_name: r.sale_id ? (sn.get(r.sale_id) ?? null) : null,
      }),
    );
  });

/** A client's sales to pick from when putting them on a package (their subscription anchors their calls). */
export const listClientSalesForPackage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: rows, error } = await supabase
      .from("purchase_records")
      .select("id, offer_name, next_billing_date, stripe_subscription_status, contract_value_cents, created_at, archived_at")
      .eq("client_id", data.clientId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id as string,
      name: (r.offer_name as string | null) ?? "Sale",
      nextBilling: (r.next_billing_date as string | null) ?? null,
      live: ["active", "trialing", "past_due"].includes(String(r.stripe_subscription_status ?? "")),
    }));
  });

/**
 * Puts a client on a package (ending the one they were on). Never touches
 * their sale or subscription: what they pay stays what it is, and the
 * contracted price is only noted here.
 */
export const enrollClientInPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        packageId: z.string().uuid(),
        startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        saleId: z.string().uuid().nullable().optional(),
        periodAnchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        contractedPriceCents: z.number().int().min(0).max(LIMITS.priceCents).nullable().optional(),
        includedCalls: z.number().int().min(0).max(LIMITS.includedCalls).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: current } = await supabase
      .from("coaching_package_enrollments")
      .select("id, package_id, starts_on")
      .eq("client_id", data.clientId)
      .eq("status", "active")
      .maybeSingle();
    if (current) {
      const end = data.startsOn > current.starts_on ? prevDay(data.startsOn) : current.starts_on;
      const { data: ended, error: endErr } = await supabase
        .from("coaching_package_enrollments")
        .update({ status: "ended", ends_on: end })
        .eq("id", current.id)
        .select("id")
        .maybeSingle();
      if (endErr) throw new Error(endErr.message);
      if (!ended) throw new Error("You can't change this client's package.");
    }
    const { data: saved, error } = await supabase
      .from("coaching_package_enrollments")
      .insert({
        client_id: data.clientId,
        package_id: data.packageId,
        starts_on: data.startsOn,
        sale_id: data.saleId ?? null,
        period_anchor: data.periodAnchor ?? null,
        contracted_price_cents: data.contractedPriceCents ?? null,
        included_calls: data.includedCalls ?? null,
        note: data.note || null,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("You can't change this client's package.");
    return { id: saved.id as string };
  });

export const endEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: saved, error } = await supabase
      .from("coaching_package_enrollments")
      .update({ status: "ended" })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("You can't change this client's package.");
    return { ok: true };
  });

function prevDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ───────────────────────── a client's included calls ───────────────────────── */

export type MyCall = {
  id: string;
  start: string | null;
  end: string | null;
  date: string;
  status: string;
  meetLink: string | null;
  topics: string | null;
  /** The coach's action items and next priorities, once they sent them. */
  shared: { actionItems: string[]; nextPriorities: string | null; at: string } | null;
};

export type MyCoachingCalls = {
  packageName: string;
  included: number;
  used: number;
  left: number;
  periodStart: string;
  periodEnd: string;
  /** The period after this one (calls can be booked into it once it's within reach). */
  next: { left: number; periodStart: string; periodEnd: string } | null;
  cancelHours: number;
  callMinutes: number;
  bookSlug: string | null;
  calls: MyCall[];
};

function todayIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** A client's included calls this period (null when their package has none). */
export const getMyCoachingCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MyCoachingCalls | null> => {
    const { supabase, userId } = context as any;
    const clientId = await resolvePovClientId(supabase, userId, data);
    if (!clientId) return null;
    const db = await admin();
    const { data: en } = await db
      .from("coaching_package_enrollments")
      .select("id, package_id, included_calls, coaching_packages!inner(id, name, included_calls, call_minutes, call_cancel_hours, call_booking_card_id)")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle();
    const pkg = (en as any)?.coaching_packages;
    const card: string | null = pkg?.call_booking_card_id ?? null;
    const included = (en as any)?.included_calls ?? pkg?.included_calls ?? 0;
    if (!en || !card || !(included > 0)) return null;
    const [{ data: c }, { data: bc }] = await Promise.all([
      db.from("clients").select("timezone").eq("id", clientId).maybeSingle(),
      db.from("booking_cards").select("slug, is_active, online_enabled").eq("id", card).maybeSingle(),
    ]);
    const today = todayIn((c as any)?.timezone || "America/Winnipeg");
    const { data: now } = await db.rpc("coaching_call_usage", { _client: clientId, _card: card, _on: today });
    if (!now) return null;
    const u = now as any;
    const { data: after } = await db.rpc("coaching_call_usage", { _client: clientId, _card: card, _on: u.period_end });
    const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    const { data: sessions } = await db
      .from("pt_sessions")
      .select("id, starts_at, ends_at, session_date, status, meet_link")
      .eq("client_id", clientId)
      .eq("booking_card_id", card)
      .gte("session_date", since)
      .eq("visible_to_client", true)
      .order("session_date", { ascending: true })
      .limit(40);
    const ids = ((sessions ?? []) as any[]).map((s) => s.id);
    const [{ data: topics }, { data: reviews }] = await Promise.all([
      ids.length ? db.from("coaching_call_topics").select("pt_session_id, topics").in("pt_session_id", ids) : Promise.resolve({ data: [] }),
      ids.length
        ? db
            .from("coaching_call_reviews")
            .select("pt_session_id, action_items, next_priorities, shared_at")
            .in("pt_session_id", ids)
            .not("shared_at", "is", null)
        : Promise.resolve({ data: [] }),
    ]);
    const topicBy = new Map(((topics ?? []) as any[]).map((t) => [t.pt_session_id, t.topics as string]));
    const reviewBy = new Map(((reviews ?? []) as any[]).map((r) => [r.pt_session_id, r]));
    return {
      packageName: String(u.package_name ?? pkg.name),
      included: Number(u.included),
      used: Number(u.used),
      left: Number(u.left),
      periodStart: String(u.period_start),
      periodEnd: String(u.period_end),
      next: after ? { left: Number((after as any).left), periodStart: String((after as any).period_start), periodEnd: String((after as any).period_end) } : null,
      cancelHours: Number(u.cancel_hours ?? 24),
      callMinutes: Number(u.call_minutes ?? 30),
      bookSlug: (bc as any)?.is_active && (bc as any)?.online_enabled ? ((bc as any)?.slug ?? null) : null,
      calls: ((sessions ?? []) as any[])
        .filter((s) => s.status !== "Rescheduled")
        .map((s): MyCall => {
          const r = reviewBy.get(s.id);
          return {
            id: s.id,
            start: s.starts_at,
            end: s.ends_at,
            date: s.session_date,
            status: s.status,
            meetLink: s.meet_link ?? null,
            topics: topicBy.get(s.id) ?? null,
            shared: r
              ? {
                  actionItems: actionTexts(r.action_items),
                  nextPriorities: r.next_priorities ?? null,
                  at: r.shared_at,
                }
              : null,
          };
        }),
    };
  });

/** What the client wants to cover on a call of theirs (before it starts; never in a coach's preview). */
export const saveCallTopics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    PovInput.extend({ sessionId: z.string().uuid(), topics: z.string().trim().max(1500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (isPovRequest(userId, data)) throw new Error("You're previewing as the client, so nothing is saved.");
    const clientId = await resolvePovClientId(supabase, userId, data);
    if (!clientId) throw new Error("Sign in with your client account.");
    const db = await admin();
    const { data: s } = await db
      .from("pt_sessions")
      .select("id, client_id, status, starts_at")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!s || (s as any).client_id !== clientId) throw new Error("That call isn't yours.");
    if ((s as any).status !== "Scheduled" || ((s as any).starts_at && new Date((s as any).starts_at).getTime() < Date.now())) {
      throw new Error("That call has already happened.");
    }
    if (!data.topics) {
      await db.from("coaching_call_topics").delete().eq("pt_session_id", data.sessionId);
      return { ok: true };
    }
    const { error } = await db
      .from("coaching_call_topics")
      .upsert({ pt_session_id: data.sessionId, client_id: clientId, topics: data.topics, updated_at: new Date().toISOString(), updated_by: userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
