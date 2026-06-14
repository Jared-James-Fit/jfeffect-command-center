/**
 * Shared types and helpers for multi-block exercise prescriptions.
 *
 * A single `pl_exercise_rows` row can now own an ordered list of
 * "blocks" (straight sets, top set, backoff, ascending, drop set,
 * warm-up, custom). Each block type renders a different input matrix
 * in the coach builder and expands to a different set of logging rows
 * in the client logger.
 *
 * Legacy exercises (no blocks persisted) are read through the
 * `synthesizeLegacyBlock` helper so that nothing in the UI has to
 * branch on "is this row blockified yet". The DB backfill already
 * created one Straight block per existing row, so the synthesizer is
 * only the safety net for rows where blocks were deleted or never
 * materialized (e.g. mid-flight builder state).
 */

export const BLOCK_TYPES = [
  "straight",
  "top",
  "backoff",
  "ascending",
  "drop",
  "warmup",
  "custom",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/** How the block's load is prescribed. */
export type LoadType =
  | "none" // bodyweight / not prescribed
  | "fixed" // explicit weight in kg/lb
  | "pct_1rm" // % of 1RM
  | "rpe" // by RPE only
  | "ref_pct" // % of another block's top set
  | "ref_minus"; // top set minus N% / N units

export type LoadUnit = "kg" | "lb" | "pct";

/** A row inside an ascending or warm-up block. */
export interface BlockSetRow {
  id: string;
  sort_order: number;
  reps_text: string | null;
  load_value: number | null;
  load_unit: LoadUnit | null;
  rpe: string | null;
  rir: string | null;
  amrap: boolean;
}

/** A stage inside a drop set, after the initial drive set. */
export interface BlockDropStage {
  id: string;
  sort_order: number;
  reduction_type: "pct" | "fixed" | null;
  reduction_value: number | null;
  reps_text: string | null;
  rpe: string | null;
  rir: string | null;
  amrap: boolean;
  rest_seconds: number | null;
}

export interface ExerciseBlock {
  id: string;
  row_id: string;
  sort_order: number;
  block_type: BlockType;
  label: string | null;
  /** Set count for straight/top/backoff/custom. For ascending/warmup
   *  we use the length of `set_rows`. For drop we use 1 + stages. */
  sets: number | null;
  reps_text: string | null;
  rpe: string | null;
  rir: string | null;
  load_type: LoadType | null;
  load_value: number | null;
  load_unit: LoadUnit | null;
  reference_block_id: string | null;
  rest_seconds_override: number | null;
  tempo: string | null;
  amrap: boolean;
  notes: string | null;
  config: Record<string, any>;
  set_rows?: BlockSetRow[];
  drop_stages?: BlockDropStage[];
}

/** Minimal shape needed to synthesize a legacy block. */
export interface LegacyRowFields {
  id: string;
  sets: number | null;
  reps_text: string | null;
  rpe: string | null;
  rir: string | null;
  load: string | null;
  rest_seconds_override: number | null;
  tempo: string | null;
}

/**
 * Read the legacy `load` text field and infer (load_type, load_value, load_unit).
 *
 * Examples:
 *   "75%"     -> pct_1rm / 75 / pct
 *   "100kg"   -> fixed   / 100 / kg
 *   "225lb"   -> fixed   / 225 / lb
 *   "BW"      -> none    / null / null
 *   ""        -> null    / null / null
 */
export function parseLegacyLoad(raw: string | null | undefined): {
  load_type: LoadType | null;
  load_value: number | null;
  load_unit: LoadUnit | null;
} {
  const s = (raw ?? "").trim();
  if (!s) return { load_type: null, load_value: null, load_unit: null };
  const lower = s.toLowerCase();
  if (lower === "bw" || lower === "bodyweight") {
    return { load_type: "none", load_value: null, load_unit: null };
  }
  const pct = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pct) {
    return { load_type: "pct_1rm", load_value: Number(pct[1]), load_unit: "pct" };
  }
  const kg = s.match(/^(-?\d+(?:\.\d+)?)\s*kg$/i);
  if (kg) return { load_type: "fixed", load_value: Number(kg[1]), load_unit: "kg" };
  const lb = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:lb|lbs)$/i);
  if (lb) return { load_type: "fixed", load_value: Number(lb[1]), load_unit: "lb" };
  const bare = s.match(/^(-?\d+(?:\.\d+)?)$/);
  if (bare) return { load_type: "fixed", load_value: Number(bare[1]), load_unit: "kg" };
  return { load_type: null, load_value: null, load_unit: null };
}

/** Synthesize a single Straight block from legacy row fields. */
export function synthesizeLegacyBlock(row: LegacyRowFields): ExerciseBlock {
  const parsed = parseLegacyLoad(row.load);
  return {
    id: `legacy:${row.id}`,
    row_id: row.id,
    sort_order: 0,
    block_type: "straight",
    label: null,
    sets: row.sets,
    reps_text: row.reps_text,
    rpe: row.rpe,
    rir: row.rir,
    load_type: parsed.load_type,
    load_value: parsed.load_value,
    load_unit: parsed.load_unit,
    reference_block_id: null,
    rest_seconds_override: row.rest_seconds_override,
    tempo: row.tempo,
    amrap: false,
    notes: null,
    config: {},
    set_rows: [],
    drop_stages: [],
  };
}

/** How many concrete sets a block produces (for the logger). */
export function blockSetCount(block: ExerciseBlock): number {
  switch (block.block_type) {
    case "ascending":
    case "warmup":
      return block.set_rows?.length ?? 0;
    case "drop":
      return 1 + (block.drop_stages?.length ?? 0);
    case "top":
      return Math.max(1, block.sets ?? 1);
    case "straight":
    case "backoff":
    case "custom":
    default:
      return Math.max(1, block.sets ?? 1);
  }
}

/** Default human label when the coach hasn't set one. */
export function defaultBlockLabel(block_type: BlockType): string {
  switch (block_type) {
    case "straight": return "Straight Sets";
    case "top": return "Top Set";
    case "backoff": return "Backoff";
    case "ascending": return "Ascending Sets";
    case "drop": return "Drop Set";
    case "warmup": return "Warm-up";
    case "custom": return "Custom";
  }
}

/**
 * Resolve the suggested load for a single set of a block, given:
 *   - the block prescription
 *   - the client's 1RM (if any) for this exercise
 *   - the actual weight logged on the referenced block's top set (if any)
 *
 * Returns `null` when the calculation can't be made yet (e.g. backoff
 * waiting for the top set to be completed). Callers should render a
 * "Complete Top Set to calculate backoff load" hint when null is
 * returned for a `ref_*` block.
 */
export function resolveSuggestedLoad(args: {
  block: ExerciseBlock;
  one_rm: number | null;
  reference_top_load: number | null;
  /** For ascending/warmup, the set row's own load_value if present. */
  override_value?: number | null;
  override_unit?: LoadUnit | null;
}): { value: number; unit: "kg" | "lb" } | null {
  const { block, one_rm, reference_top_load, override_value, override_unit } = args;

  if (override_value != null && override_unit && override_unit !== "pct") {
    return { value: override_value, unit: override_unit };
  }

  switch (block.load_type) {
    case "fixed": {
      if (block.load_value == null) return null;
      const unit = (block.load_unit === "lb" ? "lb" : "kg") as "kg" | "lb";
      return { value: block.load_value, unit };
    }
    case "pct_1rm": {
      if (block.load_value == null || one_rm == null) return null;
      return { value: round(one_rm * (block.load_value / 100)), unit: "kg" };
    }
    case "ref_pct": {
      if (block.load_value == null || reference_top_load == null) return null;
      return { value: round(reference_top_load * (block.load_value / 100)), unit: "kg" };
    }
    case "ref_minus": {
      if (block.load_value == null || reference_top_load == null) return null;
      // load_unit "pct" => percent reduction; else absolute reduction in unit
      if (block.load_unit === "pct") {
        return { value: round(reference_top_load * (1 - block.load_value / 100)), unit: "kg" };
      }
      const unit = (block.load_unit === "lb" ? "lb" : "kg") as "kg" | "lb";
      return { value: round(reference_top_load - block.load_value), unit };
    }
    case "rpe":
    case "none":
    case null:
    default:
      return null;
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Validate a block's shape before save. Returns an array of
 * human-readable error strings (empty = OK).
 */
export function validateBlock(block: ExerciseBlock): string[] {
  const errs: string[] = [];
  if (!BLOCK_TYPES.includes(block.block_type)) {
    errs.push(`Unknown block type "${block.block_type}"`);
  }
  if (
    block.block_type !== "ascending" &&
    block.block_type !== "warmup" &&
    block.block_type !== "drop" &&
    (block.sets == null || block.sets < 1)
  ) {
    errs.push(`${defaultBlockLabel(block.block_type)}: sets must be ≥ 1`);
  }
  if (
    (block.block_type === "backoff" || block.load_type === "ref_pct" || block.load_type === "ref_minus") &&
    !block.reference_block_id
  ) {
    errs.push(`${defaultBlockLabel(block.block_type)}: pick a reference block`);
  }
  if (
    (block.load_type === "pct_1rm" || block.load_type === "ref_pct" || block.load_type === "ref_minus" || block.load_type === "fixed") &&
    block.load_value == null
  ) {
    errs.push(`${defaultBlockLabel(block.block_type)}: load value required`);
  }
  return errs;
}

/**
 * Deep-copy an ordered list of blocks with fresh ids and a remap of
 * `reference_block_id` so internal references point at the new copies.
 * Used by the copy-exercise / copy-week / duplicate flows.
 */
export function copyBlocks(
  blocks: ExerciseBlock[],
  newRowId: string,
  genId: () => string = () => crypto.randomUUID(),
): ExerciseBlock[] {
  const idMap = new Map<string, string>();
  for (const b of blocks) idMap.set(b.id, genId());
  return blocks.map((b) => ({
    ...b,
    id: idMap.get(b.id)!,
    row_id: newRowId,
    reference_block_id: b.reference_block_id ? idMap.get(b.reference_block_id) ?? null : null,
    set_rows: (b.set_rows ?? []).map((r) => ({ ...r, id: genId() })),
    drop_stages: (b.drop_stages ?? []).map((s) => ({ ...s, id: genId() })),
  }));
}

/**
 * Build an empty block of the given type with sensible defaults so the
 * builder UI has something to render immediately after "+ Add block".
 */
export function makeEmptyBlock(
  block_type: BlockType,
  row_id: string,
  sort_order: number,
  genId: () => string = () => crypto.randomUUID(),
): ExerciseBlock {
  const base: ExerciseBlock = {
    id: genId(),
    row_id,
    sort_order,
    block_type,
    label: null,
    sets: null,
    reps_text: null,
    rpe: null,
    rir: null,
    load_type: null,
    load_value: null,
    load_unit: null,
    reference_block_id: null,
    rest_seconds_override: null,
    tempo: null,
    amrap: false,
    notes: null,
    config: {},
    set_rows: [],
    drop_stages: [],
  };
  switch (block_type) {
    case "straight":
      return { ...base, sets: 3, reps_text: "8" };
    case "top":
      return { ...base, sets: 1, reps_text: "3", load_type: "rpe", rpe: "8" };
    case "backoff":
      return { ...base, sets: 3, reps_text: "5", load_type: "ref_minus", load_value: 10, load_unit: "pct" };
    case "ascending":
      return {
        ...base,
        set_rows: [
          { id: genId(), sort_order: 0, reps_text: "5", load_value: null, load_unit: "pct", rpe: null, rir: null, amrap: false },
          { id: genId(), sort_order: 1, reps_text: "3", load_value: null, load_unit: "pct", rpe: null, rir: null, amrap: false },
          { id: genId(), sort_order: 2, reps_text: "1", load_value: null, load_unit: "pct", rpe: null, rir: null, amrap: false },
        ],
      };
    case "drop":
      return {
        ...base,
        sets: 1,
        reps_text: "8",
        drop_stages: [
          { id: genId(), sort_order: 0, reduction_type: "pct", reduction_value: 20, reps_text: "AMRAP", rpe: null, rir: null, amrap: true, rest_seconds: 0 },
          { id: genId(), sort_order: 1, reduction_type: "pct", reduction_value: 20, reps_text: "AMRAP", rpe: null, rir: null, amrap: true, rest_seconds: 0 },
        ],
      };
    case "warmup":
      return {
        ...base,
        set_rows: [
          { id: genId(), sort_order: 0, reps_text: "8", load_value: 40, load_unit: "pct", rpe: null, rir: null, amrap: false },
          { id: genId(), sort_order: 1, reps_text: "5", load_value: 60, load_unit: "pct", rpe: null, rir: null, amrap: false },
        ],
      };
    case "custom":
      return { ...base, sets: 1, reps_text: "" };
  }
}