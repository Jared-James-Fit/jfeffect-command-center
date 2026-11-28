/** Read only submitted native evidence for the exact athlete and competition. No draft answers or public media. */
export async function readPrepEvidence(db:any, clientId:string, competitionId:string) {
  const {data:subs,error}=await db.from("nf_submissions").select("id,form_id,status,submitted_at,form:form_id(title,settings)").eq("client_id",clientId).eq("competition_id",competitionId).not("submitted_at","is",null).order("submitted_at",{ascending:false}).limit(30);
  if(error)throw error;
  const rows=(subs??[]).filter((s:any)=>s.form?.settings?.lift_request===true||s.form?.settings?.competition_cue_profile===true);
  if(!rows.length)return {lifts:[],cues:[]};
  const ids=rows.map((s:any)=>s.id), formIds=[...new Set(rows.map((s:any)=>s.form_id))];
  const [q,a,v]=await Promise.all([
    db.from("nf_questions").select("id,form_id,label,validation,order_index").in("form_id",formIds).order("order_index"),
    db.from("nf_answers").select("submission_id,question_id,value_text,value_number,value_json").in("submission_id",ids),
    db.from("nf_files").select("id,submission_id,question_id,mime_type").in("submission_id",ids)
  ]);
  for(const result of [q,a,v])if(result.error)throw result.error;
  const answers=new Map<string,any>((a.data??[]).map((x:any)=>[x.submission_id+":"+x.question_id,x]));
  const videos=new Map<string,string[]>();for(const x of v.data??[]){if(!String(x.mime_type??"").startsWith("video/"))continue;const k=x.submission_id+":"+x.question_id;videos.set(k,[...(videos.get(k)??[]),x.id]);}
  const lifts:any[]=[],cues:any[]=[];
  for(const s of rows){
    const grouped=new Map<string,any>();
    for(const question of q.data??[]){
      if(question.form_id!==s.form_id)continue;
      const key=s.id+":"+question.id, answer=answers.get(key);
      const m=question.validation?.lift_request;
      if(s.form.settings.lift_request===true && m?.item_id){
        const item=grouped.get(m.item_id)??{id:s.id+":"+m.item_id,submissionId:s.id,exercise:m.exercise,title:m.title,request:s.form.title,fields:{},videoIds:[]};
        if(answer){const val=answer.value_number??answer.value_text;if(val!==null&&val!==undefined&&val!=="")item.fields[m.field]=m.field==="weight"?String(val)+(answer.value_json?.unit?" "+answer.value_json.unit:""):String(val);}
        item.videoIds.push(...(videos.get(key)??[]));grouped.set(m.item_id,item);
      }
      if(s.form.settings.competition_cue_profile===true&&answer?.value_text?.trim())cues.push({id:key,label:question.label,text:answer.value_text,submittedAt:s.submitted_at});
    }
    for(const item of grouped.values())if(Object.keys(item.fields).length||item.videoIds.length)lifts.push(item);
  }
  return {lifts,cues};
}
