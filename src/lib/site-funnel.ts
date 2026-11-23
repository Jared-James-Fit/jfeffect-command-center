/**
 * Count a public-site step from the browser (site-funnel-rules.ts): the same
 * anonymous id and first source as the join funnel (join-funnel.ts), plus a
 * coarse device class. Fire-and-forget: it never waits, never throws, and
 * does nothing on the server or in a preview.
 */
import { captureSource, currentDevice, visitorId } from "@/lib/join-funnel";
import { cleanStep, type SiteEvent } from "@/lib/site-funnel-rules";

export function trackSite(event: SiteEvent, step?: string | null): void {
  const id = visitorId();
  if (!id) return;
  const s = captureSource();
  const device = currentDevice();
  void import("@/lib/site-funnel.functions")
    .then(({ trackSiteFunnel }) =>
      trackSiteFunnel({
        data: {
          visitorId: id,
          event,
          step: cleanStep(step),
          device,
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
