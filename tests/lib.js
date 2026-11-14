'use strict';
/* Shared harness for the scripted usability tests. They drive the real UI/index.html from file:// with the
   fake host in tests/fixtures/ and a frozen clock. No network, no Swift. */
process.env.TZ = 'America/Los_Angeles';            // the sample day is written in this zone
const path = require('path');
const fs = require('fs');
const pw = require('playwright-core');
const sample = require('./fixtures/sample');
const UI = 'file://' + path.resolve(__dirname, '..', 'UI');
const HOST = path.join(__dirname, 'fixtures', 'test-host.js');
const BROWSER = process.env.SHISHI_BROWSER || 'chromium';
async function launch() {
  if (BROWSER === 'webkit') return pw.webkit.launch();
  const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(f => fs.existsSync(f));
  return pw.chromium.launch({...(exe ? {executablePath: exe} : {}), args: ['--no-sandbox']});
}
function suite(name) {
  const res = {name, browser: BROWSER, pass: 0, fail: 0, steps: []}; module.exports.current = res;
  const ok = (cond, msg, extra) => { res.steps.push({ok: !!cond, msg, extra}); cond ? res.pass++ : res.fail++; if (!cond) console.log(`   ✗ ${msg}` + (extra !== undefined ? `  → ${JSON.stringify(extra)}` : '')); else if (process.env.VERBOSE) console.log(`   ✓ ${msg}`); };
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, {got: a, want: b});
  return {res, ok, eq};
}
/* Open the app. o: variant (see fixtures/sample.js), lang, dark, rm, w, h, compact, quota (false = nothing readable),
   inbox (false = empty), file ('index.html' | 'result-panel.html'), config (extra fields for the fake host). */
async function open(browser, o = {}) {
  const variant = o.variant || 'dense', lang = o.lang || 'zh-Hans';
  const ctx = await browser.newContext({viewport: {width: o.w || 1140, height: o.h || 800}, colorScheme: o.dark ? 'dark' : 'light',
    reducedMotion: o.rm ? 'reduce' : 'no-preference', timezoneId: 'America/Los_Angeles', locale: lang === 'en' ? 'en-US' : 'zh-CN'});
  const p = await ctx.newPage();
  p.errors = []; p.failed = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') p.errors.push(m.text()); });
  p.on('requestfailed', r => p.failed.push(r.url()));
  p.on('response', r => { if (r.status() >= 400) p.failed.push(r.status() + ' ' + r.url()); });
  p.on('request', r => { if (!/^(file|data):/.test(r.url())) p.failed.push('external ' + r.url()); });
  await p.clock.setFixedTime(o.time || sample.clock(variant));
  const config = {lang, workspace: o.workspace === undefined ? sample.workspace(variant) : o.workspace,
    inbox: o.inbox === false ? {codex: [], external: []} : (o.inbox || sample.inbox()), quota: o.quota === false ? undefined : (o.quota || sample.quota()),
    compact: !!o.compact,
    // the tidy-up card opens by itself once a day; outside the morning scenario it has already been seen today
    prefs: variant === 'carry' ? {} : {reviewDay: sample.date(0)}, ...(o.config || {})};
  await p.addInitScript(c => { window.__SHISHI_TEST__ = c;
    document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI); }); }, config);
  await p.addInitScript({path: HOST});
  await p.goto(UI + '/' + (o.file || 'index.html'));
  if (!o.file) await p.waitForFunction(() => window.Shishi && Shishi.ready && __host.state.ops.includes('ready'));
  await p.waitForTimeout(250);
  return p;
}
/* Move the frozen clock (hours of the sample Friday; 24 and above is the next day) and let the app notice. */
async function setNow(p, hours, dayOffset = 0) {
  await p.clock.setFixedTime(sample.at(hours % 24, dayOffset + Math.floor(hours / 24)));
  await p.evaluate(() => tick());
}
/* New results arrive from the host; resolves after the app has announced them. */
async function deliver(p, rows) { await p.evaluate(r => __host.deliver(r), rows); await p.waitForTimeout(450); }
const num = s => { const m = String(s || '').match(/\d+/); return m ? +m[0] : 0; };

/* Cross-surface consistency: reads what the user sees and compares it with the store. */
async function consistency(p) {
  return p.evaluate(() => {
    const f = [], q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
    const num = s => { const m = String(s).match(/\d+/); return m ? +m[0] : 0; }, num_ = s => +(s || 0);
    const chip = k => { const b = q(`#filters [data-f="${k}"] b`); return b ? +b.textContent : 0; };
    const L = tasks(), done = L.filter(x => x.done).length;
    const constrained_ = st.tag || st.proj || st.query || st.only || st.range;
    if (st.scale === 'day' && st.mode !== 'compact') {
      const hd = q('#dDate').textContent;
      if (L.length) { const m = hd.match(/已完成 (\d+)\/(\d+)/); if (!m) f.push('header missing 已完成 N/M'); else { if (+m[1] !== done) f.push(`header done ${m[1]} ≠ store ${done}`); if (+m[2] !== L.length) f.push(`header total ${m[2]} ≠ store ${L.length}`); }
        if (!constrained_) { if (chip('all') !== L.length) f.push(`chip 全部 ${chip('all')} ≠ ${L.length}`); if (chip('done') !== done) f.push(`chip 已完成 ${chip('done')} ≠ ${done}`); } }
      const markers = qa('.bm').reduce((s, m) => s + (m.classList.contains('cl') ? +m.textContent : 1), 0);
      const openTimed = L.filter(x => !x.done && x.time != null).length;
      if (markers !== openTimed) f.push(`band markers ${markers} ≠ open timed ${openTimed}`);
      if (!constrained_ && st.day === st.today && chip('over') + chip('next') !== openTimed) f.push(`chips 逾期+接下来 ${chip('over') + chip('next')} ≠ open timed ${openTimed}`);
      // a finished task sits at its planned time, or at the moment it was completed when it had none
      const stars = qa('.bdone').length, doneOnBand = L.filter(x => doneHour(x) != null).length; if (stars !== doneOnBand) f.push(`band stars ${stars} ≠ done on band ${doneOnBand}`);
      if (st.day === st.today) { const cz = q('#carryZone b'); const c = carry().length; if (!cz || +cz.textContent !== c) f.push(`carry zone ${cz && cz.textContent} ≠ ${c}`);
        if (q('.review') && qa('.review .rv').length !== Math.min(c, st.reviewAll ? c : 6)) f.push(`review rows ${qa('.review .rv').length} ≠ carry ${c}`); if (q('.review') && !q('.review .rh b').textContent.includes(String(c))) f.push('review title count wrong'); }
      const nz = q('#nextZone b'); const nn = dayList(st.day + 1).length; if (!nz || +nz.textContent !== nn) f.push(`next zone ${nz && nz.textContent} ≠ ${nn}`);
      // every list row is a real task of the viewed day and respects the constraints
      if (st.nav !== 'done') { const ids = qa('#dList .drow[data-id]').map(r => r.dataset.id); const allowed = new Set(constrained(L).map(x => x.id));
        const bad = ids.filter(i => !allowed.has(i)); if (bad.length) f.push(`list shows ${bad.length} rows outside current filter/day`);
        if (new Set(ids).size !== ids.length) f.push('duplicate rows in list'); }
    }
    const T = dayList(st.today), tDone = T.filter(x => x.done).length;
    const side = q('.nav-row[data-nav="today"] .n'); if (side && num_(side.textContent) !== T.length - tDone) f.push(`sidebar 今天 ${side.textContent} ≠ open ${T.length - tDone}`);
    const plan = q('.nav-row[data-nav="plan"] .n'); const pv = S.tasks.filter(x => !x.done && x.day != null && x.day > st.today).length; if (plan && num_(plan.textContent) !== pv) f.push(`sidebar 计划 ${plan.textContent} ≠ ${pv}`);
    const all = q('.nav-row[data-nav="all"] .n'); const av = S.tasks.filter(x => !x.done).length; if (all && num_(all.textContent) !== av) f.push(`sidebar 全部 ${all.textContent} ≠ ${av}`);
    qa('#sideTags [data-tag]').forEach(r => { const v = S.tasks.filter(x => !x.done && x.tag === r.dataset.tag).length; if (num_(r.querySelector('.n').textContent) !== v) f.push(`tag ${r.dataset.tag} count wrong`); });
    qa('#sideProjects [data-proj]').forEach(r => { const v = S.tasks.filter(x => !x.done && x.proj === r.dataset.proj).length; if (num_(r.querySelector('.n').textContent) !== v) f.push(`project ${r.dataset.proj} count wrong`); });
    // floating Today agrees with the store
    if (!q('#cw').hidden) { const s = q('#cwSub').textContent, m = s.match(/已完成 (\d+)\/(\d+) · 逾期 (\d+) · 未定时 (\d+)/);
      const over = T.filter(isOver).length, un = T.filter(x => !x.done && x.time == null).length;
      if (!m) f.push('compact sub missing'); else if (+m[1] !== tDone || +m[2] !== T.length || +m[3] !== over || +m[4] !== un) f.push(`compact "${s}" ≠ store ${tDone}/${T.length} 逾期${over} 未定时${un}`);
      const off = +q('#cwRing').getAttribute('stroke-dashoffset'), want = 94.25 * (1 - tDone / T.length); if (Math.abs(off - want) > .5) f.push('compact ring ≠ progress'); }
    // quota ring and label == tightest window (or "not provided" when nothing is readable)
    const tq = Quota.tightest(), sl = q('#sideQuota .sq-r');
    if (sl && (tq ? !sl.textContent.includes(tq.v + '%') : sl.textContent !== tr('q.none'))) f.push('side quota label ≠ tightest');
    qa('[data-ring]').forEach(r => { const c = r.querySelectorAll('circle'); if (!c.length) return f.push('ring empty'); if (!tq) { if (c.length !== 1) f.push('ring shows a value with no quota'); return; }
      const C = 2 * Math.PI * 14; if (Math.abs(+c[1].getAttribute('stroke-dashoffset') - C * (1 - tq.v / 100)) > .5) f.push('ring ≠ tightest quota'); });
    // week columns agree with the store
    if (st.scale !== 'day') qa('.wday').forEach(w => { const d = +w.dataset.day, Ld = dayList(d), lab = w.querySelector('.wcount span').textContent;
      if (d > st.today && num(lab) !== Ld.length) f.push(`week ${d} label ${lab} ≠ ${Ld.length}`);
      if (d === st.today && lab !== `完成 ${Ld.filter(x => x.done).length}/${Ld.length}`) f.push(`week today label ${lab} ≠ ${Ld.length}`);
      const left = w.querySelector('.left'); const wantLeft = d < st.today ? Ld.filter(x => !x.done).length : d === st.today ? carry().length : 0; if ((left ? num(left.textContent) : 0) !== wantLeft) f.push(`week ${d} 遗留 ${left && left.textContent} ≠ ${wantLeft}`); });
    // AI results: every badge shows the same unread-group count as the store
    { const n = Inbox.unreadCount(), v = x => x == null ? 0 : +(x || 0);
      const got = {side: v(q('.nav-row[data-inbox] .n')?.textContent), toolbar: v(q('#inboxBtn .badge')?.textContent), island: v(q('#island')?.dataset.n), compact: v(q('#cwInbox .badge')?.textContent)};
      Object.entries(got).forEach(([k, x]) => { if (x !== n) f.push(`inbox badge ${k} ${x} ≠ ${n}`); });
      if (st.quiet && !q('#island').textContent.includes('专注中')) f.push('island not showing focus');
      if (q('#inbox') && !q('#inbox').hidden && !st.inbox.cu) { const u = q('#ibUnread').textContent; if (n ? !u.includes(n + ' 条未读') : !u.includes('没有未读')) f.push(`drawer header ${u} ≠ ${n}`); }
      qa('.blane[data-run]').forEach(b => { const r = Inbox.forRun(b.dataset.run); if (!!(r && r.unread) !== b.classList.contains('hasres')) f.push(`lane ${b.dataset.run} unread dot wrong`); }); }
    // what the host has saved equals what is on screen
    { const saved = __host.state.workspace; if (saved && __host.state.saves) { const a = JSON.stringify(saved.tasks), b = JSON.stringify(S.tasks.map(toEntry)); if (a !== b) f.push('saved workspace ≠ store'); } }
    return f;
  });
}
async function check(p, t, label) { const f = await consistency(p); t.ok(!f.length, `一致性 · ${label}`, f.length ? f : undefined); return f; }
/* Load check: no page errors, no failed or external requests, no CSP violations. */
async function clean(p, t, label) {
  const csp = await p.evaluate(() => window.__csp || []);
  t.ok(!p.errors.length && !p.failed.length && !csp.length, `加载检查 · ${label}`, {errors: p.errors, failed: p.failed, csp});
}
const toast = p => p.evaluate(() => Toast.text);
async function save(res) { const dir = path.join(__dirname, 'results'); fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, `${res.name}-${res.browser}.json`), JSON.stringify(res, null, 1)); }
module.exports = {UI, BROWSER, sample, launch, suite, open, setNow, deliver, consistency, check, clean, toast, num, save};
