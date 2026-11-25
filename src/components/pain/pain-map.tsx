/**
 * "Where does it hurt?": the anatomical body map, full screen over the
 * workout review (Nov 21 2026).
 *
 * Front, back and side views of the body, every muscle, tendon and joint area
 * drawn (atlas-data.ts). A tap on the body zooms into that area; zoomed in, a
 * tap (or a tap on a label) picks the exact spot and opens its details: how
 * bad 0–10, what it feels like, when it hurts, which exercise. Pinch and drag
 * zoom anywhere; the deeper layer shows the rotator cuff, rhomboids, QL,
 * piriformis and the like; the list finds any spot by name.
 *
 * What's picked is the review's own state: leaving the map (←, Done, Escape)
 * never drops anything, and a spot comes off only with its ✕. The map shows
 * where they feel it, never what's wrong: nothing here names an injury.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, Layers, List, Search, X, AlertTriangle, Trash2, Mic, Loader2, PenLine, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { noAutofill } from "@/lib/no-autofill";
import { AnatomyFigure, placeKey } from "@/components/pain/anatomy-figure";
import { atlasView, hasDeep, partAt, regionBox, type AtlasPart, type AtlasView, type SideFacing, type ViewKey } from "@/lib/pain/anatomy/atlas";
import { DETAIL_SCALE, IDENTITY, centerOn, clampXf, fitView, frameBox, toDrawing, toScreen, zoomAt, type Size, type Xf } from "@/lib/pain/anatomy/stage";
import { PAIN_REGIONS, areaLabel, regionOf, type PainSide } from "@/lib/pain/regions";
import { PAIN_SITES, searchSites, siteAnatomy, siteLabel, siteOf } from "@/lib/pain/sites";
import { CHANGES, FEELS, FEEL_CHOICES, FEEL_SIGNS, IMPACTS, NOTE_MAX, TIMINGS, placeLabel, scoreWord, type Feel, type Timing } from "@/lib/pain/report";
import { followUpFor, shortDay, type PainEntry } from "@/lib/pain/history";
import { addPick, answerFollowUp, applyDescribed, mirrorOf, pickScore, recentSites, scorePatch, setSideChoice, sideChoiceOf, unrated, updatePaired, type PainPick, type SideChoice } from "@/lib/pain/picks";
import { chooseSide, describePain, describedGroups, describedLine, type DescribeResult, type DescribedPlace } from "@/lib/pain/describe";
import { readPainDescriptionFn, transcribePainVoiceFn } from "@/lib/pain/describe.functions";
import { AiConsentInline, useMyAiConsent } from "@/components/ai-consent/ai-consent";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";
import { VoiceMicButton, VoiceStatusLine } from "@/components/voice/voice-recorder";
import { CLIENT_SAFETY_NOTICE, needsSafetyNotice, URGENT_SIGNS } from "@/lib/pain/safety";
import { useSwipeDownToClose } from "@/hooks/use-swipe-down-to-close";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { revealDelta } from "@/lib/equipment/setup-draft";
import { viewForPlace, partForPlace } from "@/lib/pain/anatomy/place-view";

export type PainMapContext = {
  today: string;
  entries: PainEntry[];
  exercises: { id: string | null; name: string }[];
  feedbackId: string | null;
};

/** The four ways round: a side view shows one side of the body at a time. */
const VIEWS: { v: ViewKey; facing: SideFacing; key: string; label: string }[] = [
  { v: "front", facing: "R", key: "front", label: "Front" },
  { v: "back", facing: "R", key: "back", label: "Back" },
  { v: "side", facing: "R", key: "side-R", label: "Right side" },
  { v: "side", facing: "L", key: "side-L", label: "Left side" },
];

export { viewForPlace, partForPlace };

/**
 * How much of the stage a spot's details take: the sheet is always this tall
 * (it never grows as sections appear) and the map frames the spot and lays out
 * its labels in the rest above it, so no label sits under the sheet.
 */
const DETAILS_SHARE = 0.64;

const chip = (on: boolean) =>
  cn(
    "inline-flex min-h-10 items-center justify-center rounded-full border px-3.5 text-[14px] font-medium transition-colors active:scale-[0.97]",
    on ? "border-primary bg-primary/15 text-foreground" : "border-border bg-transparent text-foreground/90 hover:bg-muted",
  );

// ── 0–10 ────────────────────────────────────────────────────────────────

function ScoreScale({ value, onPick, label }: { value: number | null; onPick: (n: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // a finger can slide sideways along the scale: the number under it is picked as it moves;
  // up or down is the sheet's scroll (touch-pan-y), so a swipe that starts here never picks
  const drag = useRef<{ x: number; y: number; sliding: boolean } | null>(null);
  const slid = useRef(false);
  const at = (clientX: number) => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(10, Math.floor(((clientX - r.left) / r.width) * 11)));
  };
  const set = (n: number | null) => {
    if (n == null || n === value) return;
    feedback("detent");
    onPick(n);
  };
  return (
    <div>
      <div
        ref={ref}
        role="radiogroup"
        aria-label={label}
        className="grid touch-pan-y grid-cols-11 gap-1 select-none"
        data-no-sheet-drag
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, sliding: false };
          slid.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (!d.sliding) {
            const dx = e.clientX - d.x;
            if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
            d.sliding = true;
            slid.current = true;
          }
          set(at(e.clientX));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        data-pain-score
      >
        {Array.from({ length: 11 }, (_, n) => {
          const on = value === n;
          const lit = value != null && n <= value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${n} out of 10${scoreWord(n) ? `, ${scoreWord(n)}` : ""}`}
              onClick={() => {
                // the click a slide ends on is the slide's, not a tap on where it started
                if (slid.current) {
                  slid.current = false;
                  return;
                }
                set(n);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") set(Math.min(10, (value ?? -1) + 1));
                if (e.key === "ArrowLeft") set(Math.max(0, (value ?? 1) - 1));
              }}
              className={cn(
                "flex h-11 items-center justify-center rounded-md text-[15px] font-semibold tabular-nums transition-colors",
                on ? "bg-primary text-primary-foreground" : lit ? "bg-primary/25 text-foreground" : "bg-muted text-foreground/85",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-muted-foreground">
        <span>No pain</span>
        <span className={cn("font-semibold", value != null ? "text-foreground" : "")} data-pain-score-word>
          {value != null ? `${value}/10 · ${scoreWord(value)}` : "Tap a number"}
        </span>
        <span>Worst</span>
      </div>
    </div>
  );
}

// ── one place's details ─────────────────────────────────────────────────

type ViewportBox = { top: number; height: number; keyboard: boolean } | null;

function PlaceDetails({
  pick,
  mirror,
  sideChoice,
  ctx,
  vv,
  undo,
  onChange,
  onMirrorScore,
  onSide,
  onRemove,
  onDone,
}: {
  pick: PainPick;
  /** The same spot on the other side, while both are picked. */
  mirror: PainPick | null;
  /** Left · Right · Both (null: a place with no sides). */
  sideChoice: SideChoice | null;
  ctx: PainMapContext | null;
  /** The visible part of the screen (useVisualViewportBox): with the keyboard up the details are pinned to it. */
  vv: ViewportBox;
  /** "Right side removed · Undo", while it can still be put back. */
  undo: { label: string; onUndo: () => void } | null;
  onChange: (patch: Partial<PainPick>) => void;
  onMirrorScore: (n: number) => void;
  onSide: (choice: SideChoice) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const kb = !!vv?.keyboard;
  // one swipe down puts the details away (the place stays picked); never while typing,
  // when a pull down takes the keyboard down instead (iOS's own sheets)
  useSwipeDownToClose(panel, !kb, onDone);
  const scroller = useRef<HTMLDivElement | null>(null);
  const reveal = useCallback((el: Element | null) => {
    const sc = scroller.current;
    if (!sc || !el || !sc.contains(el)) return;
    const r = el.getBoundingClientRect();
    const b = sc.getBoundingClientRect();
    const d = revealDelta({ top: r.top, bottom: r.bottom, viewTop: b.top, viewBottom: b.bottom });
    if (d) sc.scrollTop += d;
  }, []);
  // the box being typed in stays in view as the keyboard comes up and the sheet resizes
  useEffect(() => {
    if (kb) reveal(document.activeElement);
  }, [kb, vv?.height, vv?.top, reveal]);
  const pull = useRef<number | null>(null);
  const both = sideChoice === "both" && !!mirror;
  const name = both ? (pick.site ? siteOf(pick.site)?.label ?? placeLabel(pick) : regionOf(pick.region)?.label ?? placeLabel(pick)) : placeLabel(pick);
  const anat = siteAnatomy(pick.site);
  const region = regionOf(pick.region);
  const left = both ? (pick.side === "L" ? pick : mirror!) : null;
  const right = both ? (pick.side === "R" ? pick : mirror!) : null;
  const prior = useMemo(
    () => (ctx ? followUpFor(ctx.entries, pick.region, pick.side ?? null, { today: ctx.today, feedbackId: ctx.feedbackId, site: pick.site }) : null),
    [ctx, pick.region, pick.side, pick.site],
  );
  const followChoice = pick.sameIssue === false ? "new" : pick.sameIssue ? pick.change ?? null : null;
  const timing = pick.timing ?? [];
  const training = timing.some((t) => t === "during" || t === "after" || t === "movement");
  const toggleFeel = (f: Feel) => onChange({ feel: (pick.feel ?? []).includes(f) ? (pick.feel ?? []).filter((x) => x !== f) : [...(pick.feel ?? []), f] });
  const toggleTiming = (t: Timing) => onChange({ timing: timing.includes(t) ? timing.filter((x) => x !== t) : [...timing, t] });
  const [noteOpen, setNoteOpen] = useState(!!pick.note?.trim());
  const [otherOpen, setOtherOpen] = useState(!!pick.exerciseName && !ctx?.exercises.some((x) => x.name === pick.exerciseName));
  const score = pickScore(pick);
  const safety = needsSafetyNotice([{ region: pick.region, side: pick.side ?? null, severity: pick.severity, score: pick.score, feel: pick.feel, trigger: pick.trigger, timing }]);
  const label = (s: string) => <p className="text-[13px] font-semibold text-muted-foreground">{s}</p>;

  return (
    <div
      ref={setPanel}
      className={cn(
        "inset-x-0 z-30 flex flex-col rounded-t-3xl border-t border-white/10 bg-background shadow-[0_-12px_40px_rgba(0,0,0,0.6)]",
        // typing: the details are the visible part of the screen, pinned to it (top and
        // height from the visual viewport, never the keyboard's height added to the
        // bottom: iOS also slides the page, and the two together jump a sheet past it)
        kb ? "fixed" : "absolute bottom-0",
      )}
      style={
        kb && vv
          ? { top: vv.top + 8, height: vv.height - 8 }
          : { height: `${DETAILS_SHARE * 100}%`, paddingBottom: "env(safe-area-inset-bottom)" }
      }
      onTouchStart={(e) => {
        pull.current = kb && (scroller.current?.scrollTop ?? 0) <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
      }}
      onTouchMove={(e) => {
        if (pull.current == null) return;
        if (e.touches[0].clientY - pull.current > 36) {
          pull.current = null;
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
      }}
      data-pain-keyboard={kb ? "up" : undefined}
      data-pain-details
      role="dialog"
      aria-label={`${name}: details`}
    >
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
      <div className="flex shrink-0 items-start gap-3 px-5 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-semibold leading-tight" data-pain-details-name>{name}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{[anat, region && pick.site ? region.label : null].filter(Boolean).join(" · ") || "The whole area"}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label={`Remove ${name}`}
          data-pain-remove
        >
          <Trash2 className="h-[18px] w-[18px]" />
        </button>
      </div>
      {sideChoice && (
        <div className="shrink-0 px-5 pb-2">
          <div className="grid grid-cols-3 rounded-lg bg-white/[0.07] p-0.5" role="radiogroup" aria-label="Which side" data-pain-side-control>
            {(["L", "R", "both"] as SideChoice[]).map((c) => {
              const on = sideChoice === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    if (on) return;
                    feedback("tap");
                    onSide(c);
                  }}
                  className={cn("h-10 rounded-md text-[14px] font-semibold transition-colors", on ? "bg-white/[0.16] text-foreground" : "text-muted-foreground")}
                  data-pain-side={c}
                >
                  {c === "L" ? "Left" : c === "R" ? "Right" : "Both"}
                </button>
              );
            })}
          </div>
          {undo && (
            <div className="mt-2 flex items-center justify-between gap-2 text-[13px] text-muted-foreground" data-pain-undo>
              <span>{undo.label}</span>
              <button type="button" onClick={undo.onUndo} className="inline-flex h-9 items-center rounded-full px-3 font-semibold text-foreground hover:bg-white/10">
                Undo
              </button>
            </div>
          )}
        </div>
      )}
      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-4 pt-1"
        onFocus={(e) => {
          const t = e.target as Element;
          if (!t.matches?.("input, textarea")) return;
          // after the keyboard has come up and the sheet has been pinned above it
          for (const ms of [0, 160, 380]) window.setTimeout(() => reveal(t), ms);
        }}
      >
        {both ? (
          <div className="space-y-4" data-pain-both-scores>
            {[left!, right!].map((p) => (
              <div key={p.uid} className="space-y-2">
                {label(`${p.side === "L" ? "Left" : "Right"}: how bad is it?`)}
                <ScoreScale
                  value={pickScore(p)}
                  onPick={(n) => (p.uid === pick.uid ? onChange(scorePatch(n)) : onMirrorScore(n))}
                  label={`${p.side === "L" ? "Left" : "Right"} ${name.toLowerCase()}: how bad, 0 to 10`}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {label("How bad is it?")}
            <ScoreScale value={score} onPick={(n) => onChange(scorePatch(n))} label={`${name}: how bad, 0 to 10`} />
          </div>
        )}

        {prior && (
          <div className="space-y-2" data-pain-followup>
            {label(`You flagged ${prior.site && prior.site !== pick.site ? `your ${(siteOf(prior.site)?.label ?? "").toLowerCase()} ` : "this "}${shortDay(prior.date)}${prior.score != null ? ` (${prior.score}/10)` : prior.severity ? ` (${prior.severity})` : ""}. Since then?`)}
            <div className="flex flex-wrap gap-2">
              {[...CHANGES, { v: "new" as const, label: "Something new" }].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={chip(followChoice === o.v)}
                  aria-pressed={followChoice === o.v}
                  onClick={() => {
                    feedback("tap");
                    onChange(answerFollowUp(pick, o.v, prior));
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {label("What does it feel like?")}
          <div className="flex flex-wrap gap-2">
            {[...FEEL_CHOICES, ...((pick.feel ?? []).includes("pinch") ? (["pinch"] as Feel[]) : [])].map((f) => {
              const on = (pick.feel ?? []).includes(f);
              return (
                <button key={f} type="button" className={chip(on)} aria-pressed={on} onClick={() => toggleFeel(f)} data-pain-feel={f}>
                  {FEELS.find((x) => x.v === f)?.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="text-[12px] text-muted-foreground">Also:</span>
            {FEEL_SIGNS.map((f) => {
              const on = (pick.feel ?? []).includes(f);
              return (
                <button key={f} type="button" className={cn(chip(on), "min-h-9 text-[13px]")} aria-pressed={on} onClick={() => toggleFeel(f)} data-pain-feel={f}>
                  {FEELS.find((x) => x.v === f)?.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          {label("When does it hurt?")}
          <div className="flex flex-wrap gap-2">
            {TIMINGS.map((t) => {
              const on = timing.includes(t.v);
              return (
                <button key={t.v} type="button" className={chip(on)} aria-pressed={on} onClick={() => toggleTiming(t.v)} data-pain-timing={t.v}>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {training && (
          <div className="space-y-2" data-pain-exercise>
            {label("Which exercise or movement?")}
            <div className="flex flex-wrap gap-2">
              {(ctx?.exercises ?? []).map((x) => {
                const on = pick.exerciseName === x.name;
                return (
                  <button
                    key={x.name}
                    type="button"
                    className={cn(chip(on), "text-[13px]")}
                    aria-pressed={on}
                    onClick={() => {
                      setOtherOpen(false);
                      onChange(on ? { exerciseName: null, exerciseId: null } : { exerciseName: x.name, exerciseId: x.id });
                    }}
                  >
                    {x.name}
                  </button>
                );
              })}
              <button
                type="button"
                className={cn(chip(otherOpen), "text-[13px]")}
                aria-pressed={otherOpen}
                onClick={() => {
                  setOtherOpen((o) => !o);
                  if (ctx?.exercises.some((x) => x.name === pick.exerciseName)) onChange({ exerciseName: null, exerciseId: null });
                }}
              >
                Something else
              </button>
            </div>
            {otherOpen && (
              <input
                value={pick.exerciseName ?? ""}
                onChange={(e) => onChange({ exerciseName: e.target.value.slice(0, 120), exerciseId: null })}
                placeholder="e.g. reaching overhead, getting up from a chair"
                aria-label="Which exercise or movement"
                {...noAutofill("pain-movement")}
                autoCapitalize="sentences"
                className="h-12 w-full rounded-lg border border-border bg-transparent px-3 text-base outline-none focus:border-foreground"
              />
            )}
          </div>
        )}

        {timing.includes("during") && (
          <div className="space-y-2">
            {label("Did it change your session?")}
            <div className="flex flex-wrap gap-2">
              {IMPACTS.map((o) => (
                <button key={o.v} type="button" className={chip(pick.impact === o.v)} aria-pressed={pick.impact === o.v} onClick={() => onChange({ impact: pick.impact === o.v ? null : o.v })}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {pick.region === "other" || noteOpen ? (
          <div className="space-y-2">
            {label(pick.region === "other" ? "Where does it hurt?" : "Anything else? (optional)")}
            <textarea
              value={pick.note ?? ""}
              onChange={(e) => onChange({ note: e.target.value.slice(0, NOTE_MAX) })}
              rows={2}
              placeholder={pick.region === "other" ? "Say where" : "e.g. only at the bottom of the lift, left side only"}
              aria-label={`${name}: note`}
              {...noAutofill("pain-note")}
              className="w-full resize-none rounded-lg border border-border bg-transparent px-3 py-2.5 text-base outline-none focus:border-foreground"
            />
          </div>
        ) : (
          <button type="button" onClick={() => setNoteOpen(true)} className="inline-flex h-10 items-center text-[14px] font-semibold text-muted-foreground hover:text-foreground" data-pain-add-note>
            + Add a note
          </button>
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
      </div>
      <div className={cn("shrink-0 border-t border-white/10 px-5 pt-3", kb ? "pb-2" : "pb-3")}>
        <button
          type="button"
          onClick={onDone}
          className="h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-50"
          data-pain-details-done
        >
          {score == null || (both && pickScore(mirror!) == null) ? "Done (rate it later)" : "Done"}
        </button>
      </div>
    </div>
  );
}

// ── the list ────────────────────────────────────────────────────────────

function PlaceSearch({ onPick }: { onPick: (place: { region: string; side: PainSide | null; site: string | null }) => void }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => searchSites(q), [q]);
  const byRegion = useMemo(() => {
    if (q.trim()) return null;
    return PAIN_REGIONS.filter((r) => r.key !== "other").map((r) => ({ region: r, sites: PAIN_SITES.filter((s) => s.region === r.key) }));
  }, [q]);
  const sideButtons = (label: string, region: string, site: string | null, sided: boolean, anat?: string | null) =>
    sided ? (
      <span className="flex shrink-0 gap-1.5">
        {(["L", "R"] as PainSide[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick({ region, side: s, site })}
            className="inline-flex h-10 min-w-[3.25rem] items-center justify-center rounded-lg bg-muted px-2 text-[13px] font-semibold hover:bg-muted-foreground/25"
            aria-label={`${s === "L" ? "Left" : "Right"} ${label.toLowerCase()}${anat ? `, ${anat}` : ""}`}
          >
            {s === "L" ? "Left" : "Right"}
          </button>
        ))}
      </span>
    ) : (
      <button type="button" onClick={() => onPick({ region, side: null, site })} className="inline-flex h-10 min-w-[4rem] items-center justify-center rounded-lg bg-muted px-3 text-[13px] font-semibold hover:bg-muted-foreground/25" aria-label={`Pick ${label.toLowerCase()}${anat ? `, ${anat}` : ""}`}>
        Pick
      </button>
    );
  const row = (s: (typeof PAIN_SITES)[number]) => (
    <div key={s.key} className="flex min-h-14 items-center gap-3 border-b border-white/[0.06] py-2" data-pain-list-site={s.key}>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-tight">{s.label}</p>
        {s.anat && <p className="truncate text-[12px] text-muted-foreground">{s.anat}{q.trim() ? ` · ${regionOf(s.region)?.label}` : ""}</p>}
      </div>
      {sideButtons(s.label, s.region, s.key, !s.midline, s.anat)}
    </div>
  );
  return (
    <div className="flex h-full flex-col" data-pain-list>
      <div className="px-4 pb-2 pt-1">
        <label className="flex h-11 items-center gap-2 rounded-lg bg-white/[0.07] px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search: knee, lats, rotator cuff…"
            aria-label="Search the body"
            {...noAutofill("pain-search")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear the search" className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {byRegion
          ? byRegion.map(({ region: r, sites }) => (
              <section key={r.key} className="pt-3">
                <div className="flex min-h-12 items-center gap-3 border-b border-white/[0.06] pb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</p>
                    <p className="text-[12px] text-muted-foreground/80">Not sure exactly? Pick the whole area</p>
                  </div>
                  {sideButtons(r.label, r.key, null, r.sided || !!r.lateral)}
                </div>
                {sites.map(row)}
              </section>
            ))
          : results.length
            ? results.map(row)
            : (
              <div className="space-y-3 py-8 text-center text-[14px] text-muted-foreground">
                <p>Nothing called that. Try another word, or pick the closest area.</p>
                <button type="button" onClick={() => onPick({ region: "other", side: null, site: null })} className="inline-flex h-10 items-center rounded-lg bg-muted px-4 font-semibold text-foreground">
                  Somewhere else: describe it
                </button>
              </div>
            )}
      </div>
    </div>
  );
}

// ── describe it ─────────────────────────────────────────────────────────

/** Five bars that move with their voice, so they can see it's hearing them. */
/**
 * Type or say what hurts. The app's own reader goes first (instant, free);
 * only when it can't place anything does the server read it. Every place comes
 * back as a row to confirm or change before anything is added.
 */
function DescribePanel({ ctx, onApply }: { ctx: PainMapContext | null; onApply: (places: DescribedPlace[]) => void }) {
  const [text, setText] = useState("");
  // what's in the box now, for a recording that finishes after they typed more
  const textRef = useRef("");
  textRef.current = text;
  const [result, setResult] = useState<DescribeResult | null>(null);
  const [choices, setChoices] = useState<Record<string, SideChoice>>({});
  // rows they took off the confirm list
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const readFn = useServerFn(readPainDescriptionFn);
  const hearFn = useServerFn(transcribePainVoiceFn);
  const read = async (words: string) => {
    const t = words.trim();
    if (t.length < 3) return;
    setNote(null);
    setChoices({});
    setDropped(new Set());
    const local = describePain(t, { exercises: ctx?.exercises ?? [] });
    if (local.places.length || local.unclear.length) {
      setResult(local);
      return;
    }
    setReading(true);
    try {
      const r = await readFn({ data: { text: t.slice(0, 600), exercises: (ctx?.exercises ?? []).slice(0, 40) } });
      if (r.ok && (r.places.length || r.unclear.length)) setResult({ places: r.places, unclear: r.unclear });
      else {
        setResult({ places: [], unclear: [] });
        setNote(r.ok ? "Couldn't place that. Name the body part (knee, low back, left shoulder), or tap it on the body." : r.reason === "busy" ? "Too many tries right now. Tap it on the body instead." : "Couldn't read that right now. Tap it on the body instead.");
      }
    } catch {
      setResult({ places: [], unclear: [] });
      setNote("Couldn't read that right now. Tap it on the body instead.");
    } finally {
      setReading(false);
    }
  };

  // Say it: the app's one dictation (a take that couldn't be turned into words is
  // kept in memory for Try again, never stored); the words join what's typed and are read.
  const voice = useVoiceDictation({
    maxMs: 60_000,
    transcribe: async (audio, mime) => {
      const r = await hearFn({ data: { audio, mime } });
      return r.ok ? { ok: true, text: r.text ?? "" } : { ok: false, reason: r.reason };
    },
    onText: (said) => {
      const typed = textRef.current.trim();
      const next = (typed ? `${typed} ${said}` : said).slice(0, 600);
      setText(next);
      void read(next);
    },
  });
  // speech goes to OpenAI or Google: someone who hasn't allowed that is asked in place first
  const aiConsent = useMyAiConsent();
  const [askVoice, setAskVoice] = useState(false);
  const canMic = voice.supported;
  const recording = voice.state === "recording";
  const hearing = voice.state === "requesting" || voice.state === "processing" || voice.state === "transcribing";

  const groups = useMemo(() => (result ? describedGroups(result.places).filter((g) => !dropped.has(g.key)) : []), [result, dropped]);
  const finalPlaces = useMemo(
    () => groups.flatMap((g) => (choices[g.key] ? chooseSide(g, choices[g.key]) : g.places)),
    [groups, choices],
  );
  const addUnclear = (region: string) => {
    feedback("tap");
    setResult((r) => {
      if (!r) return r;
      const place: DescribedPlace = { region, site: null, side: null, score: null, feel: [], timing: [], exerciseName: null, exerciseId: null, impact: null, change: null, note: text.trim().slice(0, 300), needs: ["score"] };
      if (regionOf(region)?.sided) place.needs.push("side");
      return { places: [...r.places, place], unclear: r.unclear.filter((u) => !u.options.includes(region)) };
    });
  };
  const busy = reading || hearing;

  return (
    <div className="flex h-full flex-col" data-pain-describe>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 pt-1">
        <div className="space-y-2">
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value.slice(0, 600));
                if (result) setResult(null);
              }}
              rows={4}
              placeholder="e.g. both knees bother me on squats, the left is about a 5. my right shoulder pinches on bench"
              aria-label="Describe where it hurts"
              {...noAutofill("pain-describe")}
              autoCapitalize="sentences"
              className="w-full resize-none rounded-xl border border-white/15 bg-white/[0.04] px-3 py-3 pr-14 text-base leading-snug outline-none placeholder:text-muted-foreground/80 focus:border-white/40"
              data-pain-describe-text
            />
            {canMic && (
              <VoiceMicButton
                state={voice.state}
                onClick={() => (aiConsent.needsYes && !recording ? setAskVoice((a) => !a) : voice.toggle())}
                disabled={reading}
                label="Say it instead"
                className={cn("absolute bottom-2.5 right-2.5 h-10 w-10", !recording && "bg-white/[0.1] hover:bg-white/[0.16]")}
              />
            )}
          </div>
          <VoiceStatusLine
            voice={voice}
            className="text-[13px]"
            idle={<p className="text-[12px] text-muted-foreground">Say where, which side, how bad out of 10 and what it hurt on. Recordings are turned into words and never kept.</p>}
          />
          {askVoice && aiConsent.needsYes && (
            <AiConsentInline use="turns what you say into words" via="OpenAI (or Google if OpenAI can't)" onAllowed={() => setAskVoice(false)} onDismiss={() => setAskVoice(false)} />
          )}
          {!result && (
            <button
              type="button"
              onClick={() => read(text)}
              disabled={busy || text.trim().length < 3}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-white/[0.1] text-[15px] font-semibold disabled:opacity-40"
              data-pain-describe-read
            >
              {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {reading ? "Reading it…" : "Show me what you got"}
            </button>
          )}
        </div>

        {result && (
          <div className="space-y-2" data-pain-describe-result>
            {groups.length > 0 && <p className="text-[13px] font-semibold text-muted-foreground">Check these. Change anything that's off.</p>}
            {groups.map((g) => {
              const choice = choices[g.key] ?? g.choice;
              const places = choices[g.key] ? chooseSide(g, choices[g.key]) : g.places;
              const name = g.site ? siteOf(g.site)?.label ?? "" : regionOf(g.region)?.label ?? g.region;
              const scores = places.map((p) => (p.score != null ? `${p.side ? `${p.side === "L" ? "Left" : "Right"} ` : ""}${p.score}/10` : null)).filter(Boolean).join(" · ");
              const rest = places[0] ? describedLine({ ...places[0], score: null }) : "";
              return (
                <div key={g.key} className="space-y-2 rounded-xl border border-white/10 p-3" data-pain-describe-row={g.key}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 text-[15px] font-semibold">{name}</p>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className={cn("text-[13px] font-semibold tabular-nums", scores ? "text-foreground" : "text-warning")}>{scores || "rate it next"}</span>
                      <button
                        type="button"
                        onClick={() => {
                          feedback("tap");
                          setDropped((d) => new Set([...d, g.key]));
                        }}
                        className="-mr-1.5 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10"
                        aria-label={`Not ${name.toLowerCase()}`}
                        data-pain-describe-drop
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                  {(rest || places[0]?.feel.length) && (
                    <p className="text-[12px] text-muted-foreground">
                      {[places[0]?.feel.map((f) => FEELS.find((x) => x.v === f)?.label.toLowerCase()).filter(Boolean).join(", "), rest].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {g.sided && (
                    <div className={cn("grid grid-cols-3 rounded-lg p-0.5", choice ? "bg-white/[0.07]" : "bg-warning/15 ring-1 ring-warning/50")} role="radiogroup" aria-label={`${name}: which side`}>
                      {(["L", "R", "both"] as SideChoice[]).map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={choice === c}
                          onClick={() => {
                            feedback("tap");
                            setChoices((x) => ({ ...x, [g.key]: c }));
                          }}
                          className={cn("h-9 rounded-md text-[13px] font-semibold", choice === c ? "bg-white/[0.16] text-foreground" : "text-muted-foreground")}
                        >
                          {c === "L" ? "Left" : c === "R" ? "Right" : "Both"}
                        </button>
                      ))}
                    </div>
                  )}
                  {g.sided && !choice && <p className="text-[12px] font-medium text-warning">Which side?</p>}
                </div>
              );
            })}
            {result.unclear.map((u) => (
              <div key={u.word} className="space-y-2 rounded-xl border border-warning/50 p-3" data-pain-describe-unclear={u.word}>
                <p className="text-[14px] font-semibold">Which part of your {u.word}?</p>
                <div className="flex flex-wrap gap-2">
                  {u.options.map((r) => (
                    <button key={r} type="button" onClick={() => addUnclear(r)} className={chip(false)}>
                      {regionOf(r)?.label ?? r}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
            <button type="button" onClick={() => setResult(null)} className="inline-flex h-10 items-center gap-1.5 text-[14px] font-semibold text-muted-foreground hover:text-foreground">
              <PenLine className="h-4 w-4" aria-hidden /> Change what I wrote
            </button>
          </div>
        )}
      </div>
      {result && finalPlaces.length > 0 && (
        <div className="shrink-0 border-t border-white/10 px-4 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button
            type="button"
            disabled={groups.some((g) => g.sided && !(choices[g.key] ?? g.choice))}
            onClick={() => onApply(finalPlaces)}
            className="h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-50"
            data-pain-describe-add
          >
            Add {finalPlaces.length === 1 ? "this" : `these ${finalPlaces.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── the map ─────────────────────────────────────────────────────────────

type Gesture = {
  pointers: Map<number, { x: number; y: number }>;
  start: { x: number; y: number; t: number } | null;
  moved: boolean;
  pinched: boolean;
  /** The first finger landed on a label or a tool: a still tap is that button's, not the drawing's. */
  onButton: boolean;
  xf0: Xf;
  dist0: number;
  mid0: { x: number; y: number };
};

/** How much of the stage the "In view" list takes while zoomed in (the map frames the area above it). */
const PANEL_SHARE = 0.36;
/** The notch, or the notch and iOS's blur band where it's added (styles.css --app-safe-top); never less than the notch. */
const SAFE_TOP = "max(env(safe-area-inset-top, 0px), var(--app-safe-top, 0px))";
const PANEL_MIN = 168;
/** Structures listed (and numbered on the drawing) at most. */
const IN_VIEW_MAX = 10;

export function PainMap({
  open,
  onOpenChange,
  picks,
  onChange,
  ctx,
  editUid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  picks: PainPick[];
  onChange: (next: PainPick[]) => void;
  ctx: PainMapContext | null;
  /** Open on this place's details (editing it from the review). */
  editUid?: string | null;
}) {
  const [viewKey, setViewKey] = useState<ViewKey>("front");
  const [facing, setFacing] = useState<SideFacing>("R");
  const [deep, setDeep] = useState(false);
  const [mode, setMode] = useState<"map" | "list" | "describe">("map");
  // what was just taken off, while it can be put back
  const [undo, setUndo] = useState<{ label: string; before: PainPick[]; at: number } | null>(null);
  const [xf, setXf] = useState<Xf>(IDENTITY);
  const [animate, setAnimate] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const [focus, setFocus] = useState<{ region: string; side: PainSide | null } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [size, setSize] = useState<Size>({ w: 375, h: 560 });
  // the stage is in a portal that mounts after the dialog opens: its size is
  // read when the element itself arrives, never only on open
  const stage = useRef<HTMLDivElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    stage.current = el;
    setStageEl(el);
  }, []);
  const g = useRef<Gesture>({ pointers: new Map(), start: null, moved: false, pinched: false, onButton: false, xf0: IDENTITY, dist0: 1, mid0: { x: 0, y: 0 } });
  const latest = useRef({ xf, picks });
  latest.current = { xf, picks };

  const view = atlasView(viewKey, facing);
  const fit = useMemo(() => fitView(size), [size]);
  const sheetH = active ? Math.round(size.h * DETAILS_SHARE) : 0;
  // zoomed in on an area (tapped, or pinched in): the spots there are listed under the drawing
  const detail = xf.s >= DETAIL_SCALE || !!focus;
  const panelH = !active && detail && mode === "map" ? Math.max(PANEL_MIN, Math.round(size.h * PANEL_SHARE)) : 0;
  const vis = useMemo(() => ({ top: 0, bottom: sheetH || panelH }), [sheetH, panelH]);

  const picked = useMemo(() => new Set(picks.filter((p) => p.site).map((p) => placeKey(p.site!, siteOf(p.site)?.midline ? null : p.side ?? null))), [picks]);
  const pickedAreas = useMemo(() => new Set(picks.filter((p) => !p.site && p.region !== "other").map((p) => `${p.region}:${p.side ?? "-"}`)), [picks]);
  const recent = useMemo(() => (ctx ? recentSites(ctx.entries, ctx.feedbackId) : new Set<string>()), [ctx]);

  useLayoutEffect(() => {
    const el = stageEl;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageEl]);

  // A pinch anywhere on the map is the map's (the stage zooms the body), never the
  // page's: iOS would zoom the whole app under the dialog. Two fingers on the
  // header, the details or the list do nothing.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = contentEl;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    const twoFingers = (e: TouchEvent) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    };
    el.addEventListener("gesturestart", stop);
    el.addEventListener("gesturechange", stop);
    el.addEventListener("touchmove", twoFingers, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", stop);
      el.removeEventListener("gesturechange", stop);
      el.removeEventListener("touchmove", twoFingers);
    };
  }, [contentEl]);

  // the keyboard: the dialog is the visible part of the screen while it's up
  const vv = useVisualViewportBox(open);
  const kb = !!vv?.keyboard;
  const fontFamily = useRef<string | null>(null);

  const go = useCallback((next: Xf, anim = true) => {
    setAnimate(anim);
    setXf(next);
  }, []);

  const reset = useCallback(() => {
    setFocus(null);
    setDeep(false);
    go(IDENTITY);
  }, [go]);

  // each open starts on the whole body, or on the place being edited
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setMode("map");
      setUndo(null);
      // the review's "removed · Undo" would sit on top of the map
      toast.dismiss();
      setPressed(null);
      const p = editUid ? latest.current.picks.find((x) => x.uid === editUid) : null;
      if (p && p.region !== "other") {
        const where = viewForPlace(p.site, p.region, p.side ?? null);
        setViewKey(where.view);
        setFacing(where.facing);
        setDeep(!!siteOf(p.site)?.deep);
        setFocus({ region: p.region, side: siteOf(p.site)?.midline ? null : p.side ?? null });
        setActive(p.uid);
        setXf(IDENTITY);
        setAnimate(false);
      } else {
        setActive(p?.uid ?? null);
        setFocus(null);
        setDeep(false);
        setXf(IDENTITY);
        setAnimate(false);
      }
    }
    wasOpen.current = open;
  }, [open, editUid]);

  // frame the focused area (after a view switch, a layer switch or the stage settling)
  const framedFor = useRef<string>("");
  useEffect(() => {
    if (!open || !focus) {
      framedFor.current = "";
      return;
    }
    const key = `${viewKey}:${facing}:${focus.region}:${focus.side}:${deep}:${size.w}x${size.h}:${!!active}:${vis.bottom}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    const box = regionBox(view, focus.region, focus.side, { deep, pad: 16 });
    if (!box) return;
    const p = active ? latest.current.picks.find((x) => x.uid === active) : null;
    const part = p ? partForPlace(view, p.site, p.region, p.side ?? null) : null;
    const framed = frameBox(box, size, fit, vis, 0.86);
    go(part ? centerOn(part.center, framed, size, fit, vis) : framed);
  }, [open, focus, viewKey, facing, deep, size, fit, vis, view, active, go]);

  const focusRegion = (region: string, side: PainSide | null) => {
    const r = regionOf(region);
    const s = r && (r.sided || r.lateral) ? side : null;
    feedback("tap");
    setFocus({ region, side: r?.sided ? s : side });
  };

  const openPlace = (place: { region: string; side: PainSide | null; site: string | null }, part?: AtlasPart | null) => {
    const res = addPick(latest.current.picks, place);
    if (res.picks !== latest.current.picks) onChange(res.picks);
    feedback("tap");
    setActive(res.uid);
    if (part) {
      const nextVis = { top: 0, bottom: Math.round(size.h * DETAILS_SHARE) };
      go(centerOn(part.center, latest.current.xf.s < DETAIL_SCALE ? { ...latest.current.xf, s: Math.max(DETAIL_SCALE, latest.current.xf.s) } : latest.current.xf, size, fit, nextVis));
    }
  };

  const layer = useMemo(() => view.parts.filter((p) => (deep ? p.deep : !p.deep)), [view, deep]);

  const tap = (sx: number, sy: number) => {
    const pt = toDrawing(sx, sy, fit, xf);
    const reach = 14 / (fit.k * xf.s);
    const hit = partAt(layer, pt, reach);
    if (!hit?.site || !hit.region) return;
    if (!detail) {
      focusRegion(hit.region, hit.side);
      return;
    }
    openPlace({ region: hit.region, side: hit.side, site: hit.site }, hit);
  };

  // gestures: one finger pans (zoomed in), two pinch, a still tap picks
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    const p = local(e);
    // a finger on a label or a tool still counts toward a pinch or a pan, but
    // isn't captured, so lifting it still clicks that button
    const onButton = !!(e.target as Element | null)?.closest?.("button");
    if (!onButton) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    s.pointers.set(e.pointerId, p);
    if (s.pointers.size === 1) {
      s.start = { ...p, t: performance.now() };
      s.moved = false;
      s.pinched = false;
      s.onButton = onButton;
      s.xf0 = latest.current.xf;
      // a quick lighten on what's under the finger
      const hit = onButton ? null : partAt(layer, toDrawing(p.x, p.y, fit, latest.current.xf), 10 / (fit.k * latest.current.xf.s));
      setPressed(hit?.id ?? null);
    } else if (s.pointers.size === 2) {
      const [a, b] = [...s.pointers.values()];
      s.pinched = true;
      s.dist0 = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      s.mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      s.xf0 = latest.current.xf;
      setPressed(null);
      setGesturing(true);
    }
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s.pointers.has(e.pointerId)) return;
    const p = local(e);
    s.pointers.set(e.pointerId, p);
    if (s.pointers.size >= 2) {
      const [a, b] = [...s.pointers.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = s.xf0.s * (dist / s.dist0);
      const z = zoomAt(s.xf0, scale, [s.mid0.x, s.mid0.y]);
      go(clampXf({ ...z, tx: z.tx + (mid.x - s.mid0.x), ty: z.ty + (mid.y - s.mid0.y) }, size, fit, vis), false);
      return;
    }
    if (!s.start) return;
    const dx = p.x - s.start.x;
    const dy = p.y - s.start.y;
    if (!s.moved && Math.hypot(dx, dy) > 8) {
      s.moved = true;
      setPressed(null);
      if (s.xf0.s > 1.01) setGesturing(true);
    }
    if (s.moved && s.xf0.s > 1.01) go(clampXf({ s: s.xf0.s, tx: s.xf0.tx + dx, ty: s.xf0.ty + dy }, size, fit, vis), false);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    const p = local(e);
    const wasTap = s.pointers.size === 1 && !s.pinched && !s.moved && !!s.start && performance.now() - s.start.t < 600;
    s.pointers.delete(e.pointerId);
    if (s.pointers.size === 0) {
      setGesturing(false);
      setPressed(null);
      s.start = null;
      if (s.pinched && latest.current.xf.s < 1.05) reset();
      if (wasTap && !s.onButton) tap(p.x, p.y);
    } else if (s.pointers.size === 1) {
      // one finger left after a pinch: carry on panning from here
      const [rest] = [...s.pointers.values()];
      s.start = { ...rest, t: 0 };
      s.moved = true;
      s.xf0 = latest.current.xf;
    }
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const p = local(e);
    go(clampXf(zoomAt(xf, xf.s * Math.exp(-e.deltaY * 0.0018), [p.x, p.y]), size, fit, vis), false);
  };

  // what's in view, zoomed in: numbered on the drawing, named in the list under it
  const inView = useMemo(() => {
    if (!detail || mode !== "map") return [];
    const seen = new Map<string, AtlasPart>();
    for (const p of layer) {
      if (!p.site) continue;
      const k = placeKey(p.site, p.side);
      const prev = seen.get(k);
      if (!prev || p.box.w * p.box.h > prev.box.w * prev.box.h) seen.set(k, p);
    }
    const visibleH = size.h - (sheetH || panelH);
    const anchors: { part: AtlasPart; sx: number; sy: number; rank: number }[] = [];
    for (const p of seen.values()) {
      const [sx, sy] = toScreen(p.center, fit, xf);
      if (sx < 10 || sx > size.w - 10 || sy < 10 || sy > visibleH - 10) continue;
      const inFocus = !!focus && p.region === focus.region && (focus.side == null || p.side == null || p.side === focus.side);
      const d = Math.hypot(sx - size.w / 2, sy - visibleH / 2);
      anchors.push({ part: p, sx, sy, rank: (inFocus ? 0 : 10_000) + d });
    }
    anchors.sort((a, b) => a.rank - b.rank);
    const keep = anchors.slice(0, IN_VIEW_MAX);
    // both sides of one structure in view: each says which
    const count = new Map<string, number>();
    for (const a of keep) count.set(a.part.site!, (count.get(a.part.site!) ?? 0) + 1);
    return keep.map((a, i) => ({ ...a, n: i + 1, sideTag: (count.get(a.part.site!) ?? 0) > 1 ? a.part.side : null }));
  }, [detail, mode, layer, size, sheetH, panelH, fit, xf, focus]);

  const activePick = active ? picks.find((p) => p.uid === active) ?? null : null;
  const focusLabel = focus ? areaLabel(focus.region, focus.side) : null;
  const deepHere = focus ? hasDeep(view, focus.region) : false;
  const focusRegionDef = focus ? regionOf(focus.region) : null;

  const close = () => {
    setActive(null);
    onOpenChange(false);
  };
  const back = () => {
    if (active) return setActive(null);
    if (mode !== "map") return setMode("map");
    if (focus || xf.s > 1.01) return reset();
    close();
  };
  const switchView = (v: ViewKey, f: SideFacing) => {
    if (v === viewKey && (v !== "side" || f === facing)) return;
    feedback("tap");
    setViewKey(v);
    setFacing(f);
    setDeep(false);
    // stay on the same area when the new view has it (on a side view, that side of it)
    if (focus) {
      const side = v === "side" && focus.side ? f : focus.side;
      const nv = atlasView(v, f);
      if (!regionBox(nv, focus.region, side)) {
        setFocus(null);
        go(IDENTITY, false);
      } else if (side !== focus.side) setFocus({ ...focus, side });
    } else go(IDENTITY, false);
  };
  const otherSide = () => {
    if (!focus?.side) return;
    feedback("tap");
    const next: PainSide = focus.side === "L" ? "R" : "L";
    if (viewKey === "side") setFacing(next);
    setFocus({ region: focus.region, side: next });
  };
  // Undo goes away by itself after a few seconds
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo((u) => (u && u.at === undo.at ? null : u)), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);
  const offerUndo = (label: string, before: PainPick[]) => setUndo({ label, before, at: Date.now() });
  const takeBack = () => {
    if (!undo) return;
    feedback("tap");
    onChange(undo.before);
    setUndo(null);
  };
  const remove = (uid: string) => {
    feedback("tap");
    const before = latest.current.picks;
    const p = before.find((x) => x.uid === uid);
    const mirror = p ? mirrorOf(before, p) : null;
    // both sides open together come off together
    onChange(before.filter((x) => x.uid !== uid && x.uid !== mirror?.uid));
    if (p) offerUndo(`${mirror ? (siteOf(p.site)?.label ?? regionOf(p.region)?.label ?? placeLabel(p)) + " (both sides)" : placeLabel(p)} removed`, before);
    setActive(null);
  };
  const chooseSideFor = (uid: string, choice: SideChoice) => {
    const before = latest.current.picks;
    const res = setSideChoice(before, uid, choice);
    onChange(res.picks);
    if (res.removed) offerUndo(`${res.removed.side === "L" ? "Left" : "Right"} side removed`, before);
    else setUndo(null);
    if (res.uid !== uid) setActive(res.uid);
  };
  const applyDescription = (places: DescribedPlace[]) => {
    const prior = ctx ? (pl: { region: string; side: PainSide | null; site: string | null }) => followUpFor(ctx.entries, pl.region, pl.side, { today: ctx.today, feedbackId: ctx.feedbackId, site: pl.site }) : undefined;
    const res = applyDescribed(latest.current.picks, places, prior);
    onChange(res.picks);
    feedback("tap");
    setMode("map");
    // the one question that's left: how bad, for the first place without a number
    const first = res.picks.find((p) => res.uids.includes(p.uid) && unrated(p)) ?? null;
    if (first && first.region !== "other") {
      const where = viewForPlace(first.site, first.region, first.side ?? null);
      setViewKey(where.view);
      setFacing(where.facing);
      setDeep(!!siteOf(first.site)?.deep);
      setFocus({ region: first.region, side: siteOf(first.site)?.midline ? null : first.side ?? null });
      setActive(first.uid);
    } else {
      setFocus(null);
      go(IDENTITY, false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        {/* Radix puts the scroll lock on the overlay. Without one the review sheet
            underneath stays the active lock and cancels every swipe on the map
            (the details, the list and the tray couldn't scroll). */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[#0b0b0d]" />
        <DialogPrimitive.Content
          ref={setContentEl}
          className="dark fixed inset-x-0 z-[90] flex flex-col bg-[#0b0b0d] text-foreground outline-none"
          // typing in the list's search: the dialog ends at the keyboard, so the whole list scrolls into view
          // below the notch and, on a home-screen app added before Nov 13 2026, below the band iOS blurs (--app-safe-top)
          style={kb && vv ? { top: vv.top, height: vv.height, paddingTop: SAFE_TOP } : { top: 0, bottom: 0, paddingTop: SAFE_TOP }}
          data-pain-keyboard={kb ? "up" : undefined}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            back();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          aria-describedby={undefined}
          data-pain-map
          data-pain-view={viewKey}
          data-pain-zoomed={detail ? "" : undefined}
        >
          <DialogPrimitive.Title className="sr-only">Where does it hurt?</DialogPrimitive.Title>
          {/* top bar */}
          <div className="flex h-14 shrink-0 items-center gap-1 px-2">
            <button type="button" onClick={back} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label={active ? "Back to the body" : focus || xf.s > 1.01 ? "Whole body" : "Back to your review"} data-pain-back>
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-[17px] font-semibold leading-tight" data-pain-title>{mode === "list" ? "Find it by name" : mode === "describe" ? "Describe it" : focusLabel ?? "Where does it hurt?"}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {mode === "list" ? "Plain names, with the anatomy beside them" : mode === "describe" ? "Type it or say it, then check it" : detail ? "Tap the exact spot, or pick it below" : "Tap the area to zoom in"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMode(mode === "map" ? "list" : "map")}
              className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10", mode === "list" && "bg-white/10")}
              aria-label={mode !== "map" ? "Back to the body map" : "Find it by name"}
              aria-pressed={mode === "list"}
              data-pain-list-toggle
            >
              {mode !== "map" ? <X className="h-5 w-5" /> : <List className="h-5 w-5" />}
            </button>
          </div>

          {mode === "map" && (
            <div className="flex shrink-0 justify-center px-4 pb-2">
              <div className="grid w-full max-w-sm grid-cols-4 rounded-lg bg-white/[0.07] p-0.5" role="group" aria-label="View">
                {VIEWS.map((o) => {
                  const on = viewKey === o.v && (o.v !== "side" || facing === o.facing);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => switchView(o.v, o.facing)}
                      aria-pressed={on}
                      className={cn("h-10 whitespace-nowrap rounded-md px-1 text-[13px] font-semibold transition-colors", on ? "bg-white/[0.16] text-foreground" : "text-muted-foreground")}
                      data-pain-view-tab={o.key}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {mode === "describe" ? (
              <DescribePanel ctx={ctx} onApply={applyDescription} />
            ) : mode === "list" ? (
              <PlaceSearch
                onPick={(place) => {
                  const where = place.region === "other" ? null : viewForPlace(place.site, place.region, place.side);
                  if (where) {
                    setViewKey(where.view);
                    setFacing(where.facing);
                    setDeep(!!siteOf(place.site)?.deep);
                    setFocus({ region: place.region, side: siteOf(place.site)?.midline ? null : place.side });
                  }
                  const res = addPick(latest.current.picks, place);
                  if (res.picks !== latest.current.picks) onChange(res.picks);
                  feedback("tap");
                  setMode("map");
                  setActive(res.uid);
                }}
              />
            ) : (
              <div
                ref={stageRef}
                className="absolute inset-0 touch-none select-none overflow-hidden"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onWheel={onWheel}
                data-pain-stage
              >
                <div
                  className="absolute left-0 top-0 h-full w-full origin-top-left will-change-transform"
                  style={{
                    transform: `translate3d(${xf.tx}px, ${xf.ty}px, 0) scale(${xf.s})`,
                    transition: animate ? "transform 340ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
                  }}
                  onTransitionEnd={() => setAnimate(false)}
                >
                  <AnatomyFigure
                    view={view}
                    deep={deep}
                    picked={picked}
                    pickedAreas={pickedAreas}
                    recent={recent}
                    pressed={pressed}
                    detail={detail}
                    className="h-full w-full"
                  />
                </div>

                {/* which side is which */}
                {!detail && viewKey !== "side" && (
                  <div className="pointer-events-none absolute inset-x-0 top-[14%] flex justify-between px-5 text-[12px] font-semibold text-muted-foreground" aria-hidden>
                    <span>{viewKey === "front" ? "Right" : "Left"}</span>
                    <span>{viewKey === "front" ? "Left" : "Right"}</span>
                  </div>
                )}

                {/* what's in view, numbered (the list under the drawing names them) */}
                {inView.length > 0 && !animate && !gesturing && (
                  <div className="pointer-events-none absolute inset-0" aria-hidden data-pain-markers>
                    {inView.map((c) => {
                      const on = picked.has(placeKey(c.part.site!, c.part.side));
                      return (
                        <span
                          key={c.part.id}
                          className={cn(
                            "absolute flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums shadow-[0_1px_4px_rgba(0,0,0,0.6)]",
                            on ? "bg-primary text-primary-foreground" : pressed === c.part.id ? "bg-white text-black ring-2 ring-white/60" : "bg-white/90 text-black",
                          )}
                          style={{ left: c.sx - 10, top: c.sy - 10 }}
                          data-pain-marker={c.part.site!}
                        >
                          {c.n}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* the deeper layer, where this area has one */}
                {(deepHere || deep) && (
                  <div className="absolute right-3 top-2">
                    <button
                      type="button"
                      onClick={() => {
                        feedback("tap");
                        setDeep((d) => !d);
                      }}
                      aria-pressed={deep}
                      className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold", deep ? "bg-white text-black" : "bg-black/70 text-white ring-1 ring-white/15")}
                      data-pain-deep
                    >
                      <Layers className="h-3.5 w-3.5" aria-hidden /> {deep ? "Deeper" : "Show deeper"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* zoomed in: the spots in view, plain names first, the anatomy under them */}
            {panelH > 0 && (
              <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col border-t border-white/10 bg-[#0b0b0d]" style={{ height: panelH }} data-pain-in-view>
                <div className="flex shrink-0 items-center gap-2 px-4 pb-1.5 pt-3">
                  <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{focus ? "Where exactly?" : "In view"}</p>
                  {focus && focusRegionDef?.sided && (
                    <div className="grid grid-cols-2 rounded-lg bg-white/[0.07] p-0.5" role="radiogroup" aria-label="Which side" data-pain-focus-side>
                      {(["L", "R"] as PainSide[]).map((side) => {
                        const on = focus.side === side;
                        return (
                          <button
                            key={side}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => !on && otherSide()}
                            className={cn("h-8 rounded-md px-3 text-[13px] font-semibold", on ? "bg-white/[0.16] text-foreground" : "text-muted-foreground")}
                          >
                            {side === "L" ? "Left" : "Right"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2" aria-label="Spots in view">
                  {focus && (
                    <li>
                      <button
                        type="button"
                        onClick={() => openPlace({ region: focus.region, side: focus.side, site: null }, null)}
                        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-white/[0.06]"
                        data-pain-whole-area
                      >
                        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-white/30 text-[11px] font-bold text-muted-foreground" aria-hidden>
                          ·
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium leading-tight">The whole {(focusRegionDef?.label ?? "area").toLowerCase()}</span>
                          <span className="block text-[12px] leading-snug text-muted-foreground">Not sure exactly where</span>
                        </span>
                        {pickedAreas.has(`${focus.region}:${focus.side ?? "-"}`) && <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Picked" />}
                      </button>
                    </li>
                  )}
                  {inView.map((c) => {
                    const k = placeKey(c.part.site!, c.part.side);
                    const on = picked.has(k);
                    const s = siteOf(c.part.site);
                    const p = on ? picks.find((x) => x.site === c.part.site && (siteOf(x.site)?.midline || (x.side ?? null) === (c.part.side ?? null))) : null;
                    const sc = p ? pickScore(p) : null;
                    return (
                      <li key={c.part.id}>
                        <button
                          type="button"
                          onClick={() => openPlace({ region: c.part.region!, side: c.part.side, site: c.part.site }, c.part)}
                          onPointerDown={() => setPressed(c.part.id)}
                          onPointerUp={() => setPressed(null)}
                          onPointerLeave={() => setPressed(null)}
                          onPointerCancel={() => setPressed(null)}
                          className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06]"
                          aria-label={`${siteLabel(c.part.site!, c.part.side)}${s?.anat ? `, ${s.anat}` : ""}`}
                          aria-pressed={on}
                          data-pain-label={c.part.site!}
                        >
                          <span
                            className={cn(
                              "flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums",
                              on ? "bg-primary text-primary-foreground" : "bg-white/90 text-black",
                            )}
                            aria-hidden
                          >
                            {c.n}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-medium leading-tight">
                              {c.sideTag && <span className="mr-1 text-[12px] font-bold text-muted-foreground">{c.sideTag === "L" ? "Left" : "Right"}</span>}
                              {s?.label}
                            </span>
                            {s?.anat && <span className="block text-[12px] leading-snug text-muted-foreground">{s.anat}</span>}
                          </span>
                          {on && <span className="shrink-0 text-[13px] font-semibold tabular-nums text-muted-foreground">{sc != null ? `${sc}/10` : "rate it"}</span>}
                        </button>
                      </li>
                    );
                  })}
                  {!inView.length && !focus && <li className="px-2 py-3 text-[13px] text-muted-foreground">Move the body to see the spots here.</li>}
                </ul>
              </div>
            )}

            {activePick && (
              <PlaceDetails
                key={activePick.uid}
                pick={activePick}
                mirror={mirrorOf(picks, activePick)}
                sideChoice={sideChoiceOf(picks, activePick)}
                ctx={ctx}
                vv={vv}
                undo={undo && Date.now() - undo.at < 6000 ? { label: undo.label, onUndo: takeBack } : null}
                onChange={(patch) => onChange(updatePaired(latest.current.picks, activePick.uid, patch))}
                onMirrorScore={(n) => {
                  const m = mirrorOf(latest.current.picks, activePick);
                  if (m) onChange(updatePaired(latest.current.picks, m.uid, scorePatch(n)));
                }}
                onSide={(c) => chooseSideFor(activePick.uid, c)}
                onRemove={() => remove(activePick.uid)}
                onDone={() => setActive(null)}
              />
            )}
          </div>

          {/* what's picked, and the way back */}
          {!activePick && !kb && mode !== "describe" && (
            <div className="shrink-0 border-t border-white/10 bg-[#0b0b0d] px-4 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
              {undo && (
                <div className="mb-2 flex items-center justify-between gap-2 text-[13px] text-muted-foreground" data-pain-undo>
                  <span className="min-w-0 truncate">{undo.label}</span>
                  <button type="button" onClick={takeBack} className="inline-flex h-9 shrink-0 items-center rounded-full px-3 font-semibold text-foreground hover:bg-white/10">
                    Undo
                  </button>
                </div>
              )}
              {mode === "map" && !detail && (
                <button
                  type="button"
                  onClick={() => {
                    feedback("tap");
                    setMode("describe");
                  }}
                  className="mb-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/15 text-[14px] font-semibold text-foreground hover:bg-white/[0.06]"
                  data-pain-describe-open
                >
                  <Mic className="h-4 w-4" aria-hidden /> Type or say where it hurts
                </button>
              )}
              {picks.length > 0 && (
                <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-0.5" data-pain-tray>
                  {picks.map((p) => {
                    const sc = pickScore(p);
                    return (
                      <button
                        key={p.uid}
                        type="button"
                        onClick={() => {
                          feedback("tap");
                          if (p.region !== "other") {
                            const where = viewForPlace(p.site, p.region, p.side ?? null);
                            setViewKey(where.view);
                            setFacing(where.facing);
                            setDeep(!!siteOf(p.site)?.deep);
                            setFocus({ region: p.region, side: siteOf(p.site)?.midline ? null : p.side ?? null });
                          }
                          setMode("map");
                          setActive(p.uid);
                        }}
                        className={cn(
                          "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold",
                          unrated(p) ? "border-warning/60 text-foreground" : "border-white/15 text-foreground",
                        )}
                        data-pain-tray-item={p.site ?? p.region}
                      >
                        <span className="max-w-[11rem] truncate">{placeLabel(p)}</span>
                        <span className={cn("tabular-nums", unrated(p) ? "text-warning" : "text-muted-foreground")}>{sc != null ? `${sc}/10` : "rate it"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={close}
                className={cn(
                  "h-12 w-full rounded-lg text-[15px] font-semibold active:opacity-90",
                  picks.length ? "bg-primary text-primary-foreground" : "bg-white/[0.08] text-foreground",
                )}
                data-pain-map-done
              >
                {picks.length ? `Done · ${picks.length} ${picks.length === 1 ? "area" : "areas"}` : "Back to the review"}
              </button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
