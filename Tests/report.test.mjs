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
