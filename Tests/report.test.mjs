import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
await import('../UI/result-digest.js');
await import('../UI/report.js');
const {brief, minutes} = globalThis.AgentReport;
const note = summary => ({summary, title: 'Claude Code · small-tool', time: 0});

test('a clean finish needs no check', () => {
  const report = brief(note('Updated `billing.py` and added 12 tests in `tests/test_billing.py`.\n\nAll 48 tests pass.'), {task: 'Refactor billing', started: 100, time: 340});
  assert.equal(report.verdict, 'done');
  assert.equal(report.label, 'No need to check');
  assert.equal(report.tests, 'passed');
  assert.equal(report.reason, 'Checks passed.');
  assert.ok(report.points.every(point => !/pass/.test(point)), 'no line repeats the passed checks');
  assert.deepEqual(report.files, ['billing.py', 'test_billing.py']);
  assert.equal(report.asked, 'Refactor billing');
  assert.equal(report.took, '4 min');
  assert.match(report.headline, /Updated billing\.py/);
});

test('failed checks are worth a look', () => {
  for (const text of ['Implemented the parser. 2 tests failed in test_dates.py.', 'Added the endpoint, but the build is still failing on CI.', 'Done. Tests failing: 3.']) {
    assert.equal(brief(note(text)).verdict, 'review', text);
  }
  assert.equal(brief(note('Fixed the previously failing test. 0 failed, 31 passed.')).verdict, 'done');
  assert.equal(brief(note('Fixed the previously failing test. 0 failed, 31 passed.')).tests, 'passed');
});

test('questions and blocks need you', () => {
  assert.equal(brief(note('I found two ways to fix this.\n\nShould I migrate the database now or wait for the release?')).verdict, 'blocked');
  assert.equal(brief(note('Which option do you prefer, A or B?')).reason, 'It asked you a question.');
  assert.equal(brief(note('I could not continue because the API key is missing.')).reason, 'It stopped early.');
  const waiting = brief(note(''), {state: 'attention', detail: 'Claude needs your permission to use Bash'});
  assert.deepEqual([waiting.verdict, waiting.headline, waiting.points], ['blocked', 'Claude needs your permission to use Bash', []]);
});

test('durations read naturally', () => {
  assert.deepEqual([minutes(0), minutes(20), minutes(150), minutes(3700), minutes(7200)], ['', '20 s', '3 min', '1 h 2 min', '2 h']);
});

test('facts from the session log decide the checks', () => {
  const facts = (tests, files = ['src/billing.py'], extra = {}) => ({files, fileCount: files.length, commands: 2, failedTools: 0, tests, testCommand: 'pytest', ...extra});
  const says = 'Refactored billing and added tests. All tests pass.';
  const verified = brief(note(says), {facts: facts('passed')});
  assert.deepEqual([verified.verdict, verified.tests, verified.verified, verified.checked], ['done', 'passed', true, 'pytest']);
  const unverified = brief(note(says), {facts: facts('none')});
  assert.deepEqual([unverified.verdict, unverified.reason, unverified.tests], ['review', 'It says checks pass, but none ran.', 'none']);
  const untested = brief(note('Updated the refund rules.'), {facts: facts('none')});
  assert.deepEqual([untested.verdict, untested.reason], ['review', 'It changed code and ran no checks.']);
  const docs = brief(note('Updated the README.'), {facts: facts('none', ['README.md'])});
  assert.equal(docs.verdict, 'done');
  const failing = brief(note('Everything works. All tests pass.'), {facts: facts('failed')});
  assert.deepEqual([failing.verdict, failing.reason], ['review', 'A check failed when it ran.']);
  const many = brief(note('Renamed the module.'), {facts: facts('passed', ['a/one.ts', 'b/two.ts', 'c/three.ts', 'd/four.ts'], {fileCount: 9})});
  assert.deepEqual([many.files.slice(0, 3), many.moreFiles], [['one.ts', 'two.ts', 'three.ts'], 6]);
});
