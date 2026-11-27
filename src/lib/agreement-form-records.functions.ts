import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdminView } from "@/lib/permissions.server";

export type AgreementFormRecord = {
  id: string; name: string; clientId: string | null; date: string | null;
  version: string | null; method: string | null; status: string;
  acknowledgement: string | null; source: "legal" | "coaching" | "external";
};
export type AgreementFormGroup = { id: string; title: string; records: AgreementFormRecord[]; source: AgreementFormRecord["source"]; historical?: boolean };

async function allRows(build: (from: number, to: number) => PromiseLike<{data: any[] | null; error: any}>) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}
const first = (x: any) => Array.isArray(x) ? x[0] : x;

// Read only. Legal evidence remains in its canonical tables, never synthesized
// into a native form submission or used to grant access.
export const listAgreementFormRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AgreementFormGroup[]> => {
    const { db } = await assertAdminView(context as any);
    const [docs, acceptances, signatures, external] = await Promise.all([
      allRows((a,b) => db.from("legal_documents").select("id,title,archived,is_required,current_version_id").order("id").range(a,b)),
      allRows((a,b) => db.from("legal_acceptances").select("id,document_id,user_id,client_id,accepted_at,revoked_at,signature_method,typed_name,acknowledgement_text,client:clients(full_name),version:legal_document_versions(version_number,title)").order("id").range(a,b)),
      allRows((a,b) => db.from("coaching_agreement_signatures").select("id,client_id,client_name,signed_at,signature_method,coaching_agreement_versions(version)").order("id").range(a,b)),
      allRows((a,b) => db.from("agreements").select("id,client_id,template_name,agreement_type,status,archived,signed_at,sent_at,signing_method,clients(full_name)").order("id").range(a,b)),
    ]);
    const missing = [...new Set<string>(acceptances.filter(r => !first(r.client)?.full_name && !r.typed_name).map(r => r.user_id).filter(Boolean))];
    const names = new Map<string,string>();
    for (let i = 0; i < missing.length; i += 100) {
      const {data,error} = await db.from("profiles").select("id,full_name").in("id",missing.slice(i,i+100));
      if (error) throw new Error(error.message);
      for (const p of data ?? []) if (p.full_name) names.set(p.id,p.full_name);
    }
    const groups = new Map<string, AgreementFormGroup>();
    for (const d of docs) if (!d.archived && d.current_version_id && d.is_required) {
      groups.set(d.id,{id:d.id,title:d.title,records:[],source:"legal",historical:!!d?.archived || !d?.current_version_id});
    }
    for (const r of acceptances) {
      const d = docs.find(d => d.id === r.document_id);
      if (!groups.has(r.document_id)) groups.set(r.document_id,{id:r.document_id,title:d?.title ?? first(r.version)?.title ?? "Archived legal document",records:[],source:"legal"});
      groups.get(r.document_id)!.records.push({
        id:r.id,name:first(r.client)?.full_name ?? r.typed_name ?? names.get(r.user_id) ?? "Account " + String(r.user_id ?? "unknown").slice(0,8),
        clientId:r.client_id,date:r.accepted_at,version:first(r.version)?.version_number != null ? String(first(r.version).version_number) : null,
        method:r.signature_method,status:r.revoked_at ? "Revoked" : "Accepted",acknowledgement:r.acknowledgement_text,source:"legal",
      });
    }
    groups.set("coaching",{id:"coaching",title:"Coaching Agreement",source:"coaching",records:signatures.map(r => ({
      id:r.id,name:r.client_name ?? "Client",clientId:r.client_id,date:r.signed_at,version:first(r.coaching_agreement_versions)?.version ?? null,
      method:r.signature_method,status:"Signed",acknowledgement:null,source:"coaching",
    }))});
    for (const r of external) {
      const title = r.template_name ?? r.agreement_type ?? "External agreement";
      const historical = !!r.archived || (/signnow/i.test(title) && !r.sent_at && !r.signed_at && !["Signed","Completed","Verified"].includes(r.status));
      const key = "external:" + title;
      if (!groups.has(key)) groups.set(key,{id:key,title,source:"external",records:[]});
      groups.get(key)!.records.push({id:r.id,name:first(r.clients)?.full_name ?? "Client",clientId:r.client_id,date:r.signed_at ?? (["Signed","Completed","Verified"].includes(r.status) ? null : r.sent_at),
        version:null,method:r.signing_method,status:r.status + (r.archived ? " · Archived" : ""),acknowledgement:null,source:"external"});
    }
    return [...groups.values()].map(g => ({...g,records:g.records.sort((a,b) => (b.date ?? "").localeCompare(a.date ?? ""))})).sort((a,b) => a.title.localeCompare(b.title));
  });

export const getLegalFormEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({id:z.string().uuid()}).parse(data))
  .handler(async ({ context, data }) => {
    const { db } = await assertAdminView(context as any);
    const {data:row,error} = await db.from("legal_acceptances")
      .select("rendered_snapshot,checkbox_checked,context,revoked_at,typed_name")
      .eq("id",data.id).single();
    if (error) throw new Error(error.message);
    return {snapshot:row.rendered_snapshot as string | null,checked:row.checkbox_checked as boolean | null,
      context:row.context as string | null,revokedAt:row.revoked_at as string | null,typedName:row.typed_name as string | null};
  });
