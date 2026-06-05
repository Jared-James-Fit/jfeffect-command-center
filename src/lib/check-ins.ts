import { supabase } from "@/integrations/supabase/client";

export const CHECK_IN_TYPES = [
  "Weekly Check-In",
  "Powerlifting Check-In",
  "Lifestyle Check-In",
  "Nutrition Check-In",
  "In-Person Client Check-In",
  "New Client Check-In",
  "Custom",
] as const;
export type CheckInType = (typeof CHECK_IN_TYPES)[number];

export const CHECK_IN_FREQUENCIES = ["Weekly", "Bi-weekly", "Monthly", "One-time", "Custom"] as const;

export type CheckInLink = {
  id: string;
  title: string;
  url: string;
  description: string | null;
  check_in_type: string;
  custom_type: string | null;
  due_day: string | null;
  frequency: string;
  visible_to_client: boolean;
  active: boolean;
  archived: boolean;
  archived_at: string | null;
  notes_client: string | null;
  notes_admin: string | null;
  require_video: boolean;
  require_photos: boolean;
  created_at: string;
  updated_at: string;
};

export async function listCheckInLinks(opts: { includeArchived?: boolean } = {}) {
  let q = supabase.from("check_in_links" as any).select("*").order("updated_at", { ascending: false });
  if (!opts.includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as CheckInLink[];
}

export async function upsertCheckInLink(input: Partial<CheckInLink> & { id?: string }) {
  if (input.id) {
    const { error } = await supabase.from("check_in_links" as any).update(input as any).eq("id", input.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("check_in_links" as any).insert(input as any);
  if (error) throw error;
}

export async function archiveCheckInLink(id: string, archived: boolean) {
  const { error } = await supabase.from("check_in_links" as any).update({
    archived,
    archived_at: archived ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) throw error;
}

export async function deleteCheckInLink(id: string) {
  const { error } = await supabase.from("check_in_links" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function assignCheckInLinkToClient(clientId: string, linkId: string | null) {
  const { error } = await supabase.from("clients").update({ assigned_check_in_link_id: linkId } as any).eq("id", clientId);
  if (error) throw error;
}