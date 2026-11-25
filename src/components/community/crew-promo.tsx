/**
 * A JF Effect promo as one screen of the Crew feed, always labelled
 * "Sponsored · JF Effect", with Not interested to dismiss it for good
 * (crew-ads/placement.ts has where and how often). Impressions count once a
 * visit when half of it is on screen; taps and dismissals count too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { getMyPromos, trackPromo } from "@/lib/crew-ads/crew-ads.functions";
import { SPONSORED_LABEL, promoFor, promoSlots, safePromoPath, type Promo } from "@/lib/crew-ads/placement";
import { inProgressWorkoutDay } from "@/lib/workout-resume";

const SESSION_KEY = "jf.crew-promo-session";

function visitKey(): string {
  try {
    const k = sessionStorage.getItem(SESSION_KEY);
    if (k) return k;
    const fresh = Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return "visit";
  }
}

/**
 * The promos for this visit and where they go: `at(i)` is the promo that
 * follows post i (or null). Off for staff and previews (`enabled` false).
 */
export function useCrewPromos(posts: number, enabled: boolean) {
  const fn = useServerFn(getMyPromos);
  const track = useServerFn(trackPromo);
  const session = useMemo(() => (typeof window === "undefined" ? "ssr" : visitKey()), []);
  const q = useQuery({ queryKey: ["crew-promos", session], queryFn: () => fn(), enabled, staleTime: Infinity, gcTime: Infinity });
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const promos = useMemo(() => (q.data?.promos ?? []).filter((p) => !dismissed.has(p.id) && safePromoPath(p.cta_path)), [q.data, dismissed]);
  const slots = useMemo(
    () =>
      enabled && q.data
        ? promoSlots({ posts, sessionKey: session, shownToday: q.data.shownToday, workoutGoing: !!inProgressWorkoutDay(), available: promos.length })
        : [],
    [enabled, q.data, posts, session, promos.length],
  );
  const at = useCallback((i: number): { promo: Promo; slot: number } | null => {
    const slot = slots.indexOf(i);
    if (slot < 0) return null;
    const promo = promoFor(promos, slot);
    return promo ? { promo, slot } : null;
  }, [slots, promos]);
  const send = useCallback(
    (id: string, event: "impression" | "click" | "dismiss") => void track({ data: { campaignId: id, event, session } }).catch(() => {}),
    [track, session],
  );
  const dismiss = useCallback(
    (id: string) => {
      send(id, "dismiss");
      setDismissed((s) => new Set(s).add(id));
    },
    [send],
  );
  return { at, send, dismiss };
}

export function CrewPromoScreen({ promo, onSeen, onTap, onDismiss }: { promo: Promo; onSeen: () => void; onTap: () => void; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useRef(false);
  const seenFn = useRef(onSeen);
  seenFn.current = onSeen;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!seen.current && entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) {
          seen.current = true;
          seenFn.current();
        }
      },
      { threshold: [0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const path = safePromoPath(promo.cta_path) ?? "/";
  return (
    <div ref={ref} className="mx-auto w-full max-w-md rounded-3xl bg-card p-6 text-card-foreground ring-1 ring-border" data-crew-promo={promo.id}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground" data-sponsored-label>
          {SPONSORED_LABEL}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-2 inline-flex h-10 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-muted-foreground active:opacity-70"
          aria-label="Not interested: don't show this again"
        >
          <X className="h-4 w-4" aria-hidden /> Not interested
        </button>
      </div>
      <h2 className="mt-4 text-[26px] font-bold leading-tight tracking-tight">{promo.headline}</h2>
      {promo.body && <p className="mt-2 text-[16px] leading-relaxed text-muted-foreground">{promo.body}</p>}
      <Link
        to={path as any}
        onClick={onTap}
        className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-primary px-6 text-[16px] font-semibold text-primary-foreground active:scale-[0.99]"
      >
        {promo.cta_label}
      </Link>
    </div>
  );
}
