/**
 * One Edit with AI turn, in the background (the program-ai-tick hook; never
 * inside the coach's request, which the host cuts off when the phone leaves
 * the screen). It re-checks that the coach who asked may still edit this
 * program, reads the program, the athlete (Program Intelligence's brief: the
 * same full-history read the generator uses), the catalog and the coach's
 * rules, asks the model, checks the reply (schema, refs, exercises, values;
 * up to two fix rounds with the problems named), merges it into the
 * conversation's current proposal and stores the result. Nothing is written
 * to the program here.
 */
import { buildBrief, setupText } from "@/lib/program-intel/brief";
import { buildGeneratorIntel } from "@/lib/program-intel/intelligence";
import { loadIntelRecords } from "@/lib/program-intel/load";
import { findConflicts } from "@/lib/program-intel/recommend";
import { conversationText, mergeProposal, snapshotFingerprint, type Turn } from "./conversation";
import { buildPlan, exerciseNamesIn, normName, refIndex, resolveChanges, type EngineCtx } from "./engine";
import { loadCatalog, loadClientSnapshot, loadRules, loadTemplateSnapshot, resolveLibraryNames } from "./load.server";
import { parseReply, type EditChange, type EditReply } from "./ops";
import { catalogText, EDIT_PROMPT_VERSION, EDIT_SYSTEM_PROMPT, editUserPrompt, programText, rulesText } from "./prompts";
import type { CatalogExercise, ProgramSnapshot } from "./types";

type Db = any;
const STALE_RUN_MS = 6 * 60_000;
const MAX_ATTEMPTS = 3;
const CALL_TIMEOUT_MS = 170_000;
/** The athlete's brief: the full history unless it's larger (then summarized and said so). */
const BRIEF_CHARS = 170_000;
/** At most this many model calls per turn (the first, then a fix round), and no fix round once a turn has run this long. */
const MAX_CALLS = 2;
const FIX_ROUND_BEFORE_MS = 120_000;

async function claim(admin: Db, editId: string | null): Promise<any | null> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const q = editId
    ? admin.from("program_ai_edits").select("*").eq("id", editId).limit(1)
    : admin.from("program_ai_edits").select("*").gt("updated_at", since).lt("attempts", MAX_ATTEMPTS).in("status", ["pending", "running"]).order("created_at").limit(5);
  const { data } = await q;
  const edit = (data ?? []).find((e: any) => e.status === "pending" || (e.status === "running" && Date.now() - Date.parse(e.updated_at) > STALE_RUN_MS));
  if (!edit || edit.attempts >= MAX_ATTEMPTS) return null;
  const { data: claimed } = await admin
    .from("program_ai_edits")
    .update({ status: "running", attempts: edit.attempts + 1, started_at: new Date().toISOString(), error: null, stage: "Reading the program" })
    .eq("id", edit.id)
    .eq("status", edit.status)
    .eq("attempts", edit.attempts)
    .select("*")
    .maybeSingle();
  return claimed ?? null;
}

async function stage(admin: Db, id: string, text: string) {
  await admin.from("program_ai_edits").update({ stage: text }).eq("id", id);
}

/**
 * The model that edits programs: the strongest one the gateway takes (Cleo's, which does her
 * program edits too; PROGRAM_AI_MODEL overrides it), then the app's fast default if it fails or
 * runs out of time. A live test on Nov 8 2026 had the fast model put "rear delt work" on a
 * lateral raise and overwrite an athlete's cue; programming judgment is worth the wait.
 */
export const EDIT_PRIMARY_MODEL = "openai/gpt-5.5";
const PRIMARY_TIMEOUT_MS = 150_000;
const FALLBACK_TIMEOUT_MS = 90_000;

async function callModel(admin: Db, edit: any, label: string, system: string, prompt: string): Promise<{ text: string; model: string }> {
  const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
  const { generateText } = await import("ai");
  const { data: cfg } = await admin.from("global_ai_config").select("default_model").limit(1).maybeSingle();
  const primary = process.env.PROGRAM_AI_MODEL || EDIT_PRIMARY_MODEL;
  const models = [...new Set([primary, (cfg?.default_model as string | undefined) || DEFAULT_AI_MODEL])];
  let last: any = null;
  for (const [i, model] of models.entries()) {
    const t0 = Date.now();
    try {
      // OpenAI's reasoning models take only their default temperature
      const r = await generateText({
        model: createLovableAiGateway()(model),
        system,
        prompt,
        ...(model.startsWith("openai/") ? {} : { temperature: 0.2 }),
        abortSignal: AbortSignal.timeout(i === 0 ? PRIMARY_TIMEOUT_MS : FALLBACK_TIMEOUT_MS),
      });
      await logCall(admin, edit.id, { label, model, system, prompt, response: r.text, ok: true, ms: Date.now() - t0, usage: (r as any).usage });
      return { text: r.text, model };
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status;
      await logCall(admin, edit.id, { label, model, system, prompt, response: null, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 500) });
      last = e;
      if (status === 402) throw new Error("AI credits are used up.");
      // busy: the next model may not be
    }
  }
  throw new Error(`The AI service didn't answer: ${String(last?.message ?? last).slice(0, 200)}`);
}

async function logCall(admin: Db, editId: string, x: { label: string; model: string; system: string; prompt: string; response: string | null; ok: boolean; ms: number; error?: string; usage?: any }) {
  await admin
    .from("program_ai_edit_calls")
    .insert({
      edit_id: editId,
      stage: x.label,
      model: x.model,
      system_prompt: x.system,
      prompt: x.prompt,
      response: x.response,
      prompt_chars: x.system.length + x.prompt.length,
      response_chars: x.response?.length ?? 0,
      input_tokens: x.usage?.inputTokens ?? x.usage?.promptTokens ?? null,
      output_tokens: x.usage?.outputTokens ?? x.usage?.completionTokens ?? null,
      duration_ms: x.ms,
      ok: x.ok,
      error: x.error ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** The athlete as Program Intelligence reads them (the generator's brief, minus its setup sections). */
async function athleteBrief(admin: Db, clientId: string): Promise<{ text: string; maxSessionMinutes: number | null; maxLifts: string[]; warnings: string[]; chars: number; signals: NonNullable<EngineCtx["signals"]>; missing: Array<{ field: string; why: string; where: string }> }> {
  const rec = await loadIntelRecords(admin, clientId, { kind: "history" });
  const intel = buildGeneratorIntel(rec);
  const setup = intel.recommendation.setup;
  const lookup = (r: { id: string | null; name: string }) => (r.id ? intel.exercises.get(r.id) ?? null : null) ?? (r.name ? { name: r.name, equipment: null } : null);
  let conflicts: any[] = [];
  try {
    conflicts = findConflicts(setup, intel.ctx, intel.recommendation.baseline, lookup, setup);
  } catch {
    conflicts = [];
  }
  const b = buildBrief(intel, { setup, edited: [], conflicts, redistribution: null, budgetChars: BRIEF_CHARS, exclude: ["setup", "requirements"] });
  const flags = conflicts.length ? `\n\n## Things the data flags\n${conflicts.map((c: any) => `- [${c.severity}] ${c.title}. ${c.detail}`).join("\n")}` : "";
  const text = `${b.text}${flags}\n\n## What the data recommends for their training (a reference, not a requirement)\n${setupText(setup)}`;
  const maxLifts = intel.history.lifts.filter((l: any) => l.maxOnFileKg != null).map((l: any) => String(l.lift).toLowerCase());
  // what the records say about each exercise: the editor warns when a change goes against it
  const signals: NonNullable<EngineCtx["signals"]> = new Map();
  for (const p of intel.development.progression) if (p.exerciseId) signals.set(p.exerciseId, { decision: p.decision, why: p.why, lastKg: p.lastKg, pain: p.pain });
  return { text, maxSessionMinutes: setup.maxSessionMinutes ?? null, maxLifts, warnings: b.warnings, chars: text.length, signals, missing: intel.development.missing };
}

function ctxFrom(catalog: CatalogExercise[], extra: Map<string, CatalogExercise> = new Map()): EngineCtx {
  const all = [...catalog, ...extra.values()];
  return { catalog: new Map(all.map((e) => [e.code, e])), byId: new Map(all.map((e) => [e.id, e])), names: extra };
}

/** Problems worth one more try (wrong shape, unknown refs or exercises, invalid values), in words. */
function fixable(snap: ProgramSnapshot, ctx: EngineCtx, changes: EditChange[]): string[] {
  const out: string[] = [];
  for (const r of resolveChanges(snap, changes, ctx)) for (const i of r.issues) if (i.level === "error") out.push(`${r.id}: ${i.text}`);
  return out.slice(0, 20);
}

export async function runProgramAiEdit(admin: Db, editId: string | null): Promise<{ status: string; editId?: string; error?: string }> {
  const edit = await claim(admin, editId);
  if (!edit) return { status: "idle" };
  try {
    // 1. who's asking, and the program
    let snap: ProgramSnapshot;
    let meta: Map<string, any>;
    let templateNote: string | null = null;
    const athleteId: string | null = edit.client_id ?? edit.personalize_client_id ?? null;
    if (edit.target_kind === "client") {
      const { data: allowed, error } = await admin.rpc("program_intel_can_coach", { _user: edit.created_by, _client: edit.client_id });
      if (error) throw new Error(error.message);
      if (!allowed) throw new Error("The coach who asked for this no longer coaches this client.");
      ({ snap, meta } = await loadClientSnapshot(admin, edit.client_id, { focusBlockId: edit.focus_block_id }));
    } else {
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: edit.created_by, _role: "admin" });
      if (!isAdmin) throw new Error("Only an admin can edit library templates.");
      ({ snap, meta } = await loadTemplateSnapshot(admin, edit.template_id));
      if (edit.personalize_client_id) {
        const { data: ok } = await admin.rpc("program_intel_can_coach", { _user: edit.created_by, _client: edit.personalize_client_id });
        if (!ok) throw new Error("You can't personalize a template for a client you don't coach.");
        templateNote = "This is a LIBRARY TEMPLATE, personalized for the athlete below as the coach asked. Changes go to this template (or a new variation), never to the athlete's own program.";
      } else {
        templateNote = "This is a LIBRARY TEMPLATE: no athlete, no logs. Program for the kind of lifter it's meant for; don't assume any one client's history.";
      }
    }

    // 2. the athlete
    let brief: string | null = null;
    let briefInfo: { chars: number; warnings: string[] } | null = null;
    let signals: EngineCtx["signals"] = undefined;
    let missing: Array<{ field: string; why: string; where: string }> = [];
    if (athleteId) {
      await stage(admin, edit.id, "Reading their training history");
      const a = await athleteBrief(admin, athleteId);
      brief = a.text;
      briefInfo = { chars: a.chars, warnings: a.warnings };
      // a template personalized for someone is still a template: no progression warnings against their program
      if (edit.target_kind === "client") signals = a.signals;
      missing = a.missing;
      if (snap.kind === "client") {
        snap.maxSessionMinutes = a.maxSessionMinutes;
        snap.maxLifts = a.maxLifts;
      }
    }

    // 3. catalog, rules, the conversation
    const catalog = await loadCatalog(admin, snap, meta);
    let ctx: EngineCtx = { ...ctxFrom(catalog), signals };
    const rules = await loadRules(admin, athleteId, snap.today);
    const { data: earlier } = await admin
      .from("program_ai_edits")
      .select("id, instruction, status, result, rejected, created_at")
      .eq("thread_id", edit.thread_id)
      .lt("created_at", edit.created_at)
      .order("created_at");
    const turns: Turn[] = ((earlier ?? []) as any[]).map((t) => ({ instruction: t.instruction, status: t.status, result: t.result, rejected: t.rejected ?? [] }));
    const lastWithProposal = [...(earlier ?? [])].reverse().find((t: any) => t.result?.proposal && t.status !== "error") as any;
    const fingerprint = snapshotFingerprint(snap);
    const programChanged = !!lastWithProposal && lastWithProposal.result.fingerprint !== fingerprint;
    const applied = lastWithProposal?.status === "applied";
    // an applied proposal is done: a new ask starts a fresh proposal on the updated program
    // the carried proposal names exercises by the codes of the turn that made it: re-code them for this catalog
    let nextCode = catalog.length + 1;
    const names = new Map<string, CatalogExercise>(Object.entries((lastWithProposal?.result?.names ?? {}) as Record<string, CatalogExercise>));
    const current: EditChange[] = applied ? [] : recodeChanges((lastWithProposal?.result?.proposal ?? []) as EditChange[], (lastWithProposal?.result?.exercises ?? {}) as Record<string, CatalogExercise>, ctx, () => `X${nextCode++}`);
    ctx = { ...ctx, names };
    const obs = await admin
      .from("program_intel_observations")
      .select("statement, corrected_statement, status, kind")
      .eq("client_id", athleteId ?? "00000000-0000-0000-0000-000000000000")
      .in("status", ["approved", "corrected"])
      .order("created_at", { ascending: false })
      .limit(30);
    const observations = athleteId && obs.data?.length ? (obs.data as any[]).map((o) => `- ${o.corrected_statement || o.statement}`).join("\n") : null;

    const user = editUserPrompt({
      target: snap.kind === "client" ? `Client: ${snap.title}` : `Template: ${snap.title}`,
      templateNote,
      brief,
      rules: rulesText(rules),
      observations,
      program: programText(snap, ctx),
      catalog: catalogText([...ctx.catalog.values()]),
      conversation: conversationText(turns, current, programChanged && current.length > 0),
      instruction: edit.instruction,
    });

    // 4. ask, check, fix
    await stage(admin, edit.id, "Thinking it through");
    const started = Date.now();
    let reply: EditReply | null = null;
    let model = "";
    let prompt = user;
    for (let call = 1; call <= MAX_CALLS; call++) {
      const r = await callModel(admin, edit, call === 1 ? "edit" : `edit (fix ${call - 1})`, EDIT_SYSTEM_PROMPT, prompt);
      model = r.model;
      const parsed = parseReply(r.text);
      if (!parsed.ok) {
        if (call === MAX_CALLS || Date.now() - started > FIX_ROUND_BEFORE_MS) throw new Error(`The AI's reply wasn't usable: ${parsed.error}`);
        prompt = `${user}\n\nYour previous reply couldn't be used: ${parsed.error}\nReply again with ONE valid JSON object in exactly the required shape.`;
        continue;
      }
      reply = parsed.value;
      // exercises named instead of coded: look them up in the library
      const asked = exerciseNamesIn(reply.changes).filter((n) => !names.has(normName(n)));
      const notes: string[] = [];
      if (asked.length) {
        const { found, missing } = await resolveLibraryNames(admin, asked, nextCode);
        nextCode += found.size + missing.reduce((n, m) => n + m.candidates.length, 0);
        for (const [k, e] of found) names.set(k, e);
        for (const m of missing) {
          for (const c of m.candidates) ctx.catalog.set(c.code, c);
          notes.push(`"${m.name}" isn't in the exercise library.${m.candidates.length ? ` Closest library exercises: ${m.candidates.map((c) => `${c.code} ${c.name}`).join(", ")}.` : " Pick a catalog code."}`);
        }
      }
      ctx = { catalog: ctx.catalog, byId: new Map([...ctx.catalog.values(), ...names.values()].map((e) => [e.id, e])), names, signals };
      const merged = mergeProposal(programChanged ? [] : current, reply, edit.rejected ?? []);
      const problems = [...notes, ...fixable(snap, ctx, merged.changes.filter((c) => reply!.changes.some((x) => x.id === c.id) || merged.added.includes(c.id)))];
      if (!problems.length || call === MAX_CALLS || Date.now() - started > FIX_ROUND_BEFORE_MS) break;
      await stage(admin, edit.id, "Fixing a few details");
      prompt = `${user}\n\nYour previous reply:\n${r.text.slice(0, 20_000)}\n\nIt has problems the app won't accept:\n${problems.map((p) => `- ${p}`).join("\n")}\nReply again with the whole JSON object, fixed (same ids). Only codes from the catalog or the ones listed above.`;
    }
    if (!reply) throw new Error("The AI didn't reply.");

    // 5. the proposal
    await stage(admin, edit.id, "Checking the changes");
    if (snap.kind === "template" && reply.intent === "generate") reply = { ...reply, intent: "edit", generate: null };
    const merged = mergeProposal(programChanged ? [] : current, reply, edit.rejected ?? []);
    const resolved = resolveChanges(snap, merged.changes, ctx);
    // the exercises the proposal uses, so Apply resolves exactly the same ones
    const used: Record<string, CatalogExercise> = {};
    const usedNames: Record<string, CatalogExercise> = {};
    for (const c of merged.changes)
      for (const op of c.ops as any[]) {
        const refs = op.op === "add_day" ? op.exercises.map((e: any) => e.exercise) : op.exercise ? [op.exercise] : [];
        for (const ref of refs) {
          const code = String(ref).trim().toUpperCase();
          if (/^X\d+$/.test(code) && ctx.catalog.has(code)) used[code] = ctx.catalog.get(code)!;
          else if (names.has(normName(ref))) usedNames[normName(ref)] = names.get(normName(ref))!;
        }
      }
    // what the coach previewed: each ref's record and each touched workout's state, so Apply refuses anything that moved since
    const refs: Record<string, string> = {};
    const index = refIndex(snap);
    for (const c of merged.changes)
      for (const op of c.ops as any[]) for (const ref of [...(op.rows ?? []), ...(op.days ?? []), ...(op.weeks ?? [])]) {
        const hit = index.get(String(ref));
        if (hit) refs[String(ref)] = hit.id;
      }
    const bases: Record<string, unknown> = {};
    for (const b of buildPlan(snap, merged.changes, ctx).plan.day_bases) bases[b.id] = b;
    const result = {
      version: 1,
      refs,
      bases,
      prompt_version: EDIT_PROMPT_VERSION,
      intent: reply.intent,
      answer: reply.answer,
      analysis: reply.analysis,
      changes: resolved,
      proposal: merged.changes,
      merged: { carried: merged.carried, replaced: merged.replaced, added: merged.added, dropped: merged.dropped },
      generate: reply.intent === "generate" ? reply.generate ?? { notes: edit.instruction } : null,
      remember: reply.remember,
      questions: reply.questions,
      exercises: used,
      names: usedNames,
      fingerprint,
      revision: snap.revision ?? null,
      program: { title: snap.title, kind: snap.kind, blocks: snap.blocks.map((b) => ({ ref: b.ref, id: b.id, name: b.name, weeks: b.weeks.length })), trainingDays: snap.trainingDays, maxSessionMinutes: snap.maxSessionMinutes ?? null },
      context: { prompt_chars: user.length, brief_chars: briefInfo?.chars ?? 0, brief_warnings: briefInfo?.warnings ?? [], catalog: catalog.length, rules: rules.length, program_changed: programChanged, missing },
    };
    await admin
      .from("program_ai_edits")
      .update({ status: "ready", stage: null, result, model, prompt_version: EDIT_PROMPT_VERSION, finished_at: new Date().toISOString() })
      .eq("id", edit.id);
    return { status: "ready", editId: edit.id };
  } catch (e: any) {
    const message = String(e?.message ?? e).slice(0, 500);
    await admin.from("program_ai_edits").update({ status: "error", stage: null, error: message, finished_at: new Date().toISOString() }).eq("id", edit.id);
    return { status: "error", editId: edit.id, error: message };
  }
}

/** A carried change's exercise codes, mapped through the turn that wrote them to this turn's catalog. */
export function recodeChanges(changes: EditChange[], prev: Record<string, CatalogExercise>, ctx: EngineCtx, fresh: () => string): EditChange[] {
  const codeOf = new Map([...ctx.catalog.values()].map((e) => [e.id, e.code]));
  const recode = (ref: string): string => {
    const code = ref.trim().toUpperCase();
    const e = prev[code];
    if (!/^X\d+$/.test(code) || !e) return ref;
    let c = codeOf.get(e.id);
    if (!c) {
      c = fresh();
      ctx.catalog.set(c, { ...e, code: c });
      ctx.byId.set(e.id, { ...e, code: c });
      codeOf.set(e.id, c);
    }
    return c;
  };
  return changes.map((ch) => ({
    ...ch,
    ops: ch.ops.map((op: any) => (op.op === "add_day" ? { ...op, exercises: op.exercises.map((x: any) => ({ ...x, exercise: recode(x.exercise) })) } : op.exercise ? { ...op, exercise: recode(op.exercise) } : op)),
  }));
}
