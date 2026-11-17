import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  checklistItems,
  checklistProgress,
  checklistStates,
  setItemState,
  stateWords,
  visibleItems,
  type ChecklistItem,
  type ItemState,
} from "@/lib/form-checklist";
import type { AnswerLike } from "@/lib/form-logic";
import { otherUnit } from "@/lib/meet-checklist";

type Q = {
  id: string;
  label: string;
  help_text?: string | null;
  required?: boolean | null;
  options?: unknown;
  validation?: Record<string, unknown> | null;
};

/**
 * A checklist section, built for packing a bag with one thumb: tap the row to
 * mark it ready (tap again to undo), or Need / N/A on the right. Compact rows,
 * the whole row a target; the header folds the section away and says how far
 * along it is. Nothing unmarked reads as missing: only "Still need" does.
 */
export function ChecklistSection({
  q,
  value,
  answers,
  readOnly,
  flagged,
  onChange,
}: {
  q: Q;
  value: unknown;
  /** What's on screen now, for items that only show for some answers. */
  answers: Record<string, AnswerLike | undefined>;
  readOnly: boolean;
  flagged?: boolean;
  onChange: (next: unknown) => void;
}) {
  const all = checklistItems(q);
  const items = visibleItems(all, answers);
  const states = checklistStates(value);
  const words = stateWords(q);
  const p = checklistProgress(items, value);
  const done = p.total > 0 && p.marked === p.total;
  // A section already finished when the form opens starts folded.
  const [open, setOpen] = useState(() => !done);
  const set = (item: ChecklistItem, s: ItemState | null) => {
    if (readOnly) return;
    onChange(setItemState(value, all, item, s));
  };

  return (
    <section
      id={`q-${q.id}`}
      className={cn("scroll-mt-24 overflow-hidden rounded-2xl border bg-card", flagged ? "border-destructive ring-2 ring-destructive/20" : "border-border")}
      data-form-question="checklist"
      data-checklist-done={done ? "" : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left"
        data-checklist-header
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold leading-snug">{q.label}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
            {p.marked} of {p.total}
            {p.need > 0 && <span className="font-semibold text-warning"> · {p.need} still {p.need === 1 ? "needed" : "needed"}</span>}
          </p>
        </div>
        {done && p.need === 0 && (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-success text-white" aria-label="All done">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        )}
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div className="h-1 bg-muted" aria-hidden>
        <div className="h-full bg-success transition-[width] duration-300" style={{ width: `${p.total ? (p.marked / p.total) * 100 : 0}%` }} />
      </div>
      {open && (
        <ul className="divide-y divide-border/70" data-checklist-items>
          {q.help_text && <li className="px-4 py-2.5 text-[14px] leading-snug text-muted-foreground">{q.help_text}</li>}
          {items.map((item) => {
            const s = states.get(item.key) ?? null;
            return (
              <li key={item.key} className="flex items-stretch" data-checklist-item={item.key} data-state={s ?? "open"}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={s === "ready"}
                  disabled={readOnly}
                  onClick={() => set(item, s === "ready" ? null : "ready")}
                  className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left active:bg-muted/60 disabled:opacity-100"
                >
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition-colors",
                      s === "ready" ? "border-success bg-success text-white" : s === "need" ? "border-warning" : "border-muted-foreground/40",
                    )}
                    aria-hidden
                  >
                    {s === "ready" && <Check className="h-4 w-4" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-[15px] leading-snug", s === "na" ? "text-muted-foreground line-through decoration-muted-foreground/50" : "font-medium")}>
                      {item.label}
                      {item.priority === "critical" && s !== "na" && <span className="ml-1.5 whitespace-nowrap text-[12px] font-semibold text-muted-foreground">Must have</span>}
                      {item.priority === "optional" && s == null && <span className="ml-1.5 whitespace-nowrap text-[12px] text-muted-foreground">Optional</span>}
                    </span>
                    {s === "need" ? (
                      <span className="mt-0.5 block text-[13px] font-semibold text-warning">Still need</span>
                    ) : s === "ready" ? (
                      <span className="mt-0.5 block text-[13px] text-success">{words.ready}</span>
                    ) : item.help ? (
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{item.help}</span>
                    ) : null}
                  </span>
                </button>
                {!readOnly && (
                  <div className="flex shrink-0 items-center gap-1 pr-3">
                    <StateChip on={s === "need"} tone="need" onClick={() => set(item, s === "need" ? null : "need")}>
                      Need
                    </StateChip>
                    <StateChip on={s === "na"} tone="na" onClick={() => set(item, s === "na" ? null : "na")}>
                      N/A
                    </StateChip>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StateChip({ on, tone, onClick, children }: { on: boolean; tone: "need" | "na"; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-10 min-w-[48px] rounded-full border px-2.5 text-[13px] font-semibold transition-colors active:scale-[0.96]",
        on
          ? tone === "need"
            ? "border-warning bg-warning/15 text-foreground"
            : "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** "Still to sort": every item marked Still need, tap one to go to it. */
export function StillToSort({
  rows,
  onGo,
}: {
  rows: Array<{ questionId: string; label: string; critical: boolean }>;
  onGo: (questionId: string) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="rounded-2xl border border-warning/40 bg-warning/5 px-4 py-3" data-still-to-sort>
      <p className="text-[15px] font-semibold">Still to sort ({rows.length})</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {rows.map((r) => (
          <button
            key={`${r.questionId}-${r.label}`}
            type="button"
            onClick={() => onGo(r.questionId)}
            className="min-h-[36px] rounded-full border border-border bg-background px-3 text-[14px] font-medium"
          >
            {r.label}
            {r.critical && <span className="ml-1 text-[12px] font-semibold text-warning">must have</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A number in lb or kg: the unit switch relabels what's typed (never converts
 * it, so a number typed in the wrong unit is fixed with one tap), and the
 * other unit shows underneath.
 */
export function UnitNumberInput({
  value,
  units,
  readOnly,
  onChange,
  onDone,
  hint,
}: {
  value: { value: string; unit: "kg" | "lb" };
  units: Array<"kg" | "lb">;
  readOnly: boolean;
  onChange: (next: { value: string; unit: "kg" | "lb" }, typed?: boolean) => void;
  onDone: () => void;
  hint?: { text: string; onUse?: () => void } | null;
}) {
  const n = value.value === "" ? null : Number(value.value);
  const conv = otherUnit(n, value.unit);
  return (
    <div>
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-background px-3.5 text-[17px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          value={value.value}
          disabled={readOnly}
          placeholder="Type a number"
          enterKeyHint="done"
          onChange={(e) => onChange({ value: e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"), unit: value.unit }, true)}
          onBlur={onDone}
          aria-label="Number"
        />
        <div className="flex shrink-0 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Unit">
          {units.map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={value.unit === u}
              disabled={readOnly}
              onClick={() => onChange({ value: value.value, unit: u })}
              className={cn(
                "min-w-[48px] rounded-lg px-3 text-[15px] font-semibold transition-colors",
                value.unit === u ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
        <span className="tabular-nums">{conv ?? ""}</span>
        {hint && (
          <span className="inline-flex items-center gap-2">
            {hint.text}
            {hint.onUse && !readOnly && (
              <button type="button" onClick={hint.onUse} className="min-h-[32px] rounded-full border border-border bg-background px-3 font-semibold text-foreground">
                Use it
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
