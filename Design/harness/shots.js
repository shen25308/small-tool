// Headless screenshots of the real UI files with a mocked native host.
// usage: node shots.js <outDir> [--css extra.css] [--only name,name] [--scale 2] [--schemes light,dark]
const {chromium} = require('playwright');
const path = require('path'), fs = require('fs');
const args = process.argv.slice(2), out = path.resolve(args[0] || 'out');
const opt = name => { const i = args.indexOf('--' + name); return i < 0 ? '' : args[i + 1]; };
const only = opt('only') ? opt('only').split(',') : null, scale = Number(opt('scale') || 2);
const schemes = (opt('schemes') || 'light,dark').split(','), extra = opt('css') ? fs.readFileSync(opt('css'), 'utf8') : '';
const ui = file => 'file://' + path.resolve(__dirname, '../../UI', file);
const firstAgentCard = '#inboxCards .result-card[data-notice="c1/t3"] .result-preview';

const scenes = [
  {name: 'today', size: [760, 800]},
  {name: 'today-narrow', size: [635, 520]},
  {name: 'plan', size: [760, 800], run: async p => { await p.evaluate(() => document.querySelector('#pool').scrollIntoView({block: 'start'})); }},
  {name: 'project', size: [760, 620], run: async p => { await p.click('#projects button >> nth=0'); }},
  {name: 'row-hover', size: [760, 420], run: async p => { await p.hover('.row >> nth=6'); }},
  {name: 'row-focus', size: [760, 420], run: async p => { await p.focus('.row >> nth=3 >> .task-body'); await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab'); }},
  {name: 'menu', size: [760, 420], run: async p => { await p.click('#boardMore'); }},
  {name: 'tag-picker', size: [760, 520], run: async p => { await p.click('.row >> nth=1 >> .task-tag'); }},
  {name: 'deadline', size: [760, 520], run: async p => { await p.click('.row >> nth=1 >> .task-deadline'); }},
  {name: 'task-dialog', size: [760, 620], run: async p => { await p.click('.row >> nth=1 >> .task-body'); }},
  {name: 'capture', size: [760, 800], run: async p => { await p.click('#boardMore'); await p.click('#openCapture'); await p.click('#demoText'); await p.click('#recognize'); await p.waitForSelector('.candidate'); }},
  {name: 'capture-busy', size: [760, 520], init: () => { window.__slowExtract = 60000; }, run: async p => { await p.click('#boardMore'); await p.click('#openCapture'); await p.click('#demoText'); await p.click('#recognize'); }},
  {name: 'capture-error', size: [760, 520], init: () => { window.__extractFails = true; }, run: async p => { await p.click('#boardMore'); await p.click('#openCapture'); await p.click('#demoText'); await p.click('#recognize'); await p.waitForSelector('.feedback'); }},
  {name: 'search', size: [760, 620], run: async p => { await p.click('#searchTasks'); await p.fill('#searchQuery', 're'); }},
  {name: 'wrap-up', size: [760, 620], run: async p => { await p.click('#wrapUp'); }},
  {name: 'inbox', size: [760, 800], run: async p => { await p.click('#inboxButton'); }},
  {name: 'inbox-open', size: [760, 800], run: async p => { await p.click('#inboxButton'); await p.click(firstAgentCard); }},
  {name: 'inbox-reading', size: [760, 800], run: async p => { await p.click('#inboxButton'); await p.click(firstAgentCard); await p.click('#inboxCards .result-card[data-notice="c1/t3"] .result-expand'); }},
  {name: 'inbox-observed', size: [760, 800], run: async p => { await p.click('#inboxButton'); await p.click('#inboxCards .result-card[data-notice="gh/1"] .result-preview'); await p.click('#inboxCards .result-card[data-notice="gh/2"] .result-preview'); }},
  {name: 'inbox-syncing', size: [760, 520], init: () => { window.__slowSync = 60000; }, run: async p => { await p.click('#inboxButton'); await p.click('#syncInbox'); }},
  {name: 'inbox-empty', size: [760, 520], init: () => { window.__shishiCodex = []; window.__shishiConnector = []; }, run: async p => { await p.click('#inboxButton'); }},
  {name: 'connectors', size: [760, 800], run: async p => { await p.click('#inboxButton'); await p.click('#connectors'); await p.waitForSelector('.provider-row'); }},
  {name: 'latest-result', size: [760, 620], run: async p => { await p.click('#boardMore'); await p.click('#peekLatest'); await p.click('#latestCard .result-preview'); }},
  {name: 'empty-today', size: [760, 520], init: () => { window.__shishiState = {version: 1, projects: ['My Work'], labels: [], tasks: []}; }},
  {name: 'load-error', size: [760, 420], init: () => { window.__loadFails = true; }},
  {name: 'compact', size: [356, 484], run: async p => { await p.evaluate(() => window.setCompact(true)); }},
  {name: 'compact-min', size: [300, 320], run: async p => { await p.evaluate(() => window.setCompact(true)); }},
  {name: 'compact-result', size: [382, 484], run: async p => { await p.evaluate(() => window.setCompact(true)); await p.click('#boardMore'); await p.click('#peekLatest'); await p.click('#latestCard .result-preview'); }},
  {name: 'compact-inbox', size: [356, 484], run: async p => { await p.evaluate(() => window.setCompact(true)); await p.click('#inboxButton'); await p.click(firstAgentCard); }},
  {name: 'panel-preview', page: 'result-panel.html', size: [292, 80]},
  {name: 'panel-details', page: 'result-panel.html', size: [372, 272], run: async p => { await p.click('.result-preview'); }},
  {name: 'panel-original', page: 'result-panel.html', size: [410, 430], run: async p => { await p.click('.result-preview'); await p.click('#edgeExpand'); }},
  {name: 'panel-empty', page: 'result-panel.html', size: [292, 80], init: () => { window.__shishiCodex = []; window.__shishiConnector = []; }}
];

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch();
  const problems = [];
  for (const scheme of schemes) for (const scene of scenes) {
    if (only && !only.includes(scene.name)) continue;
    const page = await browser.newPage({viewport: {width: scene.size[0], height: scene.size[1]}, deviceScaleFactor: scale, colorScheme: scheme});
    page.on('pageerror', e => problems.push(scene.name + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') problems.push(scene.name + ': ' + m.text()); });
    if (scene.init) await page.addInitScript(scene.init);
    await page.addInitScript({path: path.join(__dirname, 'mock-host.js')});
    await page.goto(ui(scene.page || 'index.html'));
    if (extra) await page.addStyleTag({content: extra}).catch(() => page.evaluate(css => { const s = new CSSStyleSheet(); s.replaceSync(css); document.adoptedStyleSheets = [s]; }, extra));
    await page.waitForTimeout(250);
    try { if (scene.run) await scene.run(page); } catch (e) { problems.push(scene.name + ' (' + scheme + '): ' + e.message.split('\n')[0]); }
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) problems.push(scene.name + ' (' + scheme + '): horizontal overflow');
    await page.screenshot({path: path.join(out, scene.name + '-' + scheme + '.png')});
    await page.close();
  }
  await browser.close();
  console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'no problems');
})();
