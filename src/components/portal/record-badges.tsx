/**
 * Animated training-record badges for the Performance League.
 *
 * Shows how many lifts an athlete set an ATPR / PROGRAM PR / BLOCK PR on this
 * month (each lift counted once, at its best tier). Colours are inline so
 * they read identically in light and dark mode. A record set in the last 48h
 * gets a live shimmer + "NEW" spark; older ones sit still so the board stays
 * calm. Reduced-motion users get static badges (global CSS rule).
 */
import { Award, Medal, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export const FRESH_RECORD_MS = 48 * 60 * 60 * 1000;

export type RecordCounts = {
  atpr_lifts?: number | null;
  program_pr_lifts?: number | null;
  block_pr_lifts?: number | null;
  last_record_at?: string | null;
};

const TIERS = [
  { key: "atpr_lifts", label: "ATPR", icon: Trophy, from: "#fde68a", via: "#f59e0b", to: "#b45309", text: "#3b1d00", ring: "#fbbf24" },
  { key: "program_pr_lifts", label: "PROGRAM PR", icon: Medal, from: "#ddd6fe", via: "#8b5cf6", to: "#5b21b6", text: "#ffffff", ring: "#a78bfa" },
  { key: "block_pr_lifts", label: "BLOCK PR", icon: Award, from: "#bae6fd", via: "#0ea5e9", to: "#075985", text: "#ffffff", ring: "#38bdf8" },
] as const;

export function isFreshRecord(lastRecordAt: string | null | undefined, now = Date.now()) {
  if (!lastRecordAt) return false;
  const t = new Date(lastRecordAt).getTime();
  return Number.isFinite(t) && now - t >= 0 && now - t < FRESH_RECORD_MS;
}

export function hasRecords(r: RecordCounts) {
  return (r.atpr_lifts ?? 0) + (r.program_pr_lifts ?? 0) + (r.block_pr_lifts ?? 0) > 0;
}

export function RecordBadges({
  row,
  size = "sm",
  className,
  center = false,
}: {
  row: RecordCounts;
  size?: "xs" | "sm";
  className?: string;
  center?: boolean;
}) {
  if (!hasRecords(row)) return null;
  const fresh = isFreshRecord(row.last_record_at);
  // The freshest badge is the best tier the athlete holds.
  const topKey = TIERS.find((t) => (row[t.key] ?? 0) > 0)?.key;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", center && "justify-center", className)}>
      {TIERS.map((t) => {
        const n = row[t.key] ?? 0;
        if (n <= 0) return null;
        const Icon = t.icon;
        const live = fresh && t.key === topKey;
        return (
          <span
            key={t.key}
            title={`${n} lift${n === 1 ? "" : "s"} with a ${t.label} this month`}
            className={cn(
              "jf-record-badge relative inline-flex items-center gap-1 overflow-hidden rounded-full font-black uppercase leading-none tracking-wide",
              size === "xs" ? "h-[18px] px-1.5 text-[8.5px]" : "h-5 px-2 text-[9.5px]",
              live && "jf-record-badge-live",
            )}
            style={{
              color: t.text,
              background: `linear-gradient(135deg, ${t.from} 0%, ${t.via} 48%, ${t.to} 100%)`,
              boxShadow: `0 0 0 1px ${t.ring}66, 0 2px 6px -2px ${t.to}aa`,
              ["--jf-glow" as string]: `${t.ring}99`,
            }}
          >
            <Icon className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} strokeWidth={2.75} />
            <span>{n > 1 ? `${n} ` : ""}{t.label}</span>
            {live && <span className="ml-0.5 rounded-sm bg-white/85 px-[3px] text-[7.5px] leading-[11px] text-black">NEW</span>}
            {/* shimmer sweep */}
            <span aria-hidden className="jf-record-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/2" />
          </span>
        );
      })}
    </div>
  );
}
