import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { noteHeading, noteMatches, notePreview } from "@/components/tasks/quick-notes";

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

  it("keeps the existing storage key so saved notes carry over", () => {
    const page = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");
    expect(page).toContain("storageKey={`${storagePrefix}-task-notes`}");
    expect(page).toContain("search={search}");
  });
});
