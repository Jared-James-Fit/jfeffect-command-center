/**
 * "Anything hurt?" → Yes, in the workout review (Nov 21 2026): the spots that
 * hurt, each a row with a small picture of where it is, how bad (0–10) and
 * what they added, and the anatomical body map (pain-map.tsx) to add or change
 * them. Yes opens the map straight away the first time; every spot opens its
 * details again with one tap.
 *
 * A severe spot, tingling or numbness, a pop or swelling shows the safety
 * notice (safety.ts): the urgent signs, and "worth a physio or doctor's look".
 * That's the only advice the athlete sees here; anything about training or
 * recovery comes from their coach.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { AnatomyFigure } from "@/components/pain/anatomy-figure";
import { PainMap, type PainMapContext } from "@/components/pain/pain-map";
import { PlaceThumb as Thumb } from "@/components/pain/place-thumb";
import { atlasView } from "@/lib/pain/anatomy/atlas";
import { FEELS, TIMINGS, placeLabel } from "@/lib/pain/report";
import { siteAnatomy } from "@/lib/pain/sites";
import { regionOf } from "@/lib/pain/regions";
import { pickScore, unrated, type PainPick } from "@/lib/pain/picks";
import { CLIENT_SAFETY_NOTICE, needsSafetyNotice, URGENT_SIGNS } from "@/lib/pain/safety";

export type PainContext = PainMapContext;

function PlaceThumb({ pick }: { pick: PainPick }) {
  return <Thumb place={pick} />;
}

function detailLine(p: PainPick): string {
  const feel = (p.feel ?? []).map((f) => FEELS.find((x) => x.v === f)?.label).filter(Boolean) as string[];
  const when = (p.timing ?? []).map((t) => TIMINGS.find((x) => x.v === t)?.label).filter(Boolean) as string[];
  return [feel.slice(0, 2).join(", "), when.slice(0, 1).join(""), p.exerciseName].filter(Boolean).join(" · ");
}

export function PainReporter({ picks, onChange, ctx }: { picks: PainPick[]; onChange: (next: PainPick[]) => void; ctx: PainContext | null }) {
  const [mapOpen, setMapOpen] = useState(false);
  const [editUid, setEditUid] = useState<string | null>(null);
  // Yes opens the map by itself, once (closing it with nothing picked leaves the prompt here)
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (picks.length === 0) setMapOpen(true);
  }, [picks.length]);
  const safety = needsSafetyNotice(picks.map((p) => ({ region: p.region, side: p.side ?? null, severity: p.severity, score: p.score, feel: p.feel, trigger: p.trigger, timing: p.timing })));

  const open = (uid: string | null) => {
    feedback("tap");
    setEditUid(uid);
    setMapOpen(true);
  };
  const remove = (p: PainPick) => {
    feedback("tap");
    const before = picks;
    onChange(picks.filter((x) => x.uid !== p.uid));
    toast(`${placeLabel(p)} removed`, { action: { label: "Undo", onClick: () => onChange(before) }, duration: 5000 });
  };

  return (
    <div className="space-y-2" data-pain-reporter>
      {picks.length === 0 ? (
        <button
          type="button"
          onClick={() => open(null)}
          className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-muted"
          data-testid="pain-where"
          data-pain-open-map
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#0b0b0d] ring-1 ring-border" aria-hidden>
            <AnatomyFigure view={atlasView("front")} box={{ x: 80, y: 10, w: 240, h: 460 }} detail={false} className="h-full w-full" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Show where it hurts</span>
            <span className="block text-[13px] text-muted-foreground">Tap the exact spot on the body</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ) : (
        <ul className="space-y-2" aria-label="Where it hurts">
          {picks.map((p) => {
            const sc = pickScore(p);
            const anat = siteAnatomy(p.site);
            const line = detailLine(p);
            const needs = unrated(p) || (p.region === "other" && !p.note?.trim());
            return (
              <li key={p.uid} className={cn("flex items-center gap-3 rounded-xl border p-2.5", needs ? "border-warning/60" : "border-border")} data-pain-place={`${p.site ?? p.region}:${p.side ?? "-"}`}>
                <button type="button" onClick={() => open(p.uid)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`${placeLabel(p)}: change`}>
                  <PlaceThumb pick={p} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[15px] font-semibold">{placeLabel(p)}</span>
                      <span className={cn("shrink-0 text-[14px] font-semibold tabular-nums", needs ? "text-warning" : "text-foreground")} data-pain-place-score>
                        {sc != null ? `${sc}/10` : ""}
                      </span>
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {needs ? (p.region === "other" && !p.note?.trim() ? "Say where" : "Tap to rate how bad") : line || anat || regionOf(p.region)?.label}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => remove(p)} className="-mr-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label={`Remove ${placeLabel(p)}`}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => open(null)} className="inline-flex h-11 items-center gap-1.5 rounded-lg px-1 text-[14px] font-semibold text-foreground hover:bg-muted" data-pain-add-another>
              <Plus className="h-4 w-4" aria-hidden /> Add another area
            </button>
          </li>
        </ul>
      )}

      {safety && (
        <div className="space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[13px] leading-snug" data-pain-safety role="note">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden /> {CLIENT_SAFETY_NOTICE.title}
          </p>
          <p>{CLIENT_SAFETY_NOTICE.body}</p>
          <p className="text-muted-foreground">
            {CLIENT_SAFETY_NOTICE.urgentLead} {URGENT_SIGNS.join("; ")}.
          </p>
        </div>
      )}

      <PainMap open={mapOpen} onOpenChange={setMapOpen} picks={picks} onChange={onChange} ctx={ctx} editUid={editUid} />
    </div>
  );
}
