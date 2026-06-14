/**
 * Program Library — sharing, submission, and approval helpers.
 *
 * Uses the browser supabase client. All authorization is enforced by RLS
 * (see pl_template_shares + pl_templates policies). Phase 1 only.
 */
import { supabase as sb } from "@/integrations/supabase/client";

export type ShareDestination =
  | "team"
  | "coach"
  | "team_submission"
  | "membership_submission"
  | "public_submission";

export type ShareStatus =
  | "shared"
  | "pending"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "removed";

export interface TemplateShare {
  id: string;
  template_id: string;
  destination: ShareDestination;
  target_coach_id: string | null;
  permission: "read" | "duplicate";
  status: ShareStatus;
  shared_version: number | null;
  notes: string | null;
  review_notes: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** All shares for a single program template. */
export async function listShares(templateId: string): Promise<TemplateShare[]> {
  const { data, error } = await sb
    .from("pl_template_shares")
    .select("*")
    .eq("template_id", templateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as any;
}

/** All currently active shares (admin only — filtered for non-admin by RLS). */
export async function listAllActiveShares() {
  const { data, error } = await sb
    .from("pl_template_shares")
    .select("*, template:pl_templates(id,name,owner_user_id,owner_role,payload_revision,archived)")
    .not("status", "in", "(removed,rejected)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Submissions inbox for admins. */
export async function listPendingSubmissions() {
  const { data, error } = await sb
    .from("pl_template_shares")
    .select("*, template:pl_templates(id,name,owner_user_id,owner_role,payload_revision)")
    .in("destination", ["team_submission", "membership_submission", "public_submission"])
    .in("status", ["pending", "changes_requested"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Programs shared directly with the current coach. */
export async function listSharedWithMe() {
  const { data, error } = await sb
    .from("pl_template_shares")
    .select("*, template:pl_templates(*)")
    .eq("destination", "coach")
    .not("status", "in", "(removed,rejected)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Coach's own submissions. */
export async function listMySubmissions(ownerUserId: string) {
  const { data, error } = await sb
    .from("pl_template_shares")
    .select("*, template:pl_templates!inner(id,name,owner_user_id,payload_revision)")
    .in("destination", ["team_submission", "membership_submission", "public_submission"])
    .eq("template.owner_user_id", ownerUserId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Admin: publish a program to the Team Library. */
export async function publishToTeam(templateId: string, version: number) {
  // Flip template visibility AND record a 'team' share.
  const { error: tplErr } = await sb
    .from("pl_templates")
    .update({ visibility: "team" })
    .eq("id", templateId);
  if (tplErr) throw tplErr;
  const { data, error } = await sb
    .from("pl_template_shares")
    .upsert(
      {
        template_id: templateId,
        destination: "team",
        target_coach_id: null,
        permission: "duplicate",
        status: "shared",
        shared_version: version,
      },
      { onConflict: "template_id,destination,target_coach_id" } as any,
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Admin: remove a program from the Team Library (back to private). */
export async function unpublishFromTeam(templateId: string) {
  await sb.from("pl_templates").update({ visibility: "private" }).eq("id", templateId);
  await sb
    .from("pl_template_shares")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("template_id", templateId)
    .eq("destination", "team")
    .not("status", "in", "(removed,rejected)");
}

/** Admin: share a program with a specific coach. */
export async function shareWithCoach(
  templateId: string,
  coachId: string,
  version: number,
  permission: "read" | "duplicate" = "duplicate",
) {
  const { data, error } = await sb
    .from("pl_template_shares")
    .upsert(
      {
        template_id: templateId,
        destination: "coach",
        target_coach_id: coachId,
        permission,
        status: "shared",
        shared_version: version,
      },
      { onConflict: "template_id,destination,target_coach_id" } as any,
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Admin: revoke a coach's access. */
export async function revokeCoachShare(shareId: string) {
  const { error } = await sb
    .from("pl_template_shares")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("id", shareId);
  if (error) throw error;
}

/** Coach: submit own program for admin review to a destination. */
export async function submitForReview(
  templateId: string,
  destination: "team_submission" | "membership_submission" | "public_submission",
  version: number,
  notes: string | null,
) {
  const { data, error } = await sb
    .from("pl_template_shares")
    .insert({
      template_id: templateId,
      destination,
      target_coach_id: null,
      permission: "read",
      status: "pending",
      shared_version: version,
      notes,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Admin decision on a submission. */
export async function decideSubmission(
  shareId: string,
  decision: "approved" | "rejected" | "changes_requested",
  reviewNotes: string | null,
) {
  const { data, error } = await sb
    .from("pl_template_shares")
    .update({
      status: decision,
      review_notes: reviewNotes,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", shareId)
    .select("*, template:pl_templates(id,visibility)")
    .single();
  if (error) throw error;

  // If the submission was for the Team Library and is approved, flip visibility.
  if (decision === "approved" && (data as any).destination === "team_submission") {
    await sb.from("pl_templates").update({ visibility: "team" }).eq("id", (data as any).template_id);
  }
  return data;
}

/** Coach: duplicate a shared/team program into their own My Library. */
export async function duplicateToMyLibrary(templateId: string, newOwnerUserId: string) {
  const { data: tpl, error } = await sb
    .from("pl_templates")
    .select("*")
    .eq("id", templateId)
    .single();
  if (error) throw error;
  const {
    id: _id,
    created_at: _c,
    updated_at: _u,
    created_by: _b,
    owner_user_id: _o,
    owner_role: _or,
    visibility: _v,
    payload_revision: _r,
    ...rest
  } = tpl as any;
  const { data: copy, error: insErr } = await sb
    .from("pl_templates")
    .insert({
      ...rest,
      name: `${tpl.name} (My Copy)`,
      owner_user_id: newOwnerUserId,
      owner_role: "coach",
      visibility: "private",
      archived: false,
    })
    .select()
    .single();
  if (insErr) throw insErr;
  return copy;
}

/** All active coaches (for the share-with-coach picker). */
export async function listActiveCoaches() {
  const { data, error } = await sb
    .from("coaches")
    .select("id,full_name,profile_picture_url,user_id")
    .eq("archived", false)
    .eq("status", "Active")
    .order("full_name");
  if (error) throw error;
  return data ?? [];
}

/** Distribution events (activity timeline) for a template. */
export async function listDistributionEvents(templateId: string) {
  const { data, error } = await sb
    .from("pl_template_distribution_events")
    .select("*")
    .eq("template_id", templateId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

/** Derive a compact destination summary for a template card. */
export interface DestinationSummary {
  visibility: "private" | "team";
  coachShareCount: number;
  pendingSubmissions: ShareDestination[];
  rejectedSubmissions: ShareDestination[];
  changesRequested: ShareDestination[];
}

export function summarizeShares(
  template: { visibility: string },
  shares: TemplateShare[],
): DestinationSummary {
  const active = shares.filter((s) => s.status !== "removed" && s.status !== "rejected");
  return {
    visibility: (template.visibility as any) ?? "private",
    coachShareCount: active.filter((s) => s.destination === "coach" && s.status === "shared").length,
    pendingSubmissions: active.filter((s) => s.status === "pending").map((s) => s.destination),
    rejectedSubmissions: shares.filter((s) => s.status === "rejected").map((s) => s.destination),
    changesRequested: active.filter((s) => s.status === "changes_requested").map((s) => s.destination),
  };
}

/** Friendly destination label. */
export function destinationLabel(d: ShareDestination): string {
  switch (d) {
    case "team": return "Team Library";
    case "coach": return "Coach";
    case "team_submission": return "Team Library";
    case "membership_submission": return "Membership";
    case "public_submission": return "Public";
  }
}