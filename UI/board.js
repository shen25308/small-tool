'use strict';

function sortVisibleTasks(items) {
  const order = $('taskSort').value;
  if (order === 'manual') return items;
  if (order === 'priority') return [...items].sort((a,b) => (a.priority || 'P2').localeCompare(b.priority || 'P2'));
  const deadline = task => (task.dueDate || '9999-12-31') + 'T' + (task.dueTime || '23:59');
  return [...items].sort((a,b) => deadline(a).localeCompare(deadline(b)));
}

function renderBoardTags() {
  const counts = new Map();
  for (const task of data.tasks) {
    if (task.tag && !task.done) counts.set(task.tag,(counts.get(task.tag) || 0) + 1);
  }
  $('labels').innerHTML = availableTaskTags().map(name =>
    '<button data-board-tag="'+esc(name)+'" title="'+esc(name)+'"'+(view==='all' && tag===name?' class="active" aria-current="page"':'')+'>'+
    '<span class="tag-bullet '+taskTagColor(name)+'" aria-hidden="true"></span><span class="prname">'+esc(name)+'</span>'+
    '<span class="num">'+(counts.get(name) || '')+'</span></button>').join('');
}

$('labels').addEventListener('click', event => {
  const button = event.target.closest('[data-board-tag]');
  if (!button) return;
  view='all'; tag=button.dataset.boardTag; render();
  document.querySelector('main .content').scrollTop=0;
});

$('newTag').onclick=()=>{
  dialog('New tag','<form id="tagForm"><label>Tag name<input id="tagName" maxlength="30" required autocomplete="off"></label><div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Create tag</button></div></form>');
  $('tagName').focus();
  $('tagForm').onsubmit=event=>{
    event.preventDefault();
    const name=$('tagName').value.trim();
    if (!name) return;
    if (availableTaskTags().includes(name)) { toast('This tag already exists.'); return }
    action(change(state=>{state.labels=[...new Set([...(state.labels || []),name])]}).then(()=>{closeDialog();view='all';tag=name;render()}));
  };
};

function openTaskSearch() {
  dialog('Search','<label class="reader-only" for="searchQuery">Search tasks and projects</label><input id="searchQuery" type="search" placeholder="Search tasks, tags, or projects…" autocomplete="off"><div id="searchMatches"></div>');
  const input=$('searchQuery');
  function matches() {
    const value=input.value.trim().toLocaleLowerCase();
    const projects=data.projects.filter(p=>projectLabel(p).toLocaleLowerCase().includes(value));
    const tasks=data.tasks.filter(t=>[t.title,projectLabel(t.project),t.tag].join(' ').toLocaleLowerCase().includes(value));
    const projectRows=projects.map(p=>'<button type="button" data-search-project="'+esc(p)+'">'+symbol('folder-icon')+esc(projectLabel(p))+'</button>').join('');
    const taskRows=tasks.map(t=>'<button type="button" data-search-task="'+esc(t.id)+'"><span class="search-result-priority">'+esc(t.priority)+'</span><span>'+esc(t.title)+'</span></button>').join('');
    $('searchMatches').innerHTML=(projectRows?'<h3>Projects</h3>'+projectRows:'')+(taskRows?'<h3>Tasks</h3>'+taskRows:'')||'<p class="hint">No matches.</p>';
  }
  input.oninput=matches;
  $('searchMatches').onclick=event=>{
    const task=event.target.closest('[data-search-task]'), project=event.target.closest('[data-search-project]');
    if (task) {const record=data.tasks.find(t=>t.id===task.dataset.searchTask);if(record)taskForm(record)}
    if (project) {closeDialog();go('p:'+project.dataset.searchProject)}
  };
  matches(); input.focus();
}

$('wrapUp').onclick=()=>{
  const today=data.tasks.filter(isToday);
  const done=today.filter(t=>t.done), open=today.filter(t=>!t.done);
  const section=(title,rows)=>'<h3>'+title+' <span>'+rows.length+'</span></h3>'+
    (rows.length?'<ul>'+rows.map(t=>'<li>'+esc(t.title)+'</li>').join('')+'</ul>':'<p class="hint">None</p>');
  dialog('Daily wrap-up','<div class="wrap-summary">'+section('Completed',done)+section('Still open',open)+'</div><div class="actions"><button class="primary" data-close>Done</button></div>');
};

$('taskSort').onchange=render;
$('searchTasks').onclick=openTaskSearch;
document.addEventListener('keydown',event=>{
  if (event.metaKey && event.key.toLowerCase()==='f' && !$('dialog').open) {
    event.preventDefault();openTaskSearch();
  }
});

const menu=$('boardMenu');
menu.addEventListener('beforetoggle',event=>{
  if (event.newState!=='open') return;
  const box=$('boardMore').getBoundingClientRect();
  menu.style.top=Math.round(box.bottom+5)+'px';
  menu.style.right=Math.max(6,Math.round(innerWidth-box.right))+'px';
  $('peekLatest').disabled=$('latestResult').hidden;
});
menu.addEventListener('click',event=>{if(event.target.closest('button'))menu.hidePopover()});
$('peekLatest').onclick=()=>{
  $('latestPeek').hidden=false;
  $('latestPeek').scrollIntoView({block:'nearest'});
  $('latestCard').querySelector('.result-preview')?.focus();
};
$('closePeek').onclick=()=>{
  const preview=$('latestCard').querySelector('.result-preview[aria-expanded="true"]');
  if (preview) preview.click();
  $('latestPeek').hidden=true;
  $('boardMore').focus();
};
