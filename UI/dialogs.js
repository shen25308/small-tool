'use strict';
/* Modal sheets that keep the existing features: task details, new project, new tag, capturing tasks from a
   pasted message with the local model, the daily wrap-up, and connector settings. Content cards are opaque;
   only the scrim is translucent. */
const Dialogs=(()=>{
  const modal=()=>document.getElementById('dialog'),body=()=>document.getElementById('dialogBody');
  const el=id=>document.getElementById(id);
  let goBack=close,token=0;
  function open(title,html,navigation={}){
    const m=modal(),label=navigation.label||tr('dlg.back');
    goBack=navigation.back||close;
    body().innerHTML=`<div class="dialog-head"><button type="button" class="btn sm dialog-back" aria-label="${esc(label)}">${icon('chev-left')}${esc(label)}</button><h2 id="dialogTitle">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="${tr('dlg.close')}">${icon('plus','rot45')}</button></div>`+html;
    body().querySelector('.dialog-back').onclick=()=>goBack();
    m.scrollTop=0;
    if(!m.open)m.showModal();
  }
  function close(){const m=modal();if(m.open)m.close()}
  const isOpen=()=>modal().open;
  const hasDraft=()=>isOpen()&&!!body().querySelector('input:not([type=checkbox]),textarea,select');
  const options=(list,sel,label=String)=>list.map(v=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(label(v))}</option>`).join('');
  const prioLabel=p=>tr('prio.'+p);

  /* ---------- task details ---------- */
  function task(id){
    const x=byId(id);if(!x)return;
    open(tr('task.title'),`<form id="taskForm"><label>${tr('task.name')}<input id="fTitle" required maxlength="240" value="${esc(x.t)}"></label>
      <div class="formgrid"><label>${tr('task.project')}<select id="fProject">${options(data.projects,x.proj)}</select></label><label>${tr('task.priority')}<select id="fPrio">${options(['0','1','2'],String(x.p),prioLabel)}</select></label></div>
      <div class="formgrid"><label>${tr('task.tag')}<input id="fTag" maxlength="30" list="tagList" value="${esc(x.tag||'')}"><datalist id="tagList">${allTags().map(n=>`<option value="${esc(n)}">`).join('')}</datalist></label><span></span></div>
      <fieldset><legend>${tr('task.plan')}</legend><div class="formgrid"><label>${tr('task.planDate')}<input id="fDay" type="date" value="${x.day==null?'':ymd(x.day)}"></label><label>${tr('task.planTime')}<input id="fTime" type="time" value="${x.time==null?'':fmt(x.time)}"></label></div><p class="hint">${tr('task.planHint')}</p></fieldset>
      <fieldset><legend>${tr('task.deadline')}</legend><div class="formgrid"><label>${tr('task.dueDate')}<input id="fDueDate" type="date" value="${esc(x.dueDate||'')}"></label><label>${tr('task.dueTime')}<input id="fDueTime" type="time" value="${esc(x.dueTime||'')}"></label></div><p class="hint">${tr('task.deadlineHint')}</p></fieldset>
      ${x.src?`<details><summary>${tr('task.source')}</summary><blockquote>${esc(x.src)}</blockquote></details>`:''}
      <div class="actions"><button type="button" class="btn danger" id="fRemove">${tr('task.remove')}</button><span class="sp"></span><button type="button" class="btn" data-close>${tr('cancel')}</button><button class="btn primary">${tr('save')}</button></div></form>`);
    el('fTitle').focus();
    el('fRemove').onclick=()=>{close();act(tr('t.removed',quote(x.t)),()=>{S.tasks=S.tasks.filter(t=>t.id!==id)})};
    el('taskForm').onsubmit=e=>{e.preventDefault();
      const title=el('fTitle').value.trim();if(!title)return;
      const day=fromYmd(el('fDay').value),time=day!=null&&el('fTime').value?hm(el('fTime').value):null,due=el('fDueDate').value;
      const next={t:title,proj:el('fProject').value||x.proj,p:+el('fPrio').value,tag:el('fTag').value.trim()||null,day,time,
        dueDate:due||null,dueTime:due&&el('fDueTime').value?el('fDueTime').value:null};
      close();
      act(tr('t.saved',quote(title)),()=>{const t=byId(id);if(!t)return;
        if(next.tag&&!allTags().includes(next.tag))data.labels=[...(data.labels||[]),next.tag];
        Object.assign(t,next)});
    };
  }

  /* ---------- project / tag ---------- */
  function nameForm(title,label,max,done){
    open(title,`<form id="nameForm"><label>${label}<input id="fName" required maxlength="${max}" autocomplete="off"></label><p class="feedback" id="fError" role="alert"></p><div class="actions"><span class="sp"></span><button type="button" class="btn" data-close>${tr('cancel')}</button><button class="btn primary">${tr('create')}</button></div></form>`);
    el('fName').focus();
    el('nameForm').onsubmit=e=>{e.preventDefault();const name=el('fName').value.trim();if(!name)return;const problem=done(name);if(problem)el('fError').textContent=problem};
  }
  const project=()=>nameForm(tr('project.new'),tr('project.name'),32,name=>{
    if(data.projects.includes(name))return tr('project.exists');
    close();act(tr('project.created',name),()=>{data.projects=[...data.projects,name]});st.proj=name;st.nav='all';st.scale='week';render()});
  const tag=()=>nameForm(tr('tag.new'),tr('tag.name'),30,name=>{
    if(allTags().includes(name))return tr('tag.exists');
    close();act(tr('tag.created',name),()=>{data.labels=[...(data.labels||[]),name]})});

  /* ---------- capture tasks from a pasted message (local model) ---------- */
  function message(source=''){
    ++token;
    open(tr('msg.title'),`<p class="hint">${tr('msg.hint')}</p><label>${tr('msg.label')}<textarea id="mSource" maxlength="2400" rows="5" placeholder="${tr('msg.placeholder')}">${esc(source)}</textarea></label><div class="actions"><span class="sp"></span><button type="button" id="mPaste" class="btn">${tr('msg.paste')}</button><button type="button" id="mFind" class="btn primary">${tr('msg.find')}</button></div><div id="mFound" aria-live="polite"></div>`);
    el('mSource').focus();
    const reset=()=>{token++;el('mFound').innerHTML='';el('mFind').disabled=false;el('mFind').textContent=tr('msg.find')};
    el('mSource').oninput=reset;
    el('mPaste').onclick=async()=>{try{const v=await native('paste');if(v.length>2400){Toast.show(tr('msg.tooLong'));return}if(v){el('mSource').value=v;reset()}else Toast.show(tr('msg.noClipboard'))}catch(e){Toast.show(e.message)}};
    const manual=text=>{el('mFound').insertAdjacentHTML('beforeend',`<button type="button" class="btn" id="mManual">${tr('msg.addOne')}</button>`);
      el('mManual').onclick=()=>{close();Features.openCap(text.split(/\r?\n/)[0].slice(0,120))}};
    el('mFind').onclick=async()=>{
      const text=el('mSource').value.trim();if(!text){el('mSource').focus();Toast.show(tr('msg.empty'));return}
      const stamp=++token,button=el('mFind');button.disabled=true;button.textContent=tr('msg.finding');el('mFound').innerHTML=`<p class="hint">${tr('msg.running')}</p>`;
      try{
        const found=await native('extract',{text});
        if(stamp!==token||!isOpen())return;
        if(!found.length){el('mFound').innerHTML=`<p class="hint">${tr('msg.none')}</p>`;manual(text);return}
        review(text,found);
      }catch(e){if(stamp===token&&isOpen()){el('mFound').innerHTML=`<p class="feedback">${esc(e.message)}</p>`;manual(text)}}
      finally{if(stamp===token&&button.isConnected){button.disabled=false;button.textContent=tr('msg.findAgain')}}
    };
  }
  function review(source,items){
    const root=el('mFound'),first=st.proj&&data.projects.includes(st.proj)?st.proj:data.projects[0];
    root.innerHTML=`<h3>${tr('msg.review',items.length)}</h3><datalist id="mTags">${allTags().map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`+
      items.map((t,i)=>`<article class="candidate" data-index="${i}"><div class="ctop"><input type="checkbox" checked aria-label="${tr('msg.select',i+1)}"><input class="ctitle" aria-label="${tr('task.name')}" maxlength="240" value="${esc(t.title)}"></div>
        <div class="formgrid three"><label>${tr('task.project')}<select class="cproject">${options(data.projects,first)}</select></label><label>${tr('task.tag')}<input class="ctag" list="mTags" maxlength="30" value="${esc(t.tag||'')}"></label><label>${tr('task.priority')}<select class="cprio">${options(['0','1','2'],'2',prioLabel)}</select></label></div>
        <details><summary>${tr('task.source')}</summary><blockquote>${esc(t.quote)}</blockquote></details></article>`).join('')+
      `<div class="actions"><label class="toggle-label"><input type="checkbox" id="mToday" checked>${tr('msg.toToday')}</label><span class="sp"></span><button type="button" class="btn primary" id="mAdd">${tr('msg.add')}</button></div>`;
    el('mAdd').onclick=()=>{
      const chosen=[...root.querySelectorAll('.candidate')].filter(c=>c.querySelector('[type=checkbox]').checked).map(c=>({t:c.querySelector('.ctitle').value.trim(),proj:c.querySelector('.cproject').value,
        tag:c.querySelector('.ctag').value.trim()||null,p:+c.querySelector('.cprio').value,src:source,quote:items[+c.dataset.index].quote}));
      if(!chosen.length||chosen.some(t=>!t.t)){Toast.show(tr('msg.pick'));return}
      const fresh=chosen.filter(t=>!S.tasks.some(x=>x.src===t.src&&x.quote===t.quote&&x.t===t.t&&x.proj===t.proj)),today=el('mToday').checked;
      close();
      if(!fresh.length){Toast.show(tr('msg.dupes'));return}
      act(tr('msg.added',fresh.length),()=>{fresh.forEach(t=>{S.tasks.push(newTask({...t,day:today?st.today:null}));if(t.tag&&!allTags().includes(t.tag))data.labels=[...(data.labels||[]),t.tag]})});
      if(!today){st.nav='all';st.scale='week';render()}
    };
  }

  /* ---------- daily wrap-up ---------- */
  function wrapUp(){
    const T=dayList(st.today),done=T.filter(x=>x.done),left=T.filter(x=>!x.done),C=carry();
    const sec=(title,rows)=>`<h3>${title} <span>${rows.length}</span></h3>`+(rows.length?`<ul>${rows.map(x=>`<li>${esc(x.t)}</li>`).join('')}</ul>`:`<p class="hint">${tr('wrap.none')}</p>`);
    open(tr('wrap.title'),`<div class="wrap-summary">${sec(tr('f.done'),done)}${sec(tr('wrap.open'),left)}${C.length?sec(tr('carry'),C):''}</div><div class="actions"><span class="sp"></span><button type="button" class="btn primary" data-close>${tr('done')}</button></div>`);
  }

  /* ---------- connectors ---------- */
  function connectors(){
    open(tr('con.title'),`<div class="connector-list"><section><h3>${tr('con.mail')}</h3><div id="providerRows">${tr('con.checking')}</div><label class="toggle-label"><input type="checkbox" id="showEdgeMail" disabled>${tr('con.edgeMail')}</label></section>
      <section><h3>Codex <small id="codexState">${tr('con.checking')}</small></h3><p>${tr('con.codexHint')}</p><button type="button" id="codexConnection" class="btn" disabled>${tr('con.check')}</button></section>
      <section><h3>Grok Bot</h3><p>${tr('con.grokHint')}</p><button type="button" id="copyGrok" class="btn">${tr('con.copyGrok')}</button></section>
      <section><h3>${tr('con.mcp')}</h3><p>${tr('con.mcpHint')}</p><button type="button" id="copyMCP" class="btn">${tr('con.copyMcp')}</button></section>
      <section><h3>${tr('con.sync')}</h3><button type="button" id="syncNow" class="btn">${tr('con.syncNow')}</button></section></div>`,{label:tr('dlg.back'),back:close});
    ProviderUI.rows();
    const fail=e=>Toast.show(e.message,{ms:5000});
    const mail=el('showEdgeMail');
    native('edgeMailPreference').then(v=>{if(!mail.isConnected)return;mail.checked=v;mail.disabled=false;
      mail.onchange=()=>native('edgeMailPreference',{value:mail.checked}).catch(e=>{mail.checked=!mail.checked;fail(e)})}).catch(fail);
    const button=el('codexConnection'),badge=el('codexState');
    function setCodex(enabled){if(!button.isConnected)return;
      badge.textContent=tr(enabled?'con.enabled':'con.off');button.disabled=false;button.textContent=tr(enabled?'con.codexOff':'con.codexOn');
      button.onclick=()=>{button.disabled=true;native('codexConnection',{enabled:!enabled}).then(setCodex).catch(fail).finally(()=>{if(button.isConnected)button.disabled=false})}}
    native('codexConnection').then(setCodex).catch(fail);
    const copy=(b,kind)=>{b.onclick=()=>native('copyConnectorSetup',{kind}).then(()=>{b.textContent=tr('con.copied')}).catch(fail)};
    copy(el('copyGrok'),'grokBot');copy(el('copyMCP'),'mcp');
    el('syncNow').onclick=()=>native('syncInboxes').then(()=>Toast.show(tr('con.synced'),{ms:1800})).catch(fail);
  }

  document.addEventListener('click',e=>{if(e.target.closest('#dialog [data-close]'))close()});
  document.addEventListener('DOMContentLoaded',()=>{
    modal().addEventListener('cancel',e=>{e.preventDefault();goBack()});
    modal().addEventListener('close',()=>{token++});
  });
  return {open,close,isOpen,hasDraft,task,project,tag,message,wrapUp,connectors};
})();
