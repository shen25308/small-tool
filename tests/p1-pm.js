/* Persona 1 — 林姐, product manager, 37 tasks, opens the app at 09:30 and again after lunch. */
const {open,suite,check,clean,toast,setNow,sample}=require('./lib');
module.exports=async b=>{
  const {res,ok,eq}=suite('p1-pm'),t={ok,eq};
  let p=await open(b,{time:sample.at(9.5)});
  await clean(p,t,'主窗口');
  await check(p,t,'09:30 初始');
  const s0=await p.evaluate(()=>({over:buckets(tasks()).over.length,next:buckets(tasks()).next.length}));
  ok(s0.over>=1,'09:30 已有逾期（9:15 合并 PR 未完成）',s0);
  // complete the first open row with the full motion path
  const first=await p.$eval('#dList .drow:not(.done)[data-id]',r=>({id:r.dataset.id,t:r.querySelector('.ttl').textContent}));
  const before=await p.evaluate(()=>tasks().filter(x=>x.done).length);
  await p.click(`#dList .drow[data-id="${first.id}"] .check`);
  await p.waitForTimeout(1700);
  eq(await p.evaluate(()=>tasks().filter(x=>x.done).length),before+1,'完成一项后 store 已完成 +1');
  ok((await toast(p)).includes('已完成'),'完成后出现「已完成…」提示',await toast(p));
  ok(await p.$('.toast.on [data-undo]')!==null,'提示里有「撤销」按钮');
  ok(await p.evaluate(id=>{const e=__host.state.workspace.tasks.find(x=>x.id===id);return e.done===true&&!Number.isNaN(Date.parse(e.completedAt))},first.id),'完成写进了 Workspace（done + completedAt）');
  await check(p,t,'完成后（头部/芯片/星星/侧栏）');
  ok(!(await p.$(`#dList .drow[data-id="${first.id}"]:not(.done)`)),'完成的任务离开待办列表');
  await p.click('.toast [data-undo]');await p.waitForTimeout(200);
  eq(await p.evaluate(()=>tasks().filter(x=>x.done).length),before,'点「撤销」后恢复');
  ok(await p.evaluate(id=>{const e=__host.state.workspace.tasks.find(x=>x.id===id);return e.done===false&&e.completedAt===undefined},first.id),'撤销也写回 Workspace');
  await check(p,t,'撤销后');
  // ⌘Z path
  await p.click(`#dList .drow[data-id="${first.id}"] .check`);await p.waitForTimeout(1700);
  await p.keyboard.press('Control+z');await p.waitForTimeout(200);
  eq(await p.evaluate(()=>tasks().filter(x=>x.done).length),before,'⌘Z/Ctrl+Z 撤销完成');
  // double-click on a checkbox must not complete twice / two toasts
  const id2=await p.$eval('#dList .drow:not(.done)[data-id]',r=>r.dataset.id);
  await p.click(`#dList .drow[data-id="${id2}"] .check`);await p.click(`#dList .drow[data-id="${id2}"] .check`,{force:true}).catch(()=>{});await p.waitForTimeout(1800);
  eq(await p.evaluate(()=>undoStack.length),1,'快速连点同一个勾选框只记一次');
  await p.keyboard.press('Control+z');await p.waitForTimeout(150);
  // un-complete a done task from the expanded done section
  await p.click('[data-expand="done"]');await p.waitForTimeout(100);
  const d1=await p.$eval('#dList .drow.done[data-id]',r=>r.dataset.id);
  await p.click(`#dList .drow[data-id="${d1}"] .check`);await p.waitForTimeout(200);
  eq(await p.evaluate(id=>byId(id).done,d1),0,'在展开的已完成里取消勾选可恢复');
  await check(p,t,'取消完成后');
  await p.keyboard.press('Control+z');await p.waitForTimeout(150);

  // after lunch: 14:40
  await p.close();p=await open(b);
  const D=await p.evaluate(()=>st.today);
  await check(p,t,'14:40 初始');
  // row action: defer to tomorrow
  const r=await p.$eval('#dList .drow:not(.done)[data-id]',r=>r.dataset.id);
  const nz0=+(await p.textContent('#nextZone b'));
  await p.hover(`#dList .drow[data-id="${r}"]`);await p.click(`#dList .drow[data-id="${r}"] [data-a="defer"]`);await p.waitForTimeout(150);
  eq(await p.evaluate(id=>byId(id).day,r),D+1,'「推迟」把任务移到明天');
  eq(+(await p.textContent('#nextZone b')),nz0+1,'右侧「明天」计数 +1');
  ok(!(await p.$(`#dList .drow[data-id="${r}"]`)),'推迟的任务从今天消失');
  ok((await toast(p)).includes('推迟'),'推迟有提示',await toast(p));
  eq(await p.evaluate(id=>__host.state.workspace.tasks.find(x=>x.id===id).deferCount,r),1,'推迟次数写进 Workspace（deferCount）');
  await check(p,t,'推迟后');
  await p.click('#nextZone');await p.waitForTimeout(150);
  ok(!!(await p.$(`#dList .drow[data-id="${r}"]`)),'在明天的日视图里能看到它');
  eq(await p.textContent('#dTitle'),'明天','点「明天」进入明天的日视图');
  await check(p,t,'明天视图');
  await p.click('#backToday');await p.waitForTimeout(100);
  eq(await p.textContent('#dTitle'),'今天','「回到今天」');
  await p.keyboard.press('Control+z');await p.waitForTimeout(150);
  eq(await p.evaluate(id=>byId(id).day,r),D,'撤销推迟');

  // cluster: open, list only these, shift 30 min, undo
  const ci=await p.evaluate(()=>st.cs.findIndex(c=>c.items.length>=4&&c.a>st.now));
  ok(ci>=0,'有 ≥4 项的簇');
  await p.click(`.bm[data-c="${ci}"]`);await p.waitForTimeout(700);
  const n=+(await p.textContent(`.bm[data-c="${ci}"]`));
  eq(await p.$$eval('#cpop .pr',x=>x.length),n,'簇弹层的条目数 = 标记上的数字');
  const ids=await p.$$eval('#cpop .pr',x=>x.map(e=>e.dataset.id));
  await p.click('#cpop [data-a="only"]');await p.waitForTimeout(700);
  eq((await p.$$eval('#dList .drow[data-id]',x=>x.map(e=>e.dataset.id))).sort(),[...ids].sort(),'「在列表中只看这些」只显示这几项');
  ok(!!(await p.$('#filters [data-clear="only"]')),'出现「只看这 N 项」筛选芯片');
  await check(p,t,'只看簇');
  await p.click('#filters [data-clear="only"]');await p.waitForTimeout(150);
  ok(!(await p.$('#filters [data-clear="only"]')),'芯片可清除');
  await p.click(`.bm[data-c="${ci}"]`);await p.waitForTimeout(700);
  const times0=await p.evaluate(ids=>ids.map(i=>byId(i).time),ids);
  await p.click('#cpop [data-a="shift30"]');await p.waitForTimeout(700);
  eq(await p.evaluate(ids=>ids.map(i=>byId(i).time),ids),times0.map(x=>x+.5),'「整体推迟 30 分钟」');
  ok(await p.$eval('#cpop',e=>e.classList.contains('hidden')),'推迟后弹层关闭');
  await check(p,t,'簇推迟后');
  await p.keyboard.press('Control+z');await p.waitForTimeout(150);
  eq(await p.evaluate(ids=>ids.map(i=>byId(i).time),ids),times0,'撤销整体推迟');
  // complete from inside the cluster popover
  await p.click(`.bm[data-c="${ci}"]`);await p.waitForTimeout(700);
  await p.click('#cpop .pr .check');await p.waitForTimeout(300);
  eq(await p.evaluate(id=>byId(id).done,ids[0]),1,'在簇弹层里也能完成');
  await check(p,t,'弹层内完成后');
  await p.keyboard.press('Control+z');await p.waitForTimeout(150);

  // filters compose: tag + chip + range, and clear
  await p.click('#sideTags [data-tag="发布"]');await p.waitForTimeout(150);
  await p.click('#filters [data-f="next"]');await p.waitForTimeout(150);
  const now=await p.evaluate(()=>st.now);const rows=await p.evaluate(()=>[...document.querySelectorAll('#dList .drow[data-id]')].map(r=>byId(r.dataset.id)));
  ok(rows.length>0&&rows.every(x=>x.tag==='发布'&&!x.done&&x.time>=now),'标签「发布」+「接下来」组合筛选正确',rows.map(x=>x.t));
  eq(+(await p.textContent('#filters [data-f="next"] b')),rows.length,'芯片数字是组合后的数量');
  await check(p,t,'组合筛选');
  const track=await p.$('#track');const bb=await track.boundingBox();
  await p.mouse.move(bb.x+bb.width*.55,bb.y+10);await p.mouse.down();await p.mouse.move(bb.x+bb.width*.68,bb.y+10,{steps:6});await p.mouse.up();await p.waitForTimeout(150);
  ok(!!(await p.$('#filters [data-clear="range"]')),'拖动时间带出现时间段芯片');
  const rr=await p.evaluate(()=>[...document.querySelectorAll('#dList .drow[data-id]')].map(r=>({...byId(r.dataset.id),R:st.range})));
  ok(rr.length>0&&rr.every(x=>x.tag==='发布'&&x.time>=x.R[0]&&x.time<=x.R[1]),'时间段与标签叠加');
  await check(p,t,'三重筛选');
  await p.keyboard.press('Escape');await p.waitForTimeout(150);
  ok(await p.evaluate(()=>!st.tag&&!st.range&&st.filter==='all'),'Esc 一次清除全部筛选');
  await check(p,t,'清除筛选后');
  // project filter (real projects, not tags): opens every open task of the project, across days
  await p.click('#sideProjects [data-proj="团队"]');await p.waitForTimeout(700);
  ok(await p.evaluate(()=>{const rows=[...document.querySelectorAll('#dList .drow[data-id]')].map(r=>byId(r.dataset.id));return rows.length===S.tasks.filter(x=>!x.done&&x.proj==='团队').length&&rows.every(x=>x.proj==='团队')}),'点项目：列出这个项目全部未完成的任务');
  ok(!!(await p.$('#filters [data-clear="proj"]')),'项目筛选有可清除的芯片');
  await p.click('#filters [data-clear="proj"]');await p.click('[data-nav="today"]');await p.waitForTimeout(400);

  // overdue flips as time passes
  const over0=await p.evaluate(()=>buckets(tasks()).over.length);
  await setNow(p,15+5/60);await p.waitForTimeout(100);
  const over1=await p.evaluate(()=>buckets(tasks()).over.length);
  ok(over1>over0,'15:05 时 15:00 的任务变成逾期',{over0,over1});
  ok(await p.evaluate(()=>[...document.querySelectorAll('#dList .drow')].some(r=>r.textContent.includes('1:1 准备')&&r.querySelector('.tcol.over'))),'1:1 准备 的时间变红');
  await check(p,t,'15:05');
  // deadline is separate from the plan: 16:00 planned, due 17:00
  ok(await p.evaluate(()=>{const r=[...document.querySelectorAll('#dList .drow')].find(r=>r.textContent.includes('发送发布检查清单'));const d=r&&r.querySelector('.due');return d&&d.textContent.includes('17:00')&&!d.classList.contains('over')&&document.querySelectorAll('.bdue').length===1}),'截止时间单独显示（行上「截止 17:00」+ 时间带标记），未到点不变红');
  await setNow(p,17+10/60);
  ok(await p.evaluate(()=>!!document.querySelector('.drow .due.over')&&!!document.querySelector('.bdue.over')),'过了截止时间才变红');
  await setNow(p,15+5/60);
  // 全部顺延到今晚
  await p.click('[data-a="evening"]');await p.waitForTimeout(150);
  eq(await p.evaluate(()=>buckets(tasks()).over.length),0,'「全部顺延到今晚」后没有逾期');
  ok(await p.evaluate(()=>tasks().filter(x=>!x.done&&x.time!=null).every(x=>x.time>=st.now)),'顺延后时间都在现在之后');
  ok(await p.evaluate(()=>{const ts=tasks().filter(x=>!x.done&&x.time>=19).map(x=>x.time);return new Set(ts).size>=ts.length-3}),'顺延时尽量错开，不全挤在同一刻');
  await check(p,t,'顺延后');
  await p.keyboard.press('Control+z');await p.waitForTimeout(150);
  eq(await p.evaluate(()=>buckets(tasks()).over.length),over1,'撤销顺延');
  // 安排时间… (untimed into free slots)
  const un0=await p.evaluate(()=>buckets(tasks()).un.length);
  await p.click('[data-a="slotall"]');await p.waitForTimeout(150);
  const un1=await p.evaluate(()=>buckets(tasks()).un.length);
  ok(un1<un0,'「安排时间…」把未定时排进空档',{un0,un1});
  ok((await toast(p)).includes('排进'),'有结果提示（含放不下的数量）',await toast(p));
  await check(p,t,'安排时间后');
  await clean(p,t,'结束时');
  await p.close();return res;
};
