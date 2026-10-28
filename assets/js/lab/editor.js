// 회원 글 편집기(2026-10-27, 연구자: "블로그 같이 작성하는 경우도 있으니까 이미지 복붙 해도 ㄱㅊ게 하는 등 편집 기능을 좀 잘").
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
  var BLOCK = /^(P|DIV|H[1-6]|BLOCKQUOTE|UL|OL|LI|PRE|HR|TABLE)$/;

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
      if (tag === 'P' || tag === 'DIV' || tag === 'LI') out.push.apply(out, blocks(n));
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
    Array.prototype.slice.call(frag.querySelectorAll('span, u, font')).forEach(unwrap);
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

  // ---------------------------------------------------------------- 편집기
  // opts: { api, me: 로그인한 사람 id, md: 처음 글(고칠 때), placeholder, onChange(), onSave(), onFiles(파일 목록), notice(글, 종류) }
  function create(opts) {
    var pending = Object.create(null);   // 아직 안 올린 그림: 경로 → { blob, name, size, url }
    var urls = Object.create(null);      // 이 편집기에서 보이는 그림 주소: 경로 → 주소(새 그림 · 이미 올린 그림)
    var savedRange = null, busy = 0;

    var area = h('div', { class: 'ed-area prose', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
      'aria-label': '본문', spellcheck: 'true', 'data-placeholder': opts.placeholder || '여기에 글을 쓰세요. 복사한 그림은 그대로 붙여 넣으면 들어갑니다.' });
    var picker = h('input', { type: 'file', multiple: true, accept: U.accept.photo, hidden: true });
    var linkIn = h('input', { type: 'url', inputmode: 'url', placeholder: 'https://', 'aria-label': '링크 주소', maxlength: 500 });
    var linkBar = h('div', { class: 'ed-link', hidden: true },
      linkIn,
      h('button', { type: 'button', class: 'btn btn-small', onclick: function () { putLink(); } }, '링크 넣기'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { closeLink(true); } }, '그만두기'));
    var foot = h('p', { class: 'ed-foot', 'aria-live': 'polite' });

    // 도구 줄: [이름, 하는 일, 단축키 설명]
    var TOOLS = [
      ['굵게', function () { exec('bold'); }, 'Ctrl+B', 'ed-b'],
      ['기울임', function () { exec('italic'); }, 'Ctrl+I', 'ed-i'],
      ['취소선', function () { exec('strikeThrough'); }],
      '|',
      ['큰 제목', function () { block('h3'); }],
      ['작은 제목', function () { block('h4'); }],
      ['본문', function () { block('p'); }],
      '|',
      ['• 목록', function () { exec('insertUnorderedList'); }],
      ['1. 목록', function () { exec('insertOrderedList'); }],
      ['인용', quote],
      '|',
      ['링크', openLink, 'Ctrl+K'],
      ['그림', function () { keep(); picker.click(); }],
      ['가로줄', function () { exec('insertHorizontalRule'); }],
      '|',
      ['되돌리기', function () { exec('undo'); }, 'Ctrl+Z'],
      ['다시', function () { exec('redo'); }, 'Ctrl+Shift+Z']
    ];
    var bar = h('div', { class: 'ed-bar', role: 'toolbar', 'aria-label': '글 꾸미기' }, TOOLS.map(function (t) {
      if (t === '|') return h('span', { class: 'ed-sep', 'aria-hidden': 'true' });
      var b = h('button', { type: 'button', class: t[3] || null, title: t[2] ? t[0] + ' (' + t[2] + ')' : t[0] }, t[0]);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });   // 누르는 동안 쓰던 자리를 잃지 않게
      b.addEventListener('click', function () { t[1](); });
      return b;
    }));
    var el = h('div', { class: 'ed' }, bar, linkBar, area, foot, picker);

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
      if (document.activeElement !== area) area.focus({ preventScroll: true });
      sel.removeAllRanges(); sel.addRange(r);
    }
    document.addEventListener('selectionchange', keep);

    function exec(cmd, val) { restore(); document.execCommand(cmd, false, val === undefined ? null : val); changed(); }
    function block(tag) { exec('formatBlock', '<' + tag + '>'); }
    function quote() {
      restore();
      var sel = window.getSelection(), node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      var bq = node && (node.nodeType === 1 ? node : node.parentNode).closest('blockquote');
      if (bq && inArea(bq)) { unwrap(bq); changed(); } else block('blockquote');
    }

    // ---- 링크
    function openLink() { keep(); linkBar.hidden = false; linkIn.value = ''; linkIn.focus(); }
    function closeLink(back) { linkBar.hidden = true; if (back) restore(); }
    function putLink() {
      var u = linkIn.value.trim();
      if (!/^(https?:\/\/|mailto:)\S+$/i.test(u)) { say('링크는 https:// 로 시작하는 주소로 적어 주세요.', 'error'); linkIn.focus(); return; }
      closeLink(true);
      var sel = window.getSelection();
      if (sel.rangeCount && !sel.getRangeAt(0).collapsed) document.execCommand('createLink', false, u);
      else document.execCommand('insertHTML', false, '<a href="' + escAttr(u) + '">' + escAttr(u) + '</a>&nbsp;');
      changed();
    }
    linkIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); putLink(); }
      if (e.key === 'Escape') { e.preventDefault(); closeLink(true); }
    });

    // ---- 그림 넣기(붙여 넣기 · 끌어다 놓기 · 고르기 모두 여기로)
    function newPath(ext) { return opts.me + '/' + crypto.randomUUID() + '.' + ext; }
    function isImage(f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name || ''); }
    async function addImages(files, range) {
      var list = Array.prototype.filter.call(files, isImage);
      if (!list.length) return;
      busy++; changed();
      say(list.length + '장을 줄이는 중…');
      var html = '', errors = [];
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
          html += '<p><img src="' + escAttr(url) + '" alt="' + escAttr(alt) + '" data-lab-path="' + escAttr(path) + '"></p>';
        } catch (e) { errors.push(L.errText(e)); }
      }
      busy--;
      if (html) {
        if (range) { var sel = window.getSelection(); area.focus(); sel.removeAllRanges(); sel.addRange(range); } else restore();
        document.execCommand('insertHTML', false, html + '<p><br></p>');
      }
      changed();
      if (errors.length) say(errors.join(' / '), 'error');
      else say('그림을 넣었습니다. 긴 변 1600px 로 줄였고 사진 속 위치 정보는 지웠습니다. 글을 저장할 때 올라갑니다.', 'ok');
    }
    picker.addEventListener('change', function () { addImages(picker.files); picker.value = ''; });

    // ---- 붙여 넣기: 그림만 있으면 그림으로, 글이 있으면 모양을 거른 글로(그림은 따로 넣게 알림)
    area.addEventListener('paste', function (e) {
      var cd = e.clipboardData;
      if (!cd) return;
      var files = Array.prototype.filter.call(cd.files || [], isImage);
      var html = cd.getData('text/html'), text = cd.getData('text/plain');
      var hasText = (text || '').replace(/\s/g, '').length > 0;
      if (files.length && (!hasText || (/<img/i.test(html) && text.trim().length < 20))) {
        e.preventDefault(); keep(); addImages(files); return;
      }
      if (html) {
        e.preventDefault();
        var frag = window.DOMPurify.sanitize(html, PASTE);
        var dropped = tidyPasted(frag, function (p) { return urls[p]; });
        var box = document.createElement('div'); box.appendChild(frag);
        document.execCommand('insertHTML', false, box.innerHTML);
        changed();
        if (dropped) say('붙여 넣은 글 속 그림 ' + dropped + '개는 뺐습니다. 그림은 그림만 복사해서 붙여 넣거나 \'그림\' 단추로 넣어 주세요.', 'error');
        return;
      }
      if (text) { e.preventDefault(); document.execCommand('insertText', false, text); changed(); }
    });

    // ---- 끌어다 놓기: 그림은 놓은 자리에, 다른 파일은 첨부 칸으로
    area.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) { e.preventDefault(); el.classList.add('is-drop'); }
    });
    area.addEventListener('dragleave', function () { el.classList.remove('is-drop'); });
    area.addEventListener('drop', function (e) {
      el.classList.remove('is-drop');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault();
      var range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      var imgs = Array.prototype.filter.call(files, isImage), rest = Array.prototype.filter.call(files, function (f) { return !isImage(f); });
      if (imgs.length) addImages(imgs, range && inArea(range.startContainer) ? range : null);
      if (rest.length) {
        if (opts.onFiles) opts.onFiles(rest);
        else say('이 게시판에는 파일을 붙일 수 없습니다. 그림만 넣을 수 있습니다.', 'error');
      }
    });

    // ---- 그림을 누르면 고른 것으로(지우기 키로 뺄 수 있게)
    area.addEventListener('click', function (e) {
      Array.prototype.forEach.call(area.querySelectorAll('img.is-picked'), function (i) { i.classList.remove('is-picked'); });
      if (e.target.tagName === 'IMG') {
        e.target.classList.add('is-picked');
        var r = document.createRange(); r.selectNode(e.target);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
    });

    area.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openLink(); }
      if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (opts.onSave) opts.onSave(); }
    });
    area.addEventListener('input', changed);

    var dirty = false;
    function changed() {
      var empty = !area.textContent.trim() && !area.querySelector('img, hr, table');
      area.classList.toggle('is-empty', empty);
      dirty = true;
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
      if (!area.firstChild) area.appendChild(h('p', {}, h('br')));
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
      uploaded: function (paths) { paths.forEach(function (p) { delete pending[p]; }); },
      busy: function () { return busy > 0; },
      isDirty: function () { return dirty; },
      clean: function () { dirty = false; },
      isEmpty: function () { return area.classList.contains('is-empty'); },
      say: say,
      focus: function () { area.focus(); }
    };
  }

  window.LabEditor = { create: create, toMarkdown: toMarkdown };
})();
