import { describe, expect, it } from "vitest";
import { AT_HOME_BACKUP_SESSIONS_KEY } from "@/lib/at-home-backup";
import { attachSessions, programContextFor, programContextText, publicProgramContext, weekChip } from "@/lib/program-context";

// Shaped like a real off-season: Block 1 (5 weeks, active) then Block 2 (draft), Sunday-start weeks.
const blocks = [
  { id: "b1", name: "Block 1 — Volume 5s/7s", start_date: "2026-09-27", end_date: "2026-10-31", weeks: 5, status: "Active", training_focus: "Volume 5s/7s", coach_notes: "bracing cues every top set", prep_id: "p1", archived: false },
  { id: "b2", name: "Block 2 — Volume 4s/6s", start_date: "2026-11-01", end_date: "2026-12-05", weeks: 5, status: "Draft", training_focus: "Volume 4s/6s", prep_id: "p1", archived: false },
  { id: "home", name: "At-home sessions", source_template_block_key: AT_HOME_BACKUP_SESSIONS_KEY, start_date: "2026-09-27", status: "Active", archived: false },
];
const weeks = [
  ...[1, 2, 3, 4, 5].map((i) => ({ id: `w1-${i}`, block_id: "b1", week_index: i, phase: "Volume 5s/7s" })),
  ...[1, 2, 3, 4, 5].map((i) => ({ id: `w2-${i}`, block_id: "b2", week_index: i, notes: i === 1 ? "new comp stance" : null })),
  { id: "wh", block_id: "home", week_index: 1 },
];
const notes = [
  { block_id: "b1", week_id: null, ai_label: "Volume 5s/7s", ai_summary: "Build work capacity before heavier blocks." },
  { block_id: "b1", week_id: "w1-3", ai_label: "Load progression", ai_summary: "Same volume, top sets to RPE 5-6." },
  { block_id: "b1", week_id: "w1-4", ai_label: "Intensification", ai_summary: "Top sets reach RPE 6-7." },
  { block_id: "b1", week_id: "w1-5", ai_label: "Peak volume", ai_summary: "Highest intensity of the block, RPE 7-8.", coach_label: "Heaviest week" },
  { block_id: "b2", week_id: "w2-1", ai_label: "Intro week", ai_summary: "Baseline volume, top sets at RPE 4." },
];
const preps = [{ id: "p1", title: "Jared McIntyre — 28 Week Off-Season Development", status: "Active", goal_type: "Off-Season", current_focus: "Block 1 — Volume 5s/7s" }];
const base = { blocks, weeks, notes, preps, ownerName: "Jared McIntyre" };

describe("programContextFor", () => {
  it("knows the week just trained and the one coming up", () => {
    // Check-in for Mon Oct 12 - Sun Oct 18 → middle of the period is Thu Oct 15.
    const ctx = programContextFor({ ...base, ref: "2026-10-15" })!;
    expect(ctx.program).toBe("28 Week Off-Season Development");
    expect(ctx.this_week).toMatchObject({ block: "Block 1 — Volume 5s/7s", week: 3, weeks_in_block: 5, label: "Load progression", program_week: 3, program_weeks: 10 });
    expect(ctx.next_week).toMatchObject({ week: 4, label: "Intensification", focus: "Top sets reach RPE 6-7.", start: "2026-10-18", end: "2026-10-24" });
    expect(ctx.block).toMatchObject({ label: "Volume 5s/7s", purpose: "Build work capacity before heavier blocks.", training_focus: null, coach_notes: "bracing cues every top set" });
    expect(ctx.next_block).toBeNull();
    expect(ctx.goal).toBe("Off-Season");
  });

  it("the coach's wording wins, and a new block starting next week is called out (draft flagged)", () => {
    const ctx = programContextFor({ ...base, ref: "2026-10-29" })!;
    expect(ctx.this_week).toMatchObject({ week: 5, label: "Heaviest week" });
    expect(ctx.next_week).toMatchObject({ block: "Block 2 — Volume 4s/6s", week: 1, label: "Intro week", notes: "new comp stance", draft: true });
    expect(ctx.next_block).toMatchObject({ name: "Block 2 — Volume 4s/6s", draft: true });
    const text = programContextText(ctx);
    expect(text).toContain("last week of this block");
    expect(text).toContain("NEW BLOCK STARTS NEXT WEEK: Block 2");
    expect(text).toContain("still a draft");
  });

  it("before the program starts there's no week just trained; after it ends nothing is next", () => {
    const before = programContextFor({ ...base, ref: "2026-09-20" })!;
    expect(before.this_week).toBeNull();
    expect(before.next_week).toMatchObject({ block: "Block 1 — Volume 5s/7s", week: 1 });
    const after = programContextFor({ ...base, ref: "2026-12-20" })!;
    expect(after.next_week).toBeNull();
    expect(programContextText(after)).toContain("UPCOMING WEEK: nothing programmed yet");
  });

  it("ignores at-home backup blocks and blocks with no weeks; null with no program", () => {
    expect(programContextFor({ ...base, blocks: [blocks[2]], ref: "2026-10-15" })).toBeNull();
    const undated = { id: "x", name: "Empty shell", start_date: "2026-09-01", status: "Active", archived: false };
    expect(programContextFor({ ...base, blocks: [...blocks, undated], ref: "2026-12-20" })!.this_week).toMatchObject({ block: "Block 2 — Volume 4s/6s", week: 5 });
    expect(programContextText(null)).toBe("");
  });

  it("adds session titles and keeps coach notes out of the client-readable copy", () => {
    const ctx = attachSessions(programContextFor({ ...base, ref: "2026-10-15" })!, [
      { week_id: "w1-4", day_index: 2, title: "Bench + Upper" },
      { week_id: "w1-4", day_index: 1, title: "Squat" },
      { week_id: "w1-3", day_index: 1, title: null, focus: "Deadlift" },
    ]);
    expect(ctx.next_week?.sessions).toEqual(["Squat", "Bench + Upper"]);
    expect(ctx.this_week?.sessions).toEqual(["Deadlift"]);
    expect(programContextText(ctx)).toContain("coach notes: bracing cues every top set");
    const pub = JSON.stringify(publicProgramContext(ctx));
    expect(pub).not.toContain("bracing");
    expect(pub).not.toContain("w1-4");
    expect(weekChip(ctx.next_week)).toBe("Week 4 of 5 · Intensification");
  });
});

describe("wiring", () => {
  it("check-ins, form reviews and nutrition plans all get the program", async () => {
    const { readFileSync } = await import("node:fs");
    const checkins = readFileSync("src/lib/messenger-checkins.functions.ts", "utf8");
    expect(checkins).toContain("loadProgramContext(sb, row.client_id, periodStart ? isoDateAdd(periodStart, 3) : null)");
    expect(checkins).toContain("program: publicProgramContext(program)");
    expect(readFileSync("src/lib/submission-reviews.functions.ts", "utf8")).toContain("PROGRAM CONTEXT:");
    expect(readFileSync("src/lib/nutrition-ai-plans.functions.ts", "utf8")).toContain("programContextText(program, { readout: false })");
  });
});

import { weightClassGap, weightClassKg } from "@/lib/program-context";

describe("weight class", () => {
  it("parses classes and reports the gap from the 7-day average", () => {
    expect(weightClassKg("57 kg")).toBe(57);
    expect(weightClassKg("M 66kg")).toBe(66);
    expect(Math.round(weightClassKg("198 lb")!)).toBe(90);
    expect(weightClassGap("57 kg", 58.24, "kg")).toEqual({ class: "57 kg", bodyweight: "58.2 kg", gap: "1.2 kg over the class" });
    expect(weightClassGap("57 kg", null, "kg").gap).toBeNull();
  });
});
