/**
 * A block's settings in one place (Nov 23 2026), off the workout editor: the
 * schedule (training days and dates), the athlete roadmap (what they read
 * about this block, exactly as they'll see it) and the block's warm-ups. They
 * used to fold open under the last exercise, which made the builder read like
 * a long form; they're opened from the header's Block settings now. The
 * panels are the same ones, saving the same records: only where they live
 * moved. A tab mounts only when it's opened.
 *
 * `#roadmap` (the old link to the roadmap section) opens it on Athlete roadmap.
 */
import { useEffect, useState } from "react";
import { CalendarRange, Flame, Milestone } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobileNow } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { AutoSchedulePanel } from "@/components/auto-schedule-panel";
import { BlockRoadmapPanel } from "@/components/programs/block-roadmap-panel";
import { BlockWarmupPanel } from "@/components/block-warmup-panel";

export type BlockSettingsTab = "schedule" | "roadmap" | "warmups";

const TABS: Array<{ id: BlockSettingsTab; label: string; hint: string; icon: typeof CalendarRange }> = [
  { id: "schedule", label: "Schedule", hint: "Training days and dates", icon: CalendarRange },
  { id: "roadmap", label: "Athlete roadmap", hint: "What they read about this block", icon: Milestone },
  { id: "warmups", label: "Warm-ups", hint: "Before the first exercise", icon: Flame },
];

export function BlockSettingsSheet({
  blockId,
  blockName,
  open,
  onOpenChange,
  tab,
  onTab,
}: {
  blockId: string;
  blockName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tab: BlockSettingsTab;
  onTab: (t: BlockSettingsTab) => void;
}) {
  const phone = useIsMobileNow();
  // each tab mounts once it's been opened, and stays (a half-written roadmap survives a look at the schedule)
  const [seen, setSeen] = useState<Set<BlockSettingsTab>>(() => new Set([tab]));
  useEffect(() => {
    setSeen((s) => (s.has(tab) ? s : new Set(s).add(tab)));
  }, [tab]);
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={phone ? "bottom" : "right"}
        swipeToClose={phone}
        className={cn("flex flex-col gap-0 p-0", phone ? "max-h-[92dvh] rounded-t-3xl" : "w-full sm:max-w-xl")}
        data-block-settings
      >
        <div className="shrink-0 border-b border-border px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex min-h-10 items-center pl-24">
            <div className="min-w-0">
              <SheetTitle className="text-base">Block settings</SheetTitle>
              <SheetDescription className="truncate text-xs">{blockName}</SheetDescription>
            </div>
          </div>
          <div role="tablist" aria-label="Block settings" className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-0.5">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => onTab(t.id)}
                  className={cn(
                    "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold transition-colors",
                    tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  <span className="truncate">{t.id === "roadmap" ? (phone ? "Roadmap" : t.label) : t.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{current.hint}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          {seen.has("schedule") && (
            <div hidden={tab !== "schedule"} id="schedule">
              <AutoSchedulePanel blockId={blockId} bare />
            </div>
          )}
          {seen.has("roadmap") && (
            <div hidden={tab !== "roadmap"} id="roadmap">
              <BlockRoadmapPanel blockId={blockId} bare />
            </div>
          )}
          {seen.has("warmups") && (
            <div hidden={tab !== "warmups"} id="warmups">
              <BlockWarmupPanel blockId={blockId} bare />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
