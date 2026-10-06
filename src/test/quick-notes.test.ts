import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  noteHeading, noteMatches, notePreview, noteToTask, purgeExpired, sortByRecent, trashDaysLeft, TRASH_DAYS,
} from "@/components/tasks/quick-notes";

describe("quick notes", () => {
  it("rows show a heading and a one-line preview", () => {
    expect(noteHeading({ title: "PR Prompt — Claude", body: "Have the app…\nmore" })).toBe("PR Prompt — Claude");
    expect(notePreview({ title: "PR Prompt — Claude", body: "\nHave the app…\nmore" })).toBe("Have the app…");
    expect(noteHeading({ title: "", body: "Film squat tutorial\nUse the new lighting" })).toBe("Film squat tutorial");
    expect(notePreview({ title: "", body: "Film squat tutorial\nUse the new lighting" })).toBe("Use the new lighting");
    expect(noteHeading({ title: " ", body: "" })).toBe("Untitled note");
  });

  it("search matches title or body, case-insensitively", () => {
    const n = { title: "Auto collapse old check-ins — Claude", body: "FORM MESSAGE UX" };
    expect(noteMatches(n, "check-in")).toBe(true);
    expect(noteMatches(n, "form message")).toBe(true);
    expect(noteMatches(n, "nutrition")).toBe(false);
    expect(noteMatches(n, "")).toBe(true);
  });

  it("lists the most recently edited note first without mutating storage order", () => {
    const stored = [{ id: "a", updatedAt: 1 }, { id: "b", updatedAt: 3 }, { id: "c", updatedAt: 2 }];
    expect(sortByRecent(stored).map((n) => n.id)).toEqual(["b", "c", "a"]);
    expect(stored.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("purges notes only after 30 days in Recently Deleted", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 100 * day;
    const notes = [
      { id: "live" },
      { id: "fresh", deletedAt: now - 2 * day },
      { id: "edge", deletedAt: now - TRASH_DAYS * day + 1 },
      { id: "expired", deletedAt: now - TRASH_DAYS * day },
    ];
    expect(purgeExpired(notes, now).map((n) => n.id)).toEqual(["live", "fresh", "edge"]);
    expect(trashDaysLeft(now, now)).toBe(30);
    expect(trashDaysLeft(now - 2 * day, now)).toBe(28);
    expect(trashDaysLeft(now - TRASH_DAYS * day + 1, now)).toBe(1);
  });

  it("turns a note into a task without repeating the title in the task notes", () => {
    expect(noteToTask({ title: "PR Prompt", body: "Have the app track rep PRs\nby load" }))
      .toEqual({ title: "PR Prompt", notes: "Have the app track rep PRs\nby load" });
    expect(noteToTask({ title: "", body: "\nFilm squat tutorial\nUse the new lighting" }))
      .toEqual({ title: "Film squat tutorial", notes: "Use the new lighting" });
    expect(noteToTask({ title: "Just a title", body: "  " })).toEqual({ title: "Just a title", notes: null });
    expect(noteToTask({ title: " ", body: "\n " })).toBeNull();
    expect(noteToTask({ title: "x".repeat(250), body: "" })?.title).toHaveLength(200);
  });

  it("keeps the existing storage key so saved notes carry over", () => {
    const page = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");
    expect(page).toContain("storageKey={`${storagePrefix}-task-notes`}");
    expect(page).toContain("search={search}");
  });
});
