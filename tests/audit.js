/* Audit: smallest visible text (≥ 11px), all-caps labels, external requests, CSP violations, console errors and
   failed loads, over the main states in both languages and both appearances. Usage: node tests/audit.js */
const lib=require('./lib');const {open,deliver,sample}=lib;
const STATES=[
  ['today',{}],['today · dark',{dark:true}],['english · 635×420',{lang:'en',w:635,h:420}],
  ['carry-over',{variant:'carry'}],['night',{variant:'night',dark:true}],['empty',{variant:'empty'}],['no quota',{quota:false}],
  ['week',{},p=>p.click('[data-scale="week"]')],['3 days · en',{lang:'en'},p=>p.click('[data-scale="3"]')],
  ['cluster',{},p=>p.evaluate(()=>openCluster(st.cs.findIndex(c=>c.items.length>=4&&c.a>st.now)))],
  ['quota popover',{},p=>p.click('#sideQuota')],['more menu',{},p=>p.click('#moreBtn')],['shortcuts',{},p=>p.keyboard.press('?')],
  ['inbox + burst',{},async p=>{await p.evaluate(()=>Inbox.open());await deliver(p,sample.burst(10))}],
  ['one by one',{},p=>p.evaluate(()=>{Inbox.open();Inbox.startCatchup()})],
  ['capture',{},p=>p.evaluate(()=>Features.openCap('今天下午3点 让 Claude 重构'))],['capture · en',{lang:'en'},p=>p.evaluate(()=>Features.openCap('tomorrow 3pm ask Claude to refactor P1'))],
  ['suggest',{},p=>p.click('[data-fa="suggest"]')],['focus',{},p=>p.click('#focusBtn')],
  ['task details',{},p=>p.evaluate(()=>Dialogs.task(S.tasks.find(x=>!x.done).id))],['message',{lang:'en'},p=>p.evaluate(()=>Dialogs.message(''))],
  ['floating Today',{compact:true,w:356,h:484}],['floating Today · inbox · dark',{compact:true,w:356,h:484,dark:true},p=>p.evaluate(()=>Inbox.open())],
  ['panel · preview',{file:'result-panel.html',w:320,h:96}],
  ['panel · details',{file:'result-panel.html',w:400,h:460},p=>p.click('#rvPeek')],
  ['panel · raw · en · dark',{file:'result-panel.html',w:400,h:620,lang:'en',dark:true},async p=>{await p.click('#rvPeek');await p.click('.rv2-raw')}],
];
(async()=>{
  const b=await lib.launch();let issues=0;
  for(const [name,o,step] of STATES){
    const p=await open(b,o);
    if(step){await step(p);await p.waitForTimeout(500)}
    const r=await p.evaluate(()=>{const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
      while((n=w.nextNode())){const t=n.textContent.trim();if(!t)continue;const e=n.parentElement;const cs=getComputedStyle(e);const rc=e.getBoundingClientRect();
        if(!rc.width||cs.visibility==='hidden'||+cs.opacity===0||e.closest('[hidden],.hidden'))continue;
        if(rc.bottom<0||rc.top>innerHeight||rc.right<0||rc.left>innerWidth)continue;
        const fs=parseFloat(cs.fontSize);if(fs<11)out.push(fs+'px '+t.slice(0,20));
        if(cs.textTransform==='uppercase'||(/^[A-Z]{3,}$/.test(t)&&!/^(CI|PR|QA|AI|SF|UI|MCP|ESC)$/i.test(t)))out.push('CAPS '+t)}
      return [...out,...(window.__csp||[]).map(c=>'CSP '+c)]});
    const all=[...r,...p.errors.map(e=>'error '+e),...p.failed.map(f=>'request '+f)];
    issues+=all.length;console.log(name.padEnd(30),all.length?all.slice(0,6).join(' | '):'ok');
    await p.context().close();
  }
  await b.close();console.log(`\n${issues} issues (${lib.BROWSER})`);process.exit(issues?1:0);
})();
