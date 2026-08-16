/**
 * Deterministic attribution for public coaching-application submissions.
 *
 * Nothing here guesses: when a signal is absent, the value stays null and the
 * admin UI renders "Unknown". The default source label is only applied to the
 * canonical Quick Apply flow, and an explicit `?from=` query refines it.
 */

export const DEFAULT_QUICK_APPLY_SOURCE = "Website · Online Coaching";
export const UNKNOWN_SOURCE = "Unknown";

/** Known `?from=` values → human source labels. Anything else is title-cased. */
const FROM_LABELS: Record<string, string> = {
  selkirk: "Website · Selkirk Personal Training",
  coaching: "Website · Online Coaching",
  home: "Website · Home Page",
  instagram: "Instagram",
  ig: "Instagram",
  facebook: "Facebook",
  google: "Google",
  email: "Email",
  referral: "Referral",
};

export type AttributionInput = {
  /** Explicit `?from=` marketing token, or a page-supplied source key. */
  from?: string | null;
  /** Full page URL at submit time. */
  page_url?: string | null;
  /** document.referrer at submit time. */
  referrer?: string | null;
  /** Name of the form that produced the submission. */
  form_name?: string | null;
  /** Fallback label when there is no `from` token (e.g. Quick Apply default). */
  default_source_label?: string | null;
};

export type Attribution = {
  source_label: string | null;
  form_name: string | null;
  page_path: string | null;
  page_url: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

function clean(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function labelForFrom(from: string | null | undefined): string | null {
  const key = clean(from, 80)?.toLowerCase();
  if (!key) return null;
  if (FROM_LABELS[key]) return FROM_LABELS[key]!;
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Parse path + utm params out of a full URL. Never throws. */
export function parsePageUrl(pageUrl: string | null | undefined): {
  page_path: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
} {
  const url = clean(pageUrl);
  const empty = { page_path: null, utm_source: null, utm_medium: null, utm_campaign: null };
  if (!url) return empty;
  try {
    const u = new URL(url, url.startsWith("http") ? undefined : "https://jfeffect.com");
    return {
      page_path: u.pathname || null,
      utm_source: clean(u.searchParams.get("utm_source"), 120),
      utm_medium: clean(u.searchParams.get("utm_medium"), 120),
      utm_campaign: clean(u.searchParams.get("utm_campaign"), 120),
    };
  } catch {
    return { ...empty, page_path: url.startsWith("/") ? url.split("?")[0]! : null };
  }
}

export function resolveAttribution(input: AttributionInput): Attribution {
  const parsed = parsePageUrl(input.page_url);
  const fromLabel = labelForFrom(input.from);
  return {
    source_label: fromLabel ?? clean(input.default_source_label, 120),
    form_name: clean(input.form_name, 120),
    page_path: parsed.page_path,
    page_url: clean(input.page_url),
    referrer: clean(input.referrer),
    utm_source: parsed.utm_source,
    utm_medium: parsed.utm_medium,
    utm_campaign: parsed.utm_campaign,
  };
}

/** Display helper — legacy rows with no attribution always read "Unknown". */
export function displaySource(row: {
  source_label?: string | null;
  form_name?: string | null;
  page_path?: string | null;
} | null | undefined): string {
  const label = clean(row?.source_label, 120);
  if (label) return label;
  return UNKNOWN_SOURCE;
}
