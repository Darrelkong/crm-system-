import React, { act, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MailWorkspaceProvider, useMailWorkspace, type MailWorkspaceApi } from "@/lib/mail/client/mail-workspace-context";
// @ts-expect-error Test bundler exposes the unchanged private production effect.
import { MailProductionWorkspaceRevalidation } from "@/lib/mail/client/mail-workspace-data-source-boundary";
import { MailProductionReadingPane } from "@/components/mail/prototype/mail-production-reading-pane";
import { I18nProvider } from "@/i18n/provider";
import { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
window.IS_REACT_ACT_ENVIRONMENT = true;
localStorage.setItem("crm_locale", "en");
const checks: string[]=[];
const errors: string[]=[];
const originalError=console.error;
console.error=(...args:unknown[])=>{errors.push(args.map(String).join(" "));originalError(...args);};
let workspace: ReturnType<typeof useMailWorkspace>;
function Probe(){const value=useMailWorkspace();useEffect(()=>{workspace=value;},[value]);return <MailProductionReadingPane onSeedAction={()=>{}}/>;}
let listCalls=0,detailCalls=0,offline=false,denied=false;
const detail={id:"synthetic-message",threadId:"thread",mailboxId:"synthetic-mailbox",direction:"inbound" as const,sender:{address:"sender@example.invalid",displayName:"Synthetic Sender"},subject:"Synthetic continuity",preview:"",timestamp:"2026-10-03T00:00:00Z",isUnread:false,isImportantPersonal:false,hasAttachments:false,attachmentCount:0,composeMode:null,recipients:[{recipientType:"to" as const,sortOrder:0,address:"reader@example.invalid",displayName:null}],bodyText:"",bodyHtml:"<p>BEGIN</p>"+"<p>Synthetic paragraph</p>".repeat(1000)+"<p>ACTUAL_END</p>",quotedText:null,quotedHtml:null,receivedAt:"2026-10-03T00:00:00Z",sentAt:null,attachments:[],thread:{id:"thread",mailboxId:"synthetic-mailbox",subjectNormalized:"synthetic",messageCount:1,latestMessageAt:"2026-10-03T00:00:00Z"},customerAssociation:null};
const api:MailWorkspaceApi={fetchAccessibleMailboxes:async()=>[{id:"synthetic-mailbox",address:"reader@example.invalid",displayName:"Synthetic",mailboxType:"personal",accessMode:"member",permissions:{canRead:true,canReply:true,canSend:false}}],fetchMessages:async()=>{listCalls++;if(offline)throw Error("offline");return {items:[],nextCursor:null};},fetchMessageDetail:async()=>{detailCalls++;if(denied)throw new MailReadApiError(403,"denied");if(offline)throw Error("offline");return {...detail};},updateMessageReadState:async()=>{throw Error("Not used");},fetchDrafts:async()=>[]};
// Capture timer scheduling, not effect implementation. Advance poll callbacks
// explicitly; these are synthetic lifecycle events, not physical device tests.
let poll: (()=>void)|undefined;
const interval=window.setInterval.bind(window);
window.setInterval=((handler:TimerHandler,timeout?:number,...args:unknown[])=>{if(timeout===60000&&typeof handler==='function')poll=handler as ()=>void;return interval(handler,timeout,...args);}) as typeof window.setInterval;
let visibility:DocumentVisibilityState="visible";
Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>visibility});
const check=(condition:unknown,label:string)=>{if(!condition)throw Error(label);checks.push(label);};
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,100));});
async function main(){
 const root=createRoot(document.getElementById("mount")!);
 await act(async()=>root.render(<StrictMode><I18nProvider><MailWorkspaceProvider api={api}><MailProductionWorkspaceRevalidation/><Probe/></MailWorkspaceProvider></I18nProvider></StrictMode>));
 for(let i=0;i<30&&!workspace;i++)await settle();
 await act(async()=>{await workspace.loadMailboxes();await workspace.selectMessage(detail.id);});await settle();
 const frame=document.querySelector('iframe')!;
 check(frame,"real isolated reader mounted");
 const documentBefore=frame.contentDocument;
 for(let i=0;i<30&&frame.offsetHeight<1000;i++)await settle();
 const scroll=document.querySelector<HTMLElement>('.mail-message-scroll')!;
 scroll.scrollTop=1200;
 check(scroll.scrollTop===1200,"real outer reader has scroll range");
 check(scroll.contains(document.querySelector('.mail-reading-header')),"mobile metadata inside primary scroll owner");
 for(const event of ['hidden','visible','focus','poll1','poll2']){
  const before=listCalls;
  await act(async()=>{
   if(event==='hidden'||event==='visible'){visibility=event==='hidden'?'hidden':'visible';document.dispatchEvent(new Event('visibilitychange'));}
   else if(event==='focus')window.dispatchEvent(new Event('focus'));
   else poll?.();
  });await settle();
  check(listCalls-before===(event==='hidden'?0:1),`${event}: bounded refresh count`);
  check(document.querySelector('iframe')===frame&&frame.contentDocument===documentBefore,`${event}: document identity retained`);
  check(scroll.scrollTop===1200&&workspace.selectedMessageId===detail.id,`${event}: selection and position retained`);
 }
 offline=true;await act(async()=>window.dispatchEvent(new Event('focus')));await settle();
 check(document.querySelector('iframe')===frame&&scroll.scrollTop===1200,'network error retains reader');
 offline=false;denied=true;await act(async()=>window.dispatchEvent(new Event('focus')));await settle();
 check(!document.querySelector('iframe')&&!workspace.selectedMessage,'access denial removes private document');
 check(!errors.some(e=>/Maximum update depth|ResizeObserver loop|Cannot update a component/.test(e)),'no lifecycle errors');
 await act(async()=>root.unmount());
 return {ok:true,checks,listCalls,detailCalls,errors};
}
main().then(async result=>{document.getElementById('result')!.textContent=JSON.stringify(result,null,2);await fetch('/result',{method:'POST',body:JSON.stringify(result)});}).catch(async error=>{const result={ok:false,error:String(error),checks,errors};document.getElementById('result')!.textContent=JSON.stringify(result,null,2);await fetch('/result',{method:'POST',body:JSON.stringify(result)});});
