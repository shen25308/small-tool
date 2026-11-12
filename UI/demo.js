'use strict';
// A pretend Claude Code session, so anyone can see the reports without setting anything up.
// It lives only in this page: nothing is written to disk and nothing reaches the app's inbox.
window.Demo = (() => {
  let rows = [], timers = [];
  const notes = new Map();
  const now = () => Date.now() / 1000;
  const base = {source: 'Claude Code', app: '', receipt: '', demo: true};

  function publish() {
    window.setInbox({channel: 'demo', items: [...notes.values()], error: ''});
    renderAgents();
  }
  function at(ms, step) {
    const timer = setTimeout(() => { timers = timers.filter(item => item !== timer); step(); }, ms);
    timers.push(timer);
  }
  function stop() {
    timers.forEach(clearTimeout);
    timers = [];
    rows = [];
    notes.clear();
    publish();
  }

  function start() {
    stop();
    const began = now();
    rows = [{...base, key: 'demo-shop', title: 'Claude Code · demo-shop', state: 'working', task: 'Add refunds to checkout and cover them with tests',
             detail: 'Add refunds to checkout and cover them with tests', started: began, time: began}];
    publish();
    toast('Demo: a pretend Claude Code session is working…');
    at(4000, () => {
      rows.push({...base, key: 'demo-api', title: 'Claude Code · demo-api', state: 'attention', task: 'Rename the orders table',
                 detail: 'Claude needs your permission to run the database migration', started: now() - 70, time: now()});
      publish();
    });
    at(9000, () => {
      const id = 'demo/shop-1';
      notes.set(id, {id, source: 'Claude Code', title: 'Claude Code · demo-shop', time: now(), read: false, thread: '', link: '', channel: 'demo',
        summary: 'Added refunds in `checkout/refunds.ts` and 9 tests in `checkout/refunds.test.ts`.\n\nAll 52 tests pass.'});
      rows = rows.map(row => row.key === 'demo-shop' ? {...row, state: 'done', receipt: id, time: now(), detail: 'Added refunds and 9 tests.',
        facts: {files: ['checkout/refunds.ts', 'checkout/refunds.test.ts'], fileCount: 2, commands: 4, failedTools: 0, tests: 'passed', testCommand: 'npm test'}} : row);
      publish();
    });
  }

  function read(id) {
    const note = notes.get(id);
    if (note) notes.set(id, {...note, read: true});
    rows = rows.filter(row => row.receipt !== id);
    publish();
    // Let the last message be read before the closing one.
    if (!rows.length && !timers.length) at(2600, () => { renderAgents(); toast('That is the whole idea. Connect Claude Code to see your own sessions here.'); });
    return Promise.resolve([...notes.values()]);
  }
  function dismiss(key) {
    rows = rows.filter(row => row.key !== key);
    publish();
    return Promise.resolve(true);
  }

  return {start, stop, read, dismiss, rows: () => rows, running: () => rows.length > 0};
})();

// One place to mark a result read, whether it came from the app or from the demo.
window.readNotice = note => note.channel === 'demo' ? Demo.read(note.id) : native('readNotice', {key: note.id, channel: note.channel});
window.dismissAgentEntry = entry => entry.demo ? Demo.dismiss(entry.key) : entry.notice ? readNotice(entry.notice) : native('dismissAgent', {key: entry.key});
