/* Persona 5 — 王工, keyboard-only (no mouse at all). */
const {open,suite,check,clean}=require('./lib');
module.exports=async b=>{
  const {res,ok,eq}=suite('p5-keyboard'),t={ok,eq};
  const p=await open(b);
  // Tab through the page: every focus stop must show a visible ring
  await p.keyboard.press('Tab');
  let stops=[],invisible=[];
  for(let i=0;i<90;i++){
    const s=await p.evaluate(()=>{const a=document.activeElement;if(!a||a===document.body)return null;const cs=getComputedStyle(a);
      const ring=(cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0)||cs.boxShadow!=='none';const r=a.getBoundingClientRect();
      return {k:a.tagName+'.'+(typeof a.className==='string'?a.className.split(' ')[0]:'')+(a.id?'#'+a.id:''),ring,vis:r.width>0&&r.height>0&&cs.visibility!=='hidden'&&+cs.opacity!==0}});
    if(s){stops.push(s.k);if(!s.ring||!s.vis)invisible.push(s)}
    await p.keyboard.press('Tab');
  }
  ok(stops.length>20,'Tab 能走到大量控件',stops.length);
  ok(stops.some(s=>s.includes('#bw')),'时间带本身可以获得焦点');
  ok(stops.some(s=>s.includes('nav-row')),'侧栏导航可用 Tab 到达');
  ok(stops.some(s=>s.includes('check')),'勾选框可用 Tab 到达');
  ok(stops.some(s=>s.includes('ra')),'行操作「推迟」可用 Tab 到达（聚焦时显示）');
  eq(invisible,[],'每个焦点都有可见的焦点环');
  const unnamed=await p.evaluate(()=>[...document.querySelectorAll('button,[role=button],[role=checkbox]')].filter(e=>e.getClientRects().length&&!(e.getAttribute('aria-label')||e.textContent.trim()||e.title)).map(e=>e.id||e.className));
  eq(unnamed,[],'每个可见的按钮都有名字（文字或 aria-label）');
  // band navigation
  await p.focus('#bw');await p.keyboard.press('ArrowRight');await p.waitForTimeout(80);
  const f1=await p.evaluate(()=>st.focus);ok(f1>=0,'→ 聚焦到下一个任务点');
  ok(await p.evaluate(()=>document.activeElement.id==='bw'),'焦点仍在时间带上（可继续按方向键）');
  ok((await p.textContent('#bandSR')).length>0,'读屏播报当前任务点',await p.textContent('#bandSR'));
  await p.keyboard.press('ArrowRight');await p.waitForTimeout(60);
  eq(await p.evaluate(()=>st.focus),f1+1,'再按 → 移到下一个');
  await p.keyboard.press('ArrowLeft');await p.waitForTimeout(60);eq(await p.evaluate(()=>st.focus),f1,'← 回到上一个');
  // find the next cluster and open it with Enter
  const ci=await p.evaluate(()=>st.cs.findIndex(c=>c.items.length>=4&&c.a>st.now));
  for(let i=f1;i<ci;i++)await p.keyboard.press('ArrowRight');
  await p.keyboard.press('Enter');await p.waitForTimeout(700);
  ok(await p.$eval('#cpop',e=>!e.classList.contains('hidden')),'回车展开簇');
  ok(await p.evaluate(()=>!!document.activeElement.closest('#cpop')),'焦点进入弹层');
  await p.keyboard.press('Space');await p.waitForTimeout(250);
  ok((await p.evaluate(()=>Toast.text)).includes('已完成'),'空格在弹层里完成一项');
  await check(p,t,'键盘完成后');
  await p.keyboard.press('Meta+z');await p.waitForTimeout(150);
  ok(await p.evaluate(()=>undoStack.length===0),'⌘Z 撤销');
  await p.keyboard.press('Escape');await p.waitForTimeout(600);
  ok(await p.evaluate(()=>document.activeElement.id==='bw'),'Esc 关闭弹层后焦点回到时间带');
  // arrows must not move the band while typing in search
  await p.keyboard.press('/');await p.waitForTimeout(100);
  ok(await p.evaluate(()=>document.activeElement.id==='q'),'/ 打开并聚焦搜索框');
  const f2=await p.evaluate(()=>st.focus);
  await p.keyboard.type('发布');await p.keyboard.press('ArrowLeft');await p.keyboard.press('t');await p.waitForTimeout(100);
  eq(await p.evaluate(()=>st.focus),f2,'在输入框里按方向键 / T 不会触发时间带快捷键');
  eq(await p.evaluate(()=>st.query),'发t布','输入内容正常（← 只移动光标）');
  await p.keyboard.press('Backspace');await p.waitForTimeout(100);eq(await p.evaluate(()=>st.query),'发布','退格后为「发布」');
  ok(await p.evaluate(()=>[...document.querySelectorAll('#dList .drow[data-id]')].every(r=>byId(r.dataset.id).t.includes('发布'))),'搜索过滤列表');
  await check(p,t,'搜索中');
  // the once-a-minute clock tick re-renders; it must not take the keyboard out of the search field
  await p.clock.setFixedTime(require('./lib').sample.at(14+41/60));await p.evaluate(()=>tick());
  ok(await p.evaluate(()=>document.activeElement.id==='q'&&st.now>14.68),'时钟走到下一分钟时，搜索框不丢焦点');
  await p.keyboard.press('Escape');await p.waitForTimeout(100);
  ok(await p.evaluate(()=>!st.query&&!st.search),'Esc 清除并关闭搜索');
  // ? sheet
  await p.keyboard.press('?');await p.waitForTimeout(80);ok(await p.isVisible('#keys'),'? 打开快捷键表');
  await p.keyboard.press('Escape');await p.waitForTimeout(80);ok(!(await p.isVisible('#keys')),'Esc 关闭');
  // scale shortcuts
  await p.keyboard.press('3');await p.waitForTimeout(700);eq(await p.evaluate(()=>st.scale),'week','3 → 周');
  await p.keyboard.press('2');await p.waitForTimeout(700);eq(await p.evaluate(()=>st.scale),'3','2 → 3 天');
  await p.keyboard.press('t');await p.waitForTimeout(700);eq(await p.evaluate(()=>[st.scale,document.activeElement.id]),['day','bw'],'T 回到今天并聚焦时间带');
  // more menu via keyboard
  await p.focus('#moreBtn');await p.keyboard.press('Enter');await p.waitForTimeout(80);
  ok(await p.isVisible('#moreMenu'),'更多菜单可用键盘打开');
  ok(await p.evaluate(()=>!!document.activeElement.closest('#moreMenu')),'焦点进入菜单');
  await p.keyboard.press('Escape');await p.waitForTimeout(80);
  eq(await p.evaluate(()=>document.activeElement.id),'moreBtn','Esc 关闭菜单，焦点回到按钮');
  // task details: open from the keyboard, edit, save, undo
  const row=await p.$eval('#dList .drow:not(.done)[data-id]',r=>r.dataset.id);
  await p.focus(`#dList .drow[data-id="${row}"] [data-a="details"]`);await p.keyboard.press('Enter');await p.waitForTimeout(200);
  ok(await p.evaluate(()=>document.querySelector('#dialog').open&&document.activeElement.id==='fTitle'),'「详情」用回车打开，焦点在标题上');
  await p.keyboard.press('n');await p.waitForTimeout(80);
  ok(await p.evaluate(()=>!document.querySelector('#cap')||document.querySelector('#cap').hidden),'在详情里打字不会触发快捷键');
  await p.fill('#fTitle','合并 PR #212（已改名）');await p.fill('#fDueDate','2026-11-13');await p.fill('#fDueTime','18:00');await p.keyboard.press('Enter');await p.waitForTimeout(250);
  ok(await p.evaluate(id=>{const e=__host.state.workspace.tasks.find(x=>x.id===id);return e.title==='合并 PR #212（已改名）'&&e.dueDate==='2026-11-13'&&e.dueTime==='18:00'&&!document.querySelector('#dialog').open},row),'保存写进 Workspace（标题、截止日期和时间）');
  await p.keyboard.press('Meta+z');await p.waitForTimeout(150);
  ok(await p.evaluate(id=>byId(id).t==='合并 PR #212'&&!byId(id).dueDate,row),'⌘Z 撤销编辑');
  await check(p,t,'编辑并撤销后');
  // the edge zones work with Enter
  await p.focus('#nextZone');await p.keyboard.press('Enter');await p.waitForTimeout(150);eq(await p.textContent('#dTitle'),'明天','回车激活「明天」');
  await clean(p,t,'结束时');
  await p.close();return res;
};
