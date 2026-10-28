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
    return '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.';
  }
  function userError(msg) { var e = new Error(msg); e.userMessage = msg; return e; }

  // 로그인과 등급을 확인한다. need: 'member' | 'admin'
  async function guard(api, need) {
    var s = await api.session();
    if (!s) {
      location.replace(url('/login/') + '?next=' + encodeURIComponent(location.pathname.replace(cfg.base || '', '') + location.search));
      return null;
    }
    var role = s.user.role;
    if (role === 'pending') {
      clear();
      append(root, notice('가입 신청을 받았습니다. 관리자가 승인하면 회원 칸을 쓸 수 있습니다.'));
      append(root, h('p', {}, h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { api.signOut().then(function () { location.replace(url('/')); }); } }, '로그아웃')));
      setStatus('');
      return null;
    }
    if (s.user.status === 'locked') {
      clear();
      append(root, notice('잠긴 계정입니다. 관리자에게 문의해 주세요.', 'error'));
      setStatus('');
      return null;
    }
    if (need === 'admin' && role !== 'admin') {
      clear();
      append(root, notice('관리자만 볼 수 있는 화면입니다.', 'error'));
      setStatus('');
      return null;
    }
    return s;
  }

  // 게시판 화면 주소(2026-10-27부터 게시판마다 /board/<주소 이름>/, 머리 메뉴 '게시판 ▾'에서 열림)
  function boardPath(b) { return '/board/' + encodeURIComponent(b.slug) + '/'; }

  // 회원 칸 위쪽: 누구인지, 내 화면들(회원 칸 · 내 정보 · 관리), 로그아웃. 게시판은 머리 메뉴로 다니므로 여기에 두지 않는다.
  // current 가 'board' 이면(게시판 화면) 이름 · 로그아웃 줄만.
  function topBar(api, s, current) {
    var bar = h('div', { class: 'lab-top' },
      h('span', { class: 'lab-who' }, s.user.display_name + ' 님' + (s.user.role === 'admin' ? ' (관리자)' : '')),
      current === 'board' ? h('a', { class: 'lab-mine', href: '/lab/' }, '내 글 · 임시저장') : null,
      h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { api.signOut().then(function () { location.replace(url('/')); }); } }, '로그아웃'));
    if (current === 'board') return [fakeBadge(), bar];
    var tabs = [h('li', {}, h('a', { href: '/lab/', 'aria-current': current === 'home' ? 'page' : null }, '내 글 · 임시저장'))];
    tabs.push(h('li', {}, h('a', { href: '/lab/me/', 'aria-current': current === 'me' ? 'page' : null }, '내 정보')));
    if (s.user.role === 'admin') tabs.push(h('li', {}, h('a', { href: '/lab/admin/', 'aria-current': current === 'admin' ? 'page' : null }, '관리')));
    return [fakeBadge(), bar, h('ul', { class: 'lab-tabs' }, tabs)];
  }

  function fakeBadge() {
    return cfg.backend === 'fake' ? h('p', { class: 'fake-badge' }, '시험용 가짜 로그인: 이 컴퓨터 브라우저에만 저장되고 바깥으로 아무것도 보내지 않습니다.') : null;
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

  window.Lab = {
    cfg: cfg, url: url, safeNext: safeNext, h: h, append: append, params: params, fmtDate: fmtDate, fmtSize: fmtSize,
    pageData: pageData, setStatus: setStatus, notice: notice, clear: clear, errText: errText, userError: userError,
    guard: guard, topBar: topBar, fakeBadge: fakeBadge, boardBySlug: boardBySlug, boardPath: boardPath, start: start,
    root: function () { return root; }
  };
})();
