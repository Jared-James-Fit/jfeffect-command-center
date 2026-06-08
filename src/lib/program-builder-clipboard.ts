import { useEffect, useState } from "react";

// Module-level clipboard for exercise rows (and potentially days/weeks later).
// Survives across components without prop drilling.
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
  // Deep-clone and strip identity-ish fields so they paste cleanly elsewhere.
  const cleaned = JSON.parse(JSON.stringify(rows)).map((r: any) => {
    const { id, sort_order, ...rest } = r ?? {};
    return rest;
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