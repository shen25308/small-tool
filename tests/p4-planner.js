/* Persona 4 — 陈老师, plans tomorrow and the rest of the week on Friday afternoon. */
const {open,suite,check,clean}=require('./lib');
module.exports=async b=>{
  const {res,ok,eq}=suite('p4-planner'),t={ok,eq};
  let p=await open(b);
  const D=await p.evaluate(()=>st.today);                    // Friday 11/13
  await p.click('[data-scale="week"]');await p.waitForTimeout(700);
  eq(await p.textContent('#dTitle'),'计划','周视图标题统一叫「计划」');
  eq(await p.$eval('.seg.scale button.on',e=>e.textContent),'周','计划里的分段选中「周」');
  ok(await p.$eval('.nav-row[data-nav="plan"]',e=>e.classList.contains('sel')),'周视图时侧栏选中「计划」');
  eq(await p.$$eval('.wday',x=>x.map(e=>+e.dataset.day)),[-4,-3,-2,-1,0,1,2].map(k=>D+k),'周一到周日 = 11/9–11/15');
  eq(await p.$$eval('.wday .wh b',x=>x.map(e=>e.textContent)),['9','10','11','12','13','14','15'],'列头是真实日期');
  eq(await p.textContent('#dDate'),'11月9日 – 15日','标题日期范围');
  await check(p,t,'周视图');
  const groups=await p.$$eval('#dList .dgrp',x=>x.map(e=>e.childNodes[0].textContent.trim()));
  ok(groups[0].startsWith('明天 · 周六'),'第一组是「明天 · 周六」',groups);
  ok(!groups.some(g=>/^周[一二三四]/.test(g)),'本周剩余不再出现已过去的「周二/周四」',groups);
  ok(groups.some(g=>g.startsWith('下周')),'下周单独成组',groups);
  const satCol=await p.$eval(`.wday[data-day="${D+1}"] .wcount span`,e=>e.textContent);
  const satGrp=await p.$$eval('#dList .dgrp',x=>+x[0].querySelector('.n').textContent);
  eq(satCol,`${satGrp} 项`,'周六列的数字 = 列表「明天」组数量');
  // past day is read-only
  await p.click(`.wday[data-day="${D-3}"]`,{force:true});await p.waitForTimeout(300);
  eq(await p.textContent('#dTitle'),'计划','点过去的日子不跳转');
  ok((await p.evaluate(()=>Toast.text)).includes('已过去'),'并解释为什么');
  // open Saturday
  await p.click(`.wday[data-day="${D+1}"]`);await p.waitForTimeout(800);
  eq(await p.textContent('#dTitle'),'明天','点周六 → 明天日视图');
  ok((await p.textContent('#dDate')).startsWith('11月14日 星期六'),'日期正确');
  ok(!(await p.$('.bnow')),'未来的一天不显示「现在」');
  ok(!(await p.$('#filters [data-f="over"]')),'未来的一天没有逾期');
  await check(p,t,'周六日视图');
  ok(await p.isVisible('#backToday'),'显示「回到今天」');
  await p.keyboard.press('Alt+ArrowRight');await p.waitForTimeout(150);
  ok((await p.textContent('#dDate')).startsWith('11月15日 星期日'),'⌥→ 到周日');
  await check(p,t,'周日日视图');
  await p.keyboard.press('Alt+ArrowLeft');await p.keyboard.press('Alt+ArrowLeft');await p.keyboard.press('Alt+ArrowLeft');await p.waitForTimeout(150);
  eq(await p.textContent('#dTitle'),'今天','⌥← 最多回到今天（过去的日子从「遗留」处理）');
  // 3-day
  await p.click('[data-scale="3"]');await p.waitForTimeout(700);
  eq(await p.$$eval('.wday',x=>x.map(e=>+e.dataset.day)),[D,D+1,D+2],'3 天 = 今天、明天、后天');
  await check(p,t,'3 天视图');
  const more=await p.$eval(`.wday[data-day="${D}"] .more`,e=>e.textContent);
  const shown=await p.$$eval(`.wday[data-day="${D}"] .wtasks > div:not(.more)`,x=>x.length);
  const openN=await p.evaluate(()=>dayList(st.today).filter(x=>!x.done).length);
  eq(+(more.match(/\d+/)||[0])[0]+shown,openN,'今天列：显示的 + 「还有 N 项」= 今天未完成');
  // defer from the week list
  await p.click('[data-scale="week"]');await p.waitForTimeout(700);
  const id=await p.$eval('#dList .drow[data-id]',r=>r.dataset.id);
  const d0=await p.evaluate(id=>byId(id).day,id);
  await p.hover(`#dList .drow[data-id="${id}"]`);await p.click(`#dList .drow[data-id="${id}"] [data-a="defer"]`);await p.waitForTimeout(150);
  eq(await p.evaluate(id=>byId(id).day,id),d0+1,'在周列表里推迟一天');
  await check(p,t,'周列表推迟后');
  // complete from the week list
  await p.click(`#dList .drow[data-id="${id}"] .check`);await p.waitForTimeout(1700);
  eq(await p.evaluate(id=>byId(id).done,id),1,'在周列表里完成');
  await check(p,t,'周列表完成后');
  // nav
  await p.click('[data-nav="plan"]');await p.waitForTimeout(700);eq(await p.evaluate(()=>st.scale),'3','侧栏「计划」→ 3 天');
  eq(await p.textContent('#dTitle'),'计划','侧栏「计划」打开的视图也叫「计划」');ok(await p.$eval('.nav-row[data-nav="plan"]',e=>e.classList.contains('sel')),'3 天视图侧栏仍选中「计划」');
  await p.click('[data-nav="all"]');await p.waitForTimeout(500);eq(await p.textContent('#dTitle'),'全部任务','「全部任务」标题');
  eq(await p.$$eval('#dList .drow[data-id]',x=>x.length),await p.evaluate(()=>S.tasks.filter(x=>!x.done).length),'「全部任务」列出每一项未完成的任务（遗留、今天、之后、以后）');
  await p.keyboard.press('2');await p.waitForTimeout(400);eq(await p.textContent('#dTitle'),'计划','按 2 → 计划');
  await p.click('[data-nav="all"]');await p.waitForTimeout(700);eq(await p.evaluate(()=>st.scale),'week','侧栏「全部任务」→ 周');
  // "later" tasks can be pulled into today from the list
  const later=await p.evaluate(()=>S.tasks.find(x=>x.day==null&&!x.done).id);
  await p.hover(`#dList .drow[data-id="${later}"]`);await p.click(`#dList .drow[data-id="${later}"] [data-a="toToday"]`);await p.waitForTimeout(150);
  eq(await p.evaluate(id=>byId(id).day,later),D,'「以后」的任务可以直接移到今天');
  await p.keyboard.press('Control+z');await p.waitForTimeout(150);
  await p.click('[data-nav="done"]');await p.waitForTimeout(700);eq(await p.evaluate(()=>[st.scale,st.filter]),['day','done'],'侧栏「已完成」→ 今天的已完成');
  await p.click('[data-nav="today"]');await p.waitForTimeout(300);eq(await p.evaluate(()=>[st.scale,st.filter]),['day','all'],'侧栏「今天」');
  await clean(p,t,'工作区');
  // empty state
  await p.close();p=await open(b,{variant:'empty'});
  ok(!!(await p.$('.bempty')),'空状态：时间带提示');
  const btn=await p.$('[data-goto]');const n=+(await btn.textContent()).match(/(\d+) 项/)[1];
  eq(n,+(await p.textContent('#nextZone b')),'「看看明天 · N 项」= 右侧明天计数');
  await btn.click();await p.waitForTimeout(150);eq(await p.textContent('#dTitle'),'明天','空状态按钮跳到明天');
  // a brand-new install: no file yet
  await p.close();p=await open(b,{workspace:null,inbox:false,quota:false});
  ok(await p.evaluate(()=>S.tasks.length===0&&data.projects.length===1&&!!document.querySelector('.bempty')),'没有 Workspace 文件时从一个空项目开始');
  await check(p,t,'全新安装');
  await clean(p,t,'空状态');
  await p.close();return res;
};
