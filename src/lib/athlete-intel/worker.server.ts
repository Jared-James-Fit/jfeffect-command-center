/**
 * Reading uploaded athlete information in the background (server only): the
 * athlete-intel-tick hook, woken by the database the moment a source is
 * queued and by pg_cron. One source per step:
 *
 *  1. a video is kept for reference (footage isn't analyzed here);
 *  2. the deterministic reader takes everything it can (free, instant):
 *     tables, logs, typed notes;
 *  3. only what it couldn't place goes to AI (a PDF, photos, paragraphs of a
 *     coach's notes), and only when the athlete allows AI processing;
 *     otherwise what was read stands and the rest waits, said in words;
 *  4. the model copies, code checks every number and note against the
 *     source (ai-read.ts), facts are stored (duplicates merged), every slot
 *     is worked out again, the athlete's upcoming meets are re-read (the
 *     forecast, the watch list, an interim update when something moved), and
 *     the rare question is raised.
 *
 * An AI provider that's down never uses an attempt (the source waits and is
 * read when it's back); a cut-off request is picked up again; three real
 * failures stop with why, and Try again starts it over. File contents are
 * data, never instructions.
 */
import { needsAiRead, notesFromNarrative, readSource, type ReadResult } from "./read-log";
import { detectPurposes } from "./classify";
import { summarize } from "./findings";
import {
  afterChange,
  applySourceAnswers,
  clearSourceFacts,
  DELETED_DAYS,
  INTEL_BUCKET,
  intelUrl,
  logIntel,
  staffFor,
  storeFacts,
  todayWinnipeg,
} from "./intel.server";
import type { Lift, Purpose, RawFact, SourceSummary, Unit } from "./types";

type Db = any;

export const POLL = { ms: 40_000, every: 3_000 };
export const MODEL_LIMIT_MS = 20 * 60_000;
export const STALE_READ_MS = 4 * 60_000;
export const MAX_ATTEMPTS = 3;

const ROW_COLS =
  "id, client_id, competition_id, kind, file_name, file_path, mime, provider, provider_name, purposes, detected_purposes, context, source_text, sheets, status, attempts, progress, summary, start_date, unit_answer, completion_answer, via_link_id, created_at, replaces_id";

const toBase64 = (buf: Uint8Array) => (typeof Buffer !== "undefined" ? Buffer.from(buf).toString("base64") : btoa(String.fromCharCode(...buf)));

async function claim(sb: Db, id: string | null): Promise<any | null> {
  const stale = new Date(Date.now() - STALE_READ_MS).toISOString();
  const now = new Date().toISOString();
  const ready = `status.eq.queued,and(status.eq.reading,updated_at.lt.${stale}),and(status.eq.waiting_ai,retry_at.lte.${now})`;
  let q = sb.from("athlete_intel_sources").select("id").or(ready).gt("updated_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("updated_at", { ascending: true }).limit(1);
  if (id) q = q.eq("id", id);
  const { data: pick } = await q;
  const target = (pick as any[] | null)?.[0]?.id;
  if (!target) return null;
  const { data } = await sb
    .from("athlete_intel_sources")
    .update({ status: "reading", updated_at: now })
    .eq("id", target)
    .or(ready)
    .select(ROW_COLS)
    .maybeSingle();
  return data ?? null;
}

/** The athlete's context the reader uses to tell kg from lb. */
async function unitContext(sb: Db, clientId: string) {
  const [{ data: client }, { data: meets }] = await Promise.all([
    sb.from("clients").select("preferred_weight_unit, weight_unit_confirmed_at, user_id, first_name, preferred_name, full_name").eq("id", clientId).maybeSingle(),
    sb.from("athlete_powerlifting_results").select("squat_kg, bench_kg, deadlift_kg, bodyweight_kg, meet_date").eq("client_id", clientId).order("meet_date", { ascending: false }).limit(10),
  ]);
  const meetBestKg: Partial<Record<Lift, number>> = {};
  let bw: number | null = null;
  for (const m of (meets ?? []) as any[]) {
    for (const [l, c] of [["squat", "squat_kg"], ["bench", "bench_kg"], ["deadlift", "deadlift_kg"]] as const) if (Number(m[c]) > 0) meetBestKg[l] = Math.max(meetBestKg[l] ?? 0, Number(m[c]));
    if (!bw && Number(m.bodyweight_kg) > 0) bw = Number(m.bodyweight_kg);
  }
  const preferred: Unit | null = client?.weight_unit_confirmed_at && (client.preferred_weight_unit === "kg" || client.preferred_weight_unit === "lb") ? client.preferred_weight_unit : null;
  const first = String(client?.preferred_name || client?.first_name || String(client?.full_name ?? "").split(" ")[0] || "the athlete");
  return { meetBestKg, bw, preferred, first, hasLogin: !!client?.user_id };
}

function alreadyReadLine(r: ReadResult): string | null {
  const n = r.facts.length;
  if (!n) return null;
  return r.facts
    .slice(0, 30)
    .map((f) => `${f.kind}${f.lift ? ` ${f.lift}` : ""}${f.date ? ` ${f.date}` : ""}`)
    .join("; ");
}

export type TickResult = { status: string; id?: string; cleaned?: number };

export async function runIntelTick(sb: Db, sourceId: string | null): Promise<TickResult> {
  const row = await claim(sb, sourceId);
  if (!row) return { status: "idle", cleaned: await cleanUp(sb) };
  const today = todayWinnipeg();
  const declared = ((row.purposes ?? []) as Purpose[]).filter((p) => p !== "other");
  const done = async (patch: Record<string, unknown>) =>
    sb.from("athlete_intel_sources").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "reading").select("id");

  if (row.kind === "video") {
    await clearSourceFacts(sb, row.id, row.client_id);
    const summary: SourceSummary = {
      ...summarize([], "none", ["Kept for reference. Footage isn't analyzed here: set videos logged in the app get bar speed and technique reads."]),
      line: "Footage kept for reference",
    };
    await done({ status: "stored", summary, method: "none", analyzed_at: new Date().toISOString(), error: null, progress: null });
    await logIntel(sb, { clientId: row.client_id, competitionId: row.competition_id, sourceId: row.id, actor: "system", action: "source_stored" });
    await finishReplace(sb, row);
    return { status: "stored", id: row.id };
  }

  const ctx = await unitContext(sb, row.client_id);
  const text: string = row.source_text ?? "";
  const fileKind = row.kind === "pdf" || row.kind === "image";
  const read = readSource(
    { kind: row.kind, name: row.file_name, text, sheets: Array.isArray(row.sheets) ? row.sheets : undefined },
    { today, declared, preferredUnit: ctx.preferred, meetBestKg: ctx.meetBestKg, bodyweightKg: ctx.bw },
  );
  const wantsAi = fileKind || needsAiRead(row.kind, read) || (!read.facts.length && text.trim().length > 40);
  const detected = detectPurposes({ name: row.file_name, text: text || read.narrative, sheetNames: (row.sheets ?? []).map((s: any) => s?.name) });
  const notes: string[] = [];
  if (read.completionWhy) notes.push(read.completionWhy);
  if (read.unitWhy && read.unit) notes.push(`Weights read in ${read.unit}: ${read.unitWhy.toLowerCase()}`);

  // 1. what the reader took, stored first (it stands whatever happens with AI)
  let aiFacts: RawFact[] = [];
  let method: SourceSummary["method"] = "parsed";
  let aiProblem: { status: "waiting_consent" | "waiting_ai" | "failed" | "queued"; error: string; retryMs?: number } | null = null;
  if (wantsAi) {
    const { clientAllowsAi } = await import("@/lib/ai-consent/consent.server");
    const consent = ctx.hasLogin ? await clientAllowsAi(row.client_id) : { ok: true, name: null };
    if (!consent.ok) {
      aiProblem = {
        status: "waiting_consent",
        error: `${fileKind ? "This file can only be read with AI" : "Its notes can only be read with AI"}, and ${consent.name ?? ctx.first} hasn't allowed AI processing. ${read.facts.length ? "What could be read without it is in." : "Type the key details instead, or ask them to allow it in Account → Privacy & data."}`,
      };
    } else {
      try {
        aiFacts = await aiRead(sb, row, { today, read, text, fileKind, ctx });
        method = read.facts.length ? "both" : "ai";
      } catch (e: any) {
        const { WaitingForModel, ModelsExhausted } = await import("@/lib/ai/staged-call.server");
        if (e instanceof WaitingForModel) {
          // back in the queue: the database wakes the hook again at once
          await sb.from("athlete_intel_sources").update({ status: "queued", progress: row.progress, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "reading");
          return { status: "waiting", id: row.id };
        }
        const { classifyAiError, isProviderFailure, aiFailureWords } = await import("@/lib/ai/ai-errors");
        const kind = classifyAiError(e);
        if (isProviderFailure(kind) || (e instanceof ModelsExhausted && (e as any).noOpenAiCredits)) {
          aiProblem = { status: "waiting_ai", error: `Waiting for AI: ${aiFailureWords(kind)}. It's read automatically once AI is back.`, retryMs: 10 * 60_000 };
        } else {
          const attempts = Number(row.attempts ?? 0) + 1;
          aiProblem =
            attempts >= MAX_ATTEMPTS
              ? { status: "failed", error: `It couldn't be read (${String(e?.message ?? e).slice(0, 160)}). Try again, or type the key details.` }
              : { status: "waiting_ai", error: "Reading it again shortly.", retryMs: 2 * 60_000 };
          await sb.from("athlete_intel_sources").update({ attempts }).eq("id", row.id);
        }
      }
    }
  }

  // what no AI read looked at stays as the source's own words (an AI read covers it when it runs)
  const kept = aiFacts.length || method !== "parsed" ? [] : notesFromNarrative(read.narrative);
  const raws = applySourceAnswers([...read.facts, ...aiFacts, ...kept], row);
  await clearSourceFacts(sb, row.id, row.client_id);
  const stored = await storeFacts(sb, row, raws, null);
  const summary: SourceSummary = {
    ...summarize(raws, read.facts.length || aiFacts.length ? method : "none", notes),
    ...(read.unitUnknown && !row.unit_answer ? { unitUnknown: true } : {}),
  } as SourceSummary & { unitUnknown?: boolean };
  if (stored.merged && !stored.added) summary.notes.push("Everything in it was already on file");
  const purposes = [...new Set([...detected])].slice(0, 8);

  if (aiProblem) {
    await done({
      status: aiProblem.status,
      error: aiProblem.error.slice(0, 600),
      summary,
      method: read.facts.length ? "parsed" : "none",
      detected_purposes: purposes,
      retry_at: aiProblem.retryMs ? new Date(Date.now() + aiProblem.retryMs).toISOString() : null,
      progress: aiProblem.status === "failed" ? null : row.progress,
    });
    await logIntel(sb, { clientId: row.client_id, competitionId: row.competition_id, sourceId: row.id, actor: "system", action: `source_${aiProblem.status}`, detail: { error: aiProblem.error.slice(0, 200) } });
    if (read.facts.length) await afterChange(sb, row.client_id).catch(() => undefined);
    return { status: aiProblem.status, id: row.id };
  }

  const impacts = await afterChange(sb, row.client_id).catch(() => []);
  const moved = (impacts as any[]).find((i) => i.before != null && i.after != null && Math.abs(i.after - i.before) / i.before >= 0.01);
  if (moved) summary.impact = { competitionId: moved.competitionId, before: moved.before, after: moved.after };
  const { data: ok } = await done({ status: "ready", error: null, summary, method, detected_purposes: purposes, analyzed_at: new Date().toISOString(), progress: null, retry_at: null, attempts: 0 });
  if (!(ok as any[] | null)?.length) return { status: "discarded", id: row.id };
  await logIntel(sb, { clientId: row.client_id, competitionId: row.competition_id, sourceId: row.id, actor: "cleo", action: "source_analyzed", detail: { added: stored.added, merged: stored.merged, method } });
  await finishReplace(sb, row);
  // a contributor's upload: the handler hears about it once (they weren't there)
  if (row.via_link_id) {
    const to = await staffFor(sb, row.client_id, row.competition_id);
    if (to) {
      try {
        const { sendWebPushToUser } = await import("@/lib/push/push.server");
        await sendWebPushToUser(
          sb,
          to,
          { title: `New information for ${ctx.first}`, body: `${row.file_name ?? "A note"}: ${summary.line}`.slice(0, 160), url: intelUrl(row.client_id, row.competition_id), tag: `intel-src-${row.client_id}` },
          { eventKey: `intel_src:${row.id}` },
        );
      } catch {
        /* best effort */
      }
    }
  }
  return { status: "ready", id: row.id };
}

/** A new version that's read: the one it replaces stops counting (kept as history, restorable). */
async function finishReplace(sb: Db, row: any) {
  if (!row.replaces_id) return;
  await sb.from("athlete_intel_sources").update({ status: "replaced", replaced_by: row.id }).eq("id", row.replaces_id).eq("client_id", row.client_id).neq("status", "deleted");
  await afterChange(sb, row.client_id).catch(() => undefined);
}

async function aiRead(sb: Db, row: any, o: { today: string; read: ReadResult; text: string; fileKind: boolean; ctx: Awaited<ReturnType<typeof unitContext>> }): Promise<RawFact[]> {
  const { stagedCall } = await import("@/lib/ai/staged-call.server");
  const { resolveRoute } = await import("@/lib/ai/routing");
  const { readRouteOverride } = await import("@/lib/ai/route-call.server");
  const { INTEL_SYSTEM, intelPrompt } = await import("./ai-prompt.server");
  const { readAiAnswer, UnreadableAnswer } = await import("./ai-read");
  const state: any = row.progress ?? {};
  const save = async () => {
    row.progress = state;
    await sb.from("athlete_intel_sources").update({ progress: state, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "reading");
  };
  const route = resolveRoute("athlete_intel", await readRouteOverride(sb), { openaiOnly: true });
  let meet: { name: string; date: string } | null = null;
  if (row.competition_id) {
    const { data: c } = await sb.from("competitions").select("name, meet_date").eq("id", row.competition_id).maybeSingle();
    if (c) meet = { name: c.name, date: String(c.meet_date).slice(0, 10) };
  }
  const files = o.fileKind
    ? async () => {
        const { data, error } = await sb.storage.from(INTEL_BUCKET).download(row.file_path);
        if (error || !data) throw new Error("The uploaded file is gone. Upload it again.");
        const pdf = row.kind === "pdf";
        return [{ kind: (pdf ? "pdf" : "image") as "pdf" | "image", name: String(row.file_name ?? "upload"), mime: String(pdf ? "application/pdf" : row.mime || data.type || "image/jpeg"), base64: toBase64(new Uint8Array(await data.arrayBuffer())) }];
      }
    : undefined;
  // text sources: the whole text (it's checked against), told what's already read
  const prompt = intelPrompt({
    fileName: row.file_name,
    kind: row.kind,
    text: o.fileKind ? null : o.text,
    context: row.context,
    provider: row.provider,
    purposes: row.purposes ?? [],
    today: o.today,
    athleteFirst: o.ctx.first,
    meet,
    alreadyRead: alreadyReadLine(o.read),
  });
  const call = (key: string, p: string) =>
    stagedCall({
      state,
      key,
      route,
      req: { system: INTEL_SYSTEM, prompt: p, effort: route.effort, maxOutputTokens: route.maxOutputTokens, files },
      save,
      tag: "athlete_intel",
      poll: POLL,
      backgroundLimitMs: MODEL_LIMIT_MS,
      syncTimeoutMs: 170_000,
    });
  const ground = { source: o.fileKind ? null : o.text, fileKind: o.fileKind, today: o.today, unitHint: (row.unit_answer as Unit | null) ?? o.read.unit ?? o.ctx.preferred };
  const first = await call("read", prompt);
  try {
    return readAiAnswer(first.text, ground).facts;
  } catch (e) {
    if (!(e instanceof UnreadableAnswer)) throw e;
    const again = await call("read2", `${prompt}\n\nYour last answer couldn't be read as JSON with a "facts" list. Answer again in exactly the shape asked for.`);
    return readAiAnswer(again.text, ground).facts;
  }
}

/** Files of deleted sources removed; sources 30 days in Recently deleted gone for good (their facts with them). */
export async function cleanUp(sb: Db): Promise<number> {
  let n = 0;
  const cutoff = new Date(Date.now() - DELETED_DAYS * 86_400_000).toISOString();
  const { data: old } = await sb.from("athlete_intel_sources").select("id").eq("status", "deleted").lt("deleted_at", cutoff).limit(50);
  for (const r of (old ?? []) as any[]) {
    await sb.from("athlete_intel_sources").delete().eq("id", r.id).eq("status", "deleted");
    n++;
  }
  const { data: tomb } = await sb.from("athlete_intel_file_tombstones").select("path").limit(100);
  const paths = ((tomb ?? []) as any[]).map((t) => t.path);
  if (paths.length) {
    const { error } = await sb.storage.from(INTEL_BUCKET).remove(paths);
    if (!error) {
      await sb.from("athlete_intel_file_tombstones").delete().in("path", paths);
      n += paths.length;
    }
  }
  return n;
}
