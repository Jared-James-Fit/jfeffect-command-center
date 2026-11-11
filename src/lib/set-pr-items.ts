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

const SCOPE_WORDS: Record<RecordScope, string> = { atpr: "ATPR", program_pr: "program PR", block_pr: "block PR" };

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
}): SetPrItem[] {
  const { record, loadRecord, localPr, assisted, unit } = input;
  const items: SetPrItem[] = [];
  const repScope = record ? topScope(record) : null;
  if (record && repScope) {
    const prev = previousFor(record, repScope);
    items.push({
      key: "reps",
      scope: repScope,
      title: `${record.reps}-rep ${SCOPE_WORDS[repScope]}`,
      detail: `${formatLoad(record.load_kg, unit)} × ${record.reps}${prev != null ? ` · was ${formatLoad(prev, unit)}` : ""}`,
    });
  }
  const loadScope = loadRecord ? topScope(loadRecord) : null;
  if (loadRecord && loadScope) {
    const prev = previousFor(loadRecord, loadScope);
    items.push({
      key: "weight",
      scope: loadScope,
      title: `Weight ${SCOPE_WORDS[loadScope]}`,
      detail: `Heaviest yet · ${formatLoad(loadRecord.load_kg, unit)}${prev != null ? ` · was ${formatLoad(prev, unit)}` : ""}`,
    });
  }
  if (!items.length && localPr) {
    items.push({
      key: "local",
      scope: "atpr",
      title: `${localPr.reps}-rep ATPR`,
      detail: assisted
        ? `${num(localPr.amount)} ${localPr.unit} less assistance than your best`
        : `+${num(localPr.amount)} ${localPr.unit} over your previous best`,
    });
  }
  return items;
}

/** The collapsed indicator's words: the one record's name, or how many. */
export function setPrSummary(items: SetPrItem[]): string {
  if (items.length === 1) return items[0].title;
  return `${items.length} PRs`;
}
