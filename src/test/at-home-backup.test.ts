import { describe, expect, it } from "vitest";
import {
  AT_HOME_BACKUP_DEFINITIONS_KEY,
  AT_HOME_BACKUP_SESSIONS_KEY,
  BACKUP_DEFINITION_EXERCISE_COUNT,
  RESERVED_AT_HOME_BACKUP_BLOCK_KEYS,
  backupSessionDedupeKey,
  backupSessionTitle,
  cloneBackupRow,
  filterPrimaryProgramBlocks,
  isAtHomeBackupClient,
  isAtHomeBackupDefinitionsBlock,
  isAtHomeBackupSessionBlock,
  isCompleteBackupDefinition,
  isReservedAtHomeBackupBlock,
  shouldConfirmBackupStart,
  summarizeBackupDefinition,
} from "@/lib/at-home-backup";

const ASHLEY = "b970c6db-e59c-45b9-9429-6122b53b8616";

describe("at-home backup scoping", () => {
  it("enables only the allowlisted client", () => {
    expect(isAtHomeBackupClient(ASHLEY)).toBe(true);
    expect(isAtHomeBackupClient("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isAtHomeBackupClient(null)).toBe(false);
  });

  it("distinguishes definitions and session blocks", () => {
    const defs = { source_template_block_key: AT_HOME_BACKUP_DEFINITIONS_KEY };
    const sess = { source_template_block_key: AT_HOME_BACKUP_SESSIONS_KEY };
    const other = { source_template_block_key: "b2:template" };
    expect(isAtHomeBackupDefinitionsBlock(defs)).toBe(true);
    expect(isAtHomeBackupSessionBlock(sess)).toBe(true);
    expect(isAtHomeBackupSessionBlock(defs)).toBe(false);
    expect(isAtHomeBackupSessionBlock(other)).toBe(false);
    expect(isAtHomeBackupSessionBlock(null)).toBe(false);
  });

  it("names both reserved block keys at the query boundary", () => {
    expect(RESERVED_AT_HOME_BACKUP_BLOCK_KEYS).toEqual([
      AT_HOME_BACKUP_DEFINITIONS_KEY,
      AT_HOME_BACKUP_SESSIONS_KEY,
    ]);
    expect(isReservedAtHomeBackupBlock({ source_template_block_key: AT_HOME_BACKUP_DEFINITIONS_KEY })).toBe(true);
    expect(isReservedAtHomeBackupBlock({ source_template_block_key: AT_HOME_BACKUP_SESSIONS_KEY })).toBe(true);
    expect(isReservedAtHomeBackupBlock({ source_template_block_key: "b2:template" })).toBe(false);
    expect(isReservedAtHomeBackupBlock(null)).toBe(false);
  });
});

describe("primary program boundary", () => {
  const primary = { source_template_block_key: null };
  const defs = { source_template_block_key: AT_HOME_BACKUP_DEFINITIONS_KEY };
  const sess = { source_template_block_key: AT_HOME_BACKUP_SESSIONS_KEY };

  it("excludes both reserved blocks from primary schedule/adherence queries", () => {
    expect(filterPrimaryProgramBlocks([primary, defs, sess])).toEqual([primary]);
  });

  it("includes started session blocks only on the narrow opt-in read path", () => {
    expect(filterPrimaryProgramBlocks([primary, defs, sess], { includeSessions: true })).toEqual([
      primary,
      sess,
    ]);
  });

  it("never includes the definitions block, even with the opt-in", () => {
    expect(filterPrimaryProgramBlocks([defs], { includeSessions: true })).toEqual([]);
  });
});

describe("today confirmation branching", () => {
  it("confirms only when a normal gym session is scheduled today", () => {
    expect(shouldConfirmBackupStart(true)).toBe(true);
    expect(shouldConfirmBackupStart(false)).toBe(false);
  });
});

describe("definition completeness", () => {
  it("requires exactly seven prescribed rows per definition", () => {
    expect(BACKUP_DEFINITION_EXERCISE_COUNT).toBe(7);
    expect(isCompleteBackupDefinition(new Array(7).fill({}))).toBe(true);
    expect(isCompleteBackupDefinition(new Array(5).fill({}))).toBe(false);
    expect(isCompleteBackupDefinition([])).toBe(false);
  });
});

describe("session instantiation helpers", () => {
  it("dedupes by definition + date", () => {
    expect(backupSessionDedupeKey("day-1", "2026-08-17")).toBe("day-1:2026-08-17");
    expect(backupSessionDedupeKey("day-1", "2026-08-18")).not.toBe(
      backupSessionDedupeKey("day-1", "2026-08-17"),
    );
  });

  it("keeps the definition title, with a safe fallback", () => {
    expect(backupSessionTitle("Holds Full Body A")).toBe("Holds Full Body A");
    expect(backupSessionTitle("  ")).toBe("At-Home Backup");
    expect(backupSessionTitle(null)).toBe("At-Home Backup");
  });

  it("clones prescription fields only, never ids or logged results", () => {
    const cloned = cloneBackupRow(
      {
        id: "row-1",
        day_id: "def-day",
        exercise_id: "ex-1",
        sets: 4,
        reps_text: "8-10",
        rest_seconds: 90,
        notes: "Chest tall",
        measurement_type: "reps",
        tracking_type: "reps_weight",
        actual_load: 40,
        actual_reps: 10,
        created_at: "2026-01-01",
      },
      2,
    ) as Record<string, unknown>;
    expect(cloned.sort_order).toBe(2);
    expect(cloned.exercise_id).toBe("ex-1");
    expect(cloned.sets).toBe(4);
    expect(cloned).not.toHaveProperty("id");
    expect(cloned).not.toHaveProperty("day_id");
    expect(cloned).not.toHaveProperty("actual_load");
    expect(cloned).not.toHaveProperty("created_at");
  });

  it("defaults timed rows to time tracking", () => {
    const cloned = cloneBackupRow({ measurement_type: "time", duration_seconds: 40 }, 0);
    expect(cloned.tracking_type).toBe("time");
    expect(cloned.duration_seconds).toBe(40);
  });

  it("summarizes a definition", () => {
    expect(summarizeBackupDefinition([{ sets: 4 }, { sets: 3 }, { sets: 3 }])).toBe(
      "3 exercises · 10 sets",
    );
    expect(summarizeBackupDefinition([])).toBe("0 exercises");
  });
});