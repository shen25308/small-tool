'use strict';
// The Agent Island: a capsule at the top of the window that shows what your agents are doing.
// It spins while they work, glows when one needs you, and briefly opens when a result lands.
window.Island = (() => {
  const node = $('island');
  const loadedAt = Date.now();
  let entries = [], previous = new Map(), started = false, flash = null, flashTimer = 0, open = false, lastMarkup = '';

  const place = entry => {
    const title = entry.title || 'Agent';
    const parts = title.split(' · ');
    return parts.length > 1 ? parts.slice(1).join(' · ') : title;
  };
  const glyph = mode => '<span class="island-glyph glyph-' + mode + '" aria-hidden="true">' +
    (mode === 'done' || mode === 'neutral' ? '<svg viewBox="0 0 16 16"><path d="M3.5 8.4l3 3 6-6.6"/></svg>' : '') + '</span>';

  function summary() {
    const waiting = entries.filter(entry => entry.state === 'attention');
    const working = entries.filter(entry => entry.state === 'working');
    const done = entries.filter(entry => entry.state === 'done');
    if (waiting.length) return {mode: 'attention', text: waiting.length > 1 ? waiting.length + ' need you' : place(waiting[0]) + ' needs you'};
    if (working.length) return {mode: 'working', text: working.length > 1 ? working.length + ' agents working' : place(working[0])};
    if (done.length) return {mode: 'done', text: done.length > 1 ? done.length + ' results' : place(done[0]) + ' finished'};
    return {mode: 'idle', text: 'Agents'};
  }

  function markup() {
    if (open) {
      const rows = entries.map(agentMarkup).join('') || '<p class="agent-empty">Claude Code and Codex appear here while they work.</p>';
      return {mode: 'panel', html: '<div class="island-panel"><div class="island-head">' + glyph(summary().mode) + '<b>Agents</b><span>' + entries.length + '</span></div>' +
        '<div class="island-list">' + rows + '</div><div class="island-actions"><button type="button" data-island="inbox">Open Inbox</button><button type="button" data-island="connections">Connections…</button></div></div>'};
    }
    if (flash) {
      const entry = flash.entry;
      const note = entry.notice || allNotices().find(item => item.id === entry.receipt);
      const report = AgentReport.brief(note, entry);
      const tone = flash.mode === 'attention' || report.tone === 'blocked' ? 'attention' : report.tone;
      return {mode: 'flash flash-' + tone, html: '<div class="island-flash">' + glyph(tone === 'review' ? 'attention' : tone) +
        '<span class="island-copy"><b>' + esc(place(entry)) + '<small>' + esc(report.label) + ' · ' + esc(entry.source || 'Agent') + '</small></b>' +
        '<span>' + esc(report.headline || (flash.mode === 'done' ? 'The result is in your inbox.' : 'Waiting for your answer.')) + '</span></span></div>'};
    }
    const now = summary();
    return {mode: now.mode, html: '<div class="island-pill">' + glyph(now.mode) + '<span class="island-text">' + esc(now.text) + '</span></div>'};
  }

  // The capsule may not cover the toolbar buttons. When the middle of a narrow window is too tight,
  // it moves to the left edge, where it has more room.
  function room() {
    const bar = node.parentElement?.getBoundingClientRect();
    if (!bar?.width) return 316;
    if (compact) return Math.floor(bar.width);
    const tools = document.querySelector('.toolbar-tools').getBoundingClientRect();
    const centered = 2 * (tools.left - (bar.left + bar.width / 2)) - 24;
    const left = centered < 300;
    node.classList.toggle('island-left', left);
    return Math.max(140, Math.floor(left ? tools.left - bar.left - 40 : centered));
  }

  function paint() {
    const view = markup();
    const signature = view.mode + view.html;
    if (signature === lastMarkup) return;
    lastMarkup = signature;
    const inner = document.createElement('div');
    inner.className = 'island-inner';
    inner.innerHTML = view.html;
    node.className = 'island mode-' + view.mode;
    node.style.setProperty('--island-max', room() + 'px');
    node.replaceChildren(inner);
    node.setAttribute('aria-expanded', String(open));
    // The capsule animates between measured sizes, so it morphs instead of jumping.
    node.style.width = Math.ceil(inner.offsetWidth) + 'px';
    node.style.height = Math.ceil(inner.offsetHeight) + 'px';
    if (!Motion.reduced()) inner.animate([{opacity: 0, filter: 'blur(5px)', transform: 'scale(.96)'}, {opacity: 1, filter: 'none', transform: 'none'}], {duration: 360, easing: Motion.gentle});
  }

  function showFlash(mode, entry) {
    flash = {mode, entry};
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash = null; paint(); }, mode === 'attention' ? 8000 : 6000);
    paint();
  }

  function update(list) {
    entries = list;
    // Only news flashes: a change seen while running, about something that happened in the last two minutes.
    if (started && !open && !compact && Date.now() - loadedAt > 2500) {
      for (const entry of entries) {
        if (Date.now() / 1000 - entry.time > 120) continue;
        const before = previous.get(entry.key);
        if (entry.state === 'attention' && before !== 'attention') showFlash('attention', entry);
        else if (entry.state === 'done' && before !== 'done') showFlash('done', entry);
      }
    }
    if (flash && !entries.some(entry => entry.key === flash.entry.key)) { flash = null; clearTimeout(flashTimer); }
    previous = new Map(entries.map(entry => [entry.key, entry.state]));
    started = true;
    paint();
  }

  function close() {
    if (!open) return;
    open = false;
    paint();
  }

  node.addEventListener('click', event => {
    const command = event.target.closest('[data-island]');
    if (command) {
      close();
      Card.inWorkspace(command.dataset.island === 'inbox' ? () => $('inboxButton').click() : () => showConnectors());
      return;
    }
    if (open) return;
    if (flash) {
      const entry = flash.entry;
      flash = null; clearTimeout(flashTimer);
      if (entry.receipt && allNotices().some(note => note.id === entry.receipt)) { paint(); Card.inWorkspace(() => openNotice(entry.receipt)); return; }
    }
    open = true;
    paint();
  });
  node.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === node) { event.preventDefault(); node.click(); }
  });
  addEventListener('resize', () => { lastMarkup = ''; paint(); });
  document.addEventListener('pointerdown', event => { if (open && !node.contains(event.target)) close(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && open) close(); });

  return {update, close, isOpen: () => open};
})();
