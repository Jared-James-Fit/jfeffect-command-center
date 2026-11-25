/**
 * Cleo Autopilot's server functions (Nov 25 2026): the coach's exception
 * dashboard, the autonomy settings, the decisions (Approve, Reject, Defer,
 * Roll back, bulk approve, Re-assess) and Re-create on a check-in reply.
 * Staff only: every read of a client goes through the caller's own login
 * (RLS: the admin, or that client's coach) and every write is the service
 * role after `assertStaffReachesClient`. Global settings: the admin only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Bucket, Category, Domain, Mode, StoredDomain } from "@/lib/autopilot/types";

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function assertReach(supabase: any, userId: string, clientId: string) {
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(supabase, userId, clientId);
}

async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return !!data;
}

async function isStaff(supabase: any, userId: string): Promise<boolean> {
  const [{ data: a }, { data: c }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  return !!a || !!c;
}

export type BoardRow = {
  id: string;
  clientId: string;
  name: string;
  category: Category;
  bucket: Bucket;
  status: string;
  headline: string;
  rationale: string;
  expected: string | null;
  reassessOn: string | null;
  shadow: boolean;
  createdAt: string;
  trigger: string;
  version: number;
  protections: Array<{ reason: string; domain: string; text: string }>;
  missing: string[];
  domains: Record<Domain, Pick<StoredDomain, "change" | "summary" | "before" | "after" | "draft" | "draftError" | "published" | "rolledBack"> & { routing: StoredDomain["routing"] }>;
  outcome: { verdict: string; text: string } | null;
  cost: { calls: number; input_tokens: number; output_tokens: number; usd?: number };
  paused: boolean;
};

export type AutopilotBoard = {
  available: boolean;
  rows: BoardRow[];
  counts: Record<Bucket, number>;
  cost30: { calls: number; tokens: number; usd: number; clients: number };
  globalPaused: boolean;
};

export const getAutopilotBoardFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutopilotBoard> => {
    const empty: AutopilotBoard = { available: false, rows: [], counts: { requires_attention: 0, awaiting_approval: 0, auto_updated: 0, missing_info: 0, on_track: 0 }, cost30: { calls: 0, tokens: 0, usd: 0, clients: 0 }, globalPaused: false };
    if (!(await isStaff(context.supabase, context.userId))) return empty;
    const sb = context.supabase as any;
    const since = new Date(Date.now() - 21 * 86_400_000).toISOString();
    // the caller's own login: RLS decides whose rows come back
    const { data, error } = await sb
      .from("autopilot_decisions")
      .select("id, client_id, category, bucket, status, headline, rationale, expected_outcome, reassess_on, shadow, created_at, trigger, version, protected, missing, domains, outcome, cost")
      .gte("created_at", since)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return empty;
    const latest = new Map<string, any>();
    for (const r of data ?? []) if (!latest.has(r.client_id)) latest.set(r.client_id, r);
    const ids = [...latest.keys()];
    const names = new Map<string, string>();
    const paused = new Set<string>();
    if (ids.length) {
      const [{ data: cs }, { data: st }] = await Promise.all([
        sb.from("clients").select("id, full_name, preferred_name, first_name").in("id", ids),
        sb.from("autopilot_settings").select("client_id, paused, paused_until").eq("scope", "client").in("client_id", ids),
      ]);
      for (const c of cs ?? []) names.set(c.id, c.preferred_name || c.full_name || c.first_name || "Client");
      const today = new Date().toISOString().slice(0, 10);
      for (const s of st ?? []) if (s.paused || (s.paused_until && s.paused_until >= today)) paused.add(s.client_id);
    }
    const { data: g } = await sb.from("autopilot_settings").select("paused, paused_until").eq("scope", "global").maybeSingle();
    const globalPaused = !!g && (!!g.paused || (!!g.paused_until && g.paused_until >= new Date().toISOString().slice(0, 10)));
    const rows: BoardRow[] = [...latest.values()]
      .filter((r) => names.has(r.client_id))
      .map((r) => ({
        id: r.id,
        clientId: r.client_id,
        name: names.get(r.client_id)!,
        category: r.category,
        bucket: r.status === "published" ? "auto_updated" : r.status === "rejected" || r.status === "rolled_back" ? "on_track" : r.bucket,
        status: r.status,
        headline: r.headline,
        rationale: r.rationale,
        expected: r.expected_outcome,
        reassessOn: r.reassess_on,
        shadow: r.shadow,
        createdAt: r.created_at,
        trigger: r.trigger,
        version: r.version,
        protections: r.protected ?? [],
        missing: r.missing ?? [],
        domains: r.domains,
        outcome: r.outcome ? { verdict: r.outcome.verdict, text: r.outcome.text } : null,
        cost: r.cost ?? { calls: 0, input_tokens: 0, output_tokens: 0 },
        paused: paused.has(r.client_id),
      }));
    const counts = { ...empty.counts };
    for (const r of rows) counts[r.bucket]++;
    // what it cost over the last 30 days (calls and tokens it recorded)
    const { data: costs } = await sb.from("autopilot_decisions").select("client_id, cost").gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(2000);
    const cost30 = { calls: 0, tokens: 0, usd: 0, clients: new Set<string>() as any };
    for (const c of costs ?? []) {
      cost30.calls += Number(c.cost?.calls ?? 0);
      cost30.tokens += Number(c.cost?.input_tokens ?? 0) + Number(c.cost?.output_tokens ?? 0);
      cost30.usd += Number(c.cost?.usd ?? 0);
      cost30.clients.add(c.client_id);
    }
    return { available: true, rows, counts, cost30: { calls: cost30.calls, tokens: cost30.tokens, usd: Math.round(cost30.usd * 100) / 100, clients: cost30.clients.size }, globalPaused };
  });

/* ------------------------------------------------------------------ */
/* Settings                                                            */

const modeSchema = z.enum(["draft", "smart", "advanced"]).nullable();
const settingsSchema = z.object({
  clientId: z.string().uuid().nullable(),
  modes: z.object({ training: modeSchema, nutrition: modeSchema, cardio: modeSchema }),
  locked: z.array(z.enum(["training", "nutrition", "cardio"])).max(3),
  ranges: z.object({ nutrition_kcal: z.number().int().min(0).max(250).nullable(), cardio_minutes: z.number().int().min(0).max(30).nullable() }),
  paused: z.boolean(),
  pausedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  shadow: z.boolean().nullable(),
});
export type AutopilotSettingsInput = z.infer<typeof settingsSchema>;

export const getAutopilotSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    if (data.clientId) await assertReach(context.supabase, context.userId, data.clientId);
    const { loadSettingsRows } = await import("@/lib/autopilot/run.server");
    const { resolveSettings } = await import("@/lib/autopilot/autonomy");
    const rows = await loadSettingsRows(await admin(), data.clientId);
    return { ...rows, resolved: resolveSettings(rows.global, data.clientId ? rows.client : null, new Date().toISOString().slice(0, 10)), canEditGlobal: await isAdmin(context.supabase, context.userId) };
  });

export const saveAutopilotSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.clientId) await assertReach(context.supabase, context.userId, data.clientId);
    else if (!(await isAdmin(context.supabase, context.userId))) throw new Error("Only an admin changes the global autopilot settings.");
    const sb = await admin();
    const row: Record<string, unknown> = {
      scope: data.clientId ? "client" : "global",
      client_id: data.clientId,
      // the global row always has a mode; a client's null = follow the global one
      mode_training: data.modes.training ?? (data.clientId ? null : "draft"),
      mode_nutrition: data.modes.nutrition ?? (data.clientId ? null : "draft"),
      mode_cardio: data.modes.cardio ?? (data.clientId ? null : "draft"),
      locked_domains: data.locked,
      ranges: Object.fromEntries(Object.entries(data.ranges).filter(([, v]) => v != null)),
      paused: data.paused,
      paused_until: data.pausedUntil,
      shadow: data.shadow ?? (data.clientId ? null : true),
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    const q = sb.from("autopilot_settings").select("id").eq("scope", row.scope);
    const { data: had } = data.clientId ? await q.eq("client_id", data.clientId).maybeSingle() : await q.maybeSingle();
    const { error } = had ? await sb.from("autopilot_settings").update(row).eq("id", had.id) : await sb.from("autopilot_settings").insert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Decisions                                                           */

export const decideAutopilotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(50),
        action: z.enum(["approve", "reject", "defer", "rollback"]),
        note: z.string().max(2000).nullable().optional(),
        deferDays: z.number().int().min(1).max(28).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: decs } = await sb.from("autopilot_decisions").select("id, client_id, status, domains").in("id", data.ids);
    const results: Array<{ id: string; status: string; published?: Domain[]; waiting?: string | null; errors?: string[] }> = [];
    for (const dec of decs ?? []) {
      await assertReach(context.supabase, context.userId, dec.client_id);
      const run = await import("@/lib/autopilot/run.server");
      if (data.action === "approve") {
        const r = await run.publishDecision(sb, dec.id, { userId: context.userId, supabase: context.supabase });
        results.push({ id: dec.id, ...r });
      } else if (data.action === "rollback") {
        const r = await run.rollbackDecision(sb, dec.id, { userId: context.userId, supabase: context.supabase });
        results.push({ id: dec.id, status: r.undone.length ? "rolled_back" : dec.status, errors: r.errors });
      } else if (data.action === "reject") {
        if (!["open", "approved", "deferred"].includes(dec.status)) {
          results.push({ id: dec.id, status: dec.status, errors: ["Already decided"] });
          continue;
        }
        // its drafts are put away (never the coach's own)
        for (const s of Object.values((dec.domains ?? {}) as Record<Domain, StoredDomain>)) {
          if (!s?.draft || s.published) continue;
          try {
            if (s.draft.kind === "nutrition_plan_edit") {
              const { discardPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
              await discardPlanEdit(sb, s.draft.id);
            } else if (s.draft.kind === "program_ai_edit") {
              await sb.from("program_ai_edits").update({ status: "discarded" }).eq("id", s.draft.id).in("status", ["ready", "pending", "error"]);
            } else {
              const { data: d } = await sb.from("cardio_plan_drafts").select("note, updated_at").eq("client_id", dec.client_id).maybeSingle();
              if (d && String(d.note ?? "").startsWith(run.AUTOPILOT_TAG) && Math.abs(Date.parse(d.updated_at) - Date.parse(s.draft.savedAt)) < 1000) {
                const { discardCardioDraft } = await import("@/lib/cardio/publish.server");
                await discardCardioDraft(sb, dec.client_id);
              }
            }
          } catch {
            // a draft already gone is fine
          }
        }
        await sb.from("autopilot_decisions").update({ status: "rejected", coach_note: data.note?.trim() || null, decided_by: context.userId, decided_at: new Date().toISOString() }).eq("id", dec.id);
        results.push({ id: dec.id, status: "rejected" });
      } else {
        const until = new Date(Date.now() + (data.deferDays ?? 7) * 86_400_000).toISOString().slice(0, 10);
        await sb.from("autopilot_decisions").update({ status: "deferred", deferred_until: until, coach_note: data.note?.trim() || null, decided_by: context.userId, decided_at: new Date().toISOString() }).eq("id", dec.id);
        results.push({ id: dec.id, status: "deferred" });
      }
    }
    return { results };
  });

/** Assess a client now (the coach's Re-assess): a new version of the record. */
export const runAutopilotNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertReach(context.supabase, context.userId, data.clientId);
    const { runAssessment } = await import("@/lib/autopilot/run.server");
    const r = await runAssessment(await admin(), data.clientId, { trigger: "manual", checkinId: null });
    if (!r) throw new Error("Couldn't assess them now (Autopilot isn't set up on this database, or their records couldn't be read).");
    return { decisionId: r.decisionId, category: r.assessment.category, bucket: r.bucket };
  });

/* ------------------------------------------------------------------ */
/* Re-create                                                           */

async function checkinClient(sb: any, checkinId: string): Promise<string> {
  const { data } = await sb.from("messenger_checkins").select("client_id").eq("id", checkinId).maybeSingle();
  if (!data) throw new Error("Check-in not found.");
  return data.client_id;
}

export const recreateReplyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        checkinId: z.string().uuid(),
        style: z.enum(["redo", "shorter", "like_me", "direct", "supportive", "custom"]),
        custom: z.string().max(400).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    await assertReach(context.supabase, context.userId, await checkinClient(sb, data.checkinId));
    if (data.style === "custom" && !data.custom?.trim()) throw new Error("Say how you'd like it changed.");
    const { recreateReply } = await import("@/lib/autopilot/reply.server");
    const { classifyAiError, aiFailureWords } = await import("@/lib/ai/ai-errors");
    try {
      return await recreateReply(sb, { checkinId: data.checkinId, style: data.style, custom: data.custom ?? null, userId: context.userId });
    } catch (e: any) {
      if (/^(No new wording|Check-in not found|This check-in)/.test(String(e?.message))) throw e;
      throw new Error(`Couldn't write a new version: ${aiFailureWords(classifyAiError(e))}. The current one is kept.`);
    }
  });

export const replyVersionsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ checkinId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    await assertReach(context.supabase, context.userId, await checkinClient(sb, data.checkinId));
    const { listReplyVersions } = await import("@/lib/autopilot/reply.server");
    return listReplyVersions(sb, data.checkinId);
  });

export const pickReplyVersionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ checkinId: z.string().uuid(), versionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    await assertReach(context.supabase, context.userId, await checkinClient(sb, data.checkinId));
    const { pickReplyVersion } = await import("@/lib/autopilot/reply.server");
    return pickReplyVersion(sb, data);
  });

export type { Mode };
