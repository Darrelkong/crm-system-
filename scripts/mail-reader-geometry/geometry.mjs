/** Real DOM measurement, evaluated inside the authenticated /mail document.
 * No layout/style mutation and no application-state access.
 */
export function measureReader({ end }) {
  // Compute inside the DOM scope: browser tools truncate large returned strings.
  function textFingerprint(text) { let hash=2166136261; for(let i=0;i<text.length;i++) hash=Math.imul(hash^text.charCodeAt(i),16777619); return `${text.length}:${hash>>>0}`; }
  const body = document.querySelector('.mail-message-body');
  if (!body) throw new Error('Production message body is not mounted');
  function rect(el) {
    const r = el.getBoundingClientRect();
    return { x:r.x, y:r.y, top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height };
  }
  function item(el) {
    const s = getComputedStyle(el);
    return { tag:el.tagName, classes:el.className, rect:rect(el), clientHeight:el.clientHeight, offsetHeight:el.offsetHeight, scrollHeight:el.scrollHeight, clientWidth:el.clientWidth, scrollWidth:el.scrollWidth, scrollTop:el.scrollTop, scrollLeft:el.scrollLeft, height:s.height, maxHeight:s.maxHeight, overflowX:s.overflowX, overflowY:s.overflowY, display:s.display, flexGrow:s.flexGrow, flexShrink:s.flexShrink, flexBasis:s.flexBasis, minHeight:s.minHeight, position:s.position, paddingBottom:s.paddingBottom };
  }
  const nodes = []; for(let el=body;el;el=el.parentElement) nodes.push(el);
  const marker = end ? Array.from(body.querySelectorAll('p,td,span')).find(el=>el.textContent===end) : null;
  const nav = document.querySelector('.mobile-bottom-nav');
  function visibility(el) {
    if (!el) return null;
    const r=rect(el); let top=0, bottom=innerHeight, left=0, right=innerWidth;
    const clips=[];
    for(let a=el.parentElement;a;a=a.parentElement) {
      const s=getComputedStyle(a), ar=rect(a);
      if(['hidden','clip','auto','scroll'].includes(s.overflowY)) { top=Math.max(top,ar.top);bottom=Math.min(bottom,ar.bottom);clips.push({classes:a.className,top:ar.top,bottom:ar.bottom,overflow:s.overflowY}); }
      if(['hidden','clip','auto','scroll'].includes(s.overflowX)) {left=Math.max(left,ar.left);right=Math.min(right,ar.right);}
    }
    const navRect=nav&&getComputedStyle(nav).display!=='none'?rect(nav):null;
    if(navRect&&navRect.width>0) bottom=Math.min(bottom,navRect.top);
    const x=Math.max(left,Math.min((r.left+r.right)/2,right-1));
    const y=Math.max(top,Math.min((r.top+r.bottom)/2,bottom-1));
    const hit=document.elementFromPoint(x,y);
    return {rect:r,visible:r.bottom>top&&r.top<bottom&&r.right>left&&r.left<right&&bottom>top,fullyVisible:r.top>=top&&r.bottom<=bottom&&r.left>=left&&r.right<=right,hitMatches:!!hit&&(el.contains(hit)||hit.contains(el)),effectiveClip:{top,bottom,left,right},clips};
  }
  const article=body.closest('article');
  const attachment=article?Array.from(article.querySelectorAll('span,button,a')).find(el=>el.textContent==='M1B_END_ATTACHMENT.txt'):null;
  return { viewport:{width:innerWidth,height:innerHeight}, url:location.pathname, chain:nodes.map(item), markerExists:!!marker, marker:visibility(marker), attachment:visibility(attachment), footer:visibility(article?.querySelector('footer')), actions:Array.from(article?.querySelectorAll('footer button')??[]).map(el=>({text:el.textContent,...visibility(el)})), nav:nav?item(nav):null, document:{clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,scrollTop:document.scrollingElement.scrollTop,scrollHeight:document.scrollingElement.scrollHeight,clientHeight:document.scrollingElement.clientHeight}, pre:Array.from(body.querySelectorAll('pre')).map(item), bodyTextLength:body.textContent.length, textFingerprint:textFingerprint(body.textContent), remoteResourceCount:body.querySelectorAll('[src],[srcset],link,style,object,embed').length, emptyState:body.getAttribute('role')==='status'?body.textContent:null, dangerousElementCount:body.querySelectorAll('script,iframe,form,input,object,embed,svg,img,[onclick],[onerror]').length, unsafeLinkCount:Array.from(body.querySelectorAll('a')).filter(a=>/^javascript:/i.test(a.getAttribute('href')??'')).length, executed:document.body.hasAttribute('data-m1b-executed') };
}

/** Accepts measured browser records, not source text. M1C can select fixed mode. */
export function assertGeometry(record, mode='fixed') {
  const checks=[];
  function check(name,pass) { checks.push({name,pass:!!pass}); }
  const {top,middle,bottom,fixture}=record;
  check('real Mail route',top.url==='/mail');
  if(mode==='fixed') {
    check('no external resource markup',bottom.remoteResourceCount===0);
    if(fixture.end) check('rendered content matches persisted fixture',top.textFingerprint===fixture.textFingerprint&&bottom.textFingerprint===fixture.textFingerprint);
  }
  check('no active malicious elements',bottom.dangerousElementCount===0&&bottom.unsafeLinkCount===0&&!bottom.executed);
  check('no horizontal document overflow',bottom.document.scrollWidth<=bottom.document.clientWidth+1);
  if(record.firstBottom) check('user-scroll maximum stable',Math.abs(bottom.document.scrollTop-record.firstBottom.document.scrollTop)<=1&&bottom.chain.every((n,i)=>Math.abs(n.scrollTop-record.firstBottom.chain[i].scrollTop)<=1));
  if(record.securityAfterClick) check('event handler remains inactive after click',!record.securityAfterClick.executed);
  if(fixture.end) {
    check('final marker exists',top.markerExists&&bottom.markerExists);
    if(fixture.name!=='MALICIOUS_HTML') {
      check('long content has scroll extent',top.chain.some(n=>n.scrollHeight>n.clientHeight+100));
      check('scroll probes recorded',!!middle&&!!bottom);
      if(mode==='baseline') {
        check('baseline final marker clipped',!bottom.marker.visible);
        check('document is the only user-scrollable vertical ancestor',bottom.document.scrollHeight>bottom.document.clientHeight&&!bottom.chain.some(n=>n.tag!=='HTML'&&['auto','scroll'].includes(n.overflowY)&&n.scrollHeight>n.clientHeight+1));
        check('baseline content exceeds clipped wrapper',bottom.chain.some(n=>n.overflowY==='hidden'&&n.scrollHeight>n.clientHeight+100));
        check('baseline intended inner scroller unconstrained',bottom.chain.some(n=>n.overflowY==='auto'&&n.classes.includes('flex-1')&&n.scrollHeight<=n.clientHeight+1));
      } else {
        check('M1C final marker reachable',bottom.marker.fullyVisible);
        check('M1C inner body has usable vertical scroll range',bottom.chain.some(n=>n.classes.includes('flex-1 overflow-y-auto')&&n.scrollHeight>n.clientHeight+1));
        check('M1C attachment reachable',bottom.attachment?.fullyVisible&&bottom.attachment?.hitMatches);
        check('M1C footer reachable',bottom.footer?.fullyVisible);
        check('M1C actions unobscured',(bottom.actions??[]).length>0&&(bottom.actions??[]).every(a=>a.fullyVisible&&a.hitMatches));
        check('M1C no competing document scroll',bottom.document.scrollHeight<=bottom.document.clientHeight+1);
        check('M1C one primary vertical body scroller',bottom.chain.filter(n=>['auto','scroll'].includes(n.overflowY)&&n.scrollHeight>n.clientHeight+1).length===1);
      }
    } else check('safe marker reachable',bottom.marker.visible);
  } else check('image-only empty state',!!bottom.emptyState);
  return {checks,passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length};
}
