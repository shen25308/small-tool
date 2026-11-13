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
const listIcons={today:'day-star',all:'project-list',done:'completed'};
const projectTone=name=>'project-'+Math.max(0,data.projects.indexOf(name))%5;
function symbol(name){return '<span class="symbol '+name+'" aria-hidden="true"></span>'}
function navButton(id,label,count){
  const project=id.startsWith('p:'), drop=project||id==='today';
  const icon=symbol(project?'folder-icon':listIcons[id]);
  return '<button data-view="'+esc(id)+'" '+(view===id?'class="active" aria-current="page" ':'')+
    (drop?'data-target="'+esc(id)+'" ':'')+'>'+icon+'<span class="prname">'+esc(project?projectLabel(label):label)+'</span><span class="num">'+(count||'')+'</span></button>';
}
const collapsedProjects = new Set();
const suggestedTags = {'Leadership':0, 'Urgent':1, 'This week':2, 'Product insights':3, 'Feedback':4, 'Later':5, 'Today':6, 'Long-term':4, 'Leader follow-up':1};

function availableTaskTags() {
  return [...new Set([...data.tasks.map(item => item.tag).filter(Boolean), ...(data.labels || []), ...Object.keys(suggestedTags)])];
}

function taskTagColor(name) {
  if (Object.hasOwn(suggestedTags, name)) return 'tag-tone-' + suggestedTags[name];
  let value = 0;
  for (const char of name) value = (value * 31 + char.codePointAt(0)) >>> 0;
  return 'tag-tone-' + value % 7;
}

function row(t) {
  const title = esc(t.title);
  const addToday = !t.done && !isToday(t);
  const priority = ['P0', 'P1', 'P2'].includes(t.priority) ? t.priority.toLowerCase() : '';
  const tagLabel = t.tag || '+ Tag';
  const planned = t.planned && !t.done && t.planned !== day() ?
    '<time class="planned-day" datetime="' + esc(t.planned) + '" title="Scheduled for ' + esc(plannedDateLabel(t.planned)) + '">' + esc(plannedDateLabel(t.planned)) + '</time>' : '';
  return '<article class="row' + (t.done ? ' done' : '') + '" draggable="' + !t.done + '" data-id="' + esc(t.id) + '">' +
    '<button class="check" data-act="toggle" aria-pressed="' + !!t.done + '" aria-label="' + (t.done ? 'Reopen ' : 'Complete ') + title + '">' + (t.done ? '✓' : '') + '</button>' +
    '<button class="priority ' + priority + '" data-act="priority" aria-haspopup="dialog" aria-label="Edit priority for ' + title + '">' + esc(t.priority || 'Priority') + '</button>' +
    '<button class="task-body" data-act="edit" title="' + title + '"><span class="title">' + title + '</span></button>' +
    '<button class="task-tag ' + (t.tag ? taskTagColor(t.tag) : 'no-tag') + '" data-act="tag" aria-haspopup="dialog" aria-label="Edit tag for ' + title + '" title="' + esc(tagLabel) + '">' + esc(tagLabel) + '</button>' +
    planned +
    '<button class="task-deadline' + (t.dueDate ? ' has-deadline' : ' no-deadline') + (isOverdue(t) ? ' overdue' : '') + '" data-act="deadline" aria-haspopup="dialog" aria-label="Edit deadline for ' + title + '" title="' + (isOverdue(t) ? 'Overdue · ' : '') + esc(deadlineLabel(t)) + '">' +
    (t.dueDate ? deadlineMarkup(t) : '<span class="symbol clock-mark" aria-hidden="true"></span>') + '</button>' +
    (addToday ? '<button class="rowAction" data-act="today" title="Add to Today" aria-label="Add ' + title + ' to Today">+ Today</button>' : '') +
    '</article>';
}

function addTaskButton(project) {
  const target = project == null ? 'data-add-current' : 'data-add-project="' + esc(project) + '"';
  return '<button type="button" class="inline-add" ' + target + '><span aria-hidden="true">+</span>Add task</button>';
}

function projectGroup(project, tasks, index) {
  const isOpen = !collapsedProjects.has(project);
  const groupId = 'project-group-' + index;
  return '<section class="task-group" data-target="' + esc('p:' + project) + '">' +
    '<button type="button" class="group-toggle" data-group="' + esc(project) + '" aria-expanded="' + isOpen + '" aria-controls="' + groupId + '">' +
    '<span class="disclosure" aria-hidden="true"></span>' + symbol('project-list') +
    '<span class="group-name">' + esc(projectLabel(project)) + '</span><span class="group-count">' + tasks.length + '</span></button>' +
    '<div id="' + groupId + '"' + (isOpen ? '' : ' hidden') + '>' +
    sortVisibleTasks(tasks).map(row).join('') + addTaskButton(project) + '</div></section>';
}

function deadlineLabel(task) {
  if (!task.dueDate) return 'Set deadline';
  const date = plannedDateLabel(task.dueDate);
  if (!task.dueTime) return date;
  const time = new Date(task.dueDate + 'T' + task.dueTime);
  return Number.isNaN(time.getTime()) ? date : date + ' ' + time.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
}

// The time is a separate span so the compact card can show the date alone.
function deadlineMarkup(task) {
  const label = deadlineLabel(task), date = plannedDateLabel(task.dueDate);
  return label.startsWith(date + ' ') ? esc(date) + '<span class="due-time"> ' + esc(label.slice(date.length + 1)) + '</span>' : esc(label);
}

function isOverdue(task) {
  if (!task.dueDate || task.done) return false;
  if (task.dueDate !== day()) return task.dueDate < day();
  return !!task.dueTime && new Date(task.dueDate + 'T' + task.dueTime) < new Date();
}

function placeTaskPicker(picker, anchor) {
  document.querySelector('.task-picker')?.remove();
  picker.setAttribute('popover', 'auto');
  picker.setAttribute('role', 'dialog');
  picker.addEventListener('toggle', event => {
    if (event.newState !== 'closed') return;
    picker.remove();
    if (anchor.isConnected && document.activeElement === document.body) anchor.focus();
  });
  document.body.append(picker);
  picker.showPopover();
  const pos = anchor.getBoundingClientRect();
  const rect = picker.getBoundingClientRect();
  picker.style.left = Math.max(6, Math.min(pos.left, innerWidth - rect.width - 6)) + 'px';
  picker.style.top = Math.max(6, Math.min(pos.bottom + 4, innerHeight - rect.height - 6)) + 'px';
}

function editDeadline(anchor, task) {
  const picker = document.createElement('div');
  picker.className = 'task-picker deadline-picker';
  picker.setAttribute('aria-label', 'Deadline');
  picker.innerHTML = '<form><h3>Deadline</h3><label>Due date<input type="date" name="date" required></label>' +
    '<label>Time (optional)<input type="time" name="time"></label><div class="deadline-actions">' +
    (task.dueDate ? '<button type="button" class="mini-link" data-clear-deadline>Clear deadline</button>' : '') +
    '<button type="button" class="secondary" data-cancel-deadline>Cancel</button><button class="primary" type="submit">Save</button></div></form>';
  const form = picker.querySelector('form');
  form.elements.date.value = task.dueDate || day();
  form.elements.time.value = task.dueTime || '';
  function save(date, time) {
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(button => {button.disabled = true});
    action(change(state => {
      const current = state.tasks.find(item => item.id === task.id);
      if (!current) return;
      if (date) {
        current.dueDate = date;
        if (time) current.dueTime = time;
        else delete current.dueTime;
      } else {
        delete current.dueDate;
        delete current.dueTime;
      }
    }).then(() => {
      picker.hidePopover();
      document.querySelector('.row[data-id="' + CSS.escape(task.id) + '"] [data-act="deadline"]')?.focus();
    }).finally(() => buttons.forEach(button => {button.disabled = false})));
  }
  form.onsubmit = event => {event.preventDefault(); save(form.elements.date.value, form.elements.time.value)};
  picker.querySelector('[data-cancel-deadline]').onclick = () => picker.hidePopover();
  const clear = picker.querySelector('[data-clear-deadline]');
  if (clear) clear.onclick = () => save('', '');
  placeTaskPicker(picker, anchor);
  form.elements.date.focus();
}

function showTaskPicker(anchor, task, field) {
  const isTag = field === 'tag';
  const picker = document.createElement('div');
  picker.className = 'task-picker';
  picker.setAttribute('aria-label', isTag ? 'Choose a tag' : 'Choose a priority');
  const choices = isTag
    ? availableTaskTags()
    : ['P0', 'P1', 'P2'];
  picker.innerHTML = (isTag ? '<form><input aria-label="Find or create a tag" placeholder="Find or create a tag…" maxlength="30" autocomplete="off"></form>' : '') +
    '<div class="picker-options"></div>';
  const choicesBox = picker.querySelector('.picker-options');
  const input = picker.querySelector('input');
  function showChoices() {
    const search = input?.value.trim() ?? '';
    const filtered = choices.filter(value => value.toLowerCase().includes(search.toLowerCase()));
    const current = task[field];
    choicesBox.innerHTML = filtered.map(value => '<button type="button" data-choice="' + esc(value) + '" aria-pressed="' + (current === value) + '">' +
      '<span class="' + (isTag ? 'task-tag ' + taskTagColor(value) : 'priority ' + value.toLowerCase()) + '">' + esc(value) + '</span>' +
      (value === current ? '<span class="chosen" aria-hidden="true">✓</span>' : '') + '</button>').join('') +
      (search && !choices.includes(search) ? '<button type="button" data-choice="' + esc(search) + '">Create “' + esc(search) + '”</button>' : '') +
      (isTag && current ? '<button type="button" class="clear-tag" data-choice="">Remove tag</button>' : '');
  }
  let picked = false;
  function select(value) {
    if (picked) return;
    picked = true;
    const save = change(state => {
      const current = state.tasks.find(item => item.id === task.id);
      if (current) current[field] = value;
    });
    action(save.then(() => {
      picker.hidePopover();
      document.querySelector('.row[data-id="' + CSS.escape(task.id) + '"] [data-act="' + field + '"]')?.focus();
    }).catch(error => { picked = false; throw error }));
  }
  if (input) {
    input.oninput = showChoices;
    picker.querySelector('form').onsubmit = event => {
      event.preventDefault();
      if (input.value.trim()) select(input.value.trim());
    };
  }
  picker.onclick = event => {
    const button = event.target.closest('[data-choice]');
    if (button) select(button.dataset.choice);
  };
  picker.onkeydown = event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...choicesBox.querySelectorAll('button')];
    if (!buttons.length) return;
    event.preventDefault();
    const i = buttons.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? i + 1 : (i < 0 ? buttons.length - 1 : i - 1);
    buttons[(next + buttons.length) % buttons.length].focus();
  };
  showChoices();
  placeTaskPicker(picker, anchor);
  (input ?? choicesBox.querySelector('button[aria-pressed=true],button'))?.focus();
}
function render(){
  const tasks=data.tasks,open=tasks.filter(t=>!t.done),today=tasks.filter(isToday),project=projectOfView();
  $('nav').innerHTML=navButton('today','Today',today.filter(t=>!t.done).length)+navButton('all','All tasks',open.length)+navButton('done','Completed',tasks.length-open.length);
  $('projects').innerHTML=data.projects.map(p=>navButton('p:'+p,p,open.filter(t=>t.project===p).length)).join('');
  $('viewIcon').className=project?projectTone(project):view;
  $('viewIcon').innerHTML=symbol(project?'folder-icon':listIcons[view]);
  $('dateline').textContent=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
  $('pageTitle').textContent=tag || currentTitle();
  $('wrapUp').hidden=view!=='today';
  const finished=today.filter(t=>t.done).length;
  $('dayProgress').hidden=view!=='today'||!today.length;
  $('dayProgress').style.setProperty('--done',(today.length?Math.round(finished/today.length*100):0)+'%');
  $('dayProgressLabel').textContent=finished===today.length?'All '+today.length+' done':finished+' of '+today.length+' done';
  renderBoardTags();
  const pin=$('pin');
  pin.innerHTML=symbol(compact?'expand':'pin')+'<span class="tool-label">'+(compact?'Expand workspace':'Compact view')+'</span>';
  pin.title=compact?'Expand workspace':'Switch to compact view';
  pin.setAttribute('aria-label',pin.title);
  pin.setAttribute('aria-pressed',String(compact));
  $('manual').hidden=view==='done';
  let list = view === 'today' ? today : view === 'done' ? tasks.filter(t => t.done)
    : project ? tasks.filter(t => t.project === project) : open;
  const tags = [...new Set(list.map(t => t.tag).filter(Boolean))];
  const filterable = view !== 'today' && view !== 'done';
  if (!filterable || !(view === 'all' ? availableTaskTags() : tags).includes(tag)) tag = '';
  const filters = filterable && tags.length ? '<div class="tags task-filters"><button data-tag="" class="' + (!tag ? 'active' : '') + '">All tags</button>' +
    tags.map(value => '<button data-tag="' + esc(value) + '" class="' + (value === tag ? 'active' : '') + '">' + esc(value) + '</button>').join('') + '</div>' : '';
  if (tag) list = list.filter(t => t.tag === tag);
  $('sectionTitle').textContent = ({today:'Today', all:'Open tasks', done:'Completed tasks'})[view] || 'Project tasks';
  $('count').textContent = list.length + (list.length === 1 ? ' task' : ' tasks');
  const empty = tag ? 'No tasks with this tag.' : view === 'today' ? 'Drop tasks here to plan your day.' :
    view === 'done' ? 'Completed tasks appear here.' : 'No tasks in this list.';
  const add = view !== 'done' ? addTaskButton(project) : '';
  const listAttrs = view === 'today' ? 'class="task-list drop" data-target="today"' : 'class="task-list"';
  $('tasks').innerHTML = filters + '<div ' + listAttrs + '>' +
    (sortVisibleTasks(list).map(row).join('') || '<div class="empty task-empty">' + empty + '</div>') + add + '</div>';

  let groups = '';
  if (view === 'today') {
    const waiting = tasks.filter(t => !isToday(t));
    groups = '<div class="plan-head"><h2>Plan</h2><p>Drag a task up into Today, or use its + Today action.</p></div>' + data.projects.map((name, index) => projectGroup(name, waiting.filter(t => t.project === name), index)).join('') +
      '<button type="button" class="inline-add new-group" data-new-group><span aria-hidden="true">+</span>New project</button>';
  }
  $('pool').innerHTML = groups;

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
function taskForm(t, context = {}){
  const isNew=!t;
  const exists=t&&data.tasks.some(x=>x.id===t.id);
  t=t||{id:uuid(),title:'',project:context.project ?? projectOfView() ?? data.projects[0],tag:'',priority:'P2',planned:context.project ? '' : view==='today'?day():'',done:false,source:'',quote:''};
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
  const reset=()=>{captureToken++;$('candidates').innerHTML='';$('recognize').disabled=false;$('recognize').removeAttribute('aria-busy');$('recognize').textContent='Find tasks'};
  $('source').oninput=reset;
  $('demoText').onclick=()=>{$('source').value=example;reset()};
  $('paste').onclick=async()=>{try{const v=await native('paste');if(v.length>2400){toast('This message is over 2,400 characters. Paste it in shorter sections.');return}if(v){$('source').value=v;reset()}else toast('The clipboard has no text.')}catch(e){toast(e.message)}};
  $('recognize').onclick=async()=>{
    const text=$('source').value.trim();if(!text){$('source').focus();toast('Enter a message first.');return}
    const stamp=++captureToken,button=$('recognize');button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Finding tasks…';$('candidates').innerHTML='<p class="hint is-working">Qwen is running on this Mac. The first run may take a few seconds.</p>';
    try{
      const suggestions=await native('extract',{text});
      if(stamp!==captureToken||!$('dialog').open)return;
      if(!suggestions.length){$('candidates').innerHTML='<p class="hint">No clear tasks found. Add more context or enter a task manually.</p><button id="useManual" class="secondary">Add a task</button>';$('useManual').onclick=()=>manualFromText(text);return}
      review(text,suggestions);
    }catch(e){if(stamp===captureToken&&$('dialog').open){$('candidates').innerHTML='<p class="feedback">'+esc(e.message)+'</p><button id="useManual" class="secondary">Add a task</button>';$('useManual').onclick=()=>manualFromText(text)}}
    finally{if(button.isConnected)button.removeAttribute('aria-busy');if(stamp===captureToken&&button.isConnected){button.disabled=false;button.textContent='Find tasks again'}}
  };
}
function manualFromText(text){
  taskForm({id:uuid(),title:'',project:projectOfView()||data.projects[0],tag:'',priority:'P2',planned:'',done:false,source:text,quote:text});
}
function review(source,items){
  const root=$('candidates');
  root.innerHTML='<div class="subhead"><h3>Review '+items.length+(items.length===1?' task':' tasks')+'</h3></div>'+
    '<datalist id="captureTags">'+availableTaskTags().map(name=>'<option value="'+esc(name)+'">').join('')+'</datalist>'+
    items.map((t,i)=>'<article class="candidate" data-index="'+i+'"><div class="ctop"><input type="checkbox" checked aria-label="Select task '+(i+1)+'"><input class="candidate-title" aria-label="Task title" maxlength="240" value="'+esc(t.title)+'"></div>'+
      '<div class="formgrid"><label>Project<select class="cproject">'+options(data.projects,projectOfView()||data.projects[0],projectLabel)+'</select></label>'+
      '<label>Tag<input class="ctag" list="captureTags" maxlength="30" value="'+esc(t.tag)+'"></label>'+
      '<label>Priority<select class="cpriority">'+options(['P0','P1','P2'],['P0','P1','P2'].includes(t.priority)?t.priority:'P2')+'</select></label></div>'+
      '<details class="candidate-source"><summary>Source message</summary><blockquote>'+esc(t.quote)+'</blockquote></details></article>').join('')+
    '<div class="actions"><button class="primary" id="confirm">'+(items.length===1?'Add task':'Add selected tasks')+'</button></div>';
  $('confirm').onclick=async()=>{
    const button=$('confirm');button.disabled=true;
    const chosen=[...root.querySelectorAll('.candidate')].filter(el=>el.querySelector('[type=checkbox]').checked).map(el=>{const item=items[Number(el.dataset.index)];return {id:uuid(),title:el.querySelector('.candidate-title').value.trim(),project:el.querySelector('.cproject').value,tag:el.querySelector('.ctag').value.trim(),priority:el.querySelector('.cpriority').value,planned:'',done:false,source,quote:item.quote}});
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
  const group=e.target.closest('[data-group]');
  if(group){
    const opening=group.getAttribute('aria-expanded')==='false';
    if(opening)collapsedProjects.delete(group.dataset.group);else collapsedProjects.add(group.dataset.group);
    group.setAttribute('aria-expanded',String(opening));
    $(group.getAttribute('aria-controls')).hidden=!opening;
    return;
  }
  const add=e.target.closest('[data-add-project],[data-add-current]');
  if(add){taskForm(null,add.hasAttribute('data-add-project')?{project:add.dataset.addProject}:{});return}
  if(e.target.closest('[data-new-group]')){projectForm();return}
  const f=e.target.closest('[data-tag]');if(f){tag=f.dataset.tag;render();return}
  if(e.target.closest('[data-demo]')){capture(example);return}
  const a=e.target.closest('[data-act]');if(!a)return;
  const t=data.tasks.find(x=>x.id===a.closest('.row').dataset.id);if(!t)return;
  if(a.dataset.act==='edit')taskForm(t);
  if(a.dataset.act==='deadline')editDeadline(a,t);
  if(a.dataset.act==='tag'||a.dataset.act==='priority')showTaskPicker(a,t,a.dataset.act);
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
document.addEventListener('DOMContentLoaded',async()=>{try{const s=await native('load');if(s)data=s;render();await native('ready')}catch(e){locked=true;render();$('tasks').innerHTML='<div class="load-error" role="alert"><b>Shishi could not load your lists.</b>Saving is paused to protect your data. '+esc(e.message)+'</div>'}});
