import { formAnswerText } from "@/lib/form-answer-text";

type Db = any;
type Options = { client_id?: string; form_id?: string; submission_id?: string; source?: "native" | "fillout"; search?: string; offset?: number; limit?: number; question_offset?: number };
function checked(r: any, label: string): any[] {
  if (r.error) throw new Error(label + ": " + r.error.message);
  return r.data ?? [];
}
const cleanSearch = (s: string) => s.replace(/[%_\\]/g, "").trim();
function safeJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(safeJson);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !/(token|secret|password|passcode|api.?key|signature|signed.?url|download.?url)/i.test(k)).map(([k,x]) => [k,safeJson(x)]));
  return typeof v === "string" && /^https?:\/\//i.test(v) ? "[link omitted]" : v;
}

/** All reads use the requester's RLS client. Never substitute service role. */
export async function readCoachForms(db: Db, mode: "library" | "submissions" | "answers", o: Options = {}, scopeClientId?: string): Promise<string> {
  if (scopeClientId && o.client_id && o.client_id !== scopeClientId) throw new Error("This conversation is restricted to its selected client.");
  const client = scopeClientId ?? o.client_id;
  const offset = Math.max(0, o.offset ?? 0), limit = Math.max(1, Math.min(50, o.limit ?? 20));
  if (mode === "library") {
    // A client conversation can only list their own responses, not the global library.
    if (scopeClientId) return readCoachForms(db, "submissions", o, scopeClientId);
    let q = db.from("nf_forms").select("id,title,description,category,kind,form_type,active,archived,owner_id,shared", { count: "exact" });
    if (o.form_id) q = q.eq("id", o.form_id);
    if (o.search && cleanSearch(o.search)) q = q.ilike("title", "%" + cleanSearch(o.search) + "%");
    const res = await q.order("title").order("id").range(offset,offset+limit-1);
    const forms = checked(res,"form library");
    const lines = ["Source: Coaching → Forms → App forms (nf_forms). Visible forms: " + (res.count ?? forms.length) + ". Offset " + offset + "."];
    for (const f of forms) lines.push("- " + f.title + " | " + f.id + " | " + (f.category ?? "Uncategorized") + " | " + (f.archived ? "archived" : f.active ? "active" : "draft") + " | " + f.kind + " | " + (f.owner_id ? "coach-owned" : "organization") + (f.description ? " | " + f.description : ""));
    if (o.form_id && forms.length === 1) {
      const questions = checked(await db.from("nf_questions").select("id,label,question_type,order_index,required,options,help_text,archived_at").eq("form_id",o.form_id).order("order_index").range(offset,offset+limit-1),"form questions");
      for (const q of questions) lines.push("  - " + q.label + " | " + q.id + " | " + q.question_type + (q.required ? " | required" : "") + (q.archived_at ? " | archived" : "") + (q.options?.length ? " | options: " + q.options.join(", ") : "") + (q.help_text ? " | " + q.help_text : ""));
    }
    if ((res.count ?? 0)>offset+forms.length) lines.push("More results: increase offset.");
    return lines.join("\n");
  }
  if (mode === "answers") {
    if (!o.submission_id) throw new Error("Choose an exact submission id from form submissions.");
    if (o.source === "fillout") {
      let q = db.from("fillout_submissions").select("id,client_id,form_name,submitted_at,created_at,response_json").eq("id",o.submission_id);
      if (client) q=q.eq("client_id",client);
      const list=checked(await q.limit(1),"Fillout response");
      if (!list.length) return "No visible matching Fillout response.";
      const r=list[0];
      return "Source: Intake & Form Answers → " + (r.form_name ?? "Fillout") + " | " + (r.submitted_at ?? r.created_at) + " | " + r.id + "\n" + JSON.stringify(safeJson(r.response_json),null,2);
    }
    let q = db.from("nf_submissions").select("id,client_id,form_id,status,submitted_at,created_at,form:form_id(title)").eq("id",o.submission_id);
    if(client) q=q.eq("client_id",client);
    const list=checked(await q.limit(1),"submission");
    if(!list.length) return "No visible matching submission.";
    const s=list[0];
    const start=Math.max(0,o.question_offset ?? 0);
    const qr=await db.from("nf_questions").select("id,label,order_index,question_type",{count:"exact"}).eq("form_id",s.form_id).order("order_index").order("id").range(start,start+19);
    const questions=checked(qr,"questions");
    const answers=questions.length ? checked(await db.from("nf_answers").select("question_id,value_text,value_number,value_json").eq("submission_id",s.id).in("question_id",questions.map(q=>q.id)),"answers") : [];
    const byId=new Map(answers.map(a=>[a.question_id,a]));
    return ["Source: Forms → " + (s.form?.title ?? s.form_id) + " → submission " + s.id + " | " + (s.submitted_at ?? s.created_at) + " | " + s.status,
      ...questions.map(q=> {const a=byId.get(q.id); return q.label + ": " + (a ? formAnswerText(safeJson(a) as any) || "(not answered)" : "(not answered)");}),
      (qr.count ?? 0)>start+questions.length ? "More questions: call again with question_offset=" + (start+questions.length) : "End of questions."].join("\n");
  }
  const lines: string[] = [];
  const filters = o.search && cleanSearch(o.search) ? cleanSearch(o.search) : "";
  let ids: string[] | undefined;
  if (filters && !o.form_id) ids=checked(await db.from("nf_forms").select("id").ilike("title","%"+filters+"%").limit(200),"matching forms").map(f=>f.id);
  if(o.source!=="fillout" && (!ids || ids.length)) {
    let q=db.from("nf_submissions").select("id,client_id,form_id,status,submitted_at,created_at,form:form_id(title),client:client_id(full_name)",{count:"exact"});
    if(client)q=q.eq("client_id",client);
    if(o.form_id)q=q.eq("form_id",o.form_id);
    else if(ids)q=q.in("form_id",ids);
    const res=await q.order("submitted_at",{ascending:false,nullsFirst:false}).order("id").range(offset,offset+limit-1);
    const list=checked(res,"native submissions");
    lines.push("Source: Forms → Submissions (native). Matching visible records: "+(res.count??list.length)+". Offset "+offset+".");
    for(const s of list) lines.push("- "+(s.form?.title??s.form_id)+" | "+(s.client?.full_name??s.client_id)+" | "+(s.submitted_at??s.created_at)+" | "+s.status+" | submission "+s.id);
    if((res.count??0)>offset+list.length)lines.push("More native submissions: increase offset.");
  }
  if(o.source!=="native"&&!o.form_id) {
    let q=db.from("fillout_submissions").select("id,client_id,form_name,submitted_at,created_at",{count:"exact"});
    if(client)q=q.eq("client_id",client);
    if(filters)q=q.ilike("form_name","%"+filters+"%");
    const res=await q.order("submitted_at",{ascending:false,nullsFirst:false}).order("id").range(offset,offset+limit-1);
    if(res.error)lines.push("Fillout intake records could not be verified: "+res.error.message);
    else {
      const list=res.data??[];
      lines.push("Source: Intake & Form Answers (Fillout). Matching visible records: "+(res.count??list.length)+". Offset "+offset+".");
      for(const s of list)lines.push("- "+(s.form_name??"Intake form")+" | "+s.client_id+" | "+(s.submitted_at??s.created_at)+" | submission "+s.id+" (source fillout)");
      if((res.count??0)>offset+list.length)lines.push("More Fillout submissions: increase offset.");
    }
  }
  return lines.join("\n")||"No matching visible form submissions.";
}
