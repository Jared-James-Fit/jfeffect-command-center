/**
 * CardioCompletionCard: one prescribed cardio session and its log.
 *
 * Three layouts, one body (what to do, how to finish, the coach's note, the
 * log): `day` leads a day with no workout on the Workouts tab (the day card
 * holds it), `row` sits inside a workout's day card under its buttons (a
 * workout that doesn't carry the plan's row), `card` is its own card (the
 * workout page). Historical `cardio_type` strings are normalized for display
 * only (see @/lib/cardio-activity), so analytics, schedule sync and past logs
 * are untouched.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, CheckCircle2, ChevronDown, ChevronUp, Circle, Info, Loader2, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { CardMenu, CardMenuItem } from "@/components/workout-day/card-menu";
import { cardioStatus, formatCardioLogLine } from "@/lib/cardio-plan";
import {
  CARDIO_EMPTY_METRICS,
  deleteCardioCompletion,
  saveCardioCompletion,
  type CardioCompletionRow,
} from "@/lib/cardio-completion";
import { resolveCardioTargets, resolveCompletionTarget } from "@/lib/cardio-prescription";
import {
  cardioSessionTitle,
  cardioSpecParts,
  completionTargetParts,
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
  /** "day": leads a day card; "row": inside a workout's card; "card": its own card. */
  layout?: "card" | "day" | "row";
  /** The day's words for the `day` layout ("Today", "Sat, Nov 21"). */
  dayLabel?: string;
};

export function CardioCompletionCard({ target, clientId, date, readonly = false, layout = "card", dayLabel }: Props) {
  const qc = useQueryClient();
  const dateStr = date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  const [expanded, setExpanded] = useState(false);
  // the row layout folds to one line until it's opened
  const [rowOpen, setRowOpen] = useState(false);
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

  const title = cardioSessionTitle(view);
  // What to do in one line: the time, the machine's settings, the effort (said once).
  const specs = cardioSpecParts(target, view);
  const finishParts = completionTargetParts({
    duration_minutes: target.duration_minutes,
    steps: smartTargets.steps,
    calories: smartTargets.calories,
    showCalories: target.show_calories_to_client,
  });
  // Only worth a line when there's more than the time it already says.
  const showFinish = !isCompleted && !isSkipped && finishParts.length > 1;
  const logLine = isCompleted ? formatCardioLogLine(completion as any) : "";

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

  const finishLine = showFinish && (
    <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground" data-cardio-finish>
      Finish at any one: {finishParts.join(" · ")}{" "}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="What does this mean?"
            className="relative inline-grid h-4 w-4 place-items-center align-[-3px] text-muted-foreground before:absolute before:-inset-3 before:content-[''] hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 text-xs">
          You don't need to hit every target. Once you reach the time, step, or calorie
          target, you're done.
        </PopoverContent>
      </Popover>
    </p>
  );

  const statusWord = isCompleted ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-success" data-cardio-status="done">
      <Check className="h-3.5 w-3.5" aria-hidden /> Done
    </span>
  ) : isSkipped ? (
    <span className="shrink-0 text-[13px] font-medium text-muted-foreground" data-cardio-status="skipped">Skipped</span>
  ) : null;

  // Skipping is rare, so it's in a ⋯ (as a workout's Reschedule is), never a third button.
  const skipMenu = !readonly && !isCompleted && !isSkipped ? (
    <CardMenu
      name={title}
      ariaLabel="Cardio options"
      description="Options for this cardio session"
      vertical
      align="end"
      iconClassName="h-5 w-5"
      buttonClassName="-mr-2 -my-1.5 h-10 w-10 shrink-0 text-muted-foreground"
    >
      <CardMenuItem onSelect={markSkipped}>
        <SkipForward className="mr-2 h-4 w-4" /> Skip today
      </CardMenuItem>
    </CardMenu>
  ) : null;

  const body = (
    <>
      {(specs.length > 0 || layout === "row") && (
        <div className="mt-0.5 flex items-start justify-between gap-2">
          <p className="min-w-0 text-[14px] leading-snug text-muted-foreground" data-cardio-specs>{specs.join(" · ")}</p>
          {layout === "row" && skipMenu}
        </div>
      )}
      {finishLine}
      {logLine && (
        <p className="mt-1.5 text-[13px] text-foreground/80" data-cardio-log>
          Logged · {logLine}
        </p>
      )}
      {isCompleted && completion?.notes && (
        <p className="mt-1 text-[13px] italic text-muted-foreground">"{completion.notes}"</p>
      )}
      {target.client_notes && (
        <details className="group mt-1.5 text-[13px] text-muted-foreground">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 font-medium text-foreground/80 [&::-webkit-details-marker]:hidden">
            Coach note
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="whitespace-pre-wrap pb-1 leading-relaxed">{target.client_notes}</p>
        </details>
      )}

      {!readonly && !expanded && (
        // Two buttons that share the row, each a full row on a narrow phone (never cut off).
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!isCompleted && !isSkipped ? (
            <>
              <Button
                size={layout === "day" ? "lg" : "default"}
                // red only when it's the day's one thing to do (a cardio day); beside a
                // workout, Start / Finish Workout is the screen's one main action
                variant={layout === "day" ? "default" : "secondary"}
                className={cn("min-w-[9.5rem] flex-1 px-4", layout !== "day" && "h-10")}
                onClick={toggleComplete}
                disabled={saving || isLoading}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Done as planned
              </Button>
              <Button
                size={layout === "day" ? "lg" : "default"}
                variant="outline"
                className={cn("min-w-[7.5rem] flex-1 px-4", layout !== "day" && "h-10")}
                onClick={() => setExpanded(true)}
                disabled={saving}
              >
                Add numbers
              </Button>
            </>
          ) : (
            <>
              {isCompleted && (
                <Button variant="outline" size="sm" className="h-9" onClick={() => setExpanded(true)} disabled={saving}>
                  Edit log
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={toggleComplete} disabled={saving || isLoading}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isSkipped ? "Undo skip" : "Reset"}
              </Button>
            </>
          )}
        </div>
      )}

      {expanded && !readonly && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <p className="text-[12px] text-muted-foreground">
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
                className="h-10 text-base"
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
                className="h-10 text-base"
              />
            </div>
            <div>
              <Label className="text-xs">Avg HR</Label>
              <Input type="text" inputMode="numeric" placeholder="—" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} className="h-10 text-base" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Distance</Label>
              <Input type="text" inputMode="decimal" placeholder="—" value={distance} onChange={(e) => setDistance(e.target.value)} className="h-10 text-base" />
            </div>
            <div>
              <Label className="text-xs">Unit</Label>
              <select
                value={distanceUnit}
                onChange={(e) => setDistanceUnit(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-2 text-base"
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
                className="h-10 text-base"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="flex min-h-9 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showMore ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            More details (optional)
          </button>

          {showMore && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">RPE</Label>
                  <Input type="text" inputMode="decimal" placeholder="—" value={rpe} onChange={(e) => setRpe(e.target.value)} className="h-10 text-base" />
                </div>
                {view.isTreadmill && (
                  <>
                    <div>
                      <Label className="text-xs">Speed</Label>
                      <Input type="text" inputMode="decimal" placeholder={target.speed_min_mph ? String(target.speed_min_mph) : "—"} value={avgSpeed} onChange={(e) => setAvgSpeed(e.target.value)} className="h-10 text-base" />
                    </div>
                    <div>
                      <Label className="text-xs">Incline %</Label>
                      <Input type="text" inputMode="decimal" placeholder={target.incline ? String(target.incline) : "—"} value={incline} onChange={(e) => setIncline(e.target.value)} className="h-10 text-base" />
                    </div>
                  </>
                )}
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel?" rows={2} className="text-base" />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button className="flex-1" onClick={saveDetails} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {isCompleted ? "Save changes" : "Log cardio"}
            </Button>
            <Button variant="ghost" onClick={() => setExpanded(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </>
  );

  // Leads a day with no workout: the day, then what to do and its buttons.
  if (layout === "day") {
    return (
      <div data-cardio-day={status}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted-foreground">{dayLabel ? `${dayLabel} · ` : ""}Cardio</span>
          {statusWord ?? skipMenu}
        </div>
        <div className="mt-1 text-lg font-semibold leading-snug" data-cardio-title>{title}</div>
        {body}
      </div>
    );
  }

  // Inside a workout's card: one line until it's opened; the circle logs it as planned.
  if (layout === "row") {
    return (
      <div className="mt-3 border-t border-border pt-2" data-cardio-row={status}>
        <div className="flex min-h-11 items-center gap-1">
          {!readonly ? (
            <button
              type="button"
              onClick={toggleComplete}
              disabled={saving || isLoading}
              aria-label={isCompleted || isSkipped ? "Reset cardio" : "Mark cardio done as planned"}
              className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-95"
            >
              {isLoading || saving ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : isCompleted ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : isSkipped ? (
                <SkipForward className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
          ) : (
            <span className="w-2" aria-hidden />
          )}
          <button
            type="button"
            onClick={() => { setRowOpen((v) => !v); if (rowOpen) setExpanded(false); }}
            aria-expanded={rowOpen}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-semibold">Cardio</span>
              {/* the minutes until it's done; then "Done" says it and the log has the real time */}
              <span className="text-muted-foreground"> · {title}{target.duration_minutes && !statusWord ? ` · ${target.duration_minutes} min` : ""}</span>
            </span>
            {statusWord}
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", rowOpen && "rotate-180")} aria-hidden />
          </button>
        </div>
        {rowOpen && <div className="pb-1">{body}</div>}
      </div>
    );
  }

  return (
    <Card className="p-4" data-cardio-card={status}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-base font-semibold leading-snug" data-cardio-title>{title}</span>
        {statusWord ?? skipMenu}
      </div>
      {body}
    </Card>
  );
}
