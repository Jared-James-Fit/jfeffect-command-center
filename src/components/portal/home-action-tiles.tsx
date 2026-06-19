import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Big, dummy-proof tap targets for the Home dashboard (client + member).
 * Used inside `ProgressSummaryCard.extraActions` so the snapshot + quick
 * actions live in one section. Items already in the mobile bottom tab bar
 * (Workouts, Messages, Nutrition for clients; My Plans, Library, Nutrition,
 * Account for members) are intentionally OMITTED — that's the whole point.
 */
export type HomeActionTile = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  emphasis?: boolean;
};

export function HomeActionTiles({ tiles }: { tiles: HomeActionTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div
      className={cn(
        "grid gap-3",
        tiles.length === 1
          ? "grid-cols-1"
          : tiles.length === 2
          ? "grid-cols-2"
          : "grid-cols-2 sm:grid-cols-3",
      )}
    >
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            to={t.to}
            className={cn(
              "group relative flex min-h-[112px] flex-col justify-between rounded-2xl border bg-card p-4 transition active:scale-[0.98]",
              t.emphasis
                ? "border-primary/50 bg-gradient-to-br from-primary/10 to-card hover:border-primary"
                : "border-border hover:border-primary/40 hover:bg-card/80",
            )}
          >
            <div className="flex w-full items-center justify-between">
              <Icon
                className={cn(
                  "h-7 w-7",
                  t.emphasis ? "text-primary" : "text-foreground",
                )}
              />
              {t.badge != null && Number(t.badge) > 0 && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                  {t.badge}
                </span>
              )}
            </div>
            <div className="text-base font-bold leading-tight">{t.label}</div>
          </Link>
        );
      })}
    </div>
  );
}