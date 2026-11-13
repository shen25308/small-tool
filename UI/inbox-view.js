'use strict';
// The Inbox as a main view: a list of results beside a reader (INBOX-LAYOUT). Selecting a result is the only thing
// that changes the reader; results that arrive meanwhile join the list and are counted under "Show latest".
// Leaving for Settings or a sheet and coming back keeps the selected result, its tab and both scroll positions
// (RETURN-STATE). Search covers every stored reply, read or archived (INBOX-SEARCH). At 1000 px and narrower the
// view becomes list → reader → Back.
window.InboxView = (() => {
  const state = {selected: '', tab: 'preview', filter: 'inbox', query: '', narrowReader: false, known: null, pending: [], listTop: 0, readerTop: 0};
  const FILTERS = [['inbox', 'Inbox'], ['unread', 'Unread'], ['review', 'Needs review'], ['snoozed', 'Snoozed'], ['archived', 'Archived']];
  const narrowQuery = matchMedia('(max-width: 1000px)');
  let drawnReader = '';

  const isFeed = note => ['Gmail', 'Outlook', 'Reminders', 'GitHub Actions'].includes(note.source);
  const kind = note => ['Gmail', 'Outlook'].includes(note.source) ? 'Email' : note.source === 'GitHub Actions' ? 'Build result' : note.source === 'Reminders' ? 'Reminder' : 'Task result';
  const snoozedUntil = note => data.snoozed?.[note.id] || '';
  const isSnoozed = note => snoozedUntil(note) > day();
  function verdict(note) {
    if (isFeed(note) || !window.AgentReport) return null;
    return AgentReport.brief(note, window.agentForNotice?.(note.id) || {});
  }
  const needsReview = note => !note.archived && !isSnoozed(note) && (verdict(note)?.action || 'none') !== 'none';

  // The list a result belongs to: the agent's folder (or a folder inside it), or the folder name in its title.
  function projectOf(note) {
    const folders = Object.entries(data.projectFolders || {}).filter(([id]) => data.projects.includes(id));
    const cwd = window.agentForNotice?.(note.id)?.cwd || '';
    const byPath = cwd && folders.find(([, path]) => cwd === path || cwd.startsWith(path.replace(/\/$/, '') + '/'));
    if (byPath) return byPath[0];
    const tail = String(note.title || '').split(' · ').slice(1).join(' · ').trim();
    if (!tail) return '';
    const byFolder = folders.find(([, path]) => path.split('/').filter(Boolean).pop() === tail);
    return byFolder ? byFolder[0] : Projects.byName(data, tail) || '';
  }

  function matches(note, query) {
    const text = (note.title + ' ' + (note.summary || '') + ' ' + ResultUI.sourceName(note)).toLocaleLowerCase();
    return query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word => text.includes(word));
  }
  // What the list shows. A search looks through every stored result, whatever the filter.
  function visible() {
    const all = allNotices();
    if (state.query.trim()) return all.filter(note => matches(note, state.query.trim()));
    const f = state.filter;
    if (f === 'archived') return all.filter(note => note.archived);
    if (f === 'snoozed') return all.filter(note => !note.archived && isSnoozed(note));
    const live = all.filter(note => !note.archived && !isSnoozed(note));
    if (f === 'unread') return live.filter(note => !note.read);
    if (f === 'review') return live.filter(needsReview);
    if (f.startsWith('source:')) return live.filter(note => ResultUI.sourceName(note) === f.slice(7));
    if (f.startsWith('project:')) return all.filter(note => !note.archived && projectOf(note) === f.slice(8));
    return live;
  }

  function shell() {
    const box = $('altView');
    if (box.dataset.view === 'inbox') return;
    box.dataset.view = 'inbox';
    drawnReader = '';
    box.innerHTML = '<div class="alt-page"><header class="alt-head"><h1 id="altTitle">Inbox</h1><p>Finished work from your agents and connections. Read it when you are ready.</p></header>' +
      '<div class="inbox-view" id="inboxView">' +
      '<section class="inbox-list-pane" aria-label="Results">' +
        '<div class="inbox-list-tools"><select id="inboxFilter" aria-label="Show"></select>' +
        '<input id="inboxSearch" type="search" placeholder="Search all results" aria-label="Search all results, including read and archived" autocomplete="off" spellcheck="false"></div>' +
        '<div class="inbox-list-meta"><span id="inboxListCount" aria-live="polite"></span><button type="button" class="mini-link" id="inboxLatest" hidden></button>' +
        '<button type="button" class="mini-link" id="inboxReadAll" hidden></button></div>' +
        '<p class="feedback" id="inboxWarnings" hidden></p>' +
        '<div class="inbox-items" id="inboxItems" role="listbox" aria-label="Results"></div></section>' +
      '<section class="inbox-reader" id="inboxReader" aria-label="Reader" tabindex="-1"></section></div></div>';
    $('inboxSearch').value = state.query;
    $('inboxSearch').addEventListener('input', event => { state.query = event.target.value; render(); });
    $('inboxFilter').addEventListener('change', event => { state.filter = event.target.value; state.query = ''; $('inboxSearch').value = ''; render(); });
    $('inboxLatest').onclick = () => { const newest = state.pending[0]; state.pending = []; if (newest) select(newest); };
    $('inboxReadAll').onclick = () => { const unread = visible().filter(note => !note.read); setStates(unread, {read: true}, 'Marked ' + plural(unread.length, 'result') + ' read'); };
    $('inboxItems').addEventListener('click', event => { const item = event.target.closest('[data-notice]'); if (item) select(item.dataset.notice, {focusReader: false}); });
    $('inboxItems').addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      const items = [...$('inboxItems').querySelectorAll('[data-notice]')];
      const at = items.indexOf(document.activeElement);
      if (event.key === 'Enter' && at >= 0) { event.preventDefault(); select(items[at].dataset.notice, {focusReader: true}); return; }
      const next = items[Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { event.preventDefault(); next.focus(); select(next.dataset.notice, {focusReader: false}); }
    });
    $('inboxItems').addEventListener('scroll', () => { state.listTop = $('inboxItems').scrollTop; }, {passive: true});
    $('inboxReader').addEventListener('scroll', () => { state.readerTop = $('inboxReader').scrollTop; }, {passive: true});
    $('inboxReader').addEventListener('click', readerClick);
  }

  function itemMarkup(note) {
    const info = ResultUI.digest(note), brief = verdict(note);
    const project = projectOf(note);
    const color = SourceColors.colorFor(ResultUI.sourceName(note));
    const status = brief ? brief.label : '';
    const preview = (isFeed(note) ? note.summary : info.details[0] || info.excerpt || note.summary || '').replace(/\s+/g, ' ').slice(0, 180);
    return '<button type="button" role="option" class="inbox-item' + (note.read ? '' : ' unread') + (color ? ' has-source-color' : '') + '"' +
      (color ? ' style="--source-color:' + color + '"' : '') + ' data-notice="' + esc(note.id) + '" aria-selected="' + (note.id === state.selected) + '">' +
      '<span class="inbox-item-top"><span class="source-dot" aria-hidden="true"></span><b>' + esc(ResultUI.sourceName(note)) + '</b>' +
      '<time>' + esc(inboxDate(note.time)) + '</time></span>' +
      '<span class="inbox-item-title">' + esc(isFeed(note) ? note.title : info.headline) + '</span>' +
      (preview ? '<span class="inbox-item-preview">' + esc(preview) + '</span>' : '') +
      '<span class="inbox-item-foot">' + (status ? '<span class="inbox-item-status tone-' + esc(brief.tone) + '">' + esc(status) + '</span>' : '') +
      '<span>' + esc([project ? projectLabel(project) : String(note.title || '').split(' · ').slice(1).join(' · '), isSnoozed(note) && 'Snoozed until ' + dayLabel(snoozedUntil(note)), note.archived && 'Archived'].filter(Boolean).join(' · ')) + '</span>' +
      (note.read ? '' : '<span class="unread-dot" aria-label="Unread"></span>') + '</span></button>';
  }

  function renderList() {
    const list = visible();
    const select = $('inboxFilter');
    const sources = [...new Set(allNotices().filter(note => !note.archived).map(ResultUI.sourceName))];
    const choices = [...FILTERS, ...sources.map(name => ['source:' + name, name])];
    if (state.filter.startsWith('project:')) choices.push([state.filter, projectLabel(state.filter.slice(8))]);
    const key = JSON.stringify(choices);
    if (select.dataset.key !== key) { select.dataset.key = key; select.innerHTML = choices.map(([value, label]) => '<option value="' + esc(value) + '">' + esc(label) + '</option>').join(''); }
    select.value = state.filter;
    const unread = list.filter(note => !note.read).length;
    $('inboxListCount').textContent = state.query.trim() ? plural(list.length, 'result') + ' in all results' : plural(list.length, 'result') + (unread ? ' · ' + unread + ' unread' : '');
    $('inboxReadAll').hidden = !unread || !!state.query.trim();
    $('inboxReadAll').textContent = 'Mark ' + unread + ' Read';
    $('inboxLatest').hidden = !state.pending.length;
    $('inboxLatest').textContent = plural(state.pending.length, 'new result') + ' · Show latest';
    const warnings = [...inboxErrors.values()].filter(Boolean).join(' · ');
    $('inboxWarnings').textContent = warnings; $('inboxWarnings').hidden = !warnings;
    const box = $('inboxItems');
    const html = list.slice(0, 300).map(itemMarkup).join('') ||
      '<p class="empty">' + (state.query.trim() ? 'No result mentions “' + esc(state.query.trim()) + '”.' : state.filter === 'archived' ? 'Nothing archived.' : state.filter === 'snoozed' ? 'Nothing snoozed.' : 'No results here.') + '</p>';
    if (box.dataset.html !== html) {
      const focused = document.activeElement?.closest?.('#inboxItems [data-notice]')?.dataset.notice;
      box.innerHTML = html;
      box.dataset.html = html;
      if (focused) box.querySelector('[data-notice="' + CSS.escape(focused) + '"]')?.focus({preventScroll: true});
    }
    box.scrollTop = state.listTop;
  }

  function readerMarkup(note) {
    if (!note) return '<div class="reader-empty">' + symbol('inbox') + '<p>' + (allNotices().length ? 'Select a result to read it here.' : 'Finished work from your agents and connections arrives here.') + '</p></div>';
    const info = ResultUI.digest(note), brief = verdict(note), source = ResultUI.sourceName(note), color = SourceColors.colorFor(source);
    const project = projectOf(note), follow = data.tasks.find(task => task.fromNotice === note.id);
    const when = new Intl.DateTimeFormat('en-US', {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(note.time * 1000));
    const points = brief ? brief.points : info.details;
    const files = brief ? brief.files : info.files.map(file => file.label);
    const preview = isFeed(note) ? '<p class="reader-text">' + esc(note.summary || '') + '</p>'
      : (points.length ? '<h3>What changed</h3><ul class="reader-points">' + points.map(point => '<li>' + esc(point) + '</li>').join('') + '</ul>' : '') +
        (files.length ? '<h3>Files</h3><div class="reader-files">' + files.map(file => '<code>' + esc(file) + '</code>').join('') + '</div>' : '') +
        (info.excerpt ? '<h3>From the reply</h3><blockquote class="reader-quote">' + esc(info.excerpt) + '</blockquote>' : '') +
        (!points.length && !files.length && !info.excerpt ? '<p class="reader-text">' + esc(note.summary || 'No reply was attached.') + '</p>' : '');
    return '<div class="reader-inner">' +
      '<button type="button" class="mini-link reader-back" data-reader="back">' + symbol('back') + 'Back to Inbox</button>' +
      '<div class="reader-meta"><span class="source-chip' + (color ? ' has-source-color' : '') + '"' + (color ? ' style="--source-color:' + color + '"' : '') + '><span class="source-dot" aria-hidden="true"></span>' + esc(source) + '</span><time>' + esc(when) + '</time></div>' +
      '<h2 class="reader-title">' + esc(isFeed(note) ? note.title : info.headline) + '</h2>' +
      '<div class="reader-crumbs">' + (project ? '<button type="button" class="mini-link" data-reader="project" data-project-id="' + esc(project) + '">' + esc(projectLabel(project)) + '</button><span aria-hidden="true">›</span>' : '') +
        '<span>' + esc(kind(note)) + '</span>' + (note.title && !isFeed(note) ? '<span aria-hidden="true">·</span><span>' + esc(note.title) + '</span>' : '') + '</div>' +
      (brief ? '<div class="reader-verdict tone-' + esc(brief.tone) + '"><b>' + esc(brief.label) + '</b><span>' + esc(brief.reason) + '</span>' + (brief.evidence ? '<small>' + esc(brief.evidence) + '</small>' : '') + '</div>' : '') +
      '<div class="reader-actions">' +
        '<button type="button" class="secondary" data-reader="read">' + (note.read ? 'Mark Unread' : 'Mark Read') + '</button>' +
        '<button type="button" class="secondary" data-reader="follow">' + (follow ? 'View Follow-up' : 'Add Follow-up') + '</button>' +
        '<button type="button" class="secondary" data-reader="snooze">' + (isSnoozed(note) ? 'Unsnooze' : 'Snooze Until Tomorrow') + '</button>' +
        '<button type="button" class="secondary" data-reader="archive">' + (note.archived ? 'Move to Inbox' : 'Archive') + '</button>' +
        (note.thread || note.link ? '<button type="button" class="mini-link" data-reader="open">' + (isFeed(note) ? (['Gmail', 'Outlook'].includes(note.source) ? 'Open Email' : 'View Build') : 'Open Conversation') + '</button>' : '') +
      '</div>' +
      '<div class="reader-tabs" role="tablist"><button type="button" role="tab" data-reader-tab="preview" aria-selected="' + (state.tab === 'preview') + '">Preview</button>' +
        '<button type="button" role="tab" data-reader-tab="original" aria-selected="' + (state.tab === 'original') + '">' + (isFeed(note) ? 'Full Record' : 'Original Reply') + '</button></div>' +
      '<div class="reader-body" role="tabpanel">' + (state.tab === 'original' ? '<pre class="reader-original">' + esc(note.summary || 'No reply was attached to this result.') + '</pre>' : preview) + '</div>' +
      '</div>';
  }

  function renderReader() {
    const note = allNotices().find(item => item.id === state.selected);
    if (state.selected && !note) state.selected = '';
    const html = readerMarkup(note);
    const key = (note ? note.id + '|' + note.read + '|' + note.archived + '|' + snoozedUntil(note) + '|' + note.summary.length : '') + '|' + state.tab + '|' + html.length;
    const reader = $('inboxReader');
    if (drawnReader !== key) { reader.innerHTML = html; drawnReader = key; }
    reader.scrollTop = state.readerTop;
  }

  function render() {
    if (view !== 'inbox') return;
    shell();
    // Results that arrive while one is being read are counted, never swapped in.
    const ids = allNotices().map(note => note.id);
    if (state.known) {
      const fresh = ids.filter(id => !state.known.has(id));
      if (state.selected) state.pending = [...fresh, ...state.pending.filter(id => ids.includes(id))];
    }
    state.known = new Set(ids);
    $('inboxView').classList.toggle('narrow', narrowQuery.matches);
    $('inboxView').classList.toggle('showing-reader', narrowQuery.matches && state.narrowReader && !!state.selected);
    renderList();
    renderReader();
  }

  function select(id, {tab = 'preview', focusReader = true} = {}) {
    const note = allNotices().find(item => item.id === id);
    if (!note) return;
    if (state.selected !== id) { state.readerTop = 0; state.tab = tab; }
    else if (tab !== 'preview') state.tab = tab;
    state.selected = id;
    state.narrowReader = true;
    state.pending = state.pending.filter(item => item !== id);
    if (!note.read) action(readNotice(note));
    render();
    $('inboxItems').querySelector('[data-notice="' + CSS.escape(id) + '"]')?.scrollIntoView({block: 'nearest'});
    state.listTop = $('inboxItems').scrollTop;
    if (focusReader) $('inboxReader').focus({preventScroll: true});
  }

  function readerClick(event) {
    const tab = event.target.closest('[data-reader-tab]');
    if (tab) { state.tab = tab.dataset.readerTab; state.readerTop = 0; render(); return; }
    const button = event.target.closest('[data-reader]');
    const note = allNotices().find(item => item.id === state.selected);
    if (!button || !note) return;
    const what = button.dataset.reader;
    if (what === 'back') { state.narrowReader = false; render(); $('inboxItems').querySelector('[aria-selected="true"]')?.focus(); }
    else if (what === 'read') setStates([note], {read: !note.read}, note.read ? 'Marked unread' : 'Marked read');
    else if (what === 'archive') setStates([note], {archived: !note.archived}, note.archived ? 'Moved back to the inbox' : 'Archived');
    else if (what === 'open') cardOptions.open(note);
    else if (what === 'project') go('p:' + button.dataset.projectId);
    else if (what === 'snooze') {
      const until = isSnoozed(note) ? '' : addDays(day(), 1);
      action(change(s => { s.snoozed = {...(s.snoozed || {})}; if (until) s.snoozed[note.id] = until; else delete s.snoozed[note.id]; if (!Object.keys(s.snoozed).length) delete s.snoozed; })
        .then(() => toast(until ? 'Snoozed until tomorrow' : 'Back in the inbox', () => action(change(s => { s.snoozed = {...(s.snoozed || {})}; if (until) delete s.snoozed[note.id]; else s.snoozed[note.id] = snoozedUntil(note); })))));
    } else if (what === 'follow') {
      const existing = data.tasks.find(task => task.fromNotice === note.id);
      if (existing) { taskForm(existing); return; }
      const info = ResultUI.digest(note);
      const follow = newTask({title: ('Follow up: ' + (isFeed(note) ? note.title : info.headline)).slice(0, 240), planned: day(), source: (note.summary || '').slice(0, 2400),
                              quote: ResultUI.sourceName(note) + ' · ' + note.title, fromNotice: note.id, project: projectOf(note) || data.projects[0]});
      action(change(s => { if (!s.projects.includes(follow.project)) follow.project = s.projects[0]; s.tasks.push(follow); }).then(() => toast('Follow-up added to Today', () => action(change(s => { s.tasks = s.tasks.filter(task => task.id !== follow.id); })))));
    }
  }

  // Opens the Inbox on one result, on its original reply when asked (F09). Used by the card, agents and tasks.
  function open(id, {original = false} = {}) {
    const note = allNotices().find(item => item.id === id);
    if (note && !visible().some(item => item.id === id)) { state.filter = note.archived ? 'archived' : isSnoozed(note) ? 'snoozed' : 'inbox'; state.query = ''; }
    if (view !== 'inbox') go('inbox');
    if ($('inboxSearch')) $('inboxSearch').value = state.query;
    select(id, {tab: original ? 'original' : 'preview'});
  }
  function search(query) {
    state.query = query;
    if (view !== 'inbox') go('inbox'); else render();
    $('inboxSearch').value = query;
  }
  function showProject(id) { state.filter = 'project:' + id; state.query = ''; if (view !== 'inbox') go('inbox'); else render(); }

  narrowQuery.addEventListener('change', render);
  return {render, open, select, search, showProject, projectOf, needsReview, matches, visible, state};
})();
