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
      (task.subtasks?.length ? '<span class="card-sub" title="Subtasks">' + task.subtasks.filter(s => s.done).length + '/' + task.subtasks.length + '</span>' : '') +
      '</article>';
  }

  // The report answers one question when an agent finishes: do I need to open it now?
  let reportShown = null;
  function pendingReport() {
    const entries = agentEntries(), notices = allNotices();
    const unread = entries.filter(entry => entry.state === 'done').map(entry => {
      const note = entry.notice || notices.find(item => item.id === entry.receipt);
      return note && !note.read ? {entry, note} : null;
    }).filter(Boolean);
    const waiting = entries.find(entry => entry.state === 'attention');
    const pick = waiting ? {entry: waiting, note: null} : unread[0];
    return pick && {...pick, others: unread.length - (waiting ? 0 : 1)};
  }
  function reportMarkup({entry, note, others}) {
    const report = AgentReport.brief(note, entry);
    const place = (entry.title || '').split(' · ').slice(1).join(' · ') || entry.title || 'Agent';
    const app = entry.notice ? 'Codex' : AgentReport.appName(entry.app);
    const glyph = {done: 'i-check', review: 'i-flag', blocked: 'i-bolt'}[report.verdict];
    const meta = [entry.source || 'Agent', report.took].filter(Boolean).join(' · ');
    return '<div class="report-head"><b>' + esc(place) + '</b><span>' + esc(meta) + '</span><time>' + agentAge(entry.time) + '</time>' +
      '<button type="button" class="report-close" data-report="dismiss" title="Dismiss" aria-label="Dismiss">' + symbol('close-icon') + '</button></div>' +
      '<div class="report-verdict"><span class="verdict-badge">' + symbol(glyph) + esc(report.label) + '</span><span>' + esc(report.reason) + '</span></div>' +
      '<p class="report-headline">' + esc(report.headline) + '</p>' +
      (report.points.length ? '<ul class="report-points">' + report.points.map(point => '<li>' + esc(point) + '</li>').join('') + '</ul>' : '') +
      (report.files.length || report.tests ? '<div class="report-chips">' + report.files.slice(0, 3).map(file => '<code>' + esc(file) + '</code>').join('') +
        (report.moreFiles ? '<code class="more-files">+' + report.moreFiles + '</code>' : '') +
        (report.tests ? '<span class="test-chip ' + report.tests + '"' + (report.checked ? ' title="' + esc(report.checked) + '"' : '') + '>' +
          ({passed: 'Checks passed', failed: 'Checks failed', none: 'No checks ran'})[report.tests] + '</span>' : '') + '</div>' : '') +
      (report.asked ? '<p class="report-asked" title="' + esc(report.asked) + '">You asked: ' + esc(report.asked) + '</p>' : '') +
      '<div class="report-actions"><button type="button" class="' + (report.verdict === 'done' ? 'secondary' : 'primary') + '" data-report="open">' +
        esc(app ? 'Open in ' + app : 'Open Claude Code') + '</button>' +
        (note ? '<button type="button" class="secondary" data-report="read">Full reply</button>' : '') +
        '<button type="button" class="' + (report.verdict === 'done' ? 'primary' : 'mini-link') + '" data-report="dismiss">Got it</button></div>' +
      (others > 0 ? '<button type="button" class="report-more" data-report="inbox">' + others + ' more ' + (others === 1 ? 'result' : 'results') + ' in the inbox</button>' : '');
  }
  function renderReport() {
    const pick = pendingReport(), box = $('cardReport');
    const key = pick ? pick.entry.key + '|' + pick.entry.state + '|' + (pick.note?.id || '') + '|' + pick.others : '';
    root.classList.toggle('has-report', !!pick);
    if (!pick) { box.hidden = true; box.replaceChildren(); reportShown = null; return; }
    if (reportShown?.key === key) return;
    const report = AgentReport.brief(pick.note, pick.entry);
    box.className = 'card-report verdict-' + report.verdict;
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
    if (kind === 'dismiss') { action(markRead()); return; }
    if (kind === 'inbox') { inWorkspace(() => $('inboxButton').click()); return; }
    if (kind === 'read') { inWorkspace(() => openNotice(note.id)); return; }
    if (entry.demo) { toast('In a real session, this brings forward the app Claude Code runs in.'); action(markRead()); return; }
    const opening = entry.notice ? native('openCodex', {thread: entry.notice.thread}) : native('openAgentApp', {app: entry.app || ''});
    action(opening.then(() => { if (note) return markRead(); }));
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
  function report() {
    if (!compact) return;
    const height = Math.ceil(inner.getBoundingClientRect().height);
    if (!height || height === reported) return;
    reported = height;
    native('cardSize', {height}).catch(() => {});
  }
  new ResizeObserver(() => requestAnimationFrame(report)).observe(inner);

  function inWorkspace(next) {
    if (!compact) { next(); return; }
    action(native('compact', {value: false}).then(() => { window.setWorkspaceReturn(true); next(); }));
  }

  root.addEventListener('click', event => {
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
    if (event.target.closest('#cardPin')) action(native('pin', {value: !pinnedNow}).then(value => { pinnedNow = value; render(); }));
  });

  // Drag the card by any empty part of it. The app moves the window and snaps it to a corner.
  root.addEventListener('mousedown', event => {
    if (event.button !== 0 || event.target.closest('button, input, a, .row, .island, [popover], .card-report, .card-welcome')) return;
    native('cardDrag').catch(() => {});
  });

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
  root.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    const taskRow = event.target.closest('.row[data-id]');
    const task = taskRow && data.tasks.find(item => item.id === taskRow.dataset.id);
    const plan = date => () => action(patchTask(task.id, item => { item.planned = date; }));
    const card = [
      {label: 'Keep Above Other Windows', checked: pinnedNow, run: () => action(native('pin', {value: !pinnedNow}).then(value => { pinnedNow = value; render(); }))},
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
  }, true);

  $('cardAdd').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('cardAddInput'), found = parseQuick(input.value);
    if (!found.title) return;
    const fields = {planned: day()};
    for (const key of ['planned', 'dueDate', 'dueTime', 'priority', 'tag', 'project', 'repeat']) if (found[key]) fields[key] = found[key];
    input.value = '';
    action(change(state => { state.tasks.push(newTask({...fields, title: found.title})); }).then(() => {
      if (fields.planned !== day()) toast('Added for ' + dayLabel(fields.planned));
    }));
  });
  $('cardAddInput').addEventListener('keydown', event => { if (event.key === 'Escape') { event.target.value = ''; event.target.blur(); } });

  window.setPinned = value => { pinnedNow = !!value; render(); };
  // Agents and results change often. Refresh only the parts they affect, not the task list.
  const refresh = () => { if (compact) { renderReport(); renderWelcome(); } };
  return {render, report, inWorkspace, refresh};
})();
