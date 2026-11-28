/** Read only explicit QuickTime capture date metadata. Bounded reads; no video decode, no filename/mtime guesses. */
type Atom = {type:string;code:number;start:number;end:number};
const CAP = 8*1024*1024;
function atoms(bytes:Uint8Array,start=0,end=bytes.length):Atom[]{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const out:Atom[]=[];
  for(let p=start;p+8<=end&&out.length<10000;){
    let size=view.getUint32(p);const code=view.getUint32(p+4);let header=8;
    if(size===1){if(p+16>end)break;const n=view.getBigUint64(p+8);if(n>BigInt(end-p))break;size=Number(n);header=16;}
    if(size===0)size=end-p;
    if(size<header||p+size>end)break;
    const type=String.fromCharCode(...bytes.subarray(p+4,p+8));out.push({type,code,start:p+header,end:p+size});p+=size;
  }
  return out;
}
const decode=(b:Uint8Array)=>new TextDecoder().decode(b).replace(/\0+$/g,"").trim();
function explicitDate(value:string){
  const m=value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))?$/);
  if(!m)return null;
  const date=m[1];const parsed=new Date(date+"T00:00:00Z");
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||date<"1990-01-01")return null;
  if(value.length>10&&!Number.isFinite(Date.parse(value)))return null;
  return {date,recordedAt:value,source:"quicktime_creationdate" as const};
}
function findMeta(bytes:Uint8Array, boxes:Atom[], depth=0):ReturnType<typeof explicitDate>{
  if(depth>4)return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(const box of boxes){
    if(box.type==="udta"||box.type==="moov"){const d=findMeta(bytes,atoms(bytes,box.start,box.end),depth+1);if(d)return d;}
    if(box.type!=="meta")continue;
    for(const offset of [4,0]){
      const children=atoms(bytes,box.start+offset,box.end),keys=children.find(x=>x.type==="keys"),ilst=children.find(x=>x.type==="ilst");
      if(!keys||!ilst||keys.start+8>keys.end)continue;
      const count=view.getUint32(keys.start+4);let p=keys.start+8;
      let keyIndex=0;
      for(let i=1;i<=Math.min(count,10000)&&p+8<=keys.end;i++){
        const len=view.getUint32(p);if(len<8||p+len>keys.end)break;
        if(decode(bytes.subarray(p+8,p+len))==="com.apple.quicktime.creationdate"){keyIndex=i;break;}p+=len;
      }
      if(!keyIndex)continue;
      const item=atoms(bytes,ilst.start,ilst.end).find(x=>x.code===keyIndex);
      if(!item)continue;
      const data=atoms(bytes,item.start,item.end).find(x=>x.type==="data");
      if(data&&data.start+8<data.end&&data.end-data.start<1024){const d=explicitDate(decode(bytes.subarray(data.start+8,data.end)));if(d)return d;}
    }
  }
  return null;
}
export async function readOriginalRecordingDate(file:Blob):Promise<ReturnType<typeof explicitDate>>{
  try{
    // Seek top-level atom headers: skip the often enormous mdat atom.
    for(let p=0,n=0;p+8<=file.size&&n<256;n++){
      const bytes=new Uint8Array(await file.slice(p,p+16).arrayBuffer()),view=new DataView(bytes.buffer);
      let len=view.getUint32(0),header=8;const type=String.fromCharCode(...bytes.subarray(4,8));
      if(len===1){if(bytes.length<16)return null;const big=view.getBigUint64(8);if(big>BigInt(file.size-p))return null;len=Number(big);header=16;}
      if(len===0)len=file.size-p;
      if(len<header||p+len>file.size)return null;
      if(type==="moov"&&len<=CAP){const body=new Uint8Array(await file.slice(p+header,p+len).arrayBuffer());return findMeta(body,atoms(body));}
      p+=len;
    }
  }catch{ /* Unknown/edited media is not an error. */ }
  return null;
}
