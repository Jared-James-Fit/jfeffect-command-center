/**
 * The import screen's server calls (Nov 21 2026). Every one runs as the
 * signed-in person (requireSupabaseAuth) and checks they may build programs
 * (athlete_program_can_author, the builder's own rule) before the server
 * writes anything with the service role.
 *
 *   startProgramImport   the parser first (free, instant); AI only when the
 *                        parser can't read it all, or for a PDF / photos
 *                        (AI credits, refunded if the read fails)
 *   retryProgramImport   a failed AI read, again
 *   rereadProgramImport  a file the parser read, read again with AI (the
 *                        person thinks the parser got it wrong)
 *   discardProgramImport an import they don't want (its files deleted now)
 *   markProgramImportSaved  the program was saved from it (files deleted now)
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CreditState } from "@/lib/ai-credits/packs";
import { IMPORT_RIGHTS_TEXT } from "./rights";

/** At most this many imports a day each (storage and AI are shared). */
export const IMPORTS_PER_DAY = 12;
const MAX_TEXT = 150_000;
const MAX_CELLS = 40_000;

const Sheet = z.object({ name: z.string().max(400), rows: z.array(z.array(z.string().max(2000)).max(60)).max(2000) });

const StartInput = z.object({
  kind: z.enum(["text", "csv", "xlsx", "docx", "pdf", "image"]),
  fileName: z.string().trim().max(200).nullable().optional(),
  text: z.string().max(MAX_TEXT).nullable().optional(),
  sheets: z.array(Sheet).max(40).nullable().optional(),
  paths: z.array(z.string().max(300)).max(10).optional(),
  bytes: z.number().int().nonnegative().max(60 * 1024 * 1024).optional(),
  rightsConfirmed: z.literal(true),
  /** Read it with AI even though the parser could (the person asked). */
  forceAi: z.boolean().optional(),
  /** Out of credits: take what the parser could read and review it as is. */
  acceptPartial: z.boolean().optional(),
});

async function mayAuthor(supabase: any): Promise<boolean> {
  const { data, error } = await supabase.rpc("athlete_program_can_author");
  return !error && data === true;
}

export type StartResult =
  | { ok: true; id: string; status: "ready" | "pending" }
  | { ok: false; reason: "out_of_credits"; credits: CreditState | null; partial: boolean }
  | { ok: false; reason: "too_many" | "nothing_found" | "not_allowed"; message: string };

export const startProgramImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => StartInput.parse(i))
  .handler(async ({ data, context }): Promise<StartResult> => {
    const { supabase, userId } = context as any;
    if (!(await mayAuthor(supabase))) return { ok: false, reason: "not_allowed", message: "Your account can't build programs." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await sb.from("program_imports").select("id", { count: "exact", head: true }).eq("user_id", userId).gt("created_at", since);
    if ((count ?? 0) >= IMPORTS_PER_DAY)
      return { ok: false, reason: "too_many", message: `That's ${IMPORTS_PER_DAY} imports today. Try again tomorrow.` };

    const fileKind = data.kind === "pdf" || data.kind === "image";
    const paths = (data.paths ?? []).filter(Boolean);
    if (fileKind) {
      if (!paths.length) return { ok: false, reason: "nothing_found", message: "Add the file first." };
      // only their own folder (the bucket's policy wrote it there)
      if (paths.some((p) => !p.startsWith(`${userId}/`) || p.includes("..")))
        return { ok: false, reason: "not_allowed", message: "That file isn't yours." };
    }
    const cells = (data.sheets ?? []).reduce((n, s) => n + s.rows.reduce((m, r) => m + r.length, 0), 0);
    const sheets = cells <= MAX_CELLS ? data.sheets ?? undefined : undefined;
    const text = data.text?.trim() || null;
    if (!fileKind && !text) return { ok: false, reason: "nothing_found", message: "There's nothing to read in it." };

    // the parser first: free, instant, and exact when the file is laid out plainly
    let parsed: { program: unknown; confident: boolean; exercises: number } | null = null;
    if (!fileKind && text) {
      const { parseSource } = await import("./parse");
      const out = parseSource({ kind: data.kind, name: data.fileName ?? "", text, sheets });
      parsed = { program: out.program, confident: out.confident, exercises: out.exercises };
    }
    const row = {
      user_id: userId,
      source_kind: data.kind,
      file_name: data.fileName ?? null,
      file_paths: paths,
      file_bytes: data.bytes ?? null,
      source_text: text,
      rights_confirmed_at: new Date().toISOString(),
      rights_text: IMPORT_RIGHTS_TEXT,
    };

    const usePartial = !!parsed && parsed.exercises > 0 && (parsed.confident || data.acceptPartial) && !data.forceAi;
    if (usePartial) {
      const { data: ins, error } = await sb
        .from("program_imports")
        .insert({ ...row, status: "ready", method: "parsed", result: parsed!.program })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true, id: ins.id, status: "ready" };
    }

    // AI: taken now, settled when the read finishes (given back if it fails)
    const { data: use, error: useError } = await sb.rpc("ai_credits_use", { _user: userId, _feature: "program_import", _ref: null });
    if (useError) throw new Error(`Couldn't check your AI credits: ${useError.message}`);
    if (!use?.ok) return { ok: false, reason: "out_of_credits", credits: (use?.state ?? null) as CreditState | null, partial: !!parsed && parsed.exercises > 0 };
    const { data: ins, error } = await sb
      .from("program_imports")
      .insert({ ...row, status: "pending", credit_use_id: use.use_id })
      .select("id")
      .single();
    if (error) {
      await sb.rpc("ai_credits_settle", { _use_id: use.use_id, _ok: false });
      throw new Error(error.message);
    }
    await sb.from("ai_credit_events").update({ ref: `program_import:${ins.id}` }).eq("id", use.use_id);
    return { ok: true, id: ins.id, status: "pending" };
  });

const IdInput = z.object({ id: z.string().uuid() });

async function ownImport(sb: any, id: string, userId: string) {
  const { data } = await sb
    .from("program_imports")
    .select("id, user_id, status, method, file_paths, files_deleted_at, credit_use_id")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.user_id !== userId) throw new Error("Import not found.");
  return data as { id: string; status: string; method: string | null; file_paths: string[]; files_deleted_at: string | null; credit_use_id: string | null };
}

export const retryProgramImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const imp = await ownImport(sb, data.id, userId);
    if (imp.status !== "failed") return { ok: true as const };
    if (imp.files_deleted_at) return { ok: false as const, message: "Its file was deleted. Start a new import." };
    const { data: use, error } = await sb.rpc("ai_credits_use", { _user: userId, _feature: "program_import", _ref: `program_import:${imp.id}` });
    if (error) throw new Error(`Couldn't check your AI credits: ${error.message}`);
    if (!use?.ok)
      return { ok: false as const, outOfCredits: true, credits: (use?.state ?? null) as CreditState | null, message: "You're out of AI credits for this month." };
    await sb
      .from("program_imports")
      .update({ status: "pending", error: null, progress: null, credit_use_id: use.use_id, attempts: 0, updated_at: new Date().toISOString() })
      .eq("id", imp.id);
    return { ok: true as const };
  });

export const rereadProgramImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!(await mayAuthor(supabase))) return { ok: false as const, message: "Your account can't build programs." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const imp = await ownImport(sb, data.id, userId);
    if (imp.status !== "ready" || imp.method !== "parsed") return { ok: false as const, message: "This import can't be read again." };
    const { data: use, error } = await sb.rpc("ai_credits_use", { _user: userId, _feature: "program_import", _ref: `program_import:${imp.id}` });
    if (error) throw new Error(`Couldn't check your AI credits: ${error.message}`);
    if (!use?.ok)
      return { ok: false as const, outOfCredits: true, credits: (use?.state ?? null) as CreditState | null, message: "You're out of AI credits for this month." };
    await sb
      .from("program_imports")
      .update({
        status: "pending",
        method: null,
        result: null,
        error: null,
        progress: null,
        credit_use_id: use.use_id,
        attempts: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", imp.id);
    return { ok: true as const };
  });

export const discardProgramImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const imp = await ownImport(sb, data.id, userId);
    if (imp.status === "saved") return { ok: true };
    const wasRunning = imp.status === "pending" || imp.status === "reading";
    await sb.from("program_imports").update({ status: "discarded", progress: null, updated_at: new Date().toISOString() }).eq("id", imp.id);
    // a read still running when it was discarded gives its credits back
    if (wasRunning && imp.credit_use_id) await sb.rpc("ai_credits_settle", { _use_id: imp.credit_use_id, _ok: false });
    if (!imp.files_deleted_at) {
      const { deleteImportFiles } = await import("./import.server");
      await deleteImportFiles(sb, imp.id, imp.file_paths ?? []);
    }
    return { ok: true };
  });

export const markProgramImportSaved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), programId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const imp = await ownImport(sb, data.id, userId);
    const { data: prog } = await sb.from("athlete_programs").select("id, owner_id").eq("id", data.programId).maybeSingle();
    if (!prog || prog.owner_id !== userId) throw new Error("Program not found.");
    await sb
      .from("program_imports")
      .update({ status: "saved", program_id: prog.id, progress: null, updated_at: new Date().toISOString() })
      .eq("id", imp.id);
    if (!imp.files_deleted_at) {
      const { deleteImportFiles } = await import("./import.server");
      await deleteImportFiles(sb, imp.id, imp.file_paths ?? []);
    }
    return { ok: true };
  });
