/**
 * Server side of Cleo's actions: propose (a card), confirm, cancel, and the
 * owner's approve / decline. Server-only.
 *
 * - The card's words come from the database, not from the model, so what the
 *   person confirms is what runs.
 * - An action always runs as the person who asked for it, never as whoever
 *   approved it. Within their role it runs on Confirm with their own session
 *   (the same server functions and RLS as the app's own buttons). A coach's
 *   card for their own client waits for the business owner, whose Approve only
 *   authorizes it: it then runs as the coach, written with the service role
 *   after their role and the client's assignment are checked again
 *   (`cleo_action_target_allowed`), every row naming the coach. What a role
 *   could never do (money for a coach) is never offered or run, and kinds that
 *   only work through request-bound server functions stay the owner's to do
 *   himself (CLEO_ACTION_RULES).
 * - cleo_actions rows are written with the service key only after the caller
 *   is checked, and every status change is a compare-and-set, so a double tap
 *   can't run something twice. `executed_as` records who it ran as, and the
 *   database holds it to the requester.
 */
import { BUSINESS_TZ, businessToday } from "@/lib/billing-schedule";
import { clientTaxRate } from "@/lib/client-billing-summary";
import { taxInside } from "@/lib/sale-money";
import { wallTimeToUtc } from "@/lib/schedule-time";
import {
  CLEO_ACTION_INFO, CLEO_ACTION_PARAMS, CLEO_ACTION_RULES, actionPermission, isCleoActionKind, isStale, notAllowedReason, routeFor,
  type Caller, type CleoActionKind, type CleoActionStatus, type CleoActionView,
} from "@/lib/cleo-actions";

export type ActorCtx = {
  /** The caller's own client (writes). On an approved request: the service role. */
  supabase: any;
  /** What to read with: the caller's client, or the finance login's admin view. On an approved request: the service role. */
  db: any;
  /** Who it runs as: always the person who asked for it. */
  userId: string;
  /**
   * Set only when the owner's approval runs a coach's request: every write is
   * the service role's, so the code names the requester on every row itself,
   * and nothing request-bound (server functions that read the tapper's session) may run.
   */
  asRequester?: { role: "admin" | "coach" };
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
  const isCoach = roleList.includes("coach");
  // A coach role never carries money through Cleo: permissions come only from the person's other roles.
  const permissionRoles = roleList.filter((r) => r !== "coach");
  let permissions: string[] = [];
  if (!isAdmin && permissionRoles.length) {
    const { data } = await supabase.from("role_permissions").select("permission").in("role", permissionRoles);
    permissions = (data ?? []).map((r: any) => r.permission);
  }
  return { isAdmin, isCoach, permissions, isOwner: owner?.data === true };
}

/** The database doesn't have a function this needs yet (the app shipped before its migration). */
function missingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|function .* does not exist/i.test(error.message ?? "");
}

/** The client a client-scoped card acts on, read with the service role (a missing row is a refusal). */
export async function targetClientOf(admin: any, kind: CleoActionKind, p: any): Promise<string> {
  let id: string | null = null;
  switch (kind) {
    case "edit_program_day":
      id = await clientOfDay(admin, p.day_id);
      break;
    case "publish_program": {
      const { data } = await admin.from("pl_blocks").select("client_id").eq("id", p.block_id).maybeSingle();
      id = data?.client_id ?? null;
      break;
    }
    case "correct_logged_exercise": {
      const { data } = await admin.from("pl_exercise_rows").select("day_id").eq("id", p.row_id).maybeSingle();
      id = data?.day_id ? await clientOfDay(admin, data.day_id) : null;
      break;
    }
    default:
      id = typeof p?.client_id === "string" ? p.client_id : null;
  }
  if (!id) throw new Error("I couldn't find whose that is.");
  return id;
}

/**
 * Whose a card would change, for a client's conversation (Nov 24 2026): the
 * client it resolves to, or null when it's about nobody in particular (a task)
 * or can't be told yet (it's then checked again when it runs). Service role,
 * read only; never throws.
 */
export async function scopeClientOf(kind: CleoActionKind, p: any): Promise<string | null> {
  try {
    const admin = await service();
    switch (kind) {
      case "edit_program_day":
        return await clientOfDay(admin, p.day_id);
      case "publish_program": {
        const { data } = await admin.from("pl_blocks").select("client_id").eq("id", p.block_id).maybeSingle();
        return data?.client_id ?? null;
      }
      case "correct_logged_exercise": {
        const { data } = await admin.from("pl_exercise_rows").select("day_id").eq("id", p.row_id).maybeSingle();
        return data?.day_id ? await clientOfDay(admin, data.day_id) : null;
      }
      case "record_payment":
      case "send_payment_link": {
        const { data } = await admin.from("purchase_records").select("client_id").eq("id", p.purchase_id).maybeSingle();
        return data?.client_id ?? null;
      }
      case "move_workout":
      case "remove_workout": {
        if (p.workout_id) {
          const { data } = await admin.from("pl_scheduled_workouts").select("client_id").eq("id", p.workout_id).maybeSingle();
          return data?.client_id ?? null;
        }
        return p.day_id ? await clientOfDay(admin, p.day_id) : null;
      }
      case "restore_program_version": {
        const { data } = await admin.from("pl_program_versions").select("client_id").eq("id", p.version_id).maybeSingle();
        return data?.client_id ?? null;
      }
      default:
        return typeof p?.client_id === "string" ? p.client_id : null;
    }
  } catch {
    return null;
  }
}

/**
 * May this person act on this client right now? The admin, or the client's
 * own active coach (`cleo_action_target_allowed`, a definer check that reads
 * the requester's roles and coach record, never the caller's session).
 * Fails closed when the database can't answer.
 */
export async function assertRequesterReaches(admin: any, requester: string, clientId: string): Promise<void> {
  const { data, error } = await admin.rpc("cleo_action_target_allowed", { _requester: requester, _client: clientId });
  if (missingFunction(error)) throw new Error("Cleo can't run coach requests until the database is updated.");
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("They're not this client's coach any more, so it wasn't done.");
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

/** A payment Cleo records: its cents and the GST/HST inside them, at the client's own rate (5% before any payment shows it). */
async function cleoPayment(db: any, p: any) {
  const pr = await purchase(db, p.purchase_id);
  const cents = Math.round(Number(p.amount) * 100);
  let rate: number | null = null;
  if (p.includes_tax !== false && pr.client_id) {
    const { data: sales } = await db.from("purchase_records").select("archived_at, amount_tax_paid_cents, amount_paid_cents").eq("client_id", pr.client_id);
    rate = clientTaxRate((sales ?? []) as any) ?? 0.05;
  }
  const date = p.date ?? businessToday();
  return { pr, cents, tax: taxInside(cents, rate), rate, date };
}

const METHOD_WORDS: Record<string, string> = {
  etransfer: "e-transfer", cash: "cash", cheque: "cheque", debit: "debit", credit_card: "card", bank_transfer: "bank transfer", other: "another way",
};

function money(n: number): string {
  return `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(date: string, time: string): string {
  const d = wallTimeToUtc(date, time, BUSINESS_TZ);
  return d.toLocaleString("en-CA", { timeZone: BUSINESS_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The card's words, from the database. Throws when the thing doesn't exist or can't be done. */
export async function describeAction(db: any, kind: CleoActionKind, p: any): Promise<string> {
  if (kind === "restore_program_version") {
    const { describeRestore } = await import("@/lib/cleo-history.server");
    return describeRestore(await service(), p.version_id);
  }
  const program = await import("@/lib/cleo-program.server");
  if (program.isProgramKind(kind)) return program.describeProgramAction(db, kind, p, businessToday());
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
    case "record_payment": {
      const { pr, cents, tax, rate, date } = await cleoPayment(db, p);
      if (date > businessToday()) throw new Error("That date hasn't happened yet.");
      const taxLine = tax > 0 ? ` (${money(tax / 100)} ${rate && rate > 0.0501 ? "HST" : "GST"} in it)` : " (no GST/HST in it)";
      return `Record ${money(cents / 100)} from ${clientLabel(pr.client)} by ${METHOD_WORDS[p.method] ?? p.method} on ${date} for ${pr.offer_name ?? "their purchase"}${taxLine}.${p.reference ? `\nReference: ${p.reference}` : ""}`;
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

export type ActionLink = { href: string; label: string };

/** The client a program row, day or block belongs to. */
async function clientOfDay(db: any, dayId: string): Promise<string | null> {
  const { data: d } = await db.from("pl_days").select("week_id").eq("id", dayId).maybeSingle();
  if (!d) return null;
  const { data: w } = await db.from("pl_weeks").select("block_id").eq("id", d.week_id).maybeSingle();
  if (!w) return null;
  const { data: b } = await db.from("pl_blocks").select("client_id").eq("id", w.block_id).maybeSingle();
  return b?.client_id ?? null;
}

/** Where to look at the change once it's done. Never throws: a card without a link is fine. */
export async function actionLink(db: any, kind: CleoActionKind, p: any): Promise<ActionLink | null> {
  try {
    const client = (id: string | null | undefined, tab: string, label: string) => (id ? { href: `/admin/clients/${id}?tab=${tab}`, label } : null);
    const training = (id: string | null | undefined) => client(id, "training", "Open their training");
    switch (kind) {
      case "create_task":
      case "complete_task":
        return { href: "/admin/tasks", label: "Open Tasks" };
      case "send_message":
      case "schedule_message":
        return { href: `/admin/communication?tab=messages&client=${p.client_id}`, label: "Open the chat" };
      case "add_client_note":
        return client(p.client_id, "notes", "Open their notes");
      case "mark_check_ins_reviewed":
        return client(p.client_id, "summary", "Open their profile");
      case "record_payment":
      case "send_payment_link": {
        const { data } = await db.from("purchase_records").select("client_id").eq("id", p.purchase_id).maybeSingle();
        return client(data?.client_id, "purchases", "Open their purchases");
      }
      case "book_appointment":
        return { href: "/admin/calendar", label: "Open Calendar" };
      case "assign_program_template":
      case "build_program":
      case "add_workout":
        return training(p.client_id);
      case "edit_program_day":
        return training(await clientOfDay(db, p.day_id));
      case "remove_workout": {
        if (p.day_id) return training(await clientOfDay(db, p.day_id));
        const { data } = await db.from("pl_scheduled_workouts").select("client_id").eq("id", p.workout_id).maybeSingle();
        return training(data?.client_id);
      }
      case "correct_logged_exercise": {
        const { data } = await db.from("pl_exercise_rows").select("day_id").eq("id", p.row_id).maybeSingle();
        const cid = data?.day_id ? await clientOfDay(db, data.day_id) : null;
        return cid ? { href: `/admin/client-programs/${cid}/history`, label: "Open workout history" } : null;
      }
      case "publish_program": {
        const { data } = await db.from("pl_blocks").select("client_id").eq("id", p.block_id).maybeSingle();
        return training(data?.client_id);
      }
      case "move_workout": {
        if (!p.workout_id) return training(await clientOfDay(db, p.day_id));
        const { data } = await db.from("pl_scheduled_workouts").select("client_id").eq("id", p.workout_id).maybeSingle();
        return training(data?.client_id);
      }
      case "set_nutrition_targets":
        return client(p.client_id, "nutrition", "Open their nutrition");
      case "restore_program_version": {
        const { data } = await (await service()).from("pl_program_versions").select("client_id, kind").eq("id", p.version_id).maybeSingle();
        return data?.kind === "set_nutrition_targets" ? client(data?.client_id, "nutrition", "Open their nutrition") : training(data?.client_id);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** A new card. Returns what Cleo should tell the person. */
export async function proposeAction(actor: ActorCtx, caller: Caller, kind: CleoActionKind, raw: unknown) {
  // Who may ask comes first: nothing is looked up (least of all with the service role) for a card that isn't theirs.
  const route = routeFor(kind, caller);
  if (route === "not_allowed") throw new Error(notAllowedReason(kind, "the owner"));
  const params = CLEO_ACTION_PARAMS[kind].parse(raw);
  const admin = await service();
  // A request the owner will approve runs as this person: their client, checked now and again when it runs.
  if (route === "ask_owner") await assertRequesterReaches(admin, actor.userId, await targetClientOf(admin, kind, params));
  const summary = await describeAction(actor.db, kind, params);
  const permission = actionPermission(kind, params);
  // Kept with the params (the schema drops unknown keys when it runs).
  const link = await actionLink(actor.db, kind, params);
  const { data, error } = await admin
    .from("cleo_actions")
    .insert({ requested_by: actor.userId, kind, params: { ...params, ...(link ? { _link: link } : {}) }, summary, permission, status: "proposed" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, summary, route };
}

/**
 * Runs it as `actor.userId`: with their own session on Confirm (same server
 * functions and RLS as the app), or with the service role on an approved
 * request (`asRequester`), where every row this writes names the requester.
 */
async function execute(actor: ActorCtx, kind: CleoActionKind, raw: unknown): Promise<string> {
  const p: any = CLEO_ACTION_PARAMS[kind].parse(raw);
  // Defense in depth: request-bound kinds would act as whoever tapped Approve.
  if (actor.asRequester && !CLEO_ACTION_RULES[kind].approvable) throw new Error("Only the owner can do this one himself.");
  const senderRole: "admin" | "coach" = actor.asRequester?.role ?? "admin";
  if (kind === "restore_program_version") {
    const { restoreVersion } = await import("@/lib/cleo-history.server");
    return restoreVersion(actor, p.version_id);
  }
  const program = await import("@/lib/cleo-program.server");
  if (program.isProgramKind(kind)) return program.executeProgramAction({ ...actor, role: senderRole }, kind, p, businessToday());
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
          sender_role: senderRole,
          body: p.body,
          attachments: [],
          message_type: "General",
          is_internal_note: false,
          read_by_admin_at: senderRole === "admin" ? new Date().toISOString() : null,
        })
        .select("id, client_id, sender_id, sender_role, is_internal_note, attachments")
        .single();
      if (error) throw new Error(error.message);
      await sb.from("conversation_state").update({ status: "open" }).eq("client_id", p.client_id).eq("status", "needs_response").then(() => {}, () => {});
      try {
        // The push the inbox sends (notifyNewMessage), for the message just written as its sender.
        const { pushNewMessage } = await import("@/lib/push/message-push.server");
        await pushNewMessage(await service(), data);
      } catch (e) {
        console.warn("[cleo] message push failed", e);
      }
      return "Message sent.";
    }
    case "schedule_message": {
      // The same row scheduleMessage writes, as the person who asked.
      const at = wallTimeToUtc(p.date, p.time, BUSINESS_TZ);
      if (at.getTime() < Date.now() - 30_000) throw new Error("That time has already passed.");
      const { scheduledMessageRow } = await import("@/lib/scheduled-messages.functions");
      const { error } = await sb
        .from("messages")
        .insert(scheduledMessageRow({ clientId: p.client_id, senderId: actor.userId, senderRole, body: p.body.trim(), when: at, tz: BUSINESS_TZ }));
      if (error) throw new Error(error.message);
      return `Scheduled for ${when(p.date, p.time)}.`;
    }
    case "add_client_note": {
      const { error } = await sb.from("client_file_notes").insert({ client_id: p.client_id, author_id: actor.userId, title: p.title, body: p.body, source: "client_file" });
      if (error) throw new Error(error.message);
      return "Note added.";
    }
    case "mark_check_ins_reviewed": {
      // On an approved request: the same updates, reviewed by the coach who asked (the RPC checks them again).
      const { data, error } = actor.asRequester
        ? await sb.rpc("cleo_mark_client_reviews_reviewed_as", { _actor: actor.userId, _client: p.client_id })
        : await sb.rpc("mark_client_reviews_reviewed", { _client_id: p.client_id });
      if (missingFunction(error)) throw new Error("Cleo can't run coach requests until the database is updated.");
      if (error) throw new Error(error.message);
      const n = Number(data ?? 0);
      return n ? `Marked ${n} item${n === 1 ? "" : "s"} reviewed.` : "Nothing was waiting.";
    }
    case "record_payment": {
      const { cents, tax, date } = await cleoPayment(actor.db, p);
      const { recordPayment } = await import("@/lib/billing.functions");
      const res: any = await recordPayment({
        data: {
          purchase_id: p.purchase_id, amount_minor: cents, tax_minor: tax, method: p.method, currency: "CAD",
          transaction_date: date, external_reference: p.reference ?? null, internal_note: "Recorded via Cleo",
        },
      });
      if (res?.duplicate) return `${money(cents / 100)} was already recorded a moment ago, so it wasn't added twice.`;
      return `${money(cents / 100)} recorded.${res?.autoPay?.ended ? " Nothing is owed now, so auto-pay stops at the end of this period." : ""}`;
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
  const run = (fields: Record<string, unknown>) => {
    let q = admin.from("cleo_actions").update({ status: to, updated_at: new Date().toISOString(), ...fields }).eq("id", id).in("status", from);
    if (requester) q = q.eq("requested_by", requester);
    return q.select("*").maybeSingle();
  };
  let { data, error } = await run(extra);
  // Before 20270507093000 there's no executed_as column: who it ran as is still the requester (the code holds it).
  if (error && "executed_as" in extra && /executed_as/.test(String(error.message ?? ""))) {
    const { executed_as: _skip, ...rest } = extra;
    ({ data, error } = await run(rest));
  }
  if (error) throw new Error(error.message);
  return data as any | null;
}

/** Runs a claimed card as `actor` (who is always its requester) and records the outcome. */
async function runClaimed(actor: ActorCtx, row: any) {
  const admin = await service();
  try {
    const kind: unknown = row.kind;
    if (!isCleoActionKind(kind)) throw new Error("Unknown action.");
    if (actor.userId !== row.requested_by) throw new Error("A card only ever runs as the person who asked for it.");
    // Program history: the state right before, so it can be undone.
    const history = await import("@/lib/cleo-history.server");
    const params = CLEO_ACTION_PARAMS[kind].parse(row.params);
    const before = await history.captureBefore(actor.supabase, kind, params).catch((e) => {
      console.warn("[cleo] program history capture failed", e);
      return null;
    });
    const result = await execute(actor, kind, row.params);
    if (before) await history.saveVersion(actor.supabase, before, kind, params, row.summary, row.id, actor.userId);
    await admin.from("cleo_actions").update({ status: "done", result, done_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
    return { status: "done" as const, result };
  } catch (e) {
    const error = errText(e);
    await admin.from("cleo_actions").update({ status: "failed", error, updated_at: new Date().toISOString() }).eq("id", row.id);
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
  if (!isCleoActionKind(row.kind)) throw new Error("Unknown action.");
  const kind: CleoActionKind = row.kind;
  const caller = await loadCaller(actor.supabase, actor.userId);
  // The rule for the kind now, never the permission stored on an older card.
  const route = routeFor(kind, caller);
  if (route === "not_allowed") {
    await move(id, ["proposed"], "cancelled", { error: "Not in their role" }, actor.userId);
    throw new Error(notAllowedReason(kind, "the owner"));
  }
  if (route === "run") {
    const claimed = await move(id, ["proposed"], "running", { executed_as: actor.userId }, actor.userId);
    if (!claimed) throw new Error("This was already handled.");
    return runClaimed(actor, claimed);
  }
  // Checked before it goes to the owner, and again when it runs.
  const admin = await service();
  await assertRequesterReaches(admin, actor.userId, await targetClientOf(admin, kind, CLEO_ACTION_PARAMS[kind].parse(row.params)));
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

/**
 * The context an approved request runs in: the requester, written with the
 * service role, after checking again (now, not when they asked) that their
 * role can still do this kind and that the client is still theirs.
 */
export async function requesterActor(row: any): Promise<ActorCtx> {
  const kind: unknown = row.kind;
  if (!isCleoActionKind(kind)) throw new Error("Unknown action.");
  const rule = CLEO_ACTION_RULES[kind];
  if (!rule.approvable) throw new Error("Only the owner can do this one himself. Ask Cleo for it yourself.");
  const admin = await service();
  const requester = await loadCaller(admin, row.requested_by);
  const route = routeFor(kind, requester);
  if (route === "not_allowed") throw new Error("Their role can't do this any more, so it wasn't done.");
  const params = CLEO_ACTION_PARAMS[kind].parse(row.params);
  await assertRequesterReaches(admin, row.requested_by, await targetClientOf(admin, kind, params));
  return { supabase: admin, db: admin, userId: row.requested_by, asRequester: { role: requester.isAdmin ? "admin" : "coach" } };
}

/**
 * The owner approves: his OK authorizes it, and it runs as the person who
 * asked (never with the owner's session or in his name).
 */
export async function approveAction(actor: ActorCtx, id: string) {
  await assertOwner(actor);
  const row = await getRow(id);
  if (row.status !== "awaiting_approval") throw new Error("This was already handled.");
  const now = new Date().toISOString();
  const claimed = await move(id, ["awaiting_approval"], "running", { decided_by: actor.userId, decided_at: now, executed_as: row.requested_by }, row.requested_by);
  if (!claimed) throw new Error("This was already handled.");
  let out: { status: "done"; result: string } | { status: "failed"; error: string };
  try {
    out = await runClaimed(await requesterActor(claimed), claimed);
  } catch (e) {
    const error = errText(e);
    await (await service()).from("cleo_actions").update({ status: "failed", error, updated_at: new Date().toISOString() }).eq("id", id);
    out = { status: "failed", error };
  }
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

function toView(row: any, caller: Caller, names: Map<string, string>, versions: Map<string, any> = new Map()): CleoActionView {
  const v = versions.get(row.id);
  const k: unknown = row.kind;
  const kind: CleoActionKind = isCleoActionKind(k) ? k : "create_task";
  return {
    id: row.id,
    messageId: row.message_id ?? null,
    kind,
    title: CLEO_ACTION_INFO[kind].title,
    summary: row.summary,
    status: row.status === "proposed" && isStale(row.created_at) ? "cancelled" : row.status,
    route: routeFor(kind, caller),
    result: row.result ?? null,
    error: row.error ?? null,
    requestedBy: row.requested_by,
    requesterName: names.get(row.requested_by) ?? null,
    createdAt: row.created_at,
    link: row.params?._link?.href && String(row.params._link.href).startsWith("/admin") ? { href: row.params._link.href, label: String(row.params._link.label ?? "Open") } : null,
    undo: v && row.status === "done" ? { versionId: v.id, undone: !!v.restored_at } : null,
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
  // Restore points for this person's done changes (admins only: history is theirs to undo).
  const versions = new Map<string, any>();
  const doneIds = (mine.data ?? []).filter((r: any) => r.status === "done").map((r: any) => r.id);
  if (caller.isAdmin && doneIds.length) {
    const { data } = await admin.from("pl_program_versions").select("id, cleo_action_id, restored_at").in("cleo_action_id", doneIds);
    for (const v of data ?? []) versions.set(v.cleo_action_id, v);
  }
  return {
    actions: (mine.data ?? []).map((r: any) => toView(r, caller, names, versions)),
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

/** Cards from an answer that was thrown away (never shown), so a retry doesn't double them. */
export async function discardProposals(userId: string, ids: string[]) {
  if (!ids.length) return;
  const admin = await service();
  await admin.from("cleo_actions").delete().in("id", ids).eq("requested_by", userId).eq("status", "proposed").is("message_id", null);
}


/** The Undo on a done card: puts that change back right away (admins only). */
export async function undoChange(actor: ActorCtx, versionId: string) {
  const caller = await loadCaller(actor.supabase, actor.userId);
  if (!caller.isAdmin) throw new Error("Only an admin can undo program changes.");
  const { restoreVersion } = await import("@/lib/cleo-history.server");
  return { result: await restoreVersion(actor, versionId) };
}
