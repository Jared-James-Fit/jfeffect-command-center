/**
 * Replays plan quality (Training, Nutrition, Cardio) on a read-only snapshot of
 * production rows, through the real loaders and engines (memory-sb.ts stands in
 * for the database; writes stay in memory).
 *
 *   npx tsx scripts/replay/quality-replay.ts <snapshot.json> [today]       one line of JSON per client
 *   npx tsx scripts/replay/quality-replay.ts --tables                      the tables the loaders read
 *
 * The snapshot is { <client key>: { <table>: rows } } (a query_database dump).
 * It holds client data: keep it outside the repository.
 */
import { readFileSync } from "node:fs";
import { memorySb } from "./memory-sb";
import { programQualityFor } from "@/lib/program-quality.server";
import { nutritionQualityFor } from "@/lib/nutrition-targets/plan-quality.server";
import { loadCardioWorkspace } from "@/lib/cardio/workspace.server";
import { scoreCardioPlan } from "@/lib/cardio/quality";
import type { QualityScore } from "@/lib/plan-quality";

const args = process.argv.slice(2);

function recording(tables: Record<string, any[]>, seen: Map<string, Set<string>>) {
  const sb = memorySb(tables) as any;
  const from = sb.from;
  sb.from = (t: string) => {
    const q = from(t);
    const select = q.select.bind(q);
    q.select = (cols?: string) => {
      const s = seen.get(t) ?? new Set<string>();
      s.add(String(cols ?? "*"));
      seen.set(t, s);
      return select(cols);
    };
    if (!seen.has(t)) seen.set(t, new Set());
    // the columns it filters on: a snapshot without them reads as "nothing on file"
    for (const op of ["eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "not", "contains"]) {
      const f = q[op].bind(q);
      q[op] = (col: string, ...rest: any[]) => {
        seen.get(t)!.add(`filter:${col}`);
        return f(col, ...rest);
      };
    }
    return q;
  };
  const rpc = sb.rpc;
  sb.rpc = (fn: string, ...rest: any[]) => {
    seen.set(`rpc:${fn}`, new Set());
    return rpc(fn, ...rest);
  };
  return sb;
}

const brief = (q: QualityScore | null | undefined) =>
  q
    ? {
        score: q.score,
        band: q.band,
        provisional: q.provisional,
        confidence: q.confidence,
        verdict: `${q.verdict.kind}/${q.verdict.action}: ${q.verdict.headline}`,
        concerns: q.concerns.map((c) => `${c.severity} ${c.reason}${c.category ? `(${c.category})` : ""}: ${c.text}`),
        opportunities: q.opportunities.map((o) => `${o.optional ? "opt " : ""}${o.impact} ${o.reason}: ${o.title}`),
        categories: q.categories.map((c) => `${c.key}=${c.score ?? "-"}${c.critical ? "*" : ""}`).join(" "),
        settling: q.settling,
        execution: q.execution,
        ask: q.verdict.ask ?? null,
        changes: q.changes.map((c) => `${c.on} ${c.size}${c.holds ? " HOLDS" : ""} -> ${c.ready}${c.why ? ` (${c.why})` : ""}: ${c.summary}`),
      }
    : null;

async function readAll(sb: any, clientId: string) {
  const out: Record<string, unknown> = {};
  try {
    out.training = brief((await programQualityFor(sb, clientId)).quality);
  } catch (e: any) {
    out.training = { error: String(e?.message ?? e) };
  }
  try {
    out.nutrition = brief((await nutritionQualityFor(sb, clientId)).quality);
  } catch (e: any) {
    out.nutrition = { error: String(e?.message ?? e) };
  }
  try {
    const view = await loadCardioWorkspace(sb, clientId);
    out.cardio = brief(scoreCardioPlan(view.live, view.scoreCtx));
  } catch (e: any) {
    out.cardio = { error: String(e?.message ?? e) };
  }
  return out;
}

if (args[0] === "--tables") {
  const seen = new Map<string, Set<string>>();
  const id = "00000000-0000-4000-8000-000000000001";
  const tables: Record<string, any[]> = {
    clients: [{ id, full_name: "Test Person", service_tier: "coaching", status: "Active", committed_training_days: ["Monday", "Thursday"], timezone: "America/Winnipeg", user_id: "00000000-0000-4000-8000-000000000002" }],
    pl_blocks: [{ id: "b1", client_id: id, name: "Block", status: "Active", client_visible: true, start_date: "2026-01-01", end_date: "2099-01-01", archived: false, created_at: "2026-01-01" }],
    pl_weeks: [{ id: "w1", block_id: "b1", week_index: 1, archived: false }],
    pl_days: [{ id: "d1", week_id: "w1", day_index: 1, archived: false, scheduled_date: "2099-01-01" }],
    pl_exercise_rows: [{ id: "r1", day_id: "d1", exercise_id: "e1", sets: 3, reps_text: "5", rpe: "7" }],
  };
  await readAll(recording(tables, seen), id);
  for (const [t, cols] of [...seen.entries()].sort()) console.log(`${t}\t${[...cols].join(" | ")}`);
} else {
  const [file, todayArg] = args;
  const dump = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, any[] | null>>;
  void todayArg;
  for (const [key, tables] of Object.entries(dump)) {
    const t: Record<string, any[]> = {};
    for (const [name, rows] of Object.entries(tables)) t[name] = rows ?? [];
    const clientId = t.clients?.[0]?.id;
    if (!clientId) continue;
    console.log(JSON.stringify({ client: key, ...(await readAll(memorySb(t), clientId)) }));
  }
}
