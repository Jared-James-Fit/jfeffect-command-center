/**
 * Cross-device sync for Task Manager Quick Notes.
 *
 * The device keeps its notes in localStorage (instant load, offline buffer,
 * and the exact format older builds wrote). This engine mirrors them to the
 * `task_quick_notes` table and merges what other devices changed.
 *
 * Merge model — a 3-way merge per note id:
 *   local  = this device's note
 *   remote = what the server has now
 *   base   = what this device last saw in agreement with the server
 * Only local changed → push it. Only remote changed → adopt it. Both changed
 * → keep the server's version and save this device's text as a "(conflict
 * copy)" note, so no typed text is ever lost. Pushes carry the server version
 * they were based on, so a stale device can't overwrite a newer edit.
 *
 * Pure of React and Supabase (an `api` is injected) so it is unit-tested with
 * an in-memory server.
 */

export type SyncNote = { id: string; title: string; body: string; updatedAt: number; deletedAt?: number };

export type NoteRow = {
  id: string;
  title: string;
  body: string;
  edited_at: string;
  deleted_at: string | null;
  version: number;
};

/** What this device last saw in agreement with the server, per note id. */
export type Base = Record<string, { sig: string; version: number }>;

export type SyncStatus = "idle" | "syncing" | "offline" | "unavailable";

export interface NotesApi {
  fetch(): Promise<NoteRow[]>;
  /** Inserts a new note. Resolves to null if a note with that id already exists. */
  insert(note: SyncNote): Promise<NoteRow | null>;
  /** Updates only if the stored version matches. Resolves to null on mismatch. */
  update(note: SyncNote, expectVersion: number): Promise<NoteRow | null>;
  /** Deletes only if the stored version matches. Resolves to false on mismatch. */
  remove(id: string, expectVersion: number): Promise<boolean>;
}

// ------------------------------------------------------------------ helpers

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Database id for a local note id. Real UUIDs pass through. Older notes used
 * `${Date.now()}-${Math.random()}` ids, which are mapped to a stable UUID
 * (same input → same output) so re-running an import can never duplicate notes.
 */
export function toSyncId(id: string): string {
  if (UUID_RE.test(id)) return id.toLowerCase();
  // cyrb128: small, deterministic 128-bit string hash.
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < id.length; i++) {
    const k = id.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  const hex = [h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
  const variant = "89ab"[parseInt(hex[16], 16) & 3];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const noteSig = (n: SyncNote) => JSON.stringify([n.title, n.body, n.updatedAt, n.deletedAt ?? null]);
const isBlank = (n: SyncNote) => !n.title.trim() && !n.body.trim();
const sameText = (a: SyncNote, b: SyncNote) => a.title === b.title && a.body === b.body;

export function rowToNote(r: NoteRow): SyncNote {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    updatedAt: Date.parse(r.edited_at),
    ...(r.deleted_at ? { deletedAt: Date.parse(r.deleted_at) } : {}),
  };
}

export function noteToRow(n: SyncNote) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    edited_at: new Date(n.updatedAt).toISOString(),
    deleted_at: n.deletedAt ? new Date(n.deletedAt).toISOString() : null,
  };
}

/** Gives old non-UUID ids their stable database id. Returns the same array when nothing changes. */
export function normalizeIds<T extends { id: string }>(notes: T[]): T[] {
  if (notes.every((n) => UUID_RE.test(n.id) && n.id === n.id.toLowerCase())) return notes;
  return notes.map((n) => ({ ...n, id: toSyncId(n.id) }));
}

// --------------------------------------------------------------- reconcile

export type Plan = {
  /** The local notes after applying remote changes. */
  next: SyncNote[];
  /** Base entries for everything now known to match the server. */
  base: Base;
  insert: SyncNote[];
  update: { note: SyncNote; expectVersion: number }[];
  remove: { id: string; expectVersion: number }[];
};

export function reconcile(
  local: SyncNote[],
  remote: NoteRow[],
  base: Base,
  newId: () => string,
  /**
   * False when this device's local copy couldn't be read reliably. A note that
   * is "missing locally" then means "unknown", never "deleted here", so no
   * delete is ever sent to the server.
   */
  trustLocalDeletes = true,
): Plan {
  const L = new Map(local.map((n) => [n.id, n]));
  const R = new Map(remote.map((r) => [r.id, r]));
  const next: SyncNote[] = [];
  const nextBase: Base = {};
  const plan: Plan = { next, base: nextBase, insert: [], update: [], remove: [] };

  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id);
    const r = R.get(id);
    const b = base[id];

    if (l && r) {
      const rn = rowToNote(r);
      const sigL = noteSig(l);
      const sigR = noteSig(rn);
      if (sigL === sigR) {
        next.push(l);
        nextBase[id] = { sig: sigR, version: r.version };
      } else if (b && b.sig === sigR) {
        // Only this device changed it.
        next.push(l);
        nextBase[id] = { sig: sigR, version: r.version };
        plan.update.push({ note: l, expectVersion: r.version });
      } else if (b && b.sig === sigL) {
        // Only another device changed it.
        next.push(rn);
        nextBase[id] = { sig: sigR, version: r.version };
      } else {
        // Both changed: the server's version wins, our text is kept as a copy.
        next.push(rn);
        nextBase[id] = { sig: sigR, version: r.version };
        if (!sameText(l, rn) && !isBlank(l)) {
          const copy: SyncNote = {
            id: newId(),
            title: l.title ? `${l.title} (conflict copy)` : "",
            body: l.body,
            updatedAt: l.updatedAt,
          };
          next.push(copy);
          plan.insert.push(copy);
        }
      }
    } else if (l && !r) {
      if (b && b.sig === noteSig(l)) {
        // Deleted for good on another device, unchanged here: drop it.
      } else {
        // New here, or edited here after another device deleted it: keep it.
        next.push(l);
        if (!isBlank(l)) plan.insert.push(l);
      }
    } else if (!l && r) {
      const rn = rowToNote(r);
      if (trustLocalDeletes && b && b.sig === noteSig(rn)) {
        // Deleted for good here, unchanged elsewhere: delete it on the server.
        plan.remove.push({ id, expectVersion: r.version });
        nextBase[id] = b; // kept until the delete is confirmed
      } else {
        next.push(rn); // new from another device (or changed after we deleted it)
        nextBase[id] = { sig: noteSig(rn), version: r.version };
      }
    }
  }
  return plan;
}

// ------------------------------------------------------------------ engine

export interface NotesSync {
  /** Fetch, merge and push. Never rejects. */
  fullSync(): Promise<void>;
  /** Push local edits without refetching. Never rejects. */
  pushLocal(): Promise<void>;
  /** Handle a realtime payload (undefined = "something may have changed"). */
  onRemoteEvent(payload?: unknown): void;
  status(): SyncStatus;
  dispose(): void;
}

export function createNotesSync(opts: {
  api: NotesApi;
  loadBase: () => Base;
  saveBase: (b: Base) => void;
  getLocal: () => SyncNote[];
  setLocal: (next: SyncNote[]) => void;
  newId?: () => string;
  onStatus?: (s: SyncStatus) => void;
  /** True when the error means the table doesn't exist yet (migration not applied). */
  isUnavailable?: (e: unknown) => boolean;
  /** False when the local copy couldn't be read — disables delete propagation. */
  trustLocalDeletes?: boolean;
  /** Delay before retrying after a network failure. */
  retryMs?: number;
}): NotesSync {
  const newId = opts.newId ?? (() => toSyncId(`${Date.now()}-${Math.random()}`));
  let base = opts.loadBase();
  let chain: Promise<unknown> = Promise.resolve();
  let synced = false;
  let disposed = false;
  let current: SyncStatus = "idle";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const setStatus = (s: SyncStatus) => {
    if (s === current) return;
    current = s;
    opts.onStatus?.(s);
  };
  const enqueue = (fn: () => Promise<void>) => {
    const run = chain.then(fn, fn).catch((e) => {
      if (opts.isUnavailable?.(e)) { setStatus("unavailable"); return; }
      setStatus("offline");
      // Local edits stay safe on the device; try again shortly.
      clearTimeout(retryTimer);
      if (!disposed) retryTimer = setTimeout(() => { void enqueue(doFullSync); }, opts.retryMs ?? 15000);
    });
    chain = run;
    return run;
  };
  const dead = () => disposed || current === "unavailable";

  type Ops = Pick<Plan, "insert" | "update" | "remove">;
  /** Runs the writes. Resolves true when any was rejected as stale (needs a resync). */
  async function push(ops: Ops): Promise<boolean> {
    let stale = false;
    try {
      for (const n of ops.insert) {
        const row = await opts.api.insert(n);
        if (row) base[n.id] = { sig: noteSig(n), version: row.version };
        else stale = true;
      }
      for (const u of ops.update) {
        const row = await opts.api.update(u.note, u.expectVersion);
        if (row) base[u.note.id] = { sig: noteSig(u.note), version: row.version };
        else stale = true;
      }
      for (const r of ops.remove) {
        if (await opts.api.remove(r.id, r.expectVersion)) delete base[r.id];
        else stale = true;
      }
    } finally {
      opts.saveBase(base);
    }
    return stale;
  }

  async function doFullSync() {
    if (dead()) return;
    setStatus("syncing");
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await opts.api.fetch();
      // Merge and apply in one synchronous step, so typing can't slip between.
      const plan = reconcile(opts.getLocal(), remote, base, newId, opts.trustLocalDeletes ?? true);
      base = plan.base;
      opts.setLocal(plan.next);
      opts.saveBase(base);
      synced = true;
      if (!(await push(plan))) break;
    }
    setStatus("idle");
  }

  async function doPushLocal() {
    if (dead()) return;
    if (!synced) return doFullSync();
    const ops: Ops = { insert: [], update: [], remove: [] };
    const seen = new Set<string>();
    for (const n of opts.getLocal()) {
      seen.add(n.id);
      const b = base[n.id];
      if (!b) { if (!isBlank(n)) ops.insert.push(n); }
      else if (noteSig(n) !== b.sig) ops.update.push({ note: n, expectVersion: b.version });
    }
    if (opts.trustLocalDeletes ?? true) {
      for (const id of Object.keys(base)) {
        if (!seen.has(id)) ops.remove.push({ id, expectVersion: base[id].version });
      }
    }
    if (!ops.insert.length && !ops.update.length && !ops.remove.length) return;
    setStatus("syncing");
    const stale = await push(ops);
    if (stale) return doFullSync();
    setStatus("idle");
  }

  return {
    fullSync: () => enqueue(doFullSync),
    pushLocal: () => enqueue(doPushLocal),
    onRemoteEvent(payload) {
      const p = payload as { eventType?: string; new?: { id?: string; version?: number }; old?: { id?: string } } | undefined;
      if (p?.eventType === "DELETE") {
        if (p.old?.id && !base[p.old.id]) return; // we already know it's gone
      } else if (p?.new?.id) {
        const b = base[p.new.id];
        if (b && typeof p.new.version === "number" && b.version >= p.new.version) return; // our own write
      }
      if (dead()) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void enqueue(doFullSync); }, 250);
    },
    status: () => current,
    dispose() { disposed = true; clearTimeout(timer); clearTimeout(retryTimer); },
  };
}
