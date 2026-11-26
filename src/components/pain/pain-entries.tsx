/**
 * The pain report's one review screen (Nov 26 2026): every place the athlete
 * reported, by voice, typing or the body map, as a compact row they can fix
 * in place. What's needed shows on the row itself, never behind a tap: which
 * side (a knee, an elbow), how bad 1–10 (or Unsure). Everything else they
 * said (how it feels, when, which lift) is a line under the name; a tap on
 * the row opens it to change, one row at a time.
 *
 * Shared by every way in (pain-reporter.tsx): one data shape (picks.ts), one
 * confirmation.
 */
import { useMemo, useState, type ReactNode } from "react";
import { MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { noAutofill } from "@/lib/no-autofill";
import { PlaceThumb } from "@/components/pain/place-thumb";
import { CHANGES, FEELS, FEEL_CHOICES, FEEL_SIGNS, HEAD_FEEL_CHOICES, HEAD_SIGNS, IMPACTS, NOTE_MAX, TIMINGS, placeLabel, type Feel, type Timing } from "@/lib/pain/report";
import { classShort, generalOf, symptomClass } from "@/lib/pain/symptoms";
import { followUpFor, shortDay, type PainEntry } from "@/lib/pain/history";
import { siteAnatomy, siteOf } from "@/lib/pain/sites";
import { regionOf } from "@/lib/pain/regions";
import {
  answerFollowUp,
  mirrorOf,
  needsRating,
  pickGaps,
  pickScore,
  pickSided,
  scorePatch,
  setSideChoice,
  sideChoiceOf,
  unsurePatch,
  updatePaired,
  type PainPick,
  type SideChoice,
} from "@/lib/pain/picks";

export type PainEntriesContext = {
  today: string;
  entries: PainEntry[];
  exercises: { id: string | null; name: string }[];
  feedbackId: string | null;
};

const chip = (on: boolean) =>
  cn(
    "inline-flex min-h-9 items-center justify-center rounded-full border px-3 text-[13px] font-medium transition-colors active:scale-[0.97]",
    on ? "border-foreground bg-foreground text-background" : "border-border text-foreground/90 hover:bg-muted",
  );

/** How bad, 1–10, or Unsure: one row, a tap each. */
export function ScorePicker({
  value,
  unsure,
  onScore,
  onUnsure,
  label,
}: {
  value: number | null;
  unsure: boolean;
  onScore: (n: number) => void;
  onUnsure: () => void;
  label: string;
}) {
  return (
    <div data-pain-score-picker>
      <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label={label}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${n} out of 10`}
              onClick={() => {
                feedback("detent");
                onScore(n);
              }}
              className={cn(
                "flex h-10 items-center justify-center rounded-md text-[15px] font-semibold tabular-nums transition-colors",
                on ? "bg-foreground text-background" : value != null && n < value ? "bg-foreground/15 text-foreground" : "bg-muted text-foreground/85",
              )}
              data-pain-score-n={n}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted-foreground">
        <span>1 mild · 10 worst</span>
        <button
          type="button"
          role="radio"
          aria-checked={unsure}
          onClick={() => {
            feedback("tap");
            onUnsure();
          }}
          className={cn("inline-flex h-8 items-center rounded-full px-3 text-[13px] font-semibold", unsure ? "bg-foreground text-background" : "text-foreground hover:bg-muted")}
          data-pain-unsure
        >
          Unsure
        </button>
      </div>
    </div>
  );
}

function SideControl({ value, onPick, hint, attention }: { value: SideChoice | null; onPick: (c: SideChoice) => void; hint?: string | null; attention?: boolean }) {
  return (
    <div>
      <div
        className={cn("grid grid-cols-3 rounded-lg p-0.5", attention ? "bg-warning/15 ring-1 ring-warning/50" : "bg-muted")}
        role="radiogroup"
        aria-label="Which side"
        data-pain-side-control
      >
        {(["L", "R", "both"] as SideChoice[]).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            onClick={() => {
              if (value === c) return;
              feedback("tap");
              onPick(c);
            }}
            className={cn("h-9 rounded-md text-[14px] font-semibold transition-colors", value === c ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
            data-pain-side={c}
          >
            {c === "L" ? "Left" : c === "R" ? "Right" : "Both"}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** "Sharp · During exercise · Competition Squat": what they said, in one line. */
export function entrySummary(p: PainPick): string {
  const feel = (p.feel ?? []).map((f) => FEELS.find((x) => x.v === f)?.label).filter(Boolean) as string[];
  const when = (p.timing ?? []).map((t) => TIMINGS.find((x) => x.v === t)?.label).filter(Boolean) as string[];
  const impact = p.impact === "stopped" ? "Had to stop" : p.impact === "modified" ? "Changed the session" : null;
  return [feel.join(", "), when.join(", "), p.exerciseName, impact].filter(Boolean).join(" · ");
}

function Label({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-semibold text-muted-foreground">{children}</p>;
}

/** One place: its row, what it still needs on it, and (open) everything else to change. */
export function PainEntryRow({
  pick,
  picks,
  ctx,
  open,
  flash,
  onToggle,
  onChange,
  onRemove,
  onChangeSpot,
}: {
  pick: PainPick;
  picks: PainPick[];
  ctx: PainEntriesContext | null;
  open: boolean;
  /** Just added or just asked for: a quick highlight. */
  flash?: boolean;
  onToggle: () => void;
  onChange: (next: PainPick[]) => void;
  onRemove: () => void;
  onChangeSpot: () => void;
}) {
  const mirror = mirrorOf(picks, pick);
  const sideChoice = sideChoiceOf(picks, pick);
  // both sides are one row: what either still needs shows here
  const gaps = [...new Set([...pickGaps(pick), ...(mirror ? pickGaps(mirror) : [])])];
  const sided = pickSided(pick);
  const score = pickScore(pick);
  const both = sideChoice === "both" && !!mirror;
  const name = both ? (pick.site ? siteOf(pick.site)?.label ?? placeLabel(pick) : regionOf(pick.region)?.label ?? placeLabel(pick)) : placeLabel(pick);
  const line = entrySummary(pick);
  const timing = pick.timing ?? [];
  const training = timing.some((t) => t === "during" || t === "after" || t === "movement");
  const [otherOpen, setOtherOpen] = useState(!!pick.exerciseName && !ctx?.exercises.some((x) => x.name === pick.exerciseName));
  const prior = useMemo(
    () => (ctx ? followUpFor(ctx.entries, pick.region, pick.side ?? null, { today: ctx.today, feedbackId: ctx.feedbackId, site: pick.site, symptom: pick.symptom }) : null),
    [ctx, pick.region, pick.side, pick.site, pick.symptom],
  );
  // what kind of thing this is (symptoms.ts) decides what's worth asking: how bad only when it changes
  // what happens next, what it feels like only where there's somewhere to feel it
  const general = generalOf(pick.symptom);
  const head = !!general || pick.region === "head" || pick.region === "face" || pick.region === "jaw";
  const rateOptional = !needsRating(pick);
  const kind = symptomClass(pick);
  // no side said: the last time this place came up, its side (a hint, never picked for them)
  const sideHint = useMemo(() => {
    if (!sided || pick.side || !ctx) return null;
    const last = followUpFor(ctx.entries, pick.region, null, { today: ctx.today, feedbackId: ctx.feedbackId, site: pick.site });
    return last?.side ? `Last time (${shortDay(last.date)}) it was your ${last.side === "L" ? "left" : "right"}.` : null;
  }, [sided, pick.side, pick.region, pick.site, ctx]);
  const followChoice = pick.sameIssue === false ? "new" : pick.sameIssue ? pick.change ?? null : null;

  const patch = (p: Partial<PainPick>) => onChange(updatePaired(picks, pick.uid, p));
  const setSide = (c: SideChoice) => {
    if (!pick.side) {
      // a place with no side yet: it's that side, or both
      if (c === "both") onChange(setSideChoice(updatePaired(picks, pick.uid, { side: "L" }), pick.uid, "both").picks);
      else patch({ side: c });
      return;
    }
    onChange(setSideChoice(picks, pick.uid, c).picks);
  };
  const toggleFeel = (f: Feel) => patch({ feel: (pick.feel ?? []).includes(f) ? (pick.feel ?? []).filter((x) => x !== f) : [...(pick.feel ?? []), f] });
  const toggleTiming = (t: Timing) => patch({ timing: timing.includes(t) ? timing.filter((x) => x !== t) : [...timing, t] });
  const setScore = (who: PainPick, n: number) => onChange(updatePaired(picks, who.uid, scorePatch(n)));
  const setUnsure = (who: PainPick) => onChange(updatePaired(picks, who.uid, unsurePatch()));
  const badge = (p: PainPick) => {
    const s = pickScore(p);
    return s != null ? `${s}/10` : p.unsure ? "Unsure" : !needsRating(p) ? classShort(symptomClass(p)) : null;
  };
  const scoreText = both ? [pick, mirror!].sort((a) => (a.side === "L" ? -1 : 1)).map((p) => `${p.side === "L" ? "L" : "R"} ${badge(p) ?? "?"}`).join(" · ") : badge(pick);

  return (
    <li
      className={cn("rounded-xl border bg-background transition-colors", gaps.length ? "border-warning/60" : "border-border", flash && "jf-pain-flash")}
      data-pain-place={`${pick.symptom ?? pick.site ?? pick.region}:${pick.side ?? "-"}`}
      data-pain-kind={kind}
      data-pain-gaps={gaps.join(" ") || undefined}
    >
      <div className="flex items-center gap-3 p-2.5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open} aria-label={`${name}: ${open ? "close" : "change details"}`}>
          <PlaceThumb place={pick} className="h-11 w-11" />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 truncate text-[15px] font-semibold" data-pain-place-name>{name}</span>
              {scoreText && (
                <span className={cn("shrink-0 text-[14px] font-semibold tabular-nums", score != null && score >= 7 ? "text-warning" : "text-foreground")} data-pain-place-score>
                  {scoreText}
                </span>
              )}
            </span>
            <span className="block truncate text-[12px] text-muted-foreground">
              {line || siteAnatomy(pick.site) || (open ? "Add details below" : "Tap to add details")}
            </span>
          </span>
        </button>
        <button type="button" onClick={onRemove} className="-mr-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label={`Remove ${name}`} data-pain-remove>
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* what it still needs: on the row, never behind a tap */}
      {(gaps.length > 0 || open) && (
        <div className="space-y-4 border-t border-border/60 px-3 pb-3 pt-3" data-pain-entry-body>
          {gaps.includes("where") && (
            <div className="space-y-1.5" data-pain-gap="where">
              <Label>Where does it hurt?</Label>
              <input
                value={pick.note ?? ""}
                onChange={(e) => patch({ note: e.target.value.slice(0, NOTE_MAX) })}
                placeholder="e.g. under my left shoulder blade"
                aria-label="Where it hurts"
                {...noAutofill("pain-where")}
                className="h-11 w-full rounded-lg border border-border bg-transparent px-3 text-base outline-none focus:border-foreground"
              />
            </div>
          )}

          {sided && (gaps.includes("side") || open) && (
            <div className="space-y-1.5" data-pain-gap={gaps.includes("side") ? "side" : undefined}>
              <Label>Which side?</Label>
              <SideControl value={sideChoice} onPick={setSide} hint={sideHint} attention={gaps.includes("side")} />
            </div>
          )}

          {(gaps.includes("score") || open) &&
            (both ? (
              <div className="space-y-3" data-pain-gap={gaps.includes("score") ? "score" : undefined}>
                {[pick, mirror!]
                  .sort((a) => (a.side === "L" ? -1 : 1))
                  .map((p) => (
                    <div key={p.uid} className="space-y-1.5">
                      <Label>{p.side === "L" ? "Left" : "Right"}: how bad?</Label>
                      <ScorePicker value={pickScore(p)} unsure={!!p.unsure} onScore={(n) => setScore(p, n)} onUnsure={() => setUnsure(p)} label={`${p.side === "L" ? "Left" : "Right"} ${name.toLowerCase()}: how bad, 1 to 10`} />
                    </div>
                  ))}
              </div>
            ) : (
              <div className="space-y-1.5" data-pain-gap={gaps.includes("score") ? "score" : undefined}>
                <Label>{rateOptional ? "How bad is it? (optional)" : "How bad is it?"}</Label>
                <ScorePicker value={score} unsure={!!pick.unsure} onScore={(n) => setScore(pick, n)} onUnsure={() => setUnsure(pick)} label={`${name}: how bad, 1 to 10`} />
              </div>
            ))}

          {open && (
            <>
              {prior && (
                <div className="space-y-1.5" data-pain-followup>
                  <Label>
                    {`You flagged ${prior.site && prior.site !== pick.site ? `your ${(siteOf(prior.site)?.label ?? "").toLowerCase()} ` : "this "}${shortDay(prior.date)}${prior.score != null ? ` (${prior.score}/10)` : ""}. Since then?`}
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {[...CHANGES, { v: "new" as const, label: "Something new" }].map((o) => (
                      <button key={o.v} type="button" className={chip(followChoice === o.v)} aria-pressed={followChoice === o.v} onClick={() => patch(answerFollowUp(pick, o.v, prior))}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(!general || general.key === "headache") && (
              <div className="space-y-1.5">
                <Label>What does it feel like?</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[...(head ? HEAD_FEEL_CHOICES : FEEL_CHOICES), ...((pick.feel ?? []).includes("pinch") ? (["pinch"] as Feel[]) : []), ...(head ? HEAD_SIGNS : FEEL_SIGNS)].map((f) => {
                    const on = (pick.feel ?? []).includes(f);
                    return (
                      <button key={f} type="button" className={chip(on)} aria-pressed={on} onClick={() => toggleFeel(f)} data-pain-feel={f}>
                        {FEELS.find((x) => x.v === f)?.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              )}

              <div className="space-y-1.5">
                <Label>{general ? "When did it happen?" : "When does it hurt?"}</Label>
                <div className="flex flex-wrap gap-1.5">
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
                <div className="space-y-1.5" data-pain-exercise>
                  <Label>Which exercise or movement?</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(ctx?.exercises ?? []).map((x) => {
                      const on = pick.exerciseName === x.name;
                      return (
                        <button
                          key={x.name}
                          type="button"
                          className={chip(on)}
                          aria-pressed={on}
                          onClick={() => {
                            setOtherOpen(false);
                            patch(on ? { exerciseName: null, exerciseId: null } : { exerciseName: x.name, exerciseId: x.id });
                          }}
                        >
                          {x.name}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className={chip(otherOpen)}
                      aria-pressed={otherOpen}
                      onClick={() => {
                        setOtherOpen((o) => !o);
                        if (ctx?.exercises.some((x) => x.name === pick.exerciseName)) patch({ exerciseName: null, exerciseId: null });
                      }}
                    >
                      Something else
                    </button>
                  </div>
                  {otherOpen && (
                    <input
                      value={pick.exerciseName ?? ""}
                      onChange={(e) => patch({ exerciseName: e.target.value.slice(0, 120), exerciseId: null })}
                      placeholder="e.g. reaching overhead, getting up from a chair"
                      aria-label="Which exercise or movement"
                      {...noAutofill("pain-movement")}
                      autoCapitalize="sentences"
                      className="h-11 w-full rounded-lg border border-border bg-transparent px-3 text-base outline-none focus:border-foreground"
                    />
                  )}
                </div>
              )}

              {timing.includes("during") && (
                <div className="space-y-1.5">
                  <Label>Did it change your session?</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {IMPACTS.map((o) => (
                      <button key={o.v} type="button" className={chip(pick.impact === o.v)} aria-pressed={pick.impact === o.v} onClick={() => patch({ impact: pick.impact === o.v ? null : o.v })}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {pick.region !== "other" && (
                <div className="space-y-1.5">
                  <Label>Anything else? (optional)</Label>
                  <textarea
                    value={pick.note ?? ""}
                    onChange={(e) => patch({ note: e.target.value.slice(0, NOTE_MAX) })}
                    rows={2}
                    placeholder="e.g. only at the bottom of the lift"
                    aria-label={`${name}: note`}
                    {...noAutofill("pain-note")}
                    className="w-full resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-base outline-none focus:border-foreground"
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                {pick.region !== "other" && pick.region !== "general" ? (
                  <button type="button" onClick={onChangeSpot} className="inline-flex h-9 items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground" data-pain-change-spot>
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> Change spot on the body
                  </button>
                ) : (
                  <span />
                )}
                <button type="button" onClick={onToggle} className="inline-flex h-9 items-center rounded-full bg-muted px-4 text-[13px] font-semibold" data-pain-entry-done>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

