'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day = (d=new Date()) => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const shortDate = new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric'});
function plannedDateLabel(date) {
  const parsed = new Date(date + 'T12:00:00');
  return Number.isNaN(parsed.getTime()) ? date : shortDate.format(parsed);
}
const uuid = () => crypto.randomUUID();
const example = 'Maya: Please send the new homepage prototype to the design team before tomorrow afternoon’s review.\nAlex: Got it, thanks!\nMaya: Also, summarize the customer feedback for the product team by Friday.';
let data={version:1,projects:['My Work'],tasks:[]},view='today',tag='',compact=false,dragId='',lastDay=day(),locked=false;
const titles={today:'Today',all:'All tasks',done:'Completed'};
const projectOfView=()=>view.startsWith('p:')?view.slice(2):null;
// Project names are storage keys. Display the original built-in list in English
// without changing task references, even when the user also has a list named My Work.
function projectLabel(name) {
  if (name !== '\u6211\u7684\u5de5\u4f5c' || data.projects[0] !== name) return name;
  return data.projects.includes('My Work') ? 'My Work (original)' : 'My Work';
}
const currentTitle=()=>projectOfView()?projectLabel(projectOfView()):titles[view];
const isToday=t=>t.planned===day() || (!t.done && t.planned && t.planned<day());
const pending=new Map();
function native(op, payload={}){
  const id=uuid();
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject});
    try{window.webkit.messageHandlers.host.postMessage({id,op,...payload})}
    catch(e){pending.delete(id);reject(e)}
  });
}
window.hostReply=(id,ok,value)=>{const p=pending.get(id);if(!p)return;pending.delete(id);ok?p.resolve(value):p.reject(Error(String(value)))};
let toastTimer;
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('toast-show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('toast-show'),3000)}
let writeQueue=Promise.resolve();
function change(fn){
  const write=async()=>{if(locked)throw Error('Shishi could not read the workspace file. Saving is paused.');const next=structuredClone(data);fn(next);await native('save',{state:next});data=next;render()};
  const result=writeQueue.then(write);writeQueue=result.catch(()=>{});return result;
}
function action(p){p.catch(e=>toast(e.message))}
function go(v){view=v;tag='';render()}
const listIcons={today:'calendar',all:'all-tasks',done:'completed'};
const projectTone=name=>'project-'+Math.max(0,data.projects.indexOf(name))%5;
function symbol(name){return '<span class="symbol '+name+'" aria-hidden="true"></span>'}
function navButton(id,label,count){
  const project=id.startsWith('p:'), drop=project||id==='today';
  const icon=project?'<span class="project-dot '+projectTone(label)+'" aria-hidden="true"></span>':symbol(listIcons[id]);
  return '<button data-view="'+esc(id)+'" '+(view===id?'class="active" aria-current="page" ':'')+
    (drop?'data-target="'+esc(id)+'" ':'')+'>'+icon+'<span class="prname">'+esc(project?projectLabel(label):label)+'</span><span class="num">'+(count||'')+'</span></button>';
}
function row(t){
  const showToday=!t.done&&!isToday(t);
  return '<article class="row '+(t.done?'done':'')+'" draggable="'+(!t.done)+'" data-id="'+esc(t.id)+'"><button class="check" data-act="toggle" aria-label="'+(t.done?'Reopen':'Complete')+' '+esc(t.title)+'">'+(t.done?'✓':'')+'</button><button class="task-body" data-act="edit"><span class="title">'+esc(t.title)+'</span><span class="meta"><span class="priority '+esc(t.priority).toLowerCase()+'">'+esc(t.priority)+'</span><span>'+esc(projectLabel(t.project))+'</span>'+(t.tag?'<span>· '+esc(t.tag)+'</span>':'')+(t.planned&&t.planned<day()&&!t.done?'<span>· Scheduled for '+esc(plannedDateLabel(t.planned))+'</span>':'')+'</span></button>'+(showToday?'<button class="rowAction" data-act="today" title="Add to Today">+ Today</button>':'')+'</article>';
}
function render(){
  const tasks=data.tasks,open=tasks.filter(t=>!t.done),today=tasks.filter(isToday),project=projectOfView();
  $('nav').innerHTML=navButton('today','Today',today.filter(t=>!t.done).length)+navButton('all','All tasks',open.length)+navButton('done','Completed',tasks.length-open.length);
  $('projects').innerHTML=data.projects.map(p=>navButton('p:'+p,p,open.filter(t=>t.project===p).length)).join('');
  $('viewIcon').className=project?projectTone(project):view;
  $('viewIcon').innerHTML=symbol(project?'project-list':listIcons[view]);
  $('dateline').textContent=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
  $('pageTitle').textContent=$('crumbView').textContent=currentTitle();
  const pin=$('pin');
  pin.innerHTML=symbol(compact?'expand':'pin')+'<span class="tool-label">'+(compact?'Expand workspace':'Compact view')+'</span>';
  pin.title=compact?'Expand workspace':'Switch to compact view';
  pin.setAttribute('aria-label',pin.title);
  pin.setAttribute('aria-pressed',String(compact));
  $('manual').hidden=view==='done';
  let list=view==='today'?today:view==='done'?tasks.filter(t=>t.done):project?tasks.filter(t=>t.project===project&&!t.done):open;
  const tags=[...new Set(list.map(t=>t.tag).filter(Boolean))];
  const filterable=view!=='today'&&view!=='done';
  if(!filterable||!tags.includes(tag))tag='';
  const filters=filterable&&tags.length?'<div class="tags"><button class="'+(!tag?'active':'')+'" data-tag="">All tags</button>'+tags.map(v=>'<button class="'+(v===tag?'active':'')+'" data-tag="'+esc(v)+'">'+esc(v)+'</button>').join('')+'</div>':'';
  if(tag)list=list.filter(t=>t.tag===tag);
  $('sectionTitle').textContent=({today:'Scheduled',all:'Open tasks',done:'Completed tasks'})[view]||'Project tasks';
  $('count').textContent=list.length+(list.length===1?' task':' tasks');
  const active=list.filter(t=>!t.done),finished=list.filter(t=>t.done);
  const emptyText=view==='today'?'Drag a task here or click + Today next to a project task.':view==='done'?'Tasks appear here when you mark them complete.':'Add a task or capture one from a message.';
  $('tasks').innerHTML=filters+'<div '+(view==='today'?'class="drop" data-target="today"':'')+'>'+(active.map(t=>row(t)).join('')+(finished.length&&view==='today'?'<div class="completed-heading">Completed · '+finished.length+'</div>':'')+finished.map(t=>row(t)).join('')||'<div class="empty">'+emptyText+'</div>')+'</div>';
  let pool='';
  if(view==='today'&&!compact){
    const waiting=open.filter(t=>!isToday(t));
    if(waiting.length)pool='<div class="subhead"><h3>From your projects</h3><small>Drag to Today</small></div>'+data.projects.map(p=>{
      const items=waiting.filter(t=>t.project===p);
      return items.length?'<div class="group"><span class="project-dot '+projectTone(p)+'" aria-hidden="true"></span>'+esc(projectLabel(p))+'</div>'+items.map(t=>row(t)).join(''):'';
    }).join('');
    else if(!tasks.length)pool='<div class="samplebox">New here? <button class="sample" data-demo>Try a sample conversation</button></div>';
  }
  $('pool').innerHTML=pool;
}
let dialogBack=closeDialog;
function dialog(title,body,navigation={}) {
  const modal=$('dialog');
  const backLabel=navigation.label||'Back to workspace';
  dialogBack=navigation.back||closeDialog;
  $('dialogBody').innerHTML='<div class="dialog-head"><button type="button" class="dialog-back" aria-label="'+esc(backLabel)+'">'+symbol('back')+esc(backLabel)+'</button><h2 id="dialogTitle">'+esc(title)+'</h2><button type="button" class="close" data-close title="Close dialog" aria-label="Close dialog">'+symbol('close-icon')+'</button></div>'+body;
  $('dialogBody').querySelector('.dialog-back').onclick=()=>dialogBack();
  modal.scrollTop=0;
  if(!modal.open)modal.showModal();
}
function closeDialog(){if($('dialog').open)$('dialog').close()}
$('dialog').addEventListener('cancel',event=>{event.preventDefault();dialogBack()});
const options=(list,sel,label=String)=>list.map(v=>'<option value="'+esc(v)+'" '+(v===sel?'selected':'')+'>'+esc(label(v))+'</option>').join('');
function taskForm(t){
  const isNew=!t;
  const exists=t&&data.tasks.some(x=>x.id===t.id);
  t=t||{id:uuid(),title:'',project:projectOfView()||data.projects[0],tag:'',priority:'P2',planned:view==='today'?day():'',done:false,source:'',quote:''};
  dialog(isNew?'New task':'Task details','<form id="taskForm"><label>Task<input id="fieldTitle" required maxlength="240" value="'+esc(t.title)+'"></label><div class="formgrid"><label>Project<select id="fieldProject">'+options(data.projects,t.project,projectLabel)+'</select></label><label>Priority<select id="fieldPriority">'+options(['P0','P1','P2'],t.priority)+'</select></label></div><div class="formgrid"><label>Tag<input id="fieldTag" maxlength="30" value="'+esc(t.tag)+'" placeholder="e.g. Design"></label><label>Scheduled date<input id="fieldPlanned" type="date" value="'+esc(t.planned)+'"></label></div>'+(t.source?'<details><summary class="mini-link">Show source message</summary><blockquote>'+esc(t.source)+'</blockquote></details>':'')+'<div class="actions">'+(exists?'<button type="button" class="mini-link" id="removeTask">Remove task</button>':'')+'<button type="button" data-close class="secondary">Cancel</button><button class="primary">Save</button></div></form>');
  $('fieldTitle').focus();
  if(exists)$('removeTask').onclick=async()=>{
    try{await change(s=>{s.tasks=s.tasks.filter(x=>x.id!==t.id)});closeDialog();
      toast('Task removed');clearTimeout(toastTimer);
      const undo=document.createElement('button');undo.className='undo';undo.textContent='Undo';
      undo.onclick=()=>action(change(s=>{if(!s.tasks.some(x=>x.id===t.id))s.tasks.push(t)}).then(()=>toast('Task restored')));
      $('toast').append(undo);toastTimer=setTimeout(()=>$('toast').classList.remove('toast-show'),12000);
    }catch(err){toast(err.message)}
  };
  $('taskForm').onsubmit=async e=>{e.preventDefault();const title=$('fieldTitle').value.trim();if(!title)return;
    const updated={...t,title,project:$('fieldProject').value,tag:$('fieldTag').value.trim(),priority:$('fieldPriority').value,planned:$('fieldPlanned').value};
    try{await change(s=>{const i=s.tasks.findIndex(x=>x.id===updated.id);if(i<0)s.tasks.push(updated);else s.tasks[i]=updated});closeDialog();toast('Task saved')}catch(err){toast(err.message)}
  };
}
function projectForm(){
  dialog('New project','<form id="projectForm"><label>Project name<input id="projectName" required maxlength="32" placeholder="e.g. Client delivery"></label><div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Create project</button></div></form>');
  $('projectName').focus();
  $('projectForm').onsubmit=async e=>{e.preventDefault();const name=$('projectName').value.trim();if(!name)return;
    try{await change(s=>{if(s.projects.includes(name))throw Error('A project with this name already exists.');s.projects.push(name)});closeDialog();go('p:'+name)}catch(err){toast(err.message)}
  };
}
let captureToken=0;
function capture(source=''){
  ++captureToken;
  dialog('Capture tasks','<p class="hint">Paste a chat or meeting notes. Shishi finds tasks on this Mac. Review each suggestion alongside the original message before adding it.</p><label>Message<textarea id="source" maxlength="2400" rows="5" placeholder="Paste a work message here…">'+esc(source)+'</textarea></label><div class="actions"><button id="demoText" class="mini-link">Try an example</button><button id="paste" class="secondary">Paste message</button><button id="recognize" class="primary">Find tasks</button></div><div id="candidates" aria-live="polite"></div>');
  $('source').focus();
  const reset=()=>{captureToken++;$('candidates').innerHTML='';$('recognize').disabled=false;$('recognize').textContent='Find tasks'};
  $('source').oninput=reset;
  $('demoText').onclick=()=>{$('source').value=example;reset()};
  $('paste').onclick=async()=>{try{const v=await native('paste');if(v.length>2400){toast('This message is over 2,400 characters. Paste it in shorter sections.');return}if(v){$('source').value=v;reset()}else toast('The clipboard has no text.')}catch(e){toast(e.message)}};
  $('recognize').onclick=async()=>{
    const text=$('source').value.trim();if(!text){$('source').focus();toast('Enter a message first.');return}
    const stamp=++captureToken,button=$('recognize');button.disabled=true;button.textContent='Finding tasks…';$('candidates').innerHTML='<p class="hint">Qwen is running on this Mac. The first run may take a few seconds.</p>';
    try{
      const suggestions=await native('extract',{text});
      if(stamp!==captureToken||!$('dialog').open)return;
      if(!suggestions.length){$('candidates').innerHTML='<p class="hint">No clear tasks found. Add more context or enter a task manually.</p><button id="useManual" class="secondary">Add a task</button>';$('useManual').onclick=()=>manualFromText(text);return}
      review(text,suggestions);
    }catch(e){if(stamp===captureToken&&$('dialog').open){$('candidates').innerHTML='<p class="feedback">'+esc(e.message)+'</p><button id="useManual" class="secondary">Add a task</button>';$('useManual').onclick=()=>manualFromText(text)}}
    finally{if(stamp===captureToken&&button.isConnected){button.disabled=false;button.textContent='Find tasks again'}}
  };
}
function manualFromText(text){
  taskForm({id:uuid(),title:'',project:projectOfView()||data.projects[0],tag:'',priority:'P2',planned:'',done:false,source:text,quote:text});
}
function review(source,items){
  const root=$('candidates');
  root.innerHTML='<div class="subhead"><h3>Review suggestions · '+items.length+'</h3><small>Source messages included</small></div>'+items.map((t,i)=>'<div class="candidate" data-index="'+i+'"><div class="ctop"><input type="checkbox" checked aria-label="Select task '+(i+1)+'"><input class="candidate-title" aria-label="Task title" maxlength="240" value="'+esc(t.title)+'"></div><blockquote>'+esc(t.quote)+'</blockquote><div class="formgrid"><label>Project<select class="cproject">'+options(data.projects,projectOfView()||data.projects[0],projectLabel)+'</select></label><label>Tag<input class="ctag" maxlength="30" value="'+esc(t.tag)+'"></label></div></div>').join('')+'<div class="actions"><button class="primary" id="confirm">Add selected tasks</button></div>';
  $('confirm').onclick=async()=>{
    const button=$('confirm');button.disabled=true;
    const chosen=[...root.querySelectorAll('.candidate')].filter(el=>el.querySelector('[type=checkbox]').checked).map(el=>{const item=items[Number(el.dataset.index)];return {id:uuid(),title:el.querySelector('.candidate-title').value.trim(),project:el.querySelector('.cproject').value,tag:el.querySelector('.ctag').value.trim(),priority:'P2',planned:'',done:false,source,quote:item.quote}});
    try{
      if(!chosen.length||chosen.some(t=>!t.title))throw Error('Select at least one task and give each selected task a title.');
      let added=0;await change(s=>{for(const t of chosen){if(!s.tasks.some(x=>x.source===t.source&&x.quote===t.quote&&x.title===t.title&&x.project===t.project)){s.tasks.push(t);added++}}});
      closeDialog();go('all');toast(added?'Added '+added+(added===1?' task':' tasks'):'These tasks are already on your list.')
    }catch(e){button.disabled=false;toast(e.message)}
  };
}
function schedule(id,target,before=''){
  return change(s=>{let i=s.tasks.findIndex(t=>t.id===id);if(i<0)return;const t=s.tasks[i];if(t.done)return;
    if(target==='today'){t.planned=day();if(before&&before!==id){s.tasks.splice(i,1);const j=s.tasks.findIndex(x=>x.id===before);s.tasks.splice(j<0?s.tasks.length:j,0,t)}}
    else if(target.startsWith('p:')&&s.projects.includes(target.slice(2)))t.project=target.slice(2);
  });
}
document.addEventListener('click',e=>{
  if(e.target.closest('[data-close]')){closeDialog();return}
  const b=e.target.closest('[data-view]');if(b){go(b.dataset.view);return}
  const f=e.target.closest('[data-tag]');if(f){tag=f.dataset.tag;render();return}
  if(e.target.closest('[data-demo]')){capture(example);return}
  const a=e.target.closest('[data-act]');if(!a)return;
  const t=data.tasks.find(x=>x.id===a.closest('.row').dataset.id);if(!t)return;
  if(a.dataset.act==='edit')taskForm(t);
  if(a.dataset.act==='toggle')action(change(s=>{const x=s.tasks.find(v=>v.id===t.id);x.done=!x.done}));
  if(a.dataset.act==='today')action(schedule(t.id,'today').then(()=>toast('Added to Today')));
});
document.addEventListener('dragstart',e=>{const r=e.target.closest('.row[draggable=true]');if(!r)return;dragId=r.dataset.id;e.dataTransfer.setData('text/plain',dragId);e.dataTransfer.effectAllowed='move'});
document.addEventListener('dragover',e=>{const zone=e.target.closest('[data-target]');if(!dragId||!zone)return;e.preventDefault();e.dataTransfer.dropEffect='move';zone.classList.add('over')});
document.addEventListener('dragleave',e=>{const zone=e.target.closest('[data-target]');if(zone&&!zone.contains(e.relatedTarget))zone.classList.remove('over')});
document.addEventListener('drop',e=>{const zone=e.target.closest('[data-target]');if(!dragId||!zone)return;e.preventDefault();const dest=zone.dataset.target;const id=dragId;const before=e.target.closest('.row')?.dataset.id||'';dragId='';action(schedule(id,dest,before).then(()=>toast(dest==='today'?'Today updated':'Task moved to project')));zone.classList.remove('over')});
document.addEventListener('dragend',()=>{dragId='';document.querySelectorAll('.over').forEach(x=>x.classList.remove('over'))});
$('openCapture').onclick=()=>capture();$('newProject').onclick=projectForm;$('manual').onclick=()=>taskForm();
$('pin').onclick=async()=>{try{await native('compact',{value:!compact})}catch(e){toast(e.message)}};
$('dialog').addEventListener('close',()=>{captureToken++});
window.setCompact=v=>{compact=v;document.body.classList.toggle('compact',v);if(v){
  const preview=document.querySelector('#latestResult .result-preview[aria-expanded="true"]');
  if(preview)preview.click();
  go('today');
}else render()};
window.showWorkspaceHome=()=>{
  // A draft the user began earlier stays on screen when returning from the edge.
  if($('dialog').open && ($('dialogBody').querySelector('input:not([type=checkbox]),textarea,select')))return;
  closeDialog();
};
window.openMessage=text=>{capture(text||'')};
document.addEventListener('keydown',e=>{if(e.metaKey&&e.key==='n'){e.preventDefault();taskForm()}});
setInterval(()=>{if(lastDay!==day()){lastDay=day();render()}},30000);
document.addEventListener('DOMContentLoaded',async()=>{try{const s=await native('load');if(s)data=s;render();await native('ready')}catch(e){locked=true;render();$('tasks').textContent='Shishi could not load your lists. Saving is paused to protect your data. '+e.message}});
