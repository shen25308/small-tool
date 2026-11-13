'use strict';
// The corner card: today at a glance. A date, a progress ring, the open tasks, a line to add one,
// and the agent capsule. Anything bigger opens the full workspace.
window.Card = (() => {
  const root = $('card'), inner = root.querySelector('.card-inner');
  const MAX_ROWS = 6;
  const weekday = new Intl.DateTimeFormat('en-US', {weekday: 'long'});
  let reported = 0, pinnedNow = true;

  const shortTime = (date, time) => new Date(date + 'T' + time).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'}).replace(':00', '');
  function due(task) {
    if (!task.dueDate) return {text: '', late: false};
    const today = day(), late = isOverdue(task);
    if (task.dueDate === today) return {text: task.dueTime ? shortTime(task.dueDate, task.dueTime) : (late ? 'Today' : ''), late};
    return {text: dayLabel(task.dueDate), late};
  }

  function row(task) {
    const when = due(task), title = esc(task.title);
    const level = ['P0', 'P1'].includes(task.priority) ? ' ' + task.priority.toLowerCase() : '';
    return '<article class="row card-row' + level + '" data-id="' + esc(task.id) + '">' +
      '<button class="check" data-act="toggle" aria-pressed="false" aria-label="Complete ' + title + '"></button>' +
      '<button class="task-body" data-card-open title="' + title + '"><span class="title">' + title + '</span></button>' +
      (when.text ? '<span class="card-due' + (when.late ? ' late' : '') + '">' + esc(when.text) + '</span>' : '') +
      '<button type="button" class="card-row-more" data-card-menu title="More" aria-label="More actions for ' + title + '">' + symbol('i-ellipsis') + '</button>' +
      (task.subtasks?.length ? '<span class="card-sub" title="Subtasks">' + task.subtasks.filter(s => s.done).length + '/' + task.subtasks.length + '</span>' : '') +
      '</article>';
  }

  // The report answers one question when an agent finishes: do I need to open it now?
  let reportShown = null, reportFolded = false;
  // Every result still waiting for you, most urgent first: sessions that need you, then unread replies
  // from agents, newest first. Age changes the order, never whether a result can be found (F06).
  const FEEDS = new Set(['Gmail', 'Outlook', 'GitHub Actions', 'Reminders']);
  function candidates() {
    const entries = agentEntries();
    // A request already on the card with Allow and Deny needs no second "Needs you" report.
    const asking = new Set((window.Approvals?.rows() || []).filter(row => row.expires > Date.now() / 1000).map(row => row.id));
    const waiting = entries.filter(entry => entry.state === 'attention' && !asking.has(entry.approval)).map(entry => ({entry, note: null}));
    const unread = allNotices().filter(note => !note.read && !note.archived && !FEEDS.has(note.source)).map(note => {
      const entry = entries.find(item => item.receipt === note.id || item.notice?.id === note.id) ||
        {key: 'note:' + note.id, source: sourceName(note), title: note.title, time: note.time, state: 'done', receipt: note.id,
         notice: note.channel === 'codex' ? note : null, demo: note.channel === 'demo', facts: window.agentForNotice?.(note.id)?.facts};
      return {entry, note};
    });
    return [...waiting, ...unread];
  }
  const sameReport = shown => item => item.entry.key === shown.entry.key && (item.note?.id || '') === (shown.note?.id || '');

  // While you read, select or use the report, it stays put; later arrivals wait behind "New result" (F03).
  let touched = 0, forceNext = false;
  function engaged() {
    const box = $('cardReport'), selection = getSelection();
    return box.matches(':hover') || box.contains(document.activeElement) || Date.now() - touched < 1200 ||
      (!!selection && !selection.isCollapsed && box.contains(selection.anchorNode));
  }
  function reportMarkup({entry, note, others}) {
    const report = AgentReport.brief(note, entry);
    const place = (entry.title || '').split(' · ').slice(1).join(' · ') || entry.title || 'Agent';
    const app = entry.notice ? 'Codex' : AgentReport.appName(entry.app);
    const glyph = {done: 'i-check', neutral: 'i-check', review: 'i-flag', blocked: 'i-bolt'}[report.tone];
    const meta = [entry.source || 'Agent', report.took].filter(Boolean).join(' · ');
    return '<button type="button" class="report-newer" data-report="newer" hidden>' + symbol('i-arrow-right') + 'New result</button>' +
      '<div class="report-head"><b>' + esc(place) + '</b><span>' + esc(meta) + '</span><time>' + agentAge(entry.time) + '</time>' +
      '<button type="button" class="report-fold" data-report="fold" aria-expanded="' + !reportFolded + '" title="' + (reportFolded ? 'Show details' : 'Show less') + '" aria-label="' + (reportFolded ? 'Show details' : 'Show less') + '">' + symbol('i-chevron-down') + '</button>' +
      '<button type="button" class="report-close" data-report="dismiss" title="Dismiss" aria-label="Dismiss">' + symbol('close-icon') + '</button></div>' +
      '<div class="report-verdict"><span class="verdict-badge">' + symbol(glyph) + esc(report.label) + '</span></div>' +
      '<p class="report-reason">' + esc(report.reason) + '</p>' +
      // The exact sentence or observed command behind the verdict.
      (report.evidence && report.evidence !== report.headline ? '<blockquote class="report-evidence selectable">' + esc(report.evidence) + '</blockquote>' : '') +
      '<p class="report-headline">' + esc(report.headline) + '</p>' +
      (report.points.length ? '<ul class="report-points">' + report.points.map(point => '<li>' + esc(point) + '</li>').join('') + '</ul>' : '') +
      (report.files.length || report.tests ? '<div class="report-chips">' + report.files.slice(0, 3).map(file => entry.cwd ? '<button type="button" class="file-chip" data-open-file="' + esc(file) + '" title="Open ' + esc(file) + '"><code>' + esc(file) + '</code></button>' : '<code>' + esc(file) + '</code>').join('') +
        (report.moreFiles ? '<code class="more-files">+' + report.moreFiles + '</code>' : '') +
        (report.tests ? '<span class="test-chip ' + report.tests + '"' + (report.checked ? ' title="' + esc(report.checked) + '"' : '') + '>' +
          ({passed: 'Checks ran and passed', failed: report.verified ? 'A check failed' : 'Reported failing', none: 'No checks ran', claimed: 'Reported passing'})[report.tests] + '</span>' : '') + '</div>' : '') +
      (report.asked ? '<p class="report-asked" title="' + esc(report.asked) + '">You asked: ' + esc(report.asked) + '</p>' : '') +
      '<div class="report-actions"><button type="button" class="' + (report.action === 'none' ? 'secondary' : 'primary') + '" data-report="open">' +
        esc(app ? 'Open in ' + app : 'Open Claude Code') + '</button>' +
        (note ? '<button type="button" class="secondary" data-report="read">Full reply</button>' : '') +
        '<button type="button" class="' + (report.action === 'none' ? 'primary' : 'mini-link') + '" data-report="dismiss">Got it</button></div>' +
      (others > 0 ? '<button type="button" class="report-more" data-report="inbox">' + others + ' more ' + (others === 1 ? 'result' : 'results') + ' in the inbox</button>' : '');
  }
  function renderReport() {
    const list = candidates(), box = $('cardReport');
    const top = list[0];
    const pick = top && {...top, others: list.length - 1};
    root.classList.toggle('has-report', !!pick || !!reportShown);
    // Keep the report being read in place while it still needs attention. Show that something newer is waiting.
    if (reportShown && !forceNext && engaged() && list.some(sameReport(reportShown))) {
      const newer = box.querySelector('.report-newer');
      if (newer) newer.hidden = !pick || sameReport(reportShown)(pick);
      return;
    }
    forceNext = false;
    root.classList.toggle('has-report', !!pick);
    if (!pick) { box.hidden = true; box.replaceChildren(); reportShown = null; return; }
    const key = pick.entry.key + '|' + pick.entry.state + '|' + (pick.note?.id || '') + '|' + pick.others;
    if (reportShown?.key === key) return;
    const report = AgentReport.brief(pick.note, pick.entry);
    box.className = 'card-report verdict-' + report.tone + (reportFolded ? ' folded' : '');
    SourceColors.apply(box, pick.entry.source || sourceName(pick.note || {}));
    box.innerHTML = reportMarkup(pick);
    const appeared = box.hidden || reportShown?.entry.key !== pick.entry.key;
    box.hidden = false;
    reportShown = {...pick, key};
    if (appeared && !Motion.reduced()) box.animate([{opacity: 0, transform: 'translateY(-10px) scale(.98)'}, {opacity: 1, transform: 'none'}], {duration: 520, easing: Motion.spring});
  }
  function reportAction(kind) {
    const pick = reportShown;
    if (!pick) return;
    const {entry, note} = pick;
    const markRead = () => note ? readNotice(note) : dismissAgentEntry(entry);
    if (kind === 'newer') { forceNext = true; renderReport(); return; }
    if (kind === 'fold') {
      reportFolded = !reportFolded;
      const box = $('cardReport'), fold = box.querySelector('.report-fold');
      box.classList.toggle('folded', reportFolded);
      fold.setAttribute('aria-expanded', String(!reportFolded));
      fold.title = reportFolded ? 'Show details' : 'Show less';
      fold.setAttribute('aria-label', fold.title);
      return;
    }
    if (kind === 'dismiss') { action(markRead()); return; }
    if (kind === 'inbox') { inWorkspace(() => $('inboxButton').click()); return; }
    if (kind === 'read') { inWorkspace(() => openNotice(note.id, {original: true})); return; }
    if (entry.demo) { toast('In a real session, this brings forward the app Claude Code runs in.'); action(markRead()); return; }
    const opening = entry.notice ? native('openCodex', {thread: entry.notice.thread})
      : native('openAgentApp', {app: entry.app || '', terminal: entry.terminal || {}, cwd: entry.cwd || ''});
    action(opening.then(result => {
      // Say so when only the app could be brought forward, so nobody hunts for the right tab without knowing.
      if (result?.found === 'app' && (entry.terminal?.iterm || entry.terminal?.tty)) toast('Opened ' + result.app + '. Allow Shishi to control it in System Settings → Privacy → Automation to jump to the exact tab.');
      if (note) return markRead();
    }));
  }

  let claude = null, askedClaude = false;
  function checkClaude() {
    if (askedClaude) return;
    askedClaude = true;
    native('claudeCode', {action: 'status'}).then(state => { claude = state; render(); }).catch(() => { claude = {installed: false}; });
  }
  function renderWelcome() {
    checkClaude();
    const show = !!claude && !claude.installed && !data.welcomed && !root.classList.contains('has-report') && !Demo.running();
    $('cardWelcome').hidden = !show;
  }
  function welcomeAction(kind) {
    if (kind === 'demo') { Demo.start(); render(); return; }
    if (kind === 'close') { action(change(state => { state.welcomed = true; })); return; }
    const button = root.querySelector('[data-welcome="connect"]');
    button.disabled = true;
    action(native('claudeCode', {action: 'install'}).then(state => {
      claude = state;
      toast(state.working ? 'Claude Code is connected. Finish a turn to see a report here.' : state.problem || 'Claude Code is connected.');
      render();
    }).finally(() => { button.disabled = false; }));
  }

  function render() {
    if (!compact) return;
    renderReport();
    renderWelcome();
    const now = new Date();
    const today = data.tasks.filter(isToday);
    const open = today.filter(task => !task.done), done = today.length - open.length;
    $('cardWeekday').textContent = weekday.format(now).toUpperCase();
    $('cardDay').textContent = String(now.getDate());
    $('cardSummary').textContent = open.length ? open.length + (open.length === 1 ? ' task left' : ' tasks left') : today.length ? 'All done' : 'Nothing planned';
    const upcoming = window.CalendarEvents?.next();
    $('cardNextEvent').hidden = !upcoming;
    $('cardNextEvent').textContent = upcoming ? 'Next: ' + CalendarEvents.label(upcoming) : '';
    const ratio = today.length ? done / today.length : 0;
    const ring = $('cardRing');
    ring.style.setProperty('--progress', ratio.toFixed(3));
    ring.classList.toggle('complete', today.length > 0 && done === today.length);
    ring.classList.toggle('zero', done === 0);
    ring.querySelector('.ring-label').textContent = today.length ? done + '/' + today.length : '–';
    ring.setAttribute('aria-label', done + ' of ' + today.length + ' done today');
    const shown = open.slice(0, MAX_ROWS);
    $('cardTasks').innerHTML = shown.map(row).join('') || '<div class="card-empty">' + symbol(today.length ? 'i-check-circle' : 'i-sun') +
      '<span>' + (today.length ? 'Everything for today is done.' : 'A clear day. Add a task below, or plan one from your lists.') + '</span></div>';
    const more = open.length - shown.length;
    $('cardMore').hidden = more <= 0;
    $('cardMore').textContent = '+' + more + ' more';
    $('cardPin').setAttribute('aria-pressed', String(pinnedNow));
    $('cardPin').title = pinnedNow ? 'Kept above other windows' : 'Keep above other windows';
  }

  // The window follows the content: the page measures itself and the app resizes the card.
  // The height the card would need to show everything. Parts that scroll inside the card report their
  // full content height, so a short window can still grow when the screen allows it (F08).
  function naturalHeight() {
    const style = getComputedStyle(inner);
    const parts = [...inner.children].filter(node => node.getClientRects().length);
    const content = parts.reduce((sum, node) => sum + Math.max(node.scrollHeight, node.getBoundingClientRect().height), 0);
    return Math.ceil(content + (parseFloat(style.rowGap) || 0) * Math.max(0, parts.length - 1) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
  }
  function report() {
    if (!compact) return;
    const height = naturalHeight();
    if (!height || height === reported) return;
    reported = height;
    native('cardSize', {height}).catch(() => {});
  }
  const measure = () => requestAnimationFrame(report);
  new ResizeObserver(measure).observe(inner);
  new MutationObserver(measure).observe(inner, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class']});

  function inWorkspace(next) {
    if (!compact) { next(); return; }
    action(native('compact', {value: false}).then(() => { window.setWorkspaceReturn(true); next(); }));
  }

  root.addEventListener('click', event => {
    const file = event.target.closest('[data-open-file]');
    if (file && reportShown) {
      const {entry} = reportShown;
      action(native('openFile', {path: file.dataset.openFile, cwd: entry.cwd || '', app: entry.app || ''}));
      return;
    }
    const report = event.target.closest('[data-report]');
    if (report) { reportAction(report.dataset.report); return; }
    const welcome = event.target.closest('[data-welcome]');
    if (welcome) { welcomeAction(welcome.dataset.welcome); return; }
    const open = event.target.closest('[data-card-open]');
    if (open) {
      const task = data.tasks.find(item => item.id === open.closest('.row').dataset.id);
      if (task) inWorkspace(() => taskForm(task));
      return;
    }
    if (event.target.closest('#cardMore')) inWorkspace(() => go('today'));
    if (event.target.closest('#cardExpand')) inWorkspace(() => {});
    if (event.target.closest('#cardInbox')) inWorkspace(() => $('inboxButton').click());
    if (event.target.closest('#cardPin')) action(setPrefs({pinned: !pinnedNow}));
  });

  // Moving and resizing the card happen in the app's own grip and handle (F15), so pressing anywhere
  // in the page selects text or presses a control as usual.
  let prefs = {snap: true, allSpaces: false, pinned: false, userSized: false};
  const setPrefs = (changes = {}) => native('cardPrefs', changes).then(value => { prefs = value; pinnedNow = value.pinned; render(); return value; });

  // System menus, because a menu drawn in the page could not extend past the card.
  async function menu(items) {
    const runs = new Map();
    const wire = items.filter(Boolean).map((item, index) => {
      if (item === '-') return {separator: true};
      runs.set(String(index), item.run);
      return {id: String(index), title: item.label, checked: !!item.checked, enabled: item.enabled !== false};
    });
    const chosen = await native('nativeMenu', {items: wire});
    runs.get(chosen)?.();
  }
  // The same system menu opens from right-click and from the row's visible More button (F17).
  root.addEventListener('click', event => {
    const more = event.target.closest('[data-card-menu]');
    if (!more) return;
    event.stopPropagation();
    openMenu(more.closest('.row[data-id]'));
  }, true);
  root.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    openMenu(event.target.closest('.row[data-id]'));
  }, true);
  function openMenu(taskRow) {
    const task = taskRow && data.tasks.find(item => item.id === taskRow.dataset.id);
    const plan = date => () => action(patchTask(task.id, item => planOn(item, date)));
    const card = [
      {label: 'Keep Above Other Windows', checked: prefs.pinned, run: () => action(setPrefs({pinned: !prefs.pinned}))},
      {label: 'Show on All Spaces', checked: prefs.allSpaces, run: () => action(setPrefs({allSpaces: !prefs.allSpaces}))},
      {label: 'Snap to Screen Corners', checked: prefs.snap, run: () => action(setPrefs({snap: !prefs.snap}))},
      prefs.userSized && {label: 'Fit Height to Content', run: () => action(setPrefs({fit: true}))},
      '-',
      {label: 'Open Full Workspace', run: () => inWorkspace(() => {})},
      {label: 'Open Inbox', run: () => inWorkspace(() => $('inboxButton').click())}
    ];
    action(menu(task ? [
      {label: 'Complete', run: () => action(toggleTask(task.id))},
      {label: 'Details…', run: () => inWorkspace(() => taskForm(task))},
      '-',
      {label: 'Move to Tomorrow', run: plan(addDays(day(), 1))},
      {label: 'Move to Next Week', run: plan(TaskLogic.nextWeekday(day(), 1))},
      '-',
      ...['P0', 'P1', 'P2'].map(level => ({label: 'Priority ' + level, checked: task.priority === level, run: () => action(patchTask(task.id, item => { item.priority = level; }))})),
      '-',
      {label: 'Delete', run: () => action(removeTask(task))},
      '-', ...card
    ] : card));
  }

  $('cardAdd').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('cardAddInput'), found = parseQuick(input.value, ignoredKinds(input));
    if (!found.title) return;
    const fields = {planned: day()};
    for (const key of ['planned', 'dueDate', 'dueTime', 'priority', 'tag', 'project', 'repeat', 'evening', 'someday']) if (found[key]) fields[key] = found[key];
    input.value = '';
    input.dataset.ignore = '';
    showParseHint(input, $('cardAddHint'));
    action(change(state => { state.tasks.push(newTask({...fields, title: found.title})); }).then(() => {
      if (fields.planned !== day()) toast('Added for ' + dayLabel(fields.planned));
    }));
  });
  $('cardAddInput').addEventListener('input', event => showParseHint(event.target, $('cardAddHint')));
  $('cardAddInput').addEventListener('keydown', event => { if (event.key === 'Escape') { event.target.value = ''; event.target.blur(); } });

  const box = $('cardReport');
  box.addEventListener('pointerdown', () => { touched = Date.now(); });
  const later = () => setTimeout(() => { if (!engaged()) renderReport(); }, 1300);
  box.addEventListener('mouseleave', later);
  box.addEventListener('focusout', later);

  window.setPinned = value => { pinnedNow = !!value; prefs.pinned = pinnedNow; render(); };
  // Agents and results change often. Refresh only the parts they affect, not the task list.
  const refresh = () => { if (compact) { renderReport(); renderWelcome(); } };
  return {render, report, inWorkspace, refresh, setPrefs, prefs: () => prefs};
})();

// ⌃⌥N from any app: the card comes forward with the add field ready.
window.focusQuickAdd = () => { const input = document.getElementById('cardAddInput'); input?.focus(); input?.select(); };
