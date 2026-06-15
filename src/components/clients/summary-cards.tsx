import { useNavigate } from "@tanstack/react-router";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { STATUS_META, TONE_CLASSES, type StatusKey } from "./clients-status";
import { cn } from "@/lib/utils";
import type { DirectoryCounts } from "@/lib/clients-directory.functions";

const KEYS: StatusKey[] = ["all", "needs_setup", "needs_review", "program_ending", "payment_issues", "new_clients"];

export function SummaryCards({
  counts,
  active,
  loading,
}: {
  counts: DirectoryCounts | undefined;
  active: StatusKey;
  loading?: boolean;
}) {
  const navigate = useNavigate({ from: "/admin/clients" });
  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="tablist"
        aria-label="Filter clients by status"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      >
        {KEYS.map((k) => {
          const meta = STATUS_META[k];
          const tone = TONE_CLASSES[meta.tone];
          const Icon = meta.icon;
          const isActive = active === k;
          const value = counts?.[k] ?? 0;
          const btn = (
            <button
              key={k}
              role="tab"
              aria-selected={isActive}
              aria-label={`${meta.label}: ${value}`}
              onClick={() =>
                navigate({
                  search: (prev: any) => ({ ...prev, status: k, page: 1 }),
                })
              }
              className={cn(
                "group flex min-h-[88px] w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition",
                "ring-1 ring-inset",
                tone.ring,
                isActive
                  ? "border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]"
                  : "border-border hover:border-primary/30 hover:bg-accent/30",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  tone.iconBg,
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-muted-foreground">
                  {meta.label}
                </span>
                <span className="block text-2xl font-semibold leading-tight">
                  {loading ? <span className="inline-block h-6 w-8 animate-pulse rounded bg-muted" /> : value}
                </span>
              </span>
            </button>
          );
          if (!meta.hint) return btn;
          return (
            <Tooltip key={k}>
              <TooltipTrigger asChild>{btn}</TooltipTrigger>
              <TooltipContent side="bottom">{meta.hint}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}