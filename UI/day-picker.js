'use strict';
// A month calendar for choosing the days a task is planned for: one day, several separate days, or a range (F11).
// Click toggles a day. Range mode (or Shift-click) adds every day between two clicks. Each chosen day is listed
// below the calendar and can be removed on its own.
window.DayPicker = (() => {
  const monthName = new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric'});
  const chip = new Intl.DateTimeFormat('en-US', {weekday: 'short', month: 'short', day: 'numeric'});
  const fromISO = TaskLogic.fromISO, iso = TaskLogic.iso, addDays = TaskLogic.addDays;

  // "Wed, Nov 18", "Mon, Nov 16 and Wed, Nov 18", "Nov 16 – 20 (5 days)", or "4 days from Nov 16".
  function summary(dates) {
    const days = [...new Set(dates)].sort();
    if (!days.length) return 'Not planned';
    if (days.length === 1) return chip.format(fromISO(days[0]));
    const consecutive = days.every((date, index) => !index || addDays(days[index - 1], 1) === date);
    const short = new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric'});
    if (consecutive) return short.format(fromISO(days[0])) + ' – ' + short.format(fromISO(days.at(-1))) + ' (' + days.length + ' days)';
    if (days.length === 2) return chip.format(fromISO(days[0])) + ' and ' + chip.format(fromISO(days[1]));
    return days.length + ' days from ' + short.format(fromISO(days[0]));
  }

  function create({dates = [], today, onChange = () => {}}) {
    const selected = new Set(dates);
    let month = (([...selected].sort()[0]) || today).slice(0, 7), range = false, anchor = '';
    const node = document.createElement('div');
    node.className = 'day-picker';
    const emit = () => onChange([...selected].sort());
    function draw() {
      const first = fromISO(month + '-01'), lead = first.getDay();
      const total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < lead; i++) cells.push('<span></span>');
      for (let d = 1; d <= total; d++) {
        const date = month + '-' + String(d).padStart(2, '0');
        cells.push('<button type="button" data-day="' + date + '" aria-pressed="' + selected.has(date) + '"' + (date === today ? ' class="is-today"' : '') +
          (date === anchor && range ? ' data-anchor' : '') + ' aria-label="' + chip.format(fromISO(date)) + '">' + d + '</button>');
      }
      const days = [...selected].sort();
      node.innerHTML = '<div class="day-picker-head"><button type="button" data-month="-1" aria-label="Previous month">‹</button><b>' + monthName.format(first) + '</b>' +
        '<button type="button" data-month="1" aria-label="Next month">›</button></div>' +
        '<div class="day-picker-mode menu-segment"><button type="button" data-mode="days" aria-pressed="' + !range + '">Pick days</button><button type="button" data-mode="range" aria-pressed="' + range + '">Range</button></div>' +
        '<div class="day-picker-grid">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(name => '<span class="day-picker-weekday">' + name + '</span>').join('') + cells.join('') + '</div>' +
        '<p class="day-picker-summary" aria-live="polite">' + esc(summary(days)) + (range && anchor ? ' · choose the last day' : '') + '</p>' +
        '<div class="day-picker-chosen">' + days.map(date => '<span class="chip">' + esc(chip.format(fromISO(date))) +
          '<button type="button" class="chip-keep" data-remove="' + date + '" aria-label="Remove ' + esc(chip.format(fromISO(date))) + '">' + symbol('close-icon') + '</button></span>').join('') +
        (days.length ? '<button type="button" class="mini-link" data-clear>Clear</button>' : '') + '</div>';
    }
    node.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      event.preventDefault();
      if (target.dataset.month) {
        const shown = fromISO(month + '-01');
        shown.setMonth(shown.getMonth() + Number(target.dataset.month));
        month = iso(shown).slice(0, 7);
      } else if (target.dataset.mode) {
        range = target.dataset.mode === 'range';
        anchor = '';
      } else if (target.dataset.remove) {
        selected.delete(target.dataset.remove); emit();
      } else if (target.hasAttribute('data-clear')) {
        selected.clear(); anchor = ''; emit();
      } else if (target.dataset.day) {
        const date = target.dataset.day;
        if ((range || event.shiftKey) && anchor) {
          const [start, end] = [anchor, date].sort();
          for (let d = start; d <= end; d = addDays(d, 1)) selected.add(d);
          anchor = range ? '' : date;
        } else if (range) {
          anchor = date;
          selected.add(date);
        } else {
          if (selected.has(date)) selected.delete(date); else selected.add(date);
          anchor = date;
        }
        emit();
      }
      draw();
      node.querySelector('[data-day="' + (target.dataset.day || '') + '"]')?.focus();
    });
    draw();
    return {node, dates: () => [...selected].sort()};
  }

  return {create, summary};
})();
