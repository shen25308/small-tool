'use strict';
// The Agents list: what each coding agent is doing right now, in a corner you can glance at.
let agentRows = [];
const agentWords = {working: 'Working', attention: 'Needs you', done: 'Finished', idle: 'Idle'};
const agentOrder = {attention: 0, working: 1, done: 2, idle: 3};
const dismissingAgents = new Set();

function agentAge(seconds) {
  const age = Math.max(0, Date.now() / 1000 - seconds);
  if (age < 60) return 'now';
  if (age < 3600) return Math.floor(age / 60) + 'm';
  if (age < 86400) return Math.floor(age / 3600) + 'h';
  return Math.floor(age / 86400) + 'd';
}

function agentEntries() {
  const entries = agentRows.map(row => ({...row}));
  // Codex has no hook here. Its unread finished turns from the last 12 hours stand in for a status.
  const cutoff = Date.now() / 1000 - 12 * 3600, threads = new Set();
  for (const note of inboxes.get('codex') || []) {
    if (note.read || note.time < cutoff || threads.has(note.thread)) continue;
    threads.add(note.thread);
    entries.push({key: 'notice:' + note.id, source: 'Codex', title: note.title, state: 'done', receipt: note.id, time: note.time, notice: note,
                  detail: ResultUI.digest(note).headline || ''});
  }
  return entries.sort((a, b) => agentOrder[a.state] - agentOrder[b.state] || b.time - a.time);
}

function agentMarkup(entry) {
  const state = agentWords[entry.state] || 'Idle';
  return '<button type="button" class="agent-row" data-agent="' + esc(entry.key) + '" title="' + esc(entry.title + (entry.detail ? '\n' + entry.detail : '')) + '">' +
    '<span class="agent-dot ' + esc(entry.state) + '" aria-hidden="true"></span><span class="agent-title">' + esc(entry.title) + '</span>' +
    '<span class="agent-time">' + agentAge(entry.time) + '</span>' +
    '<span class="agent-detail"><span class="agent-state ' + esc(entry.state) + '">' + state + '</span>' + (entry.detail ? ' · ' + esc(entry.detail) : '') + '</span></button>';
}

function dismissAgent(entry) {
  if (entry.notice) return native('readNotice', {key: entry.notice.id, channel: entry.notice.channel});
  return native('dismissAgent', {key: entry.key});
}

function renderAgents() {
  const entries = agentEntries();
  $('agentList').innerHTML = entries.map(agentMarkup).join('') ||
    '<p class="agent-empty">Claude Code and Codex appear here while they work.</p><button type="button" class="mini-link" data-connect-agents>Connect an agent…</button>';
  window.Island?.update(entries);
  // Once a finished result has been read, its status has done its job.
  const notices = new Map(allNotices().map(note => [note.id, note]));
  for (const row of agentRows) {
    if (row.state !== 'done' || !row.receipt || dismissingAgents.has(row.key) || !notices.get(row.receipt)?.read) continue;
    dismissingAgents.add(row.key);
    native('dismissAgent', {key: row.key}).catch(() => {}).finally(() => dismissingAgents.delete(row.key));
  }
}
window.renderAgents = renderAgents;
window.setAgents = rows => { agentRows = Array.isArray(rows) ? rows : []; renderAgents(); };

function agentMenu(entry, at) {
  const hasResult = entry.receipt && allNotices().some(note => note.id === entry.receipt);
  showMenu([
    {heading: (agentWords[entry.state] || 'Idle') + ' · ' + agentAge(entry.time) + (agentAge(entry.time) === 'now' ? '' : ' ago')},
    hasResult && {label: 'Open Result', icon: 'inbox', run: () => openNotice(entry.receipt)},
    hasResult && {label: 'Add Follow-up Task', icon: 'plus', run: () => cardOptions.task(allNotices().find(note => note.id === entry.receipt))},
    entry.detail && {label: 'Copy Details', icon: 'i-copy', run: () => action(native('copy', {text: entry.detail}).then(() => toast('Copied')))},
    '-',
    {label: entry.state === 'done' ? 'Mark as Read' : 'Dismiss', icon: 'i-xmark', run: () => action(dismissAgent(entry))}
  ], at);
}

for (const id of ['agentList']) {
  $(id).addEventListener('click', event => {
    if (event.target.closest('[data-connect-agents]')) { showConnectors(); return; }
    const row = event.target.closest('[data-agent]');
    const entry = row && agentEntries().find(item => item.key === row.dataset.agent);
    if (!entry) return;
    if (entry.state === 'done' && entry.receipt && allNotices().some(note => note.id === entry.receipt)) openNotice(entry.receipt);
    else agentMenu(entry, row);
  });
  $(id).addEventListener('contextmenu', event => {
    const row = event.target.closest('[data-agent]');
    const entry = row && agentEntries().find(item => item.key === row.dataset.agent);
    if (!entry) return;
    event.preventDefault();
    event.stopPropagation();
    agentMenu(entry, {x: event.clientX, y: event.clientY});
  });
}
setInterval(renderAgents, 30000);
