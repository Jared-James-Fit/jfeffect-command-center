/** Where a visitor came from, read from the address and referrer (pure, tested; join-funnel.ts keeps the first one). */
export type JoinSource = {
  source: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

export const EMPTY_SOURCE: JoinSource = {
  source: null,
  referrer: null,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
};

/** Pure: what a page's address and referrer say about where someone came from (tested). */
export function sourceFrom(href: string, referrer: string | null | undefined): JoinSource {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return EMPTY_SOURCE;
  }
  const p = (k: string) => (url.searchParams.get(k) ?? "").trim().slice(0, 120) || null;
  let ref: string | null = null;
  try {
    const r = new URL(String(referrer ?? ""));
    ref = r.hostname && r.hostname !== url.hostname ? r.toString().slice(0, 500) : null;
  } catch {
    ref = null;
  }
  return {
    source: (p("from") ?? p("ref"))?.slice(0, 80) ?? null,
    referrer: ref,
    utm_source: p("utm_source"),
    utm_medium: p("utm_medium"),
    utm_campaign: p("utm_campaign"),
  };
}
