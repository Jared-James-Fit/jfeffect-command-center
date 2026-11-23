/**
 * The coach's program editor (StructureCanvas) works on a day's rows as
 * exercises: a row and the back-off rows that hang off it are one exercise
 * (a "unit"), dragged, copied, swapped and removed together, the way the
 * member builder's set groups are (program-plan.ts). Pure, tested
 * (program-editor-rows.test.ts).
 *
 * A row follows the row above into its exercise when it's the same exercise
 * and either worked out from it (a % of the top set or of the previous set)
 * or called a back-off by the coach ("Back-off", "Primary Squat Backoff"):
 * the same rule the logger and pl_day_set_names use to name a top set and its
 * back-offs, so what the editor groups is what the athlete sees as one lift.
 *
 * A change made in one week can be repeated in the later weeks laid out the
 * same (`laidOutTheSame` / `replayRowOp`): each week keeps its own numbers,
 * only the same move, copy, swap or removal is made there.
 */

export type EditorRow = Record<string, any>;

/** A coach's word for a back-off anywhere in a row's label. */
export const BACKOFF_WORD = /back\s*-?\s*offs?\b/i;

/** Who the row is, for "same exercise" checks: its library id, else its typed name. */
export function exerciseKeyOf(row: EditorRow | null | undefined): string {
  if (!row) return "";
  if (row.exercise_id) return `id:${row.exercise_id}`;
  const name = String(row.exercise_name_override ?? "").trim().toLowerCase();
  return name ? `name:${name}` : "";
}

/** A % of the top set (or the previous set): its weight comes from the row above. */
export function isLinkedLoad(row: EditorRow | null | undefined): boolean {
  return !!row && (row.percentage_basis === "top_set" || row.percentage_basis === "prev_set");
}

/** `row` belongs to the exercise `head` starts: the same exercise, worked out from it or called a back-off. */
export function followsHead(row: EditorRow | null | undefined, head: EditorRow | null | undefined): boolean {
  if (!row || !head) return false;
  const k = exerciseKeyOf(row);
  if (!k || k !== exerciseKeyOf(head)) return false;
  if (isLinkedLoad(row)) return true;
  return BACKOFF_WORD.test(String(row.purpose_label ?? ""));
}

/** One exercise: rows[start] and the back-offs after it, up to (not including) `end`. */
export type RowUnit = { start: number; end: number };

export function rowUnits(rows: EditorRow[]): RowUnit[] {
  const out: RowUnit[] = [];
  for (let i = 0; i < rows.length; i++) {
    const last = out[out.length - 1];
    if (last && followsHead(rows[i], rows[last.start])) last.end = i + 1;
    else out.push({ start: i, end: i + 1 });
  }
  return out;
}

/** The unit a row index sits in. */
export function unitOfRow(units: RowUnit[], rowIdx: number): number {
  return units.findIndex((u) => rowIdx >= u.start && rowIdx < u.end);
}

/** A copy that is a new row: no saved id, so it's inserted, never an update of the row it came from. */
export function freshCopy(row: EditorRow): EditorRow {
  const c: EditorRow = JSON.parse(JSON.stringify(row ?? {}));
  const src = c._dbId ?? c.id ?? c._sourceDbId ?? null;
  delete c._dbId;
  delete c.id;
  delete c.sort_order;
  delete c[ROW_KEY];
  // set blocks (pl_exercise_blocks) on a saved row are cloned onto the copy,
  // the same way Copy / Paste does it (program-builder-clipboard.ts)
  if (src) c._sourceDbId = src;
  else delete c._sourceDbId;
  return c;
}

/** Rows in order with their sort_order matching where they sit. */
export function renumberRows(rows: EditorRow[]): EditorRow[] {
  return rows.map((r, i) => (r?.sort_order === i ? r : { ...r, sort_order: i }));
}

/** A label for a back-off of an exercise whose label is `headLabel` ("Primary Squat" → "Primary Squat Backoff"). */
export function backoffLabelFor(headLabel: string | null | undefined): string {
  const l = String(headLabel ?? "").trim();
  if (!l || /^assistance$/i.test(l) || BACKOFF_WORD.test(l)) return "Backoff";
  return `${l} Backoff`;
}

/** The rows a new back-off starts from: two sets at 90% of the top set, its reps, rest and tempo. */
export function backoffRow(head: EditorRow, label: string): EditorRow {
  return {
    exercise_id: head.exercise_id ?? null,
    exercise_name_override: head.exercise_name_override ?? null,
    sets: 2,
    reps_text: head.reps_text ?? "",
    rpe: "",
    rir: "",
    percentage: 90,
    percentage_basis: "top_set",
    load_kg: null,
    load_lb: null,
    load_unit: head.load_unit ?? null,
    load_round: null,
    manual_override: false,
    rest_seconds: head.rest_seconds ?? null,
    rest_seconds_override: head.rest_seconds_override ?? null,
    tempo: head.tempo ?? "",
    time_profile: head.time_profile ?? "accessory_compound",
    movement_family: head.movement_family ?? null,
    tracking_type: "reps_weight",
    measurement_type: "reps",
    notes: "",
    purpose_label: label,
  };
}

/** Whether an exercise can take back-offs: it's lifted for reps with a weight. */
export function takesBackoffs(head: EditorRow | null | undefined): boolean {
  if (!head || !exerciseKeyOf(head)) return false;
  const t = head.tracking_type;
  if (t === "time" || t === "reps" || head.measurement_type === "time") return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Edits made to a day's rows                                         */
/* ------------------------------------------------------------------ */

export type RowOp =
  /** move exercise `from` so it ends up at exercise position `to` (positions after the move) */
  | { kind: "move"; from: number; to: number }
  /** copy exercise `unit` (with its back-offs) right under it */
  | { kind: "duplicate"; unit: number }
  /** add back-off sets to exercise `unit` */
  | { kind: "backoff"; unit: number; label: string }
  /** remove exercise `unit` with its back-offs */
  | { kind: "remove"; unit: number }
  /** swap exercise `unit` (and its back-offs) for another, keeping every number */
  | { kind: "swap"; unit: number; exerciseId: string | null; name: string | null }
  /** add a new exercise at exercise position `at` (0 … the number of exercises) */
  | { kind: "add"; at: number; row: EditorRow }
  /** copy one row (a back-off) right under itself, inside its exercise */
  | { kind: "copyRow"; row: number }
  /** remove one row (a back-off) from its exercise */
  | { kind: "removeRow"; row: number };

export type RowOpResult = {
  rows: EditorRow[];
  /** the rows this change created, by index in `rows` */
  added: number[];
};

/**
 * Makes `op` on a day's rows. Returns null when the op doesn't fit them (an
 * exercise that isn't there). Rows it doesn't touch keep their object
 * identity (the editor keys its cards by it); sort_order is renumbered.
 */
export function applyRowOp(rows: EditorRow[], op: RowOp): RowOpResult | null {
  const units = rowUnits(rows);
  const slice = (u: RowUnit) => rows.slice(u.start, u.end);
  switch (op.kind) {
    case "move": {
      const from = units[op.from];
      if (!from || op.to < 0 || op.to >= units.length || op.from === op.to) return null;
      const order = units.map((_, i) => i);
      const [m] = order.splice(op.from, 1);
      order.splice(op.to, 0, m);
      return { rows: renumberRows(order.flatMap((i) => slice(units[i]))), added: [] };
    }
    case "duplicate": {
      const u = units[op.unit];
      if (!u) return null;
      const copies = slice(u).map(freshCopy);
      const next = [...rows.slice(0, u.end), ...copies, ...rows.slice(u.end)];
      return { rows: renumberRows(next), added: copies.map((_, k) => u.end + k) };
    }
    case "backoff": {
      const u = units[op.unit];
      if (!u || !takesBackoffs(rows[u.start])) return null;
      // a second back-off group starts as a copy of the last one; the first from the top set
      const last = u.end - 1 > u.start ? rows[u.end - 1] : null;
      const row = last ? freshCopy(last) : backoffRow(rows[u.start], op.label);
      const next = [...rows.slice(0, u.end), row, ...rows.slice(u.end)];
      return { rows: renumberRows(next), added: [u.end] };
    }
    case "remove": {
      const u = units[op.unit];
      if (!u) return null;
      return { rows: renumberRows([...rows.slice(0, u.start), ...rows.slice(u.end)]), added: [] };
    }
    case "swap": {
      const u = units[op.unit];
      if (!u) return null;
      const next = rows.map((r, i) =>
        i >= u.start && i < u.end ? { ...r, exercise_id: op.exerciseId, exercise_name_override: op.name } : r,
      );
      return { rows: next, added: [] };
    }
    case "copyRow": {
      const r = rows[op.row];
      if (!r) return null;
      const next = [...rows.slice(0, op.row + 1), freshCopy(r), ...rows.slice(op.row + 1)];
      return { rows: renumberRows(next), added: [op.row + 1] };
    }
    case "removeRow": {
      if (!rows[op.row]) return null;
      return { rows: renumberRows(rows.filter((_, i) => i !== op.row)), added: [] };
    }
    case "add": {
      if (op.at < 0 || op.at > units.length) return null;
      const at = op.at === units.length ? rows.length : units[op.at].start;
      const row = freshCopy(op.row);
      const next = [...rows.slice(0, at), row, ...rows.slice(at)];
      return { rows: renumberRows(next), added: [at] };
    }
  }
}

/** A day's layout: its exercises in order and how many rows each has. Two days laid out the same take the same edit. */
export function layoutOf(rows: EditorRow[]): string {
  return rowUnits(rows)
    .map((u) => `${exerciseKeyOf(rows[u.start]) || "?"}*${u.end - u.start}`)
    .join("|");
}

/* ------------------------------------------------------------------ */
/*  Repeating an edit in later weeks                                   */
/* ------------------------------------------------------------------ */

export type EditorWeek = { week_index?: number | null; days?: EditorRow[] | null } & Record<string, any>;

function dayIn(week: EditorWeek | undefined, dayIndex: number): number {
  return (week?.days ?? []).findIndex((d: any) => Number(d?.day_index) === dayIndex);
}

/**
 * The weeks after `fromWeek` whose day `dayIndex` is laid out like `layout`
 * (the day as it was before the edit), so the same edit lands on the same
 * exercise there. `skip` leaves a day out (a workout already trained).
 */
export function laidOutTheSame(
  weeks: EditorWeek[],
  fromWeek: number,
  dayIndex: number,
  layout: string,
  skip?: (day: EditorRow) => boolean,
): number[] {
  const out: number[] = [];
  for (let j = fromWeek + 1; j < weeks.length; j++) {
    const di = dayIn(weeks[j], dayIndex);
    if (di < 0) continue;
    const day = weeks[j].days![di];
    if (skip?.(day)) continue;
    if (layoutOf(day.rows ?? []) === layout) out.push(j);
  }
  return out;
}

/**
 * The same edit in each of `targets`' day `dayIndex`, made on that week's own
 * rows (its own numbers kept). A week no longer laid out like `layout` is
 * left as it is. Returns the weeks and which ones changed.
 */
export function replayRowOp(
  weeks: EditorWeek[],
  targets: number[],
  dayIndex: number,
  layout: string,
  op: RowOp,
): { weeks: EditorWeek[]; changed: number[] } {
  const hit = new Set(targets);
  const changed: number[] = [];
  const next = weeks.map((w, j) => {
    if (!hit.has(j)) return w;
    const di = dayIn(w, dayIndex);
    if (di < 0) return w;
    const day = w.days![di];
    if (layoutOf(day.rows ?? []) !== layout) return w;
    const res = applyRowOp(day.rows ?? [], op);
    if (!res) return w;
    changed.push(j);
    const days = [...(w.days ?? [])];
    days[di] = { ...day, rows: res.rows };
    return { ...w, days };
  });
  return { weeks: next, changed };
}

/** "week 4", "weeks 4–8", "weeks 4–6, 8 and 10" from week numbers. */
export function weekNumbersWords(numbers: number[]): string {
  const g = [...new Set(numbers)].sort((a, b) => a - b);
  if (!g.length) return "";
  if (g.length === 1) return `week ${g[0]}`;
  const runs: string[] = [];
  let lo = g[0];
  let prev = g[0];
  for (const n of [...g.slice(1), Infinity]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    runs.push(lo === prev ? String(lo) : `${lo}–${prev}`);
    lo = prev = n;
  }
  return `weeks ${runs.length === 1 ? runs[0] : `${runs.slice(0, -1).join(", ")} and ${runs[runs.length - 1]}`}`;
}

/** What an edit did, in a few words for its toast ("Moved Competition Squat"). */
export function rowOpWords(op: RowOp, name: string): string {
  const n = name || "the exercise";
  switch (op.kind) {
    case "move": return `Moved ${n}`;
    case "duplicate": return `Duplicated ${n}`;
    case "backoff": return `Added back-off sets to ${n}`;
    case "remove": return `Removed ${n}`;
    case "swap": return `Swapped to ${op.name || n}`;
    case "add": return `Added ${n}`;
    case "copyRow": return `Duplicated a back-off of ${n}`;
    case "removeRow": return `Removed a back-off of ${n}`;
  }
}

/* ------------------------------------------------------------------ */
/*  A back-off's weight, worked out from its top set                   */
/* ------------------------------------------------------------------ */

/** The step a % of the top set rounds to, as the logger rounds it: "fine" 2.5 lb / 1 kg, else 5 lb / 2.5 kg. */
export function backoffStep(unit: "kg" | "lb", round: string | null | undefined): number {
  if (round === "fine") return unit === "kg" ? 1 : 2.5;
  return unit === "kg" ? 2.5 : 5;
}

/** `pct`% of a `top` load, rounded like the logger rounds a back-off. */
export function backoffLoad(top: number, pct: number, unit: "kg" | "lb", round: string | null | undefined): number | null {
  if (!Number.isFinite(top) || top <= 0 || !Number.isFinite(pct) || pct <= 0) return null;
  const step = backoffStep(unit, round);
  const v = Math.round((top * pct) / 100 / step) * step;
  return Math.round(v * 100) / 100;
}

/* ------------------------------------------------------------------ */
/*  Keys that follow a row, not a position                             */
/* ------------------------------------------------------------------ */

/**
 * The editor copies its whole payload on every change (normalizeTemplatePayload),
 * so a row's key lives on the row itself: `_k`, written when the editor moves,
 * copies or adds rows, never saved (`withoutRowKeys`; the block editor saves
 * only ROW_FIELDS). A row without one (never touched this visit) keeps the key
 * of the position it's in, unless a row that has one claims it.
 */
export const ROW_KEY = "_k";

export function rowKeysOf(rows: EditorRow[], prevKeys: string[], fresh: () => string): string[] {
  const out: (string | undefined)[] = new Array(rows.length);
  const used = new Set<string>();
  rows.forEach((r, i) => {
    const k = typeof r?.[ROW_KEY] === "string" ? (r[ROW_KEY] as string) : null;
    if (k && !used.has(k)) {
      out[i] = k;
      used.add(k);
    }
  });
  rows.forEach((_, i) => {
    if (out[i]) return;
    const p = prevKeys[i];
    const k = p && !used.has(p) ? p : fresh();
    out[i] = k;
    used.add(k);
  });
  return out as string[];
}

/** Every row carrying the key it's shown under (a new object only where that changes). */
export function stampRowKeys(rows: EditorRow[], keys: string[]): EditorRow[] {
  return rows.map((r, i) => (r?.[ROW_KEY] === keys[i] ? r : { ...r, [ROW_KEY]: keys[i] }));
}

/** A payload as saved: no editor keys anywhere in it. */
export function withoutRowKeys<T>(payload: T): T {
  if (payload == null) return payload;
  return JSON.parse(JSON.stringify(payload, (k, v) => (k === ROW_KEY ? undefined : v)));
}
