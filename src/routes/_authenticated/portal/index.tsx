import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Activity, Apple, CalendarDays, Camera, MessageCircle, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/")({
  component: PortalHome,
});

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function PortalHome() {
  const { user } = useAuth();
  const rawName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    "";
  const firstName = rawName.trim().split(/\s+/)[0] || "";

  const shortcuts = [
    { to: "/portal/workouts", label: "Workouts", sub: "Open your training plan", icon: Activity },
    { to: "/portal/messages", label: "Messages", sub: "Chat with your coach", icon: MessageCircle },
    { to: "/portal/nutrition-targets", label: "Nutrition", sub: "Targets and nutrition", icon: Apple },
    { to: "/portal/progress", label: "Progress", sub: "Weight, photos and metrics", icon: Camera },
    { to: "/portal/calendar", label: "Calendar", sub: "Schedule and appointments", icon: CalendarDays },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-[calc(140px+env(safe-area-inset-bottom))] pt-5 md:max-w-5xl md:px-8 md:pt-7">
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">JF Effect</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your coaching dashboard is ready.
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">
            Quick access
          </h2>
        </div>
        <div className="divide-y divide-border">
          {shortcuts.map(({ to, label, sub, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-[68px] items-center gap-3 px-4 py-3 transition active:bg-secondary/40"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black">{label}</div>
                <div className="truncate text-xs text-muted-foreground">{sub}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        The full dashboard widgets are temporarily disabled while the Home loading issue is isolated.
        Training, messaging, nutrition, progress and calendar remain available from here and the bottom navigation.
      </section>
    </div>
  );
}
