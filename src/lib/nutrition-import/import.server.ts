/**
 * Meal plans brought into the Nutrition Studio, on the server (Nov 22 2026):
 * the AI read of an import and Cleo's draft, run in the background one step
 * per request (the nutrition-imports-tick hook, woken by the database the
 * moment one is queued and by pg_cron), filing a saved import's original in
 * the person's documents, and the files' clean-up. Server only.
 *
 * The model calls are OpenAI's background mode through the shared stagedCall:
 * submitted once and polled across requests (`progress`), so nothing holds a
 * request open and a request cut off never asks twice. An import's answer is
 * read by code (readAiAnswer) and checked against the file
 * (planGroundingFlags); a draft is checked like every plan the app writes
 * (withPrepFix's one fix round, withHonestTotals, draftFlags). Credits taken
 * when it was queued are settled when it finishes and given back if it fails.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAiAnswer, readPlanText, UnreadableAnswer } from "./read";
import { planGroundingFlags } from "./ground";
import { draftFlags, importFlags } from "./checks";
import { cleanAnswers, createQAs, createTargetsText, restrictionsOf, usableTargets } from "./create";
import { MEAL_IMPORT_FILE_DAYS, MEAL_IMPORT_ROW_DAYS } from "./rights";
import type { MealFlag, MealImportResult } from "./types";

type Db = SupabaseClient<any, any, any>;

export const MEAL_IMPORT_BUCKET = "nutrition-imports";
/** One request polls the model this long, then hands back and is woken again. */
export const MEAL_IMPORT_POLL = { ms: 40_000, every: 3_000 };
/** A model still thinking after this is given up on. */
export const MEAL_IMPORT_MODEL_LIMIT_MS = 20 * 60_000;
/** A read whose request was cut off is picked up again after this. */
export const STALE_READ_MS = 4 * 60_000;

export type MealImportRow = {
  id: string;
  user_id: string;
  kind: "import" | "create";
  audience: "member" | "staff";
  source_kind: string;
  file_name: string | null;
  file_paths: string[];
  source_text: string | null;
  answers: any;
  status: string;
  progress: any;
  credit_use_id: string | null;
  attempts: number;
};

const ROW_COLUMNS =
  "id, user_id, kind, audience, source_kind, file_name, file_paths, source_text, answers, status, progress, credit_use_id, attempts";

const toBase64 = (buf: Uint8Array) => {
  if (typeof Buffer !== "undefined") return Buffer.from(buf).toString("base64");
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** The PDF or photos the model reads, from storage, only when a call is about to be submitted. */
async function filesFor(sb: Db, row: MealImportRow) {
  const out: Array<{ kind: "pdf" | "image"; name: string; mime: string; base64: string }> = [];
  for (const path of row.file_paths) {
    const { data, error } = await sb.storage.from(MEAL_IMPORT_BUCKET).download(path);
    if (error || !data) throw new Error("The uploaded file is gone. Upload it again.");
    const pdf = /\.pdf$/i.test(path) || data.type === "application/pdf";
    out.push({
      kind: pdf ? "pdf" : "image",
      name: path.split("/").pop() ?? "meal-plan",
      mime: pdf ? "application/pdf" : data.type || "image/jpeg",
      base64: toBase64(new Uint8Array(await data.arrayBuffer())),
    });
  }
  return out;
}

async function settle(sb: Db, useId: string | null, ok: boolean, model: string | null, usage: { input: number; output: number } | null) {
  if (!useId) return;
  try {
    const { estimateCost } = await import("@/lib/ai/model-client.server");
    await (sb as any).rpc("ai_credits_settle", {
      _use_id: useId,
      _ok: ok,
      _model: model,
      _input_tokens: usage?.input ?? null,
      _output_tokens: usage?.output ?? null,
      _cost_usd: model && usage ? estimateCost(model, usage.input, usage.output) : null,
    });
  } catch (e: any) {
    console.error("[nutrition-import] settle failed", { useId, message: e?.message });
  }
}

/** The next import waiting on AI (or one whose read was cut off), claimed for this request. */
async function claim(sb: Db, id: string | null): Promise<MealImportRow | null> {
  const stale = new Date(Date.now() - STALE_READ_MS).toISOString();
  let q = sb
    .from("nutrition_imports")
    .select("id")
    .or(`status.eq.pending,and(status.eq.reading,updated_at.lt.${stale})`)
    .gt("updated_at", new Date(Date.now() - 2 * 86_400_000).toISOString())
    .order("updated_at", { ascending: true })
    .limit(1);
  if (id) q = q.eq("id", id);
  const { data: pick } = await q;
  const target = (pick as any[] | null)?.[0]?.id;
  if (!target) return null;
  const { data } = await sb
    .from("nutrition_imports")
    .update({ status: "reading", updated_at: new Date().toISOString() })
    .eq("id", target)
    .or(`status.eq.pending,and(status.eq.reading,updated_at.lt.${stale})`)
    .select(ROW_COLUMNS)
    .maybeSingle();
  return (data as MealImportRow | null) ?? null;
}

/** Runs one step of one import's AI read or one draft. */
export async function runQueuedMealImport(sb: Db, id: string | null): Promise<{ status: string; id?: string; cleaned?: number }> {
  const row = await claim(sb, id);
  if (!row) {
    const cleaned = await cleanUpMealImports(sb);
    return { status: "idle", ...(cleaned ? { cleaned } : {}) };
  }
  const { stagedCall, WaitingForModel, ModelsExhausted, OPENAI_CREDITS_HINT } = await import("@/lib/ai/staged-call.server");
  const { resolveRoute } = await import("@/lib/ai/routing");
  const { readRouteOverride } = await import("@/lib/ai/route-call.server");
  const state: any = row.progress ?? {};
  state.usage = state.usage ?? { input: 0, output: 0 };
  const save = async () => {
    await sb.from("nutrition_imports").update({ progress: state, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "reading");
  };
  const log = async (x: { model: string; ok: boolean; usage?: any }) => {
    if (x.ok && x.usage) {
      state.usage.input += Number(x.usage.input ?? 0);
      state.usage.output += Number(x.usage.output ?? 0);
    }
    state.model = x.ok ? x.model : state.model;
  };
  const override = await readRouteOverride(sb);
  const call = (task: "nutrition_import" | "nutrition_write", key: string, system: string, prompt: string, files?: () => Promise<any[]>) => {
    const route = resolveRoute(task, override);
    return stagedCall({
      state,
      key,
      route,
      req: { system, prompt, effort: route.effort, maxOutputTokens: route.maxOutputTokens, files, ...(task === "nutrition_write" ? { temperature: 0.3 } : {}) },
      save,
      log,
      poll: MEAL_IMPORT_POLL,
      backgroundLimitMs: MEAL_IMPORT_MODEL_LIMIT_MS,
      syncTimeoutMs: 170_000,
    });
  };

  const fail = async (message: string) => {
    // only a read still running fails: one discarded meanwhile stays discarded (its credits are back already)
    const { data: failed } = await sb
      .from("nutrition_imports")
      .update({ status: "failed", error: message.slice(0, 500), progress: null, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "reading")
      .select("id");
    await settle(sb, row.credit_use_id, false, state.model ?? null, state.usage);
    if ((failed as any[] | null)?.length) await notify(sb, row, false);
    return { status: "failed", id: row.id };
  };

  try {
    const result = row.kind === "create" ? await writeDraft(row, call) : await readImport(sb, row, call);
    // only a read still running becomes ready: one discarded while it was read gives its credits back
    const { data: done } = await sb
      .from("nutrition_imports")
      .update({ status: "ready", method: "ai", result, model: state.model ?? null, error: null, progress: null, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "reading")
      .select("id");
    if (!(done as any[] | null)?.length) {
      await settle(sb, row.credit_use_id, false, state.model ?? null, state.usage);
      return { status: "discarded", id: row.id };
    }
    await settle(sb, row.credit_use_id, true, state.model ?? null, state.usage);
    await notify(sb, row, true);
    return { status: "ready", id: row.id };
  } catch (e: any) {
    if (e instanceof WaitingForModel) {
      // back in the queue: the database wakes the hook again at once (queue_run on 'pending')
      await sb
        .from("nutrition_imports")
        .update({ status: "pending", progress: state, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "reading");
      return { status: "waiting", id: row.id };
    }
    if (e instanceof UnreadableAnswer)
      return fail(
        row.kind === "create"
          ? "The draft didn't come out as a meal plan. Try again."
          : "No meals could be read from it. Try again, or paste the plan as text.",
      );
    if (e instanceof ModelsExhausted) {
      console.error("[nutrition-import] no model answered", { id: row.id, tried: e.tried, errors: e.errors });
      return fail(`It couldn't be done right now. Try again in a few minutes.${e.noOpenAiCredits ? OPENAI_CREDITS_HINT : ""}`);
    }
    console.error("[nutrition-import] failed", { id: row.id, message: e?.message });
    return fail(String(e?.message ?? "Something went wrong.").slice(0, 300));
  }
}

type Call = (
  task: "nutrition_import" | "nutrition_write",
  key: string,
  system: string,
  prompt: string,
  files?: () => Promise<any[]>,
) => Promise<{ text: string; model: string }>;

/** An import read by AI: copied into the plan text, then checked against the file. */
async function readImport(sb: Db, row: MealImportRow, call: Call): Promise<MealImportResult> {
  const { MEAL_IMPORT_SYSTEM, mealImportPrompt } = await import("./ai-prompt.server");
  const fileKind = row.source_kind === "pdf" || row.source_kind === "image";
  const files = fileKind ? () => filesFor(sb, row) : undefined;
  const prompt = mealImportPrompt({ fileName: row.file_name, text: fileKind ? null : row.source_text, kind: row.source_kind });
  let answer;
  const first = await call("nutrition_import", "read", MEAL_IMPORT_SYSTEM, prompt, files);
  try {
    answer = readAiAnswer(first.text);
  } catch (e) {
    if (!(e instanceof UnreadableAnswer)) throw e;
    // one more try, told what went wrong (a cut-off answer, or the plan out of the format)
    const again = await call(
      "nutrition_import",
      "read2",
      MEAL_IMPORT_SYSTEM,
      `${prompt}\n\nYour last answer couldn't be read as a meal plan: no "… MENU" header with "Meal" lines and foods under it. Answer again in exactly the shape asked for.`,
      files,
    );
    answer = readAiAnswer(again.text);
  }
  const source = fileKind ? answer.transcript : row.source_text;
  const flags: MealFlag[] = [
    ...answer.unsure.map((text): MealFlag => ({ level: "check", code: "unsure", text })),
    ...planGroundingFlags(answer.read.text, source),
    ...importFlags(answer.read.text),
  ];
  if (fileKind && source)
    flags.push({
      level: "info",
      code: "unchecked",
      text: "Read from your file's pictures: it's checked against the text read from them, so compare the amounts with your file too.",
    });
  return { text: answer.read.text, flags, transcript: fileKind ? answer.transcript : null };
}

/**
 * Create with Cleo: written under the app's meal-plan rules to the member's own targets
 * (taken by the server when it was queued), one fix round when a check fails, every Daily
 * Total the sum of its meals, then what's still worth their look.
 */
async function writeDraft(row: MealImportRow, call: Call): Promise<MealImportResult> {
  const answers = cleanAnswers(row.answers?.answers);
  const targets = usableTargets(row.answers?.targets);
  if (!targets) throw new Error("Your targets weren't there to write to. Set your targets, then try again.");
  const { CREATE_SYSTEM, createUserPrompt } = await import("./create-prompt.server");
  const { withPrepFix } = await import("@/lib/nutrition-ai-plans.server");
  const { cleanAiText } = await import("@/lib/nutrition-ai-prompts.server");
  const { parseAiTargets } = await import("@/lib/nutrition-targets/nutrition-intel");
  const { withHonestTotals } = await import("@/lib/nutrition-targets/plan-coverage");
  const prompt = createUserPrompt(answers, targets);
  const qas = createQAs(answers);
  const avoid = restrictionsOf(answers).categories;
  const first = await call("nutrition_write", "write", CREATE_SYSTEM, prompt);
  let text = await withPrepFix(
    cleanAiText(first.text),
    prompt,
    // one round, its own key, so a resumed run reuses the answer it already has
    (p) => call("nutrition_write", "fix", CREATE_SYSTEM, p).then((r) => r.text),
    parseAiTargets(createTargetsText(targets)),
    1,
    qas,
    avoid,
  );
  // every Daily Total is the sum of its meals as written
  text = withHonestTotals(text);
  const read = readPlanText(text);
  if (!read) throw new UnreadableAnswer("No meals in the draft.");
  return { text: read.text, flags: draftFlags(read.text, { answers: qas, avoid, targets, mealPrep: answers.cooking === "meal_prep" }) };
}

/** "Your meal plan is ready to check" (or that it couldn't be done), once per import, for a member. */
async function notify(sb: Db, row: MealImportRow, ok: boolean) {
  if (row.audience !== "member") return;
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const draft = row.kind === "create";
    await sendWebPushToUser(
      sb as any,
      row.user_id,
      {
        title: ok ? (draft ? "Your meal plan draft is ready" : "Your meal plan is ready to check") : draft ? "Your draft couldn't be written" : "Your meal plan couldn't be read",
        body: ok
          ? draft
            ? "Check it over and make it yours in your meal plan."
            : `${row.file_name ?? "Your import"}: check it over and edit it in your meal plan.`
          : "Open it to try again. Your credits were given back.",
        url: `/portal/nutrition-studio?start=${draft ? "cleo" : "import"}`,
        tag: `nutrition-import-${row.id}`,
      },
      { eventKey: `nutrition_import:${row.id}:${ok ? "ready" : "failed"}` },
    );
  } catch (e: any) {
    console.error("[nutrition-import] push failed", { id: row.id, message: e?.message });
  }
}

/* ------------------------------------------------------------------ */
/*  Filing the original, and the files                                 */
/* ------------------------------------------------------------------ */

/** A stable id for an import's later pages (photo 2 of 4), so filing them again finds the same documents. */
export async function pageLinkId(importId: string, page: number): Promise<string> {
  if (page === 0) return importId;
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${importId}:page:${page}`)));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** A document's title for an import's original. */
export function originalTitle(row: Pick<MealImportRow, "file_name" | "source_kind">, page: number, pages: number): string {
  const base = (row.file_name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").trim() || (row.source_kind === "image" ? "Meal plan photos" : "Meal plan");
  return pages > 1 ? `${base} (${page + 1} of ${pages})` : base;
}

/**
 * A saved import's original filed in its owner's documents (documents library,
 * recordDocument: copied, private, linked to the import, idempotent), so it
 * outlives the import's 7-day clean-up: each uploaded file, or pasted text as a
 * .txt. A draft has no original. Never throws: a file that can't be filed is
 * logged and the save goes on.
 */
export async function fileImportOriginals(
  admin: Db,
  row: Pick<MealImportRow, "id" | "kind" | "source_kind" | "file_name" | "file_paths" | "source_text"> & {
    rights_text: string | null;
    rights_confirmed_at: string | null;
    files_deleted_at: string | null;
  },
  owner: { userId: string; clientId: string | null },
): Promise<string[]> {
  if (row.kind !== "import") return [];
  const { recordDocument } = await import("@/lib/documents/documents.server");
  const rights = row.rights_text && row.rights_confirmed_at ? { text: row.rights_text, confirmedAt: row.rights_confirmed_at } : null;
  const files: Array<{ title: string; linkedId: string; file: any }> = [];
  const paths = row.files_deleted_at ? [] : row.file_paths ?? [];
  for (const [i, path] of paths.entries())
    files.push({
      title: originalTitle(row, i, paths.length),
      linkedId: await pageLinkId(row.id, i),
      file: { bucket: MEAL_IMPORT_BUCKET, path, name: path.split("/").pop() },
    });
  if (!files.length && row.source_kind === "text" && row.source_text?.trim())
    files.push({
      title: "Pasted meal plan",
      linkedId: row.id,
      file: { data: new TextEncoder().encode(row.source_text), name: "pasted-meal-plan.txt", mime: "text/plain" },
    });
  const ids: string[] = [];
  for (const f of files) {
    const r = await recordDocument(admin, {
      ownerUserId: owner.userId,
      clientId: owner.clientId,
      category: "nutrition_plan",
      title: f.title,
      tags: [],
      visibility: "private",
      source: "import",
      linkedKind: "nutrition_import",
      linkedId: f.linkedId,
      rights,
      file: f.file,
    });
    if (r.ok) ids.push(r.document.id);
    else console.error("[nutrition-import] couldn't file the original", { id: row.id, error: r.error });
  }
  return ids;
}

/** Deletes an import's files from storage and says so on the row. */
export async function deleteMealImportFiles(sb: Db, id: string, paths: string[]) {
  if (paths.length) {
    const { error } = await sb.storage.from(MEAL_IMPORT_BUCKET).remove(paths);
    if (error) {
      console.error("[nutrition-import] file delete failed", { id, message: error.message });
      return false;
    }
  }
  await sb.from("nutrition_imports").update({ files_deleted_at: new Date().toISOString() }).eq("id", id);
  return true;
}

/**
 * Retention: files of imports that were saved or discarded, or are 7 days old,
 * are deleted. After 30 days an import that wasn't saved is deleted, and one
 * that was keeps only its record (who confirmed what, when, the plan and the
 * document it became): its text, answers and read are cleared.
 */
export async function cleanUpMealImports(sb: Db): Promise<number> {
  let n = 0;
  const week = new Date(Date.now() - MEAL_IMPORT_FILE_DAYS * 86_400_000).toISOString();
  const { data: withFiles } = await sb
    .from("nutrition_imports")
    .select("id, file_paths")
    .is("files_deleted_at", null)
    // a failed read keeps its file for a retry until the week is up
    .or(`status.in.(saved,discarded),created_at.lt.${week}`)
    .limit(20);
  for (const r of (withFiles ?? []) as Array<{ id: string; file_paths: string[] }>) {
    if (!r.file_paths?.length) {
      await sb.from("nutrition_imports").update({ files_deleted_at: new Date().toISOString() }).eq("id", r.id);
      continue;
    }
    if (await deleteMealImportFiles(sb, r.id, r.file_paths)) n++;
  }
  const month = new Date(Date.now() - MEAL_IMPORT_ROW_DAYS * 86_400_000).toISOString();
  const { data: old } = await sb
    .from("nutrition_imports")
    .select("id, status, file_paths, files_deleted_at")
    .lt("created_at", month)
    .or("status.neq.saved,source_text.not.is.null,result.not.is.null,answers.not.is.null")
    .limit(100);
  for (const r of (old ?? []) as Array<{ id: string; status: string; file_paths: string[]; files_deleted_at: string | null }>) {
    if (r.file_paths?.length && !r.files_deleted_at && !(await deleteMealImportFiles(sb, r.id, r.file_paths))) continue;
    if (r.status === "saved")
      await sb.from("nutrition_imports").update({ source_text: null, result: null, answers: null, progress: null }).eq("id", r.id);
    else await sb.from("nutrition_imports").delete().eq("id", r.id);
    n++;
  }
  return n;
}
