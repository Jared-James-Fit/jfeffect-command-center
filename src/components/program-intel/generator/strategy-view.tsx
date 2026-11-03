/**
 * Stage 4 on screen: the recommended programming strategy, before anything is
 * built. What stays, what changes, what gets priority, what gets reduced and
 * how the cycle progresses, then each decision as Observation → Evidence →
 * Proposed change → Expected benefit → What to monitor. The coach keeps or
 * drops each decision and edits the wording, then approves it to build.
 */
import { useMemo, useState } from "react";
import { Check, Loader2, RotateCcw, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Strategy } from "@/lib/program-intel/generator-schemas";
import { KindChip } from "../sections";
import { SectionTitle } from "./overview";

type Item = Strategy["keep"][number];

function ItemList({ title, items, onChange, testId }: { title: string; items: Item[]; onChange?: (v: Item[]) => void; testId?: string }) {
  if (!items.length) return null;
  return (
    <div data-testid={testId}>
      <div className="mb-1 text-[12px] font-bold">{title}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[12px]">
            <div className="min-w-0 flex-1">
              <span className="font-semibold">{it.item}</span>
              {it.why ? <span className="text-muted-foreground"> · {it.why}</span> : null}
              {it.evidence.length > 0 && <div className="text-[11px] text-muted-foreground">Evidence: {it.evidence.join(" · ")}</div>}
            </div>
            {onChange && (
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Drop ${it.item}`} className="shrink-0 p-0.5 text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StrategySummary({ strategy, compact }: { strategy: Strategy; compact?: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed">{strategy.athlete_read}</p>
      {!compact && (
        <div className="rounded-xl bg-secondary/40 p-2.5 text-[12px]">
          <div><b>The last program was meant to:</b> {strategy.previous_program.intent || "—"}</div>
          <div className="mt-1"><b>What happened:</b> {strategy.previous_program.outcome || "—"}</div>
        </div>
      )}
      <ItemList title="A · What stays the same" items={strategy.keep} />
      <ItemList title="B · What changes" items={strategy.change} />
      <ItemList title="C · What gets priority" items={strategy.prioritize} />
      <ItemList title="D · What gets reduced or removed" items={strategy.reduce} />
      <div>
        <div className="mb-1 text-[12px] font-bold">E · How the new program progresses</div>
        <div className="space-y-1 text-[12px]">
          <div><b>Model:</b> {strategy.progression.model}</div>
          <div><b>Expected:</b> {strategy.progression.expected}</div>
          <div><b>Fatigue:</b> {strategy.progression.fatigue}</div>
          {strategy.progression.success_criteria.length > 0 && <div><b>Success looks like:</b> {strategy.progression.success_criteria.join(" · ")}</div>}
        </div>
      </div>
      <div className="rounded-xl bg-secondary/40 p-2.5 text-[12px]">
        <div className="font-bold">Structure: {strategy.structure.weeks} weeks · {strategy.structure.days_per_week} days{strategy.structure.session_minutes ? ` · ~${strategy.structure.session_minutes} min` : ""}</div>
        {strategy.structure.blocks.map((b, i) => (
          <div key={i} className="mt-1"><b>{b.name}</b> ({b.weeks} wk): {b.objective}{b.phases.length ? ` · ${b.phases.map((p) => `W${p.week} ${p.phase}`).join(", ")}` : ""}</div>
        ))}
        <div className="mt-2 grid gap-1">
          {strategy.weekly_layout.map((d) => (
            <div key={d.day}><b>Day {d.day}: {d.title}</b> · {d.focus}{d.primary.length ? ` · main: ${d.primary.join(", ")}` : ""}</div>
          ))}
        </div>
        {(strategy.frequency_targets.length > 0 || strategy.volume_targets.length > 0) && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            {strategy.frequency_targets.length > 0 && <div>Frequency: {strategy.frequency_targets.map((f) => `${f.target} ${f.per_week}×`).join(", ")}</div>}
            {strategy.volume_targets.length > 0 && <div>Weekly sets: {strategy.volume_targets.map((v) => `${v.target} ${v.sets_per_week}${v.vs_previous ? ` (${v.vs_previous})` : ""}`).join(", ")}</div>}
            {strategy.intensity && <div>Intensity: {strategy.intensity}</div>}
          </div>
        )}
      </div>
      {(strategy.data_limits.length > 0 || strategy.conflicts.length > 0) && (
        <div className="space-y-1 rounded-xl bg-amber-500/10 p-2.5 text-[12px] text-amber-900 dark:text-amber-100">
          {strategy.conflicts.map((c, i) => <div key={`c${i}`}><b>Conflict:</b> {c.description}{c.resolution ? ` → ${c.resolution}` : ""}</div>)}
          {strategy.data_limits.map((d, i) => <div key={`d${i}`}><b>Data limit:</b> {d}</div>)}
        </div>
      )}
    </div>
  );
}

export function DecisionCard({ d, on, onToggle, onEdit }: { d: Strategy["decisions"][number]; on?: boolean; onToggle?: () => void; onEdit?: (change: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={cn("space-y-1 rounded-xl border p-2.5 text-[12px]", on === false ? "border-dashed opacity-55" : "border-border/60")} data-testid="gen-decision">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <KindChip kind={d.basis} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{d.area || "decision"} · {d.confidence} confidence</span>
        </div>
        {onToggle && (
          <button type="button" onClick={onToggle} className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-bold", on ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground")} aria-pressed={on}>
            {on ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} {on ? "Keep" : "Dropped"}
          </button>
        )}
      </div>
      <div><span className="font-bold text-muted-foreground">Observation · </span>{d.observation}</div>
      {d.evidence.length > 0 && <div className="text-[11px] text-muted-foreground"><span className="font-bold">Evidence · </span>{d.evidence.join(" · ")}</div>}
      {editing && onEdit ? (
        <Textarea defaultValue={d.change} rows={3} className="text-[12px]" onBlur={(e) => { onEdit(e.target.value.trim() || d.change); setEditing(false); }} autoFocus />
      ) : (
        <button type="button" className="block text-left" onClick={() => onEdit && setEditing(true)}>
          <span className="font-bold text-muted-foreground">Change · </span>
          <span className="font-semibold">{d.change}</span>
          {onEdit ? <span className="ml-1 text-[10px] text-primary">edit</span> : null}
        </button>
      )}
      {d.benefit && <div><span className="font-bold text-muted-foreground">Expected benefit · </span>{d.benefit}</div>}
      {d.monitor && <div><span className="font-bold text-muted-foreground">Monitor · </span>{d.monitor}</div>}
    </div>
  );
}

export function StrategyReview({
  strategy,
  busy,
  onApprove,
  onRegenerate,
  onDiscard,
}: {
  strategy: Strategy;
  busy: boolean;
  onApprove: (s: Strategy) => void;
  onRegenerate: () => void;
  onDiscard: () => void;
}) {
  const [keep, setKeep] = useState(strategy.keep);
  const [change, setChange] = useState(strategy.change);
  const [prio, setPrio] = useState(strategy.prioritize);
  const [reduce, setReduce] = useState(strategy.reduce);
  const [on, setOn] = useState<boolean[]>(strategy.decisions.map(() => true));
  const [texts, setTexts] = useState<string[]>(strategy.decisions.map((d) => d.change));
  const edited = useMemo<Strategy>(
    () => ({
      ...strategy,
      keep,
      change,
      prioritize: prio,
      reduce,
      decisions: strategy.decisions.map((d, i) => ({ ...d, change: texts[i] })).filter((_, i) => on[i]),
    }),
    [strategy, keep, change, prio, reduce, on, texts],
  );
  const kept = on.filter(Boolean).length;
  return (
    <Card className="space-y-3 p-3.5" data-testid="gen-strategy">
      <SectionTitle hint="nothing is built yet">Recommended strategy</SectionTitle>
      <StrategySummary strategy={{ ...strategy, keep, change, prioritize: prio, reduce }} />
      <div className="space-y-1 text-[12px]">
        <ItemList title="Edit: what stays" items={keep} onChange={setKeep} />
        <ItemList title="Edit: what changes" items={change} onChange={setChange} />
        <ItemList title="Edit: priorities" items={prio} onChange={setPrio} />
        <ItemList title="Edit: reduced or removed" items={reduce} onChange={setReduce} />
      </div>
      <div className="space-y-2">
        <div className="text-[12px] font-bold">Decisions ({kept} of {strategy.decisions.length} kept)</div>
        {strategy.decisions.map((d, i) => (
          <DecisionCard key={i} d={{ ...d, change: texts[i] }} on={on[i]} onToggle={() => setOn(on.map((x, j) => (j === i ? !x : x)))} onEdit={(v) => setTexts(texts.map((x, j) => (j === i ? v : x)))} />
        ))}
      </div>
      {strategy.coach_requirements.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <div className="font-bold text-foreground">Your requirements</div>
          {strategy.coach_requirements.map((r, i) => <div key={i}>{r.status === "met" ? "✓" : r.status === "conflict" ? "⚠" : "–"} {r.requirement}{r.how ? `: ${r.how}` : ""}</div>)}
        </div>
      )}
      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
        <Button className="h-11" disabled={busy || kept === 0} onClick={() => onApprove(edited)} data-testid="gen-approve-strategy">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />} Approve and build the program
        </Button>
        <div className="flex gap-1.5">
          <Button variant="outline" className="h-10 flex-1" disabled={busy} onClick={onRegenerate}><RotateCcw className="mr-1.5 h-4 w-4" /> New strategy</Button>
          <Button variant="ghost" className="h-10 text-destructive" disabled={busy} onClick={onDiscard}><Trash2 className="mr-1.5 h-4 w-4" /> Discard</Button>
        </div>
      </div>
    </Card>
  );
}
