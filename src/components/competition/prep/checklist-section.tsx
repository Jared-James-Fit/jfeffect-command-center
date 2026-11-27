/**
 * The preparation checklist in its four stages (coach and athlete read the
 * same one): readiness first in one line, then each stage's items, what's
 * still open marked by how much it matters. A tick is one tap; an item the
 * records already show done says so and can't be unticked here.
 */
import { useMutation, useMutationState } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STAGES,
  readinessOf,
  STAGE_LABEL,
  type ItemState,
  type PrepItem,
  type Readiness,
} from "@/lib/competition/prep-checklist";
import { ReadinessWord, dayWords } from "./prep-ui";

export type ChecklistChange = { key: string; state: ItemState };

export function applyChecklistChanges(items: PrepItem[], changes: (ChecklistChange | undefined)[]): PrepItem[] {
  const states = new Map<string, ItemState>();
  for (const change of changes) if (change) states.set(change.key, change.state);
  if (!states.size) return items;
  return items.map((item) => !item.auto && states.has(item.key) ? { ...item, state: states.get(item.key)! } : item);
}

export function ChecklistSection({
  items: serverItems,
  readiness: serverReadiness,
  competitionId,
  today,
  onTick,
  who,
}: {
  items: PrepItem[];
  readiness: Readiness;
  competitionId: string;
  today: string;
  onTick?: (key: string, state: ItemState) => Promise<unknown>;
  who: "coach" | "athlete";
}) {
  const mutationKey = ["prep-checklist-tick", competitionId, who];
  const save = useMutation({
    mutationKey,
    scope: { id: `prep-checklist:${competitionId}` },
    mutationFn: ({ key, state }: ChecklistChange) => {
      if (!onTick) throw new Error("Checklist is read-only");
      return onTick(key, state);
    },
    onError: () => toast.error("Couldn't save that checklist change. Please try again."),
  });
  const pending = useMutationState({
    filters: { mutationKey, exact: true, status: "pending" },
    select: (mutation) => mutation.state.variables as ChecklistChange | undefined,
  });
  // Pending mutations include queued taps. Keep their newest intent visible
  // until each write and its cache reconciliation finish, even on tab changes.
  const items = onTick ? applyChecklistChanges(serverItems, pending) : serverItems;
  const readiness = items === serverItems ? serverReadiness : readinessOf(items, today);
  const tick = onTick ? (key: string, state: ItemState) => save.mutate({ key, state }) : undefined;
  return (
    <div className="space-y-3" data-prep-checklist>
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-[15px]">
          <ReadinessWord verdict={readiness.verdict} /> <span className="text-muted-foreground">· {readiness.line}</span>
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Readiness weighs what's missing by how much it matters and when it's due, not a percentage.
        </p>
      </div>
      {STAGES.map((stage) => {
        const list = items.filter((i) => i.stage === stage);
        if (!list.length) return null;
        const open = list.filter((i) => i.state === "open");
        return (
          <section key={stage} className="rounded-2xl border border-border bg-card" data-stage={stage}>
            <header className="flex items-baseline justify-between gap-2 px-4 pt-3">
              <h3 className="text-[15px] font-semibold">{STAGE_LABEL[stage]}</h3>
              <span className="text-[12.5px] text-muted-foreground">
                {open.length ? `${open.length} to do` : "All done"}
              </span>
            </header>
            <ul className="mt-1 divide-y divide-border">
              {list.map((i) => (
                <Row key={i.key} item={i} today={today} onTick={tick} who={who} />
              ))}
            </ul>
            <div className="h-1" />
          </section>
        );
      })}
    </div>
  );
}

function Row({
  item,
  today,
  onTick,
  who,
}: {
  item: PrepItem;
  today: string;
  onTick?: (key: string, state: ItemState) => void;
  who: "coach" | "athlete";
}) {
  const late = item.state === "open" && item.due < today;
  const canTick = !!onTick && !item.auto && (who === "coach" || item.owner !== "coach");
  const done = item.state === "done";
  const na = item.state === "na";
  return (
    <li className="flex items-start gap-3 px-4 py-2.5" data-item={item.key} data-state={item.state}>
      <button
        type="button"
        disabled={!canTick}
        aria-label={done ? `Mark "${item.label}" not done` : `Mark "${item.label}" done`}
        onClick={() => onTick?.(item.key, done || na ? "open" : "done")}
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
          done ? "border-success bg-success text-white" : na ? "border-border bg-muted text-muted-foreground" : "border-muted-foreground/50",
          !canTick && "cursor-default opacity-80",
        )}
      >
        {done ? <Check className="h-4 w-4" /> : na ? <Minus className="h-4 w-4" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[14.5px] leading-snug", (done || na) && "text-muted-foreground line-through decoration-muted-foreground/40")}>
          {item.label}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {item.priority === "critical" ? <span className="font-medium text-foreground">Must-have · </span> : item.priority === "optional" ? "Optional · " : null}
          {done ? (item.auto ? "Done (on file)" : "Done") : na ? "Doesn't apply" : late ? <span className="text-destructive">Overdue · was due {dayWords(item.due)}</span> : `By ${dayWords(item.due)}`}
          {item.owner === "coach" ? " · Coach" : item.owner === "both" && !done ? " · Both" : ""}
        </p>
        {item.help && !done ? <p className="text-[12px] text-muted-foreground">{item.help}</p> : null}
      </div>
      {canTick && item.state === "open" ? (
        <button
          type="button"
          className="mt-0.5 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => onTick?.(item.key, "na")}
        >
          N/A
        </button>
      ) : null}
    </li>
  );
}
