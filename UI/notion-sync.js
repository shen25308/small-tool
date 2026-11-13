'use strict';

// Decides what a Notion sync changes on each side. Pure functions: the caller does the network and saving.
(root => {
  const pad = number => String(number).padStart(2, '0');

  // Notion dates are "2026-11-12" or carry a time and zone. Tasks keep a local date and an optional local time.
  function fromNotionDate(start) {
    if (!start) return {dueDate: '', dueTime: ''};
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return {dueDate: start, dueTime: ''};
    const date = new Date(start);
    if (Number.isNaN(date.getTime())) return {dueDate: '', dueTime: ''};
    return {
      dueDate: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()),
      dueTime: pad(date.getHours()) + ':' + pad(date.getMinutes())
    };
  }
  function toNotionDate(dueDate, dueTime) {
    if (!dueDate) return '';
    if (!dueTime) return dueDate;
    const date = new Date(dueDate + 'T' + dueTime + ':00');
    if (Number.isNaN(date.getTime())) return dueDate;
    const offset = -date.getTimezoneOffset(), sign = offset < 0 ? '-' : '+', size = Math.abs(offset);
    return dueDate + 'T' + dueTime + ':00' + sign + pad(Math.floor(size / 60)) + ':' + pad(size % 60);
  }

  // Compare only the columns this database has. A page without a priority equals the default P2.
  function taskFields(task, mapping) {
    const fields = {title: task.title, done: !!task.done};
    if (mapping.due) fields.due = (task.dueDate || '') + (task.dueDate && task.dueTime ? ' ' + task.dueTime : '');
    if (mapping.priority) fields.priority = task.priority || 'P2';
    if (mapping.tag) fields.tag = task.tag || '';
    return fields;
  }
  function pageFields(page, mapping) {
    const fields = {title: page.title, done: !!page.done};
    if (mapping.due) { const due = fromNotionDate(page.due); fields.due = due.dueDate + (due.dueTime ? ' ' + due.dueTime : ''); }
    if (mapping.priority) fields.priority = page.priority || 'P2';
    if (mapping.tag) fields.tag = page.tag || '';
    return fields;
  }
  const signature = fields => JSON.stringify(fields);

  function outgoing(task, mapping, keys) {
    const local = taskFields(task, mapping), fields = {};
    for (const key of keys) {
      if (!(key in local)) continue;
      fields[key] = key === 'due' ? toNotionDate(task.dueDate, task.dueTime) : local[key];
    }
    return fields;
  }

  function adopt(task, page, mapping) {
    task.title = page.title;
    task.done = !!page.done;
    if (mapping.due) {
      const due = fromNotionDate(page.due);
      if (due.dueDate) task.dueDate = due.dueDate; else delete task.dueDate;
      if (due.dueTime) task.dueTime = due.dueTime; else delete task.dueTime;
    }
    if (mapping.priority && page.priority) task.priority = page.priority;
    if (mapping.tag) task.tag = page.tag || '';
  }

  /**
   * Updates `tasks` in place from the pulled pages and returns the changes to send to Notion.
   * When a task and its page both changed since the last sync, the Notion page wins.
   */
  function plan(tasks, pages, options) {
    // linkKey names the field that ties a task to its remote item: "notion" or "reminder" (Apple Reminders).
    const {mapping, project, truncated, newId, stamp, linkKey = 'notion'} = options;
    const byPage = new Map(pages.map(page => [page.id, page]));
    const linked = new Set();
    const changes = [];
    const stats = {imported: 0, updated: 0, sent: 0, missing: 0};
    for (const task of tasks) {
      const link = task[linkKey];
      if (!link?.id) continue;
      linked.add(link.id);
      const page = byPage.get(link.id);
      if (!page) {
        // The page was deleted or moved in Notion. Keep the local task and stop syncing it.
        if (!truncated && !link.gone) { link.gone = true; stats.missing++; }
        continue;
      }
      delete link.gone;
      const local = taskFields(task, mapping), remote = pageFields(page, mapping);
      const localSig = signature(local), remoteSig = signature(remote);
      if (localSig === remoteSig) { link.sig = localSig; link.edited = page.edited; continue; }
      if (remoteSig !== link.sig) {
        const wasDone = task.done;
        adopt(task, page, mapping);
        if (task.done && !wasDone) task.completedAt = stamp; else if (!task.done) delete task.completedAt;
        link.sig = signature(taskFields(task, mapping));
        link.edited = page.edited;
        stats.updated++;
      } else {
        const keys = Object.keys(local).filter(key => local[key] !== remote[key]);
        changes.push({task: task.id, page: link.id, fields: outgoing(task, mapping, keys)});
      }
    }
    for (const page of pages) {
      if (linked.has(page.id) || page.done || !page.title) continue;
      const task = {id: newId(), title: page.title, project, tag: '', priority: 'P2', planned: '', source: '', quote: '', done: false,
                    [linkKey]: {id: page.id, edited: page.edited}};
      adopt(task, page, mapping);
      task[linkKey].sig = signature(taskFields(task, mapping));
      tasks.push(task);
      stats.imported++;
    }
    for (const task of tasks) {
      if (task.project !== project || task[linkKey]?.id) continue;
      const keys = Object.keys(taskFields(task, mapping)).filter(key =>
        key === 'title' || key === 'done' || (key === 'due' && task.dueDate) || (key === 'priority' && task.priority && task.priority !== 'P2') || (key === 'tag' && task.tag));
      changes.push({task: task.id, page: '', fields: outgoing(task, mapping, keys)});
    }
    return {changes, stats};
  }

  // Record what Notion accepted so the next sync sees those tasks as unchanged.
  function settle(tasks, results, mapping, linkKey = 'notion') {
    let sent = 0, failed = '';
    for (const result of results || []) {
      const task = tasks.find(item => item.id === result.task);
      if (!result.ok) { failed = failed || result.error || 'A change was not accepted.'; continue; }
      if (!task || !result.page?.id) continue;
      task[linkKey] = {id: result.page.id, edited: result.page.edited, sig: signature(taskFields(task, mapping))};
      sent++;
    }
    return {sent, failed};
  }

  root.NotionSync = {plan, settle, fromNotionDate, toNotionDate, taskFields, pageFields};
})(typeof window === 'undefined' ? globalThis : window);
