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

await check('completing a repeating task schedules the next one', {}, async ({page, tasks}) => {
  await page.locator('#tasks .row', {hasText: "Prepare Friday's update"}).locator('.check').click();
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === "Prepare Friday's update").length === 2);
  const [finished, next] = (await tasks()).filter(t => t.title === "Prepare Friday's update");
  assert.equal(finished.done, true);
  assert.match(finished.completedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  assert.equal(finished.repeat, undefined);
  assert.deepEqual([next.done, next.repeat, next.planned, next.completedAt], [false, 'weekly', day(7), undefined]);
  assert.notEqual(next.id, finished.id);
  assert.match(await text(page, '#toast'), /Next one scheduled/);
  // Reopening the finished one must not create another copy.
  await page.locator('#tasks .row.done', {hasText: "Prepare Friday's update"}).locator('.check').click();
  await page.waitForFunction(() => window.__host.workspace.tasks.filter(t => t.title === "Prepare Friday's update" && !t.done).length === 2);
  assert.equal((await tasks()).filter(t => t.title === "Prepare Friday's update").length, 2);
});

await check('task details: notes, subtasks, deadline, repeat', {}, async ({page, tasks, shot}) => {
  await page.locator('#tasks .row', {hasText: 'Organize the review notes'}).locator('.task-body').click();
  await page.waitForSelector('#taskForm');
  assert.equal(await page.inputValue('#fieldTitle'), 'Organize the review notes');
  assert.equal(await page.locator('#subtaskList [data-sub-title]').count(), 3);
  await shot('task-details');
  await page.fill('#fieldNotes', 'Ask Maya first');
  await page.fill('#subtaskNew', 'Send the summary');
  await page.press('#subtaskNew', 'Enter');
  await page.locator('[data-sub-remove="0"]').click();
  await page.locator('[data-sub-done="0"]').check();
  await page.fill('#fieldDue', day(3));
  await page.fill('#fieldDueTime', '09:30');
  await page.selectOption('#fieldRepeat', 'monthly');
  await page.click('#taskForm .primary');
  await page.waitForFunction(() => !document.getElementById('dialog').open);
  const saved = (await tasks()).find(t => t.title === 'Organize the review notes');
  assert.deepEqual([saved.notes, saved.dueDate, saved.dueTime, saved.repeat], ['Ask Maya first', day(3), '09:30', 'monthly']);
  assert.deepEqual(saved.subtasks.map(s => [s.title, s.done]), [['Group by theme', true], ['Share with Maya', false], ['Send the summary', false]]);
  assert.match(await text(page, '#tasks .row:has-text("Organize the review notes") .row-meta'), /1\/3[\s\S]*Every month[\s\S]*Ask Maya first/);
  // Clearing optional fields removes them from the saved task.
  await page.locator('#tasks .row', {hasText: 'Organize the review notes'}).locator('.task-body').click();
  await page.fill('#fieldNotes', '');
  await page.fill('#fieldDue', '');
  await page.selectOption('#fieldRepeat', '');
  await page.click('#taskForm .primary');
  await page.waitForFunction(() => !document.getElementById('dialog').open);
  const cleared = (await tasks()).find(t => t.title === 'Organize the review notes');
  assert.deepEqual(['notes', 'dueDate', 'dueTime', 'repeat'].filter(key => key in cleared), []);
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

await check('floating Today window', {width: 356, height: 484, compact: true, scale: 2}, async ({page, shot}) => {
  assert.equal(await page.locator('aside').isHidden(), true);
  assert.equal(await page.locator('#agentBar .agent-row').count(), 3);
  assert.match(await text(page, '#agentBar'), /1 more/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.equal(overflow, 0);
  await shot('today-floating');
  await page.click('#tasks [data-quick="view"]');
  await page.locator('.quick-add input').fill('Stretch');
  await page.locator('.quick-add input').press('Enter');
  await page.waitForFunction(() => window.__host.workspace.tasks.some(t => t.title === 'Stretch'));
});

await check('floating Today window, dark', {width: 356, height: 484, compact: true, dark: true, scale: 2}, async ({shot}) => { await shot('today-floating-dark'); });

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
