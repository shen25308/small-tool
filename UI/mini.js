'use strict';
/* Shared pieces: provider glyphs, the mini sky band (floating Today), quota, and the toast with undo. */
const PV={codex:{icon:'pv-codex'},claude:{icon:'pv-claude'},grok:{icon:'pv-grok'},qwen:{icon:'pv-qwen'},ci:{icon:'pv-ci'},
  mail:{icon:'pv-mail'},bell:{icon:'pv-bell'},other:{icon:'sparkles'}};
// Which glyph a source gets. The source text itself is user or connector data and is shown as written.
const pvOf=l=>{l=String(l||'');return /^codex|chatgpt|openai/i.test(l)?'codex':/claude/i.test(l)?'claude':/grok|xai/i.test(l)?'grok':/qwen|local ai/i.test(l)?'qwen'
  :/github|actions/i.test(l)?'ci':/gmail|outlook|mail/i.test(l)?'mail':/remind/i.test(l)?'bell':'other'};
const pvName=(k,source)=>k==='other'||k==='mail'?(source||tr('pv.'+k)):tr('pv.'+k);
const pvGlyph=(k,cls='')=>`<svg class="pv ${cls}" aria-hidden="true"><use href="#${PV[k].icon}"/></svg>`;
const pvTile=(k,cls='',source='')=>`<span class="pvtile ${cls}" title="${esc(pvName(k,source))}" aria-label="${esc(pvName(k,source))}">${pvGlyph(k)}</span>`;

const MiniBand={
  /* opts: now, tasks [{h,done,over}], runs [{a,b}], labels (bool), H0, H1, size 'sm'|'md' */
  render(el,o){
    const H0=o.H0??6,H1=o.H1??24,dark=isDark();
    const W=o.W||el.clientWidth||300,X=h=>(h-H0)/(H1-H0)*W,now=o.now,sky=Sky.at(now,dark);
    const th=o.size==='sm'?14:18,ty=o.arc===false?2:20;
    const stops=[];for(let h=H0;h<=H1;h+=1.5){const s=Sky.at(h,dark);let c=Sky.mix(s.top,s.bottom,.45);if(!dark)c=Sky.mix(c,'#ffffff',h>Sky.SET+.5||h<Sky.RISE?.42:.12);stops.push(`${c} ${((h-H0)/(H1-H0)*100).toFixed(1)}%`)}
    let s='';
    if(o.arc!==false){
      const arc=(x0,x1,peak)=>`M${x0} 18 Q ${(x0+x1)/2} ${2*peak-18} ${x1} 18`;
      s+=`<svg class="mb-arc" viewBox="0 0 ${W} 18" style="width:${W}px"><path d="${arc(X(Sky.RISE),X(Sky.SET),1)}" class="${sky.day?'on':''}"/><path d="${arc(X(Sky.SET),Math.min(W,X(Sky.SET+10)),5)}" class="moon ${!sky.day?'on':''}"/></svg>`;
      if(sky.day)s+=`<span class="mb-sun" style="left:${X(now)}px;top:${18-15*sky.alt}px"></span>`;
      else s+=`<span class="mb-moon" style="left:${X(now)}px;top:${18-12*Math.sin(Math.PI*Math.min(1,Math.max(0,(now-Sky.SET)/10)))}px"><svg class="i fill"><use href="#moon"/></svg></span>`;
    }
    s+=`<div class="mb-track" style="top:${ty}px;height:${th}px;background:linear-gradient(90deg,${stops.join(',')})"><i class="mb-past" style="width:${X(now)}px"></i>`;
    (o.runs||[]).forEach(r=>{const a=X(r.a),b=X(Math.min(r.b,now));if(b>a)s+=`<i class="mb-run" style="left:${a}px;width:${b-a}px"></i>`});
    s+=`</div>`;
    // markers with clustering (done tasks become small stars)
    const pts=(o.tasks||[]).filter(t=>t.h!=null).map(t=>({...t,x:X(t.h)})).sort((a,b)=>a.x-b.x);
    const open=pts.filter(p=>!p.done),cs=[];open.forEach(p=>{const c=cs[cs.length-1];if(c&&p.x-c.x1<(o.size==='sm'?9:11)){c.items.push(p);c.x1=p.x}else cs.push({x0:p.x,x1:p.x,items:[p]})});
    const my=ty+th/2;
    {let last=-99;pts.filter(p=>p.done).forEach(p=>{if(p.x-last<12)return;last=p.x;s+=`<svg class="mb-star" style="left:${p.x}px;top:${my}px"><use href="#star4"/></svg>`})}
    cs.forEach(c=>{const x=(c.x0+c.x1)/2,over=c.items.some(i=>i.over);
      s+=c.items.length===1?`<span class="mb-dot${over?' over':''}" style="left:${x}px;top:${my}px"></span>`:`<span class="mb-cl${over?' over':''}" style="left:${x}px;top:${my}px">${c.items.length}</span>`});
    s+=`<span class="mb-now" style="left:${X(now)}px;top:${o.arc===false?0:6}px;height:${ty+th+3-(o.arc===false?0:6)}px"></span>`;
    if(o.labels!==false){s+=`<div class="mb-hours" style="top:${ty+th+3}px">`+[9,12,15,18,21].filter(h=>h>H0&&h<H1).map(h=>`<span style="left:${X(h)}px"${Math.abs(X(h)-X(now))<14?' class="near"':''}>${h}</span>`).join('')+`</div>`}
    el.classList.add('miniband');el.style.setProperty('--sky-accent',sky.accent);el.style.height=(ty+th+(o.labels!==false?18:4))+'px';
    el.innerHTML=s;
  }
};

/* ---------- Quota: one source for the ring, the label, the popover and the capture hint ----------
   The host reports only what this Mac can read. A provider with no readable figure is listed as "not provided".
   QUOTA rows: {pv, name, plan, win:[[label, percentLeft|null, text, resetHourToday|null]], extra:[[k,v]]} */
let QUOTA=[];
const Quota={
  updated:null,
  set(report){
    const rows=report&&Array.isArray(report.providers)?report.providers:[];
    Quota.updated=report&&report.updatedAt?report.updatedAt:null;
    QUOTA=rows.filter(p=>p&&PV[p.id]).map(p=>{
      const win=(p.windows||[]).filter(w=>w&&w.kind).map(w=>{
        const v=typeof w.leftPercent==='number'?Math.max(0,Math.min(100,Math.round(w.leftPercent))):null;
        let text='',hour=null;
        if(w.resetsAt){const d=new Date(w.resetsAt*1000),h=nowHours(d);
          if(dayNum(d)===st.today){text=tr('q.resetAt',fmt(h));hour=h}else text=`${dayShort(dayNum(d))} ${fmt(h)}`}
        return [tr('q.win.'+w.kind),v,text,hour];
      });
      const extra=[];
      if(p.id==='qwen'){
        if(p.lastRun)extra.push([tr('q.lastRun'),tr('q.lastRunValue',p.lastRun.count,(+p.lastRun.seconds).toFixed(1))]);
        extra.push([tr('q.state'),tr(p.available===false?'q.modelMissing':'q.offline')]);
      }
      return {pv:p.id,name:tr(p.id==='grok'?'pv.grokBuild':'pv.'+p.id),plan:p.id==='qwen'?tr('q.localPlan'):p.plan?tr('q.planName',p.plan):'',
        win,why:win.some(w=>w[1]!=null)||p.id==='qwen'?'':tr('q.why.'+(p.status||'unknown')),credits:p.credits||'',extra};
    });
  },
  /* the tightest known window drives every ring and label; null when nothing is readable */
  tightest(){let best=null;QUOTA.forEach(q=>q.win.forEach(([k,v,r])=>{if(v!=null&&(!best||v<best.v))best={name:q.name,k,v,r}}));return best},
  of:pv=>QUOTA.find(q=>q.pv===pv)||null,
  lvl:v=>v==null?'none':v<10?'crit':v<25?'warn':'',
  ring(v,{track='var(--fill2)'}={}){const C=2*Math.PI*14;
    if(v==null)return `<circle cx="18" cy="18" r="14" fill="none" stroke-dasharray="3 4" style="stroke:var(--label3)"/>`;
    const col=v<10?'var(--red)':v<25?'var(--warn)':'var(--label2)';
    return `<circle cx="18" cy="18" r="14" fill="none" style="stroke:${track}"/><circle cx="18" cy="18" r="14" fill="none" transform="rotate(-90 18 18)" style="stroke:${col}" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-v/100)}"/>`},
  cards(){const L=Quota.lvl;return QUOTA.map(q=>`<section class="qsec">
    <div class="qh">${pvTile(q.pv,'sm')}${esc(q.name)}</div>
    ${q.plan?`<div class="qr"><span class="k">${tr('q.source')}</span><span class="v">${esc(q.plan)}</span></div>`:''}
    ${q.win.map(([k,v,r])=>v==null
      ?`<div class="qr"><span class="k">${tr('q.limitOf',k)}</span><span class="v unk">${tr('q.none')}</span></div>`
      :`<div class="qr" data-q="${esc(q.name)}|${esc(k)}"><span class="k">${k}</span><span class="bar ${L(v)}"><i style="width:${v}%"></i></span><span class="v ${L(v)}">${tr('q.left',v)}</span><span class="rs">${esc(r)}</span></div>`).join('')}
    ${q.why?`<div class="qr"><span class="k">${tr('q.limit')}</span><span class="v unk">${tr('q.none')} · ${q.why}</span></div>`:''}
    ${q.credits?`<div class="qr"><span class="k">${tr('q.credits')}</span><span class="v">${esc(q.credits)}</span></div>`:''}
    ${q.extra.map(([k,v])=>`<div class="qr"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}
  </section>`).join('')}
};

/* ---------- Toast with undo. Toast.show(text, {undo, action:{label,fn}, ms}). The text is never parsed as HTML. ---------- */
const Toast=(()=>{
  let el=null,timer=null,undoFn=null,actFn=null;
  function ensure(){if(el)return el;el=document.createElement('div');el.className='toast glass';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target.closest('[data-tact]')){const f=actFn;hide();f&&f()}else if(e.target.closest('[data-undo]')){const f=undoFn;hide();f&&f()}else if(e.target.closest('[data-tclose]'))hide()});return el}
  function hide(){if(!el)return;el.classList.remove('on');undoFn=null;clearTimeout(timer)}
  function show(msg,o={}){ensure();undoFn=o.undo||null;actFn=o.action?o.action.fn:null;clearTimeout(timer);
    el.innerHTML=`<span class="tm"></span>${o.action?`<button class="tu" data-tact>${esc(o.action.label)}</button>`:''}${o.undo?`<button class="tu" data-undo>${tr('undo')} <kbd>⌘Z</kbd></button>`:''}<button class="tx" data-tclose aria-label="${tr('toast.close')}">×</button>`;
    el.querySelector('.tm').textContent=msg;
    el.classList.remove('on');void el.offsetWidth;el.classList.add('on');
    timer=setTimeout(hide,o.ms||5000)}
  return {show,hide,get text(){return el&&el.classList.contains('on')?el.querySelector('.tm').textContent:''},get canUndo(){return !!undoFn},undo(){if(undoFn){const f=undoFn;hide();f();return true}return false}};
})();
