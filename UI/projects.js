'use strict';
// Lists (projects) have stable IDs. A task, a connection (Notion, Reminders, GitHub issues) and a project folder
// point at a list by its ID, so renaming a list never splits it and a sync never brings back an old name
// (PROJECT-MODEL, UX-N07). The workspace keeps `projects` as the ordered list of IDs, which older versions of
// Shishi and the native host still accept, and `lists` holds each list's name, area, goal and notes.
// Pure: the caller loads, snapshots and saves.
(root => {
  const SCHEMA = 2;
  const isId = value => typeof value === 'string' && /^l-[0-9a-z]{6,32}$/.test(value);
  const randomId = prefix => prefix + Array.from({length: 10}, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]).join('');

  // The upgrade from name lists. Returns {workspace, changed, problems}; the input is never modified.
  function migrate(input, newId = () => randomId('l-')) {
    const ws = structuredClone(input || {});
    if (ws.schema >= SCHEMA) return {workspace: repair(ws), changed: false, problems: check(ws)};
    const names = Array.isArray(ws.projects) ? ws.projects.filter(name => typeof name === 'string') : [];
    const ids = new Map();
    const lists = {};
    const add = name => {
      if (ids.has(name)) return ids.get(name);
      let id = newId();
      while (lists[id]) id = newId();
      ids.set(name, id);
      lists[id] = {name};
      return id;
    };
    names.forEach(add);
    const tasks = Array.isArray(ws.tasks) ? ws.tasks : [];
    // A task in a list that is missing from the list of lists keeps its list: it is added, never dropped.
    for (const task of tasks) if (task && typeof task === 'object') task.project = add(typeof task.project === 'string' ? task.project : names[0] || 'My Work');
    if (!ids.size) add('My Work');
    for (const key of ['notion', 'reminders', 'github']) {
      if (ws[key] && typeof ws[key].project === 'string') ws[key].project = add(ws[key].project);
    }
    if (ws.projectFolders && typeof ws.projectFolders === 'object') {
      ws.projectFolders = Object.fromEntries(Object.entries(ws.projectFolders).filter(([name]) => ids.has(name)).map(([name, path]) => [ids.get(name), path]));
    }
    ws.projects = [...ids.values()];
    ws.lists = {...(ws.lists && typeof ws.lists === 'object' ? ws.lists : {}), ...lists};
    if (!Array.isArray(ws.areas)) ws.areas = [];
    ws.schema = SCHEMA;
    const problems = check(ws);
    // Nothing a person entered may be lost: same tasks, same titles, every old list name still there.
    if (tasks.length !== (input?.tasks || []).length) problems.push('The number of tasks changed.');
    (input?.tasks || []).forEach((task, index) => { if (task?.id !== tasks[index]?.id || task?.title !== tasks[index]?.title) problems.push('A task changed during the upgrade.'); });
    for (const name of names) if (!ws.projects.some(id => ws.lists[id].name === name)) problems.push('The list “' + name + '” went missing.');
    return {workspace: ws, changed: true, problems};
  }

  // Every list in `projects` has a name; IDs are unique; every task's list exists.
  function check(ws) {
    const problems = [];
    const projects = Array.isArray(ws.projects) ? ws.projects : [];
    if (!projects.length) problems.push('There are no lists.');
    if (new Set(projects).size !== projects.length) problems.push('A list appears twice.');
    for (const id of projects) if (!ws.lists?.[id] || typeof ws.lists[id].name !== 'string') problems.push('A list has no name.');
    for (const task of ws.tasks || []) if (!projects.includes(task.project)) { problems.push('“' + String(task.title).slice(0, 40) + '” is in a list that does not exist.'); break; }
    return problems;
  }

  function repair(ws) {
    ws.lists = ws.lists && typeof ws.lists === 'object' ? ws.lists : {};
    for (const id of ws.projects || []) if (!ws.lists[id]) ws.lists[id] = {name: id};
    if (!Array.isArray(ws.areas)) ws.areas = [];
    return ws;
  }

  const name = (ws, id) => ws.lists?.[id]?.name ?? id;
  const byName = (ws, wanted) => {
    const lower = String(wanted || '').trim().toLocaleLowerCase();
    return (ws.projects || []).find(id => name(ws, id).toLocaleLowerCase() === lower) || null;
  };
  // Adds a list and returns its ID. A name that is taken gets a number, so two lists never share a name.
  function create(ws, wanted, fields = {}, newId = () => randomId('l-')) {
    let label = String(wanted || '').trim().slice(0, 60) || 'New List', n = 2;
    const base = label.slice(0, 54);
    while (byName(ws, label)) label = base + ' ' + n++;
    let id = newId();
    while (ws.lists?.[id]) id = newId();
    ws.lists = ws.lists || {};
    ws.lists[id] = {name: label, ...fields};
    ws.projects = [...(ws.projects || []), id];
    return id;
  }
  function rename(ws, id, next) {
    const label = String(next || '').trim().slice(0, 60);
    if (!label) throw Error('A list needs a name.');
    const other = byName(ws, label);
    if (other && other !== id) throw Error('A list with this name already exists.');
    ws.lists[id] = {...ws.lists[id], name: label};
  }
  // Removes a list. Its tasks move to `target` or are deleted; connections that used it follow the tasks,
  // or are turned off, so no later sync can bring the list back.
  function remove(ws, id, target) {
    ws.projects = ws.projects.filter(item => item !== id);
    if (target) ws.tasks.forEach(task => { if (task.project === id) task.project = target; });
    else ws.tasks = ws.tasks.filter(task => task.project !== id);
    const stopped = [];
    for (const key of ['notion', 'reminders', 'github']) {
      if (ws[key]?.project !== id) continue;
      if (target) ws[key].project = target;
      else { delete ws[key]; stopped.push(key); }
    }
    if (ws.projectFolders?.[id]) { if (target && !ws.projectFolders[target]) ws.projectFolders[target] = ws.projectFolders[id]; delete ws.projectFolders[id]; }
    delete ws.lists[id];
    return stopped;
  }
  // The list a connection syncs into. If it is gone (for example deleted in an older version), a list with the
  // connection's own name is made once, and the connection keeps pointing at that from then on.
  function ensure(ws, connection, fallbackName, newId) {
    if (connection.project && ws.projects.includes(connection.project)) return connection.project;
    const existing = !isId(connection.project) && byName(ws, connection.project);
    connection.project = existing || create(ws, isId(connection.project) ? fallbackName : connection.project || fallbackName, {}, newId);
    return connection.project;
  }

  root.Projects = {SCHEMA, migrate, check, name, byName, create, rename, remove, ensure, isId};
})(typeof window === 'undefined' ? globalThis : window);
