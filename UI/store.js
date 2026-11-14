'use strict';
/* One store for the whole window. Tasks come from Workspace.json through the bridge. Every count on screen
   (header, chips, band, sidebar, floating Today, week) is derived from S.tasks, and every change goes through
   act(), which records an undo snapshot and then saves. */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const icon=(id,cls='')=>`<svg class="i ${cls}"><use href="#${id}"/></svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isDark=()=>document.documentElement.classList.contains('dark');
const fmt=Sky.fmt;
const hm=s=>{const [h,m]=String(s).split(':').map(Number);return h+(m||0)/60};      // "HH:mm" -> hours

/* ---------- calendar: a day is the number of days since 1970-01-01, in local time ---------- */
const dayNum=(d=new Date())=>Math.round(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5);
const utc=n=>new Date(n*864e5);
const ymd=n=>utc(n).toISOString().slice(0,10);
const fromYmd=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?Math.round(Date.UTC(+m[1],+m[2]-1,+m[3])/864e5):null};
const wd=d=>utc(d).getUTCDay();
const dom=d=>utc(d).getUTCDate();
const mon=d=>utc(d).getUTCMonth()+1;
const weekStart=d=>d-((wd(d)+6)%7);              // Monday
// Date wording comes from the string table (i18n.js); these only pass the numbers along.
const md=d=>I18n.dates.md(mon(d),dom(d));
const mdS=d=>`${mon(d)}/${dom(d)}`;
const dayShort=d=>I18n.dates.weekdayShort(wd(d));
const dayLong=d=>I18n.dates.long(mon(d),dom(d),wd(d));
const rangeLabel=(a,b)=>mon(a)===mon(b)?I18n.dates.range(mon(a),dom(a),dom(b)):`${md(a)} – ${md(b)}`;
const relDay=d=>d===st.today?tr('day.today'):d===st.today+1?tr('day.tomorrow'):d===st.today-1?tr('day.yesterday'):dayShort(d);
const nowHours=(d=new Date())=>d.getHours()+d.getMinutes()/60;

/* ---------- state ---------- */
let data={version:2,projects:[],tasks:[]};       // the workspace as last saved
let locked=false;                                 // true when the file could not be read: nothing is written
const S={tasks:[],res:[],pending:[]};
const st={mode:'dense',today:dayNum(),day:dayNum(),now:nowHours(),scale:'day',nav:'today',filter:'all',tag:null,proj:null,query:'',
  only:null,range:null,cluster:null,focus:-1,review:false,reviewAll:false,showDone:false,showUntimed:false,cExpand:{},search:false};
let H0=6;const H1=24;

/* ---------- workspace <-> tasks ---------- */
const PRIORITY=['P0','P1','P2'];
function toTask(e,i){
  const day=fromYmd(e.planned);
  return {id:e.id,ord:i,day,time:day!=null&&/^\d{1,2}:\d{2}$/.test(e.plannedTime||'')?hm(e.plannedTime):null,t:e.title,
    p:PRIORITY.includes(e.priority)?PRIORITY.indexOf(e.priority):2,done:e.done?1:0,
    tag:e.tag||null,proj:e.project,defers:e.deferCount||0,doneAt:e.completedAt||null,dueDate:e.dueDate||null,dueTime:e.dueTime||null,
    src:e.source||'',quote:e.quote||''};
}
function toEntry(x){
  const e={id:x.id,title:x.t,project:x.proj,tag:x.tag||'',priority:PRIORITY[x.p]||'P2',planned:x.day==null?'':ymd(x.day),
    source:x.src||'',quote:x.quote||'',done:!!x.done};
  if(x.dueDate){e.dueDate=x.dueDate;if(x.dueTime)e.dueTime=x.dueTime}
  if(x.day!=null&&x.time!=null)e.plannedTime=fmt(x.time);
  if(x.done&&x.doneAt)e.completedAt=x.doneAt;
  if(x.defers)e.deferCount=x.defers;
  return e;
}
function loadWorkspace(state){
  data=state&&Array.isArray(state.tasks)?state:{version:2,projects:[tr('project.default')],tasks:[]};
  S.tasks=data.tasks.map(toTask);
}
const newTask=o=>({id:crypto.randomUUID(),ord:S.tasks.reduce((m,x)=>Math.max(m,x.ord),-1)+1,day:null,time:null,t:'',p:2,done:0,tag:null,
  proj:st.proj&&data.projects.includes(st.proj)?st.proj:data.projects[0],defers:0,doneAt:null,dueDate:null,dueTime:null,src:'',quote:'',...o});
let saveQueue=Promise.resolve();
function persist(){
  const state={...data,version:2,tasks:S.tasks.map(toEntry)};
  data=state;
  saveQueue=saveQueue.then(()=>native('save',{state})).catch(error=>{Toast.show(tr('save.failed',error.message),{ms:7000})});
  return saveQueue;
}

/* ---------- undo ---------- */
const undoStack=[];
const resFlags=()=>S.res.map(r=>[r.id,r.unread,r.archived,r.resolved]);
function snapshot(){return {tasks:JSON.stringify(S.tasks),projects:JSON.stringify(data.projects),labels:JSON.stringify(data.labels||[]),res:resFlags(),review:st.review,only:st.only}}
const tasksChanged=s=>JSON.stringify(S.tasks)!==s.tasks||JSON.stringify(data.projects)!==s.projects||JSON.stringify(data.labels||[])!==s.labels;
function act(label,fn,{toast=true}={}){
  if(locked){Toast.show(tr('save.paused'),{ms:5000});return}
  const snap=snapshot();fn();undoStack.push(snap);if(undoStack.length>30)undoStack.shift();
  if(tasksChanged(snap))persist();
  render();
  if(toast)Toast.show(label,{undo:undo});
}
function undo(){
  const s=undoStack.pop();if(!s)return false;
  const dirty=tasksChanged(s);
  S.tasks=JSON.parse(s.tasks);data.projects=JSON.parse(s.projects);data.labels=JSON.parse(s.labels);
  // Results keep arriving, so only their read / archived / accepted state goes back, not the list itself.
  const flags=new Map(s.res.map(f=>[f[0],f]));
  S.res.forEach(r=>{const f=flags.get(r.id);if(f){r.unread=f[1];r.archived=f[2];r.resolved=f[3]}});
  st.review=s.review;st.only=s.only;
  if(dirty)persist();
  render();Toast.show(tr('undo.done'),{ms:1800});return true;
}
const byId=id=>S.tasks.find(x=>x.id===id);
// Titles are shortened in notices: 14 characters of Chinese, about twice that in Latin script.
const quote=t=>{const max=/[\u3400-\u9fff]/.test(t)?14:30;return tr('quote',t.length>max?t.slice(0,max-1)+'…':t)};

/* ---------- derived ---------- */
const byTime=(a,b)=>(a.time??99)-(b.time??99)||a.ord-b.ord;
const dayList=d=>S.tasks.filter(x=>x.day===d).sort(byTime);
const tasks=()=>dayList(st.day);
const carry=()=>S.tasks.filter(x=>x.day!=null&&x.day<st.today&&!x.done).sort((a,b)=>b.day-a.day||byTime(a,b));
const isOver=x=>!x.done&&x.day!=null&&(x.day<st.today||(x.day===st.today&&x.time!=null&&x.time<st.now));
// Where a finished task sits on the band: its planned time, or the moment it was completed if it had none.
function doneHour(x){
  if(!x.done)return null;
  if(x.time!=null)return x.time;
  if(!x.doneAt)return null;
  const d=new Date(x.doneAt);
  return Number.isNaN(d.getTime())||dayNum(d)!==x.day?null:nowHours(d);
}
// A deadline is separate from the plan: it is shown on the row and as a tick on the band, red once it has passed.
function dueInfo(x){
  const day=fromYmd(x.dueDate);if(day==null)return null;
  const time=x.dueTime?hm(x.dueTime):null;
  return {day,time,over:!x.done&&(day<st.today||(day===st.today&&time!=null&&time<st.now))};
}
const allTags=()=>[...new Set([...(data.labels||[]),...S.tasks.map(x=>x.tag).filter(Boolean)])];
const TAG_COLORS=['#c08a2b','#4f7bd9','#9a6bcf','#3fa58a','#8e8e93','#c7607a','#5a9bb8'];
const tagColor=name=>{const i=allTags().indexOf(name);return TAG_COLORS[(i<0?0:i)%TAG_COLORS.length]};
const textW=(()=>{const c=document.createElement('canvas').getContext('2d');return (s,w=400)=>{c.font=`${w} 11px -apple-system, BlinkMacSystemFont, "PingFang SC", "SF Pro Text", "Noto Sans CJK SC", sans-serif`;return c.measureText(s).width}})();
