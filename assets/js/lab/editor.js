// 회원 글 편집기(2026-10-27 · 11-02 시안 A: 두 층 도구 줄 · 사진 묶음 · 덩어리 옮기기 · 글씨 크기, / 빠른 넣기는 11-02 뺌, 연구자: "블로그 같이 작성하는 경우도 있으니까 이미지 복붙 해도 ㄱㅊ게 하는 등 편집 기능을 좀 잘").
// 보이는 그대로 쓰는 칸(contenteditable) + 도구 줄. 글은 마크다운으로 저장하므로(2_보안검토.md 3.1) 저장할 때 이 칸의 모양을
// 마크다운으로 바꾸고(toMarkdown), 고칠 때는 render.js 가 거른 조각을 다시 불러온다. 이 칸의 모양은 저장 전에 한 번 더 거르지 않아도
// 되게, 마크다운으로 바꿀 때 아는 모양(문단 · 제목 · 목록 · 인용 · 코드 · 표 · 굵게 · 기울임 · 취소선 · 링크 · 우리 그림)만 남긴다.
// 그림: 붙여 넣기(복사한 그림 · 화면 캡처) · 끌어다 놓기 · '그림' 단추 → 이 브라우저에서 긴 변 1600px JPEG 로 다시 저장(위치 정보 빠짐)
// → 글을 저장할 때 사진 칸에 올리고 본문에는 lab:<경로> 로 적는다. 바깥 주소 그림은 받지 않는다.
(function () {
  'use strict';
  if (window.LAB_BLOCKED || !window.Lab || !window.LabRender || !window.LabUpload || !window.DOMPurify) return;
  var L = window.Lab, h = L.h, U = window.LabUpload;

  var LAB_PATH = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,120}$/;
  var BLOCK = /^(P|DIV|H[1-6]|BLOCKQUOTE|UL|OL|LI|PRE|HR|TABLE|FIGURE)$/;
  // 글쓰기 시안 A(2026-11-02): 정렬 · 인용구 · 구분선 모양 · 사진 묶음 · 링크 카드 · 글자색 · 형광은 render.js 가 허용한
  // 꾸밈 이름(class)으로만 저장한다. 그런 덩어리는 마크다운 안에 HTML 한 줄로 적는다(마크다운에는 모양 표시가 없어서).
  var CLASS_OK = window.LabRender.CLASS_OK || {};
  function okClass(n) {
    var ok = CLASS_OK[n.tagName] || [];
    return (n.getAttribute('class') || '').split(/\s+/).filter(function (c) { return ok.indexOf(c) !== -1; }).join(' ');
  }

  // 붙여 넣은 HTML(워드 · 엑셀 · 웹 글)에서 남기는 모양. 글자색 · 크기 · 글꼴은 빠지고, 그림은 아래에서 따로 고른다.
  var PASTE = {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'strike', 'u', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
      'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'div', 'span', 'img'],
    ALLOWED_ATTR: ['href', 'alt', 'data-lab-path'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  };
  // 편집 칸에 둘 때 이름을 하나로 맞춘다(마크다운으로 바꿀 때와 화면 모양이 같게).
  var RENAME = { B: 'strong', I: 'em', S: 'del', STRIKE: 'del', H1: 'h3', H2: 'h3', H5: 'h4', H6: 'h4', DIV: 'p' };

  function esc(t) {
    return t.replace(/ /g, ' ').replace(/[\r\n\t]+/g, ' ').replace(/([\\`*_[\]<>~|&])/g, '\\$1');
  }
  function escAttr(t) { return String(t).replace(/[&"<>]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  // ---------------------------------------------------------------- 편집 칸 → 마크다운
  function toMarkdown(root) {
    return blocks(root).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 한 줄 글: 칸 띄움을 하나로, 줄 앞에 오면 목록 · 제목으로 읽히는 글자는 글자로 남긴다.
  function tidy(s) {
    return s.split('\n').map(function (line) {
      return line.replace(/[ \t]+/g, ' ').trim().replace(/^([#>+=-]|\d+[.)])/, function (m) { return m.replace(/([#>+=.)-])$/, '\\$1'); });
    }).join('\n').replace(/^\n+|\n+$/g, '');
  }

  function blocks(parent) {
    var out = [], buf = '';
    function flush() { var t = tidy(buf); if (t) out.push(t); buf = ''; }
    Array.prototype.forEach.call(parent.childNodes, function (n) {
      if (n.nodeType === 3) { buf += esc(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (!BLOCK.test(tag)) { buf += inline(n); return; }
      flush();
      var cls = okClass(n);
      if (tag === 'FIGURE') { var f = figureHtml(n); if (f) out.push(f); }
      else if (cls && /^(P|H[1-6])$/.test(tag)) {
        var inner = htmlKids(n).trim(), t2 = tag === 'P' ? 'p' : /^H[1-3]$/.test(tag) ? 'h3' : 'h4';
        if (inner) out.push('<' + t2 + ' class="' + cls + '">' + inner + '</' + t2 + '>');
      } else if (cls && tag === 'BLOCKQUOTE') { var qh = quoteHtml(n); if (qh) out.push('<blockquote class="' + cls + '">' + qh + '</blockquote>'); }
      else if (cls && tag === 'HR') out.push('<hr class="' + cls + '">');
      else if (tag === 'P' || tag === 'DIV' || tag === 'LI') out.push.apply(out, blocks(n));
      else if (/^H[1-3]$/.test(tag)) heading('## ', n);
      else if (/^H[4-6]$/.test(tag)) heading('### ', n);
      else if (tag === 'BLOCKQUOTE') {
        var q = blocks(n).join('\n\n');
        if (q) out.push(q.split('\n').map(function (l) { return l ? '> ' + l : '>'; }).join('\n'));
      } else if (tag === 'UL' || tag === 'OL') { var li = list(n); if (li) out.push(li); }
      else if (tag === 'PRE') { var c = n.textContent.replace(/\n+$/, ''); if (c) out.push(fence(c)); }
      else if (tag === 'HR') out.push('---');
      else if (tag === 'TABLE') { var t = table(n); if (t) out.push(t); }
    });
    flush();
    return out;
    function heading(mark, n) { var t = tidy(kids(n)).replace(/\n+/g, ' '); if (t) out.push(mark + t); }
  }

  function list(n) {
    var ordered = n.tagName === 'OL', i = 0, items = [], pad = '';
    Array.prototype.forEach.call(n.children, function (c) {
      if (c.tagName === 'UL' || c.tagName === 'OL') {   // 크롬이 들여 쓴 목록을 li 밖에 두는 경우: 앞 항목 아래로
        var sub = list(c);
        if (sub) items.push(items.length ? indent(sub, pad) : sub);
        return;
      }
      var body = blocks(c).join('\n');
      if (!body) return;
      i++;
      var mark = ordered ? i + '. ' : '- ';
      pad = '         '.slice(0, mark.length);
      items.push(mark + indent(body, pad).slice(pad.length));
    });
    return items.join('\n');
  }
  function indent(s, pad) { return s.split('\n').map(function (l) { return l ? pad + l : l; }).join('\n'); }

  function fence(code) {
    var f = '```';
    while (code.indexOf(f) !== -1) f += '`';
    return f + '\n' + code + '\n' + f;
  }

  function table(t) {
    var rows = Array.prototype.filter.call(t.querySelectorAll('tr'), function (tr) { return tr.closest('table') === t; });
    var data = rows.map(function (tr) {
      return Array.prototype.map.call(tr.children, function (c) { return tidy(kids(c)).replace(/\n+/g, ' ') || ' '; });
    }).filter(function (r) { return r.length; });
    if (!data.length) return '';
    var w = Math.max.apply(null, data.map(function (r) { return r.length; }));
    data.forEach(function (r) { while (r.length < w) r.push(' '); });
    function line(r) { return '| ' + r.join(' | ') + ' |'; }
    return [line(data[0]), line(data[0].map(function () { return '---'; }))].concat(data.slice(1).map(line)).join('\n');
  }

  function kids(n) { return Array.prototype.map.call(n.childNodes, inline).join(''); }

  function inline(n) {
    if (n.nodeType === 3) return esc(n.nodeValue);
    if (n.nodeType !== 1) return '';
    switch (n.tagName) {
      case 'BR': return '\n';
      case 'STRONG': case 'B': return wrap('**', 'strong', kids(n));
      case 'EM': case 'I': return wrap('*', 'em', kids(n));
      case 'DEL': case 'S': case 'STRIKE': return wrap('~~', 'del', kids(n));
      case 'U': var ku = kids(n); return ku.trim() ? '<u>' + ku + '</u>' : ku;
      case 'SPAN': case 'MARK':
        var kc = kids(n), c = okClass(n);
        return c && kc.trim() ? '<' + n.tagName.toLowerCase() + ' class="' + c + '">' + kc + '</' + n.tagName.toLowerCase() + '>' : kc;
      case 'CODE': return code(n.textContent);
      case 'A':
        var href = n.getAttribute('href') || '', inner = kids(n);
        if (!/^(https?:|mailto:)/i.test(href) || !inner.trim()) return inner;
        return '[' + inner.replace(/\n/g, ' ') + '](' + href.replace(/[()<>\s]/g, encodeURIComponent) + ')';
      case 'IMG':
        var p = n.getAttribute('data-lab-path') || '';
        return LAB_PATH.test(p) ? '![' + esc(n.getAttribute('alt') || '') + '](lab:' + p + ')' : '';
      default:
        return BLOCK.test(n.tagName) ? '\n' + blocks(n).join('\n') + '\n' : kids(n);
    }
  }
  // **굵게**: 앞뒤 칸 띄움은 밖으로. 글자가 문장 부호로 시작 · 끝나면 마크다운 표시가 안 먹으므로 <strong> 으로 둔다(render.js 가 허용).
  function wrap(mark, tag, s) {
    var core = s.trim();
    if (!core) return s;
    var lead = s.slice(0, s.indexOf(core.charAt(0))), trail = s.slice(s.lastIndexOf(core.charAt(core.length - 1)) + 1);
    var punct = /^[\p{P}\p{S}]|[\p{P}\p{S}]$/u.test(core.replace(/\\(.)/g, '$1'));
    return lead + (punct ? '<' + tag + '>' + core + '</' + tag + '>' : mark + core + mark) + trail;
  }
  function code(t) {
    t = t.replace(/\n/g, ' ');
    if (!t) return '';
    var ticks = '`';
    while (t.indexOf(ticks) !== -1) ticks += '`';
    var pad = /^`|`$/.test(t) ? ' ' : '';
    return ticks + pad + t + pad + ticks;
  }

  // HTML 한 줄로 적는 덩어리 안쪽: 글자는 HTML 로 막고(&lt; 등), 아는 꾸밈만 남긴다. 빈 줄이 생기면 마크다운이 덩어리를 끊으므로 줄바꿈은 <br> 로.
  function htmlKids(n) { return Array.prototype.map.call(n.childNodes, htmlInline).join(''); }
  function htmlInline(n) {
    if (n.nodeType === 3) return escAttr(n.nodeValue.replace(/[\r\n\t]+/g, ' '));
    if (n.nodeType !== 1) return '';
    var k = function () { return htmlKids(n); };
    switch (n.tagName) {
      case 'BR': return '<br>';
      case 'STRONG': case 'B': return '<strong>' + k() + '</strong>';
      case 'EM': case 'I': return '<em>' + k() + '</em>';
      case 'DEL': case 'S': case 'STRIKE': return '<del>' + k() + '</del>';
      case 'U': return '<u>' + k() + '</u>';
      case 'CODE': return '<code>' + escAttr(n.textContent.replace(/\n/g, ' ')) + '</code>';
      case 'A':
        var href = n.getAttribute('href') || '';
        return /^(https?:|mailto:)/i.test(href) ? '<a href="' + escAttr(href) + '">' + k() + '</a>' : k();
      case 'SPAN': case 'MARK':
        var c = okClass(n), t = n.tagName.toLowerCase();
        return c ? '<' + t + ' class="' + c + '">' + k() + '</' + t + '>' : k();
      case 'IMG': return '';
      default: return BLOCK.test(n.tagName) ? ' ' + k() + ' ' : k();
    }
  }
  function quoteHtml(q) {
    var out = [], buf = '';
    function flush() { if (buf.trim()) out.push('<p>' + buf.trim() + '</p>'); buf = ''; }
    Array.prototype.forEach.call(q.childNodes, function (c) {
      if (c.nodeType === 1 && BLOCK.test(c.tagName)) { flush(); buf = htmlKids(c); flush(); }
      else buf += htmlInline(c);
    });
    flush();
    return out.join('');
  }
  // 사진 묶음: <figure class="pics sz-m cols-2"><img src="lab:…" alt="…">…<figcaption>설명</figcaption></figure>
  function figureHtml(f) {
    var imgs = Array.prototype.filter.call(f.querySelectorAll('img'), function (i) { return LAB_PATH.test(i.getAttribute('data-lab-path') || ''); });
    if (!imgs.length) return '';
    var c = okClass(f).split(' ');
    var sz = c.filter(function (x) { return /^sz-/.test(x); })[0] || 'sz-m';
    var want = +((c.filter(function (x) { return /^cols-/.test(x); })[0] || '').slice(5)) || imgs.length;
    var cols = Math.max(1, Math.min(3, want, imgs.length));
    var cap = f.querySelector('figcaption');
    var capHtml = cap ? htmlKids(cap).trim() : '';
    return '<figure class="pics ' + sz + ' cols-' + cols + '">' + imgs.map(function (i) {
      return '<img src="lab:' + i.getAttribute('data-lab-path') + '" alt="' + escAttr(i.getAttribute('alt') || '') + '">';
    }).join('') + (capHtml ? '<figcaption>' + capHtml + '</figcaption>' : '') + '</figure>';
  }

  // ---------------------------------------------------------------- 붙여 넣은 HTML 정리
  // DOMPurify 로 거른 조각에서 이름을 맞추고(b → strong 등), 모르는 꾸밈(span · u)은 벗기고, 우리 그림만 남긴다.
  function tidyPasted(frag, known) {
    var dropped = 0;
    Array.prototype.slice.call(frag.querySelectorAll('img')).forEach(function (img) {
      var p = img.getAttribute('data-lab-path') || '';
      if (LAB_PATH.test(p) && known(p)) {
        img.removeAttribute('data-lab-drop');
        img.setAttribute('src', known(p));
      } else { dropped++; img.remove(); }
    });
    Array.prototype.slice.call(frag.querySelectorAll('span, font')).forEach(unwrap);
    Array.prototype.slice.call(frag.querySelectorAll('b, i, s, strike, h1, h2, h5, h6, div')).forEach(function (el) {
      // 안에 문단 · 목록 같은 덩어리가 있는 div 는 벗기고, 글만 있는 div 는 문단으로
      if (el.tagName === 'DIV' && el.querySelector('p, div, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, hr')) { unwrap(el); return; }
      var to = document.createElement(RENAME[el.tagName]);
      while (el.firstChild) to.appendChild(el.firstChild);
      el.replaceWith(to);
    });
    Array.prototype.forEach.call(frag.querySelectorAll('a'), function (a) { a.removeAttribute('target'); a.removeAttribute('rel'); });
    return dropped;
  }
  function unwrap(el) { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); }

  // ---------------------------------------------------------------- 선 아이콘(시안 A, 바깥 부품 없이 직접 그림)
  // 글자 = 선(path d), [x, y, w, h, rx] = 네모, [cx, cy, r] = 동그라미
  var ICONS = {
    photo: [[3, 5, 18, 14, 2], [9, 10, 1.6], 'M4 17l5-4.5 3.5 3 3-2.5L20 17'],
    gallery: [[2.5, 6, 9, 12, 1.5], [12.5, 6, 9, 12, 1.5], 'M3.5 15.5l3-3 2.5 2.5M13.5 15.5l3-3 3.5 3.5'],
    table: [[3, 4.5, 18, 15, 2], 'M3 9.5h18M3 14.5h18M9.5 9.5v10M15 9.5v10'],
    quote: ['M5 17v-4.5C5 9 6.8 7 10 6.5M5 12.5h4.5V17H5M13 17v-4.5C13 9 14.8 7 18 6.5M13 12.5h4.5V17H13'],
    hr: ['M3 12h18M8 7h8M8 17h8'],
    card: [[3, 5, 18, 14, 2], 'M3 5h6v14H3', 'M12 10h6M12 14h4'],
    file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5M9 13h6M9 17h4'],
    code: ['M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14'],
    link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
    undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
    redo: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
    al: ['M4 6h16M4 10h10M4 14h16M4 18h10'],
    ac: ['M4 6h16M7 10h10M4 14h16M7 18h10'],
    ar: ['M4 6h16M10 10h10M4 14h16M10 18h10'],
    ul: [[5, 7, 1.2], [5, 12, 1.2], [5, 17, 1.2], 'M9.5 7H20M9.5 12H20M9.5 17H20'],
    ol: ['M4 5.5l1.5-1V9M4 13.2c.3-.8 2.6-.9 2.4.6-.1.8-2.4 2-2.4 2.7h2.6M4 18.6c.4-.6 2.5-.7 2.4.5 0 .7-1.2.8-1.2.8s1.4.1 1.3 1c-.1 1.2-2.2 1-2.6.4M10 7h10M10 13h10M10 19h10'],
    color: ['M7 16L12 4l5 12M8.8 12h6.4', 'M4 20h16'],
    mark: ['M14.5 4.5l5 5-8 8H6.5v-5z', 'M4 20h7'],
    chev: ['M6 9l6 6 6-6'],
    eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', [12, 12, 3]],
    close: ['M6 6l12 12M18 6L6 18'],
    grip: [[9, 6, 1.5], [15, 6, 1.5], [9, 12, 1.5], [15, 12, 1.5], [9, 18, 1.5], [15, 18, 1.5]],
    plus: ['M12 5v14M5 12h14'],
    trash: ['M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'],
    side: [[3, 4, 18, 16, 2], 'M15 4v16'],
    pc: [[3, 4, 18, 12, 1.5], 'M9 20h6M12 16v4'],
    phone: [[7, 3, 10, 18, 2], 'M11 18h2'],
    h: ['M6 5v14M18 5v14M6 12h12']
  };
  var SVGNS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'ed-ic' + (cls ? ' ' + cls : ''));
    (ICONS[name] || []).forEach(function (p) {
      var e;
      if (typeof p === 'string') { e = document.createElementNS(SVGNS, 'path'); e.setAttribute('d', p); }
      else if (p.length === 5) { e = document.createElementNS(SVGNS, 'rect'); ['x', 'y', 'width', 'height', 'rx'].forEach(function (k, i) { e.setAttribute(k, p[i]); }); }
      else { e = document.createElementNS(SVGNS, 'circle'); ['cx', 'cy', 'r'].forEach(function (k, i) { e.setAttribute(k, p[i]); }); if (name === 'grip') e.setAttribute('class', 'fill'); }
      s.appendChild(e);
    });
    return s;
  }

  // 고를 수 있는 모양(render.js 의 CLASS_OK 와 같은 이름)
  var QUOTES = [['', '왼쪽 가는 선'], ['q-mark', '금색 따옴표'], ['q-center', '가운데 큰 글씨']];
  var HRS = [['', '가는 선'], ['hr-gold', '금색 짧은 선'], ['hr-double', '두 줄 선']];
  var COLORS = [['', '먹색(기본)', '#1a1a1a'], ['tc-gray', '회색', '#5f5f5f'], ['tc-gold', '짙은 금색', '#86672f'], ['tc-red', '붉은색', '#a3302a']];
  var SIZES = [['fs-s', '작게'], ['', '본문 크기'], ['fs-m', '조금 크게'], ['fs-l', '크게'], ['fs-xl', '아주 크게']];
  var MARKS = [['hl-gold', '금빛 형광', '#ecdcb6'], ['hl-sky', '옅은 하늘', '#dde5f2'], ['hl-rose', '옅은 분홍', '#f6dedb'], ['', '형광 빼기', '']];

  // ---------------------------------------------------------------- 편집기
  // opts: { api, me: 로그인한 사람 id, md: 처음 글(고칠 때), head: 쓰는 칸 맨 위에 둘 것(제목 칸), placeholder,
  //         onChange(), onSave(), onFiles(파일 목록), onFileButton() }
  function create(opts) {
    var pending = Object.create(null);   // 아직 안 올린 그림: 경로 → { blob, name, size, url }
    var urls = Object.create(null);      // 이 편집기에서 보이는 그림 주소: 경로 → 주소(새 그림 · 이미 올린 그림)
    var savedRange = null, busy = 0;

    var area = h('div', { class: 'ed-area prose', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
      'aria-label': '본문', spellcheck: 'true', 'data-placeholder': opts.placeholder || '여기에 글을 쓰십시오.' });
    var picker = h('input', { type: 'file', multiple: true, accept: U.accept.photo, hidden: true });
    var pickMode = 'many', pickInto = null;   // 'many' 고른 만큼 한 묶음(11-02 사진 · 여러 장 단추를 하나로) · 'add' 고른 묶음에 더하기
    var linkIn = h('input', { type: 'url', inputmode: 'url', placeholder: 'https://', 'aria-label': '링크 주소', maxlength: 500 });
    var cardIn = h('input', { type: 'text', placeholder: '카드에 보일 제목(비우면 주소)', 'aria-label': '링크 카드 제목', maxlength: 120, hidden: true });
    var linkMode = 'link';
    var linkBar = h('div', { class: 'ed-link', hidden: true },
      h('span', { class: 'ed-link-h' }, icon('link')), linkIn, cardIn,
      h('button', { type: 'button', class: 'btn btn-small', onclick: function () { putLink(); } }, '넣기'),
      h('button', { type: 'button', class: 'btn btn-text btn-small', onclick: function () { closeLink(true); } }, '그만두기'));
    var foot = h('p', { class: 'ed-foot', 'aria-live': 'polite' });

    // ---- 도구 단추 만들기
    function noSteal(b) { b.addEventListener('mousedown', function (e) { if (e.target.tagName !== 'SELECT') e.preventDefault(); }); return b; }
    function tbtn(label, ic, fn, key, extra) {
      var b = noSteal(h('button', { type: 'button', class: 'ed-t', title: key ? label + ' (' + key + ')' : label, 'aria-label': label }, ic));
      if (extra) b.setAttribute('data-k', extra);
      b.addEventListener('click', function () { fn(b); });
      return b;
    }
    function letter(t, cls) { return h('span', { class: 'ed-lt ' + cls }, t); }
    function sep() { return h('span', { class: 'ed-sep', 'aria-hidden': 'true' }); }

    // 펼침 메뉴: 단추 + 판. 판 밖을 누르거나 Esc 면 닫힌다
    var openPop = null;
    function popw(btn, panel) {
      var w = h('span', { class: 'ed-popw' }, btn, panel);
      panel.hidden = true;
      btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () { keep(); if (openPop === panel) closePop(); else showPop(btn, panel); });
      return w;
    }
    function showPop(btn, panel) {
      closePop();
      panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); openPop = panel; openPop._btn = btn;
      // 판이 화면 오른쪽을 넘으면 오른쪽 끝에 맞춘다
      panel.classList.remove('is-r');
      if (panel.getBoundingClientRect().right > window.innerWidth - 8) panel.classList.add('is-r');
      var first = panel.querySelector('button'); if (first) first.focus({ preventScroll: true });
    }
    function closePop(back) {
      if (!openPop) return;
      openPop.hidden = true; openPop._btn.setAttribute('aria-expanded', 'false');
      if (back) openPop._btn.focus();
      openPop = null;
    }
    document.addEventListener('mousedown', function (e) { if (openPop && !openPop.parentNode.contains(e.target)) closePop(); });
    document.addEventListener('keydown', function (e) { if (openPop && e.key === 'Escape') { e.preventDefault(); closePop(true); } });
    function opt(label, sample, fn) {
      var b = noSteal(h('button', { type: 'button', class: 'ed-opt' }, sample ? h('span', { class: 'ed-ex' }, sample) : null, h('span', {}, label)));
      b.addEventListener('click', function () { closePop(); fn(); });
      return b;
    }
    function panel(title) {
      return h('div', { class: 'ed-pop', role: 'menu' }, title ? h('p', { class: 'ed-pop-h' }, title) : null, Array.prototype.slice.call(arguments, 1));
    }

    // 넣기(위층)
    function insBtn(label, sub, ic, fn, hasPop) {
      var b = noSteal(h('button', { type: 'button', class: 'ed-ins', title: label + ' · ' + sub },
        icon(ic), h('span', { class: 'ed-ins-l' }, label, hasPop ? icon('chev', 'ed-chev') : null)));
      if (fn) b.addEventListener('click', function () { fn(b); });
      return b;
    }
    // 표 크기 고르기(6 × 6)
    var gridN = h('p', { class: 'ed-grid-n' }, '3 × 3 표');
    var grid = h('div', { class: 'ed-grid', role: 'group', 'aria-label': '표 크기' });
    for (var gr = 1; gr <= 6; gr++) for (var gc = 1; gc <= 6; gc++) (function (r, c) {
      var cell = noSteal(h('button', { type: 'button', 'aria-label': r + '줄 ' + c + '칸 표' }));
      cell.addEventListener('mouseenter', function () { paintGrid(r, c); });
      cell.addEventListener('focus', function () { paintGrid(r, c); });
      cell.addEventListener('click', function () { closePop(); insertTable(r, c); });
      grid.appendChild(cell);
    })(gr, gc);
    function paintGrid(r, c) {
      Array.prototype.forEach.call(grid.children, function (cell, i) { cell.classList.toggle('on', Math.floor(i / 6) < r && i % 6 < c); });
      gridN.textContent = r + '줄 × ' + c + '칸 표(첫 줄은 제목 줄)';
    }
    paintGrid(3, 3);
    var tablePop = panel('표 크기', grid, gridN);
    var quotePop = panel('인용구 모양', QUOTES.map(function (q) { return opt(q[1], h('span', { class: 'ed-ex-q ' + (q[0] || 'q-line') }, '“'), function () { quote(q[0]); }); }));
    var hrPop = panel('구분선 모양', HRS.map(function (x) { return opt(x[1], h('span', { class: 'ed-ex-hr ' + (x[0] || 'hr-thin') }), function () { insertHr(x[0]); }); }));

    var insRow = h('div', { class: 'ed-ins-row' },
      insBtn('사진', '한 장 또는 여러 장', 'photo', function () { pickPhotos('many'); }),
      popw(insBtn('표', '줄 · 칸 고르기', 'table', null, true), tablePop),
      popw(insBtn('인용구', '모양 3가지', 'quote', null, true), quotePop),
      popw(insBtn('구분선', '모양 3가지', 'hr', null, true), hrPop),
      insBtn('링크 카드', '주소를 카드로', 'card', function () { openLink('card'); }),
      opts.onFileButton ? insBtn('파일', 'PDF · 한글 · 오피스', 'file', function () { opts.onFileButton(); }) : null,
      insBtn('코드', '코드 상자', 'code', function () { block('pre'); }));

    // 글자 꾸미기(아래층)
    var shape = h('select', { class: 'ed-shape', 'aria-label': '글 모양' },
      h('option', { value: 'p' }, '본문'), h('option', { value: 'h3' }, '큰 제목'), h('option', { value: 'h4' }, '작은 제목'));
    shape.addEventListener('change', function () { block(shape.value); });
    // 글씨 크기(2026-11-02): 고른 글자에 꾸밈 이름 fs-* 를 붙인다. '본문 크기'는 걸친 크기를 벗긴다.
    var size = h('select', { class: 'ed-shape ed-size', 'aria-label': '글씨 크기', title: '글씨 크기' },
      SIZES.map(function (z) { return h('option', { value: z[0] }, z[1]); }));
    size.addEventListener('change', function () { resize(size.value); });
    size.value = '';
    var colorPop = panel('글자색', h('div', { class: 'ed-sw-row' }, COLORS.map(function (c) {
      var b = noSteal(h('button', { type: 'button', class: 'ed-sw ' + (c[0] || 'tc-ink'), title: c[1], 'aria-label': c[1] }));
      b.addEventListener('click', function () { closePop(); paint('color', c[0], c[2]); });
      return b;
    })));
    var markPop = panel('형광', h('div', { class: 'ed-sw-row' }, MARKS.map(function (c) {
      var b = noSteal(h('button', { type: 'button', class: 'ed-sw ' + (c[0] || 'hl-none'), title: c[1], 'aria-label': c[1] }));
      b.addEventListener('click', function () { closePop(); paint('mark', c[0], c[2]); });
      return b;
    })));
    var state = {
      bold: tbtn('굵게', letter('B', 'b'), function () { exec('bold'); }, 'Ctrl+B'),
      italic: tbtn('기울임', letter('I', 'i'), function () { exec('italic'); }, 'Ctrl+I'),
      underline: tbtn('밑줄', letter('U', 'u'), function () { exec('underline'); }, 'Ctrl+U'),
      strikeThrough: tbtn('취소선', letter('S', 's'), function () { exec('strikeThrough'); })
    };
    var alignBtns = {
      '': tbtn('왼쪽 맞춤', icon('al'), function () { align(''); }),
      'al-center': tbtn('가운데 맞춤', icon('ac'), function () { align('al-center'); }),
      'al-right': tbtn('오른쪽 맞춤', icon('ar'), function () { align('al-right'); })
    };
    var listBtns = {
      insertUnorderedList: tbtn('점 목록', icon('ul'), function () { exec('insertUnorderedList'); }),
      insertOrderedList: tbtn('번호 목록', icon('ol'), function () { exec('insertOrderedList'); })
    };
    var fmtRow = h('div', { class: 'ed-fmt-row' },
      shape, size, sep(),
      state.bold, state.italic, state.underline, state.strikeThrough, sep(),
      popw(tbtn('글자색', icon('color'), function () {}), colorPop),
      popw(tbtn('형광', icon('mark'), function () {}), markPop), sep(),
      alignBtns[''], alignBtns['al-center'], alignBtns['al-right'], sep(),
      listBtns.insertUnorderedList, listBtns.insertOrderedList, sep(),
      tbtn('링크', icon('link'), function () { openLink('link'); }, 'Ctrl+K'), sep(),
      tbtn('되돌리기', icon('undo'), function () { exec('undo'); }, 'Ctrl+Z'),
      tbtn('다시', icon('redo'), function () { exec('redo'); }, 'Ctrl+Shift+Z'));
    // 표 안에 있을 때만 보이는 표 도구
    var tblBar = h('div', { class: 'ed-tbl', hidden: true }, h('span', { class: 'ed-tbl-h' }, '표'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { tableEdit('row+'); } }, '줄 더하기'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { tableEdit('col+'); } }, '칸 더하기'),
      h('button', { type: 'button', class: 'btn btn-text btn-small', onclick: function () { tableEdit('row-'); } }, '이 줄 빼기'),
      h('button', { type: 'button', class: 'btn btn-text btn-small', onclick: function () { tableEdit('col-'); } }, '이 칸 빼기'),
      h('button', { type: 'button', class: 'btn btn-text btn-small', onclick: function () { tableEdit('del'); } }, '표 빼기'));
    Array.prototype.forEach.call(tblBar.querySelectorAll('button'), noSteal);

    var bar = h('div', { class: 'ed-bar', role: 'toolbar', 'aria-label': '넣기와 글자 꾸미기' }, insRow, fmtRow, tblBar, linkBar);

    // 사진 도구(사진 묶음을 누르면 위에 뜬다)
    var phSize = {}, phCols = {};
    var phbar = h('div', { class: 'ed-phbar', role: 'toolbar', 'aria-label': '사진 도구', hidden: true });
    [['sz-s', '작게'], ['sz-m', '본문 폭'], ['sz-l', '크게']].forEach(function (s) {
      phSize[s[0]] = noSteal(h('button', { type: 'button', class: 'ed-t', onclick: function () { figSet('sz', s[0]); } }, s[1]));
      phbar.appendChild(phSize[s[0]]);
    });
    phbar.appendChild(sep());
    [1, 2, 3].forEach(function (n) {
      phCols[n] = noSteal(h('button', { type: 'button', class: 'ed-t', title: '한 줄에 ' + n + '장', onclick: function () { figSet('cols', 'cols-' + n); } }, n + '장씩'));
      phbar.appendChild(phCols[n]);
    });
    phbar.appendChild(sep());
    phbar.appendChild(noSteal(h('button', { type: 'button', class: 'ed-t', onclick: function () { if (picked) pickPhotos('add', picked); } }, icon('plus'), '사진 더하기')));
    phbar.appendChild(noSteal(h('button', { type: 'button', class: 'ed-t', onclick: function () { if (picked) { var f = picked; unpick(); afterRemove(f); f.remove(); changed(); } } }, icon('trash'), '빼기')));

    // 문단 손잡이 · 끌어 옮기기
    var hdl = h('button', { type: 'button', class: 'ed-hdl', draggable: 'true', 'aria-label': '끌어서 이 덩어리 옮기기', tabindex: '-1', hidden: true }, icon('grip'));
    var dropline = h('div', { class: 'ed-dropline', hidden: true });

    var paper = h('div', { class: 'ed-paper' }, opts.head || null, opts.head ? h('div', { class: 'ed-tline' }) : null, area, foot, phbar, hdl, dropline);
    var el = h('div', { class: 'ed' }, bar, paper, picker);

    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* 지원 안 하면 div 문단 → 저장할 때 문단으로 */ }

    // ---- 쓰던 자리 기억 · 되살리기(도구 줄 · 링크 칸으로 손이 갔다 와도)
    function inArea(node) { return node && (node === area || area.contains(node)); }
    function keep() {
      var sel = window.getSelection();
      if (sel.rangeCount && inArea(sel.getRangeAt(0).commonAncestorContainer)) savedRange = sel.getRangeAt(0).cloneRange();
    }
    // 커서가 아직 본문 안에 있으면(도구 줄은 눌러도 커서를 안 옮김) 그 자리를 그대로 쓴다. 링크 칸 · 파일 고르기로 나갔다 오면
    // 나가기 전에 기억한 자리로, 그 자리가 지워졌으면 본문 끝으로.
    function restore() {
      var sel = window.getSelection();
      var cur = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      var r = cur && inArea(cur.commonAncestorContainer) ? cur
        : savedRange && savedRange.startContainer.isConnected && inArea(savedRange.startContainer) ? savedRange : null;
      if (!r) { r = document.createRange(); r.selectNodeContents(area); r.collapse(false); }
      if (document.activeElement !== area && !(document.activeElement && inArea(document.activeElement))) area.focus({ preventScroll: true });
      sel.removeAllRanges(); sel.addRange(r);
      return r;
    }
    document.addEventListener('selectionchange', function () { keep(); refresh(); });

    // 본문 바로 아래 덩어리(문단 · 제목 · 사진 묶음 …)
    function topOf(node) {
      while (node && node.parentNode !== area) { if (node === area || !node.parentNode) return null; node = node.parentNode; }
      return node;
    }
    function curTop() { var r = restore(); return topOf(r.startContainer); }
    function caretTo(node, end) {
      var r = document.createRange(); r.selectNodeContents(node); r.collapse(!end);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    function emptyP() { return h('p', {}, h('br')); }
    function isBlank(b) { return b && b.tagName === 'P' && !b.textContent.trim() && !b.querySelector('img'); }
    // 덩어리 하나를 지금 자리에 넣는다: 빈 문단이면 그 자리를 바꾸고, 아니면 그 아래에. 뒤에 쓸 문단을 하나 둔다
    function putBlock(node, caretInside) {
      var cur = curTop();
      if (cur && isBlank(cur)) cur.replaceWith(node);
      else if (cur) cur.after(node);
      else area.appendChild(node);
      var next = node.nextElementSibling;
      if (!next || !isBlank(next)) { next = emptyP(); node.after(next); }
      decorate();
      if (caretInside) caretTo(caretInside, false); else caretTo(next, false);
      changed();
    }

    function exec(cmd, val) { restore(); document.execCommand(cmd, false, val === undefined ? null : val); changed(); }
    function block(tag) {
      if (tag === 'pre') {
        var cur = curTop();
        if (cur && cur.tagName === 'PRE') { exec('formatBlock', '<p>'); return; }
      }
      exec('formatBlock', '<' + tag + '>');
    }
    function quote(cls) {
      restore();
      var sel = window.getSelection(), node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      var bq = node && (node.nodeType === 1 ? node : node.parentNode).closest('blockquote');
      if (!(bq && inArea(bq))) { document.execCommand('formatBlock', false, '<blockquote>'); node = sel.getRangeAt(0).startContainer; bq = (node.nodeType === 1 ? node : node.parentNode).closest('blockquote'); }
      if (bq && inArea(bq)) { bq.classList.remove('q-mark', 'q-center'); if (cls) bq.classList.add(cls); }
      changed();
    }
    function insertHr(cls) { var hr = h('hr', { class: cls || null }); putBlock(hr); }
    function insertTable(r, c) {
      var head = h('tr', {}), body = h('tbody', {});
      for (var j = 0; j < c; j++) head.appendChild(h('th', {}, h('br')));
      for (var i = 1; i < r; i++) { var tr = h('tr', {}); for (var k = 0; k < c; k++) tr.appendChild(h('td', {}, h('br'))); body.appendChild(tr); }
      var t = h('table', {}, h('thead', {}, head), body);
      putBlock(t, head.firstChild);
    }
    function cellOf() {
      var sel = window.getSelection(); if (!sel.rangeCount) return null;
      var n = sel.getRangeAt(0).startContainer; n = n.nodeType === 1 ? n : n.parentNode;
      var c = n.closest && n.closest('td, th');
      return c && inArea(c) ? c : null;
    }
    function tableEdit(what) {
      var cell = cellOf(); if (!cell) return;
      var tr = cell.parentNode, t = cell.closest('table'), idx = Array.prototype.indexOf.call(tr.children, cell);
      var rows = Array.prototype.slice.call(t.querySelectorAll('tr'));
      if (what === 'row+') {
        var nr = h('tr', {}); for (var i = 0; i < tr.children.length; i++) nr.appendChild(h('td', {}, h('br')));
        if (tr.parentNode.tagName === 'THEAD') { var tb = t.querySelector('tbody') || t.appendChild(h('tbody')); tb.insertBefore(nr, tb.firstChild); } else tr.after(nr);
        caretTo(nr.firstChild);
      } else if (what === 'col+') {
        rows.forEach(function (row) { var ref = row.children[idx]; var nc = h(ref && ref.tagName === 'TH' ? 'th' : 'td', {}, h('br')); if (ref) ref.after(nc); else row.appendChild(nc); });
        caretTo(tr.children[idx + 1]);
      } else if (what === 'row-') {
        if (tr.parentNode.tagName === 'THEAD' || rows.length <= 1) { say('제목 줄은 뺄 수 없습니다. 표 전체를 빼려면 \'표 빼기\'를 누르십시오.', 'error'); return; }
        var to = tr.previousElementSibling || tr.nextElementSibling; tr.remove(); if (to) caretTo(to.firstChild);
      } else if (what === 'col-') {
        if (tr.children.length <= 1) { tableEdit('del'); return; }
        rows.forEach(function (row) { if (row.children[idx]) row.children[idx].remove(); });
        caretTo(tr.children[Math.max(0, idx - 1)]);
      } else if (what === 'del') {
        var nx = t.nextElementSibling; t.remove(); if (nx) caretTo(nx); else { var p = emptyP(); area.appendChild(p); caretTo(p); }
      }
      changed();
    }

    // 정렬: 고른 문단 · 제목마다 꾸밈 이름 하나
    function align(cls) {
      var r = restore();
      Array.prototype.forEach.call(area.children, function (b) {
        if (!/^(P|H3|H4)$/.test(b.tagName) || !r.intersectsNode(b)) return;
        b.classList.remove('al-center', 'al-right');
        if (cls) b.classList.add(cls);
        if (!b.classList.length) b.removeAttribute('class');
      });
      changed();
    }

    // 글씨 크기: 브라우저 명령(fontSize 7)으로 감싼 뒤 normalize 가 fs-* 꾸밈 이름으로 바꾼다
    var sizeNext = '';
    function resize(cls) {
      var r = restore();
      if (r.collapsed) { say('크기를 바꿀 글자를 먼저 고르십시오(끌어서 고르기).', 'error'); refresh(); return; }
      Array.prototype.slice.call(area.querySelectorAll('span.fs-s, span.fs-m, span.fs-l, span.fs-xl')).forEach(function (s) {
        if (!r.intersectsNode(s)) return;
        SIZES.forEach(function (z) { if (z[0]) s.classList.remove(z[0]); });
        if (!okClass(s)) unwrap(s);
      });
      if (cls) {
        restore();
        try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* 없으면 그대로 */ }
        sizeNext = cls;
        document.execCommand('fontSize', false, '7');
        normalize();
        sizeNext = '';
      }
      changed();
    }

    // 글자색 · 형광: 브라우저 명령으로 칠한 뒤 우리 꾸밈 이름으로 바꾼다(style 속성은 저장하지 않음)
    function paint(kind, cls, hex) {
      var r = restore();
      if (!cls) {   // 기본색 · 형광 빼기: 고른 곳에 걸친 칠을 벗긴다
        var sel = kind === 'color' ? 'span.tc-gray, span.tc-gold, span.tc-red' : 'mark';
        Array.prototype.slice.call(area.querySelectorAll(sel)).forEach(function (s) { if (r.intersectsNode(s)) unwrap(s); });
        changed(); return;
      }
      if (r.collapsed) { say('칠할 글자를 먼저 고르십시오(끌어서 고르기).', 'error'); return; }
      try { document.execCommand('styleWithCSS', false, kind === 'mark'); } catch (e) { /* 없으면 그대로 */ }
      document.execCommand(kind === 'color' ? 'foreColor' : 'hiliteColor', false, hex);
      try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* 없으면 그대로 */ }
      normalize();
      changed();
    }
    function hexOf(v) {
      var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v || '');
      if (!m) return (v || '').trim().toLowerCase();
      return '#' + [m[1], m[2], m[3]].map(function (x) { return (+x).toString(16).padStart(2, '0'); }).join('');
    }
    function normalize() {
      Array.prototype.slice.call(area.querySelectorAll('font')).forEach(function (f) {
        var c = COLORS.filter(function (x) { return x[2] === hexOf(f.getAttribute('color')); })[0];
        var cls = [c && c[0], f.getAttribute('size') === '7' && sizeNext].filter(Boolean).join(' ');
        if (!cls) { unwrap(f); return; }
        var s = h('span', { class: cls }); while (f.firstChild) s.appendChild(f.firstChild); f.replaceWith(s);
      });
      Array.prototype.slice.call(area.querySelectorAll('[style]')).forEach(function (s) {
        // 사이트 차단 규칙(style-src)이 style 속성을 적용하지 않으므로 s.style 이 비어 있다: 속성 글자에서 색을 읽는다
        var st = s.getAttribute('style') || '';
        var bg = hexOf((/background(?:-color)?\s*:\s*([^;]+)/i.exec(st) || [])[1]);
        var fg = hexOf((/(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(st) || [])[1]);
        var m = MARKS.filter(function (x) { return x[2] && x[2] === bg; })[0];
        var c = COLORS.filter(function (x) { return x[0] && x[2] === fg; })[0];
        s.removeAttribute('style');
        if (s.tagName !== 'SPAN') return;
        if (m) { var mk = h('mark', { class: m[0] }); while (s.firstChild) mk.appendChild(s.firstChild); s.replaceWith(mk); }
        else if (c) { s.classList.remove('tc-gray', 'tc-gold', 'tc-red'); s.classList.add(c[0]); }
        else if (!okClass(s)) unwrap(s);
      });
    }

    // ---- 링크 · 링크 카드
    function openLink(mode) {
      keep(); linkMode = mode; linkBar.hidden = false; linkIn.value = ''; cardIn.value = ''; cardIn.hidden = mode !== 'card';
      linkBar.classList.toggle('is-card', mode === 'card');
      linkIn.focus();
    }
    function closeLink(back) { linkBar.hidden = true; if (back) restore(); }
    function putLink() {
      var u = linkIn.value.trim();
      if (!/^(https?:\/\/|mailto:)\S+$/i.test(u)) { say('링크는 https:// 로 시작하는 주소로 적어 주십시오.', 'error'); linkIn.focus(); return; }
      var title = cardIn.value.trim();
      closeLink(true);
      if (linkMode === 'card') {
        var a = h('a'); a.setAttribute('href', u); a.textContent = title || u.replace(/^https?:\/\//i, '');
        putBlock(h('p', { class: 'lcard' }, a)); return;
      }
      var sel = window.getSelection();
      if (sel.rangeCount && !sel.getRangeAt(0).collapsed) document.execCommand('createLink', false, u);
      else document.execCommand('insertHTML', false, '<a href="' + escAttr(u) + '">' + escAttr(u) + '</a>&nbsp;');
      changed();
    }
    [linkIn, cardIn].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); putLink(); }
        if (e.key === 'Escape') { e.preventDefault(); closeLink(true); }
      });
    });

    // ---- 그림 넣기(붙여 넣기 · 끌어다 놓기 · 고르기 모두 여기로). 한 번에 들어온 그림은 한 묶음(figure)
    function newPath(ext) { return opts.me + '/' + crypto.randomUUID() + '.' + ext; }
    function isImage(f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name || ''); }
    function pickPhotos(mode, into) { keep(); pickMode = mode; pickInto = into || null; picker.click(); }
    // 한 줄에 몇 장씩: 1~3장은 그 수대로, 4장은 2장씩 두 줄, 5장부터는 3장씩
    function colsFor(n) { return n === 4 ? 2 : Math.max(1, Math.min(3, n)); }
    function figure(imgs, cols) {
      var f = h('figure', { class: 'pics sz-m cols-' + (cols || colsFor(imgs.length)) });
      imgs.forEach(function (i) { f.appendChild(i); });
      f.appendChild(h('figcaption', {}));
      return f;
    }
    async function addImages(files, range, mode, into) {
      var list = Array.prototype.filter.call(files, isImage);
      if (!list.length) return;
      busy++; changed();
      say(list.length + '장을 줄이는 중…');
      var made = [], errors = [];
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        // 붙여 넣은 그림은 이름이 'image.png'처럼 오거나 비어 있다: 확장자를 형식에서 붙여 검사한다
        if (!/\.[A-Za-z0-9]+$/.test(f.name || '')) f = new File([f], 'image.' + ((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: f.type });
        var chk = await U.checkPhoto(f);
        if (!chk.ok) { errors.push(chk.error); continue; }
        try {
          var out = await U.reencodePhoto(f);
          var path = newPath('jpg');
          var base = (f.name || '').replace(/\.[^.]+$/, '');
          var alt = /^(image|이미지|스크린샷|screenshot)/i.test(base) || !base ? '그림' : U.safeName(base).slice(0, 80);
          var url = URL.createObjectURL(out.blob);
          pending[path] = { blob: out.blob, name: U.safeName(base || '그림') + '.jpg', size: out.blob.size };
          urls[path] = url;
          var img = h('img', { alt: alt, 'data-lab-path': path }); img.src = url;
          made.push(img);
        } catch (e) { errors.push(L.errText(e)); }
      }
      busy--;
      if (made.length) {
        if (range) { var sel = window.getSelection(); area.focus(); sel.removeAllRanges(); sel.addRange(range); }
        if (mode === 'add' && into && into.isConnected) {
          var cap = into.querySelector('figcaption');
          made.forEach(function (m) { into.insertBefore(m, cap); });
          var n = into.querySelectorAll('img').length;
          setClass(into, 'cols-', 'cols-' + colsFor(n));
          decorate(); changed();
        } else putBlock(figure(made));
      }
      changed();
      if (errors.length) say(errors.join(' / '), 'error');
      else say('사진 ' + made.length + '장을 넣었습니다. 글을 저장할 때 올라갑니다.', 'ok');
    }
    picker.addEventListener('change', function () { addImages(picker.files, null, pickMode, pickInto); picker.value = ''; });

    // ---- 사진 묶음 고르기 · 크기 · 나란히 · 순서
    var picked = null;
    function setClass(node, prefix, cls) {
      Array.prototype.slice.call(node.classList).forEach(function (c) { if (c.indexOf(prefix) === 0) node.classList.remove(c); });
      node.classList.add(cls);
    }
    function pick(f) {
      if (picked === f) return;
      unpick(); picked = f; f.classList.add('is-sel'); phbar.hidden = false; placePhbar(); syncPhbar();
    }
    function unpick() { if (picked) picked.classList.remove('is-sel'); picked = null; phbar.hidden = true; }
    function afterRemove(f) { var nx = f.nextElementSibling || f.previousElementSibling; if (nx) caretTo(nx); }
    function placePhbar() {
      if (!picked) return;
      var pr = paper.getBoundingClientRect(), fr = picked.getBoundingClientRect();
      phbar.style.top = Math.max(8, fr.top - pr.top - 56) + 'px';
      phbar.style.left = Math.max(8, Math.min(pr.width - phbar.offsetWidth - 8, fr.left - pr.left + fr.width / 2 - phbar.offsetWidth / 2)) + 'px';
    }
    function syncPhbar() {
      if (!picked) return;
      Object.keys(phSize).forEach(function (k) { phSize[k].setAttribute('aria-pressed', String(picked.classList.contains(k))); });
      var n = picked.querySelectorAll('img').length;
      Object.keys(phCols).forEach(function (k) {
        phCols[k].hidden = n < 2 || +k > n;
        phCols[k].setAttribute('aria-pressed', String(picked.classList.contains('cols-' + k)));
      });
    }
    function figSet(kind, cls) { if (!picked) return; setClass(picked, kind === 'sz' ? 'sz-' : 'cols-', cls); syncPhbar(); placePhbar(); changed(); }
    window.addEventListener('resize', placePhbar);
    window.addEventListener('scroll', placePhbar, { passive: true });

    // 사진 묶음 안 그림 끌어 순서 바꾸기
    var dragImg = null;
    function wireImg(img) {
      if (img._wired) return; img._wired = true;
      img.draggable = true;
      img.addEventListener('dragstart', function (e) { dragImg = img; e.dataTransfer.setData('text/x-lab-img', '1'); e.dataTransfer.effectAllowed = 'move'; img.classList.add('is-dragging'); });
      img.addEventListener('dragend', function () { if (dragImg) dragImg.classList.remove('is-dragging'); dragImg = null; clearImgDrop(); });
      img.addEventListener('dragover', function (e) {
        if (!dragImg || dragImg === img || dragImg.parentNode !== img.parentNode) return;
        e.preventDefault(); e.stopPropagation();
        var r = img.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
        clearImgDrop(); img.classList.add(after ? 'drop-r' : 'drop-l');
      });
      img.addEventListener('drop', function (e) {
        if (!dragImg || dragImg.parentNode !== img.parentNode) return;
        e.preventDefault(); e.stopPropagation();
        if (img.classList.contains('drop-r')) img.after(dragImg); else img.before(dragImg);
        clearImgDrop(); changed();
      });
    }
    function clearImgDrop() { Array.prototype.forEach.call(area.querySelectorAll('.drop-l, .drop-r'), function (i) { i.classList.remove('drop-l', 'drop-r'); }); }

    // 사진 묶음 · 링크 카드는 통째로 다루고(글자 커서가 안 들어감), 사진 설명 칸만 글을 쓴다
    function decorate() {
      Array.prototype.forEach.call(area.querySelectorAll('figure'), function (f) {
        f.setAttribute('contenteditable', 'false');
        var cap = f.querySelector('figcaption');
        if (!cap) { cap = h('figcaption'); f.appendChild(cap); }
        cap.setAttribute('contenteditable', 'true'); cap.setAttribute('data-ph', '사진 설명을 적어 주십시오(비워 두면 안 보임)');
        Array.prototype.forEach.call(f.querySelectorAll('img'), wireImg);
      });
    }
    // 옛 글의 '문단 안 그림'은 처음 불러올 때 사진 묶음으로 바꾼다(저장하면 새 모양으로)
    function upgradeOld() {
      Array.prototype.slice.call(area.children).forEach(function (p) {
        if (p.tagName !== 'P') return;
        var imgs = p.querySelectorAll('img');
        if (imgs.length && !p.textContent.trim()) p.replaceWith(figure(Array.prototype.slice.call(imgs), 1));
      });
    }

    // ---- 붙여 넣기: 그림만 있으면 그림으로, 글이 있으면 모양을 거른 글로(그림은 따로 넣게 알림)
    area.addEventListener('paste', function (e) {
      var cd = e.clipboardData;
      if (!cd) return;
      if (e.target.closest && e.target.closest('figcaption')) {   // 사진 설명 칸: 글자만
        e.preventDefault(); document.execCommand('insertText', false, (cd.getData('text/plain') || '').replace(/\s+/g, ' ')); changed(); return;
      }
      var files = Array.prototype.filter.call(cd.files || [], isImage);
      var html = cd.getData('text/html'), text = cd.getData('text/plain');
      var hasText = (text || '').replace(/\s/g, '').length > 0;
      if (files.length && (!hasText || (/<img/i.test(html) && text.trim().length < 20))) {
        e.preventDefault(); keep(); addImages(files, null, 'many'); return;
      }
      if (html) {
        e.preventDefault();
        var frag = window.DOMPurify.sanitize(html, PASTE);
        var dropped = tidyPasted(frag, function (p) { return urls[p]; });
        var box = document.createElement('div'); box.appendChild(frag);
        document.execCommand('insertHTML', false, box.innerHTML);
        changed();
        if (dropped) say('붙여 넣은 글 속 그림 ' + dropped + '개는 뺐습니다. 그림은 그림만 복사해서 붙여 넣거나 \'사진\' 단추로 넣어 주십시오.', 'error');
        return;
      }
      if (text) { e.preventDefault(); document.execCommand('insertText', false, text); changed(); }
    });

    // ---- 끌어다 놓기: 그림 파일은 놓은 자리에, 다른 파일은 첨부 칸으로, 손잡이로 끈 덩어리는 놓은 자리로
    var moving = null, dropRef = null, dropAfter = false;
    function hasType(e, t) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, t) !== -1; }
    paper.addEventListener('dragover', function (e) {
      if (moving) {
        e.preventDefault();
        var kids = Array.prototype.filter.call(area.children, function (c) { return c !== moving; });
        dropRef = null;
        for (var i = 0; i < kids.length; i++) {
          var r = kids[i].getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) { dropRef = kids[i]; dropAfter = false; break; }
          dropRef = kids[i]; dropAfter = true;
        }
        if (dropRef) {
          var pr = paper.getBoundingClientRect(), rr = dropRef.getBoundingClientRect();
          dropline.hidden = false;
          dropline.style.top = ((dropAfter ? rr.bottom : rr.top) - pr.top - 1) + 'px';
        }
        return;
      }
      if (hasType(e, 'Files')) { e.preventDefault(); el.classList.add('is-drop'); }
    });
    paper.addEventListener('dragleave', function (e) { if (!paper.contains(e.relatedTarget)) { el.classList.remove('is-drop'); dropline.hidden = true; } });
    paper.addEventListener('drop', function (e) {
      el.classList.remove('is-drop');
      if (moving) {
        e.preventDefault(); dropline.hidden = true;
        if (dropRef) { if (dropAfter) dropRef.after(moving); else dropRef.before(moving); }
        moving.classList.remove('is-moving'); moving = null; changed(); return;
      }
      if (hasType(e, 'text/x-lab-img')) { e.preventDefault(); return; }
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault();
      var range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      var imgs = Array.prototype.filter.call(files, isImage), rest = Array.prototype.filter.call(files, function (f) { return !isImage(f); });
      if (imgs.length) addImages(imgs, range && inArea(range.startContainer) ? range : null, 'many');
      if (rest.length) {
        if (opts.onFiles) opts.onFiles(rest);
        else say('이 게시판에는 파일을 붙일 수 없습니다. 그림만 넣을 수 있습니다.', 'error');
      }
    });
    // 손잡이: 마우스가 올라간 덩어리 왼쪽에 뜬다
    var hoverTop = null;
    paper.addEventListener('mousemove', function (e) {
      if (moving || window.matchMedia('(max-width: 640px)').matches) return;
      var t = e.target === hdl || hdl.contains(e.target) ? hoverTop : topOf(e.target);
      if (!t || t === hoverTop) return;
      hoverTop = t;
      var pr = paper.getBoundingClientRect(), tr = t.getBoundingClientRect();
      hdl.hidden = false;
      hdl.style.top = (tr.top - pr.top + Math.min(tr.height, 40) / 2 - 18) + 'px';
    });
    paper.addEventListener('mouseleave', function () { if (!moving) { hdl.hidden = true; hoverTop = null; } });
    hdl.addEventListener('dragstart', function (e) {
      if (!hoverTop) { e.preventDefault(); return; }
      moving = hoverTop; moving.classList.add('is-moving'); unpick();
      e.dataTransfer.setData('text/x-lab-block', '1'); e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setDragImage(moving, 20, 20); } catch (x) { /* 안 되면 기본 그림 */ }
    });
    hdl.addEventListener('dragend', function () { if (moving) moving.classList.remove('is-moving'); moving = null; dropline.hidden = true; hdl.hidden = true; hoverTop = null; });

    // ---- 그림 · 사진 묶음 누르기
    area.addEventListener('click', function (e) {
      var f = e.target.closest && e.target.closest('figure');
      if (f && inArea(f)) { pick(f); return; }
      unpick();
    });

    area.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') unpick();
      if (picked && (e.key === 'Backspace' || e.key === 'Delete') && !(e.target.closest && e.target.closest('figcaption'))) {
        e.preventDefault(); var f = picked; unpick(); afterRemove(f); f.remove(); changed(); return;
      }
      if (e.target.closest && e.target.closest('figcaption') && e.key === 'Enter') { e.preventDefault(); return; }   // 설명은 한 줄
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openLink('link'); }
      if (mod && !e.shiftKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); exec('underline'); }
      if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (opts.onSave) opts.onSave(); }
    });
    area.addEventListener('input', function () { normalize(); changed(); });

    // 도구 줄 상태: 지금 커서 자리의 굵게 · 정렬 · 글 모양 · 표 안인지
    function refresh() {
      var sel = window.getSelection();
      if (!sel.rangeCount || !inArea(sel.getRangeAt(0).startContainer)) return;
      Object.keys(state).forEach(function (k) {
        var on = false; try { on = document.queryCommandState(k); } catch (e) { /* 모름 */ }
        state[k].setAttribute('aria-pressed', String(on));
      });
      var t = topOf(sel.getRangeAt(0).startContainer);
      var tag = t ? t.tagName : 'P';
      shape.value = tag === 'H3' ? 'h3' : tag === 'H4' ? 'h4' : 'p';
      Object.keys(alignBtns).forEach(function (k) {
        alignBtns[k].setAttribute('aria-pressed', String(!!t && (k ? t.classList.contains(k) : !t.classList.contains('al-center') && !t.classList.contains('al-right'))));
      });
      Object.keys(listBtns).forEach(function (k) {
        var on = false; try { on = document.queryCommandState(k); } catch (e) { /* 모름 */ }
        listBtns[k].setAttribute('aria-pressed', String(on));
      });
      tblBar.hidden = !cellOf();
      var sz = sel.getRangeAt(0).startContainer;
      sz = (sz.nodeType === 1 ? sz : sz.parentNode).closest('span.fs-s, span.fs-m, span.fs-l, span.fs-xl');
      size.value = sz && inArea(sz) ? SIZES.filter(function (z) { return z[0] && sz.classList.contains(z[0]); })[0][0] : '';
    }

    var dirty = false;
    function changed() {
      var empty = !area.textContent.trim() && !area.querySelector('img, hr, table, figure');
      area.classList.toggle('is-empty', empty);
      dirty = true;
      if (picked && !picked.isConnected) unpick();
      if (opts.onChange) opts.onChange();
    }
    function say(msg, kind) {
      foot.textContent = msg || '';
      foot.classList.toggle('is-error', kind === 'error');
      foot.classList.toggle('is-ok', kind === 'ok');
    }

    // ---- 처음 글 불러오기(고칠 때): 거른 조각을 넣고 우리 그림 주소를 채운다
    function load(md) {
      area.replaceChildren();
      if (md) area.appendChild(window.LabRender.markdown(md));
      Array.prototype.forEach.call(area.querySelectorAll('a'), function (a) { a.removeAttribute('target'); a.removeAttribute('rel'); });
      var jobs = Array.prototype.map.call(area.querySelectorAll('img[data-lab-src]'), function (img) {
        var p = img.getAttribute('data-lab-src');
        img.removeAttribute('data-lab-src');
        img.setAttribute('data-lab-path', p);
        return opts.api.attachmentUrl({ bucket: 'gallery', path: p })
          .then(function (u) { img.src = u; urls[p] = u; })
          .catch(function () { img.alt = '그림을 불러오지 못했습니다'; });
      });
      upgradeOld();
      decorate();
      if (!area.firstChild) area.appendChild(emptyP());
      if (area.lastElementChild && !isBlank(area.lastElementChild) && !/^(P|H3|H4)$/.test(area.lastElementChild.tagName)) area.appendChild(emptyP());
      changed();
      dirty = false;
      return Promise.all(jobs);
    }

    return {
      el: el,
      ready: load(opts.md || ''),
      markdown: function () { return toMarkdown(area); },
      // 지금 본문에 있는 우리 그림 경로(나온 차례대로)와, 그중 아직 안 올린 그림
      images: function () {
        var paths = Array.prototype.map.call(area.querySelectorAll('img[data-lab-path]'), function (i) { return i.getAttribute('data-lab-path'); })
          .filter(function (p) { return LAB_PATH.test(p); });
        return { paths: paths, fresh: paths.filter(function (p) { return pending[p]; }).map(function (p) {
          return { path: p, blob: pending[p].blob, name: pending[p].name, size: pending[p].size };
        }) };
      },
      // 미리 보기에서 아직 안 올린 그림도 보이게
      imageUrl: function (p) { return urls[p] || null; },
      // 글자 수(빈칸 뺌) · 읽는 시간(1분에 500자)
      stats: function () {
        var n = area.textContent.replace(/\s/g, '').length;
        return { chars: n, minutes: Math.max(1, Math.round(n / 500)), photos: area.querySelectorAll('img[data-lab-path]').length };
      },
      uploaded: function (paths) { paths.forEach(function (p) { delete pending[p]; }); },
      busy: function () { return busy > 0; },
      isDirty: function () { return dirty; },
      clean: function () { dirty = false; },
      isEmpty: function () { return area.classList.contains('is-empty'); },
      say: say,
      focus: function () { area.focus(); }
    };
  }

  window.LabEditor = { create: create, toMarkdown: toMarkdown, icon: icon };
})();
