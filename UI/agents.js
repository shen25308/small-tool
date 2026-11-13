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
  const entries = [...agentRows, ...(window.Demo?.rows() || [])].map(row => ({...row}));
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

// What a working session is doing now, from its last tool: "Edit billing.py · 14 tools".
function agentActivity(entry) {
  if (entry.state !== 'working' || !entry.activity) return '';
  return entry.activity + (entry.tools > 1 ? ' · ' + entry.tools + ' tools' : '');
}
function agentMarkup(entry) {
  const state = entry.ended ? 'Stopped' : agentWords[entry.state] || 'Idle';
  const detail = agentActivity(entry) || entry.detail;
  return '<button type="button" class="agent-row" data-agent="' + esc(entry.key) + '" title="' + esc(entry.title + (entry.detail ? '\n' + entry.detail : '')) + '">' +
    '<span class="agent-dot ' + esc(entry.ended ? 'ended' : entry.state) + '" aria-hidden="true"></span><span class="agent-title">' + esc(entry.title) + '</span>' +
    '<span class="agent-time">' + agentAge(entry.time) + '</span>' +
    '<span class="agent-detail"><span class="agent-state ' + esc(entry.ended ? 'ended' : entry.state) + '">' + state + '</span>' + (detail ? ' · ' + esc(detail) : '') + '</span></button>';
}

function dismissAgent(entry) {
  return dismissAgentEntry(entry);
}

function renderAgents() {
  const entries = agentEntries();
  $('agentList').innerHTML = entries.map(agentMarkup).join('') ||
    '<p class="agent-empty">Claude Code and Codex appear here while they work.</p><button type="button" class="mini-link" data-connect-agents>Connect an agent…</button><button type="button" class="mini-link" data-agent-demo>Try a demo</button>';
  window.Island?.update(entries);
  window.Card?.refresh();
  // Once a finished result has been read, its status has done its job.
  const notices = new Map(allNotices().map(note => [note.id, note]));
  for (const row of agentRows) {
    if (row.state !== 'done' || !row.receipt || dismissingAgents.has(row.key) || !notices.get(row.receipt)?.read) continue;
    dismissingAgents.add(row.key);
    native('dismissAgent', {key: row.key}).catch(() => {}).finally(() => dismissingAgents.delete(row.key));
  }
}
window.renderAgents = renderAgents;
// Session facts outlive the agent status: reading a result clears its status, but its verdict must not change.
const factsByNotice = new Map();
window.agentForNotice = id => agentEntries().find(entry => entry.receipt === id || entry.notice?.id === id) || factsByNotice.get(id) || null;
window.setAgents = rows => {
  agentRows = Array.isArray(rows) ? rows : [];
  for (const row of agentRows) if (row.receipt && row.facts) factsByNotice.set(row.receipt, {state: 'done', facts: row.facts, task: row.task || '', started: row.started, time: row.time, receipt: row.receipt});
  renderAgents();
  window.AgentTasks?.link(agentRows);
  // Task rows show their linked session's live state.
  if (agentRows.some(row => row.shishiTask) || data.tasks.some(task => task.agentStarted)) render();
  // Session facts decide inbox verdicts too; refresh an open inbox so both places agree.
  if ($('dialog').open && $('inboxList')) { const top = $('dialog').scrollTop; listNotices(); $('dialog').scrollTop = top; }
};

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
    if (event.target.closest('[data-agent-demo]')) { Demo.start(); return; }
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

// Usage and limits, from the agents' own files on this Mac (Connectors/agent_usage.py). Refreshed every 5 minutes.
window.Usage = (() => {
  let report = null, enabled = true;
  const compactNumber = new Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 1});
  const clock = new Intl.DateTimeFormat('en-US', {hour: 'numeric', minute: '2-digit'});
  const day = new Intl.DateTimeFormat('en-US', {weekday: 'short', hour: 'numeric', minute: '2-digit'});
  const windowName = minutes => !minutes ? 'limit' : minutes % 1440 === 0 ? (minutes / 1440 === 7 ? 'weekly' : minutes / 1440 + '-day') + ' limit' : minutes / 60 + '-hour limit';
  const resets = at => !at ? '' : ', resets ' + (at - Date.now() / 1000 < 20 * 3600 ? clock : day).format(new Date(at * 1000));
  function lines() {
    const out = [];
    const claude = report?.claude;
    if (claude && claude.week.replies) {
      out.push({source: 'Claude Code', text: compactNumber.format(claude.fiveHours.tokens) + ' tokens in 5 hours · ' + compactNumber.format(claude.week.tokens) + ' this week',
                title: 'Input, output and cache-write tokens from Claude Code\'s own session files. ' + compactNumber.format(claude.week.cacheRead) +
                  ' cache-read tokens this week are not included. Anthropic keeps plan limits on its servers, so Shishi shows counts, not a percentage.'});
    }
    const codex = report?.codex;
    for (const name of ['primary', 'secondary']) {
      const limit = codex?.[name];
      if (limit) out.push({source: 'Codex', text: Math.round(limit.usedPercent) + '% of ' + windowName(limit.windowMinutes) + resets(limit.resetsAt),
                           title: 'From the latest rate-limit snapshot Codex wrote to its session files (' + clock.format(new Date(codex.observedAt * 1000)) + ').',
                           high: limit.usedPercent >= 80});
    }
    return out;
  }
  function render() {
    const box = document.getElementById('agentUsage');
    if (!box) return;
    const rows = enabled ? lines() : [];
    box.hidden = !rows.length;
    box.innerHTML = rows.map(row => '<div class="usage-row' + (row.high ? ' high' : '') + '" title="' + esc(row.title) + '"><b>' + esc(row.source) + '</b> ' + esc(row.text) + '</div>').join('');
  }
  function refresh() {
    if (!enabled) { render(); return Promise.resolve(); }
    return native('usage').then(value => { report = value; render(); }).catch(() => {});
  }
  function setEnabled(on) { enabled = !!on; if (enabled) refresh(); else render(); }
  native('settings').then(value => setEnabled(value.usage !== false)).catch(() => {});
  setInterval(refresh, 5 * 60 * 1000);
  return {refresh, setEnabled, lines, report: () => report};
})();

// A newer published release is mentioned once per version, quietly. Shishi never downloads or installs it.
window.Updates = (() => {
  function offer(value) {
    toast('Shishi ' + value.latest + ' is available.', () => action(native('openRelease', {url: value.url})), 'View');
  }
  setTimeout(() => native('checkUpdate', {}).then(value => {
    if (!value?.newer || data.updateNoticed === value.latest) return;
    offer(value);
    action(change(state => { state.updateNoticed = value.latest; }));
  }).catch(() => {}), 15000);
  return {offer};
})();
