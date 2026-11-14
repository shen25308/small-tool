/* "No dead buttons": click every visible control in a fresh page; something must change (DOM, toast, a message to the host)
   or it must look disabled. */
const {open,suite,deliver,sample}=require('./lib');
const STATES=[
  ['主窗口',b=>open(b)],
  ['第二天早上',b=>open(b,{variant:'carry'})],
  ['周视图',async b=>{const p=await open(b);await p.click('[data-scale="week"]');await p.waitForTimeout(700);return p}],
  ['浮动今日',b=>open(b,{compact:true,w:356,h:484})],
  ['空状态',b=>open(b,{variant:'empty'})],
  ['结果抽屉 + 10 条同时到达',async b=>{const p=await open(b);await p.evaluate(()=>Inbox.open());await deliver(p,sample.burst(10));return p}],
  ['逐条处理',async b=>{const p=await open(b);await p.evaluate(()=>{Inbox.open();Inbox.startCatchup()});await p.waitForTimeout(200);return p}],
  ['更多菜单',async b=>{const p=await open(b);await p.click('#moreBtn');await p.waitForTimeout(150);return p}],
  ['任务详情',async b=>{const p=await open(b);await p.evaluate(()=>Dialogs.task(S.tasks.find(x=>!x.done).id));await p.waitForTimeout(200);return p}],
  ['英文 · 635×420',b=>open(b,{lang:'en',w:635,h:420})],
  ['结果面板 · 预览',b=>open(b,{file:'result-panel.html',w:320,h:96})],
  ['结果面板 · 详情',async b=>{const p=await open(b,{file:'result-panel.html',w:400,h:460});await p.click('#rvPeek');await p.waitForTimeout(150);return p}],
];
const SEL='button,a[href],[role=button],[role=checkbox],[role=tab],.collapsed-row,.act';
module.exports=async b=>{
  const {res,ok}=suite('deadclick');
  for(const [name,make] of STATES){
    let p=await make(b),fresh=true;
    const LIST=`(sel=>[...document.querySelectorAll(sel)].filter(e=>{if(!e.getClientRects().length)return false;for(let a=e.parentElement;a;a=a.parentElement){const cs=getComputedStyle(a);if(cs.overflow!=='visible'&&a.getBoundingClientRect().height<2)return false}const r=e.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)return true;
      const h=document.elementFromPoint(Math.min(innerWidth-1,Math.max(0,r.left+r.width/2)),Math.min(innerHeight-1,Math.max(0,r.top+r.height/2)));return h&&(h===e||e.contains(h)||h.contains(e))}))`;
    const n=await p.evaluate(`${LIST}(${JSON.stringify(SEL)}).length`);
    const dead=[];let tested=0;
    for(let i=0;i<n;i++){
      if(!fresh){await p.close();p=await make(b);fresh=true}
      const info=await p.evaluate(`(${(([sel,i,L])=>{const els=L(sel);const e=els[i];if(!e)return null;
        e.setAttribute('data-dc','1');const dis=e.disabled||e.getAttribute('aria-disabled')==='true';
        const cur=e.getAttribute('aria-current')==='page'||e.getAttribute('aria-selected')==='true'&&e.getAttribute('role')==='tab';
        document.querySelectorAll('[data-dc]').forEach(x=>x!==e&&x.removeAttribute('data-dc'));
        return {dis,cur,label:(e.getAttribute('aria-label')||e.textContent||e.className).trim().replace(/\s+/g,' ').slice(0,30)}}).toString()})([${JSON.stringify(SEL)},${i},${LIST}])`);
      if(!info)continue;
      if(info.dis||info.cur){tested++;continue}
      // a control below the fold counts only if it is still reachable once scrolled into view (not under the open drawer)
      const covered=await p.evaluate(()=>{const e=document.querySelector('[data-dc]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();
        const h=document.elementFromPoint(Math.min(innerWidth-1,Math.max(0,r.left+r.width/2)),Math.min(innerHeight-1,Math.max(0,r.top+r.height/2)));return !(h&&(h===e||e.contains(h)||h.contains(e)))});
      if(covered){tested++;continue}
      // what the user can perceive, plus what the host was told (opening a session or a link changes nothing in the page)
      const sig=()=>p.evaluate(()=>document.body.innerHTML.length+':'+[...document.body.innerHTML].reduce((h,c)=>(h*31+c.charCodeAt(0))|0,0)+':'+document.documentElement.className+':'+(window.Toast?Toast.text:'')+':'+
        __host.state.ops.length+':'+__host.state.edgeOps.length+':'+(document.activeElement&&document.activeElement.id)+':'+[...document.querySelectorAll('dialog')].map(d=>d.open).join());
      const s0=await sig();
      const el=await p.$('[data-dc]');await el.hover().catch(()=>{});
      await el.click({force:true,timeout:2000}).catch(()=>{});await p.waitForTimeout(180);
      const s1=await sig().catch(()=>'navigated');tested++;
      if(s0===s1)dead.push(info.label);else fresh=false;
    }
    ok(dead.length===0,`${name} · ${tested} 个控件都有反应`,dead.length?dead:undefined);
    ok(p.errors.length===0,`${name} · 没有脚本错误`,p.errors);
    await p.close();
  }
  return res;
};
