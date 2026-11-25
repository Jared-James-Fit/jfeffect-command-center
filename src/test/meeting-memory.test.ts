import { describe, expect, it } from "vitest";
import {
  categoryOf,
  contradicts,
  isOutdated,
  memoryBoard,
  overlap,
  reviewCandidate,
  scopeOf,
  type MemoryRow,
} from "@/lib/coaching-sessions/memory";

const row = (over: Partial<MemoryRow>): MemoryRow => ({
  id: "m1",
  kind: "preference",
  text: "Trains in the morning before work",
  status: "confirmed",
  permanence: "lasting",
  expires_on: null,
  ...over,
});

describe("what Cleo keeps from a meeting", () => {
  const kept = [row({ id: "k1" })];
  it("a plain, low-risk thing they said themselves is kept by itself", () => {
    const r = reviewCandidate(
      {
        kind: "goal",
        text: "Wants a 500 kg total next year",
        quote: "I want a 500 total next year",
        basis: "confirmed",
        speaker: "athlete",
      },
      kept,
      { allowAutoKeep: true, speakerConfirmed: true },
    );
    expect(r.action).toBe("auto_keep");
  });
  it("anything uncertain, sensitive, consequential or unattributed waits for the coach", () => {
    const opts = { allowAutoKeep: true, speakerConfirmed: true };
    expect(
      reviewCandidate(
        {
          kind: "goal",
          text: "Might want to drop a class",
          quote: "maybe I'll drop a class",
          basis: "confirmed",
          speaker: "athlete",
        },
        kept,
        opts,
      ).action,
    ).toBe("review");
    expect(
      reviewCandidate(
        {
          kind: "preference",
          text: "Knee pain on deep squats",
          quote: "my knee hurts",
          basis: "confirmed",
          speaker: "athlete",
        },
        kept,
        opts,
      ).action,
    ).toBe("review");
    expect(
      reviewCandidate(
        {
          kind: "decision",
          text: "Moving to four days",
          quote: "let's do four days",
          basis: "confirmed",
          speaker: "athlete",
        },
        kept,
        opts,
      ).action,
    ).toBe("review");
    expect(
      reviewCandidate(
        {
          kind: "goal",
          text: "Wants a 500 kg total",
          quote: "500 total",
          basis: "confirmed",
          speaker: "coach",
        },
        kept,
        opts,
      ).action,
    ).toBe("review");
    expect(
      reviewCandidate(
        {
          kind: "goal",
          text: "Wants a 500 kg total",
          quote: "500 total",
          basis: "confirmed",
          speaker: "athlete",
        },
        kept,
        { allowAutoKeep: true, speakerConfirmed: false },
      ).action,
    ).toBe("review");
    expect(
      reviewCandidate(
        {
          kind: "goal",
          text: "Wants a 500 kg total",
          quote: "500 total",
          basis: "tentative",
          speaker: "athlete",
        },
        kept,
        opts,
      ).action,
    ).toBe("review");
    expect(
      reviewCandidate(
        {
          kind: "goal",
          text: "Wants a 500 kg total",
          quote: "500 total",
          basis: "confirmed",
          speaker: "athlete",
        },
        kept,
        { allowAutoKeep: false, speakerConfirmed: true },
      ).action,
    ).toBe("review");
  });
  it("a duplicate is merged and a contradiction is flagged, never kept beside the old line", () => {
    const opts = { allowAutoKeep: true, speakerConfirmed: true };
    expect(
      reviewCandidate(
        {
          kind: "preference",
          text: "Trains in the morning before work",
          quote: "mornings",
          basis: "confirmed",
          speaker: "athlete",
        },
        kept,
        opts,
      ),
    ).toMatchObject({ action: "duplicate", of: "k1" });
    expect(
      reviewCandidate(
        {
          kind: "preference",
          text: "Trains in the evening after work",
          quote: "evenings now",
          basis: "confirmed",
          speaker: "athlete",
        },
        kept,
        opts,
      ),
    ).toMatchObject({ action: "conflict", with: "k1" });
  });
  it("overlap and contradiction read the same topic", () => {
    expect(overlap("Trains in the morning", "trains mornings before work")).toBeGreaterThan(0.3);
    expect(contradicts("Likes high-rep accessories", "Doesn't like high-rep accessories")).toBe(
      true,
    );
    expect(contradicts("Likes high-rep accessories", "Has a meet in June")).toBe(false);
  });
  it("categories, scope and what's outdated", () => {
    expect(categoryOf("goal")).toBe("goals");
    expect(categoryOf("unknown-kind")).toBe("insights");
    expect(scopeOf({ permanence: "temporary", event_key: null })).toBe("temporary");
    expect(scopeOf({ permanence: "lasting", event_key: "c1" })).toBe("event");
    expect(
      isOutdated(row({ permanence: "temporary", expires_on: "2026-11-01" }), "2026-11-25"),
    ).toBe(true);
    expect(isOutdated(row({ event_date: "2026-11-20" }), "2026-11-25")).toBe(true);
    expect(isOutdated(row({}), "2026-11-25")).toBe(false);
  });
  it("the board puts what needs review first and groups the rest", () => {
    const b = memoryBoard(
      [
        row({ id: "a", status: "proposed", conflicts_with: "b" }),
        row({ id: "b" }),
        row({ id: "c", kind: "goal", text: "500 kg total", auto_kept: true }),
        row({ id: "d", permanence: "temporary", expires_on: "2026-11-01" }),
        row({ id: "e", status: "archived" }),
      ],
      "2026-11-25",
    );
    expect(b.pending.map((r) => r.id)).toEqual(["a"]);
    expect(b.conflicts.map((r) => r.id)).toEqual(["a"]);
    expect(b.outdated.map((r) => r.id)).toEqual(["d"]);
    expect(b.groups.map((g) => g.category)).toEqual(["goals", "preferences"]);
    expect(b.autoKept.map((r) => r.id)).toEqual(["c"]);
    expect(b.total).toBe(2);
  });
});
