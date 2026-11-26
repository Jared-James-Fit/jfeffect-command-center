/**
 * Coaching packages (Nov 22 2026): the one source of truth for what JF Effect
 * sells and what the public site says about it. Pure and tested
 * (coaching-packages.test.ts): the public pages, the admin toolkit, the card
 * painter and the server share these rules, so a price edited in one place is
 * the price everywhere.
 *
 * A package's price is what's advertised. What a client pays is their sale
 * (purchase_records, Stripe) and never changes when a package does; a client
 * on a package keeps their contracted price (coaching_package_enrollments).
 */

/** free: the app; membership: a paid self-serve plan (bought in the app, Manage plan); subscription: monthly coaching; one_time: a call. */
export type PackageKind = "free" | "membership" | "subscription" | "one_time";
export type PackageStatus = "draft" | "active" | "archived";
export type BillingInterval = "month" | "once";

/** A package as the admin sees it (coaching_packages row). */
export type CoachingPackage = {
  id: string;
  slug: string;
  kind: PackageKind;
  name: string;
  tagline: string | null;
  description: string | null;
  best_for: string | null;
  features: string[];
  price_cents: number | null;
  currency: string;
  billing_interval: BillingInterval | null;
  recommended: boolean;
  status: PackageStatus;
  is_public: boolean;
  sort_order: number;
  cta_label: string | null;
  included_calls: number;
  call_minutes: number;
  call_booking_card_id: string | null;
  call_cancel_hours: number;
  product_id: string | null;
  admin_note: string | null;
  published_at: string | null;
  updated_at: string;
  /** Sold straight from the site (Ready to start), no call or approval needed. */
  direct_checkout?: boolean;
};

/** What anyone may see about a package (coaching_packages_public()). Never the admin note or product. */
export type PublicPackage = {
  slug: string;
  kind: PackageKind;
  name: string;
  tagline: string | null;
  description: string | null;
  bestFor: string | null;
  features: string[];
  priceCents: number | null;
  currency: string;
  interval: BillingInterval | null;
  recommended: boolean;
  ctaLabel: string | null;
  includedCalls: number;
  callMinutes: number;
  sortOrder: number;
  /** Listed on the public pages (an active package can be unlisted: a custom offer reached by its link). */
  listed: boolean;
  /** "Ready to start" may be offered (the server still checks Stripe before any checkout). */
  directCheckout?: boolean;
};

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The focused public package presentation uses the existing coaching route. */
export const PACKAGES_PAGE_URL = "https://jfeffect.com/coaching?view=packages";

/** Share only public catalogue slugs, never negotiated terms or private client data. */
export function packageComparisonLink(slugs: readonly string[] = []): string {
  const valid = [...new Set(slugs.filter((slug) => SLUG_RE.test(slug) && slug.length <= 60))].slice(0, 12);
  return valid.length ? `${PACKAGES_PAGE_URL}&plans=${encodeURIComponent(valid.join(","))}` : PACKAGES_PAGE_URL;
}

/** Fail closed for a selection that no longer exists; never include unlisted packages. */
export function comparisonPackages<T extends PublicPackage>(rows: readonly T[], plans?: string): T[] {
  const listed = listedPackages(rows);
  if (!plans) return listed;
  const wanted = new Set(plans.split(",").filter((slug) => SLUG_RE.test(slug) && slug.length <= 60).slice(0, 12));
  return listed.filter((p) => wanted.has(p.slug));
}
/** The public catalogue is marketing copy, not an entitlement matrix. Only an
 * explicit exact feature match earns a Listed mark; absent copy is not a denial. */
export function publicComparisonRows(packages: readonly PublicPackage[]) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const unique = new Map<string, string>();
  const featureSets = packages.map((p) => {
    const features = p.features.map((f) => f.trim()).filter(Boolean);
    for (const f of features) if (!unique.has(normalize(f))) unique.set(normalize(f), f);
    return new Set(features.map(normalize));
  });
  return [...unique].map(([key, label]) => ({
    key, label, listed: featureSets.map((set) => set.has(key)),
  })).sort((a,b) => Number(b.listed.every(Boolean)) - Number(a.listed.every(Boolean)));
}

/** The picker accepts only currently listed public slugs. */
export function selectedPublicSlugs(packages: readonly PublicPackage[], requested: readonly string[]): string[] {
  const allowed = new Set(listedPackages(packages).map(p => p.slug));
  return [...new Set(requested)].filter(s => allowed.has(s)).slice(0, 4);
}

export const LIMITS = {
  name: 60,
  tagline: 120,
  description: 600,
  bestFor: 160,
  feature: 120,
  features: 12,
  cta: 40,
  adminNote: 1000,
  slug: 48,
  /** The most a package can charge a month (a typo guard, not a business rule). */
  priceCents: 1_000_000,
  includedCalls: 8,
} as const;

/** The site's main way in for each kind. */
export const FREE_JOIN_PATH = "/join";
export const APPLY_PATH = "/coaching/apply";
export const SITE = "https://jfeffect.com";

/** Public packages, in the order they show. */
export function listedPackages<T extends { listed: boolean; sortOrder: number; name: string }>(rows: readonly T[]): T[] {
  return rows.filter((p) => p.listed).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** The paid ones a coaching section shows (the free app is the rest of the page). */
export function paidPackages<T extends { kind: PackageKind }>(rows: readonly T[]): T[] {
  return rows.filter((p) => p.kind !== "free" && p.kind !== "membership");
}

/** The one the page leads with: the recommended package, else the first paid one. */
export function centerpiece<T extends { kind: PackageKind; recommended: boolean }>(rows: readonly T[]): T | null {
  return rows.find((p) => p.recommended && p.kind !== "free") ?? rows.find((p) => p.kind !== "free") ?? null;
}

/** "$130", "$99.50", "$0". Whole dollars drop their cents. */
export function priceLabel(cents: number | null | undefined): string {
  const c = Math.max(0, Math.round(Number(cents ?? 0)));
  const whole = c % 100 === 0;
  const dollars = c / 100;
  return `$${dollars.toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}

/**
 * A plan's name as one word for a tight switch ("Complete" for Complete
 * Online Coaching, "Plus" for Coaching Plus, "Free" for Free app): the words
 * every plan shares are dropped, never a word that tells them apart.
 */
export function shortPlanName(name: string): string {
  const short = name.replace(/\b(online|coaching|app)\b/gi, " ").replace(/\s+/g, " ").trim();
  return short || name.trim();
}

/** "/month", " once" or "" (free). */
export function intervalLabel(p: { kind: PackageKind; interval?: BillingInterval | null }): string {
  if (p.kind === "free") return "";
  return p.interval === "once" ? "" : "/month";
}

/** The line under every paid price: what currency and that tax is added. */
export const TAX_NOTE = "CAD, plus applicable tax";

/** "$130/month", "Free", "$150". */
export function priceText(p: { kind: PackageKind; priceCents: number | null; interval?: BillingInterval | null }): string {
  if (p.kind === "free" || !p.priceCents) return p.kind === "free" ? "Free" : "Price not set";
  return `${priceLabel(p.priceCents)}${intervalLabel(p)}`;
}

/** Where a package's button goes: the free app's sign-up, or the coaching application with the package picked. */
export function ctaHref(p: { kind: PackageKind; slug: string }, from?: string | null): string {
  // a membership is bought inside the app, after joining free (Account → Your plan)
  if (p.kind === "free" || p.kind === "membership") return FREE_JOIN_PATH;
  const q = new URLSearchParams({ package: p.slug });
  if (from) q.set("from", from);
  return `${APPLY_PATH}?${q.toString()}`;
}

/** The full link to share (toolkit: Copy application link). */
export function shareLink(p: { kind: PackageKind; slug: string }, from = "share"): string {
  return `${SITE}${ctaHref(p, from)}`;
}

export function ctaText(p: { kind: PackageKind; ctaLabel?: string | null }): string {
  const own = (p.ctaLabel ?? "").trim();
  if (own) return own;
  return p.kind === "free" ? "Get the free app" : p.kind === "membership" ? "Join free, then upgrade" : "Apply for coaching";
}

const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];

/**
 * "Two private 30-minute video calls each billing month" from what the package
 * includes. Calls run on the subscription's own billing month (call-period.ts),
 * never the calendar month, and the words say so.
 */
export function callsLine(p: { includedCalls: number; callMinutes: number }): string | null {
  if (!p.includedCalls) return null;
  const n = COUNT_WORDS[p.includedCalls] ?? String(p.includedCalls);
  return `${n} private ${p.callMinutes}-minute video call${p.includedCalls === 1 ? "" : "s"} each billing month`;
}

/**
 * How included calls work, in one answer (the coaching page's questions): the
 * allowance, the 24-hour rule and no rollover, from the package itself.
 */
export function callsPolicy(p: { name: string; includedCalls: number; callMinutes: number }, cancelHours = 24): string | null {
  const line = callsLine(p);
  if (!line) return null;
  return `${p.name} includes ${line.charAt(0).toLowerCase()}${line.slice(1)}, booked in the app at a time that suits you. Cancel at least ${cancelHours} hours ahead and the call goes back to you. A later cancel or a no-show uses it. If I have to move or cancel a call, it never counts against you. Unused calls don't carry over to the next month.`;
}

/**
 * The honest anchor for a recommended monthly package: how much more it is
 * than the next cheaper monthly package on the site ("$31 more than Nutrition
 * Coaching"). Both prices are listed ones, never a made-up "worth" or a
 * crossed-out price; null when there's nothing cheaper to compare with.
 */
export function anchorLine<T extends PublicPackage>(pkg: T, listed: readonly T[]): string | null {
  if (!pkg.recommended || pkg.kind !== "subscription" || !pkg.priceCents) return null;
  const cheaper = listed
    .filter((p) => p.slug !== pkg.slug && p.kind === "subscription" && p.interval === pkg.interval && p.priceCents && p.priceCents < pkg.priceCents!)
    .sort((a, b) => (b.priceCents ?? 0) - (a.priceCents ?? 0))[0];
  if (!cheaper) return null;
  return `${priceLabel(pkg.priceCents - (cheaper.priceCents ?? 0))} more than ${cheaper.name}`;
}

/** One row of the closing "which one is you?" section. */
/**
 * The cards a pricing section shows, in order: the monthly packages by price,
 * and with `free` the free app first, so every way in sits side by side. Only
 * listed packages, and the free card only beside at least one paid one (a page
 * of one free card isn't a comparison).
 */
export function optionCards<T extends PublicPackage>(rows: readonly T[], opts: { free?: boolean } = {}): T[] {
  const listed = listedPackages(rows);
  const paid = listed
    .filter((p) => p.kind === "subscription")
    .sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0) || a.sortOrder - b.sortOrder);
  const free = opts.free && paid.length ? listed.find((p) => p.kind === "free") : undefined;
  return free ? [free, ...paid] : paid;
}

export type DecisionRow = {
  slug: string;
  kind: PackageKind;
  name: string;
  /** Who it's for, in their words (the package's "Best for"). */
  line: string;
  price: string;
  recommended: boolean;
  cta: string;
};

/**
 * The closing decision, one row per way in: the free app first, then each
 * monthly package on the site in price order. Read from the packages (their
 * "Best for"), so a package taken off the site leaves the list with it.
 */
export function decisionRows(rows: readonly PublicPackage[]): DecisionRow[] {
  const listed = listedPackages(rows).filter((p) => p.kind === "free" || (p.kind === "subscription" && p.priceCents));
  const ordered = [...listed].sort((a, b) => (a.kind === "free" ? -1 : b.kind === "free" ? 1 : (a.priceCents ?? 0) - (b.priceCents ?? 0)));
  return ordered.map((p) => ({
    slug: p.slug,
    kind: p.kind,
    name: p.name,
    line: (p.bestFor ?? p.tagline ?? "").trim(),
    price: p.kind === "free" ? "Free" : `${priceText(p)}`,
    recommended: p.recommended && p.kind !== "free",
    cta: ctaText(p),
  }));
}

/** The admin row → what the public sees. */
export function toPublic(p: CoachingPackage): PublicPackage {
  return {
    slug: p.slug,
    kind: p.kind,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    bestFor: p.best_for,
    features: p.features ?? [],
    priceCents: p.kind === "free" ? 0 : p.price_cents,
    currency: (p.currency || "CAD").toUpperCase(),
    interval: p.kind === "free" ? null : p.kind === "one_time" ? "once" : (p.billing_interval ?? "month"),
    recommended: p.recommended,
    ctaLabel: p.cta_label,
    includedCalls: p.included_calls ?? 0,
    callMinutes: p.call_minutes ?? 30,
    sortOrder: p.sort_order ?? 0,
    listed: p.status === "active" && p.is_public,
    directCheckout: p.kind === "subscription" && !!p.direct_checkout,
  };
}

/** A row from coaching_packages_public() → PublicPackage. */
export function fromPublicRow(r: Record<string, unknown>): PublicPackage {
  const kind = (["free", "membership", "subscription", "one_time"].includes(String(r.kind)) ? r.kind : "subscription") as PackageKind;
  return {
    slug: String(r.slug ?? ""),
    kind,
    name: String(r.name ?? ""),
    tagline: (r.tagline as string) ?? null,
    description: (r.description as string) ?? null,
    bestFor: (r.best_for as string) ?? null,
    features: Array.isArray(r.features) ? (r.features as unknown[]).map(String).filter(Boolean) : [],
    priceCents: r.price_cents == null ? (kind === "free" ? 0 : null) : Number(r.price_cents),
    currency: String(r.currency ?? "CAD").toUpperCase(),
    interval: kind === "free" ? null : kind === "one_time" ? "once" : ((r.billing_interval as BillingInterval) ?? "month"),
    recommended: !!r.recommended,
    ctaLabel: (r.cta_label as string) ?? null,
    includedCalls: Number(r.included_calls ?? 0) || 0,
    callMinutes: Number(r.call_minutes ?? 30) || 30,
    sortOrder: Number(r.sort_order ?? 0) || 0,
    listed: !!r.listed,
    directCheckout: kind === "subscription" && r.direct_checkout === true,
  };
}

/** Status in words for the toolkit. */
export function statusWord(p: Pick<CoachingPackage, "status" | "is_public">): "Live" | "Unlisted" | "Draft" | "Archived" {
  if (p.status === "archived") return "Archived";
  if (p.status === "draft") return "Draft";
  return p.is_public ? "Live" : "Unlisted";
}

/** What would stop a package from saving (empty = fine). */
export function packageProblems(p: {
  slug: string;
  kind: PackageKind;
  name: string;
  tagline?: string | null;
  description?: string | null;
  best_for?: string | null;
  features: string[];
  price_cents: number | null;
  cta_label?: string | null;
  included_calls?: number | null;
  call_minutes?: number | null;
}): string[] {
  const out: string[] = [];
  if (!SLUG_RE.test(p.slug) || p.slug.length > LIMITS.slug) out.push("The link name can be lowercase letters, numbers and dashes.");
  if (!p.name.trim()) out.push("Add a name.");
  if (p.name.length > LIMITS.name) out.push(`Keep the name under ${LIMITS.name} characters.`);
  if ((p.tagline ?? "").length > LIMITS.tagline) out.push(`Keep the one-liner under ${LIMITS.tagline} characters.`);
  if ((p.description ?? "").length > LIMITS.description) out.push(`Keep the description under ${LIMITS.description} characters.`);
  if ((p.best_for ?? "").length > LIMITS.bestFor) out.push(`Keep "Best for" under ${LIMITS.bestFor} characters.`);
  if (p.features.length > LIMITS.features) out.push(`Keep it to ${LIMITS.features} included items.`);
  if (p.features.some((f) => f.length > LIMITS.feature)) out.push(`Keep each included item under ${LIMITS.feature} characters.`);
  if ((p.cta_label ?? "").length > LIMITS.cta) out.push(`Keep the button under ${LIMITS.cta} characters.`);
  if (p.kind !== "free" && p.price_cents != null && (p.price_cents < 0 || p.price_cents > LIMITS.priceCents)) {
    out.push("That price doesn't look right.");
  }
  const calls = p.included_calls ?? 0;
  if (calls < 0 || calls > LIMITS.includedCalls) out.push(`Included calls can be 0 to ${LIMITS.includedCalls} a month.`);
  const mins = p.call_minutes ?? 30;
  if (mins < 15 || mins > 90) out.push("A call can be 15 to 90 minutes.");
  return out;
}

/** What stops a package from going public (on top of saving). */
export function publishProblems(p: Pick<CoachingPackage, "kind" | "status" | "price_cents" | "features" | "name">): string[] {
  const out: string[] = [];
  if (p.status !== "active") out.push("Set it to Active first.");
  if (p.kind !== "free" && !(p.price_cents && p.price_cents > 0)) out.push("Set a price first.");
  if (!p.features.length) out.push("List what's included first.");
  return out;
}

/** The fields whose change a client or visitor would see. */
export const PUBLIC_FIELDS = [
  "name",
  "tagline",
  "description",
  "best_for",
  "features",
  "price_cents",
  "currency",
  "billing_interval",
  "recommended",
  "cta_label",
  "included_calls",
  "call_minutes",
  "sort_order",
  "status",
  "is_public",
] as const;

/** Before → after, in words, for the package's history. */
export function changeWords(before: Record<string, unknown> | null, after: Record<string, unknown>): string[] {
  if (!before) return ["Created"];
  const out: string[] = [];
  const b = (k: string) => before[k];
  const a = (k: string) => after[k];
  if (b("price_cents") !== a("price_cents")) out.push(`Price ${priceLabel(b("price_cents") as number)} → ${priceLabel(a("price_cents") as number)}`);
  if (b("name") !== a("name")) out.push(`Renamed "${b("name")}" → "${a("name")}"`);
  const live = (r: (k: string) => unknown) => r("status") === "active" && !!r("is_public");
  if (live(b) !== live(a)) out.push(live(a) ? "Made public" : "Taken off the site");
  else if (b("status") !== a("status")) out.push(`${String(b("status"))} → ${String(a("status"))}`);
  if (b("recommended") !== a("recommended")) out.push(a("recommended") ? "Marked recommended" : "No longer recommended");
  if (JSON.stringify(b("features") ?? []) !== JSON.stringify(a("features") ?? [])) out.push("What's included changed");
  for (const [k, w] of [
    ["tagline", "One-liner"],
    ["description", "Description"],
    ["best_for", "Best for"],
    ["cta_label", "Button"],
  ] as const) {
    if ((b(k) ?? "") !== (a(k) ?? "")) out.push(`${w} edited`);
  }
  if (b("included_calls") !== a("included_calls") || b("call_minutes") !== a("call_minutes")) out.push("Included calls changed");
  if (b("sort_order") !== a("sort_order") && !out.length) out.push("Moved in the order");
  return out.length ? out : ["Saved"];
}

/**
 * The pricing as text to paste in a DM or caption (toolkit: Copy pricing).
 * One block per package, then where to apply.
 */
export function pricingText(rows: readonly PublicPackage[], opts: { from?: string } = {}): string {
  const lines: string[] = [];
  for (const p of rows) {
    const head =
      p.kind === "free"
        ? `${p.name}: Free`
        : `${p.name}${p.recommended ? " (recommended)" : ""}: ${priceText(p)} ${TAX_NOTE}`;
    lines.push(head);
    if (p.tagline) lines.push(p.tagline);
    const calls = callsLine(p);
    for (const f of p.features) lines.push(`• ${f}`);
    if (calls && !p.features.some((f) => /call/i.test(f))) lines.push(`• ${calls}`);
    lines.push(p.kind === "free" ? `Join: ${SITE}${FREE_JOIN_PATH}` : `Apply: ${shareLink(p, opts.from ?? "share")}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** A call review's action items as text (stored as strings or {text}). */
export function actionTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === "string" ? x : typeof (x as { text?: unknown })?.text === "string" ? String((x as { text: string }).text) : ""))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * The answer to "What does coaching cost?", from the packages on the site
 * (null when none are: the page keeps its own words).
 */
export function costAnswer(rows: readonly PublicPackage[]): string | null {
  const plans = listedPackages(rows).filter((p) => p.kind === "subscription" && p.priceCents);
  if (!plans.length) return null;
  const ordered = [...plans].sort((a, b) => Number(b.recommended) - Number(a.recommended));
  const parts = ordered.map((p) => `${p.name} is ${priceLabel(p.priceCents)} a month`);
  const lead = parts.length === 1 ? `${parts[0]}.` : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
  return `${lead} Prices are in Canadian dollars, plus applicable tax. Applying is free, and we talk on a short call before you commit to anything.`;
}
