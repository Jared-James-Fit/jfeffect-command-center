import { Link } from "@tanstack/react-router";
import { Activity, MessageCircle, ClipboardCheck, Scale, Video, Apple } from "lucide-react";
import { cn } from "@/lib/utils";

type Tile = {
  to: string;
  label: string;
  icon: any;
  onClick?: () => void;
  badge?: string | number;
  emphasis?: boolean;
};

export function QuickActionsGrid({
  onLogWeight,
  messageBadge,
  checkInBadge,
  weeklyCheckInFormId,
}: {
  onLogWeight?: () => void;
  messageBadge?: number;
  checkInBadge?: number;
  /**
   * When set, the "Submit Check-In" tile deep-links straight into the
   * embedded weekly check-in form instead of the forms list — so the
   * client never feels like they leave the app to fill it out.
   */
  weeklyCheckInFormId?: string;
}) {
  const checkInTo = weeklyCheckInFormId
    ? `/portal/check-ins/${weeklyCheckInFormId}`
    : "/portal/check-ins";
  const tiles: Tile[] = [
    { to: "/portal/workouts", label: "Workouts", icon: Activity, emphasis: true },
    { to: "/portal/messages", label: "Message Coach", icon: MessageCircle, badge: messageBadge },
    { to: checkInTo, label: "Submit Check-In", icon: ClipboardCheck, badge: checkInBadge },
    { to: "#", label: "Log Bodyweight", icon: Scale, onClick: onLogWeight },
    { to: "/portal/lift-videos", label: "Upload Lift", icon: Video },
    { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {tiles.map((t) => {
        const Icon = t.icon;
        const inner = (
          <div
            className={cn(
              "relative flex min-h-[88px] flex-col items-start justify-between gap-2 rounded-2xl border bg-card p-3.5 transition active:scale-[0.98]",
              t.emphasis
                ? "border-primary/40 bg-gradient-to-br from-primary/10 to-card hover:border-primary"
                : "border-border hover:border-primary/40 hover:bg-card/80",
            )}
          >
            <div className="flex w-full items-center justify-between">
              <Icon className={cn("h-6 w-6", t.emphasis ? "text-primary" : "text-foreground")} />
              {t.badge != null && Number(t.badge) > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {t.badge}
                </span>
              )}
            </div>
            <div className="text-sm font-semibold leading-tight">{t.label}</div>
          </div>
        );
        if (t.onClick) {
          return (
            <button key={t.label} type="button" onClick={t.onClick} className="text-left">
              {inner}
            </button>
          );
        }
        return (
          <Link key={t.label} to={t.to}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}