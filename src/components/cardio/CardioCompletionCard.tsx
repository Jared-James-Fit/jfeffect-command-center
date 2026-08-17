/**
 * CardioCompletionCard — one prescribed cardio session, simplified.
 *
 * Client hierarchy: Activity → Mode → Duration → machine settings →
 * one completion rule → action. Historical `cardio_type` strings are
 * normalized for display only (see @/lib/cardio-activity) so analytics,
 * schedule sync and past logs are untouched.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Info, Loader2, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cardioStatus, cardioStatusLabel, formatCardioLogLine } from "@/lib/cardio-plan";
import { resolveCardioTargets, resolveCompletionTarget } from "@/lib/cardio-prescription";
import {
  cardioActivityLabel,
  completionTargetParts,
  formatSpeedRange,
  resolveCardioActivity,
} from "@/lib/cardio-activity";

type CardioTarget = {
  id: string;
  cardio_type: string;
  custom_type: string | null;
  day_type: string;
  custom_day_type: string | null;
  duration_minutes: number | null;
  intensity: string | null;
  heart_rate_zone: string | null;
  machine_preference: string | null;
  goal: string | null;
  step_target: number | null;
  step_target_mode?: "auto" | "custom" | null;
  calorie_target_min: number | null;
  calorie_target_mode?: "auto" | "custom" | null;
  incline?: number | null;
  speed_min_mph?: number | null;
  speed_max_mph?: number | null;
  calorie_target_max: number | null;
  show_calories_to_client: boolean;
  client_notes: string | null;
};

type Props = {
  target: CardioTarget;
  clientId: string;
  date?: Date;
  readonly?: boolean;
};

export function CardioCompletionCard({ target, clientId, date, readonly = false }: Props) {
  const qc = useQueryClient();
  const dateStr = date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  const [expanded, setExpanded] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actualDuration, setActualDuration] = useState("");
  const [rpe, setRpe] = useState("");
  const [notes, setNotes] = useState("");
  const [distance, setDistance] = useState("");
  const [distanceUnit, setDistanceUnit] = useState("km");
  const [avgSpeed, setAvgSpeed] = useState("");
  const [incline, setIncline] = useState("");
  const [calories, setCalories] = useState("");
  const [steps, setSteps] = useState("");
  const [avgHr, setAvgHr] = useState("");

  const { data: completion, isLoading } = useQuery({
    queryKey: ["cardio-completion", clientId, target.id, dateStr],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("cardio_completions")
        .select("*")
        .eq("client_id", clientId)
        .eq("cardio_target_id", target.id)
        .eq("completed_date", dateStr)
        .maybeSingle();
      return data ?? null;
    },
    staleTime: 30_000,
  });

  const status = cardioStatus(completion as any);
  const isCompleted = status === "logged";
  const isSkipped = status === "skipped";
  const view = resolveCardioActivity(target);
  const smartTargets = resolveCardioTargets(target);
  const typeName = cardioActivityLabel(target);

  useEffect(() => {
    if (!expanded) return;
    const c: any = completion;
    setActualDuration(c?.duration_minutes != null ? String(c.duration_minutes) : "");
    setRpe(c?.rpe != null ? String(c.rpe) : "");
    setNotes(c?.notes ?? "");
    setDistance(c?.distance != null ? String(c.distance) : "");
    setDistanceUnit(c?.distance_unit ?? "km");
    setAvgSpeed(c?.avg_speed != null ? String(c.avg_speed) : "");
    setIncline(c?.incline != null ? String(c.incline) : "");
    setCalories(c?.calories != null ? String(c.calories) : "");
    setSteps(c?.steps != null ? String(c.steps) : "");
    setAvgHr(c?.avg_heart_rate != null ? String(c.avg_heart_rate) : "");
  }, [expanded, completion]);

  const speedLabel = view.isTreadmill
    ? formatSpeedRange(target.speed_min_mph, target.speed_max_mph)
    : null;
  const inclineLabel = view.isTreadmill && Number(target.incline) > 0
    ? `${Number(target.incline)}%`
    : null;
  const finishParts = completionTargetParts({
    duration_minutes: target.duration_minutes,
    steps: smartTargets.steps,
    calories: smartTargets.calories,
    showCalories: target.show_calories_to_client,
  });
  // HR zone appears only when the coach intentionally prescribed one.
  const hrZone = target.heart_rate_zone?.trim() || null;
  const effort = target.intensity?.trim() || null;

  async function toggleComplete() {
    if (readonly || saving) return;
    setSaving(true);
    try {
      if (isCompleted || isSkipped) {
        await (supabase as any)
          .from("cardio_completions")
          .delete()
          .eq("client_id", clientId)
          .eq("cardio_target_id", target.id)
          .eq("completed_date", dateStr);
        toast.success("Cardio reset to not started");
      } else {
        await (supabase as any)
          .from("cardio_completions")
          .upsert({
            client_id: clientId,
            cardio_target_id: target.id,
            completed_date: dateStr,
            completed: true,
            skipped: false,
            duration_minutes: target.duration_minutes ?? null,
            cardio_type: target.cardio_type,
            day_type: target.day_type,
            completion_target: "manual",
          }, { onConflict: "client_id,cardio_target_id,completed_date" });
        toast.success("Cardio logged!");
      }
      qc.invalidateQueries({ queryKey: ["cardio-completion", clientId, target.id, dateStr] });
      qc.invalidateQueries({ queryKey: ["cardio-summary"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function markSkipped() {
    if (readonly || saving) return;
    setSaving(true);
    try {
      await (supabase as any)
        .from("cardio_completions")
        .upsert({
          client_id: clientId,
          cardio_target_id: target.id,
          completed_date: dateStr,
          completed: false,
          skipped: true,
          cardio_type: target.cardio_type,
          day_type: target.day_type,
        }, { onConflict: "client_id,cardio_target_id,completed_date" });
      toast.success("Cardio marked as skipped");
      qc.invalidateQueries({ queryKey: ["cardio-completion", clientId, target.id, dateStr] });
      qc.invalidateQueries({ queryKey: ["cardio-summary"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails() {
    if (readonly || saving) return;
    const num = (v: string) => {
      const n = Number(v);
      return v.trim() !== "" && Number.isFinite(n) ? n : null;
    };
    setSaving(true);
    try {
      const completedBy = resolveCompletionTarget({
        duration_minutes: target.duration_minutes,
        step_target: smartTargets.steps,
        calorie_target_min: smartTargets.calories,
        logged_duration_minutes: num(actualDuration),
        logged_steps: num(steps),
        logged_calories: num(calories),
      });
      await (supabase as any)
        .from("cardio_completions")
        .upsert({
          client_id: clientId,
          cardio_target_id: target.id,
          completed_date: dateStr,
          completed: true,
          skipped: false,
          duration_minutes: actualDuration ? parseInt(actualDuration, 10) : target.duration_minutes ?? null,
          cardio_type: target.cardio_type,
          rpe: num(rpe),
          distance: num(distance),
          distance_unit: num(distance) != null ? distanceUnit : null,
          avg_speed: num(avgSpeed),
          incline: num(incline),
          calories: num(calories),
          steps: num(steps),
          completion_target: completedBy ?? "manual",
          avg_heart_rate: num(avgHr),
          notes: notes.trim() || null,
          day_type: target.day_type,
        }, { onConflict: "client_id,cardio_target_id,completed_date" });
      toast.success("Cardio logged!");
      setExpanded(false);
      qc.invalidateQueries({ queryKey: ["cardio-completion", clientId, target.id, dateStr] });
      qc.invalidateQueries({ queryKey: ["cardio-summary"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className={`overflow-hidden transition-colors ${
      isCompleted ? "border-emerald-500/30 bg-emerald-500/5"
      : isSkipped ? "border-amber-500/30 bg-amber-500/5"
      : "border-border"
    }`}>
      <div className="p-3">
        <div className="flex items-start gap-2">
          {!readonly && (
            <button
              type="button"
              onClick={toggleComplete}
              disabled={saving || isLoading}
              aria-label={isCompleted ? "Mark cardio incomplete" : "Mark cardio complete"}
              className="mt-0.5 shrink-0 transition active:scale-95"
            >
              {isLoading || saving
                ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                : isCompleted
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  : isSkipped
                    ? <SkipForward className="h-5 w-5 text-amber-500" />
                    : <Circle className="h-5 w-5 text-muted-foreground hover:text-primary" />}
            </button>
          )}

          <div className="min-w-0 flex-1">
            {/* Activity · Mode · status */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={`text-base font-black leading-none ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
                {view.activity}
              </span>
              {view.modeLabel && (
                <span className="text-sm font-semibold text-muted-foreground">{view.modeLabel}</span>
              )}
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                · {cardioStatusLabel(status)}
              </span>
            </div>

            {/* Duration */}
            {target.duration_minutes ? (
              <div className="mt-1 text-sm font-bold">{target.duration_minutes} min</div>
            ) : null}

            {/* Treadmill settings — separated metrics, never a sentence */}
            {view.isTreadmill && (inclineLabel || speedLabel) && (
              <div className="mt-2 rounded-md border border-border bg-secondary/30 px-2.5 py-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Treadmill</p>
                <div className="mt-1 flex gap-6">
                  {inclineLabel && (
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Incline</p>
                      <p className="text-sm font-bold">{inclineLabel}</p>
                    </div>
                  )}
                  {speedLabel && (
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Speed</p>
                      <p className="text-sm font-bold">
                        {speedLabel}
                        {formatSpeedRange(target.speed_min_mph, target.speed_max_mph, "kph")
                          ? ` · ${formatSpeedRange(target.speed_min_mph, target.speed_max_mph, "kph")}`
                          : ""}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Effort / HR zone — only when prescribed */}
            {(effort || hrZone) && (
              <div className="mt-1.5 text-xs text-muted-foreground">
                {[effort, hrZone].filter(Boolean).join(" · ")}
              </div>
            )}

            {/* One completion rule */}
            {!isCompleted && finishParts.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-1 text-[11px] font-semibold">
                  Finish when you reach any one
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" aria-label="What does this mean?" className="text-muted-foreground hover:text-foreground">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 text-xs">
                      You don't need to hit every target. Once you reach the time, step, or calorie
                      target, you're done.
                    </PopoverContent>
                  </Popover>
                </div>
                <p className="text-xs text-muted-foreground">{finishParts.join(" · ")}</p>
                <p className="text-[10px] text-muted-foreground/80">Whichever comes first.</p>
              </div>
            )}

            {isCompleted && formatCardioLogLine(completion as any) && (
              <div className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {formatCardioLogLine(completion as any)}
              </div>
            )}

            {target.client_notes && (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none font-medium">Coach note</summary>
                <p className="mt-1 whitespace-pre-wrap">{target.client_notes}</p>
              </details>
            )}

            {isCompleted && completion?.notes && (
              <p className="mt-1 text-xs italic text-emerald-700">"{completion.notes}"</p>
            )}
          </div>

          {!readonly && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Hide log form" : isCompleted ? "Edit cardio log" : "Log details"}
              className="shrink-0 text-muted-foreground transition hover:text-foreground"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>

        {!readonly && !expanded && !isCompleted && !isSkipped && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => setExpanded(true)}>
              Log Cardio
            </Button>
            <Button size="sm" variant="outline" onClick={markSkipped} disabled={saving}>
              <SkipForward className="mr-1.5 h-3.5 w-3.5" /> Skip
            </Button>
          </div>
        )}

        {expanded && !readonly && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">
              Fill in whatever you tracked — one is enough.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Minutes</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder={target.duration_minutes ? String(target.duration_minutes) : "—"}
                  value={actualDuration}
                  onChange={(e) => setActualDuration(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Steps</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder={smartTargets.steps ? String(smartTargets.steps) : "—"}
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Calories</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder={smartTargets.calories ? String(smartTargets.calories) : "—"}
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showMore ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              More details (optional)
            </button>

            {showMore && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">RPE</Label>
                    <Input type="number" inputMode="decimal" min="1" max="10" step="0.5" placeholder="—" value={rpe} onChange={(e) => setRpe(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Distance</Label>
                    <Input type="number" inputMode="decimal" placeholder="—" value={distance} onChange={(e) => setDistance(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <select
                      value={distanceUnit}
                      onChange={(e) => setDistanceUnit(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="km">km</option>
                      <option value="mi">mi</option>
                      <option value="m">m</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {view.isTreadmill && (
                    <>
                      <div>
                        <Label className="text-xs">Speed</Label>
                        <Input type="number" inputMode="decimal" placeholder={target.speed_min_mph ? String(target.speed_min_mph) : "—"} value={avgSpeed} onChange={(e) => setAvgSpeed(e.target.value)} className="h-9 text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">Incline %</Label>
                        <Input type="number" inputMode="decimal" placeholder={target.incline ? String(target.incline) : "—"} value={incline} onChange={(e) => setIncline(e.target.value)} className="h-9 text-sm" />
                      </div>
                    </>
                  )}
                  <div>
                    <Label className="text-xs">Avg HR</Label>
                    <Input type="number" inputMode="numeric" placeholder="—" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} className="h-9 text-sm" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel?" rows={2} className="text-sm" />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={saveDetails} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                {isCompleted ? "Save changes" : "Log Cardio"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
