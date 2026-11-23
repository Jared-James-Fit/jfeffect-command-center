/**
 * The join funnel, from the browser (membership-apply.ts, membership_funnel_events):
 * an anonymous id per browser (never a person, never sent anywhere else), the
 * first place they came from (an Instagram link, a ?from=, a referrer), and a
 * fire-and-forget report of each step. Nothing here ever blocks the page.
 */
import { trackJoinFunnel } from "@/lib/membership-applications.functions";
import type { FunnelEvent, MemberStepKey } from "@/lib/membership-apply";
import { EMPTY_SOURCE as EMPTY, sourceFrom, type JoinSource } from "@/lib/join-source";
import { deviceClass, type Device } from "@/lib/site-funnel-rules";

const VISITOR_KEY = "jf_visitor_v1";
const SOURCE_KEY = "jf_join_source_v1";
const SOURCE_DAYS = 30;

export type { JoinSource };

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
  );
}

export function visitorId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(VISITOR_KEY);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = uuid();
      window.localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

const hasAny = (s: JoinSource) =>
  !!(s.source || s.referrer || s.utm_source || s.utm_medium || s.utm_campaign);

/** The first place they came from in the last 30 days (a later direct visit never overwrites it). */
export function captureSource(): JoinSource {
  if (typeof window === "undefined") return EMPTY;
  const now = sourceFrom(window.location.href, document.referrer);
  try {
    const raw = window.localStorage.getItem(SOURCE_KEY);
    const saved = raw ? (JSON.parse(raw) as { at: number; s: JoinSource }) : null;
    const fresh = saved && Date.now() - Number(saved.at) < SOURCE_DAYS * 86_400_000;
    if (fresh && hasAny(saved!.s) && !hasAny(now)) return saved!.s;
    if (hasAny(now) || !fresh)
      window.localStorage.setItem(SOURCE_KEY, JSON.stringify({ at: Date.now(), s: now }));
    return hasAny(now) ? now : fresh ? saved!.s : now;
  } catch {
    return now;
  }
}

/** Phone, tablet or desktop (site-funnel-rules.ts), never anything finer. */
export function currentDevice(): Device | null {
  if (typeof window === "undefined") return null;
  try {
    const short = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    return deviceClass(short, coarse);
  } catch {
    return null;
  }
}

/** Report one step; never waits, never throws. */
export function trackJoin(event: FunnelEvent, step?: MemberStepKey): void {
  const id = visitorId();
  if (!id) return;
  const s = captureSource();
  void Promise.resolve()
    .then(() =>
      trackJoinFunnel({
        data: {
          visitorId: id,
          event,
          step: step ?? null,
          device: currentDevice(),
          source: s.source,
          referrer: s.referrer,
          utm_source: s.utm_source,
          utm_medium: s.utm_medium,
          utm_campaign: s.utm_campaign,
        },
      }),
    )
    .catch(() => null);
}
