/**
 * WorkoutScheduleSetup — lets a member choose their training days after adding a program.
 *
 * The member selects N weekdays (where N = days_per_week) and a start date.
 * On confirm, we write all workout dates into member_plan_day_schedule so the
 * schedule is fully explicit and matches the coaching-client experience.
 *
 * The existing getEnrollmentSchedule + defaultScheduledDate logic is preserved
 * for enrollments that don't have explicit schedule entries.
 */

import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { format, addDays, nextDay, startOfDay } from "date-fns";
import { rescheduleDay } from "@/lib/member-plans.functions";

const WEEKDAYS = [
  { label: "Mon", value: 1, full: "Monday" },
  { label: "Tue", value: 2, full: "Tuesday" },
  { label: "Wed", value: 3, full: "Wednesday" },
  { label: "Thu", value: 4, full: "Thursday" },
  { label: "Fri", value: 5, full: "Friday" },
  { label: "Sat", value: 6, full: "Saturday" },
  { label: "Sun", value: 0, full: "Sunday" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrollmentId: string;
  planName: string;
  daysPerWeek: number;
  totalWeeks: number;
  /** All workout days in the plan: [{week, day}] */
  workoutDays: { week: number; day: number; title?: string | null }[];
  onScheduled: () => void;
}

export function WorkoutScheduleSetup({
  open,
  onOpenChange,
  enrollmentId,
  planName,
  daysPerWeek,
  totalWeeks,
  workoutDays,
  onScheduled,
}: Props) {
  const rescheduleFn = useServerFn(rescheduleDay);

  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startDate, setStartDate] = useState<string>(() => {
    // Default to next Monday
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    return format(addDays(today, daysUntilMonday), "yyyy-MM-dd");
  });
  const [saving, setSaving] = useState(false);

  const toggleDay = (day: number) => {
    setSelectedDays((prev) => {
      if (prev.includes(day)) return prev.filter((d) => d !== day);
      if (prev.length >= daysPerWeek) {
        toast.error(`This program requires exactly ${daysPerWeek} training days`);
        return prev;
      }
      return [...prev, day].sort((a, b) => {
        // Sort Mon-Sun (1,2,3,4,5,6,0)
        const order = [1, 2, 3, 4, 5, 6, 0];
        return order.indexOf(a) - order.indexOf(b);
      });
    });
  };

  // Generate preview schedule
  const previewSchedule = useMemo(() => {
    if (selectedDays.length !== daysPerWeek || !startDate) return [];

    const start = new Date(startDate + "T00:00:00");
    const sortedDays = [...selectedDays].sort((a, b) => {
      const order = [1, 2, 3, 4, 5, 6, 0];
      return order.indexOf(a) - order.indexOf(b);
    });

    // Generate dates for each workout day
    const result: { week: number; day: number; date: string; title?: string | null }[] = [];

    for (const wd of workoutDays) {
      const daySlot = (wd.day - 1) % daysPerWeek; // 0-indexed slot within the week
      const weekOffset = wd.week - 1; // 0-indexed week

      // Find the first occurrence of the chosen weekday at or after start
      const targetWeekday = sortedDays[daySlot];
      let date = new Date(start);

      // Move to the first occurrence of targetWeekday
      const startDayOfWeek = start.getDay();
      let daysToAdd = (targetWeekday - startDayOfWeek + 7) % 7;
      if (daysToAdd === 0 && weekOffset === 0 && daySlot === 0) daysToAdd = 0;
      date = addDays(date, daysToAdd);

      // Add weeks offset
      date = addDays(date, weekOffset * 7);

      result.push({
        week: wd.week,
        day: wd.day,
        date: format(date, "yyyy-MM-dd"),
        title: wd.title,
      });
    }

    return result;
  }, [selectedDays, startDate, daysPerWeek, workoutDays]);

  const handleConfirm = async () => {
    if (selectedDays.length !== daysPerWeek) {
      toast.error(`Please select exactly ${daysPerWeek} training days`);
      return;
    }
    if (!startDate) {
      toast.error("Please select a start date");
      return;
    }

    setSaving(true);
    try {
      // Write all workout dates to member_plan_day_schedule
      for (const entry of previewSchedule) {
        await rescheduleFn({
          data: {
            enrollmentId,
            weekIndex: entry.week,
            dayIndex: entry.day,
            scheduledDate: entry.date,
          },
        });
      }
      toast.success("Schedule saved! Your workouts are now scheduled.");
      onScheduled();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const isReady = selectedDays.length === daysPerWeek && !!startDate;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-xl font-black">Set Your Training Schedule</SheetTitle>
          <SheetDescription>
            <span className="font-medium text-foreground">{planName}</span> requires{" "}
            <span className="font-bold text-primary">{daysPerWeek} days/week</span> for{" "}
            {totalWeeks} weeks. Choose which days you'll train.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 pb-6">
          {/* Day selector */}
          <div className="space-y-3">
            <Label className="text-sm font-bold">
              Training Days{" "}
              <span className="font-normal text-muted-foreground">
                ({selectedDays.length}/{daysPerWeek} selected)
              </span>
            </Label>
            <div className="grid grid-cols-7 gap-2">
              {WEEKDAYS.map((wd) => {
                const isSelected = selectedDays.includes(wd.value);
                const isDisabled = !isSelected && selectedDays.length >= daysPerWeek;
                return (
                  <button
                    key={wd.value}
                    onClick={() => !isDisabled && toggleDay(wd.value)}
                    disabled={isDisabled}
                    className={[
                      "flex flex-col items-center rounded-xl border-2 py-3 text-xs font-bold transition-all",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground shadow-glow"
                        : isDisabled
                        ? "cursor-not-allowed border-border bg-muted/30 text-muted-foreground opacity-40"
                        : "border-border bg-card hover:border-primary/50 hover:bg-primary/5",
                    ].join(" ")}
                  >
                    <span className="text-[11px] uppercase tracking-wider">{wd.label}</span>
                    {isSelected && <CheckCircle2 className="mt-1 h-3 w-3" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Start date */}
          <div className="space-y-2">
            <Label htmlFor="start-date" className="text-sm font-bold">
              Start Date
            </Label>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Input
                id="start-date"
                type="date"
                value={startDate}
                min={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-auto"
              />
            </div>
          </div>

          {/* Preview */}
          {isReady && previewSchedule.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-bold">Schedule Preview</Label>
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <div className="space-y-1 text-xs">
                  {/* Show first 2 weeks */}
                  {previewSchedule.slice(0, Math.min(daysPerWeek * 2, previewSchedule.length)).map((entry) => (
                    <div key={`${entry.week}:${entry.day}`} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        Wk {entry.week} · Day {entry.day}
                        {entry.title ? ` — ${entry.title}` : ""}
                      </span>
                      <span className="font-medium tabular-nums">
                        {format(new Date(entry.date + "T00:00:00"), "EEE, MMM d")}
                      </span>
                    </div>
                  ))}
                  {previewSchedule.length > daysPerWeek * 2 && (
                    <div className="pt-1 text-muted-foreground">
                      + {previewSchedule.length - daysPerWeek * 2} more workouts…
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Validation message */}
          {selectedDays.length > 0 && selectedDays.length < daysPerWeek && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Select {daysPerWeek - selectedDays.length} more day{daysPerWeek - selectedDays.length > 1 ? "s" : ""}
            </div>
          )}

          {/* Confirm button */}
          <Button
            size="lg"
            className="w-full text-base font-bold"
            disabled={!isReady || saving}
            onClick={handleConfirm}
          >
            {saving ? "Saving schedule…" : "Confirm Schedule"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            You can adjust individual workout dates later from your plan view.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
