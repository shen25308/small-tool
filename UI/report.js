'use strict';
// A brief report for a finished agent turn. It answers three separate questions and never mixes them:
//   execution    did the turn finish, stop early, or wait for you?
//   verification what is actually known about tests and checks, and from where (observed or claimed)?
//   action       does a person need to do something now?
// Unknown verification stays unknown. A request for your input outranks everything else.
(root => {
  const SENTENCES = /[^.!?\n。！？；;]+[.!?。！？；;]*/g;

  // The agent needs a person: a question, a confirmation, approval, or a choice.
  const asksEN = /\b(?:should I|shall I|do you want me to|would you like me to|want me to|let me know (?:if|whether|which|how)|please (?:confirm|choose|decide|approve|review and|advise)|can you (?:confirm|approve|check)|I need you to|need(?:s)? (?:your|you to) (?:approval|input|permission|decision|confirmation|answer|go-ahead)|waiting (?:for|on) (?:you|your)|awaiting your|before I (?:continue|proceed|go ahead)|once you (?:confirm|approve)|which (?:option|approach|one) (?:do|would|should) you)\b/i;
  const asksZH = /需要(?:你|您)(?:来|的)?(?:确认|批准|决定|回复|选择|处理|授权|同意)|请(?:你|您)?(?:确认|选择|决定|批准|回复|告诉我)|确认后(?:才能|再)?继续|才能继续|是否(?:需要|继续|要)|要不要|等(?:待)?(?:你|您)(?:的)?(?:确认|回复|决定)/;
  // The turn ended without finishing.
  const stoppedEN = /\b(?:blocked|could(?:n['’]t| not) (?:continue|proceed|finish|complete|access|apply)|unable to (?:continue|proceed|finish|complete|apply)|stopped (?:because|before)|ran out of|gave up)\b/i;
  const stoppedZH = /无法继续|被阻塞|未能完成|没能完成|中断了/;

  // Claims about checks in the reply. Negation is read before success: "not all tests passed" is a failure.
  const negatedPass = /\b(?:not all (?:of the )?(?:tests?|checks?|specs?)|none of the (?:tests?|checks?)|(?:tests?|checks?|build|lint)(?: \w+){0,2} (?:did not|didn['’]t|do not|don['’]t|does not|doesn['’]t|never|haven['’]t|have not|hasn['’]t|has not|won['’]t|will not) (?:pass|succeed|compile|build))\b|\bfailed to (?:pass|build|compile)\b/i;
  const notRunEN = /\b(?:(?:did not|didn['’]t|could not|couldn['’]t|was not able to|wasn['’]t able to|unable to) (?:run|execute) (?:the |any )?(?:tests?|checks?|test suite|build)|no (?:tests?|checks?) (?:were|was|have been) (?:run|executed)|(?:tests?|checks?) (?:were|was) not (?:run|executed)|without running (?:the |any )?(?:tests?|checks?)|(?:tests?|checks?) (?:not|un)verified)\b/i;
  const failedEN = /(?:\b(?!0 )\d+ (?:tests? |checks? |specs? )?(?:failed|failing|errors?|failures?)\b|\b(?:tests?|build|checks?|lint|type ?check|compil\w*)(?: \w+){0,2} (?:still )?(?:failed|failing|fails|broke|broken|errored)\b|\bfailing (?:tests?|checks?)\b)/i;
  const passedEN = /(?:\ball (?:\d+ )?(?:tests?|checks?|specs?) (?:now )?pass(?:ed|es|ing)?\b|\b\d+ (?:tests? |checks? )?passed\b|\b(?:tests?|checks?|build|lint|type ?check)(?: \w+){0,2} (?:now )?(?:pass(?:ed|es)?|succeeded|(?:is |are )?green|(?:is |are )?clean)\b)/i;
  const zeroFailures = /\b0 (?:tests? )?(?:failed|failures|errors)\b/i;
  const failedZH = /(?:测试|构建|编译|检查)(?:仍|依然|还是)?(?:未通过|没(?:有)?通过|未全部通过|失败|报错)|有\s*\d+\s*个?(?:测试|用例)失败/;
  const notRunZH = /(?:没(?:有)?|未)(?:跑|运行|执行)(?:任何)?(?:测试|检查)|(?:测试|检查)(?:尚)?未(?:运行|执行|验证)/;
  const passedZH = /(?:测试|构建|编译|检查)(?:已)?(?:全部)?通过/;
  // A sentence that talks about a fixed or earlier failure is history, not a current failure.
  const historical = /\b(?:fixed|resolved|repaired|previously|no longer|used to|was failing|were failing|earlier)\b|修复|解决|之前/i;

  const code = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|swift|kt|java|c|cc|cpp|h|hpp|m|mm|cs|php|scala|sh|vue|svelte|sql|dart|ex|exs)$/i;

  function sentences(text) {
    return (String(text || '').match(SENTENCES) || []).map(item => item.trim()).filter(Boolean);
  }
  function lastLine(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop() || '';
  }

  // What the reply says about checks, with the exact sentence that says it.
  function claimedChecks(text) {
    let result = {state: 'unknown', evidence: ''};
    for (const sentence of sentences(text)) {
      if (negatedPass.test(sentence) || failedZH.test(sentence)) return {state: 'failed', evidence: sentence};
      if (notRunEN.test(sentence) || notRunZH.test(sentence)) { result = {state: 'not-run', evidence: sentence}; continue; }
      const failing = failedEN.exec(sentence);
      if (failing && !historical.test(sentence.slice(0, failing.index + failing[0].length)) && !zeroFailures.test(failing[0])) {
        return {state: 'failed', evidence: sentence};
      }
      if ((passedEN.test(sentence) || passedZH.test(sentence)) && result.state === 'unknown') result = {state: 'passed', evidence: sentence};
    }
    return result;
  }

  function firstMatch(text, ...patterns) {
    return sentences(text).find(sentence => patterns.some(pattern => pattern.test(sentence))) || '';
  }

  function minutes(seconds) {
    if (!(seconds > 0)) return '';
    if (seconds < 60) return Math.max(1, Math.round(seconds)) + ' s';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min';
    const hours = Math.floor(seconds / 3600), rest = Math.round(seconds % 3600 / 60);
    return hours + ' h' + (rest ? ' ' + rest + ' min' : '');
  }

  /** note: {summary, title, time}; agent: {task, started, time, state, detail, facts} (both optional). */
  function brief(note, agent = {}) {
    const text = String(note?.summary || '');
    const digest = root.ShishiDigest.summarize(text || agent.detail || '', note?.title || '');
    const facts = agent.facts && ['passed', 'failed', 'none', 'unclear'].includes(agent.facts.tests) ? agent.facts : null;
    const claim = claimedChecks(text);
    const touchedCode = !!facts && facts.files.some(file => code.test(file));

    // 1. Execution.
    const waiting = agent.state === 'attention';
    const asked = firstMatch(text, asksEN, asksZH) || (/[?？]$/.test(lastLine(text)) ? lastLine(text) : '');
    const stopped = firstMatch(text, stoppedEN, stoppedZH);
    const execution = waiting ? 'waiting' : stopped ? 'stopped' : 'completed';

    // 2. Verification: an observed run outranks any claim; a claim is reported as a claim; otherwise unknown.
    let verification;
    if (facts) {
      // "unclear": a check ran but did not show a pass (masked exit, background launch, no result printed).
      const state = facts.tests === 'none' ? 'not-run' : facts.tests === 'unclear' ? 'unverified' : facts.tests;
      verification = {state, source: 'observed', evidence: facts.tests === 'unclear' ? 'Ran ' + facts.testCommand + ', but it did not show a passing result.'
        : facts.testCommand ? 'Ran ' + facts.testCommand : 'No test, build or lint command ran in this turn.'};
    } else if (claim.state !== 'unknown') {
      verification = {state: claim.state, source: 'claimed', evidence: claim.evidence};
    } else {
      verification = {state: 'unverified', source: 'none', evidence: ''};
    }

    // An open problem, other than the sentence that already describes the checks.
    const unresolved = digest.status === 'attention'
      ? sentences(text).find(sentence => sentence !== verification.evidence && root.ShishiDigest.summarize(sentence).status === 'attention') || ''
      : '';

    // 3. Action required, most urgent first.
    let action = 'none', reason, evidence = '';
    if (waiting) { action = 'input'; reason = 'It is waiting for you.'; evidence = agent.detail || ''; }
    else if (asked) { action = 'input'; reason = 'It asked for your input.'; evidence = asked; }
    else if (stopped) { action = 'input'; reason = 'It stopped before finishing.'; evidence = stopped; }
    else if (verification.state === 'failed') {
      action = 'review'; reason = verification.source === 'observed' ? 'A check failed when it ran.' : 'The reply says checks failed.'; evidence = verification.evidence;
    } else if (facts && verification.state === 'not-run' && claim.state === 'passed') {
      action = 'review'; reason = 'It says checks pass, but none ran.'; evidence = claim.evidence;
    } else if (touchedCode && verification.state === 'not-run') {
      action = 'review'; reason = 'It changed code and ran no checks.';
    } else if (unresolved) {
      action = 'review'; reason = 'Something is unresolved.'; evidence = unresolved;
    } else {
      reason = {passed: verification.source === 'observed' ? 'Checks ran and passed.' : 'The reply says checks pass. Shishi did not see them run.',
                'not-run': 'No checks ran.',
                unverified: verification.source === 'observed' ? 'A check ran, but its result does not show a pass.' : 'Nothing shows whether checks ran.'}[verification.state];
    }

    const verificationLabel = {passed: verification.source === 'observed' ? 'Checks passed' : 'Checks reported passing',
                               failed: 'Checks failed', 'not-run': 'No checks ran', unverified: 'Checks not verified'}[verification.state];
    const label = action === 'input' ? 'Needs you' : action === 'review' ? 'Worth a look' : 'Completed · ' + verificationLabel;
    // Colour follows evidence: green only for checks observed to pass.
    const tone = action === 'input' ? 'blocked' : action === 'review' ? 'review'
      : verification.state === 'passed' && verification.source === 'observed' ? 'done' : 'neutral';

    return {
      execution, verification, action, tone, label, reason, evidence,
      verdict: tone,
      headline: waiting ? (agent.detail || 'Waiting for you') : digest.headline,
      points: waiting ? [] : digest.details.filter(point => point !== verification.evidence && point !== evidence),
      files: facts ? facts.files.map(file => file.split('/').pop()) : digest.files.map(file => file.label),
      moreFiles: facts ? Math.max(0, facts.fileCount - Math.min(facts.files.length, 3)) : 0,
      tests: verification.source === 'none' ? '' : verification.state === 'passed' && verification.source === 'claimed' ? 'claimed' : verification.state === 'not-run' ? 'none' : verification.state,
      checked: facts?.testCommand || '',
      verified: !!facts,
      asked: agent.task || '',
      took: agent.started && agent.time ? minutes(agent.time - agent.started) : ''
    };
  }

  // Bundle identifiers of apps that commonly host Claude Code, for a friendlier button.
  const apps = {
    'com.apple.Terminal': 'Terminal', 'com.googlecode.iterm2': 'iTerm', 'com.mitchellh.ghostty': 'Ghostty',
    'dev.warp.Warp-Stable': 'Warp', 'com.microsoft.VSCode': 'VS Code', 'com.todesktop.230313mzl4w4u92': 'Cursor',
    'dev.zed.Zed': 'Zed', 'com.anthropic.claudefordesktop': 'Claude'
  };
  const appName = bundle => apps[bundle] || '';

  root.AgentReport = {brief, appName, minutes, claimedChecks};
})(typeof window === 'undefined' ? globalThis : window);
