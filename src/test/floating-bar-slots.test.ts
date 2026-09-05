import { describe, it, expect } from "vitest";
import { Home } from "lucide-react";
import {
  MAX_BAR_SLOTS,
  MORE_BAR_ITEM,
  MORE_BAR_TO,
  resolveVisibleBarItems,
  mergeNavSources,
  navItemsToLayout,
  resolveLayout,
} from "@/lib/floating-bar";
import type { NavItem } from "@/components/app-shell";

const item = (to: string, label = to): NavItem => ({ to, label, icon: Home });

describe("floating bar slots", () => {
  it("keeps five configurable slots", () => {
    const items = ["/a", "/b", "/c", "/d", "/e", "/f"].map((t) => item(t));
    expect(navItemsToLayout(items).slots).toHaveLength(MAX_BAR_SLOTS);
  });

  it("resolves every saved slot when routes only exist in the full registry", () => {
    const collapsedNav = [item("/admin"), item("/admin/clients")];
    const fullNav = [
      item("/admin"),
      item("/admin/clients"),
      item("/admin/messages"),
      item("/admin/check-in-reviews"),
      item("/admin/tasks"),
    ];
    const layout = navItemsToLayout(fullNav);

    // Collapsed nav alone silently dropped folded routes (the old bug).
    expect(resolveLayout(layout, collapsedNav)).toHaveLength(2);
    // Merged source resolves all five.
    expect(resolveLayout(layout, mergeNavSources(collapsedNav, fullNav))).toHaveLength(5);
  });

  it("dedupes merged sources, first source wins", () => {
    const merged = mergeNavSources([item("/a", "Primary")], [item("/a", "Secondary"), item("/b")]);
    expect(merged.map((m) => m.to)).toEqual(["/a", "/b"]);
    expect(merged[0]?.label).toBe("Primary");
  });
});

describe("visible bar contract", () => {
  it("never renders more than five buttons and always keeps More reachable", () => {
    const six = ["/a", "/b", "/c", "/d", "/e", "/f"].map((t) => item(t));
    const visible = resolveVisibleBarItems(six);
    expect(visible).toHaveLength(MAX_BAR_SLOTS);
    expect(visible[visible.length - 1].to).toBe(MORE_BAR_TO);
  });

  it("keeps an explicitly configured More slot in place without adding a sixth", () => {
    const items = [item("/a"), MORE_BAR_ITEM, item("/b"), item("/c"), item("/d")];
    const visible = resolveVisibleBarItems(items);
    expect(visible).toHaveLength(5);
    expect(visible.filter((v: NavItem) => v.to === MORE_BAR_TO)).toHaveLength(1);
    expect(visible[1].to).toBe(MORE_BAR_TO);
  });
});
