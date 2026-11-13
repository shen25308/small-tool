'use strict';
// Tasks and coding agents, linked. "Send to Claude Code" starts Claude Code in the list's project folder with the
// task as the prompt. The session carries the task's ID (SHISHI_TASK), so its live state shows on the task row, its
// report attaches to the task, the time it worked adds up, and checking the task off clears the report.
// Codex has no hooks, so a Codex run is started but cannot be linked back.
window.AgentTasks = (() => {
  const names = {claude: 'Claude Code', codex: 'Codex'};
  const MAX_RUN = 12 * 3600;

  const shortPath = path => String(path || '').replace(/^\/Users\/[^/]+/, '~');

  function prompt(task) {
    const lines = [task.title];
    if (task.notes) lines.push('', task.notes);
    const open = (task.subtasks || []).filter(item => !item.done);
    if (open.length) lines.push('', 'Steps:', ...open.map(item => '- ' + item.title));
    if (task.dueDate) lines.push('', 'Deadline: ' + task.dueDate + (task.dueTime ? ' ' + task.dueTime : ''));
    return lines.join('\n');
  }

  async function chooseFolder(list) {
    const path = await native('chooseFolder');
    if (!path) return '';
    await change(state => { state.projectFolders = {...state.projectFolders, [list]: path}; });
    toast('Agents for “' + projectLabel(list) + '” start in ' + shortPath(path));
    return path;
  }

  async function send(task, agent = 'claude') {
    let folder = data.projectFolders?.[task.project];
    if (!folder) folder = await chooseFolder(task.project);
    if (!folder) return;
    const used = await native('startAgent', {agent, folder, prompt: prompt(task), task: task.id, terminal: data.agentTerminal || 'Terminal'});
    await change(state => {
      const item = state.tasks.find(entry => entry.id === task.id);
      if (item) item.agentStarted = {agent, at: stampNow()};
    });
    toast(names[agent] + ' started in ' + used + ' for “' + task.title + '”' + (agent === 'codex' ? '. Codex runs are not linked back to the task.' : ''));
  }

  // A finished linked session: remember its report and add the time it worked, once per reply.
  function link(rows) {
    const finished = rows.filter(row => row.shishiTask && row.state === 'done' && row.receipt);
    const pending = finished.filter(row => {
      const task = data.tasks.find(item => item.id === row.shishiTask);
      return task && !(task.agentRuns || []).some(run => run.receipt === row.receipt);
    });
    if (!pending.length) return;
    action(change(state => {
      for (const row of pending) {
        const task = state.tasks.find(item => item.id === row.shishiTask);
        if (!task || (task.agentRuns || []).some(run => run.receipt === row.receipt)) continue;
        const seconds = row.started > 0 ? Math.max(0, Math.min(MAX_RUN, Math.round(row.time - row.started))) : 0;
        task.agentRuns = [...(task.agentRuns || []), {receipt: row.receipt, seconds, day: day(), agent: row.source}].slice(-50);
        task.agentReceipt = row.receipt;
      }
    }));
  }

  const minutes = seconds => Math.max(1, Math.round(seconds / 60));
  const totalSeconds = task => (task.agentRuns || []).reduce((sum, run) => sum + (run.seconds || 0), 0);

  // What the task row shows: a live state, or the verdict of the latest linked report.
  function status(task) {
    const live = (typeof agentEntries === 'function' ? agentEntries() : []).find(entry => entry.shishiTask === task.id && entry.state !== 'done');
    if (live) {
      const word = live.state === 'attention' ? 'needs you' : live.ended ? 'stopped' : 'working';
      return {text: live.source + ' ' + word, tone: live.state === 'attention' ? 'blocked' : 'working', title: live.activity || live.detail || ''};
    }
    if (!task.agentReceipt) return null;
    const note = allNotices().find(item => item.id === task.agentReceipt);
    const verdict = note && window.AgentReport ? AgentReport.brief(note, window.agentForNotice?.(note.id) || {}) : null;
    const time = totalSeconds(task) ? ' · ' + minutes(totalSeconds(task)) + ' min' : '';
    return verdict ? {text: verdict.label + time, tone: verdict.tone, title: 'Latest report from ' + (note.source || 'the agent')} : null;
  }

  function closeReport(task) {
    const note = allNotices().find(item => item.id === task.agentReceipt);
    if (note && !note.read) action(Promise.resolve(window.setNoticeState(note, {read: true})));
  }

  // Details: the folder, the runs so far, and buttons to start an agent.
  function detailsMarkup(task) {
    const folder = data.projectFolders?.[task.project];
    const runs = task.agentRuns || [];
    const note = task.agentReceipt && allNotices().find(item => item.id === task.agentReceipt);
    return '<div class="agent-task" id="agentTask"><div class="agent-task-line">' + symbol('i-terminal') +
      '<span>' + (runs.length ? esc('Agents worked ' + minutes(totalSeconds(task)) + ' min over ' + runs.length + (runs.length === 1 ? ' run' : ' runs')) : 'No agent has worked on this yet') +
      ' · ' + (folder ? 'in ' + esc(shortPath(folder)) : 'no project folder for this list') + '</span>' +
      '<button type="button" class="mini-link" data-agent-folder>' + (folder ? 'Change' : 'Choose') + '</button></div>' +
      '<div class="agent-task-actions">' + (note ? '<button type="button" class="mini-link" data-agent-report>Open the latest report</button>' : '') +
      '<span class="spacer"></span><button type="button" class="mini-link" data-agent-send="codex">Send to Codex</button>' +
      '<button type="button" class="secondary agent-send" data-agent-send="claude">' + symbol('i-terminal') + 'Send to Claude Code</button></div></div>';
  }

  function bindDetails(task, flush) {
    const box = document.getElementById('agentTask');
    if (!box) return;
    box.onclick = event => {
      if (event.target.closest('[data-agent-folder]')) { action(chooseFolder(task.project).then(path => { if (path) taskForm(data.tasks.find(item => item.id === task.id)); })); return; }
      if (event.target.closest('[data-agent-report]')) { openNotice(task.agentReceipt, {original: true}); return; }
      const send_ = event.target.closest('[data-agent-send]');
      if (send_) { flush?.(); action(send(data.tasks.find(item => item.id === task.id) || task, send_.dataset.agentSend)); }
    };
  }

  function minutesOn(date) {
    return Math.round(data.tasks.reduce((sum, task) => sum + (task.agentRuns || []).filter(run => run.day === date).reduce((s, run) => s + (run.seconds || 0), 0), 0) / 60);
  }

  return {send, chooseFolder, link, status, closeReport, detailsMarkup, bindDetails, prompt, shortPath, minutesOn};
})();
