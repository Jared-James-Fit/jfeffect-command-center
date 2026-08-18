/**
 * Availability guardrail dialog shown BEFORE a program is written to a
 * client. Handles: matching frequency (preview only), too few available
 * days (blocked until fixed), extra availability (pick exact days), and
 * missing availability (set it inline). Reused by every assignment path.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CalendarCheck, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Weekday } from "@/lib/program-planner/types";
import {
  GUARD_WEEKDAYS, GUARD_WEEKDAY_LABEL, GUARD_WEEKDAY_SHORT,
  AVAILABILITY_SOURCE_LABEL, buildWeeklyPreview, type GuardResult,
} from "@/lib/program-availability-guard";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  guard: GuardResult;
  clientId: string;
  clientName?: string | null;
  /** Titles of the first programmed week, in program order. */
  workoutTitles: string[];
  busy?: boolean;
  /** Called when the coach confirms; receives the final weekday schedule. */
  onConfirm: (days: Weekday[]) => void;
};

export function AvailabilityGuardDialog({
  open, onOpenChange, guard, clientId, clientName, workoutTitles, busy, onConfirm,
}: Props) {
  const qc = useQueryClient();
  const required = guard.requiredDays;
  const [days, setDays] = useState<Weekday[]>(guard.selectedDays.slice(0, required));
  const [saving, setSaving] = useState(false);
  const [override, setOverride] = useState(false);

  useEffect(() => {
    if (open) {
      setDays(guard.selectedDays.slice(0, required));
      setOverride(false);
    }
  }, [open, guard.status, guard.selectedDays.join(","), required]); // eslint-disable-line react-hooks/exhaustive-deps

  // "extra_days" restricts choices to the client's saved availability; the
  // other states let the coach widen the week (that is the fix).
  const choices: Weekday[] = guard.status === "extra_days" ? guard.availability.days : GUARD_WEEKDAYS;
  const exact = days.length === required;
  const preview = useMemo(() => buildWeeklyPreview(workoutTitles, days), [workoutTitles, days]);

  const toggle = (d: Weekday) =>
    setDays((prev) =>
      prev.includes(d)
        ? prev.filter((x) => x !== d)
        : GUARD_WEEKDAYS.filter((x) => x === d || prev.includes(x)),
    );

  const saveAvailability = async () => {
    setSaving(true);
    const longDays = days.map((d) => GUARD_WEEKDAY_LABEL[d]);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("clients")
      .update({
        committed_training_days: longDays,
        committed_training_frequency: longDays.length,
        training_schedule_completed: true,
        training_schedule_last_updated: new Date().toISOString(),
        training_schedule_updated_by: auth.user?.id ?? null,
      } as any)
      .eq("id", clientId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Training availability saved");
    qc.invalidateQueries({ queryKey: ["planner-client", clientId] });
    qc.invalidateQueries({ queryKey: ["client", clientId] });
    qc.invalidateQueries({ queryKey: ["client-schedule", clientId] });
    onConfirm(days);
  };

  const needsSave = guard.status === "missing_availability" || guard.status === "too_few_days";
  const tone = guard.status === "ok" ? "ok" : "warn";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100vw-1.5rem)] [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8 text-left">
            {tone === "ok"
              ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />}
            {guard.title}
          </DialogTitle>
          <DialogDescription className="text-left">{guard.message}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Program vs availability comparison */}
          {guard.status !== "ok" && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border bg-secondary/20 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Program</div>
                <div className="font-semibold">{required} workout{required === 1 ? "" : "s"}/week</div>
              </div>
              <div className="rounded border border-border bg-secondary/20 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Client availability</div>
                <div className="font-semibold">
                  {guard.availability.days.length
                    ? guard.availability.days.map((d) => GUARD_WEEKDAY_LABEL[d]).join(" · ")
                    : "Not set"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {guard.availability.days.length} day{guard.availability.days.length === 1 ? "" : "s"}/week ·{" "}
                  {AVAILABILITY_SOURCE_LABEL[guard.availability.source]}
                </div>
              </div>
            </div>
          )}

          {guard.variableFrequency && (
            <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
              This program's weekly frequency changes between weeks
              {guard.frequency.min ? ` (${guard.frequency.min}–${guard.frequency.max} workouts/week)` : ""}.
              Availability must support the busiest week ({required} days).
            </div>
          )}

          {/* Weekday selection */}
          {guard.status !== "ok" && (
            <div>
              <div className="mb-1 text-xs font-semibold">
                Select {required} training day{required === 1 ? "" : "s"}
                <span className="ml-1 font-normal text-muted-foreground">({days.length}/{required} selected)</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {choices.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggle(d)}
                    aria-pressed={days.includes(d)}
                    className={
                      "min-w-[48px] rounded px-2 py-1.5 text-xs " +
                      (days.includes(d)
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:bg-secondary/70")
                    }
                  >
                    {GUARD_WEEKDAY_SHORT[d]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Final weekly preview */}
          {exact && preview.length > 0 && (
            <div className="rounded border border-border bg-secondary/10 p-2">
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold">
                <CalendarCheck className="h-3.5 w-3.5 text-primary" /> Weekly Schedule
              </div>
              <ul className="space-y-1 text-xs">
                {preview.map((r) => (
                  <li key={r.weekday} className="flex items-center justify-between gap-2 border-b border-border/40 pb-1 last:border-0">
                    <span className="font-medium">{r.label}</span>
                    <span className="truncate text-muted-foreground">{r.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!exact && guard.status !== "ok" && (
            <div className="text-[11px] text-muted-foreground">
              Pick exactly {required} day{required === 1 ? "" : "s"} to continue — JF Effect never doubles two workouts onto one day automatically.
            </div>
          )}

          {guard.status !== "ok" && (
            <label className="flex cursor-pointer items-start gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" className="mt-0.5" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              <span>
                <span className="font-semibold text-foreground">Override Schedule</span> — this program does not match the client's saved training availability. Assign anyway with the days shown above.
              </span>
            </label>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy || saving}>Go Back</Button>
          {guard.status === "ok" ? (
            <Button onClick={() => onConfirm(days)} disabled={busy}>
              {busy ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Assigning…</> : "Assign Program"}
            </Button>
          ) : override ? (
            <Button variant="destructive" onClick={() => onConfirm(days)} disabled={busy || days.length === 0}>
              {busy ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Assigning…</> : "Assign Anyway"}
            </Button>
          ) : needsSave ? (
            <Button onClick={saveAvailability} disabled={!exact || saving || busy}>
              {saving ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving…</> : "Fix Schedule"}
            </Button>
          ) : (
            <Button onClick={() => onConfirm(days)} disabled={!exact || busy}>
              {busy ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Assigning…</> : "Use These Days"}
            </Button>
          )}
        </DialogFooter>

        {guard.status === "too_few_days" && (
          <div className="text-center text-[11px] text-muted-foreground">
            <Badge variant="outline" className="mr-1">Tip</Badge>
            Edit availability above, or go back and choose a program with {guard.availability.days.length} training days.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
