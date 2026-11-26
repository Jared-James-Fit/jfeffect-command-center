/**
 * Where the competition's assessments being written stand (server only, the service role after the
 * caller's staff check): each milestone in flight as `LiveRewrite` (rewrite-progress.ts reads it),
 * the versions a change request has just produced, and the usual length of Cleo's calls from the
 * calls on file. Light on purpose: the screens poll it every few seconds while something's in
 * flight, never the whole workspace.
 */
import {
  DEFAULT_TYPICAL,
  liveFromProgress,
  medianMs,
  type LiveRewrite,
  type RewriteTypical,
} from "./rewrite-progress";
import { todayWinnipeg } from "./load.server";

type Db = any;

/** A version a change request has just produced, for "Version 2 is ready". */
export type RewriteDone = {
  fromId: string;
  toId: string;
  version: number;
  kind: string;
  at: string;
};

let typicalCache: { at: number; value: RewriteTypical } | null = null;
const TYPICAL_TTL_MS = 10 * 60_000;
/** A finished rewrite is reported this long (so a screen that missed the moment still sees it). */
const DONE_WINDOW_MS = 30 * 60_000;

/** The median write and second-pass call from ai_call_log (cached for 10 minutes). */
export async function rewriteTypical(sb: Db): Promise<RewriteTypical> {
  if (typicalCache && Date.now() - typicalCache.at < TYPICAL_TTL_MS) return typicalCache.value;
  const { data } = await sb
    .from("ai_call_log")
    .select("feature, ms")
    .like("task", "competition:%")
    .in("feature", ["write", "write2"])
    .eq("ok", true)
    .order("at", { ascending: false })
    .limit(80);
  const of = (f: string) =>
    medianMs(((data ?? []) as any[]).filter((r) => r.feature === f).map((r) => Number(r.ms)));
  const value = {
    write: of("write") ?? DEFAULT_TYPICAL.write,
    write2: of("write2") ?? DEFAULT_TYPICAL.write2,
  };
  typicalCache = { at: Date.now(), value };
  return value;
}

export async function loadRewrites(sb: Db, competitionId: string) {
  const today = todayWinnipeg();
  const [{ data: ms, error }, { data: asked }, { data: recent }] = await Promise.all([
    sb
      .from("competition_milestones")
      .select(
        "id, kind, status, attempts, last_error, why, updated_at, locked_at, due_on, progress",
      )
      .eq("competition_id", competitionId)
      .in("status", ["scheduled", "generating", "waiting_ai", "failed"]),
    sb
      .from("competition_assessments")
      .select("id, milestone_id, version, changes_note, changes_requested_at")
      .eq("competition_id", competitionId)
      .eq("status", "changes_requested"),
    sb
      .from("competition_assessments")
      .select("id, kind, superseded_by, superseded_at")
      .eq("competition_id", competitionId)
      .not("changes_requested_at", "is", null)
      .not("superseded_by", "is", null)
      .gte("superseded_at", new Date(Date.now() - DONE_WINDOW_MS).toISOString()),
  ]);
  if (error) throw new Error(error.message);
  const byMilestone = new Map<string, any>();
  for (const a of (asked ?? []) as any[]) if (a.milestone_id) byMilestone.set(a.milestone_id, a);

  const live: LiveRewrite[] = [];
  for (const m of (ms ?? []) as any[]) {
    const req = byMilestone.get(m.id) ?? null;
    // the schedule's future milestones aren't in flight; a failed one is shown only for a change request
    if (m.status === "scheduled" && String(m.due_on) > today) continue;
    if (m.status === "failed" && !req) continue;
    live.push({
      milestoneId: m.id,
      kind: m.kind,
      status: m.status,
      attempts: Number(m.attempts ?? 0),
      lastError: m.last_error ?? null,
      why: m.why ?? null,
      updatedAt: m.updated_at ?? null,
      lockedAt: m.locked_at ?? null,
      ...liveFromProgress(m.progress),
      request: req
        ? {
            assessmentId: req.id,
            version: Number(req.version ?? 1),
            note: req.changes_note ?? null,
            at: req.changes_requested_at ?? null,
          }
        : null,
    });
  }

  const doneRows = (recent ?? []) as any[];
  const newIds = [...new Set(doneRows.map((r) => r.superseded_by))];
  const { data: news } = newIds.length
    ? await sb.from("competition_assessments").select("id, version, created_at").in("id", newIds)
    : { data: [] };
  const newer = new Map(((news ?? []) as any[]).map((n) => [n.id, n]));
  const done: RewriteDone[] = doneRows
    .filter((r) => newer.has(r.superseded_by))
    .map((r) => ({
      fromId: r.id,
      toId: r.superseded_by,
      version: Number(newer.get(r.superseded_by).version ?? 1),
      kind: r.kind,
      at: String(r.superseded_at),
    }));

  return { serverNow: Date.now(), typical: await rewriteTypical(sb), live, done };
}

/**
 * Start a stopped rewrite again now, keeping what Cleo already finished (its answered calls stay
 * on the milestone, so a resumed run never asks twice). Only a failed one, or one waiting on
 * OpenAI, can be started again; one being written is left alone.
 */
export async function retryRewrite(sb: Db, milestoneId: string, userId: string) {
  const { data: m, error } = await sb
    .from("competition_milestones")
    .select("id, competition_id, client_id, kind, status, last_error")
    .eq("id", milestoneId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!m) throw new Error("That assessment isn't scheduled any more");
  if (m.status !== "failed" && m.status !== "waiting_ai")
    return { ok: true, already: m.status === "generating" || m.status === "scheduled" };
  const { error: upd } = await sb
    .from("competition_milestones")
    .update({
      status: "scheduled",
      due_on: todayWinnipeg(),
      attempts: 0,
      last_error: null,
      locked_at: null,
    })
    .eq("id", milestoneId)
    .in("status", ["failed", "waiting_ai"]);
  if (upd) throw new Error(upd.message);
  const { logEvent } = await import("./release.server");
  await logEvent(sb, {
    competitionId: m.competition_id,
    clientId: m.client_id,
    actorId: userId,
    actor: "coach",
    action: "retry",
    detail: { kind: m.kind, after: m.last_error ?? null },
  });
  return { ok: true, already: false };
}
