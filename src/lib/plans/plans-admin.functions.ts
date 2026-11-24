/**
 * Sales → Plans (/admin/plans): every plan and price, what's waiting on the
 * admin (applications from members, requests to come back, requests to change
 * a custom plan, offers out), who's on a grandfathered or custom price, every
 * change in flight, failed payments and what's about to change. Admin only;
 * read with the service role after the check. Nothing here writes: the rows
 * open the client's plan card, where every change is made.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildCatalog, saleIsLive, type CatalogPackage, type CatalogProduct } from "@/lib/plans/plan-engine";
import { readPortalSetting } from "@/lib/plans/billing-portal";

type Person = { clientId: string; name: string; tier: string };

export type PlansOverview = {
  catalog: Array<{ slug: string; name: string; family: string; priceCents: number; listed: boolean; problem: string | null; onIt: number; onSpecialPrice: number }>;
  decisions: Array<{ kind: "application" | "comeback" | "request"; id: string; person: Person; at: string; detail: string; packageName: string | null; changeId: string | null; applicationId: string | null }>;
  offers: Array<{ id: string; person: Person; toName: string | null; toPriceCents: number | null; expiresAt: string | null; at: string }>;
  approvals: Array<{ id: string; person: Person; packageName: string | null; expiresAt: string; source: string }>;
  grandfathered: Array<{ person: Person; planName: string; priceCents: number | null; advertisedCents: number | null; how: "special_price" | "custom"; nextBillingDate: string | null }>;
  inFlight: Array<{ id: string; person: Person; kind: string; status: string; fromName: string | null; toName: string | null; effectiveAt: string | null; at: string }>;
  failedPayments: Array<{ person: Person; planName: string; since: string | null; status: string }>;
  ending: Array<{ person: Person; planName: string; endsOn: string | null }>;
  history: Array<{ id: string; person: Person; kind: string; status: string; fromName: string | null; toName: string | null; at: string; source: string }>;
  portal: { test: string | null; live: string | null };
};

export const adminPlansOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlansOverview> => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admins only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const now = new Date().toISOString();
    const ninetyAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();

    const [pk, enr, changes, open, offered, appr, sales, apps, portal] = await Promise.all([
      db.from("coaching_packages").select("*").neq("status", "archived"),
      db.from("coaching_package_enrollments").select("client_id, package_id, sale_id, contracted_price_cents").eq("status", "active"),
      db.from("plan_changes").select("id, client_id, kind, status, from_label, to_label, to_package_id, effective_at, created_at, source, note").order("created_at", { ascending: false }).limit(60),
      db.from("plan_changes").select("id, client_id, kind, status, from_label, to_label, to_package_id, effective_at, created_at, source, note").in("status", ["checkout", "processing", "awaiting_payment", "scheduled", "requested"]),
      db.from("plan_changes").select("id, client_id, to_label, to_price_cents, offer_expires_at, created_at").eq("status", "offered").gt("offer_expires_at", now),
      db.from("coaching_purchase_approvals").select("id, client_id, package_id, expires_at, source").is("used_at", null).is("revoked_at", null).gt("expires_at", now),
      db.from("purchase_records").select("id, client_id, offer_name, stripe_subscription_id, stripe_subscription_status, payment_status, next_billing_date, cancel_at_period_end, full_payable_amount, is_fixed_term_commitment, sessions_purchased, archived_at, updated_at").is("archived_at", null).not("stripe_subscription_id", "is", null),
      db.from("coaching_applications").select("id, client_id, status, created_at, coaching_interest, main_goal").eq("is_test", false).gte("created_at", ninetyAgo).not("client_id", "is", null),
      db.from("app_settings").select("value").eq("key", "stripe_portal_config").maybeSingle(),
    ]);
    for (const r of [pk, enr, changes, open, offered, appr, sales, apps]) if (r.error) throw new Error(r.error.message);

    const packages = (pk.data ?? []) as CatalogPackage[];
    const productIds = [...new Set(packages.map((p) => p.product_id).filter(Boolean))] as string[];
    const { data: products } = productIds.length
      ? await db.from("coaching_products").select("id, name, price_cents, currency, stripe_price_id, mode, payment_structure, active, archived").in("id", productIds)
      : { data: [] };
    const catalog = buildCatalog(packages, (products ?? []) as CatalogProduct[]);
    const pkgById = new Map(packages.map((p) => [p.id, p]));

    // everyone mentioned, one read
    const ids = new Set<string>();
    for (const list of [enr.data, changes.data, open.data, offered.data, appr.data, sales.data, apps.data]) for (const r of list ?? []) if (r.client_id) ids.add(r.client_id);
    const people = new Map<string, Person & { archived: boolean; status: string | null }>();
    const idList = [...ids];
    for (let i = 0; i < idList.length; i += 150) {
      const { data } = await db.from("clients").select("id, full_name, first_name, service_tier, archived, status").in("id", idList.slice(i, i + 150));
      for (const c of data ?? []) {
        people.set(c.id, {
          clientId: c.id,
          name: (c.full_name || c.first_name || "Client").trim(),
          tier: c.service_tier ?? "coaching",
          archived: !!c.archived,
          status: c.status ?? null,
        });
      }
    }
    const person = (id: string): Person => {
      const p = people.get(id);
      return { clientId: id, name: p?.name ?? "Client", tier: p?.tier ?? "coaching" };
    };
    const live = (id: string) => {
      const p = people.get(id);
      return !!p && !p.archived && !["Deactivated", "Deleted"].includes(String(p.status ?? ""));
    };

    const enrollments = (enr.data ?? []) as any[];
    const catalogOut = catalog.map((o) => {
      const on = enrollments.filter((e) => e.package_id === o.id && live(e.client_id));
      return {
        slug: o.slug,
        name: o.name,
        family: o.family,
        priceCents: o.priceCents,
        listed: o.listed,
        problem: o.problem,
        onIt: on.length,
        onSpecialPrice: on.filter((e) => e.contracted_price_cents != null && e.contracted_price_cents !== o.priceCents).length,
      };
    });

    const openRows = (open.data ?? []) as any[];
    const decisions: PlansOverview["decisions"] = [];
    for (const r of openRows.filter((x) => x.status === "requested")) {
      if (!live(r.client_id)) continue;
      decisions.push({
        kind: r.kind === "reactivate" ? "comeback" : "request",
        id: r.id,
        person: person(r.client_id),
        at: r.created_at,
        detail: r.kind === "reactivate" ? `Asked to come back${r.to_label ? ` (${r.to_label})` : ""}` : `Asked to change ${r.from_label ?? "their plan"} to ${r.to_label ?? "another plan"}`,
        packageName: r.to_label ?? null,
        changeId: r.id,
        applicationId: null,
      });
    }
    const approvedClients = new Set((appr.data ?? []).map((a: any) => a.client_id));
    const seenApp = new Set<string>();
    for (const a of (apps.data ?? []) as any[]) {
      if (seenApp.has(a.client_id)) continue;
      seenApp.add(a.client_id);
      const p = people.get(a.client_id);
      // a member (self-serve, with an account) waiting on the coach's yes
      if (!p || p.tier !== "self_serve" || !live(a.client_id) || approvedClients.has(a.client_id)) continue;
      if (["Rejected", "Approved", "Declined"].includes(String(a.status))) continue;
      decisions.push({
        kind: "application",
        id: a.id,
        person: person(a.client_id),
        at: a.created_at,
        detail: a.main_goal ? `Applied: ${String(a.main_goal).slice(0, 120)}` : "Applied for coaching",
        packageName: a.coaching_interest ?? null,
        changeId: null,
        applicationId: a.id,
      });
    }
    decisions.sort((x, y) => x.at.localeCompare(y.at));

    const salesRows = ((sales.data ?? []) as any[]).filter((s) => saleIsLive(s) && live(s.client_id));
    const enrolledSale = new Set(enrollments.map((e) => e.sale_id).filter(Boolean));
    const grandfathered: PlansOverview["grandfathered"] = [];
    for (const e of enrollments) {
      const pkg = pkgById.get(e.package_id);
      if (!pkg || !live(e.client_id)) continue;
      if (e.contracted_price_cents != null && e.contracted_price_cents !== pkg.price_cents) {
        const sale = salesRows.find((s) => s.id === e.sale_id);
        grandfathered.push({ person: person(e.client_id), planName: pkg.name, priceCents: e.contracted_price_cents, advertisedCents: pkg.price_cents, how: "special_price", nextBillingDate: sale?.next_billing_date ?? null });
      }
    }
    for (const s of salesRows) {
      if (enrolledSale.has(s.id) || s.is_fixed_term_commitment || Number(s.sessions_purchased ?? 0) > 0) continue;
      const p = people.get(s.client_id);
      if (!p || p.tier !== "coaching") continue;
      grandfathered.push({
        person: person(s.client_id),
        planName: s.offer_name ?? "Coaching",
        priceCents: Math.round(Number(s.full_payable_amount ?? 0) * 100) || null,
        advertisedCents: null,
        how: "custom",
        nextBillingDate: s.next_billing_date ?? null,
      });
    }

    const failedPayments = salesRows
      .filter((s) => String(s.stripe_subscription_status ?? "").toLowerCase() === "past_due" || /overdue|failed/i.test(String(s.payment_status ?? "")))
      .map((s) => ({ person: person(s.client_id), planName: s.offer_name ?? "Subscription", since: s.updated_at ?? null, status: s.stripe_subscription_status ?? s.payment_status ?? "past_due" }));
    const ending = salesRows.filter((s) => s.cancel_at_period_end).map((s) => ({ person: person(s.client_id), planName: s.offer_name ?? "Subscription", endsOn: s.next_billing_date ?? null }));

    const portalSaved = readPortalSetting(portal.data?.value);
    return {
      catalog: catalogOut,
      decisions,
      offers: ((offered.data ?? []) as any[]).map((o) => ({ id: o.id, person: person(o.client_id), toName: o.to_label, toPriceCents: o.to_price_cents, expiresAt: o.offer_expires_at, at: o.created_at })),
      approvals: ((appr.data ?? []) as any[]).map((a) => ({ id: a.id, person: person(a.client_id), packageName: a.package_id ? pkgById.get(a.package_id)?.name ?? null : null, expiresAt: a.expires_at, source: a.source })),
      grandfathered,
      inFlight: openRows
        .filter((r) => r.status !== "requested")
        .map((r) => ({ id: r.id, person: person(r.client_id), kind: r.kind, status: r.status, fromName: r.from_label, toName: r.to_label, effectiveAt: r.effective_at, at: r.created_at }))
        .sort((a, b) => String(a.effectiveAt ?? a.at).localeCompare(String(b.effectiveAt ?? b.at))),
      failedPayments,
      ending,
      history: ((changes.data ?? []) as any[])
        .filter((r) => ["applied", "failed", "cancelled"].includes(r.status))
        .slice(0, 30)
        .map((r) => ({ id: r.id, person: person(r.client_id), kind: r.kind, status: r.status, fromName: r.from_label, toName: r.to_label, at: r.created_at, source: r.source })),
      portal: { test: portalSaved.test ?? null, live: portalSaved.live ?? null },
    };
  });
