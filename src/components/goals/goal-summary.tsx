/**
 * The goal summary (Nov 26 2026, docs/GOAL_INTELLIGENCE.md): one compact card
 * placed where the coach already works (the client's Summary, Training, a
 * competition, a meeting), reading the one goal ledger. Each goal says, in
 * order: the client's target, Cleo's projection, the approved target,
 * feasibility and progress, time left and Cleo's recommended action, with the
 * reasoning (the six approaches, the pace, the source quote, the history) one
 * tap away. The coach approves, edits, dismisses or keeps the plan in place;
 * nothing here changes a program (a programming change is handed to the
 * Training tab's Cleo dock to show and apply), and the only message is the
 * client update, which waits in its review window with Preview, Edit, Hold,
 * Cancel and Send now.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, MessageSquare, Plus, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CompactWeightInput, draftKg, type WeightDraft } from "@/components/compact-weight-input";
import { dualRange, dualLoadText, inputKg, type DualWeight } from "@/lib/dual-weight";
import { WeightOther } from "@/components/dual-weight";
import { handOffToCleo } from "@/lib/cleo-handoff";
import {
  addGoalFn,
  decideGoalFn,
  decideGoalRecommendationFn,
  getClientGoalsFn,
  goalUpdateActionFn,
  setGoalUpdateSettingsFn,
} from "@/lib/goal-intel/goal-intel.functions";
import {
  APPROACH_LABEL,
  KIND_WORD,
  fmtClientTarget,
  type ApproachKey,
  type GoalKind,
  type GoalRow,
  type Lift,
  type Unit,
} from "@/lib/goal-intel/types";

export const clientGoalsKey = (clientId: string) => ["client-goals", clientId] as const;

type View = Awaited<ReturnType<typeof getClientGoalsFn>>;

const CONF_WORD: Record<string, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

/** A feasibility score's tone: green supported, amber a stretch, red very high risk (never a chance). */
function scoreTone(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-700 dark:text-emerald-300";
  if (score >= 30) return "text-amber-700 dark:text-amber-300";
  return "text-destructive";
}

function goalWeight(kg: number | null | undefined, unit: Unit, hi: number | null = null, recorded?: Unit): DualWeight | null {
  return kg == null || !Number.isFinite(Number(kg)) ? null : dualRange(Number(kg), hi, unit, recorded);
}
function sourceKg(value: number | null, unit: Unit | null, fallback: number | null): number | null {
  return value != null && unit ? inputKg(Number(value), unit) : fallback;
}
function goalDisplayUnit(g: GoalRow, unit: Unit): Unit {
  return g.competition_id && (g.kind === "lift" || g.kind === "total" || g.kind === "bodyweight") ? "kg" : unit;
}
function WeightWords({ weight }: { weight: DualWeight | null }) {
  return weight ? <>{weight.primary} <WeightOther className="text-[10px]">({weight.secondary})</WeightOther></> : <>—</>;
}
const approvedWords = (g: GoalRow, unit: Unit) => goalWeight(sourceKg(g.approved_value, g.approved_unit, g.approved_kg), unit, null, g.approved_unit ?? undefined);


/** The top of the client's own range, in their unit, for "Approve 225 lb". */
const clientTop = (g: GoalRow) => (g.client_value != null && g.client_unit ? `${Number(g.client_value_max ?? g.client_value)} ${g.client_unit}` : null);

const ago = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "";

export function GoalSummary({
  clientId,
  competitionId,
  compact = false,
  hideWhenEmpty = false,
  onOpenTraining,
  className,
}: {
  clientId: string;
  /** only the goals at this competition (Competition Intelligence) */
  competitionId?: string | null;
  /** a slimmer card (Training, a competition, a meeting) */
  compact?: boolean;
  hideWhenEmpty?: boolean;
  /** where a programming recommendation goes (the Training tab's Cleo dock) */
  onOpenTraining?: () => void;
  className?: string;
}) {
  const read = useServerFn(getClientGoalsFn);
  const q = useQuery({ queryKey: clientGoalsKey(clientId), queryFn: () => read({ data: { clientId } }), staleTime: 60_000 });
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const view = q.data;
  const goals = useMemo(() => {
    const all = (view?.goals ?? []) as GoalRow[];
    return competitionId ? all.filter((g) => g.competition_id === competitionId) : all;
  }, [view, competitionId]);
  const open = goals.filter((g) => g.status === "proposed" || g.status === "active");
  // what needs the coach first: proposed, then an open recommendation, then the rest by date
  const ordered = [...open].sort((a, b) => rank(a) - rank(b) || String(a.deadline ?? "9999").localeCompare(String(b.deadline ?? "9999")));
  const closed = goals.filter((g) => g.status === "achieved" || g.status === "missed").slice(-5).reverse();
  const toReview = open.filter((g) => g.status === "proposed").length + open.filter((g) => g.recommendation_status === "open").length;

  if (q.isPending) return compact ? null : <Card className={cn("h-24 animate-none bg-muted/40", className)} aria-busy />;
  if (q.isError) {
    return compact ? null : (
      <Card className={cn("p-4 text-sm text-muted-foreground", className)}>
        Goals couldn't load. <button className="underline" onClick={() => q.refetch()}>Try again</button>
      </Card>
    );
  }
  if (!view) return null;
  if (!open.length && !view.outbox && hideWhenEmpty) return null;
  const unit = view.unit as Unit;

  return (
    <Card className={cn("min-w-0 p-4", className)} data-goal-summary aria-label="Goals">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Target className="h-4 w-4 text-muted-foreground" aria-hidden /> Goals
          {toReview > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200" data-goals-to-review>
              {toReview} to review
            </span>
          )}
        </h3>
        <Button variant="ghost" size="sm" className="h-9" onClick={() => setAdding(true)} aria-label="Add a goal">
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>

      {!open.length && (
        <p className="mt-2 text-sm text-muted-foreground">
          No goals yet. They come from meetings, check-ins and their messages for you to approve, or add one.
        </p>
      )}

      <ul className="mt-2 divide-y divide-border">
        {groupCompetitionGoals(ordered).map((group) => group.length === 1 ? (
          <GoalItem key={group[0].id} g={group[0]} view={view} unit={unit} compact={compact} onOpenTraining={onOpenTraining} />
        ) : (
          <CompetitionGoalGroup key={group[0].competition_id} goals={group} view={view} unit={unit} onOpenTraining={onOpenTraining} />
        ))}
      </ul>

      {view.outbox && <OutboxRow key={`${view.outbox.id}:${view.outbox.updated_at}`} view={view} />}

      {closed.length > 0 && (
        <div className="mt-2">
          <button className="flex min-h-9 items-center gap-1 text-xs text-muted-foreground" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Past goals ({closed.length})
          </button>
          {showClosed && (
            <ul className="space-y-1 text-xs">
              {closed.map((g) => (
                <li key={g.id} className="flex justify-between gap-2" data-goal-outcome={g.status}>
                  <span className="truncate">{g.title}</span>
                  <span className={g.status === "achieved" ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>
                    {g.status === "achieved" ? "Achieved" : "Missed"}
                    {g.outcome?.actualKg != null ? ` · ${dualLoadText(g.outcome.actualKg, goalDisplayUnit(g, unit))}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {adding && <AddGoalDialog view={view} competitionId={competitionId ?? null} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function groupCompetitionGoals(goals: GoalRow[]): GoalRow[][] {
  const seen = new Set<string>();
  const result: GoalRow[][] = [];
  for (const g of goals) {
    if (seen.has(g.id)) continue;
    const group = g.competition_id && g.kind === "lift"
      ? goals.filter(x => x.kind === "lift" && x.competition_id === g.competition_id)
      : [g];
    // Keep ambiguous or duplicate lifts individual rather than implying a total.
    const unique = group.every(x => x.lift) && new Set(group.map(x => x.lift)).size === group.length;
    const rows = unique && group.length > 1
      ? [...group].sort((a, b) => ["squat", "bench", "deadlift"].indexOf(a.lift ?? "") - ["squat", "bench", "deadlift"].indexOf(b.lift ?? ""))
      : [g];
    rows.forEach(x => seen.add(x.id));
    result.push(rows);
  }
  return result;
}

function CompetitionGoalGroup({ goals, view, unit, onOpenTraining }: { goals: GoalRow[]; view: View; unit: Unit; onOpenTraining?: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const first = goals[0];
  const qc = useQueryClient();
  const decide = useServerFn(decideGoalFn);
  const [drafts, setDrafts] = useState<Record<string, { draft: WeightDraft; version: number; rounded?: boolean }>>({});
  const proposed = goals.filter(g => g.status === "proposed");
  const draftFor = (g: GoalRow): WeightDraft => drafts[g.id]?.version === g.version ? drafts[g.id].draft : {
    value: String(g.client_value_max ?? g.client_value ?? ""),
    unit: g.client_unit ?? "kg",
  };
  const isValid = (g: GoalRow) => {
    const d = draftFor(g);
    const kg = draftKg(d);
    return kg != null && kg > 0 && kg <= 1500 && Number(d.value) <= 3000 && (g.client_unit != null || drafts[g.id]?.version === g.version);
  };
  const batch = useMutation({
    mutationFn: async (items: Array<{ g: GoalRow; draft: WeightDraft; rounded?: boolean }>) => {
      let saved = 0;
      for (const { g, draft, rounded } of items) {
        try {
          await decide({ data: { goalId: g.id, decision: { action: "approve", value: Number(draft.value), unit: draft.unit, expectedVersion: g.version, changeReason: rounded ? "round_up" : undefined, clientFacing: g.client_facing } } });
          saved++;
        } catch (error) {
          throw new Error(`${saved} of ${items.length} targets saved. ${error instanceof Error ? error.message : "Refresh and review the remaining targets."}`);
        }
      }
      return saved;
    },
    onSuccess: n => { setSelected(null); toast.success(`${n} targets approved`); },
    onError: error => toast.error(error.message),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: clientGoalsKey(first.client_id) });
      qc.invalidateQueries({ queryKey: ["competition-workspace", first.client_id] });
    },
  });
  const comp = view.competitions.find(c => c.id === first.competition_id);
  const projected = goals.map(g => g.feasibility?.projection?.expectedKg ?? null);
  const proposedKg = goals.map(g => g.status === "proposed" && isValid(g) ? draftKg(draftFor(g)) : g.status === "active" ? sourceKg(g.approved_value, g.approved_unit, g.approved_kg) : null);
  const total = (xs: Array<number | null>) => goals.length === 3 && xs.every(x => x != null)
    ? goalWeight(xs.reduce<number>((sum, x) => sum + (x ?? 0), 0), "kg") : null;
  const sources = [...new Set(goals.map(g => g.source_kind ? (SOURCE_WORD[g.source_kind] ?? "On file") + (g.source_at ? " · " + ago(g.source_at) : "") : null).filter(Boolean))];
  return <li className="py-3" data-competition-goal-group>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{first.event_title ?? "Competition targets"}</p>
        {sources.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">Source: {sources.join(" / ")}</p>}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{first.feasibility?.timeLeft?.line ?? ""}</span>
    </div>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[300px] text-left text-xs tabular-nums">
        <thead className="text-muted-foreground"><tr><th className="py-1 font-normal">Lift</th><th className="py-1 font-normal">Discussed</th><th className="py-1 font-normal">Projected</th><th className="py-1 font-normal">Proposed / approved</th><th><span className="sr-only">Review</span></th></tr></thead>
        <tbody>
          {goals.map((g, i) => {
            const discussed = g.client_unit ? goalWeight(sourceKg(g.client_value, g.client_unit, g.client_kg), "kg", sourceKg(g.client_value_max, g.client_unit, g.client_kg_max), g.client_unit) : null;
            const proj = goalWeight(projected[i], "kg");
            const target = goalWeight(proposedKg[i], "kg");
            return <tr key={g.id} className="border-t border-border align-top">
              <th className="py-2 pr-2 font-medium capitalize">{g.lift}{g.feasibility?.headline && <span className="block text-[10px] font-normal normal-case text-muted-foreground" title={g.feasibility.headline}>{g.feasibility.score == null ? "Unscored" : g.feasibility.score >= 70 ? "Supported" : g.feasibility.score >= 30 ? "Stretch" : "High risk"}</span>}</th>
              <td className="py-2 pr-2">{discussed ? <>{discussed.primary}<span className="block text-muted-foreground">{discussed.secondary}{g.client_unit_source === "inferred" ? " · inferred" : ""}</span></> : fmtClientTarget(g) ?? "—"}</td>
              <td className="py-2 pr-2">{proj ? <>{proj.primary}<span className="block text-muted-foreground">{proj.secondary}</span></> : "—"}</td>
              <td className="py-2 pr-2">{target ? <>{target.primary}<span className="block text-muted-foreground">{target.secondary} · {g.status === "active" ? "Approved" : "Proposed"}</span></> : "Needs review"}</td>
              <td className="py-1 text-right"><Button variant="ghost" size="sm" className="h-8 px-2" disabled={batch.isPending} aria-expanded={selected === g.id} onClick={() => setSelected(selected === g.id ? null : g.id)}>{selected === g.id ? "Close" : g.status === "proposed" ? "Edit / review" : "Edit"}</Button></td>
            </tr>;
          })}
          {goals.length === 3 && <tr className="border-t border-border"><th className="py-2 font-semibold">Total</th><td>—</td><td><WeightWords weight={total(projected)} /></td><td><WeightWords weight={total(proposedKg)} /></td><td /></tr>}
        </tbody>
      </table>
    </div>
    {selected && goals.some(g => g.id === selected) && (() => {
      const g = goals.find(g => g.id === selected)!;
      return g.status === "proposed" ? <div className="mt-2 rounded-lg border border-border p-2 space-y-2">
        <p className="text-xs font-medium">{g.title}</p>
        {(g.source_quote || g.source_context) && <p className="text-xs text-muted-foreground">{g.source_quote ?? g.source_context}</p>}
        {g.feasibility?.headline && <p className="text-xs text-muted-foreground">{g.feasibility.headline}</p>}
        <CompactWeightInput key={g.id} draft={draftFor(g)} onChange={(draft, rounded) => setDrafts(old => ({ ...old, [g.id]: { draft, rounded, version: g.version } }))} incrementKg={comp?.incrementKg ?? 2.5} confirmed={comp?.rulesConfirmed} disabled={batch.isPending} />
        <Button size="sm" className="h-9" disabled={batch.isPending || !isValid(g)} onClick={() => batch.mutate([{ g, draft: draftFor(g), rounded: drafts[g.id]?.rounded }])}>Approve this target</Button>
        <details><summary className="cursor-pointer text-xs text-muted-foreground">Other options and history</summary><ul><GoalItem key={g.id} g={g} view={view} unit={unit} compact onOpenTraining={onOpenTraining} /></ul></details>
      </div> : <ul className="mt-1 rounded-lg border border-border px-3"><GoalItem key={g.id} g={g} view={view} unit={unit} compact onOpenTraining={onOpenTraining} /></ul>;
    })()}
    {proposed.length > 0 && <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] text-muted-foreground">Proposed targets use the discussed range's upper end unless edited. Confirm inferred units before approval.</p>
      <Button size="sm" className="h-9" disabled={batch.isPending || !proposed.every(isValid)} onClick={() => batch.mutate(proposed.map(g => ({ g, draft: draftFor(g), rounded: drafts[g.id]?.rounded })))}>{batch.isPending ? "Saving…" : `Approve ${proposed.length} pending target${proposed.length === 1 ? "" : "s"}`}</Button>
    </div>}
  </li>;
}

function rank(g: GoalRow) {
  if (g.status === "proposed" && g.kind !== "preference") return 0;
  if (g.recommendation_status === "open") return 1;
  if (g.kind === "preference") return 3;
  return 2;
}

function useGoalMutations(clientId: string) {
  const qc = useQueryClient();
  const decide = useServerFn(decideGoalFn);
  const decideRec = useServerFn(decideGoalRecommendationFn);
  const done = () => {
    qc.invalidateQueries({ queryKey: clientGoalsKey(clientId) });
    qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
  };
  const goal = useMutation({
    mutationFn: (x: { goalId: string; decision: any }) => decide({ data: x }),
    onSuccess: done,
    onError: (e: any) => toast.error(e?.message ?? "That didn't save."),
  });
  const rec = useMutation({
    mutationFn: (x: { goalId: string; action: "approve" | "dismiss" | "maintain"; value?: number | null; unit?: Unit | null }) => decideRec({ data: x }),
    onSuccess: done,
    onError: (e: any) => toast.error(e?.message ?? "That didn't save."),
  });
  return { goal, rec };
}

function GoalItem({ g, view, unit, compact, onOpenTraining }: { g: GoalRow; view: View; unit: Unit; compact: boolean; onOpenTraining?: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoreDraft, setRestoreDraft] = useState<WeightDraft | null>(null);
  unit = goalDisplayUnit(g, unit);
  const { goal, rec } = useGoalMutations(g.client_id);
  const f = g.feasibility;
  const busy = goal.isPending || rec.isPending;
  const said = g.client_value != null && !g.client_unit ? null : fmtClientTarget(g);
  const approved = approvedWords(g, unit);
  const clientWeight = g.client_unit ? goalWeight(sourceKg(g.client_value, g.client_unit, g.client_kg), unit, sourceKg(g.client_value_max, g.client_unit, g.client_kg_max), g.client_unit) : null;
  const projected = goalWeight(f?.projection?.expectedKg, unit);
  const comp = view.competitions.find(c => c.id === g.competition_id);
  const measurable = g.kind === "lift" || g.kind === "total" || g.kind === "bodyweight";
  const recOpen = g.recommendation_status === "open" && g.recommendation;
  const first = view.firstName ?? "them";

  const approveAs = (decision: any, msg: string) => goal.mutate({ goalId: g.id, decision }, { onSuccess: () => toast.success(msg) });

  return (
    <li className="py-3" data-goal={g.kind} data-goal-status={g.status}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{g.title}</p>
          {g.kind === "preference" && <p className="text-xs text-muted-foreground">{g.client_text ?? g.approved_text}</p>}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-goal-time>
          {f?.timeLeft?.line ?? (g.deadline ? g.deadline : "No date")}
        </span>
      </div>

      {g.source_kind && (
        <div className="mt-1 text-xs leading-snug text-muted-foreground" data-goal-source>
          <span className="font-medium">{SOURCE_WORD[g.source_kind] ?? "On file"}{g.source_at ? ` · ${ago(g.source_at)}` : ""}</span>
          {g.source_speaker ? ` · ${g.source_speaker === "unclear" ? "Speaker unconfirmed" : g.source_speaker === "athlete" ? "Athlete" : "Coach"}` : ""}
          {g.source_quote ? <p className="mt-0.5">“{g.source_quote}”</p> : g.source_context ? <p className="mt-0.5">{g.source_context}</p> : null}
        </div>
      )}

      {g.kind !== "preference" && (
        <dl className="mt-1.5 grid grid-cols-3 gap-2 text-xs" data-goal-numbers>
          <Num label="Client" value={clientWeight?.primary ?? said ?? (g.client_value != null ? "Unit needed" : "—")} secondary={clientWeight?.secondary} note={g.client_unit_source === "inferred" ? "unit inferred" : g.tentative ? "tentative" : null} />
          <Num
            label="Projected"
            value={projected?.primary ?? (measurable ? "—" : "Not scored")}
            secondary={projected?.secondary}
          />
          <Num label="Approved" value={approved?.primary ?? g.approved_text ?? "—"} secondary={approved?.secondary} strong={!!approved} note={g.approved_approach ? APPROACH_LABEL[g.approved_approach] : null} />
        </dl>
      )}

      {f && (
        <div className="mt-2" data-goal-feasibility>
          <p className={cn("text-xs", scoreTone(f.score))} title={f.headline + " · " + CONF_WORD[f.confidence]}>
            {f.score == null ? "Not enough data" : f.score >= 70 ? "Supported" : f.score >= 30 ? "Stretch target" : "High risk"}
            {f.recommendedWhy ? <span className="text-muted-foreground"> · {f.recommendedWhy}</span> : f.action?.line ? <span className="text-muted-foreground"> · {f.action.line}</span> : null}
          </p>
          {f.progress?.line && !compact && <p className="text-[11px] text-muted-foreground">Progress: {f.progress.line}{f.progress.pct != null ? ` (${f.progress.pct}%)` : ""}</p>}
        </div>
      )}

      {/* Cleo's recommended action and the coach's choices */}
      {g.status === "proposed" && g.kind !== "preference" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {measurable && said ? (
            <Button size="sm" className="h-9" disabled={busy} onClick={() => approveAs({ action: "approve" }, `Approved ${clientTop(g) ?? ""}`.trim())} data-goal-approve>
              Approve {clientWeight ? <WeightWords weight={goalWeight(sourceKg(g.client_value_max ?? g.client_value, g.client_unit, g.client_kg_max ?? g.client_kg), unit, null, g.client_unit ?? undefined)} /> : clientTop(g)}
            </Button>
          ) : !measurable ? (
            <Button size="sm" className="h-9" disabled={busy} onClick={() => approveAs({ action: "approve" }, "Kept as a goal")} data-goal-approve>
              Keep as a goal
            </Button>
          ) : null}
          {measurable && f?.recommended && f.approaches?.length ? (
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              disabled={busy}
              onClick={() => approveAs({ action: "approve", approach: f.recommended }, `Approved ${APPROACH_LABEL[f.recommended as ApproachKey]}`)}
              data-goal-approve-recommended
            >
              {APPROACH_LABEL[f.recommended]} <WeightWords weight={goalWeight(f.approaches.find((a) => a.key === f.recommended)?.targetKg, unit)} />
            </Button>
          ) : null}
          {measurable && (
            <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => approveAs({ action: "dismiss" }, "Dismissed")}>
            Dismiss
          </Button>
        </div>
      )}
      {g.status === "proposed" && g.kind === "preference" && (
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => approveAs({ action: "approve" }, "Kept with the event")}>
            Keep
          </Button>
          <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => approveAs({ action: "dismiss" }, "Dismissed")}>
            Dismiss
          </Button>
        </div>
      )}
      {g.status === "active" && recOpen && g.recommendation && (
        <div className="mt-2 rounded-lg bg-muted/50 p-2.5" data-goal-recommendation={g.recommendation.kind}>
          <p className="text-xs font-medium">Cleo: {g.recommendation.line}</p>
          {g.recommendation.benefit && <p className="text-[11px] text-muted-foreground">Expected benefit: {g.recommendation.benefit.toLowerCase()}.</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() =>
                rec.mutate(
                  { goalId: g.id, action: "approve" },
                  {
                    onSuccess: (out: any) => {
                      if (out?.handoff) {
                        handOffToCleo(g.client_id, "training", out.handoff);
                        toast.success("Approved. It's in Training's Cleo box to review and apply.");
                        onOpenTraining?.();
                      } else toast.success("Approved");
                    },
                  },
                )
              }
            >
              {g.recommendation.kind === "adjust_program" ? "Adjust programming" : g.recommendation.suggestedKg != null ? `Approve ${dualLoadText(g.recommendation.suggestedKg, unit)}` : "Approve"}
            </Button>
            {g.recommendation.suggestedKg != null && (
              <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => rec.mutate({ goalId: g.id, action: "maintain" }, { onSuccess: () => toast.success("Keeping the current plan") })}>
              Keep plan
            </Button>
            <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => rec.mutate({ goalId: g.id, action: "dismiss" }, { onSuccess: () => toast.success("Dismissed") })}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {g.status === "active" && !recOpen && measurable && !editing && (
        <Button size="sm" variant="outline" className="mt-2 h-9" disabled={busy} onClick={() => setEditing(true)}>Edit target</Button>
      )}
      {g.status === "active" && !recOpen && f?.action && f.action.kind === "maintain" && !compact && (
        <p className="mt-1 text-[11px] text-muted-foreground">{f.action.line}</p>
      )}

      {editing && <EditGoalInline g={g} view={view} unit={unit} initial={restoreDraft} incrementKg={g.kind === "lift" && g.competition_id ? comp?.incrementKg ?? 2.5 : undefined} confirmed={comp?.rulesConfirmed} onClose={() => { setEditing(false); setRestoreDraft(null); }} />}
      <div className="mt-1 flex items-center gap-3">
        <button type="button" className="flex min-h-9 items-center gap-1 text-xs text-muted-foreground" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Details
        </button>
        <button type="button" className="flex min-h-9 items-center gap-1 text-xs text-muted-foreground" onClick={() => setHistoryOpen(v => !v)} aria-expanded={historyOpen}>
          {historyOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} History
        </button>
      </div>
      {open && <GoalDetails g={g} view={view} unit={unit} busy={busy} onApprove={approveAs} first={first} />}
      {historyOpen && <GoalHistory g={g} view={view} unit={unit} onRestore={g.status === "active" && !editing ? d => { setRestoreDraft(d); setEditing(true); } : undefined} />}
    </li>
  );
}

function Num({ label, value, secondary, note, strong }: { label: string; value: string; secondary?: string; note?: string | null; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("break-words tabular-nums", strong ? "font-semibold" : "")}>{value}</dd>
      {secondary && <dd><WeightOther className="text-[10px]">({secondary})</WeightOther></dd>}
      {note && <dd className="truncate text-[10px] text-muted-foreground">{note}</dd>}
    </div>
  );
}

function GoalDetails({ g, view, unit, busy, onApprove, first }: { g: GoalRow; view: View; unit: Unit; busy: boolean; onApprove: (d: any, msg: string) => void; first: string }) {
  const f = g.feasibility;
  const { goal } = useGoalMutations(g.client_id);
  return (
    <div className="mt-1 space-y-2 rounded-lg border border-border p-2.5 text-xs" data-goal-details>
      {f?.approaches?.length ? (
        <div>
          <p className="mb-1 font-medium">Approaches</p>
          <ul className="space-y-1" data-goal-approaches>
            {f.approaches.map((a) => (
              <li key={a.key} className={cn("flex items-center justify-between gap-2", f.band === a.key && "font-medium")}>
                <span className="min-w-0">
                  {a.label}
                  {f.recommended === a.key ? <span className="text-muted-foreground"> · recommended</span> : null}
                  <span className="block truncate text-[10px] text-muted-foreground">{a.line}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  <WeightWords weight={goalWeight(a.targetKg, unit)} /> · {a.score}
                  <Button size="sm" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => onApprove({ action: "approve", approach: a.key }, `Approved ${a.label}`)}>
                    Use
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {f.recommendedWhy && <p className="mt-1 text-muted-foreground">Why {APPROACH_LABEL[f.recommended as ApproachKey] ?? "this"}: {f.recommendedWhy}.</p>}
        </div>
      ) : null}
      {f?.pace?.requiredPctPerWeek != null && (
        <p className="text-muted-foreground">
          Pace: needs {f.pace.requiredPctPerWeek}% a week
          {f.pace.demonstratedPctPerWeek != null ? `; they've shown ${f.pace.demonstratedPctPerWeek}%` : ""}
          {f.pace.usualPctPerWeek ? ` (usual ${f.pace.usualPctPerWeek[0]}–${f.pace.usualPctPerWeek[1]}%)` : ""}.
        </p>
      )}
      {f?.projection && <p className="text-muted-foreground">Projected range: <WeightWords weight={goalWeight(f.projection.lowKg, unit, f.projection.highKg)} /></p>}
      {f?.projection?.basis?.length ? <p className="text-muted-foreground">Projection from: {f.projection.basis.join("; ")}.</p> : null}
      {f?.reasons?.length ? <p className="text-muted-foreground">{f.reasons.join(" · ")}</p> : null}
      {f?.missing?.length ? <p className="text-amber-700 dark:text-amber-300">Missing: {f.missing.join("; ")}</p> : null}
      {g.source_quote && (
        <p className="text-muted-foreground">
          “{g.source_quote}” <span className="whitespace-nowrap">· {SOURCE_WORD[g.source_kind ?? ""] ?? "on file"}{g.source_at ? `, ${ago(g.source_at)}` : ""}</span>
        </p>
      )}
      {g.source_context && !g.source_quote && <p className="text-muted-foreground">{g.source_context}</p>}
      {g.status === "active" && (
        <label className="flex min-h-9 items-center justify-between gap-2">
          <span>Tell {first} when it changes</span>
          <Switch checked={g.client_facing} onCheckedChange={(v) => goal.mutate({ goalId: g.id, decision: { action: "client_facing", clientFacing: v } })} />
        </label>
      )}
      {g.status === "active" && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => onApprove({ action: "result", result: "achieved" }, "Marked achieved")}>
            Achieved
          </Button>
          <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => onApprove({ action: "result", result: "missed" }, "Marked missed")}>
            Missed
          </Button>
          <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => onApprove({ action: "archive" }, "Closed")}>
            Close goal
          </Button>
        </div>
      )}

    </div>
  );
}

const SOURCE_WORD: Record<string, string> = {
  meeting: "said in a meeting",
  checkin: "their check-in",
  message: "their message",
  coach: "set by the coach",
  profile: "their profile",
  competition: "the competition",
  form: "a form",
};
const HISTORY_WORD: Record<string, string> = {
  proposed: "Read from what they said",
  approved: "Approved",
  edited: "Target changed",
  dismissed: "Dismissed",
  archived: "Closed",
  achieved: "Achieved",
  missed: "Missed",
  created: "Added",
  synced: "Updated elsewhere in the app",
  recommendation: "Cleo recommended a change",
  recommendation_approved: "Recommendation approved",
  recommendation_dismissed: "Recommendation dismissed",
  plan_maintained: "Kept the current plan",
  client_target_changed: "Their target changed",
  client_update_queued: "Update for them prepared",
  client_told: "They were told",
};

function GoalHistory({ g, view, unit, onRestore }: { g: GoalRow; view: View; unit: Unit; onRestore?: (d: WeightDraft) => void }) {
  const [limit, setLimit] = useState(5);
  const history = (view.history ?? []).filter(h => h.goal_id === g.id);
  return (
    <div className="mt-1 space-y-2 rounded-lg border border-border p-2.5 text-xs" data-goal-history>
      {!history.length && <p className="text-muted-foreground">No recorded changes yet.</p>}
      {history.slice(0, limit).map((h, i) => {
        const before = h.detail?.before;
        const after = h.detail?.after;
        const b = goalWeight(sourceKg(before?.approved_value ?? null, before?.approved_unit ?? null, before?.approved_kg ?? null), unit);
        const a = goalWeight(sourceKg(after?.approved_value ?? null, after?.approved_unit ?? null, after?.approved_kg ?? null), unit);
        const changed = before?.approved_kg !== after?.approved_kg;
        const actor = h.actor === "cleo" ? "Cleo" : h.actor === "coach" ? "Coach" : h.actor === "athlete" ? "Athlete" : "System";
        const prev = before?.approved_kg != null ? { value: String(before.approved_value ?? before.approved_kg), unit: (before.approved_unit === "lb" && before.approved_value != null ? "lb" : "kg") as Unit } : null;
        return <div key={h.at + i} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
          <p className="font-medium">{HISTORY_WORD[h.action] ?? h.action.replace(/_/g, " ")}</p>
          {changed && (a || b) && <p className="mt-0.5 tabular-nums"><WeightWords weight={b} /> → <WeightWords weight={a} /></p>}
          {h.detail?.change_reason === "round_up" && <p className="text-[11px] text-muted-foreground">Rounded up to the meet increment.</p>}
          {h.detail?.change_reason === "restore" && <p className="text-[11px] text-muted-foreground">Restored previous target.</p>}
          {h.action === "recommendation" && typeof h.detail?.suggested_kg === "number" && <p className="text-muted-foreground">Suggested: <WeightWords weight={goalWeight(h.detail.suggested_kg, unit)} /></p>}
          <p className="text-[11px] text-muted-foreground">{actor} · {new Date(h.at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
          {changed && prev && onRestore && (h.action === "edited" || h.action === "approved") && <Button type="button" variant="ghost" size="sm" className="mt-1 h-8 px-2" onClick={() => onRestore(prev)}>Restore previous target</Button>}
        </div>;
      })}
      {history.length > limit && <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setLimit(v => v + 5)}>Show older changes</Button>}
    </div>
  );
}

function EditGoalInline({ g, view, unit, initial, incrementKg, confirmed, onClose }: { g: GoalRow; view: View; unit: Unit; initial: WeightDraft | null; incrementKg?: number; confirmed?: boolean; onClose: () => void }) {
  const u0 = g.approved_unit ?? g.client_unit ?? unit;
  const suggested = g.recommendation_status === "open" ? g.recommendation?.suggestedKg : null;
  const start: WeightDraft = suggested != null ? { value: String(suggested), unit: "kg" }
    : g.approved_value != null && g.approved_unit ? { value: String(g.approved_value), unit: g.approved_unit }
    : g.approved_kg != null ? { value: String(g.approved_kg), unit: "kg" }
    : g.client_unit ? { value: String(g.client_value_max ?? g.client_value ?? ""), unit: g.client_unit }
    : { value: "", unit: u0 };
  const [draft, setDraft] = useState<WeightDraft>(initial ?? start);
  const [reason, setReason] = useState<"round_up" | "restore" | undefined>(initial ? "restore" : undefined);
  const [deadline, setDeadline] = useState(g.deadline ?? "");
  const [tell, setTell] = useState(g.client_facing);
  const [settings, setSettings] = useState(false);
  const { goal } = useGoalMutations(g.client_id);
  const kg = draftKg(draft);
  const unchanged = g.status === "active" && g.recommendation_status !== "open" && kg != null && g.approved_kg != null
    && Math.abs(kg - (sourceKg(g.approved_value, g.approved_unit, g.approved_kg) ?? -1)) < 1e-7
    && (g.competition_id || (deadline || null) === g.deadline) && tell === g.client_facing;
  const valid = kg != null && kg <= 1500 && Number(draft.value) <= 3000 && !unchanged;
  const save = () => {
    if (!valid || goal.isPending) return;
    goal.mutate({ goalId: g.id, decision: { action: "approve", value: Number(draft.value), unit: draft.unit, expectedVersion: g.version, changeReason: reason, deadline: g.competition_id ? undefined : deadline || null, clientFacing: tell } },
      { onSuccess: () => { toast.success("Target saved"); onClose(); } });
  };
  return <form className="mt-2 rounded-lg border border-border p-2" onSubmit={e => { e.preventDefault(); save(); }} data-goal-edit>
    {initial && <p className="mb-1 text-xs text-muted-foreground">Restore previous target — save to confirm.</p>}
    <div className="flex flex-wrap items-start justify-between gap-1.5">
      <CompactWeightInput draft={draft} onChange={(d, rounded) => { setDraft(d); setReason(rounded ? "round_up" : initial ? "restore" : undefined); }} autoFocus incrementKg={incrementKg} confirmed={confirmed} disabled={goal.isPending} />
      <div className="flex items-center gap-1">
        <Button type="submit" size="sm" className="h-9" disabled={!valid || goal.isPending}>{goal.isPending ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" variant="ghost" className="h-9 px-2" disabled={goal.isPending} onClick={onClose}>Cancel</Button>
      </div>
    </div>
    <button type="button" className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setSettings(v => !v)} aria-expanded={settings}>More options</button>
    {settings && <div className="mt-2 space-y-2 text-xs">
      {!g.competition_id && <label className="block">Target date<Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="mt-1 h-9" /></label>}
      <label className="flex min-h-9 items-center justify-between gap-2"><span>Tell {view.firstName ?? "them"} after review</span><Switch checked={tell} onCheckedChange={setTell} /></label>
    </div>}
  </form>;
}

const ADD_KINDS: Array<{ kind: GoalKind; label: string }> = [
  { kind: "lift", label: "Lift" },
  { kind: "total", label: "Total" },
  { kind: "bodyweight", label: "Bodyweight" },
  { kind: "physique", label: "Physique" },
  { kind: "performance", label: "Strength" },
  { kind: "event", label: "Event" },
];

function AddGoalDialog({ view, competitionId, onClose }: { view: View; competitionId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const add = useServerFn(addGoalFn);
  const [kind, setKind] = useState<GoalKind>("lift");
  const [lift, setLift] = useState<Lift>("squat");
  const [draft, setDraft] = useState<WeightDraft>({ value: "", unit: competitionId ? "kg" : view.unit as Unit });
  const value = draft.value;
  const u = draft.unit;
  const [deadline, setDeadline] = useState("");
  const [comp, setComp] = useState<string>(competitionId ?? "none");
  const [text, setText] = useState("");
  const [tell, setTell] = useState(true);
  const measurable = kind === "lift" || kind === "total" || kind === "bodyweight";
  const m = useMutation({
    mutationFn: () =>
      add({
        data: {
          clientId: view.clientId,
          kind: kind as any,
          lift: kind === "lift" ? lift : null,
          value: measurable ? Number(value) : null,
          unit: measurable ? u : null,
          deadline: comp !== "none" ? null : deadline || null,
          competitionId: comp !== "none" ? comp : null,
          text: measurable ? null : text,
          clientFacing: tell,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientGoalsKey(view.clientId) });
      toast.success("Goal added");
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "That didn't save."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a goal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
            {ADD_KINDS.map((k) => (
              <button
                key={k.kind}
                role="radio"
                aria-checked={kind === k.kind}
                onClick={() => setKind(k.kind)}
                className={cn("min-h-9 rounded-full border px-3 text-xs", kind === k.kind ? "border-foreground bg-foreground text-background" : "border-border")}
              >
                {k.label}
              </button>
            ))}
          </div>
          {kind === "lift" && (
            <Select value={lift} onValueChange={(v) => setLift(v as Lift)}>
              <SelectTrigger className="h-10" aria-label="Lift">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="squat">Squat</SelectItem>
                <SelectItem value="bench">Bench</SelectItem>
                <SelectItem value="deadlift">Deadlift</SelectItem>
              </SelectContent>
            </Select>
          )}
          {measurable ? (
            <CompactWeightInput draft={draft} onChange={setDraft} incrementKg={kind === "lift" && comp !== "none" ? view.competitions.find(c => c.id === comp)?.incrementKg ?? 2.5 : undefined} confirmed={view.competitions.find(c => c.id === comp)?.rulesConfirmed} />
          ) : (
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "event" ? "Qualify for nationals" : "In their words"} rows={2} />
          )}
          {(view.competitions ?? []).length > 0 && (kind === "lift" || kind === "total") && (
            <Select value={comp} onValueChange={setComp}>
              <SelectTrigger className="h-10" aria-label="At a meet">
                <SelectValue placeholder="At a meet?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">By a date</SelectItem>
                {view.competitions.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.meet_date})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {comp === "none" && <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="By" className="h-10" />}
          <label className="flex min-h-9 items-center justify-between gap-2">
            <span>Tell {view.firstName ?? "them"} (after your review window)</span>
            <Switch checked={tell} onCheckedChange={setTell} />
          </label>
          <p className="text-[11px] text-muted-foreground">{KIND_WORD[kind]} goals you add are approved targets.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending || (measurable ? !(Number(value) > 0) : text.trim().length < 2)} onClick={() => m.mutate()}>
            Add goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The waiting client update: what it says, when it goes and why it's waiting, and the coach's controls. */
function OutboxRow({ view }: { view: View }) {
  const o = view.outbox;
  const qc = useQueryClient();
  const act = useServerFn(goalUpdateActionFn);
  const saveSettings = useServerFn(setGoalUpdateSettingsFn);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string>(o?.body ?? "");
  const m = useMutation({
    mutationFn: (action: any) => act({ data: { outboxId: o.id, clientId: view.clientId, action } }),
    onSuccess: (r: any, action: any) => {
      qc.invalidateQueries({ queryKey: clientGoalsKey(view.clientId) });
      toast.success(action.action === "send_now" ? (r?.status === "sent" ? "Sent" : `Not sent: ${r?.status}`) : action.action === "edit" ? "Saved" : action.action === "hold" ? "Held" : action.action === "cancel" ? "Cancelled" : "Back on its window");
    },
    onError: (e: any) => toast.error(e?.message ?? "That didn't work."),
  });
  const s = useMutation({
    mutationFn: (x: { reviewMinutes: number; autoSend: boolean }) => saveSettings({ data: x }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientGoalsKey(view.clientId) });
      toast.success("Saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "That didn't save."),
  });
  if (!o) return null;
  const mins = Math.max(0, Math.round((Date.parse(o.next_attempt_at ?? o.send_after) - Date.now()) / 60_000));
  const when =
    o.status === "held"
      ? o.status_line ?? "Held"
      : o.status === "sending"
        ? "Sending…"
        : o.wait_reason === "window" || !o.wait_reason
          ? `Sends ${mins > 0 ? `in ${mins} min` : "soon"} if ${view.firstName ? `${view.firstName}'s` : "they're"} offline`
          : o.status_line ?? "Waiting";
  return (
    <div className="mt-2 rounded-lg border border-border p-2.5" data-goal-outbox={o.status}>
      <button className="flex min-h-9 w-full items-center justify-between gap-2 text-left text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex min-w-0 items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">
            <span className="font-medium">Update for {view.firstName ?? "them"}</span> · {when}
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">{open ? "Hide" : "Preview"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="text-sm" aria-label="Message" />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="h-9" disabled={m.isPending} onClick={() => m.mutate(body !== o.body ? { action: "edit", body } : { action: "send_now" })}>
              {body !== o.body ? "Save" : "Send now"}
            </Button>
            {o.status === "held" ? (
              <Button size="sm" variant="outline" className="h-9" disabled={m.isPending} onClick={() => m.mutate({ action: "resume" })}>
                Resume
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-9" disabled={m.isPending} onClick={() => m.mutate({ action: "hold" })}>
                Hold
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-9" disabled={m.isPending} onClick={() => m.mutate({ action: "cancel" })}>
              Cancel
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>Review window</span>
            <Select value={String(view.settings.reviewMinutes)} onValueChange={(v) => s.mutate({ reviewMinutes: Number(v), autoSend: view.settings.autoSend })}>
              <SelectTrigger className="h-8 w-24 text-xs" aria-label="Review window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[15, 30, 60, 120, 240].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n < 60 ? `${n} min` : `${n / 60} h`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5">
              Send by itself
              <Switch checked={view.settings.autoSend} onCheckedChange={(v) => s.mutate({ reviewMinutes: view.settings.reviewMinutes, autoSend: v })} />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">Goes only when they're offline and outside their quiet hours. Never includes your notes or Cleo's analysis.</p>
        </div>
      )}
    </div>
  );
}
