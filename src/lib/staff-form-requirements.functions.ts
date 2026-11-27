import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { accountSetupRequirements } from "@/lib/account-setup-scope";
import { isGoalsSetupComplete } from "@/lib/client-goals/schema";
import { SIGNUP_LEGAL_SLUGS } from "@/lib/legal-signup";
import { MEMBERSHIP_AGREEMENT_SLUG, CLICK_ACCEPTANCE_VERSION_ID, isMemberAppAcceptance } from "@/lib/membership-agreement/acks";
import { IN_APP_SIGNING_FROM_VERSION } from "@/lib/membership-agreement.functions";

export type StaffFormRequirement = {
  key: string; clientId: string; name: string; title: string;
  complete: boolean; occurrence?: string; acceptedAt?: string | null; recordId?: string;
};

async function rows(build: (from: number,to: number)=>PromiseLike<{data:any[]|null;error:any}>) {
  const result:any[] = [];
  for(let from=0;;from+=1000) {
    const {data,error}=await build(from,from+999);
    if(error) throw new Error(error.message);
    result.push(...(data??[]));
    if((data?.length??0)<1000) return result;
  }
}

const first = (r:any) => Array.isArray(r) ? r[0] : r;

/** Read-only view of existing account obligations, not a form assignment or an
 * acceptance. Authorization is checked before any privileged cross-account read.
 * Native form requests retain form-response-status.ts as their source of truth. */
export const listStaffFormRequirements = createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input:unknown)=>z.object({clientId:z.string().uuid().optional()}).parse(input))
  .handler(async ({context,data}):Promise<StaffFormRequirement[]>=>{
    const caller=context.supabase;
    const [admin,coach]=await Promise.all([
      caller.rpc("has_role",{_user_id:context.userId,_role:"admin"}),
      caller.rpc("has_role",{_user_id:context.userId,_role:"coach"}),
    ]);
    if(admin.error || coach.error) throw new Error("Could not verify staff access");
    if(!admin.data && !coach.data) throw new Error("Forbidden");
    const candidates=await rows((a,b)=>{
      let q=caller.from("clients").select("id,user_id,full_name,service_tier,status,archived,portal_access_disabled")
        .not("user_id","is",null).eq("archived",false).order("id");
      if(data.clientId) q=q.eq("id",data.clientId);
      return q.range(a,b);
    });
    const active=candidates.filter(c=>!c.portal_access_disabled && !["Archived","Deactivated","Deleted"].includes(c.status));
    const clients:any[]=[];
    for(let i=0;i<active.length;i+=20){
      const batch=active.slice(i,i+20);
      const scoped=await Promise.all(batch.map(async c=>{
        if(admin.data) return c;
        const allowed=await caller.rpc("is_assigned_coach_for_client",{_client_id:c.id});
        if(allowed.error) throw new Error("Could not verify assigned coach");
        return allowed.data ? c : null;
      }));
      clients.push(...scoped.filter(Boolean));
    }
    if(!clients.length) return [];
    // The authorized target set is fixed above. Fetch only the fields needed for
    // completion, including historical acceptances with no client_id.
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const db=supabaseAdmin as any;
    const {loadHandlingSetup}=await import("@/lib/competition/handling-setup.server");
    const legalDocs=await rows((a,b)=>db.from("legal_documents")
      .select("id,slug,title,archived,emergency_disabled,is_optional_consent,current_version:legal_document_versions!fk_legal_documents_current_version(id,version_number,status,needs_legal_review,requires_reacceptance)")
      .in("slug",[...SIGNUP_LEGAL_SLUGS,MEMBERSHIP_AGREEMENT_SLUG]).eq("archived",false).order("id").range(a,b));
    const membership=legalDocs.find(d=>d.slug===MEMBERSHIP_AGREEMENT_SLUG);
    const memberVersion=first(membership?.current_version);
    let priorMemberId:string|null=null;
    if(memberVersion?.id===CLICK_ACCEPTANCE_VERSION_ID && !memberVersion.requires_reacceptance){
      const {data:prior,error}=await db.from("legal_document_versions").select("id").eq("document_id",membership.id).eq("version_number",6).maybeSingle();
      if(error) throw new Error(error.message);
      priorMemberId=prior?.id??null;
    }
    const out:StaffFormRequirement[]=[];
    for(let i=0;i<clients.length;i+=20){
      const batch=clients.slice(i,i+20);
      const ids=batch.map(c=>c.id), users=batch.map(c=>c.user_id);
      const [goals,enrollments,acceptances,handling]=await Promise.all([
        rows((a,b)=>db.from("client_goals_setup").select("client_id,main_goal,training_days_per_week,workout_length_minutes,training_experience,training_location,nutrition_goal").in("client_id",ids).order("client_id").range(a,b)),
        rows((a,b)=>db.from("coaching_package_enrollments").select("client_id,coaching_packages!inner(slug)").in("client_id",ids).eq("status","active").lte("starts_on",new Date().toISOString().slice(0,10)).order("id").range(a,b)),
        rows((a,b)=>db.from("legal_acceptances").select("id,user_id,document_id,version_id,accepted_at,signature_method,context_ref,checkbox_checked,acknowledgement_text").in("user_id",users).in("document_id",legalDocs.map(d=>d.id)).is("revoked_at",null).order("id").range(a,b)),
        Promise.all(batch.map(c=>loadHandlingSetup(db,c.id))),
      ]);
      batch.forEach((c,index)=>{
        const meets=handling[index];
        const scope=accountSetupRequirements(c.service_tier,enrollments.filter(e=>e.client_id===c.id).map(e=>first(e.coaching_packages)?.slug??""),meets.length>0);
        const base={clientId:c.id,name:c.full_name?.trim()||"Account"};
        if(scope.generalGoals) out.push({...base,key:"setup_goals",title:"Goals & Intake",complete:isGoalsSetupComplete(goals.find(g=>g.client_id===c.id),scope.nutritionOnly)});
        for(const m of meets) {
          out.push({...base,key:"setup_competition",title:"Competition Setup",occurrence:m.name,complete:m.intakeDone});
          out.push({...base,key:"handling_terms",title:"Competition handling terms",occurrence:m.name,complete:m.termsDone});
        }
        for(const d of legalDocs){
          const v=first(d.current_version);
          if(!v || v.status!=="published" || d.emergency_disabled || d.is_optional_consent) continue;
          const acc=acceptances.filter(a=>a.user_id===c.user_id && a.document_id===d.id);
          let signed:any;
          if(d.slug===MEMBERSHIP_AGREEMENT_SLUG){
            if(c.service_tier!=="self_serve" || v.version_number<IN_APP_SIGNING_FROM_VERSION) continue;
            signed=acc.find(a=>a.version_id===v.id && isMemberAppAcceptance(a));
            if(!signed && priorMemberId && v.id===CLICK_ACCEPTANCE_VERSION_ID) signed=acc.find(a=>a.version_id===priorMemberId && isMemberAppAcceptance(a));
          }else{
            if(v.needs_legal_review) continue;
            signed=acc.find(a=>a.version_id===v.id) ?? (!v.requires_reacceptance ? acc[0] : undefined);
          }
          out.push({...base,key:"legal:"+d.id,title:d.title,complete:!!signed,acceptedAt:signed?.accepted_at??null,recordId:signed?.id});
        }
      });
    }
    return out;
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
