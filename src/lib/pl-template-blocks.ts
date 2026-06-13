/**
 * Template payload normalization layer (schema_version: 2).
 *
 * The pl_templates.payload column is JSONB. Historically:
 *   - template_type === "block"     → payload = { weeks_data: [...] }            (single block)
 *   - template_type === "full_prep" → payload = { blocks_data: [{...}], prep }   (multi block)
 *   - template_type === "week"/"day"/"exercise_row" → leaf shapes
 *
 * We are evolving "block" templates (and full_prep) to a unified v2 shape:
 *
 *   {
 *     schema_version: 2,
 *     blocks: [
 *       {
 *         id: <stable uuid>,
 *         name: "Block 1",
 *         phase: null | string,
 *         notes: "",
 *         order_index: 0,
 *         archived: false,
 *         archived_at: null,
 *         deleted_at: null,
 *         estimated_minutes: null,
 *         weeks: [ ...weeks_data items... ],
 *         // preserved passthrough for future-proofing:
 *         training_focus?: string | null,
 *         goal?: string | null,
 *         source_template_block_id?: string | null,
 *       },
 *       ...
 *     ],
 *     // every unknown top-level field is preserved verbatim under __legacy
 *   }
 *
 * Rules:
 *   - Reading legacy payloads NEVER mutates them on disk. Normalization is
 *     in-memory; v2 is only persisted on intentional save.
 *   - Unknown legacy fields are preserved (in `__legacy`) so other features
 *     that still read e.g. `payload.prep` keep working after a round-trip.
 *   - Block identity is a stable UUID; never use array index as identity.
 *   - Leaf template types (week/day/exercise_row) bypass this layer.
 */

export const TEMPLATE_SCHEMA_VERSION = 2 as const;

/** Marker stored on blocks that came from a legacy payload and have never
 * been intentionally saved as v2. They get deterministic temporary IDs
 * derived from the template id + their legacy position so that refresh,
 * URL ?block=, and Back/Forward all keep pointing at the same block. */
const LEGACY_ID_PREFIX = "legacy:";
function legacyBlockId(templateId: string | undefined, position: number, sourceKey: string): string {
  const tid = templateId && templateId.length > 0 ? templateId : "anon";
  return `${LEGACY_ID_PREFIX}${tid}:${sourceKey}:${position}`;
}
export function isTemporaryLegacyBlockId(id: string | undefined | null): boolean {
  return typeof id === "string" && id.startsWith(LEGACY_ID_PREFIX);
}

export interface TemplateBlockV2 {
  id: string;
  name: string;
  phase: string | null;
  notes: string;
  order_index: number;
  archived: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  estimated_minutes: number | null;
  weeks: any[]; // shape preserved from existing weeks_data entries
  training_focus?: string | null;
  goal?: string | null;
  source_template_block_id?: string | null;
  // anything else carried through unchanged:
  [extra: string]: any;
}

export interface TemplatePayloadV2 {
  schema_version: 2;
  blocks: TemplateBlockV2[];
  /** Snapshot of every unknown top-level key from the source payload. A
   * safety backup ONLY — unknown keys are ALSO preserved at their original
   * top-level positions so existing readers (e.g. `payload.prep`) keep
   * working. Never the sole location for live fields. */
  __legacy?: Record<string, any>;
  /** Recovery state for malformed payloads. When set, destructive block ops
   * MUST be disabled and the raw original payload is preserved verbatim. */
  __recovery?: { reason: string; raw: any };
  /** Allow forward-compatible extras (e.g. prep info on full_prep). */
  [extra: string]: any;
}

/** Crypto.randomUUID with a safe fallback. */
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `blk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function makeBlock(
  partial: Partial<TemplateBlockV2> & { weeks?: any[] },
  orderIndex: number,
  fallbackId?: string,
): TemplateBlockV2 {
  return {
    id: partial.id || fallbackId || newId(),
    name: partial.name || `Block ${orderIndex + 1}`,
    phase: partial.phase ?? null,
    notes: partial.notes ?? "",
    order_index: typeof partial.order_index === "number" ? partial.order_index : orderIndex,
    archived: Boolean(partial.archived),
    archived_at: partial.archived_at ?? null,
    deleted_at: partial.deleted_at ?? null,
    estimated_minutes: partial.estimated_minutes ?? null,
    weeks: Array.isArray(partial.weeks) ? partial.weeks : [],
    training_focus: partial.training_focus ?? null,
    goal: partial.goal ?? null,
    source_template_block_id: partial.source_template_block_id ?? null,
  };
}

/** Reserved keys we extract; everything else is preserved verbatim
 * at its original top-level position AND snapshotted in __legacy. */
const V2_RESERVED_KEYS = new Set([
  "schema_version",
  "blocks",
  "blocks_data",
  "weeks_data",
  "block_name",
  "__legacy",
  "__recovery",
]);

function pickUnknownTopLevel(payload: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(payload)) {
    if (!V2_RESERVED_KEYS.has(k)) out[k] = payload[k];
  }
  return out;
}

/**
 * Normalize any incoming payload to the v2 in-memory shape WITHOUT mutating
 * the input. Safe to call on legacy, v2, full_prep, or completely empty payloads.
 *
 * Normalization priority (explicit, no silent merging across sources):
 *   1. valid schema_version: 2 with valid blocks array  → trust v2.blocks
 *   2. legacy blocks_data (or templateType === full_prep) → expand
 *   3. legacy weeks_data (or templateType === block)     → single block
 *   4. malformed/unreadable                              → __recovery mode
 *
 * Pass `templateId` so legacy blocks get deterministic temporary IDs that
 * are stable across refreshes (legacy:<templateId>:<sourceKey>:<position>).
 */
export function normalizeTemplatePayload(
  rawPayload: any,
  opts?: { templateType?: string; templateId?: string },
): TemplatePayloadV2 {
  const payload = rawPayload && typeof rawPayload === "object" ? deepClone(rawPayload) : {};
  const templateId = opts?.templateId;
  const unknownTop = pickUnknownTopLevel(payload);

  // Already v2 — trust the shape but defensively re-make each block so
  // any missing field is filled in with safe defaults.
  if (payload.schema_version === 2 && Array.isArray(payload.blocks)) {
    const blocks = payload.blocks
      .map((b: any, i: number) => makeBlock(b ?? {}, i))
      // Stable order: explicit order_index first, fall back to original index.
      .sort((a: TemplateBlockV2, b: TemplateBlockV2) => a.order_index - b.order_index)
      .map((b: TemplateBlockV2, i: number) => ({ ...b, order_index: i }));
    return { ...unknownTop, schema_version: 2, blocks, __legacy: unknownTop };
  }

  // full_prep legacy: payload.blocks_data → blocks
  if (opts?.templateType === "full_prep" || Array.isArray(payload.blocks_data)) {
    const srcRaw = Array.isArray(payload.blocks_data) ? payload.blocks_data : [];
    // Validate each entry; reject if any are not objects.
    const src = srcRaw.every((b: any) => b && typeof b === "object") ? srcRaw : [];
    if (srcRaw.length > 0 && src.length === 0) {
      return {
        schema_version: 2,
        blocks: [makeBlock({ name: "Block 1" }, 0, legacyBlockId(templateId, 0, "recovery"))],
        ...unknownTop,
        __legacy: unknownTop,
        __recovery: { reason: "blocks_data contained non-object entries", raw: rawPayload },
      };
    }
    const blocks: TemplateBlockV2[] = src.length
      ? src.map((b: any, i: number) =>
          makeBlock(
            {
              id: b.id, // may be undefined → deterministic legacy id
              name: b.name,
              phase: b.phase ?? b.training_focus ?? null,
              notes: b.notes ?? "",
              estimated_minutes: b.estimated_minutes ?? b.est_minutes_per_workout ?? null,
              weeks: Array.isArray(b.weeks_data) ? b.weeks_data : [],
              training_focus: b.training_focus ?? null,
              goal: b.goal ?? null,
            },
            i,
            legacyBlockId(templateId, i, "blocks_data"),
          ),
        )
      : [makeBlock({ name: "Block 1" }, 0, legacyBlockId(templateId, 0, "blocks_data"))];
    return { ...unknownTop, schema_version: 2, blocks, __legacy: unknownTop };
  }

  // "block" legacy: payload.weeks_data → single block
  if (Array.isArray(payload.weeks_data) || (!payload.blocks && !payload.blocks_data)) {
    const weeksRaw = Array.isArray(payload.weeks_data) ? payload.weeks_data : [];
    // weeks_data must be an array of objects (or empty). Otherwise recover.
    if (weeksRaw.length > 0 && !weeksRaw.every((w: any) => w && typeof w === "object")) {
      return {
        schema_version: 2,
        blocks: [makeBlock({ name: "Block 1" }, 0, legacyBlockId(templateId, 0, "recovery"))],
        ...unknownTop,
        __legacy: unknownTop,
        __recovery: { reason: "weeks_data contained non-object entries", raw: rawPayload },
      };
    }
    const onlyBlock = makeBlock(
      {
        name: payload.block_name || payload.name || "Block 1",
        notes: payload.notes ?? "",
        weeks: weeksRaw,
      },
      0,
      legacyBlockId(templateId, 0, "weeks_data"),
    );
    return { ...unknownTop, schema_version: 2, blocks: [onlyBlock], __legacy: unknownTop };
  }

  // Truly unknown shape — RECOVERY MODE. Preserve raw payload verbatim,
  // seed a single empty block so the UI can render, and disable destructive
  // ops at callsites that respect __recovery.
  return {
    schema_version: 2,
    blocks: [makeBlock({ name: "Block 1" }, 0, legacyBlockId(templateId, 0, "recovery"))],
    ...unknownTop,
    __legacy: unknownTop,
    __recovery: { reason: "Unrecognized payload shape", raw: rawPayload },
  };
}

/** True when a normalized payload is in recovery mode and destructive
 * operations (purge, archive, reorder) MUST be disabled in the UI. */
export function isPayloadInRecovery(v2: TemplatePayloadV2): boolean {
  return Boolean(v2.__recovery);
}

/**
 * Convert a v2 in-memory payload back into the JSONB shape that gets
 * persisted.
 *
 * Canonical source of truth: `blocks`. The `weeks_data` and `blocks_data`
 * fields are GENERATED COMPATIBILITY MIRRORS for legacy readers and must
 * never be merged back over canonical data on the next read (the v2 branch
 * of normalizeTemplatePayload ignores them entirely when blocks is valid).
 *
 * Mirror filtering rules:
 *   - `blocks_data` mirrors ACTIVE assignable blocks only (no archived, no trashed).
 *   - `weeks_data` mirrors the FIRST active block only, for single-block readers.
 *   - Trashed blocks are NEVER mirrored.
 *   - Archived blocks are NEVER mirrored into assignment-shaped fields.
 */
export function serializeTemplatePayload(v2: TemplatePayloadV2): Record<string, any> {
  if (v2.__recovery) {
    // Refuse to overwrite a malformed payload with an empty v2 shell.
    // Caller must explicitly opt in to recovery-save.
    throw new Error("serializeTemplatePayload: payload is in recovery mode; refusing to overwrite raw data.");
  }
  const blocks = v2.blocks.map((b, i) => ({ ...b, order_index: i }));
  const activeBlocks = blocks.filter((b) => !b.archived && !b.deleted_at);
  const primary = activeBlocks[0] ?? blocks[0];
  // Re-include unknown top-level keys from CURRENT v2 state (not the
  // snapshot), so live edits to e.g. `prep` survive the round-trip.
  const current = pickUnknownTopLevel(v2 as any);

  return {
    ...current, // first so v2 fields below win
    schema_version: 2,
    blocks,
    // Compatibility mirrors — ACTIVE blocks only, never trashed/archived.
    weeks_data: (primary && !primary.archived && !primary.deleted_at) ? (primary.weeks ?? []) : [],
    blocks_data: activeBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      phase: b.phase,
      notes: b.notes,
      training_focus: b.training_focus,
      goal: b.goal,
      weeks_data: b.weeks,
    })),
  };
}

/** Active = not archived AND not in trash. Sorted by order_index. */
export function getActiveTemplateBlocks(v2: TemplatePayloadV2): TemplateBlockV2[] {
  return v2.blocks
    .filter((b) => !b.archived && !b.deleted_at)
    .sort((a, b) => a.order_index - b.order_index);
}

export function getArchivedTemplateBlocks(v2: TemplatePayloadV2): TemplateBlockV2[] {
  return v2.blocks.filter((b) => b.archived && !b.deleted_at);
}

export function getTrashedTemplateBlocks(v2: TemplatePayloadV2): TemplateBlockV2[] {
  return v2.blocks.filter((b) => b.deleted_at);
}

/** Deep-clone a block with fresh IDs throughout. Strips the source's identity. */
export function cloneTemplateBlock(block: TemplateBlockV2, opts?: { nameSuffix?: string }): TemplateBlockV2 {
  const cloned = deepClone(block);
  cloned.id = newId();
  cloned.name = `${block.name}${opts?.nameSuffix ?? " Copy"}`;
  cloned.archived = false;
  cloned.archived_at = null;
  cloned.deleted_at = null;
  cloned.source_template_block_id = block.id;
  // weeks themselves don't carry stable identity — copy as-is.
  return cloned;
}

export interface ValidationWarning {
  level: "warn" | "error";
  code: string;
  message: string;
  blockId?: string;
}

/**
 * Surface non-destructive warnings about a payload. Never throws.
 * `error`-level results SHOULD block assignment; `warn`-level should not.
 */
export function validateTemplatePayload(v2: TemplatePayloadV2): ValidationWarning[] {
  const out: ValidationWarning[] = [];
  if (!Array.isArray(v2.blocks) || v2.blocks.length === 0) {
    out.push({ level: "error", code: "no_blocks", message: "Template has no blocks." });
    return out;
  }
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const b of v2.blocks) {
    if (!b.id) out.push({ level: "error", code: "missing_block_id", message: `Block "${b.name}" is missing an ID.` });
    if (seenIds.has(b.id)) out.push({ level: "error", code: "duplicate_block_id", message: `Duplicate Block ID: ${b.id}`, blockId: b.id });
    seenIds.add(b.id);
    if (seenOrders.has(b.order_index)) out.push({ level: "warn", code: "duplicate_order_index", message: `Duplicate order index ${b.order_index} on "${b.name}"`, blockId: b.id });
    seenOrders.add(b.order_index);
    if (!Array.isArray(b.weeks)) {
      out.push({ level: "error", code: "invalid_weeks", message: `Block "${b.name}" has an invalid weeks array.`, blockId: b.id });
    } else if (!b.archived && !b.deleted_at && b.weeks.length === 0) {
      out.push({ level: "warn", code: "empty_block", message: `Block "${b.name}" has no weeks.`, blockId: b.id });
    }
  }
  return out;
}

/** Insert a fresh blank block at the end of the active sequence. */
export function addBlankBlock(v2: TemplatePayloadV2, name?: string): TemplatePayloadV2 {
  const next = deepClone(v2);
  const active = next.blocks.filter((b) => !b.deleted_at);
  const newBlock = makeBlock({ name: name || `Block ${active.length + 1}` }, active.length);
  next.blocks.push(newBlock);
  return next;
}

/** Replace a single block by ID, preserving all others. */
export function replaceBlock(v2: TemplatePayloadV2, blockId: string, patch: Partial<TemplateBlockV2>): TemplatePayloadV2 {
  const next = deepClone(v2);
  next.blocks = next.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b));
  return next;
}

/** Reorder ACTIVE blocks. Archived/trashed blocks keep their relative position at the end. */
export function reorderActiveBlocks(v2: TemplatePayloadV2, orderedIds: string[]): TemplatePayloadV2 {
  const next = deepClone(v2);
  const byId = new Map(next.blocks.map((b) => [b.id, b]));
  const ordered: TemplateBlockV2[] = [];
  for (const id of orderedIds) {
    const b = byId.get(id);
    if (b) {
      ordered.push(b);
      byId.delete(id);
    }
  }
  // Append any remaining (archived/trashed/missing-from-list) in original order.
  for (const b of next.blocks) {
    if (byId.has(b.id)) ordered.push(b);
  }
  next.blocks = ordered.map((b, i) => ({ ...b, order_index: i }));
  return next;
}

/** Soft archive / restore. */
export function setBlockArchived(v2: TemplatePayloadV2, blockId: string, archived: boolean): TemplatePayloadV2 {
  return replaceBlock(v2, blockId, {
    archived,
    archived_at: archived ? new Date().toISOString() : null,
  });
}

/** Move to trash / restore from trash. */
export function setBlockTrashed(v2: TemplatePayloadV2, blockId: string, trashed: boolean): TemplatePayloadV2 {
  return replaceBlock(v2, blockId, {
    deleted_at: trashed ? new Date().toISOString() : null,
  });
}

/**
 * Permanently remove a trashed block. Caller must verify the block has no
 * client history (templates don't carry client history, but the safeguard
 * lives at the callsite where assignment links are known).
 */
export function purgeTrashedBlock(v2: TemplatePayloadV2, blockId: string): TemplatePayloadV2 {
  const next = deepClone(v2);
  const target = next.blocks.find((b) => b.id === blockId);
  if (!target || !target.deleted_at) return v2; // refuse to purge non-trashed
  next.blocks = next.blocks.filter((b) => b.id !== blockId);
  return next;
}

/**
 * Return the block IDs that should be expanded into client pl_blocks rows
 * on assignment. Honors archived (skip) and trashed (skip). Caller may
 * further restrict via a selected-blocks set.
 */
export function getAssignableBlockIds(v2: TemplatePayloadV2, opts?: { selectedIds?: string[]; startFromId?: string | null }): string[] {
  const active = getActiveTemplateBlocks(v2);
  let chosen = active;
  if (opts?.selectedIds && opts.selectedIds.length > 0) {
    const set = new Set(opts.selectedIds);
    chosen = active.filter((b) => set.has(b.id));
  }
  if (opts?.startFromId) {
    const idx = chosen.findIndex((b) => b.id === opts.startFromId);
    if (idx > 0) chosen = chosen.slice(idx);
  }
  return chosen.map((b) => b.id);
}

/**
 * Convenience: produce the assignment-shaped block objects that
 * applyTemplateToClient already understands (`weeks_data`, `name`, etc.).
 * Use this from the assignment flow to expand v2 → relational client rows.
 */
export function toAssignmentBlocks(v2: TemplatePayloadV2, opts?: { selectedIds?: string[]; startFromId?: string | null }) {
  const ids = new Set(getAssignableBlockIds(v2, opts));
  return v2.blocks
    .filter((b) => ids.has(b.id))
    .sort((a, b) => a.order_index - b.order_index)
    .map((b) => ({
      id: b.id,
      name: b.name,
      training_focus: b.training_focus ?? b.phase ?? null,
      goal: b.goal ?? null,
      notes: b.notes,
      weeks_data: b.weeks,
    }));
}

/** Counts for the Program overview card. */
export interface TemplateBlockSummary {
  totalBlocks: number;
  activeBlocks: number;
  archivedBlocks: number;
  trashedBlocks: number;
  totalWeeks: number;
  totalDays: number;
  totalRows: number;
  estimatedMinutes: number | null;
}

export function summarizeV2Payload(v2: TemplatePayloadV2): TemplateBlockSummary {
  const active = getActiveTemplateBlocks(v2);
  const archived = getArchivedTemplateBlocks(v2);
  const trashed = getTrashedTemplateBlocks(v2);
  let weeks = 0;
  let days = 0;
  let rows = 0;
  let estimated = 0;
  let anyEstimate = false;
  for (const b of active) {
    weeks += b.weeks?.length ?? 0;
    for (const w of b.weeks ?? []) {
      const ds = w?.days ?? [];
      days += ds.length;
      for (const d of ds) rows += (d?.rows ?? []).length;
    }
    if (typeof b.estimated_minutes === "number") {
      estimated += b.estimated_minutes;
      anyEstimate = true;
    }
  }
  return {
    totalBlocks: v2.blocks.length,
    activeBlocks: active.length,
    archivedBlocks: archived.length,
    trashedBlocks: trashed.length,
    totalWeeks: weeks,
    totalDays: days,
    totalRows: rows,
    estimatedMinutes: anyEstimate ? estimated : null,
  };
}

/** Common phase labels for the Block settings dropdown. Selection is optional. */
export const BLOCK_PHASE_OPTIONS = [
  "Foundation",
  "Hypertrophy",
  "Accumulation",
  "Strength",
  "Intensification",
  "Peak",
  "Taper",
  "Deload",
  "Competition",
] as const;
