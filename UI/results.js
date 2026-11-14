'use strict';
/* AI results inbox.
   - results that arrive together become one notice and one summary card, never a stack
   - groups: needs you -> failed -> done; updates from the same conversation share one row, latest on top
   - J/K · Space · E · A · U · X · C, multi-select with bulk actions, one-by-one mode with progress
   - every result maps to its mark on the band and back
   - focus mode holds new results and delivers them together afterwards
   Rows come from the host (Codex sessions and connectors). Read / archived / accepted are saved by the host. */
const Inbox=(()=>{
const GL=s=>tr('res.group.'+s);
const ORDER=['confirm','fail','done'];
const AI=['codex','claude','grok','qwen','other'];
const wire=new Map();            // channel -> rows as the host last sent them
const errors=new Map();          // channel -> message
const seen=new Set();            // ids already known, so only genuinely new rows are announced
const started=new Set();         // channels that delivered their first snapshot
const flags=new Map();           // id -> {read,archived,accepted} as the host knows them
let digest=null,arriving=[],arriveTimer=0;
st.inbox={open:false,filter:'all',src:'all',sel:[],cur:null,exp:[],cu:null,arch:false};st.quiet=false;

function view(row,channel){
  const src=channel==='codex'?'Codex':(row.source||''),{kind,st:status,info}=ShishiStatus.of({...row,source:src});
  const pv=channel==='codex'?'codex':pvOf(src),d=new Date(row.time*1000);
  const begun=typeof row.started==='number'&&row.started>0&&row.started<row.time?new Date(row.started*1000):null;
  return {id:row.id,channel,pv,src,kind,thread:row.thread?'codex:'+row.thread:row.id,codexThread:row.thread||'',link:row.link||'',
    task:kind==='ai'?row.title:pvName(pv,src),title:kind==='ai'?info.headline:row.title,
    detail:kind==='ai'?[...info.details,info.excerpt].filter(Boolean).join(' '):row.summary,files:kind==='ai'?info.files:[],raw:row.summary||'',
    st:status,ts:row.time,day:dayNum(d),at:nowHours(d),begin:begun&&dayNum(begun)===dayNum(d)?nowHours(begun):null,
    unread:!row.read,archived:!!row.archived,resolved:!!row.accepted,held:S.pending.includes(row.id)};
}
function rebuild(){
  S.res=[...wire.entries()].flatMap(([channel,rows])=>rows.map(r=>view(r,channel)));
  flags.clear();S.res.forEach(r=>flags.set(r.id,{read:!r.unread,archived:r.archived,accepted:r.resolved}));
  S.pending=S.pending.filter(id=>S.res.some(r=>r.id===id));
  ShishiStatus.retain(new Set(S.res.map(r=>r.id)));
}
/* The host sends a whole channel at a time. Rows not seen before, and still unread, count as arrivals. */
function receive(state){
  const channel=state.channel||'codex';
  errors.set(channel,state.error||'');
  if(Array.isArray(state.items)){
    const first=!started.has(channel);started.add(channel);
    const fresh=first?[]:state.items.filter(r=>!seen.has(r.id)&&!r.read&&!r.archived).map(r=>r.id);
    state.items.forEach(r=>seen.add(r.id));
    wire.set(channel,state.items);
    if(fresh.length&&st.quiet)S.pending.push(...fresh);
    rebuild();
    if(fresh.length&&!st.quiet){arriving.push(...fresh);clearTimeout(arriveTimer);arriveTimer=setTimeout(announce,300)}
  }
  if(window.Shishi&&Shishi.ready)render();
}
/* Send what changed locally (read / archived / accepted) to the host. Called after every render. */
function sync(){
  const changes=[];
  S.res.forEach(r=>{const w=flags.get(r.id);if(!w)return;const c={};
    if(w.read!==!r.unread)c.read=!r.unread;if(w.archived!==r.archived)c.archived=r.archived;if(w.accepted!==r.resolved)c.accepted=r.resolved;
    if(Object.keys(c).length){changes.push({id:r.id,channel:r.channel,...c});flags.set(r.id,{read:!r.unread,archived:r.archived,accepted:r.resolved})}});
  if(changes.length)native('inboxState',{changes}).catch(error=>Toast.show(error.message,{ms:5000}));
}
const live=()=>S.res.filter(r=>!r.archived&&!r.held);
function threads(arch=false){
  const m=new Map();(arch?S.res.filter(r=>r.archived):live()).forEach(r=>{if(!m.has(r.thread))m.set(r.thread,[]);m.get(r.thread).push(r)});
  return [...m.entries()].map(([key,items])=>{items.sort((a,b)=>b.ts-a.ts||(a.id<b.id?1:-1));const L=items[0];
    return {key,items,latest:L,st:L.resolved?'done':L.st,unread:items.some(i=>i.unread),pv:L.pv,src:L.src,task:L.task,ts:L.ts,
      onBand:AI.includes(L.pv)&&items.some(i=>i.day===st.today)}})
    .sort((a,b)=>ORDER.indexOf(a.st)-ORDER.indexOf(b.st)||b.ts-a.ts);
}
const srcOf=t=>pvName(t.pv,t.src);
function visible(){const I=st.inbox;let T=threads(I.arch);if(I.filter!=='all')T=T.filter(t=>t.st===I.filter);if(I.src!=='all')T=T.filter(t=>srcOf(t)===I.src);return T}
const unreadCount=()=>threads().filter(t=>t.unread).length;
const byKey=k=>threads(true).concat(threads()).find(t=>t.key===k);
/* Today's AI results as marks on the band. `a` is null unless the source reported a real start time. */
function runs(){return live().filter(r=>AI.includes(r.pv)&&r.day===st.today).map(r=>({id:r.thread,a:r.begin,b:r.at,pv:r.pv,src:r.src,task:r.task,
  rank:r.thread===st.inbox.cur?4:r.unread?(r.st==='done'||r.resolved?2:3):1}))}      // the one being read keeps its place
function forRun(id){if(!id)return null;const t=threads().find(t=>t.key===id);return t?{unread:t.unread,st:t.st,key:t.key}:null}

/* ---------- arrival ---------- */
function announce(list,label=''){
  const ids=list||arriving.splice(0),rows=S.res.filter(r=>ids.includes(r.id));
  if(!rows.length)return;
  if(rows.length>=3)digest={ids:rows.map(r=>r.id),at:st.now,label};
  const c=rows.filter(r=>r.st==='confirm').length,f=rows.filter(r=>r.st==='fail').length;
  const keys=new Set(rows.map(r=>r.thread)).size;
  const msg=rows.length===1?tr('res.one',pvName(rows[0].pv,rows[0].src),rows[0].title)
    :label+tr('res.many',rows.length)+(keys<rows.length?tr('res.manyGroups',keys):'')+(c?tr('res.manyConfirm',c):'')+(f?tr('res.manyFail',f):'');
  render();
  Toast.show(msg,{action:{label:tr('res.view'),fn:()=>open()},ms:6000});
  pulseIsland();
}
function setQuiet(on){
  st.quiet=on;native('focus',{value:on}).catch(()=>{});
  if(!on&&S.pending.length){const ids=S.pending.splice(0);S.res.forEach(r=>{if(ids.includes(r.id))r.held=false});announce(ids,tr('res.duringFocus'))}
  badges();
}

/* ---------- mutations (all undoable) ---------- */
const itemsOf=keys=>keys.flatMap(k=>{const t=byKey(k);return t?t.items:[]});
const canOpen=r=>!!(r.codexThread||r.link);
function openSource(t){const r=t.items.find(canOpen);if(!r)return;
  (r.codexThread?native('openCodex',{thread:r.codexThread}):native('openConnectorLink',{key:r.id})).catch(error=>Toast.show(error.message,{ms:4000}))}
const fixLabel=t=>t.st==='done'?null:tr(t.items.some(canOpen)?'res.acceptOpen':'res.accept');
const M={
  read(keys,v=false,quiet){const it=itemsOf(keys);act(v?tr('res.markedUnread'):tr('res.markedRead',keys.length),()=>it.forEach(i=>i.unread=v),{toast:!quiet})},
  archive(keys){const it=itemsOf(keys);const cur=st.inbox.cur;const first=byKey(keys[0]);if(!first)return;
    act(keys.length===1?tr('res.archivedOne',first.latest.title.slice(0,14)):tr('res.archivedMany',keys.length),()=>{it.forEach(i=>{i.archived=true;i.unread=false});st.inbox.sel=[];if(keys.includes(cur))st.inbox.cur=nextKey(cur)})},
  // Accepting only records the decision here and opens the source. Nothing is ever sent to an agent.
  accept(k){const t=byKey(k);if(!t||t.st==='done'){Toast.show(tr('res.nothingToAccept'),{ms:1500});return false}
    act(tr('res.accepted',fixLabel(t)),()=>{t.items.forEach(i=>{i.resolved=true;i.unread=false})});openSource(t);return true},
  allRead(){const k=threads().filter(t=>t.unread).map(t=>t.key);if(!k.length){Toast.show(tr('res.noUnread'),{ms:1200});return}M.read(k)},
  archiveDone(){const k=threads().filter(t=>t.st==='done').map(t=>t.key);if(!k.length){Toast.show(tr('res.noDone'),{ms:1200});return}M.archive(k)},
};
function nextKey(k){const T=visible().map(t=>t.key),i=T.indexOf(k);return T[i+1]||T[i-1]||null}

/* ---------- panel ---------- */
function ensure(){let el=$('#inbox');if(el)return el;el=document.createElement('aside');el.id='inbox';el.className='inbox';el.setAttribute('role','dialog');el.setAttribute('aria-label',tr('res.title'));el.tabIndex=-1;el.hidden=true;$('.main').appendChild(el);return el}
function grow(on){if(st.mode==='compact')native('latestSize',{expanded:on}).catch(()=>{})}
function open(k){const I=st.inbox;if(!I.open)grow(true);I.open=true;if(k){I.cur=k;if(!I.exp.includes(k))I.exp.push(k);const t=byKey(k);if(t&&t.unread)t.items.forEach(i=>i.unread=false)}render();$('#inbox')?.focus({preventScroll:true})}
function close(){if(st.inbox.open)grow(false);st.inbox.open=false;st.inbox.cu=null;render();(st.mode==='compact'?$('#cwInbox'):$('#inboxBtn'))?.focus({preventScroll:true})}
const fmtAt=r=>r.day===st.today?fmt(r.at):`${mdS(r.day)} ${fmt(r.at)}`;
const metaLine=t=>esc(t.task)+(srcOf(t)!==t.task?' · '+esc(srcOf(t)):'');
function rowHTML(t){const I=st.inbox,L=t.latest,exp=I.exp.includes(t.key),sel=I.sel.includes(t.key),fix=L.resolved?null:fixLabel(t),k=esc(t.key);
  const hist=t.items.slice(1).map(i=>`<li><time>${fmtAt(i)}</time>${esc(i.title)}</li>`).join('');
  return `<div class="ir${t.unread?' unread':''}${I.cur===t.key?' cur':''}${sel?' sel':''}${exp?' exp':''} s-${t.st}" data-k="${k}" role="option" aria-selected="${I.cur===t.key}">
    <div class="ir-main"><button class="ir-sel" data-ia="sel" data-k="${k}" role="checkbox" aria-checked="${sel}" aria-label="${tr('res.select')}"><i>${icon('check')}</i></button>
    ${pvTile(t.pv,'sm',t.src)}<button class="ir-body" data-ia="exp" data-k="${k}" aria-expanded="${exp}"><span class="it">${esc(L.title)}</span><span class="im">${metaLine(t)}${t.items.length>1?` · <b>${tr('res.updates',t.items.length)}</b>`:''}${L.resolved?' · '+tr('res.handled'):''}</span></button>
    <time>${fmtAt(L)}</time>${t.unread?`<span class="udot" aria-label="${tr('res.unread')}"></span>`:''}</div>
    ${exp?`<div class="ir-x"><p>${esc(L.detail||'')}</p>${L.files.length?`<div class="ir-files">${L.files.map(f=>`<code title="${esc(f.path)}">${esc(f.label)}</code>`).join('')}</div>`:''}${hist?`<ul class="ir-h">${hist}</ul>`:''}${I.raw===t.key?`<pre class="ir-raw">${esc(L.raw)}</pre>`:''}<div class="ir-acts">
      ${fix?`<button class="btn sm primary" data-ia="accept" data-k="${k}">${fix}<kbd>A</kbd></button>`:''}
      ${t.items.some(canOpen)?`<button class="btn sm" data-ia="source" data-k="${k}">${icon('open')}${tr(t.pv==='mail'?'res.openMail':t.pv==='ci'?'res.openBuild':'res.openSession')}</button>`:''}
      ${t.onBand?`<button class="btn sm" data-ia="locate" data-k="${k}">${icon('clock')}${tr('res.onBand')}</button>`:''}
      ${L.raw&&L.kind==='ai'?`<button class="btn sm" data-ia="raw" data-k="${k}" aria-expanded="${I.raw===t.key}">${tr(I.raw===t.key?'res.hideRaw':'res.raw')}</button>`:''}
      <button class="btn sm" data-ia="unread" data-k="${k}">${tr(t.unread?'res.markRead':'res.markUnread')}<kbd>U</kbd></button>
      ${I.arch?'':`<button class="btn sm" data-ia="archive" data-k="${k}">${tr('res.handledBtn')}<kbd>E</kbd></button>`}</div></div>`:''}</div>`}
function panel(){
  const el=ensure(),I=st.inbox;const box=st.mode==='compact'?$('#cw'):$('.main');if(box&&el.parentNode!==box)box.appendChild(el);el.classList.toggle('in-cw',st.mode==='compact');el.hidden=!I.open;$('#ws')?.classList.toggle('inbox-open',I.open);if(!I.open)return;
  if(st.mode==='compact'){el.style.top=($('.cw-head')?.offsetHeight||120)+'px'}else{const dl=$('#dList'),main=$('.main');if(dl&&main){const top=Math.min(Math.max(150,dl.getBoundingClientRect().top-main.getBoundingClientRect().top+4),Math.max(60,main.clientHeight-220));el.style.top=top+'px'}}
  if(I.cu){el.innerHTML=catchupHTML();return}
  const scroll=el.querySelector('.ib-list')?.scrollTop||0;
  const all=threads(),T=visible(),n=s=>all.filter(t=>t.st===s),un=all.filter(t=>t.unread).length;
  const srcs=[...new Map(all.map(t=>[srcOf(t),t.pv])).entries()];
  const warn=[...errors.values()].filter(Boolean).join(' · ');
  let h=`<div class="ib-h"><b>${tr('res.title')}</b><span class="ib-n" id="ibUnread">${un?tr('res.nUnread',un):tr('res.noUnread')}</span><span class="sp"></span>
    <button class="btn sm" data-ia="catchup" ${un?'':'disabled'} title="${tr('res.catchupTitle')}">${tr('res.catchup')}${un?` · ${un}`:''}<kbd>C</kbd></button>
    <button class="icon-btn" data-ia="close" aria-label="${tr('res.close')}">${icon('plus','rot45')}</button></div>
  <div class="ib-f" role="tablist" aria-label="${tr('res.byStatus')}">${[['all',tr('f.all'),all.length],['confirm',tr('res.f.confirm'),n('confirm').length],['fail',tr('res.f.fail'),n('fail').length],['done',tr('f.done'),n('done').length]].map(([k,l,c])=>`<button role="tab" class="${I.filter===k?'on':''}" aria-selected="${I.filter===k}" data-ia="filter" data-v="${k}">${l} <b>${c}</b></button>`).join('')}
    <span class="sp"></span><span class="ib-src">${[['all',''],...srcs].map(([s,pv])=>`<button class="${I.src===s?'on':''}" data-ia="src" data-v="${esc(s)}" title="${s==='all'?tr('res.allSources'):esc(s)}" aria-label="${s==='all'?tr('res.allSources'):esc(s)}" aria-pressed="${I.src===s}">${s==='all'?tr('f.all'):pvGlyph(pv)}</button>`).join('')}</span></div>`;
  if(warn)h+=`<p class="ib-warn" role="status">${esc(warn)}</p>`;
  if(digest&&!I.arch){const D=S.res.filter(r=>digest.ids.includes(r.id)&&!r.archived),du=D.filter(r=>r.unread);
    if(du.length){const c=D.filter(r=>r.st==='confirm'&&!r.resolved).length,f=D.filter(r=>r.st==='fail'&&!r.resolved).length,top=[...D].sort((a,b)=>ORDER.indexOf(a.st)-ORDER.indexOf(b.st)).slice(0,3);
      h+=`<section class="ib-digest" aria-label="${tr('res.digest')}"><div class="dg-h">${icon('sparkles')}<b>${digest.label||''}${tr('res.digestTitle',fmt(digest.at),digest.ids.length)}</b><span>${tr('res.nUnread',du.length)} · ${c?tr('res.f.confirm')+` ${c} · `:''}${f?tr('res.f.fail')+` ${f} · `:''}${tr('f.done')} ${D.length-c-f}</span></div>
      <ul>${top.map(r=>`<li class="s-${r.st}">${pvGlyph(r.pv)}<span>${esc(r.title)}</span></li>`).join('')}</ul>
      <div class="dg-a"><button class="btn sm primary" data-ia="catchup">${tr('res.catchup')}</button><button class="btn sm" data-ia="digestRead">${tr('res.digestRead')}</button></div></section>`}}
  if(I.sel.length)h+=`<div class="ib-bulk" role="toolbar" aria-label="${tr('res.bulk')}"><b>${tr('res.selected',I.sel.length)}</b><button class="btn sm" data-ia="bRead">${tr('res.markRead')}</button><button class="btn sm" data-ia="bUnread">${tr('res.markUnread')}</button><button class="btn sm" data-ia="bArch">${tr('res.archive')}</button><span class="sp"></span><button class="btn sm" data-ia="bAll">${tr('res.selectAll',T.length)}</button><button class="btn sm" data-ia="bNone">${tr('cancel')}</button></div>`;
  else h+=`<div class="ib-tools"><button class="linkbtn" data-ia="allRead">${tr('res.allRead')}</button><button class="linkbtn" data-ia="archDone">${tr('res.archiveDone')}</button><span class="sp"></span><span class="ib-k">${tr('res.keys')}</span></div>`;
  h+=`<div class="ib-list" role="listbox" aria-label="${tr('res.list')}">`;
  if(!T.length)h+=all.length||I.arch?`<div class="ib-empty"><b>${tr('res.emptyHere')}</b><button class="linkbtn" data-ia="filter" data-v="all">${tr('f.seeAll')}</button></div>`
    :`<div class="ib-empty done"><svg class="i big"><use href="#check-circle"/></svg><b>${tr('res.allHandled')}</b><span>${tr('res.emptyHint')}</span></div>`;
  ORDER.forEach(s=>{const g=T.filter(t=>t.st===s);if(!g.length)return;const gu=g.filter(t=>t.unread).length;
    h+=`<div class="ib-g s-${s}">${GL(s)}<span class="n">${g.length}</span>${gu?`<span class="gu">${tr('res.gUnread',gu)}</span>`:''}</div>`+g.map(rowHTML).join('')});
  h+=`</div><div class="ib-foot"><button class="linkbtn" data-ia="arch">${I.arch?tr('res.backToInbox'):tr('res.archived',threads(true).length)}</button><button class="linkbtn" data-ia="connectors">${tr('res.connectors')}</button><span class="sp"></span>${st.quiet?`<span>${tr('res.focusHeld',S.pending.length)}</span>`:''}</div>`;
  el.innerHTML=h;
  const listEl=el.querySelector('.ib-list');if(listEl)listEl.scrollTop=scroll;
  $(`#inbox .ir[data-k="${CSS.escape(I.cur||'')}"]`)?.scrollIntoView({block:'nearest'});
}
/* ---------- one by one ---------- */
function startCatchup(){const q=threads().filter(t=>t.unread).map(t=>t.key);if(!q.length){Toast.show(tr('res.noUnread'),{ms:1200});return}st.inbox.cu={q,i:0,done:0};render();$('#inbox')?.focus({preventScroll:true})}
function catchupHTML(){const C=st.inbox.cu,n=C.q.length;
  if(C.i>=n)return `<div class="cu-end"><svg class="i big"><use href="#check-circle"/></svg><b>${tr('res.allHandled')}</b><span>${tr('res.cuSummary',n,C.arch||0,C.acc||0)}</span><button class="btn primary" data-ia="cuExit">${tr('res.backToList')}</button></div>`;
  const t=byKey(C.q[C.i]);if(!t){C.i++;return catchupHTML()}const L=t.latest,fix=L.resolved?null:fixLabel(t);
  return `<div class="cu"><div class="cu-top"><button class="linkbtn" data-ia="cuExit">‹ ${tr('res.listShort')}</button><span class="cu-p" id="cuProg">${C.i+1}/${n}</span><span class="cu-bar"><i style="width:${(C.i)/n*100}%"></i></span></div>
   <div class="cu-card s-${t.st}"><div class="cu-meta">${pvTile(t.pv,'',t.src)}<div><b>${esc(srcOf(t))}</b><span>${esc(t.task)} · ${fmtAt(L)}</span></div><span class="cu-st">${GL(t.st)}</span></div>
   <h3>${esc(L.title)}</h3><p>${esc(L.detail||'')}</p>${t.items.length>1?`<ul class="ir-h">${t.items.slice(1).map(i=>`<li><time>${fmtAt(i)}</time>${esc(i.title)}</li>`).join('')}</ul>`:''}</div>
   <div class="cu-acts">${fix?`<button class="btn primary" data-ia="cuAccept">${fix}<kbd>A</kbd></button>`:''}<button class="btn" data-ia="cuArch">${tr('res.handledBtn')}<kbd>E</kbd></button><button class="btn" data-ia="cuNext">${tr('res.next')}<kbd>J</kbd></button><button class="btn" data-ia="cuPrev" ${C.i?'':'disabled'}>${tr('res.prev')}<kbd>K</kbd></button></div></div>`}
function cuStep(kind){const C=st.inbox.cu;const k=C.q[C.i];if(!k)return;
  if(kind==='arch'){M.archive([k]);C.arch=(C.arch||0)+1}
  else if(kind==='accept'){if(!M.accept(k))return;C.acc=(C.acc||0)+1}
  else if(kind==='next'){const t=byKey(k);if(t&&t.unread)M.read([k],false,true)}
  else if(kind==='prev'){C.i=Math.max(0,C.i-1);render();return}
  C.i++;render();}

/* ---------- badges + island ---------- */
function badges(){
  const n=unreadCount(),c=threads().filter(t=>t.unread&&t.st==='confirm').length,p=S.pending.length;
  $$('[data-inbox-badge]').forEach(b=>{b.textContent=n||'';b.hidden=!n});
  const sn=$('.nav-row[data-inbox] .n');if(sn)sn.textContent=n||'';
  $$('[data-inbox-label]').forEach(b=>b.setAttribute('aria-label',tr('res.badgeAria',n)+(c?tr('res.badgeConfirm',c):'')));
  const isl=$('#island');if(isl){isl.dataset.n=n;isl.className='isl'+(st.quiet?' quiet':n?' has':'');
    isl.innerHTML=st.quiet?`${icon('moon','fill')}<span>${tr('focus.on')}${p?tr('focus.later',p):''}</span>`:n?`<span class="idot${c?' warn':''}"></span><span>${tr('res.islandNew').replace('{b}',`<b>${n}</b>`)}${c?tr('res.islandConfirm',c):''}</span>`:`<span>${tr('res.islandNone')}</span>`;
    isl.setAttribute('aria-label',st.quiet?tr('focus.aria',p):tr('res.islandAria',n))}
  panel();
}
function pulseIsland(){const i=$('#island');if(!i||Theme.reduceMotion)return;i.animate([{transform:'scale(1)'},{transform:'scale(1.08)'},{transform:'scale(1)'}],{duration:500,easing:'cubic-bezier(.3,1.4,.5,1)'})}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const t=e.target;
  if(t.closest('#inboxBtn,#cwInbox,[data-inbox],#island')){st.inbox.open&&!t.closest('#island')?close():open();return}
  const ln=t.closest('.blane[data-run]');if(ln&&ln.dataset.run){const f=forRun(ln.dataset.run);if(f){open(f.key);return}}
  const a=t.closest('#inbox [data-ia]');if(!a)return;const k=a.dataset.k,I=st.inbox;
  switch(a.dataset.ia){
    case 'close':close();break;
    case 'filter':I.filter=a.dataset.v;render();break;
    case 'src':I.src=a.dataset.v;render();break;
    case 'sel':I.sel=I.sel.includes(k)?I.sel.filter(x=>x!==k):[...I.sel,k];I.cur=k;render();break;
    case 'exp':{I.cur=k;const o=I.exp.includes(k);I.exp=o?I.exp.filter(x=>x!==k):[...I.exp,k];const tt=byKey(k);if(!o&&tt&&tt.unread){tt.items.forEach(i=>i.unread=false)}render();break}
    case 'accept':M.accept(k);break;
    case 'source':{const tt=byKey(k);if(tt)openSource(tt);break}
    case 'raw':I.raw=I.raw===k?null:k;render();break;
    case 'unread':{const tt=byKey(k);if(tt)M.read([k],!tt.unread);break}
    case 'archive':M.archive([k]);break;
    case 'locate':locate(k);break;
    case 'allRead':M.allRead();break;
    case 'archDone':M.archiveDone();break;
    case 'bRead':M.read(I.sel);I.sel=[];render();break;
    case 'bUnread':M.read(I.sel,true);I.sel=[];render();break;
    case 'bArch':M.archive(I.sel);break;
    case 'bAll':I.sel=visible().map(t=>t.key);render();break;
    case 'bNone':I.sel=[];render();break;
    case 'arch':I.arch=!I.arch;I.sel=[];render();break;
    case 'connectors':Dialogs.connectors();break;
    case 'catchup':startCatchup();break;
    case 'digestRead':{const ks=[...new Set(S.res.filter(r=>digest&&digest.ids.includes(r.id)&&r.st==='done'&&r.unread).map(r=>r.thread))];if(ks.length)M.read(ks);break}
    case 'cuExit':I.cu=null;render();break;
    case 'cuArch':cuStep('arch');break;case 'cuAccept':cuStep('accept');break;case 'cuNext':cuStep('next');break;case 'cuPrev':cuStep('prev');break;
  }
});
function locate(k){const t=byKey(k);if(!t||!t.onBand)return;st.day=st.today;st.scale='day';st.nav='today';st.inbox.cur=k;render();
  const el=$(`.blane[data-run="${CSS.escape(t.key)}"]`);if(!el){Toast.show(tr('res.notOnBand'),{ms:1800});return}
  $$('.blane.flash').forEach(x=>x.classList.remove('flash'));el.classList.add('flash');$('#bw').classList.add('locating');
  setTimeout(()=>{el.classList.remove('flash');$('#bw')?.classList.remove('locating')},2400);
  Toast.show(tr('res.located',el.title),{ms:2400});}
const typing_=()=>{const a=document.activeElement;return a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT'||a.isContentEditable)};
document.addEventListener('keydown',e=>{
  const I=st.inbox;if(typing_()||e.metaKey||e.ctrlKey||document.querySelector('dialog[open]'))return;
  const k=e.key;
  if(!I.open){if(k==='i'||k==='I'){if(($('#keys')&&!$('#keys').hidden)||($('#cap')&&!$('#cap').hidden))return;e.preventDefault();e.stopImmediatePropagation();open()}return}
  const stop=()=>{e.preventDefault();e.stopImmediatePropagation()};
  if(I.cu){const m={j:'next',J:'next',ArrowDown:'next',ArrowRight:'next',k:'prev',K:'prev',ArrowUp:'prev',ArrowLeft:'prev',e:'arch',E:'arch',a:'accept',A:'accept'}[k];
    if(m){stop();if(I.cu.i>=I.cu.q.length){return}cuStep(m);return}
    if(k==='Escape'||k==='Enter'&&I.cu.i>=I.cu.q.length){stop();I.cu=null;render();return}return}
  const T=visible().map(t=>t.key);let i=T.indexOf(I.cur);
  if(k==='j'||k==='J'||k==='ArrowDown'){stop();I.cur=T[Math.min(T.length-1,i+1)]??null;render();return}
  if(k==='k'||k==='K'||k==='ArrowUp'){stop();I.cur=T[Math.max(0,i-1)]??T[0]??null;render();return}
  if(k==='Escape'){stop();if(I.sel.length){I.sel=[];render();return}close();return}
  if(k==='c'||k==='C'){stop();startCatchup();return}
  if(e.altKey&&(k==='u'||k==='U'||k==='¨')){stop();M.allRead();return}
  if(!I.cur&&T.length&&'eauxEAUX '.includes(k)){I.cur=T[0]}
  const cur=I.cur;if(!cur)return;
  if(k===' '||k==='Enter'){if(document.activeElement&&document.activeElement.closest('#inbox button'))return;stop();const o=I.exp.includes(cur);I.exp=o?I.exp.filter(x=>x!==cur):[...I.exp,cur];const tt=byKey(cur);if(!o&&tt&&tt.unread)tt.items.forEach(x=>x.unread=false);render();return}
  if(k==='e'||k==='E'){stop();M.archive(I.sel.length?I.sel:[cur]);return}
  if(k==='a'||k==='A'){stop();M.accept(cur);return}
  if(k==='u'||k==='U'){stop();const tt=byKey(cur);if(tt)M.read(I.sel.length?I.sel:[cur],!tt.unread);return}
  if(k==='x'||k==='X'){stop();I.sel=I.sel.includes(cur)?I.sel.filter(x=>x!==cur):[...I.sel,cur];render();return}
},true);
return {receive,sync,threads,visible,unreadCount,forRun,runs,setQuiet,open,close,badges,startCatchup,M,get digest(){return digest}};
})();
