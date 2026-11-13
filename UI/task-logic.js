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
  // Chinese numerals for days and hours, up to 31.
  function zhNumber(text) {
    if (/^\d+$/.test(text)) return Number(text);
    const digits = {'零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9};
    if (text === '十') return 10;
    const [tens, ones] = text.split('十');
    if (text.includes('十')) return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
    return digits[text] ?? NaN;
  }
  const ZH_NUM = '(\\d{1,2}|[零〇一二两三四五六七八九十]{1,3})';
  const ZH_DAYS = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0, '末': 6};
  const ESCAPES = {'#': '', '@': '', '!': ''};

  /**
   * Reads dates, times, priority, tag, list and repeat from typed text, in English or Chinese.
   * Each recognized piece is listed in parts, so the person can see it and turn it back into text:
   * context.ignore holds the kinds to leave alone. A backslash keeps the next #, @ or ! as text,
   * and a # followed by a number (#123) is a reference, not a tag.
   */
  function parse(input, context = {}) {
    const today = context.today || iso(new Date());
    const projects = context.projects || [], tags = context.tags || [];
    const ignore = new Set(context.ignore || []);
    const found = {title: '', planned: '', dueDate: '', dueTime: '', priority: '', tag: '', project: '', repeat: '', parts: []};
    let text = ' ' + String(input || '').replace(/\\([#@!])/g, (_, mark) => ESCAPES[mark]).replace(/\s+/g, ' ').trim() + ' ';
    let date = '', deadline = false;
    const take = (kind, pattern, use) => {
      if (ignore.has(kind)) return false;
      const match = pattern.exec(text);
      if (!match) return false;
      if (use(match) === false) return false;
      found.parts.push({kind, text: match[0].trim()});
      text = text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length);
      return true;
    };

    take('priority', / !(p[0-2]|high|urgent|medium|med|low|!{1,2})(?= )/i, m => {
      const word = m[1].toLowerCase();
      found.priority = {p0: 'P0', p1: 'P1', p2: 'P2', high: 'P0', urgent: 'P0', '!!': 'P0', medium: 'P1', med: 'P1', '!': 'P1', low: 'P2'}[word];
    });
    take('tag', / #(\p{L}[^\s#@!]{0,29})(?= )/u, m => {
      const wanted = m[1].replace(/[-_]/g, ' ').toLowerCase();
      found.tag = tags.find(name => name.toLowerCase() === wanted) || tags.find(name => name.toLowerCase() === m[1].toLowerCase()) || m[1];
    });
    take('project', / @([^\s#@!]{1,32})(?= )/, m => {
      const wanted = m[1].replace(/[-_]/g, ' ').toLowerCase();
      const hit = projects.find(name => name.toLowerCase() === wanted) || projects.find(name => name.toLowerCase().startsWith(wanted));
      if (!hit) return false;
      found.project = hit;
    });
    take('repeat', / (every ?day|daily|every weekday|weekdays|every week|weekly|every month|monthly|every year|yearly|annually)(?= )/i, m => {
      const word = m[1].toLowerCase().replace(' ', '');
      found.repeat = /weekday/.test(word) ? 'weekdays' : /day|daily/.test(word) ? 'daily' : /week/.test(word) ? 'weekly' : /month/.test(word) ? 'monthly' : 'yearly';
    }) || take('repeat', /(每天|每日|每个?工作日|工作日每天|每周|每星期|每个?月|每年)/, m => {
      const word = m[1];
      found.repeat = /工作日/.test(word) ? 'weekdays' : /[天日]/.test(word) ? 'daily' : /[周星]/.test(word) ? 'weekly' : /月/.test(word) ? 'monthly' : 'yearly';
    });

    const setDate = (value, word) => { date = value; if (word) deadline = true; };
    let evening = false;
    // Chinese: 今天 明天 后天, 周五 / 下周一, 11月20日, 3天后; …前 / 截止… make it a deadline.
    const zhDue = '(截止(?:到|于)?)?';
    const zhBefore = '(之前|以前|前|为止)?';
    const zhDate = take('date', new RegExp(zhDue + '(今天|今日|今晚|明天|明日|明晚|大后天|后天)' + zhBefore), m => {
      const offset = {'今天': 0, '今日': 0, '今晚': 0, '明天': 1, '明日': 1, '明晚': 1, '后天': 2, '大后天': 3}[m[2]];
      setDate(addDays(today, offset), m[1] || m[3]);
      if (/晚/.test(m[2])) evening = true;
    }) || take('date', new RegExp(zhDue + '(下(?:个)?)?(?:周|星期|礼拜)([一二三四五六日天末])' + zhBefore), m => {
      setDate(nextWeekday(today, ZH_DAYS[m[3]], !!m[2]), m[1] || m[4]);
    }) || take('date', new RegExp(zhDue + '下(?:个)?(?:周|星期|礼拜)' + zhBefore), m => setDate(nextWeekday(today, 1), m[1] || m[2]))
      || take('date', new RegExp(zhDue + ZH_NUM + '月' + ZH_NUM + '(?:日|号)' + zhBefore), m => {
        const month = zhNumber(m[2]), dayOfMonth = zhNumber(m[3]), year = Number(today.slice(0, 4));
        let value = year + '-' + pad(month) + '-' + pad(dayOfMonth);
        if (!(month >= 1 && month <= 12) || iso(fromISO(value)) !== value) return false;
        if (value < today) value = (year + 1) + value.slice(4);
        setDate(value, m[1] || m[4]);
      })
      || take('date', new RegExp(ZH_NUM + '(天|周|个?星期)(?:以)?后'), m => setDate(addDays(today, zhNumber(m[1]) * (/天/.test(m[2]) ? 1 : 7)), ''));
    // Chinese times: 下午3点, 晚上8点半, 10点15分, or 上午9:30. A bare 9:30 is left to the English rules below.
    const zhTime = (half, hourText, rest) => {
      let hour = zhNumber(hourText);
      const minute = rest === '半' ? 30 : rest ? zhNumber(rest.replace('分', '')) : 0;
      half = half || (evening ? '晚上' : '');
      if (/下午|傍晚|晚上|今晚/.test(half) && hour < 12) hour += 12;
      else if (/中午/.test(half) && hour < 11) hour += 12;
      else if (/凌晨/.test(half) && hour === 12) hour = 0;
      // Without a part of day, a working-hours guess: 1 to 6 means the afternoon. The preview shows it.
      else if (!half && hour >= 1 && hour <= 6) hour += 12;
      if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) return false;
      found.dueTime = pad(hour) + ':' + pad(minute);
      if (!date) setDate(today, '');
    };
    const PART = '(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚)';
    take('time', new RegExp(PART + '?' + ZH_NUM + '(?:点|时)(半|\\d{1,2}分?|[一二三四五十]{1,3}分)?'), m => zhTime(m[1], m[2], m[3] || ''))
      || take('time', new RegExp(PART + '(\\d{1,2})[:：](\\d{2})'), m => zhTime(m[1], m[2], m[3]));
    if (evening && !found.dueTime) found.dueTime = '20:00';

    const by = '(?:(by|due|until|before) )?';
    const dayNames = weekdays.map(name => name + '|' + name.slice(0, 3)).join('|');
    const monthNames = months.map(name => name + '|' + name.slice(0, 3)).join('|');
    // "this evening" plans the task for Today's evening section; "someday" parks it without a date (as in Things).
    take('evening', / (this evening)(?= )/i, () => { if (!found.planned) setDate(today, ''); found.evening = true; });
    take('someday', / (someday|some day)(?= )/i, () => { found.someday = true; });
    if (!zhDate) {
      take('date', new RegExp(' ' + by + '(today|tonight|tomorrow|tmr|tmrw)(?= )', 'i'), m => {
        setDate(/^to(day|night)$/i.test(m[2]) ? today : addDays(today, 1), m[1]);
        if (/tonight/i.test(m[2]) && !found.dueTime) found.dueTime = '20:00';
      }) || take('date', new RegExp(' ' + by + 'next week(?= )', 'i'), m => setDate(nextWeekday(today, 1), m[1]))
        || take('date', new RegExp(' ' + by + '(next )?(' + dayNames + ')(?= )', 'i'), m => {
          setDate(nextWeekday(today, weekdays.findIndex(name => name.startsWith(m[3].toLowerCase().slice(0, 3))), !!m[2]), m[1]);
        })
        || take('date', new RegExp(' ' + by + 'in (\\d{1,3}) (day|week)s?(?= )', 'i'), m => setDate(addDays(today, Number(m[2]) * (m[3].toLowerCase() === 'week' ? 7 : 1)), m[1]))
        || take('date', new RegExp(' ' + by + '(' + monthNames + ')\\.? (\\d{1,2})(?:st|nd|rd|th)?(?= )', 'i'), m => {
          const month = months.findIndex(name => name.startsWith(m[2].toLowerCase().slice(0, 3))), dayOfMonth = Number(m[3]);
          const year = Number(today.slice(0, 4));
          let value = year + '-' + pad(month + 1) + '-' + pad(dayOfMonth);
          if (dayOfMonth < 1 || dayOfMonth > 31 || iso(fromISO(value)) !== value) return false;
          if (value < today) value = (year + 1) + value.slice(4);
          setDate(value, m[1]);
        })
        || take('date', new RegExp(' ' + by + '(\\d{1,2})/(\\d{1,2})(?= )'), m => {
          const year = Number(today.slice(0, 4));
          let value = year + '-' + pad(m[2]) + '-' + pad(m[3]);
          if (iso(fromISO(value)) !== value) return false;
          if (value < today) value = (year + 1) + value.slice(4);
          setDate(value, m[1]);
        });
    }
    if (!found.dueTime) {
      take('time', / (?:at )?(\d{1,2})(?::(\d{2}))? ?([ap])\.?m\.?(?= )/i, m => { const value = clock(m[1], m[2], m[3].toLowerCase()); if (!value) return false; found.dueTime = value; })
        || take('time', / (?:at )?(\d{1,2}):(\d{2})(?= )/, m => { const value = clock(m[1], m[2]); if (!value) return false; found.dueTime = value; })
        || take('time', / (?:at )?(noon|midnight)(?= )/i, m => { found.dueTime = m[1].toLowerCase() === 'noon' ? '12:00' : '23:59'; });
    }

    if (found.dueTime && !date) date = today;
    if (date) {
      if (found.dueTime || deadline) found.dueDate = date;
      if (!deadline) found.planned = date;
    }
    if (!found.dueDate) found.dueTime = '';
    found.title = text.replace(/[-]/g, ch => Object.keys(ESCAPES).find(key => ESCAPES[key] === ch))
      .replace(/\s+([，。,、])/g, '$1').replace(/^[\s，,、]+|[\s，,、]+$/g, '').replace(/\s+/g, ' ').trim();
    return found;
  }

  /**
   * Saved filters, in a small query language like Todoist's:
   *   today, tomorrow, overdue, upcoming, "no date", evening, someday, done, open, repeating, agent
   *   "next 7 days", "due" (has a deadline), p0 / p1 / p2, #tag, @list, "search: words"
   *   combined with & (and), | (or), ! (not) and parentheses.  Example: (today | overdue) & #Work & !p2
   * Returns {test(task), error}. A query that cannot be read returns an error and matches nothing.
   */
  function filter(query, context) {
    const today = context.today;
    const days = task => task.plannedDates?.length ? task.plannedDates : task.planned ? [task.planned] : [];
    const date = task => days(task).find(d => d >= today) || days(task).at(-1) || task.dueDate || '';
    const lower = value => String(value || '').toLocaleLowerCase();
    const terms = {
      today: task => days(task).includes(today) || (!!task.dueDate && task.dueDate === today),
      tomorrow: task => days(task).includes(addDays(today, 1)) || task.dueDate === addDays(today, 1),
      overdue: task => !task.done && ((!!task.dueDate && task.dueDate < today) || (days(task).length > 0 && days(task).every(d => d < today))),
      upcoming: task => date(task) > today,
      'no date': task => !days(task).length && !task.dueDate,
      evening: task => !!task.evening,
      someday: task => !!task.someday,
      done: task => !!task.done,
      open: task => !task.done,
      repeating: task => !!task.repeat,
      agent: task => !!task.agentReceipt || !!task.agentStarted,
      due: task => !!task.dueDate,
      p0: task => task.priority === 'P0', p1: task => task.priority === 'P1', p2: task => !task.priority || task.priority === 'P2'
    };
    const tokens = [];
    const source = String(query || '').trim();
    const pattern = /\s*(\(|\)|&|\||!|search:\s*[^&|()]+|#[^&|()!]+|@[^&|()!]+|next \d{1,3} days|no date|[a-z0-9]+)/iy;
    let at = 0;
    while (at < source.length) {
      pattern.lastIndex = at;
      const match = pattern.exec(source);
      if (!match) return {test: () => false, error: 'Shishi could not read “' + source.slice(at).trim().slice(0, 30) + '”.'};
      tokens.push(match[1].trim());
      at = pattern.lastIndex;
      while (source[at] === ' ') at++;
    }
    if (!tokens.length) return {test: () => false, error: 'Type a filter, for example: today & #Work'};
    let index = 0;
    const peek = () => tokens[index];
    function atom() {
      const token = tokens[index++];
      if (token === undefined) throw Error('The filter ends too early.');
      if (token === '(') { const inner = or(); if (tokens[index++] !== ')') throw Error('A “(” is not closed.'); return inner; }
      if (token === '!') { const inner = atom(); return task => !inner(task); }
      const word = lower(token);
      if (word.startsWith('#')) { const name = lower(token.slice(1).trim()); return task => lower(task.tag) === name; }
      if (word.startsWith('@')) { const name = lower(token.slice(1).trim()); const label = context.listName || (id => id); return task => lower(label(task.project)) === name; }
      if (word.startsWith('search:')) { const text = lower(token.slice(7).trim()); return task => lower(task.title + ' ' + (task.notes || '')).includes(text); }
      const range = /^next (\d{1,3}) days$/.exec(word);
      if (range) { const end = addDays(today, Number(range[1])); return task => { const d = date(task); return !!d && d >= today && d <= end; }; }
      if (terms[word]) return terms[word];
      throw Error('“' + token + '” is not a filter word. Try today, overdue, #tag, @list, p1 or search: words.');
    }
    function and() { let left = atom(); while (peek() === '&') { index++; const right = atom(), l = left; left = task => l(task) && right(task); } return left; }
    function or() { let left = and(); while (peek() === '|') { index++; const right = and(), l = left; left = task => l(task) || right(task); } return left; }
    try {
      const test = or();
      if (index < tokens.length) throw Error('Use & or | between filter words: “' + tokens[index] + '” is unexpected.');
      return {test, error: ''};
    } catch (problem) {
      return {test: () => false, error: problem.message};
    }
  }

  root.TaskLogic = {iso, fromISO, addDays, addMonths, nextRepeat, nextWeekday, parse, repeatLabels, filter};
})(typeof window === 'undefined' ? globalThis : window);
