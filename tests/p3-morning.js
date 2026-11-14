/* Persona 3 — 小周, returning next morning (Sat 08:10) with unfinished work from Fri and Wed. */
const {open,suite,check,clean,toast}=require('./lib');
module.exports=async b=>{
  const {res,ok,eq}=suite('p3-morning'),t={ok,eq};
  let p=await open(b,{variant:'carry'});
  const D=await p.evaluate(()=>st.today);                    // Saturday
  const c=await p.evaluate(()=>carry().length);
  eq(c,6,'遗留 6 项（周五 5 + 周三 1）');
  eq(+(await p.textContent('#carryZone b')),6,'时间带左侧「遗留」= 6');
  ok(!!(await p.$('.review')),'当天第一次打开时自动出现遗留整理');
  eq(await p.evaluate(()=>__host.state.prefs.reviewDay),'2026-11-14','“今天已经提醒过”记在偏好里（不依赖 localStorage）');
  eq(await p.$$eval('.review .rv',x=>x.length),6,'晨间整理列表 6 行');
  ok((await p.textContent('.review .rh b')).includes('6'),'标题里的数字 = 6');
  ok((await p.textContent('.review .rh b')).startsWith('早上好'),'早上 5–11 点才说「早上好」');
  ok(await p.evaluate(()=>[...document.querySelectorAll('.review .from')].some(e=>e.textContent.startsWith('昨天'))&&[...document.querySelectorAll('.review .from')].some(e=>e.textContent.startsWith('周三'))),'来源写「昨天 9:15」「周三 · 未定时」');
  ok(await p.evaluate(()=>dayList(st.today).every(x=>x.day===st.today)),'遗留任务没有自动堆进今天');
  await check(p,t,'早上初始');
  // move one to today
  const id=await p.$eval('.review .rv',r=>r.dataset.id);const open0=await p.evaluate(()=>tasks().filter(x=>!x.done).length);
  await p.click(`.review .rv[data-id="${id}"] [data-a="toToday"]`);await p.waitForTimeout(120);
  eq(await p.evaluate(()=>carry().length),5,'「移到今天」后遗留 5');
  eq(await p.evaluate(()=>tasks().filter(x=>!x.done).length),open0+1,'今天待办 +1');
  ok(!!(await p.$(`#dList .drow[data-id="${id}"]`)),'出现在今天的列表里');
  ok(await p.evaluate(id=>!isOver(byId(id)),id),'移到今天后不会立刻变成逾期（过去的时间会清掉，未来的保留）');
  ok((await toast(p)).includes('移到今天'),'有提示可撤销');
  const ts=await p.$$eval('#dList .drow[data-id]',x=>x.map(r=>byId(r.dataset.id)).filter(y=>!y.done&&y.time!=null).map(y=>y.time));
  ok(ts.every((v,i)=>i===0||v>=ts[i-1]),'移入的任务按时间排进列表（不是追加在末尾/错位）',ts);
  await check(p,t,'移到今天后');
  await p.keyboard.press('Control+z');await p.waitForTimeout(120);
  eq(await p.evaluate(()=>carry().length),6,'撤销移到今天');
  // schedule one
  await p.click(`.review .rv[data-id="${id}"] [data-a="slot"]`);await p.waitForTimeout(120);
  const x=await p.evaluate(id=>byId(id),id);
  ok(x.day===D&&x.time>8+10/60,'「安排时间」放到今天现在之后的空档',x);
  ok(await p.evaluate(id=>tasks().filter(y=>y.id!==id&&!y.done&&y.time!=null).every(y=>Math.abs(y.time-byId(id).time)>=.25),id),'不和已有任务撞时间');
  ok(await p.evaluate(id=>/^\d\d:\d\d$/.test(__host.state.workspace.tasks.find(e=>e.id===id).plannedTime),id),'计划时间写进 Workspace（plannedTime）');
  await check(p,t,'安排时间后');
  await p.keyboard.press('Control+z');await p.waitForTimeout(120);
  // defer one to tomorrow
  const nz=+(await p.textContent('#nextZone b'));
  await p.click(`.review .rv[data-id="${id}"] [data-a="defer"]`);await p.waitForTimeout(120);
  eq(await p.evaluate(id=>byId(id).day,id),D+1,'「推迟到明天」→ 周日');
  eq(+(await p.textContent('#nextZone b')),nz+1,'明天计数 +1');
  await check(p,t,'推迟后');
  await p.keyboard.press('Control+z');await p.waitForTimeout(120);
  // dismiss keeps tasks
  await p.click('[data-a="hideReview"]');await p.waitForTimeout(120);
  ok(!(await p.$('.review')),'× 收起整理面板');
  eq(+(await p.textContent('#carryZone b')),6,'收起后遗留仍是 6（没有偷偷删掉）');
  await p.click('#carryZone');await p.waitForTimeout(120);
  ok(!!(await p.$('.review')),'点「遗留」重新打开');
  // bulk: all to Monday
  await p.click('[data-a="allMonday"]');await p.waitForTimeout(150);
  eq(await p.evaluate(()=>carry().length),0,'「全部推迟到下周一」后遗留 0');
  eq(await p.getAttribute('#carryZone','aria-disabled'),'true','遗留为 0 时入口显示为不可用');
  eq(await p.evaluate(d=>S.tasks.filter(x=>x.day===d).length,D+2),7,'下周一多了 6 项（原有 1 项）');
  await check(p,t,'全部推迟后');
  await p.click('[data-scale="week"]');await p.waitForTimeout(700);
  await check(p,t,'推迟后周视图');
  ok((await p.textContent('#dList')).includes('下周'),'周列表里能看到下周组');
  await p.keyboard.press('1');await p.waitForTimeout(500);
  await p.keyboard.press('Control+z');await p.waitForTimeout(150);
  eq(await p.evaluate(()=>carry().length),6,'撤销整批推迟');
  // all to today
  await p.click('[data-a="allToday"]');await p.waitForTimeout(150);
  eq(await p.evaluate(()=>carry().length),0,'「全部移到今天」后遗留 0');
  ok(!(await p.$('.review')),'整理面板自动收起');
  await check(p,t,'全部移到今天后');
  await p.keyboard.press('Control+z');await p.waitForTimeout(150);
  await p.click('[data-a="allSomeday"]');await p.waitForTimeout(150);
  eq(await p.evaluate(()=>S.tasks.filter(x=>x.day==null).length),7,'「放进以后」→ 以后 7 项');
  ok(await p.evaluate(()=>__host.state.workspace.tasks.filter(e=>e.planned===''&&e.plannedTime===undefined).length===7),'「以后」在 Workspace 里就是没有计划日期');
  await p.click('[data-scale="week"]');await p.waitForTimeout(700);
  ok(/以后 · 未定日期\s*7/.test(await p.textContent('#dList')),'周列表「以后」组显示 7');
  // week columns: past days show their leftovers
  await p.keyboard.press('Control+z');await p.waitForTimeout(200);
  await check(p,t,'周视图（撤销后）');
  const fri=await p.$eval(`.wday[data-day="${D-1}"] .left`,e=>e.textContent).catch(()=>null);
  eq(fri,'遗留 5','周五列显示遗留 5');
  // the card does not reopen by itself on the same day
  await p.close();p=await open(b,{variant:'carry',config:{prefs:{reviewDay:'2026-11-14'}}});
  ok(!(await p.$('.review'))&&+(await p.textContent('#carryZone b'))===6,'同一天再次打开不再自动弹出，入口仍在');
  await clean(p,t,'结束时');
  await p.close();return res;
};
