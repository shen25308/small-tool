/* Persona 9 — 周姐, came from Todoist/滴答; checks the pain-point fixes. */
const {open,suite,check,clean,setNow}=require('./lib');
module.exports=async b=>{
  const {res,ok,eq}=suite('p9-features'),t={ok,eq};
  let p=await open(b);let E=(f,a)=>p.evaluate(f,a);
  const D=await E(()=>st.today);
  // 1. Chinese natural-language parsing (today = 11/13 周五, now = 14:40)
  const cases=[
    ['明天下午3点 发周报',{title:'发周报',day:D+1,time:15}],
    ['后天上午10点半 牙医',{title:'牙医',day:D+2,time:10.5}],
    ['周一 9:30 站会 #团队',{title:'站会',day:D+3,time:9.5,tag:'团队'}],
    ['下周三晚上8点 读书会',{title:'读书会',day:D+5,time:20}],
    ['今晚 收拾行李',{title:'收拾行李',day:D,time:20}],
    ['3点 打电话给房东',{title:'打电话给房东',day:D,time:15}],
    ['10点 交报销',{title:'交报销',day:D+1,time:10}],
    ['12月3日 续签合同 !!',{title:'续签合同',day:D+20,p:0}],
    ['20号 交房租',{title:'交房租',day:D+7}],
    ['以后 学吉他',{title:'学吉他',day:null,time:null}],
    ['下午三点半 评审 1小时',{title:'评审',day:D,time:15.5,dur:1}],
    ['明早 晨跑 30分钟',{title:'晨跑',day:D+1,time:9,dur:.5}],
  ];
  for(const [s,w] of cases){const r=await E(s=>Features.parse(s),s);const got=Object.fromEntries(Object.keys(w).map(k=>[k,r[k]]));eq(got,w,`解析「${s}」`)}
  ok((await E(()=>Features.parse('10点 交报销').notes.map(n=>tr(n)).join())).includes('排到明天'),'已过的时间会说明「排到明天」');
  // 2. quick capture end to end
  const n0=await E(()=>S.tasks.length);
  await p.keyboard.press('n');await p.waitForTimeout(250);
  ok(await E(()=>!document.querySelector('#cap').hidden&&document.activeElement.id==='capIn'),'按 N 打开快速添加并聚焦输入框');
  await p.keyboard.type('明天下午3点 发周报 #团队 !');await p.waitForTimeout(150);
  const prev=await p.textContent('#capPrev');ok(prev.includes('明天')&&prev.includes('15:00')&&prev.includes('#团队'),'实时预览识别出的日期、时间、标签',prev);
  await p.keyboard.press('Enter');await p.waitForTimeout(250);
  eq(await E(()=>S.tasks.length),n0+1,'回车添加');
  eq(await E(()=>{const x=S.tasks[S.tasks.length-1];return [x.t,x.day,x.time,x.tag,x.p]}),['发周报',D+1,15,'团队',1],'添加的任务字段正确');
  eq(await E(()=>{const e=__host.state.workspace.tasks.at(-1);return [e.title,e.planned,e.plannedTime,e.tag,e.priority,e.project,e.done]}),['发周报','2026-11-14','15:00','团队','P1','发布 v1.7',false],'写进 Workspace 的是真实格式（planned + plannedTime + P1）');
  ok((await E(()=>Toast.text)).includes('已添加'),'添加后有提示和撤销');
  await check(p,t,'快速添加后');
  await p.keyboard.press('Meta+z');await p.waitForTimeout(150);eq(await E(()=>S.tasks.length),n0,'⌘Z 撤销添加');
  ok(await E(()=>document.querySelector('#cap').hidden),'添加后面板关闭');
  await p.keyboard.press('n');await p.waitForTimeout(150);await p.keyboard.type('周一 写总结 #不存在的标签');await p.waitForTimeout(120);
  ok((await p.textContent('#capPrev')).includes('没有 #不存在的标签 这个标签'),'不存在的标签会说明，而不是悄悄忽略');
  await p.keyboard.press('Escape');await p.waitForTimeout(100);
  // quota-aware hint
  await p.click('#addBtn');await p.waitForTimeout(200);
  await p.keyboard.type('今天下午3点 让 Claude 重构设置页');await p.waitForTimeout(150);
  const q=await p.textContent('#capPrev');ok(q.includes('剩 18%')&&q.includes('15:30'),'提到 Claude：提示额度剩 18%、15:30 重置',q);
  await p.keyboard.press('Tab');await p.waitForTimeout(100);ok((await p.textContent('#capPrev')).includes('15:30'),'Tab 改到重置之后');
  await p.keyboard.press('Enter');await p.waitForTimeout(200);
  eq(await E(()=>S.tasks[S.tasks.length-1].time),15.5,'任务排在额度重置之后（15:30）');
  await E(()=>undo());await p.waitForTimeout(100);
  await p.click('#addBtn');await p.waitForTimeout(150);await p.keyboard.press('Escape');await p.waitForTimeout(150);
  ok(await E(()=>document.querySelector('#cap').hidden),'Esc 取消快速添加');
  eq(await E(()=>document.activeElement.id),'addBtn','焦点回到「添加」按钮');
  await p.click('#searchBtn');await p.waitForTimeout(150);await p.keyboard.type('n');await p.waitForTimeout(100);
  ok(await E(()=>!document.querySelector('#cap')||document.querySelector('#cap').hidden),'在搜索框里打 n 不会弹出快速添加');
  await p.keyboard.press('Escape');await p.keyboard.press('Escape');await p.waitForTimeout(100);
  // 3. smart reschedule preview
  const over=await E(()=>buckets(dayList(st.today)).over.length),saves0=await E(()=>__host.state.saves);
  await p.click('[data-fa="suggest"]');await p.waitForTimeout(250);
  eq(await E(()=>document.querySelectorAll('.bghost').length),over,'「建议空档」在时间带上画出虚线预览点');
  eq(await E(()=>document.querySelectorAll('.sg-pill').length),over,'每个逾期行显示建议时间');
  ok(await E(()=>buckets(dayList(st.today)).over.length)===over,'预览时不改数据');
  eq(await E(()=>__host.state.saves),saves0,'预览不写 Workspace');
  const used=await E(()=>dayList(st.today).filter(x=>!x.done&&x.time!=null&&!isOver(x)).map(x=>x.time));
  const sug=await E(()=>st.suggest.map(s=>s.t));const now=await E(()=>st.now);ok(sug.every(s=>s>now&&!used.some(u=>Math.abs(u-s)<.25)),'建议的时间都在现在之后、不和已有任务撞',sug);
  await p.keyboard.press('Escape');await p.waitForTimeout(150);eq(await E(()=>document.querySelectorAll('.bghost').length),0,'Esc 取消预览');
  await p.click('[data-fa="suggest"]');await p.waitForTimeout(200);await p.click('#sgBar [data-fa="accept"]');await p.waitForTimeout(250);
  eq(await E(()=>buckets(dayList(st.today)).over.length),0,'全部接受后没有逾期');
  await check(p,t,'接受建议空档');
  await p.keyboard.press('Meta+z');await p.waitForTimeout(150);eq(await E(()=>buckets(dayList(st.today)).over.length),over,'⌘Z 撤销');
  // 4. guilt-free defer counter
  ok((await p.textContent('#dList .dgrp.red')).includes('不用愧疚'),'逾期组的说法不带压力');
  const id=await E(()=>dayList(st.today).find(x=>!x.done&&x.time!=null&&x.time>st.now).id);
  for(let i=0;i<3;i++){await E(id=>{const x=byId(id);x.day=st.today;render()},id);await E(id=>A.defer(id),id);await p.waitForTimeout(80)}
  ok((await E(()=>Toast.text)).includes('已经推迟 3 次'),'第 3 次推迟时温和提醒「拆小或放进以后」',await E(()=>Toast.text));
  await E(id=>{byId(id).day=st.today;render()},id);
  ok(await E(id=>!!document.querySelector(`.drow[data-id="${id}"] .dfr`),id),'行上标出「推迟 3 次」');
  await clean(p,t,'工作区');
  await p.close();p=await open(b);E=(f,a)=>p.evaluate(f,a);
  // 5. quota reset markers on the band
  const bq=await E(()=>[...document.querySelectorAll('.bq')].map(e=>e.getAttribute('aria-label')));
  ok(bq.some(s=>s.includes('Claude')&&s.includes('15:30'))&&bq.some(s=>s.includes('Codex')&&s.includes('16:05')),'时间带上标出额度重置时间',bq);
  await setNow(p,17);await p.waitForTimeout(100);eq(await E(()=>document.querySelectorAll('.bq').length),0,'重置时间过了，标记消失');
  await setNow(p,14+40/60);
  // 6. focus mode
  await p.click('#focusBtn');await p.waitForTimeout(250);
  ok(await p.isVisible('#fBar'),'专注条出现');ok(await E(()=>!!document.querySelector('.drow.fnext')),'只突出下一件事');
  eq(await E(()=>document.querySelector('#focusBtn').getAttribute('aria-pressed')),'true','专注按钮是按下状态');
  await check(p,t,'专注中');
  await p.click('#fBar [data-fa="focus"]');await p.waitForTimeout(200);ok(!(await p.isVisible('#fBar')),'结束专注');
  // 7. kept features: capture tasks from a message with the local model, new project, new tag, wrap-up
  await p.close();p=await open(b,{config:{clipboard:'Maya: 周五前把首页原型发给设计组。',extract:[{title:'把首页原型发给设计组',quote:'周五前把首页原型发给设计组。',tag:'产品'}]}});E=(f,a)=>p.evaluate(f,a);
  await E(()=>window.openMessage(''));await p.waitForTimeout(200);
  ok(await E(()=>document.querySelector('#dialog').open&&document.activeElement.id==='mSource'),'宿主的「从消息里提取任务」（⌘K / 服务菜单）打开面板');
  await p.click('#mPaste');await p.waitForTimeout(150);eq(await p.inputValue('#mSource'),'Maya: 周五前把首页原型发给设计组。','「粘贴」读取剪贴板');
  await p.click('#mFind');await p.waitForTimeout(250);
  eq(await p.$$eval('.candidate',x=>x.length),1,'本地模型返回的候选任务可逐条检查');
  const m0=await E(()=>S.tasks.length);await p.click('#mAdd');await p.waitForTimeout(250);
  ok(await E(n=>{const e=__host.state.workspace.tasks.at(-1);return S.tasks.length===n+1&&e.title==='把首页原型发给设计组'&&e.source.startsWith('Maya')&&e.quote.includes('首页原型')&&e.planned==='2026-11-13'},m0),'添加后带着来源消息写进 Workspace');
  await p.keyboard.press('Meta+z');await p.waitForTimeout(150);
  await p.click('#newProject');await p.waitForTimeout(150);await p.fill('#fName','客户交付');await p.keyboard.press('Enter');await p.waitForTimeout(250);
  ok(await E(()=>__host.state.workspace.projects.includes('客户交付')&&!!document.querySelector('#sideProjects [data-proj="客户交付"]')),'新建项目');
  await p.click('[data-nav="today"]');await p.click('#newTag');await p.waitForTimeout(150);await p.fill('#fName','周会');await p.keyboard.press('Enter');await p.waitForTimeout(250);
  ok(await E(()=>__host.state.workspace.labels.includes('周会')&&!!document.querySelector('#sideTags [data-tag="周会"]')),'新建标签');
  await p.click('#newTag');await p.waitForTimeout(150);await p.fill('#fName','周会');await p.keyboard.press('Enter');await p.waitForTimeout(150);
  ok((await p.textContent('#fError')).includes('已经存在'),'重名标签有说明');await p.keyboard.press('Escape');await p.waitForTimeout(150);
  await p.click('#moreBtn');await p.click('[data-m="wrap"]');await p.waitForTimeout(200);
  ok(/已完成\s*9/.test(await p.textContent('#dialogBody')),'「今日小结」列出已完成和还没完成的');await p.keyboard.press('Escape');await p.waitForTimeout(150);
  await p.click('#moreBtn');await p.click('[data-m="connectors"]');await p.waitForTimeout(300);
  ok(await E(()=>document.querySelector('#dialog').open&&__host.state.ops.includes('codexConnection')&&__host.state.ops.includes('externalProvider')),'「连接器」沿用原来的宿主接口');
  await p.keyboard.press('Escape');await p.waitForTimeout(150);
  await check(p,t,'保留的功能');
  await clean(p,t,'保留的功能');
  // compact window add + inbox button
  const c=await open(b,{compact:true,w:356,h:484});
  await c.click('#cwAdd');await c.waitForTimeout(200);ok(await c.evaluate(()=>!document.querySelector('#cap').hidden),'浮动今日的「添加任务」可用');
  await c.keyboard.press('Escape');await c.click('#cwInbox');await c.waitForTimeout(250);
  ok(await c.evaluate(()=>st.inbox.open),'浮动今日的结果按钮打开结果');
  ok(await c.evaluate(()=>__host.state.sizes.at(-1)===true),'打开结果时请求宿主把浮动窗放大一点');
  ok(await c.evaluate(()=>getComputedStyle(document.querySelector('#inbox .ib-src')).display==='none'),'浮动窗里隐藏来源筛选，按钮不换行');
  await check(c,t,'浮动今日');
  await clean(c,t,'浮动今日');
  await p.context().close();await c.context().close();return res;
};
