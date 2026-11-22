/**
 * A lift video sent in the coach chat, read like a set video (see
 * chat-lift.ts for which set it is, and the migration
 * 20270504090000_lift_videos_in_chat.sql for what's stored).
 *
 * Runs on whichever device has the video to hand: the athlete's phone right
 * after it's sent (from the very file when it went as it was, else from its
 * link), or the coach's device when the athlete's phone didn't get to it
 * (the coach opening the chat within two days, or tapping "Analyze bar
 * path"). One at a time, after the chat's own uploads, never twice for one
 * video on one device; a video whose context names no barbell lift is left
 * alone (a question, a machine, the dog), and remembered so it isn't looked
 * at again.
 */
import { supabase } from "@/integrations/supabase/client";
import { analyzeVideo } from "@/lib/lift-analysis/run";
import { guideLift, repDirection } from "@/lib/lift-analysis/exercise";
import {
  captionNamesLift,
  chatRunKey,
  LOGGED_AFTER_MIN,
  LOGGED_WINDOW_MIN,
  matchChatLift,
  type ChatLiftMatch,
  type ChatLiftSet,
} from "@/lib/lift-analysis/chat-lift";
import { proposalSuggestions, saveAnalysis, saveNotRead } from "@/lib/lift-analysis/queries";
import { announceChanged, setRunning } from "@/lib/lift-analysis/store";
import { ENGINE_VERSION } from "@/lib/lift-analysis/analyze";

const db = supabase as any;

export type ChatLiftJob = {
  messageId: string;
  storagePath: string;
  clientId: string;
  caption: string;
  sentAt: string;
  /** The file itself (sent as it was) or its signed link; signed here when missing. */
  source?: Blob | string;
  by: "athlete" | "coach";
};

export type ChatLiftOutcome =
  | "linked"
  | "suggested"
  | "workout"
  | "unlinked"
  | "not_a_lift"
  | "failed";

const TRIED_KEY = "jf-chat-lift-tried-v1";

function tried(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TRIED_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
export function wasTried(path: string): boolean {
  return !!tried()[path];
}
function markTried(path: string) {
  try {
    const t = tried();
    t[path] = Date.now();
    const keys = Object.keys(t);
    for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete t[k];
    localStorage.setItem(TRIED_KEY, JSON.stringify(t));
  } catch {
    /* no storage: tried once this visit */
  }
}

/**
 * The athlete's sets around when the video was sent: everything logged in the
 * two hours before (and a couple of minutes after), and every planned set of
 * those workouts, with each exercise's name.
 */
export async function setsAround(clientId: string, sentAt: string): Promise<ChatLiftSet[]> {
  const t = Date.parse(sentAt);
  const from = new Date(t - LOGGED_WINDOW_MIN * 60_000).toISOString();
  const to = new Date(t + LOGGED_AFTER_MIN * 60_000).toISOString();
  const { data: logged, error } = await db
    .from("pl_row_results")
    .select("row_id, set_index, completed_at, updated_at, actual_reps")
    .eq("client_id", clientId)
    .gte("updated_at", from)
    .lte("updated_at", to)
    .limit(300);
  if (error || !logged?.length) return [];
  const rowIds = [...new Set((logged as any[]).map((r) => r.row_id))];
  const { data: rows } = await db
    .from("pl_exercise_rows")
    .select("id, day_id")
    .in("id", rowIds.slice(0, 150));
  const dayIds = [...new Set(((rows ?? []) as any[]).map((r) => r.day_id).filter(Boolean))];
  if (!dayIds.length) return [];
  const { data: dayRows } = await db
    .from("pl_exercise_rows")
    .select("id, day_id, sets, exercise_name_override, exercise:exercise_id(name)")
    .in("day_id", dayIds.slice(0, 10));
  const names = new Map<string, { day: string; name: string; sets: number }>();
  for (const r of (dayRows ?? []) as any[])
    names.set(r.id, {
      day: r.day_id,
      name: (r.exercise_name_override || r.exercise?.name || "").trim(),
      sets: Math.max(0, Math.min(50, Number(r.sets) || 0)),
    });
  const setNames = new Map<string, string>();
  for (const d of dayIds.slice(0, 3)) {
    try {
      const { data: n } = await db.rpc("pl_day_set_names", { _day_id: d });
      for (const x of (n ?? []) as any[]) setNames.set(`${x.row_id}:${x.set_index}`, x.set_name);
    } catch {
      /* names are only for "top set" / "backoff" words */
    }
  }
  const out: ChatLiftSet[] = [];
  const seen = new Set<string>();
  for (const r of logged as any[]) {
    const meta = names.get(r.row_id);
    if (!meta || !meta.name) continue;
    const key = `${r.row_id}:${r.set_index}`;
    seen.add(key);
    out.push({
      rowId: r.row_id,
      dayId: meta.day,
      setIndex: r.set_index,
      exercise: meta.name,
      completedAt: r.completed_at ?? r.updated_at,
      reps: r.actual_reps ?? null,
      setName: setNames.get(key) ?? null,
    });
  }
  // the planned sets of those workouts, for "1st set" / "set 3" before they're logged
  for (const [rowId, meta] of names) {
    if (!meta.name) continue;
    for (let i = 1; i <= meta.sets; i++) {
      const key = `${rowId}:${i}`;
      if (seen.has(key)) continue;
      out.push({
        rowId,
        dayId: meta.day,
        setIndex: i,
        exercise: meta.name,
        completedAt: null,
        reps: null,
        setName: setNames.get(key) ?? null,
      });
    }
  }
  return out;
}

async function createRow(job: ChatLiftJob, m: ChatLiftMatch): Promise<string | null> {
  const args: Record<string, unknown> = {
    _message_id: job.messageId,
    _storage_path: job.storagePath,
    _how: job.by === "coach" ? "coach" : "auto",
  };
  if (m.kind === "link") {
    args._row_id = m.set.rowId;
    args._set_index = m.set.setIndex;
  } else if (m.kind === "suggest") {
    args._day_id = m.dayId;
    args._suggest = {
      row_id: m.set.rowId,
      set: m.set.setIndex,
      exercise: m.set.exercise,
      set_name: m.set.setName ?? `Set ${m.set.setIndex}`,
    };
  } else if (m.kind === "day") {
    args._day_id = m.dayId;
  }
  const { data, error } = await db.rpc("chat_video_lift", args);
  if (error) throw error;
  return (data as { id?: string } | null)?.id ?? null;
}

/** Read one chat video (see the file's header). */
export async function liftChatVideo(
  job: ChatLiftJob,
  opts: { force?: boolean } = {},
): Promise<ChatLiftOutcome> {
  const sets = await setsAround(job.clientId, job.sentAt).catch(() => [] as ChatLiftSet[]);
  const pre = matchChatLift({ caption: job.caption, sentAt: job.sentAt, sets });
  if (pre.kind === "none" && !opts.force) {
    markTried(job.storagePath);
    return "not_a_lift";
  }
  markTried(job.storagePath);
  const exercise = pre.kind === "link" || pre.kind === "suggest" ? pre.set.exercise : "";
  const key = chatRunKey(job.storagePath);
  try {
    let source = job.source;
    if (!source) {
      const { data: signed } = await supabase.storage
        .from("message-attachments")
        .createSignedUrl(job.storagePath, 3600);
      if (!signed?.signedUrl) return "failed";
      source = signed.signedUrl;
    }
    const res = await analyzeVideo({
      source,
      dirHint: repDirection(exercise) ?? undefined,
      lift: guideLift(exercise),
      onProgress: (p) => setRunning(key, p),
    });
    const video = res.ok ? { dir: res.analysis.dir, reps: res.analysis.reps.length } : null;
    const m = matchChatLift({ caption: job.caption, sentAt: job.sentAt, sets, video });
    // no plate found and the words name no lift: not a lift video, leave it alone (a question, a
    // machine, the dog), even on a training day
    const plateSeen = res.ok || res.why === "needs_confirm";
    if (!opts.force && !plateSeen && (m.kind === "none" || !captionNamesLift(job.caption, sets)))
      return "not_a_lift";
    const id = await createRow(job, m.kind === "none" ? { kind: "none", why: [] } : m);
    if (!id) return "failed";
    if (res.ok) {
      await saveAnalysis(id, res.analysis);
    } else if (res.why === "needs_confirm" || res.why === "no_plate" || res.why === "ambiguous") {
      await saveNotRead(id, {
        engine: ENGINE_VERSION,
        status: "needs_tap",
        why: res.why,
        suggestions: proposalSuggestions(
          res.why === "needs_confirm"
            ? res.proposal
            : res.proposal && { ...res.proposal, key: null },
        ),
      });
    } else if (res.why === "unreadable" || res.why === "too_short") {
      await saveNotRead(id, { engine: ENGINE_VERSION, status: "failed", why: res.why });
    }
    announceChanged(id);
    return m.kind === "link"
      ? "linked"
      : m.kind === "suggest"
        ? "suggested"
        : m.kind === "day"
          ? "workout"
          : "unlinked";
  } finally {
    setRunning(key, null);
  }
}

/* ── one at a time ─────────────────────────────────────────────────────── */

let chain: Promise<unknown> = Promise.resolve();
const queued = new Set<string>();

/** Queue a chat video (a no-op when it's already been looked at on this device). */
export function queueChatLift(
  job: ChatLiftJob,
  opts: { force?: boolean } = {},
): Promise<ChatLiftOutcome> {
  if (queued.has(job.storagePath) || (!opts.force && wasTried(job.storagePath)))
    return Promise.resolve("not_a_lift");
  queued.add(job.storagePath);
  const run = chain.then(async () => {
    // a quiet moment: the page's own work and uploads first
    await new Promise((r) => setTimeout(r, 800));
    try {
      return await liftChatVideo(job, opts);
    } catch {
      return "failed" as const;
    } finally {
      queued.delete(job.storagePath);
    }
  });
  chain = run.catch(() => undefined);
  return run;
}
