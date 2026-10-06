import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Source-level checks that the Clients list keeps its tap-to-explain statuses and its filters
 * plugged in (the app has no DOM test environment; the behaviour itself is exercised in a
 * browser, these stop the wiring being quietly undone).
 */
const read = (path: string) => readFileSync(path, "utf8");

const row = read("src/components/clients/client-row.tsx");
const tip = read("src/components/clients/status-tip.tsx");
const toolbar = read("src/components/clients/client-toolbar.tsx");
const page = read("src/routes/_authenticated/admin/clients.index.tsx");
const server = read("src/lib/clients-directory.functions.ts");

describe("statuses explain themselves on a tap", () => {
  it("is built on a popover, because a tooltip never opens from a finger", () => {
    expect(tip).toContain('from "@/components/ui/popover"');
    expect(tip).not.toMatch(/ui\/tooltip|react-tooltip/);
    // Hover is still there for a computer mouse, but only for a mouse: touch must go through a tap.
    expect(tip).toContain('e.pointerType === "mouse" && hoverIn()');
  });

  it("has no hover-only helper left to reach for", () => {
    expect(existsSync("src/components/clients/tip.tsx")).toBe(false);
    expect(row).not.toMatch(/from "\.\/tip"/);
    expect(row).not.toContain("<Tip ");
    expect(row).not.toContain("cursor-help");
  });

  it.each([
    "Coaching type",
    "Assigned coach",
    "Missed workouts",
    "Block dates",
    "Time left in the block",
    "Block progress",
    "Next block queued",
  ])("explains %s", (title) => {
    expect(row).toContain(`title="${title}"`);
  });

  it("explains every status chip, the plan pills and the program-end pill", () => {
    // Priority badges and the contract chip share one renderer, so none can be left out.
    expect(row).toContain("rowStatusChips(r)");
    expect(row).toMatch(/title=\{b\.label\}\s+body=\{b\.hint\}\s+next=\{b\.next\}/);
    // The pills render through StatusTip, with the old tap action now a button inside it.
    const pill = row.slice(row.indexOf("function StatusPill"), row.indexOf("function AssignmentStatusStrip"));
    expect(pill).toContain("<StatusTip");
    expect(pill).toContain("onAction()");
    expect(row).toMatch(/title=\{ended \? "Program has ended" : "No next block queued"\}/);
  });

  it("shows when they were last seen once, not twice, and the missed tag only when the status row can't", () => {
    expect(row).toContain("const seen = lastSeenChip(r)");
    expect(row).toContain("title={seen.title}");
    // The old standalone line (and its own grid column) is gone.
    expect(row).not.toContain('title="Last seen"');
    expect(row).not.toContain("Never signed in");
    expect(row).toContain("xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]");
    expect(row).not.toContain("_auto_auto]");
    expect(row).toContain('badges.some((b) => b.id === "missed")');
    expect(row).toContain("&& !missedShownAsBadge");
  });

  it("has no leftover filter-row code from before the new filters", () => {
    expect(existsSync("src/components/clients/summary-cards.tsx")).toBe(false);
    expect(read("src/components/clients/clients-status.ts")).not.toContain("TONE_CLASSES");
  });

  it("only lets admins send a reminder, and never to someone who can't receive it", () => {
    expect(row).toContain('a !== "remind" || isAdmin');
    expect(row).toContain("const isAdmin = role === \"admin\"");
  });
});

describe("the filters reach the database", () => {
  it("sends the filters as a list and no longer sends the single status", () => {
    expect(server).toContain("p_flags: data.flags");
    expect(server).not.toContain("p_status");
    expect(server).toMatch(/flags: z\s*\.array\(z\.enum\(DIRECTORY_FILTER_KEYS\)\)/);
  });

  it("keeps the filters in the URL, and still understands the older ?status= link", () => {
    expect(page).toMatch(/flags:\s+fallback\(z\.string\(\)/);
    expect(page).toContain("filtersFromSearch({ status: search.status, flags: search.flags })");
    expect(page).toContain("          flags,\n          coachingType: search.coachingType,");
  });

  it("starts a different tab (Active / Archived / Deactivated) with no filters", () => {
    expect(page).toMatch(/lifecycle: o\.key === "active" \? undefined : o\.key,\s+status: "all",\s+flags: undefined,/);
  });

  it("clears back to the default view without dropping the tab you are on", () => {
    expect(toolbar).toContain("({ lifecycle: prev.lifecycle })");
    expect(page).toContain("({ lifecycle: prev.lifecycle })");
    expect(toolbar).not.toMatch(/navigate\(\{ search: \(\) => \(\{\}\)/);
    expect(page).not.toMatch(/navigate\(\{ search: \(\) => \(\{\}\)/);
  });

  it("puts the quick filter row, the summary and the full sheet in the toolbar", () => {
    expect(toolbar).toContain("<ClientFilterRail");
    expect(toolbar).toContain("<ActiveFilterSummary");
    expect(toolbar).toContain("<ClientFilterSheet");
    expect(toolbar).not.toContain("More Filters");
  });

  it("points admins at the bulk reminder when they filter by unsigned contract", () => {
    expect(toolbar).toContain('isAdmin && flags.includes("no_contract")');
    expect(toolbar).toContain('to="/admin/coaching-agreements"');
  });

  it("explains the filters it offers and says several mean all of them", () => {
    const sheet = read("src/components/clients/client-filter-sheet.tsx");
    expect(sheet).toContain("meta.hint");
    expect(sheet).toContain("you only see clients who match all of them");
    expect(read("src/components/clients/client-filter-rail.tsx")).toContain("match all");
  });
});
