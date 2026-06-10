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
};

export type NfConditionalRule = {
  question_id: string;
  op: "equals" | "not_equals" | "contains" | "gt" | "lt";
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
  conditional_logic: { show_if?: NfConditionalRule[]; match?: "all" | "any" };
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
  const { error } = await db.from("nf_questions").delete().eq("id", id);
  if (error) throw error;
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

  const { data: created, error } = await db
    .from("nf_submissions")
    .insert({ form_id: form.id, client_id: clientId, period_start: period, status: "in_progress" })
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
  if (error) throw error;
}

export async function getFileSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from("form-uploads")
    .createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
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
  const rules = q.conditional_logic?.show_if;
  if (!rules || rules.length === 0) return true;
  const match = q.conditional_logic?.match ?? "all";
  const evals = rules.map((r) => {
    const ans = answers[r.question_id];
    const v = ans?.value_text ?? ans?.value_number ?? "";
    switch (r.op) {
      case "equals": return String(v) === String(r.value);
      case "not_equals": return String(v) !== String(r.value);
      case "contains": return String(v).toLowerCase().includes(String(r.value).toLowerCase());
      case "gt": return Number(v) > Number(r.value);
      case "lt": return Number(v) < Number(r.value);
    }
  });
  return match === "all" ? evals.every(Boolean) : evals.some(Boolean);
}