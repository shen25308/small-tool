/* Screenshots of the real UI (fake host, sample data) for the scenes in the handoff's reference shots.
   Writes tests/shots/*.jpg. Usage: node tests/shoot.js   ·   compare with tests/shots/compare.html */
const path=require('path'),fs=require('fs');
const lib=require('./lib');const {open,deliver,sample}=lib;
const OUT=path.join(__dirname,'shots');
const ws={w:1140,h:800};
const at=h=>({time:sample.at(h)});
const SHOTS=[
  // [file, reference in ../shishi-handoff/prototype/shots, options, step]
  ['band-dense-v2-light','band-dense-v2-light',{...ws}],
  ['band-dense-v2-dark','band-dense-v2-dark',{...ws,dark:true}],
  ['workspace-v2-light','workspace-v2-light',{w:760,h:800}],
  ['band-cluster-open-light','band-cluster-open-light',{...ws},p=>p.evaluate(()=>openCluster(st.cs.findIndex(c=>c.items.length>=4&&c.a>st.now)))],
  ['band-carryover-light','band-carryover-light',{...ws,variant:'carry'}],
  ['band-week-light','band-week-light',{...ws},p=>p.click('[data-scale="week"]')],
  ['band-hero2-light','band-hero2-light',{...ws,variant:'hero'}],
  ['band-hero2-dark','band-hero2-dark',{...ws,variant:'hero',dark:true}],
  ['band-sky-dawn-light','band-sky-dawn-light',{...ws,...at(6.75)}],
  ['band-sky-noon-light','band-sky-noon-light',{...ws,...at(12)}],
  ['band-sky-sunset-light','band-sky-sunset-light',{...ws,...at(16.6)}],
  ['band-sky-night-light','band-sky-night-light',{...ws,...at(22)}],
  ['band-sky-night-dark','band-sky-night-dark',{...ws,...at(22),dark:true}],
  ['quota-light','quota-light',{...ws},p=>p.click('#sideQuota')],
  ['results-burst-light','results-burst-light',{...ws},async p=>{await p.evaluate(()=>Inbox.open());await deliver(p,sample.burst(10))}],
  ['results-burst-dark','results-burst-dark',{...ws,dark:true},async p=>{await p.evaluate(()=>Inbox.open());await deliver(p,sample.burst(10))}],
  ['results-triage-light','results-triage-light',{...ws},p=>p.evaluate(()=>{Inbox.open();const T=Inbox.visible();st.inbox.cur=T[0].key;st.inbox.exp=[T[0].key];T[0].items.forEach(x=>x.unread=false);st.inbox.sel=T.slice(1,3).map(t=>t.key);render()})],
  ['results-catchup-light','results-catchup-light',{...ws},p=>p.evaluate(()=>{Inbox.open();Inbox.startCatchup()})],
  ['capture-quota-light','capture-quota-light',{...ws},p=>p.evaluate(()=>Features.openCap('今天下午3点 让 Claude 重构设置页'))],
  ['suggest-light','suggest-light',{...ws},p=>p.click('[data-fa="suggest"]')],
  ['focus-light','focus-light',{...ws},async p=>{await deliver(p,[]);await p.click('#focusBtn');await deliver(p,sample.burst(4))}],
  ['compact-v2-light','compact-v2-light',{compact:true,w:356,h:484}],
  ['compact-v2-dark','compact-v2-dark',{compact:true,w:356,h:484,dark:true}],
  ['compact-inbox-light','compact-inbox-light',{compact:true,w:382,h:560},p=>p.evaluate(()=>Inbox.open())],
  ['result-v2-light','result-v2-light',{file:'result-panel.html',w:400,h:460},p=>p.click('#rvPeek')],
  ['result-v2-preview-light',null,{file:'result-panel.html',w:320,h:96}],
  ['result-v2-burst-light',null,{file:'result-panel.html',w:320,h:96},p=>p.evaluate(r=>__host.edgeDeliver(r),sample.burst(10,14.75))],
  ['workspace-en-light',null,{w:760,h:800,lang:'en'}],
  ['workspace-en-min-light',null,{w:635,h:420,lang:'en'}],
];
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const b=await lib.launch();
  for(const [name,,o,step] of SHOTS){
    const p=await open(b,{...o,config:{...(o.config||{})}});
    if(step){await step(p);await p.waitForTimeout(700)}
    await p.evaluate(()=>{const t=document.querySelector('.toast');if(t)t.classList.remove('on')});await p.waitForTimeout(250);
    await p.screenshot({path:path.join(OUT,name+'.jpg'),type:'jpeg',quality:80});
    console.log(name,p.errors.length?p.errors:'');
    await p.context().close();
  }
  await b.close();
})();
module.exports={SHOTS};
