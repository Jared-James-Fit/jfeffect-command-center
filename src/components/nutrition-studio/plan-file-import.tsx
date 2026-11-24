/**
 * The coach's "Import a file" in the plan editor's paste section
 * (nutrition-target-dialog.tsx): the same engine as a member's import (the
 * app's own reader first, a full read in the background for a PDF, photos or
 * a file it can't read; never charged to a coach), ending in the same days
 * the paste box fills (`ParsedDay[]`, its weighing rules and phase). Using
 * the days files the original in the coach's documents for that client.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PlanSourcePicker } from "@/components/nutrition-studio/plan-source-picker";
import { PlanPreview } from "@/components/nutrition-studio/plan-preview";
import { useMealImport } from "@/components/nutrition-studio/use-meal-import";
import { discardMealPlanImport, markMealPlanImportSaved, retryMealPlanImport } from "@/lib/nutrition-import/import.functions";
import { readPlanText } from "@/lib/nutrition-import/read";
import { parseFoodWeighingRules, type ParsedDay } from "@/lib/nutrition-targets/meal-plan-parse";
import { phaseFromPlanText } from "@/lib/nutrition-cardio";

export function PlanFileImport({
  clientId,
  onApply,
}: {
  clientId: string | null;
  onApply: (days: ParsedDay[], foodWeighingRules: string | null, phase: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);

  if (!open)
    return (
      <Button type="button" variant="outline" className="h-11 w-full gap-1.5" onClick={() => setOpen(true)} data-plan-file-import>
        <FileUp className="h-4 w-4" /> Import a file
      </Button>
    );
  return (
    <div className="space-y-3 rounded-xl border border-border p-3" data-plan-file-import-open>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold">Import a file</span>
        <Button
          type="button"
          variant="ghost"
          className="h-9 px-2"
          onClick={() => {
            setOpen(false);
            setId(null);
          }}
        >
          Close
        </Button>
      </div>
      {id ? (
        <CoachImport
          id={id}
          onDone={(read) => {
            if (read) onApply(read.days, read.rules, read.phase);
            setId(null);
            setOpen(false);
          }}
          onReset={() => setId(null)}
          clientId={clientId}
        />
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">A PDF, photos, a spreadsheet, a Word document or a text file. It fills the days like a paste.</p>
          <PlanSourcePicker audience="staff" allowPaste={false} goLabel="Read the file" onStarted={(r) => setId(r.id)} />
        </>
      )}
    </div>
  );
}

function CoachImport({
  id,
  clientId,
  onDone,
  onReset,
}: {
  id: string;
  clientId: string | null;
  onDone: (read: { days: ParsedDay[]; rules: string | null; phase: string | null } | null) => void;
  onReset: () => void;
}) {
  const { row, loading, reload } = useMealImport(id);
  const discard = useServerFn(discardMealPlanImport);
  const retry = useServerFn(retryMealPlanImport);
  const markSaved = useServerFn(markMealPlanImportSaved);
  const [busy, setBusy] = useState(false);

  const drop = async () => {
    setBusy(true);
    try {
      await discard({ data: { id } });
      onReset();
    } catch {
      toast.error("Couldn't discard it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !row) return <div className="h-24 jf-skeleton rounded-xl bg-muted" aria-hidden />;
  if (row.status === "pending" || row.status === "reading")
    return (
      <div className="flex flex-col items-center py-6 text-center" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <div className="mt-2 text-[15px] font-medium">Reading the file…</div>
        <p className="text-[13px] text-muted-foreground">A minute or two. You can keep editing meanwhile.</p>
        <Button type="button" variant="ghost" className="mt-2 h-9" onClick={drop} disabled={busy}>
          Cancel
        </Button>
      </div>
    );
  if (row.status === "failed")
    return (
      <div className="space-y-2 py-2 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-warning" aria-hidden />
        <p className="text-[14px]">{row.error ?? "The file couldn't be read."}</p>
        <div className="flex justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r: any = await retry({ data: { id } });
                if (!r.ok) toast.error(r.message);
                else await reload();
              } finally {
                setBusy(false);
              }
            }}
          >
            Try again
          </Button>
          <Button type="button" variant="ghost" className="h-10" onClick={drop} disabled={busy}>
            Start over
          </Button>
        </div>
      </div>
    );
  const read = row.result ? readPlanText(row.result.text) : null;
  if (row.status !== "ready" || !read)
    return (
      <div className="space-y-2 py-2 text-center">
        <p className="text-[14px] text-muted-foreground">No meals were found in it.</p>
        <Button type="button" variant="ghost" className="h-10" onClick={drop} disabled={busy}>
          Start over
        </Button>
      </div>
    );
  const use = async () => {
    onDone({ days: read.days.map((d, i) => ({ ...d, sort_order: i })), rules: parseFoodWeighingRules(read.text), phase: phaseFromPlanText(read.text) });
    toast.success(`Imported ${read.days.length} day${read.days.length === 1 ? "" : "s"}`);
    // the original goes in the coach's documents for this client; never blocks the days
    void markSaved({ data: { id, clientId } }).catch(() => undefined);
  };
  return (
    <PlanPreview
      days={read.days.map((d) => ({ label: d.day_label, calories: d.calories ?? null, protein: d.protein ?? null, carbs: d.carbs ?? null, fats: d.fats ?? null, notes: d.notes ?? "" }))}
      flags={row.result?.flags ?? []}
      sourceText={row.source_text ?? row.result?.transcript ?? null}
      sourceLabel="What was read from the file"
      actions={
        <div className="space-y-2">
          <Button type="button" variant="outline" className="h-11 w-full" onClick={use} data-plan-file-import-use>
            Use these {read.days.length} day{read.days.length === 1 ? "" : "s"}
          </Button>
          <Button type="button" variant="ghost" className="h-10 w-full" onClick={drop} disabled={busy}>
            Discard
          </Button>
        </div>
      }
    />
  );
}
