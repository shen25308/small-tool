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
  const count=allNotices().filter(note=>!note.read).length;
  $('inboxBadge').textContent=count>99?'99+':String(count);
  $('inboxBadge').hidden=!count;
  $('inboxButton').setAttribute('aria-label','Inbox, '+count+' unread');
}
let resultLimit=30;
let inboxFromEdge=false;
let edgeShown=false;
window.setEdgeVisible=value=>{
  edgeShown=!!value;
  const button=$('edgeToggle');
  button.setAttribute('aria-pressed',String(edgeShown));
  button.title=edgeShown?'Hide result panel':'Show result panel';
  button.setAttribute('aria-label',button.title);
  button.lastElementChild.textContent=button.title;
};
$('edgeToggle').onclick=()=>action(native('edgeVisibility',{value:!edgeShown}));
const cardOptions={
  read:note=>action(native('readNotice',{key:note.id,channel:note.channel})),
  open:note=>action(note.thread?native('openCodex',{thread:note.thread}):native('openConnectorLink',{key:note.id}))
};
function latestResult() {
  const latest=allNotices()[0];
  const slot=$('latestCard');
  const old=slot.firstElementChild;
  $('latestResult').hidden=!latest;
  if(!latest){slot.replaceChildren();return}
  if(old?.dataset.notice===latest.id){old.classList.toggle('unread',!latest.read);return}
  // Preserve an original reply while the user is reading it. The full inbox still receives new cards.
  if(old?.querySelector('[aria-expanded="true"]') && allNotices().some(n=>n.id===old.dataset.notice))return;
  const options={...cardOptions,preview:true,previewChanged:open=>{
    if(compact)action(native('latestSize',{expanded:open}));
    if(!open)latestResult();
  }};
  slot.replaceChildren(ResultUI.card(latest,options));
}
function listNotices() {
  if(!$('dialog').open || !$('inboxList')){
    dialog('Inbox','<div id="inboxList"><div class="inbox-tools"><span id="inboxCount"></span><div><button id="syncInbox" class="mini-link">Sync now</button><button id="connectors" class="secondary">Manage connectors</button></div></div><div id="sourceFilters" class="tags"></div><p class="feedback" id="inboxWarnings"></p><div class="result-cards" id="inboxCards"></div><button class="secondary" id="olderResults" hidden>Load older results</button></div>',inboxFromEdge?{label:'Back to panel',back:returnToEdge}:{label:'Back to workspace',back:closeDialog});
    $('connectors').onclick=showConnectors;
    $('olderResults').onclick=()=>{resultLimit+=30;listNotices()};
    $('syncInbox').onclick=()=>action(native('syncInboxes').then(()=>{
      lastManualScan=new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());
      if($('dialog').open && $('inboxList'))listNotices();
    }));
  }
  const all=allNotices();
  const sources=[...new Set(all.map(sourceName))];
  if(!sources.includes(selectedInboxSource))selectedInboxSource='';
  const filtered=selectedInboxSource?all.filter(n=>sourceName(n)===selectedInboxSource):all;
  $('inboxCount').textContent=all.filter(n=>!n.read).length+' unread'+(lastManualScan?' · Synced at '+lastManualScan:'');
  const filters=$('sourceFilters');
  const filterKey=JSON.stringify([sources,selectedInboxSource]);
  if(filters.dataset.key!==filterKey){
    filters.dataset.key=filterKey;
    filters.innerHTML=sources.length>1?['',...sources].map(name=>'<button data-source="'+esc(name)+'" class="'+(selectedInboxSource===name?'active':'')+'">'+esc(name||'All sources')+'</button>').join(''):'';
    filters.hidden=sources.length<2;
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
    if(node!==insertion)list.insertBefore(node,insertion);
    insertion=node.nextElementSibling;
    existing.delete(note.id);
  }
  for(const node of existing.values())node.remove();
  if(!visible.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='No results yet.';list.append(empty)}
  $('olderResults').hidden=filtered.length<=resultLimit;
  if(scrolled&&before?.isConnected)$('dialog').scrollTop+=before.getBoundingClientRect().top-oldY;
}
function updateItems(channel,items) {
  inboxes.set(channel,items.map(note=>({...note,channel})));
  ResultUI.retain(new Set(allNotices().map(note=>note.id)));
  inboxBadge();
  latestResult();
}
function showConnectors() {
  const fromGrok=allNotices().filter(n=>sourceName(n)==='Grok Bot');
  const receipt=fromGrok.length?'Last received '+inboxDate(fromGrok[0].time):'Awaiting first result';
  const status=inboxErrors.get('codex')?'Temporarily unavailable':'Checking…';
  dialog('Connectors','<div class="connector-list"><section><h3>Mail and build updates</h3><div id="providerRows">Checking connections…</div><label class="toggle-label"><input type="checkbox" id="showEdgeMail" disabled>Show new mail in the result panel</label></section><section><h3>Codex <small id="codexState">'+status+'</small></h3><p>Shishi reads Codex sessions on this Mac and saves the final reply from each new turn. Your inbox keeps those replies after you disconnect.</p><button id="codexConnection" class="secondary" disabled>Check connection</button></section><section><h3>Grok Bot <small>'+esc(receipt)+'</small></h3><p>Copy the instructions into Grok Bot on your Mac. It can then run a local command to send a summary when a task finishes.</p><button id="copyGrok" class="secondary">Copy Grok Bot instructions</button></section><section><h3>Other AI apps (MCP)</h3><p>Add Shishi to an app that supports local MCP servers, then ask it to send the result when its task finishes.</p><button id="copyMCP" class="secondary">Copy MCP configuration</button></section></div>',{label:'Back to inbox',back:listNotices});
  ProviderUI.rows();
  const mailChoice=$('showEdgeMail');
  action(native('edgeMailPreference').then(value=>{
    if(!mailChoice.isConnected)return;
    mailChoice.checked=value;mailChoice.disabled=false;
    mailChoice.onchange=()=>action(native('edgeMailPreference',{value:mailChoice.checked}).catch(error=>{mailChoice.checked=!mailChoice.checked;throw error}));
  }));
  const connectButton=$('codexConnection'), badge=$('codexState');
  function setCodex(enabled) {
    if(!connectButton.isConnected)return;
    badge.textContent=enabled?(inboxErrors.get('codex')?'Temporarily unavailable':'Enabled'):'Not connected';
    connectButton.disabled=false;
    connectButton.textContent=enabled?'Disconnect Codex':'Connect local Codex';
    connectButton.onclick=()=>{
      connectButton.disabled=true;
      action(native('codexConnection',{enabled:!enabled}).then(setCodex).finally(()=>{connectButton.disabled=false}));
    };
  }
  action(native('codexConnection').then(setCodex));

  const configure=(button,kind)=>{button.onclick=()=>action(native('copyConnectorSetup',{kind}).then(()=>{button.textContent='Copied'}))};
  configure($('copyGrok'),'grokBot');
  configure($('copyMCP'),'mcp');
}
function returnToEdge(){
  closeDialog();inboxFromEdge=false;
  action(native('returnToEdge'));
}
window.setWorkspaceReturn=visible=>{$('workspaceReturn').hidden=!visible};
$('workspaceReturn').onclick=returnToEdge;
window.openInbox=origin=>{
  if (origin==='edge' && $('dialog').open && $('dialogBody').querySelector('form,input:not([type=checkbox]),textarea,select')) return;
  inboxFromEdge=origin==='edge';
  listNotices();
};
window.setInbox=state=>{
  const channel=state.channel||'codex';
  if(Array.isArray(state.items))updateItems(channel,state.items);
  inboxErrors.set(channel,state.error||'');
  inboxBadge();
  if($('dialog').open&&$('inboxList')){const top=$('dialog').scrollTop;listNotices();$('dialog').scrollTop=top}
};
$('inboxButton').onclick=()=>{inboxFromEdge=!$('workspaceReturn').hidden;listNotices()};
$('dialogBody').addEventListener('click',event=>{
  const filter=event.target.closest('[data-source]');
  if(filter){selectedInboxSource=filter.dataset.source;listNotices();return}

});
