'use strict';
const inboxes = new Map();
const inboxErrors = new Map();
let selectedInboxSource = '';
let lastManualScan = '';

function allNotices() {
  return [...inboxes.values()].flat().sort((a,b) => b.time-a.time || a.id.localeCompare(b.id));
}
const sourceName = ResultUI.sourceName;
function inboxDate(seconds) {
  return new Intl.DateTimeFormat('en-US',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(seconds*1000));
}
function inboxBadge() {
  const count=allNotices().filter(note=>!note.read&&!note.archived).length;
  $('inboxBadge').textContent=count>99?'99+':String(count);
  $('inboxBadge').hidden=!count;
  $('inboxButton').setAttribute('aria-label','Inbox, '+count+' unread');
}
let resultLimit=30;
const cardOptions={
  read:note=>action(readNotice(note)),
  // Per-result state controls. Each change can be undone from the message that confirms it.
  state:(note,fields)=>{
    const current=allNotices().find(item=>item.id===note.id)||note;
    const label='read' in fields?(fields.read?'Marked read':'Marked unread'):(fields.archived?'Archived':'Moved back to the inbox');
    setStates([current],fields,label);
  },
  open:note=>action(note.thread?native('openCodex',{thread:note.thread}):native('openConnectorLink',{key:note.id})),
  // A finished result often leaves something to check. Keep it as a task for today.
  task:note=>{
    const title=ResultUI.digest(note).headline||note.title;
    const follow=newTask({title:('Follow up: '+title).slice(0,240),planned:day(),source:(note.summary||'').slice(0,2400),quote:sourceName(note)+' · '+note.title});
    action(change(state=>{follow.project=state.projects.includes(follow.project)?follow.project:state.projects[0];state.tasks.push(follow)}).then(()=>toast('Added to Today')));
  }
};
const ARCHIVED='__archived';
// The results the inbox currently shows: one source, all sources, or the archive.
function noticesInView() {
  const all=allNotices();
  if(selectedInboxSource===ARCHIVED)return all.filter(note=>note.archived);
  const live=all.filter(note=>!note.archived);
  return selectedInboxSource?live.filter(note=>sourceName(note)===selectedInboxSource):live;
}
// Change read or archived state for some results, with Undo that restores exactly what each one was (F04).
function setStates(notes,fields,message) {
  if(!notes.length)return;
  const before=notes.map(note=>({note,read:!!note.read,archived:!!note.archived}));
  action(notes.reduce((chain,note)=>chain.then(()=>setNoticeState(note,fields)),Promise.resolve()).then(()=>{
    toast(message,()=>action(before.reduce((chain,item)=>chain.then(()=>setNoticeState(item.note,{read:item.read,archived:item.archived})),Promise.resolve())));
  }));
}
const plural=(count,word)=>count+' '+word+(count===1?'':'s');
function markAllRead(everywhere=false) {
  const unread=(everywhere?allNotices().filter(note=>!note.archived):noticesInView()).filter(note=>!note.read);
  setStates(unread,{read:true},'Marked '+plural(unread.length,'result')+' read');
}
// Opens the inbox on one result, for example from the Agents list.
function openNotice(id) {
  selectedInboxSource='';
  const position=allNotices().findIndex(note=>note.id===id);
  if(position>=resultLimit)resultLimit=position+1;
  listNotices();
  const card=[...document.querySelectorAll('#inboxCards .result-card')].find(node=>node.dataset.notice===id);
  if(!card)return;
  const preview=card.querySelector('.result-preview');
  if(preview?.getAttribute('aria-expanded')==='false')preview.click();
  card.scrollIntoView({block:'start'});
}
function latestResult() {
  const latest=allNotices().find(note=>!note.archived);
  const slot=$('latestCard');
  const old=slot.firstElementChild;
  $('latestResult').hidden=!latest;
  if(!latest){slot.replaceChildren();return}
  if(old?.dataset.notice===latest.id){old.classList.toggle('unread',!latest.read);return}
  // Preserve an original reply while the user is reading it. The full inbox still receives new cards.
  if(old?.querySelector('[aria-expanded="true"]') && allNotices().some(n=>n.id===old.dataset.notice))return;
  const options={...cardOptions,state:null,preview:true,previewChanged:open=>{
    if(!open)latestResult();
  }};
  slot.replaceChildren(ResultUI.card(latest,options));
}
function listNotices() {
  if(!$('dialog').open || !$('inboxList')){
    dialog('Inbox','<div id="inboxList"><div class="inbox-tools"><span id="inboxCount"></span><div><button id="readAll" class="mini-link"></button><button id="readEverything" class="mini-link"></button><button id="syncInbox" class="mini-link">Sync Now</button><button id="connectors" class="secondary">Connections…</button></div></div><div id="sourceFilters" class="tags"></div><p class="feedback" id="inboxWarnings"></p><div class="result-cards" id="inboxCards"></div><button class="secondary" id="olderResults" hidden>Load older results</button></div>',{});
    $('connectors').onclick=showConnectors;
    $('readAll').onclick=()=>markAllRead(false);
    $('readEverything').onclick=()=>markAllRead(true);
    $('olderResults').onclick=()=>{resultLimit+=30;listNotices()};
    $('syncInbox').onclick=()=>action(native('syncInboxes').then(()=>{
      lastManualScan=new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());
      if($('dialog').open && $('inboxList'))listNotices();
    }));
  }
  const all=allNotices(), live=all.filter(note=>!note.archived), archivedCount=all.length-live.length;
  const sources=[...new Set(live.map(sourceName))];
  if(selectedInboxSource!==ARCHIVED&&!sources.includes(selectedInboxSource))selectedInboxSource='';
  if(selectedInboxSource===ARCHIVED&&!archivedCount)selectedInboxSource='';
  const filtered=noticesInView();
  const unreadHere=filtered.filter(n=>!n.read).length, unreadAll=live.filter(n=>!n.read).length;
  $('inboxCount').textContent=unreadAll+' unread'+(lastManualScan?' · Synced at '+lastManualScan:'');
  // Bulk read follows the visible filter and says how many it changes. All sources is a separate action.
  $('readAll').textContent=selectedInboxSource&&selectedInboxSource!==ARCHIVED?'Mark '+unreadHere+' '+selectedInboxSource+' Read':'Mark '+unreadHere+' Read';
  $('readAll').hidden=!unreadHere||selectedInboxSource===ARCHIVED;
  $('readEverything').textContent='Mark All '+unreadAll+' Read';
  $('readEverything').hidden=!selectedInboxSource||selectedInboxSource===ARCHIVED||unreadAll===unreadHere;
  const filters=$('sourceFilters');
  const filterKey=JSON.stringify([sources,selectedInboxSource,archivedCount]);
  if(filters.dataset.key!==filterKey){
    filters.dataset.key=filterKey;
    const names=sources.length>1?['',...sources]:[];
    if(archivedCount)names.push(ARCHIVED);
    if(names.length&&!names.includes(''))names.unshift('');
    filters.innerHTML=names.map(name=>'<button data-source="'+esc(name)+'" class="'+(selectedInboxSource===name?'active':'')+'">'+esc(name===ARCHIVED?'Archived ('+archivedCount+')':name||'All sources')+'</button>').join('');
    filters.hidden=!names.length;
  }
  const warnings=$('inboxWarnings');
  warnings.textContent=[...inboxErrors.values()].filter(Boolean).join(' · ');
  warnings.hidden=!warnings.textContent;
  const list=$('inboxCards'), existing=new Map([...list.children].map(n=>[n.dataset.notice,n]));
  const visible=filtered.slice(0,resultLimit);
  const before=[...list.children].find(el=>el.getBoundingClientRect().bottom>$('dialog').getBoundingClientRect().top);
  const oldY=before?.getBoundingClientRect().top,scrolled=$('dialog').scrollTop>30;
  let insertion=list.firstElementChild;
  for(const note of visible){
    const node=existing.get(note.id)||ResultUI.card(note,{...cardOptions,preview:true});
    node.classList.toggle('unread',!note.read);
    ResultUI.syncState(node,note);
    if(node!==insertion)list.insertBefore(node,insertion);
    insertion=node.nextElementSibling;
    existing.delete(note.id);
  }
  for(const node of existing.values())node.remove();
  if(!visible.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=selectedInboxSource===ARCHIVED?'Nothing archived.':'No results yet.';list.append(empty)}
  $('olderResults').hidden=filtered.length<=resultLimit;
  if(scrolled&&before?.isConnected)$('dialog').scrollTop+=before.getBoundingClientRect().top-oldY;
}
function updateItems(channel,items) {
  inboxes.set(channel,items.map(note=>({...note,channel})));
  ResultUI.retain(new Set(allNotices().map(note=>note.id)));
  inboxBadge();
  latestResult();
  window.renderAgents?.();
}
function connectorRow(id,badge,icon,title,detail,extra='') {
  return '<div class="group-row" id="'+id+'"><span class="app-badge" style="--badge:'+badge+'">'+symbol(icon)+'</span><span class="row-text"><b>'+title+'</b><small data-state>'+detail+'</small></span>'+extra+'</div>';
}
function showConnectors() {
  const fromGrok=allNotices().filter(n=>sourceName(n)==='Grok Bot');
  const receipt=fromGrok.length?'Last received '+inboxDate(fromGrok[0].time):'Sends a summary when a task finishes';
  dialog('Connections','<div class="connector-list">'+
    '<h3>Coding agents</h3><div class="group-box">'+
    connectorRow('claudeRow','var(--orange)','i-terminal','Claude Code','Checking…','<button id="claudeConnection" class="secondary" disabled>Connect</button>')+
    connectorRow('codexRow','var(--ink)','i-terminal','Codex','Checking…','<button id="codexConnection" class="secondary" disabled>Connect</button>')+
    connectorRow('grokRow','var(--gray)','i-bolt','Grok Bot',esc(receipt),'<button id="copyGrok" class="secondary">Copy Instructions</button>')+
    connectorRow('mcpRow','var(--indigo)','i-link','Other AI apps (MCP)','Any app that supports local MCP servers','<button id="copyMCP" class="secondary">Copy Configuration</button>')+
    '</div><p>Claude Code and Codex show up under Agents while they work. Each finished turn leaves its reply in the inbox, without a notification.</p>'+
    '<h3>Workspace</h3><div class="group-box"><button type="button" class="group-row" id="notionRow"><span class="app-badge" style="--badge:var(--ink)">'+symbol('i-note')+'</span><span class="row-text"><b>Notion</b><small data-state>Checking…</small></span>'+symbol('i-chevron-right chev')+'</button></div>'+
    '<details class="more-sources"><summary>More sources: Gmail, Outlook and GitHub Actions</summary>'+
    '<p>Mail needs a Google or Microsoft app registration of your own. GitHub Actions works with any public repository.</p>'+
    '<div class="group-box" id="providerRows"><div class="group-row"><span class="row-text"><small>Checking connections…</small></span></div></div></details>'+
    '<h3>Shishi</h3><div class="group-box">'+
    '<div class="group-row"><span class="row-text"><b>Appearance</b></span><div class="menu-segment appearance-choice" id="appearanceChoice">'+
      [['system','System'],['light','Light'],['dark','Dark']].map(([value,label])=>'<button type="button" data-appearance="'+value+'" aria-pressed="false">'+label+'</button>').join('')+'</div></div>'+
    '<label class="group-row toggle-label"><span class="row-text"><b>Show status in the menu bar</b><small>Agent progress and unread results stay visible after the window closes.</small></span><input type="checkbox" id="menuBarChoice" disabled></label>'+
    '</div></div>',{label:'Inbox',back:listNotices});
  ProviderUI.rows();
  const bind=(box,op)=>{
    action(native(op).then(value=>{
      if(!box.isConnected)return;
      box.checked=!!value;box.disabled=false;
      box.onchange=()=>action(native(op,{value:box.checked}).catch(error=>{box.checked=!box.checked;throw error}));
    }));
  };
  bind($('menuBarChoice'),'menuBar');
  const appearance=$('appearanceChoice');
  const showAppearance=value=>appearance.querySelectorAll('[data-appearance]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.appearance===value)));
  action(native('appearance').then(showAppearance));
  appearance.onclick=event=>{
    const choice=event.target.closest('[data-appearance]');
    if(choice)action(native('appearance',{value:choice.dataset.appearance}).then(showAppearance));
  };

  const connectButton=$('codexConnection'), badge=$('codexRow').querySelector('[data-state]');
  function setCodex(enabled) {
    if(!connectButton.isConnected)return;
    badge.textContent=enabled?(inboxErrors.get('codex')?'Temporarily unavailable':'Connected · reads finished turns from sessions on this Mac'):'Not connected';
    connectButton.disabled=false;
    connectButton.textContent=enabled?'Disconnect':'Connect';
    connectButton.onclick=()=>{
      connectButton.disabled=true;
      action(native('codexConnection',{enabled:!enabled}).then(setCodex).finally(()=>{connectButton.disabled=false}));
    };
  }
  action(native('codexConnection').then(setCodex));

  const claudeButton=$('claudeConnection'), claudeState=$('claudeRow').querySelector('[data-state]');
  function setClaude(state) {
    if(!claudeButton.isConnected)return;
    claudeState.textContent=state.problem||(state.installed?'Connected · live status and finished replies':state.cli?'Not connected':'Not connected · the claude command was not found');
    claudeButton.disabled=false;
    const repair=state.installed&&!state.working;
    claudeButton.textContent=repair?'Repair':state.installed?'Disconnect':'Connect';
    claudeButton.onclick=()=>{
      claudeButton.disabled=true;
      action(native('claudeCode',{action:state.installed&&!repair?'remove':'install'}).then(next=>{
        setClaude(next);
        if(next.working&&!state.installed)toast('Claude Code is connected. Finish a turn to see it here.');
      }).finally(()=>{claudeButton.disabled=false}));
    };
  }
  action(native('claudeCode',{action:'status'}).then(setClaude).catch(error=>{
    if(claudeState.isConnected)claudeState.textContent=error.message;
    throw error;
  }));

  $('notionRow').onclick=()=>showNotion();
  action(native('notion',{action:'status'}).then(state=>{
    const label=$('notionRow')?.querySelector('[data-state]');
    if(label)label.textContent=state.connected&&data.notion?'Syncing “'+data.notion.title+'” with the list “'+projectLabel(data.notion.project)+'”':'Sync a list with a Notion database';
  }));

  const configure=(button,kind)=>{button.onclick=()=>action(native('copyConnectorSetup',{kind}).then(()=>{button.textContent='Copied'}))};
  configure($('copyGrok'),'grokBot');
  configure($('copyMCP'),'mcp');
}
// "Back to card" appears when the card sent you here, and takes you back to it.
window.setWorkspaceReturn=visible=>{$('workspaceReturn').hidden=!visible};
$('workspaceReturn').onclick=()=>Promise.resolve(closeDialog()).then(()=>{if(!$('dialog').open)action(native('compact',{value:true}))});
window.openInbox=()=>listNotices();
window.setInbox=state=>{
  const channel=state.channel||'codex';
  if(Array.isArray(state.items))updateItems(channel,state.items);
  inboxErrors.set(channel,state.error||'');
  inboxBadge();
  if($('dialog').open&&$('inboxList')){const top=$('dialog').scrollTop;listNotices();$('dialog').scrollTop=top}
};
$('inboxButton').onclick=()=>listNotices();
$('dialogBody').addEventListener('click',event=>{
  const filter=event.target.closest('[data-source]');
  if(filter){selectedInboxSource=filter.dataset.source;listNotices();return}

});
