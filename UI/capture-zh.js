'use strict';
/* Quick capture: the Chinese rules. This file holds language data (the words people type), not interface copy.
   今天/明天/后天/大后天/明早/明晚/今晚 · 周X/下周X/下下周X · X月X日/X号 · 上午/中午/下午/傍晚/晚上 + X点(半/一刻/三刻/X分) · HH:MM
   · 30分钟/1小时/半小时 · #标签 · ! / !! · 以后 */
window.CaptureZh=(()=>{
  const CN={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,十一:11,十二:12};
  const num=s=>s==null?null:/^\d+$/.test(s)?+s:CN[s]??(s.startsWith('十')?10+(CN[s[1]]||0):null);
  const WDN={一:1,二:2,三:3,四:4,五:5,六:6,日:0,天:0};
  const applies=text=>/[㐀-鿿]/.test(text);
  /* cal: {wd(day), weekStart(day), dayOf(month, dayOfMonth) -> day}. Returns notes as string-table keys. */
  function parse(text,today,now,cal){
    let s=' '+text+' ',day=today,time=null,dur=null,tag=null,p=null,dayHit=false;const notes=[];
    const cut=re=>{const m=s.match(re);if(m)s=s.replace(m[0],' ');return m};
    let m;
    if((m=cut(/#(\S+)/)))tag=m[1];
    if((m=cut(/[!！]{2}/)))p=0;else if((m=cut(/[!！]/)))p=1;
    if((m=cut(/(\d+|半|一|两|二|三)\s*(个)?(小时|h)(半)?/i))){dur=(m[1]==='半'?.5:num(m[1]))+(m[4]?.5:0)}
    else if((m=cut(/(\d+)\s*(分钟|min)/i)))dur=+m[1]/60;
    if((m=cut(/以后|有空再说|有空/))){day=null;dayHit=true}
    else if((m=cut(/大后天/))){day=today+3;dayHit=true}
    else if((m=cut(/后天/))){day=today+2;dayHit=true}
    else if((m=cut(/明早|明天早上/))){day=today+1;time=9;dayHit=true}
    else if((m=cut(/明晚|明天晚上/))){day=today+1;time=20;dayHit=true}
    else if((m=cut(/明天|明日/))){day=today+1;dayHit=true}
    else if((m=cut(/今晚/))){day=today;time=20;dayHit=true}
    else if((m=cut(/今天|今日/))){day=today;dayHit=true}
    else if((m=cut(/(下下|下)?(?:周|星期|礼拜)([一二三四五六日天])/))){const w=WDN[m[2]],delta=(w-cal.wd(today)+7)%7;
      const ws=cal.weekStart(today);if(m[1]){day=ws+7*(m[1]==='下下'?2:1)+((w+6)%7)}else{day=today+(delta||7)}dayHit=true}
    else if((m=cut(/下周/))){day=cal.weekStart(today)+7;dayHit=true}
    else if((m=cut(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/))){day=cal.dayOf(+m[1],+m[2]);dayHit=true}
    else if((m=cut(/(\d{1,2})\s*号/))){day=cal.dayOf(null,+m[1]);dayHit=true}
    const per=s.match(/(上午|早上|早晨|中午|下午|傍晚|晚上|凌晨|晚)/);
    if((m=cut(/(上午|早上|早晨|中午|下午|傍晚|晚上|凌晨|晚)?\s*(\d{1,2}|十[一二]?|[一二两三四五六七八九十])\s*[点:：时]\s*(半|一刻|三刻|(\d{1,2})\s*分?)?/))){
      let h=num(m[2]);const mm=m[3]==='半'?30:m[3]==='一刻'?15:m[3]==='三刻'?45:m[4]?+m[4]:0,P=m[1];
      if(P&&/下午|傍晚|晚/.test(P)&&h<12)h+=12;else if(P==='中午'&&h<3)h+=12;else if(!P&&h>=1&&h<=6){h+=12;notes.push('cap.note.pm')}
      time=h+mm/60}
    else if(per&&time==null){cut(new RegExp(per[1]));time={上午:9,早上:8,早晨:8,中午:12,下午:15,傍晚:18,晚上:20,晚:20,凌晨:1}[per[1]]}
    if(day==null)time=null;
    if(day===today&&time!=null&&time<now&&!dayHit){day=today+1;notes.push('cap.note.tomorrow')}
    else if(day===today&&time!=null&&time<now)notes.push('cap.note.passed');
    const title=s.replace(/\s+/g,' ').replace(/^[\s,，、]+|[\s,，、]+$/g,'')||text.trim();
    return {title,day,time,dur,tag,p,notes};
  }
  return {applies,parse};
})();
