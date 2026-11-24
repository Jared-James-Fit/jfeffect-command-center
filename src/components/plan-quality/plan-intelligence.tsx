/**
 * Plan intelligence (Nov 24 2026): the one compact strip at the top of a
 * client's Training, Nutrition and Cardio tabs, the same everywhere. A dial with
 * the design score and its band, the verdict in one line (what needs the coach
 * first and whether to act), how it's being followed and whether it's working
 * beside it (never in the score), then Optimize with Cleo and Ask Cleo, the
 * page's one way into its Cleo (the dock's handle takes over once the strip
 * scrolls away).
 *
 * A high score never hides a concern: anything flagged (safety, recovery, a
 * weak or client-critical category, adherence, results) leads the verdict and
 * is counted beside it. A thin read or a plan too new for its results is marked
 * provisional, and "not enough data" shows no number at all. The breakdown
 * folds out: concerns, what would help most (ranked by what matters for this
 * client, never by points), optional fine-tuning, what's working, what their
 * other plans mean for this one, and every category. Colour only means
 * something: green working, amber worth a look or a concern, red urgent, the
 * dial's colour its band (never green with a concern open). Never presented as
 * a validated or clinical measure.
 *
 * Optimize is always there: it opens the tab's Cleo on the brief
 * (OptimizeBrief) with what matters ticked and the optional fine-tuning not,
 * or, when the plan is working, a review whose answer may well be "keep it".
 * Nothing changes a live prescription from here.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, CircleDashed, Clock, Dumbbell, FilePen, Footprints, Gauge, History, Link2, MessageCircle, Salad, Send, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { queueComposerInsert } from "@/lib/composer-insert";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { CleoMark } from "@/components/summer/cleo-mark";
import {
  BAND_LABEL,
  CONFIDENCE_LABEL,
  optimizeAskFrom,
  reviewAskFrom,
  type QualityChange,
  type QualityConcern,
  type QualityDomain,
  type QualityOpportunity,
  type QualityScore,
} from "@/lib/plan-quality";

const DOMAIN_ICON: Record<QualityDomain, typeof Dumbbell> = { training: Dumbbell, nutrition: Salad, cardio: Footprints };
const DOMAIN_WORD: Record<QualityDomain, string> = { training: "Training", nutrition: "Nutrition", cardio: "Cardio" };
const REASON_WORD: Record<QualityConcern["reason"], string> = { safety: "Safety", recovery: "Recovery", timeline: "Meet prep", results: "Results", adherence: "Following it", weak_spot: "Weak spot" };

function dialStroke(q: Pick<QualityScore, "band" | "concerns" | "provisional">) {
  if (q.provisional) return "stroke-muted-foreground/60";
  if (q.band === "strong") return q.concerns.length ? "stroke-foreground" : "stroke-success";
  return q.band === "good" ? "stroke-foreground" : q.band === "fair" ? "stroke-warning" : q.band === "weak" ? "stroke-destructive" : "stroke-muted-foreground/40";
}
function barTone(score: number) {
  return score >= 85 ? "bg-success" : score >= 70 ? "bg-foreground/70" : score >= 55 ? "bg-warning" : "bg-destructive";
}

/** The score as a dial: the arc is the score, its colour the band (dashed and muted while provisional, never green with a concern). */
export function ScoreDial({ quality, size = 64, label }: { quality: Pick<QualityScore, "score" | "band" | "concerns" | "provisional">; size?: number; label?: string }) {
  const { score } = quality;
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
            strokeLinecap={quality.provisional ? "butt" : "round"}
            strokeDasharray={quality.provisional ? `${(c * pct).toFixed(1)} ${c.toFixed(1)}` : c}
            strokeDashoffset={quality.provisional ? 0 : c * (1 - pct)}
            className={cn("transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none", dialStroke(quality))}
          />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center" aria-hidden>
        {score == null ? (
          <Gauge className="h-5 w-5 text-muted-foreground" />
        ) : (
          <span className={cn("font-semibold tabular-nums tracking-tight", size >= 56 ? "text-[19px]" : "text-[15px]", quality.provisional && "text-muted-foreground")}>{score}</span>
        )}
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

const changedWords = (days: number, minor?: boolean) => {
  const verb = minor ? "Adjusted" : "Changed";
  return days === 0 ? `${verb} today` : days === 1 ? `${verb} yesterday` : `${verb} ${days} days ago`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Dec 14" from a YYYY-MM-DD date. */
export function shortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "";
}

/** A draft or proposal waiting on the coach (a friendly reminder on the strip, never a popup). */
export type PendingDraft = { text: string; action: string; onOpen: () => void };

/** "from Nov 22" / "from earlier today": how long a draft has waited, in a friendly word. */
export function waitedWords(at: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(at)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "from earlier today";
  if (days === 1) return "from yesterday";
  return `from ${shortDate(new Date(Date.parse(at)).toISOString().slice(0, 10))}`;
}

/** The reminder for a finished draft nobody has acted on yet: friendly, one line, one tap to it. */
export function pendingReminder(kind: "program" | "nutrition" | "cardio_draft" | "cardio_proposal", at: string, o: { count?: number; cleo?: boolean; onOpen: () => void }): PendingDraft {
  const when = waitedWords(at);
  const n = o.count ?? 1;
  const who = o.cleo ? "Cleo's " : "";
  if (kind === "program") return { text: `${who}${n} proposed change${n === 1 ? "" : "s"} ${when} ${n === 1 ? "is" : "are"} still waiting. Apply what you want, or discard it.`, action: "Review", onOpen: o.onOpen };
  if (kind === "nutrition") return { text: `A plan change ${when} is written and waiting. Update the plan when you're happy, or discard it.`, action: "Review", onOpen: o.onOpen };
  if (kind === "cardio_draft") return { text: `Your cardio draft ${when} isn't published yet. Publish it now, schedule it, or keep working on it.`, action: "Open draft", onOpen: o.onOpen };
  return { text: `${who}cardio proposal ${when} is waiting. Put it on your draft, or turn it down.`, action: "Review", onOpen: o.onOpen };
}

/** One recent change, its size and when its effect can be judged. */
function ChangeLine({ c }: { c: QualityChange }) {
  const future = c.settling && !c.holds && c.size === "substantial";
  return (
    <li className="flex gap-2 text-[13px] leading-snug" data-quality-change={c.size}>
      <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{shortDate(c.on)}</span>
      <span className="min-w-0">
        {c.summary}
        <span className="block text-[11px] text-muted-foreground">
          {c.size === "substantial" ? "Substantial" : "Minor"}
          {c.holds
            ? ` · judge it from ${shortDate(c.ready)}${c.why ? ` (${c.why})` : ""}`
            : future
              ? ` · starts ${shortDate(c.on)}`
              : c.settling
                ? " · judged on its own, doesn't restart the read"
                : " · had its time"}
        </span>
      </span>
    </li>
  );
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
  pending,
  messageClientId,
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
  /** Open the tab's Cleo with the brief (offered whatever the score, while there's an ask). */
  onOptimize?: (quality: QualityScore) => void;
  /** Open the tab's Cleo to ask anything. */
  onAskCleo?: () => void;
  /** Whether the person has Cleo (else the same actions, unbranded). */
  cleo: boolean;
  /** A draft on screen with its own score (cardio's builder): shown beside the live one. */
  draft?: { score: number | null; label: string } | null;
  /** A finished draft or proposal nobody has published yet: a quiet reminder with one tap to it. */
  pending?: PendingDraft | null;
  /** The client, for "Message them" when the next step is a conversation (never in a preview). */
  messageClientId?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
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
  const main = q.opportunities.filter((o) => !o.optional);
  const optional = q.opportunities.filter((o) => o.optional);
  const urgent = q.concerns.some((c) => c.severity === "urgent");
  const hasBreakdown = q.categories.length > 0 || q.connections.length > 0 || q.missing.length > 0 || q.concerns.length > 0 || q.changes.length > 0;
  const canOptimize = !!onOptimize && !!q.optimize;
  // a conversation first: they're struggling to follow it (the plan isn't the reason, or isn't only it)
  const canMessage = !!messageClientId && !!q.verdict.ask;
  const thin = q.confidence === "low" || q.confidence === "insufficient";
  const extra = main.filter((o) => !q.concerns.some((c) => c.category === o.key)).length;
  const toggleLabel = open
    ? "Hide the breakdown"
    : q.concerns.length
      ? `Concerns and what would help (${q.concerns.length + extra})`
      : main.length
        ? `What would help most (${main.length})`
        : optional.length
          ? `Optional fine-tuning (${optional.length})`
          : "See the breakdown";

  return (
    // laid out by its own width (a docked Cleo narrows the page), never the window's
    <section className={cn("@container rounded-2xl border border-border bg-card", className)} data-plan-intelligence={domain} data-verdict={q.verdict.kind} data-provisional={q.provisional || undefined}>
      <div className="flex flex-col gap-3 p-3 @lg:p-4 @3xl:flex-row @3xl:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ScoreDial quality={q} label={q.score == null ? "Not scored" : `${heading}: ${q.score} out of 100, ${q.provisional ? "provisional" : q.band ? BAND_LABEL[q.band] : ""}`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h3 className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                {heading}
              </h3>
              {q.band && <span className="text-[13px] text-muted-foreground">{q.provisional ? `Provisional · ${BAND_LABEL[q.band]}` : BAND_LABEL[q.band]}</span>}
              {delta != null && (
                <span
                  className={cn("inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums", delta > 0 ? "text-success" : "text-muted-foreground")}
                  title="The plan's design, read again after your change. Results come later."
                  data-score-delta
                >
                  {delta > 0 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
                  Design {delta > 0 ? `+${delta}` : delta} after your change{q.settling ? ", results not in yet" : ""}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-3 text-[13px] leading-snug @3xl:line-clamp-2" data-plan-verdict>
              {q.verdict.headline}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Pill className={a.text}>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", urgent ? "bg-destructive" : a.dot)} aria-hidden />
                {a.word}
              </Pill>
              {q.concerns.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className={cn(
                    "inline-flex h-6 cursor-pointer items-center gap-1 rounded-full px-2 text-[12px] font-medium transition-colors",
                    urgent ? "bg-destructive/10 text-destructive hover:bg-destructive/15" : "bg-warning/15 text-foreground hover:bg-warning/25",
                  )}
                  aria-controls={panelId}
                  data-quality-concerns-count={q.concerns.length}
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                  {q.concerns.length} concern{q.concerns.length === 1 ? "" : "s"}
                </button>
              )}
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
              {q.settling && (
                <Pill title={`${q.settling.what ? `${q.settling.what}. ` : ""}Its effect can be judged from ${shortDate(q.settling.ready) || `about ${Math.round(q.settling.window / 7)} weeks on`}${q.settling.why ? ` (${q.settling.why})` : ""}`} data-quality-settling>
                  <Clock className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">
                    {changedWords(q.settling.days, q.settling.minor)}
                    {q.settling.ready && <span className="hidden @lg:inline"> · judge from {shortDate(q.settling.ready)}</span>}
                  </span>
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
            {thin && q.missing.length > 0 && (
              <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground" data-quality-missing-inline>
                {q.score == null ? "To score it: " : "Would make it surer: "}
                {q.missing.slice(0, 3).join(", ").toLowerCase()}.
              </p>
            )}
            {pending && (
              <button
                type="button"
                onClick={pending.onOpen}
                className="mt-2 flex w-full cursor-pointer items-start gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-left text-[12px] leading-snug transition-colors hover:bg-muted"
                data-quality-pending
              >
                <FilePen className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 text-muted-foreground">{pending.text}</span>
                <span className="shrink-0 font-medium text-foreground">{pending.action}</span>
              </button>
            )}
          </div>
        </div>
        {(canOptimize || onAskCleo || canMessage) && (
          <div className="flex shrink-0 flex-wrap gap-2 @3xl:flex-col @5xl:flex-row" data-quality-actions>
            {canMessage && (
              <Button
                className="h-10 flex-1 gap-1.5 @3xl:flex-none"
                variant={q.verdict.action === "act" ? "default" : "outline"}
                onClick={() => {
                  queueComposerInsert(messageClientId!, q.verdict.ask!);
                  void navigate({ to: "/admin/messages", search: { client: messageClientId! } as any });
                  toast.success("In your message box. Edit it and send when you're happy.");
                }}
                data-quality-message
              >
                <Send className="h-4 w-4" aria-hidden />
                Message them
              </Button>
            )}
            {canOptimize && (
              <Button className="h-10 flex-1 gap-1.5 @3xl:flex-none" variant={q.verdict.action === "act" && !canMessage ? "default" : "outline"} onClick={() => onOptimize!(q)} data-quality-optimize>
                {cleo ? <CleoMark size={16} /> : null}
                {cleo ? "Optimize with Cleo" : "Optimize"}
              </Button>
            )}
            {onAskCleo && (
              <Button className="h-10 flex-1 gap-1.5 @3xl:flex-none" variant="ghost" onClick={onAskCleo} data-quality-ask>
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
            {toggleLabel}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <div id={panelId} className="grid gap-4 border-t border-border p-3 @lg:p-4 @4xl:grid-cols-2" data-quality-breakdown>
              <div className="min-w-0 space-y-4">
                {q.concerns.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-muted-foreground">Needs your attention</p>
                    <ul className="mt-1.5 space-y-1.5" data-quality-concerns>
                      {q.concerns.map((c) => (
                        <li key={c.key} className="flex gap-2 text-[13px] leading-snug">
                          <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", c.severity === "urgent" ? "bg-destructive" : "bg-warning")} aria-hidden />
                          <span className="min-w-0">
                            {c.text}
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              {c.severity === "urgent" ? "Urgent · " : ""}
                              {REASON_WORD[c.reason]}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {main.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-muted-foreground">What would help most</p>
                    <ol className="mt-1.5 space-y-2" data-quality-opportunities>
                      {main.map((o, i) => (
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
                {optional.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-muted-foreground">{main.length || q.concerns.length ? "Optional fine-tuning" : "Optional fine-tuning (keeping it as is is fine)"}</p>
                    <ul className="mt-1.5 space-y-1" data-quality-optional>
                      {optional.map((o) => (
                        <li key={o.key} className="text-[13px] leading-snug text-muted-foreground">
                          {o.title} <span className="text-[11px]">· {o.reason}</span>
                        </li>
                      ))}
                    </ul>
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
                {(adh || out || q.settling) && (
                  <div>
                    <p className="text-[12px] font-semibold text-muted-foreground">How it's going (not in the score)</p>
                    <ul className="mt-1.5 space-y-1 text-[13px] leading-snug">
                      {adh && <li>{adh.label}</li>}
                      {out && <li>{out.label}</li>}
                      {q.execution.expected && <li>{q.execution.expected}</li>}
                      {q.settling && (
                        <li>
                          {changedWords(q.settling.days, q.settling.minor)}: judge it from {shortDate(q.settling.ready) || `about ${Math.round(q.settling.window / 7)} weeks on`}
                          {q.settling.why ? ` (${q.settling.why})` : ""}. A significant trend the wrong way is said before then.
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                {q.changes.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                      <History className="h-3.5 w-3.5" aria-hidden />
                      Recent changes
                    </p>
                    <ul className="mt-1.5 space-y-1.5" data-quality-changes>
                      {q.changes.slice(0, 5).map((c) => (
                        <ChangeLine key={`${c.on}:${c.summary}`} c={c} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                {q.categories.length > 0 && (
                  <ul className="space-y-2.5" data-quality-categories>
                    {q.categories.map((c) => (
                      <li key={c.key} data-quality-category={c.key}>
                        <div className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="flex min-w-0 items-center gap-1.5 font-medium">
                            {c.label}
                            {c.critical && (
                              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground" title={`Key for them: ${c.critical}`} data-quality-critical>
                                Key for them
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{c.score == null ? "Not enough data" : c.score}</span>
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
                <p className="mt-2 text-[11px] text-muted-foreground">
                  The score rates the plan's design from what's on file; how it's followed sits beside it, and a concern is said whatever the score. A coaching check, not a clinical measure.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ImpactTag({ o }: { o: QualityOpportunity }) {
  const word = o.optional ? "Optional" : o.impact === "high" ? "High priority" : o.impact === "medium" ? "Medium" : "Low";
  return (
    <span className={cn("ml-0.5 inline-flex items-center rounded-full px-1.5 text-[11px] font-medium", !o.optional && o.impact === "high" ? "bg-warning/15 text-foreground" : "bg-muted text-muted-foreground")}>
      {word} · {o.reason}
    </span>
  );
}

/* ───────────────────────────── Optimize brief ───────────────────────────── */

export type OptimizeBriefData = { domain: QualityDomain; what: string; quality: QualityScore; nonce: number };

/** One thing the brief offers: a plan-wide concern (recovery, adherence, results) or an opportunity. */
export type BriefItem = { key: string; title: string; detail: string; tag: string; urgent: boolean; optional: boolean; concern: boolean };

export function briefItems(q: QualityScore): BriefItem[] {
  const planWide = q.concerns.filter((c) => !q.opportunities.some((o) => o.key === c.category));
  return [
    ...planWide.map((c) => ({ key: `concern:${c.key}`, title: c.text, detail: REASON_WORD[c.reason], tag: c.severity === "urgent" ? "Urgent" : "Concern", urgent: c.severity === "urgent", optional: false, concern: true })),
    ...q.opportunities.map((o) => {
      const c = q.concerns.find((x) => x.category === o.key);
      return {
        key: o.key,
        title: o.title,
        detail: [o.label, o.why].filter(Boolean).join(" · "),
        tag: c ? (c.severity === "urgent" ? "Urgent" : "Concern") : o.optional ? "Optional" : o.impact === "high" ? "High priority" : o.impact === "medium" ? "Medium" : "Low",
        urgent: c?.severity === "urgent",
        optional: o.optional,
        concern: !!c,
      };
    }),
  ];
}

/** The ask built from what the coach kept ticked; nothing ticked is a review (which may say keep it). */
export function briefAsk(b: OptimizeBriefData, keys: Set<string>): string {
  const q = b.quality;
  const concerns = q.concerns.filter((c) => keys.has(`concern:${c.key}`));
  const opportunities = q.opportunities.filter((o) => keys.has(o.key));
  if (!concerns.length && !opportunities.length) return reviewAskFrom(b.what, q);
  return optimizeAskFrom(b.what, { ...q, concerns, opportunities }) ?? reviewAskFrom(b.what, q);
}

/**
 * What Optimize opens in a Cleo dock first: what matters for this client, ranked (concerns and the
 * changes worth making ticked, optional fine-tuning not), or, when the plan is working, Cleo's read
 * that it can stay as it is with a review one tap away. Draft sends the ticked ones to Cleo, which
 * proposes each change with what it is now and what it'd become; the coach approves them one at a
 * time or all together.
 */
export function OptimizeBrief({ brief, onDraft, onEdit, onClose, busy }: { brief: OptimizeBriefData; onDraft: (ask: string) => void; onEdit: (ask: string) => void; onClose: () => void; busy?: boolean }) {
  const q = brief.quality;
  const items = useMemo(() => briefItems(q), [q]);
  const [keys, setKeys] = useState<Set<string>>(() => new Set(items.filter((i) => !i.optional).map((i) => i.key)));
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setKeys(new Set(items.filter((i) => !i.optional).map((i) => i.key)));
    setSent(false);
  }, [brief.nonce, items]);
  const ask = briefAsk(brief, keys);
  const main = items.filter((i) => !i.optional);
  const optional = items.filter((i) => i.optional);
  const keep = main.length === 0;
  const n = keys.size;
  const toggle = (key: string, on: boolean) =>
    setKeys((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  if (sent) {
    return (
      <div className="mx-3 mt-3 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground" data-optimize-brief="sent">
        <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          {n ? `Optimizing ${n} thing${n === 1 ? "" : "s"}: review each proposed change below before anything is applied.` : "Cleo's reviewing it. Keeping it as it is may be the answer; any change comes to you first."}
        </span>
        <button type="button" className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }
  const row = (i: BriefItem) => {
    const on = keys.has(i.key);
    return (
      <li key={i.key}>
        <label className={cn("flex cursor-pointer gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50", !on && "opacity-70")}>
          <Checkbox checked={on} onCheckedChange={(v) => toggle(i.key, !!v)} className="mt-0.5" aria-label={i.title} />
          <span className="min-w-0 text-[13px] leading-snug">
            <span className="font-medium">{i.title}</span>{" "}
            <span
              className={cn(
                "ml-0.5 inline-flex items-center rounded-full px-1.5 text-[11px] font-medium",
                i.urgent ? "bg-destructive/10 text-destructive" : i.concern || i.tag === "High priority" ? "bg-warning/15 text-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {i.tag}
            </span>
            {i.detail && <span className="block text-[12px] text-muted-foreground">{i.detail}</span>}
          </span>
        </label>
      </li>
    );
  };
  return (
    <div className="mx-3 mt-3 rounded-2xl border border-border bg-card p-3" data-optimize-brief={keep ? "keep" : "ranked"}>
      <div className="flex items-center gap-2.5">
        <ScoreDial quality={q} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-tight">{!keep ? "What matters most" : q.verdict.action === "none" ? "Nothing needs changing" : "Nothing urgent to change"}</p>
          <p className="text-[12px] text-muted-foreground">
            {!keep
              ? "Ranked by what matters for them (safety and recovery first), not by points. Untick anything you'd keep."
              : q.verdict.action === "none"
                ? "Cleo's read is to keep it as is. Ask for a review anyway, or tick something optional."
                : "Worth a look, but nothing in it needs changing on its own. Ask Cleo to review it, or tick what you'd change."}
          </p>
        </div>
      </div>
      {main.length > 0 && <ul className="mt-2.5 space-y-1.5">{main.map(row)}</ul>}
      {optional.length > 0 && (
        <div className="mt-2">
          <p className="px-2 text-[11px] font-semibold text-muted-foreground">Optional fine-tuning (only if clearly worth it)</p>
          <ul className="mt-1 space-y-1">{optional.map(row)}</ul>
        </div>
      )}
      {q.connections.length > 0 && (
        <p className="mt-1.5 px-2 text-[12px] text-muted-foreground">
          Cleo also reads their {q.connections.map((c) => DOMAIN_WORD[c.domain].toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).join(" and ")} plan for this.
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          className="h-10 gap-1.5"
          variant={n ? "default" : "outline"}
          disabled={busy}
          onClick={() => {
            setSent(true);
            onDraft(ask);
          }}
          data-optimize-draft
        >
          <CleoMark size={15} /> {n ? `Draft ${n} change${n === 1 ? "" : "s"}` : "Ask Cleo to review it"}
        </Button>
        <Button variant="ghost" className="h-10" onClick={() => onEdit(ask)}>
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
