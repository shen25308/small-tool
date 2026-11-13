'use strict';
// Apple Reminders and Calendar, both opt-in. Reminders keeps one Shishi list in step with one Reminders list, using
// the same tested sync as Notion (NotionSync with linkKey "reminder"), so tasks also reach iPhone, Siri and widgets.
// Calendar shows the day's events above Today and in Upcoming, read only.

let remindersBusy = false, remindersProblem = '';
const REMINDER_MAPPING = {due: true, priority: true};

async function syncReminders({quiet = false} = {}) {
  const config = data.reminders;
  if (!config || remindersBusy) return;
  remindersBusy = true;
  try {
    const pulled = await native('reminders', {action: 'pull', list: config.list});
    let outcome;
    await change(state => {
      if (!state.reminders) throw Error('Reminders was disconnected during the sync.');
      if (!state.projects.includes(state.reminders.project)) state.projects.push(state.reminders.project);
      outcome = NotionSync.plan(state.tasks, pulled.pages || [], {mapping: REMINDER_MAPPING, project: state.reminders.project,
        truncated: false, newId: uuid, stamp: stampNow(), linkKey: 'reminder'});
      state.reminders.title = pulled.title || state.reminders.title;
      state.reminders.lastSync = stampNow();
    });
    let sent = 0, failed = '';
    if (outcome.changes.length) {
      const pushed = await native('reminders', {action: 'push', list: config.list, changes: outcome.changes});
      await change(state => { ({sent, failed} = NotionSync.settle(state.tasks, pushed.results, REMINDER_MAPPING, 'reminder')); });
    }
    remindersProblem = failed;
    const {imported, updated} = outcome.stats;
    if (failed) toast(failed);
    else if (!quiet || imported || updated || sent) {
      const parts = [imported && imported + ' imported', updated && updated + ' updated', sent && sent + ' sent to Reminders'].filter(Boolean);
      toast(parts.length ? 'Reminders: ' + parts.join(', ') : 'Reminders is up to date');
    }
  } catch (error) {
    remindersProblem = error.message;
    if (!quiet) throw error;
  } finally {
    remindersBusy = false;
    if ($('dialog').open && $('remindersStatus')?.isConnected) showReminders();
  }
}

async function showReminders() {
  const config = data.reminders;
  const navigation = {label: 'Settings', back: () => showConnectors('sync')};
  if (!config) {
    dialog('Apple Reminders', '<p class="hint">Keep one list in step with a list in Reminders, so your tasks are on iPhone, Apple Watch and in Siri. ' +
      'Title, completion, deadline and priority stay in step both ways. macOS asks once for access.</p><p class="feedback" id="remindersFeedback" role="status">Loading your Reminders lists…</p>', navigation);
    let lists;
    try { lists = (await native('reminders', {action: 'lists'})).lists || []; }
    catch (error) { if ($('remindersFeedback')) $('remindersFeedback').textContent = error.message; return; }
    if (!$('remindersFeedback')) return;
    if (!lists.length) { $('remindersFeedback').textContent = 'Create a list in Reminders first, then come back.'; return; }
    $('remindersFeedback').insertAdjacentHTML('afterend', '<form id="remindersForm"><label>Reminders list<select id="remindersList">' +
      lists.map(list => '<option value="' + esc(list.id) + '">' + esc(list.title) + '</option>').join('') + '</select></label>' +
      '<label>Sync with this Shishi list<select id="remindersProject"><option value="">A new list named after it</option>' + options(data.projects, null, projectLabel) + '</select></label>' +
      '<div class="actions"><button class="primary">Start Syncing</button></div></form>');
    $('remindersFeedback').textContent = '';
    $('remindersForm').onsubmit = async event => {
      event.preventDefault();
      const select = $('remindersList'), chosen = $('remindersProject').value;
      const title = select.selectedOptions[0]?.textContent || 'Reminders';
      try {
        await change(state => {
          let project = chosen || title.slice(0, 32);
          if (!chosen) { let name = project, n = 2; while (state.projects.includes(name)) name = project.slice(0, 28) + ' ' + n++; project = name; }
          if (!state.projects.includes(project)) state.projects.push(project);
          state.reminders = {list: select.value, title, project};
        });
        showReminders();
        await syncReminders();
      } catch (error) { toast(error.message); }
    };
    return;
  }
  const linked = data.tasks.filter(task => task.reminder?.id && !task.reminder.gone).length;
  dialog('Apple Reminders', '<div class="group-box"><div class="group-row"><span class="app-badge" style="--badge:var(--orange)">' + symbol('i-check-circle') + '</span>' +
    '<span class="row-text"><b>' + esc(config.title) + '</b><small id="remindersStatus">' + (remindersBusy ? 'Syncing…' : esc(
      'List “' + projectLabel(config.project) + '” · ' + linked + (linked === 1 ? ' task' : ' tasks') + ' linked' + (config.lastSync ? ' · Last synced ' + dayLabel(config.lastSync.slice(0, 10)) + ' ' + config.lastSync.slice(11) : ''))) + '</small></span>' +
    '<button type="button" class="secondary" id="remindersSync"' + (remindersBusy ? ' disabled' : '') + '>Sync Now</button></div></div>' +
    '<p class="feedback">' + esc(remindersProblem) + '</p>' +
    '<p class="hint">Tasks in this list are added to Reminders, and open reminders appear here. If both sides changed the same task, Reminders wins. Deleting a task here does not delete its reminder. Shishi syncs when it starts and every 5 minutes.</p>' +
    '<div class="actions"><button type="button" class="mini-link danger-link" id="remindersDisconnect">Stop Syncing</button><span class="spacer"></span><button type="button" class="primary" data-close>Done</button></div>', navigation);
  $('remindersSync').onclick = () => { action(syncReminders()); showReminders(); };
  $('remindersDisconnect').onclick = () => action(change(state => {
    delete state.reminders;
    state.tasks.forEach(task => { delete task.reminder; });
  }).then(() => { remindersProblem = ''; showReminders(); toast('Stopped syncing with Reminders. Your tasks stay in both places.'); }));
}

setTimeout(() => { syncReminders({quiet: true}); }, 8000);
setInterval(() => { syncReminders({quiet: true}); }, 5 * 60 * 1000);

// Calendar events, read only. Fetched for today and the next 7 days, refreshed every 10 minutes and at midnight.
window.CalendarEvents = (() => {
  let events = [], problem = '', fetchedFor = '';
  const time = new Intl.DateTimeFormat('en-US', {hour: 'numeric', minute: '2-digit'});
  const dayOf = iso => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const enabled = () => !!data.calendar?.enabled;
  async function refresh() {
    if (!enabled()) { events = []; return; }
    try {
      events = (await native('calendarEvents', {from: day(), days: 8})).events || [];
      problem = ''; fetchedFor = day();
    } catch (error) { problem = error.message; events = []; }
    render();
  }
  function on(date) {
    // An event that spans several days shows on each of them.
    return events.filter(event => dayOf(event.start) <= date && (event.allDay ? dayOf(new Date(new Date(event.end) - 1)) : dayOf(event.end)) >= date)
      .sort((a, b) => (b.allDay - a.allDay) || a.start.localeCompare(b.start));
  }
  function markup(date) {
    if (!enabled()) return '';
    const list = on(date);
    if (!list.length) return problem && date === day() ? '<p class="feedback calendar-problem">' + esc(problem) + '</p>' : '';
    return '<div class="calendar-events" aria-label="Calendar">' + list.map(event =>
      '<div class="calendar-event" style="--event-color:' + esc(/^#[0-9a-f]{6}$/i.test(event.color) ? event.color : 'var(--gray)') + '" title="' + esc(event.calendar) + '">' +
      '<span class="event-time">' + (event.allDay ? 'All day' : esc(time.format(new Date(event.start)))) + '</span><span class="event-title">' + esc(event.title || 'Busy') + '</span></div>').join('') + '</div>';
  }
  function next() {
    if (!enabled()) return null;
    const now = Date.now();
    return on(day()).find(event => !event.allDay && new Date(event.end) > now) || null;
  }
  setInterval(() => { if (fetchedFor !== day()) refresh(); }, 60 * 1000);
  setInterval(refresh, 10 * 60 * 1000);
  setTimeout(refresh, 3000);
  return {refresh, markup, next, on, problem: () => problem, label: event => time.format(new Date(event.start)) + ' ' + event.title};
})();

// GitHub issues → tasks (public repositories, no account). Imported every 15 minutes and on demand.
let issuesBusy = false, issuesProblem = '';
async function syncIssues({quiet = false} = {}) {
  const config = data.github;
  if (!config || issuesBusy) return;
  issuesBusy = true;
  try {
    const fetched = await native('githubIssues', {repo: config.repo, assignee: config.assignee || '', label: config.label || ''});
    let stats;
    await change(state => {
      if (!state.github) throw Error('The issue import was turned off.');
      if (!state.projects.includes(state.github.project)) state.projects.push(state.github.project);
      stats = IssueSync.plan(state.tasks, fetched.issues || [], {project: state.github.project, newId: uuid, stamp: stampNow()});
      state.github.lastSync = stampNow();
    });
    issuesProblem = '';
    const parts = [stats.imported && stats.imported + ' new', stats.closed && stats.closed + ' closed', stats.reopened && stats.reopened + ' reopened'].filter(Boolean);
    if (!quiet || parts.length) toast(parts.length ? 'GitHub issues: ' + parts.join(', ') : 'GitHub issues are up to date');
  } catch (error) {
    issuesProblem = error.message;
    if (!quiet) throw error;
  } finally {
    issuesBusy = false;
    if ($('dialog').open && $('issuesStatus')?.isConnected) showIssues();
  }
}

function showIssues() {
  const config = data.github;
  const navigation = {label: 'Settings', back: () => showConnectors('sync')};
  if (!config) {
    dialog('GitHub Issues', '<p class="hint">Turn a public repository’s open issues into tasks. A task is checked off when its issue closes, and opens again if the issue reopens. No GitHub account is needed.</p>' +
      '<form id="issuesForm"><label>Repository<input id="issuesRepo" required autocomplete="off" placeholder="owner/repo"></label>' +
      '<div class="formgrid"><label>Assigned to<input id="issuesAssignee" autocomplete="off" placeholder="Anyone (or a user name)"></label>' +
      '<label>With label<input id="issuesLabel" autocomplete="off" placeholder="Any"></label></div>' +
      '<label>Add to this list<select id="issuesProject"><option value="">A new list named after the repository</option>' + options(data.projects, null, projectLabel) + '</select></label>' +
      '<p class="feedback" id="issuesFeedback" role="status"></p><div class="actions"><button class="primary">Import Issues</button></div></form>', navigation);
    $('issuesRepo').focus();
    $('issuesForm').onsubmit = async event => {
      event.preventDefault();
      const repo = $('issuesRepo').value.trim(), chosen = $('issuesProject').value;
      const config = {repo, assignee: $('issuesAssignee').value.trim(), label: $('issuesLabel').value.trim()};
      try {
        await native('githubIssues', config);
        await change(state => {
          let project = chosen || repo.split('/')[1].slice(0, 32);
          if (!chosen) { let name = project, n = 2; while (state.projects.includes(name)) name = project.slice(0, 28) + ' ' + n++; project = name; }
          if (!state.projects.includes(project)) state.projects.push(project);
          state.github = {...config, project};
        });
        showIssues();
        await syncIssues();
      } catch (error) { if ($('issuesFeedback')) $('issuesFeedback').textContent = error.message; else toast(error.message); }
    };
    return;
  }
  const linked = data.tasks.filter(task => task.github?.url).length;
  const filters = [config.assignee && 'assigned to ' + config.assignee, config.label && 'labelled “' + config.label + '”'].filter(Boolean).join(', ');
  dialog('GitHub Issues', '<div class="group-box"><div class="group-row"><span class="app-badge" style="--badge:var(--ink)">' + symbol('i-link') + '</span>' +
    '<span class="row-text"><b>' + esc(config.repo) + '</b><small id="issuesStatus">' + (issuesBusy ? 'Importing…' : esc(
      (filters ? 'Open issues ' + filters : 'All open issues') + ' → “' + projectLabel(config.project) + '” · ' + linked + (linked === 1 ? ' task' : ' tasks') +
      (config.lastSync ? ' · Checked ' + dayLabel(config.lastSync.slice(0, 10)) + ' ' + config.lastSync.slice(11) : ''))) + '</small></span>' +
    '<button type="button" class="secondary" id="issuesSync"' + (issuesBusy ? ' disabled' : '') + '>Import Now</button></div></div>' +
    '<p class="feedback">' + esc(issuesProblem) + '</p>' +
    '<p class="hint">Shishi checks every 15 minutes. Checking off a task here does not close the issue on GitHub. Deleting a task does not delete the issue.</p>' +
    '<div class="actions"><button type="button" class="mini-link danger-link" id="issuesStop">Stop Importing</button><span class="spacer"></span><button type="button" class="primary" data-close>Done</button></div>', navigation);
  $('issuesSync').onclick = () => { action(syncIssues()); showIssues(); };
  $('issuesStop').onclick = () => action(change(state => { delete state.github; }).then(() => { issuesProblem = ''; showIssues(); toast('Stopped importing issues. The tasks stay in your list.'); }));
}
setTimeout(() => { syncIssues({quiet: true}); }, 10000);
setInterval(() => { syncIssues({quiet: true}); }, 15 * 60 * 1000);
