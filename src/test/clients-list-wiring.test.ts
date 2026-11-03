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

  it("says the facts (coaching type, coach, last seen) in one plain line, never as chips to tap", () => {
    expect(row).toContain("const meta = rowMetaLine(r, { showCoach, primary });");
    expect(row).toContain("data-row-meta>{meta}</div>");
    // The old fact pills and their explanations are gone.
    for (const title of ["Coaching type", "Assigned coach", "Calendar sync", "Block dates", "Time left in the block", "Block progress", "Next block queued"]) {
      expect(row).not.toContain(`title="${title}"`);
    }
    // Calendar sync is on the client's Summary, so the list no longer asks for it.
    expect(page).not.toContain("listClientCalendarSyncKinds");
  });

  it("shows one status chip, explained on a tap, and +N for the rest", () => {
    // Every status comes from one ranked list, so none can be left out of the +N.
    expect(row).toContain("const { primary, more } = rowStatusSummary(r);");
    expect(row).toMatch(/title=\{s\.label\}\s+body=\{s\.hint\}\s+next=\{s\.next\}/);
    expect(row).toContain("<MoreStatuses r={r} statuses={more} />");
    expect(row).toContain('title="Also needs you"');
    // "No program" is itself the way to assign one.
    expect(row).toMatch(/s\.id === "no_program"[\s\S]{0,120}onClick=\{onAssign\}/);
    // The Assign Program / Nutrition / Cardio pills are gone from the row; they live in ⋯.
    expect(row).not.toContain("function StatusPill");
    expect(row).not.toMatch(/Assign (Nutrition|Cardio)/);
    const menu = read("src/components/clients/quick-actions.tsx");
    expect(menu).toContain('"Assign Nutrition"');
    expect(menu).toContain('"Assign Cardio"');
    expect(menu).toContain("Assign Program");
    expect(menu).toContain("Assign Next Block");
    expect(menu).toContain("View as client");
  });

  it("keeps the desktop row's four areas", () => {
    expect(row).toContain("xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]");
    expect(row).not.toContain("_auto_auto]");
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
  it("leaves only one directory function, so no call is ambiguous", () => {
    const drop = read("supabase/migrations/20261008210000_drop_stale_clients_directory_overload.sql");
    expect(drop).toContain(
      "drop function if exists public.admin_clients_directory(text, text, text, uuid, text, integer, integer);",
    );
    // The current function is called with every argument by name, including the two the old one lacked.
    expect(server).toContain("p_lifecycle: data.lifecycle,");
  });

  it("sends the filters as a list and no longer sends the single status", () => {
    expect(server).toContain("p_flags: data.flags");
    expect(server).not.toContain("p_status");
    expect(server).toMatch(/flags: z\s*\.array\(z\.enum\(DIRECTORY_FILTER_KEYS\)\)/);
  });

  it("keeps the filters in the URL, and still understands the older ?status= link", () => {
    expect(page).toMatch(/flags:\s+fallback\(z\.string\(\)/);
    expect(page).toContain("filtersFromSearch({ status: search.status, flags: search.flags })");
    expect(page).toContain("          flags,\n          match,\n          coachingType: search.coachingType,");
  });

  it("starts a different tab (Active / Archived / Deactivated) with no filters", () => {
    expect(toolbar).toMatch(/lifecycle: v === "active" \? undefined : v,\s+status: "all",\s+flags: undefined,\s+match: undefined,/);
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

  it("explains the filters it offers and what Any and All mean", () => {
    const sheet = read("src/components/clients/client-filter-sheet.tsx");
    expect(sheet).toContain("meta.hint");
    expect(sheet).toContain("Any shows clients with at least one of them and All only clients with every one");
    expect(sheet).toContain("<MatchToggle value={match} onChange={onMatch}");
    expect(read("src/components/clients/client-filter-rail.tsx")).toContain("<MatchToggle value={match} onChange={onMatch} />");
  });
});
