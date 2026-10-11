/**
 * Cleo writes the training roadmap: a phase label + purpose for each block and
 * a label + focus for each week (pl_roadmap_notes.ai_*). Server-only.
 *
 * - She reads the block exactly as the coach built it (digestBlock) and never
 *   writes to the program, only to her own ai_* columns. The coach's
 *   coach_* wording is never touched.
 * - A rewrite happens only when what the words depend on changed
 *   (source_hash). Identical structure elsewhere (the same template assigned
 *   to another athlete) reuses those words instead of asking again.
 * - The training-roadmap-tick job works through pl_roadmap_queue, which DB
 *   triggers fill whenever a block, its weeks, days or exercises, or its
 *   prep's meet date change.
 */
import {
  digestBlock,
  parseRoadmapReply,
  ROADMAP_SYSTEM_PROMPT,
  type DigestContext,
  type RoadmapReply,
} from "@/lib/training-roadmap";

import { isAtHomeBackupSessionBlock } from "@/lib/at-home-backup";

type Admin = any;

/** Give a coach mid-edit time to finish before re-reading the block. */
const SETTLE_MS = 2 * 60_000;
const PER_TICK = 6;
const MAX_ATTEMPTS = 4;

function must<T>(res: { data: T | null; error: any }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

async function loadBlock(admin: Admin, blockId: string) {
  const block = must<any>(
    await admin
      .from("pl_blocks")
      .select("id, client_id, name, goal, training_focus, start_date, end_date, weeks, week_duration_days, prep_id, status, archived, client_visible, sort_order, created_at, source_template_block_key")
      .eq("id", blockId)
      .maybeSingle(),
    "block",
  );
  if (!block) return null;
  const weeks = must<any[]>(
    await admin.from("pl_weeks").select("id, week_index, phase, start_date, end_date, archived, deleted_at").eq("block_id", blockId).order("week_index"),
    "weeks",
  ).filter((w) => !w.archived && !w.deleted_at);
  const weekIds = weeks.map((w) => w.id);
  const days = weekIds.length
    ? must<any[]>(
        await admin.from("pl_days").select("id, week_id, day_index, title, subtitle, focus, archived, deleted_at").in("week_id", weekIds),
        "days",
      ).filter((d) => !d.archived && !d.deleted_at)
    : [];
  const dayIds = days.map((d) => d.id);
  const rows: any[] = [];
  for (let i = 0; i < dayIds.length; i += 200) {
    rows.push(
      ...must<any[]>(
        await admin
          .from("pl_exercise_rows")
          .select("day_id, sort_order, sets, reps_text, rpe, rir, percentage, percentage_basis, tempo, intensity_techniques, exercise_name_override, exercises(name, is_competition_lift, category, primary_muscle_group)")
          .in("day_id", dayIds.slice(i, i + 200)),
        "exercise rows",
      ),
    );
  }

  // Where the block sits: its program neighbours and the meet, if any.
  const siblings = must<any[]>(
    await admin
      .from("pl_blocks")
      .select("id, name, start_date, sort_order, created_at, prep_id")
      .eq("client_id", block.client_id)
      .eq("archived", false)
      .neq("status", "Archived")
      .order("start_date", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true }),
    "program blocks",
  );
  const chain = block.prep_id ? siblings.filter((s) => s.prep_id === block.prep_id) : siblings;
  const pos = chain.findIndex((s) => s.id === block.id);
  let meet: DigestContext["meet"] = null;
  if (block.prep_id) {
    const prep = must<any>(await admin.from("pl_preps").select("event_name, event_date").eq("id", block.prep_id).maybeSingle(), "prep");
    if (prep?.event_date) meet = { name: prep.event_name, date: String(prep.event_date).slice(0, 10) };
  }
  const context: DigestContext = {
    position: pos >= 0 && chain.length > 1 ? { index: pos + 1, of: chain.length } : null,
    previousBlock: pos > 0 ? chain[pos - 1].name : null,
    nextBlock: pos >= 0 && pos < chain.length - 1 ? chain[pos + 1].name : null,
    meet,
  };

  return {
    block,
    weeks,
    digest: digestBlock({
      block,
      weeks,
      days,
      rows: rows.map((r) => ({ ...r, exercise: r.exercises ?? null })),
      context,
    }),
  };
}

async function askCleo(admin: Admin, digest: string, weekIndexes: number[]): Promise<RoadmapReply> {
  const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
  const { generateText } = await import("ai");
  const gateway = createLovableAiGateway();
  const { data: g } = await admin.from("global_ai_config").select("default_model").limit(1).maybeSingle();
  const modelId = g?.default_model || DEFAULT_AI_MODEL;
  let lastText = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await generateText({
      model: gateway(modelId),
      system: ROADMAP_SYSTEM_PROMPT,
      prompt: `${digest}\n\nWeeks to describe: ${weekIndexes.join(", ")}.`,
      temperature: 0.3,
    });
    lastText = r.text;
    const parsed = parseRoadmapReply(r.text, weekIndexes);
    if (parsed) return parsed;
  }
  throw new Error(`Cleo's reply wasn't usable: ${lastText.slice(0, 160)}`);
}

/** Cleo's words for the same structure written for another block, if any. */
async function reuse(admin: Admin, hash: string, blockId: string, weekIndexes: number[]): Promise<RoadmapReply | null> {
  const { data: twin } = await admin
    .from("pl_roadmap_notes")
    .select("block_id, ai_label, ai_summary, ai_style")
    .eq("source_hash", hash)
    .is("week_id", null)
    .not("ai_summary", "is", null)
    .neq("block_id", blockId)
    .limit(1)
    .maybeSingle();
  if (!twin) return null;
  const { data: twinWeeks } = await admin.from("pl_weeks").select("id, week_index").eq("block_id", twin.block_id);
  const idx = new Map<string, number>((twinWeeks ?? []).map((w: any) => [w.id, w.week_index]));
  const { data: notes } = await admin
    .from("pl_roadmap_notes")
    .select("week_id, ai_label, ai_summary")
    .eq("block_id", twin.block_id)
    .not("week_id", "is", null);
  const weeks = (notes ?? [])
    .map((n: any) => ({ week: idx.get(n.week_id) ?? -1, label: n.ai_label ?? "", focus: n.ai_summary ?? "" }))
    .filter((w: any) => weekIndexes.includes(w.week) && w.label && w.focus);
  if (weeks.length !== weekIndexes.length) return null;
  return { style: twin.ai_style ?? "general_fitness", label: twin.ai_label, purpose: twin.ai_summary, weeks };
}

/** Write Cleo's columns only (insert the note when it doesn't exist yet). */
async function writeNote(
  admin: Admin,
  key: { client_id: string; block_id: string; week_id: string | null },
  ai: { ai_label: string | null; ai_summary: string | null; ai_style?: string | null },
  hash: string,
) {
  const now = new Date().toISOString();
  let q = admin.from("pl_roadmap_notes").select("id").eq("block_id", key.block_id);
  q = key.week_id ? q.eq("week_id", key.week_id) : q.is("week_id", null);
  const { data: existing } = await q.maybeSingle();
  const patch = { ...ai, source_hash: hash, generated_at: now };
  if (existing?.id) {
    must(await admin.from("pl_roadmap_notes").update(patch).eq("id", existing.id), "update note");
  } else {
    const ins = await admin.from("pl_roadmap_notes").insert({ ...key, ...patch });
    // A concurrent run inserted it first: update that one instead.
    if (ins.error && /duplicate|unique/i.test(ins.error.message)) {
      let q2 = admin.from("pl_roadmap_notes").update(patch).eq("block_id", key.block_id);
      q2 = key.week_id ? q2.eq("week_id", key.week_id) : q2.is("week_id", null);
      must(await q2, "update note");
    } else if (ins.error) {
      throw new Error(`insert note: ${ins.error.message}`);
    }
  }
}

export type RoadmapResult = { blockId: string; outcome: "written" | "reused" | "unchanged" | "empty" | "gone" };

/**
 * Bring one block's roadmap words up to date. `force` asks Cleo again even
 * when nothing changed (the coach's "Rewrite" button).
 */
export async function refreshBlockRoadmap(admin: Admin, blockId: string, opts: { force?: boolean } = {}): Promise<RoadmapResult> {
  const loaded = await loadBlock(admin, blockId);
  if (!loaded || loaded.block.archived || loaded.block.status === "Archived") return { blockId, outcome: "gone" };
  // At-home backup sessions aren't part of the program roadmap.
  if (isAtHomeBackupSessionBlock(loaded.block)) return { blockId, outcome: "empty" };
  const { block, weeks, digest } = loaded;

  const { data: existing } = await admin
    .from("pl_roadmap_notes")
    .select("week_id, source_hash, ai_summary")
    .eq("block_id", blockId);
  const blockNote = (existing ?? []).find((n: any) => !n.week_id);
  const weekNoteIds = new Set((existing ?? []).filter((n: any) => n.week_id && n.source_hash === digest.hash).map((n: any) => n.week_id));
  const upToDate = blockNote?.source_hash === digest.hash && weeks.every((w: any) => weekNoteIds.has(w.id));
  if (upToDate && !opts.force) return { blockId, outcome: "unchanged" };

  const key = (week_id: string | null) => ({ client_id: block.client_id, block_id: blockId, week_id });

  // Nothing programmed yet: say nothing rather than guess.
  if (!digest.hasTraining) {
    if (blockNote?.ai_summary || (existing ?? []).some((n: any) => n.week_id && n.ai_summary)) {
      await writeNote(admin, key(null), { ai_label: null, ai_summary: null, ai_style: null }, digest.hash);
      for (const w of weeks) await writeNote(admin, key(w.id), { ai_label: null, ai_summary: null }, digest.hash);
    }
    return { blockId, outcome: "empty" };
  }

  const twin = opts.force ? null : await reuse(admin, digest.hash, blockId, digest.weekIndexes);
  const reply = twin ?? (await askCleo(admin, digest.text, digest.weekIndexes));

  await writeNote(admin, key(null), { ai_label: reply.label, ai_summary: reply.purpose, ai_style: reply.style }, digest.hash);
  const byIndex = new Map(reply.weeks.map((w) => [w.week, w]));
  for (const w of weeks) {
    const r = byIndex.get(w.week_index);
    await writeNote(admin, key(w.id), { ai_label: r?.label ?? null, ai_summary: r?.focus ?? null }, digest.hash);
  }
  return { blockId, outcome: twin ? "reused" : "written" };
}

/** The schedule tick: settled queue entries first, a few per run. */
export async function runRoadmapTick(admin: Admin) {
  const cutoff = new Date(Date.now() - SETTLE_MS).toISOString();
  const due = must<any[]>(
    await admin.from("pl_roadmap_queue").select("block_id, queued_at, attempts").lte("queued_at", cutoff).order("queued_at").limit(PER_TICK),
    "roadmap queue",
  );
  const results: Array<RoadmapResult | { blockId: string; error: string }> = [];
  for (const item of due) {
    try {
      results.push(await refreshBlockRoadmap(admin, item.block_id));
      // Only clear the entry if nothing re-queued it while Cleo was writing.
      await admin.from("pl_roadmap_queue").delete().eq("block_id", item.block_id).eq("queued_at", item.queued_at);
    } catch (e: any) {
      const message = String(e?.message ?? e).slice(0, 500);
      results.push({ blockId: item.block_id, error: message });
      if ((item.attempts ?? 0) + 1 >= MAX_ATTEMPTS) {
        await admin.from("pl_roadmap_queue").delete().eq("block_id", item.block_id).eq("queued_at", item.queued_at);
      } else {
        await admin
          .from("pl_roadmap_queue")
          .update({ attempts: (item.attempts ?? 0) + 1, last_error: message })
          .eq("block_id", item.block_id)
          .eq("queued_at", item.queued_at);
      }
    }
  }
  return { checked: due.length, results };
}
