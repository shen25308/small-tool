'use strict';

// Summaries reuse the author's wording. File references are display metadata, never a link to execute.
window.ShishiDigest = (() => {
  const suffix = /\.(?:swift|[cm]?[jt]sx?|py|go|rs|java|kt|scala|rb|php|sh|zsh|bash|c|cc|cpp|m|mm|h|hpp|html?|css|scss|vue|svelte|jsonl?|toml|ya?ml|xml|plist|sql|md|rst|tex|txt|ini|cfg|conf|xlsx?|csv|tsv|docx?|pdf|pptx?|ipynb|app)$/i;
  const specialName = /^(?:Makefile|Dockerfile|README|LICENSE|\.gitignore|\.env(?:\.example)?)$/i;
  const link = /!?\[([^\]\n]*)\]\((?:<([^>\n]+)>|((?:\\.|[^()\s]|\([^()\n]*\))+))\)/g;
  // Accept English and Mandarin replies, including receipts from earlier versions.
  const action = /(?:\u5df2(?:\u7ecf)?(?:\u5c06|\u628a|\u8865|\u6539|\u66f4|\u5199|\u6dfb|\u79fb|\u5220|\u5efa|\u751f\u6210|\u5bfc\u51fa|\u6062\u590d|\u5b9e\u73b0|\u4fee|\u91cd|\u5904\u7406|\u63a5|\u5b8c)|(?:\u4fee\u590d|\u4fee\u6539|\u66f4\u65b0|\u8865\u5145|\u5f15\u5165|\u66ff\u6362|\u521b\u5efa|\u5b8c\u6210|\u6dfb\u52a0|\u8c03\u6574|\u91cd\u5199|\u91cd\u6784|\u751f\u6210|\u4fee\u6b63|\u79fb\u9664|\u5220\u9664|\u5b9e\u73b0|\u5408\u5e76|\u4fdd\u5b58|\u5bfc\u51fa|\u627e\u51fa|\u5b9a\u4f4d|\u89e3\u51b3)\u4e86?|\b(?:changed|updated|fixed|created|added|implemented|replaced|removed|exported|saved|generated|refactored|restored|identified|found|edited|renamed|moved|wrote|prepared|published|deployed|migrated|merged|completed|repaired)\b)/i;
  const verification = /(?:\u6d4b\u8bd5|\u6821\u9a8c|\u9a8c\u8bc1|\u5b9e\u6d4b|\u590d\u6d4b|\u6784\u5efa|\u7f16\u8bd1|\u68c0\u67e5|\u6bd4\u5bf9|\u56de\u5f52|\u590d\u6838|\u901a\u8fc7|\b(?:tests?|checks?|assertions?|build|verified|validation|passed|fails?|failed|lint)\b)/i;
  const limited = /(?:\u4ecd(?:\u7136)?(?:\u6709|\u9700|\u5f85|\u672a|\u5931\u8d25|\u4e0d\u80fd|\u65e0\u6cd5|\u62a5\u9519)|\u5c1a(?:\u672a|\u9700|\u5f85)|\u8fd8(?:\u6ca1(?:\u6709)?|\u672a|\u9700(?:\u8981)?)|\u6682(?:\u65f6)?(?:\u672a|\u65e0\u6cd5)|\u65e0\u6cd5(?:\u8fd0\u884c|\u9a8c\u8bc1|\u5b8c\u6210|\u8bbf\u95ee|\u8fde\u63a5|\u7f16\u8bd1|\u6253\u5f00)|\u672a(?:\u901a\u8fc7|\u80fd|\u6267\u884c|\u6d4b\u8bd5|\u9a8c\u8bc1|\u5b8c\u6210|\u8fd0\u884c|\u89e3\u51b3)|(?:\u8bf7|\u9700\u8981|\u5f85)(?:\u4f60|\u7528\u6237)(?:\u5148)?(?:\u786e\u8ba4|\u6388\u6743|\u63d0\u4f9b|\u9009\u62e9|\u51b3\u5b9a)|(?:\u6d4b\u8bd5|\u7f16\u8bd1|\u6784\u5efa|\u6821\u9a8c|\u90e8\u7f72)(?:\u4ecd\u7136|\u4ecd|\u4f9d\u7136)?\u5931\u8d25|\b(?:blocked|pending approval|unable to|could(?:n['’]t| not) (?:run|test|verify|build|deploy|access|connect|complete|finish)|did(?:n['’]t| not) (?:run|test|verify)|needs? (?:your|user) (?:approval|input|confirmation)|requires? (?:your|user) (?:approval|input|confirmation)|not (?:yet )?(?:run|tested|verified|completed)|(?:tests?|build|checks?) (?:still )?(?:failed|failing)|\d+ (?:tests? )?failed)\b)/i;
  const nextStep = /(?:\u4e0b\u4e00\u6b65|\u5f85\u5904\u7406|\u5f85\u529e|\u9700\u8981\u4f60|\u63a5\u4e0b\u6765\u9700\u8981|\b(?:next step|remaining|requires your)\b)/i;
  const generic = /^(?:(?:\u597d[\u7684\u4e86]?|\u53ef\u4ee5|\u4ee5\u4e0a|\u4ee5\u4e0b|\u5df2\u7ecf?|\u90fd|\u5904\u7406|\u4fee\u6539|\u4efb\u52a1|\u5de5\u4f5c|\u5df2\u5904\u7406|\u5df2\u4fee\u6539|\u672c\u6b21|\u5168\u90e8|\u64cd\u4f5c|\u6309(?:\u4f60)?\u8981\u6c42)|\s)*(?:\u5df2\u5b8c\u6210|\u5b8c\u6210\u4e86?|\u641e\u5b9a\u4e86?|\u6ca1\u95ee\u9898|\u5982\u4e0b|\u597d|Done|Completed|All done|Here.s the (?:result|summary))?[\u3002.!\uff01\uff1a:\s]*$/i;
  const sectionLabel = /^(?:\u53d8\u66f4(?:\u5185\u5bb9)?|\u4fee\u6539(?:\u5185\u5bb9|\u8bf4\u660e)?|\u672c\u6b21\u4fee\u6539|\u5b8c\u6210\u60c5\u51b5|\u7ed3\u679c|\u7ed3\u8bba|\u5b9e\u73b0|\u9a8c\u8bc1(?:\u60c5\u51b5|\u7ed3\u679c)?|\u6d4b\u8bd5(?:\u60c5\u51b5|\u7ed3\u679c)?|\u4e0b\u4e00\u6b65|\u5f85\u5904\u7406|\u6ce8\u610f(?:\u4e8b\u9879)?|\u603b\u7ed3|summary|changes|implementation|results?|tests?|testing|validation|verification|next steps?|notes?)\s*[:\uff1a]?$/i;

  function shorten(text, limit) {
    const chars = Array.from(text);
    if (chars.length <= limit) return text;
    let part = chars.slice(0, limit - 1).join('').trimEnd();
    // Keep identifiers and English words readable when there is a close word boundary.
    if (/[a-z\d]$/i.test(part) && /[a-z\d]/i.test(chars[limit - 1])) {
      const safe = part.replace(/\s+[^\s]+$/, '');
      if (part.length - safe.length < 18) part = safe;
    }
    return part + '…';
  }

  function fileInfo(value) {
    let path = String(value || '').trim().replace(/^<|>$/g, '').replace(/\\([() ])/g, '$1');
    if (path.startsWith('file:///')) path = path.slice(7);
    if (/^[a-z][a-z\d+.-]*:\/\/|^\/\/|^[#?]/i.test(path)) return null;
    try { path = decodeURIComponent(path); } catch { return null; }
    path = path.replace(/(?:#L\d+(?:-L?\d+)?|:\d+(?::\d+)?)$/i, '');
    if (/^(?:git|npm|pnpm|yarn|pytest|python\d*|node|swiftc?|xcrun|make|cargo|go|rg|cat|bash|sh)\s/.test(path) || /\s--?[\w-]+\s/.test(path)) return null;
    const name = path.split(/[\\/]/).pop();
    if (!name || (!suffix.test(name) && !specialName.test(name)) || /[\r\n\x00<>|]/.test(path)) return null;
    if (!path.includes('/') && /^(?:\w+\s+){3,}/.test(name)) return null;
    return { label: name, path };
  }

  function cleanLine(raw, files) {
    function remember(target) {
      const ref = fileInfo(target);
      if (ref && !files.some(file => file.path === ref.path)) {
        if (ref.path !== ref.label) {
          const loose = files.findIndex(file => file.path === ref.label);
          if (loose !== -1) files.splice(loose, 1);
        }
        if (ref.path !== ref.label || !files.some(file => file.label === ref.label)) files.push(ref);
      }
      return ref;
    }
    let text = raw.replace(link, (_, label, angle, plain) => {
      const ref = remember(angle || plain);
      if (ref && (!label || fileInfo(label) || /^(?:\u6253\u5f00|\u67e5\u770b|\u4e0b\u8f7d|\u6587\u4ef6|open|view|download|file|here|link)$/i.test(label))) return ref.label;
      return label || ref?.label || '';
    });
    text = text.replace(/(`+)([^`\n]+?)\1/g, (_, ticks, code) => remember(code)?.label || code);
    // Bare URLs are not local files. Match ordinary filenames in addition to linked paths.
    text = text.replace(/https?:\/\/[^\s\uff0c\u3002\uff1b]+/gi, '');
    text = text.replace(/(?:\.{0,2}\/)?(?:[\w.@-]+\/)*[\w@-]+\.[a-z][a-z\d]{0,6}(?::\d+(?::\d+)?)?(?=$|\.(?=\s|$)|[\s,!?\uff0c\u3002\uff1b;\uff1a:\u3001)\uff09\]\u3011])/gi,
      token => remember(token)?.label || token);
    for (const m of text.matchAll(/(?:^|[\s("'\u300c\u3010])([\p{L}\p{N}_-]*\p{Script=Han}[\p{L}\p{N}_-]*\.[A-Za-z\d]{1,6})(?=$|\.(?=\s|$)|[\s,!?\uff0c\u3002\uff1b;\uff1a:\u3001)\uff09\]\u3011”\u300d])/gu)) remember(m[1]);
    for (const m of text.matchAll(/[\u300c“\u300e]([^\u300d”\u300f\n]+)[\u300d”\u300f]/g)) remember(m[1]);
    return text.replace(/^\s*(?:(?:#{1,6}|>)\s*|[-*+]\s+|\d+[.)\u3001]\s*)+/, '')
      .replace(/\*\*|__/g, '').replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function rowText(text) {
    return text.replace(/^(?:\u672c\u6b21(?:\u7684)?(?:\u4fee\u6539|\u53d8\u66f4)(?:\u5185\u5bb9)?(?:\u5982\u4e0b)?|\u53d8\u66f4|\u7ed3\u679c|\u603b\u7ed3|\u7ed3\u8bba|\u4fee\u6539\u5185\u5bb9|summary|changes?)\s*[:\uff1a]\s*/i, '')
      .replace(/^\u6211(?:\u5df2\u7ecf|\u5df2)\s*/, '\u5df2').replace(/^\u6211\u628a/, '\u628a').trim();
  }

  function isConcern(text) {
    // Judge each clause so that "fixed the previously failing test" isn't itself a warning.
    return text.split(/[\uff0c,\uff1b;]|\u4f46\u662f|\u4e0d\u8fc7|\bbut\b/i).some(clause => {
      const issue = limited.exec(clause);
      if (!issue) return false;
      const before = clause.slice(0, issue.index);
      if (/\b0\s*$/.test(before) || /^(?:0+ (?:tests? )?failed)/i.test(issue[0])) return false;
      return !/(?:\u4fee\u590d|\u89e3\u51b3|\u4fee\u6b63|\u6392\u9664)(?:\u4e86|\u539f\u5148|\u4e4b\u524d|\u5bfc\u81f4|\u7684|\u8be5|\u8fd9\u4e2a|\s)*$|\b(?:fixed|resolved|previously)\s+(?:the\s+)?$/i.test(before);
    });
  }

  function sentences(line) {
    const parts = line.match(/[^\u3002\uff01\uff1f]+[\u3002\uff01\uff1f](?:[\u300d\u300f”])?|[^\u3002\uff01\uff1f]+$/g) || [line];
    return parts.flatMap(part => part.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)).map(text => text.trim());
  }

  // For a quotation, remove only Markdown presentation. Keep names, paths and wording intact.
  function originalLine(raw) {
    return raw.replace(link, (_, label) => label).replace(/(`+)([^`\n]+?)\1/g, '$2')
      .replace(/^\s*(?:(?:#{1,6}|>)\s*|[-*+]\s+|\d+[.)\u3001]\s*)+/, '')
      .replace(/\*\*|__/g, '').trim();
  }

  function splitReply(source, files) {
    const rows = [];
    let fence = '', code = '', heading = '';
    for (const raw of source.split(/\r?\n/)) {
      const marker = raw.trimStart().match(/^(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1].startsWith(fence)) fence = '';
        continue;
      }
      if (fence) {
        if (!code && raw.trim()) code = raw.trim();
        continue;
      }
      if (/^\s*(?:\|?\s*:?[-]{3,}[:| -]*$|(?:tool call|functions\.exec|tokens? used)\s*[:(])/i.test(raw)) continue;
      const line = cleanLine(raw, files);
      if (!line) continue;
      if (sectionLabel.test(line)) { heading = line; continue; }
      if (/^\s*#{1,6}\s/.test(raw)) heading = line;
      const originals = sentences(originalLine(raw));
      sentences(line).forEach((text, index) => {
        if (!text || generic.test(text) || sectionLabel.test(text) || rows.some(row => row.text === rowText(text))) return;
        const change = action.test(text) && !nextStep.test(heading);
        rows.push({original: originals[index] || originalLine(raw), text:rowText(text), change,
          check:verification.test(text) || verification.test(heading), concern:isConcern(text),
          next:nextStep.test(text) || nextStep.test(heading)});
      });
    }
    return {rows, code};
  }

  function summarize(text, title = '') {
    const files = [];
    const {rows, code} = splitReply(String(text || ''), files);
    if (!rows.length) {
      const first = String(text || '').split(/\r?\n/).map(originalLine).find(line => line && !sectionLabel.test(line));
      const fallback = code ? 'The reply includes a code sample.' : shorten(first || 'Turn finished', 86);
      return {headline:fallback, details:[], excerpt:shorten(code,130), files:files.slice(0,3), status:'reply'};
    }
    const rank = (row, i) => {
      const relevantFile = files.some(f => row.text.includes(f.label));
      const first = i === 0 ? 2 : 0;
      return first + (row.change ? 5 : 0) + (relevantFile ? 2 : 0) + (row.concern ? 2 : 0)
        - (row.next ? 3 : 0) - (row.text === title ? 2 : 0);
    };
    const main = rows.reduce((best, row, i) => rank(row,i) > rank(rows[best],best) ? i : best, 0);
    const headline = shorten(rows[main].text, 86);
    const rest = rows.filter((_, i) => i !== main);
    const picked = [];
    const take = row => {if(row && !picked.includes(row) && picked.length<2)picked.push(row)};
    take(rest.find(row => row.concern));
    take(rest.find(row => row.check && !picked.includes(row)));
    take(rest.find(row => row.change && !picked.includes(row)));
    take(rest.find(row => row.next && !picked.includes(row)));
    // Use only distinct supporting text. A short one-sentence reply needs no duplicate quotation.
    const quote = rest.find(row => !picked.includes(row) && row.original.length >= 8);
    return {
      headline,
      details: picked.map(row=>shorten(row.text,115)),
      excerpt: quote ? shorten(quote.original,125) : '',
      files: files.slice(0,3),
      status: rows.some(row=>row.concern) ? 'attention' : 'reply'
    };
  }
  return {summarize};
})();
