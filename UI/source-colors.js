'use strict';
// A colour for each connection, so results from different sources are easy to tell apart (F12).
// It is shown as a thin stripe and a dot beside the source name, never as a status colour,
// and the source name is always written out, so colour is never the only cue.
const SourceColors = (() => {
  const presets = [['Blue', '#0a84ff'], ['Teal', '#30b0c7'], ['Green', '#34c759'], ['Orange', '#ff9f0a'],
                   ['Pink', '#ff375f'], ['Purple', '#af52de'], ['Brown', '#a2845e'], ['Graphite', '#8e8e93']];
  // Results carry a source name. Each connection delivers under one name.
  const connections = {
    'Claude Code': 'Claude Code', 'Codex': 'Codex', 'Grok Bot': 'Grok Bot', 'Grok Build': 'Grok Bot',
    'Local AI': 'Other AI apps', 'Gmail': 'Gmail', 'Outlook': 'Outlook', 'GitHub Actions': 'GitHub Actions'
  };
  const keyFor = source => connections[source] || source;
  const valid = color => /^#[0-9a-f]{6}$/i.test(color || '');
  function colorFor(source) {
    const color = (data.sourceColors || {})[keyFor(source)];
    return valid(color) ? color : '';
  }
  function set(key, color) {
    return change(state => {
      state.sourceColors = {...(state.sourceColors || {})};
      if (valid(color)) state.sourceColors[key] = color.toLowerCase(); else delete state.sourceColors[key];
      if (!Object.keys(state.sourceColors).length) delete state.sourceColors;
    });
  }
  function swatch(key) {
    const color = (data.sourceColors || {})[key] || '';
    return '<button type="button" class="source-swatch' + (color ? ' chosen' : '') + '" data-color-for="' + esc(key) + '" style="--swatch:' + (color || 'transparent') + '" title="Colour for ' + esc(key) + '" aria-label="Colour for ' + esc(key) + (color ? ', ' + esc(color) : ', none') + '"></button>';
  }
  function picker(anchor) {
    const key = anchor.dataset.colorFor, current = (data.sourceColors || {})[key] || '';
    const pop = document.createElement('div');
    pop.className = 'task-picker color-picker';
    pop.setAttribute('aria-label', 'Colour for ' + key);
    pop.innerHTML = '<h3>' + esc(key) + '</h3><div class="color-grid">' + presets.map(([name, color]) =>
      '<button type="button" data-color="' + color + '" style="--swatch:' + color + '" aria-pressed="' + (color === current) + '" title="' + name + '" aria-label="' + name + '"></button>').join('') + '</div>' +
      '<label class="color-custom">Custom<input type="color" value="' + (current || '#0a84ff') + '"></label>' +
      '<button type="button" class="mini-link" data-color="">Reset to none</button>';
    const choose = color => action(set(key, color).then(() => {
      pop.hidePopover();
      const row = document.querySelector('[data-color-for="' + CSS.escape(key) + '"]');
      if (row) row.outerHTML = swatch(key);
      paint();
    }));
    pop.addEventListener('click', event => { const button = event.target.closest('[data-color]'); if (button) choose(button.dataset.color); });
    pop.querySelector('input[type=color]').addEventListener('change', event => choose(event.target.value));
    placeTaskPicker(pop, anchor);
    pop.querySelector('[aria-pressed="true"], [data-color]').focus();
  }
  // Re-colour what is on screen after a change.
  function paint() {
    document.querySelectorAll('.result-card[data-source-name]').forEach(card => apply(card, card.dataset.sourceName));
    window.Card?.refresh();
  }
  function apply(node, source) {
    const color = colorFor(source);
    node.dataset.sourceName = source;
    node.classList.toggle('has-source-color', !!color);
    if (color) node.style.setProperty('--source-color', color); else node.style.removeProperty('--source-color');
  }
  document.addEventListener('click', event => {
    const anchor = event.target.closest('.source-swatch');
    if (anchor) { event.preventDefault(); event.stopPropagation(); picker(anchor); }
  }, true);
  return {colorFor, swatch, apply, keyFor, presets};
})();
window.SourceColors = SourceColors;
