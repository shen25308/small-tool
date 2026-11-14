'use strict';
/* Results panel v2, the small window that sits beside the editor.
   - a result has exactly one "what happened" sentence; the raw reply stays collapsed
   - one primary button and one "…" menu replace the old row of links
   - results that arrive together are merged into a single preview, never shown one after another
   Three sizes, set by the host: preview (one line) -> details -> original (raw reply open).
   This page's CSP allows no inline styles, so nothing here writes a style attribute into markup. */
(()=>{
const host=(op,fields={})=>window.webkit.messageHandlers.edge.postMessage({op,...fields});
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=id=>`<svg class="i"><use href="#${id}"/></svg>`;
const GLYPH={ai:'sparkles',codex:'pv-codex',claude:'pv-claude',grok:'pv-grok',qwen:'pv-qwen',build:'pv-ci',mail:'pv-mail',due:'pv-bell'};
I18n.use(navigator.languages||[navigator.language||'en']);I18n.apply(document);
Sky.follow();

let items=[],cur=null,mode='preview',src='all',rawOpen=false,burst=null,started=false;
const seen=new Set();

/* one row -> what the panel shows */
function view(n){
  const name=n.channel==='codex'?'Codex':(n.source||''),{kind,st,info}=ShishiStatus.of({...n,source:name});
  const glyph=kind!=='ai'?GLYPH[kind]:/^codex|chatgpt|openai/i.test(name)?GLYPH.codex:/claude/i.test(name)?GLYPH.claude:/grok|xai/i.test(name)?GLYPH.grok:/qwen|local ai/i.test(name)?GLYPH.qwen:GLYPH.ai;
  const d=new Date(n.time*1000),today=new Date().toDateString()===d.toDateString(),hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return {n,kind,st,glyph,name,group:kind==='ai'?'ai':kind==='build'?'ci':kind==='mail'?'mail':'other',
    title:kind==='ai'?info.headline:n.title,task:kind==='ai'?n.title:'',details:kind==='ai'?info.details:(n.summary?[n.summary]:[]),files:kind==='ai'?info.files:[],
    when:today?hm:`${d.getMonth()+1}/${d.getDate()} ${hm}`,canOpen:!!(n.thread||n.link),
    state:n.accepted?'done':kind==='mail'?'mail':kind==='due'?'due':st};
}
const tile=(v,cls='')=>`<span class="pvtile ${cls}" title="${esc(v.name)}" aria-label="${esc(v.name)}"><svg class="pv" aria-hidden="true"><use href="#${v.glyph}"/></svg></span>`;
const stateClass=s=>s==='fail'?'bad':s==='confirm'||s==='due'?'warn':s==='done'?'ok':'';
const byId=id=>items.find(n=>n.id===id)||null;
function size(next){
  if(next===mode)return;
  mode=next;const root=$('#rv2');root.classList.toggle('preview',next==='preview');root.classList.toggle('original',next==='original');
  host('resize',{mode:next});
}
function markRead(n){if(n&&!n.read){n.read=true;host('read',{key:n.id,channel:n.channel})}}

/* ---------- preview: one line, or one merged line for a burst ---------- */
function peek(){
  const el=$('#rvPeek');
  if(burst){
    const rows=burst.map(byId).filter(Boolean).map(view),c=rows.filter(v=>v.state==='confirm').length,f=rows.filter(v=>v.state==='fail').length;
    el.innerHTML=`<span class="pvtile"><svg class="pv" aria-hidden="true"><use href="#sparkles"/></svg></span><span class="tx"><span class="tt">${tr('pn.burst',rows.length)}</span><span class="mt">${tr('pn.burstSub',c,f,rows.length-c-f)}</span></span><span class="udot"></span>`;
    el.classList.add('unread');return;
  }
  const n=items[0];
  if(!n){el.innerHTML=`<span class="tx"><span class="mt">${tr('pn.waiting')}</span></span>`;el.classList.remove('unread');return}
  const v=view(n);
  el.innerHTML=`${tile(v)}<span class="tx"><span class="tt">${esc(v.title)}</span><span class="mt"><span class="st ${stateClass(v.state)}">${tr('pn.state.'+v.state)}</span> · ${esc(v.name)}</span></span><time>${v.when}</time>${n.read?'':'<span class="udot"></span>'}`;
  el.classList.toggle('unread',!n.read);
}

/* ---------- details ---------- */
function rowHTML(v){return `<button class="rv2-row${v.n.read?'':' unread'}" data-id="${esc(v.n.id)}" data-group="${v.group}">${tile(v)}<span class="tx"><span class="tt">${esc(v.title)}</span><span class="mt"><span class="st ${stateClass(v.state)}">${tr('pn.state.'+v.state)}</span> · ${esc(v.name)}</span></span><time>${v.when}</time></button>`}
function body(){
  const mount=$('#inbox'),shown=n=>src==='all'||view(n).group===src;
  $('#rvUnread').textContent=tr('pn.unread',items.filter(n=>!n.read).length);
  let h='';
  if(burst){
    const rows=burst.map(byId).filter(Boolean).map(view),c=rows.filter(v=>v.state==='confirm').length,f=rows.filter(v=>v.state==='fail').length;
    const order=['confirm','fail','due','mail','done'];rows.sort((a,b)=>order.indexOf(a.state)-order.indexOf(b.state));
    h+=`<article class="rv2-hero rv2-burst"><div class="rv2-meta"><span class="pvtile lg"><svg class="pv" aria-hidden="true"><use href="#sparkles"/></svg></span><div class="who"><b>${tr('pn.burst',rows.length)}</b><span>${tr('pn.burstSub',c,f,rows.length-c-f)}</span></div></div>
      <div class="rv2-list">${rows.filter(v=>shown(v.n)).map(rowHTML).join('')}</div>
      <button class="btn sm" data-rv="inbox">${tr('pn.review')}</button></article>`;
  }else if(cur&&shown(cur)){
    const v=view(cur),lead=v.state==='confirm'||v.state==='fail';
    const callout=lead&&v.kind==='ai'?(v.details[0]||v.title):'',rest=callout&&v.details[0]===callout?v.details.slice(1):v.details;
    h+=`<article class="rv2-hero"><div class="rv2-meta">${tile(v,'lg')}<div class="who"><b>${esc(v.name)}</b><span>${v.task?tr('pn.from',esc(v.task)):tr('pn.state.'+v.state)}</span></div><time>${v.when}</time></div>
      <h3 class="rv2-headline">${esc(v.title)}</h3>
      ${callout?`<div class="rv2-confirm${v.state==='fail'?' failed':''}" role="group" aria-label="${tr(v.state==='fail'?'pn.failed':'pn.confirm')}"><div class="ck-h">${icon('warn')}${tr(v.state==='fail'?'pn.failed':'pn.confirm')}</div><p>${esc(callout)}</p>${v.canOpen?`<button class="btn sm" data-rv="open">${tr('pn.open')}</button>`:''}</div>`:''}
      ${rest.length?`<div class="rv2-sec">${tr(v.kind==='ai'?'pn.changes':'pn.detail')}</div><ul class="rv2-changes">${rest.map(t=>`<li>${icon('check')}<span>${esc(t)}</span></li>`).join('')}</ul>`:''}
      ${v.files.length?`<div class="rv2-sec">${tr('pn.files')}</div><div class="rv2-files">${v.files.map(f=>`<span class="file" title="${esc(f.path)}">${icon('doc')}<span class="fn">${esc(f.label)}</span></span>`).join('')}</div>`:''}
      ${v.kind==='ai'&&cur.summary?`<button class="rv2-raw${rawOpen?' open':''}" data-rv="raw" aria-expanded="${rawOpen}">${icon('chev-right')}${tr('pn.raw')}<span>${tr('pn.chars',Array.from(cur.summary).length)}</span></button>${rawOpen?`<pre class="rv2-rawtext">${esc(cur.summary)}</pre>`:''}`:''}
    </article>`;
  }
  const others=items.filter(n=>shown(n)&&(burst?!burst.includes(n.id):!cur||n.id!==cur.id));
  if(others.length)h+=`<div class="rv2-sec rv2-earlier">${tr('pn.earlier')}<span>${others.length}</span></div><div class="rv2-list">${others.map(n=>rowHTML(view(n))).join('')}</div>`;
  if(!h)h=`<div class="rv2-empty">${tr(items.length?'pn.none':'pn.waiting')}</div>`;
  mount.innerHTML=h;
  const v=cur&&!burst?view(cur):null,primary=$('#rvPrimary');
  primary.dataset.rv=v&&v.canOpen?'open':'inbox';
  primary.innerHTML=v&&v.canOpen?icon('open')+tr(v.kind==='mail'?'pn.openMail':v.kind==='build'?'pn.openBuild':'pn.open'):icon('tray')+tr('pn.inbox');
  $$('#rvMenu [data-rv="today"],#rvMenu [data-rv="raw"]').forEach(b=>{b.disabled=!v||(b.dataset.rv==='raw'&&!(v.kind==='ai'&&cur.summary))});
  const newer=cur&&!burst?items.filter(n=>n.time>cur.time).length:0,cap=$('#rvNewer');
  cap.hidden=!newer;if(newer)cap.innerHTML=`<span class="dot"></span>${tr('pn.newer',newer)}<b>${tr('pn.show')}</b>`;
}
function paint(){peek();if(mode!=='preview')body()}
function show(n){burst=null;cur=n;rawOpen=false;markRead(n);size('details');paint();$('#inbox').scrollTop=0}
function note(text){const el=$('#rvNote');el.textContent=text;el.hidden=false;clearTimeout(note.timer);note.timer=setTimeout(()=>{el.hidden=true},2200)}
function menu(open){const m=$('#rvMenu');m.classList.toggle('hidden',!open);$('#rvMore').setAttribute('aria-expanded',open);if(open)m.querySelector('button:not(:disabled)')?.focus()}
function act(kind){
  menu(false);
  if(kind==='open'&&cur)host('open',{key:cur.id,channel:cur.channel,thread:cur.thread||''});
  if(kind==='inbox')host('history');
  if(kind==='back')host('workspace');
  if(kind==='today'&&cur){host('addTask',{title:view(cur).title});note(tr('pn.added'))}
  if(kind==='raw'&&cur){rawOpen=!rawOpen;size(rawOpen?'original':'details');paint();if(rawOpen)$('.rv2-rawtext')?.scrollIntoView({block:'nearest'})}
}

/* ---------- from the host ---------- */
window.setEdgeInbox=snapshot=>{
  items=(snapshot.items||[]).slice().sort((a,b)=>b.time-a.time);
  ShishiStatus.retain(new Set(items.map(n=>n.id)));
  const fresh=started?items.filter(n=>!seen.has(n.id)&&!n.read).map(n=>n.id):[];
  items.forEach(n=>seen.add(n.id));started=true;
  // Three or more arriving together become one preview. It stays until the user opens it or the rows are read.
  if(fresh.length>=3&&mode==='preview')burst=fresh;
  if(burst){burst=burst.filter(id=>{const n=byId(id);return n&&!n.read});if(burst.length<2)burst=null}
  if(cur)cur=byId(cur.id);
  if(mode!=='preview'&&!cur&&!burst){if(items[0])cur=items[0];else size('preview')}
  paint();
};
window.forgetDisplayedResult=()=>{cur=null;burst=null;items=[];rawOpen=false;size('preview');paint()};

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const t=e.target;
  if(t.closest('#rvPeek')){if(burst){size('details');paint()}else if(items[0])show(items[0]);else host('history');return}
  if(t.closest('#rvCollapse')){menu(false);rawOpen=false;cur=null;size('preview');paint();return}
  if(t.closest('#rvNewer')){if(items[0])show(items[0]);return}
  if(t.closest('#rvMore')){menu($('#rvMenu').classList.contains('hidden'));return}
  const seg=t.closest('.rv2-seg [data-src]');if(seg){src=seg.dataset.src;$$('.rv2-seg [data-src]').forEach(b=>{const on=b===seg;b.classList.toggle('on',on);b.setAttribute('aria-selected',on)});body();return}
  const row=t.closest('.rv2-row[data-id]');if(row){const n=byId(row.dataset.id);if(n)show(n);return}
  const a=t.closest('[data-rv]');if(a){act(a.dataset.rv);return}
  if(!t.closest('#rvMenu'))menu(false);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(!$('#rvMenu').classList.contains('hidden')){menu(false);$('#rvMore').focus()}else if(mode!=='preview')$('#rvCollapse').click();return}
  if(!(e.metaKey||e.ctrlKey))return;
  const k=e.key.toLowerCase();
  if(k==='t'&&cur){e.preventDefault();act('today')}
  if(k==='1'){e.preventDefault();act('back')}
  if(k==='2'){e.preventDefault();act('inbox')}
});
paint();
host('ready');
})();
