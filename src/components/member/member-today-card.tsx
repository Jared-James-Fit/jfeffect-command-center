import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, ArrowRight, Coffee, AlertCircle, CheckCircle2, Crosshair } from "lucide-react";
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
    <Card
      className={cn(
        "relative overflow-hidden border p-0 text-foreground",
        "bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950",
        view.borderClass,
      )}
    >
      <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:18px_18px]" />

      <div className="relative space-y-4 p-5 md:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]",
              view.pillClass,
            )}
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center">{view.icon}</span>
            {view.eyebrow}
          </span>
          {entry && (
            <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/70">
              Week {entry.week} · Day {entry.day}
            </span>
          )}
        </div>

        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/90">
          {planName}
        </div>

        <h2 className="text-3xl font-black leading-[1.05] tracking-tight text-white md:text-4xl">
          {view.title}
        </h2>
        {view.subtitle && (
          <p className="text-sm text-white/70">{view.subtitle}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1 [&_a]:w-full [&_a]:sm:w-auto [&_button]:w-full [&_button]:sm:w-auto">
          {view.primary}
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
    pillClass: string;
    borderClass: string;
    primary: React.ReactNode;
  } {
    const openDay = (week: number, day: number, label: string, icon: React.ReactNode, variant?: "outline") => (
      <Link
        to="/m/workouts/$enrollmentId/$week/$day"
        params={{ enrollmentId: enrollment.id, week: String(week), day: String(day) }}
      >
        <Button size="lg" variant={variant} className="font-bold uppercase">
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
          pillClass: "bg-primary text-primary-foreground",
          borderClass: "border-primary",
          primary: entry
            ? openDay(entry.week, entry.day, "Start Today's Workout", <Play className="mr-2 h-4 w-4" />)
            : null,
        };
      case "missed":
        return {
          eyebrow: "Missed Workout",
          title: "Let's catch up.",
          subtitle: entry ? `Scheduled ${relLabel(entry.date, today)}.` : undefined,
          icon: <AlertCircle className="h-5 w-5 text-primary-foreground" />,
          pillClass: "bg-destructive text-destructive-foreground",
          borderClass: "border-destructive/60",
          primary: entry
            ? openDay(entry.week, entry.day, "Complete Missed Workout", <Play className="mr-2 h-4 w-4" />)
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
          pillClass: "bg-sky-500 text-white",
          borderClass: "border-sky-500/60",
          primary: entry
            ? openDay(entry.week, entry.day, "View Upcoming Workout", <ArrowRight className="mr-2 h-4 w-4" />, "outline")
            : null,
        };
      case "upcoming":
        return {
          eyebrow: "Next Workout",
          title: "Up next.",
          subtitle: entry ? relLabel(entry.date, today) : undefined,
          icon: <Crosshair className="h-5 w-5 text-primary-foreground" />,
          pillClass: "bg-primary text-primary-foreground",
          borderClass: "border-primary/60",
          primary: entry
            ? openDay(entry.week, entry.day, "View Upcoming Workout", <ArrowRight className="mr-2 h-4 w-4" />, "outline")
            : null,
        };
      case "complete":
      default:
        return {
          eyebrow: "Plan Complete",
          title: `${planName} — All workouts complete.`,
          subtitle: "Pick a new plan or restart this one.",
          icon: <CheckCircle2 className="h-5 w-5 text-primary-foreground" />,
          pillClass: "bg-emerald-500 text-white",
          borderClass: "border-emerald-500/60",
          primary: (
            <Link to="/m/plans">
              <Button size="lg" variant="outline" className="font-bold uppercase">
                Browse Plans <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          ),
        };
    }
  }
}