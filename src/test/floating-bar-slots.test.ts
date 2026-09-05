import { describe, it, expect } from "vitest";
import { Home } from "lucide-react";
import {
  MAX_BAR_SLOTS,
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
