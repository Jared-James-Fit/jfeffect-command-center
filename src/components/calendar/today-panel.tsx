import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dumbbell, ClipboardCheck, Trophy, CalendarClock, Apple, ArrowRight } from "lucide-react";
import { ctaLabel, type CalendarItem } from "@/lib/calendar-sources";
import { cn } from "@/lib/utils";

function isoDate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysUntil(dateStr: string): number {
  const a = new Date(dateStr + "T00:00:00").getTime();
  const t = new Date(isoDate(new Date()) + "T00:00:00").getTime();
  return Math.round((a - t) / 86400000);
}
function whenLabel(dateStr: string, startsAt?: string | null): string {
  const d = daysUntil(dateStr);
  const time = startsAt ? new Date(startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
  if (d === 0) return time ? `Today · ${time}` : "Today";
  if (d === 1) return time ? `Tomorrow · ${time}` : "Tomorrow";
  if (d > 1 && d <= 7) {
    const wd = new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" });
    return time ? `${wd} · ${time}` : wd;
  }
  if (d > 7) return `In ${d} days`;
  if (d === -1) return "Yesterday";
  return `${Math.abs(d)} days ago`;
}

export function ClientTodayPanel({
  items,
  nutritionUpdatedAt,
}: {
  items: CalendarItem[];
  /** ISO timestamp of latest nutrition target update, if any. */
  nutritionUpdatedAt?: string | null;
}) {
  const today = isoDate(new Date());

  const todayWorkout = useMemo(
    () => items.find((i) => i.kind === "workout" && i.date === today && i.status !== "Completed")
      ?? items.find((i) => i.kind === "workout" && i.date >= today && i.status !== "Completed"),
    [items, today],
  );
  const nextCheckIn = useMemo(
    () => items.find((i) => i.kind === "check_in" && i.date >= today)
      ?? items.find((i) => i.kind === "check_in"),
    [items, today],
  );
  const nextMeet = useMemo(() => {
    const meetEvent = items.find((i) =>
      i.kind === "event" && i.date >= today &&
      ((i.raw?.event_type ?? "").toLowerCase().includes("meet") ||
       (i.raw?.event_type ?? "").toLowerCase().includes("competition") ||
       i.importance === "High" || i.importance === "Critical")
    );
    if (meetEvent) return meetEvent;
    return items.find((i) => i.kind === "important_date" && i.date >= today);
  }, [items, today]);
  const nextPt = useMemo(
    () => items.find((i) => i.kind === "pt_session" && i.date >= today && (i.status ?? "Scheduled") === "Scheduled"),
    [items, today],
  );
  const nextAppt = useMemo(
    () => items.find((i) => i.kind === "appointment" && i.date >= today && (i.status ?? "Scheduled") === "Scheduled"),
    [items, today],
  );

  const tiles: TileSpec[] = [];
  if (todayWorkout) {
    tiles.push({
      icon: <Dumbbell className="h-4 w-4" />,
      tone: "emerald",
      eyebrow: daysUntil(todayWorkout.date) === 0 ? "Today's Workout" : `Next Workout · ${whenLabel(todayWorkout.date)}`,
      title: todayWorkout.title,
      meta: todayWorkout.subtitle ?? undefined,
      item: todayWorkout,
    });
  }
  if (nextCheckIn) {
    const d = daysUntil(nextCheckIn.date);
    tiles.push({
      icon: <ClipboardCheck className="h-4 w-4" />,
      tone: d <= 0 ? "rose" : "amber",
      eyebrow: d < 0 ? `Check-In Overdue · ${Math.abs(d)}d` : d === 0 ? "Check-In Due Today" : `Check-In Due ${whenLabel(nextCheckIn.date)}`,
      title: nextCheckIn.title,
      item: nextCheckIn,
    });
  }
  if (nextMeet) {
    const d = daysUntil(nextMeet.date);
    tiles.push({
      icon: <Trophy className="h-4 w-4" />,
      tone: "amber",
      eyebrow: d === 0 ? "Meet Today" : d === 1 ? "Meet Tomorrow" : `Meet in ${d} days`,
      title: nextMeet.title,
      meta: nextMeet.subtitle ?? undefined,
      item: nextMeet,
    });
  }
  if (nextPt) {
    tiles.push({
      icon: <CalendarClock className="h-4 w-4" />,
      tone: "violet",
      eyebrow: `Next PT Session · ${whenLabel(nextPt.date, nextPt.startsAt)}`,
      title: nextPt.title,
      meta: nextPt.subtitle ?? undefined,
      item: nextPt,
    });
  }
  if (!nextPt && nextAppt) {
    tiles.push({
      icon: <CalendarClock className="h-4 w-4" />,
      tone: "blue",
      eyebrow: `Next Appointment · ${whenLabel(nextAppt.date, nextAppt.startsAt)}`,
      title: nextAppt.title,
      meta: nextAppt.subtitle ?? undefined,
      item: nextAppt,
    });
  }
  if (nutritionUpdatedAt) {
    const updated = new Date(nutritionUpdatedAt);
    const d = Math.round((Date.now() - updated.getTime()) / 86400000);
    tiles.push({
      icon: <Apple className="h-4 w-4" />,
      tone: "sky",
      eyebrow: d === 0 ? "Nutrition Updated Today" : d === 1 ? "Nutrition Updated Yesterday" : `Nutrition Updated ${d}d ago`,
      title: "View Nutrition Targets",
      href: { to: "/portal/nutrition-targets" },
    });
  }

  if (tiles.length === 0) {
    return (
      <Card className="border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        Nothing pressing today — check your calendar below.
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">Today</h3>
        <Badge variant="outline" className="text-[10px]">{tiles.length}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t, i) => <Tile key={i} spec={t} />)}
      </div>
    </div>
  );
}

type Tone = "emerald" | "rose" | "amber" | "violet" | "blue" | "sky";
type TileSpec = {
  icon: React.ReactNode;
  tone: Tone;
  eyebrow: string;
  title: string;
  meta?: string;
  item?: CalendarItem;
  href?: { to: string; params?: Record<string, string> };
};

const TONE_CLASSES: Record<Tone, { border: string; eyebrow: string; iconBg: string }> = {
  emerald: { border: "border-emerald-500/30 hover:border-emerald-500/60", eyebrow: "text-emerald-300", iconBg: "bg-emerald-500/15 text-emerald-300" },
  rose:    { border: "border-rose-500/40 hover:border-rose-500/70",       eyebrow: "text-rose-300",    iconBg: "bg-rose-500/15 text-rose-300" },
  amber:   { border: "border-amber-500/30 hover:border-amber-500/60",     eyebrow: "text-amber-300",   iconBg: "bg-amber-500/15 text-amber-300" },
  violet:  { border: "border-violet-500/30 hover:border-violet-500/60",   eyebrow: "text-violet-300",  iconBg: "bg-violet-500/15 text-violet-300" },
  blue:    { border: "border-blue-500/30 hover:border-blue-500/60",       eyebrow: "text-blue-300",    iconBg: "bg-blue-500/15 text-blue-300" },
  sky:     { border: "border-sky-500/30 hover:border-sky-500/60",         eyebrow: "text-sky-300",     iconBg: "bg-sky-500/15 text-sky-300" },
};

function Tile({ spec }: { spec: TileSpec }) {
  const tone = TONE_CLASSES[spec.tone];
  const href = spec.href ?? spec.item?.href;
  const cta = spec.item ? ctaLabel(spec.item) : "Open";
  const inner = (
    <Card className={cn("group flex h-full flex-col gap-2 border bg-card p-3 transition-colors", tone.border)}>
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md", tone.iconBg)}>{spec.icon}</span>
        <span className={cn("text-[10px] font-black uppercase tracking-widest", tone.eyebrow)}>{spec.eyebrow}</span>
      </div>
      <div className="text-sm font-semibold leading-tight">{spec.title}</div>
      {spec.meta && <div className="text-xs text-muted-foreground">{spec.meta}</div>}
      {href && (
        <div className="mt-auto inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-foreground/80 group-hover:text-foreground">
          {cta} <ArrowRight className="h-3 w-3" />
        </div>
      )}
    </Card>
  );
  if (href) {
    return <Link to={href.to as any} params={href.params as any} className="block">{inner}</Link>;
  }
  return inner;
}