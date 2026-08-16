/**
 * CardioCompletionCard — a single prescribed cardio session with real logging.
 *
 * Status is always explicit: Not started · Logged · Skipped.
 * Logging captures duration, type, distance, speed/incline, calories, avg HR,
 * RPE and notes — every field optional except duration. Logged sessions stay
 * editable, and Zone 2 / LISS targets offer a suggested default setup that
 * only fills gaps the coach left blank.
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
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Loader2, SkipForward, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { dayTypeLabel, dayTypeTone } from "@/lib/training-schedule";
import { format } from "date-fns";
import {
  cardioStatus,
  cardioStatusLabel,
  formatCardioLogLine,
  suggestedCardioSetup,
} from "@/lib/cardio-plan";
import { cardioCompletionRuleLabel, resolveCardioTargets, resolveCompletionTarget } from "@/lib/cardio-prescription";

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

const CARDIO_TYPES = [
  "Walking", "Running", "Cycling", "Rowing", "Elliptical",
  "Stairmaster", "Swimming", "LISS", "HIIT", "Incline Walk",
  "Bike", "Ski Erg", "Sled Push", "Custom",
];

export function CardioCompletionCard({ target, clientId, date, readonly = false }: Props) {
  const qc = useQueryClient();
  const dateStr = date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actualDuration, setActualDuration] = useState("");
  const [actualType, setActualType] = useState("");
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
  const suggestion = suggestedCardioSetup(target);
  const smartTargets = resolveCardioTargets(target);

  // Hydrate the form from the saved log so editing never starts blank.
  useEffect(() => {
    if (!expanded) return;
    const c: any = completion;
    setActualDuration(c?.duration_minutes != null ? String(c.duration_minutes) : "");
    setActualType(c?.cardio_type ?? "");
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

  const typeName = target.cardio_type === "Custom"
    ? target.custom_type || "Custom"
    : target.cardio_type;

  const metaParts: string[] = [];
  if (target.duration_minutes) metaParts.push(`${target.duration_minutes} min`);
  else if (suggestion) metaParts.push(`${suggestion.durationMinutes} min (suggested)`);
  if (target.intensity) metaParts.push(target.intensity);
  if (target.heart_rate_zone) metaParts.push(target.heart_rate_zone);
  else if (suggestion) metaParts.push(suggestion.heartRateZone);
  if (target.machine_preference) metaParts.push(target.machine_preference);
  if (smartTargets.steps) metaParts.push(`${smartTargets.steps.toLocaleString()} steps`);

  const cal = target.show_calories_to_client && smartTargets.calories
    ? `~${smartTargets.calories} kcal`
    : null;

  async function toggleComplete() {
    if (readonly || saving) return;
    setSaving(true);
    try {
      if (isCompleted || isSkipped) {
        // Mark incomplete — delete the completion
        await (supabase as any)
          .from("cardio_completions")
          .delete()
          .eq("client_id", clientId)
          .eq("cardio_target_id", target.id)
          .eq("completed_date", dateStr);
        toast.success("Cardio reset to not started");
      } else {
        // Mark complete with defaults
        await (supabase as any)
          .from("cardio_completions")
          .upsert({
            client_id: clientId,
            cardio_target_id: target.id,
            completed_date: dateStr,
            completed: true,
            skipped: false,
            duration_minutes: target.duration_minutes ?? suggestion?.durationMinutes ?? null,
            cardio_type: typeName,
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
          cardio_type: typeName,
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

  function applySuggestion() {
    if (!suggestion) return;
    setActualDuration(String(suggestion.durationMinutes));
    if (!actualType) setActualType(typeName);
    if (!rpe) setRpe("3.5");
    if (!incline) setIncline("8");
    if (!avgSpeed) setAvgSpeed("3.2");
    toast.success("Suggested Zone 2 setup applied");
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
          duration_minutes: actualDuration
            ? parseInt(actualDuration, 10)
            : target.duration_minutes ?? suggestion?.durationMinutes ?? null,
          cardio_type: actualType || typeName,
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
        {/* Header row */}
        <div className="flex items-start gap-2">
          {/* Complete toggle */}
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

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <Badge variant="outline" className={dayTypeTone(target.day_type)}>
                {dayTypeLabel(target)}
              </Badge>
              <span className={`font-semibold text-sm ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
                {typeName}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  isCompleted ? "border-emerald-500/30 text-emerald-600"
                  : isSkipped ? "border-amber-500/30 text-amber-600"
                  : "text-muted-foreground"
                }`}
              >
                {cardioStatusLabel(status)}
              </Badge>
              {cal && <Badge variant="outline" className="text-[10px]">{cal}</Badge>}
            </div>

            {metaParts.length > 0 && (
              <div className="text-xs text-muted-foreground">{metaParts.join(" · ")}</div>
            )}

            {!isCompleted && (
              <div className="mt-2 rounded-md border border-primary/25 bg-primary/5 px-2 py-1.5 text-[11px] text-foreground">
                <p className="font-semibold">Finish when ONE target is reached</p>
                <p className="mt-0.5 text-muted-foreground">
                  {[target.duration_minutes ? `${target.duration_minutes} min` : null, smartTargets.steps ? `${smartTargets.steps.toLocaleString()} steps` : null, smartTargets.calories ? `~${smartTargets.calories} kcal` : null].filter(Boolean).join("  OR  ")}
                </p>
                <p className="mt-0.5 text-muted-foreground">{cardioCompletionRuleLabel()}</p>
              </div>
            )}

            {suggestion && !isCompleted && (
              <div className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                <span>
                  Suggested: {suggestion.durationMinutes} min · {suggestion.speedHint} at{" "}
                  {suggestion.inclineHint} incline · {suggestion.rpeHint}
                </span>
              </div>
            )}

            {isCompleted && formatCardioLogLine(completion as any) && (
              <div className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {formatCardioLogLine(completion as any)}
              </div>
            )}

            {target.goal && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Goal: <span className="text-foreground">{target.goal}</span>
              </div>
            )}

            {target.client_notes && (
              <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">
                {target.client_notes}
              </p>
            )}

            {isCompleted && completion?.notes && (
              <p className="mt-1 text-xs text-emerald-700 italic">"{completion.notes}"</p>
            )}
          </div>

          {/* Log details toggle */}
          {!readonly && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Hide log form" : isCompleted ? "Edit cardio log" : "Log details"}
              className="shrink-0 text-muted-foreground hover:text-foreground transition"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>

        {!readonly && !expanded && !isCompleted && !isSkipped && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => setExpanded(true)}>
              Log cardio
            </Button>
            <Button size="sm" variant="outline" onClick={markSkipped} disabled={saving}>
              <SkipForward className="mr-1.5 h-3.5 w-3.5" /> Skip
            </Button>
          </div>
        )}

        {/* Expandable log form */}
        {expanded && !readonly && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            {suggestion && (
              <Button size="sm" variant="outline" className="w-full" onClick={applySuggestion}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Use suggested Zone 2 setup
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Duration (min)</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder={target.duration_minutes ? String(target.duration_minutes) : "—"}
                  value={actualDuration}
                  onChange={(e) => setActualDuration(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">RPE (1-10)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="10"
                  step="0.5"
                  placeholder="—"
                  value={rpe}
                  onChange={(e) => setRpe(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <Label className="text-xs">Distance</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="—"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <select
                  value={distanceUnit}
                  onChange={(e) => setDistanceUnit(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="km">km</option>
                  <option value="mi">mi</option>
                  <option value="m">m</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Steps</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder={smartTargets.steps ? String(smartTargets.steps) : "—"}
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  className="h-8 text-sm"
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
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Speed</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={suggestion ? "3.2" : "—"}
                  value={avgSpeed}
                  onChange={(e) => setAvgSpeed(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Incline %</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={suggestion ? "8" : "—"}
                  value={incline}
                  onChange={(e) => setIncline(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Avg HR</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="—"
                  value={avgHr}
                  onChange={(e) => setAvgHr(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Cardio Type</Label>
              <select
                value={actualType}
                onChange={(e) => setActualType(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{typeName} (default)</option>
                {CARDIO_TYPES.filter((t) => t !== typeName).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="How did it feel? Any notes…"
                rows={2}
                className="text-sm"
              />
            </div>
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
