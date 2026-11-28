import {describe,it,expect} from "vitest";
import {readOriginalRecordingDate} from "@/lib/video-edit/recorded-date";
const enc=(s:string)=>new TextEncoder().encode(s);
const u32=(n:number)=>{const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n);return a;};
function join(...parts:Uint8Array[]){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;}
function atom(type:string|Uint8Array,...parts:Uint8Array[]){const body=join(...parts);return join(u32(body.length+8),typeof type==="string"?enc(type):type,body);}
function file(date:string){const key=enc("com.apple.quicktime.creationdate");const keys=atom("keys",u32(0),u32(1),u32(key.length+8),enc("mdta"),key);const data=atom("data",u32(1),u32(0),enc(date));const ilst=atom("ilst",atom(u32(1),data));return new Blob([atom("mdat",enc("ignored")),atom("moov",atom("meta",u32(0),keys,ilst))]);}
describe("lift video capture date",()=>{
 it("keeps the recording's local date rather than converting it to UTC",async()=>{expect(await readOriginalRecordingDate(file("2026-11-21T23:59:00-06:00"))).toMatchObject({date:"2026-11-21",source:"quicktime_creationdate"});});
 it("does not guess missing or invalid capture dates",async()=>{expect(await readOriginalRecordingDate(new Blob(["bad"]))).toBeNull();expect(await readOriginalRecordingDate(file("2026-02-30"))).toBeNull();});
});
