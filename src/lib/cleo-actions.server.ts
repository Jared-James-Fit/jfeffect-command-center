/**
 * Server side of Cleo's actions: propose (a card), confirm, cancel, and the
 * owner's approve / decline. Server-only.
 *
 * - The card's words come from the database, not from the model, so what the
 *   person confirms is what runs.
 * - An action always runs with the session of the person who tapped: the
 *   requester when it's within their role, otherwise the business owner when
 *   they approve. It goes through the same server functions and RLS as the
 *   app's own buttons, so nobody can do more through Cleo than in the app.
 * - cleo_actions rows are written with the service key only after the caller
 *   is checked, and every status change is a compare-and-set, so a double tap
 *   can't run something twice.
 */
import { BUSINESS_TZ } from "@/lib/billing-schedule";
import { wallTimeToUtc } from "@/lib/schedule-time";
import {
  CLEO_ACTION_INFO, CLEO_ACTION_PARAMS, actionPermission, isCleoActionKind, isStale, routeFor,
  type Caller, type CleoActionKind, type CleoActionStatus, type CleoActionView,
} from "@/lib/cleo-actions";

export type ActorCtx = {
  /** The caller's own client (writes). */
  supabase: any;
  /** What to read with: the caller's client, or the finance login's admin view. */
  db: any;
  userId: string;
};

async function service(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export async function loadCaller(supabase: any, userId: string): Promise<Caller & { isOwner: boolean }> {
  const [{ data: roles }, owner] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.rpc("is_business_owner", { _uid: userId }),
  ]);
  const roleList: string[] = (roles ?? []).map((r: any) => r.role);
  const isAdmin = roleList.includes("admin");
  let permissions: string[] = [];
  if (!isAdmin && roleList.length) {
    const { data } = await supabase.from("role_permissions").select("permission").in("role", roleList);
    permissions = (data ?? []).map((r: any) => r.permission);
  }
  return { isAdmin, permissions, isOwner: owner?.data === true };
}

function clientLabel(c: any): string {
  return (c?.full_name ?? "").trim() || `${c?.preferred_name || c?.first_name || ""} ${c?.last_name ?? ""}`.trim() || c?.email || "the client";
}

async function client(db: any, id: string) {
  const { data, error } = await db.from("clients").select("id, full_name, preferred_name, first_name, last_name, email, phone").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("I couldn't find that client.");
  return data;
}

async function purchase(db: any, id: string) {
  const { data, error } = await db.from("purchase_records").select("id, client_id, offer_name, payment_status, archived_at").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.archived_at) throw new Error("I couldn't find that purchase.");
  return { ...data, client: data.client_id ? await client(db, data.client_id) : null };
}

function money(n: number): string {
  return `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(date: string, time: string): string {
  const d = wallTimeToUtc(date, time, BUSINESS_TZ);
  return d.toLocaleString("en-CA", { timeZone: BUSINESS_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The card's words, from the database. Throws when the thing doesn't exist or can't be done. */
export async function describeAction(db: any, kind: CleoActionKind, p: any): Promise<string> {
  switch (kind) {
    case "create_task":
      return `Add "${p.title}" to the team board${p.due_date ? `, due ${p.due_date}` : ""}.${p.notes ? `\nNotes: ${p.notes}` : ""}`;
    case "complete_task": {
      const { data } = await db.from("tasks").select("title, status").eq("id", p.task_id).maybeSingle();
      if (!data) throw new Error("I couldn't find that task.");
      if (data.status === "done") throw new Error(`"${data.title}" is already done.`);
      return `Mark "${data.title}" done.`;
    }
    case "send_message":
      return `Message ${clientLabel(await client(db, p.client_id))} now:\n"${p.body}"`;
    case "schedule_message": {
      if (wallTimeToUtc(p.date, p.time, BUSINESS_TZ).getTime() < Date.now() + 60_000) throw new Error("That time has already passed.");
      return `Message ${clientLabel(await client(db, p.client_id))} on ${when(p.date, p.time)}:\n"${p.body}"`;
    }
    case "add_client_note":
      return `Add a note to ${clientLabel(await client(db, p.client_id))}'s file:\n${p.title}\n${p.body}`;
    case "mark_check_ins_reviewed":
      return `Mark everything waiting from ${clientLabel(await client(db, p.client_id))} as reviewed.`;
    case "update_payment_status": {
      const pr = await purchase(db, p.purchase_id);
      return `Set ${clientLabel(pr.client)}'s ${pr.offer_name ?? "purchase"} from ${pr.payment_status ?? "?"} to ${p.payment_status}${p.amount_paid != null ? `, paid so far ${money(p.amount_paid)}` : ""}.${p.note ? `\nNote: ${p.note}` : ""}`;
    }
    case "send_payment_link": {
      const pr = await purchase(db, p.purchase_id);
      const to = p.via === "email" ? pr.client?.email : pr.client?.phone;
      if (!to) throw new Error(`${clientLabel(pr.client)} has no ${p.via === "email" ? "email" : "phone number"} on file.`);
      return `Send ${clientLabel(pr.client)} the payment link for ${pr.offer_name ?? "their purchase"} by ${p.via === "email" ? "email" : "text"} (${to}).`;
    }
    case "book_appointment": {
      const start = wallTimeToUtc(p.date, p.time, BUSINESS_TZ);
      if (start.getTime() < Date.now()) throw new Error("That time has already passed.");
      const who = p.client_id ? ` with ${clientLabel(await client(db, p.client_id))}` : "";
      return `Book "${p.title}" (${p.appointment_type})${who}, ${when(p.date, p.time)} for ${p.duration_minutes ?? 60} min${p.video_call ? ", video call" : ""}${p.location ? `, at ${p.location}` : ""}.`;
    }
  }
}

/** A new card. Returns what Cleo should tell the person. */
export async function proposeAction(actor: ActorCtx, caller: Caller, kind: CleoActionKind, raw: unknown) {
  const params = CLEO_ACTION_PARAMS[kind].parse(raw);
  const summary = await describeAction(actor.db, kind, params);
  const permission = actionPermission(kind, params);
  const admin = await service();
  const { data, error } = await admin
    .from("cleo_actions")
    .insert({ requested_by: actor.userId, kind, params, summary, permission, status: "proposed" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, summary, route: routeFor(permission, caller) };
}

/** Runs it with this actor's own session (same server functions and RLS as the app). */
async function execute(actor: ActorCtx, kind: CleoActionKind, raw: unknown): Promise<string> {
  const p: any = CLEO_ACTION_PARAMS[kind].parse(raw);
  const sb = actor.supabase;
  const myCoachId = async () => (await sb.from("coaches").select("id").eq("user_id", actor.userId).maybeSingle()).data?.id ?? null;
  switch (kind) {
    case "create_task": {
      const { error } = await sb.from("tasks").insert({
        title: p.title,
        notes: p.notes ?? null,
        // Midday local, so the date reads the same in every time zone the board is opened in.
        due_at: p.due_date ? wallTimeToUtc(p.due_date, "12:00", BUSINESS_TZ).toISOString() : null,
        quadrant: "do",
        scope: "admin",
        created_by: await myCoachId(),
      });
      if (error) throw new Error(error.message);
      return "Task added.";
    }
    case "complete_task": {
      const { data, error } = await sb
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString(), completed_by: await myCoachId() })
        .eq("id", p.task_id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("That task couldn't be changed.");
      return "Task done.";
    }
    case "send_message": {
      // The same row the inbox writes (messages.ts sendMessage), then the same push.
      const { data, error } = await sb
        .from("messages")
        .insert({
          client_id: p.client_id,
          sender_id: actor.userId,
          sender_role: "admin",
          body: p.body,
          attachments: [],
          message_type: "General",
          is_internal_note: false,
          read_by_admin_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await sb.from("conversation_state").update({ status: "open" }).eq("client_id", p.client_id).eq("status", "needs_response").then(() => {}, () => {});
      try {
        const { notifyNewMessage } = await import("@/lib/push/events.functions");
        await notifyNewMessage({ data: { messageId: data.id } });
      } catch (e) {
        console.warn("[cleo] message push failed", e);
      }
      return "Message sent.";
    }
    case "schedule_message": {
      const { scheduleMessage } = await import("@/lib/scheduled-messages.functions");
      await scheduleMessage({
        data: { clientId: p.client_id, body: p.body, scheduledAtIso: wallTimeToUtc(p.date, p.time, BUSINESS_TZ).toISOString(), scheduledTz: BUSINESS_TZ },
      });
      return `Scheduled for ${when(p.date, p.time)}.`;
    }
    case "add_client_note": {
      const { error } = await sb.from("client_file_notes").insert({ client_id: p.client_id, author_id: actor.userId, title: p.title, body: p.body, source: "client_file" });
      if (error) throw new Error(error.message);
      return "Note added.";
    }
    case "mark_check_ins_reviewed": {
      const { data, error } = await sb.rpc("mark_client_reviews_reviewed", { _client_id: p.client_id });
      if (error) throw new Error(error.message);
      const n = Number(data ?? 0);
      return n ? `Marked ${n} item${n === 1 ? "" : "s"} reviewed.` : "Nothing was waiting.";
    }
    case "update_payment_status": {
      const { updatePurchasePayment } = await import("@/lib/payments.functions");
      await updatePurchasePayment({
        data: { id: p.purchase_id, payment_status: p.payment_status, amount_paid: p.amount_paid, note: p.note ? `${p.note} (via Cleo)` : "Updated via Cleo" },
      });
      return `Payment set to ${p.payment_status}.`;
    }
    case "send_payment_link": {
      if (p.via === "email") {
        const { sendPaymentLinkEmail } = await import("@/lib/payments.functions");
        const r: any = await sendPaymentLinkEmail({ data: { id: p.purchase_id } });
        if (r && r.ok === false) throw new Error(r.reason ?? "The email didn't send.");
        return "Payment link emailed.";
      }
      const { sendPaymentLinkBySms } = await import("@/lib/sms-links.functions");
      await sendPaymentLinkBySms({ data: { purchaseId: p.purchase_id } });
      return "Payment link texted.";
    }
    case "book_appointment": {
      const start = wallTimeToUtc(p.date, p.time, BUSINESS_TZ);
      const { createAppointment } = await import("@/lib/appointments.functions");
      await createAppointment({
        data: {
          appointment_type: p.appointment_type,
          title: p.title,
          client_id: p.client_id ?? null,
          starts_at: start.toISOString(),
          ends_at: new Date(start.getTime() + (p.duration_minutes ?? 60) * 60_000).toISOString(),
          timezone: BUSINESS_TZ,
          location: p.location ?? null,
          meet_enabled: !!p.video_call,
          sms_reminders_enabled: true,
        },
      });
      return "Booked.";
    }
  }
}

function errText(e: unknown): string {
  const m = String((e as any)?.message ?? e ?? "Something went wrong.");
  return m.replace(/^Error:\s*/, "").slice(0, 300);
}

/** Compare-and-set: moves one row from one of `from` to `to`, or returns null if someone else already did. */
async function move(id: string, from: CleoActionStatus[], to: CleoActionStatus, extra: Record<string, unknown> = {}, requester?: string) {
  const admin = await service();
  let q = admin.from("cleo_actions").update({ status: to, updated_at: new Date().toISOString(), ...extra }).eq("id", id).in("status", from);
  if (requester) q = q.eq("requested_by", requester);
  const { data, error } = await q.select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data as any | null;
}

async function runClaimed(actor: ActorCtx, row: any, decidedBy: string | null) {
  const admin = await service();
  try {
    const kind: unknown = row.kind;
    if (!isCleoActionKind(kind)) throw new Error("Unknown action.");
    const result = await execute(actor, kind, row.params);
    await admin.from("cleo_actions").update({ status: "done", result, done_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(decidedBy ? { decided_by: decidedBy, decided_at: new Date().toISOString() } : {}) }).eq("id", row.id);
    return { status: "done" as const, result };
  } catch (e) {
    const error = errText(e);
    await admin.from("cleo_actions").update({ status: "failed", error, updated_at: new Date().toISOString(), ...(decidedBy ? { decided_by: decidedBy, decided_at: new Date().toISOString() } : {}) }).eq("id", row.id);
    return { status: "failed" as const, error };
  }
}

async function getRow(id: string) {
  const admin = await service();
  const { data, error } = await admin.from("cleo_actions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That card is gone.");
  return data as any;
}

/** The requester taps Confirm (or "Ask <owner>"). */
export async function confirmAction(actor: ActorCtx, id: string) {
  const row = await getRow(id);
  if (row.requested_by !== actor.userId) throw new Error("Only the person Cleo offered this to can confirm it.");
  if (row.status !== "proposed") throw new Error("This was already handled.");
  if (isStale(row.created_at)) {
    await move(id, ["proposed"], "cancelled", { error: "Expired" }, actor.userId);
    throw new Error("This card is more than a day old. Ask Cleo again so it's up to date.");
  }
  const caller = await loadCaller(actor.supabase, actor.userId);
  if (routeFor(row.permission, caller) === "run") {
    const claimed = await move(id, ["proposed"], "running", {}, actor.userId);
    if (!claimed) throw new Error("This was already handled.");
    return runClaimed(actor, claimed, null);
  }
  const waiting = await move(id, ["proposed"], "awaiting_approval", {}, actor.userId);
  if (!waiting) throw new Error("This was already handled.");
  await pushOwners(actor.userId, waiting);
  return { status: "awaiting_approval" as const };
}

/** The requester changes their mind (before it ran). */
export async function cancelAction(actor: ActorCtx, id: string) {
  const row = await move(id, ["proposed", "awaiting_approval"], "cancelled", {}, actor.userId);
  if (!row) throw new Error("This was already handled.");
  return { status: "cancelled" as const };
}

async function assertOwner(actor: ActorCtx) {
  const caller = await loadCaller(actor.supabase, actor.userId);
  if (!caller.isOwner || !caller.isAdmin) throw new Error("Only the business owner can approve Cleo requests.");
}

/** The owner approves: it runs now, with the owner's session. */
export async function approveAction(actor: ActorCtx, id: string) {
  await assertOwner(actor);
  const claimed = await move(id, ["awaiting_approval"], "running");
  if (!claimed) throw new Error("This was already handled.");
  const out = await runClaimed(actor, claimed, actor.userId);
  await pushRequester(actor.userId, claimed, out.status === "done" ? "approved" : "failed");
  return out;
}

export async function declineAction(actor: ActorCtx, id: string) {
  await assertOwner(actor);
  const row = await move(id, ["awaiting_approval"], "declined", { decided_by: actor.userId, decided_at: new Date().toISOString() });
  if (!row) throw new Error("This was already handled.");
  await pushRequester(actor.userId, row, "declined");
  return { status: "declined" as const };
}

async function firstNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const admin = await service();
  const { data } = await admin.from("profiles").select("id, full_name").in("id", ids);
  for (const p of data ?? []) out.set(p.id, String(p.full_name ?? "").trim().split(/\s+/)[0] || "Someone");
  return out;
}

export async function ownerUserIds(): Promise<string[]> {
  const admin = await service();
  const { data } = await admin.from("business_owners").select("user_id");
  return (data ?? []).map((r: any) => r.user_id);
}

// Lockscreen copy says who and what kind of thing, never the content (same
// rule as every other push in the app).
async function pushOwners(requesterId: string, row: any) {
  try {
    const admin = await service();
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const name = (await firstNames([requesterId])).get(requesterId) ?? "Someone";
    const kind: unknown = row.kind;
    const info = isCleoActionKind(kind) ? CLEO_ACTION_INFO[kind].title : "Something";
    for (const uid of await ownerUserIds()) {
      if (uid === requesterId) continue;
      await sendWebPushToUser(admin, uid, { title: `${name} needs your OK`, body: `${info}. Tap to approve or decline in Cleo.`, url: "/admin#cleo", tag: `cleo-approval:${row.id}`, data: { kind: "cleo_approval", id: row.id } }, { category: "reminders", eventKey: `cleo-approval:${row.id}:${uid}` });
    }
  } catch (e) {
    console.warn("[cleo] approval push failed", e);
  }
}

async function pushRequester(ownerId: string, row: any, outcome: "approved" | "declined" | "failed") {
  try {
    const admin = await service();
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const name = (await firstNames([ownerId])).get(ownerId) ?? "The owner";
    const kind: unknown = row.kind;
    const info = isCleoActionKind(kind) ? CLEO_ACTION_INFO[kind].title : "Your request";
    const title = outcome === "declined" ? `${name} said no` : outcome === "approved" ? `${name} approved it` : `${name} approved it, but it didn't go through`;
    await sendWebPushToUser(admin, row.requested_by, { title, body: `${info}. Open Cleo for details.`, url: "/admin#cleo", tag: `cleo-decision:${row.id}`, data: { kind: "cleo_decision", id: row.id } }, { category: "reminders", eventKey: `cleo-decision:${row.id}:${outcome}` });
  } catch (e) {
    console.warn("[cleo] decision push failed", e);
  }
}

function toView(row: any, caller: Caller, names: Map<string, string>): CleoActionView {
  const k: unknown = row.kind;
  const kind: CleoActionKind = isCleoActionKind(k) ? k : "create_task";
  return {
    id: row.id,
    messageId: row.message_id ?? null,
    kind,
    title: CLEO_ACTION_INFO[kind].title,
    summary: row.summary,
    status: row.status === "proposed" && isStale(row.created_at) ? "cancelled" : row.status,
    route: routeFor(row.permission, caller),
    result: row.result ?? null,
    error: row.error ?? null,
    requestedBy: row.requested_by,
    requesterName: names.get(row.requested_by) ?? null,
    createdAt: row.created_at,
  };
}

/** Cards for this person's chat, plus (for the owner) everything waiting on them. */
export async function listActions(actor: ActorCtx) {
  const caller = await loadCaller(actor.supabase, actor.userId);
  const admin = await service();
  const [mine, waiting, owners] = await Promise.all([
    admin.from("cleo_actions").select("*").eq("requested_by", actor.userId).order("created_at", { ascending: false }).limit(200),
    caller.isOwner
      ? admin.from("cleo_actions").select("*").eq("status", "awaiting_approval").neq("requested_by", actor.userId).order("created_at").limit(50)
      : Promise.resolve({ data: [] }),
    ownerUserIds(),
  ]);
  const rows = [...(mine.data ?? []), ...(waiting.data ?? [])];
  const names = await firstNames([...new Set([...rows.map((r: any) => r.requested_by), ...owners])]);
  return {
    actions: (mine.data ?? []).map((r: any) => toView(r, caller, names)),
    approvals: (waiting.data ?? []).map((r: any) => toView(r, caller, names)),
    ownerName: owners.map((id) => names.get(id)).find(Boolean) ?? "the owner",
  };
}

/** Ties this turn's new cards to the reply that offered them. */
export async function attachToMessage(userId: string, ids: string[], messageId: string) {
  if (!ids.length) return;
  const admin = await service();
  await admin.from("cleo_actions").update({ message_id: messageId }).in("id", ids).eq("requested_by", userId);
}
