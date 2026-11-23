/**
 * The coach's side of coaching automation (pain reports and follow-ups,
 * weekly check-ins, workout reviews, missed sessions): the queue, approving and sending,
 * dismissing, retrying, taking back an automatic message, the settings and
 * a client's own rule. Every function asks the database what the caller may
 * do (`cleo_feature`, with their two-step sign-in) and reads their items with
 * their own login (RLS: only their own); the service role only writes after
 * that, and only items that are the caller's.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MyCapabilities } from "@/lib/cleo-capabilities";
import type { AutomationCategory } from "@/lib/recovery-automation/rules";

const CATEGORY_KEYS = ["recovery_reply", "recovery_follow_up", "workout_reply", "checkin_reply", "missed_session"] as const;

/** Still open (not sent, dismissed or cancelled). `sending` is open but can't be dismissed: it's going. */
const OPEN = ["queued", "working", "sending", "draft", "awaiting_approval", "failed"];
/** What Dismiss can stop: anything not already being sent. A reply being written is stopped too; its run's later writes never land. */
const STOPPABLE = ["queued", "working", "draft", "awaiting_approval", "failed"];

export type RecoveryItem = {
  id: string;
  client_id: string;
  client_name: string;
  first_name: string;
  category: AutomationCategory;
  status: string;
  mode: string | null;
  risk: "routine" | "review" | "urgent" | null;
  risk_reasons: string[];
  regions: string[];
  draft: string | null;
  insights: string[];
  context: {
    reports?: string[];
    session?: { title: string | null; date: string } | null;
    reason?: string;
    exercises?: string[];
    /** What a reply to a workout, a check-in or a missed session was written from. */
    facts?: string[];
    workout?: { title: string | null; date: string } | null;
    missed_in_two_weeks?: number;
  } | null;
  why: string | null;
  error: string | null;
  due_at: string;
  sent_at: string | null;
  decided_by: string | null;
  message_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RecoverySettings = { paused: boolean; modes: Partial<Record<AutomationCategory, string>> };

export type RecoveryQueue =
  | { enabled: false; caps: MyCapabilities }
  | {
      enabled: true;
      caps: MyCapabilities;
      items: RecoveryItem[];
      settings: RecoverySettings;
      rules: { client_id: string; category: string; mode: string }[];
      record: { id: string; kind: string; client_id: string | null; detail: any; created_at: string }[];
    };

async function caps(context: any): Promise<MyCapabilities> {
  const { callerCapabilities } = await import("@/lib/cleo-capabilities.server");
  return callerCapabilities(context.supabase, context.userId);
}

async function requireQueue(context: any) {
  const c = await caps(context);
  if (!c.features.includes("automation.approval_queue")) throw new Error("Automation isn't part of your plan.");
  return c;
}

/** The caller's own item (RLS), with its client still theirs. */
async function ownItem(context: any, id: string) {
  const sb = context.supabase as any;
  const { data: item, error } = await sb.from("coach_automation_items").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!item || item.coach_user_id !== context.userId) throw new Error("That isn't in your queue.");
  const { data: client } = await sb.from("clients").select("id, assigned_coach_id").eq("id", item.client_id).maybeSingle();
  const { data: coach } = await sb.from("coaches").select("id").eq("user_id", context.userId).maybeSingle();
  if (!client || !coach || client.assigned_coach_id !== coach.id) throw new Error("They aren't your client any more.");
  return item;
}

export const myCapabilitiesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => caps(context));

export const getRecoveryQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecoveryQueue> => {
    const c = await caps(context);
    if (!c.features.includes("automation.approval_queue")) return { enabled: false, caps: c };
    const sb = (context as any).supabase;
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const [open, recent, settings, rules, record] = await Promise.all([
      sb.from("coach_automation_items").select("*").in("status", OPEN).order("due_at", { ascending: true }).limit(100),
      sb.from("coach_automation_items").select("*").not("status", "in", `(${OPEN.join(",")})`).gte("updated_at", since).order("updated_at", { ascending: false }).limit(60),
      sb.from("coach_automation_settings").select("paused, modes").maybeSingle(),
      sb.from("coach_automation_client_rules").select("client_id, category, mode"),
      c.features.includes("owner.controls")
        ? sb.from("coach_automation_events").select("id, kind, client_id, detail, created_at").order("created_at", { ascending: false }).limit(60)
        : Promise.resolve({ data: [] }),
    ]);
    for (const r of [open, recent]) if (r.error) throw new Error(r.error.message);
    const rows = [...(open.data ?? []), ...(recent.data ?? [])] as any[];
    const ids = [...new Set(rows.map((r) => r.client_id))];
    const { data: clients } = ids.length ? await sb.from("clients").select("id, full_name, preferred_name").in("id", ids) : { data: [] };
    const byId = new Map<string, any>(((clients ?? []) as any[]).map((x) => [x.id, x]));
    const items: RecoveryItem[] = rows.map((r) => {
      const cl = byId.get(r.client_id);
      const name = (cl?.full_name ?? "").trim() || "Client";
      return {
        id: r.id,
        client_id: r.client_id,
        client_name: name,
        first_name: (cl?.preferred_name || name).split(/\s+/)[0],
        category: r.category,
        status: r.status,
        mode: r.mode,
        risk: r.risk,
        risk_reasons: r.risk_reasons ?? [],
        regions: r.regions ?? [],
        draft: r.draft,
        insights: Array.isArray(r.insights) ? r.insights : [],
        context: r.context ?? null,
        why: r.why,
        error: r.error,
        due_at: r.due_at,
        sent_at: r.sent_at,
        decided_by: r.decided_by,
        message_id: r.message_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
    return {
      enabled: true,
      caps: c,
      items,
      settings: { paused: !!settings.data?.paused, modes: (settings.data?.modes ?? {}) as RecoverySettings["modes"] },
      rules: (rules.data ?? []) as any[],
      record: (record.data ?? []) as any[],
    };
  });

export const approveRecoveryItemFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireQueue(context);
    const item = await ownItem(context, data.id);
    if (!["draft", "awaiting_approval", "failed"].includes(item.status)) throw new Error("This one isn't waiting to be sent.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const userId = (context as any).userId as string;
    const now = new Date().toISOString();
    // take it with his words and his name on it, so a second tap, the worker or Dismiss can't
    // touch it, and a send that's cut off is retried with exactly these words
    const { data: taken } = await admin
      .from("coach_automation_items")
      .update({ status: "sending", draft: data.text, decided_by: userId, decided_at: now, locked_at: now, updated_at: now })
      .eq("id", item.id)
      .in("status", ["draft", "awaiting_approval", "failed"])
      .select("*")
      .maybeSingle();
    if (!taken) throw new Error("It was already sent or dismissed.");
    const { deliver } = await import("@/lib/recovery-automation/run.server");
    try {
      const messageId = await deliver(admin, taken, { approvedBy: userId, edited: data.text.trim() !== String(item.draft ?? "").trim() });
      return { messageId };
    } catch (e: any) {
      // nothing went: back to waiting for him, with what he wrote kept
      await admin.from("coach_automation_items").update({ status: "awaiting_approval", decided_by: null, decided_at: null, locked_at: null }).eq("id", item.id).eq("status", "sending").is("message_id", null);
      throw e;
    }
  });

export const dismissRecoveryItemFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireQueue(context);
    const item = await ownItem(context, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: done } = await admin
      .from("coach_automation_items")
      .update({ status: "dismissed", decided_by: (context as any).userId, decided_at: new Date().toISOString(), locked_at: null, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .in("status", STOPPABLE)
      .select("id")
      .maybeSingle();
    if (!done) throw new Error("It's already going, or it isn't waiting any more.");
    await admin.from("coach_automation_events").insert({ item_id: item.id, coach_user_id: item.coach_user_id, client_id: item.client_id, kind: "dismissed", actor: (context as any).userId, detail: {} });
    return { ok: true };
  });

export const retryRecoveryItemFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireQueue(context);
    const item = await ownItem(context, data.id);
    if (item.status !== "failed") throw new Error("Only one that couldn't be written can be tried again.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    await admin.from("coach_automation_items").update({ status: "queued", due_at: new Date().toISOString(), error: null, attempts: 0, updated_at: new Date().toISOString() }).eq("id", item.id).eq("status", "failed");
    const { runAutomationTick } = await import("@/lib/recovery-automation/run.server");
    const r = await runAutomationTick(admin, { itemId: item.id, budgetMs: 45_000 });
    return { outcome: r.processed[0]?.outcome ?? "queued" };
  });

/** Takes back a message automation sent (deleted for everyone; the chat keeps a copy for admins). */
export const unsendRecoveryItemFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireQueue(context);
    const item = await ownItem(context, data.id);
    if (item.status !== "sent" || !item.message_id || item.decided_by) throw new Error("Only a message that went out by itself can be taken back here.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { error } = await admin.from("messages").update({ deleted_at: new Date().toISOString(), body: "", attachments: [] }).eq("id", item.message_id).eq("client_id", item.client_id);
    if (error) throw new Error(error.message);
    await admin.from("coach_automation_items").update({ status: "cancelled", why: "Taken back by you after it went", updated_at: new Date().toISOString() }).eq("id", item.id);
    // its follow-up goes with it
    await admin.from("coach_automation_items").update({ status: "cancelled", why: "The reply it followed was taken back", locked_at: null, updated_at: new Date().toISOString() }).eq("parent_id", item.id).in("status", STOPPABLE);
    await admin.from("coach_automation_events").insert({ item_id: item.id, coach_user_id: item.coach_user_id, client_id: item.client_id, kind: "unsent", actor: (context as any).userId, detail: { message_id: item.message_id } });
    return { ok: true };
  });

const modeSchema = z.enum(["off", "manual", "approval", "automatic"]);

export const saveRecoverySettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ paused: z.boolean(), modes: z
          .object({
            recovery_reply: modeSchema.optional(),
            recovery_follow_up: modeSchema.optional(),
            workout_reply: modeSchema.optional(),
            checkin_reply: modeSchema.optional(),
            missed_session: modeSchema.optional(),
          })
          .strict() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: saved, error } = await (context as any).supabase.rpc("coach_automation_settings_set", { _paused: data.paused, _modes: data.modes });
    if (error) throw new Error(error.message);
    return saved as RecoverySettings;
  });

export const setClientRecoveryModeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ clientId: z.string().uuid(), category: z.enum(CATEGORY_KEYS), mode: modeSchema.nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context as any).supabase.rpc("coach_automation_client_rule_set", { _client: data.clientId, _category: data.category, _mode: data.mode });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** A client's automation as their pain sheet shows it (null for anyone without the queue). */
export const getClientRecoveryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await caps(context);
    if (!c.features.includes("automation.approval_queue")) return null;
    const sb = (context as any).supabase;
    const [settings, rules, items] = await Promise.all([
      sb.from("coach_automation_settings").select("paused, modes").maybeSingle(),
      sb.from("coach_automation_client_rules").select("category, mode").eq("client_id", data.clientId),
      sb.from("coach_automation_items").select("id, category, status, risk, draft, due_at, sent_at, why, context").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(10),
    ]);
    return {
      caps: c,
      settings: { paused: !!settings.data?.paused, modes: (settings.data?.modes ?? {}) as RecoverySettings["modes"] },
      rules: Object.fromEntries(((rules.data ?? []) as any[]).map((r) => [r.category, r.mode])) as Partial<Record<AutomationCategory, string>>,
      items: (items.data ?? []) as any[],
    };
  });

export const getCapabilityOverviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context as any).supabase.rpc("cleo_capability_overview");
    if (error) throw new Error(/owner/i.test(error.message) ? "Only the owner manages capabilities." : error.message);
    return data as {
      features: { key: string; level: string; label: string; description: string }[];
      grants: { id: string; user_id: string; name: string; feature_key: string; source: string; expires_at: string | null; revoked_at: string | null }[];
      coaches: { user_id: string; name: string; automation: boolean }[];
    };
  });

/**
 * The owner gives a coach a capability (a trial, a promo, one account, or a plan
 * once one exists) or takes it back. The database decides: only the owner, with
 * their two-step sign-in, only to a coach or admin, never an owner capability.
 */
export const grantCapabilityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        featureKey: z.string().regex(/^(assist|automation)\.[a-z_]{2,40}$/),
        source: z.enum(["account", "trial", "promo", "plan"]),
        expiresAt: z.string().datetime({ offset: true }).nullable(),
        note: z.string().trim().max(300).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: id, error } = await (context as any).supabase.rpc("cleo_entitlement_grant", {
      _user: data.userId,
      _key: data.featureKey,
      _source: data.source,
      _expires_at: data.expiresAt,
      _note: data.note || null,
    });
    if (error) throw new Error(/owner/i.test(error.message) ? "Only the owner manages capabilities." : error.message);
    return { id: id as string };
  });

export const revokeCapabilityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ grantId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context as any).supabase.rpc("cleo_entitlement_revoke", { _grant: data.grantId });
    if (error) throw new Error(/owner/i.test(error.message) ? "Only the owner manages capabilities." : error.message);
    return { ok: true };
  });
