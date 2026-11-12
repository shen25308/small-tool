'use strict';
// Motion for the board: rows glide to new places, new rows settle in, counts roll, and a completed task
// gets a short burst. Everything here is skipped when the Mac's "Reduce motion" setting is on.
window.Motion = (() => {
  const query = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => query.matches;

  // A damped spring sampled into CSS linear() easing, with a plain curve where linear() is missing.
  function springEasing(zeta = 0.74, omega = 9.5, steps = 48) {
    const damped = omega * Math.sqrt(1 - zeta * zeta), points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push((1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + zeta * omega / damped * Math.sin(damped * t))).toFixed(4));
    }
    points[steps] = '1';
    return 'linear(' + points.join(', ') + ')';
  }
  const spring = window.CSS?.supports?.('animation-timing-function', 'linear(0, 1)') ? springEasing() : 'cubic-bezier(.2, .9, .25, 1.12)';
  const gentle = 'cubic-bezier(.22, 1, .36, 1)';
  document.documentElement.style.setProperty('--spring', spring);

  const ROWS = '#tasks .row[data-id], #pool .row[data-id], #cardTasks .row[data-id]';
  const visible = rect => rect.width > 0 && rect.height > 0;

  function capture(view) {
    if (reduced()) return null;
    const rows = new Map(), counts = new Map();
    document.querySelectorAll(ROWS).forEach(row => rows.set(row.dataset.id, row.getBoundingClientRect()));
    document.querySelectorAll('[data-count-key]').forEach(node => counts.set(node.dataset.countKey, node.textContent));
    return {view, rows, counts};
  }

  function play(snapshot, view) {
    if (!snapshot || reduced()) return;
    const rows = [...document.querySelectorAll(ROWS)];
    const entering = snapshot.view !== view || snapshot.rows.size === 0;
    if (entering) {
      let index = 0;
      for (const row of rows) {
        if (!visible(row.getBoundingClientRect()) || index > 16) continue;
        row.animate([{opacity: 0, transform: 'translateY(12px)'}, {opacity: 1, transform: 'none'}],
          {duration: 520, delay: 24 * index++, easing: spring, fill: 'backwards'});
      }
      if (!compact) $('pageTitle').animate([{opacity: 0, transform: 'translateX(-10px)'}, {opacity: 1, transform: 'none'}], {duration: 460, easing: gentle});
    } else {
      for (const row of rows) {
        const now = row.getBoundingClientRect();
        if (!visible(now)) continue;
        const was = snapshot.rows.get(row.dataset.id);
        if (!was) {
          row.animate([{opacity: 0, transform: 'translateY(-8px) scale(.985)'}, {opacity: 1, transform: 'none'}], {duration: 460, easing: spring});
          continue;
        }
        if (!visible(was)) continue;
        const dx = was.left - now.left, dy = was.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        row.animate([{transform: 'translate(' + dx + 'px,' + dy + 'px)'}, {transform: 'none'}], {duration: 560, easing: spring});
      }
    }
    // Numbers that changed roll in from below.
    document.querySelectorAll('[data-count-key]').forEach(node => {
      const before = snapshot.counts.get(node.dataset.countKey);
      if (before == null || before === node.textContent) return;
      const up = Number(node.textContent) >= Number(before);
      node.animate([{opacity: 0, transform: 'translateY(' + (up ? '' : '-') + '55%)'}, {opacity: 1, transform: 'none'}], {duration: 460, easing: spring});
    });
  }

  function burst(anchor) {
    const box = anchor.getBoundingClientRect();
    const color = getComputedStyle(anchor).getPropertyValue('--view-color').trim() || getComputedStyle(document.documentElement).getPropertyValue('--action');
    const layer = document.createElement('div');
    layer.className = 'burst';
    layer.style.left = box.left + box.width / 2 + 'px';
    layer.style.top = box.top + box.height / 2 + 'px';
    for (let i = 0; i < 10; i++) {
      const dot = document.createElement('i');
      const angle = (i / 10) * Math.PI * 2 + Math.random() * .4, reach = 16 + Math.random() * 10;
      dot.style.background = i % 3 ? color : 'var(--yellow)';
      layer.append(dot);
      dot.animate([
        {transform: 'translate(-50%,-50%) scale(1)', opacity: 1},
        {transform: 'translate(calc(-50% + ' + Math.cos(angle) * reach + 'px), calc(-50% + ' + Math.sin(angle) * reach + 'px)) scale(0)', opacity: 0}
      ], {duration: 560 + Math.random() * 160, easing: gentle, fill: 'forwards'});
    }
    document.body.append(layer);
    setTimeout(() => layer.remove(), 800);
  }

  // Resolves once the check has filled, so the row moves away only after the user sees it land.
  function celebrate(row) {
    if (reduced() || !row) return Promise.resolve();
    row.classList.add('completing');
    burst(row.querySelector('.check'));
    return new Promise(resolve => setTimeout(resolve, 380));
  }

  return {capture, play, celebrate, spring, gentle, reduced};
})();
