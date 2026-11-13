// End-to-end checks of the UI against a stand-in host. Usage: node Tests/ui/check.mjs [screenshot-folder]
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch, open, sampleWorkspace} from './harness.mjs';

const shots = process.argv[2];
if (shots) mkdirSync(shots, {recursive: true});
const browser = await launch();
const results = [];
async function check(name, options, body) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const session = await open(browser, options);
  const {page} = session;
  const host = () => page.evaluate(() => window.__host);
  const tasks = async () => (await host()).workspace.tasks;
  const shot = async file => { if (shots) await page.screenshot({path: shots + '/' + file + '.png'}); };
  try {
    await body({page, host, tasks, shot});
    assert.deepEqual(session.problems, [], 'the page logged errors');
    results.push('ok   ' + name);
  } catch (error) {
    results.push('FAIL ' + name + '\n     ' + String(error.message).split('\n').slice(0, 6).join('\n     '));
    if (shots) await page.screenshot({path: shots + '/FAILED-' + name.replace(/\W+/g, '-') + '.png'}).catch(() => {});
  } finally { await session.context.close(); }
}
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const text = (page, selector) => page.locator(selector).first().innerText();

await check('today view and sidebar counts', {scale: 2}, async ({page, shot}) => {
  assert.equal(await text(page, '#pageTitle'), 'Today');
  assert.equal(await text(page, '#pageCount'), '5');
  assert.deepEqual(await page.locator('#nav .tile-count').allInnerTexts(), ['5', '6', '14', '4']);
  assert.equal(await page.locator('#tasks .row').count(), 6);
  assert.equal(await page.locator('#tasks .row.done').count(), 1);
  assert.equal(await page.locator('#agentList .agent-row').count(), 4);
  assert.match(await text(page, '#agentList .agent-row'), /web-app[\s\S]*Needs you/);
  assert.equal(await text(page, '#inboxBadge'), '2');
  // Nothing may hide under the title bar strip, which the window uses for dragging.
  const top = await page.evaluate(() => Math.min(...[...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect().top)));
  assert.ok(top >= 28, 'a control sits under the title bar: ' + top);
  await shot('workspace-light');
});

await check('dark appearance', {dark: true, scale: 2}, async ({page, shot}) => {
  const background = await page.evaluate(() => getComputedStyle(document.querySelector('main')).backgroundColor);
  assert.equal(background, 'rgb(30, 30, 31)');
  await shot('workspace-dark');
});

await check('quick add parses natural language', {}, async ({page, tasks, shot}) => {
  await page.click('#tasks [data-quick="view"]');
  const field = page.locator('.quick-add input');
  await field.fill('Call the bank tomorrow 3pm #Finance !p1 every week');
  assert.deepEqual(await page.locator('.quick-hint .chip').allInnerTexts(), ['P1', 'Finance', 'Every week', 'Tomorrow', '3:00 PM']);
  await shot('quick-add');
  await field.press('Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Call the bank'));
  const added = (await tasks()).find(t => t.title === 'Call the bank');
  assert.deepEqual([added.planned, added.dueDate, added.dueTime, added.tag, added.priority, added.repeat, added.project, added.source, added.quote, added.done],
    [day(1), day(1), '15:00', 'Finance', 'P1', 'weekly', 'AI Task List', '', '', false]);
  // The field stays open and focused for the next task.
  assert.equal(await page.evaluate(() => document.activeElement?.closest('.quick-add') != null), true);
  await field.fill('Plain task');
  await field.press('Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Plain task'));
  assert.equal((await tasks()).find(t => t.title === 'Plain task').planned, day(0));
  await field.press('Escape');
  assert.equal(await page.locator('.quick-add').count(), 0);
  // A list section adds to that list without scheduling it.
  await page.click('#pool [data-quick="p:Personal"]');
  await page.locator('.quick-add input').fill('Buy stamps');
  await page.locator('.quick-add input').press('Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Buy stamps'));
  const stamps = (await tasks()).find(t => t.title === 'Buy stamps');
  assert.deepEqual([stamps.project, stamps.planned], ['Personal', '']);
});

// F10, F14: parsing is visible, reversible, leaves reference numbers alone, and reads Chinese dates.
await check('quick add chips can be kept as text', {scale: 2}, async ({page, tasks, shot}) => {
  await page.click('#tasks [data-quick="view"]');
  const field = page.locator('.quick-add input');
  await field.fill('Review invoice #123 and meeting @10am');
  assert.equal(await page.locator('.quick-hint .chip').count(), 0);
  await field.press('Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Review invoice #123 and meeting @10am'));
  assert.equal((await tasks()).find(t => t.title.startsWith('Review invoice')).tag, '');
  await field.fill('Call the bank tomorrow 3pm #Finance');
  await shot('quick-add-chips');
  await page.click('.quick-hint .chip[data-kind="date"] .chip-keep');
  assert.deepEqual(await page.locator('.quick-hint .chip').allInnerTexts(), ['Finance', '3:00 PM']);
  await field.press('Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Call the bank tomorrow'));
  const kept = (await tasks()).find(t => t.title === 'Call the bank tomorrow');
  assert.deepEqual([kept.planned, kept.dueDate, kept.dueTime, kept.tag], [day(0), day(0), '15:00', 'Finance']);
  await field.fill('Email the \\#design channel');
  await field.press('Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Email the #design channel'));
});

await check('Chinese dates in the card', {width: 340, height: 640, compact: true, scale: 2}, async ({page, tasks, shot}) => {
  await page.fill('#cardAddInput', '明天下午3点 给Maya发报告');
  assert.deepEqual(await page.locator('#cardAddHint .chip').allInnerTexts(), ['Tomorrow', '3:00 PM']);
  await shot('card-chinese-chips');
  await page.press('#cardAddInput', 'Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === '给Maya发报告'));
  const task = (await tasks()).find(t => t.title === '给Maya发报告');
  assert.deepEqual([task.planned, task.dueDate, task.dueTime], [day(1), day(1), '15:00']);
  assert.equal(await page.locator('#cardAddHint .chip').count(), 0);
});

// F05: repeating tasks keep their rule, and completing is reversible.
await check('repeating tasks: complete, undo, reopen, edited successor', {}, async ({page, tasks}) => {
  const series = async () => (await tasks()).filter(t => t.title === "Prepare Friday's update");
  const complete = () => page.locator('#tasks .row:not(.done)', {hasText: "Prepare Friday's update"}).locator('.check').click();
  const reopen = () => page.locator('#tasks .row.done', {hasText: "Prepare Friday's update"}).locator('.check').click();
  await complete();
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === "Prepare Friday's update").length === 2);
  let [first, next] = await series();
  assert.deepEqual([first.done, first.repeat, first.next, next.done, next.repeat, next.planned, next.previous],
                   [true, 'weekly', next.id, false, 'weekly', day(7), first.id], 'both keep the rule and are linked');
  assert.match(first.completedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  assert.equal(first.series, first.id);
  assert.equal(next.series, first.id);
  // Undo from the message reopens it and removes the untouched successor.
  await page.click('#toast .undo');
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === "Prepare Friday's update").length === 1);
  [first] = await series();
  assert.deepEqual([first.done, first.repeat, first.next], [false, 'weekly', undefined]);
  // Completing twice in a row creates one successor, not two.
  await complete();
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === "Prepare Friday's update").length === 2);
  await reopen();
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === "Prepare Friday's update").length === 1);
  await complete();
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === "Prepare Friday's update").length === 2);
  // Edit the successor, then reopen the original: the edit is kept, and removing it is an explicit choice.
  await page.evaluate(() => { const next = window.__host.workspace.tasks.find(t => t.title === "Prepare Friday's update" && !t.done); next.notes = 'Include the metrics'; data = structuredClone(window.__host.workspace); render(); });
  await reopen();
  await page.waitForFunction(() => /already changed, so it was kept/.test(document.getElementById('toast').textContent));
  assert.equal((await series()).length, 2);
  assert.equal(await text(page, '#toast .undo'), 'Remove It');
  await page.click('#toast .undo');
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === "Prepare Friday's update").length === 1);
  await page.click('#toast .undo');
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === "Prepare Friday's update").length === 2);
  assert.equal((await series()).find(t => !t.done && t.notes)?.notes, 'Include the metrics');
});

// F02: what you type in Details is never lost by closing, Escape or relaunching.
await check('details autosave survives close, escape and relaunch', {}, async ({page, host, tasks, shot}) => {
  const open = title => page.locator('#tasks .row', {hasText: title}).locator('.task-body').click();
  await open('Review the product roadmap');
  await page.fill('#fieldNotes', 'Ask Maya about Q3');
  await page.waitForFunction(() => document.getElementById('saveState').textContent === 'Saved' && window.__host.workspace.tasks.find(t => t.title === 'Review the product roadmap').notes === 'Ask Maya about Q3');
  await shot('details-saved');
  await page.click('#dialog .dialog-head [data-close]');
  await open('Review the product roadmap');
  assert.equal(await page.inputValue('#fieldNotes'), 'Ask Maya about Q3');
  // Escape right after typing still saves: closing waits for the pending save.
  await page.fill('#fieldNotes', 'Ask Maya about Q3 and Q4');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('dialog').open);
  assert.equal((await tasks()).find(t => t.title === 'Review the product roadmap').notes, 'Ask Maya about Q3 and Q4');
  // Revert is explicit and restores the task as it was when Details opened.
  await open('Review the product roadmap');
  await page.fill('#fieldNotes', 'Scratch that');
  await page.waitForSelector('#revertTask:not([hidden])');
  await page.click('#revertTask');
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Review the product roadmap').notes === 'Ask Maya about Q3 and Q4');
  // A new task exists once it has a title; Discard removes it on purpose.
  await page.keyboard.press('Meta+k'); await page.fill('#paletteInput', 'New Task'); await page.keyboard.press('Escape');
  await page.evaluate(() => taskForm());
  await page.fill('#fieldTitle', 'Draft the launch email');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Draft the launch email'));
  await page.click('#removeTask');
  await page.waitForFunction(() => !window.__host.workspace.tasks.some(t => t.title === 'Draft the launch email'));
  // Closing an untitled new task creates nothing.
  await page.evaluate(() => taskForm());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('dialog').open);
  assert.equal((await tasks()).some(t => !t.title), false);
});

await check('details survive a relaunch', {}, async ({page, host}) => {
  await page.locator('#tasks .row', {hasText: 'Review QA feedback'}).locator('.task-body').click();
  await page.fill('#fieldNotes', 'Check the iPad layout');
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Review QA feedback').notes === 'Check the iPad layout');
  // Start the page again from exactly what the app was asked to store.
  const again = await open(browser, {workspace: (await host()).workspace});
  try {
    await again.page.locator('#tasks .row', {hasText: 'Review QA feedback'}).locator('.task-body').click();
    assert.equal(await again.page.inputValue('#fieldNotes'), 'Check the iPad layout');
  } finally { await again.context.close(); }
});

// F07: a time with no date is never dropped silently.
await check('time without a deadline date asks before closing', {}, async ({page, tasks, shot}) => {
  await page.locator('#tasks .row', {hasText: 'Prepare Friday'}).locator('.task-body').click();
  await page.fill('#fieldDueTime', '15:30');
  assert.match(await text(page, '#saveState'), /Not saved: the time needs a deadline date/);
  assert.equal(await page.getAttribute('#fieldDueTime', 'aria-invalid'), 'true');
  await page.click('#taskForm .primary');
  await page.waitForSelector('#closePrompt:not([hidden])');
  assert.match(await text(page, '#closePrompt'), /15:30 has no deadline date/);
  await shot('time-needs-date');
  await page.click('#closePrompt [data-choice="0"]');
  assert.equal(await page.evaluate(() => document.getElementById('dialog').open), true, 'Keep Editing keeps the sheet open');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#closePrompt:not([hidden])');
  await page.click('#closePrompt [data-choice="1"]');
  await page.waitForFunction(() => !document.getElementById('dialog').open);
  const task = (await tasks()).find(t => t.title === "Prepare Friday's update");
  assert.deepEqual([task.dueDate, task.dueTime], [day(0), '15:30']);
  await page.locator('#tasks .row', {hasText: 'Review QA feedback'}).locator('.task-body').click();
  await page.fill('#fieldDueTime', '09:00');
  await page.click('#taskForm .primary');
  await page.click('#closePrompt [data-choice="2"]');
  await page.waitForFunction(() => !document.getElementById('dialog').open);
  const other = (await tasks()).find(t => t.title === 'Review QA feedback');
  assert.deepEqual([other.dueDate, other.dueTime], [undefined, undefined]);
});

await check('upcoming and completed views', {}, async ({page, tasks, shot}) => {
  await page.click('#nav [data-view="upcoming"]');
  assert.equal(await text(page, '#pageTitle'), 'Upcoming');
  const heads = await page.locator('.day-head h3').allInnerTexts();
  assert.equal(heads[0], 'Overdue');
  assert.equal(heads[1], 'Tomorrow');
  assert.equal(heads.at(-1), 'Later');
  assert.equal(heads.length, 9);
  // Tasks are grouped by the day they are scheduled for, falling back to their deadline.
  assert.match(await page.locator('.day-group', {hasText: 'Tomorrow'}).first().innerText(), /Review the prototype/);
  await shot('upcoming');
  await page.locator('.day-group', {hasText: 'Tomorrow'}).first().locator('[data-quick]').click();
  await page.locator('.quick-add input').fill('Water the plants');
  await page.locator('.quick-add input').press('Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Water the plants'));
  assert.equal((await tasks()).find(t => t.title === 'Water the plants').planned, day(1));
  await page.keyboard.press('Escape');

  await page.keyboard.press('Meta+4');
  assert.equal(await text(page, '#pageTitle'), 'Completed');
  assert.deepEqual((await page.locator('.day-head h3').allInnerTexts()).slice(0, 2), ['Today', 'Yesterday']);
  await shot('completed');
  await page.click('[data-clear-done]');
  await page.waitForFunction(() => !window.__host.workspace.tasks.some(t => t.done));
  await page.click('#toast .undo');
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.done).length === 4);
});

await check('context menu: schedule, priority, duplicate, delete with undo', {}, async ({page, tasks, shot}) => {
  const row = page.locator('#pool .row', {hasText: 'Test reminders'});
  await row.click({button: 'right'});
  await page.waitForSelector('.menu');
  await shot('context-menu');
  await page.locator('.menu .menu-segment button', {hasText: 'Tomorrow'}).click();
  await page.waitForFunction(d => window.__host.workspace.tasks.find(t => t.title === 'Test reminders').planned === d, day(1));
  await page.locator('#pool .row', {hasText: 'Test reminders'}).click({button: 'right'});
  await page.locator('.menu-segment button', {hasText: 'P0'}).click();
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Test reminders').priority === 'P0');
  await page.locator('#pool .row', {hasText: 'Test reminders'}).click({button: 'right'});
  await page.locator('.menu-item', {hasText: 'Duplicate'}).click();
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === 'Test reminders').length === 2);
  await page.locator('#pool .row', {hasText: 'Test reminders'}).first().click({button: 'right'});
  await page.locator('.menu-item', {hasText: 'Move to List'}).click();
  await page.locator('.task-picker [data-choice="Personal"]').click();
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Test reminders' && t.project === 'Personal'));
  await page.locator('#pool .row', {hasText: 'Test reminders'}).first().click({button: 'right'});
  await page.locator('.menu-item', {hasText: 'Copy Title'}).click();
  await page.waitForFunction(() => window.__host.clipboard === 'Test reminders');
  await page.locator('#pool .row', {hasText: 'Test reminders'}).first().click({button: 'right'});
  await page.locator('.menu-item.danger').click();
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === 'Test reminders').length === 1);
  await page.click('#toast .undo');
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === 'Test reminders').length === 2);
  assert.equal((await tasks()).length, sampleWorkspace().tasks.length + 1);
});

await check('lists and tags: create, rename, delete', {}, async ({page, host}) => {
  await page.click('#newProject');
  await page.fill('#projectName', 'Side project');
  await page.press('#projectName', 'Enter');
  await page.waitForFunction(() => window.__host.workspace.projects.includes('Side project'));
  assert.equal(await text(page, '#pageTitle'), 'Side project');
  await page.locator('#projects [data-project="Research notes"]').click({button: 'right'});
  await page.locator('.menu-item', {hasText: 'Rename'}).click();
  await page.fill('#nameField', 'Research');
  await page.press('#nameField', 'Enter');
  await page.waitForFunction(() => window.__host.workspace.projects.includes('Research'));
  let state = (await host()).workspace;
  assert.equal(state.tasks.filter(t => t.project === 'Research').length, 3);
  assert.equal(state.tasks.some(t => t.project === 'Research notes'), false);
  await page.locator('#projects [data-project="Research"]').click({button: 'right'});
  await page.locator('.menu-item', {hasText: 'Delete List'}).click();
  await page.selectOption('#moveTarget', 'Personal');
  await page.click('#deleteList .primary');
  await page.waitForFunction(() => !window.__host.workspace.projects.includes('Research'));
  state = (await host()).workspace;
  assert.equal(state.tasks.length, sampleWorkspace().tasks.length);
  assert.equal(state.tasks.every(t => state.projects.includes(t.project)), true);
  await page.locator('#labels [data-board-tag="Feedback"]').click({button: 'right'});
  await page.locator('.menu-item', {hasText: 'Delete Tag'}).click();
  await page.waitForFunction(() => !window.__host.workspace.tasks.some(t => t.tag === 'Feedback'));
  assert.equal(await page.locator('#labels [data-board-tag="Feedback"]').count(), 0);
  await page.click('#labels [data-board-tag="This week"]');
  assert.equal(await text(page, '#pageTitle'), 'This week');
  assert.equal(await page.locator('#tasks .row').count(), 2);
});

await check('command palette searches, navigates and creates', {}, async ({page, tasks, shot}) => {
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('#palette[open]');
  await shot('palette');
  await page.fill('#paletteInput', 'pricing');
  assert.match(await text(page, '.palette-item.active'), /Compare pricing pages/);
  await shot('palette-search');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#taskForm');
  assert.equal(await page.inputValue('#fieldTitle'), 'Compare pricing pages');
  await page.click('#dialog [data-close]');
  await page.click('#searchTasks');
  await page.fill('#paletteInput', 'personal');
  await page.keyboard.press('Enter');
  assert.equal(await text(page, '#pageTitle'), 'Personal');
  await page.keyboard.press('Meta+k');
  await page.fill('#paletteInput', 'Book flights friday !p0');
  await page.keyboard.press('ArrowUp');
  assert.match(await text(page, '.palette-item.active'), /Add “Book flights friday !p0” as a task/);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Book flights'));
  const added = (await tasks()).find(t => t.title === 'Book flights');
  assert.deepEqual([added.priority, added.project], ['P0', 'Personal']);
  await page.keyboard.press('Meta+k');
  await page.fill('#paletteInput', 'markdown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__host.clipboard.includes('## AI Task List'));
  const markdown = (await page.evaluate(() => window.__host.clipboard));
  assert.match(markdown, /- \[x\] Draft the product brief \(P0, #Product insights\)/);
  assert.match(markdown, /  - \[x\] Collect comments/);
});

await check('agents list and inbox', {}, async ({page, host, shot}) => {
  await page.locator('#agentList .agent-row', {hasText: 'small-tool'}).click();
  await page.waitForSelector('#inboxCards .result-card');
  const card = page.locator('#inboxCards .result-card').first();
  assert.equal(await card.locator('.result-preview').getAttribute('aria-expanded'), 'true');
  await shot('inbox');
  await card.locator('.result-expand').click();
  await page.waitForFunction(() => window.__host.notices.external[0].read);
  // Reading the result retires the finished status.
  await page.waitForFunction(() => window.__host.agents.length === 2);
  await card.locator('.mini-link', {hasText: 'Add Follow-up Task'}).click();
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title.startsWith('Follow up:')));
  await page.click('#readAll');
  await page.waitForFunction(() => window.__host.notices.codex.every(n => n.read));
  assert.equal(await page.locator('#inboxBadge').isHidden(), true);
  await page.click('#dialog [data-close]');
  assert.equal(await page.locator('#agentList .agent-row').count(), 2);
  await page.locator('#agentList .agent-row', {hasText: 'docs-site'}).click();
  await page.locator('.menu-item', {hasText: 'Dismiss'}).click();
  await page.waitForFunction(() => window.__host.agents.length === 1);
  assert.equal((await host()).agents[0].state, 'attention');
});

// F04: bulk read follows the visible filter, every change can be undone, and archiving keeps the reply.
await check('inbox read state is scoped and reversible', {}, async ({page, host, shot}) => {
  await page.click('#inboxButton');
  await page.click('#sourceFilters [data-source="Claude Code"]');
  assert.equal(await text(page, '#readAll'), 'Mark 1 Claude Code Read');
  await page.click('#readAll');
  await page.waitForFunction(() => window.__host.notices.external[0].read);
  assert.equal((await host()).notices.codex[0].read, false, 'hidden Codex results are untouched');
  assert.equal(await text(page, '#readEverything'), 'Mark All 1 Read');
  await page.click('#toast .undo');
  await page.waitForFunction(() => !window.__host.notices.external[0].read);
  // One result: read, unread, archive, restore.
  await page.click('#sourceFilters [data-source=""]');
  const card = page.locator('#inboxCards .result-card').first();
  await card.locator('.result-preview').click();
  await card.locator('.result-read').click();
  await page.waitForFunction(() => window.__host.notices.external[0].read);
  assert.equal(await card.locator('.result-read').innerText(), 'Mark Unread');
  await card.locator('.result-read').click();
  await page.waitForFunction(() => !window.__host.notices.external[0].read);
  await card.locator('.result-archive').click();
  await page.waitForFunction(() => window.__host.notices.external[0].archived);
  assert.equal(await page.locator('#inboxCards .result-card').count(), 3);
  assert.equal(await text(page, '#sourceFilters [data-source="__archived"]'), 'Archived (1)');
  await page.click('#sourceFilters [data-source="__archived"]');
  await shot('inbox-archived');
  assert.equal(await page.locator('#inboxCards .result-card').count(), 1);
  assert.match(await text(page, '#inboxCards'), /Updated billing/);
  assert.ok((await host()).notices.external[0].summary.length > 20, 'archiving keeps the stored reply');
  const archived = page.locator('#inboxCards .result-card').first();
  await archived.locator('.result-preview').click();
  await archived.locator('.result-archive').click();
  await page.waitForFunction(() => !window.__host.notices.external[0].archived);
});

await check('connections: Claude Code, menu bar, Notion', {}, async ({page, host, tasks, shot}) => {
  await page.click('#boardMore');
  await page.click('#openConnectors');
  await page.waitForFunction(() => document.querySelector('#claudeConnection')?.textContent === 'Connect' && !document.querySelector('#claudeConnection').disabled);
  await page.waitForFunction(() => !document.querySelector('#menuBarChoice').disabled);
  await shot('connections');
  await page.click('#claudeConnection');
  await page.waitForFunction(() => document.querySelector('#claudeConnection').textContent === 'Disconnect');
  assert.match(await text(page, '#claudeRow [data-state]'), /Connected/);
  await page.click('[data-settings-tab="general"]');
  await page.waitForSelector('#appearanceChoice [data-appearance="system"][aria-pressed="true"]');
  await page.click('#appearanceChoice [data-appearance="dark"]');
  await page.waitForFunction(() => window.__host.appearance === 'dark' && document.querySelector('[data-appearance="dark"]').getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => document.querySelectorAll('[data-card-pref]:not([disabled])').length === 3);
  assert.deepEqual(await page.$$eval('[data-card-pref]', boxes => boxes.map(box => [box.dataset.cardPref, box.checked])), [['pinned', false], ['allSpaces', false], ['snap', true]]);
  await page.check('[data-card-pref="snap"]').catch(() => {});
  await page.uncheck('[data-card-pref="snap"]');
  await page.waitForFunction(() => window.__host.card.snap === false);
  await page.uncheck('#menuBarChoice');
  await page.waitForFunction(() => window.__host.menuBar === false);
  await page.click('[data-settings-tab="sync"]');
  await page.click('#notionRow');
  await page.fill('#notionDatabase', 'https://www.notion.so/acme/Team-tasks-11111111222233334444555555555555?v=1');
  await shot('notion-connect');
  await page.click('#notionForm .primary');
  await page.waitForFunction(() => window.__host.workspace.notion && window.__host.notionPushes.length === 0 && window.__host.workspace.tasks.some(t => t.notion));
  let state = (await host()).workspace;
  assert.deepEqual([state.notion.title, state.notion.project], ['Team tasks', 'Team tasks']);
  const imported = state.tasks.find(t => t.title === 'Plan the launch post');
  assert.deepEqual([imported.project, imported.dueDate, imported.priority, imported.tag, imported.done], ['Team tasks', day(1), 'P1', 'Marketing', false]);
  assert.equal(state.tasks.some(t => t.title === 'Old finished page'), false);
  await page.waitForSelector('#notionSync:not([disabled])');
  await shot('notion-connected');
  await page.click('#dialog [data-close]');
  // A task added to the linked list is created in Notion, and completing the imported one is sent too.
  await page.click('#projects [data-project="Team tasks"]');
  await page.click('#tasks [data-quick="view"]');
  await page.locator('.quick-add input').fill('Draft the changelog');
  await page.locator('.quick-add input').press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('#tasks .row', {hasText: 'Plan the launch post'}).locator('.check').click();
  await page.locator('#projects [data-project="Team tasks"]').click({button: 'right'});
  await page.locator('.menu-item', {hasText: 'Sync with Notion'}).click();
  await page.waitForFunction(() => window.__host.notionPushes.length === 2);
  const pushes = (await host()).notionPushes;
  assert.deepEqual(pushes.map(change => [change.page ? 'update' : 'create', change.fields]).sort((a, b) => a[0].localeCompare(b[0])),
    [['create', {title: 'Draft the changelog', done: false}], ['update', {done: true}]]);
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Draft the changelog')?.notion?.id);
  // Nothing more to send on the next sync.
  await page.locator('#projects [data-project="Team tasks"]').click({button: 'right'});
  await page.locator('.menu-item', {hasText: 'Sync with Notion'}).click();
  await page.waitForFunction(() => /up to date/.test(document.getElementById('toast').textContent));
  assert.equal((await host()).notionPushes.length, 2);
  assert.equal((await tasks()).every(t => typeof t.title === 'string' && typeof t.source === 'string' && typeof t.quote === 'string'), true);
});

await check('focus timer and wrap up', {}, async ({page, host, shot}) => {
  await page.click('#focusButton');
  await page.waitForSelector('.focus-pop');
  await page.locator('.focus-pop [data-length="15"]').click();
  await shot('focus');
  await page.locator('.focus-pop [data-start]').click();
  await page.waitForSelector('#focusButton.running');
  assert.match(await text(page, '#focusTime'), /^1[45]:\d\d$/);
  // Jump to the end of the session.
  await page.evaluate(() => { focusSession.end = Date.now() - 1; });
  await page.waitForFunction(() => Object.values(window.__host.workspace.focusLog || {})[0] === 15, null, {timeout: 5000});
  assert.equal(await page.locator('#focusButton.running').count(), 0);
  await page.click('#wrapUp');
  await page.waitForSelector('.stat-grid');
  assert.deepEqual(await page.locator('.stat b').allInnerTexts(), ['1', '5', '3', '15']);
  await shot('wrap-up');
  await page.click('#copyWrap');
  await page.waitForFunction(() => window.__host.clipboard.includes('## Still open'));
  await page.click('#carryOver');
  await page.waitForFunction(() => document.querySelectorAll('#tasks .row:not(.done)').length === 0);
  const state = (await host()).workspace;
  assert.equal(state.tasks.filter(t => !t.done && t.planned === day(1)).length >= 5, true);
});

// Both the source row and the drop targets must be on screen for a real drag.
await check('drag a task into Today and onto a list', {height: 1500}, async ({page}) => {
  const source = page.locator('#pool .row', {hasText: 'Compare pricing pages'});
  await source.dragTo(page.locator('#tasks .task-list'));
  await page.waitForFunction(d => window.__host.workspace.tasks.find(t => t.title === 'Compare pricing pages').planned === d, day(0));
  await page.locator('#tasks .row', {hasText: 'Compare pricing pages'}).dragTo(page.locator('#projects [data-project="Personal"]'));
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Compare pricing pages').project === 'Personal');
});

const weekdayNow = () => new Intl.DateTimeFormat('en-US', {weekday: 'long'}).format(new Date()).toUpperCase();

await check('corner card', {width: 340, height: 420, compact: true}, async ({page, host, tasks}) => {
  assert.equal(await page.locator('#shell').isHidden(), true);
  assert.equal(await text(page, '#cardWeekday'), weekdayNow());
  assert.equal(await text(page, '#cardDay'), String(new Date().getDate()));
  assert.equal(await text(page, '#cardSummary'), '5 tasks left');
  assert.equal(await text(page, '#cardRing .ring-label'), '1/6');
  assert.equal(await page.locator('#cardTasks .row').count(), 5);
  assert.equal(await page.locator('#cardTasks .row.p0').count(), 1);
  assert.equal(await text(page, '#cardTasks .row:has-text("Send the release checklist") .card-due'), 'Tomorrow');
  assert.match(await text(page, '#cardTasks .row:has-text("Review QA feedback")'), /Review QA feedback/);
  // The agent capsule moved into the card and reports the agent that needs you.
  assert.equal(await page.locator('.card-island-slot #island').count(), 1);
  assert.match(await page.getAttribute('#island', 'class'), /mode-attention/);
  // The waiting agent's report replaces the capsule, so the news is not shown twice.
  assert.equal(await page.locator('.card-island-slot').isHidden(), true);
  assert.match(await text(page, '#cardReport'), /web-app[\s\S]*Needs you[\s\S]*Claude needs your permission to use Bash/);
  // The card tells the app how tall it needs to be.
  await page.waitForFunction(() => window.__host.cardHeight > 150);
  const shown = await page.evaluate(() => Math.ceil(document.querySelector('.card-inner').getBoundingClientRect().height));
  assert.ok((await host()).cardHeight >= shown);

  await page.fill('#cardAddInput', 'Stretch at 5pm');
  await page.press('#cardAddInput', 'Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Stretch'));
  const stretch = (await tasks()).find(t => t.title === 'Stretch');
  assert.deepEqual([stretch.planned, stretch.dueDate, stretch.dueTime], [day(0), day(0), '17:00']);
  assert.equal(await text(page, '#cardSummary'), '6 tasks left');
  assert.equal(await page.locator('#cardMore').isHidden(), true);

  await page.locator('#cardTasks .row', {hasText: 'Review the product roadmap'}).locator('.check').click();
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Review the product roadmap').done);
  assert.equal(await text(page, '#cardRing .ring-label'), '2/7');
  // An overdue task finished today stays in today's tally.
  await page.locator('#cardTasks .row', {hasText: 'Review QA feedback'}).locator('.check').click();
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Review QA feedback').done);
  assert.equal(await text(page, '#cardRing .ring-label'), '3/7');

  // Report text can be selected: pressing in the page never starts a window drag (F15).
  const selected = await page.evaluate(() => { const node = document.querySelector('#cardReport .report-reason'); getSelection().selectAllChildren(node); return getSelection().toString(); });
  assert.ok(selected.length > 5);
  await page.evaluate(() => getSelection().removeAllRanges());

  await page.evaluate(() => { window.__host.menuChoice = 'Move to Tomorrow'; });
  await page.locator('#cardTasks .row', {hasText: 'Prepare Friday'}).click({button: 'right'});
  await page.waitForFunction(d => window.__host.workspace.tasks.find(t => t.title === "Prepare Friday's update").planned === d, day(1));
  const menu = (await host()).lastMenu;
  // Window behaviour is explicit, and off by default (F16).
  assert.deepEqual(['Keep Above Other Windows', 'Show on All Spaces', 'Snap to Screen Corners'].map(title => menu.find(item => item.title === title)?.checked), [false, false, true]);
  await page.evaluate(() => { window.__host.menuChoice = 'Show on All Spaces'; });
  await page.locator('.card-head').click({button: 'right'});
  await page.waitForFunction(() => window.__host.card.allSpaces === true);

  await page.hover('#card');
  await page.click('#cardPin');
  await page.waitForFunction(() => window.__host.pinned === true && document.getElementById('cardPin').getAttribute('aria-pressed') === 'true');

  // Details open in the full workspace, not inside the small card.
  await page.locator('#cardTasks .row', {hasText: 'Organize the review notes'}).locator('.task-body').click();
  await page.waitForSelector('#taskForm');
  assert.equal(await page.locator('#shell').isVisible(), true);
  assert.equal(await page.locator('.toolbar #island').count(), 1);
});

await check('brief report: decide whether to open the agent', {width: 340, height: 600, compact: true, scale: 2}, async ({page, host, shot}) => {
  const report = () => text(page, '#cardReport');
  // 1. An agent waiting for permission comes first.
  assert.match(await page.getAttribute('#cardReport', 'class'), /verdict-blocked/);
  assert.match(await report(), /Needs you[\s\S]*You asked: Deploy the preview build/);
  assert.equal(await text(page, '#cardReport [data-report="open"]'), 'Open in Terminal');
  await shot('report-needs-you');
  await page.click('#cardReport [data-report="open"]');
  await page.waitForFunction(() => window.__host.openedApp === 'com.apple.Terminal');
  await page.click('#cardReport [data-report="dismiss"]');
  await page.waitForFunction(() => !window.__host.agents.some(agent => agent.state === 'attention'));

  // 2. Then the newest unread result, with a verdict.
  await page.waitForFunction(() => /small-tool/.test(document.getElementById('cardReport').innerText));
  assert.match(await page.getAttribute('#cardReport', 'class'), /verdict-done/);
  const done = await report();
  for (const part of [/Completed · Checks passed/, /Checks ran and passed\./, /Updated billing\.py and added 12 tests/, /billing\.py/, /Checks passed/, /You asked: Refactor billing\.py/, /5 min/, /1 more result/]) assert.match(done, part);
  assert.equal(await text(page, '#cardReport [data-report="open"]'), 'Open in iTerm');
  await page.waitForTimeout(100);
  await shot('report-done');
  await page.click('#cardReport [data-report="dismiss"]');
  await page.waitForFunction(() => window.__host.notices.external[0].read);

  // 3. The Codex result opens its own conversation.
  await page.waitForFunction(() => /api-server/.test(document.getElementById('cardReport').innerText));
  assert.equal(await text(page, '#cardReport [data-report="open"]'), 'Open in Codex');
  await page.click('#cardReport [data-report="open"]');
  await page.waitForFunction(() => window.__host.openedThread && window.__host.notices.codex[0].read);
  await page.waitForFunction(() => document.getElementById('cardReport').hidden);
  assert.doesNotMatch(await page.getAttribute('#card', 'class') || '', /has-report/);
});

// F03: a newer result never replaces the report under your pointer, focus or selection.
await check('report stays put while being read', {width: 340, height: 640, compact: true}, async ({page, host}) => {
  const head = () => text(page, '#cardReport .report-head b');
  const arrive = (key, place) => page.evaluate(([key, place]) => {
    window.__host.agents.push({key: key.repeat(64), source: 'Claude Code', title: 'Claude Code · ' + place, detail: 'Claude needs your permission to run git push', state: 'attention', receipt: '', time: Date.now() / 1000});
    window.setAgents(window.__host.agents);
  }, [key, place]);
  assert.equal(await head(), 'web-app');
  await page.hover('#cardReport .report-headline');
  await arrive('9', 'payments');
  await page.waitForSelector('#cardReport .report-newer:not([hidden])');
  assert.equal(await head(), 'web-app', 'the report under the pointer is not replaced');
  // Actions stay bound to the report being read.
  await page.click('#cardReport [data-report="dismiss"]');
  await page.waitForFunction(() => !window.__host.agents.some(agent => agent.title.endsWith('web-app')));
  assert.ok((await host()).agents.some(agent => agent.title.endsWith('payments')));
  // Selected text also holds the report.
  await page.mouse.move(5, 600);
  await page.waitForFunction(() => document.querySelector('#cardReport .report-head b')?.textContent === 'payments');
  await page.evaluate(() => { const node = document.querySelector('#cardReport .report-headline'); getSelection().selectAllChildren(node); });
  await arrive('8', 'search');
  await page.waitForTimeout(400);
  assert.equal(await head(), 'payments');
  assert.equal(await page.locator('#cardReport .report-newer').isVisible(), true);
  await page.click('#cardReport .report-newer');
  await page.waitForFunction(() => document.querySelector('#cardReport .report-head b')?.textContent === 'search');
  // An idle card follows the newest result.
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.mouse.move(5, 600);
  await page.waitForTimeout(1500);
  await arrive('7', 'mobile');
  await page.waitForFunction(() => document.querySelector('#cardReport .report-head b')?.textContent === 'mobile');
});

await check('brief report: worth a look, and the full reply', {width: 340, height: 600, compact: true}, async ({page}) => {
  await page.evaluate(() => {
    const now = Date.now() / 1000;
    window.__host.agents = [];
    window.__host.notices.codex = [];
    window.__host.notices.external = [{id: 'connector/' + 'd'.repeat(64), source: 'Claude Code', title: 'Claude Code · api', time: now - 30, read: false, thread: '', link: '',
      summary: 'Added the refund endpoint in `routes/refunds.ts`.\n\n2 tests failed in `refunds.test.ts`: the currency rounding is off.'}];
    window.__host.agents.push({key: 'b'.repeat(64), source: 'Claude Code', title: 'Claude Code · api', detail: '', state: 'done', receipt: 'connector/' + 'd'.repeat(64), time: now - 30, task: 'Add a refund endpoint', started: now - 400, app: ''});
    window.setInbox({channel: 'codex', items: [], error: ''});
    window.setInbox({channel: 'external', items: window.__host.notices.external, error: ''});
    window.setAgents(window.__host.agents);
  });
  await page.waitForFunction(() => /verdict-review/.test(document.getElementById('cardReport').className));
  assert.match(await text(page, '#cardReport'), /Worth a look[\s\S]*The reply says checks failed[\s\S]*Reported failing/);
  assert.equal(await text(page, '#cardReport [data-report="open"]'), 'Open Claude Code');
  await page.click('#cardReport [data-report="read"]');
  await page.waitForSelector('#inboxCards .result-card');
  assert.equal(await page.locator('#shell').isVisible(), true);
});

await check('first run: connect Claude Code or watch the demo', {width: 340, height: 640, compact: true, empty: true, workspace: null, scale: 2}, async ({page, host, shot}) => {
  await page.waitForSelector('#cardWelcome:not([hidden])');
  assert.match(await text(page, '#cardWelcome'), /Know when Claude Code is done[\s\S]*Connect Claude Code[\s\S]*Try a demo/);
  await shot('first-run');
  await page.click('[data-welcome="demo"]');
  await page.waitForFunction(() => document.getElementById('cardWelcome').hidden);
  assert.match(await page.getAttribute('#island', 'class'), /mode-working/);
  // The waiting session's report comes first, then the finished one, with facts from its session log.
  await page.waitForFunction(() => /Needs you/.test(document.getElementById('cardReport').innerText), null, {timeout: 8000});
  await page.click('#cardReport [data-report="dismiss"]');
  await page.waitForFunction(() => /demo-shop/.test(document.getElementById('cardReport').innerText), null, {timeout: 9000});
  assert.match(await text(page, '#cardReport'), /Completed · Checks passed[\s\S]*refunds\.ts[\s\S]*Checks ran and passed/);
  await shot('demo-report');
  await page.click('#cardReport [data-report="open"]');
  await page.waitForFunction(() => /real session/.test(document.getElementById('toast').textContent));
  await page.waitForFunction(() => document.getElementById('cardReport').hidden);
  assert.equal((await host()).openedApp, undefined, 'the demo never opens a real app');
  // Nothing from the demo reached the app.
  assert.equal(((await host()).workspace?.tasks || []).length, 0);
  await page.waitForSelector('#cardWelcome:not([hidden])');
  await page.click('[data-welcome="connect"]');
  await page.waitForFunction(() => window.__host.claude.installed && document.getElementById('cardWelcome').hidden);
});

await check('first run: not now', {width: 340, height: 640, compact: true, empty: true, workspace: null}, async ({page}) => {
  await page.waitForSelector('#cardWelcome:not([hidden])');
  await page.click('[data-welcome="close"]');
  await page.waitForFunction(() => window.__host.workspace?.welcomed === true && document.getElementById('cardWelcome').hidden);
});

await check('light download: no task capture', {lite: true}, async ({page}) => {
  await page.click('#boardMore');
  assert.equal(await page.locator('#openCapture').isHidden(), true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  await page.fill('#paletteInput', 'capture');
  assert.doesNotMatch(await text(page, '#paletteList'), /Capture Tasks/);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.openMessage('Please send the deck by Friday.'));
  await page.waitForSelector('#captureManual');
  assert.match(await text(page, '#dialogBody'), /light download leaves out/);
  await page.click('#captureManual');
  await page.waitForSelector('#taskForm');
});

await check('light download: optional verified model download', {lite: true}, async ({page, host}) => {
  // Nothing downloads on its own. The menu offers it, and the dialog says what happens.
  assert.equal((await host()).modelRequests, undefined);
  await page.click('#boardMore');
  assert.equal(await page.locator('#downloadModelMenu').isVisible(), true);
  await page.click('#downloadModelMenu');
  assert.match(await text(page, '#dialogBody'), /1\.1 GB[\s\S]*checksum/);
  await page.click('#downloadModel');
  await page.waitForFunction(() => /Downloading: 559 MB of 1,117 MB \(50%\)|Checking the file/.test(document.querySelector('#modelStatus')?.textContent || ''));
  // Once installed and verified, Capture Tasks opens in place.
  await page.waitForSelector('#recognize');
  assert.equal((await host()).modelRequests, 1);
  await page.keyboard.press('Escape');
  await page.click('#boardMore');
  assert.equal(await page.locator('#openCapture').isVisible(), true);
  assert.equal(await page.locator('#downloadModelMenu').isVisible(), false);
});

await check('back to card after jumping to the workspace', {width: 340, height: 600, compact: true}, async ({page}) => {
  await page.locator('#cardTasks .row', {hasText: 'Organize the review notes'}).locator('.task-body').click();
  await page.waitForSelector('#taskForm');
  await page.click('#dialog [data-close]');
  assert.equal(await page.locator('#workspaceReturn').isVisible(), true);
  assert.equal(await text(page, '#workspaceReturn'), 'Back to card');
  await page.click('#workspaceReturn');
  await page.waitForFunction(() => compact && document.getElementById('workspaceReturn').hidden);
});

// F06: the inbox is reachable from the card in every state, with its count.
await check('card inbox button in every state', {width: 340, height: 640, compact: true, empty: true, workspace: null}, async ({page}) => {
  await page.waitForSelector('#cardWelcome:not([hidden])');
  assert.equal(await page.locator('#cardInbox').isVisible(), true, 'first run');
  assert.equal(await text(page, '#cardInboxCount'), '');
  await page.evaluate(() => {
    window.__host.notices.codex = [{id: 'old/1', thread: '11111111-1111-4111-8111-111111111111', title: 'Codex · api', time: Date.now() / 1000 - 30 * 3600, read: false, summary: 'Fixed the export.'}];
    window.setInbox({channel: 'codex', items: window.__host.notices.codex, error: ''});
  });
  assert.equal(await text(page, '#cardInboxCount'), '1');
  // A day-old unread result is still offered, not hidden by its age.
  await page.waitForFunction(() => /api/.test(document.getElementById('cardReport').innerText));
  await page.click('#cardInbox');
  await page.waitForSelector('#inboxCards .result-card');
  assert.equal(await page.locator('#workspaceReturn').isVisible(), true);
});

// F08: at 340 × 430 everything essential stays reachable; long parts scroll inside the card.
await check('compact card at a constrained height', {width: 340, height: 430, compact: true, scale: 2}, async ({page, host, shot}) => {
  const add = await page.locator('#cardAddInput').boundingBox();
  assert.ok(add.y + add.height <= 430, 'the add field is on screen: ' + (add.y + add.height));
  assert.equal(await page.locator('#cardInbox').isVisible(), true);
  const scrolls = await page.evaluate(() => ['#cardTasks', '#cardReport'].map(id => { const node = document.querySelector(id); return node.scrollHeight > node.clientHeight + 1 && getComputedStyle(node).overflowY === 'auto'; }));
  assert.ok(scrolls.some(Boolean), 'something scrolls inside the card');
  await page.waitForFunction(() => window.__host.cardHeight > 430);
  await shot('card-430');
  const before = await page.evaluate(() => document.getElementById('cardReport').scrollHeight);
  await page.click('#cardReport .report-fold');
  assert.match(await page.getAttribute('#cardReport', 'class'), /folded/);
  const after = await page.evaluate(() => document.getElementById('cardReport').scrollHeight);
  assert.ok(after < before, 'folding the report frees room: ' + before + ' -> ' + after);
  await page.fill('#cardAddInput', 'Still reachable');
  await page.press('#cardAddInput', 'Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Still reachable'));
});

// F09: Full reply opens the stored reply in one action and keeps where you were.
await check('card report keeps its lines and asks for room (native capture)', {width: 340, height: 474, compact: true}, async ({page, host}) => {
  // Seen in the macOS capture: the headline was squeezed under the next line, the task list scrolled
  // sideways, and the card asked for less height than its content needed.
  await page.waitForTimeout(800);
  const layout = await page.evaluate(() => {
    const report = document.querySelector('.card-report');
    const parts = [...report.children].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect());
    const overlaps = parts.slice(1).filter((box, i) => box.top < parts[i].bottom - 1).length;
    const sideways = [...document.querySelectorAll('#card *')].filter(node => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== 'visible' && getComputedStyle(node).overflowX !== 'hidden').map(node => node.id || node.className);
    const headline = report.querySelector('.report-headline');
    const squeezed = [...report.children].filter(node => node.getClientRects().length && node.scrollHeight > node.clientHeight + 1).map(node => node.className);
    return {overlaps, sideways, squeezed, headline: headline.clientHeight};
  });
  assert.equal(layout.overlaps, 0, 'report lines overlap');
  assert.deepEqual(layout.squeezed, [], 'report lines squeezed into less height than their text');
  assert.ok(layout.headline >= 17, 'headline height ' + layout.headline);
  assert.deepEqual(layout.sideways, [], 'something scrolls sideways');
  assert.ok((await host()).cardHeight > 474, 'the card asks for the height its content needs: ' + (await host()).cardHeight);
});

await check('inbox and card agree when session facts arrive late (native capture)', {}, async ({page}) => {
  // Seen in the macOS capture: the app sends the inbox before the agent statuses, and the inbox row kept
  // "Checks reported passing" while the card showed "Checks passed" for the same result.
  const id = 'connector/' + '9'.repeat(64);
  await page.evaluate(id => {
    const host = window.__host, now = Date.now() / 1000;
    host.notices.external.unshift({id, source: 'Claude Code', title: 'Claude Code · late-facts', time: now, read: false, thread: '', link: '', summary: 'Done. All tests pass.'});
    window.setInbox({channel: 'external', items: host.notices.external, error: ''});
  }, id);
  await page.click('#inboxButton');
  const row = () => page.locator('#inboxCards .result-card', {hasText: 'late-facts'}).locator('.result-state');
  assert.equal(await row().innerText(), 'Completed · Checks reported passing');
  await page.evaluate(id => {
    const host = window.__host, now = Date.now() / 1000;
    host.agents.push({key: '9'.repeat(64), source: 'Claude Code', title: 'Claude Code · late-facts', detail: 'Done.', state: 'done', receipt: id, time: now, task: 'Fix it', started: now - 60,
      facts: {files: ['a.py'], fileCount: 1, commands: 1, failedTools: 0, tests: 'passed', testCommand: 'pytest -q'}});
    window.setAgents(host.agents);
  }, id);
  await page.waitForTimeout(400);
  assert.equal(await row().innerText(), 'Completed · Checks passed', 'after facts arrive');
  // Reading the result clears its session status; the verdict must not fall back to the reply's claim.
  await page.evaluate(id => { const host = window.__host; host.agents = host.agents.filter(agent => agent.receipt !== id); window.setAgents(host.agents); }, id);
  await page.waitForTimeout(300);
  assert.equal(await row().innerText(), 'Completed · Checks passed');
});

await check('full reply opens the original reply', {width: 340, height: 640, compact: true}, async ({page}) => {
  await page.click('#cardReport [data-report="dismiss"]');
  await page.waitForFunction(() => /small-tool/.test(document.getElementById('cardReport').innerText));
  await page.click('#cardReport [data-report="read"]');
  await page.waitForSelector('#inboxCards .result-original:not([hidden])');
  assert.match(await text(page, '#inboxCards .result-original:not([hidden])'), /Next step: review the migration before deploying/);
  assert.equal(await page.locator('#workspaceReturn').isVisible(), true);
  // A source filter that shows the result is kept.
  await page.click('#sourceFilters [data-source="Claude Code"]');
  assert.equal(await text(page, '#dialog .dialog-back'), 'Card');
  await page.click('#dialog .dialog-back');
  await page.waitForFunction(() => compact);
  await page.click('#cardInbox');
  await page.waitForSelector('#sourceFilters [data-source="Claude Code"].active');
});

// F12: each connection can have its own colour; status colours stay separate, and text stays readable.
for (const dark of [false, true]) {
  await check('connection colours' + (dark ? ', dark' : ''), {dark, scale: 2}, async ({page, host, shot}) => {
    await page.click('#boardMore');
    await page.click('#openConnectors');
    await page.click('#claudeRow .source-swatch');
    await page.click('.color-picker [title="Purple"]');
    await page.waitForFunction(() => window.__host.workspace.sourceColors?.['Claude Code'] === '#af52de');
    await page.click('#codexRow .source-swatch');
    await page.fill('.color-picker input[type=color]', '#30d158');
    await page.waitForFunction(() => window.__host.workspace.sourceColors?.Codex === '#30d158');
    if (!dark) await shot('connections-colours');
    await page.click('#dialog [data-close]');
    await page.click('#inboxButton');
    const claude = page.locator('#inboxCards .result-card', {hasText: 'Claude Code'}).first();
    assert.match(await claude.getAttribute('class'), /has-source-color/);
    assert.match(await claude.getAttribute('style'), /--source-color: #af52de/);
    const github = page.locator('#inboxCards .result-card', {hasText: 'GitHub Actions'}).first();
    assert.doesNotMatch(await github.getAttribute('class'), /has-source-color/);
    await shot('inbox-colours' + (dark ? '-dark' : ''));
    // Contrast of the headline over the tinted card, for every preset.
    const ratios = await page.evaluate(presets => {
      const card = document.querySelector('#inboxCards .result-card.has-source-color'), head = card.querySelector('.result-headline');
      const rgb = value => value.match(/[\d.]+/g).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
      const probe = document.createElement('i'); probe.style.background = 'var(--paper)'; document.body.append(probe);
      const paper = rgb(getComputedStyle(probe).backgroundColor); probe.remove();
      const [r, g, b, a = 1] = rgb(getComputedStyle(head).color);
      return presets.map(([, hex]) => {
        const tint = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
        const back = mix(paper, tint, .07), text = mix(back, [r, g, b], a);
        const [x, y] = [lum(text), lum(back)].sort((p, q) => q - p);
        return (x + .05) / (y + .05);
      });
    }, await page.evaluate(() => SourceColors.presets));
    assert.ok(Math.min(...ratios) >= 7, 'headline contrast over every tint: ' + ratios.map(r => r.toFixed(1)).join(', '));
    // Reset removes the colour.
    await page.click('#dialog [data-close]');
    await page.click('#boardMore');
    await page.click('#openConnectors');
    await page.click('#claudeRow .source-swatch');
    await page.click('.color-picker [data-color=""]');
    await page.waitForFunction(() => !window.__host.workspace.sourceColors?.['Claude Code']);
  });
}

await check('corner card when everything is done', {width: 340, height: 420, compact: true}, async ({page}) => {
  for (let i = 0; i < 5; i++) {
    await page.locator('#cardTasks .row .check').first().click();
    await page.waitForFunction(n => document.querySelectorAll('#cardTasks .row').length === n, 4 - i);
  }
  assert.equal(await text(page, '#cardSummary'), 'All done');
  assert.match(await text(page, '#cardTasks'), /Everything for today is done/);
  assert.match(await page.getAttribute('#cardRing', 'class'), /complete/);
});

for (const dark of [false, true]) {
  await check('corner card on the desktop' + (dark ? ', dark' : ''), {width: 1280, height: 800, compact: true, desktop: true, dark, scale: 2}, async ({shot}) => {
    await shot('card-desktop' + (dark ? '-dark' : ''));
  });
}

await check('agent capsule leaves the toolbar buttons free in a narrow window', {width: 760, height: 680}, async ({page}) => {
  await page.waitForTimeout(2700);
  await page.evaluate(() => {
    window.__host.agents.push({key: 'a'.repeat(64), source: 'Claude Code', title: 'Claude Code · billing', detail: 'Updated billing.py and added 12 tests. All checks pass.', state: 'done', receipt: '', time: Date.now() / 1000});
    window.setAgents(window.__host.agents);
  });
  await page.waitForFunction(() => /mode-flash/.test(document.getElementById('island').className));
  for (const open of [false, true]) {
    if (open) { await page.click('#island'); await page.waitForFunction(() => /mode-panel/.test(document.getElementById('island').className)); }
    const [island, tools] = await page.evaluate(() => [document.getElementById('island'), document.querySelector('.toolbar-tools')].map(node => {
      const box = node.getBoundingClientRect(); return {left: box.left, right: box.left + parseFloat(node.style.width || box.width)};
    }));
    assert.ok(island.right <= tools.left, 'the capsule reaches ' + island.right + ', the toolbar starts at ' + tools.left);
  }
});

await check('motion: agent island, completion and progress', {motion: true, scale: 2}, async ({page, host, shot}) => {
  assert.equal(await page.locator('#dayRing').isVisible(), true);
  assert.match(await page.getAttribute('#island', 'class'), /mode-attention/);
  // Results that were already there at launch do not flash. A fresh one does.
  await page.waitForTimeout(2700);
  await page.evaluate(() => {
    const now = Date.now() / 1000;
    window.__host.agents = window.__host.agents.filter(agent => agent.state !== 'attention')
      .map(agent => agent.state === 'working' ? {...agent, state: 'done', time: now, detail: 'Rewrote the docs navigation and fixed 3 broken links.'} : agent);
    window.setAgents(window.__host.agents);
  });
  await page.waitForFunction(() => /mode-flash/.test(document.getElementById('island').className));
  assert.match(await text(page, '#island'), /docs-site[\s\S]*Completed · Checks not verified[\s\S]*Rewrote the docs navigation/);
  await page.waitForTimeout(700);
  await shot('island-flash');
  await page.click('#island');
  await page.waitForFunction(() => /mode-panel/.test(document.getElementById('island').className));
  assert.equal(await page.locator('#island .agent-row').count(), 3);
  await page.waitForTimeout(700);
  await shot('island-panel');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !/mode-panel/.test(document.getElementById('island').className));

  const row = page.locator('#tasks .row', {hasText: 'Review the product roadmap'});
  await row.locator('.check').click();
  assert.match(await row.getAttribute('class'), /completing/);
  assert.equal((await host()).workspace.tasks.find(t => t.title === 'Review the product roadmap').done, false, 'the task waits for its animation');
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Review the product roadmap').done);
  assert.equal(await page.locator('.burst').count() <= 1, true);
  await page.waitForTimeout(900);
  await shot('motion-after-complete');
});

await check('plan a task on several days and a range', {}, async ({page, tasks, shot}) => {
  const row = page.locator('#tasks .row', {hasText: 'Review the product roadmap'});
  await row.hover();
  await row.locator('[data-act="schedule"]').click();
  const picker = page.locator('.plan-picker');
  await picker.waitFor();
  // Add two separate days, then a three-day range, then remove one day.
  const pick = date => picker.locator('[data-day="' + date + '"]').click();
  const settle = () => page.waitForTimeout(150);
  await pick(day(2)); await settle();
  let planned = (await tasks()).find(t => t.title === 'Review the product roadmap');
  assert.deepEqual(planned.plannedDates, [day(0), day(2)]);
  assert.equal(planned.planned, day(0));
  await shot('plan-days');
  // Ranges that cross a month end show the next month first.
  const pickAny = async date => {
    for (let i = 0; i < 3 && !(await picker.locator('[data-day="' + date + '"]').count()); i++) await picker.locator('[data-month="1"]').click();
    await pick(date); await settle();
  };
  await picker.locator('[data-mode="range"]').click();
  await pickAny(day(5)); await pickAny(day(7));
  planned = (await tasks()).find(t => t.title === 'Review the product roadmap');
  assert.deepEqual(planned.plannedDates, [day(0), day(2), day(5), day(6), day(7)]);
  await picker.locator('[data-remove="' + day(6) + '"]').click(); await settle();
  planned = (await tasks()).find(t => t.title === 'Review the product roadmap');
  assert.deepEqual(planned.plannedDates, [day(0), day(2), day(5), day(7)]);
  await picker.locator('[data-plan-done]').click();
  // Upcoming lists the task under each planned day.
  await page.click('#nav [data-view="upcoming"]');
  const groups = await page.locator('.day-group').evaluateAll(nodes => nodes.filter(node => node.textContent.includes('Review the product roadmap')).length);
  assert.equal(groups, 3, 'shown on day +2, +5 and +7');
  // Completing it completes the whole task once, not one day at a time.
  await page.click('#nav [data-view="today"]');
  await page.locator('#tasks .row', {hasText: 'Review the product roadmap'}).locator('[data-act="toggle"]').click();
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Review the product roadmap').done);
  assert.equal((await tasks()).filter(t => t.title === 'Review the product roadmap').length, 1);
});

await check('planned days in details, and not overdue while a day remains', {}, async ({page, tasks}) => {
  // "Review QA feedback" was planned yesterday. Adding tomorrow keeps it off the overdue list.
  await page.locator('#tasks .row', {hasText: 'Review QA feedback'}).locator('.task-body').click();
  await page.click('#plannedToggle');
  assert.equal(await page.getAttribute('#plannedToggle', 'aria-expanded'), 'true');
  await page.locator('#plannedPicker [data-day="' + day(1) + '"]').click();
  assert.match(await text(page, '#plannedToggle'), /and/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(d => window.__host.workspace.tasks.find(t => t.title === 'Review QA feedback').plannedDates?.includes(d), day(1));
  const task = (await tasks()).find(t => t.title === 'Review QA feedback');
  assert.deepEqual(task.plannedDates, [day(-1), day(1)]);
  assert.equal(task.planned, day(1));
  assert.equal(await page.locator('#tasks .row', {hasText: 'Review QA feedback'}).count(), 0, 'no longer overdue in Today');
});

await check('row actions without right-click', {}, async ({page}) => {
  const row = page.locator('#tasks .row', {hasText: 'Organize the review notes'});
  // Hidden until hover or keyboard focus, then visible and labelled.
  assert.equal(await row.locator('.row-actions').evaluate(node => getComputedStyle(node).opacity), '0');
  await row.locator('.task-body').focus();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  assert.equal(await row.locator('.row-actions').evaluate(node => getComputedStyle(node).opacity), '1');
  assert.deepEqual(await row.locator('.row-icon').evaluateAll(nodes => nodes.map(n => n.getAttribute('title'))), ['Plan days', 'Details', 'More']);
  await row.locator('[data-act="more"]').click();
  const labels = await page.locator('.menu button').allInnerTexts();
  assert.ok(labels.some(label => label.includes('Choose Days')), 'More offers multi-day planning');
  assert.ok(labels.some(label => label.includes('Edit Details')));
  await page.keyboard.press('Escape');
  await row.locator('[data-act="edit"].row-icon').click();
  await page.locator('#dialog[open]').waitFor();
  assert.equal(await page.inputValue('#fieldTitle'), 'Organize the review notes');
});

await check('backup: export, preview, import and undo', {}, async ({page, host, tasks}) => {
  await page.click('#boardMore');
  await page.click('#backupExport');
  await page.waitForFunction(() => window.__host.backupFile);
  const backup = JSON.parse((await host()).backupFile);
  assert.equal(backup.format, 'shishi-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.workspace.tasks.length, 18);
  assert.doesNotMatch(JSON.stringify(backup), /token|secret|password/i);
  // Change something, then restore the backup on top of it.
  await page.evaluate(() => window.__host.workspace.tasks.length);
  await page.locator('#tasks .row', {hasText: 'Organize the review notes'}).locator('[data-act="toggle"]').click();
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.title === 'Organize the review notes').done);
  backup.workspace.tasks = backup.workspace.tasks.slice(0, 3);
  await page.evaluate(text => { window.__host.importFile = {name: 'Shishi Backup.json', text}; }, JSON.stringify(backup));
  await page.click('#boardMore');
  await page.click('#backupImport');
  await page.locator('#confirmImport').waitFor();
  assert.match(await text(page, '#dialogBody'), /3\s*Tasks[\s\S]*replaces your current 18 tasks/);
  await page.click('#confirmImport');
  await page.waitForFunction(() => window.__host.workspace.tasks.length === 3);
  assert.equal((await host()).snapshots, 1, 'a copy of the current data is saved first');
  await page.locator('#toast button', {hasText: 'Undo'}).click();
  await page.waitForFunction(() => window.__host.workspace.tasks.length === 18);
  assert.equal((await tasks()).find(t => t.title === 'Organize the review notes').done, true, 'undo restores the data from before the import');
});

await check('backup: invalid files change nothing', {}, async ({page, tasks}) => {
  const tries = [
    ['not json', /not valid JSON/],
    [JSON.stringify({format: 'something-else'}), /not a Shishi backup/],
    [JSON.stringify({format: 'shishi-backup', version: 9, workspace: {version: 1, projects: ['A'], tasks: []}}), /newer version/],
    [JSON.stringify({format: 'shishi-backup', version: 1, workspace: {version: 1, projects: ['A'], tasks: [{id: 'x', title: 'T', project: 'B', dueTime: '09:00'}]}}), /list that is not in the backup[\s\S]*time without a valid date/],
    [JSON.stringify({format: 'shishi-backup', version: 1, workspace: {version: 1, projects: ['A'], tasks: [], notion: {token: 'abc'}}}), /look like credentials/]
  ];
  for (const [body, pattern] of tries) {
    await page.evaluate(text => { window.__host.importFile = {name: 'bad.json', text}; }, body);
    await page.click('#boardMore');
    await page.click('#backupImport');
    await page.locator('#dialog[open] .import-problems').waitFor();
    assert.match(await text(page, '#dialogBody'), pattern);
    assert.equal(await page.locator('#confirmImport').count(), 0);
    await page.click('#dialog [data-close]');
    await page.locator('#dialog[open]').waitFor({state: 'detached'}).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('#dialog').open);
  }
  assert.equal((await tasks()).length, 18);
});

await check('native capture flags open the right sheets', {}, async ({page}) => {
  await page.evaluate(() => window.showForCapture('schedule'));
  await page.locator('#plannedPicker:not([hidden]) .day-picker').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#dialog').open);
  await page.evaluate(() => window.showForCapture('connections'));
  await page.locator('.color-picker').waitFor();
});

await check('agents: current tool, stopped sessions, settings and diagnostics', {}, async ({page, host}) => {
  // A working session shows what it is doing now; a session whose process died shows Stopped.
  assert.match(await text(page, '#agentList'), /Working · Edit billing\.py · 14 tools/);
  await page.evaluate(() => {
    const rows = window.__host.agents.map(row => row.state === 'working' ? {...row, state: 'idle', ended: true, activity: '', detail: 'The session ended without a final reply.'} : row);
    window.setAgents(rows);
  });
  assert.match(await text(page, '#agentList'), /Stopped · The session ended without a final reply\./);
  await page.click('#boardMore');
  await page.click('#openConnectors');
  const hotkeys = page.locator('[data-setting="hotkeys"]'), awake = page.locator('[data-setting="keepAwake"]');
  await page.waitForFunction(() => !document.querySelector('[data-setting="hotkeys"]').disabled);
  assert.deepEqual([await hotkeys.isChecked(), await awake.isChecked()], [true, false]);
  await awake.check();
  await page.waitForFunction(() => window.__host.settings.keepAwake === true);
  await page.click('[data-settings-tab="general"]');
  assert.match(await text(page, '#hotkeyNote'), /⌃⌥Space shows or hides the card\. ⌃⌥N adds a task\./);
  await hotkeys.uncheck();
  await page.waitForFunction(() => window.__host.settings.hotkeys === false);
  await page.click('[data-settings-tab="agents"]');

  await page.click('#hookLogBox summary');
  await page.locator('#hookLog .hook-outcome').first().waitFor();
  assert.match(await text(page, '#hookLog'), /PostToolUse[\s\S]*session 1a2b3c4d[\s\S]*delivered[\s\S]*Unreadable event[\s\S]*problem:/);
});

await check('global shortcut focuses the card add field', {width: 340, height: 600, compact: true}, async ({page}) => {
  await page.evaluate(() => window.focusQuickAdd());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cardAddInput');
});

await check('approve a permission request from the card', {width: 340, height: 640, compact: true, scale: 2}, async ({page, host, shot}) => {
  const now = Date.now() / 1000;
  await page.evaluate(now => window.setApprovals([
    {id: 'a'.repeat(32), session: 's', source: 'Claude Code', project: 'web-app', tool: 'Bash', detail: 'rm -rf node_modules && npm install', reason: 'Clean install', time: now, expires: now + 25}
  ]), now);
  const box = page.locator('#cardApprovals');
  await box.waitFor();
  assert.match(await box.innerText(), /web-app[\s\S]*Claude Code wants to use Bash: Clean install[\s\S]*rm -rf node_modules && npm install[\s\S]*Then it asks in the terminal/);
  assert.match(await box.locator('[data-left]').innerText(), /^2[45] s$/);
  // The same session's request is not repeated as a "Needs you" report while Allow and Deny are on the card.
  await page.evaluate(() => window.setAgents(window.__host.agents.map(row => row.state === 'attention' ? {...row, approval: 'a'.repeat(32)} : row)));
  await page.waitForFunction(() => !/Needs you/.test(document.getElementById('cardReport').innerText));
  await shot('card-approval');
  await box.locator('[data-answer="allow"]').click();
  await page.waitForFunction(() => window.__host.answers?.length === 1);
  assert.deepEqual((await host()).answers[0], {request: 'a'.repeat(32), behavior: 'allow'});
  assert.equal(await box.isHidden(), true);
  assert.match(await text(page, '#toast'), /Allowed/);
  // An answer that arrives too late says so, and an expired request disappears by itself.
  await page.evaluate(now => window.setApprovals([{id: 'gone', project: 'api', tool: 'Edit', detail: 'a.py', time: now, expires: now + 30},
                                                   {id: 'b'.repeat(32), project: 'old', tool: 'Bash', detail: 'ls', time: now - 30, expires: now + 1.2}]), now);
  await page.locator('#cardApprovals [data-approval="gone"] [data-answer="deny"]').click();
  await page.waitForFunction(() => /no longer waiting/.test(document.getElementById('toast').textContent));
  await page.waitForFunction(() => !document.querySelector('[data-approval]'), null, {timeout: 5000});
});

await check('approvals and alerts in Connections', {}, async ({page, host}) => {
  await page.evaluate(() => { window.__host.claude = {installed: true, working: true, cli: true, problem: '', approvals: false}; });
  await page.click('#boardMore');
  await page.click('#openConnectors');
  await page.locator('#approvalRow:not([hidden])').waitFor();
  await page.check('#approvalChoice');
  await page.waitForFunction(() => window.__host.claude.approvals === true);
  assert.match(await text(page, '#toast'), /Permission requests now come to Shishi first/);
  await page.selectOption('#approvalWait', '45');
  await page.waitForFunction(() => window.__host.approvalWait === 45);
  await page.click('[data-settings-tab="alerts"]');
  // Alerts are off until chosen; sound and banner follow the two triggers.
  await page.waitForFunction(() => !document.querySelector('[data-alert="needsYou"]').disabled);
  assert.equal(await page.locator('[data-alert="sound"]').isDisabled(), true);
  await page.check('[data-alert="needsYou"]');
  await page.waitForFunction(() => window.__host.alerts.needsYou === true && !document.querySelector('[data-alert="sound"]').disabled);
  await page.fill('[data-alert="quietFrom"]', '22:00');
  await page.locator('[data-alert="quietFrom"]').dispatchEvent('change');
  await page.fill('[data-alert="quietTo"]', '08:00');
  await page.locator('[data-alert="quietTo"]').dispatchEvent('change');
  await page.waitForFunction(() => window.__host.alerts.quietTo === '08:00');
  assert.match(await text(page, '#quietNote'), /from 22:00 to 08:00/);
  await page.selectOption('[data-alert="remindAfter"]', '10');
  await page.waitForFunction(() => window.__host.alerts.remindAfter === 10);
  await page.click('#testAlert');
  await page.waitForFunction(() => window.__host.testAlerts === 1);
  // Reconnecting keeps the approval choice.
  await page.click('[data-settings-tab="agents"]');
  await page.click('#claudeConnection');
  await page.waitForFunction(() => window.__host.claude.installed === false);
  await page.click('#claudeConnection');
  await page.waitForFunction(() => window.__host.claude.installed === true);
});

await check('usage and limits under Agents, exact tab', {width: 1040, height: 760}, async ({page, host}) => {
  await page.locator('#agentUsage:not([hidden])').waitFor();
  const usage = await text(page, '#agentUsage');
  assert.match(usage, /Claude Code\s*1\.2M \/ 5 h · 8\.4M \/ week/);
  assert.match(usage, /Codex\s*42% \/ 5 h · 83% \/ week/);
  assert.match(await page.locator('.usage-row').nth(1).getAttribute('title'), /42% of the 5-hour limit, resets[\s\S]*83% of the weekly limit, resets/);
  assert.equal(await page.locator('.usage-row.high').count(), 1, 'a limit above 80% stands out');
  assert.match(await page.locator('.usage-row').first().getAttribute('title'), /counts, not a percentage/);
  // Turning usage off hides it.
  await page.click('#boardMore');
  await page.click('#openConnectors');
  await page.waitForFunction(() => !document.querySelector('[data-setting="usage"]').disabled);
  await page.uncheck('[data-setting="usage"]');
  await page.waitForFunction(() => document.getElementById('agentUsage').hidden);
  await page.keyboard.press('Escape');
});

await check('open the exact terminal tab, and say when only the app opened', {width: 340, height: 640, compact: true}, async ({page, host}) => {
  await page.click('#cardReport [data-report="open"]');
  await page.waitForFunction(() => window.__host.openedApp === 'com.apple.Terminal');
  assert.deepEqual((await host()).openedPlace, {terminal: {tty: 'ttys004'}, cwd: '/Users/me/code/web-app'});
  await page.evaluate(() => { window.__host.focusResult = 'app'; });
  await page.click('#cardReport [data-report="open"]');
  await page.waitForFunction(() => /Privacy → Automation/.test(document.getElementById('toast').textContent));
});

await check('shishi:// links add a task or show a view, nothing else', {}, async ({page, tasks}) => {
  await page.evaluate(() => window.openURLAction({action: 'add', text: 'Pay rent tomorrow 9am !p1', list: 'personal', notes: 'From Shortcuts'}));
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Pay rent'));
  const added = (await tasks()).find(t => t.title === 'Pay rent');
  assert.deepEqual([added.project, added.dueDate, added.dueTime, added.priority, added.notes], ['Personal', day(1), '09:00', 'P1', 'From Shortcuts']);
  assert.match(await text(page, '#toast'), /Added “Pay rent” from a link/);
  await page.locator('#toast button', {hasText: 'Undo'}).click();
  await page.waitForFunction(() => !window.__host.workspace.tasks.some(t => t.title === 'Pay rent'));
  await page.evaluate(() => window.openURLAction({action: 'open', view: 'upcoming'}));
  assert.equal(await text(page, '#pageTitle'), 'Upcoming');
  await page.evaluate(() => window.openURLAction({action: 'add', text: '   '}));
  assert.match(await text(page, '#toast'), /no task title/);
  await page.evaluate(() => window.openURLAction({action: 'delete', id: 'x'}));
  assert.equal((await tasks()).length, 18);
  await page.evaluate(() => window.openURLAction({action: 'search', q: 'roadmap'}));
  await page.locator('#palette[open]').waitFor();
  assert.equal(await page.inputValue('#paletteInput'), 'roadmap');
});

await check('Apple Reminders: sync a list both ways', {}, async ({page, host, tasks}) => {
  await page.click('#boardMore');
  await page.click('#openConnectors');
  await page.click('[data-settings-tab="sync"]');
  await page.click('#remindersRow');
  await page.locator('#remindersForm').waitFor();
  await page.selectOption('#remindersList', 'L2');
  await page.selectOption('#remindersProject', 'Personal');
  await page.click('#remindersForm .primary');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Buy milk'));
  const milk = (await tasks()).find(t => t.title === 'Buy milk');
  assert.deepEqual([milk.project, milk.reminder.id], ['Personal', 'R1']);
  assert.equal((await tasks()).some(t => t.title === 'Old reminder'), false, 'completed reminders are not imported');
  // Personal's own open tasks went to Reminders and are now linked.
  await page.waitForFunction(() => window.__host.reminderPushes?.length);
  const personal = (await tasks()).filter(t => t.project === 'Personal');
  assert.ok(personal.every(t => t.reminder?.id), 'every task in the list is linked');
  assert.match(await text(page, '#remindersStatus'), /Personal” · \d+ tasks linked/);
  assert.equal((await host()).workspace.reminders.title, 'Errands');
  await page.click('#remindersDisconnect');
  await page.waitForFunction(() => !window.__host.workspace.reminders);
  assert.equal((await tasks()).some(t => t.reminder), false);
});

await check('calendar events in Today, Upcoming and the card', {}, async ({page, host}) => {
  await page.click('#boardMore');
  await page.click('#openConnectors');
  await page.click('[data-settings-tab="sync"]');
  await page.check('#calendarChoice');
  await page.waitForFunction(() => window.__host.workspace.calendar?.enabled);
  await page.evaluate(() => closeDialog(true));
  await page.locator('#tasks .calendar-event').first().waitFor();
  assert.match(await text(page, '#tasks .calendar-events'), /11:30 PM\s*Standup/);
  assert.equal((await host()).calendarAsked.days, 8);
  await page.click('#nav [data-view="upcoming"]');
  const groups = await page.locator('.day-group').allInnerTexts();
  assert.match(groups.find(g => g.startsWith('Tomorrow')), /All day\s*Holiday/);
  assert.ok(groups.some(g => /3:00 PM\s*Design review/.test(g)));
  await page.evaluate(() => window.setCompact(true));
  await page.waitForFunction(() => !document.getElementById('cardNextEvent').hidden);
  assert.equal(await text(page, '#cardNextEvent'), 'Next: 11:30 PM Standup');
});

await check('GitHub issues become tasks', {}, async ({page, host, tasks}) => {
  await page.click('#boardMore');
  await page.click('#openConnectors');
  await page.click('[data-settings-tab="sync"]');
  await page.click('#issuesRow');
  await page.fill('#issuesRepo', 'acme/missing');
  await page.click('#issuesForm .primary');
  await page.waitForFunction(() => /exists and is public/.test(document.getElementById('issuesFeedback').textContent));
  await page.fill('#issuesRepo', 'acme/app');
  await page.fill('#issuesAssignee', 'octocat');
  await page.click('#issuesForm .primary');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.github?.number === 12));
  const task = (await tasks()).find(t => t.github?.number === 12);
  assert.deepEqual([task.title, task.project], ['Crash on login', 'app']);
  assert.equal((await tasks()).some(t => t.github?.number === 9), false);
  assert.equal((await host()).issueRequests.at(-1).assignee, 'octocat');
  // The issue closes on GitHub: Import Now completes the task.
  await page.evaluate(() => { window.__host.issues = [{number: 12, title: 'Crash on login', state: 'closed', url: 'https://github.com/acme/app/issues/12'}]; });
  await page.click('#issuesSync');
  await page.waitForFunction(() => window.__host.workspace.tasks.find(t => t.github?.number === 12).done);
  await page.evaluate(() => closeDialog(true));
  await page.click('#nav [data-view="done"]');
  await page.locator('.row', {hasText: 'Crash on login'}).first().locator('.task-body').click();
  await page.click('#openIssue');
  await page.waitForFunction(() => window.__host.openedIssue === 'https://github.com/acme/app/issues/12');
});

await check('send a task to Claude Code and follow it back', {}, async ({page, host, tasks}) => {
  const id = (await tasks()).find(t => t.title === 'Review the product roadmap').id;
  const row = () => page.locator('#tasks .row', {hasText: 'Review the product roadmap'});
  await row().locator('[data-act="more"]').click();
  await page.locator('.menu button', {hasText: 'Send to Claude Code'}).click();
  await page.waitForFunction(() => window.__host.started?.length === 1);
  const started = (await host()).started[0];
  assert.deepEqual([started.agent, started.folder, started.task, started.terminal], ['claude', '/Users/me/code/app', id, 'Terminal']);
  assert.match(started.prompt, /^Review the product roadmap/);
  assert.equal((await host()).workspace.projectFolders['Product ideas'], '/Users/me/code/app', 'the folder is remembered for the list');
  assert.match(await text(page, '#toast'), /Claude Code started in Terminal/);
  // The linked session shows on the task row while it works, then its report and time attach to the task.
  const now = Date.now() / 1000;
  const working = {key: '7'.repeat(64), source: 'Claude Code', title: 'Claude Code · app', detail: '', state: 'working', time: now, started: now - 600, shishiTask: id, activity: 'Edit roadmap.md', receipt: ''};
  await page.evaluate(rows => window.setAgents([...window.__host.agents, ...rows]), [working]);
  await page.waitForFunction(() => /Claude Code working/.test(document.querySelector('#tasks').innerText));
  const receipt = 'connector/' + '7'.repeat(64);
  await page.evaluate(([row, receipt]) => {
    const host = window.__host;
    host.notices.external.unshift({id: receipt, source: 'Claude Code', title: 'Claude Code · app', time: row.time + 900, read: false, thread: '', link: '', summary: 'Updated roadmap.md. Tests: 3 passed.'});
    window.setInbox({channel: 'external', items: host.notices.external, error: ''});
    window.setAgents([...host.agents, {...row, state: 'done', time: row.time + 900, receipt, facts: {files: ['roadmap.md'], fileCount: 1, commands: 1, failedTools: 0, tests: 'passed', testCommand: 'npm test'}}]);
  }, [working, receipt]);
  await page.waitForFunction(id => window.__host.workspace.tasks.find(t => t.id === id).agentRuns?.length === 1, id);
  const linked = (await tasks()).find(t => t.id === id);
  assert.deepEqual([linked.agentReceipt, linked.agentRuns[0].seconds], [receipt, 1500]);
  await page.waitForFunction(() => /Completed · Checks passed · 25 min/.test(document.querySelector('#tasks').innerText));
  // A second delivery of the same state adds nothing.
  await page.evaluate(() => window.setAgents(window.__host.agents.concat([])));
  assert.equal((await tasks()).find(t => t.id === id).agentRuns.length, 1);
  // Details show the time and the report; Wrap Up counts agent minutes.
  await row().locator('.task-body').click();
  assert.match(await text(page, '#agentTask'), /Agents worked 25 min over 1 run · in ~\/code\/app/);
  await page.evaluate(() => closeDialog(true));
  await page.click('#wrapUp');
  assert.match(await text(page, '#dialogBody'), /25\s*Agent minutes/);
  await page.evaluate(() => closeDialog(true));
  // Checking the task off clears its report.
  await row().locator('[data-act="toggle"]').click();
  await page.waitForFunction(receipt => window.__host.notices.external.find(n => n.id === receipt)?.read, receipt);
});

await check('update check: quiet, once per version, never installs', {}, async ({page, host}) => {
  await page.click('#boardMore');
  await page.click('#openConnectors');
  await page.click('[data-settings-tab="general"]');
  await page.waitForFunction(() => !document.getElementById('updateChoice').disabled);
  assert.match(await text(page, '#updateNote'), /latest published version \(1\.7\)/);
  await page.evaluate(() => { window.__host.latestRelease = '1.8'; });
  await page.click('#checkUpdate');
  await page.waitForFunction(() => /1\.8 is available/.test(document.getElementById('updateNote').textContent));
  assert.match(await text(page, '#toast'), /Shishi 1\.8 is available/);
  await page.locator('#toast button', {hasText: 'View'}).click();
  await page.waitForFunction(() => window.__host.openedRelease === 'https://github.com/shen25308/small-tool/releases/tag/v1.8');
  await page.uncheck('#updateChoice');
  await page.waitForFunction(() => window.__host.updatesOn === false);
});

await check('first launch with no data', {workspace: null, empty: true}, async ({page, tasks, shot}) => {
  assert.equal(await text(page, '#pageTitle'), 'Today');
  assert.match(await text(page, '#tasks'), /Nothing planned for today/);
  assert.match(await text(page, '#agentList'), /appear here while they work/);
  await shot('empty');
  await page.click('#tasks [data-quick="view"]');
  await page.locator('.quick-add input').fill('First task');
  await page.locator('.quick-add input').press('Enter');
  await page.waitForFunction(() => window.__host.workspace?.tasks?.length === 1);
  const [first] = await tasks();
  assert.deepEqual([first.project, first.priority, first.planned], ['My Work', 'P2', day(0)]);
});

await browser.close();
console.log(results.join('\n'));
if (results.some(line => line.startsWith('FAIL'))) process.exit(1);
