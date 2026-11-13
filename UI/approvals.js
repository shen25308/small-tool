'use strict';
// Permission requests from Claude Code, answered on the card (opt-in). Claude Code waits a few seconds for an
// answer here; after that it asks in the terminal as usual. Nothing is ever allowed without a click.
window.Approvals = (() => {
  let rows = [];
  const boxes = () => [document.getElementById('cardApprovals'), document.getElementById('workspaceApprovals')].filter(Boolean);
  const left = row => Math.max(0, Math.ceil(row.expires - Date.now() / 1000));
  const answering = new Set();

  // The card only offers Allow when it holds the whole request. Lengths count code points, as Python does.
  const complete = row => typeof row.length !== 'number' || row.length < 0 || [...(row.detail || '')].length === row.length;
  function markup(row) {
    const tool = row.tool || 'a tool';
    if (!complete(row)) {
      return '<article class="approval" data-approval="' + esc(row.id) + '"><div class="approval-head"><span class="verdict-badge">Permission</span><b>' + esc(row.project || 'Claude Code') + '</b></div>' +
        '<p class="approval-ask">Claude Code wants to use <b>' + esc(tool) + '</b>, but the request is too long to show here in full. Answer it in the terminal.</p></article>';
    }
    const size = [...(row.detail || '')].length;
    return '<article class="approval" data-approval="' + esc(row.id) + '">' +
      '<div class="approval-head"><span class="verdict-badge">' + symbol('i-bolt') + 'Permission</span><b>' + esc(row.project || 'Claude Code') + '</b>' +
      '<span class="approval-left" data-left>' + left(row) + ' s</span></div>' +
      '<p class="approval-ask">Claude Code wants to use <b>' + esc(tool) + '</b>' + (row.reason ? ': ' + esc(row.reason) : '') + '</p>' +
      (row.detail ? '<pre class="approval-detail" tabindex="0" aria-label="Full request">' + esc(row.detail) + '</pre>' +
        (size > 400 ? '<p class="approval-size">' + size.toLocaleString('en-US') + ' characters · scroll to read all of it before allowing</p>' : '') : '') +
      '<div class="approval-actions"><span class="approval-note">Then it asks in the terminal.</span>' +
      '<button type="button" class="secondary" data-answer="deny">Deny</button>' +
      '<button type="button" class="primary" data-answer="allow">Allow</button></div></article>';
  }

  function render() {
    const live = rows.filter(row => left(row) > 0);
    for (const box of boxes()) {
      box.hidden = !live.length;
      box.innerHTML = live.map(markup).join('');
    }
    document.getElementById('card')?.classList.toggle('has-approval', live.length > 0);
    window.Card?.refresh?.();
  }

  function tick() {
    let expired = false;
    for (const node of document.querySelectorAll('[data-approval]')) {
      const row = rows.find(item => item.id === node.dataset.approval);
      const seconds = row ? left(row) : 0;
      if (!seconds) expired = true;
      const label = node.querySelector('[data-left]');
      if (label) label.textContent = seconds + ' s';
    }
    if (expired) render();
  }
  setInterval(tick, 1000);

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-answer]');
    const card = button?.closest('[data-approval]');
    if (!card || answering.has(card.dataset.approval)) return;
    const id = card.dataset.approval, behavior = button.dataset.answer;
    answering.add(id);
    card.querySelectorAll('button').forEach(node => { node.disabled = true; });
    native('answerApproval', {request: id, behavior})
      .then(() => { rows = rows.filter(row => row.id !== id); render(); toast(behavior === 'allow' ? 'Allowed. Claude Code continues.' : 'Denied. Claude Code was told.'); })
      .catch(error => { rows = rows.filter(row => row.id !== id); render(); toast(error.message); })
      .finally(() => answering.delete(id));
  });

  window.setApprovals = list => { rows = Array.isArray(list) ? list : []; render(); };
  return {render, rows: () => rows};
})();
