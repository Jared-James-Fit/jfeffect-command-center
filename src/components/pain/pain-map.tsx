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
import { ChevronLeft, Layers, List, Search, X, AlertTriangle, ArrowLeftRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { noAutofill } from "@/lib/no-autofill";
import { AnatomyFigure, placeKey } from "@/components/pain/anatomy-figure";
import { atlasView, hasDeep, partAt, regionBox, type AtlasPart, type AtlasView, type SideFacing, type ViewKey } from "@/lib/pain/anatomy/atlas";
import { DETAIL_SCALE, IDENTITY, centerOn, clampXf, fitView, frameBox, layoutCallouts, toDrawing, toScreen, zoomAt, type Size, type Xf } from "@/lib/pain/anatomy/stage";
import { PAIN_REGIONS, areaLabel, regionOf, type PainSide } from "@/lib/pain/regions";
import { PAIN_SITES, searchSites, siteAnatomy, siteLabel, siteOf } from "@/lib/pain/sites";
import { CHANGES, FEELS, FEEL_CHOICES, FEEL_SIGNS, IMPACTS, NOTE_MAX, TIMINGS, placeLabel, scoreWord, type Feel, type Timing } from "@/lib/pain/report";
import { followUpFor, shortDay, type PainEntry } from "@/lib/pain/history";
import { addPick, answerFollowUp, pickScore, recentSites, scorePatch, unrated, updatePick, type PainPick } from "@/lib/pain/picks";
import { CLIENT_SAFETY_NOTICE, needsSafetyNotice, URGENT_SIGNS } from "@/lib/pain/safety";
import { useSwipeDownToClose } from "@/hooks/use-swipe-down-to-close";

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

/** A spot's best view to show it in: front, then back, then side (its side of the body). */
export function viewForPlace(site: string | null | undefined, region: string, side: PainSide | null): { view: ViewKey; facing: SideFacing } {
  for (const v of ["front", "back", "side"] as ViewKey[]) {
    for (const f of (v === "side" ? [side === "L" ? "L" : "R"] : ["R"]) as SideFacing[]) {
      const av = atlasView(v, f);
      const has = av.parts.some((p) => (site ? p.site === site : p.region === region) && (side == null || p.side == null || p.side === side));
      if (has) return { view: v, facing: f };
    }
  }
  return { view: "front", facing: "R" };
}

/** The part to frame for a place (its largest drawn part on that view). */
export function partForPlace(view: AtlasView, site: string | null | undefined, region: string, side: PainSide | null): AtlasPart | null {
  let best: AtlasPart | null = null;
  for (const p of view.parts) {
    if (site ? p.site !== site : p.region !== region) continue;
    if (side != null && p.side != null && p.side !== side) continue;
    if (!best || p.box.w * p.box.h > best.box.w * best.box.h) best = p;
  }
  return best;
}

const chip = (on: boolean) =>
  cn(
    "inline-flex min-h-10 items-center justify-center rounded-full border px-3.5 text-[14px] font-medium transition-colors active:scale-[0.97]",
    on ? "border-primary bg-primary/15 text-foreground" : "border-border bg-transparent text-foreground/90 hover:bg-muted",
  );

// ── 0–10 ────────────────────────────────────────────────────────────────

function ScoreScale({ value, onPick, label }: { value: number | null; onPick: (n: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  // a finger can slide along the scale: the number under it is picked as it moves
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
        className="grid touch-none grid-cols-11 gap-1 select-none"
        data-no-sheet-drag
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          set(at(e.clientX));
        }}
        onPointerMove={(e) => dragging.current && set(at(e.clientX))}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
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
              onClick={() => set(n)}
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

function PlaceDetails({
  pick,
  ctx,
  onChange,
  onRemove,
  onDone,
}: {
  pick: PainPick;
  ctx: PainMapContext | null;
  onChange: (patch: Partial<PainPick>) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  // one swipe down puts the details away (the place stays picked)
  useSwipeDownToClose(panel, true, onDone);
  const name = placeLabel(pick);
  const anat = siteAnatomy(pick.site);
  const region = regionOf(pick.region);
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
      className="absolute inset-x-0 bottom-0 z-30 flex max-h-[72%] flex-col rounded-t-3xl border-t border-white/10 bg-background shadow-[0_-12px_40px_rgba(0,0,0,0.6)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
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
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-4 pt-1">
        <div className="space-y-2">
          {label("How bad is it?")}
          <ScoreScale value={score} onPick={(n) => onChange(scorePatch(n))} label={`${name}: how bad, 0 to 10`} />
        </div>

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
            {FEEL_CHOICES.map((f) => {
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
      <div className="shrink-0 border-t border-white/10 px-5 pb-3 pt-3">
        <button
          type="button"
          onClick={onDone}
          className="h-12 w-full rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-50"
          data-pain-details-done
        >
          {score == null ? "Done (rate it later)" : "Done"}
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

const LABEL_H = 40;
const labelWidth = (w: number) => Math.min(148, Math.round(w * 0.36));
/** What framing keeps clear on each side for the labels (they may overlap the drawing's edge a little). */
const labelRoom = (w: number) => Math.round(labelWidth(w) * 0.72);

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
  const [mode, setMode] = useState<"map" | "list">("map");
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
  const sheetH = active ? Math.round(size.h * 0.62) : 0;
  const vis = useMemo(() => ({ top: 0, bottom: sheetH }), [sheetH]);
  const detail = xf.s >= DETAIL_SCALE;

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

  // iOS Safari's own page pinch would fight ours
  useEffect(() => {
    const el = stageEl;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", stop);
    el.addEventListener("gesturechange", stop);
    return () => {
      el.removeEventListener("gesturestart", stop);
      el.removeEventListener("gesturechange", stop);
    };
  }, [stageEl]);

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
    const key = `${viewKey}:${facing}:${focus.region}:${focus.side}:${deep}:${size.w}x${size.h}:${!!active}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    const box = regionBox(view, focus.region, focus.side, { deep, pad: 16 });
    if (!box) return;
    const p = active ? latest.current.picks.find((x) => x.uid === active) : null;
    const part = p ? partForPlace(view, p.site, p.region, p.side ?? null) : null;
    const framed = frameBox(box, size, fit, vis, 0.86, labelRoom(size.w));
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
      const nextVis = { top: 0, bottom: Math.round(size.h * 0.62) };
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

  // labels for what's in view, zoomed in
  const callouts = useMemo(() => {
    if (!detail || gesturing || mode !== "map") return [];
    const seen = new Map<string, AtlasPart>();
    for (const p of layer) {
      if (!p.site) continue;
      const k = placeKey(p.site, p.side);
      const prev = seen.get(k);
      if (!prev || p.box.w * p.box.h > prev.box.w * prev.box.h) seen.set(k, p);
    }
    const visibleH = size.h - sheetH;
    const anchors: (AtlasPart & { sx: number; sy: number; rank: number })[] = [];
    for (const p of seen.values()) {
      const [sx, sy] = toScreen(p.center, fit, xf);
      if (sx < 10 || sx > size.w - 10 || sy < 10 || sy > visibleH - 10) continue;
      const inFocus = !!focus && p.region === focus.region && (focus.side == null || p.side == null || p.side === focus.side);
      const d = Math.hypot(sx - size.w / 2, sy - visibleH / 2);
      anchors.push({ ...p, sx, sy, rank: (inFocus ? 0 : 10_000) + d });
    }
    anchors.sort((a, b) => a.rank - b.rank);
    const keep = anchors.slice(0, 8);
    const labelW = labelWidth(size.w);
    const placed = layoutCallouts(
      keep.map((a) => ({ id: a.id, x: a.sx, y: a.sy })),
      { w: size.w, h: visibleH },
      { labelW, labelH: LABEL_H, gap: 6, top: 52, bottom: 52 },
    );
    const byId = new Map(keep.map((a) => [a.id, a]));
    // both sides of one structure in view: each label says which
    const count = new Map<string, number>();
    for (const c of placed) count.set(byId.get(c.id)!.site!, (count.get(byId.get(c.id)!.site!) ?? 0) + 1);
    return placed.map((c) => {
      const part = byId.get(c.id)!;
      return { ...c, part, w: labelW, sideTag: (count.get(part.site!) ?? 0) > 1 ? part.side : null };
    });
  }, [detail, gesturing, mode, layer, size, sheetH, fit, xf, focus]);

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
    if (mode === "list") return setMode("map");
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
  const remove = (uid: string) => {
    feedback("tap");
    onChange(picks.filter((p) => p.uid !== uid));
    setActive(null);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="dark fixed inset-0 z-[90] flex flex-col bg-[#0b0b0d] text-foreground outline-none"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
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
              <p className="truncate text-[17px] font-semibold leading-tight" data-pain-title>{mode === "list" ? "Find it by name" : focusLabel ?? "Where does it hurt?"}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {mode === "list" ? "Plain names, with the anatomy beside them" : detail ? "Tap the exact spot, or a label" : "Tap the area to zoom in"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMode(mode === "list" ? "map" : "list")}
              className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10", mode === "list" && "bg-white/10")}
              aria-label={mode === "list" ? "Back to the body map" : "Find it by name"}
              aria-pressed={mode === "list"}
              data-pain-list-toggle
            >
              {mode === "list" ? <X className="h-5 w-5" /> : <List className="h-5 w-5" />}
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
            {mode === "list" ? (
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

                {/* labels with leader lines */}
                {callouts.length > 0 && !animate && (
                  <>
                    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                      {callouts.map((c) => {
                        const x1 = c.side === "l" ? c.x + c.w : c.x;
                        const y1 = c.y + LABEL_H / 2;
                        return (
                          <g key={c.id}>
                            <line x1={x1} y1={y1} x2={c.ax} y2={c.ay} stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
                            <circle cx={c.ax} cy={c.ay} r={3} fill="#fff" />
                          </g>
                        );
                      })}
                    </svg>
                    {callouts.map((c) => {
                      const k = placeKey(c.part.site!, c.part.side);
                      const on = picked.has(k);
                      const s = siteOf(c.part.site);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => openPlace({ region: c.part.region!, side: c.part.side, site: c.part.site }, c.part)}
                          className={cn(
                            "absolute flex flex-col justify-center rounded-lg border px-2.5 text-left leading-tight shadow-[0_4px_14px_rgba(0,0,0,0.45)] backdrop-blur-[2px] transition-colors",
                            on ? "border-primary bg-primary/90 text-white" : "border-white/20 bg-black/70 text-white active:bg-white/20",
                          )}
                          style={{ left: c.x, top: c.y, width: c.w, height: LABEL_H }}
                          aria-label={`${siteLabel(c.part.site!, c.part.side)}${s?.anat ? `, ${s.anat}` : ""}`}
                          aria-pressed={on}
                          data-pain-label={c.part.site!}
                        >
                          <span className="flex min-w-0 items-baseline gap-1">
                            {c.sideTag && <span className={cn("shrink-0 text-[11px] font-bold", on ? "text-white/85" : "text-white/60")}>{c.sideTag}</span>}
                            <span className="truncate text-[13px] font-semibold">{s?.label}</span>
                          </span>
                          {s?.anat && <span className={cn("truncate text-[11px]", on ? "text-white/85" : "text-white/60")}>{s.anat}</span>}
                        </button>
                      );
                    })}
                  </>
                )}

                {/* tools on the stage */}
                <div className="absolute inset-x-0 top-2 flex items-start justify-between gap-2 px-3">
                  <div className="flex gap-2">
                    {focus && focusRegionDef?.sided && (
                      <button
                        type="button"
                        onClick={otherSide}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3.5 text-[13px] font-semibold text-white backdrop-blur-[2px]"
                        data-pain-other-side
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden /> {focus.side === "L" ? "Right" : "Left"} side
                      </button>
                    )}
                  </div>
                  {(deepHere || deep) && (
                    <button
                      type="button"
                      onClick={() => {
                        feedback("tap");
                        setDeep((d) => !d);
                      }}
                      aria-pressed={deep}
                      className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold backdrop-blur-[2px]", deep ? "bg-white text-black" : "bg-black/60 text-white")}
                      data-pain-deep
                    >
                      <Layers className="h-3.5 w-3.5" aria-hidden /> {deep ? "Deeper" : "Show deeper"}
                    </button>
                  )}
                </div>

                {/* the whole area, when they can't say exactly */}
                {focus && !active && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
                    <button
                      type="button"
                      onClick={() => openPlace({ region: focus.region, side: focus.side, site: null }, null)}
                      className="pointer-events-auto inline-flex h-10 items-center rounded-full bg-black/70 px-4 text-[13px] font-semibold text-white ring-1 ring-white/15 backdrop-blur-[2px]"
                      data-pain-whole-area
                    >
                      Not sure exactly? Pick the whole {(focusRegionDef?.label ?? "area").toLowerCase()}
                    </button>
                  </div>
                )}
              </div>
            )}

            {activePick && (
              <PlaceDetails
                key={activePick.uid}
                pick={activePick}
                ctx={ctx}
                onChange={(patch) => onChange(updatePick(latest.current.picks, activePick.uid, patch))}
                onRemove={() => remove(activePick.uid)}
                onDone={() => setActive(null)}
              />
            )}
          </div>

          {/* what's picked, and the way back */}
          {!activePick && (
            <div className="shrink-0 border-t border-white/10 bg-[#0b0b0d] px-4 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
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
