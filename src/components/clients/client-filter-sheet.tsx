import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { DirectoryCounts } from "@/lib/clients-directory.functions";
import type { DirectoryFilterKey } from "@/lib/clients-directory-filters";
import { countPillClass } from "./client-filter-rail";
import { FILTER_GROUPS, STATUS_META } from "./clients-status";

export const COACHING_TYPES = [
  "Online Coaching",
  "In-Person Coaching",
  "Hybrid Coaching",
  "Powerlifting",
  "Bodybuilding",
  "Fat Loss",
  "Muscle Gain",
  "Lifestyle",
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flags: DirectoryFilterKey[];
  counts: DirectoryCounts | undefined;
  /** How many clients the current filters show. */
  total: number;
  loading: boolean;
  coachingType: string;
  coachId: string | null;
  coaches: { id: string; full_name: string | null }[];
  isAdmin: boolean;
  onToggleFlag: (key: DirectoryFilterKey) => void;
  onChange: (patch: { coachingType?: string | undefined; coachId?: string | undefined }) => void;
  onClearAll: () => void;
};

/**
 * Every filter in one place, each with a plain sentence saying what it finds, plus client type
 * and coach. Changes apply as you tap (the list behind the sheet updates), so the button at the
 * bottom just closes it and says how many clients are showing.
 */
export function ClientFilterSheet({
  open,
  onOpenChange,
  flags,
  counts,
  total,
  loading,
  coachingType,
  coachId,
  coaches,
  isAdmin,
  onToggleFlag,
  onChange,
  onClearAll,
}: Props) {
  const isMobile = useIsMobile();
  const anyActive = flags.length > 0 || (!!coachingType && coachingType !== "all") || !!coachId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        data-testid="filter-sheet"
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "max-h-[88dvh] rounded-t-3xl" : "w-full sm:max-w-md",
        )}
      >
        {/* Keeps the sheet header's left space for the Back pill, like every other sheet in the app. */}
        <SheetHeader className="shrink-0 pb-3 pl-28 pr-5 pt-4">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Pick what you want to find. Pick more than one and you only see clients who match all of them.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {FILTER_GROUPS.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <ul>
                {group.keys.map((key) => {
                  const meta = STATUS_META[key];
                  const Icon = meta.icon;
                  const count = counts?.[key];
                  return (
                    <li key={key}>
                      <label className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-lg px-1 py-2 active:bg-muted/50">
                        <Checkbox
                          checked={flags.includes(key)}
                          onCheckedChange={() => onToggleFlag(key)}
                          className="h-5 w-5"
                          aria-label={meta.label}
                        />
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-snug">{meta.label}</span>
                          <span className="block text-xs leading-snug text-muted-foreground">{meta.hint}</span>
                        </span>
                        {count !== undefined && (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                              countPillClass(meta.tone, count),
                            )}
                          >
                            {count}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section aria-label="Client type and coach" className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="filter-client-type">
                Client type
              </label>
              <Select
                value={coachingType || "all"}
                onValueChange={(v) => onChange({ coachingType: v === "all" ? undefined : v })}
              >
                <SelectTrigger id="filter-client-type" className="h-11" aria-label="Client type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {COACHING_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isAdmin && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground" htmlFor="filter-coach">
                  Coach
                </label>
                <Select
                  value={coachId ?? "all"}
                  onValueChange={(v) => onChange({ coachId: v === "all" ? undefined : v })}
                >
                  <SelectTrigger id="filter-coach" className="h-11" aria-label="Assigned coach">
                    <SelectValue placeholder="All coaches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All coaches</SelectItem>
                    {coaches.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name ?? "(unnamed)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </section>
        </div>

        <div
          className="flex shrink-0 gap-2 border-t border-border bg-background px-5 pt-3 dark:bg-card"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <Button type="button" variant="outline" className="h-11" disabled={!anyActive} onClick={onClearAll}>
            Clear all
          </Button>
          <Button type="button" className="h-11 flex-1" onClick={() => onOpenChange(false)}>
            {loading ? "Loading…" : total === 0 ? "No clients match" : `Show ${total} client${total === 1 ? "" : "s"}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
