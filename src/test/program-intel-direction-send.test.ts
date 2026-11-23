import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  directionSend,
  runInstructions,
  sameInstructions,
} from "@/lib/program-intel/direction-send";

const base = {
  notes: "Bench is the priority. Deadlift once a week.",
  used: null as string | null,
  blocked: false,
  cleo: true,
};

describe("Tell Cleo: what Send does", () => {
  it("has nothing to send with an empty box", () => {
    expect(directionSend({ ...base, stage: "setup", notes: "  \n " })).toBeNull();
  });

  it("writes the strategy when nothing is running", () => {
    const s = directionSend({ ...base, stage: "setup" })!;
    expect(s.action).toBe("strategy");
    expect(s.label).toBe("Send to Cleo");
    expect(directionSend({ ...base, stage: "setup", cleo: false })!.label).not.toMatch(/Cleo/);
  });

  it("never sends past a setup conflict that stops a run", () => {
    for (const stage of ["setup", "strategy_ready", "draft_ready", "draft_error"] as const) {
      const s = directionSend({ ...base, stage, used: "older words", blocked: true })!;
      expect(s.action).toBeNull();
      expect(s.hint).toMatch(/conflicts/);
    }
  });

  it("rewrites a waiting strategy only when the instructions changed after it", () => {
    expect(directionSend({ ...base, stage: "strategy_ready", used: "Squat first." })!.action).toBe(
      "rewrite",
    );
    const same = directionSend({
      ...base,
      stage: "strategy_ready",
      used: "Bench is the priority.\nDeadlift once a week.",
    })!;
    expect(same.action).toBeNull();
    expect(same.hint).toMatch(/follows these/);
  });

  it("builds a new draft beside a waiting one when the instructions changed", () => {
    const s = directionSend({ ...base, stage: "draft_ready", used: "" })!;
    expect(s.action).toBe("rebuild");
    expect(s.hint).toMatch(/Earlier programs/);
    expect(directionSend({ ...base, stage: "draft_ready", used: base.notes })!.action).toBeNull();
  });

  it("starts a stopped run over with new words, and points at Try again with the same ones", () => {
    expect(directionSend({ ...base, stage: "draft_error", used: "x" })!.action).toBe("restart");
    expect(directionSend({ ...base, stage: "strategy_error", used: "x" })!.action).toBe("restart");
    expect(directionSend({ ...base, stage: "draft_error", used: base.notes })!.hint).toMatch(
      /try it again/,
    );
  });

  it("never sends while a run is going, and says whether these are in it", () => {
    for (const stage of ["strategy_running", "building"] as const) {
      expect(directionSend({ ...base, stage, used: "x" })!.action).toBeNull();
      expect(directionSend({ ...base, stage, used: "x" })!.hint).toMatch(
        /Send these once it's done/,
      );
      expect(directionSend({ ...base, stage, used: base.notes })!.hint).not.toMatch(
        /once it's done/,
      );
    }
  });

  it("reads a run's instructions from its setup and ignores spacing", () => {
    expect(runInstructions(null)).toBeNull();
    expect(runInstructions({ options: { setup: { coachNotes: "a" } } })).toBe("a");
    expect(runInstructions({ options: {} })).toBe("");
    expect(sameInstructions(" A  b\nc ", "A b c")).toBe(true);
    expect(sameInstructions("A", "B")).toBe(false);
  });
});

describe("Tell Cleo: wiring", () => {
  const card = readFileSync("src/components/program-intel/workflow/coach-direction.tsx", "utf8");
  const ws = readFileSync("src/components/program-intel/generator/workstation.tsx", "utf8");
  const review = readFileSync("src/components/program-intel/generator/strategy-view.tsx", "utf8");

  it("the card has a Send button and ⌘/Ctrl+Enter", () => {
    expect(card).toMatch(/data-direction-send/);
    expect(card).toMatch(/e\.metaKey \|\| e\.ctrlKey/);
  });

  it("the workstation hands the card what Send does", () => {
    expect(ws).toMatch(/send=\{sendInfo\}/);
    expect(ws).toMatch(/onSend=\{\(\) => void sendDirection\(\)\}/);
  });

  it("a strategy written before new instructions says so and leads with the rewrite", () => {
    expect(ws).toMatch(/staleInstructions=\{strategyStale\}/);
    expect(review).toMatch(/data-strategy-stale/);
    expect(review).toMatch(/Build it as written/);
  });

  it("keeps the typed instructions on the phone when a run was started from older ones", () => {
    expect(ws).toMatch(
      /if \(sameInstructions\(runSetup\.coachNotes, setup\?\.coachNotes\)\) clearDirectionDraft\(clientId\)/,
    );
  });
});
