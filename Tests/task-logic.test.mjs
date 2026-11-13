import test from 'node:test';
import assert from 'node:assert/strict';
import '../UI/task-logic.js';
import '../UI/notion-sync.js';

const {parse, nextRepeat, addDays, addMonths} = globalThis.TaskLogic;
const {plan, settle, fromNotionDate, toNotionDate} = globalThis.NotionSync;
// 2026-11-11 is a Wednesday.
const context = {today: '2026-11-11', projects: ['AI Task List', 'Personal'], tags: ['Design', 'This week']};
const q = text => parse(text, context);
const withoutParts = ({parts, ...rest}) => rest;

test('plain text stays a title', () => {
  assert.deepEqual(withoutParts(q('  Buy   milk ')), {title: 'Buy milk', planned: '', dueDate: '', dueTime: '', priority: '', tag: '', project: '', repeat: ''});
  assert.equal(q('Email sam@example.com about #1 priority').title, 'Email sam@example.com about #1 priority');
});

test('dates schedule the task', () => {
  assert.equal(q('Call Sam today').planned, '2026-11-11');
  assert.equal(q('Call Sam tomorrow').planned, '2026-11-12');
  assert.equal(q('Call Sam friday').planned, '2026-11-13');
  assert.equal(q('Call Sam wed').planned, '2026-11-18');
  assert.equal(q('Call Sam next friday').planned, '2026-11-20');
  assert.equal(q('Call Sam next monday').planned, '2026-11-16');
  assert.equal(q('Plan offsite next week').planned, '2026-11-16');
  assert.equal(q('Follow up in 3 days').planned, '2026-11-14');
  assert.equal(q('Follow up in 2 weeks').planned, '2026-11-25');
  assert.equal(q('Renew domain Dec 3').planned, '2026-12-03');
  assert.equal(q('File taxes march 15th').planned, '2027-03-15');
  assert.equal(q('Party 11/20').planned, '2026-11-20');
  assert.equal(q('Party 2/30').planned, '');
  assert.equal(q('Call Sam tomorrow').title, 'Call Sam');
});

test('times and "by" set a deadline', () => {
  const timed = q('Send report friday 3pm');
  assert.deepEqual([timed.title, timed.planned, timed.dueDate, timed.dueTime], ['Send report', '2026-11-13', '2026-11-13', '15:00']);
  assert.deepEqual([q('Standup at 9:30').dueDate, q('Standup at 9:30').dueTime], ['2026-11-11', '09:30']);
  assert.equal(q('Lunch 12pm').dueTime, '12:00');
  assert.equal(q('Deploy 12:30 am tomorrow').dueTime, '00:30');
  assert.equal(q('Review at noon').dueTime, '12:00');
  const due = q('Submit expenses by friday');
  assert.deepEqual([due.title, due.planned, due.dueDate, due.dueTime], ['Submit expenses', '', '2026-11-13', '']);
  assert.equal(q('Watch the game tonight').dueTime, '20:00');
  assert.equal(q('Fix bug 25:99').dueTime, '');
});

test('priority, tag, project and repeat', () => {
  const full = q('Write spec tomorrow #design !p1 @ai every week');
  assert.deepEqual(withoutParts(full), {title: 'Write spec', planned: '2026-11-12', dueDate: '', dueTime: '', priority: 'P1', tag: 'Design', project: 'AI Task List', repeat: 'weekly'});
  assert.equal(q('Ship it !!!').priority, 'P0');
  assert.equal(q('Ship it !high').priority, 'P0');
  assert.equal(q('Ship it !low').priority, 'P2');
  assert.equal(q('Plan #this-week').tag, 'This week');
  assert.equal(q('Plan #Brand-new').tag, 'Brand-new');
  assert.equal(q('Ping @nobody').title, 'Ping @nobody');
  assert.equal(q('Water plants daily').repeat, 'daily');
  assert.equal(q('Standup every weekday').repeat, 'weekdays');
  assert.equal(q('Pay rent monthly').repeat, 'monthly');
});

test('repeat dates', () => {
  assert.equal(nextRepeat('2026-11-11', 'daily', '2026-11-11'), '2026-11-12');
  assert.equal(nextRepeat('2026-11-01', 'daily', '2026-11-11'), '2026-11-12');
  assert.equal(nextRepeat('2026-11-13', 'weekdays', '2026-11-13'), '2026-11-16');
  assert.equal(nextRepeat('2026-11-04', 'weekly', '2026-11-11'), '2026-11-18');
  assert.equal(nextRepeat('2026-01-31', 'monthly', '2026-01-31'), '2026-02-28');
  assert.equal(nextRepeat('', 'weekly', '2026-11-11'), '2026-11-18');
  assert.equal(nextRepeat('2024-02-29', 'yearly', '2024-03-01'), '2025-02-28');
  assert.equal(nextRepeat('2026-11-11', 'nonsense', '2026-11-11'), '');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addMonths('2026-10-31', 1), '2026-11-30');
});

const mapping = {title: 'Name', done: {name: 'Done', type: 'checkbox'}, due: 'Due', priority: {name: 'Priority', options: []}, tag: {name: 'Tags', type: 'multi_select'}};
const base = (id, title, extra = {}) => ({id, title, project: 'Notion', tag: '', priority: 'P2', planned: '', source: '', quote: '', done: false, ...extra});
const page = (id, title, extra = {}) => ({id, url: '', edited: 'e1', title, done: false, due: '', priority: '', tag: '', ...extra});
let serial = 0;
const options = extra => ({mapping, project: 'Notion', truncated: false, newId: () => 'new-' + (++serial), stamp: '2026-11-11T10:00', ...extra});

test('notion dates round-trip in local time', () => {
  assert.deepEqual(fromNotionDate('2026-11-12'), {dueDate: '2026-11-12', dueTime: ''});
  assert.deepEqual(fromNotionDate(''), {dueDate: '', dueTime: ''});
  const stamped = toNotionDate('2026-11-12', '15:00');
  assert.match(stamped, /^2026-11-12T15:00:00[+-]\d{2}:\d{2}$/);
  assert.deepEqual(fromNotionDate(stamped), {dueDate: '2026-11-12', dueTime: '15:00'});
  assert.equal(toNotionDate('2026-11-12', ''), '2026-11-12');
});

test('first sync imports open pages and sends local tasks', () => {
  const tasks = [base('t1', 'Local only', {dueDate: '2026-11-20', priority: 'P0', tag: 'Design'}), base('t2', 'Elsewhere', {project: 'Personal'})];
  const pages = [page('p1', 'From Notion', {due: '2026-11-15', priority: 'P1', tag: 'Ops'}), page('p2', 'Old finished', {done: true}), page('p3', '')];
  const result = plan(tasks, pages, options());
  assert.deepEqual(result.stats, {imported: 1, updated: 0, sent: 0, missing: 0});
  const imported = tasks.find(task => task.notion?.id === 'p1');
  assert.deepEqual([imported.title, imported.project, imported.dueDate, imported.priority, imported.tag, imported.done], ['From Notion', 'Notion', '2026-11-15', 'P1', 'Ops', false]);
  assert.deepEqual(result.changes, [{task: 't1', page: '', fields: {title: 'Local only', done: false, due: '2026-11-20', priority: 'P0', tag: 'Design'}}]);
  const outcome = settle(tasks, [{task: 't1', ok: true, page: page('p9', 'Local only', {edited: 'e2'})}], mapping);
  assert.deepEqual(outcome, {sent: 1, failed: ''});
  assert.equal(tasks[0].notion.id, 'p9');
  // A second sync with matching pages changes nothing.
  const again = plan(tasks, [page('p1', 'From Notion', {due: '2026-11-15', priority: 'P1', tag: 'Ops'}), page('p9', 'Local only', {due: '2026-11-20', priority: 'P0', tag: 'Design', edited: 'e2'})], options());
  assert.deepEqual([again.changes, again.stats.imported, again.stats.updated], [[], 0, 0]);
});

test('later syncs move changes in the right direction', () => {
  const synced = (id, pageId, title, extra = {}) => {
    const task = base(id, title, extra);
    task.notion = {id: pageId, edited: 'e1', sig: JSON.stringify(globalThis.NotionSync.taskFields(task, mapping))};
    return task;
  };
  const localEdit = synced('a', 'pa', 'Draft'), remoteEdit = synced('b', 'pb', 'Review'), both = synced('c', 'pc', 'Plan'), gone = synced('d', 'pd', 'Removed');
  localEdit.done = true; localEdit.title = 'Draft v2';
  both.title = 'Plan (mine)';
  const pages = [page('pa', 'Draft'), page('pb', 'Review', {done: true, edited: 'e2'}), page('pc', 'Plan (theirs)', {edited: 'e2'})];
  const tasks = [localEdit, remoteEdit, both, gone];
  const result = plan(tasks, pages, options());
  assert.deepEqual(result.changes, [{task: 'a', page: 'pa', fields: {title: 'Draft v2', done: true}}]);
  assert.deepEqual([remoteEdit.done, remoteEdit.completedAt], [true, '2026-11-11T10:00']);
  assert.equal(both.title, 'Plan (theirs)');
  assert.equal(gone.notion.gone, true);
  assert.deepEqual(result.stats, {imported: 0, updated: 2, sent: 0, missing: 1});
  // A deleted page is not created again, and an incomplete pull never marks pages as deleted.
  assert.deepEqual(plan(tasks, pages, options()).changes.map(change => change.task), ['a']);
  const partial = [synced('e', 'pe', 'Keep')];
  plan(partial, [], options({truncated: true}));
  assert.equal(partial[0].notion.gone, undefined);
});

test('failed changes are reported and retried', () => {
  const tasks = [base('t1', 'Local only')];
  const {changes} = plan(tasks, [], options());
  const outcome = settle(tasks, [{task: 't1', ok: false, error: 'Notion did not accept this change.'}], mapping);
  assert.deepEqual(outcome, {sent: 0, failed: 'Notion did not accept this change.'});
  assert.equal(tasks[0].notion, undefined);
  assert.equal(plan(tasks, [], options()).changes.length, changes.length);
});

// F10: ordinary reference numbers stay text; every recognized piece can be turned back into text.
test('reference numbers, escapes and keep-as-text', () => {
  const r = q('Review invoice #123 and meeting @10am');
  assert.deepEqual([r.title, r.tag, r.project, r.parts], ['Review invoice #123 and meeting @10am', '', '', []]);
  assert.equal(q('Email \\#design team').title, 'Email #design team');
  assert.equal(q('Email \\#design team').tag, '');
  assert.equal(q('Ping \\@ai later').title, 'Ping @ai later');
  const full = parse('Call bank tomorrow 3pm #Design !p1', {...context, ignore: ['date', 'time']});
  assert.deepEqual([full.title, full.planned, full.dueTime, full.tag, full.priority], ['Call bank tomorrow 3pm', '', '', 'Design', 'P1']);
  assert.deepEqual(q('Write spec tomorrow #design !p1').parts.map(part => part.kind + ':' + part.text), ['priority:!p1', 'tag:#design', 'date:tomorrow']);
});

// F14: Chinese dates and times, with the same chips.
test('Chinese dates and times', () => {
  const cases = {
    '明天下午3点给Maya发报告': ['给Maya发报告', '2026-11-12', '2026-11-12', '15:00'],
    '周五前提交报销': ['提交报销', '', '2026-11-13', ''],
    '截止周五 提交报销': ['提交报销', '', '2026-11-13', ''],
    '下周一 开会': ['开会', '2026-11-16', '', ''],
    '星期三 复盘': ['复盘', '2026-11-18', '', ''],
    '11月20日 交房租': ['交房租', '2026-11-20', '', ''],
    '十一月二十号 交房租': ['交房租', '2026-11-20', '', ''],
    '3月5号 体检': ['体检', '2027-03-05', '', ''],
    '今晚8点半 健身': ['健身', '2026-11-11', '2026-11-11', '20:30'],
    '今晚 健身': ['健身', '2026-11-11', '2026-11-11', '20:00'],
    '上午9:30 晨会': ['晨会', '2026-11-11', '2026-11-11', '09:30'],
    '明天10点15分 面试': ['面试', '2026-11-12', '2026-11-12', '10:15'],
    '后天 搬家': ['搬家', '2026-11-13', '', ''],
    '3天后 跟进客户': ['跟进客户', '2026-11-14', '', ''],
  };
  for (const [text, expected] of Object.entries(cases)) {
    const r = q(text);
    assert.deepEqual([r.title, r.planned, r.dueDate, r.dueTime], expected, text);
  }
  assert.equal(q('每周 写周报').repeat, 'weekly');
  assert.equal(q('每个工作日 站会').repeat, 'weekdays');
  assert.deepEqual(q('准备材料 #设计 !p1').tag, '设计');
  // Mixed English and Chinese.
  const mixed = q('Send the deck 明天下午2点');
  assert.deepEqual([mixed.title, mixed.dueTime, mixed.planned], ['Send the deck', '14:00', '2026-11-12']);
  // A plain 9:30 stays with the English rules, which also remove "at".
  assert.equal(q('Standup at 9:30').title, 'Standup');
});

test('the same sync keeps a list in step with Apple Reminders', () => {
  const {plan, settle} = NotionSync;
  const mapping = {due: true, priority: true};
  const tasks = [
    {id: 'local', title: 'Buy stamps', project: 'Home', priority: 'P2', done: false},
    {id: 'linked', title: 'Call mum', project: 'Home', priority: 'P2', done: false, reminder: {id: 'R1', sig: JSON.stringify({title: 'Call mum', done: false, due: '', priority: 'P2'})}},
    {id: 'notion', title: 'Other', project: 'Home', priority: 'P2', done: false, notion: {id: 'N1'}}
  ];
  const reminders = [
    {id: 'R1', title: 'Call mum', done: true, due: '', priority: '', edited: 'e2'},
    {id: 'R2', title: 'Water plants', done: false, due: '2026-11-20T09:00:00+08:00', priority: 'P0', edited: 'e1'}
  ];
  let next = 0;
  const {changes, stats} = plan(tasks, reminders, {mapping, project: 'Home', newId: () => 'new' + ++next, stamp: 'now', linkKey: 'reminder'});
  assert.equal(tasks.find(t => t.id === 'linked').done, true, 'completed in Reminders');
  const imported = tasks.find(t => t.reminder?.id === 'R2');
  assert.equal(imported.title, 'Water plants');
  assert.equal(imported.priority, 'P0');
  assert.equal(stats.imported, 1);
  // Local tasks without a link are sent, including one linked only to Notion: each sync owns its own field.
  assert.deepEqual(changes.map(c => c.task).sort(), ['local', 'notion']);
  assert.equal(tasks.find(t => t.id === 'notion').notion.id, 'N1');
  settle(tasks, [{task: 'local', ok: true, page: {id: 'R3', edited: 'e3'}}], mapping, 'reminder');
  assert.equal(tasks.find(t => t.id === 'local').reminder.id, 'R3');
  assert.equal(tasks.find(t => t.id === 'local').notion, undefined);
});

test('GitHub issues become tasks and close with their issue', async () => {
  await import('../UI/issue-sync.js');
  const {plan: planIssues} = globalThis.IssueSync;
  const url = n => 'https://github.com/acme/app/issues/' + n;
  const tasks = [];
  let n = 0;
  const options = {project: 'Work', newId: () => 'i' + ++n, stamp: 'now'};
  const first = planIssues(tasks, [
    {number: 1, title: 'Crash on login', state: 'open', url: url(1)},
    {number: 2, title: 'Old bug', state: 'closed', url: url(2)}
  ], options);
  assert.equal(first.imported, 1, 'closed issues are not imported');
  assert.deepEqual([tasks[0].title, tasks[0].project, tasks[0].github.number], ['Crash on login', 'Work', 1]);
  // Renamed on GitHub follows; renamed in Shishi stays.
  planIssues(tasks, [{number: 1, title: 'Crash on login with SSO', state: 'open', url: url(1)}], options);
  assert.equal(tasks[0].title, 'Crash on login with SSO');
  tasks[0].title = 'Fix SSO crash (my words)';
  planIssues(tasks, [{number: 1, title: 'Crash on login (SSO)', state: 'open', url: url(1)}], options);
  assert.equal(tasks[0].title, 'Fix SSO crash (my words)');
  // Closing the issue completes the task; reopening it opens the task again; nothing is imported twice.
  const closed = planIssues(tasks, [{number: 1, title: 'Crash on login (SSO)', state: 'closed', url: url(1)}], options);
  assert.equal(closed.closed, 1);
  assert.equal(tasks[0].done, true);
  const reopened = planIssues(tasks, [{number: 1, title: 'Crash on login (SSO)', state: 'open', url: url(1)}], options);
  assert.equal(reopened.reopened, 1);
  assert.equal(tasks[0].done, false);
  assert.equal(tasks.length, 1);
});

test('saved filters: a small query language like Todoist', () => {
  const {filter} = globalThis.TaskLogic;
  const ctx = {today: '2026-11-13'};
  const tasks = [
    {id: 'a', title: 'Ship release', project: 'Work', tag: 'Launch', priority: 'P0', planned: '2026-11-13', done: false},
    {id: 'b', title: 'Pay rent', project: 'Home', tag: '', priority: 'P2', planned: '', dueDate: '2026-11-10', done: false},
    {id: 'c', title: 'Read book', project: 'Home', tag: 'Later', priority: 'P2', planned: '', done: false, someday: true},
    {id: 'd', title: 'Plan offsite', project: 'Work', tag: 'Launch', priority: 'P1', planned: '2026-11-18', done: false},
    {id: 'e', title: 'Old task', project: 'Work', tag: '', priority: 'P2', planned: '2026-11-01', done: true}
  ];
  const ids = query => tasks.filter(filter(query, ctx).test).map(task => task.id).join('');
  assert.equal(ids('today'), 'a');
  assert.equal(ids('overdue'), 'b');
  assert.equal(ids('(today | overdue) & !p2'), 'a');
  assert.equal(ids('@work & open'), 'ad');
  assert.equal(ids('#launch & next 7 days'), 'ad');
  assert.equal(ids('no date'), 'c', 'neither planned nor a deadline');
  assert.equal(ids('no date & !someday'), '');
  assert.equal(ids('someday'), 'c');
  assert.equal(ids('search: rent | p1'), 'bd');
  assert.equal(ids('done'), 'e');
  for (const bad of ['today &', '(today', 'today tomorrow', 'banana', '%']) {
    const result = filter(bad, ctx);
    assert.ok(result.error, bad + ' should explain the problem');
    assert.equal(tasks.filter(result.test).length, 0);
  }
});
