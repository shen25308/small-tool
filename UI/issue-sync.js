'use strict';
// Turns a public repository's GitHub issues into tasks. Pure: the caller fetches and saves.
// Open issues become tasks in the chosen list; a task completes when its issue closes and reopens with it.
// A title edited in Shishi is kept; one edited only on GitHub follows GitHub.
(root => {
  function plan(tasks, issues, {project, newId, stamp}) {
    const byUrl = new Map(tasks.filter(task => task.github?.url).map(task => [task.github.url, task]));
    const stats = {imported: 0, closed: 0, reopened: 0, renamed: 0};
    for (const issue of issues) {
      const task = byUrl.get(issue.url);
      if (!task) {
        if (issue.state !== 'open') continue;
        tasks.push({id: newId(), title: issue.title, project, tag: '', priority: 'P2', planned: '', source: '', quote: '', done: false,
                    github: {url: issue.url, number: issue.number, state: 'open', title: issue.title}});
        stats.imported++;
        continue;
      }
      const link = task.github;
      if (issue.title !== link.title) {
        if (task.title === link.title) { task.title = issue.title; stats.renamed++; }
        link.title = issue.title;
      }
      if (issue.state === 'closed' && link.state !== 'closed') {
        link.state = 'closed';
        // Remember which completion was ours, so a reopen can tell it from one the person made (C04).
        if (!task.done) { task.done = true; task.completedAt = stamp; link.closedTask = stamp; stats.closed++; } else delete link.closedTask;
      } else if (issue.state === 'open' && link.state === 'closed') {
        link.state = 'open';
        // Reopen only a task that Shishi completed because the issue closed, and that nobody has completed again since.
        if (task.done && link.closedTask && task.completedAt === link.closedTask && !link.keepDone) {
          task.done = false; delete task.completedAt; stats.reopened++;
        }
        delete link.closedTask;
      }
    }
    return stats;
  }
  root.IssueSync = {plan};
})(typeof window === 'undefined' ? globalThis : window);
