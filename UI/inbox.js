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
  $('cardInboxCount').textContent=count?(count>99?'99+':String(count)):'';
  $('cardInbox').setAttribute('aria-label','Inbox, '+count+' unread');
  $('cardInbox').title=count?'Inbox · '+count+' unread':'Inbox';
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
// Opens the inbox on one result. With original, the stored reply itself is open and in view (F09).
// The source filter stays as it was when it already shows this result.
function openNotice(id,{original=false}={}) {
  if(window.InboxView){InboxView.open(id,{original});return}
  const note=allNotices().find(item=>item.id===id);
  if(note){
    if(note.archived)selectedInboxSource=ARCHIVED;
    else if(selectedInboxSource&&(selectedInboxSource===ARCHIVED||sourceName(note)!==selectedInboxSource))selectedInboxSource='';
  }
  const position=noticesInView().findIndex(item=>item.id===id);
  if(position>=resultLimit)resultLimit=position+1;
  listNotices();
  const card=[...document.querySelectorAll('#inboxCards .result-card')].find(node=>node.dataset.notice===id);
  if(!card)return;
  const preview=card.querySelector('.result-preview');
  if(preview?.getAttribute('aria-expanded')==='false')preview.click();
  if(original){
    const show=card.querySelector('.result-expand');
    if(show&&show.getAttribute('aria-expanded')!=='true')show.click();
  }
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
  if(window.InboxView){if(view!=='inbox')go('inbox');else InboxView.render();return}
  if(!$('dialog').open || !$('inboxList')){
    dialog('Inbox','<div id="inboxList"><div class="inbox-tools"><span id="inboxCount"></span><div><button id="readAll" class="mini-link"></button><button id="readEverything" class="mini-link"></button><button id="syncInbox" class="mini-link">Sync Now</button><button id="connectors" class="secondary">Settings…</button></div></div><div id="sourceFilters" class="tags"></div><p class="feedback" id="inboxWarnings"></p><div class="result-cards" id="inboxCards"></div><button class="secondary" id="olderResults" hidden>Load older results</button></div>',{});
    $('connectors').onclick=()=>showConnectors('agents',{fromInbox:true});
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
  // A row's verdict depends on the session facts in the agent status, which can arrive after the inbox.
  // Rebuild a row when those facts change, so the inbox never disagrees with the card.
  const factsKey=note=>{const agent=window.agentForNotice?.(note.id);return agent?.facts?JSON.stringify(agent.facts):''};
  for(const note of visible){
    const key=factsKey(note), cached=existing.get(note.id);
    const node=cached&&cached.dataset.factsKey===key?cached:ResultUI.card(note,{...cardOptions,preview:true});
    node.dataset.factsKey=key;
    if(cached&&cached!==node){cached.replaceWith(node);if(insertion===cached)insertion=node}
    node.classList.toggle('unread',!note.read);
    ResultUI.syncState(node,note);
    if(node!==insertion)list.insertBefore(node,insertion);
    insertion=node.nextElementSibling;
    existing.delete(note.id);
  }
  for(const node of existing.values())if(node.isConnected)node.remove();
  if(!visible.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=selectedInboxSource===ARCHIVED?'Nothing archived.':'No results yet.';list.append(empty)}
  $('olderResults').hidden=filtered.length<=resultLimit;
  if(scrolled&&before?.isConnected)$('dialog').scrollTop+=before.getBoundingClientRect().top-oldY;
}
function updateItems(channel,items) {
  inboxes.set(channel,items.map(note=>({...note,channel})));
  ResultUI.retain(new Set(allNotices().map(note=>note.id)));
  inboxBadge();
  latestResult();
  if(view==='inbox')InboxView.render();
  renderSidebarCounts();
  window.renderAgents?.();
}
function showHookLog(){
  action(native('hookLog').then(rows=>{
    const box=$('hookLog');
    if(!box)return;
    box.innerHTML=rows.length?rows.slice(0,40).map(row=>'<div class="group-row"><span class="row-text"><b>'+esc(row.event||'Unreadable event')+'</b><small>'+
      esc(new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(row.time*1000)))+
      (row.session?' · session '+esc(row.session):'')+'</small></span><span class="hook-outcome'+(row.outcome==='delivered'?'':' problem')+'">'+esc(row.outcome)+'</span></div>').join('')
      :'<div class="group-row"><span class="row-text"><small>No deliveries yet. Send Claude Code a prompt after connecting.</small></span></div>';
  }));
}
function connectorRow(id,badge,icon,title,detail,extra='',colorKey='') {
  return '<div class="group-row" id="'+id+'"><span class="app-badge" style="--badge:'+badge+'">'+symbol(icon)+'</span><span class="row-text"><b>'+title+'</b><small data-state>'+detail+'</small></span>'+(colorKey?SourceColors.swatch(colorKey):'')+extra+'</div>';
}
// Settings, in four tabs like System Settings. Opened from the ••• menu (⌘,), the Inbox, or a sync sheet's back button.
const SETTINGS_TABS=[['agents','Agents'],['sync','Sync'],['alerts','Alerts'],['general','General']];
let settingsTab='agents';
function showConnectors(tab,{fromInbox=false}={}) {
  if(SETTINGS_TABS.some(([name])=>name===tab))settingsTab=tab;
  const fromGrok=allNotices().filter(n=>sourceName(n)==='Grok Bot');
  const receipt=fromGrok.length?'Last received '+inboxDate(fromGrok[0].time):'Sends a summary when a task finishes';
  const toggle=(attrs,title,note='',noteId='')=>'<label class="group-row toggle-label"><span class="row-text"><b>'+title+'</b>'+(note||noteId?'<small'+(noteId?' id="'+noteId+'"':'')+'>'+note+'</small>':'')+'</span><input type="checkbox" '+attrs+'></label>';
  const pane=(name,html)=>'<section class="settings-pane" data-pane="'+name+'"'+(name===settingsTab?'':' hidden')+'>'+html+'</section>';
  dialog('Settings','<div class="settings-tabs menu-segment" role="tablist" aria-label="Settings sections">'+
    SETTINGS_TABS.map(([name,label])=>'<button type="button" role="tab" data-settings-tab="'+name+'" aria-selected="'+(name===settingsTab)+'">'+label+'</button>').join('')+'</div>'+
    '<div class="connector-list">'+
    pane('agents',
      '<h3>Coding agents</h3><div class="group-box">'+
      connectorRow('claudeRow','var(--orange)','i-terminal','Claude Code','Checking…','<button id="claudeConnection" class="secondary" disabled>Connect</button>','Claude Code')+
      '<label class="group-row toggle-label sub-row" id="approvalRow" hidden><span class="row-text"><b>Answer permission requests on the card</b><small>Allow or Deny on the card; otherwise Claude Code asks in the terminal as usual. While it waits, the terminal shows no prompt.</small></span><input type="checkbox" id="approvalChoice"></label>'+
      '<div class="group-row sub-row" id="approvalWaitRow" hidden><span class="row-text"><b>Wait for an answer</b></span><select id="approvalWait" aria-label="Seconds to wait">'+
        [15,25,45,90].map(n=>'<option value="'+n+'">'+n+' seconds</option>').join('')+'</select></div>'+
      '<div class="group-row sub-row"><span class="row-text"><b>Start agents in</b><small>Where “Send to Claude Code” on a task opens, in the list’s project folder.</small></span>'+
        '<select id="agentTerminal" aria-label="Terminal for agents">'+['Terminal','iTerm2'].map(name=>'<option'+((data.agentTerminal||'Terminal')===name?' selected':'')+'>'+name+'</option>').join('')+'</select></div>'+
      connectorRow('codexRow','var(--ink)','i-terminal','Codex','Checking…','<button id="codexConnection" class="secondary" disabled>Connect</button>','Codex')+
      connectorRow('grokRow','var(--gray)','i-bolt','Grok Bot',esc(receipt),'<button id="copyGrok" class="secondary">Copy Instructions</button>','Grok Bot')+
      connectorRow('mcpRow','var(--indigo)','i-link','Other AI apps (MCP)','Any app that supports local MCP servers','<button id="copyMCP" class="secondary">Copy Configuration</button>','Other AI apps')+
      '</div><p>Agents show up under Agents while they work. Each finished turn leaves its reply in the inbox.</p>'+
      '<h3>While agents work</h3><div class="group-box">'+
      toggle('data-setting="usage" disabled','Show usage and limits','Claude Code token counts and Codex limits, read on this Mac only.')+
      toggle('data-setting="keepAwake" disabled','Keep the Mac awake','Only while an agent is working, not while it waits for you.')+
      '</div>'+
      '<details class="more-sources" id="hookLogBox"><summary>Diagnostics: recent hook deliveries</summary><p>Event, time and outcome of the last deliveries from the Claude Code hook. Prompts, replies and commands are never kept.</p><div class="group-box hook-log" id="hookLog"><div class="group-row"><span class="row-text"><small>Open to load…</small></span></div></div></details>')+
    pane('sync',
      '<h3>Tasks</h3><div class="group-box"><button type="button" class="group-row" id="notionRow"><span class="app-badge" style="--badge:var(--ink)">'+symbol('i-note')+'</span><span class="row-text"><b>Notion</b><small data-state>Checking…</small></span>'+symbol('i-chevron-right chev')+'</button>'+
      '<button type="button" class="group-row" id="remindersRow"><span class="app-badge" style="--badge:var(--orange)">'+symbol('i-check-circle')+'</span><span class="row-text"><b>Apple Reminders</b><small>'+
        (data.reminders?esc('Syncing “'+data.reminders.title+'” with “'+projectLabel(data.reminders.project)+'”'):'Sync a list with Reminders, for iPhone and Siri')+'</small></span>'+symbol('i-chevron-right chev')+'</button>'+
      '<button type="button" class="group-row" id="issuesRow"><span class="app-badge" style="--badge:var(--ink)">'+symbol('i-link')+'</span><span class="row-text"><b>GitHub issues</b><small>'+
        (data.github?esc(data.github.repo+' → “'+projectLabel(data.github.project)+'”'):'Turn a repository’s open issues into tasks')+'</small></span>'+symbol('i-chevron-right chev')+'</button></div>'+
      '<h3>Calendar</h3><div class="group-box">'+
      '<label class="group-row toggle-label"><span class="app-badge" style="--badge:var(--red)">'+symbol('i-calendar')+'</span><span class="row-text"><b>Show calendar events</b><small id="calendarNote">Above Today, in each Upcoming day, and the next one on the card. Read only.</small></span><input type="checkbox" id="calendarChoice"'+(data.calendar?.enabled?' checked':'')+'></label></div>'+
      '<h3>More sources</h3><p>Mail needs a Google or Microsoft app registration of your own. GitHub Actions works with any public repository.</p>'+
      '<div class="group-box" id="providerRows"><div class="group-row"><span class="row-text"><small>Checking connections…</small></span></div></div>')+
    pane('alerts',
      '<p>Shishi is silent unless you choose otherwise. Results always wait in the inbox.</p><h3>Alert me</h3><div class="group-box" id="alertBox">'+
      toggle('data-alert="needsYou" disabled','When an agent needs you','A permission request or a question.')+
      '<div class="group-row sub-row plain"><span class="row-text"><b>Remind me again</b></span><select data-alert="remindAfter" aria-label="Remind after">'+
        [[0,'Never'],[2,'After 2 minutes'],[5,'After 5 minutes'],[10,'After 10 minutes']].map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select></div>'+
      toggle('data-alert="due" disabled','When a task is due','At the deadline time of a task that is still open.')+
      '</div><h3>How</h3><div class="group-box">'+
      toggle('data-alert="sound" disabled','Play a sound')+
      toggle('data-alert="banner" disabled','Show a banner','macOS asks once whether Shishi may show banners.','bannerNote')+
      '<div class="group-row"><span class="row-text"><b>Quiet hours</b><small id="quietNote">No sound or banner between these times.</small></span><span class="quiet-hours"><input type="time" data-alert="quietFrom" aria-label="Quiet from"> – <input type="time" data-alert="quietTo" aria-label="Quiet until"></span></div>'+
      '<div class="group-row"><span class="row-text"><b>Try it</b><small>Plays an alert now, even in quiet hours.</small></span><button type="button" class="secondary" id="testAlert">Test</button></div>'+
      '</div>')+
    pane('general',
      '<h3>Shishi</h3><div class="group-box">'+
      '<div class="group-row"><span class="row-text"><b>Appearance</b></span><div class="menu-segment appearance-choice" id="appearanceChoice">'+
        [['system','System'],['light','Light'],['dark','Dark']].map(([value,label])=>'<button type="button" data-appearance="'+value+'" aria-pressed="false">'+label+'</button>').join('')+'</div></div>'+
      '<div class="group-row"><span class="row-text"><b>Source colours</b><small>How results show the colour of their source. Set each colour under Agents and Sync.</small></span><div class="menu-segment" id="sourceStyleChoice">'+
        [['tint','Subtle Tint'],['accent','Accent Only']].map(([value,label])=>'<button type="button" data-source-style="'+value+'" aria-pressed="'+(SourceColors.style()===value)+'">'+label+'</button>').join('')+'</div></div>'+
      toggle('id="menuBarChoice" disabled','Show status in the menu bar','Agent progress and unread results stay visible after the window closes.')+
      toggle('data-setting="hotkeys" disabled','Keyboard shortcuts in every app','⌃⌥Space shows or hides the card. ⌃⌥N adds a task.','hotkeyNote')+
      '</div><h3>Corner card</h3><div class="group-box">'+
      toggle('data-card-pref="pinned" disabled','Keep above other windows','Otherwise the card stays behind the app you are using.')+
      toggle('data-card-pref="allSpaces" disabled','Show on all Spaces','Otherwise it stays on the Space where you put it.')+
      toggle('data-card-pref="snap" disabled','Snap to screen corners','Otherwise it stays exactly where you drop it.')+
      '</div><h3>Updates</h3><div class="group-box">'+
      '<label class="group-row toggle-label"><span class="row-text"><b>Check once a day</b><small id="updateNote">Asks GitHub for the latest release. Nothing is downloaded or installed.</small></span>'+
        '<button type="button" class="secondary" id="checkUpdate">Check Now</button><input type="checkbox" id="updateChoice" disabled></label>'+
      '</div>')+
    '</div>',fromInbox?{label:'Inbox',back:listNotices}:{});
  // Start keyboard focus on the chosen tab, not on the close button.
  document.querySelector('.settings-tabs [aria-selected="true"]')?.focus({preventScroll:true});
  $('sourceStyleChoice').onclick=event=>{
    const button=event.target.closest('[data-source-style]');
    if(!button)return;
    action(SourceColors.setStyle(button.dataset.sourceStyle).then(()=>{
      $('sourceStyleChoice')?.querySelectorAll('[data-source-style]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));
    }));
  };
  document.querySelector('.settings-tabs').onclick=event=>{
    const button=event.target.closest('[data-settings-tab]');
    if(!button)return;
    settingsTab=button.dataset.settingsTab;
    document.querySelectorAll('[data-settings-tab]').forEach(node=>node.setAttribute('aria-selected',String(node===button)));
    document.querySelectorAll('.settings-pane').forEach(node=>{node.hidden=node.dataset.pane!==settingsTab});
    $('dialog').scrollTop=0;
  };
  ProviderUI.rows();
  const bind=(box,op)=>{
    action(native(op).then(value=>{
      if(!box.isConnected)return;
      box.checked=!!value;box.disabled=false;
      box.onchange=()=>action(native(op,{value:box.checked}).catch(error=>{box.checked=!box.checked;throw error}));
    }));
  };
  bind($('menuBarChoice'),'menuBar');
  const cardBoxes=[...document.querySelectorAll('[data-card-pref]')];
  const showPrefs=value=>cardBoxes.forEach(box=>{box.checked=!!value[box.dataset.cardPref];box.disabled=false});
  action(native('cardPrefs').then(showPrefs));
  cardBoxes.forEach(box=>{box.onchange=()=>action(Card.setPrefs({[box.dataset.cardPref]:box.checked}).then(showPrefs).catch(error=>{box.checked=!box.checked;throw error}))});
  const alertFields=[...document.querySelectorAll('[data-alert]')];
  const showAlerts=value=>{
    for(const field of alertFields){
      const key=field.dataset.alert;
      if(field.type==='checkbox')field.checked=!!value[key];else field.value=String(value[key]??'');
      field.disabled=false;
    }
    const subordinate=!value.needsYou&&!value.due;
    alertFields.filter(field=>['sound','banner','quietFrom','quietTo'].includes(field.dataset.alert)).forEach(field=>{field.disabled=subordinate});
    if($('bannerNote'))$('bannerNote').textContent=value.banner&&value.bannersAllowed===false?'macOS is not allowing banners from Shishi. Turn them on in System Settings → Notifications.':'macOS asks once whether Shishi may show banners.';
    if($('quietNote'))$('quietNote').textContent=value.quietFrom&&value.quietTo?(value.quietNow?'Quiet now. ':'')+'No sound or banner from '+value.quietFrom+' to '+value.quietTo+'.':'No sound or banner between these times.';
  };
  action(native('alerts').then(showAlerts));
  alertFields.forEach(field=>{field.onchange=()=>{
    const key=field.dataset.alert;
    const value=field.type==='checkbox'?field.checked:key==='remindAfter'?Number(field.value):field.value;
    action(native('alerts',{[key]:value}).then(showAlerts));
  }});
  $('testAlert').onclick=()=>action(native('testAlert'));
  const showUpdate=value=>{
    if(!$('updateChoice'))return;
    $('updateChoice').checked=value.enabled!==false;$('updateChoice').disabled=false;
    $('updateNote').textContent=value.skipped||!value.latest?'Asks GitHub for the latest release. Nothing is downloaded or installed. This is version '+value.current+'.'
      :value.newer?'Version '+value.latest+' is available. You have '+value.current+'.':'You have the latest published version ('+value.current+').';
  };
  action(native('checkUpdate',{}).then(showUpdate));
  $('updateChoice').onchange=()=>action(native('checkUpdate',{enabled:$('updateChoice').checked}).then(showUpdate));
  $('checkUpdate').onclick=event=>{event.preventDefault();action(native('checkUpdate',{force:true}).then(value=>{showUpdate(value);if(value.newer)Updates.offer(value)}))};
  const settingBoxes=[...document.querySelectorAll('[data-setting]')];
  const showSettings=value=>{
    settingBoxes.forEach(box=>{box.checked=!!value[box.dataset.setting];box.disabled=false});
    if($('hotkeyNote'))$('hotkeyNote').textContent=(value.hotkeyLabels||['⌃⌥Space','⌃⌥N']).join(' shows or hides the card. ')+' adds a task.'+
      (value.takenShortcuts?.length?' Another app already uses '+value.takenShortcuts.join(' and ')+'.':'');
  };
  action(native('settings').then(showSettings));
  settingBoxes.forEach(box=>{box.onchange=()=>action(native('settings',{[box.dataset.setting]:box.checked}).then(value=>{showSettings(value);window.Usage?.setEnabled(value.usage!==false)}).catch(error=>{box.checked=!box.checked;throw error}))});
  $('hookLogBox').addEventListener('toggle',()=>{if($('hookLogBox').open)showHookLog()});
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
    badge.textContent=enabled?(inboxErrors.get('codex')?'Temporarily unavailable':'Connected · finished turns on this Mac. Codex cannot report when it waits for approval.'):'Not connected';
    connectButton.disabled=false;
    connectButton.textContent=enabled?'Disconnect':'Connect';
    connectButton.onclick=()=>{
      connectButton.disabled=true;
      action(native('codexConnection',{enabled:!enabled}).then(setCodex).finally(()=>{connectButton.disabled=false}));
    };
  }
  action(native('codexConnection').then(setCodex));
  action(native('approvalWait').then(value=>{const select=$('approvalWait');if(!select)return;select.value=String(value);
    select.onchange=()=>action(native('approvalWait',{value:Number(select.value)}))}));

  const claudeButton=$('claudeConnection'), claudeState=$('claudeRow').querySelector('[data-state]');
  function setClaude(state) {
    if(!claudeButton.isConnected)return;
    claudeState.textContent=state.problem||(state.installed?'Connected · live status and finished replies':state.cli?'Not connected':'Not connected · the claude command was not found');
    claudeButton.disabled=false;
    const repair=state.installed&&!state.working;
    claudeButton.textContent=repair?'Repair':state.installed?'Disconnect':'Connect';
    const approvalRow=$('approvalRow'), approvalChoice=$('approvalChoice');
    approvalRow.hidden=!state.installed;
    $('approvalWaitRow').hidden=!state.installed||!state.approvals;
    approvalChoice.checked=!!state.approvals;
    approvalChoice.onchange=()=>{
      approvalChoice.disabled=true;
      action(native('claudeCode',{action:'install',approvals:approvalChoice.checked}).then(next=>{
        setClaude(next);
        toast(next.approvals?'Permission requests now come to Shishi first. New Claude Code sessions pick this up.':'Permission requests go straight to the terminal again.');
      }).catch(error=>{approvalChoice.checked=!approvalChoice.checked;throw error}).finally(()=>{approvalChoice.disabled=false}));
    };
    claudeButton.onclick=()=>{
      claudeButton.disabled=true;
      action(native('claudeCode',{action:state.installed&&!repair?'remove':'install',approvals:!!state.approvals}).then(next=>{
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
  $('remindersRow').onclick=()=>action(showReminders());
  $('agentTerminal').onchange=()=>action(change(state=>{state.agentTerminal=$('agentTerminal').value}));
  $('issuesRow').onclick=()=>showIssues();
  $('calendarChoice').onchange=()=>{
    const on=$('calendarChoice').checked;
    action(change(state=>{state.calendar={enabled:on}}).then(()=>window.CalendarEvents.refresh()).then(()=>{
      const problem=CalendarEvents.problem();
      if(on&&problem){toast(problem);$('calendarNote').textContent=problem}
      else if(on)toast('Calendar events now show in Today and Upcoming.');
    }));
  };
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
$('workspaceReturn').onclick=returnToCard;
window.openInbox=()=>listNotices();
window.setInbox=state=>{
  const channel=state.channel||'codex';
  if(Array.isArray(state.items))updateItems(channel,state.items);
  inboxErrors.set(channel,state.error||'');
  inboxBadge();
  if($('dialog').open&&$('inboxList')){const top=$('dialog').scrollTop;listNotices();$('dialog').scrollTop=top}
};
$('inboxButton').onclick=()=>go('inbox');
$('dialogBody').addEventListener('click',event=>{
  const filter=event.target.closest('[data-source]');
  if(filter){selectedInboxSource=filter.dataset.source;listNotices();return}

});
