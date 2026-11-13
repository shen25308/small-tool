'use strict';
// Versioned JSON backup of everything you entered: lists, tasks with notes, subtasks, planned days, deadlines,
// repeats and source links, tags, connection colours and settings stored with the workspace (F13).
// Account secrets never live in the workspace, so they cannot end up in a backup.
window.Backup = (() => {
  const FORMAT = 'shishi-backup', VERSION = 1;
  // Real calendar days and clock times only: 2026-99-99, 2026-02-30 and 99:99 are refused (UX-N01).
  const isDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number), date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  };
  const isTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const DATE = {test: isDate}, TIME = {test: isTime};
  const SECRET = /token|secret|password|credential|api[_-]?key/i;

  function build() {
    return {format: FORMAT, version: VERSION, app: 'Shishi', exportedAt: new Date().toISOString(), workspace: structuredClone(data)};
  }

  // Check a backup and return a cleaned copy plus everything wrong with it. Nothing changes until you confirm.
  function validate(object) {
    const problems = [];
    if (!object || typeof object !== 'object') return {problems: ['This file is not a Shishi backup.']};
    if (object.format !== FORMAT) problems.push('This file is not a Shishi backup.');
    if (!Number.isInteger(object.version) || object.version > VERSION) problems.push('This backup comes from a newer version of Shishi.');
    const ws = object.workspace;
    if (!ws || typeof ws !== 'object') return {problems: [...problems, 'The backup has no workspace.']};
    const secretKeys = [];
    (function walk(value, path) {
      if (Array.isArray(value)) value.forEach((item, index) => walk(item, path + '[' + index + ']'));
      else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) { if (SECRET.test(key)) secretKeys.push(path + key); walk(inner, path + key + '.'); }
    })(ws, '');
    if (secretKeys.length) problems.push('The backup contains fields that look like credentials (' + secretKeys.slice(0, 3).join(', ') + '). Shishi does not import them.');
    if (ws.version !== 1) problems.push('The workspace format is not supported.');
    const projects = Array.isArray(ws.projects) ? ws.projects : [];
    if (!projects.length || projects.some(name => typeof name !== 'string' || !name.trim()) || new Set(projects).size !== projects.length) problems.push('The list names are missing or repeated.');
    if (!Array.isArray(ws.tasks)) problems.push('The backup has no task list, so it may be damaged.');
    const ids = new Set();
    const tasks = (Array.isArray(ws.tasks) ? ws.tasks : []).map((task, index) => {
      const where = 'Task ' + (index + 1) + (typeof task?.title === 'string' && task.title ? ' (“' + task.title.slice(0, 40) + '”)' : '');
      if (!task || typeof task !== 'object') { problems.push(where + ' is not a task.'); return null; }
      const clean = {...task, tag: typeof task.tag === 'string' ? task.tag : '', source: typeof task.source === 'string' ? task.source : '',
        quote: typeof task.quote === 'string' ? task.quote : '', priority: ['P0', 'P1', 'P2'].includes(task.priority) ? task.priority : 'P2',
        planned: typeof task.planned === 'string' ? task.planned : '', done: task.done === true};
      if (typeof task.id !== 'string' || !task.id || ids.has(task.id)) problems.push(where + ' has a missing or repeated ID.');
      ids.add(task.id);
      if (typeof task.title !== 'string' || !task.title.trim()) problems.push(where + ' has no title.');
      if (!projects.includes(task.project)) problems.push(where + ' belongs to a list that is not in the backup.');
      if (clean.planned && !DATE.test(clean.planned)) problems.push(where + ' has an invalid planned date.');
      if (task.plannedDates !== undefined && (!Array.isArray(task.plannedDates) || task.plannedDates.some(date => !DATE.test(date)))) problems.push(where + ' has invalid planned days.');
      if (task.dueDate !== undefined && !DATE.test(task.dueDate)) problems.push(where + ' has an invalid deadline.');
      if (task.dueTime !== undefined && (!TIME.test(task.dueTime) || !task.dueDate)) problems.push(where + ' has a deadline time without a valid date.');
      if (task.repeat !== undefined && !TaskLogic.repeatLabels[task.repeat]) problems.push(where + ' has an unknown repeat rule.');
      if (task.subtasks !== undefined && (!Array.isArray(task.subtasks) || task.subtasks.some(item => typeof item?.title !== 'string'))) problems.push(where + ' has invalid subtasks.');
      if (task.notes !== undefined && typeof task.notes !== 'string') problems.push(where + ': its notes are not text.');
      for (const flag of ['evening', 'someday']) if (task[flag] !== undefined && typeof task[flag] !== 'boolean') problems.push(where + ' has an invalid “' + flag + '” value.');
      if (task.title !== undefined && typeof task.title !== 'string') problems.push(where + ' has a title that is not text.');
      return clean;
    }).filter(Boolean);
    // A backup from before list IDs is upgraded on import; one from after must have a name for every list.
    if (ws.schema >= 2) problems.push(...Projects.check({...ws, projects, tasks}).map(problem => 'Lists: ' + problem));
    const workspace = {...ws, projects, tasks};
    return {problems, workspace, summary: {
      lists: projects.length, tasks: tasks.length, open: tasks.filter(task => !task.done).length,
      notes: tasks.filter(task => task.notes).length, subtasks: tasks.filter(task => task.subtasks?.length).length,
      repeating: tasks.filter(task => task.repeat).length, multiDay: tasks.filter(task => task.plannedDates?.length > 1).length,
      deadlines: tasks.filter(task => task.dueDate).length, exportedAt: object.exportedAt || ''
    }};
  }

  async function exportFile() {
    const text = JSON.stringify(build(), null, 2);
    const path = await native('exportBackup', {text, name: 'Shishi Backup ' + day() + '.json'});
    if (path) toast('Backup saved: ' + data.tasks.length + ' tasks in ' + data.projects.length + ' lists');
  }

  const count = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  async function importFile() {
    const file = await native('importBackup');
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(file.text); } catch { parsed = null; }
    const result = parsed ? validate(parsed) : {problems: ['The file is not valid JSON.']};
    const s = result.summary;
    dialog('Import Backup', (result.problems.length
      ? '<p class="feedback">Shishi cannot import this file. Nothing was changed.</p><ul class="import-problems">' + result.problems.slice(0, 8).map(problem => '<li>' + esc(problem) + '</li>').join('') + '</ul>' +
        '<div class="actions"><button type="button" class="primary" data-close>Close</button></div>'
      : '<p class="hint">' + esc(file.name) + (s.exportedAt ? ' · saved ' + esc(new Date(s.exportedAt).toLocaleString('en-US')) : '') + '</p>' +
        '<div class="stat-grid"><div class="stat"><b>' + s.tasks + '</b><span>Tasks</span></div><div class="stat"><b>' + s.open + '</b><span>Open</span></div>' +
        '<div class="stat"><b>' + s.lists + '</b><span>Lists</span></div><div class="stat"><b>' + s.notes + '</b><span>With notes</span></div></div>' +
        '<p class="hint">Also: ' + [count(s.subtasks, 'task') + ' with subtasks', count(s.repeating, 'repeating task'), count(s.multiDay, 'multi-day task'), count(s.deadlines, 'deadline')].join(', ') + '.</p>' +
        (s.tasks ? '' : '<p class="feedback">This backup has no tasks. Importing it removes all ' + data.tasks.length + ' of your current tasks.</p>') +
        '<p class="hint">Importing replaces your current ' + count(data.tasks.length, 'task') + ' in ' + count(data.projects.length, 'list') + '. A copy of your current data is saved first, and you can undo right after.</p>' +
        '<p class="feedback" id="importProblem" role="alert"></p>' +
        '<div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button type="button" class="primary" id="confirmImport">' +
        (s.tasks ? 'Replace My Data' : 'Replace with Empty Backup') + '</button></div>'));
    if (!result.problems.length) $('confirmImport').onclick = () => {
      $('confirmImport').disabled = true;
      replace(result.workspace).catch(error => {
        // Nothing was replaced: say why, keep the sheet open (UX-N02).
        if ($('importProblem')) $('importProblem').textContent = error.message;
        if ($('confirmImport')) $('confirmImport').disabled = false;
      });
    };
  }

  async function replace(incoming) {
    const upgraded = Projects.migrate(incoming);
    if (upgraded.problems.length) throw Error('Not imported: ' + upgraded.problems[0] + ' Nothing was changed.');
    const workspace = upgraded.workspace;
    const previous = structuredClone(data);
    // No safety copy, no import: the current data stays exactly as it is (UX-N02).
    let snapshot = '';
    try { snapshot = await native('snapshotWorkspace'); }
    catch (error) { throw Error('Not imported: Shishi could not save a copy of your current data first (' + error.message + '). Nothing was changed.'); }
    await change(state => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, structuredClone(workspace)); });
    closeDialog(true);
    toast('Imported ' + count(workspace.tasks.length, 'task') + (snapshot ? '. Your previous data was saved as a copy.' : '.'), () => action(change(state => {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, previous);
    }).then(() => toast('Import undone'))));
  }

  return {build, validate, exportFile, importFile};
})();
