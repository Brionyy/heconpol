// 모든 화면이 쓰는 작은 동작: 좁은 화면 메뉴, 아래 메뉴 열기, 첫 화면 사진 넘기기, 옛 주소 넘기기.
// 이 파일은 회원 칸 서버를 부르지 않는다.
(function () {
  'use strict';

  function pageData() {
    var el = document.getElementById('page-data');
    if (!el) return {};
    try { return JSON.parse(el.textContent); } catch (e) { return {}; }
  }

  // 옛 주소(heconpol.org/?page_id=57 등)로 들어오면 새 화면으로 보낸다.
  function redirectOld(data) {
    if (!data.redirects) return false;
    var q = new URLSearchParams(location.search);
    var id = q.get('page_id');
    if (!id && !q.get('p') && !q.get('cat') && !q.get('feed')) return false;
    var to = (id && data.redirects[id]) || '/';
    if (!/^\/(?!\/)/.test(to)) to = '/';
    var dest = (data.base || '') + to;
    if (dest === location.pathname && !location.search) return false;
    location.replace(dest);
    return true;
  }

  function setupMenu() {
    var hdr = document.querySelector('.hdr');
    var btn = document.querySelector('.menu-btn');
    if (btn && hdr) {
      btn.addEventListener('click', function () {
        var open = hdr.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    document.querySelectorAll('.sub-toggle').forEach(function (t) {
      t.addEventListener('click', function () {
        var li = t.closest('.has-sub');
        var open = li.classList.toggle('is-open');
        t.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.has-sub.is-open').forEach(function (li) {
        li.classList.remove('is-open');
        var t = li.querySelector('.sub-toggle');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function setupSlides() {
    var hero = document.querySelector('.hero');
    if (!hero) return;
    var slides = Array.prototype.slice.call(hero.querySelectorAll('.slide'));
    if (slides.length < 2) return;
    var now = hero.querySelector('.count-now');
    var bar = hero.querySelector('.count-bar');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var idx = 0, timer = null, hovering = false;
    var step = 80 / Math.max(slides.length - 1, 1);

    function show(n) {
      idx = (n + slides.length) % slides.length;
      slides.forEach(function (s, i) {
        var on = i === idx;
        s.classList.toggle('is-on', on);
        if (on) { s.removeAttribute('aria-hidden'); s.removeAttribute('inert'); }
        else { s.setAttribute('aria-hidden', 'true'); s.setAttribute('inert', ''); }
      });
      if (now) now.textContent = String(idx + 1).padStart(2, '0');
      if (bar) bar.style.transform = 'translateX(' + (idx * step) + 'px)';
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      stop();
      if (reduce || hovering || document.hidden) return;
      timer = setInterval(function () { show(idx + 1); }, 7000);
    }
    hero.querySelectorAll('[data-slide]').forEach(function (b) {
      b.addEventListener('click', function () { show(idx + Number(b.getAttribute('data-slide'))); start(); });
    });
    hero.addEventListener('mouseenter', function () { hovering = true; stop(); });
    hero.addEventListener('mouseleave', function () { hovering = false; start(); });
    hero.addEventListener('focusin', function () { hovering = true; stop(); });
    hero.addEventListener('focusout', function () { hovering = false; start(); });
    document.addEventListener('visibilitychange', start);
    show(0);
    start();
  }

  var data = pageData();
  if (redirectOld(data)) return;
  document.addEventListener('DOMContentLoaded', function () {
    setupMenu();
    setupSlides();
  });
})();
