/* Persona 2 — 阿杰, developer: waits for Codex / Claude results, wants to know when they land and how much quota is left.
   Differences from the prototype suite, because the app only shows what it really knows:
   - a result is drawn at the moment it finished; a start–end bar appears only when the source reports a start time
   - there is no "running" state, so the .live assertions are gone
   - "manage usage" links are gone (no page to open offline); providers with no readable figure say "not provided" */
const {open,suite,check,clean,setNow,deliver,sample}=require('./lib');
module.exports=async b=>{
  const {res,ok,eq}=suite('p2-dev'),t={ok,eq};
  let p=await open(b);
  ok((await p.$$('.blane.point')).length>=1,'14:40 时能在时间带上看到 AI 结果的结束点');
  eq((await p.$$('.blane.live')).length,0,'没有编造的「运行中」状态');
  ok(!!(await p.$('.blegend')),'有 AI 结果图例');
  const titles=await p.$$eval('.blane',x=>x.map(e=>e.title));
  ok(titles.every(s=>/\d\d:\d\d/.test(s)),'每个结果标记悬停都有时间',titles.slice(0,3));
  ok(titles.every(s=>!/\d\d:\d\d–\d\d:\d\d/.test(s)),'没有开始时间的结果不画时间段');
  // a source that does report a start time gets a real bar
  await deliver(p,[{channel:'external',id:'connector/'+'a'.repeat(64),source:'Local AI',title:'整理发布清单',summary:'清单已整理好\n共 12 项。',time:sample.epoch(14.5),started:sample.epoch(13.2),read:false,thread:'',link:'',archived:false,accepted:false}]);
  ok(await p.evaluate(()=>[...document.querySelectorAll('.blane:not(.point)')].some(e=>/13:12–14:30/.test(e.title))),'带开始时间的结果画成 13:12–14:30 的时间段');
  await check(p,t,'带开始时间的结果');
  const n0=(await p.$$('.blane')).length;
  await setNow(p,17);
  ok((await p.$$('.blane')).length>=n0,'17:00 结果标记还在');
  await setNow(p,14+40/60);
  // quota popover: numbers match ring + label
  await p.click('#sideQuota');await p.waitForTimeout(600);
  ok(await p.$eval('#qpop',e=>!e.classList.contains('hidden')),'点侧栏「AI 额度」打开额度弹层');
  eq(await p.getAttribute('#sideQuota','aria-expanded'),'true','触发按钮 aria-expanded=true');
  const vals=await p.$$eval('#qpop .qr .v',x=>x.map(e=>e.textContent).filter(s=>/剩余 \d+%/.test(s)).map(s=>+s.match(/\d+/)[0]));
  const label=await p.textContent('#sideQuota .sq-r');
  eq(Math.min(...vals)+'%',label.match(/\d+%/)[0],'弹层里最低的剩余 = 侧栏标签');
  const box=await p.$eval('#qpop',e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]});
  ok(box[0]>=0&&box[1]>=0&&box[2]<=1140&&box[3]<=800,'弹层完整在窗口内',box);
  const pop=await p.textContent('#qpop');
  ok(/Grok Build[\s\S]*未提供 · 仅在 \/usage 显示/.test(pop),'读不到的额度写「未提供」并说明原因');
  ok(pop.includes('提取 6 条 · 3.2 秒'),'本地 Qwen 显示上次运行');
  await check(p,t,'额度弹层');
  await p.keyboard.press('Escape');await p.waitForTimeout(300);
  ok(await p.$eval('#qpop',e=>e.classList.contains('hidden')),'Esc 关闭额度弹层');
  eq(await p.evaluate(()=>document.activeElement.id),'sideQuota','关闭后焦点回到触发按钮');
  // what the real host reports today: nothing readable, so nothing is invented
  await p.close();p=await open(b,{quota:false});
  eq(await p.textContent('#sideQuota .sq-r'),'未提供','本机读不到额度时侧栏写「未提供」');
  eq(await p.$$eval('#sideQuota [data-ring] circle',x=>x.length),1,'额度环只画虚线轨道，不画数值');
  eq((await p.$$('.bq')).length,0,'没有额度数据时时间带上没有重置标记');
  await p.click('#sideQuota');await p.waitForTimeout(500);
  const none=await p.textContent('#qpop');
  ok(!/\d+%/.test(none)&&(none.match(/未提供/g)||[]).length>=3,'弹层里没有任何编造的百分比',none.replace(/\s+/g,' ').slice(0,120));
  await p.keyboard.press('Escape');
  await check(p,t,'没有额度数据');
  // workspace and floating Today are the same store: switch between them and compare
  await p.close();p=await open(b,{variant:'hero'});
  await check(p,t,'16:38 工作区');
  await p.evaluate(()=>__host.setCompact(true));await p.waitForTimeout(250);
  await check(p,t,'切到浮动今日');
  const id=await p.$eval('#cList .drow:not(.done)[data-id]',r=>r.dataset.id);
  await p.click(`#cList .drow[data-id="${id}"] .check`);await p.waitForTimeout(400);
  eq(await p.evaluate(id=>byId(id).done,id),1,'在浮动今日里完成');
  await check(p,t,'浮动今日完成后');
  await p.click('#cwExpand');await p.waitForTimeout(300);
  ok(await p.evaluate(()=>st.mode==='dense'&&!document.querySelector('#ws').hidden),'展开按钮回到工作区');
  await check(p,t,'回到工作区后两边一致');
  // compact quota ring opens the same popover
  await p.close();p=await open(b,{compact:true,w:356,h:484});
  await check(p,t,'浮动今日');
  await p.click('#cwQuota');await p.waitForTimeout(600);
  ok(await p.$eval('#qpop',e=>!e.classList.contains('hidden')),'浮动窗的额度环也能打开弹层');
  ok(await p.$eval('#qpop',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}),'弹层在 356×484 的窗口内');
  await p.keyboard.press('Escape');await p.waitForTimeout(200);
  // compact expanders are real
  const exp=await p.$$('#cList [data-cexpand]');ok(exp.length>=1,'浮动窗有「还有 N 项」展开');
  const c0=await p.$$eval('#cList .drow',x=>x.length);await p.click('#cList [data-cexpand]');await p.waitForTimeout(100);
  ok(await p.$$eval('#cList .drow',x=>x.length)>c0,'点「还有 N 项」能展开');
  await clean(p,t,'浮动今日');
  await p.close();return res;
};
