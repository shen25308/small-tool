// Regression cases for result classification (audit finding F01).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
await import('../UI/result-digest.js');
await import('../UI/report.js');
const {brief, minutes} = globalThis.AgentReport;
const note = summary => ({summary, title: 'Claude Code · small-tool', time: 0});
const facts = (tests, files = ['src/billing.py'], extra = {}) => ({files, fileCount: files.length, commands: 2, failedTools: 0, tests, testCommand: 'pytest -q', ...extra});
const read = (text, agent) => { const r = brief(note(text), agent); return [r.action, r.verification.state, r.verification.source, r.label]; };

test('audit cases: negation, bare receipt, Chinese request for input', () => {
  assert.deepEqual(read('Not all tests passed.'), ['review', 'failed', 'claimed', 'Worth a look']);
  assert.equal(brief(note('Not all tests passed.')).evidence, 'Not all tests passed.');
  assert.deepEqual(read('Turn finished'), ['none', 'unverified', 'none', 'Completed · Checks not verified']);
  assert.equal(brief(note('Turn finished')).tone, 'neutral');
  const zh = '文件还没有修改，需要你确认后才能继续。';
  assert.deepEqual(read(zh), ['input', 'unverified', 'none', 'Needs you']);
  assert.equal(brief(note(zh)).evidence, zh);
});

test('negation outranks success', () => {
  for (const text of ["Tests didn't pass on CI.", 'None of the tests passed.', 'The build did not succeed.', 'Not all of the checks passed, 2 are flaky.',
                      'I implemented the parser. 2 tests failed in test_dates.py.', 'Done, but the build is still failing.', '测试未通过。', '有 3 个测试失败。']) {
    assert.equal(brief(note(text)).verification.state, 'failed', text);
    assert.equal(brief(note(text)).action, 'review', text);
  }
});

test('history and zero failures are not failures', () => {
  assert.deepEqual(read('Fixed the previously failing test. All 31 tests pass.'), ['none', 'passed', 'claimed', 'Completed · Checks reported passing']);
  assert.deepEqual(read('0 failed, 31 passed.'), ['none', 'passed', 'claimed', 'Completed · Checks reported passing']);
  assert.equal(brief(note('0 failed, 31 passed.')).tone, 'neutral', 'a claim alone never turns green');
});

test('claims stay claims; only observed runs are green', () => {
  const observed = brief(note('Refactored billing. All tests pass.'), {facts: facts('passed')});
  assert.deepEqual([observed.action, observed.label, observed.tone, observed.verification.evidence], ['none', 'Completed · Checks passed', 'done', 'Ran pytest -q']);
  const contradicted = brief(note('Everything works. All tests pass.'), {facts: facts('failed')});
  assert.deepEqual([contradicted.action, contradicted.reason], ['review', 'A check failed when it ran.']);
  const unsupported = brief(note('Refactored billing. All tests pass.'), {facts: facts('none')});
  assert.deepEqual([unsupported.action, unsupported.reason, unsupported.evidence], ['review', 'It says checks pass, but none ran.', 'All tests pass.']);
  const untested = brief(note('Updated the refund rules.'), {facts: facts('none')});
  assert.deepEqual([untested.action, untested.reason], ['review', 'It changed code and ran no checks.']);
  const docs = brief(note('Updated the README.'), {facts: facts('none', ['README.md'])});
  assert.deepEqual([docs.action, docs.label, docs.tone], ['none', 'Completed · No checks ran', 'neutral']);
});

test('missing verification is reported as missing', () => {
  assert.deepEqual(read("Implemented the endpoint. I couldn't run the tests because Docker is not installed."), ['none', 'not-run', 'claimed', 'Completed · No checks ran']);
  assert.deepEqual(read('已完成重构，但没有运行测试。'), ['none', 'not-run', 'claimed', 'Completed · No checks ran']);
  assert.deepEqual(read('Renamed the module.'), ['none', 'unverified', 'none', 'Completed · Checks not verified']);
});

test('requests for input in English, Chinese and mixed text', () => {
  for (const text of ['I found two ways to fix this.\n\nShould I migrate the database now?', 'Which option do you prefer, A or B?',
                      'Tests pass, but I need you to confirm the migration before I continue.', '重构完成。请确认是否需要删除旧接口。',
                      'Refactor is done. 需要你确认后才能部署。', 'I could not continue because the API key is missing.']) {
    assert.equal(brief(note(text)).action, 'input', text);
  }
  assert.equal(brief(note('I could not continue because the API key is missing.')).reason, 'It stopped before finishing.');
  const waiting = brief(note(''), {state: 'attention', detail: 'Claude needs your permission to use Bash'});
  assert.deepEqual([waiting.action, waiting.execution, waiting.headline, waiting.points], ['input', 'waiting', 'Claude needs your permission to use Bash', []]);
});

test('mixed-language success claim stays a claim', () => {
  assert.deepEqual(read('Refactored the parser. 测试全部通过。'), ['none', 'passed', 'claimed', 'Completed · Checks reported passing']);
});

test('report details', () => {
  const report = brief(note('Updated `billing.py` and added 12 tests in `tests/test_billing.py`.\n\nAll 48 tests pass.'), {task: 'Refactor billing', started: 100, time: 340});
  assert.deepEqual(report.files, ['billing.py', 'test_billing.py']);
  assert.equal(report.took, '4 min');
  assert.equal(report.asked, 'Refactor billing');
  const many = brief(note('Renamed the module.'), {facts: facts('passed', ['a/one.ts', 'b/two.ts', 'c/three.ts', 'd/four.ts'], {fileCount: 9})});
  assert.deepEqual([many.files.slice(0, 3), many.moreFiles], [['one.ts', 'two.ts', 'three.ts'], 6]);
  assert.deepEqual([minutes(0), minutes(20), minutes(150), minutes(3700), minutes(7200)], ['', '20 s', '3 min', '1 h 2 min', '2 h']);
});
