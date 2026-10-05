/**
 * Server-only: coach/admin "View as client" (client POV) identity.
 *
 * Client-portal server functions resolve "me" from the session, which in POV
 * is the COACH — so they returned the coach's (empty) data. Functions that
 * accept `viewAsUserId` / `viewAsClientId` resolve the viewed client here.
 * Only admins and the client's assigned coach may view as someone else
 * (same rule as the database's portal_viewer_uid); anyone else is refused.
 */
import { z } from "zod";

export const PovInput = z
  .object({
    viewAsUserId: z.string().uuid().nullish(),
    viewAsClientId: z.string().uuid().nullish(),
  })
  .partial();
export type PovArgs = z.infer<typeof PovInput>;

export function isPovRequest(userId: string, pov?: PovArgs | null) {
  return !!pov && ((!!pov.viewAsUserId && pov.viewAsUserId !== userId) || !!pov.viewAsClientId);
}

async function canViewClient(supabase: any, userId: string, clientId: string) {
  const [{ data: isAdmin }, { data: isCoach }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("is_assigned_coach", { _client_id: clientId }),
  ]);
  return !!isAdmin || !!isCoach;
}

/** The auth user id whose portal data to read. */
export async function resolvePovUserId(supabase: any, userId: string, pov?: PovArgs | null): Promise<string> {
  if (!pov?.viewAsUserId || pov.viewAsUserId === userId) return userId;
  const { data, error } = await supabase.rpc("portal_viewer_uid", { _as_user: pov.viewAsUserId });
  if (error || data !== pov.viewAsUserId) throw new Error("Forbidden");
  return pov.viewAsUserId;
}

/** The clients.id whose portal data to read (null if the person has no client row). */
export async function resolvePovClientId(supabase: any, userId: string, pov?: PovArgs | null): Promise<string | null> {
  if (pov?.viewAsClientId) {
    if (!(await canViewClient(supabase, userId, pov.viewAsClientId))) throw new Error("Forbidden");
    return pov.viewAsClientId;
  }
  const uid = await resolvePovUserId(supabase, userId, pov);
  const { data } = await supabase.from("clients").select("id").eq("user_id", uid).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
