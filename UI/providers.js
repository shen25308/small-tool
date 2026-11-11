'use strict';
const ProviderUI = (() => {
  const names={gmail:'Gmail',outlook:'Outlook',github:'GitHub Actions'};
  const request=(provider,action,fields={})=>native('externalProvider',{provider,action,...fields});
  let serial=0;
  function showError(error) {
    const feedback=$('providerFeedback');
    if(feedback)feedback.textContent=error.message||String(error);
  }
  function stateLabel(account) {
    return ({connected:'Connected',retry:'Waiting to retry',reconnect:'Sign in again',cursor_expired:'Sync again'})[account.state]||'Check status';
  }
  async function rows(){
    const mount=$('providerRows');if(!mount)return;
    const id=++serial;
    const [mailState,outlookState,gitState]=await Promise.allSettled([request('gmail','status'),request('outlook','status'),request('github','status')]);
    if(!mount.isConnected||id!==serial)return;
    const mail=mailState.status==='fulfilled'?mailState.value:null;
    const git=gitState.status==='fulfilled'?gitState.value:null;
    const accounts=mail?.accounts||[];
    const entries=Object.entries(names).map(([provider,name])=>{
      const list=accounts.filter(a=>a.provider===provider);
      const state=provider==='github'?(git?.connected?git.repo:git?'Not connected':'Check status'):(list.length?list.map(a=>a.email).join(', '):mail?'Not connected':'Check status');
      const badge=provider==='github'?'var(--purple)':provider==='gmail'?'var(--red)':'var(--action)';
      return '<button type="button" class="group-row provider-row" data-provider="'+provider+'"><span class="app-badge" style="--badge:'+badge+'">'+symbol(provider==='github'?'i-bolt':'i-note')+'</span><span class="row-text"><b>'+esc(name)+'</b><small>'+esc(state)+'</small></span>'+symbol('i-chevron-right chev')+'</button>';
    });
    mount.innerHTML=entries.join('');
    mount.onclick=e=>{const button=e.target.closest('[data-provider]');if(!button)return;
      const provider=button.dataset.provider;
      if(provider==='github')github(git);else mailbox(provider,accounts.filter(a=>a.provider===provider),provider==='gmail'?mail?.configuredDefault:outlookState.value?.configuredDefault);
    };
  }
  function mailbox(provider,accounts,registered=false) {
    const accountRows=accounts.map(a=>'<div class="account-row"><b>'+esc(a.email)+'</b><p>'+esc(stateLabel(a))+' · '+esc(a.sender?'Only from '+a.sender:'All new mail')+'</p>'+(a.error?'<p class="feedback">'+esc(a.error)+'</p>':'')+'<button class="mini-link" type="button" data-edit="'+esc(a.id)+'">Message filter</button><button class="mini-link" type="button" data-remove="'+esc(a.id)+'">Disconnect</button></div>').join('');
    const registration=registered?'':provider==='gmail'?'This beta uses your Google desktop app credentials. Click Connect account and select the OAuth JSON file from Google Cloud.':'This beta uses your registered Microsoft desktop app. Click Connect account and enter its public client ID.';
    dialog(names[provider]+' accounts',accountRows+(registration?'<p class="hint">'+registration+'</p>':'')+'<p class="hint">Sign in with your email provider to receive the subject, sender, and arrival time of new messages. Shishi stores the access tokens in this Mac’s Keychain.</p><form id="accountForm"><label>Messages to receive<select id="mailScope"><option value="sender">Specific sender</option><option value="all">All new mail</option></select></label><label id="senderLabel">Sender email address<input id="senderAddress" type="email" required autocomplete="off" placeholder="name@example.com"></label><p id="providerFeedback" class="feedback" role="status"></p><div class="actions"><button type="submit" class="primary">Connect account</button></div></form>',{label:'Connections',back:showConnectors});
    $('mailScope').onchange=()=>{const one=$('mailScope').value==='sender';$('senderLabel').hidden=!one;$('senderAddress').required=one};
    const form=$('accountForm');
    form.onsubmit=async e=>{
      e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
      $('providerFeedback').textContent='Preparing sign-in…';
      try{
        const result=await request(provider,'connect',{sender:$('mailScope').value==='all'?'':$('senderAddress').value.trim()});
        if(form.isConnected)mailbox(provider,(result.accounts||[]).filter(a=>a.provider===provider),result.configuredDefault);
      }catch(error){if(form.isConnected)showError(error)}finally{button.disabled=false}
    };
    $('dialogBody').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>accountAction(provider,accounts.find(a=>a.id===b.dataset.edit),false,()=>mailbox(provider,accounts,registered)));
    $('dialogBody').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>accountAction(provider,accounts.find(a=>a.id===b.dataset.remove),true,()=>mailbox(provider,accounts,registered)));
  }
  function accountAction(provider,account,remove,back){
    if(!account)return;
    const fields=remove?'<p class="hint">Disconnecting stops sync and removes this account’s token from your Mac.</p><label class="toggle-label"><input type="checkbox" id="mailPurge">Also remove this account’s messages from the Shishi inbox</label>':'<label>Specific sender<input id="senderAddress" type="email" value="'+esc(account.sender||'')+'" placeholder="Leave blank to receive all new mail"></label>';
    dialog(remove?'Disconnect account':'Message filter','<p>'+esc(account.email)+'</p><form id="editProvider">'+fields+'<p class="feedback" id="providerFeedback"></p><div class="actions"><button class="primary">'+(remove?'Disconnect':'Save filter')+'</button></div></form>',{label:'Back',back});
    const form=$('editProvider');
    form.onsubmit=async e=>{
      e.preventDefault();const btn=form.querySelector('.primary');btn.disabled=true;
      try{await request(provider,remove?'disconnect':'set-sender',remove?{account:account.id,purge:$('mailPurge').checked}:{account:account.id,sender:$('senderAddress').value.trim()});
        if(form.isConnected)showConnectors();
      }catch(err){if(form.isConnected)showError(err)}finally{btn.disabled=false}
    };
  }
  function github(state){
    const connected=!!state?.connected;
    const fields=connected?'<p><b>'+esc(state.repo)+'</b></p><p>'+esc(state.workflow||'All workflows')+'</p>':'<label>Public repository<input id="gitRepo" required placeholder="owner/repository" autocomplete="off"></label><label>Workflow name (optional)<input id="gitWorkflow" placeholder="e.g. CI"></label>';
    dialog('GitHub Actions','<p class="hint">Receive the branch and build result when a workflow finishes in this public repository.</p><form id="gitForm">'+fields+'<p class="feedback" id="providerFeedback">'+esc(state?.error||'')+'</p><div class="actions"><button class="primary">'+(connected?'Unsubscribe':'Subscribe')+'</button></div></form>',{label:'Connections',back:showConnectors});
    const form=$('gitForm');
    form.onsubmit=async e=>{
      e.preventDefault();const b=form.querySelector('.primary');b.disabled=true;
      try {await request('github',connected?'disconnect':'connect',connected?{}:{repo:$('gitRepo').value.trim(),workflow:$('gitWorkflow').value.trim()});if(form.isConnected)showConnectors()}
      catch(err){if(form.isConnected)showError(err)}finally{b.disabled=false}
    };
  }
  return {rows};
})();
