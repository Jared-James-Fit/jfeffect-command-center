import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNewsTo } from "@/lib/whats-new";

describe("a what's-new popup is only for people who were here before it", () => {
  it("shows to older accounts, never to ones made since", () => {
    expect(isNewsTo("2026-10-01T12:00:00Z", "2026-11-05T00:00:00Z")).toBe(true);
    expect(isNewsTo("2026-11-05T00:00:00Z", "2026-11-05T00:00:00Z")).toBe(false);
    expect(isNewsTo("2026-11-20T09:00:00Z", "2026-11-05T00:00:00Z")).toBe(false);
  });
  it("an unknown sign-up date keeps the old behaviour", () => {
    expect(isNewsTo(null, "2026-11-05T00:00:00Z")).toBe(true);
    expect(isNewsTo("not a date", "2026-11-05T00:00:00Z")).toBe(true);
  });
  it("the dark mode announcement checks it", () => {
    const gate = readFileSync("src/components/whats-new/theme-announcement.tsx", "utf8");
    expect(gate).toContain("isNewsTo(user.created_at, THEME_NEW_SINCE)");
  });
});
