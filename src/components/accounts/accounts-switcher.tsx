import { useRef, type TouchEvent } from "react";
import { BadgeCheck, UserCog, Users, type LucideIcon } from "lucide-react";
import { PageSwitcher } from "@/components/page-switcher";

export type AccountKind = "clients" | "members" | "team";
export const KINDS: AccountKind[] = ["clients", "members", "team"];

const META: Record<AccountKind, { label: string; icon: LucideIcon }> = {
  clients: { label: "Clients", icon: Users },
  members: { label: "Members", icon: BadgeCheck },
  team: { label: "Team", icon: UserCog },
};

/**
 * Clients · Members · Team: every account the business has, one tap (or one
 * swipe) apart. Members only shows while there are members (coaching
 * clients never count). Stays pinned under the header while the list scrolls.
 */
export function AccountsSwitcher({ kind, onChange, counts, kinds = KINDS }: {
  kind: AccountKind;
  onChange: (k: AccountKind) => void;
  counts: Partial<Record<AccountKind, number>>;
  /** The tabs to show (Members only when there are members). */
  kinds?: AccountKind[];
}) {
  const items = kinds.map((k) => ({ key: k, ...META[k], count: counts[k] }));
  return <PageSwitcher items={items} value={kind} onChange={onChange} label="Accounts" />;
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
