'use strict';
/* Features that answer the competitor pain points:
   1 quick capture in one line (N): Chinese rules in capture-zh.js, English rules here
   2 suggested slots: preview free gaps on the band; nothing moves until "accept all"
   3 quota hints in capture and quota reset marks on the band (only when real quota data exists)
   4 focus mode (F): emphasises the next item and holds AI results until it ends */
const Features=(()=>{
const cal={wd,weekStart,
  // (month, day of month) -> the next such day; with no month, the next such day of month
  dayOf(month,d){const now=utc(st.today);let y=now.getUTCFullYear(),m=month==null?now.getUTCMonth():month-1;
    let n=Math.round(Date.UTC(y,m,d)/864e5);
    if(n<st.today)n=month==null?Math.round(Date.UTC(y,m+1,d)/864e5):Math.round(Date.UTC(y+1,m,d)/864e5);
    return n}};

/* ---------- English rules ----------
   today / tomorrow / tonight / day after tomorrow / mon…sun / next fri / next week / Nov 20 / 11/20
   at 3pm / 3:30pm / 15:30 / noon / morning / afternoon / evening · for 30 min / 1h · P0–P2 or ! / !! · #tag · later */
const WEEKDAYS=['sun','mon','tue','wed','thu','fri','sat'],MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function parseEn(text,today,now){
  let s=' '+text+' ',day=today,time=null,dur=null,tag=null,p=null,dayHit=false;const notes=[];
  const cut=re=>{const m=s.match(re);if(m)s=s.replace(m[0],' ');return m};
  let m;
  if((m=cut(/#(\S+)/)))tag=m[1];
  if((m=cut(/(?:^|\s)p([0-2])(?=\s|$)/i)))p=+m[1];else if((m=cut(/!!/)))p=0;else if((m=cut(/(?:^|\s)!(?=\s|$)|(?<=\S)!(?=\s|$)/)))p=1;
  if((m=cut(/\b(?:for\s+)?half\s+an?\s+hour\b/i)))dur=.5;
  else if((m=cut(/\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i)))dur=+m[1];
  else if((m=cut(/\b(?:for\s+)?(\d+)\s*(?:m|min|mins|minutes?)\b/i)))dur=+m[1]/60;
  if((m=cut(/\b(?:later|someday|some\s+day)\b/i))){day=null;dayHit=true}
  else if((m=cut(/\bday\s+after\s+tomorrow\b/i))){day=today+2;dayHit=true}
  else if((m=cut(/\btomorrow\s+morning\b/i))){day=today+1;time=9;dayHit=true}
  else if((m=cut(/\btomorrow\s+(?:night|evening)\b/i))){day=today+1;time=20;dayHit=true}
  else if((m=cut(/\b(?:tomorrow|tmrw|tmr)\b/i))){day=today+1;dayHit=true}
  else if((m=cut(/\btonight\b/i))){day=today;time=20;dayHit=true}
  else if((m=cut(/\btoday\b/i))){day=today;dayHit=true}
  else if((m=cut(/\b(?:(next)\s+|on\s+|this\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday)?\b/i))){
    const w=WEEKDAYS.indexOf(m[2].toLowerCase());
    day=m[1]?weekStart(today)+7+((w+6)%7):today+(((w-wd(today)+7)%7)||7);dayHit=true}
  else if((m=cut(/\bnext\s+week\b/i))){day=weekStart(today)+7;dayHit=true}
  else if((m=cut(/\b(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i))){day=cal.dayOf(MONTHS.indexOf(m[1].toLowerCase())+1,+m[2]);dayHit=true}
  else if((m=cut(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})\b/))&&+m[1]>=1&&+m[1]<=12&&+m[2]>=1&&+m[2]<=31){day=cal.dayOf(+m[1],+m[2]);dayHit=true}
  if((m=cut(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i))){let h=+m[1]%12;if(/pm/i.test(m[3]))h+=12;time=h+(m[2]?+m[2]/60:0)}
  else if((m=cut(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/))&&+m[1]<24){time=+m[1]+ +m[2]/60}
  else if((m=cut(/\bat\s+(\d{1,2})\b/i))&&+m[1]<24){let h=+m[1];if(h>=1&&h<=6){h+=12;notes.push('cap.note.pm')}time=h}
  else if((m=cut(/\b(?:at\s+)?noon\b/i)))time=12;
  else if(time==null&&(m=cut(/\b(?:in\s+the\s+)?(morning|afternoon|evening|night)\b/i)))time={morning:9,afternoon:15,evening:18,night:20}[m[1].toLowerCase()];
  if(day==null)time=null;
  if(day===today&&time!=null&&time<now&&!dayHit){day=today+1;notes.push('cap.note.tomorrow')}
  else if(day===today&&time!=null&&time<now)notes.push('cap.note.passed');
  const title=s.replace(/\s+/g,' ').replace(/^[\s,]+|[\s,]+$/g,'').replace(/\s+(?:at|on|by|for)$/i,'')||text.trim();
  return {title,day,time,dur,tag,p,notes};
}
const AIN=['codex','claude','grok','qwen'];
function parse(text,{today=st.today,now=st.now}={}){
  const r=CaptureZh.applies(text.replace(/#\S+/g,''))?CaptureZh.parse(text,today,now,cal):parseEn(text,today,now);
  const low=text.toLowerCase(),hit=AIN.find(k=>low.includes(k));
  r.ai=hit?{pv:hit,q:Quota.of(hit)}:null;
  return r;
}
function quotaHint(r){if(!r.ai||!r.ai.q)return null;const w=r.ai.q.win.find(w=>w[1]!=null&&w[1]<25);if(!w)return null;
  const reset=w[3];
  const clash=reset!=null&&(r.day===st.today||r.day==null)&&(r.time==null||r.time<reset);
  return {text:tr('cap.quota',r.ai.q.name,w[0],w[1],w[2])+(clash?tr('cap.quotaAfter',fmt(reset)):''),reset:clash?reset:null}}

/* ---------- capture sheet ---------- */
function ensureCap(){let c=$('#cap');if(c)return c;c=document.createElement('div');c.id='cap';c.className='cap-scrim';c.hidden=true;
  c.innerHTML=`<div class="cap glass" role="dialog" aria-modal="true" aria-label="${tr('capture.title')}"><div class="cap-in">${icon('plus')}<input id="capIn" placeholder="${tr('cap.placeholder')}" autocomplete="off" maxlength="240" aria-describedby="capPrev"></div><div class="cap-prev" id="capPrev" aria-live="polite"></div><div class="cap-ft"><span>${tr('cap.help')}</span><span><kbd>↩</kbd> ${tr('cap.add')} <kbd>Esc</kbd> ${tr('cancel')}</span></div></div>`;
  document.body.appendChild(c);
  c.addEventListener('mousedown',e=>{if(e.target===c)closeCap()});
  $('#capIn').addEventListener('input',prev);
  $('#capIn').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();commit()}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeCap()}else if(e.key==='Tab'&&cur.hint&&cur.hint.reset!=null){e.preventDefault();useReset()}});
  c.addEventListener('click',e=>{if(e.target.closest('[data-cap="reset"]'))useReset()});
  return c}
let cur={},opener=null;
function openCap(prefill=''){if(locked){Toast.show(tr('save.paused'),{ms:5000});return}const c=ensureCap();opener=document.activeElement;c.hidden=false;const i=$('#capIn');i.value=prefill;prev();i.focus()}
function closeCap(){const c=$('#cap');if(c)c.hidden=true;if(opener&&opener.isConnected&&opener.focus)opener.focus({preventScroll:true})}
function prev(){const v=$('#capIn').value;if(!v.trim()){$('#capPrev').innerHTML=`<span class="cp-empty">${tr('cap.empty')}</span>`;cur={};return}
  const r=parse(v);r.hint=quotaHint(r);if(r.hint&&r.hint.reset!=null&&cur.forceReset)r.time=r.hint.reset;cur=r;
  const chip=(k,v,cls='')=>`<span class="cp ${cls}"><i>${k}</i>${v}</span>`;
  $('#capPrev').innerHTML=chip(tr('cap.task'),esc(r.title),'t')+chip(tr('cap.date'),r.day==null?tr('later'):relDay(r.day)+' '+mdS(r.day))+(r.time!=null?chip(tr('cap.time'),fmt(r.time)+(r.dur?`–${fmt(r.time+r.dur)}`:'')):chip(tr('cap.time'),tr('f.untimed'),'dim'))+(r.tag?(allTags().includes(r.tag)?chip(tr('cap.tag'),'#'+esc(r.tag)):`<span class="cp note">${tr('cap.noTag',esc(r.tag))}</span>`):'')+(r.p!=null&&r.p<2?chip(tr('cap.prio'),r.p===0?'!!':'!'):'')+
    r.notes.map(n=>`<span class="cp note">${tr(n)}</span>`).join('')+(r.hint?`<div class="cp-q">${pvGlyph(r.ai.pv)}<span>${esc(r.hint.text)}</span>${r.hint.reset!=null?`<button class="btn sm" data-cap="reset">${tr('cap.moveTo',fmt(r.hint.reset))}<kbd>Tab</kbd></button>`:''}</div>`:'')}
function useReset(){cur.forceReset=true;const keep=cur.forceReset;prev();cur.forceReset=keep}
function commit(){const v=$('#capIn').value.trim();if(!v)return;const r=parse(v);const h=quotaHint(r);if(cur.forceReset&&h&&h.reset!=null)r.time=h.reset;
  const tg=r.tag&&allTags().includes(r.tag)?r.tag:null;
  act(tr('t.added',quote(r.title),r.day==null?tr('later'):relDay(r.day))+(r.time!=null?' '+fmt(r.time):''),()=>{S.tasks.push(newTask({day:r.day,time:r.time,t:r.title.slice(0,240),p:r.p??2,tag:tg}))});
  cur={};$('#capIn').value='';closeCap()}

/* ---------- suggested slots ---------- */
function suggest(){const ov=buckets(dayList(st.today)).over;if(!ov.length){Toast.show(tr('sg.none'),{ms:1400});return}
  const ts=nextSlots(ov.length,st.now);st.suggest=ov.map((x,i)=>({id:x.id,t:ts[i]})).filter(s=>s.t!=null);
  if(!st.suggest.length){st.suggest=null;Toast.show(tr('t.noSlotDefer'));return}render()}
function acceptSuggest(){const sg=st.suggest;if(!sg)return;st.suggest=null;act(tr('sg.accepted',sg.length),()=>sg.forEach(s=>{const x=byId(s.id);if(x){x.time=s.t;x.day=st.today}}))}

/* ---------- focus ---------- */
function focus(on=!st.focusMode){const had=S.pending.length;st.focusMode=on;if(on)st.suggest=null;Inbox.setQuiet(on);render();if(on||!had)Toast.show(tr(on?'focus.started':'focus.ended'),{ms:1800})}

/* ---------- band extras: quota reset marks and suggested-slot ghosts ---------- */
function bandExtras(X,W,live){let s='';if(!live)return s;
  QUOTA.forEach(q=>q.win.forEach(([k,v,r,h])=>{if(h==null||v==null||h<=st.now||h>=H1)return;
    s+=`<span class="bq ${Quota.lvl(v)}" style="left:${X(h)}px" title="${esc(tr('band.resetTitle',q.name,k,fmt(h),v))}" aria-label="${esc(tr('band.resetAria',q.name,fmt(h)))}"><i></i><b>${esc(tr('band.reset',q.name.split(' ')[0],fmt(h)))}</b></span>`}));
  if(st.suggest)st.suggest.forEach(g=>{const x=byId(g.id);if(x)s+=`<span class="bghost" style="left:${X(g.t)}px;top:94px" title="${tr('sg.pill',fmt(g.t))} ${esc(x.t)}"></span>`});
  return s}
function afterRender(){
  const ws=$('#ws');if(ws){ws.classList.toggle('focusing',!!st.focusMode)}
  const fb=$('#focusBtn');if(fb){fb.setAttribute('aria-pressed',!!st.focusMode);fb.classList.toggle('on',!!st.focusMode)}
  // suggestion bar + row pills
  $('#sgBar')?.remove();$$('.sg-pill').forEach(p=>p.remove());
  if(st.suggest&&st.day===st.today&&st.scale==='day'&&st.mode!=='compact'){const bar=document.createElement('div');bar.id='sgBar';bar.className='sgbar';bar.setAttribute('role','status');
    bar.innerHTML=`${icon('sparkles')}<span>${tr('sg.bar',st.suggest.length,st.suggest.slice(0,4).map(g=>fmt(g.t)).join(tr('list.sep'))+(st.suggest.length>4?'…':''))}</span><span class="sp"></span><button class="btn sm primary" data-fa="accept">${tr('sg.accept')}</button><button class="btn sm" data-fa="cancel">${tr('cancel')}</button>`;
    $('#bandWrap').after(bar);
    st.suggest.forEach(g=>{const r=$(`#dList .drow[data-id="${CSS.escape(g.id)}"] .meta`);if(r)r.insertAdjacentHTML('afterbegin',`<span class="sg-pill">${tr('sg.pill',fmt(g.t))}</span>`)})}
  // focus bar
  $('#fBar')?.remove();
  if(st.focusMode&&st.mode!=='compact'){const nx=dayList(st.today).find(x=>!x.done&&x.time!=null&&x.time>=st.now-.25);const b=document.createElement('div');b.id='fBar';b.className='fbar';
    if(nx)$(`#dList .drow[data-id="${CSS.escape(nx.id)}"]`)?.classList.add('fnext');
    b.innerHTML=`${icon('moon','fill')}<span><b>${tr('focus.on')}</b>${nx?` · ${tr('focus.now',esc(nx.t),fmt(nx.time))}`:''}</span><span class="sp"></span><span class="fb-n">${S.pending.length?tr('focus.held',S.pending.length):tr('focus.willHold')}</span><button class="btn sm" data-fa="focus">${tr('focus.end')}<kbd>F</kbd></button>`;$('#bandWrap').after(b)}
}
document.addEventListener('click',e=>{const a=e.target.closest('[data-fa],#addBtn,#cwAdd,#focusBtn');if(!a)return;
  if(a.id==='addBtn'||a.id==='cwAdd'||a.dataset.fa==='capture')return openCap();
  if(a.id==='focusBtn'||a.dataset.fa==='focus')return focus();
  ({suggest,accept:acceptSuggest,cancel:()=>{st.suggest=null;render()}})[a.dataset.fa]?.()});
document.addEventListener('keydown',e=>{const a=document.activeElement;if(a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT'))return;if(st.inbox&&st.inbox.open)return;
  if(!$('#keys').hidden||document.querySelector('dialog[open]'))return;
  if((e.key==='n'||e.key==='N')&&!e.altKey){e.preventDefault();e.stopImmediatePropagation();openCap();return}
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if(e.key==='f'||e.key==='F'){e.preventDefault();e.stopImmediatePropagation();focus();return}
  if(e.key==='Escape'&&st.suggest){e.stopImmediatePropagation();st.suggest=null;render();return}},true);
return {parse,parseEn,quotaHint,openCap,closeCap,suggest,acceptSuggest,focus,afterRender,bandExtras};
})();
const bandExtras=Features.bandExtras;
