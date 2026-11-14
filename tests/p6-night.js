/* Persona 6 — 夜猫子 Mia, dark mode, 23:30, works past midnight. Also checks reduced motion and reduced transparency. */
const {open,suite,check,clean,setNow}=require('./lib');
module.exports=async b=>{
  const {res,ok,eq}=suite('p6-night'),t={ok,eq};
  let p=await open(b,{variant:'night',dark:true});
  ok(await p.evaluate(()=>document.documentElement.classList.contains('dark')),'深色模式跟随系统');
  ok(!!(await p.$('.hz-moonball')),'夜里显示月亮而不是太阳');
  const nx=await p.$eval('.bnow',e=>parseFloat(e.style.left)),W=await p.$eval('#bw',e=>e.clientWidth);
  ok(nx>0&&nx<=W,'23:30 的「现在」在时间带内',{nx,W});
  ok((await p.textContent('#dList')).includes('提交本周周报'),'23:45 的任务在「接下来/今晚」里');
  await check(p,t,'23:30');
  await setNow(p,23+50/60);await p.waitForTimeout(80);
  ok(await p.evaluate(()=>isOver(S.tasks.find(x=>x.t==='提交本周周报'))),'23:50 时 23:45 的任务变逾期');
  await check(p,t,'23:50');
  const openFri=await p.evaluate(()=>dayList(st.today).filter(x=>!x.done).length+carry().length);
  const D=await p.evaluate(()=>st.today);
  // the real clock crosses midnight
  await setNow(p,24+12/60);await p.waitForTimeout(120);
  eq(await p.evaluate(()=>st.today),D+1,'过了午夜，今天变成下一天');
  eq(await p.textContent('#dTitle'),'今天','跨过午夜后标题仍是「今天」');
  ok((await p.textContent('#dDate')).startsWith('11月14日 星期六'),'日期翻到 11月14日 星期六');
  eq(await p.textContent('.bnow b'),'00:12','「现在」标签 00:12');
  eq(await p.evaluate(()=>carry().length),openFri,'昨天没做完的全部变成遗留');
  ok(!!(await p.$('.review')),'自动出现遗留整理');
  eq(await p.$$eval('.review .rv',x=>x.length),6,'遗留很多时整理面板只先列 6 项（按优先级），不会淹没今天');
  ok(!(await p.textContent('.review .rh b')).startsWith('早上好'),'半夜不说「早上好」');
  const pr=await p.$$eval('.review .rv',x=>x.map(r=>byId(r.dataset.id).p));ok(pr.every((v,i)=>i===0||v>=pr[i-1]),'先列出高优先级',pr);
  await p.click('[data-expand="review"]');await p.waitForTimeout(80);eq(await p.$$eval('.review .rv',x=>x.length),openFri,'「还有 N 项」展开全部');
  ok((await p.evaluate(()=>Toast.text)).includes('11月14日'),'跨日提示');
  const nx2=await p.$eval('.bnow',e=>parseFloat(e.style.left));
  ok(nx2>=0&&nx2<W*.1,'00:12 的「现在」在时间带左端附近而不是跑出去',nx2);
  eq(await p.evaluate(()=>H0),0,'午夜后时间带从 0:00 开始');
  eq(await p.evaluate(()=>buckets(tasks()).over.length),0,'新的一天刚开始，今天没有逾期');
  await check(p,t,'00:12 跨日后');
  // sat tasks must not be shown as overdue yet, Friday's must not stay in the today list
  ok(await p.evaluate(()=>[...document.querySelectorAll('#dList .drow[data-id]')].every(r=>byId(r.dataset.id).day===st.today)),'今天列表只有周六的任务');
  // move one carry-over task scheduled for 23:45 to today: time is in the "future" (23:45 > 0:12) — keep it
  const id=await p.evaluate(()=>S.tasks.find(x=>x.t==='提交本周周报').id);
  await p.click(`.review .rv[data-id="${id}"] [data-a="toToday"]`);await p.waitForTimeout(100);
  ok(await p.evaluate(id=>byId(id).day===st.today&&!isOver(byId(id)),id),'深夜任务移到今天后不是逾期');
  await check(p,t,'移到今天');
  await clean(p,t,'深色');
  // cluster shift that would cross midnight is refused
  await p.close();p=await open(b,{variant:'night',dark:true});
  await p.evaluate(()=>{S.tasks.push(newTask({day:st.today,time:23.75,t:'检查备份'}));S.tasks.push(newTask({day:st.today,time:23+50/60,t:'关电脑'}));render()});await p.waitForTimeout(80);
  const ci=await p.evaluate(()=>st.cs.findIndex(c=>c.items.length>=2&&c.a>=23.7));
  ok(ci>=0,'23:45 附近成簇');
  await p.click(`.bm[data-c="${ci}"]`);await p.waitForTimeout(700);
  await p.click('#cpop [data-a="shift30"]');await p.waitForTimeout(100);
  ok((await p.evaluate(()=>Toast.text)).includes('午夜'),'整体推迟会跨过午夜时给出提示而不是生成 24:15');
  ok(await p.evaluate(()=>S.tasks.every(x=>x.time==null||x.time<24)),'没有出现 ≥24:00 的时间');
  await p.close();
  // reduced motion: completing still works immediately, no flying star
  p=await open(b,{rm:true});
  ok(await p.evaluate(()=>document.documentElement.classList.contains('rm')),'系统「减少动态效果」会被跟随');
  const id2=await p.$eval('#dList .drow:not(.done)[data-id]',r=>r.dataset.id);
  await p.click(`#dList .drow[data-id="${id2}"] .check`);await p.waitForTimeout(80);
  eq(await p.$$eval('body > span.star',x=>x.length),0,'减少动态效果：没有飞星');
  await p.waitForTimeout(300);
  eq(await p.evaluate(id=>byId(id).done,id2),1,'减少动态效果：完成仍然生效');
  await check(p,t,'减少动态效果');
  // the in-app switch is remembered through the host, not localStorage
  await p.close();p=await open(b);
  await p.click('#moreBtn');await p.click('#mmRm');await p.waitForTimeout(150);
  ok(await p.evaluate(()=>document.documentElement.classList.contains('rm')&&__host.state.prefs.reduceMotion===true),'菜单里的「减少动态效果」生效并记在偏好里');
  await p.click('#moreBtn');await p.click('[data-pal="rose"]');await p.waitForTimeout(150);
  ok(await p.evaluate(()=>Sky.palette==='rose'&&__host.state.prefs.palette==='rose'),'天色配色可切换并记在偏好里');
  await p.close();p=await open(b,{config:{prefs:{palette:'rose',reviewDay:'2026-11-13'}}});
  eq(await p.evaluate(()=>Sky.palette),'rose','下次打开沿用保存的配色');
  await p.close();p=await open(b);
  eq(await p.evaluate(()=>[Sky.palette,getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()]),['pearl','#2674f4'],'默认配色是 D · 珍珠蓝调，14:40 的强调色来自真实时钟');
  await setNow(p,16+38/60);
  eq(await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),'#585bd8','16:38 的强调色是设计稿里的 #585bd8（不是棕橙色）');
  // reduce transparency: glass becomes opaque
  await p.emulateMedia({reducedMotion:'no-preference'});
  await p.evaluate(()=>{document.documentElement.classList.add('opaque')});
  ok(await p.evaluate(()=>{const cs=getComputedStyle(document.querySelector('.tb-group'));return (cs.backdropFilter||cs.webkitBackdropFilter||'none')==='none'}),'「降低透明度」时玻璃变成不透明表面');
  await clean(p,t,'结束时');
  await p.close();return res;
};
