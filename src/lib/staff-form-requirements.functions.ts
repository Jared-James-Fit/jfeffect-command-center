import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StaffFormRequirement = {
  key: string; clientId: string; name: string; title: string;
  complete: boolean; occurrence?: string; acceptedAt?: string | null; recordId?: string;
};

/** Read-only view of existing account obligations, not a form assignment or an
 * acceptance. Authorization is checked before any privileged cross-account read.
 * Native form requests retain form-response-status.ts as their source of truth. */
export const listStaffFormRequirements = createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input:unknown)=>z.object({clientId:z.string().uuid().optional()}).parse(input))
  .handler(async ({context,data})=>{
    const {readStaffFormRequirements}=await import("@/lib/staff-form-requirements.server");
    return readStaffFormRequirements(context,data);
  });

/** Read one accepted document for the explicitly authorized account only. */
export const getStaffFormAcceptanceEvidence=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input:unknown)=>z.object({clientId:z.string().uuid(),id:z.string().uuid()}).parse(input))
  .handler(async({context,data})=>{
    const caller=context.supabase;
    const [admin,coach,assigned]=await Promise.all([
      caller.rpc("has_role",{_user_id:context.userId,_role:"admin"}),
      caller.rpc("has_role",{_user_id:context.userId,_role:"coach"}),
      caller.rpc("is_assigned_coach_for_client",{_client_id:data.clientId}),
    ]);
    if(admin.error || coach.error || (!admin.data && assigned.error)) throw new Error("Could not verify staff access");
    if(!admin.data && !(coach.data && assigned.data)) throw new Error("Forbidden");
    const {data:target,error}=await caller.from("clients").select("user_id").eq("id",data.clientId).maybeSingle();
    if(error || !target?.user_id) throw new Error("Account not available");
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const {data:record,error:recordError}=await (supabaseAdmin as any).from("legal_acceptances").select("rendered_snapshot,signature_method,acknowledgement_text").eq("id",data.id).eq("user_id",target.user_id).single();
    if(recordError || !record) throw new Error("Accepted document not available");
    return {snapshot:record.rendered_snapshot as string|null,method:record.signature_method as string|null,acknowledgement:record.acknowledgement_text as string|null};
  });
