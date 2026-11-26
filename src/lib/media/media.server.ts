/**
 * KLIPY, server side only: the key never reaches a phone.
 *
 * - `KLIPY_API_KEY` (free production key from partner.klipy.com). Without it
 *   the picker quietly runs on the app's own library.
 * - Every user is sent as an opaque hash, never their id or email.
 * - Responses are kept for a few minutes per (kind, query, page) and identical
 *   requests in flight share one call, so a busy feed costs KLIPY one request,
 *   not one per person. Media itself is never downloaded or stored: the app
 *   shows KLIPY's own links.
 * - A 429 / outage backs off for a minute and the picker falls back to the
 *   library instead of erroring.
 */
import { createHash } from "node:crypto";
import { parseKlipy, type MediaItem, type MediaKind } from "@/lib/media/media";

const BASE = "https://api.klipy.com/api/v1";
const PER_PAGE = 30;
const TTL_TRENDING = 10 * 60_000;
const TTL_SEARCH = 30 * 60_000;
const MAX_ENTRIES = 400;
/** Safe for a coaching community: no adult or graphic results. */
export const CONTENT_FILTER = "medium";

type Page = { items: MediaItem[]; hasNext: boolean };
const cache = new Map<string, { at: number; ttl: number; page: Page }>();
const inflight = new Map<string, Promise<Page>>();
let downUntil = 0;

export const klipyKey = () => (process.env.KLIPY_API_KEY ?? "").trim() || null;

export function customerIdFor(userId: string) {
  return createHash("sha256").update(`jfeffect-media:${userId}`).digest("hex").slice(0, 32);
}

function remember(key: string, ttl: number, page: Page) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), ttl, page });
}

export type ProviderResult = Page & { available: boolean };

export async function klipyBrowse(opts: { kind: MediaKind; q: string; page: number; userId: string }): Promise<ProviderResult> {
  const key = klipyKey();
  if (!key || Date.now() < downUntil) return { items: [], hasNext: false, available: false };
  const q = opts.q.trim().toLowerCase().slice(0, 80);
  const path = opts.kind === "sticker" ? "stickers" : "gifs";
  const ck = `${path}|${q}|${opts.page}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < hit.ttl) return { ...hit.page, available: true };
  let p = inflight.get(ck);
  if (!p) {
    p = (async () => {
      const params = new URLSearchParams({
        page: String(opts.page),
        per_page: String(PER_PAGE),
        customer_id: customerIdFor(opts.userId),
        locale: "CA",
        content_filter: CONTENT_FILTER,
      });
      if (q) params.set("q", q);
      const url = `${BASE}/${encodeURIComponent(key)}/${path}/${q ? "search" : "trending"}?${params}`;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      try {
        const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
        if (res.status === 429 || res.status >= 500) {
          downUntil = Date.now() + 60_000;
          throw new Error(`klipy ${res.status}`);
        }
        if (!res.ok) throw new Error(`klipy ${res.status}`);
        const page = parseKlipy(await res.json(), opts.kind);
        remember(ck, q ? TTL_SEARCH : TTL_TRENDING, page);
        return page;
      } finally {
        clearTimeout(t);
      }
    })();
    inflight.set(ck, p);
    p.finally(() => inflight.delete(ck)).catch(() => {});
  }
  try {
    return { ...(await p), available: true };
  } catch {
    // stale is better than nothing
    if (hit) return { ...hit.page, available: true };
    return { items: [], hasNext: false, available: false };
  }
}

/** Tell KLIPY an item was sent (improves its trending / relevance). Never throws. */
export async function klipyShare(opts: { kind: MediaKind; slug: string; q: string; userId: string }) {
  const key = klipyKey();
  if (!key || Date.now() < downUntil) return;
  const path = opts.kind === "sticker" ? "stickers" : "gifs";
  try {
    await fetch(`${BASE}/${encodeURIComponent(key)}/${path}/share/${encodeURIComponent(opts.slug)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_id: customerIdFor(opts.userId), q: opts.q.slice(0, 80) }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* best effort */
  }
}

/** For tests. */
export function __resetKlipyCache() {
  cache.clear();
  inflight.clear();
  downUntil = 0;
}
