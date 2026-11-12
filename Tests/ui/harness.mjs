// Opens the Shishi UI in Chromium with a stand-in for the native app, for checks and screenshots.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

// require() also finds a globally installed Playwright.
const {chromium} = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const iso = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');

export function sampleWorkspace() {
  const text = readFileSync(path.join(root, 'Tests/ci/sample-workspace.json'), 'utf8');
  return JSON.parse(text.replace(/"@(-?\d+)/g, (_, days) => { const date = new Date(); date.setDate(date.getDate() + Number(days)); return '"' + iso(date); }));
}

// Runs inside the page before any app script. It answers the same messages the Swift host answers.
function fakeHost(seed) {
  const now = Date.now() / 1000;
  const state = {
    workspace: seed.workspace, saves: 0, clipboard: '', codex: true, menuBar: true, edgeMail: false, edge: false,
    claude: {installed: false, working: false, cli: true, problem: ''}, notionConnected: false, notionPushes: [],
    notionPages: [
      {id: 'aaaaaaaa-0000-0000-0000-000000000001', url: '', edited: 'e1', title: 'Plan the launch post', done: false, due: seed.tomorrow, priority: 'P1', tag: 'Marketing'},
      {id: 'aaaaaaaa-0000-0000-0000-000000000002', url: '', edited: 'e1', title: 'Old finished page', done: true, due: '', priority: '', tag: ''}
    ],
    notices: seed.empty ? {codex: [], external: []} : {
      codex: [{id: 'thread-1/turn-1', thread: '11111111-1111-4111-8111-111111111111', title: 'Codex · api-server', time: now - 1500, read: false,
               summary: 'Fixed the pagination bug in `routes/users.ts` and added a regression test.\n\nTests: 48 passed.'}],
      external: [
        {id: 'connector/' + 'a'.repeat(64), source: 'Claude Code', title: 'Claude Code · small-tool', time: now - 240, read: false, thread: '', link: '',
         summary: 'Updated `billing.py` and added 12 tests. All checks pass.\n\nNext step: review the migration before deploying.'},
        {id: 'connector/' + 'b'.repeat(64), source: 'GitHub Actions', title: 'CI · main · success', time: now - 7200, read: true, thread: '', link: '', summary: 'Run 128 finished on main.'},
        {id: 'connector/' + 'c'.repeat(64), source: 'Reminders', title: 'Send the release checklist', time: now - 9000, read: true, thread: '', link: '', summary: 'Due today at 15:00 (local time).'}
      ]
    },
    agents: seed.empty ? [] : [
      {key: 'e'.repeat(64), source: 'Claude Code', title: 'Claude Code · web-app', detail: 'Claude needs your permission to use Bash', state: 'attention', receipt: '', time: now - 50},
      {key: 'd'.repeat(64), source: 'Claude Code', title: 'Claude Code · docs-site', detail: 'Refactor the billing module and add tests', state: 'working', receipt: '', time: now - 95},
      {key: 'f'.repeat(64), source: 'Claude Code', title: 'Claude Code · small-tool', detail: 'Updated billing.py and added 12 tests. All checks pass.', state: 'done', receipt: 'connector/' + 'a'.repeat(64), time: now - 240}
    ]
  };
  window.__host = state;
  const push = channel => window.setInbox({channel, items: state.notices[channel], error: ''});
  const handlers = {
    load: () => state.workspace,
    save: message => { state.workspace = JSON.parse(JSON.stringify(message.state)); state.saves++; return true; },
    ready: () => {
      window.setChrome({titlebar: seed.titlebar, vibrant: false});
      if (seed.compact) window.setCompact(true);
      push('codex'); push('external');
      window.setAgents(state.agents);
      window.setEdgeVisible(false);
      return true;
    },
    syncInboxes: () => true,
    readNotice: message => {
      const channel = message.channel || 'codex';
      const note = state.notices[channel].find(item => item.id === message.key);
      if (note) note.read = true;
      push(channel);
      return state.notices[channel];
    },
    codexConnection: message => { if (typeof message.enabled === 'boolean') state.codex = message.enabled; return state.codex; },
    externalProvider: message => message.provider === 'github' ? {connected: false} : {accounts: [], configuredDefault: false, connected: false},
    edgeMailPreference: message => { if (typeof message.value === 'boolean') state.edgeMail = message.value; return state.edgeMail; },
    appearance: message => { if (['system', 'light', 'dark'].includes(message.value)) state.appearance = message.value; return state.appearance || 'system'; },
    menuBar: message => { if (typeof message.value === 'boolean') state.menuBar = message.value; return state.menuBar; },
    edgeVisibility: message => { state.edge = !!message.value; window.setEdgeVisible(state.edge); return state.edge; },
    claudeCode: message => {
      if (message.action === 'install') state.claude = {installed: true, working: true, cli: true, problem: ''};
      if (message.action === 'remove') state.claude = {installed: false, working: false, cli: true, problem: ''};
      return state.claude;
    },
    notion: message => {
      if (message.action === 'status') return {connected: state.notionConnected};
      if (message.action === 'disconnect') { state.notionConnected = false; return {connected: false}; }
      const mapping = {title: 'Name', done: {name: 'Done', type: 'checkbox'}, due: 'Due', priority: {name: 'Priority', options: []}, tag: {name: 'Tags', type: 'multi_select'}};
      if (message.action === 'connect') { state.notionConnected = true; return {connected: true, database: '11111111-2222-3333-4444-555555555555', title: 'Team tasks', mapping}; }
      if (message.action === 'pull') return {connected: true, title: 'Team tasks', mapping, pages: state.notionPages, truncated: false};
      if (message.action === 'push') {
        state.notionPushes.push(...message.changes);
        return {connected: true, results: message.changes.map((change, index) => {
          const page = change.page ? state.notionPages.find(item => item.id === change.page)
            : {id: 'bbbbbbbb-0000-0000-0000-' + String(state.notionPages.length + index).padStart(12, '0'), url: '', title: '', done: false, due: '', priority: '', tag: ''};
          Object.assign(page, change.fields, {edited: 'e' + Date.now()});
          if (!change.page) state.notionPages.push(page);
          return {task: change.task, ok: true, page};
        })};
      }
      throw Error('Unsupported connector action.');
    },
    copy: message => { state.clipboard = message.text; return true; },
    paste: () => state.clipboard,
    dismissAgent: message => { state.agents = state.agents.filter(agent => agent.key !== message.key); window.setAgents(state.agents); return true; },
    compact: message => { window.setCompact(!!message.value); return true; },
    latestSize: () => true, openNotion: () => true, openCodex: () => true, openConnectorLink: () => true, copyConnectorSetup: () => true,
    returnToEdge: () => true,
    extract: () => [{title: 'Send the homepage prototype to the design team', quote: 'Maya: Please send the new homepage prototype…', tag: 'Design'}]
  };
  window.webkit = {messageHandlers: {host: {postMessage(message) {
    setTimeout(() => {
      try {
        const handler = handlers[message.op];
        if (!handler) throw Error('Unsupported action: ' + message.op);
        window.hostReply(message.id, true, handler(message));
      } catch (error) { window.hostReply(message.id, false, error.message); }
    }, 0);
  }}}};
}

export async function launch() { return chromium.launch(); }

export async function open(browser, {width = 1040, height = 760, dark = false, compact = false, empty = false, titlebar = 28, workspace, scale = 1} = {}) {
  const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: scale, colorScheme: dark ? 'dark' : 'light'});
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push('pageerror: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push('console: ' + message.text()); });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  await page.addInitScript(fakeHost, {workspace: workspace === undefined ? sampleWorkspace() : workspace, compact, empty, titlebar, tomorrow: iso(tomorrow)});
  // Chromium reports the Mac platform key as Meta, the same key the page listens for.
  await page.goto(pathToFileURL(path.join(root, 'UI/index.html')).href);
  await page.waitForFunction(() => window.__host && document.querySelector('#nav .smart-tile') && document.querySelector('#agentList'));
  await page.waitForTimeout(150);
  return {page, context, problems};
}
