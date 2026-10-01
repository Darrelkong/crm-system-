import { deflateSync } from "node:zlib";
function crc(data:Uint8Array) {let c=0xffffffff;for(const byte of data){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(name:string,bytes:Buffer){const data=Buffer.concat([Buffer.from(name),bytes]),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc(data));return Buffer.concat([size,data,checksum]);}
export function cidPng(w=600,h=420){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;const row=Buffer.alloc(w*3+1,110);row[0]=0;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(Buffer.concat(Array.from({length:h},()=>row)))),chunk("IEND",Buffer.alloc(0))]);}
export type CidPart={cid?:string;disposition?:"inline"|"attachment";mime?:string;bytes?:Uint8Array;filename?:string};
export function cidMime(input:{name:string;html:string;parts:CidPart[];messageId?:string}) {
  const lines=["From: Synthetic Sender <sender@example.invalid>","To: reader@example.invalid","Bcc: invisible@example.invalid",`Subject: M1EC ${input.name}`,`Message-ID: <${input.messageId??input.name}@cid-test.invalid>`,"MIME-Version: 1.0",'Content-Type: multipart/related; boundary="cid-fixture"',"", "--cid-fixture", "Content-Type: text/html; charset=utf-8", "", input.html];
  input.parts.forEach((part,index)=>lines.push("--cid-fixture",`Content-Type: ${part.mime??"image/png"}; name="${part.filename??`part-${index}.png`}"`,...(part.cid===undefined?[]:[`Content-ID: ${part.cid}`]),...(part.disposition===undefined?[]:[`Content-Disposition: ${part.disposition}; filename="${part.filename??`part-${index}.png`}"`]),"Content-Transfer-Encoding: base64","",Buffer.from(part.bytes??cidPng()).toString("base64")));
  lines.push("--cid-fixture--","");return new TextEncoder().encode(lines.join("\r\n"));
}
export function cidFixtures(){
  const part={cid:"<Logo@Example>",disposition:"inline" as const};
  return [
    {name:"CID_SINGLE",html:'<h1>Single CID</h1><img src="cid:Logo%40Example" alt="Local logo" width="600">',parts:[part],loaded:1,unavailable:0},
    {name:"CID_MULTIPLE",html:'<h1>Multiple CID</h1><img src="cid:Logo@Example" alt="First"><img src="cid:second@example" alt="Second"><img src="cid:Logo@Example" alt="Repeated">',parts:[part,{cid:"<second@example>",disposition:"attachment" as const}],loaded:3,unavailable:0},
    {name:"CID_MISSING",html:'<img src="cid:missing@example" alt="Missing">',parts:[],loaded:0,unavailable:1},
    {name:"CID_DUPLICATE",html:'<img src="cid:Logo@Example" alt="Ambiguous">',parts:[part,{...part,disposition:"attachment" as const}],loaded:0,unavailable:1},
    {name:"CID_IMAGE_ONLY",html:'<img src="cid:Logo@Example" alt="">',parts:[part],loaded:1,unavailable:0},
    {name:"CID_MIXED_TEXT",html:'<h1>Text plus private and remote image</h1><p>Remote remains blocked</p><img src="cid:Logo@Example"><img src="http://127.0.0.1:3399/banner.png" alt="Remote canary">',parts:[part],loaded:1,unavailable:0},
    {name:"CID_WRONG_MESSAGE",html:'<img src="cid:Logo@Example" alt="Only another message has this CID">',parts:[],loaded:0,unavailable:1},
    {name:"CID_BAD_BYTES",html:'<img src="cid:Logo@Example" alt="Bad bytes">',parts:[{...part,bytes:new TextEncoder().encode("not PNG")}],loaded:0,unavailable:1},
  ].map(f=>({...f,end:f.name==="CID_IMAGE_ONLY"?null:`ACTUAL_END_${f.name}`,html:f.html+(f.name==="CID_IMAGE_ONLY"?"":`<p>ACTUAL_END_${f.name}</p>`)}));
}
