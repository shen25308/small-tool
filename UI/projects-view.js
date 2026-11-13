'use strict';
// Projects: every list as a project, grouped by area, with its goal, next deadline, folder and results
// (PROJECT-MODEL). A project's own page has three tabs: Tasks, Notes (free text, no checkbox) and Results.
window.ProjectsView = (() => {
  const openCount = id => data.tasks.filter(task => task.project === id && !task.done).length;
  const nextDeadline = id => data.tasks.filter(task => task.project === id && !task.done && task.dueDate).map(task => task.dueDate).sort()[0] || '';
  const results = id => allNotices().filter(note => !note.archived && InboxView.projectOf(note) === id);
  const info = id => data.lists?.[id] || {};

  function card(id) {
    const due = nextDeadline(id), folder = data.projectFolders?.[id], found = results(id).length, goal = info(id).goal;
    return '<button type="button" class="project-card" data-open-project="' + esc(id) + '"><span class="project-card-head"><span class="list-badge ' + projectTone(id) + '">' + symbol('i-list') + '</span>' +
      '<b>' + esc(projectLabel(id)) + '</b><span class="project-card-count">' + plural(openCount(id), 'open task') + '</span></span>' +
      (goal ? '<span class="project-card-goal">' + esc(goal) + '</span>' : '') +
      '<span class="project-card-meta">' + [due && 'Next deadline ' + dayLabel(due), found && plural(found, 'result'), folder && AgentTasks.shortPath(folder)].filter(Boolean).map(esc).join(' · ') + '</span></button>';
  }

  function renderOverview() {
    const box = $('altView');
    box.dataset.view = 'projects';
    $('pageTitle').textContent = 'Projects';
    const areas = data.areas || [];
    const loose = data.projects.filter(id => !info(id).area || !areas.some(area => area.id === info(id).area));
    const section = (title, ids, area) => '<section class="project-area"' + (area ? ' data-area="' + esc(area.id) + '"' : '') + '><div class="day-head"><h3>' + esc(title) + '</h3>' +
      (area ? '<button type="button" class="mini-link" data-rename-area="' + esc(area.id) + '">Rename</button>' : '') + '</div>' +
      (ids.length ? '<div class="project-grid">' + ids.map(card).join('') + '</div>' : '<p class="hint">No projects in this area yet.</p>') + '</section>';
    box.innerHTML = '<div class="alt-page"><header class="alt-head"><h1 id="altTitle">Projects</h1></header><div class="projects-view"><div class="projects-head"><p class="hint">Projects hold tasks, notes and the results agents deliver for them. Areas group projects, for example Work and Personal.</p>' +
      '<div class="actions"><button type="button" class="secondary" id="newArea">New Area</button><button type="button" class="primary" id="newProjectButton">New Project</button></div></div>' +
      (loose.length || !areas.length ? section(areas.length ? 'No area' : 'All projects', loose) : '') +
      areas.map(area => section(area.name, data.projects.filter(id => info(id).area === area.id), area)).join('') + '</div></div>';
    box.onclick = event => {
      const open = event.target.closest('[data-open-project]');
      if (open) { go('p:' + open.dataset.openProject); return; }
      if (event.target.closest('#newProjectButton')) { edit(); return; }
      if (event.target.closest('#newArea')) { areaForm(); return; }
      const rename = event.target.closest('[data-rename-area]');
      if (rename) areaForm(rename.dataset.renameArea);
    };
  }

  function areaForm(id) {
    const current = (data.areas || []).find(area => area.id === id);
    nameForm(current ? 'Rename Area' : 'New Area', 'Name', current?.name || '', current ? 'Rename' : 'Create', name => change(state => {
      state.areas = [...(state.areas || [])];
      if ((state.areas).some(area => area.id !== id && area.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw Error('An area with this name already exists.');
      if (current) state.areas = state.areas.map(area => area.id === id ? {...area, name} : area);
      else state.areas.push({id: 'a-' + uuid().replace(/-/g, '').slice(0, 10), name});
    }));
  }

  // New project, or a project's details: name, area, goal and folder.
  function edit(id) {
    const current = id ? info(id) : {};
    const areaOptions = '<option value="">No area</option>' + (data.areas || []).map(area => '<option value="' + esc(area.id) + '"' + (area.id === current.area ? ' selected' : '') + '>' + esc(area.name) + '</option>').join('');
    dialog(id ? 'Project Info' : 'New Project', '<form id="projectInfo"><label>Name<input id="projectInfoName" required maxlength="60" value="' + esc(id ? projectLabel(id) : '') + '"></label>' +
      '<label>Area<select id="projectInfoArea">' + areaOptions + '</select></label>' +
      '<label>Goal<input id="projectInfoGoal" maxlength="200" placeholder="What done looks like" value="' + esc(current.goal || '') + '"></label>' +
      '<p class="hint">Project folder: ' + (data.projectFolders?.[id] ? esc(AgentTasks.shortPath(data.projectFolders[id])) + ' · ' : '') + '<button type="button" class="mini-link" id="projectInfoFolder">' + (data.projectFolders?.[id] ? 'Change…' : 'Choose…') + '</button></p>' +
      '<p class="feedback" id="projectInfoProblem" role="alert"></p>' +
      '<div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">' + (id ? 'Save' : 'Create') + '</button></div></form>');
    let folder = '';
    $('projectInfoFolder').onclick = () => action(native('chooseFolder').then(path => { if (path) { folder = path; $('projectInfoFolder').textContent = AgentTasks.shortPath(path); } }));
    $('projectInfoName').focus();
    $('projectInfo').onsubmit = event => {
      event.preventDefault();
      const name = $('projectInfoName').value.trim(), area = $('projectInfoArea').value, goal = $('projectInfoGoal').value.trim();
      let made = id;
      change(state => {
        if (id) Projects.rename(state, id, name);
        else { if (Projects.byName(state, name)) throw Error('A project with this name already exists.'); made = Projects.create(state, name); }
        const next = {...state.lists[made]};
        if (area) next.area = area; else delete next.area;
        if (goal) next.goal = goal; else delete next.goal;
        state.lists[made] = next;
        if (folder) state.projectFolders = {...state.projectFolders, [made]: folder};
      }).then(() => { closeDialog(true); go('p:' + made); }, error => { $('projectInfoProblem').textContent = error.message; });
    };
  }

  // The tabs above a project's page. Notes save as you type and are flushed when you leave.
  let notesTimer = 0;
  function tabs(id) {
    const count = results(id).length;
    return '<div class="project-tabs menu-segment" role="tablist">' + [['tasks', 'Tasks'], ['notes', 'Notes'], ['results', 'Results' + (count ? ' (' + count + ')' : '')]].map(([key, label]) =>
      '<button type="button" role="tab" data-project-tab="' + key + '" aria-selected="' + (projectTab === key) + '">' + label + '</button>').join('') + '</div>' +
      (info(id).goal ? '<p class="project-goal">' + esc(info(id).goal) + '</p>' : '');
  }
  function notes(id) {
    return '<div class="project-notes"><textarea id="projectNotes" aria-label="Project notes" placeholder="Notes for this project: decisions, links, context. Not tasks, so no checkboxes.">' + esc(info(id).notes || '') + '</textarea>' +
      '<p class="hint" id="projectNotesState" aria-live="polite"></p></div>';
  }
  function resultList(id) {
    const list = results(id);
    return list.length ? '<div class="inbox-items project-results">' + list.slice(0, 100).map(note => '<button type="button" class="inbox-item' + (note.read ? '' : ' unread') + '" data-project-result="' + esc(note.id) + '">' +
      '<span class="inbox-item-top"><b>' + esc(ResultUI.sourceName(note)) + '</b><time>' + esc(inboxDate(note.time)) + '</time></span>' +
      '<span class="inbox-item-title">' + esc(ResultUI.digest(note).headline || note.title) + '</span></button>').join('') + '</div>'
      : emptyState('inbox', 'No results for this project yet. Results are matched by the project folder.');
  }
  function saveNotes(id, text) {
    clearTimeout(notesTimer);
    if ((info(id).notes || '') === text) return Promise.resolve();
    if ($('projectNotesState')) $('projectNotesState').textContent = 'Saving…';
    return change(state => { if (state.lists[id]) { state.lists[id] = {...state.lists[id]}; if (text) state.lists[id].notes = text; else delete state.lists[id].notes; } })
      .then(() => { if ($('projectNotesState')) $('projectNotesState').textContent = 'Saved'; }, error => { if ($('projectNotesState')) $('projectNotesState').textContent = 'Not saved: ' + error.message; });
  }
  function bind(id) {
    const area = $('projectNotes');
    if (area) {
      area.addEventListener('input', () => { clearTimeout(notesTimer); $('projectNotesState').textContent = 'Editing…'; notesTimer = setTimeout(() => saveNotes(id, area.value), 400); });
      area.addEventListener('blur', () => saveNotes(id, area.value));
    }
  }
  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (tab) {
      const area = $('projectNotes');
      const id = view.slice(2);
      Promise.resolve(area ? saveNotes(id, area.value) : null).then(() => { projectTab = tab.dataset.projectTab; render(); });
      return;
    }
    const result = event.target.closest('[data-project-result]');
    if (result) InboxView.open(result.dataset.projectResult);
  });

  return {render: renderOverview, edit, tabs, notes, resultList, bind, results, areaForm};
})();
