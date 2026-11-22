/**
 * Program imports on the server (Nov 21 2026): an AI read run in the
 * background, one step per request (the program-imports-tick hook, woken by
 * the database the moment an import is queued and by pg_cron), and the files'
 * clean-up. Server only.
 *
 * The AI call is OpenAI's background mode through the shared stagedCall: it's
 * submitted once and polled across requests (`progress`), so a long program
 * never holds a request open and a request cut off never asks twice. The
 * answer is read by code (readAiImport) and stored as the program it found;
 * the person reviews it, checked against the file (toDraft's flags), before
 * anything is saved. Credits taken when the import was queued are settled
 * when it finishes and given back if it fails.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAiImport, UnreadableAnswer } from "./ai";
import { IMPORT_SYSTEM, importPrompt } from "./ai-prompt.server";
import { IMPORT_FILE_DAYS, IMPORT_ROW_DAYS } from "./rights";
import type { ImportedProgram } from "./types";

type Db = SupabaseClient<any, any, any>;

export const IMPORT_BUCKET = "program-imports";
/** One request polls the model this long, then hands back and is woken again. */
export const IMPORT_POLL = { ms: 40_000, every: 3_000 };
/** A model still thinking after this is given up on. */
export const IMPORT_MODEL_LIMIT_MS = 20 * 60_000;
/** A read whose request was cut off is picked up again after this. */
export const STALE_READ_MS = 4 * 60_000;

type Row = {
  id: string;
  user_id: string;
  source_kind: string;
  file_name: string | null;
  file_paths: string[];
  source_text: string | null;
  status: string;
  progress: any;
  credit_use_id: string | null;
  attempts: number;
};

/** The files a PDF / photo import sends the model, read from storage only when a call is about to be submitted. */
async function filesFor(sb: Db, row: Row) {
  const out: Array<{ kind: "pdf" | "image"; name: string; mime: string; base64: string }> = [];
  for (const path of row.file_paths) {
    const { data, error } = await sb.storage.from(IMPORT_BUCKET).download(path);
    if (error || !data) throw new Error("The uploaded file is gone. Upload it again.");
    const buf = new Uint8Array(await data.arrayBuffer());
    let base64: string;
    if (typeof Buffer !== "undefined") base64 = Buffer.from(buf).toString("base64");
    else {
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      base64 = btoa(bin);
    }
    const pdf = /\.pdf$/i.test(path) || data.type === "application/pdf";
    out.push({
      kind: pdf ? "pdf" : "image",
      name: path.split("/").pop() ?? "program",
      mime: pdf ? "application/pdf" : data.type || "image/jpeg",
      base64,
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
    console.error("[program-import] settle failed", { useId, message: e?.message });
  }
}

/** The next import waiting on AI (or one whose read was cut off), claimed for this request. */
async function claim(sb: Db, id: string | null): Promise<Row | null> {
  const stale = new Date(Date.now() - STALE_READ_MS).toISOString();
  let q = sb
    .from("program_imports")
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
    .from("program_imports")
    .update({ status: "reading", updated_at: new Date().toISOString() })
    .eq("id", target)
    .or(`status.eq.pending,and(status.eq.reading,updated_at.lt.${stale})`)
    .select("id, user_id, source_kind, file_name, file_paths, source_text, status, progress, credit_use_id, attempts")
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** Runs one step of one import's AI read. */
export async function runQueuedImport(sb: Db, id: string | null): Promise<{ status: string; id?: string }> {
  const row = await claim(sb, id);
  if (!row) {
    const cleaned = await cleanUpImports(sb);
    return { status: "idle", ...(cleaned ? { cleaned } : {}) } as any;
  }
  const { stagedCall, WaitingForModel, ModelsExhausted, OPENAI_CREDITS_HINT } = await import("@/lib/ai/staged-call.server");
  const { resolveRoute } = await import("@/lib/ai/routing");
  const { readRouteOverride } = await import("@/lib/ai/route-call.server");
  const state: any = row.progress ?? {};
  state.usage = state.usage ?? { input: 0, output: 0 };
  const save = async () => {
    await sb.from("program_imports").update({ progress: state, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "reading");
  };
  const route = resolveRoute("program_import", await readRouteOverride(sb));
  const files = row.source_kind === "pdf" || row.source_kind === "image" ? () => filesFor(sb, row) : undefined;
  const prompt = importPrompt({ fileName: row.file_name, text: row.source_text, kind: row.source_kind });
  const log = async (x: { model: string; ok: boolean; usage?: any }) => {
    if (x.ok && x.usage) {
      state.usage.input += Number(x.usage.input ?? 0);
      state.usage.output += Number(x.usage.output ?? 0);
    }
    state.model = x.ok ? x.model : state.model;
  };
  const ask = (key: string, extra = "") =>
    stagedCall({
      state,
      key,
      route,
      req: { system: IMPORT_SYSTEM, prompt: prompt + extra, effort: route.effort, maxOutputTokens: route.maxOutputTokens, files },
      save,
      log,
      poll: IMPORT_POLL,
      backgroundLimitMs: IMPORT_MODEL_LIMIT_MS,
      syncTimeoutMs: 170_000,
    });

  const fail = async (message: string) => {
    await sb
      .from("program_imports")
      .update({ status: "failed", error: message.slice(0, 500), progress: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    await settle(sb, row.credit_use_id, false, state.model ?? null, state.usage);
    await notify(sb, row, false);
    return { status: "failed", id: row.id };
  };

  try {
    let program: ImportedProgram;
    const first = await ask("read");
    try {
      program = readAiImport(first.text);
    } catch (e) {
      if (!(e instanceof UnreadableAnswer)) throw e;
      // one more try, told what went wrong (a cut-off or malformed answer)
      const again = await ask(
        "read2",
        "\n\nYour last answer couldn't be read as JSON (it may have been cut off). Answer again with the complete JSON only, leaving out every null or empty key to keep it short.",
      );
      program = readAiImport(again.text);
    }
    // the person may have discarded it while it was being read
    const { data: now } = await sb.from("program_imports").select("status").eq("id", row.id).maybeSingle();
    if ((now as any)?.status !== "reading") {
      await settle(sb, row.credit_use_id, false, state.model ?? null, state.usage);
      return { status: "discarded", id: row.id };
    }
    await sb
      .from("program_imports")
      .update({
        status: "ready",
        method: "ai",
        result: program,
        model: state.model ?? null,
        error: null,
        progress: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    await settle(sb, row.credit_use_id, true, state.model ?? null, state.usage);
    await notify(sb, row, true);
    return { status: "ready", id: row.id };
  } catch (e: any) {
    if (e instanceof WaitingForModel) {
      // back in the queue: the database wakes the hook again at once (queue_run on 'pending')
      await sb
        .from("program_imports")
        .update({ status: "pending", progress: state, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "reading");
      return { status: "waiting", id: row.id };
    }
    if (e instanceof UnreadableAnswer) return fail("Something went wrong with the full read. Try again, or paste the program as text.");
    if (e instanceof ModelsExhausted) {
      console.error("[program-import] no model answered", { id: row.id, tried: e.tried, errors: e.errors });
      return fail(`The program couldn't be read right now. Try again in a few minutes.${e.noOpenAiCredits ? OPENAI_CREDITS_HINT : ""}`);
    }
    console.error("[program-import] read failed", { id: row.id, message: e?.message });
    return fail(String(e?.message ?? "The program couldn't be read.").slice(0, 300));
  }
}

/** "Your program is ready to review" (or that it couldn't be read), once per import. */
async function notify(sb: Db, row: Row, ok: boolean) {
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    await sendWebPushToUser(
      sb as any,
      row.user_id,
      {
        title: ok ? "Your program is ready to review" : "Your program couldn't be read",
        body: ok
          ? `${row.file_name ?? "Your import"}: check it over and save it to your programs.`
          : "Open it to try again, or paste the program as text.",
        url: `/portal/programs/import?id=${row.id}`,
        tag: `program-import-${row.id}`,
      },
      { category: "workouts", eventKey: `program_import:${row.id}:${ok ? "ready" : "failed"}` },
    );
  } catch (e: any) {
    console.error("[program-import] push failed", { id: row.id, message: e?.message });
  }
}

/** Deletes an import's files from storage and says so on the row. */
export async function deleteImportFiles(sb: Db, id: string, paths: string[]) {
  if (paths.length) {
    const { error } = await sb.storage.from(IMPORT_BUCKET).remove(paths);
    if (error) {
      console.error("[program-import] file delete failed", { id, message: error.message });
      return false;
    }
  }
  await sb.from("program_imports").update({ files_deleted_at: new Date().toISOString() }).eq("id", id);
  return true;
}

/**
 * Retention: files of imports that were saved or discarded, or are 7 days
 * old, are deleted. After 30 days an import that wasn't saved is deleted, and
 * one that was keeps only its record (who confirmed what, when, and the
 * program it made): the file's text and the read are cleared. The saved
 * program stays either way.
 */
export async function cleanUpImports(sb: Db): Promise<number> {
  let n = 0;
  const week = new Date(Date.now() - IMPORT_FILE_DAYS * 86_400_000).toISOString();
  const { data: withFiles } = await sb
    .from("program_imports")
    .select("id, file_paths, status, created_at")
    .is("files_deleted_at", null)
    // a failed read keeps its file for a retry until the week is up
    .or(`status.in.(saved,discarded),created_at.lt.${week}`)
    .limit(20);
  for (const r of (withFiles ?? []) as Array<{ id: string; file_paths: string[] }>) {
    if (!r.file_paths?.length) {
      await sb.from("program_imports").update({ files_deleted_at: new Date().toISOString() }).eq("id", r.id);
      continue;
    }
    if (await deleteImportFiles(sb, r.id, r.file_paths)) n++;
  }
  const month = new Date(Date.now() - IMPORT_ROW_DAYS * 86_400_000).toISOString();
  const { data: old } = await sb
    .from("program_imports")
    .select("id, status, file_paths, files_deleted_at")
    .lt("created_at", month)
    .or("status.neq.saved,source_text.not.is.null,result.not.is.null")
    .limit(100);
  for (const r of (old ?? []) as Array<{ id: string; status: string; file_paths: string[]; files_deleted_at: string | null }>) {
    if (r.file_paths?.length && !r.files_deleted_at && !(await deleteImportFiles(sb, r.id, r.file_paths))) continue;
    if (r.status === "saved")
      await sb.from("program_imports").update({ source_text: null, result: null, progress: null }).eq("id", r.id);
    else await sb.from("program_imports").delete().eq("id", r.id);
    n++;
  }
  return n;
}
