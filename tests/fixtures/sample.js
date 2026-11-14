'use strict';
/* Sample data for the tests, in the app's real formats: a version 2 Workspace.json, inbox rows as the host
   sends them, and a quota report. It is the prototype's sample day (Friday 2026-11-13, 14:40 in Los Angeles).
   Everything here is fictional. */
const BASE = [2026, 10, 13];                       // Friday 13 November 2026
const pad = n => String(n).padStart(2, '0');
const date = offset => { const d = new Date(BASE[0], BASE[1], BASE[2] + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const at = (h, offset = 0) => new Date(BASE[0], BASE[1], BASE[2] + offset, Math.floor(h), Math.round((h % 1) * 60));
const epoch = (h, offset = 0) => at(h, offset).getTime() / 1000;
const hm = s => { const [h, m] = s.split(':').map(Number); return h + m / 60; };

const PROJECTS = ['发布 v1.7', '产品', '团队', '个人'];
const LABELS = ['产品', '发布', '团队', '反馈', '个人'];
const projectOf = tag => ({发布: '发布 v1.7', 产品: '产品', 反馈: '产品', 团队: '团队', 个人: '个人'}[tag] || '个人');

function tasks() {
  let n = 0;
  // day is an offset from Friday; null means "later"
  const T = (day, time, title, p = 2, o = {}) => {
    const e = {id: 't' + (++n), title, project: projectOf(o.tag), tag: o.tag || '', priority: 'P' + p,
      planned: day == null ? '' : date(day), source: '', quote: '', done: !!o.done};
    if (time && day != null) e.plannedTime = time.padStart(5, '0');
    if (o.done && day != null && time) e.completedAt = at(hm(time) + .25, day).toISOString();
    if (o.deferCount) e.deferCount = o.deferCount;
    if (o.dueDate) { e.dueDate = o.dueDate; if (o.dueTime) e.dueTime = o.dueTime; }
    return e;
  };
  const fri = [
    T(0, '8:30', '晨会准备', 2, {done: 1}), T(0, '9:00', '回复投资人邮件', 1, {done: 1, tag: '团队'}), T(0, '9:00', '确认首页设计稿', 2, {done: 1, tag: '产品'}),
    T(0, '9:15', '合并 PR #212', 0, {tag: '发布'}), T(0, '9:30', '更新路线图', 1, {tag: '产品'}), T(0, '10:00', '产品评审会', 2, {done: 1}),
    T(0, '10:30', '起草产品简报', 0, {done: 1, tag: '产品'}), T(0, '11:00', '整理评审会笔记', 0, {tag: '团队'}), T(0, '11:30', '给设计师反馈', 2, {done: 1, tag: '反馈'}),
    T(0, '12:00', '看 QA 报告', 2, {done: 1, tag: '反馈'}), T(0, '13:00', '订下周会议室', 2), T(0, '13:30', '写周报初稿', 2, {done: 1}),
    T(0, '14:00', 'Review the roadmap', 1, {tag: '产品'}), T(0, '15:00', '1:1 准备', 1, {tag: '团队'}), T(0, '15:30', '测试到期提醒', 2, {tag: '发布'}),
    T(0, '16:00', '发送发布检查清单', 0, {tag: '发布', dueDate: date(0), dueTime: '17:00'}), T(0, '16:00', '跟进法务意见', 1), T(0, '16:05', '打包测试版本', 2, {tag: '发布'}),
    T(0, '16:15', '发周会纪要', 2, {tag: '团队'}), T(0, '16:30', '确认发布文案', 1, {tag: '发布'}), T(0, '17:00', '回顾本周指标', 2, {tag: '产品'}),
    T(0, '17:30', '预约下周用户访谈', 2, {tag: '反馈'}), T(0, '19:30', '准备周五更新', 2), T(0, '20:00', '读 Liquid Glass 文档', 2, {tag: '个人'}),
    T(0, '21:00', '写明日计划', 2, {tag: '个人'}),
    ...['整理收件箱流程', '回复 Gmail 草稿', '更新依赖', '给 small-tool 写 README', '清理桌面截图', '研究 WidgetKit', '准备访谈问题', '补写发布说明', '买咖啡豆', '检查发票', '规划下周 sprint', '给团队发感谢']
      .map((t, i) => T(0, null, t, i === 0 ? 1 : 2, {tag: ['产品', '反馈', '发布', '产品', '个人', '产品', '反馈', '发布', '个人', '个人', '团队', '团队'][i], done: i === 8 ? 1 : 0})),
  ];
  const older = [T(-2, null, '补充单元测试', 2, {tag: '发布'}), T(-1, '17:00', '回复用户访谈邀约', 2, {tag: '反馈', deferCount: 3})];
  const sat = [T(1, '9:00', '整理本周照片', 2, {tag: '个人'}), T(1, '10:30', '和设计师远程走查', 1, {tag: '产品'}), T(1, '11:00', '发布测试版', 0, {tag: '发布'}), T(1, '14:00', '健身', 2, {tag: '个人'}),
    T(1, '16:30', '回顾访谈笔记', 2, {tag: '反馈'}), T(1, '20:00', '写周记', 2, {tag: '个人'}), T(1, null, '整理 WidgetKit 笔记', 2, {tag: '产品'}), T(1, null, '清理下载文件夹', 2)];
  const sun = [T(2, '10:00', '家庭午餐', 2, {tag: '个人'}), T(2, '16:00', '跑步', 2, {tag: '个人'}), T(2, null, '整理下周计划', 1, {tag: '团队'}), T(2, null, '给妈妈打电话', 2, {tag: '个人'})];
  const next = [T(3, '9:30', '和团队过发布计划', 1, {tag: '发布'}), T(4, '10:00', '设计评审', 1, {tag: '产品'}), T(4, '16:00', '发布 v1.7 测试版', 0, {tag: '发布'}),
    T(5, null, '补齐 WidgetKit 原型', 2, {tag: '产品'}), T(6, '14:00', '1:1', 2, {tag: '团队'}), T(6, null, '准备季度回顾', 2, {tag: '产品'})];
  const later = [T(11, null, '提交公证', 1, {tag: '发布'}), T(15, null, '季度回顾', 2, {tag: '产品'}), T(18, null, 'v1.8 规划', 2, {tag: '产品'}), T(null, null, '学 Swift Charts', 2, {tag: '个人'})];
  return [...fri, ...older, ...sat, ...sun, ...next, ...later];
}

/* variant: dense (Friday afternoon) · carry (Saturday morning) · night · hero (16:38) · empty · v1 (old file format) */
function workspace(variant = 'dense') {
  let list = tasks();
  const friday = date(0);
  const finish = (t, hour) => { t.done = true; t.completedAt = at(hour, 0).toISOString(); };
  if (variant === 'carry') {
    const keep = ['合并 PR #212', '整理评审会笔记', '更新路线图', '跟进法务意见', '预约下周用户访谈'];
    list.forEach(t => { if (t.planned === friday && !keep.includes(t.title) && !t.done) finish(t, 17); if (t.planned === date(-1)) finish(t, 17.5); });
  }
  if (variant === 'hero') list.forEach(t => { if (t.planned === friday && t.plannedTime && hm(t.plannedTime) < 16.6 && !['合并 PR #212', '跟进法务意见'].includes(t.title) && !t.done) finish(t, hm(t.plannedTime) + .2); });
  if (variant === 'night') list.push({id: 't-night', title: '提交本周周报', project: '团队', tag: '团队', priority: 'P1', planned: friday, plannedTime: '23:45', source: '', quote: '', done: false});
  if (variant === 'empty') list = list.filter(t => t.planned === '' || t.planned > friday);
  if (variant === 'v1') return {version: 1, projects: PROJECTS, tasks: list.map(({plannedTime, completedAt, deferCount, ...rest}) => rest)};
  return {version: 2, projects: PROJECTS, labels: LABELS, tasks: list};
}
const CLOCK = {dense: [0, 14 + 40 / 60], carry: [1, 8 + 10 / 60], night: [0, 23.5], hero: [0, 16 + 38 / 60], empty: [0, 9 + 20 / 60], v1: [0, 14 + 40 / 60]};
const clock = variant => at(CLOCK[variant][1], CLOCK[variant][0]);

/* ---------- inbox rows ---------- */
const THREAD = name => { let h = 0; for (const c of name) h = (h * 131 + c.charCodeAt(0)) >>> 0; return `00000000-0000-4000-8000-${h.toString(16).padStart(12, '0')}`; };
const SOURCE = {claude: 'Claude Code', grok: 'Grok Bot', ci: 'GitHub Actions', qwen: 'Local AI', mail: 'Gmail', bell: 'Reminders'};
let serial = 0;
/* pv 'codex' rows travel on the codex channel and share a conversation; everything else is a connector row. */
function row(pv, thread, task, title, detail, hour, read, extra = {}) {
  const id = ++serial, time = extra.time ?? epoch(hour);
  if (pv === 'codex') return {channel: 'codex', id: `${THREAD(thread)}/turn-${id}`, thread: THREAD(thread), title: task, summary: `${title}\n${detail}`, time, read: !!read, archived: false, accepted: false, ...extra.more};
  const feed = pv === 'ci' || pv === 'mail' || pv === 'bell';
  return {channel: 'external', id: `connector/${String(id).padStart(64, '0')}`, source: SOURCE[pv], title: feed ? title : task, summary: feed ? detail : `${title}\n${detail}`,
    time, read: !!read, thread: '', link: extra.link || '', archived: false, accepted: false, ...extra.more};
}
function inbox() {
  serial = 0;
  const list = [
    row('codex', 'pr212', '合并 PR #212', 'PR #212 的 3 个测试全部通过，可以合并', '跑了单元测试和快照测试；没有改动公共 API。', 10, true),
    row('claude', 'tz', '修复截止日期时区', '改成本地时区，1 处数据迁移需要你确认', '旧数据里 12 条截止时间是 UTC，迁移会换算成本地时间。', 10 + 20 / 60, true, {link: 'https://claude.ai/chat/sample'}),
    row('grok', 'swiftui', 'SwiftUI 示例对比', '对比了 3 个 Apple 风格的 SwiftUI 示例仓库', '推荐 IceCubes 的列表结构；另外两个缺少无障碍标签。', 9 + 55 / 60, true),
    row('codex', 'build', '打包测试版本', '构建失败：钥匙串里找不到签名证书', 'codesign 返回 errSecInternalComponent，通常重新解锁钥匙串即可。', 11 + 20 / 60, true),
    row('ci', 'ci128', '', 'small-tool · main 的 CI #128 · 失败', '格式检查：2 个文件的缩进不符合 swiftformat 规则。', 13 + 58 / 60, false, {link: 'https://github.com/example/small-tool/actions/runs/128'}),
    row('claude', 'weekly', '整理周报表格', '给 weekly-update.md 加了两列，日期格式需要确认', '截止日期写成了 2026-11-13，模板其他地方用“11月13日”。', 14 + 40 / 60, false),
    row('codex', 'notes', '生成发布说明', '开始生成发布说明', '读取 42 个提交。', 13 + 46 / 60, true),
    row('codex', 'notes', '生成发布说明', '已分组：新功能 6 · 修复 9', '按提交类型分组。', 14 + 10 / 60, true),
    row('codex', 'notes', '生成发布说明', '发布说明草稿已写好（412 字）', '草稿在 RELEASE_NOTES.md；没有改动其他文件。', 14 + 40 / 60, false),
  ];
  return {codex: list.filter(r => r.channel === 'codex'), external: list.filter(r => r.channel === 'external')};
}
// one refactoring job fans out to ten results within a second
const BURST = [
  ['claude', 'auth', '重构 Auth 模块', 'Auth 拆成 3 个文件，1 个接口改名需要确认', '改名会影响 2 个调用方：LoginView、TokenStore。'],
  ['codex', 'net', '重构网络层', '网络层改用 async/await，测试全部通过', '删掉 214 行回调代码。'],
  ['codex', 'ui', '整理设置页', '设置页拆成 4 个子视图', '保持原有布局。'],
  ['codex', 'ui', '整理设置页', '设置页的预览全部恢复', '补了 4 个 #Preview。'],
  ['claude', 'db', '迁移本地数据库', 'SQLite 表结构有 1 处不可逆变更，需要你确认', 'tasks.due 从 TEXT 改成 INTEGER，旧格式不能回滚。'],
  ['grok', 'docs', '补文档', '给 12 个公开类型补了文档注释', '代码保持原样。'],
  ['ci', 'ci129', '', 'refactor 分支 CI #129 · 失败', '2 个快照测试：快照里时间格式变了。'],
  ['qwen', 'tags', '本地 Qwen 提取任务', '从 6 封邮件提取了 4 个任务', '已放进收件箱，等你挑选后再加入今天。'],
  ['codex', 'lint', '清理警告', '清掉 37 个编译警告', '都是多余的变量。'],
  ['claude', 'i18n', '补齐本地化', '补齐 18 条中文文案', '术语和现有文案一致。'],
];
function burst(n = 10, hour = 14 + 40 / 60, offset = 0) {
  const list = [];
  for (let i = 0; i < n; i++) { const b = BURST[i % BURST.length], round = Math.floor(i / BURST.length);
    list.push(row(b[0], b[1] + (round ? '-' + round : ''), b[2], b[3], b[4], hour, false, {time: epoch(hour, offset) + i / 100})); }
  return list;
}
function volume(n = 30, hour = 14 + 40 / 60) {
  // thirty updates from fifteen Codex conversations, two each
  const S = ['done', 'done', 'done', 'fail', 'confirm'], list = [];
  for (let i = 0; i < n; i++) { const s = S[i % 5], k = Math.floor(i / 2);
    const title = s === 'fail' ? `第 ${i + 1} 项运行失败` : s === 'confirm' ? `第 ${i + 1} 项改动需要确认` : `第 ${i + 1} 项已完成`;
    list.push(row('codex', 'v' + k, `批量任务 ${k + 1}`, title, '示例数据。', hour, false, {time: epoch(hour) - (n - i)})); }
  return list;
}
function quota() {
  return {updatedAt: epoch(14 + 38 / 60), providers: [
    {id: 'codex', plan: 'ChatGPT Plus', credits: '1,250', windows: [{kind: 'fiveHour', leftPercent: 62, resetsAt: epoch(16 + 5 / 60)}, {kind: 'weekly', leftPercent: 39, resetsAt: epoch(9, 4)}]},
    {id: 'claude', plan: 'Claude Max', windows: [{kind: 'fiveHour', leftPercent: 18, resetsAt: epoch(15.5)}, {kind: 'sevenDay', leftPercent: 56, resetsAt: epoch(8, 6)}]},
    {id: 'grok', plan: 'SuperGrok', windows: [], status: 'usageOnly'},
    {id: 'qwen', windows: [], status: 'local', available: true, lastRun: {seconds: 3.2, count: 6, at: epoch(13)}},
  ]};
}
module.exports = {BASE, date, at, epoch, workspace, clock, inbox, burst, volume, quota, PROJECTS, LABELS};
