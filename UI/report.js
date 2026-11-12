'use strict';
// A brief report for a finished agent turn, written to answer one question: do I need to open it now?
(root => {
  // Claude asked you something, or is waiting on a decision only you can make.
  const asks = /(?:\b(?:should I|shall I|do you want me to|would you like me to|want me to|let me know (?:if|whether|which|how)|please (?:confirm|choose|decide|approve|review and)|need(?:s)? (?:your|you to) (?:approval|input|permission|decision|confirmation|answer)|waiting (?:for|on) (?:you|your)|which (?:option|approach) (?:do|would) you)\b|请(?:确认|选择|决定)|是否需要|要不要)/i;
  const blocked = /\b(?:blocked|could(?:n['’]t| not) (?:continue|proceed|finish|complete|access|run)|unable to (?:continue|proceed|finish|complete)|stopped because|ran out of)\b|无法继续|被阻塞/i;
  const failed = /(?:\b(?!0 )\d+ (?:tests? )?(?:failed|failing|errors?)\b|\b(?:tests?|build|checks?|lint|type ?check)(?: \w+){0,2} (?:still )?(?:failed|failing|fails|broke|broken)\b|\bfailing tests?\b)|(?:测试|构建|编译)(?:仍|依然)?失败/i;
  const passed = /(?:\ball (?:\d+ )?(?:tests?|checks?|specs?) (?:now )?pass(?:ed|es)?\b|\b\d+ (?:tests? )?passed\b(?![^.]*\b[1-9]\d* failed)|\b(?:tests?|checks?|build|lint|type ?check)(?: \w+){0,2} (?:now )?(?:pass(?:ed|es)?|succeeded|green|clean)\b)|(?:测试|构建|编译)(?:全部)?通过/i;

  // A failure counts only in a clause that does not say it was fixed ("fixed the previously failing test").
  function stillFailing(text) {
    return String(text).split(/[.;,\n\uff0c\u3002\uff1b]|\bbut\b/i).some(clause => {
      const hit = failed.exec(clause);
      if (!hit) return false;
      return !/\b(?:fixed|resolved|repaired|previously|no longer|used to|were)\b|\u4fee\u590d|\u89e3\u51b3/i.test(clause.slice(0, hit.index + hit[0].length));
    });
  }

  const code = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|swift|kt|java|c|cc|cpp|h|hpp|m|mm|cs|php|scala|sh|vue|svelte|sql|dart|ex|exs)$/i;

  function lastLine(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop() || '';
  }

  function minutes(seconds) {
    if (!(seconds > 0)) return '';
    if (seconds < 60) return Math.max(1, Math.round(seconds)) + ' s';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min';
    const hours = Math.floor(seconds / 3600), rest = Math.round(seconds % 3600 / 60);
    return hours + ' h' + (rest ? ' ' + rest + ' min' : '');
  }

  /** note: {summary, title, time}; agent: {task, started, time, state, detail} (both optional). */
  function brief(note, agent = {}) {
    const text = String(note?.summary || agent.detail || '');
    const digest = root.ShishiDigest.summarize(text, note?.title || '');
    // Facts from the session log, when the hook could read it, outrank what the reply says.
    const facts = agent.facts && ['passed', 'failed', 'none'].includes(agent.facts.tests) ? agent.facts : null;
    const claimed = stillFailing(text) ? 'failed' : passed.test(text) ? 'passed' : '';
    const tests = facts ? facts.tests : claimed;
    const touchedCode = !!facts && facts.files.some(file => code.test(file));
    let verdict = 'done', reason;
    if (agent.state === 'attention') {
      verdict = 'blocked';
      reason = 'It is waiting for you.';
    } else if (asks.test(text) || /[?？]$/.test(lastLine(text)) || blocked.test(text)) {
      verdict = 'blocked';
      reason = blocked.test(text) ? 'It stopped early.' : 'It asked you a question.';
    } else if (tests === 'failed' || digest.status === 'attention') {
      verdict = 'review';
      reason = tests === 'failed' ? (facts ? 'A check failed when it ran.' : 'Some checks failed.') : 'Something is unresolved.';
    } else if (facts && tests === 'none' && claimed === 'passed') {
      verdict = 'review';
      reason = 'It says checks pass, but none ran.';
    } else if (touchedCode && tests === 'none') {
      verdict = 'review';
      reason = 'It changed code and ran no checks.';
    } else {
      reason = tests === 'passed' ? 'Checks passed.' : 'Nothing is waiting on you.';
    }
    const labels = {done: 'No need to check', review: 'Worth a look', blocked: 'Needs you'};
    return {
      verdict, label: labels[verdict], reason,
      headline: verdict === 'blocked' && agent.state === 'attention' ? (agent.detail || 'Waiting for you') : digest.headline,
      // A line that only says the checks passed repeats the chip below it.
      points: verdict === 'blocked' && agent.state === 'attention' ? [] : digest.details.filter(point => !(tests === 'passed' && passed.test(point) && !stillFailing(point))),
      files: facts ? facts.files.map(file => file.split('/').pop()) : digest.files.map(file => file.label),
      moreFiles: facts ? Math.max(0, facts.fileCount - Math.min(facts.files.length, 3)) : 0,
      tests,
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

  root.AgentReport = {brief, appName, minutes};
})(typeof window === 'undefined' ? globalThis : window);
