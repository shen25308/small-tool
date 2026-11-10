'use strict';
window.ResultUI = (() => {
  const cache = new Map();
  // Older versions used localized source names in receipt IDs. Change only their display labels.
  const legacySources = new Map([
    ['\u624b\u52a8\u6536\u5f55', 'Manual capture'],
    ['\u672c\u5730 AI', 'Local AI']
  ]);
  function sourceName(note) {
    return legacySources.get(note.source) || note.source || 'Codex';
  }
  function digest(note) {
    const current = cache.get(note.id);
    if (current?.text === note.summary && current?.title === note.title) return current.value;
    const value = window.ShishiDigest.summarize(note.summary, note.title);
    cache.set(note.id,{text:note.summary,title:note.title,value});
    return value;
  }
  function element(tag, className, value) {
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(value)node.textContent=value;
    return node;
  }
  function card(note, options={}) {
    const info=digest(note);
    const article=element('article','result-card');
    article.dataset.notice=note.id;
    article.classList.toggle('unread',!note.read);
    const isMail=['Gmail','Outlook'].includes(note.source);
    const isFeed=isMail||note.source==='GitHub Actions';
    const preview=!!options.preview;
    const top=element(preview?'span':'div','result-meta');
    const state=info.status==='attention'?'Needs attention':'Turn finished';
    // Build titles in stored receipts may still carry an older localized conclusion.
    const failedBuild = /[·•]\s*(?:failure|failed|timed out|timeout|action required|needs attention|startup failure|failed to start|\u5931\u8d25|\u8d85\u65f6|\u9700\u8981\u5904\u7406|\u542f\u52a8\u5931\u8d25)$/i;
    const needsAttention=isFeed&&!isMail?failedBuild.test(note.title):!isFeed&&info.status==='attention';
    top.append(element('span','result-state '+(needsAttention?'attention':isMail?'mail':''),isMail?'New mail':isFeed?'Build result':state));
    top.append(element('span','result-source',sourceName(note)));
    const date=new Date(note.time*1000);
    const time=element('time','',new Intl.DateTimeFormat('en-US',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date));
    time.dateTime=date.toISOString();
    top.append(time);
    const headline=element(preview?'span':'h3','result-headline',isFeed?note.title:info.headline);
    const details=preview?element('div','result-details'):article;
    let trigger;
    if(preview) {
      article.classList.add('has-preview');
      trigger=element('button','result-preview');
      trigger.type='button';
      trigger.title=headline.textContent;
      const arrow=element('span','result-chevron');
      arrow.setAttribute('aria-hidden','true');
      details.id='result-'+crypto.randomUUID();
      details.hidden=true;
      trigger.setAttribute('aria-expanded','false');
      trigger.setAttribute('aria-controls',details.id);
      trigger.append(top,headline,arrow);
      article.append(trigger,details);
    } else {
      article.append(top,headline);
    }
    if(!isFeed&&info.files.length) {
      const tags=element('div','result-files');
      info.files.forEach(file=>{const code=element('code','',file.label);code.title=file.path;tags.append(code)});details.append(tags);
    }
    if(isFeed) {
      if(note.summary)details.append(element('p','result-context',note.summary));
    } else {
      if(info.details.length){
        const points=element('ul','result-points');
        info.details.forEach(line=>points.append(element('li','',line)));details.append(points);
      }
      if(info.excerpt)details.append(element('blockquote','result-quote',info.excerpt));
    }
    const foot=element('div','result-footer');
    if(!isFeed) {
      const label=element('span','result-thread',note.title);
      label.title=note.title;foot.append(label);
    }
    const button=element('button','result-expand',isFeed?'Show record':'Show reply');
    button.type='button';button.dataset.expand=note.id;
    button.setAttribute('aria-expanded','false');
    const original=element('div','result-original');original.hidden=true;
    const raw=element('p','',note.summary||'No reply was attached to this result.');
    original.append(raw);
    if(options.open && (note.thread||note.link)) {
      const open=element('button','mini-link',isMail?'Open email':isFeed?'View build':'Open conversation');
      open.type='button';open.onclick=()=>options.open(note);original.append(open);
    }
    function expand(value) {
      button.setAttribute('aria-expanded',String(value));
      button.textContent=value?'Hide':isFeed?'Show record':'Show reply';
      original.hidden=!value;
      if(value && article.classList.contains('unread'))options.read?.(note);
      options.expanded?.(value);
    }
    button.onclick=()=>expand(original.hidden);
    foot.append(button);details.append(foot,original);
    if(trigger) {
      trigger.onclick=()=>{
        const opening=details.hidden;
        if(!opening && !original.hidden)expand(false);
        details.hidden=!opening;
        trigger.setAttribute('aria-expanded',String(opening));
        article.classList.toggle('details-open',opening);
        options.previewChanged?.(opening);
      };
    }
    if(options.edge){button.id='edgeExpand';original.id='edgeOriginal'}
    return article;
  }
  function retain(ids) {
    for(const id of cache.keys())if(!ids.has(id))cache.delete(id);
  }
  return {card,digest,retain,sourceName};
})();
