'use strict';
// Connects one list to one Notion database. The integration secret is entered in a system dialog
// and stays in the Keychain. This page only ever sees the database link and the task fields.
let notionBusy = false, notionProblem = '';

async function syncNotion({quiet = false} = {}) {
  const config = data.notion;
  if (!config || notionBusy) return;
  notionBusy = true;
  try {
    const pulled = await native('notion', {action: 'pull', database: config.database});
    let outcome;
    await change(state => {
      if (!state.notion) throw Error('Notion was disconnected during the sync.');
      if (!state.projects.includes(state.notion.project)) state.projects.push(state.notion.project);
      outcome = NotionSync.plan(state.tasks, pulled.pages || [], {mapping: pulled.mapping, project: state.notion.project,
        truncated: !!pulled.truncated, newId: uuid, stamp: stampNow()});
      state.notion.title = pulled.title || state.notion.title;
      state.notion.lastSync = stampNow();
    });
    let sent = 0, failed = '';
    if (outcome.changes.length) {
      const pushed = await native('notion', {action: 'push', database: config.database, mapping: pulled.mapping, changes: outcome.changes});
      await change(state => { ({sent, failed} = NotionSync.settle(state.tasks, pushed.results, pulled.mapping)); });
    }
    notionProblem = failed;
    const {imported, updated} = outcome.stats;
    if (failed) toast(failed);
    else if (!quiet || imported || updated || sent) {
      const parts = [imported && imported + ' imported', updated && updated + ' updated', sent && sent + ' sent to Notion'].filter(Boolean);
      toast(parts.length ? 'Notion: ' + parts.join(', ') : 'Notion is up to date');
    }
  } catch (error) {
    notionProblem = error.message;
    if (!quiet) throw error;
  } finally {
    notionBusy = false;
    // Refresh the sheet only while it is on screen. A background sync must never reopen it.
    if ($('dialog').open && $('notionStatus')?.isConnected) showNotion();
  }
}

function showNotion() {
  const config = data.notion;
  const navigation = {label: 'Connections', back: showConnectors};
  if (!config) {
    dialog('Notion', '<p class="hint">Keep one list in step with a Notion database. Tasks you add on either side appear on the other, and checking one off checks off both.</p>' +
      '<ol class="steps selectable"><li>In Notion, open <b>Settings → Connections → Develop or manage integrations</b> and create an internal integration. Copy its secret.</li>' +
      '<li>Open your task database, choose <b>••• → Connections</b>, and add that integration.</li>' +
      '<li>Copy the database link (<b>••• → Copy link</b>) and paste it below.</li></ol>' +
      '<form id="notionForm"><label>Database link<input id="notionDatabase" required autocomplete="off" placeholder="https://www.notion.so/…"></label>' +
      '<label>Sync with this list<select id="notionProject"><option value="">A new list named after the database</option>' + options(data.projects, null, projectLabel) + '</select></label>' +
      '<p class="feedback" id="notionFeedback" role="status"></p>' +
      '<div class="actions"><button class="primary">Continue</button></div></form>' +
      '<p class="hint">Shishi asks for the secret in a separate system dialog and stores it in your Mac’s Keychain. The database needs a title column. A checkbox or status column, a date column, a “Priority” select and a “Tags” column are used when present.</p>', navigation);
    $('notionDatabase').focus();
    $('notionForm').onsubmit = async event => {
      event.preventDefault();
      const button = $('notionForm').querySelector('.primary');
      button.disabled = true;
      $('notionFeedback').textContent = 'Waiting for the integration secret…';
      try {
        const found = await native('notion', {action: 'connect', database: $('notionDatabase').value.trim()});
        const chosen = $('notionProject')?.value || '';
        await change(state => {
          let project = chosen || String(found.title || 'Notion').slice(0, 32);
          if (!chosen) { let name = project, n = 2; while (state.projects.includes(name)) name = project.slice(0, 28) + ' ' + n++; project = name; }
          if (!state.projects.includes(project)) state.projects.push(project);
          state.notion = {database: found.database, title: found.title || 'Notion', project};
        });
        if ($('notionForm')?.isConnected) showNotion();
        await syncNotion();
      } catch (error) {
        if ($('notionFeedback')) $('notionFeedback').textContent = error.message;
        else toast(error.message);
      } finally { button.disabled = false; }
    };
    return;
  }
  const linked = data.tasks.filter(task => task.notion?.id && !task.notion.gone).length;
  dialog('Notion', '<div class="group-box"><div class="group-row"><span class="app-badge" style="--badge:var(--ink)">' + symbol('i-note') + '</span>' +
    '<span class="row-text"><b>' + esc(config.title) + '</b><small id="notionStatus">' + (notionBusy ? 'Syncing…' : esc(
      'List “' + projectLabel(config.project) + '” · ' + linked + (linked === 1 ? ' task' : ' tasks') + ' linked' + (config.lastSync ? ' · Last synced ' + dayLabel(config.lastSync.slice(0, 10)) + ' ' + config.lastSync.slice(11) : ''))) + '</small></span>' +
    '<button type="button" class="secondary" id="notionSync"' + (notionBusy ? ' disabled' : '') + '>Sync Now</button></div></div>' +
    '<p class="feedback">' + esc(notionProblem) + '</p>' +
    '<p class="hint">Tasks in this list are created in Notion, and open pages in the database appear in the list. Title, completion, deadline, priority and tag stay in step. If both sides changed the same task, the Notion page wins. Deleting a task here does not delete its page.</p>' +
    '<div class="actions"><button type="button" class="mini-link danger-link" id="notionDisconnect">Disconnect Notion</button><span class="spacer"></span><button type="button" class="primary" data-close>Done</button></div>', navigation);
  $('notionSync').onclick = () => { action(syncNotion()); showNotion(); };
  $('notionDisconnect').onclick = () => action(native('notion', {action: 'disconnect'}).then(() => change(state => {
    delete state.notion;
    state.tasks.forEach(task => { delete task.notion; });
  })).then(() => { notionProblem = ''; showNotion(); toast('Notion disconnected. Your tasks stay in the list.'); }));
}

// Sync quietly in the background: shortly after launch, then every 15 minutes.
setTimeout(() => { syncNotion({quiet: true}); }, 6000);
setInterval(() => { syncNotion({quiet: true}); }, 15 * 60 * 1000);
