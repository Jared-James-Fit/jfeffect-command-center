/**
 * Where a place is shown on the body map (pure): the view it's best seen in
 * and the drawn part to frame. Shared by the map, its thumbnails and the
 * coach's chat card.
 */
import { atlasView, type AtlasPart, type AtlasView, type SideFacing, type ViewKey } from "@/lib/pain/anatomy/atlas";
import type { PainSide } from "@/lib/pain/regions";
import { siteCovers } from "@/lib/pain/sites";

/** A part shows this spot: the spot itself, or one its group covers ("Fingers" is each finger). */
function onSpot(partSite: string | null, site: string): boolean {
  return partSite === site || (!!partSite && siteCovers(site).includes(partSite));
}

/** A spot's best view to show it in: front, then back, then side (its side of the body). */
export function viewForPlace(site: string | null | undefined, region: string, side: PainSide | null): { view: ViewKey; facing: SideFacing } {
  for (const v of ["front", "back", "side"] as ViewKey[]) {
    for (const f of (v === "side" ? [side === "L" ? "L" : "R"] : ["R"]) as SideFacing[]) {
      const av = atlasView(v, f);
      const has = av.parts.some((p) => (site ? onSpot(p.site, site) : p.region === region) && (side == null || p.side == null || p.side === side));
      if (has) return { view: v, facing: f };
    }
  }
  return { view: "front", facing: "R" };
}

/** The part to frame for a place (its largest drawn part on that view). */
export function partForPlace(view: AtlasView, site: string | null | undefined, region: string, side: PainSide | null): AtlasPart | null {
  let best: AtlasPart | null = null;
  for (const p of view.parts) {
    if (site ? !onSpot(p.site, site) : p.region !== region) continue;
    if (side != null && p.side != null && p.side !== side) continue;
    if (!best || p.box.w * p.box.h > best.box.w * best.box.h) best = p;
  }
  return best;
}

