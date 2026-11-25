/**
 * Client context server functions (Nov 25 2026).
 *
 * Client-facing (the client themselves, or their coach / an admin): read and
 * save their work & lifestyle profile, decline or snooze a question. Writes go
 * through the caller's own login, so RLS decides and the database stamps the
 * source (a client's own edit is always client_reported) and keeps history.
 *
 * Coach-only (the admin, or the client's own coach; never the client): the
 * Personal Context section (private facts, relationship labels, history) and
 * Cleo reading what the coach typed into facts to confirm. Every one checks the
 * caller first (assertStaffReachesClient) and then reads and writes through the
 * caller's own login, so a coach never reaches another coach's client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEMAND,
  EMPLOYMENT,
  EXTRACT_MAX_INPUT,
  FACT_CATEGORIES,
  LIFESTYLE_FIELDS,
  RELATIONSHIPS,
  SCHEDULE,
  WORKDAY,
  extractionPrompt,
  normalizeLifestyle,
  normalizeRelationship,
  parseExtraction,
  type Extraction,
  type Lifestyle,
} from "@/lib/client-context/lifestyle";

const keys = (opts: readonly { key: string }[]) => opts.map((o) => o.key) as [string, ...string[]];
const patchSchema = z
  .object({
    employment_status: z.enum(keys(EMPLOYMENT)).nullable(),
    workday_activity: z.enum(keys(WORKDAY)).nullable(),
    work_schedule: z.enum(keys(SCHEDULE)).nullable(),
    physical_demand: z.enum(keys(DEMAND)).nullable(),
    occupation: z.string().trim().max(120).nullable(),
    employer: z.string().trim().max(120).nullable(),
  })
  .partial();
const fieldEnum = z.enum(LIFESTYLE_FIELDS as unknown as [string, ...string[]]);

type Actor = "client" | "staff";

/** The client themselves, or staff who reach them; anyone else is refused. */
async function actorFor(ctx: any, clientId: string): Promise<Actor> {
  const { data: own } = await ctx.supabase.from("clients").select("id").eq("id", clientId).eq("user_id", ctx.userId).maybeSingle();
  if (own) {
    // a staff login that is also this client (a dual account) still counts as staff
    const { staffCanReachClient } = await import("@/lib/staff-client-access.server");
    return (await staffCanReachClient(ctx.supabase, ctx.userId, clientId)) ? "staff" : "client";
  }
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(ctx.supabase, ctx.userId, clientId);
  return "staff";
}

async function staffOnly(ctx: any, clientId: string) {
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(ctx.supabase, ctx.userId, clientId);
}

async function readLifestyle(sb: any, clientId: string): Promise<Lifestyle> {
  const { data, error } = await sb.from("client_lifestyle").select("*").eq("client_id", clientId).maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeLifestyle(data ?? {});
}

/** Write a lifestyle change through the caller's own login (insert the row the first time). */
async function writeLifestyle(sb: any, clientId: string, body: Record<string, unknown>): Promise<Lifestyle> {
  const { data: existing } = await sb.from("client_lifestyle").select("client_id").eq("client_id", clientId).maybeSingle();
  const res = existing
    ? await sb.from("client_lifestyle").update(body).eq("client_id", clientId).select("*").maybeSingle()
    : await sb.from("client_lifestyle").insert({ client_id: clientId, ...body }).select("*").maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return normalizeLifestyle(res.data ?? {});
}

/* ------------------------------------------------------------------------ */
/* Client-facing                                                              */

/** Their work & lifestyle profile, and whether they're a coaching client (members never get the coaching questions). */
export const getLifestyleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await actorFor(context, data.clientId);
    const sb = context.supabase as any;
    const [lifestyle, { data: client }] = await Promise.all([readLifestyle(sb, data.clientId), sb.from("clients").select("service_tier").eq("id", data.clientId).maybeSingle()]);
    // a JF member (self_serve) never gets the coaching questions; anything else is a coaching client (service-tier.ts)
    return { lifestyle, coaching: !!client && client.service_tier !== "self_serve", actor };
  });

/**
 * Save answers (each saves at once), decline a question ("Prefer not to say"),
 * or snooze one in Complete your profile. A client's own save is client_reported;
 * staff saving here is coach_provided.
 */
export const saveLifestyleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; patch?: Record<string, unknown>; decline?: string[]; undecline?: string[]; snooze?: string | null }) =>
    z
      .object({
        clientId: z.string().uuid(),
        patch: patchSchema.optional(),
        decline: z.array(fieldEnum).max(6).optional(),
        undecline: z.array(fieldEnum).max(6).optional(),
        snooze: fieldEnum.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await actorFor(context, data.clientId);
    const sb = context.supabase as any;
    const cur = await readLifestyle(sb, data.clientId);
    const body: Record<string, unknown> = { last_source: actor === "client" ? "client_reported" : "coach_provided" };
    for (const [k, v] of Object.entries(data.patch ?? {})) body[k] = typeof v === "string" ? v.trim() || null : v;
    if (data.decline?.length || data.undecline?.length) {
      const next = new Set(cur.declined);
      for (const f of data.decline ?? []) next.add(f);
      for (const f of data.undecline ?? []) next.delete(f);
      body.declined = [...next];
    }
    if (data.snooze) {
      const st = cur.prompt_state[data.snooze] ?? {};
      body.prompt_state = { ...cur.prompt_state, [data.snooze]: { ...st, dismissed_at: new Date().toISOString() } };
    }
    const lifestyle = await writeLifestyle(sb, data.clientId, body);
    return { lifestyle };
  });

/* ------------------------------------------------------------------------ */
/* Coach-only                                                                 */

/** The Personal Context section: their profile with sources, its change history, private facts, relationship. */
export const getPersonalContextFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await staffOnly(context, data.clientId);
    const sb = context.supabase as any;
    const { loadContextFacts, loadRelationship } = await import("@/lib/client-context/load.server");
    const [lifestyle, facts, relationship, history] = await Promise.all([
      readLifestyle(sb, data.clientId),
      loadContextFacts(sb, data.clientId, { all: true }),
      loadRelationship(sb, data.clientId),
      sb.from("client_context_history").select("field, old_value, new_value, source, changed_at").eq("client_id", data.clientId).order("changed_at", { ascending: false }).limit(50),
    ]);
    return { lifestyle, facts, relationship, history: (history.data ?? []) as Array<{ field: string; old_value: string | null; new_value: string | null; source: string; changed_at: string }> };
  });

/** Cleo reads what the coach typed or said into facts to confirm (nothing is saved here). */
export const extractContextFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; text: string }) => z.object({ clientId: z.string().uuid(), text: z.string().trim().min(2).max(EXTRACT_MAX_INPUT) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; extraction: Extraction } | { ok: false; reason: string }> => {
    await staffOnly(context, data.clientId);
    const sb = context.supabase as any;
    const { loadContextFacts } = await import("@/lib/client-context/load.server");
    const [{ data: client }, current, facts] = await Promise.all([
      sb.from("clients").select("first_name, full_name").eq("id", data.clientId).maybeSingle(),
      readLifestyle(sb, data.clientId),
      loadContextFacts(sb, data.clientId),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const { system, prompt } = extractionPrompt({ name: client?.first_name || String(client?.full_name ?? "the client").split(" ")[0], text: data.text, today, current });
    try {
      const { askRoute } = await import("@/lib/ai/route-call.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // the coach_write route (routing.ts): GPT-5 mini, then GPT-5.5, on the OpenAI key only
      const reply = await askRoute("coach_write", { system, prompt, timeoutMs: 30_000, tag: "client_context" }, { sb: supabaseAdmin, openaiOnly: true });
      return { ok: true, extraction: parseExtraction(reply.text ?? "", current, facts.map((f) => f.fact), today) };
    } catch (e: any) {
      const { classifyAiError, aiFailureWords } = await import("@/lib/ai/ai-errors");
      return { ok: false, reason: aiFailureWords(classifyAiError(e)) };
    }
  });

const factSchema = z.object({ category: z.enum(FACT_CATEGORIES as unknown as [string, ...string[]]), text: z.string().trim().min(1).max(500), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });
const relSchema = z.object({
  labels: z.array(z.enum(keys(RELATIONSHIPS))).max(8),
  custom: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

/**
 * Save what the coach confirmed (from Cleo's card, or typed by hand): profile
 * fields (ai_confirmed or coach_provided), private facts, relationship labels
 * (added to the ones on file, never replacing them unless `replaceLabels`).
 */
export const saveContextFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        source: z.enum(["ai_confirmed", "coach_provided"]),
        profile: patchSchema.optional(),
        facts: z.array(factSchema).max(12).optional(),
        relationship: relSchema.nullable().optional(),
        replaceLabels: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await staffOnly(context, data.clientId);
    const sb = context.supabase as any;
    const profile = Object.fromEntries(Object.entries(data.profile ?? {}).filter(([, v]) => v !== undefined));
    if (Object.keys(profile).length) await writeLifestyle(sb, data.clientId, { ...profile, last_source: data.source });
    if (data.facts?.length) {
      const rows = data.facts.map((f) => ({ client_id: data.clientId, category: f.category, fact: f.text, source: data.source, valid_until: f.validUntil ?? null, created_by: context.userId }));
      const { error } = await sb.from("client_context_facts").insert(rows);
      if (error) throw new Error(error.message);
    }
    if (data.relationship) {
      const { data: cur } = await sb.from("client_relationships").select("labels, custom_label, note").eq("client_id", data.clientId).maybeSingle();
      const was = normalizeRelationship(cur ?? {});
      const next = normalizeRelationship({
        labels: data.replaceLabels ? data.relationship.labels : [...was.labels, ...data.relationship.labels],
        custom: data.relationship.custom !== undefined ? data.relationship.custom : was.custom,
        note: data.relationship.note !== undefined ? data.relationship.note : was.note,
      });
      const { error } = await sb.from("client_relationships").upsert({ client_id: data.clientId, labels: next.labels, custom_label: next.custom, note: next.note }, { onConflict: "client_id" });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** A private fact becomes historical (kept), active again, or is edited. */
export const updateContextFactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ clientId: z.string().uuid(), id: z.string().uuid(), status: z.enum(["active", "historical"]).optional(), text: z.string().trim().min(1).max(500).optional(), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await staffOnly(context, data.clientId);
    const patch: Record<string, unknown> = {};
    if (data.status) patch.status = data.status;
    if (data.text) patch.fact = data.text;
    if (data.validUntil !== undefined) patch.valid_until = data.validUntil;
    const { error } = await (context.supabase as any).from("client_context_facts").update(patch).eq("id", data.id).eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
