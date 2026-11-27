/**
 * The preparation checklist in its four stages (coach and athlete read the
 * same one): readiness first in one line, then each stage's items, what's
 * still open marked by how much it matters. A tick is one tap; an item the
 * records already show done says so and can't be unticked here.
 */
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STAGES,
  STAGE_LABEL,
  type ItemState,
  type PrepItem,
  type Readiness,
} from "@/lib/competition/prep-checklist";
import { ReadinessWord, dayWords } from "./prep-ui";

export function ChecklistSection({
  items,
  readiness,
  today,
  onTick,
  who,
}: {
  items: PrepItem[];
  readiness: Readiness;
  today: string;
  onTick?: (key: string, state: ItemState) => void;
  who: "coach" | "athlete";
}) {
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
                <Row key={i.key} item={i} today={today} onTick={onTick} who={who} />
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
