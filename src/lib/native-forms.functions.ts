import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AssignmentSchema = z.object({
  formId: z.string().uuid(),
  clientId: z.string().uuid(),
  assigned: z.boolean(),
});

const BulkAssignmentSchema = z.object({
  formId: z.string().uuid(),
  clientIds: z.array(z.string().uuid()).max(1000),
});

const ReplaceAssignmentsSchema = z.object({
  formId: z.string().uuid(),
  clientIds: z.array(z.string().uuid()).max(5000),
});

const ReplaceClientAssignmentsSchema = z.object({
  clientId: z.string().uuid(),
  formIds: z.array(z.string().uuid()).max(1000),
});

const FormAccessSchema = z.object({
  formId: z.string().uuid(),
  visibility: z.enum(["selected", "all_active_clients"]).optional(),
  autoAssignNewClients: z.boolean().optional(),
});

const FormSchema = z.object({ formId: z.string().uuid() });
const DeleteFormsSchema = z.object({ formIds: z.array(z.string().uuid()).min(1).max(500) });

async function getAssignmentAccess(userId: string, clientIds: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: adminRole, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError) throw new Error(roleError.message);
  if (adminRole) return { supabaseAdmin, isAdmin: true, coachId: null as string | null };

  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("user_id", userId)
    .eq("archived", false)
    .eq("status", "Active")
    .maybeSingle();
  if (coachError) throw new Error(coachError.message);
  if (!coach) throw new Error("You do not have permission to assign forms.");

  const uniqueClientIds = Array.from(new Set(clientIds));
  if (uniqueClientIds.length > 0) {
    const { data: allowedClients, error: clientsError } = await supabaseAdmin
      .from("clients")
      .select("id")
      .in("id", uniqueClientIds)
      .eq("assigned_coach_id", coach.id)
      .eq("archived", false);
    if (clientsError) throw new Error(clientsError.message);
    if ((allowedClients ?? []).length !== uniqueClientIds.length) {
      throw new Error("You can only assign forms to clients assigned to you.");
    }
  }

  return { supabaseAdmin, isAdmin: false, coachId: coach.id as string };
}

/** A coach assigns only forms in their own library (their own, the organization's, shared ones): what RLS on nf_forms lets them read. */
async function assertFormsInLibrary(supabase: any, formIds: string[]) {
  const ids = Array.from(new Set(formIds));
  if (!ids.length) return;
  const { data, error } = await supabase.from("nf_forms").select("id").in("id", ids);
  if (error) throw new Error(error.message);
  if ((data ?? []).length !== ids.length) throw new Error("You can only send forms from your own library.");
}

export const setNativeFormAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AssignmentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const access0 = await getAssignmentAccess(context.userId, [data.clientId]);
    if (!access0.isAdmin) await assertFormsInLibrary(context.supabase, [data.formId]);
    const { supabaseAdmin } = access0;

    if (data.assigned) {
      const { error } = await supabaseAdmin
        .from("nf_assignments")
        .upsert({ form_id: data.formId, client_id: data.clientId }, { onConflict: "form_id,client_id" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("nf_assignments")
        .delete()
        .eq("form_id", data.formId)
        .eq("client_id", data.clientId);
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

export const bulkAssignNativeFormToClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BulkAssignmentSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (data.clientIds.length === 0) return { ok: true, count: 0 };
    const access0 = await getAssignmentAccess(context.userId, data.clientIds);
    if (!access0.isAdmin) await assertFormsInLibrary(context.supabase, [data.formId]);
    const { supabaseAdmin } = access0;
    const rows = Array.from(new Set(data.clientIds)).map((clientId) => ({ form_id: data.formId, client_id: clientId }));
    const { error } = await supabaseAdmin
      .from("nf_assignments")
      .upsert(rows, { onConflict: "form_id,client_id" });
    if (error) throw new Error(error.message);
    return { ok: true, count: rows.length };
  });

export const clearNativeFormAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FormSchema.parse(input))
  .handler(async ({ data, context }) => {
    const access = await getAssignmentAccess(context.userId, []);
    if (!access.isAdmin) await assertFormsInLibrary(context.supabase, [data.formId]);
    let query = access.supabaseAdmin.from("nf_assignments").delete().eq("form_id", data.formId);

    if (!access.isAdmin) {
      const coachId = access.coachId;
      if (!coachId) throw new Error("You do not have permission to clear assignments.");
      const { data: coachClients, error: clientsError } = await access.supabaseAdmin
        .from("clients")
        .select("id")
        .eq("assigned_coach_id", coachId)
        .eq("archived", false);
      if (clientsError) throw new Error(clientsError.message);
      const clientIds = (coachClients ?? []).map((client: any) => client.id);
      if (clientIds.length === 0) return { ok: true };
      query = query.in("client_id", clientIds);
    }

    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const replaceNativeFormAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReplaceAssignmentsSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const clientIds = Array.from(new Set(data.clientIds));
      const access = await getAssignmentAccess(context.userId, clientIds);
      if (!access.isAdmin) await assertFormsInLibrary(context.supabase, [data.formId]);

      if (access.isAdmin) {
        // Only the clients taken off: everyone kept keeps their row as it was.
        let del = access.supabaseAdmin.from("nf_assignments").delete().eq("form_id", data.formId);
        if (clientIds.length) del = del.not("client_id", "in", `(${clientIds.join(",")})`);
        const { error: deleteError } = await del;
        if (deleteError) throw new Error(deleteError.message);
      } else {
        const coachId = access.coachId;
        if (!coachId) throw new Error("You do not have permission to save assignments.");
        const { data: coachClients, error: clientsError } = await access.supabaseAdmin
          .from("clients")
          .select("id")
          .eq("assigned_coach_id", coachId)
          .eq("archived", false);
        if (clientsError) throw new Error(clientsError.message);
        const coachClientIds = (coachClients ?? []).map((client: any) => client.id).filter((id: string) => !clientIds.includes(id));
        if (coachClientIds.length > 0) {
          const { error: deleteError } = await access.supabaseAdmin
            .from("nf_assignments")
            .delete()
            .eq("form_id", data.formId)
            .in("client_id", coachClientIds);
          if (deleteError) throw new Error(deleteError.message);
        }
      }

      if (clientIds.length > 0) {
        const rows = clientIds.map((clientId) => ({ form_id: data.formId, client_id: clientId }));
        const { error: insertError } = await access.supabaseAdmin
          .from("nf_assignments")
          .upsert(rows, { onConflict: "form_id,client_id", ignoreDuplicates: true });
        if (insertError) throw new Error(insertError.message);
      }

      return { ok: true, count: clientIds.length, error: null as string | null };
    } catch (error: any) {
      return { ok: false, count: 0, error: error?.message ?? "Assignments could not be saved." };
    }
  });

export const replaceClientNativeFormAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReplaceClientAssignmentsSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const formIds = Array.from(new Set(data.formIds));
      const access = await getAssignmentAccess(context.userId, [data.clientId]);
      if (!access.isAdmin) await assertFormsInLibrary(context.supabase, formIds);

      // Only what changed: a form still on keeps its row (when it was asked for,
      // what it was sent with), so saving this list never reopens or resets one.
      const { data: existing, error: readError } = await access.supabaseAdmin
        .from("nf_assignments")
        .select("form_id")
        .eq("client_id", data.clientId);
      if (readError) throw new Error(readError.message);
      const had = new Set(((existing ?? []) as Array<{ form_id: string }>).map((r) => r.form_id));
      const drop = [...had].filter((id) => !formIds.includes(id));
      if (drop.length) {
        const { error: deleteError } = await access.supabaseAdmin
          .from("nf_assignments")
          .delete()
          .eq("client_id", data.clientId)
          .in("form_id", drop);
        if (deleteError) throw new Error(deleteError.message);
      }

      const add = formIds.filter((id) => !had.has(id));
      if (add.length > 0) {
        const rows = add.map((formId) => ({ form_id: formId, client_id: data.clientId }));
        const { error: insertError } = await access.supabaseAdmin
          .from("nf_assignments")
          .upsert(rows, { onConflict: "form_id,client_id", ignoreDuplicates: true });
        if (insertError) throw new Error(insertError.message);
      }

      return { ok: true, count: formIds.length, error: null as string | null };
    } catch (error: any) {
      return { ok: false, count: 0, error: error?.message ?? "Client form assignments could not be saved." };
    }
  });

export const updateNativeFormAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FormAccessSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: adminRole, error: roleError } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (roleError) throw new Error(roleError.message);
      if (!adminRole) throw new Error("Only admins can change form access settings.");

      const patch: Record<string, any> = {};
      if (data.visibility) patch.visibility = data.visibility;
      if (typeof data.autoAssignNewClients === "boolean") {
        patch.auto_assign_new_clients = data.autoAssignNewClients;
      }
      if (Object.keys(patch).length === 0) return { ok: true, error: null as string | null };

      const { error } = await (supabaseAdmin as any).from("nf_forms").update(patch).eq("id", data.formId);
      if (error) throw new Error(error.message);
      return { ok: true, error: null as string | null };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? "Form access settings could not be saved." };
    }
  });

export const deleteNativeForms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteFormsSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: adminRole, error: roleError } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (roleError) throw new Error(roleError.message);
      if (!adminRole) throw new Error("Only admins can delete forms.");

      const formIds = Array.from(new Set(data.formIds));
      const { error } = await supabaseAdmin.from("nf_forms").delete().in("id", formIds);
      if (error) throw new Error(error.message);
      return { ok: true, count: formIds.length, error: null as string | null };
    } catch (error: any) {
      return { ok: false, count: 0, error: error?.message ?? "Forms could not be deleted." };
    }
  });
const SendSchema = z.object({
  formId: z.string().uuid(),
  clientIds: z.array(z.string().uuid()).min(1).max(1000),
  competitionId: z.string().uuid().nullable().optional(),
  /** The meet a checklist is for (picked when sending). */
  meet: z
    .object({
      name: z.string().trim().max(120).nullable().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      weight_class: z.string().trim().max(60).nullable().optional(),
    })
    .nullable()
    .optional(),
  /** Meet-day reminders for this send (on by default where the form has them). */
  reminders: z.boolean().optional(),
});

/**
 * Send a form from the chat (or a client's profile): the form must be one the
 * sender can see in their library (read as them), the clients theirs. Each
 * assignment remembers who sent it and when (Recently sent), and what it was
 * sent with (the meet, reminders). A form the athlete keeps updating starts a
 * fresh copy only when it's sent for a different meet, or the last copy is
 * over 45 days old; otherwise it's a nudge to the same one.
 */
export const sendNativeFormFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const clientIds = Array.from(new Set(data.clientIds));
    const { supabaseAdmin } = await getAssignmentAccess(context.userId, clientIds);
    const { data: form, error: formErr } = await (context.supabase as any)
      .from("nf_forms")
      .select("id, title, active, archived, allow_updates, form_type, settings")
      .eq("id", data.formId)
      .maybeSingle();
    if (formErr) throw new Error(formErr.message);
    if (!form || form.archived) throw new Error("That form isn't in your library.");
    const admin = supabaseAdmin as any;
    const prepForm = form.settings?.lift_request === true || form.settings?.competition_cue_profile === true;
    let competition: any = null;
    if (data.competitionId) {
      if (!prepForm || clientIds.length !== 1) throw new Error("Choose one athlete for this competition.");
      const {data: row, error} = await admin.from("competitions").select("id,client_id,name,meet_date,weight_class").eq("id",data.competitionId).eq("client_id",clientIds[0]).maybeSingle();
      if (error || !row) throw new Error("Competition not found for this athlete.");
      competition = row;
    }
    // A draft is switched on when it's sent: a client can't open an inactive form.
    if (!form.active) {
      const { error } = await admin.from("nf_forms").update({ active: true }).eq("id", form.id);
      if (error) throw new Error(error.message);
    }

    const now = new Date().toISOString();
    const meet = competition ? {name:competition.name,date:competition.meet_date,weight_class:competition.weight_class ?? null} : data.meet && (data.meet.name || data.meet.date) ? { name: data.meet.name ?? null, date: data.meet.date ?? null, weight_class: data.meet.weight_class ?? null } : null;
    const [{ data: existing }, { data: lastSubs }, { data: qs }] = await Promise.all([
      admin.from("nf_assignments").select("client_id, settings").eq("form_id", form.id).in("client_id", clientIds),
      form.allow_updates
        ? admin.from("nf_submissions").select("id, client_id, status, created_at").eq("form_id", form.id).in("client_id", clientIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      form.allow_updates ? admin.from("nf_questions").select("id, validation").eq("form_id", form.id) : Promise.resolve({ data: [] }),
    ]);
    const settingsBy = new Map<string, Record<string, unknown>>(((existing ?? []) as any[]).map((r) => [r.client_id, (r.settings ?? {}) as Record<string, unknown>]));
    const latestBy = new Map<string, any>();
    for (const sub of (lastSubs ?? []) as any[]) if (!latestBy.has(sub.client_id)) latestBy.set(sub.client_id, sub);

    let fresh = 0;
    const rows = [];
    for (const clientId of clientIds) {
      const settings: Record<string, unknown> = { ...(settingsBy.get(clientId) ?? {}) };
      if (prepForm) {
        // Keep all previously sent meet contexts; a later send must not retarget an old chat card.
        const history: Record<string,unknown> = {...((settings.prep_competitions ?? {}) as Record<string,unknown>)};
        const previous = typeof settings.competition_id === "string" ? settings.competition_id : "general";
        if (settingsBy.has(clientId) && !(previous in history)) history[previous] = settings.meet ?? null;
        history[competition?.id ?? "general"] = meet;
        settings.prep_competitions = history;
        if (competition) settings.competition_id = competition.id;
        else { delete settings.competition_id; delete settings.meet; }
      }
      if (meet) settings.meet = meet;
      if (typeof data.reminders === "boolean") settings.reminders = data.reminders;
      const last = latestBy.get(clientId);
      if (!prepForm && form.allow_updates && last && last.status !== "in_progress" && !competition) {
        let newCopy = Date.now() - Date.parse(last.created_at) > 45 * 86_400_000;
        if (meet) {
          const { meetFacts } = await import("@/lib/meet-checklist");
          const { data: answers } = await admin.from("nf_answers").select("question_id, value_text, value_number, value_json").eq("submission_id", last.id);
          const byQ: Record<string, any> = {};
          for (const a of (answers ?? []) as any[]) byQ[a.question_id] = a;
          const facts = meetFacts((qs ?? []) as any[], byQ);
          const sameDate = !meet.date || !facts.meetDate || facts.meetDate === meet.date;
          const sameName = !meet.name || !facts.meetName || facts.meetName.trim().toLowerCase() === meet.name.trim().toLowerCase();
          newCopy = !(sameDate && sameName);
        }
        if (newCopy) {
          settings.new_copy_since = now;
          fresh++;
        }
      }
      rows.push({ form_id: form.id, client_id: clientId, last_sent_by: context.userId, last_sent_at: now, settings });
    }
    const { error } = await admin.from("nf_assignments").upsert(rows, { onConflict: "form_id,client_id" });
    if (error) throw new Error(error.message);
    return { ok: true, count: rows.length, freshCopies: fresh, title: form.title as string };
  });

/**
 * "Draft with AI": a coach describes the form, a model writes the questions
 * (route `form_draft`, the OpenAI key), and code reads them (parseFormDraft)
 * into a draft saved as the coach (their own form, inactive, never sent).
 * Coach-only AI, so it isn't metered with AI credits.
 */
export const draftFormWithAiFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ prompt: z.string().trim().min(8).max(2000), category: z.string().trim().max(60).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const [{ data: isAdmin }, { data: coach }] = await Promise.all([
      db.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      db.from("coaches").select("id").eq("user_id", context.userId).eq("archived", false).maybeSingle(),
    ]);
    if (!isAdmin && !coach) throw new Error("Only coaches can make forms.");
    const [{ callModelNow }, { resolveRoute }, { FORM_DRAFT_SYSTEM, parseFormDraft }] = await Promise.all([
      import("@/lib/ai/model-client.server"),
      import("@/lib/ai/routing"),
      import("@/lib/form-draft"),
    ]);
    const route = resolveRoute("form_draft");
    let draft: ReturnType<typeof parseFormDraft> = null;
    let lastError = "no answer";
    for (const model of route.models) {
      try {
        const reply = await callModelNow(model, {
          system: FORM_DRAFT_SYSTEM,
          prompt: data.prompt,
          effort: route.effort,
          maxOutputTokens: route.maxOutputTokens,
          timeoutMs: 45_000,
          tag: "form_draft",
        });
        draft = parseFormDraft(reply.text);
        if (draft) break;
        lastError = "the answer wasn't a form";
      } catch (e: any) {
        lastError = e?.message ?? lastError;
        console.error("[form-draft] model failed", { model, message: lastError });
      }
    }
    if (!draft) throw new Error(`The AI couldn't draft that form (${lastError}). Try describing it another way, or start blank.`);
    const { data: form, error } = await db
      .from("nf_forms")
      .insert({
        title: draft.title,
        description: draft.description,
        category: data.category || draft.category,
        form_type: "check_in",
        recurrence: "none",
        active: false,
        kind: "native",
        visibility: "selected",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const rows = draft.questions.map((q, i) => ({ ...q, form_id: form.id, order_index: i }));
    const { error: qErr } = await db.from("nf_questions").insert(rows);
    if (qErr) {
      await db.from("nf_forms").delete().eq("id", form.id);
      throw new Error(qErr.message);
    }
    return { formId: form.id as string, questions: rows.length };
  });
