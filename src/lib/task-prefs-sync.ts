/**
 * Cross-device merge for the small Task Manager settings (assignee list,
 * quadrant names/colors). Same 3-way idea as the notes sync, for one value:
 *   local  = what this device has (undefined = never set here)
 *   remote = what the server has (null = never set)
 *   base   = the value this device last saw in agreement with the server
 * Pure, so it is unit-tested without a database.
 */

export type PrefDecision<T> = {
  /** What the device should now hold (undefined = leave it unset). */
  next: T | undefined;
  /** True when `next` differs from what this device had. */
  adopt: boolean;
  /** True when `next` must be uploaded. */
  push: boolean;
};

/**
 * JSON with object keys sorted. Postgres jsonb stores keys in its own order,
 * so the same object read back from the server must still compare equal.
 */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const str = (v: unknown) => (v === undefined || v === null ? null : canonical(v));

export function reconcilePref<T>(args: {
  local: T | undefined;
  remote: T | null;
  base: string | null;
  merge: (local: T, remote: T) => T;
}): PrefDecision<T> {
  const { local, remote, base, merge } = args;
  const L = str(local);
  const R = str(remote);
  if (L === R) return { next: local, adopt: false, push: false };
  if (R === null) return { next: local, adopt: false, push: true }; // server never had one
  if (L === null) return { next: remote as T, adopt: true, push: false }; // this device never set one
  if (base === R) return { next: local, adopt: false, push: true }; // only this device changed it
  if (base === L) return { next: remote as T, adopt: true, push: false }; // only another device changed it
  const merged = merge(local as T, remote as T);
  return { next: merged, adopt: str(merged) !== L, push: str(merged) !== R };
}

export type Assignee = { id: string; name: string };

/** Both devices added people: keep everyone (server order first, then ones only here). */
export function mergeAssignees(local: Assignee[], remote: Assignee[]): Assignee[] {
  const seen = new Set(remote.map((a) => a.id));
  return [...remote, ...local.filter((a) => !seen.has(a.id))];
}

/**
 * Both devices customised quadrants: per quadrant, a customised value beats a
 * default one; if both customised the same quadrant, this device's wins.
 */
export function mergeQuadrantStyles<S extends Record<string, unknown>>(
  local: S,
  remote: S,
  defaults: S,
): S {
  const out: Record<string, unknown> = { ...remote };
  for (const key of Object.keys(local)) {
    const isDefault = canonical(local[key]) === canonical(defaults[key]);
    if (!isDefault || !(key in remote)) out[key] = local[key];
  }
  return out as S;
}
