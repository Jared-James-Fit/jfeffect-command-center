import { useEffect, useState } from "react";

// Module-level clipboard for exercise rows (and potentially days/weeks later).
// Survives across components without prop drilling.
//
// Block preservation contract:
//   When the source row has a persisted `_dbId`, we keep it on the
//   clipboard payload as `_sourceDbId`. The paste site uses that to
//   call `cloneBlocksForRowsFn` after `applyPayloadDiff` has inserted
//   the new rows, so any `pl_exercise_blocks` (including ascending
//   set rows and drop stages) attached to the source row land on the
//   new row with `reference_block_id` remapped. The `_sourceDbId` is
//   cleared by the paste site after the first successful clone, so
//   re-clicking Paste on the same materialized rows cannot duplicate
//   blocks.
export type RowClip = {
  kind: "rows";
  rows: any[];
};

let _clip: RowClip | null = null;
const _subs = new Set<() => void>();

export function getClip(): RowClip | null { return _clip; }

export function setClip(next: RowClip | null) {
  _clip = next;
  _subs.forEach((f) => f());
}

export function copyRows(rows: any[]) {
  if (!rows || rows.length === 0) return;
  // Deep-clone and strip identity-ish fields so they paste cleanly
  // elsewhere. Promote `_dbId`/`id` to `_sourceDbId` so the paste path
  // can clone any attached blocks server-side; never carry the source
  // primary key into the destination payload (that would make the
  // applyPayloadDiff treat the paste as an update of the source).
  const cleaned = JSON.parse(JSON.stringify(rows)).map((r: any) => {
    const src = r?._dbId ?? r?.id ?? null;
    const { id, _dbId, sort_order, ...rest } = r ?? {};
    return { ...rest, _sourceDbId: src };
  });
  setClip({ kind: "rows", rows: cleaned });
}

export function useClip(): RowClip | null {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    _subs.add(f);
    return () => { _subs.delete(f); };
  }, []);
  return _clip;
}