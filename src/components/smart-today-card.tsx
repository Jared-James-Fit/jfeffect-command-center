import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, ArrowRight, Coffee, AlertCircle, CheckCircle2, Clock, Crosshair, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeTodayState,
  dayDisplayTitle,
  dayDurationLabel,
  type WorkoutItem,
  type TodayState,
} from "@/lib/workout-today";

/**
 * The single "What do I do today?" card at the top of the client Workouts page.
 * Only ever shows ONE primary action.
 */
export function SmartTodayCard({
  items,
  clientId,
}: {
  items: WorkoutItem[];
  clientId: string;
}) {
  const { data: client } = useQuery({
    queryKey: ["my-client-schedule", clientId],
    queryFn: async () =>
      (await supabase.from("clients").select("preferred_training_days, preferred_rest_days").eq("id", clientId).maybeSingle()).data,
  });

  const state = computeTodayState(items, client as any);
  if (state.kind === "no_program") return null;

  return <SmartTodayCardInner state={state} />;
}

function SmartTodayCardInner({ state }: { state: TodayState }) {
  const view = render(state);
  // Pull block / week / day title out of state where available so the hero
  // hierarchy (Block → Day → Week/Status → CTA) is always front and centre.
  const it: WorkoutItem | undefined = (state as any).item;
  const blockName: string | null = it?.block?.name ?? (state as any).block?.name ?? null;
  const weekIdx: number | null = it?.week?.week_index ?? null;
  const dayTitle: string | null = it ? dayDisplayTitle(it) : null;
  const dayFocus: string | null = it?.day?.focus ?? null;

  return (
    <Card
      className={cn(
        "relative overflow-hidden border p-0 text-foreground",
        "bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950",
        view.borderClass,
      )}
    >
      {/* Brand red glow accents — screenshot-worthy without being noisy */}
      <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:18px_18px]" />

      <div className="relative space-y-4 p-5 md:p-7">
        {/* Eyebrow row: status pill + week */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]",
              view.statusPillClass ?? "bg-primary text-primary-foreground",
            )}
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center">{view.icon}</span>
            {view.eyebrow}
          </span>
          {weekIdx != null && (
            <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/70">
              Week {weekIdx}
            </span>
          )}
        </div>

        {/* Block title — the big screenshot moment */}
        {blockName ? (
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/90">
            {blockName}
          </div>
        ) : null}

        {/* Day title — primary headline */}
        <h2 className="text-3xl font-black leading-[1.05] tracking-tight text-white md:text-4xl">
          {dayTitle ?? view.title}
        </h2>
        {dayFocus && (
          <div className="text-sm font-semibold uppercase tracking-wide text-white/60">
            {dayFocus}
          </div>
        )}
        {!dayTitle && view.subtitle && (
          <p className="text-sm text-white/70">{view.subtitle}</p>
        )}
        {dayTitle && view.subtitle && (
          <p className="text-sm text-white/70">{view.subtitle}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1 [&_a]:w-full [&_a]:sm:w-auto [&_button]:w-full [&_button]:sm:w-auto">
          {view.primary}
          {view.secondary}
        </div>
      </div>
    </Card>
  );
}

type View = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  meta?: string[];
  icon: React.ReactNode;
  iconBg: string;
  borderClass: string;
  bgClass: string;
  statusPillClass?: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
};

function startBtn(item: WorkoutItem, label: string, icon: React.ReactNode) {
  return (
    <Link to="/portal/workouts/$dayId" params={{ dayId: item.day.id }}>
      <Button size="lg" className="font-bold uppercase">
        {icon} {label}
      </Button>
    </Link>
  );
}

function render(state: TodayState): View {
  switch (state.kind) {
    case "workout_today": {
      const it = state.item;
      const meta: string[] = [];
      if (it.block?.name) meta.push(it.block.name);
      if (it.week?.week_index != null) meta.push(`Week ${it.week.week_index}`);
      const dur = dayDurationLabel(it);
      return {
        eyebrow: "Today's Workout",
        title: dayDisplayTitle(it) + (it.day?.focus ? ` — ${it.day.focus}` : ""),
        subtitle: dur ? `Estimated ${dur}` : undefined,
        meta,
        icon: <Play className="h-5 w-5 text-primary-foreground" />,
        iconBg: "bg-primary",
        borderClass: "border-primary",
        bgClass: "bg-primary",
        primary: startBtn(it, "Start Today's Workout", <Play className="mr-2 h-4 w-4" />),
      };
    }
    case "in_progress": {
      const it = state.item;
      const meta: string[] = [];
      if (it.block?.name) meta.push(it.block.name);
      if (it.week?.week_index != null) meta.push(`Week ${it.week.week_index}`);
      return {
        eyebrow: "Workout In Progress",
        title: dayDisplayTitle(it) + (it.day?.focus ? ` — ${it.day.focus}` : ""),
        subtitle: "Pick up where you left off.",
        meta,
        icon: <RotateCcw className="h-5 w-5 text-primary-foreground" />,
        iconBg: "bg-amber-500",
        borderClass: "border-amber-500",
        bgClass: "bg-amber-500",
        primary: startBtn(it, "Continue Workout", <Play className="mr-2 h-4 w-4" />),
      };
    }
    case "rest_day": {
      const next = state.next;
      return {
        eyebrow: "Rest Day",
        title: "No workout scheduled today.",
        subtitle: "Recover, eat well, sleep well — see you next session.",
        icon: <Coffee className="h-5 w-5 text-primary-foreground" />,
        iconBg: "bg-sky-500",
        borderClass: "border-sky-500/60",
        bgClass: "bg-sky-500",
        primary: next ? (
          <Link to="/portal/workouts/$dayId" params={{ dayId: next.day.id }}>
            <Button size="lg" variant="outline" className="font-bold uppercase">
              View Upcoming Workout <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        ) : null,
      };
    }
    case "upcoming": {
      const it = state.item;
      const meta: string[] = [];
      if (it.block?.name) meta.push(it.block.name);
      if (it.week?.week_index != null) meta.push(`Week ${it.week.week_index}`);
      return {
        eyebrow: "Next Workout",
        title: dayDisplayTitle(it) + (it.day?.focus ? ` — ${it.day.focus}` : ""),
        subtitle: state.whenLabel,
        meta,
        icon: <Crosshair className="h-5 w-5 text-primary-foreground" />,
        iconBg: "bg-primary",
        borderClass: "border-primary/60",
        bgClass: "bg-primary",
        primary: (
          <Link to="/portal/workouts/$dayId" params={{ dayId: it.day.id }}>
            <Button size="lg" className="font-bold uppercase">
              View Upcoming Workout <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        ),
      };
    }
    case "missed": {
      const it = state.item;
      const meta: string[] = [];
      if (it.block?.name) meta.push(it.block.name);
      if (it.week?.week_index != null) meta.push(`Week ${it.week.week_index}`);
      return {
        eyebrow: "Workout Missed",
        title: dayDisplayTitle(it) + (it.day?.focus ? ` — ${it.day.focus}` : ""),
        subtitle: `You had a scheduled workout ${state.whenLabel}.`,
        meta,
        icon: <AlertCircle className="h-5 w-5 text-primary-foreground" />,
        iconBg: "bg-destructive",
        borderClass: "border-destructive/60",
        bgClass: "bg-destructive",
        primary: startBtn(it, "Complete Missed Workout", <Play className="mr-2 h-4 w-4" />),
      };
    }
    case "block_complete": {
      return {
        eyebrow: "Block Complete",
        title: state.block?.name ? `${state.block.name} — All Workouts Complete` : "All Workouts Complete",
        subtitle: "Nice work. Your coach will set up your next block.",
        icon: <CheckCircle2 className="h-5 w-5 text-primary-foreground" />,
        iconBg: "bg-emerald-500",
        borderClass: "border-emerald-500/60",
        bgClass: "bg-emerald-500",
        primary: (
          <Link to="/portal/workouts">
            <Button size="lg" variant="outline" className="font-bold uppercase">
              View Program <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        ),
      };
    }
    default:
      return {
        eyebrow: "",
        title: "",
        icon: <Clock className="h-5 w-5" />,
        iconBg: "bg-muted",
        borderClass: "border-border",
        bgClass: "bg-muted",
        primary: null,
      };
  }
}