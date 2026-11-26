/**
 * What a logged set's PR indicator says (pure, tested): one compact
 * "🏆 5-rep ATPR" or "🏆 2 PRs" under the set, opening to each record with
 * what it beat. Read from what the logger already detects, never a new rule:
 * the server's records for the set (a rep record and a weight record, each
 * at its top scope, the same as the old pills) or, where there are none (a
 * member's legacy logger, an assisted set), the on-phone rep-max check.
 */
import { formatLoad, topScope, type RecordScope, type RepRecord } from "@/lib/training-records";
import type { SetPR } from "@/lib/workout-pr";

export type SetPrItem = {
  key: string;
  scope: RecordScope;
  /** "5-rep ATPR", "Weight program PR". */
  title: string;
  /** "145 kg × 5 · was 140 kg". */
  detail: string;
};

type ServerRecord = Pick<RepRecord, "reps" | "load_kg" | "atpr" | "program_pr" | "block_pr" | "prev_all_kg" | "prev_program_kg" | "prev_block_kg">;

const SCOPE_WORDS: Record<RecordScope, string> = { atpr: "all-time PR", program_pr: "program PR", block_pr: "block PR" };

function previousFor(r: ServerRecord, scope: RecordScope): number | null {
  const v = scope === "atpr" ? r.prev_all_kg : scope === "program_pr" ? r.prev_program_kg : r.prev_block_kg;
  return v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
}

const num = (n: number) => String(Math.round(n * 10) / 10);

export function setPrItems(input: {
  record?: ServerRecord | null;
  loadRecord?: ServerRecord | null;
  /** The on-phone rep-max check, used only when the server has no records for this logger. */
  localPr?: SetPR | null;
  assisted?: boolean;
  unit: "kg" | "lb";
  /** The machine it was on, when a weight on it means nothing on another one: "· on Hammer row". */
  equipment?: string | null;
}): SetPrItem[] {
  const { record, loadRecord, localPr, assisted, unit } = input;
  const on = input.equipment ? ` · on ${input.equipment}` : "";
  const items: SetPrItem[] = [];
  const repScope = record ? topScope(record) : null;
  if (record && repScope) {
    const prev = previousFor(record, repScope);
    items.push({
      key: "reps",
      scope: repScope,
      title: `${record.reps}-rep ${SCOPE_WORDS[repScope]}`,
      detail: `${formatLoad(record.load_kg, unit)} × ${record.reps}${prev != null ? ` · was ${formatLoad(prev, unit)}` : ""}${on}`,
    });
  }
  const loadScope = loadRecord ? topScope(loadRecord) : null;
  if (loadRecord && loadScope) {
    const prev = previousFor(loadRecord, loadScope);
    items.push({
      key: "weight",
      scope: loadScope,
      title: `Weight ${SCOPE_WORDS[loadScope]}`,
      detail: `Heaviest yet · ${formatLoad(loadRecord.load_kg, unit)}${prev != null ? ` · was ${formatLoad(prev, unit)}` : ""}${on}`,
    });
  }
  if (!items.length && localPr) {
    items.push({
      key: "local",
      scope: "atpr",
      title: `${localPr.reps}-rep all-time PR`,
      detail: assisted
        ? `${num(localPr.amount)} ${localPr.unit} less assistance than your best`
        : `+${num(localPr.amount)} ${localPr.unit} over your previous best${on}`,
    });
  }
  return items;
}

/** The collapsed indicator's words: the one record's name, or how many. */
export function setPrSummary(items: SetPrItem[]): string {
  if (items.length === 1) return items[0].title;
  return `${items.length} PRs`;
}

/**
 * The most reps a record can be for and still be "a PR" worth celebrating
 * (community.ts' HEADLINE_PR_MAX_REPS; the same test, set-pr-items keeps it
 * here so the logger never loads the Crew module for it).
 */
export const GENUINE_PR_MAX_REPS = 10;

/**
 * Whether a set's records earn the PR celebration (pure, tested): an all-time
 * record at 10 reps or fewer, or the heaviest weight they've ever put on the
 * exercise. A block or program best (the plan was always going to bring it),
 * or an all-time best at 12 or 15 reps on an accessory, keeps its chip under
 * the set and its League points; it just isn't a moment.
 */
export function isGenuineSetPr(input: {
  record?: Pick<ServerRecord, "reps" | "atpr"> | null;
  loadRecord?: Pick<ServerRecord, "atpr"> | null;
  /** The on-phone rep-max check (all-time by construction), when the server has no records here. */
  localPr?: Pick<SetPR, "reps"> | null;
}): boolean {
  const { record, loadRecord, localPr } = input;
  if (loadRecord?.atpr) return true;
  if (record?.atpr && Number(record.reps) >= 1 && Number(record.reps) <= GENUINE_PR_MAX_REPS) return true;
  if (!record && !loadRecord && localPr && localPr.reps >= 1 && localPr.reps <= GENUINE_PR_MAX_REPS) return true;
  return false;
}
