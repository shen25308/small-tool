/* Results panel v2 (result-panel.html) and how it talks to the host.
   The prototype's p7 checked its mock workspace, floating window and widgets against each other. In the app
   the workspace and floating Today are one store (covered in p2), and widgets are not part of this port. */
const {open,suite,clean,sample}=require('./lib');
module.exports=async b=>{
  const {res,ok,eq}=suite('p7-panel');const t={ok,eq};
  let p=await open(b,{file:'result-panel.html',w:320,h:96});
  const ops=()=>p.evaluate(()=>__host.state.edgeOps);
  const unread=async()=>+(await p.textContent('#rvUnread')).match(/\d+/)[0];
  await clean(p,t,'结果面板（CSP 不允许内联样式）');
  ok(await p.evaluate(()=>document.querySelector('#rv2').classList.contains('preview')&&document.querySelectorAll('#rvPeek .tt').length===1),'预览只有一行：一句话结果');
  ok((await p.textContent('#rvPeek')).includes('发布说明草稿已写好'),'预览显示最新一条',await p.textContent('#rvPeek'));
  ok(!(await p.textContent('#rvPeek')).includes('RELEASE_NOTES'),'预览里不重复原文');
  // open details
  await p.click('#rvPeek');await p.waitForTimeout(150);
  ok((await ops()).some(o=>o.op==='resize'&&o.mode==='details'),'点开 → 请求宿主放大到 details');
  ok((await ops()).some(o=>o.op==='read'),'点开即标为已读（通知宿主）');
  await p.setViewportSize({width:400,height:460});
  eq(await unread(),2,'3 条未读，点开一条后 → 2 条未读');
  eq(await p.$$eval('.rv2-headline',x=>x.length),1,'一条结果只有一句「发生了什么」');
  eq(await p.$$eval('.rv2-foot .btn',x=>x.length),2,'底部只有一个主按钮和一个「…」');
  ok(await p.evaluate(()=>[...document.querySelectorAll('.rv2 *')].every(e=>getComputedStyle(e).textTransform!=='uppercase')),'没有全大写的小标签');
  await p.click('.rv2-row.unread');await p.waitForTimeout(100);eq(await unread(),1,'点开另一条未读 → 1 条未读');
  ok(await p.isVisible('.rv2-confirm'),'需要确认的结果有醒目的提示块');
  // source filter
  await p.click('[data-src="ci"]');await p.waitForTimeout(100);
  eq(await p.$$eval('.rv2-row',x=>x.length),1,'「构建」只剩 CI 一条');
  eq(await p.textContent('.rv2-earlier span'),'1','分组计数同步');
  await p.click('[data-src="mail"]');await p.waitForTimeout(100);ok((await p.textContent('#inbox')).includes('这个来源暂时没有结果'),'没有结果的来源有空状态');
  await p.click('[data-src="all"]');await p.waitForTimeout(100);eq(await p.$$eval('.rv2-row',x=>x.length),8,'回到全部');
  // raw reply
  await p.click('.rv2-row');await p.waitForTimeout(100);
  await p.click('.rv2-raw');await p.waitForTimeout(100);ok(await p.isVisible('.rv2-rawtext'),'「原始回复」能展开');
  ok((await ops()).some(o=>o.op==='resize'&&o.mode==='original'),'展开原始回复 → 请求 original 尺寸');
  await p.click('.rv2-raw');await p.waitForTimeout(100);ok(!(await p.$('.rv2-rawtext')),'再点收起');
  // a newer result while reading: a capsule, not a replacement
  const reading=await p.textContent('.rv2-headline');
  await p.evaluate(r=>__host.edgeDeliver(r),sample.burst(1,14.7));await p.waitForTimeout(150);
  ok(await p.isVisible('#rvNewer'),'阅读时来了新结果 → 顶部出现「有 1 条更新的结果」');
  eq(await p.textContent('.rv2-headline'),reading,'正在读的那条不被挤走');
  await p.click('#rvNewer');await p.waitForTimeout(100);ok(!(await p.isVisible('#rvNewer')),'点后显示最新一条，胶囊消失');
  // primary + menu
  await p.click('.rv2-row[data-group="ai"]:has(.pvtile [href="#pv-codex"])');await p.waitForTimeout(100);
  await p.click('#rvPrimary');await p.waitForTimeout(80);
  ok((await ops()).some(o=>o.op==='open'&&/^[0-9a-f-]{36}$/.test(o.thread)),'「打开会话」把会话 ID 交给宿主');
  await p.click('#rvMore');await p.waitForTimeout(120);ok(await p.evaluate(()=>!document.querySelector('#rvMenu').classList.contains('hidden')),'「…」打开菜单');
  await p.keyboard.press('Escape');await p.waitForTimeout(80);ok(await p.evaluate(()=>document.querySelector('#rvMenu').classList.contains('hidden')&&document.activeElement.id==='rvMore'),'Esc 关闭菜单，焦点回到按钮');
  for(const k of ['today','inbox','back']){await p.click('#rvMore');await p.waitForTimeout(80);await p.click(`#rvMenu [data-rv="${k}"]`);await p.waitForTimeout(120)}
  const sent=await ops();
  ok(sent.some(o=>o.op==='addTask'&&o.title.length>0),'菜单「加入今天」把标题交给宿主');
  ok(sent.some(o=>o.op==='history')&&sent.some(o=>o.op==='workspace'),'菜单「打开收件箱」「返回工作区」通知宿主');
  // back to preview, then ten results at once: one merged preview
  await p.click('#rvCollapse');await p.waitForTimeout(100);
  ok((await ops()).filter(o=>o.op==='resize').pop().mode==='preview','收起 → 回到 preview 尺寸');
  await p.setViewportSize({width:320,height:96});
  await p.evaluate(r=>__host.edgeDeliver(r),sample.burst(10,14.75));await p.waitForTimeout(150);
  const peek=await p.textContent('#rvPeek');
  ok(peek.includes('同时到达 10 条结果')&&peek.includes('2 条需要你确认')&&peek.includes('1 条失败'),'10 条同时到达 → 合并成一条预览',peek);
  eq(await p.$$eval('#rvPeek .tt',x=>x.length),1,'仍然只有一行，不逐条闪过');
  await p.click('#rvPeek');await p.waitForTimeout(120);await p.setViewportSize({width:400,height:460});
  eq(await p.$$eval('.rv2-burst .rv2-row',x=>x.length),10,'点开后列出这 10 条，需要确认和失败的排在前面');
  eq(await p.$$eval('.rv2-burst .rv2-row .st',x=>x.slice(0,3).map(e=>e.className)),['st warn','st warn','st bad'],'顺序：需要确认 → 失败 → 已完成');
  await p.click('.rv2-burst [data-rv="inbox"]');await p.waitForTimeout(80);
  ok((await ops()).filter(o=>o.op==='history').length>=2,'「打开收件箱逐条处理」通知宿主');
  await clean(p,t,'结束时');
  await p.close();
  // dark, English
  p=await open(b,{file:'result-panel.html',w:400,h:460,dark:true,lang:'en'});
  await p.click('#rvPeek');await p.waitForTimeout(150);
  ok(/unread/.test(await p.textContent('#rvUnread'))&&(await p.textContent('#rvPrimary')).includes('Open session'),'英文系统下面板是英文');
  await clean(p,t,'深色 · 英文');
  await p.close();
  // "add to Today" from the panel lands in the workspace
  p=await open(b);
  const n0=await p.evaluate(()=>dayList(st.today).length);
  await p.evaluate(()=>window.addTaskFromResult('发布说明草稿已写好（412 字）'));await p.waitForTimeout(150);
  eq(await p.evaluate(()=>dayList(st.today).length),n0+1,'宿主转来的「加入今天」真的加入今天');
  ok(await p.evaluate(()=>__host.state.workspace.tasks.some(e=>e.title==='发布说明草稿已写好（412 字）'&&e.planned==='2026-11-13')),'并写进 Workspace');
  await p.keyboard.press('Meta+z');await p.waitForTimeout(150);eq(await p.evaluate(()=>dayList(st.today).length),n0,'可撤销');
  // the host's other calls
  await p.evaluate(()=>{window.setWorkspaceReturn(true);window.openInbox('edge')});await p.waitForTimeout(200);
  ok(await p.evaluate(()=>st.inbox.open&&!document.querySelector('#backEdge').hidden),'从面板过来：打开 AI 结果，并显示「回到结果面板」');
  await p.click('#backEdge');await p.waitForTimeout(150);
  ok(await p.evaluate(()=>__host.state.ops.includes('returnToEdge')&&document.querySelector('#backEdge').hidden),'「回到结果面板」通知宿主');
  await clean(p,t,'工作区');
  await p.close();return res;
};
