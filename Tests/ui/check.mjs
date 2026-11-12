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
  assert.deepEqual(await page.locator('.quick-hint .chip').allInnerTexts(), ['Tomorrow', 'Due Tomorrow, 3:00 PM', 'Every week', 'P1', 'Finance']);
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
  await page.locator('.menu-item', {hasText: 'Tomorrow'}).click();
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
  await page.waitForSelector('#appearanceChoice [data-appearance="system"][aria-pressed="true"]');
  await page.click('#appearanceChoice [data-appearance="dark"]');
  await page.waitForFunction(() => window.__host.appearance === 'dark' && document.querySelector('[data-appearance="dark"]').getAttribute('aria-pressed') === 'true');
  await page.uncheck('#menuBarChoice');
  await page.waitForFunction(() => window.__host.menuBar === false);
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
  const natural = await page.evaluate(() => Math.ceil(document.querySelector('.card-inner').getBoundingClientRect().height));
  assert.equal((await host()).cardHeight, natural);

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

  await page.locator('.card-head').dispatchEvent('mousedown', {button: 0});
  await page.waitForFunction(() => window.__host.drags === 1);
  await page.locator('#cardTasks .row').first().dispatchEvent('mousedown', {button: 0});
  await page.waitForTimeout(100);
  assert.equal((await host()).drags, 1, 'a press on a task must not move the card');

  await page.evaluate(() => { window.__host.menuChoice = 'Move to Tomorrow'; });
  await page.locator('#cardTasks .row', {hasText: 'Prepare Friday'}).click({button: 'right'});
  await page.waitForFunction(d => window.__host.workspace.tasks.find(t => t.title === "Prepare Friday's update").planned === d, day(1));
  assert.ok((await host()).lastMenu.some(item => item.title === 'Keep Above Other Windows' && item.checked));

  await page.hover('#card');
  await page.click('#cardPin');
  await page.waitForFunction(() => window.__host.pinned === false && document.getElementById('cardPin').getAttribute('aria-pressed') === 'false');

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

await check('back to card after jumping to the workspace', {width: 340, height: 600, compact: true}, async ({page}) => {
  await page.locator('#cardTasks .row', {hasText: 'Organize the review notes'}).locator('.task-body').click();
  await page.waitForSelector('#taskForm');
  await page.click('#dialog [data-close]');
  assert.equal(await page.locator('#workspaceReturn').isVisible(), true);
  assert.equal(await text(page, '#workspaceReturn'), 'Back to card');
  await page.click('#workspaceReturn');
  await page.waitForFunction(() => compact && document.getElementById('workspaceReturn').hidden);
});

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
