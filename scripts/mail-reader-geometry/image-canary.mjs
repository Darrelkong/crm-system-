/** Test-only loopback server: no upstream fetch, no mail/AI, append-only evidence. */
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const log = process.argv[2];
if (!log || !log.includes('crm-mail-m1b-')) throw new Error('Use established disposable M1B evidence path');
function crc(data) { let c=0xffffffff; for(const byte of data) { c^=byte; for(let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
function chunk(name, bytes) { const data=Buffer.concat([Buffer.from(name),bytes]), size=Buffer.alloc(4), checksum=Buffer.alloc(4); size.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(data)); return Buffer.concat([size,data,checksum]); }
function png(w,h) { const header=Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h,4); header[8]=8; header[9]=2; const row=Buffer.alloc(w*3+1,110); row[0]=0; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:h},()=>row)))),chunk('IEND',Buffer.alloc(0))]); }
const banner=png(600,900), pixel=png(1,1);
http.createServer((req,res)=>{
  appendFileSync(log,JSON.stringify({path:req.url,referer:req.headers.referer??null,time:new Date().toISOString()})+'\n');
  if (!/^\/(banner|only|one|two|three|pixel|tiny|mixed|alt|safe)\.png$/.test(req.url??'')) {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
  res.end(req.url==='/pixel.png'||req.url==='/tiny.png'?pixel:banner);
}).listen(3399,'127.0.0.1',()=>console.log('Synthetic image canary listening on 127.0.0.1:3399'));
