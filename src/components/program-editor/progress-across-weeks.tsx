import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applyCell,
  formatCell,
  leadingNumber,
  patchSlot,
  progression,
  progressionText,
  rowAtSlot,
  type SheetField,
} from "@/lib/program-sheet";
import { BuilderSheet } from "./builder-sheet";

type Slot = { dayIndex: number; pos: number };

const LABEL: Record<SheetField, string> = {
  sets: "Sets",
  reps: "Reps",
  rpe: "RPE",
  rir: "RIR",
  load: "Load",
  tempo: "Tempo",
  rest: "Rest",
  notes: "Notes",
};

/** The usual step a week for each field (a coach types any other). */
const DEFAULT_STEP: Partial<Record<SheetField, number>> = { sets: 1, reps: -1, rpe: 0.5, rir: -0.5, load: 2.5 };

/** RPE, unless this exercise is written in RIR. */
export function effortField(row: any): "rpe" | "rir" {
  return !formatCell(row, "rpe") && formatCell(row, "rir") ? "rir" : "rpe";
}

/**
 * One exercise followed week to week in the coach's editor (a client's block
 * or a template), the member builder's "Progress across weeks": every week's
 * sets, reps, effort, load and rest in one table typed straight in, and a
 * pattern (a start and a step a week, previewed before it's written) for any
 * one of them. Values are read and written by the Sheet view's own rules
 * (`applyCell`, `progression`, `progressionText`), so a load stays a % of the
 * same basis or the same unit, effort stops at 10 and nothing is guessed.
 */
export function ProgressAcrossWeeksSheet({
  open,
  onOpenChange,
  weeksData,
  setWeeksData,
  slot,
  activeIdx,
  name,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  weeksData: any[];
  setWeeksData: (next: any[]) => void;
  slot: Slot | null;
  activeIdx: number;
  name: string;
}) {
  const weeks = useMemo(
    () =>
      slot
        ? weeksData
            .map((w, wi) => ({ wi, label: String(w?.week_index ?? wi + 1), row: rowAtSlot(w, slot) }))
            .filter((x) => !!x.row)
        : [],
    [weeksData, slot],
  );
  const here = slot ? rowAtSlot(weeksData[activeIdx], slot) ?? weeks[0]?.row : null;
  const effort = here ? effortField(here) : "rpe";
  const columns: SheetField[] = ["sets", "reps", effort, "load", "rest"];
  const patternFields: SheetField[] = ["sets", "reps", effort, "load"];

  const [field, setField] = useState<SheetField>(effort);
  const [start, setStart] = useState("");
  const [step, setStep] = useState("");
  // a new exercise (or reopening) starts the pattern from what week 1 says
  useEffect(() => {
    if (!open || !slot) return;
    setField(effort);
  }, [open, slot?.dayIndex, slot?.pos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const first = weeks[0]?.row;
    const n = first ? leadingNumber(formatCell(first, field)) : null;
    setStart(n == null ? "" : String(n));
    setStep(String(DEFAULT_STEP[field] ?? 0));
  }, [field, open, slot?.dayIndex, slot?.pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const startN = Number(start.replace(",", "."));
  const stepN = Number(step.replace(",", ".").replace(/^\+/, ""));
  const ready = start.trim() !== "" && Number.isFinite(startN) && Number.isFinite(stepN);
  const values = ready ? progression(startN, stepN, weeks.length, field) : [];

  const fill = () => {
    if (!slot || !ready) return;
    const before = weeksData;
    let next = weeksData;
    const failed: string[] = [];
    weeks.forEach((w, i) => {
      const row = rowAtSlot(next[w.wi], slot);
      const res = applyCell(row, field, progressionText(row, field, values[i]));
      if ("error" in res) failed.push(w.label);
      else next = patchSlot(next, w.wi, slot, res.patch);
    });
    setWeeksData(next);
    toast.success(failed.length ? `Filled, except week ${failed.join(", ")}` : `${LABEL[field]} filled week by week`, {
      action: { label: "Undo", onClick: () => setWeeksData(before) },
    });
  };

  return (
    <BuilderSheet
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`${name || "Exercise"} across weeks`}
      description={weeks.length ? `Day ${slot?.dayIndex ?? ""} · ${weeks.length} weeks in this block` : "Nothing to show"}
    >
      <div className="space-y-4" data-coach-progress>
        <section className="space-y-2.5 rounded-2xl bg-secondary/50 p-3">
          <div className="text-[13px] font-semibold">Fill a pattern</div>
          <div className="flex flex-wrap gap-1.5">
            {patternFields.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setField(f)}
                aria-pressed={field === f}
                className={cn(
                  "h-9 rounded-full px-3.5 text-[14px] font-medium",
                  field === f ? "bg-foreground text-background" : "bg-background text-foreground",
                )}
              >
                {LABEL[f]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <label className="space-y-1">
              <span className="block text-[12px] text-muted-foreground">Week {weeks[0]?.label ?? 1}</span>
              <Input value={start} onChange={(e) => setStart(e.target.value)} inputMode="decimal" className="h-11 text-base" />
            </label>
            <label className="space-y-1">
              <span className="block text-[12px] text-muted-foreground">Each week</span>
              <Input value={step} onChange={(e) => setStep(e.target.value)} inputMode="decimal" className="h-11 text-base" />
            </label>
            <Button className="h-11" disabled={!ready || !weeks.length} onClick={fill} data-coach-progress-fill>
              Fill
            </Button>
          </div>
          {ready && values.length > 0 && (
            <p className="text-[12px] text-muted-foreground" data-coach-progress-preview>
              {LABEL[field]}: {values.join(" → ")}
            </p>
          )}
        </section>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[340px] table-fixed border-separate border-spacing-y-1.5 text-[14px]">
            {/* a load reads "77.5% TM" or "102.5 kg", so it gets the room */}
            <colgroup>
              <col className="w-7" />
              <col className="w-11" />
              <col className="w-[3.25rem]" />
              <col className="w-11" />
              <col />
              <col className="w-[3.5rem]" />
            </colgroup>
            <thead>
              <tr className="text-[12px] text-muted-foreground">
                <th className="text-left font-medium">Wk</th>
                {columns.map((c) => (
                  <th key={c} className="font-medium">
                    {LABEL[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.wi} data-coach-progress-week={w.label}>
                  <td className={cn("font-semibold tabular-nums", w.wi === activeIdx ? "text-foreground" : "text-muted-foreground")}>
                    {w.label}
                  </td>
                  {columns.map((c) => (
                    <td key={c} className="px-0.5">
                      <WeekCell
                        row={w.row}
                        field={c}
                        label={`Week ${w.label} ${LABEL[c]}`}
                        onCommit={(patch) => slot && setWeeksData(patchSlot(weeksData, w.wi, slot, patch))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </BuilderSheet>
  );
}

/** One week's value, typed straight in; written only when it reads (else put back, with why). */
function WeekCell({
  row,
  field,
  label,
  onCommit,
}: {
  row: any;
  field: SheetField;
  label: string;
  onCommit: (patch: Record<string, any>) => void;
}) {
  const shown = formatCell(row, field);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  const commit = () => {
    setEditing(false);
    if (text.trim() === shown.trim()) return;
    const res = applyCell(row, field, text);
    if ("error" in res) {
      toast.error(res.error);
      setText(shown);
      return;
    }
    onCommit(res.patch);
  };
  return (
    <input
      value={text}
      aria-label={label}
      onFocus={(e) => {
        setEditing(true);
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(shown);
          setEditing(false);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      inputMode={field === "reps" || field === "load" || field === "rest" ? "text" : "decimal"}
      placeholder="—"
      className="h-10 w-full min-w-0 rounded-lg bg-secondary px-1.5 text-center text-[16px] tabular-nums outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring"
    />
  );
}
