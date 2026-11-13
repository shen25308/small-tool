'use strict';

function sortVisibleTasks(items) {
  const order = $('taskSort').value;
  if (order === 'manual') return items;
  if (order === 'priority') return [...items].sort((a, b) => (a.priority || 'P2').localeCompare(b.priority || 'P2'));
  if (order === 'title') return [...items].sort((a, b) => a.title.localeCompare(b.title, undefined, {sensitivity: 'base'}));
  const deadline = task => (task.dueDate || '9999-12-31') + 'T' + (task.dueTime || '23:59');
  return [...items].sort((a, b) => deadline(a).localeCompare(deadline(b)));
}

function renderBoardTags() {
  const counts = new Map();
  for (const task of data.tasks) {
    if (task.tag && !task.done) counts.set(task.tag, (counts.get(task.tag) || 0) + 1);
  }
  $('labels').innerHTML = availableTaskTags().map(name =>
    '<button data-board-tag="' + esc(name) + '" title="' + esc(name) + '"' + (view === 'all' && tag === name ? ' class="active" aria-current="page"' : '') + '>' +
    '<span class="tag-bullet ' + taskTagColor(name) + '" aria-hidden="true"></span><span class="prname">' + esc(name) + '</span>' +
    '<span class="num">' + (counts.get(name) || '') + '</span></button>').join('');
}

$('labels').addEventListener('click', event => {
  const button = event.target.closest('[data-board-tag]');
  if (!button) return;
  view = 'all'; tag = button.dataset.boardTag; quickTarget = null; render();
  document.querySelector('main .content').scrollTop = 0;
});

function nameForm(title, label, value, submitLabel, save) {
  dialog(title, '<form id="nameForm"><label>' + esc(label) + '<input id="nameField" maxlength="32" required autocomplete="off" value="' + esc(value) + '"></label><div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">' + esc(submitLabel) + '</button></div></form>');
  $('nameField').focus(); $('nameField').select();
  $('nameForm').onsubmit = event => {
    event.preventDefault();
    const name = $('nameField').value.trim();
    if (name) action(Promise.resolve().then(() => save(name)).then(closeDialog));
  };
}

$('newTag').onclick = () => nameForm('New Tag', 'Name', '', 'Create', name => {
  if (availableTaskTags().includes(name)) throw Error('This tag already exists.');
  return change(state => {
    state.labels = [...new Set([...(state.labels || []), name])];
    state.hiddenTags = (state.hiddenTags || []).filter(item => item !== name);
  }).then(() => { view = 'all'; tag = name; render(); });
});

// A menu that looks and behaves like a system menu: arrow keys move, Return chooses, Escape closes.
function showMenu(items, at) {
  document.querySelector('.menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu'; menu.setAttribute('popover', 'manual'); menu.setAttribute('role', 'menu');
  const handlers = new Map();
  const button = (item, className) => {
    const node = document.createElement('button');
    node.type = 'button'; node.className = className; node.setAttribute('role', 'menuitem');
    if (item.icon) node.insertAdjacentHTML('beforeend', symbol(item.icon));
    node.append(item.label);
    if (item.hint) { const hint = document.createElement('span'); hint.className = 'shortcut'; hint.textContent = item.hint; node.append(hint); }
    if (item.disabled) node.disabled = true;
    if (item.pressed != null) node.setAttribute('aria-pressed', String(item.pressed));
    handlers.set(node, item.run);
    return node;
  };
  for (const item of items.filter(Boolean)) {
    if (item === '-') { const line = document.createElement('div'); line.className = 'menu-divider'; menu.append(line); }
    else if (item.heading) { const head = document.createElement('div'); head.className = 'menu-heading'; head.textContent = item.heading; menu.append(head); }
    else if (item.segment) { const group = document.createElement('div'); group.className = 'menu-segment'; item.segment.forEach(part => group.append(button(part, ''))); menu.append(group); }
    else menu.append(button(item, 'menu-item' + (item.danger ? ' danger' : '')));
  }
  // Manual popover: the mouse-up that ends a right-click must not dismiss the menu it just opened.
  const lifetime = new AbortController();
  const close = () => { lifetime.abort(); if (menu.matches(':popover-open')) menu.hidePopover(); menu.remove(); };
  menu.addEventListener('click', event => {
    const chosen = event.target.closest('button');
    if (!chosen || chosen.disabled) return;
    close();
    handlers.get(chosen)?.();
  });
  menu.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  });
  const outside = event => { if (!menu.contains(event.target)) close(); };
  document.addEventListener('pointerdown', outside, {capture: true, signal: lifetime.signal});
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }, {signal: lifetime.signal});
  window.addEventListener('blur', close, {signal: lifetime.signal});
  window.addEventListener('resize', close, {signal: lifetime.signal});
  ($('dialog').open ? $('dialog') : document.body).append(menu);
  menu.showPopover();
  const box = menu.getBoundingClientRect();
  const anchor = at instanceof Element ? at.getBoundingClientRect() : null;
  const x = anchor ? anchor.left : at.x, y = anchor ? anchor.bottom + 4 : at.y;
  menu.style.left = Math.max(6, Math.min(x, innerWidth - box.width - 6)) + 'px';
  menu.style.top = Math.max(6, Math.min(y, innerHeight - box.height - 6)) + 'px';
  return menu;
}

function patchTask(id, fn) {
  return change(state => { const task = state.tasks.find(item => item.id === id); if (task) fn(task, state); });
}

function taskMenu(task, at, anchor) {
  const today = day();
  const plan = date => () => action(patchTask(task.id, item => planOn(item, date)));
  showMenu([
    {label: task.done ? 'Mark as Open' : 'Mark as Completed', icon: 'i-check-circle', run: () => action(toggleTask(task.id))},
    {label: 'Edit Details…', icon: 'i-pencil', run: () => taskForm(task)},
    '-',
    !task.done && {heading: 'Schedule'},
    !task.done && {segment: [['Today', today], ['Tomorrow', addDays(today, 1)], ['Next Week', TaskLogic.nextWeekday(today, 1)]].map(([label, date]) =>
      ({label, pressed: plannedDays(task).length === 1 && plannedDays(task)[0] === date, run: plan(date)}))},
    !task.done && {label: 'Choose Days…', icon: 'i-calendar', run: () => editPlanned(anchor, task)},
    !task.done && (task.evening ? {label: 'Move Out of This Evening', icon: 'i-sun', run: () => action(setWhen(task.id, ''))}
      : {label: 'This Evening', icon: 'i-moon', hint: '⌘E', run: () => action(setWhen(task.id, 'evening'))}),
    !task.done && !task.someday && {label: 'Someday', icon: 'i-someday', hint: '⌘O', run: () => action(setWhen(task.id, 'someday'))},
    !task.done && task.planned && {label: 'Remove Date', icon: 'i-xmark', run: plan('')},
    !task.done && '-',
    {heading: 'Priority'},
    {segment: ['P0', 'P1', 'P2'].map(level => ({label: level, pressed: task.priority === level, run: () => action(patchTask(task.id, item => { item.priority = level; }))}))},
    '-',
    !task.done && {label: 'Send to Claude Code', icon: 'i-terminal', run: () => action(AgentTasks.send(task, 'claude'))},
    !task.done && {label: 'Send to Codex', icon: 'i-terminal', run: () => action(AgentTasks.send(task, 'codex'))},
    !task.done && '-',
    data.projects.length > 1 && {label: 'Move to List…', icon: 'i-list', run: () => showTaskPicker(anchor, task, 'project')},
    !task.done && {label: 'Start Focus', icon: 'i-timer', run: () => startFocus(focusLength, task)},
    {label: 'Duplicate', icon: 'i-duplicate', run: () => action(change(state => {
      const index = state.tasks.findIndex(item => item.id === task.id);
      const copy = {...structuredClone(task), id: uuid(), done: false};
      delete copy.completedAt; delete copy.notion; delete copy.next; delete copy.nextSignature; delete copy.previous; delete copy.series;
      delete copy.reminder; delete copy.github; delete copy.agentRuns; delete copy.agentReceipt;
      state.tasks.splice(index + 1, 0, copy);
    }))},
    {label: 'Copy Title', icon: 'i-copy', run: () => action(native('copy', {text: task.title}).then(() => toast('Copied')))},
    '-',
    {label: 'Delete', icon: 'i-trash', danger: true, run: () => action(removeTask(task))}
  ], at);
}

function renameProject(name) {
  nameForm('Rename List', 'Name', projectLabel(name), 'Rename', next => {
    if (next === name) return;
    if (data.projects.includes(next)) throw Error('A list with this name already exists.');
    return change(state => {
      state.projects[state.projects.indexOf(name)] = next;
      state.tasks.forEach(task => { if (task.project === name) task.project = next; });
      if (state.notion?.project === name) state.notion.project = next;
    }).then(() => { if (view === 'p:' + name) view = 'p:' + next; render(); });
  });
}

function deleteProject(name) {
  const others = data.projects.filter(item => item !== name);
  const count = data.tasks.filter(task => task.project === name).length;
  dialog('Delete List', '<form id="deleteList"><p>Delete “' + esc(projectLabel(name)) + '”?</p>' +
    (count ? '<label>Move its ' + count + (count === 1 ? ' task' : ' tasks') + ' to<select id="moveTarget">' + options(others, others[0], projectLabel) + '<option value="">Delete the tasks too</option></select></label>' : '') +
    '<div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Delete</button></div></form>');
  $('deleteList').onsubmit = event => {
    event.preventDefault();
    const target = $('moveTarget')?.value ?? '';
    action(change(state => {
      state.projects = state.projects.filter(item => item !== name);
      if (target) state.tasks.forEach(task => { if (task.project === name) task.project = target; });
      else state.tasks = state.tasks.filter(task => task.project !== name);
      if (state.notion?.project === name) delete state.notion;
    }).then(() => { closeDialog(); if (view === 'p:' + name) go('today'); }));
  };
}

function deleteTag(name) {
  action(change(state => {
    state.labels = (state.labels || []).filter(item => item !== name);
    state.tasks.forEach(task => { if (task.tag === name) task.tag = ''; });
    if (Object.hasOwn(suggestedTags, name)) state.hiddenTags = [...new Set([...(state.hiddenTags || []), name])];
  }).then(() => { if (tag === name) tag = ''; render(); }));
}

function renameTag(name) {
  nameForm('Rename Tag', 'Name', name, 'Rename', next => {
    if (next === name) return;
    return change(state => {
      state.labels = [...new Set([...(state.labels || []).filter(item => item !== name), next])];
      state.tasks.forEach(task => { if (task.tag === name) task.tag = next; });
      if (Object.hasOwn(suggestedTags, name)) state.hiddenTags = [...new Set([...(state.hiddenTags || []), name])];
    }).then(() => { if (tag === name) tag = next; render(); });
  });
}

document.addEventListener('contextmenu', event => {
  const at = {x: event.clientX, y: event.clientY};
  const taskRow = event.target.closest('.row[data-id]');
  if (taskRow) {
    const task = data.tasks.find(item => item.id === taskRow.dataset.id);
    if (!task) return;
    event.preventDefault();
    taskMenu(task, at, taskRow.querySelector('.task-body'));
    return;
  }
  const project = event.target.closest('[data-project]');
  if (project) {
    event.preventDefault();
    const name = project.dataset.project;
    showMenu([
      {label: 'New Task', icon: 'plus', run: () => { go('p:' + name); openQuick('view'); }},
      {label: 'Rename…', icon: 'i-pencil', run: () => renameProject(name)},
      {label: data.projectFolders?.[name] ? 'Project Folder: ' + AgentTasks.shortPath(data.projectFolders[name]) : 'Set Project Folder…', icon: 'i-terminal', run: () => action(AgentTasks.chooseFolder(name))},
      data.notion?.project === name && {label: 'Sync with Notion', icon: 'i-link', run: () => syncNotion()},
      '-',
      {label: 'Delete List…', icon: 'i-trash', danger: true, disabled: data.projects.length < 2, run: () => deleteProject(name)}
    ], at);
    return;
  }
  const label = event.target.closest('[data-board-tag]');
  if (label) {
    event.preventDefault();
    const name = label.dataset.boardTag;
    showMenu([
      {label: 'Rename…', icon: 'i-pencil', run: () => renameTag(name)},
      {label: 'Delete Tag', icon: 'i-trash', danger: true, run: () => deleteTag(name)}
    ], at);
  }
});

document.addEventListener('click', event => {
  if (!event.target.closest('[data-clear-done]')) return;
  const removed = data.tasks.filter(task => task.done);
  if (!removed.length) return;
  action(change(state => { state.tasks = state.tasks.filter(task => !task.done); }).then(() =>
    toast('Cleared ' + removed.length + (removed.length === 1 ? ' task' : ' tasks'), () => action(change(state => {
      const ids = new Set(state.tasks.map(task => task.id));
      state.tasks.push(...removed.filter(task => !ids.has(task.id)));
    })))));
});

function tasksAsMarkdown(tasks = data.tasks) {
  const lines = [];
  for (const project of data.projects) {
    const rows = tasks.filter(task => task.project === project);
    if (!rows.length) continue;
    lines.push('## ' + projectLabel(project), '');
    for (const task of rows) {
      const facts = [task.priority !== 'P2' && task.priority, task.tag && '#' + task.tag, task.dueDate && 'due ' + task.dueDate + (task.dueTime ? ' ' + task.dueTime : ''),
        !task.done && plannedDays(task).length && 'planned ' + plannedDays(task).join(', '), task.repeat && TaskLogic.repeatLabels[task.repeat]?.toLowerCase()].filter(Boolean);
      lines.push('- [' + (task.done ? 'x' : ' ') + '] ' + task.title + (facts.length ? ' (' + facts.join(', ') + ')' : ''));
      // Notes follow as an indented quote, one line each.
      for (const line of (task.notes || '').split('\n').filter(Boolean)) lines.push('  > ' + line);
      for (const item of task.subtasks || []) lines.push('  - [' + (item.done ? 'x' : ' ') + '] ' + item.title);
    }
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}
function exportTasks() {
  if (!data.tasks.length) { toast('There are no tasks to copy.'); return; }
  action(native('copy', {text: tasksAsMarkdown()}).then(() => toast('Copied ' + data.tasks.length + ' tasks as Markdown')));
}
$('exportTasks').onclick = exportTasks;
$('backupExport').onclick = () => action(Backup.exportFile());
$('backupImport').onclick = () => action(Backup.importFile());

// Search and commands
const palette = $('palette'), paletteInput = $('paletteInput'), paletteList = $('paletteList');
let paletteRows = [], paletteIndex = 0;
function paletteCommands() {
  return [
    {label: 'New Task', icon: 'plus', hint: '⌘N', run: startNewTask},
    {label: 'New List', icon: 'i-list', run: projectForm},
    canCapture && {label: 'Capture Tasks from a Message', icon: 'sparkles', run: () => capture()},
    {label: 'Open Inbox', icon: 'inbox', run: () => $('inboxButton').click()},
    {label: 'Settings', icon: 'i-gear', hint: '⌘,', run: () => showConnectors()},
    {label: focusSession ? 'Stop Focus Timer' : 'Start Focus Timer', icon: 'i-timer', run: () => focusSession ? stopFocus(false) : startFocus(focusLength)},
    {label: 'Wrap Up Today', icon: 'i-check-circle', run: wrapUp},
    {label: compact ? 'Open Full Workspace' : 'Floating Today List', icon: compact ? 'expand' : 'pin', run: () => $('pin').click()},
    {label: 'Copy Tasks as Markdown', icon: 'i-copy', run: exportTasks},
    {label: 'Back Up to File', icon: 'i-download', run: () => action(Backup.exportFile())},
    {label: 'Import Backup', icon: 'i-upload', run: () => action(Backup.importFile())},
    data.notion && {label: 'Sync with Notion', icon: 'i-link', run: () => syncNotion()}
  ].filter(Boolean);
}
function drawPalette() {
  const query = paletteInput.value.trim().toLocaleLowerCase();
  const match = text => text.toLocaleLowerCase().includes(query);
  const sections = [];
  const commands = paletteCommands().filter(item => match(item.label));
  const lists = [
    ...['today', 'upcoming', 'all', 'someday', 'done'].map((id, index) => ({label: titles[id], icon: 'i-list', hint: '⌘' + (index + 1), run: () => go(id)})),
    ...data.projects.map(name => ({label: projectLabel(name), icon: 'i-list', hint: 'List', run: () => go('p:' + name)})),
    ...availableTaskTags().map(name => ({label: name, icon: 'i-tag', hint: 'Tag', run: () => { view = 'all'; tag = name; render(); }}))
  ].filter(item => match(item.label));
  const tasks = query ? data.tasks.filter(task => match([task.title, projectLabel(task.project), task.tag, task.notes || ''].join(' '))).slice(0, 40)
    .map(task => ({label: task.title, icon: task.done ? 'i-check-circle' : 'i-clock', hint: projectLabel(task.project), done: task.done, run: () => taskForm(task)})) : [];
  const goTo = ['Go To', query ? lists : lists.slice(0, 5 + data.projects.length)];
  // Typing a list or tag name should reach that list first. Otherwise matching tasks lead.
  const listFirst = query && lists.some(item => item.label.toLocaleLowerCase().startsWith(query));
  if (listFirst) sections.push(goTo);
  if (tasks.length) sections.push(['Tasks', tasks]);
  if (lists.length && !listFirst) sections.push(goTo);
  if (commands.length) sections.push(['Commands', commands]);
  if (query) sections.push(['New', [{label: 'Add “' + paletteInput.value.trim() + '” as a task', icon: 'plus', run: () => {
    const found = parseQuick(paletteInput.value);
    if (!found.title) return;
    const fields = quickDefaults('view');
    for (const key of ['planned', 'dueDate', 'dueTime', 'priority', 'tag', 'project', 'repeat', 'evening', 'someday']) if (found[key]) fields[key] = found[key];
    action(change(state => { state.tasks.push(newTask({...fields, title: found.title})); }).then(() => toast('Task added')));
  }}]]);
  paletteRows = sections.flatMap(([, rows]) => rows);
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteRows.length - 1));
  let index = 0;
  paletteList.innerHTML = sections.map(([title, rows]) => '<div class="palette-section">' + title + '</div>' + rows.map(item =>
    '<button type="button" role="option" class="palette-item' + (item.done ? ' is-done' : '') + (index === paletteIndex ? ' active' : '') + '" data-index="' + (index++) + '" aria-selected="' + (index - 1 === paletteIndex) + '">' +
    symbol(item.icon) + '<span class="palette-label">' + esc(item.label) + '</span>' + (item.hint ? '<small>' + esc(item.hint) + '</small>' : '') + '</button>').join('')).join('') ||
    '<div class="palette-empty">No results</div>';
  paletteList.querySelector('.active')?.scrollIntoView({block: 'nearest'});
}
function openPalette(text = '') {
  if ($('dialog').open) return;
  paletteInput.value = text; paletteIndex = 0;
  if (!palette.open) palette.showModal();
  drawPalette();
  paletteInput.focus();
}
function runPalette(index) {
  const item = paletteRows[index];
  if (!item) return;
  palette.close();
  item.run();
}
paletteInput.oninput = () => { paletteIndex = 0; drawPalette(); };
palette.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!paletteRows.length) return;
    paletteIndex = (paletteIndex + (event.key === 'ArrowDown' ? 1 : -1) + paletteRows.length) % paletteRows.length;
    drawPalette();
  } else if (event.key === 'Enter') { event.preventDefault(); runPalette(paletteIndex); }
});
palette.addEventListener('click', event => {
  if (event.target === palette) { palette.close(); return; }
  const item = event.target.closest('.palette-item');
  if (item) runPalette(Number(item.dataset.index));
});
paletteList.addEventListener('mousemove', event => {
  const item = event.target.closest('.palette-item');
  if (!item || Number(item.dataset.index) === paletteIndex) return;
  paletteIndex = Number(item.dataset.index);
  paletteList.querySelectorAll('.palette-item').forEach(node => node.classList.toggle('active', node === item));
});
$('searchTasks').onclick = () => openPalette();
$('sideSearch').onclick = () => openPalette();
document.addEventListener('keydown', event => {
  if (event.metaKey && ['k', 'f'].includes(event.key.toLowerCase()) && !$('dialog').open) { event.preventDefault(); openPalette(); }
  if (event.metaKey && event.key === ',' && !$('palette').open) { event.preventDefault(); showConnectors(); }
});

// Daily review
function completedOn(task, date) {
  return task.done && (task.completedAt ? task.completedAt.slice(0, 10) === date : task.planned === date);
}
function streak() {
  let count = 0, date = day();
  if (!data.tasks.some(task => completedOn(task, date))) date = addDays(date, -1);
  while (data.tasks.some(task => completedOn(task, date)) && count < 3650) { count++; date = addDays(date, -1); }
  return count;
}
function wrapUp() {
  const today = day();
  const done = data.tasks.filter(task => completedOn(task, today)), open = data.tasks.filter(task => isToday(task) && !task.done);
  const minutes = data.focusLog?.[today] || 0;
  const week = [...Array(7)].map((_, index) => addDays(today, index - 6));
  const counts = week.map(date => data.tasks.filter(task => completedOn(task, date)).length), top = Math.max(1, ...counts);
  const section = (title, rows) => '<h3>' + title + ' <span>' + rows.length + '</span></h3>' +
    (rows.length ? '<ul class="selectable">' + rows.map(task => '<li>' + esc(task.title) + '</li>').join('') + '</ul>' : '<p class="hint">None</p>');
  dialog('Wrap Up', '<div class="stat-grid"><div class="stat"><b>' + done.length + '</b><span>Completed</span></div><div class="stat"><b>' + open.length + '</b><span>Still open</span></div>' +
    '<div class="stat"><b>' + streak() + '</b><span>Day streak</span></div><div class="stat"><b>' + minutes + '</b><span>Focus minutes</span></div>' +
    (AgentTasks.minutesOn(today) ? '<div class="stat"><b>' + AgentTasks.minutesOn(today) + '</b><span>Agent minutes</span></div>' : '') + '</div>' +
    '<div class="week-bars" role="img" aria-label="Tasks completed over the last seven days">' + week.map((date, index) => '<div' + (date === today ? ' class="is-today"' : '') + '><b>' + (counts[index] || '') + '</b><i style="height:' + Math.round(counts[index] / top * 100) + '%"></i><span>' +
      new Intl.DateTimeFormat('en-US', {weekday: 'narrow'}).format(fromISO(date)) + '</span></div>').join('') + '</div>' +
    '<div class="wrap-summary">' + section('Completed', done) + section('Still open', open) + '</div>' +
    '<div class="actions">' + (open.length ? '<button type="button" class="secondary" id="carryOver">Move Open Tasks to Tomorrow</button>' : '') +
    '<button type="button" class="secondary" id="copyWrap">Copy Summary</button><span class="spacer"></span><button class="primary" data-close>Done</button></div>');
  if ($('carryOver')) $('carryOver').onclick = () => {
    const ids = new Set(open.map(task => task.id));
    action(change(state => { state.tasks.forEach(task => { if (ids.has(task.id)) planOn(task, addDays(today, 1)); }); }).then(() => { closeDialog(); toast('Moved ' + ids.size + (ids.size === 1 ? ' task' : ' tasks') + ' to tomorrow'); }));
  };
  $('copyWrap').onclick = () => {
    const list = (title, rows) => '## ' + title + '\n\n' + (rows.map(task => '- ' + task.title).join('\n') || '- None') + '\n';
    const text = '# ' + new Intl.DateTimeFormat('en-US', {dateStyle: 'full'}).format(new Date()) + '\n\n' + list('Completed', done) + '\n' + list('Still open', open);
    action(native('copy', {text}).then(() => toast('Summary copied')));
  };
}
$('wrapUp').onclick = wrapUp;
$('taskSort').onchange = render;

// Focus timer
let focusSession = null, focusLength = 25, focusTicker = 0;
const focusLeft = () => Math.max(0, Math.round((focusSession.end - Date.now()) / 1000));
const clockText = seconds => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
function paintFocus() {
  const button = $('focusButton'), label = $('focusTime');
  button.classList.toggle('running', !!focusSession);
  label.hidden = !focusSession;
  if (focusSession) label.textContent = clockText(focusLeft());
  button.title = focusSession ? 'Focus timer: ' + focusSession.title : 'Focus timer';
  const clock = document.querySelector('.focus-pop .focus-clock'), track = document.querySelector('.focus-pop .focus-track i');
  if (clock && track && focusSession) {
    clock.textContent = clockText(focusLeft());
    track.style.width = Math.min(100, 100 - focusLeft() / (focusSession.minutes * 60) * 100) + '%';
  }
}
function startFocus(minutes, task) {
  focusSession = {end: Date.now() + minutes * 60000, minutes, title: task?.title || 'Focus', taskId: task?.id || ''};
  clearInterval(focusTicker);
  focusTicker = setInterval(() => { if (focusSession && focusLeft() <= 0) stopFocus(true); else paintFocus(); }, 1000);
  paintFocus();
  toast('Focus started: ' + minutes + ' minutes');
}
function stopFocus(finished) {
  if (!focusSession) return;
  const session = focusSession, spent = finished ? session.minutes : Math.floor((session.minutes * 60 - focusLeft()) / 60);
  focusSession = null;
  clearInterval(focusTicker);
  document.querySelector('.focus-pop')?.hidePopover();
  paintFocus();
  if (spent > 0) action(change(state => { state.focusLog = {...(state.focusLog || {})}; state.focusLog[day()] = (state.focusLog[day()] || 0) + spent; }));
  toast(finished ? 'Focus session complete: ' + session.minutes + ' minutes on “' + session.title + '”' : 'Focus stopped' + (spent > 0 ? ' after ' + spent + ' min' : ''));
}
function focusPopover() {
  document.querySelector('.focus-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'focus-pop'; pop.setAttribute('popover', 'auto'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Focus timer');
  if (focusSession) {
    pop.innerHTML = '<h3>Focusing</h3><p>' + esc(focusSession.title) + '</p><div class="focus-clock"></div><div class="focus-track"><i></i></div>' +
      '<div class="actions"><button type="button" class="secondary" data-more>+5 min</button><button type="button" class="primary" data-stop>Stop</button></div>';
    pop.querySelector('[data-stop]').onclick = () => stopFocus(false);
    pop.querySelector('[data-more]').onclick = () => { focusSession.end += 300000; focusSession.minutes += 5; paintFocus(); };
  } else {
    const next = data.tasks.find(task => isToday(task) && !task.done);
    pop.innerHTML = '<h3>Focus Timer</h3><p>' + (next ? 'Next up: ' + esc(next.title) : 'Work without interruptions for a set time.') + '</p>' +
      '<div class="menu-segment">' + [15, 25, 50].map(value => '<button type="button" data-length="' + value + '" aria-pressed="' + (value === focusLength) + '">' + value + ' min</button>').join('') + '</div>' +
      '<div class="actions"><button type="button" class="primary" data-start>Start</button></div>';
    pop.querySelectorAll('[data-length]').forEach(button => { button.onclick = () => {
      focusLength = Number(button.dataset.length);
      pop.querySelectorAll('[data-length]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    }; });
    pop.querySelector('[data-start]').onclick = () => { pop.hidePopover(); startFocus(focusLength, next); };
  }
  pop.addEventListener('toggle', event => { if (event.newState === 'closed') pop.remove(); });
  document.body.append(pop);
  pop.showPopover();
  const anchor = $('focusButton').getBoundingClientRect(), box = pop.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(anchor.right - box.width, innerWidth - box.width - 6)) + 'px';
  pop.style.top = (anchor.bottom + 5) + 'px';
  paintFocus();
}
$('focusButton').onclick = focusPopover;

const menu = $('boardMenu');
menu.addEventListener('beforetoggle', event => {
  if (event.newState !== 'open') return;
  const box = $('boardMore').getBoundingClientRect();
  menu.style.top = Math.round(box.bottom + 5) + 'px';
  menu.style.right = Math.max(6, Math.round(innerWidth - box.right)) + 'px';
  menu.style.left = 'auto';
  $('peekLatest').disabled = $('latestResult').hidden;
});
menu.addEventListener('click', event => { if (event.target.closest('button')) menu.hidePopover(); });
$('openConnectors').onclick = () => showConnectors();
$('peekLatest').onclick = () => {
  $('latestPeek').hidden = false;
  $('latestPeek').scrollIntoView({block: 'nearest'});
  $('latestCard').querySelector('.result-preview')?.focus();
};
$('closePeek').onclick = () => {
  const preview = $('latestCard').querySelector('.result-preview[aria-expanded="true"]');
  if (preview) preview.click();
  $('latestPeek').hidden = true;
  $('boardMore').focus();
};

// The build workflow opens these sheets with "--show <name>" to capture the real window.
window.showForCapture = name => {
  if (name === 'settings-sync') { showConnectors('sync'); return; }
  if (name === 'connections') {
    showConnectors('agents');
    setTimeout(() => document.querySelector('#claudeRow .source-swatch')?.click(), 300);
  } else if (name === 'schedule') {
    const task = data.tasks.find(item => !item.done && item.plannedDates?.length > 1) || data.tasks.find(item => !item.done);
    if (!task) return;
    taskForm(task);
    $('plannedToggle')?.click();
  }
};

// shishi:// links from Shortcuts, Raycast, scripts or a browser. A link can add a task or show something,
// never change or delete what is already there.
window.openURLAction = fields => {
  const action = fields?.action;
  if (action === 'add') {
    const found = parseQuick(String(fields.text || fields.title || '').slice(0, 400));
    if (!found.title) { toast('The link had no task title.'); return; }
    const list = data.projects.find(name => name.toLocaleLowerCase() === String(fields.list || '').toLocaleLowerCase());
    const task = newTask({project: list || found.project || data.projects[0], title: found.title});
    for (const key of ['planned', 'dueDate', 'dueTime', 'priority', 'tag', 'repeat', 'evening', 'someday']) if (found[key]) task[key] = found[key];
    if (fields.notes) task.notes = String(fields.notes).slice(0, 4000);
    addFromLink(task);
    return;
  }
  if (action === 'open') {
    if (fields.view === 'inbox') { $('inboxButton').click(); return; }
    if (['today', 'upcoming', 'all', 'done'].includes(fields.view)) go(fields.view);
    return;
  }
  if (action === 'inbox') { $('inboxButton').click(); return; }
  if (action === 'search') openPalette(String(fields.q || '').slice(0, 200));
};
function addFromLink(task) {
  action(change(state => { state.tasks.push(task); }).then(() => toast('Added “' + task.title + '” from a link', () => action(change(state => {
    state.tasks = state.tasks.filter(item => item.id !== task.id);
  })))));
}

// The app menu's Settings… item (⌘,) opens the same sheet.
window.openSettings = tab => { if (compact) Card.inWorkspace(() => showConnectors(tab)); else showConnectors(tab); };
