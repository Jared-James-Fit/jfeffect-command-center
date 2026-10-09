import { useRef, type TouchEvent } from "react";
import { BadgeCheck, UserCog, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AccountKind = "clients" | "members" | "team";
export const KINDS: AccountKind[] = ["clients", "members", "team"];

const META: Record<AccountKind, { label: string; icon: LucideIcon }> = {
  clients: { label: "Clients", icon: Users },
  members: { label: "Members", icon: BadgeCheck },
  team: { label: "Team", icon: UserCog },
};

/**
 * Clients · Members · Team: every account the business has, one tap (or one
 * swipe) apart. Stays pinned under the header while the list scrolls.
 */
export function AccountsSwitcher({ kind, onChange, counts }: {
  kind: AccountKind;
  onChange: (k: AccountKind) => void;
  counts: Partial<Record<AccountKind, number>>;
}) {
  return (
    <div className="sticky top-0 z-30 bg-background/95 px-3 pb-2 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-4 md:top-[41px] md:px-6">
      <div role="tablist" aria-label="Accounts" className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card p-1 shadow-sm">
        {KINDS.map((k) => {
          const { label, icon: Icon } = META[k];
          const active = k === kind;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(k)}
              className={cn(
                "flex min-h-[44px] min-w-0 items-center justify-center gap-1.5 rounded-xl px-1.5 text-[13px] font-semibold transition-colors sm:text-sm",
                active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <Icon className="hidden h-4 w-4 shrink-0 sm:block" />
              <span className="truncate">{label}</span>
              {counts[k] != null && (
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-primary-foreground/20" : "bg-muted")}>{counts[k]}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function inSideScroller(el: HTMLElement | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const ox = getComputedStyle(n).overflowX;
    if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

/**
 * A sideways swipe moves to the next / previous tab. Ignores swipes that
 * start on text fields, sideways scrollers (filter chips) or anything marked
 * `data-swipe-ignore`, and mostly-vertical moves (scrolling the list).
 */
export function useSwipeBetween(index: number, go: (i: number) => void, count = KINDS.length) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const el = e.target as HTMLElement;
      const t = e.touches[0];
      const skip = !t || !!el.closest("[data-swipe-ignore], input, textarea, select, [role=dialog]") || inSideScroller(el);
      start.current = skip ? null : { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const next = dx < 0 ? index + 1 : index - 1;
      if (next >= 0 && next < count) go(next);
    },
  };
}
