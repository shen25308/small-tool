'use strict';
/* What a result needs from the user, derived only from what the result itself says. Nothing is stored and
   nothing is guessed: when no rule applies, a result is simply "done".
     confirm  the reply asks for a decision, or a task deadline has arrived
     fail     a build concluded with a failure, or the reply reports one
     done     everything else
   Shared by the main inbox and the results panel. */
window.ShishiStatus=(()=>{
  const cache=new Map();
  // Same rule the build cards used before: the conclusion is the last part of the title.
  const failedBuild=/[·•]\s*(?:failure|failed|timed out|timeout|action required|needs attention|startup failure|failed to start|失败|超时|需要处理|启动失败)$/i;
  // "needs your confirmation", "please confirm", 需要你确认, 请确认, 待确认 …
  const asks=/(?:需要?你?确认|需确认|请你?确认|待确认|需要你(?:来)?决定|\b(?:needs? your|requires? your|waiting (?:for|on) your|please (?:confirm|approve|decide|review)|your (?:confirmation|approval|decision|sign-off))\b)/i;
  // "failed", "error", 失败, 报错, 出错 — unless the same clause says it was fixed.
  const failure=/(?:失败|报错|出错|\b(?:fail(?:ed|ure|s)?|errors?|crash(?:ed|es)?)\b)/i;
  const fixed=/(?:修复|解决|修正|排除|通过|\b(?:fixed|resolved|no longer|0 failed|passes|passed)\b)/i;
  const reportsFailure=text=>String(text||'').split(/[。！？；;.!?\n]|但是|不过|\bbut\b/i).some(clause=>failure.test(clause)&&!fixed.test(clause));
  const kindOf=source=>source==='Reminders'?'due':source==='GitHub Actions'?'build':source==='Gmail'||source==='Outlook'?'mail':'ai';
  function digest(note){
    const hit=cache.get(note.id);
    if(hit&&hit.text===note.summary&&hit.title===note.title)return hit.value;
    const value=window.ShishiDigest.summarize(note.summary,note.title);
    cache.set(note.id,{text:note.summary,title:note.title,value});
    return value;
  }
  /* -> {kind, st, info}. `info` is the digest for AI replies and null for feeds (mail, builds, reminders). */
  function of(note){
    const kind=kindOf(note.source);
    if(kind==='due')return {kind,st:'confirm',info:null};
    if(kind==='build')return {kind,st:failedBuild.test(note.title||'')?'fail':'done',info:null};
    if(kind==='mail')return {kind,st:'done',info:null};
    const info=digest(note),text=note.summary||'';
    const st=asks.test(text)?'confirm':reportsFailure(info.headline)?'fail':info.status==='attention'?(reportsFailure(text)?'fail':'confirm'):'done';
    return {kind,st,info};
  }
  function retain(ids){for(const id of cache.keys())if(!ids.has(id))cache.delete(id)}
  return {of,retain};
})();
