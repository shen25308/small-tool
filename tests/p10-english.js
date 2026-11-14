/* English system language, the minimum window size, and the data file: v1 migration, an unreadable file. */
const {open,suite,clean,sample}=require('./lib');
module.exports=async b=>{
  const {res,ok,eq}=suite('p10-english'),t={ok,eq};
  let p=await open(b,{lang:'en'});let E=(f,a)=>p.evaluate(f,a);
  const D=await E(()=>st.today);
  eq(await E(()=>document.documentElement.lang),'en-US','界面语言跟随系统（英文）');
  eq(await p.textContent('#dTitle'),'Today','标题是英文');
  ok((await p.textContent('#dDate')).startsWith('Friday, November 13 · done 9/37'),'日期按英文书写',await p.textContent('#dDate'));
  // every key resolves in both languages, and no Chinese interface copy leaks into English
  const keys=await E(()=>I18n.keys());
  eq(keys.zh.filter(k=>!keys.en.includes(k)),[],'中文表里的每个键英文表都有');
  const missing=keys.en.filter(k=>!keys.zh.includes(k)&&!/^(app\.name|pv\.(codex|claude|grok|grokBuild|ci|other)|q\.why\.local)$/.test(k));
  eq(missing,[],'英文表里的每个键中文表都有（专有名词除外）');
  const chrome=await E(()=>{const own=new Set([...S.tasks.map(x=>x.t),...allTags(),...data.projects]);const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
    while((n=w.nextNode())){const s=n.textContent.trim();if(!s||!n.parentElement.getClientRects().length)continue;if(/[\u3400-\u9fff]/.test(s)&&![...own].some(o=>s.includes(o)||o.includes(s)))out.push(s)}return out});
  eq(chrome,[],'英文界面里只有用户自己的内容是中文');
  ok(await E(()=>[...document.querySelectorAll('[aria-label],[title]')].every(e=>!/^[a-z]+\.[a-zA-Z.]+$/.test(e.getAttribute('aria-label')||'')&&!/^[a-z]+\.[a-zA-Z.]+$/.test(e.title||''))),'没有漏翻成键名的标签');
  // English quick capture
  const cases=[
    ['today send the release checklist',{title:'send the release checklist',day:D,time:null}],
    ['tomorrow at 3pm send weekly report #团队',{title:'send weekly report',day:D+1,time:15,tag:'团队'}],
    ['call the landlord 15:30',{title:'call the landlord',day:D,time:15.5}],
    ['review roadmap tomorrow 9:30am P0',{title:'review roadmap',day:D+1,time:9.5,p:0}],
    ['draft notes P1',{title:'draft notes',day:D,p:1}],
    ['tidy desk p2',{title:'tidy desk',p:2}],
    ['book flights next mon',{title:'book flights',day:D+3}],
    ['dentist fri 10am',{title:'dentist',day:D+7,time:10}],
    ['read docs tonight for 30 min',{title:'read docs',day:D,time:20,dur:.5}],
    ['renew contract Dec 3 !!',{title:'renew contract',day:D+20,p:0}],
    ['learn guitar later',{title:'learn guitar',day:null,time:null}],
    ['submit expenses at 10am',{title:'submit expenses',day:D+1,time:10}],
  ];
  for(const [s,w] of cases){const r=await E(s=>Features.parse(s),s);const got=Object.fromEntries(Object.keys(w).map(k=>[k,r[k]]));eq(got,w,`parse “${s}”`)}
  await p.keyboard.press('n');await p.waitForTimeout(200);await p.keyboard.type('tomorrow at 3pm send weekly report P1');await p.waitForTimeout(120);
  const prev=await p.textContent('#capPrev');ok(prev.includes('Tomorrow')&&prev.includes('15:00'),'英文预览',prev);
  await p.keyboard.press('Enter');await p.waitForTimeout(250);
  eq(await E(()=>{const e=__host.state.workspace.tasks.at(-1);return [e.title,e.planned,e.plannedTime,e.priority]}),['send weekly report','2026-11-14','15:00','P1'],'英文快速添加写进 Workspace');
  ok((await E(()=>Toast.text)).startsWith('Added “send weekly report” · tomorrow'),'英文提示',await E(()=>Toast.text));
  await p.keyboard.press('Meta+z');await p.waitForTimeout(150);
  await p.click('#inboxBtn');await p.waitForTimeout(300);
  ok((await p.textContent('#inbox')).includes('Needs you')&&(await p.textContent('#ibUnread')).includes('3 unread'),'AI 结果抽屉是英文，状态推导不依赖界面语言');
  await p.keyboard.press('Escape');
  await clean(p,t,'英文');
  await p.close();

  // minimum window size 635×420, both languages: no horizontal scrolling, nothing cut off unreachably
  for(const lang of ['en','zh-Hans']){
    p=await open(b,{lang,w:635,h:420});E=(f,a)=>p.evaluate(f,a);
    const m=await E(()=>({doc:document.documentElement.scrollWidth,content:document.querySelector('.content').scrollWidth,cw:document.querySelector('.content').clientWidth,
      scrolls:document.querySelector('.content').scrollHeight>document.querySelector('.content').clientHeight,side:getComputedStyle(document.querySelector('.side')).display,
      tb:document.querySelector('.toolbar').getBoundingClientRect(),labels:[...document.querySelectorAll('.blabel')].map(e=>e.getBoundingClientRect()).every(r=>r.left>=0&&r.right<=innerWidth)}));
    ok(m.doc<=635&&m.content<=m.cw,`${lang} · 635×420 没有横向滚动`,m);
    ok(m.scrolls,`${lang} · 列表可以纵向滚动`);
    ok(m.side==='none'&&m.tb.left>=0&&m.tb.right<=635,`${lang} · 侧栏收起，工具栏完整可见`,m.tb);
    ok(m.labels,`${lang} · 时间带标签都在窗口内`);
    eq(await E(()=>[...document.querySelectorAll('#dList .drow .ttl')].filter(e=>e.getBoundingClientRect().width<40).length),0,`${lang} · 任务标题没有被挤没`);
    await p.click('#sideShow');await p.waitForTimeout(150);
    ok(await E(()=>getComputedStyle(document.querySelector('.side')).display!=='none'),`${lang} · 侧栏可以从工具栏展开`);
    await p.click('[data-nav="plan"]');await p.waitForTimeout(600);
    ok(await E(()=>document.documentElement.scrollWidth<=635&&document.querySelectorAll('.wday').length===3),`${lang} · 计划视图也不横向滚动`);
    await p.click('#inboxBtn');await p.waitForTimeout(300);
    ok(await E(()=>{const r=document.querySelector('#inbox').getBoundingClientRect();return r.left>=0&&r.right<=635&&r.bottom<=420&&r.height>150}),`${lang} · 结果抽屉在窗口内`);
    await clean(p,t,`${lang} · 635×420`);
    await p.close();
  }

  // a version 1 file loads as it is; the first save writes version 2 with the new optional fields
  p=await open(b,{variant:'v1'});E=(f,a)=>p.evaluate(f,a);
  eq(await E(()=>[S.tasks.length,S.tasks.filter(x=>x.time!=null).length,__host.state.workspace.version]),[61,0,1],'v1 文件能直接读：没有计划时间，任务都在「未定时」');
  const first=await p.$eval('#dList .drow:not(.done)[data-id]',r=>r.dataset.id);
  await p.click(`#dList .drow[data-id="${first}"] [data-a="slot"]`,{force:true});await p.waitForTimeout(200);
  ok(await E(id=>{const w=__host.state.workspace,e=w.tasks.find(x=>x.id===id);return w.version===2&&/^\d\d:\d\d$/.test(e.plannedTime)&&w.tasks.length===61&&w.tasks.every(x=>['id','title','project','tag','priority','planned','source','quote'].every(k=>typeof x[k]==='string'))},first),'第一次保存写成 version 2，原有字段一个不少');
  await p.close();
  // an unreadable file: nothing is written
  p=await open(b,{config:{failLoad:true}});E=(f,a)=>p.evaluate(f,a);
  ok(await p.isVisible('#loadError'),'读不到文件时有明确说明');
  await p.keyboard.press('n');await p.waitForTimeout(150);
  ok(await E(()=>(!document.querySelector('#cap')||document.querySelector('#cap').hidden)&&!__host.state.ops.includes('save')),'暂停保存：不会用空列表覆盖文件');
  await p.close();return res;
};
