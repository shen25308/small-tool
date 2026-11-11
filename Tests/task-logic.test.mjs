import test from 'node:test';
import assert from 'node:assert/strict';
import '../UI/task-logic.js';
import '../UI/notion-sync.js';

const {parse, nextRepeat, addDays, addMonths} = globalThis.TaskLogic;
const {plan, settle, fromNotionDate, toNotionDate} = globalThis.NotionSync;
// 2026-11-11 is a Wednesday.
const context = {today: '2026-11-11', projects: ['AI Task List', 'Personal'], tags: ['Design', 'This week']};
const q = text => parse(text, context);

test('plain text stays a title', () => {
  assert.deepEqual(q('  Buy   milk '), {title: 'Buy milk', planned: '', dueDate: '', dueTime: '', priority: '', tag: '', project: '', repeat: ''});
  assert.equal(q('Email sam@example.com about #1 priority').title, 'Email sam@example.com about #1 priority'.replace(' #1', ''));
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
  assert.deepEqual(full, {title: 'Write spec', planned: '2026-11-12', dueDate: '', dueTime: '', priority: 'P1', tag: 'Design', project: 'AI Task List', repeat: 'weekly'});
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
