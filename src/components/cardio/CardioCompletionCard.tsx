/**
 * CardioCompletionCard — one prescribed cardio session, simplified.
 *
 * Client hierarchy: Activity → Mode → Duration → machine settings →
 * one completion rule → action. Historical `cardio_type` strings are
 * normalized for display only (see @/lib/cardio-activity) so analytics,
 * schedule sync and past logs are untouched.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Activity, Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cardioStatus, formatCardioLogLine } from "@/lib/cardio-plan";
import {
  CARDIO_EMPTY_METRICS,
  deleteCardioCompletion,
  saveCardioCompletion,
  type CardioCompletionRow,
} from "@/lib/cardio-completion";
import { resolveCardioTargets, resolveCompletionTarget } from "@/lib/cardio-prescription";
import { cardioNoteForAthlete, cardioTargetsView } from "@/lib/analytics/analytics-areas";
import {
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
  /** "primary": the day's main thing (a day off's cardio), its Done the red button;
   *  "secondary": beside a workout, whose Start is the day's one red button. */
  emphasis?: "primary" | "secondary";
  /** The day it's for ("Today", "Sat, Nov 21"), said before the minutes. */
  dayLabel?: string;
  /** Anything that belongs under the session (the next workout on a day off). */
  footer?: ReactNode;
};

export function CardioCompletionCard({ target, clientId, date, readonly = false, emphasis = "primary", dayLabel, footer }: Props) {
  const qc = useQueryClient();
  const dateStr = date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  const [expanded, setExpanded] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
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
      const { data, error } = await (supabase as any)
        .from("cardio_completions")
        .select("*")
        .eq("client_id", clientId)
        .eq("cardio_target_id", target.id)
        .eq("completed_date", dateStr)
        .limit(1);
      if (error) throw error;
      return ((data ?? []) as any[])[0] ?? null;
    },
    // logging the cardio inside the workout fills this in (the database does), so read it fresh
    staleTime: 5_000,
  });

  const status = cardioStatus(completion as any);
  const isCompleted = status === "logged";
  const isSkipped = status === "skipped";
  const view = resolveCardioActivity(target);
  const smartTargets = resolveCardioTargets(target);

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

  const key = { client_id: clientId, cardio_target_id: target.id, completed_date: dateStr };
  const queryKey = ["cardio-completion", clientId, target.id, dateStr];

  // Every cardio surface (workout summary, analytics, recovery) keys off
  // "cardio" somewhere in its first query-key segment.
  function refreshCardioViews(saved: CardioCompletionRow | null) {
    qc.setQueryData(queryKey, saved);
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("cardio") });
  }

  async function run(action: () => Promise<void>) {
    if (readonly || saving) return;
    setSaving(true);
    try {
      await action();
    } catch (e: any) {
      toast.error(e?.message ? `Couldn't save cardio: ${e.message}` : "Couldn't save cardio. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // One tap: "I did the session as prescribed", so it records the planned
  // minutes (the button says so). Tap again to reset.
  const toggleComplete = () => run(async () => {
    if (isCompleted || isSkipped) {
      await deleteCardioCompletion(supabase, key);
      refreshCardioViews(null);
      toast.success("Cardio reset to not started");
      return;
    }
    const saved = await saveCardioCompletion(supabase, {
      ...key,
      completed: true,
      skipped: false,
      duration_minutes: target.duration_minutes ?? null,
      cardio_type: target.cardio_type,
      day_type: target.day_type,
      completion_target: "manual",
    });
    refreshCardioViews(saved);
    toast.success("Cardio logged!");
  });

  const markSkipped = () => run(async () => {
    const saved = await saveCardioCompletion(supabase, {
      ...key,
      ...CARDIO_EMPTY_METRICS,
      completed: false,
      skipped: true,
      cardio_type: target.cardio_type,
      day_type: target.day_type,
    });
    refreshCardioViews(saved);
    toast.success("Cardio marked as skipped");
  });

  const saveDetails = () => run(async () => {
    const num = (v: string) => {
      const n = Number(v);
      return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
    };
    const minutes = num(actualDuration);
    const completedBy = resolveCompletionTarget({
      duration_minutes: target.duration_minutes,
      step_target: smartTargets.steps,
      calorie_target_min: smartTargets.calories,
      logged_duration_minutes: minutes,
      logged_steps: num(steps),
      logged_calories: num(calories),
    });
    const saved = await saveCardioCompletion(supabase, {
      ...key,
      completed: true,
      skipped: false,
      // what they typed only: a blank time is unknown, never the plan's
      duration_minutes: minutes != null ? Math.round(minutes) : null,
      cardio_type: target.cardio_type,
      rpe: num(rpe),
      distance: num(distance),
      distance_unit: num(distance) != null ? distanceUnit : null,
      avg_speed: num(avgSpeed),
      incline: num(incline),
      calories: num(calories) != null ? Math.round(num(calories)!) : null,
      steps: num(steps) != null ? Math.round(num(steps)!) : null,
      completion_target: completedBy ?? "manual",
      avg_heart_rate: num(avgHr) != null ? Math.round(num(avgHr)!) : null,
      notes: notes.trim() || null,
      day_type: target.day_type,
    });
    refreshCardioViews(saved);
    toast.success("Cardio logged!");
    setExpanded(false);
  });

  const kph = view.isTreadmill ? formatSpeedRange(target.speed_min_mph, target.speed_max_mph, "kph") : null;
  // The session in one line ("6% incline · 3.2–3.5 mph (5.1–5.6 km/h)"), the way it's done.
  const settings = [inclineLabel ? `${inclineLabel} incline` : null, speedLabel ? `${speedLabel}${kph ? ` (${kph})` : ""}` : null]
    .filter(Boolean)
    .join(" · ");
  // The main target said big; anything else that also counts as done, under it
  // (calories are a machine's or a watch's estimate and say so).
  void finishParts;
  const targets = cardioTargetsView({
    minutes: target.duration_minutes,
    steps: smartTargets.steps,
    calories: smartTargets.calories,
    showCalories: target.show_calories_to_client,
  });
  const finishLine = !isCompleted ? targets.alternatives : null;
  // A note that only restates the old "ANY ONE target" rule says nothing the targets don't.
  const coachNote = cardioNoteForAthlete(target.client_notes);
  const title = [view.activity, view.modeLabel].filter(Boolean).join(" · ");
  const logLine = isCompleted ? formatCardioLogLine(completion as any) : "";
  const meta = [dayLabel, isCompleted || isSkipped ? (target.duration_minutes ? `${target.duration_minutes} min` : null) : null].filter(Boolean).join(" · ");
  const isPrimary = emphasis === "primary";

  return (
    <Card className="overflow-hidden" data-cardio-card={status} data-cardio-emphasis={emphasis}>
      <div className={isPrimary ? "p-4 md:p-5" : "p-3.5"}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className={`flex items-center gap-1.5 font-semibold leading-snug ${isPrimary ? "text-lg" : "text-base"}`}>
              {/* a pulse line, never a heart (a heart reads as a favourite) */}
              <Activity className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">{title}</span>
            </div>
            {(meta || isCompleted || isSkipped) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground" data-cardio-meta>
                {meta && <span>{meta}</span>}
                {isCompleted && (
                  <>
                    {meta && <span aria-hidden>·</span>}
                    <span className="inline-flex items-center gap-1 font-medium text-success" data-cardio-done>
                      <Check className="h-3.5 w-3.5" aria-hidden /> Done
                    </span>
                  </>
                )}
                {isSkipped && (
                  <>
                    {meta && <span aria-hidden>·</span>}
                    <span className="font-medium text-foreground/80">Skipped</span>
                  </>
                )}
              </div>
            )}
          </div>
          {/* the rare one sits up here, out of the way of Done: Skip, or Edit / Undo once it's logged */}
          {!readonly && !isCompleted && !isSkipped && !expanded && (
            <Button
              size="sm"
              variant="ghost"
              className="-mr-1.5 -mt-1 h-10 shrink-0 px-2.5 text-muted-foreground"
              onClick={markSkipped}
              disabled={saving || isLoading}
              aria-label="Skip cardio today"
              data-cardio-skip
            >
              Skip
            </Button>
          )}
          {!readonly && (isCompleted || isSkipped) && !expanded && (
            <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
              {isCompleted && (
                <Button size="sm" variant="ghost" className="h-10 px-2.5 text-muted-foreground" onClick={() => setExpanded(true)} disabled={saving}>
                  Edit
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-10 px-2.5 text-muted-foreground" onClick={toggleComplete} disabled={saving || isLoading} aria-label="Undo: mark cardio not started">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Undo"}
              </Button>
            </div>
          )}
        </div>

        {/* What to do, said once: the target, the machine's settings, the effort, what else counts. */}
        {!isCompleted && !isSkipped && targets.primary && (
          <div className={cn("mt-2 font-semibold tabular-nums tracking-tight", isPrimary ? "text-2xl" : "text-xl")} data-cardio-target>
            {targets.primary}
          </div>
        )}
        {!isCompleted && (settings || effort || hrZone || finishLine) && (
          <div className="mt-1 space-y-0.5 text-[14px] leading-snug" data-cardio-prescription>
            {settings && <p className="text-foreground/90">{settings}</p>}
            {(effort || hrZone) && <p className="text-[13px] text-muted-foreground">{[effort, hrZone].filter(Boolean).join(" · ")}</p>}
            {finishLine && <p className="text-[13px] text-muted-foreground">{finishLine}</p>}
          </div>
        )}

        {isCompleted && logLine && (
          <p className="mt-2 text-[14px] text-foreground/90" data-cardio-logged>{logLine}</p>
        )}
        {isCompleted && completion?.notes && (
          <p className="mt-1 text-[13px] italic text-muted-foreground">"{completion.notes}"</p>
        )}

        {coachNote && !isCompleted && (
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            className="mt-2 block w-full text-left text-[13px] leading-snug text-muted-foreground"
            aria-expanded={noteOpen}
            data-cardio-note
          >
            <span className={noteOpen ? "whitespace-pre-wrap" : "line-clamp-2"}>
              <span className="font-medium text-foreground/80">Coach: </span>
              {coachNote}
            </span>
          </button>
        )}

        {!readonly && !expanded && !isCompleted && !isSkipped && (
          <div className="mt-3 flex items-center gap-2">
            {/* One tap: done as written. Beside a workout the workout's Start is the day's
                one red button, so there this is the secondary choice. */}
            <Button
              size={isPrimary ? "lg" : "default"}
              variant={isPrimary ? "default" : "secondary"}
              className="min-w-0 flex-1"
              onClick={toggleComplete}
              disabled={saving || isLoading}
              data-cardio-done-planned
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4 max-[359px]:hidden" />}
              <span className="max-[359px]:hidden">Done as planned</span>
              <span className="hidden max-[359px]:inline">Done</span>
            </Button>
            <Button
              size={isPrimary ? "lg" : "default"}
              variant="outline"
              className="shrink-0 px-4 max-[359px]:px-3"
              onClick={() => setExpanded(true)}
              disabled={saving}
              data-cardio-log-details
            >
              Log details
            </Button>
          </div>
        )}

        {expanded && !readonly && (
          <div className="mt-3 space-y-3 border-t border-border pt-3" data-cardio-form>
            <p className="text-[13px] text-muted-foreground">
              Copy it off your watch or machine. One number is enough.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Minutes</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder={target.duration_minutes ? String(target.duration_minutes) : "—"}
                  value={actualDuration}
                  onChange={(e) => setActualDuration(e.target.value)}
                  className="h-10 text-base md:text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Calories</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder={smartTargets.calories ? String(smartTargets.calories) : "—"}
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  className="h-10 text-base md:text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Avg HR</Label>
                <Input type="text" inputMode="numeric" placeholder="—" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} className="h-10 text-base md:text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Distance</Label>
                <Input type="text" inputMode="decimal" placeholder="—" value={distance} onChange={(e) => setDistance(e.target.value)} className="h-10 text-base md:text-sm" />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <select
                  value={distanceUnit}
                  onChange={(e) => setDistanceUnit(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-2 text-base md:text-sm"
                >
                  <option value="km">km</option>
                  <option value="mi">mi</option>
                  <option value="m">m</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Steps</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder={smartTargets.steps ? String(smartTargets.steps) : "—"}
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  className="h-10 text-base md:text-sm"
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
                    <Input type="text" inputMode="decimal" placeholder="—" value={rpe} onChange={(e) => setRpe(e.target.value)} className="h-10 text-base md:text-sm" />
                  </div>
                  {view.isTreadmill && (
                    <>
                      <div>
                        <Label className="text-xs">Speed</Label>
                        <Input type="text" inputMode="decimal" placeholder={target.speed_min_mph ? String(target.speed_min_mph) : "—"} value={avgSpeed} onChange={(e) => setAvgSpeed(e.target.value)} className="h-10 text-base md:text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">Incline %</Label>
                        <Input type="text" inputMode="decimal" placeholder={target.incline ? String(target.incline) : "—"} value={incline} onChange={(e) => setIncline(e.target.value)} className="h-10 text-base md:text-sm" />
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel?" rows={2} className="text-sm" />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={saveDetails} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                {isCompleted ? "Save changes" : "Log cardio"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {footer}
      </div>
    </Card>
  );
}
