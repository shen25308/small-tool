'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const {addDays, fromISO} = TaskLogic;
const day = (d = new Date()) => TaskLogic.iso(d);
const uuid = () => crypto.randomUUID();
const stampNow = () => { const now = new Date(); return day(now) + 'T' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'); };
const shortDate = new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric'});
const longDate = new Intl.DateTimeFormat('en-US', {weekday: 'short', month: 'short', day: 'numeric'});
const yearDate = new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
function dayLabel(date, long = false) {
  const today = day();
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  const parsed = fromISO(date);
  if (Number.isNaN(parsed.getTime())) return date;
  if (date.slice(0, 4) !== today.slice(0, 4)) return yearDate.format(parsed);
  return (long ? longDate : shortDate).format(parsed);
}
const plannedDateLabel = dayLabel;
const example = 'Maya: Please send the new homepage prototype to the design team before tomorrow afternoon’s review.\nAlex: Got it, thanks!\nMaya: Also, summarize the customer feedback for the product team by Friday.';
let data = {version: 1, projects: ['My Work'], tasks: []}, view = 'today', tag = '', compact = false, dragId = '', lastDay = day(), locked = false;
// The inline "New Task" field that is open: 'view', 'p:<list>' or 'd:<date>'.
let quickTarget = null;
const titles = {today: 'Today', upcoming: 'Upcoming', all: 'All', done: 'Completed'};
const projectOfView = () => view.startsWith('p:') ? view.slice(2) : null;
// Project names are storage keys. Display the original built-in list in English
// without changing task references, even when the user also has a list named My Work.
function projectLabel(name) {
  if (name !== '我的工作' || data.projects[0] !== name) return name;
  return data.projects.includes('My Work') ? 'My Work (original)' : 'My Work';
}
const currentTitle = () => projectOfView() ? projectLabel(projectOfView()) : titles[view];
// A task can be planned for one day or for several (F11). plannedDates holds the list when there is more than
// one; planned always holds the next of them (or the last, once all have passed) so older data keeps working.
const plannedDays = t => t.plannedDates?.length ? t.plannedDates : t.planned ? [t.planned] : [];
const nextPlanned = (t, today = day()) => { const days = plannedDays(t); return days.find(d => d >= today) || days.at(-1) || ''; };
function planOn(task, dates) {
  const days = [...new Set((Array.isArray(dates) ? dates : [dates]).filter(Boolean))].sort();
  if (days.length > 1) task.plannedDates = days; else delete task.plannedDates;
  task.planned = days.length > 1 ? nextPlanned(task) : days[0] || '';
}
// Planned for today, or overdue and still open. A task with a later planned day is not overdue.
// An overdue task finished today still counts toward today.
const isToday = t => {
  const today = day(), days = plannedDays(t);
  if (days.includes(today)) return true;
  if (!days.length || days.some(d => d > today)) return false;
  return !t.done || (t.completedAt || '').slice(0, 10) === today;
};
const taskDate = t => nextPlanned(t) || t.dueDate || '';
function isOverdue(t) {
  if (t.done || !t.dueDate) return false;
  const now = stampNow();
  return t.dueDate < now.slice(0, 10) || (t.dueDate === now.slice(0, 10) && !!t.dueTime && t.dueTime <= now.slice(11));
}
const pending = new Map();
function native(op, payload = {}) {
  const id = uuid();
  return new Promise((resolve, reject) => {
    pending.set(id, {resolve, reject});
    try { window.webkit.messageHandlers.host.postMessage({id, op, ...payload}); }
    catch (e) { pending.delete(id); reject(e); }
  });
}
window.hostReply = (id, ok, value) => { const p = pending.get(id); if (!p) return; pending.delete(id); ok ? p.resolve(value) : p.reject(Error(String(value))); };
let toastTimer;
function toast(msg, undo, label = 'Undo') {
  // Everything outside an open sheet is inert, so the message (and its Undo) goes inside the sheet.
  const host = $('dialog').open ? $('dialog') : document.body;
  if ($('toast').parentElement !== host) host.append($('toast'));
  $('toast').textContent = msg;
  if (undo) {
    const button = document.createElement('button');
    button.className = 'undo'; button.textContent = label;
    button.onclick = () => { $('toast').classList.remove('toast-show'); undo(); };
    $('toast').append(button);
  }
  $('toast').classList.add('toast-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('toast-show'), undo ? 9000 : 3000);
}
let writeQueue = Promise.resolve();
function change(fn) {
  const write = async () => {
    if (locked) throw Error('Shishi could not read the workspace file. Saving is paused.');
    const next = structuredClone(data);
    fn(next);
    await native('save', {state: next});
    data = next;
    render();
  };
  const result = writeQueue.then(write);
  writeQueue = result.catch(() => {});
  return result;
}
function action(p) { p.catch(e => toast(e.message)); }
function go(v) { view = v; tag = ''; quickTarget = null; render(); document.querySelector('main .content').scrollTop = 0; }
const projectTone = name => 'project-' + Math.max(0, data.projects.indexOf(name)) % 8;
function symbol(name) { return '<span class="symbol ' + name + '" aria-hidden="true"></span>'; }
const collapsedProjects = new Set();
const suggestedTags = {'Leadership': 0, 'Urgent': 1, 'This week': 2, 'Product insights': 3, 'Feedback': 4, 'Later': 5, 'Today': 6, 'Long-term': 4, 'Leader follow-up': 1};

function availableTaskTags() {
  return [...new Set([...data.tasks.map(item => item.tag).filter(Boolean), ...(data.labels || []), ...Object.keys(suggestedTags)])]
    .filter(name => !(data.hiddenTags || []).includes(name) || data.tasks.some(item => item.tag === name));
}

function taskTagColor(name) {
  if (Object.hasOwn(suggestedTags, name)) return 'tag-tone-' + suggestedTags[name];
  let value = 0;
  for (const char of name) value = (value * 31 + char.codePointAt(0)) >>> 0;
  return 'tag-tone-' + value % 7;
}

function deadlineLabel(task) {
  if (!task.dueDate) return 'Set deadline';
  const date = dayLabel(task.dueDate);
  if (!task.dueTime) return date;
  const time = new Date(task.dueDate + 'T' + task.dueTime);
  return Number.isNaN(time.getTime()) ? date : date + ', ' + time.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
}

function smartTile(id, label, count, icon) {
  return '<button class="smart-tile tile-' + id + (view === id && !tag ? ' active" aria-current="page' : '') + '" data-view="' + id + '"' +
    (id === 'today' ? ' data-target="today"' : '') + '><span class="tile-icon">' + icon + '</span><span class="tile-count" data-count-key="tile-' + id + '">' + count +
    '</span><span class="tile-label">' + label + '</span></button>';
}
function navButton(id, label, count) {
  const name = id.slice(2);
  return '<button data-view="' + esc(id) + '" data-target="' + esc(id) + '" data-project="' + esc(name) + '"' +
    (view === id ? ' class="active" aria-current="page"' : '') + '><span class="list-badge ' + projectTone(name) + '">' + symbol('i-list') + '</span>' +
    '<span class="prname">' + esc(projectLabel(label)) + '</span><span class="num">' + (count || '') + '</span></button>';
}

function rowMeta(t, options) {
  const parts = [];
  if (options.project) parts.push('<span>' + esc(projectLabel(t.project)) + '</span>');
  if (t.subtasks?.length) parts.push('<span>' + symbol('i-checklist') + t.subtasks.filter(s => s.done).length + '/' + t.subtasks.length + '</span>');
  if (t.repeat && TaskLogic.repeatLabels[t.repeat]) parts.push('<span>' + symbol('i-repeat') + esc(TaskLogic.repeatLabels[t.repeat]) + '</span>');
  if (t.notion?.id && !t.notion.gone) parts.push('<span title="Synced with Notion">' + symbol('i-link') + 'Notion</span>');
  if (t.notes) parts.push('<span class="meta-note">' + esc(t.notes.split('\n')[0].slice(0, 120)) + '</span>');
  return parts.length ? '<span class="row-meta">' + parts.join('') + '</span>' : '';
}

function row(t, options = {}) {
  const title = esc(t.title);
  const addToday = !t.done && !isToday(t) && view !== 'done';
  const priority = ['P0', 'P1', 'P2'].includes(t.priority) ? t.priority.toLowerCase() : 'p2';
  const next = nextPlanned(t), many = plannedDays(t).length > 1;
  const planned = next && !t.done && (next !== day() || many) && !options.hideDate
    ? '<time class="planned-day' + (next < day() ? ' late' : '') + '" datetime="' + esc(next) + '" title="Planned: ' + esc(DayPicker.summary(plannedDays(t))) + '">' +
      esc(many ? DayPicker.summary(plannedDays(t)) : dayLabel(next)) + '</time>' : '';
  return '<article class="row' + (t.done ? ' done' : '') + '" draggable="' + !t.done + '" data-id="' + esc(t.id) + '">' +
    '<button class="check" data-act="toggle" aria-pressed="' + !!t.done + '" aria-label="' + (t.done ? 'Reopen ' : 'Complete ') + title + '"></button>' +
    '<button class="priority ' + priority + '" data-act="priority" aria-haspopup="dialog" aria-label="Priority ' + esc(t.priority || 'P2') + ' for ' + title + '">' + esc(t.priority || 'P2') + '</button>' +
    '<button class="task-body" data-act="edit" title="' + title + '"><span class="title">' + title + '</span>' + rowMeta(t, options) + '</button>' +
    '<span class="row-trail">' +
    '<button class="task-tag ' + (t.tag ? taskTagColor(t.tag) : 'no-tag') + '" data-act="tag" aria-haspopup="dialog" aria-label="Tag for ' + title + '" title="' + esc(t.tag || 'Add tag') + '">' + esc(t.tag || '+ Tag') + '</button>' +
    planned +
    '<button class="task-deadline' + (t.dueDate ? ' has-deadline' : ' no-deadline') + (isOverdue(t) ? ' overdue' : '') + '" data-act="deadline" aria-haspopup="dialog" aria-label="Deadline for ' + title + '" title="' + esc(t.dueDate ? 'Due ' + deadlineLabel(t) : 'Set deadline') + '">' +
    symbol('i-clock') + (t.dueDate ? esc(deadlineLabel(t)) : '') + '</button>' +
    (addToday ? '<button class="rowAction" data-act="today" title="Add to Today" aria-label="Add ' + title + ' to Today">Today</button>' : '') +
    // Visible on hover and on keyboard focus, so nothing needs a right-click (F17).
    '<span class="row-actions">' +
    (t.done ? '' : '<button class="row-icon" data-act="schedule" aria-haspopup="dialog" title="Plan days" aria-label="Plan days for ' + title + '">' + symbol('i-calendar') + '</button>') +
    '<button class="row-icon" data-act="edit" title="Details" aria-label="Details for ' + title + '">' + symbol('i-note') + '</button>' +
    '<button class="row-icon" data-act="more" aria-haspopup="menu" title="More" aria-label="More actions for ' + title + '">' + symbol('i-ellipsis') + '</button>' +
    '</span></span></article>';
}

function quickAdd(key) {
  if (quickTarget !== key) {
    return '<button type="button" class="inline-add" data-quick="' + esc(key) + '">' + symbol('plus') + 'New Task</button>';
  }
  return '<form class="quick-add" data-quick-form="' + esc(key) + '"><span class="check" aria-hidden="true"></span>' +
    '<input aria-label="New task" maxlength="240" autocomplete="off" placeholder="New task — try “Call Sam tomorrow 3pm #Design !p1” or “明天下午3点”" title="Dates and times can be typed in English or Chinese. Type \\# to keep a # as text.">' +
    '<div class="quick-hint" aria-live="polite"></div></form>';
}

function projectGroup(project, tasks, index) {
  const isOpen = !collapsedProjects.has(project);
  const groupId = 'project-group-' + index;
  return '<section class="task-group ' + projectTone(project) + '" data-target="' + esc('p:' + project) + '">' +
    '<button type="button" class="group-toggle" data-group="' + esc(project) + '" aria-expanded="' + isOpen + '" aria-controls="' + groupId + '">' +
    '<span class="group-name">' + esc(projectLabel(project)) + '</span><span class="group-count">' + tasks.length + '</span>' +
    '<span class="symbol disclosure" aria-hidden="true"></span></button>' +
    '<div id="' + groupId + '"' + (isOpen ? '' : ' hidden') + '>' +
    sortVisibleTasks(tasks).map(t => row(t)).join('') + quickAdd('p:' + project) + '</div></section>';
}

function dayGroup(title, tasks, options = {}) {
  const head = '<div class="day-head' + (options.overdue ? ' is-overdue' : '') + '"><h3>' + esc(title) + '</h3>' + (tasks.length ? '<span>' + tasks.length + '</span>' : '') + '</div>';
  const rows = tasks.map(t => row(t, {project: true, hideDate: !!options.date})).join('');
  return '<section class="day-group"' + (options.date ? ' data-target="d:' + options.date + '"' : '') + '>' + head + rows +
    (options.date ? quickAdd('d:' + options.date) : '') + '</section>';
}

function emptyState(icon, text) {
  return '<div class="empty task-empty">' + symbol(icon) + '<span>' + esc(text) + '</span></div>';
}

function placeTaskPicker(picker, anchor) {
  document.querySelector('.task-picker')?.remove();
  picker.setAttribute('popover', 'auto');
  picker.setAttribute('role', 'dialog');
  picker.addEventListener('toggle', event => {
    if (event.newState !== 'closed') return;
    picker.remove();
    if (anchor.isConnected && document.activeElement === document.body) anchor.focus();
  });
  // Inside an open sheet, the picker must belong to the sheet or it cannot be clicked.
  ($('dialog').open ? $('dialog') : document.body).append(picker);
  picker.showPopover();
  const pos = anchor.getBoundingClientRect();
  const rect = picker.getBoundingClientRect();
  picker.style.left = Math.max(6, Math.min(pos.left, innerWidth - rect.width - 6)) + 'px';
  picker.style.top = Math.max(6, Math.min(pos.bottom + 4, innerHeight - rect.height - 6)) + 'px';
}

function editDeadline(anchor, task) {
  const picker = document.createElement('div');
  picker.className = 'task-picker deadline-picker';
  picker.setAttribute('aria-label', 'Deadline');
  const today = day();
  picker.innerHTML = '<form><h3>Deadline</h3><div class="quick-dates">' +
    [['Today', today], ['Tomorrow', addDays(today, 1)], ['Next week', TaskLogic.nextWeekday(today, 1)]].map(([label, value]) =>
      '<button type="button" data-date="' + value + '">' + label + '</button>').join('') + '</div>' +
    '<label>Due date<input type="date" name="date" required></label>' +
    '<label>Time (optional)<input type="time" name="time"></label><div class="deadline-actions">' +
    (task.dueDate ? '<button type="button" class="mini-link danger-link" data-clear-deadline>Clear</button>' : '') +
    '<button type="button" class="secondary" data-cancel-deadline>Cancel</button><button class="primary" type="submit">Save</button></div></form>';
  const form = picker.querySelector('form');
  form.elements.date.value = task.dueDate || today;
  form.elements.time.value = task.dueTime || '';
  function save(date, time) {
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    action(change(state => {
      const current = state.tasks.find(item => item.id === task.id);
      if (!current) return;
      if (date) {
        current.dueDate = date;
        if (time) current.dueTime = time;
        else delete current.dueTime;
      } else {
        delete current.dueDate;
        delete current.dueTime;
      }
    }).then(() => {
      picker.hidePopover();
      document.querySelector('.row[data-id="' + CSS.escape(task.id) + '"] [data-act="deadline"]')?.focus();
    }).finally(() => buttons.forEach(button => { button.disabled = false; })));
  }
  form.onsubmit = event => { event.preventDefault(); save(form.elements.date.value, form.elements.time.value); };
  picker.querySelectorAll('[data-date]').forEach(button => { button.onclick = () => save(button.dataset.date, form.elements.time.value); });
  picker.querySelector('[data-cancel-deadline]').onclick = () => picker.hidePopover();
  const clear = picker.querySelector('[data-clear-deadline]');
  if (clear) clear.onclick = () => save('', '');
  placeTaskPicker(picker, anchor);
  form.elements.date.focus();
}

// Plan days from the row: quick choices, or a calendar for several days or a range (F11, F17).
function editPlanned(anchor, task) {
  const picker = document.createElement('div');
  picker.className = 'task-picker plan-picker';
  picker.setAttribute('aria-label', 'Plan days');
  const today = day();
  picker.innerHTML = '<h3>Plan days</h3><div class="quick-dates">' +
    [['Today', today], ['Tomorrow', addDays(today, 1)], ['Next week', TaskLogic.nextWeekday(today, 1)], ['Not planned', '']].map(([label, value]) =>
      '<button type="button" data-plan="' + value + '">' + label + '</button>').join('') + '</div>';
  const save = dates => action(patchTask(task.id, item => planOn(item, dates)));
  const calendar = DayPicker.create({dates: plannedDays(task), today, onChange: save});
  picker.append(calendar.node);
  const done = document.createElement('div');
  done.className = 'deadline-actions';
  done.innerHTML = '<button type="button" class="primary" data-plan-done>Done</button>';
  picker.append(done);
  picker.addEventListener('click', event => {
    const quick = event.target.closest('[data-plan]');
    if (quick) { save(quick.dataset.plan ? [quick.dataset.plan] : []); picker.hidePopover(); }
    if (event.target.closest('[data-plan-done]')) picker.hidePopover();
  });
  placeTaskPicker(picker, anchor);
  picker.querySelector('[data-plan]').focus();
}

function showTaskPicker(anchor, task, field) {
  const isTag = field === 'tag', isProject = field === 'project';
  const picker = document.createElement('div');
  picker.className = 'task-picker';
  picker.setAttribute('aria-label', isTag ? 'Choose a tag' : isProject ? 'Move to list' : 'Choose a priority');
  const choices = isTag ? availableTaskTags() : isProject ? data.projects : ['P0', 'P1', 'P2'];
  picker.innerHTML = (isTag ? '<form><input aria-label="Find or create a tag" placeholder="Find or create a tag…" maxlength="30" autocomplete="off"></form>' : '') +
    '<div class="picker-options"></div>';
  const choicesBox = picker.querySelector('.picker-options');
  const input = picker.querySelector('input');
  function showChoices() {
    const search = input?.value.trim() ?? '';
    const filtered = choices.filter(value => value.toLowerCase().includes(search.toLowerCase()));
    const current = task[field];
    choicesBox.innerHTML = filtered.map(value => '<button type="button" data-choice="' + esc(value) + '" aria-pressed="' + (current === value) + '">' +
      (isProject ? '<span class="list-badge ' + projectTone(value) + '">' + symbol('i-list') + '</span><span>' + esc(projectLabel(value)) + '</span>'
        : '<span class="' + (isTag ? 'task-tag ' + taskTagColor(value) : 'priority ' + value.toLowerCase()) + '">' + esc(value) + '</span>') +
      (value === current ? '<span class="chosen" aria-hidden="true">✓</span>' : '') + '</button>').join('') +
      (search && !choices.some(value => value.toLowerCase() === search.toLowerCase()) ? '<button type="button" data-choice="' + esc(search) + '">Create “' + esc(search) + '”</button>' : '') +
      (isTag && current ? '<button type="button" class="clear-tag" data-choice="">Remove tag</button>' : '');
  }
  let picked = false;
  function select(value) {
    if (picked) return;
    picked = true;
    const save = change(state => {
      const current = state.tasks.find(item => item.id === task.id);
      if (current) current[field] = value;
    });
    action(save.then(() => {
      picker.hidePopover();
      document.querySelector('.row[data-id="' + CSS.escape(task.id) + '"] [data-act="' + (isProject ? 'edit' : field) + '"]')?.focus();
    }).catch(error => { picked = false; throw error; }));
  }
  if (input) {
    input.oninput = showChoices;
    picker.querySelector('form').onsubmit = event => {
      event.preventDefault();
      if (input.value.trim()) select(input.value.trim());
    };
  }
  picker.onclick = event => {
    const button = event.target.closest('[data-choice]');
    if (button) select(button.dataset.choice);
  };
  picker.onkeydown = event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...choicesBox.querySelectorAll('button')];
    if (!buttons.length) return;
    event.preventDefault();
    const i = buttons.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? i + 1 : (i < 0 ? buttons.length - 1 : i - 1);
    buttons[(next + buttons.length) % buttons.length].focus();
  };
  showChoices();
  placeTaskPicker(picker, anchor);
  (input ?? choicesBox.querySelector('button[aria-pressed=true],button'))?.focus();
}

function upcomingMarkup(tasks) {
  const today = day(), week = addDays(today, 7);
  const open = tasks.filter(t => !t.done && taskDate(t));
  const days = t => plannedDays(t).length ? plannedDays(t) : t.dueDate ? [t.dueDate] : [];
  const overdue = open.filter(t => taskDate(t) < today || (!t.planned && isOverdue(t) && taskDate(t) === today));
  let html = overdue.length ? dayGroup('Overdue', overdue, {overdue: true}) : '';
  for (let offset = 1; offset <= 7; offset++) {
    const date = addDays(today, offset);
    // A task planned for several days appears on each of them.
    html += dayGroup(offset === 1 ? 'Tomorrow' : longDate.format(fromISO(date)), open.filter(t => days(t).includes(date)), {date});
  }
  const later = open.filter(t => taskDate(t) > week && !days(t).some(d => d > today && d <= week)).sort((a, b) => taskDate(a).localeCompare(taskDate(b)));
  if (later.length) html += dayGroup('Later', later);
  return html;
}

function completedMarkup(tasks) {
  const done = tasks.filter(t => t.done).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  if (!done.length) return emptyState('i-check-circle', 'Completed tasks appear here.');
  const groups = new Map();
  for (const task of done) {
    const key = task.completedAt ? task.completedAt.slice(0, 10) : '';
    groups.set(key, [...(groups.get(key) || []), task]);
  }
  return '<div class="listhead"><button type="button" class="mini-link" data-clear-done>Clear Completed…</button></div>' +
    [...groups].map(([key, list]) => dayGroup(key ? dayLabel(key, true) : 'Earlier', list)).join('');
}

// Morning, afternoon, evening or night, for the color of the light behind the title.
function daypart(hour = new Date().getHours()) {
  return hour < 5 ? 'night' : hour < 11 ? 'morning' : hour < 17 ? 'day' : hour < 21 ? 'evening' : 'night';
}
const motionKey = () => compact ? 'card' : view + '|' + tag;

function render() {
  const motion = window.Motion?.capture(motionKey());
  renderBoard();
  if (compact) window.Card?.render();
  window.Motion?.play(motion, motionKey());
  window.renderAgents?.();
}

function renderBoard() {
  const draftField = document.querySelector('.quick-add input');
  const draft = draftField ? {value: draftField.value, focused: document.activeElement === draftField} : null;
  const tasks = data.tasks, open = tasks.filter(t => !t.done), today = tasks.filter(isToday), project = projectOfView();
  const now = new Date();
  $('nav').innerHTML = smartTile('today', 'Today', today.filter(t => !t.done).length, String(now.getDate())) +
    smartTile('upcoming', 'Upcoming', open.filter(t => taskDate(t) > day()).length, symbol('i-calendar')) +
    smartTile('all', 'All', open.length, symbol('i-tray')) +
    smartTile('done', 'Completed', tasks.length - open.length, symbol('i-check'));
  $('projects').innerHTML = data.projects.map(p => navButton('p:' + p, p, open.filter(t => t.project === p).length)).join('');
  $('board').className = 'board-content ' + (project ? 'view-project ' + projectTone(project) : 'view-' + view);
  $('aurora').className = 'aurora ' + (project ? 'aura-project ' + projectTone(project) : view === 'today' ? 'aura-' + daypart() : 'aura-' + view);
  const planned = tasks.filter(isToday), finished = planned.filter(t => t.done).length;
  const ring = $('dayRing');
  ring.hidden = view !== 'today' || !planned.length;
  ring.style.setProperty('--progress', planned.length ? (finished / planned.length).toFixed(3) : '0');
  ring.classList.toggle('complete', planned.length > 0 && finished === planned.length);
  ring.classList.toggle('zero', finished === 0);
  ring.setAttribute('aria-label', finished + ' of ' + planned.length + ' done today');
  ring.title = finished + ' of ' + planned.length + ' done today';
  $('dateline').textContent = view === 'today' ? new Intl.DateTimeFormat('en-US', {month: 'long', day: 'numeric', weekday: 'long'}).format(now) : '';
  $('dateline').hidden = view !== 'today';
  $('pageTitle').textContent = tag || currentTitle();
  $('wrapUp').hidden = view !== 'today';
  renderBoardTags();
  const pin = $('pin');
  pin.innerHTML = symbol(compact ? 'expand' : 'pin') + '<span class="tool-label">' + (compact ? 'Open Full Workspace' : 'Floating Today List') + '</span>';
  pin.setAttribute('aria-label', compact ? 'Open full workspace' : 'Switch to the floating Today list');
  $('manual').hidden = view === 'done';

  const flat = view === 'today' || view === 'all' || !!project;
  document.querySelector('.board-content > .listhead').hidden = !flat;
  let list = view === 'today' ? today : project ? tasks.filter(t => t.project === project) : open;
  const tags = [...new Set(list.map(t => t.tag).filter(Boolean))];
  const filterable = view === 'all' || !!project;
  if (!filterable || !(view === 'all' ? availableTaskTags() : tags).includes(tag)) tag = '';
  const filters = filterable && tags.length > 1 && !tag ? '<div class="tags task-filters"><button data-tag="" class="active">All</button>' +
    tags.map(value => '<button data-tag="' + esc(value) + '">' + esc(value) + '</button>').join('') + '</div>' : '';
  if (tag) list = list.filter(t => t.tag === tag);
  // Finished tasks sink below open ones so the list reads as what is left to do.
  list = [...sortVisibleTasks(list.filter(t => !t.done)), ...list.filter(t => t.done)];
  const count = view === 'done' ? tasks.length - open.length : view === 'upcoming' ? open.filter(t => taskDate(t) > day()).length : list.filter(t => !t.done).length;
  $('pageCount').textContent = count || '';

  if (view === 'upcoming') $('tasks').innerHTML = upcomingMarkup(tasks);
  else if (view === 'done') $('tasks').innerHTML = completedMarkup(tasks);
  else {
    const empty = tag ? emptyState('i-tag', 'No open tasks with this tag.') : view === 'today' ? emptyState('i-sun', 'Nothing planned for today. Add a task or drag one here.')
      : emptyState('i-check-circle', 'No tasks here yet.');
    const listAttrs = view === 'today' ? 'class="task-list drop" data-target="today"' : 'class="task-list"';
    $('tasks').innerHTML = filters + '<div ' + listAttrs + '>' +
      (list.map(t => row(t, {project: !project})).join('') || empty) + quickAdd('view') + '</div>';
  }

  let groups = '';
  if (view === 'today') {
    const waiting = open.filter(t => !isToday(t));
    groups = data.projects.map((name, index) => projectGroup(name, waiting.filter(t => t.project === name), index)).join('') +
      '<button type="button" class="inline-add new-group" data-new-group>' + symbol('plus') + 'New List</button>';
  }
  $('pool').innerHTML = groups;

  const field = document.querySelector('.quick-add input');
  if (field) {
    if (draft) { field.value = draft.value; showQuickHint(field); }
    if ((!draft || draft.focused) && !$('dialog').open && !$('palette').open) field.focus();
  }
}

let dialogBack = closeDialog;
// Set by a sheet that autosaves. Closing goes through it so nothing typed is lost.
let dialogGuard = null;
function dialog(title, body, navigation = {}) {
  const modal = $('dialog');
  if (dialogGuard) { dialogGuard.flush(); dialogGuard = null; }
  // Everything outside an open sheet is inert, so a sheet opened from the card offers the way back itself.
  const fromCard = !$('workspaceReturn').hidden;
  const backLabel = navigation.label || (fromCard ? 'Card' : '');
  dialogBack = navigation.back || (fromCard ? returnToCard : closeDialog);
  $('dialogBody').innerHTML = '<div class="dialog-head">' +
    (backLabel ? '<button type="button" class="dialog-back" aria-label="' + esc(backLabel) + '">' + symbol('back') + esc(backLabel) + '</button>' : '<span></span>') +
    '<h2 id="dialogTitle">' + esc(title) + '</h2><button type="button" class="close" data-close title="Close" aria-label="Close">' + symbol('close-icon') + '</button></div>' + body;
  const back = $('dialogBody').querySelector('.dialog-back');
  if (back) back.onclick = () => dialogBack();
  modal.scrollTop = 0;
  if (!modal.open) modal.showModal();
}
function returnToCard() {
  return Promise.resolve(closeDialog()).then(() => { if (!$('dialog').open) action(native('compact', {value: true})); });
}
function closeDialog(force = false) {
  if (!force && dialogGuard) return dialogGuard.close();
  dialogGuard = null;
  if ($('dialog').open) $('dialog').close();
}
$('dialog').addEventListener('cancel', event => { event.preventDefault(); dialogBack(); });
const options = (list, sel, label = String) => list.map(v => '<option value="' + esc(v) + '" ' + (v === sel ? 'selected' : '') + '>' + esc(label(v)) + '</option>').join('');

function newTask(fields = {}) {
  return {id: uuid(), title: '', project: projectOfView() ?? data.projects[0], tag: '', priority: 'P2', planned: '', done: false, source: '', quote: '', ...fields};
}

function removeTask(task) {
  return change(s => { s.tasks = s.tasks.filter(x => x.id !== task.id); }).then(() => {
    toast('Task deleted', () => action(change(s => { if (!s.tasks.some(x => x.id === task.id)) s.tasks.push(task); })));
  });
}

// Details autosave: each edit is saved shortly after typing stops, with the state shown in the sheet.
// Nothing is saved while the form is invalid; closing then asks how to resolve it.
function taskForm(t, context = {}) {
  const stored = t && data.tasks.find(x => x.id === t.id);
  let created = !!stored;
  const original = stored ? structuredClone(stored) : null;
  t = stored ? structuredClone(stored) : t ? structuredClone(t) : newTask({project: context.project ?? projectOfView() ?? data.projects[0], planned: context.project ? '' : view === 'today' ? day() : ''});
  let subtasks = structuredClone(t.subtasks || []);
  const repeats = ['', ...Object.keys(TaskLogic.repeatLabels)];
  dialog(created ? 'Details' : 'New Task', '<form id="taskForm" novalidate>' +
    '<label class="field-title"><span class="reader-only">Task</span><input id="fieldTitle" maxlength="240" placeholder="Title" value="' + esc(t.title) + '"></label>' +
    '<label><span class="reader-only">Notes</span><textarea id="fieldNotes" rows="2" maxlength="4000" placeholder="Notes">' + esc(t.notes || '') + '</textarea></label>' +
    '<div class="formgrid three"><label>List<select id="fieldProject">' + options(data.projects, t.project, projectLabel) + '</select></label>' +
    '<label>Priority<select id="fieldPriority">' + options(['P0', 'P1', 'P2'], t.priority) + '</select></label>' +
    '<label>Tag<input id="fieldTag" maxlength="30" list="tagChoices" value="' + esc(t.tag) + '" placeholder="None"></label></div>' +
    '<datalist id="tagChoices">' + availableTaskTags().map(name => '<option value="' + esc(name) + '">').join('') + '</datalist>' +
    '<div class="formgrid three"><div class="planned-field"><span>Planned</span><button type="button" id="plannedToggle" class="secondary planned-toggle" aria-expanded="false" aria-controls="plannedPicker">' +
      esc(DayPicker.summary(plannedDays(t))) + '</button></div>' +
    '<label>Deadline<input id="fieldDue" type="date" value="' + esc(t.dueDate || '') + '"></label>' +
    '<label>Time<input id="fieldDueTime" type="time" value="' + esc(t.dueTime || '') + '"></label></div>' +
    '<div id="plannedPicker" class="planned-picker" hidden></div>' +
    '<label>Repeat<select id="fieldRepeat">' + options(repeats, t.repeat || '', value => value ? TaskLogic.repeatLabels[value] : 'Never') + '</select></label>' +
    '<label>Subtasks</label><div class="subtask-list" id="subtaskList"></div>' +
    (t.source ? '<details><summary class="mini-link">Show source message</summary><blockquote>' + esc(t.source) + '</blockquote></details>' : '') +
    (t.notion?.id && !t.notion.gone ? '<div class="notion-line">' + symbol('i-link') + 'Synced with Notion<button type="button" class="mini-link" id="openNotionPage">Open page</button></div>' : '') +
    '<div class="close-prompt" id="closePrompt" role="alertdialog" aria-labelledby="closePromptText" hidden></div>' +
    '<div class="actions"><button type="button" class="mini-link danger-link" id="removeTask">' + (created ? 'Delete Task' : 'Discard') + '</button>' +
    '<span class="save-state" id="saveState" role="status" aria-live="polite"></span><span class="spacer"></span>' +
    '<button type="button" class="secondary" id="revertTask" hidden>Revert Changes</button><button class="primary">Done</button></div></form>');
  const state = (text, kind = '') => { const node = $('saveState'); if (node) { node.textContent = text; node.dataset.kind = kind; } };
  function drawSubtasks(focusLast) {
    const box = $('subtaskList');
    box.innerHTML = subtasks.map((item, index) => '<div class="subtask-row"><input type="checkbox" data-sub-done="' + index + '"' + (item.done ? ' checked' : '') + ' aria-label="Done">' +
      '<input type="text" data-sub-title="' + index + '" maxlength="200" value="' + esc(item.title) + '" aria-label="Subtask">' +
      '<button type="button" data-sub-remove="' + index + '" aria-label="Remove subtask">' + symbol('close-icon') + '</button></div>').join('') +
      '<div class="subtask-row"><span></span><input type="text" id="subtaskNew" maxlength="200" placeholder="Add a subtask" aria-label="Add a subtask"><span></span></div>';
    if (focusLast) $('subtaskNew').focus();
  }
  function addSubtask() {
    const title = $('subtaskNew').value.trim();
    if (!title) return false;
    subtasks.push({id: uuid(), title, done: false});
    drawSubtasks(true);
    return true;
  }
  // What the form says, and why it cannot be saved yet if it cannot.
  function collect() {
    const title = $('fieldTitle').value.trim();
    const date = $('fieldDue').value, time = $('fieldDueTime').value;
    const current = data.tasks.find(x => x.id === t.id) || t;
    const updated = {...current, title, project: $('fieldProject').value, tag: $('fieldTag').value.trim(), priority: $('fieldPriority').value};
    planOn(updated, plannedDates);
    const set = (key, value) => { if (value && (!Array.isArray(value) || value.length)) updated[key] = value; else delete updated[key]; };
    set('notes', $('fieldNotes').value.trim());
    set('dueDate', date);
    set('dueTime', date ? time : '');
    set('repeat', $('fieldRepeat').value);
    set('subtasks', subtasks.map(item => ({...item, title: item.title.trim()})).filter(item => item.title));
    let problem = '';
    if (time && !date) problem = 'time';
    else if (!title && created) problem = 'title';
    $('fieldDueTime').setAttribute('aria-invalid', String(problem === 'time'));
    $('fieldTitle').setAttribute('aria-invalid', String(problem === 'title'));
    return {updated, problem, empty: !title && !created};
  }
  let timer = 0, queue = Promise.resolve();
  function changed() {
    clearTimeout(timer);
    $('closePrompt').hidden = true;
    const {problem} = collect();
    if (problem) { state(problem === 'time' ? 'Not saved: the time needs a deadline date.' : 'Not saved: a task needs a title.', 'error'); return; }
    state('Editing…');
    timer = setTimeout(flush, 350);
  }
  function flush() {
    clearTimeout(timer);
    const {updated, problem, empty} = collect();
    if (problem || empty) return Promise.resolve(!problem);
    const before = JSON.stringify(data.tasks.find(x => x.id === updated.id) || null);
    if (before === JSON.stringify(updated)) { if (created) state('Saved'); return Promise.resolve(true); }
    state('Saving…');
    queue = queue.then(() => change(s => { const i = s.tasks.findIndex(x => x.id === updated.id); if (i < 0) s.tasks.push(updated); else s.tasks[i] = updated; }))
      .then(() => {
        created = true;
        state('Saved');
        if ($('removeTask')) $('removeTask').textContent = original ? 'Delete Task' : 'Discard';
        if ($('revertTask')) $('revertTask').hidden = !original || JSON.stringify(original) === JSON.stringify(data.tasks.find(x => x.id === updated.id));
        return true;
      }, error => { state('Not saved: ' + error.message, 'error'); return false; });
    return queue;
  }
  function prompt(message, choices) {
    const box = $('closePrompt');
    box.innerHTML = '<p id="closePromptText">' + esc(message) + '</p><div class="actions">' +
      choices.map((choice, index) => '<button type="button" class="' + (index === 0 ? 'primary' : 'secondary') + '" data-choice="' + index + '">' + esc(choice.label) + '</button>').join('') + '</div>';
    box.hidden = false;
    box.querySelector('button').focus();
    box.onclick = event => { const button = event.target.closest('[data-choice]'); if (button) choices[Number(button.dataset.choice)].run(); };
  }
  async function close() {
    const {problem} = collect();
    if (problem === 'time') {
      prompt('The time ' + $('fieldDueTime').value + ' has no deadline date, so it has not been saved.', [
        {label: 'Keep Editing', run: () => { $('closePrompt').hidden = true; $('fieldDue').focus(); }},
        {label: 'Use Today', run: () => { $('fieldDue').value = day(); changed(); close(); }},
        {label: 'Remove the Time', run: () => { $('fieldDueTime').value = ''; changed(); close(); }}]);
      return;
    }
    if (problem === 'title') {
      prompt('A task needs a title. Your other changes have not been saved.', [
        {label: 'Keep Editing', run: () => { $('closePrompt').hidden = true; $('fieldTitle').focus(); }},
        {label: 'Revert Changes', run: revert}]);
      return;
    }
    if ($('subtaskNew').value.trim()) addSubtask();
    if (await flush()) closeDialog(true);
  }
  function revert() {
    clearTimeout(timer);
    dialogGuard = null;
    action(change(s => { const i = s.tasks.findIndex(x => x.id === original.id); if (i < 0) s.tasks.push(original); else s.tasks[i] = original; })
      .then(() => { closeDialog(true); toast('Changes reverted'); }));
  }
  dialogGuard = {close, flush};
  // Planned days: one, several, or a range, chosen in a calendar that opens below the button (F11).
  let plannedDates = [...plannedDays(t)];
  const picker = DayPicker.create({dates: plannedDates, today: day(), onChange: dates => {
    plannedDates = dates;
    $('plannedToggle').textContent = DayPicker.summary(dates);
    changed();
  }});
  $('plannedPicker').append(picker.node);
  $('plannedToggle').onclick = () => {
    const open = $('plannedPicker').hidden;
    $('plannedPicker').hidden = !open;
    $('plannedToggle').setAttribute('aria-expanded', String(open));
  };
  drawSubtasks(false);
  state(created ? 'Saved' : '');
  $('taskForm').addEventListener('input', changed);
  $('taskForm').addEventListener('change', changed);
  $('subtaskList').addEventListener('input', event => {
    const target = event.target;
    if (target.dataset.subTitle != null) subtasks[Number(target.dataset.subTitle)].title = target.value;
    if (target.dataset.subDone != null) subtasks[Number(target.dataset.subDone)].done = target.checked;
  });
  $('subtaskList').addEventListener('click', event => {
    const remove = event.target.closest('[data-sub-remove]');
    if (remove) { subtasks.splice(Number(remove.dataset.subRemove), 1); drawSubtasks(false); changed(); }
  });
  $('subtaskList').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.closest('.subtask-row')) { event.preventDefault(); if (event.target.id === 'subtaskNew' && addSubtask()) changed(); }
  });
  $('fieldTitle').focus();
  if ($('openNotionPage')) $('openNotionPage').onclick = () => action(native('openNotion', {page: t.notion.id}));
  $('revertTask').onclick = revert;
  $('removeTask').onclick = () => {
    clearTimeout(timer);
    dialogGuard = null;
    closeDialog(true);
    // Deleting a saved task can be undone. Discarding a new one that was never saved needs nothing.
    if (data.tasks.some(x => x.id === t.id)) action(removeTask(original || data.tasks.find(x => x.id === t.id)));
  };
  $('taskForm').onsubmit = event => { event.preventDefault(); close(); };
}

// Repeating tasks form a series. Every occurrence keeps the rule. Completing one creates its successor once;
// reopening it removes that successor only while it is untouched, otherwise you decide (F05).
const occurrenceSignature = task => JSON.stringify(['title', 'notes', 'project', 'tag', 'priority', 'planned', 'dueDate', 'dueTime', 'subtasks', 'repeat', 'done']
  .map(key => task[key] ?? null));

function toggleTask(id) {
  let outcome = null;
  return change(s => {
    const index = s.tasks.findIndex(v => v.id === id);
    if (index < 0) return;
    const task = s.tasks[index];
    task.done = !task.done;
    const successor = task.next && s.tasks.find(item => item.id === task.next);
    if (!task.done) {
      delete task.completedAt;
      if (!successor) { delete task.next; delete task.nextSignature; return; }
      if (occurrenceSignature(successor) === task.nextSignature) {
        s.tasks = s.tasks.filter(item => item.id !== successor.id);
        delete task.next; delete task.nextSignature;
        outcome = {kind: 'removed', date: successor.planned || successor.dueDate};
      } else {
        outcome = {kind: 'kept', successor: structuredClone(successor)};
      }
      return;
    }
    task.completedAt = stampNow();
    if (!task.repeat || !TaskLogic.repeatLabels[task.repeat]) return;
    task.series = task.series || task.id;
    // Completing again after a reopen reuses the successor that already exists.
    if (successor) return;
    const today = day(), base = task.planned || task.dueDate || today;
    const nextDay = TaskLogic.nextRepeat(base, task.repeat, today);
    const next = {...structuredClone(task), id: uuid(), done: false, previous: task.id};
    delete next.completedAt; delete next.notion; delete next.next; delete next.nextSignature; delete next.plannedDates;
    if (task.planned || !task.dueDate) next.planned = nextDay;
    if (task.dueDate) next.dueDate = task.planned ? TaskLogic.nextRepeat(task.dueDate, task.repeat, today) : nextDay;
    if (next.subtasks) next.subtasks.forEach(item => { item.done = false; });
    task.next = next.id;
    task.nextSignature = occurrenceSignature(next);
    s.tasks.splice(index + 1, 0, next);
    outcome = {kind: 'created', date: next.planned || next.dueDate};
  }).then(() => {
    if (outcome?.kind === 'created') toast('Done. Next one scheduled for ' + dayLabel(outcome.date), () => action(toggleTask(id)));
    if (outcome?.kind === 'removed') toast('Reopened. The next one for ' + dayLabel(outcome.date) + ' was removed.');
    if (outcome?.kind === 'kept') {
      const successor = outcome.successor;
      const restore = () => action(change(state => {
        if (!state.tasks.some(item => item.id === successor.id)) state.tasks.push(successor);
        const original = state.tasks.find(item => item.id === id);
        if (original) original.next = successor.id;
      }));
      const remove = () => action(change(state => {
        state.tasks = state.tasks.filter(item => item.id !== successor.id);
        const original = state.tasks.find(item => item.id === id);
        if (original) { delete original.next; delete original.nextSignature; }
      }).then(() => toast('Removed the next occurrence', restore)));
      toast('Reopened. The next one was already changed, so it was kept.', remove, 'Remove It');
    }
  });
}

function projectForm() {
  dialog('New List', '<form id="projectForm"><label>Name<input id="projectName" required maxlength="32" placeholder="e.g. Client delivery"></label><div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Create</button></div></form>');
  $('projectName').focus();
  $('projectForm').onsubmit = async e => {
    e.preventDefault();
    const name = $('projectName').value.trim();
    if (!name) return;
    try { await change(s => { if (s.projects.includes(name)) throw Error('A list with this name already exists.'); s.projects.push(name); }); closeDialog(); go('p:' + name); }
    catch (err) { toast(err.message); }
  };
}

let captureToken = 0;
function capture(source = '') {
  ++captureToken;
  if (!canCapture) {
    dialog('Capture Tasks', '<p class="hint">Finding tasks in a message uses an offline model that this light download leaves out. ' +
      (capabilities.canDownloadModel ? 'You can download it once (1.1 GB). Shishi checks the file against its published checksum before using it, and it stays on this Mac.' : 'Download the full version of Shishi to use it.') + ' Or add the task yourself.</p>' +
      (source ? '<blockquote>' + esc(source) + '</blockquote>' : '') + '<p id="modelStatus" class="hint" aria-live="polite">' + esc(modelStatusText()) + '</p>' +
      '<div class="actions"><button type="button" class="secondary" data-close>Close</button>' +
      (capabilities.canDownloadModel ? '<button type="button" class="secondary" id="downloadModel">' + (capabilities.downloading ? 'Cancel Download' : 'Download Model (1.1 GB)') + '</button>' : '') +
      '<button type="button" class="primary" id="captureManual">Add a Task</button></div>');
    $('captureManual').onclick = () => manualFromText(source);
    if ($('downloadModel')) $('downloadModel').onclick = () => action(native('downloadModel', capabilities.downloading ? {cancel: true} : {}));
    return;
  }
  dialog('Capture Tasks', '<p class="hint">Paste a chat or meeting notes. Shishi finds tasks on this Mac. Review each suggestion alongside the original message before adding it.</p><label>Message<textarea id="source" maxlength="2400" rows="5" placeholder="Paste a work message here…">' + esc(source) + '</textarea></label><div class="actions"><button id="demoText" class="mini-link">Try an example</button><span class="spacer"></span><button id="paste" class="secondary">Paste</button><button id="recognize" class="primary">Find Tasks</button></div><div id="candidates" aria-live="polite"></div>');
  $('source').focus();
  const reset = () => { captureToken++; $('candidates').innerHTML = ''; $('recognize').disabled = false; $('recognize').textContent = 'Find Tasks'; };
  $('source').oninput = reset;
  $('demoText').onclick = () => { $('source').value = example; reset(); };
  $('paste').onclick = async () => { try { const v = await native('paste'); if (v.length > 2400) { toast('This message is over 2,400 characters. Paste it in shorter sections.'); return; } if (v) { $('source').value = v; reset(); } else toast('The clipboard has no text.'); } catch (e) { toast(e.message); } };
  $('recognize').onclick = async () => {
    const text = $('source').value.trim();
    if (!text) { $('source').focus(); toast('Enter a message first.'); return; }
    const stamp = ++captureToken, button = $('recognize');
    button.disabled = true; button.textContent = 'Finding tasks…';
    $('candidates').innerHTML = '<p class="hint">Qwen is running on this Mac. The first run may take a few seconds.</p>';
    try {
      const suggestions = await native('extract', {text});
      if (stamp !== captureToken || !$('dialog').open) return;
      if (!suggestions.length) { $('candidates').innerHTML = '<p class="hint">No clear tasks found. Add more context or enter a task manually.</p><button id="useManual" class="secondary">Add a Task</button>'; $('useManual').onclick = () => manualFromText(text); return; }
      review(text, suggestions);
    } catch (e) { if (stamp === captureToken && $('dialog').open) { $('candidates').innerHTML = '<p class="feedback">' + esc(e.message) + '</p><button id="useManual" class="secondary">Add a Task</button>'; $('useManual').onclick = () => manualFromText(text); } }
    finally { if (stamp === captureToken && button.isConnected) { button.disabled = false; button.textContent = 'Find Tasks Again'; } }
  };
}
function manualFromText(text) {
  taskForm(newTask({source: text, quote: text}));
}
function review(source, items) {
  const root = $('candidates');
  root.innerHTML = '<div class="subhead"><h3>Review ' + items.length + (items.length === 1 ? ' task' : ' tasks') + '</h3></div>' +
    '<datalist id="captureTags">' + availableTaskTags().map(name => '<option value="' + esc(name) + '">').join('') + '</datalist>' +
    items.map((t, i) => '<article class="candidate" data-index="' + i + '"><div class="ctop"><input type="checkbox" checked aria-label="Select task ' + (i + 1) + '"><input class="candidate-title" aria-label="Task title" maxlength="240" value="' + esc(t.title) + '"></div>' +
      '<div class="formgrid three"><label>List<select class="cproject">' + options(data.projects, projectOfView() || data.projects[0], projectLabel) + '</select></label>' +
      '<label>Tag<input class="ctag" list="captureTags" maxlength="30" value="' + esc(t.tag) + '"></label>' +
      '<label>Priority<select class="cpriority">' + options(['P0', 'P1', 'P2'], ['P0', 'P1', 'P2'].includes(t.priority) ? t.priority : 'P2') + '</select></label></div>' +
      '<details class="candidate-source"><summary>Source message</summary><blockquote>' + esc(t.quote) + '</blockquote></details></article>').join('') +
    '<div class="actions"><button class="primary" id="confirm">' + (items.length === 1 ? 'Add Task' : 'Add Selected Tasks') + '</button></div>';
  $('confirm').onclick = async () => {
    const button = $('confirm');
    button.disabled = true;
    const chosen = [...root.querySelectorAll('.candidate')].filter(el => el.querySelector('[type=checkbox]').checked).map(el => { const item = items[Number(el.dataset.index)]; return newTask({title: el.querySelector('.candidate-title').value.trim(), project: el.querySelector('.cproject').value, tag: el.querySelector('.ctag').value.trim(), priority: el.querySelector('.cpriority').value, source, quote: item.quote}); });
    try {
      if (!chosen.length || chosen.some(t => !t.title)) throw Error('Select at least one task and give each selected task a title.');
      let added = 0;
      await change(s => { for (const t of chosen) { if (!s.tasks.some(x => x.source === t.source && x.quote === t.quote && x.title === t.title && x.project === t.project)) { s.tasks.push(t); added++; } } });
      closeDialog(); go('all');
      toast(added ? 'Added ' + added + (added === 1 ? ' task' : ' tasks') : 'These tasks are already on your list.');
    } catch (e) { button.disabled = false; toast(e.message); }
  };
}

function schedule(id, target, before = '') {
  return change(s => {
    let i = s.tasks.findIndex(t => t.id === id);
    if (i < 0) return;
    const t = s.tasks[i];
    if (t.done) return;
    if (target === 'today') {
      planOn(t, day());
      if (before && before !== id) { s.tasks.splice(i, 1); const j = s.tasks.findIndex(x => x.id === before); s.tasks.splice(j < 0 ? s.tasks.length : j, 0, t); }
    } else if (target.startsWith('d:')) planOn(t, target.slice(2));
    else if (target.startsWith('p:') && s.projects.includes(target.slice(2))) t.project = target.slice(2);
  });
}

// Inline creation
function quickDefaults(key) {
  const fields = {};
  if (key.startsWith('p:')) fields.project = key.slice(2);
  else if (key.startsWith('d:')) fields.planned = key.slice(2);
  else {
    if (projectOfView()) fields.project = projectOfView();
    if (view === 'today') fields.planned = day();
    if (tag) fields.tag = tag;
  }
  return fields;
}
// What the typed text was read as, kinds the person turned back into text, and the chips that show both (F10, F14).
const ignoredKinds = input => (input.dataset.ignore || '').split(',').filter(Boolean);
function parseQuick(text, ignore = []) {
  return TaskLogic.parse(text, {today: day(), projects: data.projects, tags: availableTaskTags(), ignore});
}
const timeLabel = time => new Date('2000-01-01T' + time).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
function parseChips(found) {
  return found.parts.map(part => {
    const label = {
      date: () => symbol('i-calendar') + esc(found.planned ? dayLabel(found.planned) : 'Due ' + dayLabel(found.dueDate)),
      time: () => symbol('i-clock') + esc(timeLabel(found.dueTime)),
      repeat: () => symbol('i-repeat') + esc(TaskLogic.repeatLabels[found.repeat]),
      priority: () => esc(found.priority),
      tag: () => symbol('i-tag') + esc(found.tag),
      project: () => symbol('i-list') + esc(projectLabel(found.project))
    }[part.kind]?.();
    if (!label) return '';
    return '<span class="chip" data-kind="' + part.kind + '" title="Read from “' + esc(part.text) + '”">' + label +
      '<button type="button" class="chip-keep" data-keep="' + part.kind + '" aria-label="Keep “' + esc(part.text) + '” as text" title="Keep “' + esc(part.text) + '” as text">' + symbol('close-icon') + '</button></span>';
  }).join('');
}
function showParseHint(input, hint) {
  if (!hint) return;
  if (!input.value.trim()) input.dataset.ignore = '';
  hint.innerHTML = parseChips(parseQuick(input.value, ignoredKinds(input)));
}
function showQuickHint(input) {
  showParseHint(input, input.closest('.quick-add')?.querySelector('.quick-hint'));
}
// The chip's button turns that piece back into plain text in the title.
document.addEventListener('mousedown', event => { if (event.target.closest('.chip-keep')) event.preventDefault(); });
document.addEventListener('click', event => {
  const keep = event.target.closest('.chip-keep');
  if (!keep) return;
  const scope = keep.closest('.quick-add, .card-add-area');
  const input = scope?.querySelector('input');
  if (!input) return;
  input.dataset.ignore = [...new Set([...ignoredKinds(input), keep.dataset.keep])].join(',');
  showParseHint(input, scope.querySelector('.quick-hint'));
  input.focus();
}, true);
function openQuick(key) {
  quickTarget = key;
  if (key.startsWith('p:')) collapsedProjects.delete(key.slice(2));
  render();
  document.querySelector('.quick-add input')?.focus();
}
function closeQuick() { if (quickTarget) { quickTarget = null; render(); } }
document.addEventListener('input', event => { if (event.target.closest?.('.quick-add')) showQuickHint(event.target); });
document.addEventListener('submit', event => {
  const form = event.target.closest?.('.quick-add');
  if (!form) return;
  event.preventDefault();
  const input = form.querySelector('input'), found = parseQuick(input.value, ignoredKinds(input));
  if (!found.title) return;
  const fields = quickDefaults(form.dataset.quickForm);
  for (const key of ['planned', 'dueDate', 'dueTime', 'priority', 'tag', 'project', 'repeat']) if (found[key]) fields[key] = found[key];
  const task = newTask({...fields, title: found.title});
  input.value = '';
  input.dataset.ignore = '';
  showQuickHint(input);
  action(change(s => { s.tasks.push(task); }));
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && event.target.closest?.('.quick-add')) { event.preventDefault(); event.target.value = ''; closeQuick(); } });
document.addEventListener('focusout', event => {
  const form = event.target.closest?.('.quick-add');
  if (!form) return;
  // Let a click on another control land before the field goes away.
  setTimeout(() => {
    const field = document.querySelector('.quick-add input');
    if (field && document.activeElement !== field && !field.value.trim()) closeQuick();
  }, 120);
});

document.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) { closeDialog(); return; }
  const b = e.target.closest('[data-view]');
  if (b) { go(b.dataset.view); return; }
  const group = e.target.closest('[data-group]');
  if (group) {
    const opening = group.getAttribute('aria-expanded') === 'false';
    if (opening) collapsedProjects.delete(group.dataset.group); else collapsedProjects.add(group.dataset.group);
    group.setAttribute('aria-expanded', String(opening));
    $(group.getAttribute('aria-controls')).hidden = !opening;
    return;
  }
  const quick = e.target.closest('[data-quick]');
  if (quick) { openQuick(quick.dataset.quick); return; }
  if (e.target.closest('[data-new-group]')) { projectForm(); return; }
  const f = e.target.closest('[data-tag]');
  if (f) { tag = f.dataset.tag; render(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const t = data.tasks.find(x => x.id === a.closest('.row').dataset.id);
  if (!t) return;
  if (a.dataset.act === 'edit') taskForm(t);
  if (a.dataset.act === 'deadline') editDeadline(a, t);
  if (a.dataset.act === 'schedule') editPlanned(a, t);
  if (a.dataset.act === 'more') taskMenu(t, a, a.closest('.row').querySelector('.task-body'));
  if (a.dataset.act === 'tag' || a.dataset.act === 'priority') showTaskPicker(a, t, a.dataset.act);
  if (a.dataset.act === 'toggle') {
    const row = a.closest('.row');
    if (row.classList.contains('completing')) return;
    // Let the check fill before the task leaves the list.
    (t.done ? Promise.resolve() : Motion.celebrate(row)).then(() => action(toggleTask(t.id)));
  }
  if (a.dataset.act === 'today') action(schedule(t.id, 'today'));
});
document.addEventListener('dragstart', e => { const r = e.target.closest?.('.row[draggable=true]'); if (!r) return; dragId = r.dataset.id; r.classList.add('dragging'); e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; });
document.addEventListener('dragover', e => { const zone = e.target.closest?.('[data-target]'); if (!dragId || !zone) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; zone.classList.add('over'); });
document.addEventListener('dragleave', e => { const zone = e.target.closest?.('[data-target]'); if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
document.addEventListener('drop', e => {
  const zone = e.target.closest?.('[data-target]');
  if (!dragId || !zone) return;
  e.preventDefault();
  const dest = zone.dataset.target, id = dragId, before = e.target.closest('.row')?.dataset.id || '';
  dragId = '';
  action(schedule(id, dest, before).then(() => toast(dest === 'today' ? 'Added to Today' : dest.startsWith('d:') ? 'Scheduled for ' + dayLabel(dest.slice(2)) : 'Moved to ' + projectLabel(dest.slice(2)))));
  zone.classList.remove('over');
});
document.addEventListener('dragend', () => { dragId = ''; document.querySelectorAll('.over,.dragging').forEach(x => x.classList.remove('over', 'dragging')); });
$('openCapture').onclick = () => capture();
// The light download has no offline model, so it cannot find tasks in a message.
// It can download the pinned model on request; the host verifies its SHA-256 before turning capture on (F18).
let canCapture = true, capabilities = {}, modelProgress = null;
const megabytes = bytes => Math.round(bytes / 1e6).toLocaleString('en-US') + ' MB';
function modelStatusText() {
  const p = modelProgress;
  if (!p) return '';
  if (p.state === 'downloading') return 'Downloading: ' + megabytes(p.received) + ' of ' + megabytes(p.total) + ' (' + Math.floor(p.received / p.total * 100) + '%)';
  if (p.state === 'verifying') return 'Checking the file against its published checksum…';
  if (p.state === 'installed') return 'The offline model is installed.';
  return p.message || '';
}
window.setCapabilities = abilities => {
  capabilities = abilities || {};
  canCapture = capabilities.capture !== false;
  $('openCapture').hidden = !canCapture;
  $('downloadModelMenu').hidden = canCapture || !capabilities.canDownloadModel;
  $('downloadModelMenu').lastChild.textContent = capabilities.downloading ? 'Downloading Offline Model…' : 'Download Offline Model…';
  if ($('downloadModel')) $('downloadModel').textContent = capabilities.downloading ? 'Cancel Download' : 'Download Model (1.1 GB)';
};
window.modelProgress = progress => {
  modelProgress = progress;
  if ($('modelStatus')) $('modelStatus').textContent = modelStatusText();
  if (progress.state === 'installed') { toast('Offline model installed. Capture Tasks is ready.'); if ($('captureManual') && !$('recognize')) { closeDialog(true); capture(); } }
  if (progress.state === 'failed') toast(progress.message);
};
$('downloadModelMenu').onclick = () => capture();
$('newProject').onclick = projectForm;
function startNewTask() { if (view === 'done') taskForm(); else openQuick('view'); }
$('manual').onclick = startNewTask;
$('pin').onclick = async () => { try { await native('compact', {value: !compact}); } catch (e) { toast(e.message); } };
$('dialog').addEventListener('close', () => { captureToken++; dialogGuard = null; document.body.append($('toast')); });
window.setCompact = v => {
  compact = v;
  if (v) { window.setWorkspaceReturn?.(false); window.Card?.setPrefs().catch(() => {}); }
  document.body.classList.toggle('compact', v);
  // One agent capsule: in the toolbar of the workspace, or at the top of the corner card.
  const island = $('island');
  if (v) document.querySelector('.card-island-slot').append(island);
  else document.querySelector('.toolbar').insertBefore(island, document.querySelector('.toolbar-tools'));
  if (v) {
    const preview = document.querySelector('#latestResult .result-preview[aria-expanded="true"]');
    if (preview) preview.click();
    go('today');
  } else render();
};
// The app tells the page how tall the title bar is, because content runs underneath it.
window.setChrome = chrome => {
  document.documentElement.style.setProperty('--titlebar', Math.max(0, Number(chrome?.titlebar) || 0) + 'px');
  document.documentElement.classList.toggle('vibrant', !!chrome?.vibrant);
};
window.openMessage = text => { capture(text || ''); };
document.addEventListener('keydown', e => {
  if (!e.metaKey || e.altKey || $('dialog').open) return;
  if (e.key === 'n') { e.preventDefault(); startNewTask(); }
  const index = ['1', '2', '3', '4'].indexOf(e.key);
  if (index >= 0) { e.preventDefault(); go(['today', 'upcoming', 'all', 'done'][index]); }
});
setInterval(() => { if (lastDay !== day()) { lastDay = day(); render(); } }, 30000);
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const s = await native('load');
    if (s) data = s;
    render();
    await native('ready');
  } catch (e) {
    locked = true;
    render();
    $('tasks').textContent = 'Shishi could not load your lists. Saving is paused to protect your data. ' + e.message;
  }
});
