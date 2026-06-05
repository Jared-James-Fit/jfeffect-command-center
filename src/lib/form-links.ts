import { supabase } from "@/integrations/supabase/client";

export const FORM_TYPES = [
  "Intake Form",
  "Consultation Form",
  "PAR-Q",
  "Health Screening",
  "Coaching Application",
  "Feedback Form",
  "Testimonial Form",
  "Renewal Form",
  "Cancellation Form",
  "Progress Update Form",
  "Custom",
] as const;

export type FormLink = {
  id: string;
  title: string;
  url: string;
  form_type: string;
  custom_type: string | null;
  description: string | null;
  visible_to_client: boolean;
  active: boolean;
  archived: boolean;
  archived_at: string | null;
  notes_admin: string | null;
  created_at: string;
  updated_at: string;
};

export async function listForms(opts: { includeArchived?: boolean } = {}) {
  let q = supabase.from("forms" as any).select("*").order("updated_at", { ascending: false });
  if (!opts.includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as FormLink[];
}

export async function upsertForm(input: Partial<FormLink> & { id?: string }) {
  if (input.id) {
    const { error } = await supabase.from("forms" as any).update(input as any).eq("id", input.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("forms" as any).insert(input as any);
  if (error) throw error;
}

export async function archiveForm(id: string, archived: boolean) {
  const { error } = await supabase.from("forms" as any).update({
    archived, archived_at: archived ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) throw error;
}

export async function deleteForm(id: string) {
  const { error } = await supabase.from("forms" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function listFormAssignments(formId: string) {
  const { data, error } = await supabase
    .from("form_client_assignments" as any)
    .select("client_id, clients:client_id(id, full_name)")
    .eq("form_id", formId);
  if (error) throw error;
  return data ?? [];
}

export async function assignFormToClient(formId: string, clientId: string) {
  const { error } = await supabase
    .from("form_client_assignments" as any)
    .upsert({ form_id: formId, client_id: clientId } as any, { onConflict: "form_id,client_id" });
  if (error) throw error;
}

export async function unassignFormFromClient(formId: string, clientId: string) {
  const { error } = await supabase
    .from("form_client_assignments" as any)
    .delete()
    .eq("form_id", formId)
    .eq("client_id", clientId);
  if (error) throw error;
}

export async function listFormsForClient(clientId: string) {
  // Forms either explicitly assigned to this client, OR visible_to_client global
  const { data: assigned } = await supabase
    .from("form_client_assignments" as any)
    .select("forms:form_id(*)")
    .eq("client_id", clientId);
  const { data: global } = await supabase
    .from("forms" as any)
    .select("*")
    .eq("visible_to_client", true)
    .eq("active", true)
    .eq("archived", false);
  const list = [
    ...((assigned ?? []).map((a: any) => a.forms).filter(Boolean) as FormLink[]),
    ...((global ?? []) as unknown as FormLink[]),
  ];
  const seen = new Set<string>();
  return list.filter((f) => f && !seen.has(f.id) && (seen.add(f.id), true)) as FormLink[];
}