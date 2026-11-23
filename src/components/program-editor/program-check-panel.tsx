/**
 * The program editor's status strip and Cleo's Program Check (program-check.ts).
 *
 * The strip: the block's type, how complete the program is (0–100%, a tap
 * lists what's missing, each item a tap from being fixed), and Check program.
 * The check: Quick polish (safe, low-risk tidying the coach ticks and applies,
 * each change shown before → after) or Deep review (adds what needs the
 * coach's call and what's important; nothing there changes here: "Ask Cleo"
 * hands it to Adjust program, where every change is previewed, applied only
 * when the coach says so, and undoable). Completeness and quality are kept
 * apart: a complete program isn't automatically a good one.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ClipboardCheck, Eye, MessageCircle, ShieldCheck } from "lucide-react";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { BuilderSheet } from "./builder-sheet";
import {
  completenessWord,
  LEVEL_TITLE,
  programCheck,
  programCompleteness,
  type CheckFinding,
  type CheckInput,
  type CheckLevel,
  type Completeness,
  type CompletenessGap,
  type Loc,
  type Patch,
} from "@/lib/program-check";

export function ScoreRing({ score, size = 28 }: { score: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const done = score >= 100;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-muted" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, score) / 100)} className={cn("transition-[stroke-dashoffset] duration-500", done ? "stroke-success" : "stroke-foreground")} />
    </svg>
  );
}

const LEVEL_ORDER: CheckLevel[] = ["warning", "decision", "safe"];
const LEVEL_ICON: Record<CheckLevel, React.ReactNode> = {
  warning: <AlertTriangle className="h-4 w-4 text-warning" />,
  decision: <MessageCircle className="h-4 w-4 text-muted-foreground" />,
  safe: <ShieldCheck className="h-4 w-4 text-success" />,
};

export function ProgramStatusStrip({
  input,
  leading,
  onApply,
  onAskCleo,
  onGo,
  onFix,
}: {
  input: CheckInput;
  /** The block type chip, beside the score. */
  leading?: React.ReactNode;
  /** Apply the picked safe changes (the editor keeps Undo). */
  onApply: (patches: Patch[], words: string) => void;
  /** Hand an instruction to Adjust program (Cleo), never applied without the coach. */
  onAskCleo?: (text: string) => void;
  onGo: (at: Loc) => void;
  onFix: (gap: CompletenessGap) => void;
}) {
  const completeness = useMemo(() => programCompleteness(input), [input]);
  const [openScore, setOpenScore] = useState(false);
  const [openCheck, setOpenCheck] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 px-1" data-program-status>
      {leading}
      <button type="button" onClick={() => setOpenScore(true)} className="inline-flex h-9 items-center gap-2 rounded-full pl-1 pr-3 text-xs font-medium hover:bg-muted" data-completeness={completeness.score} aria-label={`Program ${completeness.score}% complete: see what's missing`}>
        <ScoreRing score={completeness.score} />
        <span className="tabular-nums">{completeness.score}%</span>
        <span className="text-muted-foreground max-sm:hidden">{completenessWord(completeness.score)}</span>
      </button>
      <span className="flex-1" />
      <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setOpenCheck(true)} data-program-check-open>
        <ClipboardCheck className="h-4 w-4" /> Check program
      </Button>
      {openScore && <CompletenessSheet open={openScore} onOpenChange={setOpenScore} completeness={completeness} input={input} onGo={(at) => { setOpenScore(false); onGo(at); }} onFix={(g) => { setOpenScore(false); onFix(g); }} />}
      {openCheck && <ProgramCheckSheet open={openCheck} onOpenChange={setOpenCheck} input={input} onApply={onApply} onAskCleo={onAskCleo ? (t) => { setOpenCheck(false); onAskCleo(t); } : undefined} onGo={(at) => { setOpenCheck(false); onGo(at); }} />}
    </div>
  );
}

function CompletenessSheet({ open, onOpenChange, completeness, onGo, onFix }: { open: boolean; onOpenChange: (o: boolean) => void; completeness: Completeness; input: CheckInput; onGo: (at: Loc) => void; onFix: (g: CompletenessGap) => void }) {
  return (
    <BuilderSheet open={open} onOpenChange={onOpenChange} title={`${completeness.score}% complete`} description="How fully the program is filled in for this athlete. It says nothing about how good it is: that's Check program." wide>
      <ul className="space-y-2" data-completeness-list>
        {completeness.items.map((it) => (
          <li key={it.key} className="rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              {it.status === "ok" ? <Check className="h-4 w-4 shrink-0 text-success" /> : <ScoreRing score={Math.round(it.score * 100)} size={18} />}
              <span className="min-w-0 flex-1 text-sm font-semibold">{it.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{Math.round(it.score * 100)}%</span>
            </div>
            <p className="mt-0.5 pl-6 text-xs text-muted-foreground">{it.detail}</p>
            {it.gaps.length > 0 && (
              <ul className="mt-2 space-y-1 pl-6">
                {it.gaps.slice(0, 8).map((g, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => (g.fix ? onFix(g) : g.at ? onGo(g.at) : undefined)}
                      disabled={!g.fix && !g.at}
                      className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-muted disabled:hover:bg-transparent"
                      data-completeness-gap={it.key}
                    >
                      <span className="min-w-0 flex-1">{g.text}</span>
                      {g.fix || g.at ? <span className="shrink-0 text-xs font-medium text-muted-foreground">Fix</span> : null}
                    </button>
                  </li>
                ))}
                {it.gaps.length > 8 && <li className="px-2 text-xs text-muted-foreground">and {it.gaps.length - 8} more</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </BuilderSheet>
  );
}

export function ProgramCheckSheet({
  open,
  onOpenChange,
  input,
  onApply,
  onAskCleo,
  onGo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  input: CheckInput;
  onApply: (patches: Patch[], words: string) => void;
  onAskCleo?: (text: string) => void;
  onGo: (at: Loc) => void;
}) {
  const [depth, setDepth] = useState<"quick" | "deep">("quick");
  const cleo = useCleoAccess();
  const findings = useMemo(() => programCheck(input, depth), [input, depth]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set());
  const shown = findings.filter((f) => !dismissed.has(f.id));
  const safe = shown.filter((f) => f.level === "safe");
  const picked = safe.filter((f) => !unpicked.has(f.id));
  const counts = LEVEL_ORDER.map((l) => [l, shown.filter((f) => f.level === l).length] as const).filter(([, n]) => n > 0);

  const apply = () => {
    const patches = picked.flatMap((f) => f.patches ?? []);
    if (!patches.length) return;
    onApply(patches, picked.map((f) => f.title.toLowerCase()).join(", "));
    setDismissed((d) => new Set([...d, ...picked.map((f) => f.id)]));
  };

  return (
    <BuilderSheet open={open} onOpenChange={onOpenChange} title="Check program" description={depth === "quick" ? "Quick polish: labels, order and notes. Nothing about the training changes." : "Deep review: programming, fatigue, progression, time and equipment. You decide every change."} wide>
      <div className="space-y-4" data-program-check={depth}>
        <div role="tablist" aria-label="How deep" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(["quick", "deep"] as const).map((d) => (
            <button key={d} type="button" role="tab" aria-selected={depth === d} onClick={() => setDepth(d)} className={cn("h-9 rounded-md text-sm font-medium transition", depth === d ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")} data-check-depth={d}>
              {d === "quick" ? "Quick polish" : "Deep review"}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
            <Check className="h-6 w-6 text-success" />
            <p className="text-sm font-medium">{depth === "quick" ? "Nothing to tidy." : "Nothing stands out."}</p>
            {depth === "quick" && <Button size="sm" variant="outline" onClick={() => setDepth("deep")}>Run a deep review</Button>}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground" data-check-summary>
              {counts.map(([l, n]) => `${n} ${l === "safe" ? "safe" : l === "decision" ? "for you to decide" : "important"}`).join(" · ")}
            </p>
            {LEVEL_ORDER.map((level) => {
              const list = shown.filter((f) => f.level === level);
              if (!list.length) return null;
              return (
                <section key={level} className="space-y-2" data-check-level={level}>
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    {LEVEL_ICON[level]} {LEVEL_TITLE[level]}
                  </h3>
                  {list.map((f) => (
                    <FindingCard
                      key={f.id}
                      f={f}
                      input={input}
                      picked={!unpicked.has(f.id)}
                      onPick={(v) => setUnpicked((s) => { const n = new Set(s); if (v) n.delete(f.id); else n.add(f.id); return n; })}
                      onGo={onGo}
                      onAskCleo={onAskCleo}
                      onDismiss={() => setDismissed((d) => new Set(d).add(f.id))}
                      askLabel={cleo ? "Ask Cleo to propose" : "Propose a fix"}
                    />
                  ))}
                </section>
              );
            })}
          </>
        )}
        {depth === "deep" && onAskCleo && (
          <button
            type="button"
            onClick={() => onAskCleo(DEEP_REVIEW_ASK)}
            className="flex w-full items-start gap-2 rounded-xl border border-border p-3 text-left hover:bg-muted/60"
            data-check-ask-cleo
          >
            <CleoAvatar size="sm" />
            <span>
              <span className="block text-sm font-semibold">{cleo ? "Ask Cleo for a head-coach review" : "Get a head-coach review"}</span>
              <span className="block text-xs text-muted-foreground">Reads the whole program against their history. Proposes changes you tick and apply, or ignore.</span>
            </span>
          </button>
        )}
        {safe.length > 0 && (
          <div className="sticky bottom-0 -mx-4 border-t border-border bg-background px-4 pb-1 pt-3">
            <Button className="h-11 w-full" disabled={!picked.length} onClick={apply} data-check-apply>
              {picked.length ? `Apply ${picked.length} safe improvement${picked.length === 1 ? "" : "s"}` : "Tick an improvement to apply"}
            </Button>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Undo is one tap after. Trained workouts are never changed.</p>
          </div>
        )}
      </div>
    </BuilderSheet>
  );
}

export const DEEP_REVIEW_ASK =
  "Deep review this whole program as a head coach: exercise selection, fatigue management, progression, recovery, scheduling, equipment, session length and how well each block fits its type and the athlete's goal. Only propose changes that clearly improve it, label each one (requested, data-backed or speculative), and don't change loads, volume, exercises or the schedule unless there's a clear reason you state. Leave trained workouts alone.";

function FindingCard({ f, picked, onPick, onGo, onAskCleo, onDismiss, askLabel }: { f: CheckFinding; input: CheckInput; picked: boolean; onPick: (v: boolean) => void; onGo: (at: Loc) => void; onAskCleo?: (t: string) => void; onDismiss: () => void; askLabel: string }) {
  const [open, setOpen] = useState(false);
  const safe = f.level === "safe";
  return (
    <div className={cn("rounded-xl border p-3", f.level === "warning" ? "border-warning/40 bg-warning/5" : "border-border")} data-check-finding={f.id}>
      <div className="flex items-start gap-2.5">
        {safe ? <Checkbox checked={picked} onCheckedChange={(v) => onPick(!!v)} aria-label={`Apply: ${f.title}`} className="mt-0.5" /> : null}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug">{f.title}</div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{f.detail}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {safe && (f.changes?.length ?? 0) > 0 && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <Eye className="mr-1 h-3.5 w-3.5" /> {open ? "Hide" : "Preview"} {f.changes!.length} change{f.changes!.length === 1 ? "" : "s"}
            <ChevronDown className={cn("ml-0.5 h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        )}
        {f.at.length > 0 && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => onGo(f.at[0])}>
            Show me
          </Button>
        )}
        {!safe && f.ask && onAskCleo && (
          <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => onAskCleo(f.ask!)} data-check-ask>
            {askLabel}
          </Button>
        )}
        {!safe && (
          <Button size="sm" variant="ghost" className="ml-auto h-8 px-2 text-xs text-muted-foreground" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
      {open && f.changes && (
        <ul className="mt-2 space-y-1.5 border-t border-border pt-2" data-check-preview>
          {f.changes.slice(0, 10).map((c, i) => (
            <li key={i} className="text-xs">
              <div className="font-medium">{c.where}</div>
              <div className="flex flex-wrap items-baseline gap-1 text-muted-foreground">
                <span className="line-through decoration-muted-foreground/50">{c.before}</span>
                <span aria-hidden>→</span>
                <span className="text-foreground">{c.after}</span>
              </div>
            </li>
          ))}
          {f.changes.length > 10 && <li className="text-xs text-muted-foreground">and {f.changes.length - 10} more like these</li>}
        </ul>
      )}
    </div>
  );
}
