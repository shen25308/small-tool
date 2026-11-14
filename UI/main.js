'use strict';
/* Start-up, and the functions the Swift host calls (window.setInbox, setCompact, openInbox, …). */
window.Shishi={ready:false};

window.setInbox=state=>Inbox.receive(state||{});
window.setCompact=on=>{
  st.mode=on?'compact':'dense';document.body.classList.toggle('compact',!!on);
  if(on){st.day=st.today;st.scale='day';st.nav='today';st.cluster=null;st.suggest=null;$('#qpop').classList.add('hidden');$('#moreMenu').hidden=true}
  if(Shishi.ready)render();
};
window.setEdgeVisible=shown=>{st.edgeShown=!!shown};
window.setWorkspaceReturn=shown=>{$('#backEdge').hidden=!shown};
window.openInbox=origin=>{if(origin==='edge'&&Dialogs.hasDraft())return;Dialogs.close();if(Shishi.ready)Inbox.open()};
// A draft the user began earlier stays on screen when returning from the results panel.
window.showWorkspaceHome=()=>{if(!Dialogs.hasDraft())Dialogs.close()};
window.openMessage=text=>Dialogs.message(text||'');
window.addTaskFromResult=title=>{const t=String(title||'').trim().slice(0,240);if(t&&Shishi.ready)act(tr('t.added',quote(t),tr('day.today')),()=>{S.tasks.push(newTask({t,day:st.today}))})};

(async()=>{
  try{const info=await native('locale');I18n.use(info.languages,info.timeZone)}catch(e){I18n.use(navigator.languages||[])}
  I18n.apply(document);
  await Prefs.load();
  Sky.setPalette(Prefs.get('palette','pearl'));
  Theme.setReduceMotion(Prefs.get('reduceMotion',false)===true);
  if(Prefs.get('sideHidden',false)===true){$('#ws').classList.add('noside');$$('#sideToggle,#sideShow').forEach(b=>b.setAttribute('aria-pressed','true'))}
  Sky.setDay(new Date(),I18n.timeZone);
  try{loadWorkspace(await native('load'))}
  catch(error){
    // The file exists but could not be read. Nothing is written until it can be, so no data is lost.
    locked=true;loadWorkspace(null);
    const note=$('#loadError');note.hidden=false;note.textContent=tr('load.failed',error.message);
  }
  try{Quota.set(await native('quota'))}catch(e){Quota.set(null)}
  // The tidy-up card opens by itself once a day, the first time there is something left over.
  if(carry().length&&Prefs.get('reviewDay','')!==ymd(st.today)){st.review=true;Prefs.set('reviewDay',ymd(st.today))}
  Shishi.ready=true;
  render();
  setInterval(tick,15000);
  setInterval(()=>native('quota').then(report=>{Quota.set(report);ringsQuota()}).catch(()=>{}),300000);
  try{await native('ready')}catch(error){Toast.show(error.message,{ms:6000})}
})();
