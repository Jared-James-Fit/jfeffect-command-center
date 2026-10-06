// One shared cache of signed storage URLs for chat media.
//
// Before: the thread's signed-URL query was keyed by the *set of paths*, so
// every new message with media produced a new key, the old data vanished, and
// every image in the thread lost its URL, re-signed itself and reloaded
// (visible as blinking pictures whenever anything arrived). URLs were also
// re-issued with new tokens on each batch, which restarted image loads.
//
// Now a URL is signed once, kept until shortly before it expires, and only
// missing paths are ever requested (in one batched call). Callers get the same
// string for the same path for ~55 minutes, so nothing reloads.

export type SignFn = (paths: string[]) => Promise<Record<string, string>>;

type Entry = { url: string; expiresAt: number };

export function createSignedUrlCache(sign: SignFn, opts: { ttlMs?: number; now?: () => number } = {}) {
  const ttlMs = opts.ttlMs ?? 55 * 60_000; // signed for 60 min; refresh a little early
  const now = opts.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<void>>();

  const fresh = (e: Entry | undefined): e is Entry => !!e && e.expiresAt > now();

  return {
    get(path: string): string | undefined {
      const e = entries.get(path);
      return fresh(e) ? e.url : undefined;
    },
    /** Paths that have no usable URL yet. */
    missing(paths: string[]): string[] {
      const out: string[] = [];
      for (const p of paths) if (p && !fresh(entries.get(p))) out.push(p);
      return Array.from(new Set(out));
    },
    /** Use a URL we already have (e.g. a local blob for media we just uploaded) without a round trip. */
    seed(path: string, url: string, ttl = ttlMs) {
      if (!path || !url) return;
      entries.set(path, { url, expiresAt: now() + ttl });
    },
    /** Sign whatever is missing, once, in a single batched call. Concurrent callers share the request. */
    async ensure(paths: string[]): Promise<void> {
      const need = this.missing(paths).filter((p) => !inFlight.has(p));
      const waiting = paths.map((p) => inFlight.get(p)).filter((x): x is Promise<void> => !!x);
      if (need.length) {
        const req = sign(need)
          .then((res) => {
            for (const p of need) if (res[p]) entries.set(p, { url: res[p], expiresAt: now() + ttlMs });
          })
          .finally(() => { for (const p of need) inFlight.delete(p); });
        for (const p of need) inFlight.set(p, req);
        waiting.push(req);
      }
      await Promise.all(waiting).catch(() => { /* callers fall back to per-item signing */ });
    },
    /** Current URLs for `paths` (only those available). */
    snapshot(paths: string[]): Record<string, string> {
      const out: Record<string, string> = {};
      for (const p of paths) {
        const u = this.get(p);
        if (u) out[p] = u;
      }
      return out;
    },
    isLoading(paths: string[]): boolean {
      return paths.some((p) => inFlight.has(p));
    },
    clear() { entries.clear(); },
  };
}
