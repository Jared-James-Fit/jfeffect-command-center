import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, ArrowRight, Coffee, AlertCircle, CheckCircle2, Crosshair } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getEnrollmentSchedule } from "@/lib/member-plans.functions";

type Enrollment = {
  id: string;
  current_week?: number | null;
  member_plans?: { id: string; name: string; weeks: number; days_per_week: number } | null;
};

function todayYMD(tz?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()); // en-CA → YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function relLabel(targetYMD: string, todayStr: string): string {
  const a = new Date(targetYMD + "T00:00:00Z").getTime();
  const b = new Date(todayStr + "T00:00:00Z").getTime();
  const days = Math.round((a - b) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export function MemberTodayCard({ enrollment }: { enrollment: Enrollment }) {
  const fetchSchedule = useServerFn(getEnrollmentSchedule);
  const tz = typeof window !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : undefined;

  const { data: schedule = [] } = useQuery({
    queryKey: ["m-today-schedule", enrollment.id, tz],
    queryFn: async () => {
      const r = await fetchSchedule({ data: { enrollmentId: enrollment.id, timezone: tz } });
      return r.schedule as Array<{ week: number; day: number; date: string }>;
    },
  });

  const { data: completions = [] } = useQuery({
    queryKey: ["m-today-completions", enrollment.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_workout_completions")
        .select("week_index, day_index, completed_at")
        .eq("enrollment_id", enrollment.id);
      return (data ?? []) as Array<{ week_index: number; day_index: number; completed_at: string | null }>;
    },
  });

  const todayStr = todayYMD(tz);
  const completedKeys = new Set(
    completions.filter((c) => c.completed_at).map((c) => `${c.week_index}:${c.day_index}`),
  );

  // Sorted schedule, filter out completed entries.
  const remaining = [...schedule]
    .filter((s) => !completedKeys.has(`${s.week}:${s.day}`))
    .sort((a, b) => a.date.localeCompare(b.date));

  const todayEntry = remaining.find((s) => s.date === todayStr) ?? null;
  const missedEntry = !todayEntry
    ? remaining.find((s) => s.date < todayStr) ?? null
    : null;
  const nextEntry = !todayEntry && !missedEntry
    ? remaining.find((s) => s.date > todayStr) ?? null
    : null;

  const planName = enrollment.member_plans?.name ?? "Your plan";
  const totalRemaining = remaining.length;
  const isComplete = totalRemaining === 0 && schedule.length > 0;

  let kind: "today" | "missed" | "upcoming" | "rest" | "complete";
  let entry: { week: number; day: number; date: string } | null = null;
  if (isComplete) kind = "complete";
  else if (todayEntry) { kind = "today"; entry = todayEntry; }
  else if (missedEntry) { kind = "missed"; entry = missedEntry; }
  else if (nextEntry) {
    // Rest day = no workout today, but next is in the future (>today)
    kind = nextEntry.date === todayStr ? "today" : "rest";
    entry = nextEntry;
  } else kind = "rest";

  const view = renderView(kind, entry, planName, todayStr);

  return (
    <Card className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-sm",
            view.iconBg,
          )}
        >
          {view.compactIcon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-black uppercase tracking-wider",
                view.badgeClass,
              )}
            >
              {view.eyebrow}
            </Badge>
            {entry && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                W{entry.week} · D{entry.day}
              </span>
            )}
          </div>
          <h3 className="mt-1 text-sm font-bold leading-tight">{view.title}</h3>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {planName}
          </p>
          {view.subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{view.subtitle}</p>
          )}
          {view.primary && <div className="mt-2">{view.primary}</div>}
        </div>
      </div>
    </Card>
  );

  function renderView(
    kind: "today" | "missed" | "upcoming" | "rest" | "complete",
    entry: { week: number; day: number; date: string } | null,
    planName: string,
    today: string,
  ): {
    eyebrow: string;
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    compactIcon: React.ReactNode;
    iconBg: string;
    badgeClass: string;
    primary: React.ReactNode;
  } {
    const openDay = (week: number, day: number, label: string, icon: React.ReactNode, variant?: "outline") => (
      <Link
        to="/m/workouts/$enrollmentId/$week/$day"
        params={{ enrollmentId: enrollment.id, week: String(week), day: String(day) }}
      >
        <Button size="sm" variant={variant}>
          {icon} {label}
        </Button>
      </Link>
    );
    switch (kind) {
      case "today":
        return {
          eyebrow: "Today's Workout",
          title: "Let's get to work.",
          subtitle: "Your scheduled session is ready.",
          icon: <Play className="h-5 w-5 text-primary-foreground" />,
          compactIcon: <Play className="h-5 w-5" />,
          iconBg: "bg-primary",
          badgeClass: "border-primary/30 bg-primary/10 text-primary",
          primary: entry
            ? openDay(entry.week, entry.day, "Start Workout", <Play className="mr-1.5 h-3.5 w-3.5" />)
            : null,
        };
      case "missed":
        return {
          eyebrow: "Missed Workout",
          title: "Let's catch up.",
          subtitle: entry ? `Scheduled ${relLabel(entry.date, today)}.` : undefined,
          icon: <AlertCircle className="h-5 w-5 text-primary-foreground" />,
          compactIcon: <AlertCircle className="h-5 w-5" />,
          iconBg: "bg-destructive",
          badgeClass: "border-destructive/30 bg-destructive/10 text-destructive",
          primary: entry
            ? openDay(entry.week, entry.day, "Complete", <ArrowRight className="ml-1.5 h-3.5 w-3.5" />, "outline")
            : null,
        };
      case "rest":
        return {
          eyebrow: "Rest Day",
          title: "No workout scheduled today.",
          subtitle: entry
            ? `Next session ${relLabel(entry.date, today)}.`
            : "Recover, eat well, sleep well.",
          icon: <Coffee className="h-5 w-5 text-primary-foreground" />,
          compactIcon: <Coffee className="h-5 w-5" />,
          iconBg: "bg-sky-500",
          badgeClass: "border-sky-500/30 bg-sky-500/10 text-sky-500",
          primary: entry
            ? openDay(entry.week, entry.day, "Upcoming", <ArrowRight className="ml-1.5 h-3.5 w-3.5" />, "outline")
            : null,
        };
      case "upcoming":
        return {
          eyebrow: "Next Workout",
          title: "Up next.",
          subtitle: entry ? relLabel(entry.date, today) : undefined,
          icon: <Crosshair className="h-5 w-5 text-primary-foreground" />,
          compactIcon: <Crosshair className="h-5 w-5" />,
          iconBg: "bg-primary",
          badgeClass: "border-primary/30 bg-primary/10 text-primary",
          primary: entry
            ? openDay(entry.week, entry.day, "View", <ArrowRight className="ml-1.5 h-3.5 w-3.5" />, "outline")
            : null,
        };
      case "complete":
      default:
        return {
          eyebrow: "Plan Complete",
          title: `${planName} — All workouts complete.`,
          subtitle: "Pick a new plan or restart this one.",
          icon: <CheckCircle2 className="h-5 w-5 text-primary-foreground" />,
          compactIcon: <CheckCircle2 className="h-5 w-5" />,
          iconBg: "bg-emerald-500",
          badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
          primary: (
            <Link to="/m/plans">
              <Button size="sm" variant="outline">
                Browse Plans <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </Link>
          ),
        };
    }
  }
}