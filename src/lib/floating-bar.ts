import { useEffect, useState } from "react";
import type { NavItem } from "@/components/app-shell";
import { Search, Eye } from "lucide-react";

const KEY = "jf-floating-bar-v2";
const EVT = "floating-bar-updated";

/**
 * Synthetic nav item — not a route. When activated in the floating bar it
 * opens the keyword command palette instead of navigating.
 */
export const SEARCH_BAR_ITEM: NavItem = {
  to: "__search__",
  label: "Search",
  icon: Search,
  group: "Actions",
};

/**
 * Synthetic nav item — not a route. Opens the Client POV quick picker so
 * an admin/coach can instantly impersonate a client from the mobile bar.
 */
export const CLIENT_POV_BAR_ITEM: NavItem = {
  to: "__client_pov__",
  label: "Client POV",
  icon: Eye,
  group: "Actions",
};

/** Returns nav plus any synthetic action items the bar can use. */
export function withBarActionItems(nav: NavItem[]): NavItem[] {
  const out = [...nav];
  if (!out.some((n) => n.to === SEARCH_BAR_ITEM.to)) out.push(SEARCH_BAR_ITEM);
  if (!out.some((n) => n.to === CLIENT_POV_BAR_ITEM.to)) out.push(CLIENT_POV_BAR_ITEM);
  return out;
}

export type BarScope = "admin" | "coach";

export interface BarSlot {
  to: string;
  label?: string;
  children?: string[];
}

export interface BarLayout {
  slots: BarSlot[]; // max 5
}

function storageKey(scope: BarScope) {
  return `${KEY}:${scope}`;
}

export function loadBarLayout(scope: BarScope): BarLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.slots)) return null;
    return parsed as BarLayout;
  } catch {
    return null;
  }
}

export function saveBarLayout(scope: BarScope, layout: BarLayout) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(layout));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {}
}

export function clearBarLayout(scope: BarScope) {
  try {
    localStorage.removeItem(storageKey(scope));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {}
}

/** Resolve a saved layout into renderable NavItems using a nav source. */
export function resolveLayout(layout: BarLayout, nav: NavItem[]): NavItem[] {
  const byTo = new Map<string, NavItem>();
  for (const n of nav) byTo.set(n.to, n);
  const out: NavItem[] = [];
  for (const slot of layout.slots.slice(0, 5)) {
    const base = byTo.get(slot.to);
    if (!base) continue;
    const children = (slot.children ?? [])
      .map((to) => byTo.get(to))
      .filter(Boolean) as NavItem[];
    out.push({
      ...base,
      label: slot.label ?? base.label,
      children: children.length ? children : undefined,
    });
  }
  return out;
}

/** React hook that reactively reads the saved layout. */
export function useBarLayout(scope: BarScope): BarLayout | null {
  const [v, setV] = useState<BarLayout | null>(() => loadBarLayout(scope));
  useEffect(() => {
    const update = () => setV(loadBarLayout(scope));
    window.addEventListener(EVT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVT, update);
      window.removeEventListener("storage", update);
    };
  }, [scope]);
  return v;
}

/** Convert a list of NavItems (with possible children) back into a layout. */
export function navItemsToLayout(items: NavItem[]): BarLayout {
  return {
    slots: items.slice(0, 5).map((i) => ({
      to: i.to,
      label: i.label,
      children: i.children?.map((c) => c.to),
    })),
  };
}