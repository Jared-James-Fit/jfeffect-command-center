/**
 * A setup change that couldn't be sent yet (no signal at the rack, the app
 * closed mid-save) waits here, on the phone, until it goes through: the
 * setup sheet puts the newest version in before it tries (and whenever the
 * app goes to the background with a change still waiting), takes it out once
 * the server has it, and the outbox sends whatever's left when the phone is
 * back online or the app is opened again, even with the sheet closed.
 *
 * One entry per athlete, exercise and equipment, newest wins. Entries older
 * than a week, or ones the server refuses for good (the athlete isn't theirs
 * any more, the equipment or exercise is gone), are let go. Cleared on
 * sign-out (clearAllAppCaches). The parse is pure and tested.
 */
import { cleanSettings, PHOTOS_MAX, type Setting } from "./equipment";

export type OutboxEntry = {
  clientId: string;
  exerciseId: string;
  equipmentId: string | null;
  settings: Setting[];
  notes: string | null;
  photos: string[];
  /** When it was put in. */
  at: number;
};

const PREFIX = "jf-setup-outbox:v1:";
export const OUTBOX_KEEP_MS = 7 * 24 * 60 * 60_000;

export function outboxKey(clientId: string, exerciseId: string, equipmentId: string | null): string {
  return `${PREFIX}${clientId}:${exerciseId}:${equipmentId ?? "none"}`;
}

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function parseOutbox(raw: string | null, now: number): OutboxEntry | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as Partial<OutboxEntry>;
    if (!e || typeof e.clientId !== "string" || typeof e.exerciseId !== "string") return null;
    if (typeof e.at !== "number" || now - e.at > OUTBOX_KEEP_MS) return null;
    return {
      clientId: e.clientId,
      exerciseId: e.exerciseId,
      equipmentId: typeof e.equipmentId === "string" ? e.equipmentId : null,
      settings: cleanSettings(e.settings),
      notes: typeof e.notes === "string" && e.notes.trim() ? e.notes : null,
      photos: Array.isArray(e.photos) ? e.photos.filter((p): p is string => typeof p === "string" && !!p).slice(0, PHOTOS_MAX) : [],
      at: e.at,
    };
  } catch {
    return null;
  }
}

export function putOutbox(entry: OutboxEntry): void {
  try {
    store()?.setItem(outboxKey(entry.clientId, entry.exerciseId, entry.equipmentId), JSON.stringify(entry));
  } catch {
    /* private mode / full: the change just isn't kept */
  }
}

export function readOutbox(key: string, now = Date.now()): OutboxEntry | null {
  let raw: string | null = null;
  try {
    raw = store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
  const e = parseOutbox(raw, now);
  if (raw && !e) dropOutbox(key);
  return e;
}

/** Take an entry out, only if it's still the one that was sent (a newer one stays). */
export function dropOutbox(key: string, sentAt?: number): void {
  try {
    const s = store();
    if (!s) return;
    if (sentAt != null) {
      const e = parseOutbox(s.getItem(key), Date.now());
      if (e && e.at !== sentAt) return;
    }
    s.removeItem(key);
  } catch {
    /* nothing to drop */
  }
}

/** Everything waiting for this athlete (all athletes with null). */
export function listOutbox(clientId: string | null, now = Date.now()): Array<{ key: string; entry: OutboxEntry }> {
  const s = store();
  if (!s) return [];
  const out: Array<{ key: string; entry: OutboxEntry }> = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const entry = parseOutbox(s.getItem(key), now);
      if (entry && (clientId == null || entry.clientId === clientId)) out.push({ key, entry });
    }
  } catch {
    return out;
  }
  return out;
}

export function clearSetupOutbox(): void {
  for (const { key } of listOutbox(null, 0)) dropOutbox(key);
  // entries too old to parse
  const s = store();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    /* best effort */
  }
}

/** A refusal that won't change on a retry (not theirs any more, gone, invalid): the entry is let go. */
export function permanentRefusal(e: unknown): boolean {
  const code = String((e as any)?.code ?? "");
  const msg = String((e as any)?.message ?? "");
  if (["42501", "P0002", "22023", "23514"].includes(code)) return true;
  return /isn't theirs|can't change this athlete|isn't in the library|too long|4 photos/i.test(msg);
}

let flushing: Promise<number> | null = null;

/**
 * Send what's waiting for this athlete, oldest first, one at a time. Returns
 * how many went. A refusal for good lets the entry go; anything else (no
 * signal) leaves it for next time.
 */
export function flushOutbox(clientId: string, send: (e: OutboxEntry) => Promise<void>): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    const list = listOutbox(clientId).sort((a, b) => a.entry.at - b.entry.at);
    for (const { key, entry } of list) {
      try {
        await send(entry);
        dropOutbox(key, entry.at);
        sent++;
      } catch (e) {
        if (permanentRefusal(e)) dropOutbox(key, entry.at);
        else break; // no signal: the rest waits too
      }
    }
    return sent;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
