// 회원 칸 공통: 틀 막기, 서버 고르기, 화면 조각 만들기, 로그인 확인.
// 화면에 글을 넣을 때는 textContent 만 쓴다. 꾸민 글(게시글 본문)은 render.js 가 거른 조각만 넣는다.
(function () {
  'use strict';

  // 남의 사이트가 우리 화면을 몰래 틀에 넣으면 화면을 비운다(<meta>로는 frame-ancestors 를 못 건다).
  if (window.top !== window.self) {
    document.documentElement.textContent = '';
    window.LAB_BLOCKED = true;
    return;
  }

  var cfg = window.LAB_CONFIG || { backend: 'none', base: '' };

  function pickApi() {
    if (cfg.backend === 'fake') return window.LabFakeApi || null;
    if (cfg.backend === 'supabase') return window.LabSupabaseApi || null;
    return null;
  }

  // 같은 사이트 안 주소만 만든다.
  function url(path) {
    if (typeof path !== 'string' || !/^\/(?!\/)/.test(path)) path = '/';
    return (cfg.base || '') + path;
  }

  // 로그인 뒤 돌아갈 곳: '/'로 시작하는 같은 사이트 길만 허락한다.
  function safeNext(raw, fallback) {
    if (typeof raw === 'string' && /^\/(?!\/)[^\\\s]*$/.test(raw) && raw.indexOf('//') === -1) return raw;
    return fallback || '/lab/';
  }

  // h('a', {href: '/lab/', class: 'btn'}, '글자', 다른조각...)
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'href') el.setAttribute('href', /^\/(?!\/)/.test(v) ? url(v) : '#');
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }

  function pageData() {
    var el = document.getElementById('page-data');
    try { return el ? JSON.parse(el.textContent) : {}; } catch (e) { return {}; }
  }

  function params() { return new URLSearchParams(location.search); }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtSize(n) {
    if (n < 1024) return n + 'B';
    if (n < 1048576) return Math.round(n / 1024) + 'KB';
    return (n / 1048576).toFixed(1) + 'MB';
  }

  var root, status;
  function setStatus(msg, isError) {
    if (!status) return;
    status.textContent = msg || '';
    status.classList.toggle('is-error', !!isError);
  }
  function notice(msg, kind) { return h('p', { class: 'notice' + (kind ? ' is-' + kind : ''), role: kind === 'error' ? 'alert' : null }, msg); }
  function clear() { while (root.firstChild) root.removeChild(root.firstChild); }

  // 오류 글은 사람이 읽을 말로만 보인다(서버 원문은 개발 도구 기록에만).
  function errText(e) {
    if (e && e.userMessage) return e.userMessage;
    if (window.console) console.warn(e);
    return '처리하지 못했습니다. 잠시 뒤 다시 해 주십시오.';
  }
  function userError(msg) { var e = new Error(msg); e.userMessage = msg; return e; }

  // 로그인과 등급을 확인한다. need: 'member' | 'admin'
  async function guard(api, need) {
    var s = await api.session();
    // 이 컴퓨터 미리 보기에서만: 로그인 안 했으면 '시험회원'으로, 관리 화면이면 '시험관리자'로 보여 준다(10-28 연구자: 관리 화면도
    // 바로 확인할 수 있게). 미리 보기가 자동으로 넣은 '시험회원'으로 관리 화면에 오면 '시험관리자'로 바꾼다. 진짜 서버에는 이 기능이 없다.
    var preview = cfg.previewOpen && cfg.backend === 'fake' && api.previewSignIn;
    if (preview && (!s || (need === 'admin' && s.user.role !== 'admin' && api.isPreviewSession && api.isPreviewSession()))) {
      s = (await api.previewSignIn(need === 'admin' ? 'admin' : 'member')) || s;
    }
    if (!s) {
      location.replace(url('/login/') + '?next=' + encodeURIComponent(location.pathname.replace(cfg.base || '', '') + location.search));
      return null;
    }
    var role = s.user.role;
    // 시안 A3: 막힌 화면(승인 대기 · 잠김 · 관리자만)은 가운데 판 하나(표시 · 마루 부리 제목 · 풀이 · 할 수 있는 일 단추)
    if (role === 'pending') {
      clear();
      append(root, [fakeBadge(), gate('wait', '가입 신청을 받았습니다', '관리자가 승인하면 회원 칸을 쓸 수 있습니다.',
        [h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { api.signOut().then(function () { location.replace(url('/')); }); } }, '로그아웃')])]);
      setStatus('');
      return null;
    }
    if (s.user.status === 'locked') {
      clear();
      append(root, [fakeBadge(), gate('error', '잠긴 계정입니다', '관리자에게 문의해 주십시오.', null)]);
      setStatus('');
      return null;
    }
    if (need === 'admin' && role !== 'admin') {
      clear();
      append(root, [fakeBadge(), gate('error', '관리자만 볼 수 있는 화면입니다', '', [
        // 미리 보기에서만: 직접 로그인한 회원이어도 단추 하나로 '시험관리자'가 되어 관리 화면을 볼 수 있게(10-28)
        preview ? h('button', { type: 'button', class: 'btn', onclick: function () {
          api.previewSignIn('admin', true).then(function () { location.reload(); });
        } }, '시험관리자로 바꿔 보기(미리 보기)') : null,
        h('a', { class: 'btn btn-ghost', href: '/lab/' }, '회원 칸으로')])]);
      setStatus('');
      return null;
    }
    return s;
  }
  function gate(kind, title, body, acts) {
    return h('section', { class: 'm-gate is-' + kind, role: kind === 'error' ? 'alert' : 'status' },
      h('span', { class: 'm-gate-mark', 'aria-hidden': 'true' }),
      h('h2', { class: 'm-gate-h' }, title), body ? h('p', { class: 'm-gate-b' }, body) : null,
      acts ? h('div', { class: 'btns' }, acts) : null);
  }

  // 시안 A3: 카드 위 마우스 빛 · 테두리 빛(취향 장부 13 · 14). 마우스를 따라 옅은 빛이 움직이고 그쪽 테두리만 금빛.
  // 보안 설정은 style 속성 글을 막지만 CSSOM(el.style.setProperty)은 된다. 마우스가 없는 기기에서는 붙이지 않음
  function glow(el) {
    if (!el || !window.matchMedia || !matchMedia('(hover: hover)').matches) return el;
    el.classList.add('has-glow');
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    return el;
  }
  // 시안 A3: 탭 표시 미끄러짐(16). 화면을 다시 불러오므로 앞 화면의 표시 자리를 브라우저 저장에 두었다가 거기서 지금 자리로 미끄러진다
  function slideMark(list, key) {
    if (!list) return;
    var cur = list.querySelector('[aria-current="page"]');
    if (!cur) return;
    var mark = list.querySelector(':scope > .m-mark');
    if (!mark) { mark = h('li', { class: 'm-mark', 'aria-hidden': 'true', role: 'presentation' }); list.insertBefore(mark, list.firstChild); }
    function box() { var a = cur.getBoundingClientRect(), b = list.getBoundingClientRect(); return { x: a.left - b.left + list.scrollLeft, y: a.top - b.top + list.scrollTop, w: a.width, h: a.height }; }
    function put(r) { mark.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px)'; mark.style.width = r.w + 'px'; mark.style.height = r.h + 'px'; }
    var now = box(), prev = null;
    try { prev = JSON.parse(sessionStorage.getItem('labMark.' + key) || 'null'); sessionStorage.setItem('labMark.' + key, JSON.stringify(now)); } catch (e) { /* 없어도 됨 */ }
    if (prev && (prev.x !== now.x || prev.y !== now.y) && !reduced()) {
      mark.classList.add('no-anim'); put(prev); void mark.offsetWidth; mark.classList.remove('no-anim');
    }
    put(now);
    window.addEventListener('resize', function () { mark.classList.add('no-anim'); put(box()); });
  }

  // 게시판 화면 주소(2026-10-27부터 게시판마다 /board/<주소 이름>/, 머리 메뉴 '게시판 ▾'에서 열림)
  function boardPath(b) { return '/board/' + encodeURIComponent(b.slug) + '/'; }

  // 회원 칸 위쪽: 누구인지, 내 화면들(회원 칸 · 내 정보 · 관리), 로그아웃. 게시판은 머리 메뉴로 다니므로 여기에 두지 않는다.
  // current 가 'board' 이면(게시판 화면) 이름 · 로그아웃 줄만.
  // 시안 A(남색 안내 데스크): 게시판 밖 회원 칸은 왼쪽 남색 세로 판(누구인지 · 길 찾기 · 로그아웃) + 오른쪽 종이 작업면.
  // 관리 화면은 세로 판의 빈 자리(.lab-rail-admin)에 관리 탭을 넣는다(admin.js). 휴대폰 · 좁은 화면에서는 맨 위 남색 줄로 접힌다.
  function signOutBtn(api, cls) {
    return h('button', { type: 'button', class: 'btn btn-small ' + cls, onclick: function () { api.signOut().then(function () { location.replace(url('/')); }); } }, '로그아웃');
  }
  function topBar(api, s, current) {
    if (current === 'board') {
      var bar = h('div', { class: 'lab-top' },
        h('span', { class: 'lab-who' }, s.user.display_name + ' 님' + (s.user.role === 'admin' ? ' (관리자)' : '')),
        h('a', { class: 'lab-mine', href: '/lab/' }, '내 글 · 임시저장'),
        signOutBtn(api, 'btn-ghost'));
      return [fakeBadge(), bar];
    }
    var wrap = document.querySelector('[data-lab-page]');
    if (wrap) wrap.classList.add('lab-has-rail');
    var items = [['home', '/lab/', '내 글 · 임시저장'], ['me', '/lab/me/', '내 정보']];
    if (s.user.role === 'admin') items.push(['admin', '/lab/admin/', '관리']);
    // 시안 A3: 이름 앞에 첫 글자 동그라미(얼굴), 등급은 점 붙은 알약, 지금 위치는 옅은 알약이 앞 화면 자리에서 미끄러져 옴
    var navList = h('ul', {}, items.map(function (x) {
      return h('li', {}, h('a', { href: x[1], 'aria-current': current === x[0] ? 'page' : null }, x[2]));
    }));
    var rail = h('aside', { class: 'lab-rail', 'aria-label': '회원 칸 길 찾기' },
      h('div', { class: 'lab-rail-in' },
        h('div', { class: 'rail-who' },
          h('span', { class: 'rail-face', 'aria-hidden': 'true' }, (s.user.display_name || '?').slice(0, 1)),
          h('div', { class: 'rail-who-t' }, h('p', { class: 'rail-who-name' }, s.user.display_name + ' 님'),
            h('p', { class: 'rail-who-role' }, h('span', { class: 'm-pill ' + (s.user.role === 'admin' ? 'is-gold' : 'is-ok') }, s.user.role === 'admin' ? '관리자' : '회원')))),
        h('nav', { class: 'rail-nav', 'aria-label': '회원 칸' }, navList),
        h('div', { class: 'lab-rail-admin' }),
        h('div', { class: 'rail-foot' }, signOutBtn(api, 'btn-on-navy'))));
    requestAnimationFrame(function () { slideMark(navList, 'rail'); });
    return [rail, fakeBadge()];
  }

  function fakeBadge() {
    if (cfg.backend !== 'fake') return null;
    return h('p', { class: 'fake-badge' }, h('b', { class: 'fake-tag' }, '미리 보기'), h('b', {}, '시험용 가짜 로그인'), ' 이 컴퓨터 브라우저에만 저장되고 바깥으로 아무것도 보내지 않습니다.' +
      (cfg.previewOpen ? ' 미리 보기라 로그인하지 않아도 회원 칸은 \'시험회원\', 관리 화면은 \'시험관리자\'로 보입니다(로그아웃하면 이 브라우저에서는 로그인 화면으로 돌아감). ' : ''),
      cfg.previewOpen && location.pathname.replace(cfg.base || '', '').indexOf('/lab/admin/') !== 0 ? h('a', { href: '/lab/admin/' }, '관리 화면 보기') : null);
  }

  function boardBySlug(slug) {
    return (pageData().boards || []).filter(function (b) { return b.slug === slug; })[0] || null;
  }

  function start(pages) {
    if (window.LAB_BLOCKED) return;
    var wrap = document.querySelector('[data-lab-page]');
    if (!wrap) return;
    root = wrap.querySelector('.lab-root');
    status = wrap.querySelector('.lab-status');
    var name = wrap.getAttribute('data-lab-page');
    var api = pickApi();
    if (!api) {
      setStatus('');
      append(root, notice('회원 칸은 준비 중입니다. 새 사이트 공개 뒤에 열립니다.'));
      return;
    }
    var fn = pages[name];
    if (!fn) return;
    Promise.resolve().then(function () { return fn(api); }).catch(function (e) {
      setStatus(errText(e), true);
    });
  }

  // ---------------------------------------------------------------- 시안 A3: 취향 장부(design/TASTE.md 9절)의 공통 일 부품
  // 10-28 연구자: "내 취향을 상당히 많이 넣어놨는데 결국에는 그냥 claude가 만들어주는 디자인이랑 비슷한 거같아서".
  // 되돌리기 알림(185 "굉장히 굳굳굳") · 확인 창(177~181, 브라우저 기본 확인 창 대신) · 숫자 굴러가기(15 · 217) · 대기 → 진행 → 체크(22)
  function reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

  // 되돌리기 알림: 화면 아래에 쌓이고 8초 뒤 걷힘, 마우스를 올리면 멈춤. opt = { kind: 'ok'|'error', undo: async fn, undoLabel, ms }
  var toastBox = null;
  function toast(msg, opt) {
    opt = opt || {};
    if (!toastBox) { toastBox = h('div', { class: 'toasts' }); document.body.appendChild(toastBox); }
    var undo = opt.undo ? h('button', { type: 'button', class: 'toast-undo' }, opt.undoLabel || '되돌리기') : null;
    var close = h('button', { type: 'button', class: 'toast-x', 'aria-label': '알림 닫기' });
    var el = h('div', { class: 'toast' + (opt.kind ? ' is-' + opt.kind : ''), role: opt.kind === 'error' ? 'alert' : 'status' },
      h('span', { class: 'toast-dot', 'aria-hidden': 'true' }), h('p', {}, msg), undo, close);
    var timer = null, left = opt.ms || 8000, began = 0;
    function bye() { clearTimeout(timer); el.classList.add('is-out'); setTimeout(function () { el.remove(); }, reduced() ? 0 : 220); }
    function run() { began = Date.now(); timer = setTimeout(bye, left); }
    el.addEventListener('mouseenter', function () { clearTimeout(timer); left = Math.max(1500, left - (Date.now() - began)); });
    el.addEventListener('mouseleave', run);
    el.addEventListener('focusin', function () { clearTimeout(timer); });
    close.addEventListener('click', bye);
    if (undo) undo.addEventListener('click', async function () {
      undo.disabled = true;
      try { await opt.undo(); bye(); } catch (e) { undo.disabled = false; toast(errText(e), { kind: 'error' }); }
    });
    toastBox.appendChild(el);
    run();
    return el;
  }
  // 다시 불러온 뒤에 띄울 알림(되돌리기 단추가 있으면 그 기록 번호도 함께). admin.js 의 flash 를 이것으로 바꿔 쓴다
  function toastLater(msg, undoLogId) {
    try { sessionStorage.setItem('labToast', JSON.stringify({ msg: msg, undo: undoLogId || null })); } catch (e) { /* 없어도 됨 */ }
  }
  function toastPending(api) {
    var x = null;
    try { x = JSON.parse(sessionStorage.getItem('labToast') || 'null'); sessionStorage.removeItem('labToast'); } catch (e) { return; }
    if (!x || !x.msg) return;
    toast(x.msg, { kind: 'ok', undo: x.undo && api && api.siteUndo ? async function () {
      await api.siteUndo(x.undo);
      toastLater('되돌렸습니다.');
      location.reload();
    } : null });
  }

  // 확인 창(되돌릴 수 없는 일에만): 브라우저 기본 확인 창 대신. o = { title, body, ok, danger } → Promise<boolean>. Esc · 바깥 = 그만두기
  function ask(o) {
    return new Promise(function (resolve) {
      var okBtn = h('button', { type: 'button', class: 'btn' + (o.danger ? ' btn-danger' : '') }, o.ok || '확인');
      var no = h('button', { type: 'button', class: 'btn btn-ghost' }, o.cancel || '그만두기');
      var dlg = h('dialog', { class: 'ask', 'aria-labelledby': 'ask-h' },
        h('h2', { id: 'ask-h', class: 'ask-h' }, o.title), o.body ? h('p', { class: 'ask-b' }, o.body) : null,
        h('div', { class: 'btns ask-btns' }, no, okBtn));
      var settled = false;
      function done(v) { if (settled) return; settled = true; dlg.close(); dlg.remove(); resolve(v); }
      okBtn.addEventListener('click', function () { done(true); });
      no.addEventListener('click', function () { done(false); });
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      dlg.addEventListener('click', function (e) { if (e.target === dlg) done(false); });
      document.body.appendChild(dlg);
      dlg.showModal();
      no.focus();
    });
  }

  // 숫자 굴러가기: 화면이 열릴 때 한 번 0 → n(0.6초). '동작 줄이기'면 바로
  function countUp(el, n) {
    n = Number(n) || 0;
    if (reduced() || n < 2) { el.textContent = String(n); return el; }
    var t0 = null;
    function step(t) { if (t0 === null) t0 = t; var p = Math.min(1, (t - t0) / 600); el.textContent = String(Math.round(n * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); }
    el.textContent = '0';
    requestAnimationFrame(step);
    return el;
  }

  // 단추 상태 한 벌(대기 → 진행 → 체크): state = 'run'(점 셋이 숨 쉼, 못 누름) · 'done'(체크가 그려지고 1.6초 뒤 처음으로) · null
  function btnState(btn, state) {
    if (!btn) return;
    btn.classList.remove('is-run', 'is-done');
    btn.removeAttribute('aria-busy');
    btn.disabled = state === 'run';
    if (state === 'run') { btn.classList.add('is-run'); btn.setAttribute('aria-busy', 'true'); }
    if (state === 'done') { btn.classList.add('is-done'); setTimeout(function () { btn.classList.remove('is-done'); }, 1600); }
  }

  // 관심 분야 키워드(11-02 저녁, 연구자: "키워드를 몇 개 작성해서 보내는 거임 최대 뭐 5개...?근데 optional인 것을 명시하고").
  // 표 '관심 분야' 칸에는 ' · '로 이어 넣는다. 예전 글(쉼표로 나눈 것)도 같은 키워드 목록으로 읽는다(build.py keywords 와 같음)
  var KW = { max: 5, len: 30, sep: ' · ' };
  function keywords(text) {
    var seen = {}, out = [];
    String(text || '').split(/[,，·・;\r\n]+/).forEach(function (w) {
      w = w.replace(/\s+/g, ' ').trim();
      var k = w.toLowerCase();
      if (w && !seen[k]) { seen[k] = true; out.push(w); }
    });
    return out;
  }
  // 틀리면 사람이 읽을 까닭, 맞으면 null(미리 보기 서버 · 서버 규칙과 같은 조건)
  function checkKeywords(list) {
    if (list.length > KW.max) return '키워드는 ' + KW.max + '개까지 보낼 수 있습니다.';
    for (var i = 0; i < list.length; i++) {
      if (list[i].length > KW.len) return '\'' + list[i].slice(0, 12) + '…\' 키워드가 깁니다. 키워드 하나는 ' + KW.len + '자까지입니다.';
    }
    return null;
  }
  // 키워드를 낱말마다 나눠 보이기(구성원 화면과 같은 모양)
  function keywordList(text) {
    var list = keywords(text);
    return list.length ? h('ul', { class: 'kws' }, list.map(function (w) { return h('li', {}, w); })) : null;
  }
  // 키워드 칸: 하나씩 적고 Enter(또는 쉼표 · [더하기])로 알약을 쌓는다. 알약의 ×로 뺀다. get() 은 칸에 남은 글까지 더한 목록
  function keywordInput(list, o) {
    o = o || {};
    var items = keywords((list || []).join(','));
    var ph = o.placeholder || '예: 건강보험';
    var pills = h('ul', { class: 'kw-pills', 'aria-label': o.label || '키워드' });
    var inp = h('input', { type: 'text', maxlength: KW.len, autocomplete: 'off', placeholder: ph, 'aria-label': (o.label || '키워드') + ' 적기' });
    var add = h('button', { type: 'button', class: 'btn btn-ghost btn-small' }, '더하기');
    var count = h('span', { class: 'kw-count num' });
    var msg = h('p', { class: 'kw-msg', 'aria-live': 'polite' });
    function draw() {
      pills.replaceChildren.apply(pills, items.map(function (w, i) {
        var x = h('button', { type: 'button', class: 'kw-x', 'aria-label': w + ' 빼기' }, '×');
        x.addEventListener('click', function () { items.splice(i, 1); msg.textContent = ''; draw(); inp.focus(); });
        return h('li', {}, h('span', {}, w), x);
      }));
      pills.hidden = !items.length;
      count.textContent = items.length + ' / ' + KW.max;
      var full = items.length >= KW.max;
      inp.disabled = full; add.disabled = full;
      inp.placeholder = full ? '모두 채움' : ph;
      if (o.onChange) o.onChange(items.slice());   // 11-13: 내 정보의 '요청한 모습' 미리 보기가 따라 바뀜
    }
    // 적은 글을 키워드로 넣는다. 넣었으면 true
    function take(text) {
      var seen = {};
      items.forEach(function (w) { seen[w.toLowerCase()] = true; });
      var more = keywords(text).filter(function (w) { return !seen[w.toLowerCase()]; });
      if (!more.length) return true;
      var bad = checkKeywords(items.concat(more));
      if (bad) { msg.textContent = bad; return false; }
      items = items.concat(more); msg.textContent = ''; draw();
      return true;
    }
    inp.addEventListener('keydown', function (e) {
      // 한글을 조합하는 중의 Enter 는 글자를 마치는 것이라 넘긴다
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); if (take(inp.value)) inp.value = ''; }
      else if (e.key === 'Backspace' && !inp.value && items.length) { items.pop(); draw(); }
    });
    inp.addEventListener('input', function () {
      msg.textContent = '';
      if (/[,，·・;]/.test(inp.value)) {
        var parts = inp.value.split(/[,，·・;]/), last = parts.pop();
        if (take(parts.join(','))) inp.value = last.replace(/^\s+/, '');
      }
    });
    add.addEventListener('click', function () { if (take(inp.value)) inp.value = ''; inp.focus(); });
    draw();
    return {
      el: h('div', { class: 'kw-input' }, pills, h('div', { class: 'kw-row' }, inp, add, count), msg),
      input: inp,
      // 칸에 남은 글도 키워드로 넣은 뒤의 목록. 넣지 못하면(개수 · 길이) 오류
      get: function () {
        if (inp.value.trim() && !take(inp.value)) throw userError(msg.textContent);
        inp.value = '';
        return items.slice();
      }
    };
  }

  window.Lab = {
    kw: KW, keywords: keywords, checkKeywords: checkKeywords, keywordList: keywordList, keywordInput: keywordInput,
    cfg: cfg, url: url, safeNext: safeNext, h: h, append: append, params: params, fmtDate: fmtDate, fmtSize: fmtSize,
    pageData: pageData, setStatus: setStatus, notice: notice, clear: clear, errText: errText, userError: userError,
    guard: guard, topBar: topBar, fakeBadge: fakeBadge, boardBySlug: boardBySlug, boardPath: boardPath, start: start,
    toast: toast, toastLater: toastLater, toastPending: toastPending, ask: ask, countUp: countUp, btnState: btnState, reduced: reduced,
    root: function () { return root; }
  };
  // 시안 A3(회원 쪽이 더함): 마우스 빛 · 탭 표시 미끄러짐. 관리 화면에서도 쓸 수 있다(L.glow(카드), L.slideMark(ul, '열쇠'))
  window.Lab.glow = glow;
  window.Lab.slideMark = slideMark;
})();
