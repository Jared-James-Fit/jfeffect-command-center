import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Play,
  Coffee,
  Crosshair,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  ArrowRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  computeTodayState,
  dayDisplayTitle,
  dayScheduledDate,
  type TodayState,
  type WorkoutItem,
} from "@/lib/workout-today";
import { localStartOfToday } from "@/lib/today";
import { getClientTodayItems } from "@/lib/today-dashboard.functions";

export function DashboardTodayCard({ clientId }: { clientId: string }) {
  const { data: clientPrefs } = useQuery({
    queryKey: ["my-client-schedule", clientId],
    queryFn: async () =>
      (
        await supabase
          .from("clients")
          .select("preferred_training_days, preferred_rest_days")
          .eq("id", clientId)
          .maybeSingle()
      ).data,
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-workouts", clientId],
    queryFn: () => getClientTodayItems(clientId),
    enabled: !!clientId,
  });

  if (isLoading) return <DashboardTodaySkeleton />;
  const state = computeTodayState(items, clientPrefs as any);
  if (state.kind === "no_program") return null;

  return <DashboardTodayCardInner state={state} />;
}

function DashboardTodaySkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card/40 animate-pulse h-24" />
  );
}

function DashboardTodayCardInner({ state }: { state: TodayState }) {
  const view = buildView(state);
  return (
    <Card className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-sm",
            view.iconBg,
          )}
        >
          {view.icon}
        </div>
        <div className="min-w-0 flex-1">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-black uppercase tracking-wider",
              view.badgeClass,
            )}
          >
            {view.eyebrow}
          </Badge>
          <h3 className="mt-1 text-sm font-bold leading-tight">{view.title}</h3>
          {view.subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{view.subtitle}</p>
          )}
          {view.primary && <div className="mt-2">{view.primary}</div>}
        </div>
      </div>
    </Card>
  );
}

function buildView(state: TodayState) {
  const today = localStartOfToday();
  switch (state.kind) {
    case "workout_today": {
      const it = state.item;
      const meta = [];
      if (it.block?.name) meta.push(it.block.name);
      if (it.week?.week_index != null) meta.push(`Week ${it.week.week_index + 1}`);
      return {
        eyebrow: "Training Day",
        title: `${dayDisplayTitle(it)}${it.day?.focus ? ` — ${it.day.focus}` : ""}`,
        subtitle: meta.join(" · ") || undefined,
        icon: <Play className="h-5 w-5" />,
        iconBg: "bg-primary",
        badgeClass: "border-primary/30 bg-primary/10 text-primary",
        primary: (
          <Button asChild size="sm">
            <Link to="/portal/workouts/$dayId" params={{ dayId: it.day.id }} search={(it.scheduledWorkoutId ? { instance: it.scheduledWorkoutId } : undefined) as any}>
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Start Workout
            </Link>
          </Button>
        ),
      };
    }
    case "in_progress": {
      const it = state.item;
      return {
        eyebrow: "In Progress",
        title: `${dayDisplayTitle(it)}${it.day?.focus ? ` — ${it.day.focus}` : ""}`,
        subtitle: "Pick up where you left off.",
        icon: <RotateCcw className="h-5 w-5" />,
        iconBg: "bg-amber-500",
        badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-500",
        primary: (
          <Button asChild size="sm">
            <Link to="/portal/workouts/$dayId" params={{ dayId: it.day.id }} search={(it.scheduledWorkoutId ? { instance: it.scheduledWorkoutId } : undefined) as any}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Continue
            </Link>
          </Button>
        ),
      };
    }
    case "rest_day": {
      const next = state.next;
      return {
        eyebrow: "Rest Day",
        title: "No workout scheduled today",
        subtitle: nextLabel(next, today),
        icon: <Coffee className="h-5 w-5" />,
        iconBg: "bg-sky-500",
        badgeClass: "border-sky-500/30 bg-sky-500/10 text-sky-500",
        primary: next ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/portal/workouts/$dayId" params={{ dayId: next.day.id }} search={(next.scheduledWorkoutId ? { instance: next.scheduledWorkoutId } : undefined) as any}>
              Upcoming <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null,
      };
    }
    case "upcoming": {
      const it = state.item;
      return {
        eyebrow: "Upcoming",
        title: `${dayDisplayTitle(it)}${it.day?.focus ? ` — ${it.day.focus}` : ""}`,
        subtitle: state.whenLabel,
        icon: <Crosshair className="h-5 w-5" />,
        iconBg: "bg-primary",
        badgeClass: "border-primary/30 bg-primary/10 text-primary",
        primary: (
          <Button asChild size="sm" variant="outline">
            <Link to="/portal/workouts/$dayId" params={{ dayId: it.day.id }} search={(it.scheduledWorkoutId ? { instance: it.scheduledWorkoutId } : undefined) as any}>
              View <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        ),
      };
    }
    case "missed": {
      const it = state.item;
      return {
        eyebrow: "Missed",
        title: `${dayDisplayTitle(it)}${it.day?.focus ? ` — ${it.day.focus}` : ""}`,
        subtitle: state.whenLabel,
        icon: <AlertCircle className="h-5 w-5" />,
        iconBg: "bg-destructive",
        badgeClass: "border-destructive/30 bg-destructive/10 text-destructive",
        primary: (
          <Button asChild size="sm" variant="outline">
            <Link to="/portal/workouts/$dayId" params={{ dayId: it.day.id }} search={(it.scheduledWorkoutId ? { instance: it.scheduledWorkoutId } : undefined) as any}>
              Complete <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        ),
      };
    }
    case "block_complete": {
      return {
        eyebrow: "All Done",
        title: state.block?.name
          ? `${state.block.name} — Complete`
          : "All Workouts Complete",
        subtitle: "Nice work. Your coach will queue your next block.",
        icon: <CheckCircle2 className="h-5 w-5" />,
        iconBg: "bg-emerald-500",
        badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
        primary: (
          <Button asChild size="sm" variant="outline">
            <Link to="/portal/workouts">
              Program <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        ),
      };
    }
    default: {
      return null as never;
    }
  }
}

function nextLabel(next: WorkoutItem | undefined, today: Date): string | undefined {
  if (!next) return "Recover, eat well, sleep well.";
  const sd = dayScheduledDate(next);
  if (!sd) return "Recover, eat well, sleep well.";
  const diff = Math.round((sd.getTime() - today.getTime()) / 86400000);
  if (diff <= 0) return "Next session today.";
  if (diff === 1) return "Next session tomorrow.";
  return `Next session in ${diff} days.`;
}
