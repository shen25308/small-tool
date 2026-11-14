'use strict';
/* A stand-in for the Swift host, for tests only. It is injected into UI/index.html before the app's scripts
   and implements window.webkit.messageHandlers.host.postMessage with sample data held in memory.
   Nothing here ships: build.py copies UI/ only, and this file lives in tests/fixtures/.
   Configure with window.__SHISHI_TEST__ = {lang, timeZone, workspace, inbox:{codex,external}, quota, prefs, compact, failLoad}. */
(() => {
  const cfg = window.__SHISHI_TEST__ || {};
  const copy = v => JSON.parse(JSON.stringify(v));
  const state = {
    workspace: cfg.workspace === undefined ? null : copy(cfg.workspace),
    prefs: {...(cfg.prefs || {})},
    inbox: {codex: copy((cfg.inbox && cfg.inbox.codex) || []), external: copy((cfg.inbox && cfg.inbox.external) || [])},
    compact: !!cfg.compact, edge: false, edgeMail: false, focus: false, codex: true,
    saves: 0, ops: [], opened: [], sizes: [],
  };
  const tell = (fn, arg) => setTimeout(() => { if (typeof window[fn] === 'function') window[fn](arg); }, 0);
  const rows = channel => state.inbox[channel].slice().sort((a, b) => b.time - a.time || (a.id < b.id ? -1 : 1));
  const push = channel => tell('setInbox', {channel, items: copy(rows(channel)), error: ''});

  // The same checks as Workspace.validate() and the Entry decoder in main.swift.
  function validate(ws) {
    const text = ['id', 'title', 'project', 'tag', 'priority', 'planned', 'source', 'quote'];
    const ok = ws && (ws.version === 1 || ws.version === 2) && Array.isArray(ws.projects) && ws.projects.length &&
      new Set(ws.projects).size === ws.projects.length && Array.isArray(ws.tasks) &&
      new Set(ws.tasks.map(t => t.id)).size === ws.tasks.length &&
      ws.tasks.every(t => text.every(k => typeof t[k] === 'string') && typeof t.done === 'boolean' && t.title && ws.projects.includes(t.project) &&
        ['dueDate', 'dueTime', 'plannedTime', 'completedAt'].every(k => t[k] === undefined || typeof t[k] === 'string') &&
        (t.deferCount === undefined || Number.isInteger(t.deferCount)));
    if (!ok) throw Error('Invalid workspace data.');
  }
  const find = id => state.inbox.codex.find(r => r.id === id) || state.inbox.external.find(r => r.id === id);
  const handlers = {
    locale: () => ({languages: [cfg.lang || 'zh-Hans'], timeZone: cfg.timeZone || 'America/Los_Angeles'}),
    prefs(m) {
      for (const [k, v] of Object.entries(m.set || {})) { if (v === null) delete state.prefs[k]; else state.prefs[k] = v; }
      return {...state.prefs};
    },
    load() { if (cfg.failLoad) throw Error('Invalid workspace data.'); return state.workspace === null ? null : copy(state.workspace); },
    save(m) { if (cfg.failLoad) throw Error('The task list could not be saved.'); validate(m.state); state.workspace = copy(m.state); state.saves++; return true; },
    ready() { if (state.compact) tell('setCompact', true); push('codex'); push('external'); tell('setEdgeVisible', state.edge); return true; },
    quota: () => copy(cfg.quota || {providers: [
      {id: 'codex', windows: [], status: 'unconfirmed'}, {id: 'claude', windows: [], status: 'needsStatusLine'},
      {id: 'grok', windows: [], status: 'usageOnly'}, {id: 'qwen', windows: [], status: 'local', available: true}]}),
    inboxState(m) {
      for (const c of m.changes || []) {
        const row = find(c.id); if (!row) throw Error('This message no longer exists.');
        if ('read' in c) row.read = !!c.read; if ('archived' in c) row.archived = !!c.archived; if ('accepted' in c) row.accepted = !!c.accepted;
      }
      push('codex'); push('external'); return true;
    },
    readNotice(m) { const row = find(m.key); if (row) row.read = true; push(m.channel || 'codex'); return rows(m.channel || 'codex'); },
    focus(m) { state.focus = !!m.value; return state.focus; },
    syncInboxes() { push('codex'); push('external'); return true; },
    codexConnection(m) { if (typeof m.enabled === 'boolean') state.codex = m.enabled; return state.codex; },
    externalProvider: m => m.provider === 'github' ? {connected: false} : {accounts: [], configuredDefault: false},
    edgeMailPreference(m) { if (typeof m.value === 'boolean') state.edgeMail = m.value; return state.edgeMail; },
    returnToEdge() { tell('setWorkspaceReturn', false); return true; },
    edgeVisibility(m) { state.edge = !!m.value; tell('setEdgeVisible', state.edge); return state.edge; },
    openConnectorLink(m) { state.opened.push(m.key); return 'Opened'; },
    copyConnectorSetup: () => true,
    openCodex(m) { state.opened.push(m.thread); return true; },
    paste: () => cfg.clipboard || '',
    latestSize(m) { state.sizes.push(!!m.expanded); return true; },
    compact(m) { state.compact = !!m.value; tell('setCompact', state.compact); return true; },
    extract: () => copy(cfg.extract || []),
  };
  window.webkit = {messageHandlers: {host: {postMessage(m) {
    state.ops.push(m.op);
    setTimeout(() => {
      try {
        if (!handlers[m.op]) throw Error('Unsupported action.');
        window.hostReply(m.id, true, handlers[m.op](m));
      } catch (error) { window.hostReply(m.id, false, error.message); }
    }, 0);
  }}}};
  // The results panel (result-panel.html) talks to a second handler, `edge`.
  const edgeRows = () => [...state.inbox.codex.map(r => ({...r, channel: 'codex'})), ...state.inbox.external.map(r => ({...r, channel: 'external'}))]
    .filter(r => !r.archived).sort((a, b) => b.time - a.time).slice(0, 40);
  const edgeSend = () => tell('setEdgeInbox', {items: copy(edgeRows())});
  state.edgeOps = [];
  window.webkit.messageHandlers.edge = {postMessage(m) {
    state.edgeOps.push(m);
    if (m.op === 'ready') edgeSend();
    if (m.op === 'read') { const row = find(m.key); if (row) row.read = true; edgeSend(); }
  }};
  window.__host = {
    edgeSend,
    edgeDeliver(list) { for (const r of list) state.inbox[r.channel || 'external'].push(r); edgeSend(); },
    state,
    /* New results arriving from Codex or a connector, as the host would report them on its next scan. */
    deliver(list) { for (const r of list) state.inbox[r.channel || 'external'].push(r); push('codex'); push('external'); },
    setCompact(on) { state.compact = !!on; tell('setCompact', state.compact); },
  };
})();
