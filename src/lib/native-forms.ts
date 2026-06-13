import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export const NF_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "number",
  "single_choice",
  "multi_choice",
  "dropdown",
  "rating",
  "date",
  "file",
  "video",
] as const;
export type NfQuestionType = (typeof NF_QUESTION_TYPES)[number];

export const NF_QUESTION_TYPE_LABEL: Record<NfQuestionType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  single_choice: "Single choice",
  multi_choice: "Checkboxes",
  dropdown: "Dropdown",
  rating: "Rating (1–10)",
  date: "Date",
  file: "File upload",
  video: "Video upload",
};

export type NfRecurrence = "none" | "weekly" | "biweekly" | "monthly";
export type NfSubmissionStatus = "in_progress" | "submitted" | "pending_review" | "reviewed";

export type NfKind = "native" | "external";
export type NfOpenStyle = "embed" | "modal" | "new_tab";
export type NfVisibility = "selected" | "all_active_clients";

export type NfForm = {
  id: string;
  title: string;
  description: string | null;
  form_type: string;
  recurrence: NfRecurrence;
  recurrence_day: string | null;
  active: boolean;
  archived: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  kind: NfKind;
  external_url: string | null;
  button_label: string | null;
  open_style: NfOpenStyle;
  visibility: NfVisibility;
  auto_assign_new_clients: boolean;
  requires_client_identity: boolean;
  popup_enabled?: boolean;
  popup_weekdays?: number[];
  popup_start_time?: string | null;
  popup_end_time?: string | null;
  popup_start_date?: string | null;
  popup_end_date?: string | null;
};

export type NfConditionalRule = {
  question_id: string;
  op: "equals" | "not_equals" | "contains" | "not_contains" | "gt" | "lt" | "is_empty" | "is_not_empty";
  value: string | number;
};

export type NfQuestion = {
  id: string;
  form_id: string;
  order_index: number;
  question_type: NfQuestionType;
  label: string;
  help_text: string | null;
  required: boolean;
  options: string[];
  validation: Record<string, unknown>;
  conditional_logic: {
    show_if?: NfConditionalRule[];
    hide_if?: NfConditionalRule[];
    match?: "all" | "any";
  };
  archived_at?: string | null;
};

export type NfAssignment = {
  id: string;
  form_id: string;
  client_id: string;
  recurrence: "inherit" | NfRecurrence;
  next_due_at: string | null;
  created_at: string;
};

export type NfSubmission = {
  id: string;
  form_id: string;
  client_id: string;
  status: NfSubmissionStatus;
  period_start: string | null;
  started_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NfAnswer = {
  id: string;
  submission_id: string;
  question_id: string;
  value_text: string | null;
  value_number: number | null;
  value_json: any;
};

export type NfFile = {
  id: string;
  submission_id: string;
  question_id: string;
  storage_path: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type NfReview = {
  id: string;
  submission_id: string;
  reviewer_user_id: string;
  reply_text: string;
  sent_to_messenger_at: string | null;
  message_id: string | null;
  created_at: string;
};

/* -------------------------- Forms -------------------------- */

export async function listForms(opts: { includeArchived?: boolean } = {}) {
  let q = db.from("nf_forms").select("*").order("updated_at", { ascending: false });
  if (!opts.includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as NfForm[];
}

export async function getForm(id: string) {
  const { data, error } = await db.from("nf_forms").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as NfForm | null;
}

export async function upsertForm(input: Partial<NfForm> & { id?: string }) {
  if (input.id) {
    const { error } = await db.from("nf_forms").update(input).eq("id", input.id);
    if (error) throw error;
    return input.id;
  }
  const { data, error } = await db.from("nf_forms").insert(input).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function duplicateForm(formId: string) {
  const form = await getForm(formId);
  if (!form) throw new Error("Form not found");
  const newId = await upsertForm({
    title: `${form.title} (copy)`,
    description: form.description ?? undefined,
    form_type: form.form_type,
    recurrence: form.recurrence,
    recurrence_day: form.recurrence_day ?? undefined,
    active: false,
  });
  const qs = await listQuestions(formId);
  if (qs.length) {
    await db.from("nf_questions").insert(qs.map((q) => ({
      form_id: newId,
      order_index: q.order_index,
      question_type: q.question_type,
      label: q.label,
      help_text: q.help_text,
      required: q.required,
      options: q.options,
      validation: q.validation,
      conditional_logic: q.conditional_logic,
    })));
  }
  return newId;
}

export async function archiveForm(id: string, archived: boolean) {
  const { error } = await db.from("nf_forms").update({ archived, active: archived ? false : true }).eq("id", id);
  if (error) throw error;
}

export async function deleteForm(id: string) {
  const { error } = await db.from("nf_forms").delete().eq("id", id);
  if (error) throw error;
}

/* -------------------------- Questions -------------------------- */

export async function listQuestions(formId: string) {
  const { data, error } = await db
    .from("nf_questions")
    .select("*")
    .eq("form_id", formId)
    .is("archived_at", null)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as NfQuestion[];
}

export async function upsertQuestion(input: Partial<NfQuestion> & { form_id: string; id?: string }) {
  if (input.id) {
    const { error } = await db.from("nf_questions").update(input).eq("id", input.id);
    if (error) throw error;
    return input.id;
  }
  const { data, error } = await db.from("nf_questions").insert(input).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function deleteQuestion(id: string) {
  // Soft-archive so historical submissions keep the original label/type/answer readable.
  const { error } = await db
    .from("nf_questions")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function listQuestionsIncludingArchived(formId: string) {
  const { data, error } = await db
    .from("nf_questions")
    .select("*")
    .eq("form_id", formId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as NfQuestion[];
}

export async function reorderQuestions(updates: { id: string; order_index: number }[]) {
  await Promise.all(
    updates.map((u) => db.from("nf_questions").update({ order_index: u.order_index }).eq("id", u.id)),
  );
}

/* -------------------------- Assignments -------------------------- */

export async function listAssignments(formId: string) {
  const { data, error } = await db
    .from("nf_assignments")
    .select("*, clients:client_id(id, full_name, email)")
    .eq("form_id", formId);
  if (error) throw error;
  return data ?? [];
}

export async function assignFormToClient(formId: string, clientId: string) {
  const { error } = await db
    .from("nf_assignments")
    .upsert({ form_id: formId, client_id: clientId }, { onConflict: "form_id,client_id" });
  if (error) throw error;
}

export async function unassignForm(formId: string, clientId: string) {
  const { error } = await db
    .from("nf_assignments")
    .delete()
    .eq("form_id", formId)
    .eq("client_id", clientId);
  if (error) throw error;
}

export async function listFormsForClient(clientId: string) {
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, status, archived")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) throw clientErr;
  if (!client || client.archived) return [];

  // Forms assigned directly to this client
  const { data: assignedRows, error: aErr } = await db
    .from("nf_assignments")
    .select("form:form_id(*)")
    .eq("client_id", clientId);
  if (aErr) throw aErr;
  const assigned = ((assignedRows ?? []).map((r: any) => r.form).filter(Boolean) as NfForm[]);

  const activeForBroadcast = ["Active", "New Client"].includes(client.status ?? "Active");
  let broadcast: NfForm[] = [];
  if (activeForBroadcast) {
    // Forms broadcast to all active coaching clients (no individual assignment needed)
    const { data: broadcastRows, error: bErr } = await db
      .from("nf_forms")
      .select("*")
      .eq("visibility", "all_active_clients")
      .eq("active", true)
      .eq("archived", false);
    if (bErr) throw bErr;
    broadcast = (broadcastRows ?? []) as NfForm[];
  }

  const map = new Map<string, NfForm>();
  for (const f of [...assigned, ...broadcast]) {
    if (f.active && !f.archived) map.set(f.id, f);
  }
  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
}

/* -------------------------- Bulk assignment helpers -------------------------- */

export async function listActiveCoachingClientIds(): Promise<string[]> {
  const { data, error } = await db
    .from("clients")
    .select("id")
    .eq("archived", false)
    .in("status", ["Active", "New Client"]);
  if (error) throw error;
  return (data ?? []).map((c: any) => c.id);
}

export async function bulkAssignFormToClients(formId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  const rows = clientIds.map((cid) => ({ form_id: formId, client_id: cid }));
  const { error } = await db
    .from("nf_assignments")
    .upsert(rows, { onConflict: "form_id,client_id" });
  if (error) throw error;
}

export async function clearAllAssignments(formId: string) {
  const { error } = await db.from("nf_assignments").delete().eq("form_id", formId);
  if (error) throw error;
}

/* -------------------------- External form opens -------------------------- */

export async function recordExternalOpen(form: NfForm, clientId: string) {
  // Create / reuse a submission row so we can track opens + submitted flag.
  return getOrCreateCurrentSubmission(form, clientId);
}

/* -------------------------- Submissions -------------------------- */

export function currentPeriodStart(recurrence: NfRecurrence, day: string | null): string {
  const d = new Date();
  if (recurrence === "weekly" || recurrence === "biweekly") {
    const targetDow = dayToNum(day ?? "Monday");
    const dow = d.getDay();
    const diff = (dow - targetDow + 7) % 7;
    d.setDate(d.getDate() - diff);
  } else if (recurrence === "monthly") {
    d.setDate(1);
  }
  return d.toISOString().slice(0, 10);
}

function dayToNum(day: string): number {
  const map: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
  };
  return map[day] ?? 1;
}

export async function getOrCreateCurrentSubmission(form: NfForm, clientId: string) {
  const period = form.recurrence === "none" ? null : currentPeriodStart(form.recurrence, form.recurrence_day);
  let q = db.from("nf_submissions").select("*").eq("form_id", form.id).eq("client_id", clientId);
  if (period) q = q.eq("period_start", period);
  else q = q.in("status", ["in_progress"]);
  const { data: existing } = await q.order("created_at", { ascending: false }).limit(1);
  const found = existing?.[0];
  if (found && (found.status === "in_progress" || form.recurrence !== "none")) return found as NfSubmission;

  // Stamp current published form version (if any) onto the submission.
  let formVersionId: string | null = null;
  let formVersionNumber: number | null = null;
  const { data: vrows } = await db
    .from("nf_form_versions")
    .select("id, version_number")
    .eq("form_id", form.id)
    .order("version_number", { ascending: false })
    .limit(1);
  if (vrows && vrows[0]) {
    formVersionId = vrows[0].id;
    formVersionNumber = vrows[0].version_number;
  }

  const { data: created, error } = await db
    .from("nf_submissions")
    .insert({
      form_id: form.id,
      client_id: clientId,
      period_start: period,
      status: "in_progress",
      form_version_id: formVersionId,
      form_version_number: formVersionNumber,
    })
    .select("*")
    .single();
  if (error) throw error;
  return created as NfSubmission;
}

export async function listSubmissionsForClient(clientId: string) {
  const { data, error } = await db
    .from("nf_submissions")
    .select("*, form:form_id(*)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAllSubmissionsForReview(opts: { status?: NfSubmissionStatus } = {}) {
  let q = db
    .from("nf_submissions")
    .select("*, form:form_id(id,title,recurrence), client:client_id(id,full_name,profile_picture_url)")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getSubmission(id: string) {
  const { data, error } = await db
    .from("nf_submissions")
    .select("*, form:form_id(*), client:client_id(id,full_name,user_id,profile_picture_url)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function submitSubmission(id: string) {
  const { error } = await db
    .from("nf_submissions")
    .update({ status: "pending_review", submitted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function markReviewed(id: string, userId: string) {
  const { error } = await db
    .from("nf_submissions")
    .update({ status: "reviewed", reviewed_at: new Date().toISOString(), reviewed_by: userId })
    .eq("id", id);
  if (error) throw error;
}

/* -------------------------- Answers -------------------------- */

export async function listAnswers(submissionId: string) {
  const { data, error } = await db.from("nf_answers").select("*").eq("submission_id", submissionId);
  if (error) throw error;
  return (data ?? []) as NfAnswer[];
}

export async function upsertAnswer(input: {
  submission_id: string;
  question_id: string;
  value_text?: string | null;
  value_number?: number | null;
  value_json?: any;
}) {
  const { error } = await db.from("nf_answers").upsert(
    {
      submission_id: input.submission_id,
      question_id: input.question_id,
      value_text: input.value_text ?? null,
      value_number: input.value_number ?? null,
      value_json: input.value_json ?? null,
    },
    { onConflict: "submission_id,question_id" },
  );
  if (error) throw error;
}

/* -------------------------- Files -------------------------- */

export async function listFiles(submissionId: string) {
  const { data, error } = await db.from("nf_files").select("*").eq("submission_id", submissionId);
  if (error) throw error;
  return (data ?? []) as NfFile[];
}

export async function uploadFormFile(opts: {
  clientId: string;
  submissionId: string;
  questionId: string;
  file: File;
}) {
  const ext = opts.file.name.split(".").pop() || "bin";
  const path = `${opts.clientId}/${opts.submissionId}/${opts.questionId}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("form-uploads").upload(path, opts.file, {
    upsert: false,
    contentType: opts.file.type || undefined,
  });
  if (upErr) throw upErr;
  const { error } = await db.from("nf_files").insert({
    submission_id: opts.submissionId,
    question_id: opts.questionId,
    storage_path: path,
    original_name: opts.file.name,
    mime_type: opts.file.type,
    size_bytes: opts.file.size,
  });
  if (error) {
    // Roll back the orphan storage object if the DB row insert was rejected.
    await supabase.storage.from("form-uploads").remove([path]).catch(() => {});
    throw error;
  }
}

export async function getFileSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from("form-uploads")
    .createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Verify the current user owns the file's submission and that the submission
 * is still editable. Returns the file row + storage_path on success.
 * Throws on missing ownership, missing record, or locked submission.
 */
async function assertEditableOwnedFile(fileId: string): Promise<NfFile> {
  const { data, error } = await db
    .from("nf_files")
    .select("id, storage_path, submission_id, question_id, original_name, mime_type, size_bytes, created_at, submission:submission_id(status, client:client_id(user_id))")
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("File not found or you don't have access");
  const sub = (data as any).submission;
  const ownerUserId = sub?.client?.user_id;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id || ownerUserId !== auth.user.id) {
    throw new Error("You can only modify files you uploaded");
  }
  if (sub?.status && sub.status !== "in_progress") {
    throw new Error("This submission is locked — files can no longer be changed");
  }
  return data as NfFile;
}

export async function removeFormFile(fileId: string) {
  const file = await assertEditableOwnedFile(fileId);
  // Delete the DB row first (RLS re-enforces ownership). Only purge storage
  // after the row is gone so a failure can't leave the DB pointing at a
  // missing object.
  const { error: delErr } = await db.from("nf_files").delete().eq("id", file.id);
  if (delErr) throw delErr;
  await supabase.storage.from("form-uploads").remove([file.storage_path]).catch(() => {});
}

export async function replaceFormFile(opts: {
  fileId: string;
  clientId: string;
  file: File;
}) {
  const old = await assertEditableOwnedFile(opts.fileId);
  const ext = opts.file.name.split(".").pop() || "bin";
  const path = `${opts.clientId}/${old.submission_id}/${old.question_id}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("form-uploads")
    .upload(path, opts.file, { upsert: false, contentType: opts.file.type || undefined });
  if (upErr) throw upErr;

  // Update the existing row in place (no duplicate rows).
  const { error: updErr } = await db
    .from("nf_files")
    .update({
      storage_path: path,
      original_name: opts.file.name,
      mime_type: opts.file.type,
      size_bytes: opts.file.size,
    })
    .eq("id", opts.fileId);
  if (updErr) {
    await supabase.storage.from("form-uploads").remove([path]).catch(() => {});
    throw updErr;
  }

  // Purge the previous storage object only after the DB commit succeeded.
  if (old.storage_path && old.storage_path !== path) {
    await supabase.storage.from("form-uploads").remove([old.storage_path]).catch(() => {});
  }
}

/* -------------------------- Reviews -------------------------- */

export async function getReview(submissionId: string) {
  const { data, error } = await db
    .from("nf_reviews")
    .select("*")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as NfReview | null;
}

export async function createReview(input: {
  submissionId: string;
  reviewerUserId: string;
  replyText: string;
}) {
  const { data, error } = await db
    .from("nf_reviews")
    .insert({
      submission_id: input.submissionId,
      reviewer_user_id: input.reviewerUserId,
      reply_text: input.replyText,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as NfReview;
}

export async function markReviewMessenged(reviewId: string, messageId: string) {
  const { error } = await db
    .from("nf_reviews")
    .update({ sent_to_messenger_at: new Date().toISOString(), message_id: messageId })
    .eq("id", reviewId);
  if (error) throw error;
}

/* -------------------------- Helpers -------------------------- */

export function statusLabel(s: NfSubmissionStatus | "not_started"): string {
  switch (s) {
    case "not_started": return "Not Started";
    case "in_progress": return "In Progress";
    case "submitted": return "Submitted";
    case "pending_review": return "Pending Review";
    case "reviewed": return "Reviewed";
  }
}

export function statusTone(s: NfSubmissionStatus | "not_started") {
  switch (s) {
    case "not_started": return "border-border text-muted-foreground bg-muted/30";
    case "in_progress": return "border-warning/30 text-warning bg-warning/10";
    case "submitted":
    case "pending_review": return "border-primary/30 text-primary bg-primary/10";
    case "reviewed": return "border-emerald-500/30 text-emerald-600 bg-emerald-500/10";
  }
}

export function shouldShowQuestion(q: NfQuestion, answers: Record<string, NfAnswer | undefined>): boolean {
  const cl = q.conditional_logic ?? {};
  const match = cl.match ?? "all";
  const evalRule = (r: NfConditionalRule): boolean => {
    const ans = answers[r.question_id];
    const raw = ans?.value_text ?? (ans?.value_number != null ? String(ans.value_number) : "")
      ?? (Array.isArray(ans?.value_json) ? (ans!.value_json as any[]).join(",") : "");
    const v = String(raw ?? "");
    switch (r.op) {
      case "equals": return v === String(r.value);
      case "not_equals": return v !== String(r.value);
      case "contains": return v.toLowerCase().includes(String(r.value).toLowerCase());
      case "not_contains": return !v.toLowerCase().includes(String(r.value).toLowerCase());
      case "gt": return Number(v) > Number(r.value);
      case "lt": return Number(v) < Number(r.value);
      case "is_empty": return v.trim() === "";
      case "is_not_empty": return v.trim() !== "";
      default: return true;
    }
  };
  const combine = (rules: NfConditionalRule[]) =>
    match === "all" ? rules.every(evalRule) : rules.some(evalRule);
  const showRules = cl.show_if ?? [];
  const hideRules = cl.hide_if ?? [];
  if (showRules.length > 0 && !combine(showRules)) return false;
  if (hideRules.length > 0 && combine(hideRules)) return false;
  return true;
}

/* -------------------------- Versions -------------------------- */

export type NfFormVersion = {
  id: string;
  form_id: string;
  version_number: number;
  form_snapshot: any;
  questions_snapshot: NfQuestion[];
  change_reason: string | null;
  created_at: string;
  created_by: string | null;
};

export async function listFormVersions(formId: string) {
  const { data, error } = await db
    .from("nf_form_versions")
    .select("*")
    .eq("form_id", formId)
    .order("version_number", { ascending: false });
  if (error) throw error;
  return (data ?? []) as NfFormVersion[];
}

export async function getFormVersion(versionId: string) {
  const { data, error } = await db
    .from("nf_form_versions").select("*").eq("id", versionId).maybeSingle();
  if (error) throw error;
  return data as NfFormVersion | null;
}

/**
 * Validate a conditional-logic config against the question set.
 * Returns null on success, otherwise a human-readable error message.
 */
export function validateConditionalLogic(
  question: NfQuestion,
  allQuestions: NfQuestion[],
): string | null {
  const cl = question.conditional_logic ?? {};
  const rules = [...(cl.show_if ?? []), ...(cl.hide_if ?? [])];
  if (rules.length === 0) return null;

  const byId = new Map(allQuestions.map((q) => [q.id, q]));
  const myIndex = allQuestions.findIndex((q) => q.id === question.id);

  for (const r of rules) {
    if (!r.question_id) return "Select a source question for every rule.";
    if (r.question_id === question.id) return "A question cannot reference itself.";
    const src = byId.get(r.question_id);
    if (!src) return "A rule references a question that no longer exists.";
    if (src.archived_at) return `Rule source "${src.label}" has been deleted/archived.`;
    const srcIndex = allQuestions.findIndex((q) => q.id === src.id);
    if (srcIndex > myIndex && myIndex >= 0) {
      return `Rule source "${src.label}" appears AFTER this question — it must come before.`;
    }
    // Circular: walk the dependency graph from src.
    const seen = new Set<string>([question.id]);
    const stack = [src.id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) return "Circular conditional reference detected.";
      seen.add(cur);
      const q2 = byId.get(cur);
      if (!q2) continue;
      const more = [
        ...(q2.conditional_logic?.show_if ?? []),
        ...(q2.conditional_logic?.hide_if ?? []),
      ];
      for (const rr of more) if (rr.question_id) stack.push(rr.question_id);
    }
    if (["gt", "lt"].includes(r.op) && Number.isNaN(Number(r.value))) {
      return `Operator "${r.op}" needs a numeric value.`;
    }
    if (["is_empty", "is_not_empty"].includes(r.op)) continue;
    if (r.value === "" || r.value == null) return "Every rule needs a value.";
  }
  return null;
}