/**
 * Publishing a client's cardio plan, saving and clearing the coach's draft, and
 * restoring an earlier version into the draft (Nov 23 2026). The writes are
 * worked out by code (publish.ts) and applied in one transaction by the
 * database (cardio_plan_publish): rows dated, the version recorded, the draft
 * cleared, the workouts' cardio placed. Then, only for a change the client
 * would notice and only once per version, the chat message with the plan's
 * card and one push. A message that fails never undoes the publish. Server
 * only; the caller checks the staff member reaches the client first.
 */
import { normalizeCardioWeekdays } from "@/lib/cardio-prescription";
import { cleanPlan, isMeaningful, planProblems, planTotals, type CardioPlan, type PlanContext } from "@/lib/cardio/plan";
import { opsEmpty, publishOps, type TargetRow } from "@/lib/cardio/publish";
import { loadPending, rowsHash, workspaceAvailable } from "@/lib/cardio/workspace.server";
import { CARDIO_MESSAGE_KIND, cardioMessageBody, cardioMessageCard, shouldAnnounce } from "@/lib/cardio/plan-message";
import type { SpeedUnit } from "@/lib/weight-management/units";
import type { PublishResult } from "@/lib/cardio/types";
export type { PublishResult } from "@/lib/cardio/types";

function localToday(tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function clientCtx(sb: any, clientId: string) {
  const { data: c, error } = await sb
    .from("clients")
    .select("id, user_id, first_name, preferred_name, full_name, timezone, committed_training_days, preferred_training_days, preferred_high_days, preferred_weight_unit, assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) throw new Error("Client not found.");
  const training = normalizeCardioWeekdays(Array.isArray(c.committed_training_days) && c.committed_training_days.length ? c.committed_training_days : c.preferred_training_days ?? []);
  const ctx: PlanContext = { trainingDays: training, highDays: normalizeCardioWeekdays(c.preferred_high_days ?? []) };
  return { c, ctx, today: localToday(c.timezone) };
}

async function speedUnitFor(sb: any, clientId: string, weightUnit: string | null): Promise<SpeedUnit> {
  const { data } = await sb.from("weight_management_profiles").select("speed_unit").eq("client_id", clientId).maybeSingle();
  if (data?.speed_unit === "kmh" || data?.speed_unit === "mph") return data.speed_unit;
  return weightUnit === "kg" ? "kmh" : "mph";
}

/** Save the coach's draft (one per client). */
export async function saveCardioDraft(sb: any, x: { clientId: string; userId: string; sessions: unknown; effectiveDate: string | null; note: string | null; baseHash: string | null }) {
  if (!(await workspaceAvailable(sb))) throw new Error("The cardio builder isn't set up on this database yet.");
  const { ctx } = await clientCtx(sb, x.clientId);
  const plan = cleanPlan(x.sessions, ctx);
  const at = new Date().toISOString();
  const { error } = await sb.from("cardio_plan_drafts").upsert(
    {
      client_id: x.clientId,
      sessions: plan.sessions,
      effective_date: x.effectiveDate,
      note: x.note?.slice(0, 1000) ?? null,
      base_hash: x.baseHash,
      updated_by: x.userId,
      updated_at: at,
    },
    { onConflict: "client_id" },
  );
  if (error) throw new Error(error.message);
  return { savedAt: at };
}

export async function discardCardioDraft(sb: any, clientId: string) {
  const { error } = await sb.from("cardio_plan_drafts").delete().eq("client_id", clientId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** An earlier version back into the draft, for the coach to review and publish (never straight to the client). */
export async function restoreVersionToDraft(sb: any, x: { clientId: string; userId: string; versionId: string }) {
  const { data: v, error } = await sb.from("cardio_plan_versions").select("id, sessions, version_no").eq("id", x.versionId).eq("client_id", x.clientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!v) throw new Error("That version isn't this client's.");
  const { ctx } = await clientCtx(sb, x.clientId);
  const { data: rows } = await sb.from("cardio_targets").select("*").eq("client_id", x.clientId);
  // the sessions come back as new ones (the rows they were may have ended), so publishing dates them afresh
  const plan = cleanPlan(v.sessions, ctx);
  for (const s of plan.sessions) {
    s.id = null;
    s.key = `restore-${v.version_no}-${s.key}`.slice(0, 80);
  }
  await saveCardioDraft(sb, { clientId: x.clientId, userId: x.userId, sessions: plan.sessions, effectiveDate: null, note: `Restored from version ${v.version_no}`, baseHash: rowsHash((rows ?? []) as TargetRow[]) });
  return { plan, versionNo: v.version_no as number };
}


export async function publishCardioPlan(
  sb: any,
  x: {
    clientId: string;
    userId: string;
    sessions: unknown;
    effectiveDate: string | null;
    note: string | null;
    source: "coach" | "cleo" | "restore" | "recommendation";
    restoredFrom: string | null;
    baseHash: string | null;
    quality: { score: number | null; confidence: string } | null;
    notify: boolean;
  },
): Promise<PublishResult> {
  if (!(await workspaceAvailable(sb))) throw new Error("The cardio builder isn't set up on this database yet.");
  const { c, ctx, today } = await clientCtx(sb, x.clientId);
  const unit = await speedUnitFor(sb, x.clientId, c.preferred_weight_unit ?? null);
  const { data: rows, error } = await sb.from("cardio_targets").select("*").eq("client_id", x.clientId);
  if (error) throw new Error(error.message);
  const targetRows = (rows ?? []) as TargetRow[];
  if (x.baseHash && x.baseHash !== rowsHash(targetRows)) {
    throw new Error("Their cardio changed since you opened the builder (someone else saved it, or the nutrition plan did). Reload to see the latest before publishing.");
  }
  const draft: CardioPlan = cleanPlan(x.sessions, ctx);
  const errors = planProblems(draft, ctx).filter((p) => p.level === "error");
  if (errors.length) throw new Error(errors.map((e) => e.text).join("; "));
  const pending = await loadPending(sb, x.clientId);
  const ops = publishOps({ rows: targetRows, draft, today, effective: x.effectiveDate, ctx, unit, pending });
  if (opsEmpty(ops)) return { unchanged: true, versionId: null, versionNo: null, effective: ops.effective, scheduled: ops.scheduled, changeLines: [], messaged: false, messageReason: "unchanged" };

  const totals = planTotals(draft, ctx);
  const changeLines = ops.changes.flatMap((ch) => ch.lines).slice(0, 40);
  const payload = {
    effective: ops.effective,
    scheduled: ops.scheduled,
    pending_version_id: pending?.versionId ?? null,
    revert: ops.revert,
    end: ops.end,
    remove: ops.remove,
    update: ops.update,
    insert: ops.insert,
    version: {
      sessions: draft.sessions,
      weekly_minutes: totals.minutes,
      weekly_sessions: totals.sessions,
      change_lines: changeLines,
      source: x.source,
      restored_from: x.restoredFrom,
      note: x.note?.trim().slice(0, 1000) || null,
      quality: x.quality,
      published_by: x.userId,
    },
  };
  const { data: out, error: pubErr } = await sb.rpc("cardio_plan_publish", { p_client: x.clientId, p_payload: payload });
  if (pubErr) throw new Error(pubErr.message);
  const versionId = String(out?.version_id ?? "");
  const versionNo = Number(out?.version_no ?? 0) || null;

  // the message: a change the client would notice, once per version, never failing the publish
  let messaged = false;
  let messageReason: string | null = null;
  try {
    if (!x.notify) messageReason = "not_asked";
    else if (!shouldAnnounce(ops.changes, !!c.user_id)) messageReason = c.user_id ? "nothing_client_facing" : "no_login";
    else {
      const sent = await postCardioPlanMessage(sb, { clientId: x.clientId, client: c, actorUserId: x.userId, versionId, plan: draft, ctx, unit, ops, weeklyMinutes: totals.minutes });
      messaged = sent.posted;
      messageReason = sent.reason ?? null;
      if (sent.messageId) await sb.from("cardio_plan_versions").update({ message_id: sent.messageId }).eq("id", versionId);
      if (sent.posted) {
        const { notifyAppEvent } = await import("@/lib/push/app-events.server");
        await notifyAppEvent(sb, "cardio_plan_updated", { clientId: x.clientId, sourceId: `cardio:${versionId}`, actorUserId: x.userId });
      }
    }
  } catch (e: any) {
    messageReason = e?.message ?? "message failed";
  }
  return { unchanged: false, versionId, versionNo, effective: ops.effective, scheduled: ops.scheduled, changeLines, messaged, messageReason };
}

async function postCardioPlanMessage(
  sb: any,
  x: { clientId: string; client: any; actorUserId: string; versionId: string; plan: CardioPlan; ctx: PlanContext; unit: SpeedUnit; ops: ReturnType<typeof publishOps>; weeklyMinutes: number },
): Promise<{ posted: boolean; messageId?: string; reason?: string }> {
  // once per version
  const { data: same } = await sb
    .from("messages")
    .select("id")
    .eq("client_id", x.clientId)
    .contains("attachments", JSON.stringify([{ kind: CARDIO_MESSAGE_KIND, version_id: x.versionId }]))
    .limit(1);
  if (same?.length) return { posted: false, reason: "already_sent" };
  const { data: earlier } = await sb
    .from("messages")
    .select("id")
    .eq("client_id", x.clientId)
    .contains("attachments", JSON.stringify([{ kind: CARDIO_MESSAGE_KIND }]))
    .limit(1);
  const update = earlier?.length ? "changed" : "new";
  const card = cardioMessageCard({
    versionId: x.versionId,
    plan: x.plan,
    ctx: x.ctx,
    unit: x.unit,
    changes: x.ops.changes,
    update,
    effective: x.ops.effective,
    scheduled: x.ops.scheduled,
    weeklyMinutes: x.weeklyMinutes,
  });
  const at = new Date().toISOString();
  const { data: msg, error } = await sb
    .from("messages")
    .insert({
      client_id: x.clientId,
      sender_id: x.actorUserId,
      sender_role: "admin",
      body: cardioMessageBody(x.client.preferred_name || x.client.first_name || x.client.full_name, {
        update,
        scheduled: x.ops.scheduled,
        effective: x.ops.effective,
        empty: !x.plan.sessions.some((s) => s.enabled),
      }),
      attachments: [card],
      message_type: "Cardio",
      is_internal_note: false,
      // automated: it doesn't count as the coach replying (check-ins stay open for review)
      is_automated: true,
      delivery_status: "sent",
      sent_at: at,
      read_by_admin_at: at,
    })
    .select("id")
    .single();
  if (error) return { posted: false, reason: error.message };
  return { posted: true, messageId: msg.id };
}

export { isMeaningful };
