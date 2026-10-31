/**
 * Admin → Forms → Submissions: every kind of submission in one list
 * (form-submissions.ts). Read as the signed-in coach, so RLS decides what
 * each login sees; staff only.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NUTRITION_REQUEST_FORM_ID } from "@/lib/nutrition-ai-prompts";
import { nativeKind, type FormSubmission } from "@/lib/form-submissions";

/** A year back: the list is small (a few hundred rows a year), so it loads whole and filters on the phone. */
const WINDOW_DAYS = 365;
const LIMIT = 1500;

async function isStaff(sb: any, userId: string): Promise<boolean> {
  const [{ data: a }, { data: c }] = await Promise.all([
    sb.rpc("has_role", { _user_id: userId, _role: "admin" }),
    sb.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  return !!a || !!c;
}

const unit = (u: string | null | undefined) => (String(u ?? "").toLowerCase().startsWith("kg") ? "kg" : "lb");

export const listFormSubmissionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FormSubmission[]> => {
    const sb = context.supabase as any;
    if (!(await isStaff(sb, context.userId))) throw new Error("Coach access required");
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    // Each source on its own: one that fails (or that this login can't read) never empties the list.
    const safe = async (q: PromiseLike<{ data: any[] | null; error: any }>) => {
      const { data, error } = await q;
      return error ? [] : (data ?? []);
    };
    const [checkins, natives, progress, fillout, applications] = await Promise.all([
      safe(sb.from("messenger_checkins").select("id, client_id, task_type, submitted_at, reviewed_at")
        .eq("status", "completed").not("submitted_at", "is", null).gte("submitted_at", since)
        .order("submitted_at", { ascending: false }).limit(LIMIT)),
      safe(sb.from("nf_submissions").select("id, client_id, form_id, submitted_at, reviewed_at, status")
        .not("submitted_at", "is", null).gte("submitted_at", since)
        .order("submitted_at", { ascending: false }).limit(LIMIT)),
      safe(sb.from("progress_submissions").select("id, client_id, submission_type, submitted_at, created_at, bodyweight, weight_unit, check_in_label, review_status")
        .not("client_id", "is", null).neq("review_status", "draft").gte("created_at", since)
        .order("created_at", { ascending: false }).limit(LIMIT)),
      safe(sb.from("fillout_submissions").select("id, client_id, form_id, form_name, submitted_at, created_at, unread, unmatched")
        .gte("created_at", since).order("created_at", { ascending: false }).limit(LIMIT)),
      safe(sb.from("coaching_applications").select("id, client_id, full_name, form_name, application_source, submitted_at, created_at, application_status, is_test")
        .gte("created_at", since).order("created_at", { ascending: false }).limit(LIMIT)),
    ]);

    const clientIds = Array.from(new Set(
      [...checkins, ...natives, ...progress, ...fillout].map((r: any) => r.client_id).filter(Boolean),
    ));
    const formIds = Array.from(new Set(natives.map((r: any) => r.form_id).filter(Boolean)));
    const [clients, forms] = await Promise.all([
      clientIds.length ? safe(sb.from("clients").select("id, full_name, profile_picture_url").in("id", clientIds)) : Promise.resolve([]),
      formIds.length ? safe(sb.from("nf_forms").select("id, title").in("id", formIds)) : Promise.resolve([]),
    ]);
    const nameOf = new Map<string, string>(clients.map((c: any) => [c.id, c.full_name || "Client"]));
    const titleOf = new Map<string, string>(forms.map((f: any) => [f.id, f.title || "Form"]));
    const photoOf = new Map<string, string | null>(clients.map((c: any) => [c.id, c.profile_picture_url ?? null]));
    const name = (id: string | null) => (id ? nameOf.get(id) ?? "Client" : "Not matched to a client");
    const photo = (id: string | null) => (id ? photoOf.get(id) ?? null : null);

    const out: FormSubmission[] = [];
    for (const c of checkins) {
      const weekly = c.task_type === "weekly_checkin";
      out.push({
        key: `checkin:${c.id}`, source: "checkin", kind: weekly ? "weekly_checkin" : "nutrition_update", id: c.id,
        title: weekly ? "Weekly Check-In" : "Nutrition Review",
        clientId: c.client_id, clientName: name(c.client_id), photo: photo(c.client_id), submittedAt: c.submitted_at,
        reviewed: !!c.reviewed_at, detail: null, formId: null,
      });
    }
    for (const s of natives) {
      out.push({
        key: `native:${s.id}`, source: "native", kind: nativeKind(s.form_id, NUTRITION_REQUEST_FORM_ID), id: s.id,
        title: (s.form_id && titleOf.get(s.form_id)) || "Form",
        clientId: s.client_id, clientName: name(s.client_id), photo: photo(s.client_id), submittedAt: s.submitted_at,
        reviewed: !!s.reviewed_at || s.status === "reviewed", detail: null, formId: s.form_id ?? null,
      });
    }
    for (const p of progress) {
      const at = p.submitted_at ?? p.created_at;
      if (!at) continue;
      out.push({
        key: `progress:${p.id}`, source: "progress", kind: "progress", id: p.id,
        title: p.submission_type === "video" ? "Progress video" : "Progress photos",
        clientId: p.client_id, clientName: name(p.client_id), photo: photo(p.client_id), submittedAt: at,
        reviewed: null,
        detail: p.bodyweight != null ? `${Number(p.bodyweight)} ${unit(p.weight_unit)}` : (p.check_in_label || null),
        formId: null,
      });
    }
    for (const f of fillout) {
      const at = f.submitted_at ?? f.created_at;
      if (!at) continue;
      out.push({
        key: `fillout:${f.id}`, source: "fillout", kind: "fillout", id: f.id,
        title: f.form_name || "Fillout form",
        clientId: f.client_id ?? null, clientName: name(f.client_id ?? null), photo: photo(f.client_id ?? null), submittedAt: at,
        reviewed: !f.unread, detail: f.unmatched ? "Not matched to a client" : null, formId: f.form_id ?? null,
      });
    }
    for (const a of applications) {
      if (a.is_test) continue;
      const at = a.submitted_at ?? a.created_at;
      if (!at) continue;
      out.push({
        key: `application:${a.id}`, source: "application", kind: "application", id: a.id,
        title: a.form_name || a.application_source || "Coaching application",
        clientId: a.client_id ?? null, clientName: a.full_name || "Applicant", photo: null, submittedAt: at,
        reviewed: a.application_status !== "submitted", detail: null, formId: null,
      });
    }
    out.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return out;
  });
