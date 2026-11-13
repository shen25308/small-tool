'use strict';
// Saved filters, like Todoist's filters and OmniFocus perspectives: a name and a query in a small language
// (TaskLogic.filter). They live in the sidebar under Filters and open as a list like any other.
window.Filters = (() => {
  const EXAMPLES = [
    ['Today and overdue', 'today | overdue'],
    ['High priority', '(p0 | p1) & open'],
    ['Next 7 days', 'next 7 days & open'],
    ['Agent work', 'agent & open'],
    ['No date yet', 'no date & !someday & open']
  ];
  const list = () => Array.isArray(data.filters) ? data.filters : [];
  const get = id => list().find(item => item.id === id) || null;
  const compile = query => TaskLogic.filter(query, {today: day(), listName: projectLabel});
  const matches = filterItem => { const {test} = compile(filterItem.query); return data.tasks.filter(task => test(task)); };

  function renderSidebar() {
    const box = document.getElementById('filters'), head = document.getElementById('filtersHead');
    if (!box) return;
    box.innerHTML = list().map(item => '<button data-view="f:' + esc(item.id) + '" data-filter="' + esc(item.id) + '" title="' + esc(item.query) + '"' +
      (view === 'f:' + item.id ? ' class="active" aria-current="page"' : '') + '><span class="filter-glyph" aria-hidden="true">' + symbol('i-filter') + '</span>' +
      '<span class="prname">' + esc(item.name) + '</span><span class="num">' + (matches(item).filter(task => !task.done).length || '') + '</span></button>').join('');
    if (head) head.querySelector('h2').textContent = 'Filters';
  }

  function form(existing = null) {
    dialog(existing ? 'Edit Filter' : 'New Filter', '<form id="filterForm">' +
      '<label>Name<input id="filterName" maxlength="40" required value="' + esc(existing?.name || '') + '" placeholder="High priority this week"></label>' +
      '<label>Show tasks that match<input id="filterQuery" maxlength="200" required autocomplete="off" spellcheck="false" value="' + esc(existing?.query || '') + '" placeholder="(p0 | p1) & next 7 days"></label>' +
      '<p class="feedback" id="filterPreview" role="status"></p>' +
      '<div class="filter-examples">' + EXAMPLES.map(([name, query]) => '<button type="button" class="chip-button" data-example="' + esc(query) + '" data-name="' + esc(name) + '">' + esc(name) + '</button>').join('') + '</div>' +
      '<p class="hint">Words: today, tomorrow, overdue, upcoming, next 7 days, no date, due, evening, someday, open, done, repeating, agent, p0, p1, p2, #tag, @list and search: words. ' +
      'Combine them with & (and), | (or), ! (not) and parentheses.</p>' +
      '<div class="actions">' + (existing ? '<button type="button" class="mini-link danger-link" id="deleteFilter">Delete Filter</button>' : '') +
      '<span class="spacer"></span><button type="button" class="secondary" data-close>Cancel</button><button class="primary">' + (existing ? 'Save' : 'Create') + '</button></div></form>');
    const query = $('filterQuery'), name = $('filterName');
    const preview = () => {
      const {test, error} = compile(query.value);
      const found = error ? [] : data.tasks.filter(task => test(task));
      $('filterPreview').textContent = !query.value.trim() ? 'Pick an example or type a query.' : error ||
        (found.filter(task => !task.done).length + ' open ' + (found.filter(task => !task.done).length === 1 ? 'task matches' : 'tasks match') +
         (found.some(task => task.done) ? ', plus ' + found.filter(task => task.done).length + ' completed' : '') + '.');
      $('filterPreview').classList.toggle('problem', !!error && !!query.value.trim());
    };
    query.oninput = preview;
    preview();
    (existing ? query : name).focus();
    document.querySelector('.filter-examples').onclick = event => {
      const example = event.target.closest('[data-example]');
      if (!example) return;
      query.value = example.dataset.example;
      if (!name.value.trim()) name.value = example.dataset.name;
      preview();
    };
    if ($('deleteFilter')) $('deleteFilter').onclick = () => remove(existing);
    $('filterForm').onsubmit = event => {
      event.preventDefault();
      const {error} = compile(query.value);
      if (error) { query.focus(); return; }
      const value = {id: existing?.id || uuid(), name: name.value.trim().slice(0, 40), query: query.value.trim().slice(0, 200)};
      if (!value.name) { name.focus(); return; }
      action(change(state => {
        state.filters = Array.isArray(state.filters) ? state.filters : [];
        const at = state.filters.findIndex(item => item.id === value.id);
        if (at >= 0) state.filters[at] = value; else state.filters.push(value);
      }).then(() => { closeDialog(true); go('f:' + value.id); }));
    };
  }

  function remove(item) {
    const index = list().findIndex(entry => entry.id === item.id);
    action(change(state => { state.filters = (state.filters || []).filter(entry => entry.id !== item.id); }).then(() => {
      closeDialog(true);
      if (view === 'f:' + item.id) go('all');
      toast('Filter deleted', () => action(change(state => {
        state.filters = Array.isArray(state.filters) ? state.filters : [];
        if (!state.filters.some(entry => entry.id === item.id)) state.filters.splice(Math.min(index, state.filters.length), 0, item);
      })));
    }));
  }

  document.addEventListener('contextmenu', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const item = get(button.dataset.filter);
    if (item) showMenu([
      {label: 'Edit Filter…', icon: 'i-pencil', run: () => form(item)},
      {label: 'Delete Filter', icon: 'i-trash', danger: true, run: () => remove(item)}
    ], {x: event.clientX, y: event.clientY});
  }, true);

  return {get, list, matches, renderSidebar, form, compile};
})();
document.getElementById('newFilter')?.addEventListener('click', () => Filters.form());
