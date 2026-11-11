'use strict';

// Date arithmetic, repeat rules and the quick-add parser. No DOM access, so it runs under Node for tests.
(root => {
  const pad = number => String(number).padStart(2, '0');
  const iso = date => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  // Noon avoids a date shift when a daylight-saving change removes midnight.
  const fromISO = text => new Date(text + 'T12:00:00');
  const addDays = (text, days) => { const date = fromISO(text); date.setDate(date.getDate() + days); return iso(date); };
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const repeatLabels = {daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year'};

  function nextWeekday(today, target, strictlyNextWeek) {
    const start = fromISO(today);
    let distance = (target - start.getDay() + 7) % 7 || 7;
    if (strictlyNextWeek && distance < 7 && target > start.getDay()) distance += 7;
    return addDays(today, distance);
  }

  function addMonths(text, count) {
    const date = fromISO(text), day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + count);
    // The 31st becomes the last day of a shorter month.
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
    return iso(date);
  }

  // The next occurrence falls after both the previous date and today, so a late task does not repeat in the past.
  function nextRepeat(from, rule, today) {
    if (!repeatLabels[rule]) return '';
    let date = from || today;
    for (let guard = 0; guard < 4000; guard++) {
      if (rule === 'daily') date = addDays(date, 1);
      else if (rule === 'weekly') date = addDays(date, 7);
      else if (rule === 'monthly') date = addMonths(date, 1);
      else if (rule === 'yearly') date = addMonths(date, 12);
      else {
        do { date = addDays(date, 1); } while ([0, 6].includes(fromISO(date).getDay()));
      }
      if (date > today) return date;
    }
    return addDays(today, 1);
  }

  function clock(hour, minute, half) {
    let h = Number(hour);
    const m = Number(minute || 0);
    if (half) {
      if (h < 1 || h > 12) return '';
      if (half === 'p' && h < 12) h += 12;
      if (half === 'a' && h === 12) h = 0;
    }
    return h > 23 || m > 59 ? '' : pad(h) + ':' + pad(m);
  }

  /**
   * "Send report friday 3pm #Finance !p1 @Work every week" becomes a title plus fields.
   * A date schedules the task. A time, or the words "by" and "due", also sets its deadline.
   */
  function parse(input, context = {}) {
    const today = context.today || iso(new Date());
    const projects = context.projects || [], tags = context.tags || [];
    const found = {title: '', planned: '', dueDate: '', dueTime: '', priority: '', tag: '', project: '', repeat: ''};
    let text = ' ' + String(input || '').replace(/\s+/g, ' ').trim() + ' ';
    let date = '', deadline = false;
    const take = (pattern, use) => {
      const match = pattern.exec(text);
      if (!match) return false;
      if (use(match) === false) return false;
      text = text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length);
      return true;
    };

    take(/ !(p[0-2]|high|urgent|medium|med|low|!{1,2})(?= )/i, m => {
      const word = m[1].toLowerCase();
      found.priority = {p0: 'P0', p1: 'P1', p2: 'P2', high: 'P0', urgent: 'P0', '!!': 'P0', medium: 'P1', med: 'P1', '!': 'P1', low: 'P2'}[word];
    });
    take(/ #([^\s#@!]{1,30})(?= )/, m => {
      const wanted = m[1].replace(/[-_]/g, ' ').toLowerCase();
      found.tag = tags.find(name => name.toLowerCase() === wanted) || tags.find(name => name.toLowerCase() === m[1].toLowerCase()) || m[1];
    });
    take(/ @([^\s#@!]{1,32})(?= )/, m => {
      const wanted = m[1].replace(/[-_]/g, ' ').toLowerCase();
      const hit = projects.find(name => name.toLowerCase() === wanted) || projects.find(name => name.toLowerCase().startsWith(wanted));
      if (!hit) return false;
      found.project = hit;
    });
    take(/ (every ?day|daily|every weekday|weekdays|every week|weekly|every month|monthly|every year|yearly|annually)(?= )/i, m => {
      const word = m[1].toLowerCase().replace(' ', '');
      found.repeat = /weekday/.test(word) ? 'weekdays' : /day|daily/.test(word) ? 'daily' : /week/.test(word) ? 'weekly' : /month/.test(word) ? 'monthly' : 'yearly';
    });

    const by = '(?:(by|due|until|before) )?';
    const dayNames = weekdays.map(name => name + '|' + name.slice(0, 3)).join('|');
    const monthNames = months.map(name => name + '|' + name.slice(0, 3)).join('|');
    const setDate = (value, word) => { date = value; if (word) deadline = true; };
    take(new RegExp(' ' + by + '(today|tonight|tomorrow|tmr|tmrw)(?= )', 'i'), m => {
      setDate(/^to(day|night)$/i.test(m[2]) ? today : addDays(today, 1), m[1]);
      if (/tonight/i.test(m[2]) && !found.dueTime) found.dueTime = '20:00';
    }) || take(new RegExp(' ' + by + 'next week(?= )', 'i'), m => setDate(nextWeekday(today, 1), m[1]))
      || take(new RegExp(' ' + by + '(next )?(' + dayNames + ')(?= )', 'i'), m => {
        setDate(nextWeekday(today, weekdays.findIndex(name => name.startsWith(m[3].toLowerCase().slice(0, 3))), !!m[2]), m[1]);
      })
      || take(new RegExp(' ' + by + 'in (\\d{1,3}) (day|week)s?(?= )', 'i'), m => setDate(addDays(today, Number(m[2]) * (m[3].toLowerCase() === 'week' ? 7 : 1)), m[1]))
      || take(new RegExp(' ' + by + '(' + monthNames + ')\\.? (\\d{1,2})(?:st|nd|rd|th)?(?= )', 'i'), m => {
        const month = months.findIndex(name => name.startsWith(m[2].toLowerCase().slice(0, 3))), day = Number(m[3]);
        const year = Number(today.slice(0, 4));
        let value = year + '-' + pad(month + 1) + '-' + pad(day);
        if (day < 1 || day > 31 || iso(fromISO(value)) !== value) return false;
        if (value < today) value = (year + 1) + value.slice(4);
        setDate(value, m[1]);
      })
      || take(new RegExp(' ' + by + '(\\d{1,2})/(\\d{1,2})(?= )'), m => {
        const year = Number(today.slice(0, 4));
        let value = year + '-' + pad(m[2]) + '-' + pad(m[3]);
        if (iso(fromISO(value)) !== value) return false;
        if (value < today) value = (year + 1) + value.slice(4);
        setDate(value, m[1]);
      });

    take(/ (?:at )?(\d{1,2})(?::(\d{2}))? ?([ap])\.?m\.?(?= )/i, m => { const value = clock(m[1], m[2], m[3].toLowerCase()); if (!value) return false; found.dueTime = value; })
      || take(/ (?:at )?(\d{1,2}):(\d{2})(?= )/, m => { const value = clock(m[1], m[2]); if (!value) return false; found.dueTime = value; })
      || take(/ (?:at )?(noon|midnight)(?= )/i, m => { found.dueTime = m[1].toLowerCase() === 'noon' ? '12:00' : '23:59'; });

    if (found.dueTime && !date) date = today;
    if (date) {
      if (found.dueTime || deadline) found.dueDate = date;
      if (!deadline) found.planned = date;
    }
    if (!found.dueDate) found.dueTime = '';
    found.title = text.replace(/\s+/g, ' ').trim();
    return found;
  }

  root.TaskLogic = {iso, fromISO, addDays, addMonths, nextRepeat, nextWeekday, parse, repeatLabels};
})(typeof window === 'undefined' ? globalThis : window);
