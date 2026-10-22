import { supabase } from "@/integrations/supabase/client";

/**
 * How long each feed post holds the crew (community_post_attention): per
 * post, the time it's at least half on screen while the app is showing, how
 * often it comes on screen, and whether Crew closed (or the app went to the
 * background) with it there: an exit. A running tally in the app, sent as
 * what's new (community_attention_add adds it up), batched: 20s after a
 * change, and right away when the app goes to the background or Crew closes.
 * A failed send stays in the tally for the next one. Never your own post or a
 * coach's View as client (the tracker skips those); the server leaves
 * coaches out too.
 */

const db = supabase as any;
const BATCH_MS = 20_000;
/** On screen this much of it counts as on screen (the same as a view). */
export const ATTENTION_VISIBLE = 0.5;
/** One stretch on screen counts for at most this long (a phone left on the table isn't attention). */
export const MAX_STRETCH_MS = 60_000;

type Entry = { ms: number; shows: number; exits: number };
const tally = new Map<string, Entry>();
/** Posts on screen right now, and since when (null while the app is in the background). */
const onScreen = new Map<string, number | null>();
let timer: number | undefined;
let sending = false;
let listening = false;

const entry = (id: string): Entry => {
  let e = tally.get(id);
  if (!e) tally.set(id, (e = { ms: 0, shows: 0, exits: 0 }));
  return e;
};

const now = () => Date.now();

/** Add the time a post has been on screen since its clock started; restart it (or stop it). */
function clock(id: string, restart: boolean) {
  const since = onScreen.get(id);
  if (since != null) entry(id).ms += Math.min(MAX_STRETCH_MS, Math.max(0, now() - since));
  if (onScreen.has(id)) onScreen.set(id, restart ? now() : null);
}

function sendSoon() {
  if (typeof window === "undefined" || timer !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    void sendAttention();
  }, BATCH_MS);
}

/** Send what's new. */
export async function sendAttention(): Promise<void> {
  if (sending) return;
  // what's on screen counts up to now (and keeps counting)
  for (const id of onScreen.keys()) clock(id, onScreen.get(id) != null);
  const rows = [...tally.entries()]
    .filter(([, e]) => e.ms >= 250 || e.shows > 0 || e.exits > 0)
    .slice(0, 100)
    .map(([post_id, e]) => ({ post_id, ms: Math.round(e.ms), shows: e.shows, exits: e.exits }));
  if (!rows.length) return;
  rows.forEach((r) => tally.delete(r.post_id));
  sending = true;
  try {
    const { error } = await db.rpc("community_attention_add", { _rows: rows });
    if (error) throw error;
  } catch {
    // keep it for the next send
    for (const r of rows) {
      const e = entry(r.post_id);
      e.ms += r.ms;
      e.shows += r.shows;
      e.exits += r.exits;
    }
  } finally {
    sending = false;
  }
  if (tally.size) sendSoon();
}

/** The visit ends on whatever's on screen: an exit for each, its time counted. */
export function attentionExit() {
  let any = false;
  for (const id of onScreen.keys()) {
    // only what was being looked at (the app already in the background counted its exit then)
    if (onScreen.get(id) == null) continue;
    clock(id, false);
    entry(id).exits += 1;
    any = true;
  }
  if (any) void sendAttention();
}

/** On screen enough to count: half of it, or (a post taller than the screen) half the screen. */
export function onScreenEnough(e: Pick<IntersectionObserverEntry, "isIntersecting" | "intersectionRect" | "boundingClientRect" | "rootBounds">, viewportH: number): boolean {
  if (!e.isIntersecting) return false;
  const vh = e.rootBounds?.height || viewportH;
  return e.intersectionRect.height >= ATTENTION_VISIBLE * Math.min(e.boundingClientRect.height, vh) && e.intersectionRect.height > 0;
}

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") attentionExit();
    // back in the app: what's still on screen starts counting again
    else for (const id of onScreen.keys()) onScreen.set(id, now());
  });
  window.addEventListener("pagehide", () => attentionExit());
}

/** A post came (at least half) on screen. */
export function attentionShow(postId: string) {
  listen();
  if (onScreen.has(postId)) return;
  entry(postId).shows += 1;
  onScreen.set(postId, document.visibilityState === "hidden" ? null : now());
  sendSoon();
}

/** A post went off screen (or its card went away). */
export function attentionHide(postId: string) {
  if (!onScreen.has(postId)) return;
  clock(postId, false);
  onScreen.delete(postId);
  sendSoon();
}

/** For tests: start over. */
export function resetAttention() {
  tally.clear();
  onScreen.clear();
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
}

/** For tests: what's waiting to go. */
export function pendingAttention(): Record<string, Entry> {
  return Object.fromEntries([...tally.entries()].map(([k, v]) => [k, { ...v }]));
}
