import { describe, expect, it } from "vitest";
import { readMeetFileField, meetFileProposals, sameMeetValue, defaultMeetFileSelection, validMeetFileValue } from "@/lib/athlete-intel/meet-files";
import { readAiAnswer } from "@/lib/athlete-intel/ai-read";
describe("competition file intake", () => {
  const quote = "Shaina Sagar | Session 2 | Flight C | 7:45 AM | 9:45 AM";
  it("copies a supported time and normalizes only a grounded value", () => {
    expect(readMeetFileField({field:"weigh_in_at",value:"07:45",quote},quote)?.value).toBe("07:45");
    expect(readMeetFileField({field:"weigh_in_at",value:"19:45",quote},quote)).toBeNull();
    expect(readMeetFileField({field:"lifting_start",value:"25:00",quote},quote)).toBeNull();
  });
  it("does not accept invented evidence or unsupported fields", () => {
    expect(readMeetFileField({field:"flight",value:"D",quote},quote)).toBeNull();
    expect(readMeetFileField({field:"flight",value:"C",quote}, "another source")).toBeNull();
    expect(readMeetFileField({field:"__proto__",value:"C",quote},quote)).toBeNull();
  });
  it("stores structured data as a meet-scoped source note", () => {
    const r=readAiAnswer(JSON.stringify({facts:[{kind:"meet_logistics",field:"flight",value:"C",quote}],transcript:quote}),{source:null,fileKind:true,today:"2026-11-26",unitHint:null});
    expect(r.facts[0]).toMatchObject({kind:"note",scope:"meet",data:{meetLogistics:{field:"flight",value:"C"}}});
  });
  it("preselects clear fields, collapses duplicates and leaves conflicting evidence unchecked", () => {
    const source = { id: "s", status: "ready", competition_id: "meet", file_name: "schedule.pdf" };
    const fact = (id: string, field: string, value: string) => ({ id, status: "active", competition_id: "meet", source_id: "s", data: { meetLogistics: { field, value } } });
    const rows = meetFileProposals([fact("a","flight","B"),fact("b","flight","C"),fact("c","session_label","Session 2"),fact("d","session_label","Session 2")],[source],{ id:"meet",flight:"B" });
    expect(rows.map(p => [p.factId,p.conflict])).toEqual([["b",true],["c",false]]);
    expect(defaultMeetFileSelection(rows)).toEqual(["c"]);
  });
  it("validates coach edits against field limits and time format", () => {
    expect(validMeetFileValue("flight", " C ")).toBe(true);
    expect(validMeetFileValue("weigh_in_at", "07:45")).toBe(true);
    expect(validMeetFileValue("weigh_in_at", "25:00")).toBe(false);
    expect(validMeetFileValue("flight", " ")).toBe(false);
    expect(validMeetFileValue("flight", "x".repeat(41))).toBe(false);
    expect(validMeetFileValue("__proto__", "C")).toBe(false);
  });
  it("proposes only current ready sources for the selected competition and skips matching values", () => {
    const f={id:"f",status:"active",competition_id:"meet",source_id:"s",data:{meetLogistics:{field:"flight",value:"C"}}};
    const source={id:"s",status:"ready",competition_id:"meet",file_name:"schedule.pdf"};
    expect(meetFileProposals([f],[source],{id:"meet",flight:"B"})[0]).toMatchObject({before:"B",value:"C",source:"schedule.pdf"});
    expect(meetFileProposals([f],[source],{id:"meet",flight:"C"})).toEqual([]);
    expect(meetFileProposals([f],[{...source,status:"deleted"}],{id:"meet"})).toEqual([]);
    expect(meetFileProposals([f],[source],{id:"other"})).toEqual([]);
    expect(sameMeetValue("weight_class","57 kg","57")).toBe(true);
  });
});
