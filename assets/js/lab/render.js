// 회원이 쓴 글(마크다운)을 화면 조각으로 바꾸고 반드시 거른다(2_보안검토.md 3.1).
// marked 는 거르지 않으므로 DOMPurify 를 꼭 거친다. 결과는 조각(DocumentFragment)으로 돌려줘 innerHTML 을 쓰지 않는다.
// 본문 그림(2026-10-27)은 우리 사진 칸에 올린 그림만 'lab:<경로>'로 적고, 보여 줄 때 몇 분짜리 주소로 바꾼다.
// 바깥 주소 · data: 그림은 지운다(추적 그림 · 숨은 내용 막기).
(function () {
  'use strict';
  if (window.LAB_BLOCKED) return;
  if (!window.DOMPurify || !window.marked) {
    window.LabRender = null;
    return;
  }

  var LAB_IMG = /^lab:([A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,120})$/;

  var PURIFY = {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'h3', 'h4',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'img'],
    ALLOWED_ATTR: ['href', 'title', 'src', 'alt'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|lab:)/i,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  };

  window.DOMPurify.addHook('afterSanitizeAttributes', function (node) {
    // 링크마다 새 창 · 남에게 정보 안 넘김 표시를 붙인다. lab: 주소는 링크로 쓰지 않는다.
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      if (/^lab:/i.test(node.getAttribute('href'))) { node.removeAttribute('href'); return; }
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    // 그림: lab:<경로> 만 남기고 주소는 data-lab-src 로 옮긴다(브라우저가 lab: 주소를 부르지 않게). 나머지는 지울 표시.
    if (node.tagName === 'IMG') {
      var m = LAB_IMG.exec(node.getAttribute('src') || '');
      node.removeAttribute('src');
      if (!m) { node.setAttribute('data-lab-drop', ''); return; }
      node.setAttribute('data-lab-src', m[1]);
      node.setAttribute('loading', 'lazy');
      if (!node.hasAttribute('alt')) node.setAttribute('alt', '');
    }
  });

  function clean(raw) {
    var frag = window.DOMPurify.sanitize(raw, PURIFY);
    Array.prototype.forEach.call(frag.querySelectorAll('img[data-lab-drop]'), function (img) { img.remove(); });
    return frag;
  }

  // 회원 글의 '# 제목'은 화면 제목과 겹치지 않게 작은 제목으로 낮춘다.
  var renderer = new window.marked.Renderer();
  renderer.heading = function (token) {
    var level = token.depth <= 2 ? 3 : 4;
    return '<h' + level + '>' + this.parser.parseInline(token.tokens) + '</h' + level + '>\n';
  };

  function markdown(src) {
    return clean(window.marked.parse(String(src || ''), { gfm: true, breaks: true, async: false, renderer: renderer }));
  }

  // 옛 사이트(망보드)에서 옮긴 HTML 글: 같은 규칙으로 한 번 더 거른다.
  function legacyHtml(src) {
    return clean(String(src || ''));
  }

  // 화면에 넣은 뒤 본문 그림 주소를 채운다(진짜 서버: 600초짜리 주소, 가짜: 이 브라우저 안 주소).
  function images(root, api) {
    return Promise.all(Array.prototype.map.call(root.querySelectorAll('img[data-lab-src]'), function (img) {
      return api.attachmentUrl({ bucket: 'gallery', path: img.getAttribute('data-lab-src') })
        .then(function (u) { img.src = u; })
        .catch(function () { img.alt = '그림을 불러오지 못했습니다'; img.classList.add('is-broken'); });
    }));
  }

  window.LabRender = { markdown: markdown, legacyHtml: legacyHtml, images: images, config: PURIFY, LAB_IMG: LAB_IMG };
})();
