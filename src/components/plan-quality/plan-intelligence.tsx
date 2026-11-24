/**
 * Plan intelligence (Nov 24 2026): the one compact strip at the top of a
 * client's Training, Nutrition and Cardio tabs, the same everywhere. A dial with
 * the design score and its band, the verdict in one line (what's going on and
 * whether the coach needs to act), how it's being followed and whether it's
 * working beside it (never in the score), then Optimize with Cleo and Ask Cleo.
 * The breakdown folds out: what's working, what would help most (ranked by how
 * much each would lift the score), what their other plans mean for this one,
 * and every category. Colour only means something: green working, amber worth
 * a look or action needed, the dial's colour its band. Never presented as a
 * validated or clinical measure.
 *
 * Optimize opens the tab's Cleo with the brief (OptimizeBrief): the ranked
 * opportunities, each ticked, to draft as proposals the coach approves one by
 * one or all together. Nothing changes a live prescription from here.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleDashed, Dumbbell, Footprints, Gauge, Link2, MessageCircle, Salad, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { CleoMark } from "@/components/summer/cleo-mark";
import { BAND_LABEL, CONFIDENCE_LABEL, optimizeAskFrom, type QualityDomain, type QualityOpportunity, type QualityScore } from "@/lib/plan-quality";

const DOMAIN_ICON: Record<QualityDomain, typeof Dumbbell> = { training: Dumbbell, nutrition: Salad, cardio: Footprints };
const DOMAIN_WORD: Record<QualityDomain, string> = { training: "Training", nutrition: "Nutrition", cardio: "Cardio" };

function bandStroke(band: QualityScore["band"]) {
  return band === "strong" ? "stroke-success" : band === "good" ? "stroke-foreground" : band === "fair" ? "stroke-warning" : band === "weak" ? "stroke-destructive" : "stroke-muted-foreground/40";
}
function barTone(score: number) {
  return score >= 85 ? "bg-success" : score >= 70 ? "bg-foreground/70" : score >= 55 ? "bg-warning" : "bg-destructive";
}

/** The score as a dial: the arc is the score, its colour the band. */
export function ScoreDial({ score, band, size = 64, label }: { score: number | null; band: QualityScore["band"]; size?: number; label?: string }) {
  const stroke = size >= 56 ? 5 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ?? (score == null ? "Not scored" : `${score} out of 100`)} data-score-dial>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        {score != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            className={cn("transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none", bandStroke(band))}
          />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center" aria-hidden>
        {score == null ? <Gauge className="h-5 w-5 text-muted-foreground" /> : <span className={cn("font-semibold tabular-nums tracking-tight", size >= 56 ? "text-[19px]" : "text-[15px]")}>{score}</span>}
      </span>
    </div>
  );
}

const ACTION: Record<QualityScore["verdict"]["action"], { word: string; dot: string; text: string }> = {
  none: { word: "No action needed", dot: "bg-success", text: "text-muted-foreground" },
  review: { word: "Worth a look", dot: "bg-warning", text: "text-muted-foreground" },
  act: { word: "Action needed", dot: "bg-warning", text: "font-medium text-foreground" },
};

function Pill({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-muted px-2 text-[12px] text-muted-foreground", className)}>
      {children}
    </span>
  );
}

/** A score change since the last read on this screen ("+6"), shown for a while after it moves. */
function useScoreDelta(score: number | null, key: string): number | null {
  const prev = useRef<{ key: string; score: number | null } | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = { key, score };
    if (!p || p.key !== key || p.score == null || score == null || p.score === score) return;
    setDelta(score - p.score);
    const t = window.setTimeout(() => setDelta(null), 20_000);
    return () => window.clearTimeout(t);
  }, [score, key]);
  return delta;
}

export function PlanIntelligence({
  domain,
  clientKey,
  title,
  quality,
  loading,
  error,
  onRetry,
  onOptimize,
  onAskCleo,
  cleo,
  draft,
  className,
}: {
  domain: QualityDomain;
  /** Who it's about (keeps the score change to one client). */
  clientKey: string;
  title?: string;
  quality: QualityScore | null | undefined;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Open the tab's Cleo with the ranked brief. */
  onOptimize?: (quality: QualityScore) => void;
  /** Open the tab's Cleo to ask anything. */
  onAskCleo?: () => void;
  /** Whether the person has Cleo (else the same actions, unbranded). */
  cleo: boolean;
  /** A draft on screen with its own score (cardio's builder): shown beside the live one. */
  draft?: { score: number | null; label: string } | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const delta = useScoreDelta(quality?.score ?? null, `${domain}:${clientKey}`);
  const Icon = DOMAIN_ICON[domain];
  const heading = title ?? `${DOMAIN_WORD[domain]} plan quality`;

  if (loading) {
    return (
      <section className={cn("rounded-2xl border border-border bg-card p-3 sm:p-4", className)} data-plan-intelligence={domain} aria-busy>
        <div className="flex items-center gap-3">
          <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-full max-w-md" />
          </div>
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className={cn("flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3 text-[13px] sm:p-4", className)} data-plan-intelligence={domain}>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 text-muted-foreground">Couldn't read {DOMAIN_WORD[domain].toLowerCase()} plan quality just now.</span>
        {onRetry && (
          <Button variant="ghost" className="h-9" onClick={onRetry}>
            Try again
          </Button>
        )}
      </section>
    );
  }
  if (!quality) return null;

  const q = quality;
  const a = ACTION[q.verdict.action];
  const adh = q.execution.adherence;
  const out = q.execution.outcome;
  const hasBreakdown = q.categories.length > 0 || q.connections.length > 0 || q.missing.length > 0;
  const canOptimize = !!onOptimize && !!q.optimize;

  return (
    <section className={cn("rounded-2xl border border-border bg-card", className)} data-plan-intelligence={domain} data-verdict={q.verdict.kind}>
      <div className="flex flex-col gap-3 p-3 sm:p-4 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ScoreDial score={q.score} band={q.band} label={q.score == null ? "Not scored" : `${heading}: ${q.score} out of 100, ${q.band ? BAND_LABEL[q.band] : ""}`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h3 className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                {heading}
              </h3>
              {q.band && <span className="text-[13px] text-muted-foreground">{BAND_LABEL[q.band]}</span>}
              {delta != null && (
                <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums", delta > 0 ? "text-success" : "text-muted-foreground")} data-score-delta>
                  {delta > 0 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
                  {delta > 0 ? `+${delta}` : delta} since your change
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-3 text-[13px] leading-snug sm:line-clamp-2" data-plan-verdict>
              {q.verdict.headline}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Pill className={a.text}>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", a.dot)} aria-hidden />
                {a.word}
              </Pill>
              {adh && (
                <Pill title={adh.label}>
                  <Check className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">Followed {adh.pct}%</span>
                </Pill>
              )}
              {out && (
                <Pill title={out.label}>
                  <TrendingUp className={cn("h-3 w-3 shrink-0", out.status !== "on_track" && "rotate-90")} aria-hidden />
                  <span className="truncate">{out.status === "on_track" ? "On track" : out.status === "behind" ? "Behind" : "Off track"}</span>
                </Pill>
              )}
              {draft && draft.score != null && draft.score !== q.score && (
                <Pill title="Your unpublished draft">
                  <CircleDashed className="h-3 w-3 shrink-0" aria-hidden />
                  {draft.label} {draft.score}
                </Pill>
              )}
              <span className="text-[11px] text-muted-foreground">{CONFIDENCE_LABEL[q.confidence]}</span>
            </div>
          </div>
        </div>
        {(canOptimize || onAskCleo) && (
          <div className="flex shrink-0 gap-2 md:flex-col lg:flex-row">
            {canOptimize && (
              <Button className="h-10 flex-1 gap-1.5 md:flex-none" variant={q.verdict.action === "act" ? "default" : "outline"} onClick={() => onOptimize!(q)} data-quality-optimize>
                {cleo ? <CleoMark size={16} /> : null}
                {cleo ? "Optimize with Cleo" : "Optimize"}
              </Button>
            )}
            {onAskCleo && (
              <Button className="h-10 flex-1 gap-1.5 md:flex-none" variant="ghost" onClick={onAskCleo} data-quality-ask>
                <MessageCircle className="h-4 w-4" aria-hidden />
                {cleo ? "Ask Cleo" : "Ask"}
              </Button>
            )}
          </div>
        )}
      </div>

      {hasBreakdown && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex min-h-10 w-full cursor-pointer items-center justify-between border-t border-border px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-4"
            data-quality-toggle
          >
            {open ? "Hide the breakdown" : q.opportunities.length ? `What would help most (${q.opportunities.length})` : "See the breakdown"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <div id={panelId} className="grid gap-4 border-t border-border p-3 sm:p-4 lg:grid-cols-2" data-quality-breakdown>
              <div className="min-w-0 space-y-4">
                {q.opportunities.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-muted-foreground">What would help most</p>
                    <ol className="mt-1.5 space-y-2" data-quality-opportunities>
                      {q.opportunities.map((o, i) => (
                        <li key={o.key} className="flex gap-2 text-[13px] leading-snug">
                          <span className="mt-px w-4 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                          <span className="min-w-0">
                            <span className="font-medium">{o.title}</span> <ImpactTag o={o} />
                            {o.why && <span className="block text-[12px] text-muted-foreground">{o.why}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {q.strengths.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-muted-foreground">What's working</p>
                    <ul className="mt-1.5 space-y-1" data-quality-strengths>
                      {q.strengths.map((s) => (
                        <li key={s} className="flex gap-2 text-[13px] leading-snug">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                          <span className="min-w-0">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {q.connections.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-muted-foreground">Across their plans</p>
                    <ul className="mt-1.5 space-y-1" data-quality-connections>
                      {q.connections.map((c) => {
                        const I = DOMAIN_ICON[c.domain];
                        return (
                          <li key={c.text} className="flex gap-2 text-[13px] leading-snug">
                            <I className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="min-w-0">
                              <span className="text-muted-foreground">{DOMAIN_WORD[c.domain]}: </span>
                              {c.text}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {(adh || out) && (
                  <div>
                    <p className="text-[12px] font-semibold text-muted-foreground">How it's going (not in the score)</p>
                    <ul className="mt-1.5 space-y-1 text-[13px] leading-snug">
                      {adh && <li>{adh.label}</li>}
                      {out && <li>{out.label}</li>}
                    </ul>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                {q.categories.length > 0 && (
                  <ul className="space-y-2.5" data-quality-categories>
                    {q.categories.map((c) => (
                      <li key={c.key}>
                        <div className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="font-medium">{c.label}</span>
                          <span className="tabular-nums text-muted-foreground">{c.score == null ? "Not enough data" : c.score}</span>
                        </div>
                        {c.score != null && (
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <div className={cn("h-full rounded-full", barTone(c.score))} style={{ width: `${c.score}%` }} />
                          </div>
                        )}
                        {c.notes[0] && <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{c.notes.join(" · ")}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                {q.missing.length > 0 && <p className="mt-3 text-[12px] text-muted-foreground">Would make it surer: {q.missing.join(", ").toLowerCase()}.</p>}
                <p className="mt-2 text-[11px] text-muted-foreground">The score rates the plan's design from what's on file; how it's followed sits beside it. A coaching check, not a clinical measure.</p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ImpactTag({ o }: { o: QualityOpportunity }) {
  return (
    <span className={cn("ml-0.5 inline-flex items-center rounded-full px-1.5 text-[11px] font-medium tabular-nums", o.impact === "high" ? "bg-warning/15 text-foreground" : "bg-muted text-muted-foreground")}>
      {o.impact === "high" ? "High impact" : o.impact === "medium" ? "Medium" : "Low"} · +{Math.round(o.gain)}
    </span>
  );
}

/* ───────────────────────────── Optimize brief ───────────────────────────── */

export type OptimizeBriefData = { domain: QualityDomain; what: string; quality: QualityScore; nonce: number };

/** The ask built from the opportunities the coach kept ticked. */
export function briefAsk(b: OptimizeBriefData, keys: Set<string>): string | null {
  const opp = b.quality.opportunities.filter((o) => keys.has(o.key));
  if (!opp.length) return null;
  return optimizeAskFrom(b.what, { ...b.quality, opportunities: opp });
}

/**
 * What Optimize opens in a Cleo dock first: the ranked opportunities, each
 * ticked, with why and how much each should help. Draft sends them to Cleo,
 * which proposes each change with what it is now and what it'd become; the
 * coach approves them one at a time or all together.
 */
export function OptimizeBrief({ brief, onDraft, onEdit, onClose, busy }: { brief: OptimizeBriefData; onDraft: (ask: string) => void; onEdit: (ask: string) => void; onClose: () => void; busy?: boolean }) {
  const [keys, setKeys] = useState<Set<string>>(() => new Set(brief.quality.opportunities.map((o) => o.key)));
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setKeys(new Set(brief.quality.opportunities.map((o) => o.key)));
    setSent(false);
  }, [brief.nonce, brief.quality.opportunities]);
  const ask = briefAsk(brief, keys);
  const q = brief.quality;
  if (sent) {
    return (
      <div className="mx-3 mt-3 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground" data-optimize-brief="sent">
        <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">Optimizing {keys.size} thing{keys.size === 1 ? "" : "s"}: review each proposed change below before anything is applied.</span>
        <button type="button" className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }
  return (
    <div className="mx-3 mt-3 rounded-2xl border border-border bg-card p-3" data-optimize-brief>
      <div className="flex items-center gap-2.5">
        <ScoreDial score={q.score} band={q.band} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-tight">What would help most</p>
          <p className="text-[12px] text-muted-foreground">Ranked by how much each should lift the score. Untick anything you'd keep.</p>
        </div>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {q.opportunities.map((o) => {
          const on = keys.has(o.key);
          return (
            <li key={o.key}>
              <label className={cn("flex cursor-pointer gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50", !on && "opacity-60")}>
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) =>
                    setKeys((s) => {
                      const n = new Set(s);
                      if (v) n.add(o.key);
                      else n.delete(o.key);
                      return n;
                    })
                  }
                  className="mt-0.5"
                  aria-label={o.title}
                />
                <span className="min-w-0 text-[13px] leading-snug">
                  <span className="font-medium">{o.title}</span> <ImpactTag o={o} />
                  <span className="block text-[12px] text-muted-foreground">
                    {o.label}
                    {o.why ? ` · ${o.why}` : ""}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {q.connections.length > 0 && <p className="mt-1.5 px-2 text-[12px] text-muted-foreground">Cleo also reads their {q.connections.map((c) => DOMAIN_WORD[c.domain].toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).join(" and ")} plan for this.</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          className="h-10 gap-1.5"
          disabled={!ask || busy}
          onClick={() => {
            if (!ask) return;
            setSent(true);
            onDraft(ask);
          }}
          data-optimize-draft
        >
          <CleoMark size={15} /> Draft {keys.size} change{keys.size === 1 ? "" : "s"}
        </Button>
        <Button variant="ghost" className="h-10" disabled={!ask} onClick={() => ask && onEdit(ask)}>
          Edit the ask
        </Button>
        <button type="button" onClick={onClose} className="ml-auto h-10 cursor-pointer px-2 text-[12px] font-medium text-muted-foreground hover:text-foreground">
          Not now
        </button>
      </div>
      <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">Each change comes back with what it is now and what it'd become. Nothing reaches the client until you approve it.</p>
    </div>
  );
}
