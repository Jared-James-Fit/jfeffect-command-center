import { describe, expect, it } from "vitest";
import { makeLiftDraft, liftRequestCount, liftRequestQuestions, validateLiftDraft } from "@/lib/lift-request-template";
const ids = () => { let i=0; return ()=>String(++i); };
describe("lift request draft",()=>{
  it("creates twelve optional lift groups with private native video fields",()=>{
    const draft=makeLiftDraft("final",ids());
    expect(liftRequestCount(draft)).toBe(12);
    const questions=liftRequestQuestions(draft);
    expect(questions.filter(q=>q.question_type==="video")).toHaveLength(12);
    expect(questions.every(q=>!q.required)).toBe(true);
    expect(questions.map(q=>q.order_index)).toEqual(questions.map((_,i)=>i));
    expect(new Set(questions.map(q=>(q.validation.lift_request as {item_id:string}).item_id)).size).toBe(12);
  });
  it("does not accept an empty or unnamed request",()=>{
    const d=makeLiftDraft("custom",ids()); expect(validateLiftDraft(d)).not.toBeNull();
    d.groups[0].items.push({id:"a",title:"",instructions:""}); expect(validateLiftDraft(d)).not.toBeNull();
    d.groups[0].items[0].title="Last warm-up"; expect(validateLiftDraft(d)).toBeNull();
  });
  it("keeps identity after title and order changes",()=>{
    const d=makeLiftDraft("final",ids()); const id=d.groups[0].items[0].id;
    d.groups[0].items[0].title="Opener practice"; d.groups[0].items.reverse();
    const q=liftRequestQuestions(d).find(q=>(q.validation.lift_request as {item_id:string}).item_id===id);
    expect(q?.label).toContain("Opener practice");
  });
});
