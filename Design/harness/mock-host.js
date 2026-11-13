// Stand-in for the native host so the UI can render in a headless browser.
// Injected before the page scripts; never shipped inside the app bundle.
(() => {
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const iso = (offset = 0) => { const x = new Date(d); x.setDate(x.getDate() + offset); return [x.getFullYear(), pad(x.getMonth() + 1), pad(x.getDate())].join('-'); };
  const today = iso(), task = (title, project, priority, tag, extra = {}) => ({id: crypto.randomUUID(), title, project, priority, tag, planned: '', done: false, source: '', quote: '', ...extra});
  const state = window.__shishiState || {version: 1, projects: ['AI Task List', 'Research notes', 'Product ideas', 'Personal'], labels: [], tasks: [
    task('Draft the product brief', 'AI Task List', 'P0', 'Product insights', {planned: today, done: true}),
    task('Organize the review notes', 'AI Task List', 'P0', 'Today', {planned: today, dueDate: iso(-1), dueTime: '15:00'}),
    task('Send the release checklist', 'AI Task List', 'P1', 'This week', {planned: today, done: true, dueDate: iso(1), dueTime: '15:00'}),
    task('Review the product roadmap', 'Product ideas', 'P2', 'Leadership', {planned: today}),
    task('Reconcile the onboarding interview transcripts with the survey export before the research sync on Thursday', 'Research notes', 'P1', 'Feedback', {planned: today, dueDate: iso(2)}),
    task('整理用户访谈纪要，并把关键结论同步给产品和设计团队', 'Research notes', 'P2', '本周', {planned: today}),
    task('Polish the task template', 'AI Task List', 'P2', '', {planned: today}),
    task('Outline the inbox flow', 'AI Task List', 'P0', 'Product insights', {done: true}),
    task('Build the AI task list', 'AI Task List', 'P0', 'This week'),
    task('Review the prototype', 'AI Task List', 'P1', 'Today', {planned: iso(3)}),
    task('Connect local results', 'AI Task List', 'P1', 'Leadership'),
    task('Draft release notes', 'AI Task List', 'P1', 'Later'),
    task('Read the pricing teardown', 'Research notes', 'P2', 'Later'),
    task('Sketch the onboarding empty states', 'Product ideas', 'P1', 'Urgent'),
    task('Renew the passport', 'Personal', 'P2', 'Long-term', {dueDate: iso(20)})
  ]};
  const now = Date.now() / 1000;
  const codex = window.__shishiCodex || [
    {id: 'c1/t3', thread: '0b0e8a3e-3f52-4d0e-9d39-4c9f6a1d7a10', title: 'Fix the flaky reminder test', read: false, time: now - 240,
      summary: 'I updated `Reminders/Scheduler.swift` so a due task schedules exactly one notification.\n\n**Verification**\n- All 42 tests passed locally after the change.\n- I could not run the UI tests because the simulator needs your approval to start.\n\nNext step: confirm whether the reminder should repeat after a restart.'},
    {id: 'c1/t2', thread: '0b0e8a3e-3f52-4d0e-9d39-4c9f6a1d7a10', title: 'Update the weekly template', read: false, time: now - 3600,
      summary: 'Added owner and due date columns to weekly-update.md.\n\n- Verified both existing rows.\n- The new cells are blank so the team can fill them in.'},
    {id: 'c1/t1', thread: '0b0e8a3e-3f52-4d0e-9d39-4c9f6a1d7a10', title: '整理发布说明', read: true, time: now - 9000,
      summary: '已更新 `docs/release-notes.md`，补充了 1.6 版本的收件箱与桌面结果面板说明。\n\n- 构建与全部测试已通过。\n- 截图仍需要你确认是否使用深色外观。'}
  ];
  const connector = window.__shishiConnector || [
    {id: 'gh/1', source: 'GitHub Actions', title: 'CI · Succeeded', summary: 'shen25308/small-tool · CI\nResult: Succeeded\nBranch: main\nRun #128, attempt 1', time: now - 1500, read: false, thread: '', link: 'https://github.com/'},
    {id: 'gh/2', source: 'GitHub Actions', title: 'Desktop preview build · Failed', summary: 'shen25308/small-tool · Desktop preview build\nResult: Failed\nBranch: release/1.6\nRun #127, attempt 2', time: now - 5200, read: true, thread: '', link: 'https://github.com/'},
    {id: 'gm/1', source: 'Gmail', title: 'Agenda for the design review', summary: 'From: Maya Chen <maya@example.com>\nReceived: Today 9:12 AM', time: now - 7000, read: true, thread: '', link: 'https://mail.google.com/'},
    {id: 'rm/1', source: 'Reminders', title: 'Organize the review notes', summary: 'Due yesterday at 3:00 PM', time: now - 12000, read: true, thread: '', link: ''}
  ];
  const calls = window.__hostCalls = [];
  const replies = {
    load: () => state, ready: () => true, save: m => { Object.assign(state, m.state); return true; },
    paste: () => '', compact: m => { window.setCompact(m.value); return true; }, latestSize: () => true,
    edgeVisibility: m => { window.setEdgeVisible(m.value); return true; }, edgeMailPreference: m => m.value ?? false,
    codexConnection: m => m.enabled ?? true, copyConnectorSetup: () => true, readNotice: () => true,
    syncInboxes: () => new Promise(r => setTimeout(() => r(true), window.__slowSync || 50)),
    extract: () => new Promise((resolve, reject) => setTimeout(() => window.__extractFails ? reject('The local model could not start. Restart Shishi and try again.') : resolve([
      {title: 'Send the new homepage prototype to the design team', tag: 'Design', quote: 'Maya: Please send the new homepage prototype to the design team before tomorrow afternoon’s review.'},
      {title: 'Summarize the customer feedback for the product team', tag: 'Feedback', quote: 'Maya: Also, summarize the customer feedback for the product team by Friday.'}]), window.__slowExtract || 50)),
    externalProvider: m => m.provider === 'github' ? {connected: true, repo: 'shen25308/small-tool', workflow: ''} : {accounts: [{id: 'a1', provider: 'gmail', email: 'maya@example.com', sender: '', state: 'connected'}], configuredDefault: true}
  };
  window.webkit = {messageHandlers: {
    host: {postMessage: m => { calls.push(m); if (window.__loadFails && m.op === 'load') { setTimeout(() => window.hostReply(m.id, false, 'The workspace file is damaged.')); return; }
      Promise.resolve().then(() => (replies[m.op] || (() => true))(m)).then(v => window.hostReply(m.id, true, v), e => window.hostReply(m.id, false, e)); }},
    edge: {postMessage: m => { calls.push(m); }}
  }};
  window.__feed = () => { if (window.setInbox) { window.setInbox({channel: 'codex', items: codex}); window.setInbox({channel: 'connector', items: connector}); }
    if (window.setEdgeInbox) window.setEdgeInbox({items: [...codex.map(n => ({...n, channel: 'codex'})), ...connector.map(n => ({...n, channel: 'connector'}))].sort((a, b) => b.time - a.time)}); };
  document.addEventListener('DOMContentLoaded', () => setTimeout(window.__feed, 30));
})();
