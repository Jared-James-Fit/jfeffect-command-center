/**
 * The meal-plan import and Create with Cleo server calls (Nov 22 2026). Every
 * one runs as the signed-in person (requireSupabaseAuth) and checks who they
 * are with their own login before the server writes anything with the
 * service role:
 *
 *   startMealPlanImport   a JF member (their Studio) or a coach (the plan
 *                         editor): the app's own reader first (free,
 *                         instant); AI only when it can't read it, or for a
 *                         PDF / photos (a member's costs AI credits, refunded
 *                         if the read fails; a coach's never)
 *   startMealPlanCreate   a JF member's Cleo draft: their own saved targets,
 *                         the safety screen in code, then AI credits
 *   retryMealPlanImport   a failed read or draft, again
 *   rereadMealPlanImport  a plan the app read itself, read in full by AI
 *   discardMealPlanImport one they don't want (its files deleted now)
 *   markMealPlanImportSaved  the plan was saved from it: its original filed
 *                         in their documents, its files deleted
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CreditState } from "@/lib/ai-credits/packs";
import { rightsTextFor } from "./rights";
import { ageOn, cleanAnswers, createSafety, missingAnswers, phaseForGoal, usableTargets, type MemberTargets } from "./create";
import { readPlanText } from "./read";
import { importFlags } from "./checks";
import type { MealImportResult } from "./types";

/** At most this many imports and drafts a day each (storage and AI are shared). */
export const MEAL_IMPORTS_PER_DAY = 12;
export const MEAL_DRAFTS_PER_DAY = 6;
const MAX_TEXT = 100_000;

type Ctx = { supabase: any; userId: string };

/** The caller's own JF member record (self-serve), read with their own login, or null. */
async function memberClient(ctx: Ctx): Promise<{ id: string; date_of_birth: string | null } | null> {
  const { data } = await ctx.supabase
    .from("clients")
    .select("id, service_tier, archived, date_of_birth")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!data || data.service_tier !== "self_serve" || data.archived) return null;
  return { id: data.id, date_of_birth: data.date_of_birth ?? null };
}

async function isStaff(ctx: Ctx): Promise<boolean> {
  const [a, c] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "coach" }),
  ]);
  return a.data === true || c.data === true;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function countToday(sb: any, userId: string, kind: "import" | "create"): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await sb
    .from("nutrition_imports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gt("created_at", since);
  return count ?? 0;
}

/** A path inside the caller's own folder of the bucket (the bucket's policy wrote it there). */
const ownPath = (p: string, userId: string) => p.startsWith(`${userId}/`) && !p.includes("..") && p.length <= 300;

const StartInput = z.object({
  audience: z.enum(["member", "staff"]),
  kind: z.enum(["text", "csv", "xlsx", "docx", "pdf", "image"]),
  fileName: z.string().trim().max(200).nullable().optional(),
  text: z.string().max(MAX_TEXT).nullable().optional(),
  /** PDF / photos: what the AI reads. Any other file: its original, kept to file in their documents. */
  paths: z.array(z.string().max(300)).max(8).optional(),
  bytes: z.number().int().nonnegative().max(60 * 1024 * 1024).optional(),
  rightsConfirmed: z.literal(true),
  /** Read it in full even though the app's reader could (they asked). */
  forceAi: z.boolean().optional(),
});

export type StartImportResult =
  | { ok: true; id: string; status: "ready" | "pending"; result?: MealImportResult }
  | { ok: false; reason: "out_of_credits"; credits: CreditState | null }
  | { ok: false; reason: "too_many" | "nothing_found" | "not_allowed"; message: string };

export const startMealPlanImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => StartInput.parse(i))
  .handler(async ({ data, context }): Promise<StartImportResult> => {
    const ctx = context as unknown as Ctx;
    if (data.audience === "member" ? !(await memberClient(ctx)) : !(await isStaff(ctx)))
      return {
        ok: false,
        reason: "not_allowed",
        message: data.audience === "member" ? "Your coach writes your meal plan." : "Only coaches can import a client's plan.",
      };
    const sb = await admin();
    if ((await countToday(sb, ctx.userId, "import")) >= MEAL_IMPORTS_PER_DAY)
      return { ok: false, reason: "too_many", message: `That's ${MEAL_IMPORTS_PER_DAY} imports today. Try again tomorrow.` };

    const fileKind = data.kind === "pdf" || data.kind === "image";
    const paths = (data.paths ?? []).filter(Boolean);
    if (paths.some((p) => !ownPath(p, ctx.userId))) return { ok: false, reason: "not_allowed", message: "That file isn't yours." };
    if (fileKind && !paths.length) return { ok: false, reason: "nothing_found", message: "Add the file first." };
    if (!fileKind && paths.length > 1) return { ok: false, reason: "nothing_found", message: "One file at a time." };
    const text = fileKind ? null : data.text?.trim() || null;
    if (!fileKind && !text) return { ok: false, reason: "nothing_found", message: "There's nothing to read in it." };

    const row = {
      user_id: ctx.userId,
      kind: "import",
      audience: data.audience,
      source_kind: data.kind,
      file_name: data.fileName ?? null,
      file_paths: paths,
      file_bytes: data.bytes ?? null,
      source_text: text,
      rights_confirmed_at: new Date().toISOString(),
      rights_text: rightsTextFor(data.audience),
    };

    // the app's own reader first: free, instant, and exact when it's laid out as a plan
    const read = !fileKind && text && !data.forceAi ? readPlanText(text) : null;
    if (read) {
      const result: MealImportResult = { text: read.text, flags: importFlags(read.text), transcript: null };
      const { data: ins, error } = await sb.from("nutrition_imports").insert({ ...row, status: "ready", method: "parsed", result }).select("id").single();
      if (error) throw new Error(error.message);
      return { ok: true, id: ins.id, status: "ready", result };
    }

    // AI: a member's is taken now and settled when the read finishes (given back if it fails); a coach's is never charged
    let useId: string | null = null;
    if (data.audience === "member") {
      const { data: use, error: useError } = await sb.rpc("ai_credits_use", { _user: ctx.userId, _feature: "nutrition_import", _ref: null });
      if (useError) throw new Error(`Couldn't check your credits: ${useError.message}`);
      if (!use?.ok) return { ok: false, reason: "out_of_credits", credits: (use?.state ?? null) as CreditState | null };
      useId = use.use_id;
    }
    const { data: ins, error } = await sb.from("nutrition_imports").insert({ ...row, status: "pending", credit_use_id: useId }).select("id").single();
    if (error) {
      if (useId) await sb.rpc("ai_credits_settle", { _use_id: useId, _ok: false });
      throw new Error(error.message);
    }
    if (useId) await sb.from("ai_credit_events").update({ ref: `nutrition_import:${ins.id}` }).eq("id", useId);
    return { ok: true, id: ins.id, status: "pending" };
  });

/* ------------------------------------------------------------------ */
/*  Create with Cleo                                                   */
/* ------------------------------------------------------------------ */

/**
 * The member's own saved targets, read with their own login: their calculator's
 * (member_nutrition_targets), else the numbers of the plan they wrote themselves.
 */
async function ownTargets(ctx: Ctx, clientId: string): Promise<MemberTargets | null> {
  const { data: member } = await ctx.supabase.from("app_members").select("id").eq("user_id", ctx.userId).maybeSingle();
  if (member?.id) {
    const { data } = await ctx.supabase
      .from("member_nutrition_targets")
      .select("calories, protein_g, carbs_g, fat_g, goal")
      .eq("member_id", member.id)
      .eq("active", true)
      .maybeSingle();
    const t = usableTargets(data);
    if (t) return t;
  }
  const { data: plan } = await ctx.supabase
    .from("nutrition_targets")
    .select("assigned_coach_id, phase, nutrition_target_days(calories, protein, carbs, fats, sort_order)")
    .eq("client_id", clientId)
    .neq("status", "Archived")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!plan || plan.assigned_coach_id) return null;
  const day = ((plan.nutrition_target_days ?? []) as any[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).find((d) => d.calories);
  const goal = /loss|cut/i.test(plan.phase ?? "") ? "lose" : /gain|bulk/i.test(plan.phase ?? "") ? "gain" : "maintain";
  return day ? usableTargets({ calories: day.calories, protein_g: day.protein, carbs_g: day.carbs, fat_g: day.fats, goal }) : null;
}

export type StartCreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: "out_of_credits"; credits: CreditState | null }
  | { ok: false; reason: "no_targets" | "safety" | "too_many" | "not_allowed" | "missing"; message: string };

export const startMealPlanCreate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ answers: z.record(z.string(), z.unknown()) }).parse(i))
  .handler(async ({ data, context }): Promise<StartCreateResult> => {
    const ctx = context as unknown as Ctx;
    const me = await memberClient(ctx);
    if (!me) return { ok: false, reason: "not_allowed", message: "Your coach writes your meal plan." };
    const answers = cleanAnswers(data.answers);
    if (missingAnswers(answers).length) return { ok: false, reason: "missing", message: "Answer the questions first." };

    // the safety screen, in code, before anything is asked of a model (their answers, their health profile, their age)
    const { data: items } = await ctx.supabase
      .from("client_health_items")
      .select("kind, label, details, status")
      .eq("client_id", me.id)
      .eq("status", "active")
      .in("kind", ["condition", "medication"]);
    const healthTexts = ((items ?? []) as any[]).map((i) => [i.label, i.details].filter(Boolean).join(": "));
    let dob = me.date_of_birth;
    if (!dob) {
      const { data: m } = await ctx.supabase.from("app_members").select("date_of_birth").eq("user_id", ctx.userId).maybeSingle();
      dob = m?.date_of_birth ?? null;
    }
    const safety = createSafety(answers, { age: ageOn(dob), healthTexts });
    if (!safety.ok) return { ok: false, reason: "safety", message: safety.message };

    // their own targets, never the model's
    const targets = await ownTargets(ctx, me.id);
    if (!targets) return { ok: false, reason: "no_targets", message: "Set your calorie and macro targets first, then Cleo writes to them." };

    const sb = await admin();
    if ((await countToday(sb, ctx.userId, "create")) >= MEAL_DRAFTS_PER_DAY)
      return { ok: false, reason: "too_many", message: `That's ${MEAL_DRAFTS_PER_DAY} drafts today. Try again tomorrow.` };
    const { data: use, error: useError } = await sb.rpc("ai_credits_use", { _user: ctx.userId, _feature: "nutrition_create", _ref: null });
    if (useError) throw new Error(`Couldn't check your credits: ${useError.message}`);
    if (!use?.ok) return { ok: false, reason: "out_of_credits", credits: (use?.state ?? null) as CreditState | null };
    const { data: ins, error } = await sb
      .from("nutrition_imports")
      .insert({
        user_id: ctx.userId,
        kind: "create",
        audience: "member",
        source_kind: "answers",
        answers: { answers, targets, phase: phaseForGoal(targets.goal) },
        status: "pending",
        credit_use_id: use.use_id,
      })
      .select("id")
      .single();
    if (error) {
      await sb.rpc("ai_credits_settle", { _use_id: use.use_id, _ok: false });
      throw new Error(error.message);
    }
    await sb.from("ai_credit_events").update({ ref: `nutrition_create:${ins.id}` }).eq("id", use.use_id);
    return { ok: true, id: ins.id };
  });

/* ------------------------------------------------------------------ */
/*  One import, afterwards                                             */
/* ------------------------------------------------------------------ */

const IdInput = z.object({ id: z.string().uuid() });

type OwnRow = {
  id: string;
  user_id: string;
  kind: "import" | "create";
  audience: "member" | "staff";
  status: string;
  method: string | null;
  source_kind: string;
  file_name: string | null;
  file_paths: string[];
  source_text: string | null;
  files_deleted_at: string | null;
  credit_use_id: string | null;
  rights_text: string | null;
  rights_confirmed_at: string | null;
};

async function ownImport(sb: any, id: string, userId: string): Promise<OwnRow> {
  const { data } = await sb
    .from("nutrition_imports")
    .select("id, user_id, kind, audience, status, method, source_kind, file_name, file_paths, source_text, files_deleted_at, credit_use_id, rights_text, rights_confirmed_at")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.user_id !== userId) throw new Error("Import not found.");
  return data as OwnRow;
}

/** Credits for another try (a member's), or none needed (a coach's). */
async function takeCredits(sb: any, imp: OwnRow, userId: string) {
  if (imp.audience !== "member") return { ok: true as const, useId: null };
  const feature = imp.kind === "create" ? "nutrition_create" : "nutrition_import";
  const { data: use, error } = await sb.rpc("ai_credits_use", { _user: userId, _feature: feature, _ref: `${feature}:${imp.id}` });
  if (error) throw new Error(`Couldn't check your credits: ${error.message}`);
  if (!use?.ok) return { ok: false as const, credits: (use?.state ?? null) as CreditState | null };
  return { ok: true as const, useId: use.use_id as string };
}

export const retryMealPlanImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const sb = await admin();
    const imp = await ownImport(sb, data.id, ctx.userId);
    if (imp.status !== "failed") return { ok: true as const };
    const fileKind = imp.source_kind === "pdf" || imp.source_kind === "image";
    if (fileKind && imp.files_deleted_at) return { ok: false as const, message: "Its file was deleted. Start a new import." };
    const c = await takeCredits(sb, imp, ctx.userId);
    if (!c.ok) return { ok: false as const, outOfCredits: true, credits: c.credits, message: "You're out of credits for this month." };
    await sb
      .from("nutrition_imports")
      .update({ status: "pending", error: null, progress: null, credit_use_id: c.useId, attempts: 0, updated_at: new Date().toISOString() })
      .eq("id", imp.id);
    return { ok: true as const };
  });

export const rereadMealPlanImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const sb = await admin();
    const imp = await ownImport(sb, data.id, ctx.userId);
    if (imp.kind !== "import" || imp.status !== "ready" || imp.method !== "parsed" || !imp.source_text)
      return { ok: false as const, message: "This import can't be read again." };
    const c = await takeCredits(sb, imp, ctx.userId);
    if (!c.ok) return { ok: false as const, outOfCredits: true, credits: c.credits, message: "You're out of credits for this month." };
    await sb
      .from("nutrition_imports")
      .update({ status: "pending", method: null, result: null, error: null, progress: null, credit_use_id: c.useId, attempts: 0, updated_at: new Date().toISOString() })
      .eq("id", imp.id);
    return { ok: true as const };
  });

export const discardMealPlanImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const sb = await admin();
    const imp = await ownImport(sb, data.id, ctx.userId);
    if (imp.status === "saved" || imp.status === "discarded") return { ok: true };
    const wasRunning = imp.status === "pending" || imp.status === "reading";
    await sb.from("nutrition_imports").update({ status: "discarded", progress: null, updated_at: new Date().toISOString() }).eq("id", imp.id);
    // a read still running when it was discarded gives its credits back
    if (wasRunning && imp.credit_use_id) await sb.rpc("ai_credits_settle", { _use_id: imp.credit_use_id, _ok: false });
    if (!imp.files_deleted_at) {
      const { deleteMealImportFiles } = await import("./import.server");
      await deleteMealImportFiles(sb, imp.id, imp.file_paths ?? []);
    }
    return { ok: true };
  });

/**
 * The plan was saved from it: a member's own plan (`targetId`, theirs by their own
 * login), or a coach's plan editor filled from it (`clientId`, a client they can
 * see). Its original is filed in the owner's documents first, then its files go.
 */
export const markMealPlanImportSaved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), targetId: z.string().uuid().nullable().optional(), clientId: z.string().uuid().nullable().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const sb = await admin();
    const imp = await ownImport(sb, data.id, ctx.userId);
    if (imp.status === "saved") return { ok: true, documents: 0 };
    if (imp.status !== "ready") throw new Error("This import isn't ready to save.");
    let clientId: string | null = null;
    let targetId: string | null = null;
    if (imp.audience === "member") {
      const me = await memberClient(ctx);
      if (!me) throw new Error("Your coach writes your meal plan.");
      clientId = me.id;
      if (data.targetId) {
        // their own plan, read with their own login
        const { data: plan } = await ctx.supabase.from("nutrition_targets").select("id, client_id").eq("id", data.targetId).maybeSingle();
        if (!plan || plan.client_id !== me.id) throw new Error("Plan not found.");
        targetId = plan.id;
      }
    } else if (data.clientId) {
      // a client the coach can see (RLS); otherwise the original stays the coach's own
      const { data: c } = await ctx.supabase.from("clients").select("id").eq("id", data.clientId).maybeSingle();
      clientId = c?.id ?? null;
    }
    const { fileImportOriginals, deleteMealImportFiles } = await import("./import.server");
    const documentIds = await fileImportOriginals(sb, imp, { userId: ctx.userId, clientId });
    await sb
      .from("nutrition_imports")
      .update({ status: "saved", saved_target_id: targetId, document_ids: documentIds, progress: null, updated_at: new Date().toISOString() })
      .eq("id", imp.id);
    if (!imp.files_deleted_at) await deleteMealImportFiles(sb, imp.id, imp.file_paths ?? []);
    return { ok: true, documents: documentIds.length };
  });
