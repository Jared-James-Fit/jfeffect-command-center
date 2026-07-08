import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarIcon,
  Loader2,
  Search,
  Dumbbell,
  ChevronLeft,
  Check,
} from "lucide-react";
import {
  getSchedulableWorkouts,
  scheduleWorkouts,
  listScheduledWorkouts,
} from "@/lib/scheduled-workouts.functions";

function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface ScheduleWorkoutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName?: string | null;
  /** Optional pre-selected date (from a calendar-cell "+" tap). */
  initialDate?: Date | null;
}

type Step = "date" | "block" | "workouts" | "confirm";

export function ScheduleWorkoutSheet({
  open,
  onOpenChange,
  clientId,
  clientName,
  initialDate,
}: ScheduleWorkoutSheetProps) {
  const queryClient = useQueryClient();
  const fetchBlocks = useServerFn(getSchedulableWorkouts);
  const fetchScheduled = useServerFn(listScheduledWorkouts);
  const schedule = useServerFn(scheduleWorkouts);

  const [step, setStep] = useState<Step>("date");
  const [date, setDate] = useState<Date | null>(initialDate ?? new Date());
  const [blockId, setBlockId] = useState<string | null>(null);
  const [selectedDayIds, setSelectedDayIds] = useState<string[]>([]);
  const [time, setTime] = useState<string>("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("date");
    setDate(initialDate ?? new Date());
    setBlockId(null);
    setSelectedDayIds([]);
    setTime("");
    setSearch("");
  }, [open, initialDate]);

  const blocksQ = useQuery({
    queryKey: ["schedulable-workouts", clientId],
    enabled: open,
    queryFn: () =>
      fetchBlocks({ data: { clientId, includeArchived: false } }),
  });

  const existingQ = useQuery({
    queryKey: ["scheduled-workouts-date", clientId, date ? toYMD(date) : null],
    enabled: open && !!date,
    queryFn: () =>
      fetchScheduled({
        data: {
          clientId,
          from: toYMD(date!),
          to: toYMD(date!),
        },
      }),
  });

  const blocks = blocksQ.data?.blocks ?? [];
  const selectedBlock = blocks.find((b: any) => b.id === blockId) ?? null;

  const filteredDays = useMemo(() => {
    if (!selectedBlock) return [];
    const q = search.trim().toLowerCase();
    return (selectedBlock.days ?? []).filter((d: any) => {
      if (!q) return true;
      const label = `${d.title ?? ""} ${d.focus ?? ""} day ${d.day_index}`.toLowerCase();
      return label.includes(q);
    });
  }, [selectedBlock, search]);

  const scheduleMutation = useMutation({
    mutationFn: () =>
      schedule({
        data: {
          clientId,
          sourceDayIds: selectedDayIds,
          date: toYMD(date!),
          time: time ? `${time}:00` : null,
        },
      }),
    onSuccess: () => {
      toast.success(
        selectedDayIds.length > 1
          ? `${selectedDayIds.length} workouts scheduled.`
          : "Workout scheduled.",
      );
      void queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast.error(e?.message ?? "Could not schedule workout."),
  });

  const toggleDay = (id: string) => {
    setSelectedDayIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const goNext = () => {
    if (step === "date" && date) setStep("block");
    else if (step === "block" && blockId) setStep("workouts");
    else if (step === "workouts" && selectedDayIds.length) setStep("confirm");
  };
  const goBack = () => {
    if (step === "confirm") setStep("workouts");
    else if (step === "workouts") setStep("block");
    else if (step === "block") setStep("date");
  };

  const existingCount = existingQ.data?.length ?? 0;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="px-2 pb-[max(env(safe-area-inset-bottom),1rem)] sm:max-w-md sm:left-1/2 sm:-translate-x-1/2">
        <DrawerHeader className="text-left">
          <DrawerTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" /> Schedule workout
          </DrawerTitle>
          <DrawerDescription>
            {clientName ? `For ${clientName}` : "Manual scheduling"} · Step{" "}
            {step === "date" ? 1 : step === "block" ? 2 : step === "workouts" ? 3 : 4} of 4
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-4 max-h-[62vh] overflow-y-auto">
          {step === "date" && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Choose a date</div>
              <div className="rounded-lg border border-border bg-card">
                <Calendar
                  mode="single"
                  selected={date ?? undefined}
                  onSelect={(d) => d && setDate(d)}
                  className="pointer-events-auto p-3"
                />
              </div>
              {date && existingCount > 0 && (
                <div className="rounded-md bg-secondary/40 p-3 text-xs">
                  {format(date, "EEE, MMM d")} already has{" "}
                  <span className="font-semibold">{existingCount}</span> workout
                  {existingCount === 1 ? "" : "s"} scheduled. New workouts will
                  be added, not overwritten.
                </div>
              )}
            </div>
          )}

          {step === "block" && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Choose a program / block</div>
              {blocksQ.isLoading && (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading assigned programs…
                </div>
              )}
              {!blocksQ.isLoading && !blocks.length && (
                <div className="rounded-md border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
                  This client has no assigned programs yet.
                </div>
              )}
              <div className="space-y-2">
                {blocks.map((b: any) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setBlockId(b.id);
                      setStep("workouts");
                    }}
                    className={`w-full text-left rounded-lg border p-3 transition ${
                      blockId === b.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-secondary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm">
                        {b.name || "Untitled block"}
                      </div>
                      {b.status === "active" && (
                        <Badge variant="outline" className="text-xs">Active</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {b.program_name ? `${b.program_name} · ` : ""}
                      {b.days?.length ?? 0} workouts
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "workouts" && selectedBlock && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Choose workout(s)</div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search workouts…"
                  className="pl-9 h-11"
                />
              </div>
              <ScrollArea className="h-[38vh] rounded-md border border-border">
                <div className="p-2 space-y-1">
                  {filteredDays.map((d: any) => {
                    const checked = selectedDayIds.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-start gap-3 rounded-md p-3 cursor-pointer transition ${
                          checked ? "bg-primary/10" : "hover:bg-secondary/40"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleDay(d.id)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Dumbbell className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-medium truncate">
                              {d.title || `Day ${d.day_index}`}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Week {d.week_index} · Day {d.day_index}
                            {d.focus ? ` · ${d.focus}` : ""}
                            {d.duration_estimate_min
                              ? ` · ~${d.duration_estimate_min}m`
                              : ""}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                  {!filteredDays.length && (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No workouts match.
                    </div>
                  )}
                </div>
              </ScrollArea>
              {selectedDayIds.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {selectedDayIds.length} selected
                </div>
              )}
            </div>
          )}

          {step === "confirm" && date && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                <div className="text-xs text-muted-foreground">Scheduling for</div>
                <div className="font-semibold">
                  {format(date, "EEEE, MMM d, yyyy")}
                </div>
                {existingCount > 0 && (
                  <div className="text-xs">
                    {existingCount} workout{existingCount === 1 ? "" : "s"} already
                    on this date · adding as workout{" "}
                    {existingCount + 1}
                    {selectedDayIds.length > 1
                      ? `–${existingCount + selectedDayIds.length}`
                      : ""}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  {selectedDayIds.length} workout
                  {selectedDayIds.length === 1 ? "" : "s"}
                </div>
                {selectedDayIds.map((id) => {
                  const d = (selectedBlock?.days ?? []).find(
                    (x: any) => x.id === id,
                  );
                  if (!d) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 p-2 text-sm"
                    >
                      <Check className="h-4 w-4 text-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          {d.title || `Day ${d.day_index}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Week {d.week_index} · Day {d.day_index}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium">
                  Optional start time
                </label>
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-11"
                />
              </div>
            </div>
          )}
        </div>

        <DrawerFooter className="flex flex-row gap-2 pt-2">
          {step !== "date" ? (
            <Button
              variant="outline"
              className="flex-1"
              onClick={goBack}
              disabled={scheduleMutation.isPending}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
          ) : (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          )}
          {step !== "confirm" ? (
            <Button
              className="flex-1"
              onClick={goNext}
              disabled={
                (step === "date" && !date) ||
                (step === "block" && !blockId) ||
                (step === "workouts" && !selectedDayIds.length)
              }
            >
              Next
            </Button>
          ) : (
            <Button
              className="flex-1"
              onClick={() => scheduleMutation.mutate()}
              disabled={scheduleMutation.isPending || !selectedDayIds.length}
            >
              {scheduleMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <CalendarIcon className="mr-1 h-4 w-4" />
              )}
              Schedule
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}