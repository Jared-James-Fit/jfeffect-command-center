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
import { useEffect, useMemo, useState } from "react";
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
  fmtWeight,
  fromKg,
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
function barTone(score: number) {
  return score >= 70 ? "bg-emerald-500" : score >= 30 ? "bg-amber-500" : "bg-destructive";
}

const approvedWords = (g: GoalRow, unit: Unit) =>
  g.approved_value != null && g.approved_unit ? `${Number(g.approved_value)} ${g.approved_unit}` : g.approved_kg != null ? fmtWeight(Number(g.approved_kg), unit) : g.approved_text ?? null;

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
        {ordered.map((g) => (
          <GoalItem key={g.id} g={g} view={view} unit={unit} compact={compact} onOpenTraining={onOpenTraining} />
        ))}
      </ul>

      {view.outbox && <OutboxRow key={view.outbox.id} view={view} />}

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
                    {g.outcome?.actualKg != null ? ` · ${fmtWeight(g.outcome.actualKg, unit)}` : ""}
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
    mutationFn: (x: { goalId: string; decision: any; expectVersion?: number | null }) => decide({ data: x }),
    onSuccess: done,
    onError: (e: any) => toast.error(e?.message ?? "That didn't save."),
  });
  const rec = useMutation({
    mutationFn: (x: { goalId: string; action: "approve" | "dismiss" | "maintain"; value?: number | null; unit?: Unit | null; expectKey?: string | null }) => decideRec({ data: x }),
    onSuccess: done,
    onError: (e: any) => toast.error(e?.message ?? "That didn't save."),
  });
  return { goal, rec };
}

function GoalItem({ g, view, unit, compact, onOpenTraining }: { g: GoalRow; view: View; unit: Unit; compact: boolean; onOpenTraining?: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { goal, rec } = useGoalMutations(g.client_id);
  const f = g.feasibility;
  const busy = goal.isPending || rec.isPending;
  const said = fmtClientTarget(g);
  const approved = approvedWords(g, unit);
  const measurable = g.kind === "lift" || g.kind === "total" || g.kind === "bodyweight";
  const recOpen = g.recommendation_status === "open" && g.recommendation;
  const first = view.firstName ?? "them";

  // the version this card shows: a goal that changed since is checked again, never approved blind
  const approveAs = (decision: any, msg: string) => goal.mutate({ goalId: g.id, decision, expectVersion: g.version }, { onSuccess: () => toast.success(msg) });

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

      {g.kind !== "preference" && (
        <dl className="mt-1.5 grid grid-cols-3 gap-2 text-xs" data-goal-numbers>
          <Num label="Client" value={said ?? "—"} note={g.client_unit_source === "inferred" ? "unit inferred" : g.tentative ? "tentative" : null} />
          <Num
            label="Projected"
            value={f?.projection ? fmtWeight(f.projection.expectedKg, unit) : measurable ? "—" : "Not scored"}
            note={f?.projection ? `${fmtWeight(f.projection.lowKg, unit)}–${fmtWeight(f.projection.highKg, unit)}` : null}
          />
          <Num label="Approved" value={approved ?? "—"} strong={!!approved} note={g.approved_approach ? APPROACH_LABEL[g.approved_approach] : null} />
        </dl>
      )}

      {f && (
        <div className="mt-2" data-goal-feasibility>
          {f.score != null && (
            <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={cn("h-full rounded-full", barTone(f.score))} style={{ width: `${Math.max(4, f.score)}%` }} />
            </div>
          )}
          <p className={cn("text-xs", scoreTone(f.score))}>
            {f.headline}
            {f.score != null && f.confidence !== "high" ? <span className="text-muted-foreground"> · {CONF_WORD[f.confidence]}</span> : null}
          </p>
          {f.progress?.line && !compact && <p className="text-[11px] text-muted-foreground">Progress: {f.progress.line}{f.progress.pct != null ? ` (${f.progress.pct}%)` : ""}</p>}
        </div>
      )}

      {/* Cleo's recommended action and the coach's choices */}
      {g.status === "proposed" && g.kind !== "preference" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {f?.action?.line && <p className="w-full text-xs text-muted-foreground" data-goal-action>{f.action.line}</p>}
          {measurable && said ? (
            <Button size="sm" className="h-9" disabled={busy} onClick={() => approveAs({ action: "approve" }, `Approved ${clientTop(g) ?? ""}`.trim())} data-goal-approve>
              Approve {clientTop(g)}
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
              onClick={() =>
                approveAs(
                  { action: "approve", approach: f.recommended, approachKg: f.approaches?.find((a) => a.key === f.recommended)?.targetKg ?? null },
                  `Approved ${APPROACH_LABEL[f.recommended as ApproachKey]}`,
                )
              }
              data-goal-approve-recommended
            >
              {APPROACH_LABEL[f.recommended]} {fmtWeight(f.approaches.find((a) => a.key === f.recommended)?.targetKg ?? null, g.client_unit ?? unit)}
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
                  { goalId: g.id, action: "approve", expectKey: g.recommendation?.key ?? null },
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
              {g.recommendation.kind === "adjust_program" ? "Adjust programming" : g.recommendation.suggestedKg != null ? `Approve ${fmtWeight(g.recommendation.suggestedKg, g.approved_unit ?? unit)}` : "Approve"}
            </Button>
            {g.recommendation.suggestedKg != null && (
              <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => rec.mutate({ goalId: g.id, action: "maintain", expectKey: g.recommendation?.key ?? null }, { onSuccess: () => toast.success("Keeping the current plan") })}>
              Keep plan
            </Button>
            <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => rec.mutate({ goalId: g.id, action: "dismiss" }, { onSuccess: () => toast.success("Dismissed") })}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {g.status === "active" && !recOpen && f?.action && f.action.kind === "maintain" && !compact && (
        <p className="mt-1 text-[11px] text-muted-foreground">{f.action.line}</p>
      )}

      <button className="mt-1 flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Details
      </button>
      {open && <GoalDetails g={g} view={view} unit={unit} busy={busy} onApprove={approveAs} first={first} />}
      {editing && <EditGoalDialog g={g} view={view} unit={unit} onClose={() => setEditing(false)} />}
    </li>
  );
}

function Num({ label, value, note, strong }: { label: string; value: string; note?: string | null; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate tabular-nums", strong ? "font-semibold" : "")}>{value}</dd>
      {note && <dd className="truncate text-[10px] text-muted-foreground">{note}</dd>}
    </div>
  );
}

function GoalDetails({ g, view, unit, busy, onApprove, first }: { g: GoalRow; view: View; unit: Unit; busy: boolean; onApprove: (d: any, msg: string) => void; first: string }) {
  const f = g.feasibility;
  const history = (view.history ?? []).filter((h: any) => h.goal_id === g.id).slice(0, 6);
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
                  {fmtWeight(a.targetKg, g.client_unit ?? unit)} · {a.score}
                  <Button size="sm" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => onApprove({ action: "approve", approach: a.key, approachKg: a.targetKg }, `Approved ${a.label}`)}>
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
      {history.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground" data-goal-history>
          {history.map((h: any, i: number) => (
            <li key={i}>
              {ago(h.at)} · {HISTORY_WORD[h.action] ?? h.action.replace(/_/g, " ")}
              {h.actor === "cleo" ? " (Cleo)" : h.actor === "coach" ? "" : h.actor === "athlete" ? " (client)" : ""}
            </li>
          ))}
        </ul>
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

function EditGoalDialog({ g, view, unit, onClose }: { g: GoalRow; view: View; unit: Unit; onClose: () => void }) {
  const u0 = (g.approved_unit ?? g.client_unit ?? unit) as Unit;
  const start =
    g.recommendation?.suggestedKg != null && g.recommendation_status === "open"
      ? Math.round(fromKg(g.recommendation.suggestedKg, u0) * (u0 === "kg" ? 2 : 1)) / (u0 === "kg" ? 2 : 1)
      : g.approved_value ?? g.client_value_max ?? g.client_value ?? null;
  const [value, setValue] = useState(start != null ? String(start) : "");
  const [u, setU] = useState<Unit>(u0);
  const [deadline, setDeadline] = useState(g.deadline ?? "");
  const [tell, setTell] = useState(g.client_facing);
  const { goal } = useGoalMutations(g.client_id);
  const n = Number(value);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{g.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex gap-2">
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Target" aria-label="Target" className="h-10" />
            <Select value={u} onValueChange={(v) => setU(v as Unit)}>
              <SelectTrigger className="h-10 w-24" aria-label="Unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kg">kg</SelectItem>
                <SelectItem value="lb">lb</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!g.competition_id && (
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="By" className="h-10" />
          )}
          <label className="flex min-h-9 items-center justify-between gap-2">
            <span>Tell {view.firstName ?? "them"} (after your review window)</span>
            <Switch checked={tell} onCheckedChange={setTell} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!(n > 0) || goal.isPending}
            onClick={() =>
              goal.mutate(
                { goalId: g.id, decision: { action: "approve", value: n, unit: u, deadline: g.competition_id ? undefined : deadline || null, clientFacing: tell } },
                {
                  onSuccess: () => {
                    toast.success(`Approved ${n} ${u}`);
                    onClose();
                  },
                },
              )
            }
          >
            Approve {n > 0 ? `${n} ${u}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  const [value, setValue] = useState("");
  const [u, setU] = useState<Unit>(view.unit as Unit);
  const [deadline, setDeadline] = useState("");
  const [comp, setComp] = useState<string>(competitionId ?? "none");
  const [text, setText] = useState("");
  const [tell, setTell] = useState(true);
  const measurable = kind === "lift" || kind === "total" || kind === "bodyweight";
  // only a lift or the total is tied to a meet (that's the only kind the meet picker shows for)
  const atMeet = (kind === "lift" || kind === "total") && comp !== "none";
  const m = useMutation({
    mutationFn: () =>
      add({
        data: {
          clientId: view.clientId,
          kind: kind as any,
          lift: kind === "lift" ? lift : null,
          value: measurable ? Number(value) : null,
          unit: measurable ? u : null,
          deadline: atMeet ? null : deadline || null,
          competitionId: atMeet ? comp : null,
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
            <div className="flex gap-2">
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Target" aria-label="Target" className="h-10" />
              <Select value={u} onValueChange={(v) => setU(v as Unit)}>
                <SelectTrigger className="h-10 w-24" aria-label="Unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="lb">lb</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          {!atMeet && <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="By" className="h-10" />}
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
  // the words follow the saved update until the coach starts changing them (a refresh never wipes an edit)
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setBody(o?.body ?? "");
  }, [o?.body, dirty]);
  const m = useMutation({
    mutationFn: (action: any) => act({ data: { outboxId: o.id, clientId: view.clientId, action } }),
    onSuccess: (r: any, action: any) => {
      setDirty(false);
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
          <Textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
            rows={6}
            className="text-sm"
            aria-label="Message"
            disabled={o.status === "sending"}
          />
          {o.status === "sending" ? (
            <p className="text-[11px] text-muted-foreground">It's going out now. If it doesn't, it comes back here to send again.</p>
          ) : (
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
          )}
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
