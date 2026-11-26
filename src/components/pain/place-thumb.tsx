/**
 * A small picture of where a place is: its part of the body, framed, the spot
 * (or the whole area) lit. Used by the review's list and the coach's recovery
 * card in chat. Loads only the drawing, never the map.
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { AnatomyFigure, placeKey } from "@/components/pain/anatomy-figure";
import { atlasView } from "@/lib/pain/anatomy/atlas";
import { partForPlace, viewForPlace } from "@/lib/pain/anatomy/place-view";
import { siteOf } from "@/lib/pain/sites";
import type { PainSide } from "@/lib/pain/regions";

export function PlaceThumb({ place, className }: { place: { region: string; side?: PainSide | null; site?: string | null }; className?: string }) {
  const art = useMemo(() => {
    if (place.region === "other") return null;
    // A symptom that isn't in one place (dizziness, nausea): the whole body, nothing lit.
    if (place.region === "general") return { view: atlasView("front", "R"), deep: false, box: { x: 40, y: 0, w: 320, h: 920 }, picked: new Set<string>(), areas: new Set<string>() };
    const side = place.side ?? null;
    const where = viewForPlace(place.site, place.region, side);
    const view = atlasView(where.view, where.facing);
    const part = partForPlace(view, place.site, place.region, side);
    if (!part) return null;
    const size = Math.max(part.box.w, part.box.h) * (place.site ? 2.2 : 1.4) + 24;
    const cx = part.box.x + part.box.w / 2;
    const cy = part.box.y + part.box.h / 2;
    const picked = new Set(place.site ? [placeKey(place.site, siteOf(place.site)?.midline ? null : side)] : []);
    const areas = new Set(place.site ? [] : [`${place.region}:${side ?? "-"}`]);
    return { view, deep: !!siteOf(place.site)?.deep, box: { x: cx - size / 2, y: cy - size / 2, w: size, h: size }, picked, areas };
  }, [place.site, place.region, place.side]);
  return (
    <span className={cn("relative block h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#0b0b0d] ring-1 ring-border", className)} aria-hidden data-place-thumb>
      {art && <AnatomyFigure view={art.view} box={art.box} deep={art.deep} picked={art.picked} pickedAreas={art.areas} detail className="h-full w-full" />}
    </span>
  );
}
