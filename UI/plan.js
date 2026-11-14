'use strict';
/* Plan: the dense time band, the day list, the cluster popover, carry-over tidy-up, 3-day and week views,
   and the floating Today layout. Layout rules and thresholds follow the design spec (dense band, §11–12, §17). */

/* constraint set (tag / project / search / only / range): chip counts are computed inside it so filters compose */
function constrained(L){
  let r=L;
  if(st.tag)r=r.filter(x=>x.tag===st.tag);
  if(st.proj)r=r.filter(x=>x.proj===st.proj);
  if(st.query){const q=st.query.toLowerCase();r=r.filter(x=>x.t.toLowerCase().includes(q))}
  if(st.only)r=r.filter(x=>st.only.includes(x.id));
  if(st.range)r=r.filter(x=>x.time!=null&&x.time>=st.range[0]&&x.time<=st.range[1]);
  return r;
}
function buckets(L){
  const live=st.day===st.today;
  return {all:L,over:L.filter(isOver),next:L.filter(x=>!x.done&&x.time!=null&&(!live||x.time>=st.now)),un:L.filter(x=>!x.done&&x.time==null),done:L.filter(x=>x.done)};
}
const counts=()=>{
  const T=dayList(st.today),open=S.tasks.filter(x=>!x.done),by=k=>open.reduce((m,x)=>{if(x[k])m[x[k]]=(m[x[k]]||0)+1;return m},{});
  return {todayOpen:T.filter(x=>!x.done).length,todayDone:T.filter(x=>x.done).length,todayTot:T.length,carry:carry().length,
    plan:open.filter(x=>x.day!=null&&x.day>st.today).length,all:open.length,tag:by('tag'),proj:by('proj')};
};
// AI results that finished on the viewed day. A start time is drawn only when the source really reported one.
const runs=()=>st.day===st.today?Inbox.runs():[];

/* ---------- layout algorithm ---------- */
function packLanes(items,X,W,maxLanes=2){
  const lanes=[],out=[],over=[],dot=10/W*(H1-H0);
  items.map(r=>({...r,point:r.a==null,a:r.a??Math.max(H0,r.b-dot),b:Math.min(r.b,st.now)})).filter(r=>r.a<=st.now)
    // where several results share a moment, the ones still waiting for the user take the lanes
    .sort((p,q)=>Math.round(X(p.a))-Math.round(X(q.a))||(q.rank||0)-(p.rank||0)).forEach(r=>{
    let i=lanes.findIndex(end=>X(r.a)>=end+3);
    if(i<0&&lanes.length<maxLanes){i=lanes.length;lanes.push(0)}
    if(i<0){over.push(r);return}
    lanes[i]=X(r.b);out.push({...r,lane:i});
  });
  const more=[];over.forEach(r=>{const m=more.find(m=>Math.abs(X(m.a)-X(r.a))<30);m?m.n++:more.push({a:r.a,n:1})});
  return {out,more};
}
function cluster(list,X,th=15){
  const pts=list.filter(x=>x.time!=null&&!x.done).sort(byTime);
  const cs=[];pts.forEach(x=>{const c=cs[cs.length-1];if(c&&X(x.time)-X(c.items[c.items.length-1].time)<=th)c.items.push(x);else cs.push({items:[x]})});
  cs.forEach((c,i)=>{c.i=i;c.a=c.items[0].time;c.b=c.items[c.items.length-1].time;c.x=(X(c.a)+X(c.b))/2;c.over=c.items.some(isOver);c.p=Math.min(...c.items.map(x=>x.p))});
  return cs;
}
function placeLabels(cs,W,nowX){
  const live=st.day===st.today,ref=live?st.now:-1;
  const next=cs.find(c=>c.a>=ref);
  const score=c=>(c===next?90:0)+(c.over?(c.b>st.now-1.5?35:10):0)+(c.p===0?50:c.p===1?25:0)+Math.min(c.items.length,5)*4+(c.a>=ref?15:0);
  const rows=[live?[{l:nowX-26,r:nowX+26}]:[],[]];
  const placed=[];
  const MAX=6;[...cs].sort((a,b)=>score(b)-score(a)).forEach(c=>{
    if(placed.length>=MAX)return;
    const n=c.items.length, first=c.items[0];
    const short=s=>{if(textW(s)<=96)return s;while(s&&textW(s+'…')>96)s=s.slice(0,-1);return s+'…'};
    const txt=n===1?`<b>${fmt(c.a)}</b> ${esc(short(first.t))}`:c.over&&c.items.every(isOver)?`<b>${tr('band.nOverdue',n)}</b>`:`<b>${fmt(c.a)}–${fmt(c.b)}</b> · ${tr('n.items',n)}`;
    const plain=txt.replace(/<[^>]+>/g,'').replace(/&[#\w]+;/g,'x');
    const w=textW(plain,600)+8;
    const offs=[0];for(let d=8;d<=w/2-6;d+=8)offs.push(d,-d);
    for(let k=0;k<2;k++)for(const o of offs){
      let l=c.x-w/2+o, r=l+w; if(l<0){l=0;r=w} if(r>W){r=W;l=W-w}
      if(c.x<l+4||c.x>r-4)continue;
      if(rows[k].every(q=>r+8<q.l||l-8>q.r)){rows[k].push({l,r});placed.push({c,txt,row:k,x:(l+r)/2,ax:c.x-(l+r)/2,over:c.over});return}
    }
  });
  return placed;
}

/* ---------- band ---------- */
function band(){
  const live=st.day===st.today, sky=Sky.paint(live?st.now:12,isDark()), C=counts();
  H0=live?Math.min(6,Math.floor(st.now)):6;          // after midnight the band opens at 0:00 so "now" is never off the left edge
  const tomorrow=dayList(st.day+1).length;
  const left=live?`<div class="edge-zone ${C.carry?'warn':''} ${st.review?'on':''}" id="carryZone" role="button" tabindex="0" aria-pressed="${st.review}" aria-label="${tr('carry.aria',C.carry,tr(st.review?'carry.collapse':'carry.expand'))}" ${C.carry?'':`aria-disabled="true" title="${tr('carry.none')}"`}><b>${C.carry}</b>${tr('carry')}</div>`
    :`<div class="edge-zone" id="prevZone" role="button" tabindex="0" aria-label="${tr('band.backTo',relDay(st.day-1))}"><b>‹</b>${relDay(st.day-1)}</div>`;
  $('#bandWrap').innerHTML=`<div class="band">${left}<div class="bwrap" id="bw" tabindex="0" role="group" aria-label="${tr('band.aria',relDay(st.day))}"></div>
     <div class="edge-zone" id="nextZone" role="button" tabindex="0" aria-label="${relDay(st.day+1)} ${tr('n.items',tomorrow)}"><b>${tomorrow}</b>${relDay(st.day+1)}</div></div>`;
  const bw=$('#bw');bw.style.setProperty('--sky-top',sky.top);bw.style.setProperty('--sky-bottom',sky.bottom);bw.style.setProperty('--sky-accent',sky.accent);
  bw.classList.toggle('dimband',sky.dim);bw.classList.toggle('future',!live);
  const W=bw.clientWidth, X=h=>(h-H0)/(H1-H0)*W, nowX=X(st.now);
  const list=tasks();
  let s='';
  const arc=(x0,x1,peak)=>`M${x0} 34 Q ${(x0+x1)/2} ${2*peak-34} ${x1} 34`;
  s+=`<svg class="hz-sky" viewBox="0 0 ${W} 34" style="width:${W}px"><path d="${arc(X(Sky.RISE),X(Sky.SET),2)}" class="arc ${live&&sky.day?'on':''}"/><path d="${arc(X(Sky.SET),Math.min(W,X(Sky.SET+10)),8)}" class="arc moon ${live&&!sky.day?'on':''}"/></svg>`;
  if(live){
    if(sky.day)s+=`<span class="hz-sun" style="left:${nowX}px;top:${34-32*sky.alt}px;--glow:${sky.accent}"></span>`;
    else{const k=st.now>Sky.SET?Math.min(1,(st.now-Sky.SET)/10):Math.min(1,(st.now+24-Sky.SET)/10);s+=`<span class="hz-moonball" style="left:${nowX}px;top:${34-26*Math.sin(Math.PI*k)}px"><svg class="i fill"><use href="#moon"/></svg></span>`}
  }
  const hours=H0<6?[3,6,9,12,15,18,21]:[9,12,15,18,21];
  s+=`<div class="hz-hours">`+hours.filter(h=>!live||Math.abs(X(h)-nowX)>34).map(h=>`<span style="left:${X(h)}px">${h===18?tr('band.tonight'):h+':00'}</span>`).join('')+`</div>`;
  s+=`<div class="btrack" id="track"><div class="hz-skyfill"></div>${live?`<div class="hz-glow" style="opacity:${Math.max(sky.warm,.0)};background:radial-gradient(${W*.22}px 90px at ${nowX}px 110%, ${sky.accent}66, transparent 70%)"></div><div class="hz-past" style="width:${nowX}px"></div>`:''}`;
  const R=runs(),{out,more}=packLanes(R,X,W);
  s+=out.map(r=>{const w=X(r.b)-X(r.a),name=pvName(r.pv,r.src);
    const inner=r.point?'':w>=textW(r.task,500)+34?pvGlyph(r.pv)+`<span>${esc(r.task)}</span>`:w>=22?pvGlyph(r.pv):'';
    const rn=Inbox.forRun(r.id);return `<span class="blane${r.point?' point':''}${inner?'':' bare'}${rn&&rn.unread?' hasres':''}${rn&&rn.st==='confirm'?' needs':''}${rn&&rn.st==='fail'?' failed':''}" data-run="${esc(r.id)}" data-pv="${r.pv}" style="left:${X(r.a)}px;width:${Math.max(8,w)}px;top:${6+r.lane*20}px" title="${esc(name)} · ${esc(r.task)} · ${r.point?fmt(r.b):fmt(r.a)+'–'+fmt(r.b)}">${inner}</span>`}).join('');
  s+=more.map(m=>`<span class="bmore" style="left:${Math.max(...out.filter(o=>o.a<=m.a+.01&&o.b>=m.a).map(o=>X(o.b)),X(m.a))+3}px;top:6px" title="${tr('band.moreRuns',m.n)}">+${m.n}</span>`).join('');
  s+=list.map(x=>[x,doneHour(x)]).filter(([,h])=>h!=null).map(([x,h])=>`<span class="bdone" data-id="${esc(x.id)}" style="left:${X(h)}px"></span>`).join('');
  s+=S.tasks.map(x=>[x,dueInfo(x)]).filter(([x,d])=>d&&!x.done&&d.day===st.day&&d.time!=null&&d.time>=H0)
    .map(([x,d])=>`<span class="bdue${d.over?' over':''}" style="left:${X(d.time)}px" title="${tr('due.at',fmt(d.time))} · ${esc(x.t)}"></span>`).join('');
  s+=`</div>`;
  hours.forEach(h=>s+=`<span class="btick" style="left:${X(h)}px"></span>`);
  if(st.range)s+=`<div class="bsel" style="left:${X(st.range[0])}px;width:${X(st.range[1])-X(st.range[0])}px"></div>`;
  const cs=cluster(list,X);st.cs=cs;
  if(st.focus>=cs.length)st.focus=cs.length-1;
  const keep=(st.tag||st.proj||st.query||st.only)?new Set(constrained(list).map(x=>x.id)):null;const dim=c=>keep&&!c.items.some(x=>keep.has(x.id))?' dimmed':'';
  s+=cs.map(c=>{const n=c.items.length;
    return n===1?`<span class="bm one${dim(c)}${c.over?' over':''}${c.p===0?' p0':''}${st.cluster===c.i?' active':''}${st.focus===c.i?' focus':''}" data-c="${c.i}" style="left:${c.x}px;top:94px" role="button" aria-label="${fmt(c.a)} ${esc(c.items[0].t)}${c.over?tr('band.isOverdue'):''}"></span>`
      :`<span class="bm cl${dim(c)}${c.over?' over':''}${st.cluster===c.i?' active':''}${st.focus===c.i?' focus':''}" data-c="${c.i}" style="left:${c.x}px;top:94px" role="button" aria-label="${tr('band.clusterAria',fmt(c.a),fmt(c.b),n)}${c.over?tr('band.hasOverdue'):''}">${n}</span>`}).join('');
  s+=bandExtras(X,W,live);
  placeLabels(cs,W,nowX).forEach(p=>s+=`<span class="blabel${p.over?' over':''}${p.row?' r1':''}" style="left:${p.x}px;top:${124+p.row*17}px;--ax:${p.ax}px">${p.txt}</span>`);
  if(live)s+=`<div class="bnow" style="left:${nowX}px"><b>${fmt(st.now)}</b></div>`;
  {const ks=[...new Map(R.filter(r=>r.b<=st.now).map(r=>[pvName(r.pv,r.src),r.pv])).entries()];if(ks.length)s+=`<div class="blegend glass" role="note" aria-label="${tr('band.legend')}"><b>${tr('band.aiResults')}</b>${ks.map(([n,k])=>`<span>${pvGlyph(k)}${esc(n)}</span>`).join('')}</div>`}
  if(!list.some(x=>x.time!=null))s+=`<div class="bempty">${tr('band.empty',relDay(st.day))}</div>`;
  bw.innerHTML=s;
  const sr=$('#bandSR');if(sr)sr.textContent=st.focus>=0&&cs[st.focus]?$(`.bm[data-c="${st.focus}"]`)?.getAttribute('aria-label'):'';
}

/* ---------- filters ---------- */
const xIcon=()=>icon('plus','rot45');
function extraChips(n){
  let h='';
  if(st.tag)h+=`<button class="fchip extra" data-clear="tag" aria-label="${tr('f.clearTag',esc(st.tag))}"><span class="dot" style="background:${tagColor(st.tag)}"></span>${esc(st.tag)} ${xIcon()}</button>`;
  if(st.proj)h+=`<button class="fchip extra" data-clear="proj" aria-label="${tr('f.clearProj',esc(st.proj))}">${icon('folder')}${esc(st.proj)} ${xIcon()}</button>`;
  if(st.query)h+=`<button class="fchip extra" data-clear="query" aria-label="${tr('f.clearSearch')}">${tr('quote',esc(st.query))} ${xIcon()}</button>`;
  if(st.only)h+=`<button class="fchip extra" data-clear="only" aria-label="${tr('f.clearOnly')}">${tr('f.only',st.only.length)} ${xIcon()}</button>`;
  if(st.range)h+=`<button class="fchip range" data-clear="range" aria-label="${tr('f.clearRange')}">${fmt(st.range[0])}–${fmt(st.range[1])} · ${tr('n.itemsB').replace('{b}',`<b>${n}</b>`)} ${xIcon()}</button>`;
  return h;
}
function filters(){
  const base=tasks(),L=constrained(base),n=buckets(L),k=Object.fromEntries(Object.entries(n).map(([a,b])=>[a,b.length]));
  const live=st.day===st.today;
  let h=[['all',tr('f.all'),k.all],['over',tr('f.over'),k.over,'red'],['next',tr(live?'f.next':'f.timed'),k.next],['un',tr('f.untimed'),k.un],['done',tr('f.done'),k.done]]
    .filter(f=>f[2]||f[0]==='all'||f[0]===st.filter)
    .map(([key,l,c,cls])=>`<button class="fchip ${cls||''} ${st.filter===key?'on':''}" data-f="${key}" aria-pressed="${st.filter===key}">${l} <b>${c}</b></button>`).join('');
  h+=extraChips(L.length);
  const any=st.tag||st.proj||st.query||st.only||st.range;
  h+=`<span class="sp"></span>`;
  if(st.search)h+=`<input id="q" class="qinput" type="search" placeholder="${tr('search.placeholder')}" aria-label="${tr('search.placeholder')}" value="${esc(st.query)}">`;
  else h+=`<span class="hint">${any?`<button class="linkbtn" data-clear="all">${tr('f.clearAll')}</button> · Esc`:tr('f.dragHint')}</span>`;
  $('#filters').innerHTML=base.length||st.search||any?h:'';
  if(st.search){const q=$('#q');if(document.activeElement!==q&&st.searchFocus){q.focus();q.setSelectionRange(q.value.length,q.value.length);st.searchFocus=false}}
}

/* ---------- list ---------- */
const prioMark=x=>x.p===0?`<span class="prio p0" aria-label="${tr('prio.high')}">!!</span>`:x.p===1?`<span class="prio p1" aria-label="${tr('prio.mid')}">!</span>`:'';
function dueChip(x){
  const d=dueInfo(x);if(!d||x.done)return '';
  const when=(d.day===st.today?'':(Math.abs(d.day-st.today)<7?dayShort(d.day):mdS(d.day))+' ')+(d.time!=null?fmt(d.time):'');
  return `<span class="due${d.over?' over':''}" title="${tr('due.title')}">${tr('due.at',(when.trim()||relDay(d.day)))}</span>`;
}
function row(x,{time=true,day=false}={}){
  const tag=x.tag?`<span class="tag" style="--c:${tagColor(x.tag)}">${esc(x.tag)}</span>`:'';
  const tc=day==='multi'?(x.day==null?'':dayShort(x.day)+(x.day>weekStart(st.today)+13||x.day<st.today-6?' '+mdS(x.day):'')+(x.time!=null?' '+fmt(x.time):'')):(time&&x.time!=null?fmt(x.time):'');
  const to=(x.day??st.today)<st.today?st.today+1:(x.day??st.today)+1;
  const acts=x.done?`<span class="racts"><button class="ra" data-a="details" data-id="${esc(x.id)}" aria-label="${tr('row.detailsOf',esc(x.t))}">${tr('row.details')}</button></span>`
    :`<span class="racts">${x.time==null&&x.day===st.today?`<button class="ra" data-a="slot" data-id="${esc(x.id)}" title="${tr('row.slotTitle')}">${icon('clock')}${tr('row.slot')}</button>`:''}${x.day!==st.today?`<button class="ra" data-a="toToday" data-id="${esc(x.id)}" aria-label="${tr('row.toTodayOf',esc(x.t))}">${tr('row.toToday')}</button>`:''}<button class="ra" data-a="defer" data-id="${esc(x.id)}" title="${tr('row.deferTo',relDay(to))}" aria-label="${tr('row.deferToOf',relDay(to),esc(x.t))}">→ ${relDay(to)}</button><button class="ra" data-a="details" data-id="${esc(x.id)}" aria-label="${tr('row.detailsOf',esc(x.t))}">${tr('row.details')}</button></span>`;
  return `<div class="drow${x.done?' done':''}" data-id="${esc(x.id)}"><span class="tcol ${isOver(x)?'over':''}"${day==='multi'?' style="width:84px"':''}>${tc}</span><button class="check" role="checkbox" aria-checked="${!!x.done}" aria-label="${tr(x.done?'row.uncheckOf':'row.checkOf',esc(x.t))}"><i>${icon('check')}</i></button>${prioMark(x)}<span class="ttl">${esc(x.t)}</span><span class="meta">${dueChip(x)}${tag}${(x.defers||0)>=3&&!x.done?`<span class="dfr" title="${tr('row.deferHint')}">${tr('row.deferred',x.defers)}</span>`:''}</span>${acts}</div>`;
}
const grp=(t,n,cls='',act='')=>`<div class="dgrp ${cls}">${t}<span class="n">${n}</span><span class="rule"></span>${act}</div>`;
const more=(key,label,open)=>`<button class="collapsed-row" data-expand="${key}" aria-expanded="${open}">${icon(open?'chev-down':'chev-right')}${label}</button>`;
function list(){
  const base=tasks(),live=st.day===st.today;
  const earlier=st.nav==='done'&&live?S.tasks.filter(x=>x.done&&x.day!==st.today).sort((a,b)=>(b.day??-1)-(a.day??-1)||byTime(a,b)):[];
  const earlierHTML=()=>{if(!earlier.length)return '';const lim=st.showAllDone?earlier.length:30;
    return grp(tr('grp.doneEarlier'),earlier.length)+earlier.slice(0,lim).map(x=>row(x,{day:'multi'})).join('')+(earlier.length>30?more('alldone',st.showAllDone?tr('more.collapse'):tr('more.nMore',earlier.length-30),!!st.showAllDone):'')};
  if(!base.length){
    const n=dayList(st.day+1).length;
    $('#dList').innerHTML=`<div class="empty-state"><div class="et">${live?tr('empty.today'):tr('empty.day',relDay(st.day))}</div><p>${tr('empty.hint',relDay(st.day+1))}</p><button class="btn" data-fa="capture">${icon('plus')}${tr('capture.title')}</button> <button class="btn" data-goto="${st.day+1}">${tr('empty.look',relDay(st.day+1),n)}</button></div>`+earlierHTML();return}
  const L=constrained(base),b=buckets(L);
  if(!L.length){$('#dList').innerHTML=`<div class="empty-state"><div class="et">${tr('empty.filtered')}</div><button class="btn" data-clear="all">${tr('f.clear')}</button></div>`;applyHighlight();return}
  let h='';
  if(st.filter==='all'){
    if(live){
      const day=b.next.filter(x=>x.time<18),eve=b.next.filter(x=>x.time>=18);
      if(b.over.length)h+=grp(tr('f.over'),b.over.length,'red',`<span class="grp-note">${tr('over.noGuilt')}</span><button class="act" data-fa="suggest" title="${tr('over.suggestTitle')}">${tr('over.suggest')}</button><button class="act" data-a="evening">${tr('over.evening')}</button>`)+b.over.map(x=>row(x)).join('');
      h+=`<div class="nowline">${tr('now',fmt(st.now))}<i></i></div>`;
      if(day.length||!eve.length)h+=grp(tr('f.next'),day.length)+day.map(x=>row(x)).join('');
      if(eve.length)h+=grp(tr('grp.tonight'),eve.length)+eve.map(x=>row(x)).join('');
    } else h+=grp(tr('f.timed'),b.next.length)+b.next.map(x=>row(x)).join('');
    if(b.un.length){const lim=st.showUntimed?999:4;
      h+=grp(tr('f.untimed'),b.un.length,'',live?`<button class="act" data-a="slotall">${tr('un.slotAll')}</button>`:'')+b.un.slice(0,lim).map(x=>row(x)).join('')+(b.un.length>4?more('un',st.showUntimed?tr('un.collapse'):tr('un.more',b.un.length-4),st.showUntimed):'');}
    if(b.done.length)h+=more('done',st.showDone?tr('done.collapse',b.done.length):tr('done.expand',b.done.length),st.showDone)+(st.showDone?b.done.map(x=>row(x)).join(''):'');
  } else {
    const m=b[st.filter];h+=grp({over:tr('f.over'),next:tr(live?'f.next':'f.timed'),un:tr('f.untimed'),done:tr('f.done')}[st.filter],m.length)+m.map(x=>row(x)).join('');
    if(!m.length)h+=`<div class="empty-state small">${tr('empty.none')} · <button class="linkbtn" data-f="all">${tr('f.seeAll')}</button></div>`;
  }
  $('#dList').innerHTML=h+earlierHTML();
  applyHighlight();
}
function applyHighlight(){
  let ids=null;
  if(st.cluster!=null&&st.cs&&st.cs[st.cluster])ids=st.cs[st.cluster].items.map(x=>x.id);
  $('#dList').classList.toggle('filtering',!!ids);
  $$('#dList .drow').forEach(r=>r.classList.toggle('hl',!!ids&&ids.includes(r.dataset.id)));
}

/* ---------- cluster popover ---------- */
function openCluster(i){
  st.cluster=i;const c=i==null?null:st.cs[i],pop=$('#cpop');
  if(c==null){st.cluster=null;pop.classList.add('hidden');band();applyHighlight();if(st.refocusBand){st.refocusBand=false;$('#bw')?.focus({preventScroll:true})}return}
  band();applyHighlight();
  const mk=$(`.bm[data-c="${i}"]`);if(!mk){pop.classList.add('hidden');return}
  const m=mk.getBoundingClientRect(),host=$('.main').getBoundingClientRect();
  pop.setAttribute('aria-label',tr('cluster.aria',fmt(c.a),c.items.length));
  pop.innerHTML=`<div class="ph"><b>${c.items.length>1?fmt(c.a)+'–'+fmt(c.b):fmt(c.a)}</b><span>${tr('n.items',c.items.length)}${c.over?' · '+tr('cluster.hasOverdue'):''}</span></div>`+
    c.items.map(x=>`<div class="pr" data-id="${esc(x.id)}"><button class="check" role="checkbox" aria-checked="false" aria-label="${tr('row.checkOf',esc(x.t))}"><i>${icon('check')}</i></button>${prioMark(x)}<span>${esc(x.t)}</span><span class="tm${isOver(x)?' over':''}">${fmt(x.time)}</span></div>`).join('')+
    `<div class="pf"><button class="btn" data-a="only">${tr('cluster.only')}</button><button class="btn" data-a="shift30">${tr('cluster.shift')}</button></div>`;
  pop.style.left=Math.min(host.width-310,Math.max(10,m.left-host.left-150+m.width/2))+'px';pop.style.top=(m.bottom-host.top+12)+'px';
  pop.classList.remove('hidden');
}
const clusterIds=()=>st.cluster!=null&&st.cs[st.cluster]?st.cs[st.cluster].items.map(x=>x.id):[];

/* ---------- carry-over tidy-up ---------- */
function review(){
  const C=carry();
  if(!st.review||st.day!==st.today||st.scale!=='day'||!C.length){$('#review').innerHTML='';return}
  const from=x=>`${relDay(x.day)}${x.day<st.today-6?' '+mdS(x.day):''}${x.time!=null?' '+fmt(x.time):' · '+tr('f.untimed')}`;
  const hello=st.now>=5&&st.now<11?tr('review.hello'):'';
  $('#review').innerHTML=`<section class="review" aria-label="${tr('review.aria')}"><div class="rh"><b>${hello}${tr('review.title',C.length)}</b><span>${tr('review.sub')}</span><button class="icon-btn x" data-a="hideReview" aria-label="${tr('review.laterAria')}" title="${tr('review.later')}">${icon('plus','rot45')}</button></div>
   <div class="rlist">${(st.reviewAll?C:[...C].sort((a,b)=>a.p-b.p||b.day-a.day||byTime(a,b)).slice(0,6)).map(x=>`<div class="rv" data-id="${esc(x.id)}"><button class="check" role="checkbox" aria-checked="false" aria-label="${tr('row.checkOf',esc(x.t))}"><i>${icon('check')}</i></button>${prioMark(x)}<span class="ttl">${esc(x.t)}</span><span class="from ${st.today-x.day>=2?'over':''}">${from(x)}</span><span class="acts"><button data-a="toToday" data-id="${esc(x.id)}">${tr('review.toToday')}</button><button data-a="slot" data-id="${esc(x.id)}">${icon('clock')} ${tr('review.slot')}</button><button data-a="defer" data-id="${esc(x.id)}">${tr('row.deferTo',relDay(st.today+1))}</button></span></div>`).join('')}${C.length>6?`<button class="collapsed-row" data-expand="review" aria-expanded="${!!st.reviewAll}">${icon(st.reviewAll?'chev-down':'chev-right')}${st.reviewAll?tr('review.top6'):tr('review.more',C.length-6)}</button>`:''}</div>
   <div class="rf"><button class="btn primary" data-a="allToday">${tr('review.allToday')}</button><button class="btn" data-a="allMonday">${tr('review.allMonday')}</button><button class="btn" data-a="allSomeday">${tr('review.allLater')}</button><span>${tr('review.hint')}</span></div></section>`;
}

/* ---------- week / 3-day ---------- */
function skyGrad(){const stops=[6,7,9,12,15,16.8,18,21,24];return 'linear-gradient(90deg,'+stops.map(h=>{const s=Sky.at(h,isDark());return `${Sky.mix(s.top,s.bottom,.5)} ${((h-6)/18*100).toFixed(1)}%`}).join(',')+')'}
function densOf(L){const a=Array(9).fill(0);L.filter(x=>x.time!=null).forEach(x=>a[Math.max(0,Math.min(8,Math.floor((x.time-6)/2)))]++);return a}
function weekDays(){const three=st.scale==='3';if(three)return [st.today,st.today+1,st.today+2];const m=weekStart(st.today);return [0,1,2,3,4,5,6].map(i=>m+i)}
function dayStat(d){
  const L=dayList(d),left=L.filter(x=>!x.done).length;
  if(d<st.today)return {kind:'past',label:tr('week.done',L.length-left,L.length),left,L};
  if(d===st.today)return {kind:'today',label:tr('week.done',L.length-left,L.length),left:carry().length,L};
  return {kind:'future',label:tr('n.items',L.length),left:0,L};
}
function week(){
  const three=st.scale==='3',days=weekDays();
  Sky.paint(st.now,isDark());
  $('#bandWrap').innerHTML=`<div class="week" style="grid-template-columns:repeat(${days.length},1fr)">`+days.map(d=>{
    const s=dayStat(d),ds=densOf(s.L),max=Math.max(...ds,1),past=s.kind==='past';
    const dots=s.L.filter(x=>!x.done&&x.time!=null&&x.p<=1).slice(0,6).map(x=>`<i class="${isOver(x)?'over':''}" style="left:${(x.time-6)/18*100}%"></i>`).join('');
    const open=s.L.filter(x=>!x.done).sort(byTime),tl=open.filter(x=>s.kind!=='today'||x.time==null||x.time>=st.now).slice(0,3);
    const rest=open.length-tl.length;
    return `<div class="wday ${s.kind}" data-day="${d}" role="button" tabindex="0" ${past?`aria-disabled="true" title="${tr('week.pastTitle',dayShort(d))}"`:`aria-label="${tr('week.openDay',relDay(d),s.label)}"`}><div class="wh"><b>${dom(d)}</b>${d===st.today?tr('day.today'):dayShort(d)}</div>
      <div class="wsky" style="background:${skyGrad()}">${past?'<span class="shade"></span>':''}<div class="dens">${ds.map(v=>`<i style="height:${v/max*100}%"></i>`).join('')}</div>${s.kind==='today'?`<span class="now" style="left:${Math.max(0,(st.now-6)/18*100)}%"></span>`:''}</div>
      <div class="wdots">${dots}</div>
      <div class="wcount"><span>${s.label}</span>${s.left&&s.kind!=='future'?`<span class="left">${tr('week.left',s.left)}</span>`:''}</div>
      ${three?`<div class="wtasks">${tl.map(x=>`<div><span>${x.time!=null?fmt(x.time):''}</span><span>${esc(x.t)}</span></div>`).join('')}<div class="more">${rest>0?tr('more.nMore',rest):open.length?'':tr('week.none')}</div></div>`:''}</div>`}).join('')+`</div>`;
  // upcoming list, grouped relative to today
  const scoped=L=>{let r=L;if(st.tag)r=r.filter(x=>x.tag===st.tag);if(st.proj)r=r.filter(x=>x.proj===st.proj);if(st.query){const q=st.query.toLowerCase();r=r.filter(x=>x.t.toLowerCase().includes(q))}return r};
  const fut=scoped(S.tasks.filter(x=>!x.done&&(x.day==null||x.day>st.today))),endW=weekStart(st.today)+6,endN=endW+7;
  const groups=[];
  if(st.nav==='all'){   // "All tasks" also lists what is still open from earlier days and today
    groups.push([tr('carry'),scoped(carry()),'multi'],[tr('day.today'),scoped(dayList(st.today).filter(x=>!x.done)),'one']);
  }
  const of=f=>fut.filter(f).sort((a,b)=>(a.day??1e9)-(b.day??1e9)||byTime(a,b));
  groups.push([`${tr('day.tomorrow')} · ${dayShort(st.today+1)} ${mdS(st.today+1)}`,of(x=>x.day===st.today+1),'one']);
  for(let d=st.today+2;d<=endW;d++)groups.push([`${dayShort(d)} ${mdS(d)}`,of(x=>x.day===d),'one']);
  groups.push([`${tr('week.next')} · ${mdS(endW+1)}–${mdS(endN)}`,of(x=>x.day>endW&&x.day<=endN),'multi'],[tr('week.after'),of(x=>x.day>endN),'multi'],[tr('week.later'),of(x=>x.day==null),'multi']);
  let h='';groups.forEach(([g,items,m])=>{if(items.length)h+=grp(g,items.length)+items.map(x=>row(x,{day:m})).join('')});
  $('#dList').innerHTML=h||`<div class="empty-state small">${tr('empty.none')}</div>`;$('#dList').classList.remove('filtering');
  const thisWeek=fut.filter(x=>x.day!=null&&x.day<=endW).length;
  $('#filters').innerHTML=`<span class="fsum">${tr('week.sum').replace('{a}',`<b>${fut.length}</b>`).replace('{b}',`<b>${thisWeek}</b>`)}</span>${extraChips(fut.length)}<span class="sp"></span><span class="hint">${tr('week.hint')}</span>`;
}

/* ---------- floating Today ---------- */
function compact(){
  $('#ws').hidden=true;$('#cw').hidden=false;
  const L=dayList(st.today),b=buckets(L),over=b.over,later=L.filter(x=>!x.done&&x.time!=null&&x.time>=st.now),un=b.un,done=b.done;
  Sky.paint(st.now,isDark());
  const h0=Math.min(6,Math.floor(st.now));
  MiniBand.render($('#cBand'),{now:st.now,H0:h0,W:$('#cBand').clientWidth||308,tasks:L.map(x=>({h:x.done?doneHour(x):x.time,done:x.done,over:isOver(x)})),runs:Inbox.runs().filter(r=>r.a!=null)});
  $('#cwSub').textContent=L.length?tr('cw.sub',done.length,L.length,over.length,un.length):tr('cw.empty');
  $('#cwRing').setAttribute('stroke-dashoffset',94.25*(1-(L.length?done.length/L.length:0)));
  const nx=later[0];
  const exp=st.cExpand||{};
  $('#cList').innerHTML=(nx?`<div class="next"><div><div class="k">${tr('cw.next',fmt(nx.time))}</div><div class="v">${esc(nx.t)}</div></div><span class="in">${tr('cw.inMin',Math.max(1,Math.round((nx.time-st.now)*60)))}</span></div>`:`<div class="next"><div><div class="k">${tr('day.today')}</div><div class="v">${L.length&&!b.un.length&&!over.length?tr('cw.allDone'):tr('cw.noMore')}</div></div></div>`)+
    (over.length?`<div class="dgrp red inset">${tr('f.over')}<span class="n">${over.length}</span><span class="rule"></span><button class="act" data-a="evening">${tr('cw.rollAll')}</button></div>`+over.slice(0,exp.over?999:2).map(x=>row(x)).join('')+(over.length>2?`<button class="collapsed-row inset" data-cexpand="over" aria-expanded="${!!exp.over}">${icon(exp.over?'chev-down':'chev-right')}${exp.over?tr('more.collapse'):tr('cw.moreOver',over.length-2)}</button>`:''):'')+
    (later.length>1?`<div class="dgrp inset">${tr('f.next')}<span class="n">${later.length}</span><span class="rule"></span></div>`+later.slice(1,exp.next?999:6).map(x=>row(x)).join(''):'')+
    (later.length>6||un.length?`<button class="collapsed-row inset" data-cexpand="next" aria-expanded="${!!exp.next}">${icon(exp.next?'chev-down':'chev-right')}${exp.next?tr('more.collapse'):`${later.length>6?tr('more.nMore',later.length-6)+' · ':''}${tr('f.untimed')} ${un.length}`}</button>`+(exp.next?un.map(x=>row(x)).join(''):''):'');
  ringsQuota();
}
function ringsQuota(){
  const q=Quota.tightest();$$('[data-ring]').forEach(el=>el.innerHTML=Quota.ring(q?q.v:null));
  const sq=$('#sideQuota');if(sq){sq.setAttribute('aria-label',q?tr('q.aria',q.name,q.k,q.v):tr('q.ariaNone'));
    sq.querySelector('.sq-r').innerHTML=q?tr('q.label',esc(q.name)).replace('{b}',`<b>${q.v}%</b>`):tr('q.none');sq.querySelector('.sq-r').classList.toggle('warn',!!q&&q.v<25)}
  const cq=$('#cwQuota');if(cq)cq.setAttribute('aria-label',q?tr('q.ariaShort',q.v):tr('q.ariaNone'));
}

/* ---------- sidebar ---------- */
function side(){
  const C=counts();
  const set=(k,v)=>{const n=$(`.nav-row[data-nav="${k}"] .n`);if(n)n.textContent=v||''};
  set('today',C.todayOpen);set('plan',C.plan);set('all',C.all);
  $('#sideProjects').innerHTML=data.projects.map(n=>`<button class="nav-row${st.proj===n?' tagon':''}" data-proj="${esc(n)}" aria-pressed="${st.proj===n}">${icon('folder')}<span class="nm">${esc(n)}</span><span class="n">${C.proj[n]||''}</span></button>`).join('');
  $('#sideTags').innerHTML=allTags().map(n=>`<button class="nav-row${st.tag===n?' tagon':''}" data-tag="${esc(n)}" aria-pressed="${st.tag===n}"><span class="dot" style="background:${tagColor(n)}"></span><span class="nm">${esc(n)}</span><span class="n">${C.tag[n]||''}</span></button>`).join('');
  const sel=st.nav==='all'?'all':st.scale!=='day'?'plan':(st.nav||'today');
  $$('.side nav .nav-row[data-nav]').forEach(r=>{const on=r.dataset.nav===sel;r.classList.toggle('sel',on);r.setAttribute('aria-current',on?'page':'false')});
}

/* ---------- render ---------- */
function render(){
  draw();
  Inbox.badges();Inbox.sync();Features.afterRender();
}
function draw(){
  $('#ws').hidden=false;$('#cw').hidden=true;
  $$('[data-scale]').forEach(b=>{const on=b.dataset.scale===st.scale;b.classList.toggle('on',on);b.setAttribute('aria-selected',on)});
  const live=st.day===st.today,L=tasks();
  $('#dTitle').textContent=st.nav==='all'?tr('nav.all'):st.scale!=='day'?tr('nav.plan'):relDay(st.day);
  const ws=weekStart(st.today);
  $('#dDate').textContent=st.scale==='week'?rangeLabel(ws,ws+6):st.scale==='3'?rangeLabel(st.today,st.today+2):dayLong(st.day)+(L.length?` · ${tr('head.done',L.filter(x=>x.done).length,L.length)}`:'');
  $('#backToday').hidden=live||st.scale!=='day';
  side();ringsQuota();
  if(st.mode==='compact'){compact();return}
  if(st.scale!=='day'){week();review();$('#cpop').classList.add('hidden');st.cs=[];return}
  band();filters();review();list();
  if(st.cluster!=null&&st.cs[st.cluster])openCluster(st.cluster);else{st.cluster=null;$('#cpop').classList.add('hidden')}
}
/* The real clock. Crossing midnight rolls the day over: unfinished tasks become carry-over, never part of the new day. */
function tick(){
  const d=new Date(),today=dayNum(d),now=nowHours(d);
  if(today===st.today&&Math.abs(now-st.now)<1e-6)return;
  const rolled=today!==st.today;
  if(rolled){
    if(st.day===st.today||st.day<today)st.day=today;
    st.today=today;Sky.setDay(d,I18n.timeZone);
    st.review=carry().length>0;st.cluster=null;st.range=null;st.only=null;
    if(st.review)Prefs.set('reviewDay',ymd(today));
  }
  st.now=now;
  // Re-rendering once a minute must not take the keyboard away from a field the user is typing in.
  const a=document.activeElement,id=a&&a.id,sel=a&&a.tagName==='INPUT'&&a.type==='search'?[a.selectionStart,a.selectionEnd]:null;
  st.silent=true;render();st.silent=false;
  if(id&&document.activeElement!==document.getElementById(id)){const el=document.getElementById(id);if(el){el.focus({preventScroll:true});if(sel)try{el.setSelectionRange(sel[0],sel[1])}catch(e){}}}
  if(rolled)Toast.show(tr('rollover',md(st.today),carry().length),{ms:6000});
}

/* ---------- actions ---------- */
const nextSlots=(n,from)=>{ // free half-hour slots after `from`, skipping times already used today
  const used=dayList(st.today).filter(x=>x.time!=null&&!x.done).map(x=>x.time),out=[];
  let t=Math.ceil((from+.01)*2)/2;
  while(out.length<n&&t<23.75){if(!used.some(u=>Math.abs(u-t)<.25))out.push(t);t+=.5}
  while(out.length<n)out.push(null);return out;
};
const A={
  complete(id){const x=byId(id);if(!x)return;act(tr('t.completed',quote(x.t)),()=>{x.done=1;x.doneAt=new Date().toISOString()})},
  uncomplete(id){const x=byId(id);if(!x)return;act(tr('t.restored',quote(x.t)),()=>{x.done=0;x.doneAt=null})},
  defer(id){const x=byId(id);if(!x)return;const to=(x.day??st.today)<st.today?st.today+1:(x.day??st.today)+1;
    act(tr('t.deferred',quote(x.t),relDay(to))+((x.defers||0)>=2?tr('t.deferredOften',(x.defers||0)+1):''),()=>{x.day=to;x.defers=(x.defers||0)+1})},
  slot(id){const x=byId(id);if(!x)return;const [t]=nextSlots(1,st.now);if(t==null){Toast.show(tr('t.noSlotDefer'));return}
    act(tr('t.slotted',quote(x.t),relDay(st.today),fmt(t)),()=>{x.day=st.today;x.time=t})},
  toToday(id){const x=byId(id);if(!x)return;act(tr('t.toToday',quote(x.t)),()=>{x.day=st.today;if(x.time!=null&&x.time<st.now)x.time=null})},
  evening(){const ids=buckets(dayList(st.today)).over.map(x=>x.id);if(!ids.length)return;const ts=nextSlots(ids.length,Math.max(st.now,19));
    act(tr('t.evening',ids.length),()=>ids.forEach((id,i)=>{const x=byId(id);x.time=ts[i];}))},
  slotall(){const ids=buckets(constrained(dayList(st.today))).un.map(x=>x.id);const ts=nextSlots(ids.length,st.now),k=ts.filter(t=>t!=null).length;
    if(!k){Toast.show(tr('t.noSlot'));return}
    act(tr('t.slotAll',k)+(k<ids.length?tr('t.slotAllRest',ids.length-k):''),()=>ids.forEach((id,i)=>{if(ts[i]!=null)byId(id).time=ts[i]}))},
  shift30(){const ids=clusterIds();const r=ids.map(byId);const late=r.some(x=>x.time+.5>=24);if(late){Toast.show(tr('t.pastMidnight'));return}
    act(tr('t.shift',ids.length),()=>{r.forEach(x=>x.time+=.5);st.cluster=null})},
  only(){const ids=clusterIds();st.only=ids;st.filter='all';st.cluster=null;render()},
  allToday(){const C=carry();act(tr('t.allToday',C.length),()=>{C.forEach(x=>{x.day=st.today;if(x.time!=null&&x.time<st.now)x.time=null});st.review=false})},
  allMonday(){const C=carry(),m=weekStart(st.today)+7;act(tr('t.allMonday',C.length,mdS(m)),()=>{C.forEach(x=>x.day=m);st.review=false})},
  allSomeday(){const C=carry();act(tr('t.allLater',C.length),()=>{C.forEach(x=>{x.day=null;x.time=null});st.review=false})},
  hideReview(){st.review=false;render();Toast.show(tr('t.reviewHidden'),{ms:4000})},
  details(id){Dialogs.task(id)},
};

/* ---------- popovers / menus / sheets ---------- */
function openQpop(anchor){
  const p=$('#qpop'),was=!p.classList.contains('hidden');
  if(was&&p.dataset.anchor===anchor.id){closeQpop();return}
  $('#qcards').innerHTML=Quota.cards();
  $('#qFoot').textContent=Quota.tightest()?tr('q.foot',Quota.updated?fmt(nowHours(new Date(Quota.updated*1000))):fmt(st.now)):tr('q.footNone');
  const r=anchor.getBoundingClientRect();p.dataset.anchor=anchor.id;
  p.style.position='fixed';p.style.left=Math.max(8,Math.min(innerWidth-348,r.left))+'px';
  if(r.top>innerHeight/2){p.style.top='';p.style.bottom=(innerHeight-r.top+8)+'px'}else{p.style.bottom='';p.style.top=(r.bottom+8)+'px'}
  p.className='qpop glass dyn';anchor.setAttribute('aria-expanded','true');
  p.style.left=Math.max(8,Math.min(innerWidth-p.offsetWidth-8,r.left))+'px';      // keep it inside small windows
  setTimeout(()=>p.focus({preventScroll:true}),0);
}
function closeQpop(){const p=$('#qpop');if(p.classList.contains('hidden'))return;p.classList.add('hidden');const a=document.getElementById(p.dataset.anchor||'');if(a){a.setAttribute('aria-expanded','false');a.focus({preventScroll:true})}}
function toggleMore(force){const m=$('#moreMenu'),open=force??m.hidden;m.hidden=!open;$('#moreBtn').setAttribute('aria-expanded',open);
  if(open){$('#mmDone').setAttribute('aria-checked',st.showDone);$('#mmRm').setAttribute('aria-checked',Theme.reduceMotion);$('#mmEdge').setAttribute('aria-checked',!!st.edgeShown);
    $$('#moreMenu [data-pal]').forEach(b=>b.setAttribute('aria-checked',b.dataset.pal===Sky.palette));m.querySelector('button').focus()}}
function sheet(open){const s=$('#keys');s.hidden=!open;if(open)s.querySelector('button').focus()}
function setSide(hidden){$('#ws').classList.toggle('noside',hidden);$('#ws').classList.remove('forceside');$$('#sideToggle,#sideShow').forEach(b=>b.setAttribute('aria-pressed',hidden));Prefs.set('sideHidden',hidden?true:null)}

/* ---------- interactions ---------- */
document.addEventListener('click',e=>{
  const t=e.target;
  if(t.closest('#qpop'))return;
  if(!t.closest('#moreMenu,#moreBtn'))$('#moreMenu').hidden=true;
  if(!t.closest('#sideQuota,#cwQuota'))closeQpop();
  if(t.closest('#sideQuota')){openQpop($('#sideQuota'));return}
  if(t.closest('#cwQuota')){openQpop($('#cwQuota'));return}
  if(t.closest('#moreBtn')){toggleMore();return}
  const mi=t.closest('#moreMenu [data-m]');if(mi){const k=mi.dataset.m;toggleMore(false);
    if(k==='done'){st.showDone=!st.showDone;render()}
    if(k==='rm'){const on=!Theme.reduceMotion;Theme.setReduceMotion(on);Prefs.set('reduceMotion',on?true:null);Toast.show(tr(Theme.reduceMotion?'t.motionOff':'t.motionOn'),{ms:1800})}
    if(k==='pal'){Sky.setPalette(mi.dataset.pal);Prefs.set('palette',mi.dataset.pal==='pearl'?null:mi.dataset.pal);render()}
    if(k==='keys')sheet(true);
    if(k==='message')Dialogs.message('');
    if(k==='wrap')Dialogs.wrapUp();
    if(k==='connectors')Dialogs.connectors();
    if(k==='compact')native('compact',{value:true}).catch(err=>Toast.show(err.message));
    if(k==='edge')native('edgeVisibility',{value:!st.edgeShown}).catch(err=>Toast.show(err.message));
    return}
  if(t.closest('[data-close-sheet]')||t.id==='keys'){sheet(false);return}
  if(t.closest('#searchBtn')){st.search=!st.search;if(!st.search)st.query='';st.searchFocus=st.search;if(st.scale!=='day'){st.scale='day';st.nav='today'}render();return}
  if(t.closest('#sideToggle')){setSide(true);render();return}
  if(t.closest('#sideShow')){const ws=$('#ws');if(ws.classList.contains('noside'))setSide(false);else ws.classList.toggle('forceside');render();return}
  if(t.closest('#backToday')){st.day=st.today;st.cluster=null;render();return}
  if(t.closest('#backEdge')){native('returnToEdge').catch(err=>Toast.show(err.message));return}
  if(t.closest('#cwExpand')){native('compact',{value:false}).catch(err=>Toast.show(err.message));return}
  if(t.closest('#newProject')){Dialogs.project();return}
  if(t.closest('#newTag')){Dialogs.tag();return}
  const nav=t.closest('[data-nav]');if(nav){const k=nav.dataset.nav;st.cluster=null;st.nav=k;st.proj=null;
    if(k==='today'){st.scale='day';st.day=st.today;st.filter='all'}
    if(k==='plan'){st.scale='3'}
    if(k==='all'){st.scale='week'}
    if(k==='done'){st.scale='day';st.day=st.today;st.filter='done'}
    render();return}
  const tg=t.closest('[data-tag]');if(tg){st.tag=st.tag===tg.dataset.tag?null:tg.dataset.tag;if(st.nav!=='all'){st.scale='day'}st.cluster=null;render();return}
  const pj=t.closest('[data-proj]');if(pj){st.proj=st.proj===pj.dataset.proj?null:pj.dataset.proj;if(st.proj){st.nav='all';st.scale='week'}st.cluster=null;render();return}
  const go=t.closest('[data-goto]');if(go){st.day=+go.dataset.goto;st.scale='day';render();return}
  const sc=t.closest('[data-scale]');if(sc){st.nav='today';st.scale=sc.dataset.scale;st.cluster=null;render();return}
  const wdy=t.closest('.wday');if(wdy){if(wdy.getAttribute('aria-disabled')==='true'){Toast.show(wdy.title,{ms:3000});return}st.scale='day';st.nav='today';st.day=+wdy.dataset.day;st.cluster=null;render();return}
  const ex=t.closest('[data-expand]');if(ex){const k=ex.dataset.expand;if(k==='review'){st.reviewAll=!st.reviewAll;review();$('[data-expand="review"]')?.focus({preventScroll:true});return}
    if(k==='done')st.showDone=!st.showDone;else if(k==='alldone')st.showAllDone=!st.showAllDone;else st.showUntimed=!st.showUntimed;list();$(`[data-expand="${k}"]`)?.focus({preventScroll:true});return}
  const cx=t.closest('[data-cexpand]');if(cx){st.cExpand=st.cExpand||{};st.cExpand[cx.dataset.cexpand]=!st.cExpand[cx.dataset.cexpand];render();return}
  const f=t.closest('[data-f]');if(f){st.nav=f.dataset.f==='done'?'done':'today';st.filter=f.dataset.f;st.cluster=null;render();return}
  const cl=t.closest('[data-clear]');if(cl){const k=cl.dataset.clear;if(k==='all'){st.tag=null;st.proj=null;st.query='';st.only=null;st.range=null;st.filter='all';st.search=false}else if(k==='query'){st.query='';st.search=false}else st[k]=null;render();return}
  const a=t.closest('[data-a]');if(a&&A[a.dataset.a]){A[a.dataset.a](a.dataset.id||undefined);return}
  const m=t.closest('.bm');if(m){st.focus=+m.dataset.c;openCluster(st.cluster===+m.dataset.c?null:+m.dataset.c);return}
  const cz=t.closest('#carryZone');if(cz){if(cz.getAttribute('aria-disabled')==='true'){Toast.show(tr('carry.none'),{ms:1500});return}st.review=!st.review;render();if(st.review)$('#review .check')?.focus({preventScroll:true});return}
  if(t.closest('#prevZone')){st.day-=1;if(st.day<st.today)st.day=st.today;st.cluster=null;render();return}
  if(t.closest('#nextZone')){st.day+=1;st.scale='day';st.cluster=null;render();return}
  const ck=t.closest('.check');if(ck){const r=ck.closest('[data-id]');if(!r||r.classList.contains('completing'))return;const id=r.dataset.id,x=byId(id);if(!x)return;
    if(x.done){A.uncomplete(id);return}
    if(window.Motion&&r.matches('.drow')&&!r.closest('#cw')){Motion.complete(r,ck);return}
    A.complete(id);return}
  if(!t.closest('#cpop')&&st.cluster!=null)openCluster(null);
});
document.addEventListener('dblclick',e=>{const r=e.target.closest('.drow[data-id]');if(r&&!e.target.closest('button'))Dialogs.task(r.dataset.id)});
document.addEventListener('input',e=>{if(e.target.id==='q'){st.query=e.target.value.trim();list();filtersCounts()}});
function filtersCounts(){const n=buckets(constrained(tasks()));$$('#filters [data-f]').forEach(b=>{const k=b.dataset.f;const el=b.querySelector('b');if(el)el.textContent=n[k].length})}
document.addEventListener('mouseover',e=>{const m=e.target.closest('.bm');if(!m||st.cluster!=null||!st.cs)return;const c=st.cs[+m.dataset.c];if(!c)return;$('#dList').classList.add('filtering');$$('#dList .drow').forEach(r=>r.classList.toggle('hl',c.items.some(x=>x.id===r.dataset.id)))});
document.addEventListener('mouseout',e=>{if(e.target.closest('.bm')&&st.cluster==null){$('#dList').classList.remove('filtering');$$('.drow.hl').forEach(r=>r.classList.remove('hl'))}});
// drag on the track to select a time range (snaps to 15 minutes)
let drag=null;
document.addEventListener('pointerdown',e=>{const t=e.target.closest('#track');if(!t)return;const r=t.getBoundingClientRect();const h=x=>Math.max(H0,Math.min(H1,Math.round((H0+(x-r.left)/r.width*(H1-H0))*4)/4));drag={h,a:h(e.clientX)}});
document.addEventListener('pointermove',e=>{if(!drag)return;const b=drag.h(e.clientX);if(Math.abs(b-drag.a)<.25)return;st.range=[Math.min(drag.a,b),Math.max(drag.a,b)];st.cluster=null;band();filters();list()});
document.addEventListener('pointerup',()=>{drag=null});
// keyboard
const typing=()=>{const a=document.activeElement;return a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT'||a.isContentEditable)};
const modalOpen=()=>!!document.querySelector('dialog[open]');
document.addEventListener('keydown',e=>{
  const k=e.key,mod=e.metaKey||e.ctrlKey;
  if(modalOpen())return;
  if(mod&&k.toLowerCase()==='z'&&!e.shiftKey&&!typing()){e.preventDefault();if(!undo())Toast.show(tr('undo.none'),{ms:1500});return}
  if(mod&&k.toLowerCase()==='f'){e.preventDefault();if(st.mode==='compact')return;st.search=true;st.searchFocus=true;st.scale='day';st.nav='today';render();return}
  if(k==='Escape'){
    if(!$('#keys').hidden){sheet(false);$('#moreBtn').focus();return}
    if(!$('#moreMenu').hidden){toggleMore(false);$('#moreBtn').focus();return}
    if(!$('#qpop').classList.contains('hidden')){closeQpop();return}
    if(st.cluster!=null){const i=st.cluster;st.focus=i;st.refocusBand=true;openCluster(null);return}
    if(typing()&&e.target.id==='q'){st.query='';st.search=false;render();$('#searchBtn').focus();return}
    if(st.range||st.only||st.tag||st.proj||st.query||st.filter!=='all'){st.range=null;st.only=null;st.tag=null;st.proj=null;st.query='';st.filter='all';st.search=false;render();return}
    return}
  if(typing()||mod)return;
  const inBand=document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#bw');
  if(k==='ArrowRight'||k==='ArrowLeft'){
    if(e.altKey){st.day=Math.max(st.today,st.day+(k==='ArrowRight'?1:-1));st.scale='day';st.cluster=null;render();e.preventDefault();return}
    if(!inBand||!st.cs||!st.cs.length)return;
    const d=k==='ArrowRight'?1:-1;st.focus=st.focus<0?Math.max(0,st.cs.findIndex(c=>c.a>=st.now)):Math.max(0,Math.min(st.cs.length-1,st.focus+d));band();$('#bw').focus({preventScroll:true});e.preventDefault();return}
  if((k==='Enter'||k===' ')&&inBand&&st.focus>=0){e.preventDefault();openCluster(st.focus);$('#cpop .check')?.focus({preventScroll:true});return}
  if((k==='Enter'||k===' ')&&document.activeElement?.matches('[role=button]:not(button)')){e.preventDefault();document.activeElement.click();return}
  if(st.mode==='compact')return;
  if(k==='t'||k==='T'){st.day=st.today;st.scale='day';st.nav='today';render();st.focus=Math.max(0,st.cs.findIndex(c=>c.a>=st.now));band();$('#bw')?.focus({preventScroll:true});return}
  if(k==='1'||k==='2'||k==='3'){st.nav='today';st.scale={1:'day',2:'3',3:'week'}[k];st.cluster=null;render();return}
  if(k==='/'){e.preventDefault();st.search=true;st.searchFocus=true;st.scale='day';st.nav='today';render();return}
  if(k==='?'){sheet(true);return}
});
let resizeTimer=0;
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{st.silent=true;render();st.silent=false},60)});
window.addEventListener('shishi-theme',()=>{if(window.Shishi&&Shishi.ready)render()});
