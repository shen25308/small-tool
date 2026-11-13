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
      {key: 'e'.repeat(64), source: 'Claude Code', title: 'Claude Code · web-app', detail: 'Claude needs your permission to use Bash', state: 'attention', receipt: '', time: now - 50,
       task: 'Deploy the preview build', started: now - 400, app: 'com.apple.Terminal', cwd: '/Users/me/code/web-app', terminal: {tty: 'ttys004'}},
      {key: 'd'.repeat(64), source: 'Claude Code', title: 'Claude Code · docs-site', detail: 'Refactor the billing module and add tests', state: 'working', receipt: '', time: now - 95,
       task: 'Refactor the billing module and add tests', started: now - 95, app: 'com.microsoft.VSCode', activity: 'Edit billing.py', tools: 14},
      {key: 'f'.repeat(64), source: 'Claude Code', title: 'Claude Code · small-tool', detail: 'Updated billing.py and added 12 tests. All checks pass.', state: 'done', receipt: 'connector/' + 'a'.repeat(64), time: now - 240,
       task: 'Refactor billing.py and add tests for refunds', started: now - 540, app: 'com.googlecode.iterm2', cwd: '/Users/me/code/small-tool',
       facts: {files: ['billing.py', 'tests/test_billing.py'], fileCount: 2, commands: 3, failedTools: 0, tests: 'passed', testCommand: 'pytest -q'}}
    ]
  };
  window.__host = state;
  const push = channel => window.setInbox({channel, items: state.notices[channel], error: ''});
  const handlers = {
    load: () => state.workspace,
    save: async message => {
      if (state.saveDelay) await new Promise(done => setTimeout(done, state.saveDelay));
      if (state.failSave) throw Error(state.failSave);
      state.workspace = JSON.parse(JSON.stringify(message.state)); state.saves++; return true;
    },
    ready: () => {
      window.setChrome({titlebar: seed.titlebar, vibrant: false});
      if (seed.compact) window.setCompact(true);
      push('codex'); push('external');
      window.setAgents(state.agents);
      window.setCapabilities({capture: !seed.lite, canDownloadModel: !!seed.lite, downloading: false});
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
    noticeState: message => {
      const channel = message.channel || 'codex';
      const note = state.notices[channel].find(item => item.id === message.key);
      if (!note) throw Error('This message no longer exists.');
      if (typeof message.read === 'boolean') note.read = message.read;
      if (typeof message.archived === 'boolean') note.archived = message.archived;
      push(channel);
      return true;
    },
    codexConnection: message => { if (typeof message.enabled === 'boolean') state.codex = message.enabled; return state.codex; },
    externalProvider: message => message.provider === 'github' ? {connected: false} : {accounts: [], configuredDefault: false, connected: false},
    appearance: message => { if (['system', 'light', 'dark'].includes(message.value)) state.appearance = message.value; return state.appearance || 'system'; },
    cardSize: message => { state.cardHeight = message.height; return true; },
    cardPrefs: message => {
      state.card = state.card || {snap: true, allSpaces: false, pinned: state.pinned === true, userSized: false};
      for (const key of ['snap', 'allSpaces', 'pinned']) if (typeof message[key] === 'boolean') state.card[key] = message[key];
      if (message.fit) state.card.userSized = false;
      state.pinned = state.card.pinned;
      return {...state.card};
    },
    pin: message => { if (typeof message.value === 'boolean') state.pinned = message.value; window.setPinned(state.pinned === true); return state.pinned === true; },
    nativeMenu: message => { state.lastMenu = message.items; return state.menuChoice ? String(message.items.findIndex(item => item.title === state.menuChoice)) : ''; },
    menuBar: message => { if (typeof message.value === 'boolean') state.menuBar = message.value; return state.menuBar; },
    claudeCode: message => {
      if (message.action === 'install') state.claude = {installed: true, working: true, cli: true, problem: '', approvals: !!message.approvals};
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
    settings: message => {
      state.settings = {hotkeys: true, keepAwake: false, usage: true, hotkeyLabels: ['⌃⌥Space', '⌃⌥N'], takenShortcuts: [], keepingAwake: false, ...state.settings, ...message};
      return state.settings;
    },
    alerts: message => {
      state.alerts = {needsYou: false, due: false, sound: true, banner: false, quietFrom: '', quietTo: '', remindAfter: 5, bannersAllowed: null, quietNow: false, ...state.alerts};
      for (const [key, value] of Object.entries(message)) state.alerts[key] = value;
      return state.alerts;
    },
    testAlert: () => { state.testAlerts = (state.testAlerts || 0) + 1; return true; },
    approvalWait: message => { if (message.value) state.approvalWait = message.value; return state.approvalWait || 25; },
    answerApproval: message => {
      if (message.request === 'gone') throw Error('Claude Code is no longer waiting for this answer. Check the terminal.');
      state.answers = [...(state.answers || []), {request: message.request, behavior: message.behavior}];
      return true;
    },
    hookLog: () => [
      {time: now - 30, source: 'Claude Code', event: 'PostToolUse', session: '1a2b3c4d', outcome: 'delivered'},
      {time: now - 90, source: 'Claude Code', event: '', session: '', outcome: 'problem: Expecting value: line 1 column 1 (char 0)'}
    ],
    exportBackup: message => { state.backupFile = message.text; state.backupName = message.name; return '/Users/test/Downloads/' + message.name; },
    importBackup: () => state.importFile ?? null,
    downloadModel: message => {
      if (message.cancel) return true;
      state.modelRequests = (state.modelRequests || 0) + 1;
      window.setCapabilities({capture: false, canDownloadModel: true, downloading: true});
      setTimeout(() => window.modelProgress({state: 'downloading', received: 558660368, total: 1117320736}), 50);
      setTimeout(() => window.modelProgress({state: 'verifying'}), 250);
      setTimeout(() => { window.setCapabilities({capture: true, canDownloadModel: false, downloading: false}); window.modelProgress({state: 'installed'}); }, 600);
      return true;
    },
    snapshotWorkspace: () => { if (state.failSnapshot) throw Error(state.failSnapshot); state.snapshots = (state.snapshots || 0) + 1; return '/Users/test/Library/Application Support/ShiShiDesk/Backups/Workspace before import.json'; },
    paste: () => state.clipboard,
    dismissAgent: message => { state.agents = state.agents.filter(agent => agent.key !== message.key); window.setAgents(state.agents); return true; },
    compact: message => { window.setCompact(!!message.value); return true; },
    latestSize: () => true, openNotion: () => true, openCodex: message => { state.openedThread = message.thread; return true; },
    openAgentApp: message => {
      state.openedApp = message.app; state.openedPlace = {terminal: message.terminal, cwd: message.cwd};
      return {app: {'com.apple.Terminal': 'Terminal', 'com.googlecode.iterm2': 'iTerm'}[message.app] || 'Terminal', found: state.focusResult || (message.terminal?.tty ? 'tab' : 'app')};
    },
    reminders: message => {
      state.reminderLists ??= [{id: 'L1', title: 'Family'}, {id: 'L2', title: 'Errands'}];
      state.reminderItems ??= [{id: 'R1', title: 'Buy milk', done: false, due: '', priority: '', edited: 'e1'},
                               {id: 'R2', title: 'Old reminder', done: true, due: '', priority: '', edited: 'e1'}];
      if (message.action === 'lists') return {lists: state.reminderLists};
      if (message.action === 'pull') return {title: state.reminderLists.find(l => l.id === message.list)?.title, pages: state.reminderItems};
      if (message.action === 'push') {
        state.reminderPushes = [...(state.reminderPushes || []), ...message.changes];
        return {results: message.changes.map((change, i) => ({task: change.task, ok: true, page: {id: change.page || 'RN' + i, edited: 'e2'}}))};
      }
      return {access: true};
    },
    calendarEvents: message => {
      state.calendarAsked = message;
      const at = (offset, hour, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
      return {events: [
        {title: 'Standup', start: at(0, 23, 30), end: at(0, 23, 45), allDay: false, calendar: 'Work', color: '#0a84ff'},
        {title: 'Holiday', start: at(1, 0), end: at(2, 0), allDay: true, calendar: 'Home', color: '#ff9f0a'},
        {title: 'Design review', start: at(2, 15), end: at(2, 16), allDay: false, calendar: 'Work', color: '#34c759'}
      ]};
    },
    githubIssues: message => {
      if (message.repo === 'acme/missing') throw Error('Check that the repository exists and is public.');
      state.issueRequests = [...(state.issueRequests || []), message];
      return {ok: true, repo: message.repo, issues: state.issues ?? [
        {number: 12, title: 'Crash on login', state: 'open', url: 'https://github.com/' + message.repo + '/issues/12', labels: ['bug']},
        {number: 9, title: 'Fixed long ago', state: 'closed', url: 'https://github.com/' + message.repo + '/issues/9', labels: []}
      ]};
    },
    checkUpdate: message => {
      state.updateChecks = [...(state.updateChecks || []), message];
      if (message.enabled !== undefined) state.updatesOn = message.enabled;
      const enabled = state.updatesOn !== false;
      if (!enabled || (!message.force && state.updateChecks.length > 2)) return {enabled, current: '1.7', skipped: true};
      return {enabled, current: '1.7', latest: state.latestRelease || '1.6.0', newer: (state.latestRelease || '1.6.0') === '1.8', url: 'https://github.com/shen25308/small-tool/releases/tag/v1.8'};
    },
    openRelease: message => { state.openedRelease = message.url; return true; },
    chooseFolder: () => state.folderChoice ?? '/Users/me/code/app',
    startAgent: message => { state.started = [...(state.started || []), message]; return message.terminal === 'iTerm2' ? 'iTerm2' : 'Terminal'; },
    openFile: message => { state.openedFile = {path: message.path, cwd: message.cwd, app: message.app}; return true; },
    openIssue: message => { state.openedIssue = message.url; return true; },
    usage: () => state.usage ?? {ok: true, time: now, claude: {fiveHours: {tokens: 1240000, cacheRead: 5e6, replies: 40}, today: {tokens: 2e6, replies: 60}, week: {tokens: 8400000, cacheRead: 9e7, replies: 300}, sessions: 12},
      codex: {observedAt: now - 120, primary: {usedPercent: 42.4, windowMinutes: 300, resetsAt: now + 3600}, secondary: {usedPercent: 83, windowMinutes: 10080, resetsAt: now + 3 * 86400}}}, openConnectorLink: () => true, copyConnectorSetup: () => true,
    extract: () => [{title: 'Send the homepage prototype to the design team', quote: 'Maya: Please send the new homepage prototype…', tag: 'Design'}]
  };
  window.webkit = {messageHandlers: {host: {postMessage(message) {
    // Handlers may return a promise, so a check can make the host slow or make it fail.
    setTimeout(() => {
      Promise.resolve().then(() => {
        const handler = handlers[message.op];
        if (!handler) throw Error('Unsupported action: ' + message.op);
        return handler(message);
      }).then(value => window.hostReply(message.id, true, value), error => window.hostReply(message.id, false, error.message));
    }, 0);
  }}}};
}

export async function launch() { return chromium.launch(); }

// A stand-in desktop for pictures of the corner card: wallpaper, an editor window, and the card at top right.
const DESKTOP = `
html.desktop, html.desktop body { background: linear-gradient(135deg, #3a5bd9 0%, #7b4fd6 38%, #e0679b 70%, #f4a259 100%) fixed !important }
html.desktop.dark-desk, html.desktop.dark-desk body { background: linear-gradient(135deg, #0f1a3d 0%, #2a1c4f 45%, #4b1f45 75%, #5a2f22 100%) fixed !important }
html.desktop body.compact #card { inset: 14px 14px auto auto; width: 340px; height: auto; border-radius: 22px; overflow: hidden;
  background: color-mix(in srgb, var(--paper) 74%, transparent) !important; -webkit-backdrop-filter: blur(40px) saturate(1.8); backdrop-filter: blur(40px) saturate(1.8);
  box-shadow: 0 0 0 .5px rgba(0,0,0,.25), 0 22px 60px rgba(0,0,0,.35) }
.fake-editor { position: fixed; left: 70px; top: 40px; width: 760px; bottom: 60px; border-radius: 12px; background: #1e1f24; box-shadow: 0 30px 80px rgba(0,0,0,.45);
  font: 12.5px/1.7 ui-monospace, Menlo, monospace; color: #c9d1d9; padding: 46px 22px; overflow: hidden }
.fake-editor::before { content: "● ● ●"; position: absolute; top: 12px; left: 16px; color: #555; letter-spacing: 2px }
.fake-editor b { color: #ff7b72; font-weight: 400 } .fake-editor i { color: #79c0ff; font-style: normal } .fake-editor u { color: #8b949e; text-decoration: none }
`;
const EDITOR = '<u>// billing.py</u><br><b>def</b> <i>charge</i>(account, amount):<br>&nbsp;&nbsp;&nbsp;&nbsp;<b>if</b> amount &lt;= 0:<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b>raise</b> ValueError(<i>"amount must be positive"</i>)<br>&nbsp;&nbsp;&nbsp;&nbsp;invoice = Invoice.<i>open</i>(account)<br>&nbsp;&nbsp;&nbsp;&nbsp;invoice.<i>add</i>(amount)<br>&nbsp;&nbsp;&nbsp;&nbsp;<b>return</b> invoice.<i>settle</i>()<br><br><u># Claude Code is refactoring this module…</u>';

export async function open(browser, {width = 1040, height = 760, dark = false, compact = false, empty = false, titlebar = 28, workspace, scale = 1, motion = false, desktop = false, video = '', lite = false} = {}) {
  // Checks run with reduced motion so timing never decides a result. One check turns motion on.
  const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: scale, colorScheme: dark ? 'dark' : 'light', reducedMotion: motion ? 'no-preference' : 'reduce', ...(video ? {recordVideo: {dir: video, size: {width, height}}} : {})});
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push('pageerror: ' + error.message + (process.env.STACK ? error.stack : '')));
  page.on('console', message => { if (message.type() === 'error') problems.push('console: ' + message.text()); });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  await page.addInitScript(fakeHost, {workspace: workspace === undefined ? sampleWorkspace() : workspace, compact, empty, titlebar, lite, tomorrow: iso(tomorrow)});
  // Chromium reports the Mac platform key as Meta, the same key the page listens for.
  await page.goto(pathToFileURL(path.join(root, 'UI/index.html')).href);
  await page.waitForFunction(() => window.__host && document.querySelector('#nav .smart-tile') && document.querySelector('#agentList'));
  if (desktop) {
    await page.addStyleTag({content: DESKTOP});
    await page.evaluate(([html, dark]) => {
      document.documentElement.classList.add('desktop');
      if (dark) document.documentElement.classList.add('dark-desk');
      const editor = document.createElement('div'); editor.className = 'fake-editor'; editor.innerHTML = html;
      document.body.prepend(editor);
    }, [EDITOR, dark]);
  }
  await page.waitForTimeout(150);
  return {page, context, problems};
}
