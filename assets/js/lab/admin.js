// 관리 화면(2026-10-28 2판, 설계서 docs/2026-10-28_plan_관리화면_가입.md). 탭 다섯: 할 일 · 회원 · 사이트 내용 · 관리자 넘기기 · 기록.
// 연구자: "관리자는 나만있는 게 아니라 이후 조교들에게 넘길 것이기 떄문에 사이트 상에서 정보를 수정하는 것이 UI 상으로 편하게".
// 그래서 탭마다 맨 위에 '알아 둘 것'(꼭 필요한 탭만, 11-02)을 두고, 표 파일 대신 칸 · 고르기 · 단추로 고친다.
// 권한은 서버가 막는다(단추를 숨기는 것은 막는 장치가 아님). 글은 모두 textContent 로만 넣는다(L.h).
// 시안 A3(2026-10-28 저녁, 연구자: "내 취향을 상당히 많이 넣어놨는데 결국에는 그냥 claude가 만들어주는 디자인이랑 비슷한 거같아서"):
// 취향 장부(design/TASTE.md 9절)의 일 부품을 넣는다. 되돌리기 알림 185 · 확인 창 177~181 · 숫자 굴러가기 15 · 탭 표시 미끄러짐 16 ·
// 목록 차례로 올라옴 17 · 카드 위 마우스 빛 13 · 테두리 빛 14 · 흐림에서 또렷한 제목 19 · 상태 알약 257 · 259 · 얼굴 · 상태 꼬리표 표 146 ·
// 대기 → 진행 → 체크 22 · 사람 찾기 245. 꾸밈은 a3_admin.css.
(function () {
  'use strict';
  if (window.LAB_BLOCKED || !window.Lab) return;
  var L = window.Lab, h = L.h;

  var TABS = [['todo', '할 일'], ['members', '회원'], ['site', '사이트 내용'], ['handover', '관리자'], ['log', '기록']];
  var KINDS = ['재학', '졸업', '교수', '기타'];
  var METHODS = ['연구실이 아는 번호로 전화', '연구실이 아는 메신저', '교수님 확인', '동기 · 선후배 확인', '직접 만남'];
  var ROLE = { pending: '승인 대기', member: '회원', admin: '관리자' };
  var STATUS = { active: '정상', needs_password: '비밀번호 정하기 전', locked: '잠금' };
  var ROLE_TONE = { pending: 'mute', member: 'navy', admin: 'gold' };
  var STATUS_TONE = { active: 'ok', needs_password: 'warn', locked: 'err' };
  var KIND_TONE = { '재학': 'navy', '졸업': 'gold', '교수': 'ok', '기타': 'mute' };
  var TABLE_ORDER = ['people', 'alumni', 'news', 'projects', 'courses'];
  // 기록 '자세히'의 표 이름(가짜 서버는 표 이름, 서버 도우미는 파일 경로로 돌려줌)
  var FILE_LABEL = { people: '구성원', alumni: '졸업생', news: '소식', projects: '수행연구', courses: '교과목',
    'data/people.csv': '구성원', 'data/alumni.csv': '졸업생', 'data/news.csv': '소식', 'data/projects.csv': '수행연구', 'data/courses.csv': '교과목' };
  var TABLE_HELP = {
    people: ['졸업하면 그 줄의 [더 보기] › [졸업생으로 옮기기].']
  };

  function q(name) { return L.params().get(name); }
  function link(params) { return '/lab/admin/?' + new URLSearchParams(params).toString(); }
  function go(params) { location.assign(L.url(link(params))); }
  function fake() { return L.cfg.backend === 'fake'; }

  // ------------------------------------------------------------ 시안 A3 부품
  // 다시 불러온 뒤 화면 아래 알림(되돌릴 수 있는 사이트 내용 고침이면 기록 번호를 함께 → [되돌리기])
  function flash(t, logId) { L.toastLater(t, logId || null); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, L.reduced() ? 0 : ms); }); }
  // 상태 알약: 색 점 + 낱말(색만으로 구분하지 않음). tone = ok · warn · err · navy · gold · mute
  function pill(text, tone) { return h('span', { class: 'pill is-' + (tone || 'mute') }, text); }
  // 얼굴: 이름 첫 글자 동그라미(사진이 없는 자리). tone 은 등급 · 구분 색
  function face(name, tone, big) { return h('span', { class: 'face' + (tone ? ' is-' + tone : '') + (big ? ' is-lg' : ''), 'aria-hidden': 'true' }, (name || '?').slice(0, 1)); }
  function num(n) { return L.countUp(h('span', { class: 'num-roll' }), n); }
  // 목록 차례로 올라옴(17): 화면이 열릴 때 한 번, 앞 8개까지 40ms 간격(transform · opacity 만)
  function rise(els) {
    Array.prototype.forEach.call(els, function (el, k) { if (k < 8) { el.classList.add('rise'); el.style.setProperty('--i', String(k)); } });
    return els;
  }
  // 카드 위 마우스 빛(13) · 그쪽 테두리만 금빛(14): 마우스 자리를 --mx · --my 로(글자는 움직이지 않음)
  function glow(el) {
    el.classList.add('glow');
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px');
      el.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px');
    });
    return el;
  }
  // 흐림에서 또렷한 제목(19): 화면이 열릴 때 한 번
  function title(tag, cls, kids) { return h(tag, { class: (cls ? cls + ' ' : '') + 'blur-in' }, kids); }

  function helpBox(lines) {
    // 시안 A2: 첫 줄만 보이고 나머지는 눌러 펼침. 이 브라우저에서 그 탭을 처음 열 때만 펼친 채로(안내는 필요할 때 한 번만)
    if (!lines.length) return h('div', { hidden: true });
    var head = [h('span', { class: 'admin-help-h' }, '알아 둘 것'), h('span', { class: 'admin-help-first' }, lines[0])];
    if (lines.length === 1) return h('div', { class: 'admin-help' }, h('p', { class: 'admin-help-sum' }, head));
    var key = 'labHelpSeen.' + lines[0].slice(0, 24), first = false;
    try { first = localStorage.getItem(key) !== '1'; localStorage.setItem(key, '1'); } catch (e) { /* 없어도 됨 */ }
    return h('details', { class: 'admin-help', open: first }, h('summary', { class: 'admin-help-sum' }, head, h('span', { class: 'admin-help-more' }, '더 보기')),
      h('ul', {}, lines.slice(1).map(function (t) { return h('li', {}, t); })));
  }
  // 묶음 머리: 이름 + 건수(숫자는 굴러감)
  function section(name, n, unit, desc) {
    return h('div', { class: 'admin-sec-h' }, h('h3', { class: 'admin-h' }, name, n != null ? h('span', { class: 'cnt' }, num(n), unit || '') : null),
      desc ? h('p', { class: 'muted' }, desc) : null);
  }
  function btn(label, onclick, cls) { return h('button', { type: 'button', class: 'btn btn-small ' + (cls || 'btn-ghost'), onclick: onclick }, label); }

  // 단추 하나의 일: (되돌릴 수 없으면 확인 창) → 하고(점 셋) → 체크 → 다시 불러옴(아래 알림).
  // askOpt = { title, body, ok, danger } 또는 null. undo 가 참이고 서버가 기록 번호를 돌려주면 알림에 [되돌리기]
  function act(ctx, fn, askOpt, okText, undo) {
    return async function (e) {
      var b = e && e.currentTarget;
      if (askOpt && !(await L.ask(askOpt))) return;
      L.btnState(b, 'run');
      try {
        var r = await fn();
        L.btnState(b, 'done');
        if (okText) flash(okText, undo && r && r.log_id ? r.log_id : null);
        await wait(360);
        location.reload();
      } catch (err) {
        L.btnState(b, null);
        showError(ctx, err);
      }
    };
  }
  // 오류: 화면 아래 알림(빨간 점) + 서식 안이면 그 서식 아래 한 줄
  function showError(ctx, err, place) {
    var t = L.errText(err);
    L.toast(t, { kind: 'error' });
    if (place) place.replaceChildren(h('p', { class: 'form-err', role: 'alert' }, t));
  }

  // 메일을 바꾸기 전 '다른 길로 본인 확인' 칸(이름 · 졸업 연도는 졸업생 화면에 공개돼 있어 그것만으로는 확인이 안 됨)
  function verifyFields() {
    var box = h('input', { type: 'checkbox' });
    var how = h('select', {}, h('option', { value: '' }, '확인한 방법 고르기'), METHODS.map(function (m) { return h('option', { value: m }, m); }));
    var el = h('div', { class: 'verify' },
      h('label', { class: 'check' }, box, ' 연구실이 원래 알던 연락처로 본인임을 확인했습니다'),
      h('label', {}, '확인한 방법', how),
      h('p', { class: 'hint' }, '요청에 적힌 번호 · 메일로는 확인하지 않습니다(남이 본인인 척할 수 있음). 이름 · 졸업 연도만으로도 확인하지 않습니다.'));
    return { el: el, method: function () { return box.checked && how.value ? how.value : null; } };
  }
  var VERIFY_MISSING = '연구실이 원래 알던 연락처로 본인임을 확인했다는 칸을 켜고, 확인한 방법을 골라 주십시오.';

  // ------------------------------------------------------------ 시작
  async function admin(api) {
    var s = await L.guard(api, 'admin');
    if (!s) return;
    var root = L.root();
    L.append(root, L.topBar(api, s, 'admin'));
    var me = await api.adminSelf();
    if (!me.mfa) { drawMfa(api, root, me); L.setStatus(''); L.toastPending(api); return; }
    var msg = h('div', { class: 'admin-msg', 'aria-live': 'polite' });
    // 넘겨받은 사람이 2단계 인증으로 들어오면 넘기기를 끝낸다(넘긴 사람은 회원이 됨)
    if (me.incoming && me.incoming.length) {
      var n = await api.finishHandover();
      if (n) L.toast(me.incoming.join(', ') + ' 님에게서 관리자를 넘겨받았습니다. 넘겨준 분은 이제 회원입니다. \'관리자\' 탭 아래의 사이트 밖에서 넘길 것도 챙겨 주십시오.', { kind: 'ok', ms: 14000 });
    }
    var people = await api.adminProfiles();
    var helps = await api.adminHelp();
    var reqs = await api.adminProfileRequests();
    var tab = q('tab') || 'todo';
    var ctx = { api: api, s: s, me: me, people: people, helps: helps, reqs: reqs, msg: msg, root: root };
    // 관리 탭은 왼쪽 남색 세로 판 안에(사이트 내용 안쪽 다섯은 들여 쓴 하위 줄), 작업면 맨 위에는 지금 탭 이름
    var todo = todoCount(ctx), nav = tabNav(tab, todo, q('t'));
    var slot = root.querySelector('.lab-rail-admin');
    if (slot) slot.appendChild(nav); else root.appendChild(nav);
    tabInk(nav);
    var tabName = (TABS.filter(function (t) { return t[0] === tab; })[0] || TABS[0])[1];
    var isTodo = tab === 'todo' || !TABS.some(function (t) { return t[0] === tab; });
    root.appendChild(h('div', { class: 'work-head' }, title('h2', 'work-title', [tabName,
      tab === 'site' ? h('span', { class: 'work-sub' }, FILE_LABEL[q('t')] || '구성원') : null]),
      isTodo ? h('p', { class: 'work-count' }, todo ? ['남은 일 ', h('b', {}, num(todo)), '건'] : pill('남은 일 없음', 'ok')) : null));
    root.appendChild(msg);
    var draw = { todo: drawTodo, members: drawMembers, site: drawSite, handover: drawHandover, log: drawLog }[tab] || drawTodo;
    await draw(ctx);
    if (fake() && L.fakeMailbox) root.appendChild(await L.fakeMailbox(api));
    if (fake() && window.LabFakeApi) root.appendChild(resetButton(true));
    L.setStatus('');
    L.toastPending(api);
  }
  window.LabAdminPage = admin;

  function resetButton(ask) {
    return h('p', { class: 'fake-reset' }, btn('시험 자료 처음으로(미리 보기)', async function () {
      if (ask && !(await L.ask({ title: '시험 자료를 처음으로 되돌리시겠습니까?', body: '이 브라우저의 가입 신청 · 고친 표 · 기록이 처음 상태로 돌아갑니다. 미리 보기에서만 있는 단추입니다.', ok: '처음으로', danger: true }))) return;
      window.LabFakeApi.resetFake().then(function () { location.assign(L.url('/lab/admin/')); });
    }));
  }

  function todoCount(ctx) {
    return ctx.people.filter(function (p) { return p.role === 'pending' || p.withdraw_requested; }).length +
      ctx.helps.filter(function (r) { return r.status === 'open'; }).length + groupReqs(ctx.reqs).length;   // 변경 요청은 사람 수(카드 수)
  }

  function tabNav(cur, todo, tbl) {
    return h('nav', { class: 'admin-tabs', 'aria-label': '관리 화면 탭' }, h('ul', {}, TABS.map(function (t) {
      var on = cur === t[0];
      var sub = t[0] === 'site' ? h('ul', { class: 'rail-sub' }, TABLE_ORDER.map(function (k) {
        return h('li', {}, h('a', { href: link({ tab: 'site', t: k }), 'aria-current': on && (FILE_LABEL[tbl] ? tbl : 'people') === k ? 'page' : null }, FILE_LABEL[k]));
      })) : null;
      return h('li', { class: on ? 'is-on' : null }, h('a', { href: link({ tab: t[0] }), 'aria-current': on && t[0] !== 'site' ? 'page' : null },
        h('span', {}, t[1]), t[0] === 'todo' && todo ? h('span', { class: 'badge', 'aria-label': '남은 일 ' + todo + '건' }, num(todo)) : null), sub);
    })));
  }

  // 탭 표시 미끄러짐(16): 화면을 다시 불러오므로 앞 탭 자리를 브라우저 저장에 두었다가 거기서 지금 자리로 미끄러진다.
  // 넓은 화면은 세로 판 갈래 선 위의 금빛 막대(위아래로), 좁은 화면은 탭 아래 금빛 밑줄(옆으로)
  function tabInk(nav) {
    var narrow = window.matchMedia && matchMedia('(max-width: 1040px)').matches;
    var cur = nav.querySelector('[aria-current="page"]');
    if (!cur || (narrow && !cur.offsetParent) || cur.closest('.rail-sub') && narrow) cur = nav.querySelector('.is-on > a');
    if (!cur) return;
    var host = narrow ? nav.querySelector('ul') : nav;
    var ink = h('span', { class: 'tab-ink' + (narrow ? ' is-x' : ' is-y'), 'aria-hidden': 'true' });
    host.appendChild(ink);
    function at(p, still) {
      ink.classList.toggle('no-move', !!still);
      ink.style.setProperty('--x', p.x + 'px'); ink.style.setProperty('--y', p.y + 'px');
      ink.style.setProperty('--w', p.w + 'px'); ink.style.setProperty('--h', p.h + 'px');
    }
    requestAnimationFrame(function () {
      var hr = host.getBoundingClientRect(), cr = cur.getBoundingClientRect(), sub = cur.closest('.rail-sub');
      var bl = parseFloat(getComputedStyle(host).borderLeftWidth) || 0;
      // 넓은 화면: 갈래 선(관리 탭은 nav 왼쪽 선, 사이트 내용 안쪽은 rail-sub 왼쪽 선) 위에 3px 막대를 가운데로
      var lineX = sub ? sub.getBoundingClientRect().left : hr.left;
      var now = narrow ? { x: Math.round(cr.left - hr.left - bl + host.scrollLeft), y: Math.round(cr.bottom - hr.top - 3), w: Math.round(cr.width), h: 3 }
        : { x: Math.round(lineX - hr.left - bl - 1), y: Math.round(cr.top - hr.top + 8), w: 3, h: Math.max(16, Math.round(cr.height - 16)) };
      var key = 'labTabInk.' + (narrow ? 'x' : 'y'), prev = null;
      try { prev = JSON.parse(sessionStorage.getItem(key) || 'null'); sessionStorage.setItem(key, JSON.stringify(now)); } catch (e) { /* 없어도 됨 */ }
      if (prev && !L.reduced() && (prev.x !== now.x || prev.y !== now.y)) {
        at(prev, true);
        void ink.offsetWidth;
        requestAnimationFrame(function () { at(now, false); });
      } else at(now, true);
    });
  }

  // 2단계 인증을 아직 안 한 관리자(넘겨받은 새 조교 포함)
  function drawMfa(api, root, me) {
    var go1 = fake() ? h('button', { type: 'button', class: 'btn', onclick: async function (e) {
      var b = e.currentTarget; L.btnState(b, 'run');
      try { await api.registerMfa(); L.btnState(b, 'done'); flash('인증 앱을 등록했습니다(시험). 이제 관리 화면을 씁니다.'); await wait(360); location.reload(); }
      catch (err) { L.btnState(b, null); showError(null, err); }
    } }, '시험: 인증 앱을 등록한 것으로 하기') : null;
    root.appendChild(h('section', { class: 'mfa-card glow-host' },
      h('div', { class: 'mfa-head' }, h('span', { class: 'mfa-lock', 'aria-hidden': 'true' }),
        h('div', {}, title('h2', 'mfa-h', '먼저 2단계 인증을 등록합니다'),
          h('p', { class: 'mfa-lead' }, '관리 화면은 비밀번호와 휴대폰 인증 앱의 6자리 숫자로 엽니다.'))),
      me.incoming && me.incoming.length ? h('p', { class: 'mfa-note' }, pill('넘겨받는 중', 'warn'), ' ' + me.incoming.join(', ') + ' 님이 관리자를 넘겨주는 중입니다. 등록을 마치면 넘기기가 끝납니다.') : null,
      h('ol', { class: 'mfa-steps' },
        h('li', {}, h('b', {}, '인증 앱 깔기'), h('span', {}, 'Google · Microsoft Authenticator 등')),
        h('li', {}, h('b', {}, '네모 무늬(QR) 찍기')),
        h('li', {}, h('b', {}, '6자리 넣기')),
        h('li', {}, h('b', {}, '복구 코드 적기'), h('span', {}, '종이에 적어 연구실에 둡니다(휴대폰을 잃었을 때 씀).'))),
      go1 ? h('div', { class: 'btns' }, go1) : h('p', { class: 'muted' }, '진짜 서버를 연결한 뒤 이 자리에 QR이 나옵니다.')));
    if (fake() && window.LabFakeApi) root.appendChild(resetButton(false));
  }

  // ------------------------------------------------------------ 할 일
  async function drawTodo(ctx) {
    var root = ctx.root, people = ctx.people;
    var pending = people.filter(function (p) { return p.role === 'pending'; });
    var open = ctx.helps.filter(function (r) { return r.status === 'open'; });
    var leaving = people.filter(function (p) { return p.withdraw_requested; });
    var reqs = ctx.reqs;
    if (!pending.length && !open.length && !leaving.length && !reqs.length) {
      root.appendChild(h('div', { class: 'empty-done' }, h('span', { class: 'done-mark', 'aria-hidden': 'true' }),
        h('p', {}, h('b', {}, '처리할 일이 없습니다.'), ' 승인하지 않은 신청 · 본인 확인 요청은 30일 뒤 저절로 지워집니다.')));
      return;
    }
    var cards = [];
    function list(items, make) { var el = h('div', { class: 'todo-list' }, items.map(function (x) { var c = glow(make(ctx, x)); cards.push(c); return c; })); root.appendChild(el); }
    if (pending.length) { root.appendChild(section('가입 신청', pending.length, '건', '승인하면 그분 메일로 로그인 주소가 든 안내가 갑니다.')); list(pending, pendingCard); }
    if (open.length) {
      root.appendChild(section('본인 확인 요청', open.length, '건'));
      if (open.some(function (r) { return r.over_limit; })) root.appendChild(L.notice('오늘 요청이 30건을 넘었습니다. 장난 요청이 많으면 사람 확인 장치(Turnstile)를 켜야 합니다(site/README.md \'안전 장치\').', 'error'));
      list(open, helpCard);
    }
    if (reqs.length) {
      // 지금 공개된 카드와 나란히 보이려고 표를 한 번 불러 둔다(승인할 때 그 줄을 고침)
      try { ctx.siteData = await ctx.api.siteLoad(); } catch (err) { ctx.siteData = null; showError(ctx, err); }
      // 한 사람의 사진 · 키워드 요청은 카드 한 장(11-13)
      var groups = groupReqs(reqs);
      root.appendChild(section('구성원 소개 변경 요청', groups.length, '명', '승인하면 1~2분 뒤 공개됩니다.'));
      list(groups, cardReqCard);
    }
    if (leaving.length) { root.appendChild(section('탈퇴 요청', leaving.length, '건')); list(leaving, withdrawCard); }
    rise(cards);
  }

  function sameName(ctx, name) {
    return ctx.people.filter(function (x) { return x.role !== 'pending' && x.display_name === name; });
  }
  // 새 메일로 가입 신청(11-02): 신청서에 적은 예전 아이디와 같은 계정(대기 · 탈퇴 아님)
  function claimed(ctx, p) {
    var id = String(p.old_username || '').toLowerCase();
    return id ? ctx.people.filter(function (x) { return x.role !== 'pending' && x.status !== 'withdrawn' && x.username.toLowerCase() === id; })[0] || null : null;
  }
  function who(o) {
    return o.display_name + ' (아이디 ' + o.username + ' · ' + L.fmtDate(o.created_at).slice(0, 10) + ' 가입 · ' + (STATUS[o.status] || o.status) + ')';
  }

  // 한 건 = 가로로 긴 한 칸. 왼쪽 누구(이름 · 알약 · 날짜) · 가운데 내용 · 오른쪽 단추(세로로).
  // 반복되는 칸이라 칸 안에서 가장 중요한 단추도 흰 알약, 나머지는 글자만. 기존 회원일 수 있으면 맨 위 띠의 [기존 계정과 연결]만 남색
  function whoCol(name, pills, when) {
    return h('div', { class: 'todo-who' }, h('h4', { class: 'todo-name' }, name),
      h('p', { class: 'todo-kind' }, pills), h('p', { class: 'todo-when num' }, when));
  }
  // 신청한 때: 오늘 · 어제 · n일 전(정확한 때는 마우스를 올리면). 30일이면 저절로 지워지므로 7일 안 남으면 함께 알림
  function sinceText(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var t0 = new Date(); t0.setHours(0, 0, 0, 0);
    var days = Math.round((t0 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    var s = days <= 0 ? '오늘 ' + L.fmtDate(iso).slice(11) : days === 1 ? '어제' : days + '일 전';
    var left = 30 - days;
    return s + ' 신청' + (left <= 7 ? ' · ' + Math.max(left, 0) + '일 뒤 저절로 지워짐' : '');
  }
  // 메일은 카드가 열린 뒤 따로 불러 넣는다(회원 목록에는 메일이 없음). 판단할 때 가장 먼저 보는 단서라 내용 칸 맨 위
  function mailLine(ctx, id, label) {
    var v = h('span', { class: 'todo-mail-v' }, '…');
    ctx.api.memberEmail(id).then(function (m) { v.textContent = m || '(없음)'; }, function () { v.textContent = '(불러오지 못함)'; });
    return h('p', { class: 'todo-mail' }, h('span', { class: 'todo-mail-k' }, label || '메일'), v);
  }

  // 가입 신청 한 건(11-02 밤 다시 짬, 연구자: "한 번에 승인을 할 수 있을지, 보기 쉬운지"):
  // 왼쪽 누구 · 가운데 판단 단서(메일 · 과정 · 소개, 예전 계정이면 그 계정과 메일 둘) · 오른쪽 할 일 하나가 앞(남색 알약) + 나머지는 글자.
  // 재학 승인은 '구성원 명단에도 올리기'(켜 둠)를 함께. 승인하면 그분께 로그인 주소가 든 메일이 간다
  function pendingCard(ctx, p) {
    var mine = claimed(ctx, p);
    var olds = sameName(ctx, p.display_name).filter(function (o) { return !mine || o.id !== mine.id; });
    var student = p.kind === '재학', linked = mine || olds.length;
    var facts = [p.course || null, p.entry_year ? p.entry_year + '년 입학' : null,   // 11-02부터 가입은 메일이 아이디라 안에서 만든 아이디는 보이지 않음
      student ? '구성원 화면 메일 공개 ' + (p.show_email ? '동의' : '안 함') : null,
      p.old_username && !mine ? '기재한 기존 아이디 ' + p.old_username + '(일치하는 계정 없음)' : null].filter(Boolean).join(' · ');
    var more = h('div', { class: 'todo-more' });
    var toRoster = student && !linked ? h('input', { type: 'checkbox', checked: true }) : null;

    // 예전 계정 단서: 누구인지 한 줄 + (메일 바뀜이면) 예전 메일 → 새 메일
    var match = null;
    if (mine) {
      match = h('div', { class: 'todo-match' },
        h('p', { class: 'todo-match-h' }, h('b', {}, '기존 아이디 ' + mine.username + '로 신청했습니다.'), ' 메일 주소가 변경된 기존 회원입니다.'),
        h('p', { class: 'cand-who' }, face(mine.display_name, ROLE_TONE[mine.role]), who(mine)),
        mailLine(ctx, mine.id, '기존 메일'), mailLine(ctx, p.id, '새 메일'));
    } else if (olds.length) {
      match = h('div', { class: 'todo-match' },
        h('p', { class: 'todo-match-h' }, h('b', {}, '이름이 같은 계정이 있습니다.'), ' 같은 분이면 새로 승인하지 말고 연결하십시오.'),
        h('ul', { class: 'cand' }, olds.map(function (o) {
          return h('li', {}, h('span', { class: 'cand-who' }, face(o.display_name, ROLE_TONE[o.role]), who(o)),
            olds.length > 1 ? btn('이 계정과 연결', function () { openLinkOld(ctx, p, o, more); }, 'btn-text') : null);
        })));
    }

    var approveBtn = h('button', { type: 'button', class: 'btn ' + (linked ? 'btn-text' : ''), onclick: async function (e) {
      var b = e.currentTarget;
      if (linked && !(await L.ask({ title: p.display_name + ' 님을 새 계정으로 승인하시겠습니까?', ok: '새 계정으로 승인',
        body: '기존 계정과 별도로 계정이 하나 더 만들어집니다. 같은 분이면 [그만두기]를 누르고 기존 계정과 연결하십시오.' }))) return;
      L.btnState(b, 'run');
      try {
        await ctx.api.approve(p.id); L.btnState(b, 'done');
        if (toRoster && toRoster.checked) {
          flash(p.display_name + ' 님을 승인하고 안내 메일을 보냈습니다. 구성원 명단 초안을 확인하고 [저장]하십시오.');
          await wait(360); go({ tab: 'site', t: 'people', new: '1', from: p.id });
        } else { flash(p.display_name + ' 님을 승인하고 안내 메일을 보냈습니다.'); await wait(360); location.reload(); }
      } catch (err) { L.btnState(b, null); showError(ctx, err); }
    } }, linked ? '새 계정으로 승인' : '승인');

    var linkBtn = mine ? h('button', { type: 'button', class: 'btn', onclick: act(ctx, function () { return ctx.api.linkOld(p.id, mine.id, true); },
        { title: '기존 계정(아이디 ' + mine.username + ')과 연결하시겠습니까?', ok: '기존 계정과 연결',
          body: '기존 계정의 메일을 새 메일로 변경하고, 새 메일로 비밀번호 설정 링크를 보냅니다. 이 신청은 삭제되며, 기존 메일로 변경 알림이 발송됩니다.' },
        '기존 계정(아이디 ' + mine.username + ')의 메일을 변경하고 비밀번호 설정 링크를 보냈습니다.') }, '기존 계정과 연결')
      : olds.length === 1 ? h('button', { type: 'button', class: 'btn', onclick: function () { openLinkOld(ctx, p, olds[0], more); } }, '기존 계정과 연결')
      : null;

    return h('article', { class: 'todo-card' + (linked ? ' has-warn' : '') },
      whoCol(p.display_name, [pill(p.kind, KIND_TONE[p.kind]), mine ? pill('메일 변경', 'warn') : olds.length ? pill('기존 회원일 수 있음', 'warn') : null],
        h('span', { title: L.fmtDate(p.created_at) }, sinceText(p.created_at))),
      h('div', { class: 'todo-body' },
        mine ? null : mailLine(ctx, p.id),
        facts ? h('p', { class: 'todo-facts' }, facts) : null,
        p.intro ? h('p', { class: 'todo-quote' }, p.intro) : null,
        match),
      h('div', { class: 'todo-acts' },
        linkBtn, approveBtn,
        toRoster ? h('label', { class: 'check todo-check' }, toRoster, ' 구성원 명단에도 올리기') : null,
        h('button', { type: 'button', class: 'btn btn-text is-danger', onclick: act(ctx, function () { return ctx.api.reject(p.id); },
          { title: p.display_name + ' 님의 신청을 거절하시겠습니까?', body: '신청은 지워지고 되돌릴 수 없습니다. 같은 분이 다시 신청할 수는 있습니다.', ok: '거절', danger: true }, '거절했습니다.') }, '거절')),
      more);
  }

  // 기존 계정과 연결(검토 10-28 5번): 기존 계정 메일과 신청 메일을 나란히 보인다. 같으면 바로 잇고(기존 메일로 링크),
  // 다르면 기존 메일이 죽었을 수 있으므로 연구실이 아는 연락처로 본인 확인 뒤 기존 계정 메일을 신청 메일로 바꾸고 잇는다.
  // byClaim(11-02): 신청서에 예전 아이디를 적은 '새 메일로 가입 신청'이면 다른 길 본인 확인 없이, 예전 계정 메일을 신청 메일로 바꾸고 잇는다
  // (연구자: 본인 확인 요청은 "기분나쁠수도 있을 것 같고 … 귀찮을 것 같은데", 시안 안 1). 예전 메일에는 알림이 간다
  async function openLinkOld(ctx, p, o, area, byClaim) {
    var oldMail = '', newMail = '';
    try { oldMail = await ctx.api.memberEmail(o.id); newMail = await ctx.api.memberEmail(p.id); }
    catch (err) { showError(ctx, err); return; }
    var same = oldMail && newMail && oldMail.toLowerCase() === newMail.toLowerCase();
    var info = h('div', { class: 'mail-pair' },
      h('div', {}, h('span', { class: 'mail-pair-k' }, '기존 계정 메일'), h('span', { class: 'mail-pair-v' }, oldMail || '(없음)')),
      h('div', {}, h('span', { class: 'mail-pair-k' }, '이번 신청 메일'), h('span', { class: 'mail-pair-v' }, newMail || '(없음)')),
      same ? pill('같음', 'ok') : byClaim ? pill('새 메일로 변경', 'warn') : pill('다름 · 본인 확인 필요', 'warn'));
    if (byClaim && !same && newMail) {
      area.replaceChildren(h('div', { class: 'fix-form' }, info,
        h('p', {}, '기존 계정(아이디 ' + o.username + ')의 메일을 이번 신청 메일로 변경하고, 새 메일로 비밀번호 설정 링크를 보냅니다. 새 신청은 삭제됩니다. 기존 메일에도 알림이 갑니다.'),
        h('div', { class: 'btns' }, btn('기존 계정과 연결', act(ctx, function () { return ctx.api.linkOld(p.id, o.id, true); }, null,
          '기존 계정(아이디 ' + o.username + ')의 메일을 변경하고 비밀번호 설정 링크를 보냈습니다.'), 'btn'))));
      return;
    }
    if (same || (oldMail && !newMail)) {
      area.replaceChildren(h('div', { class: 'fix-form' }, info,
        h('p', {}, '새 신청을 지우고 기존 계정(아이디 ' + o.username + ')의 메일로 비밀번호 링크를 보냅니다. 링크를 보내지 못하면 신청은 그대로 둡니다.'),
        h('div', { class: 'btns' }, btn('기존 계정과 연결', act(ctx, function () { return ctx.api.linkOld(p.id, o.id); }, null,
          '기존 계정과 연결했습니다. 기존 계정 메일로 비밀번호 링크를 보냈습니다.'), 'btn'))));
      return;
    }
    var v = verifyFields(), err = h('div', { 'aria-live': 'polite' });
    var go2 = h('button', { type: 'submit', class: 'btn btn-small' }, '기존 계정 메일을 ' + newMail + '(으)로 바꾸고 연결');
    var form = h('form', { class: 'form form-wide fix-form' }, info,
      h('p', {}, '두 메일이 다릅니다. 기존 메일을 더 쓰지 않아 새로 신청했을 수 있습니다. 본인이 맞으면 기존 계정 메일을 이번 신청 메일로 바꾸고, 새 신청은 지운 뒤 링크를 보냅니다.'),
      v.el, err, h('div', { class: 'btns' }, go2));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var m = v.method();
      if (!m) { showError(ctx, L.userError(VERIFY_MISSING), err); return; }
      err.replaceChildren();
      L.btnState(go2, 'run');
      try {
        await ctx.api.reject(p.id);            // 신청 계정이 그 메일을 쥐고 있으므로 먼저 지운다
        await ctx.api.setEmail(o.id, newMail, m);
        await ctx.api.sendReset(o.id);
        L.btnState(go2, 'done');
        flash('기존 계정(아이디 ' + o.username + ')의 메일을 바꾸고 비밀번호 링크를 보냈습니다. 새 신청은 지웠습니다.');
        await wait(360);
        location.reload();
      } catch (er) { L.btnState(go2, null); showError(ctx, er, err); }
    });
    area.replaceChildren(form);
  }

  function helpCard(ctx, r) {
    var cands = sameName(ctx, r.name);
    var area = h('div');
    function openFix(o) {
      var v = verifyFields(), err = h('div', { 'aria-live': 'polite' });
      var go2 = h('button', { type: 'submit', class: 'btn btn-small' }, '메일을 ' + r.email + '(으)로 바꾸고 링크 보내기');
      var form = h('form', { class: 'form form-wide fix-form' }, h('p', {}, h('b', {}, o.display_name), ' 계정(아이디 ' + o.username + ')의 메일을 바꿉니다.'), v.el, err, h('div', { class: 'btns' }, go2));
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var m = v.method();
        if (!m) { showError(ctx, L.userError(VERIFY_MISSING), err); return; }
        err.replaceChildren();
        L.btnState(go2, 'run');
        try {
          await ctx.api.setEmail(o.id, r.email, m);
          await ctx.api.sendReset(o.id);
          await ctx.api.closeHelp(r.id, m + '로 확인, 메일 바꾸고 링크 보냄');
          L.btnState(go2, 'done');
          flash(o.display_name + ' 님 계정의 메일을 바꾸고 비밀번호 링크를 보냈습니다.');
          await wait(360);
          location.reload();
        } catch (er) { L.btnState(go2, null); showError(ctx, er, err); }
      });
      area.replaceChildren(form);
    }
    var facts = [r.course || null, r.year ? r.year + '년' : null, '지금 메일 ' + r.email].filter(Boolean).join(' · ');
    area.className = 'todo-more';
    return h('article', { class: 'todo-card' },
      whoCol(r.name, [pill(r.kind, KIND_TONE[r.kind]), cands.length ? pill('같은 이름 ' + cands.length + '명', 'warn') : pill('같은 이름 없음', 'mute')], L.fmtDate(r.created_at) + ' 보냄'),
      h('div', { class: 'todo-body' }, h('p', { class: 'todo-facts' }, facts),
        r.message ? h('p', { class: 'todo-quote' }, r.message) : null,
        cands.length ? h('div', { class: 'todo-cand' }, h('p', { class: 'todo-facts' }, '이름이 같은 계정'), h('ul', { class: 'cand' }, cands.map(function (o) {
          return h('li', {}, h('span', { class: 'cand-who' }, face(o.display_name, ROLE_TONE[o.role]), who(o)), btn('이 계정 메일 바꾸고 링크 보내기', function () { openFix(o); }));
        }))) : h('p', { class: 'todo-facts' }, '이름이 같은 계정이 없습니다. \'회원\' 탭에서 아이디로 찾아보십시오.')),
      h('div', { class: 'todo-acts' },
        btn('처리함', act(ctx, function () { return ctx.api.closeHelp(r.id, '처리함'); }, null, '처리한 요청으로 옮겼습니다.'), 'btn-ghost'),
        btn('지우기', act(ctx, function () { return ctx.api.deleteHelp(r.id); },
          { title: r.name + ' 님의 요청을 지우시겠습니까?', body: '지운 요청은 되돌릴 수 없습니다. 처리했으면 [처리함]을 쓰면 기록이 남습니다.', ok: '지우기', danger: true }, '지웠습니다.'), 'btn-text is-danger')),
      area);
  }

  function withdrawCard(ctx, p) {
    var also = p.person_no ? h('input', { type: 'checkbox' }) : null;
    return h('article', { class: 'todo-card' },
      whoCol(p.display_name, [pill(p.kind, KIND_TONE[p.kind]), pill('탈퇴 요청', 'err')], '아이디 ' + p.username),
      h('div', { class: 'todo-body' },
        h('p', {}, '탈퇴 처리를 하면 계정 · 메일 · 올린 사진과 파일을 지웁니다. 쓴 글은 \'탈퇴한 회원\'으로 남습니다.'),
        also ? h('label', { class: 'check' }, also, ' 구성원 · 졸업생 명단에서도 빼기') : null),
      h('div', { class: 'todo-acts' },
        h('button', { type: 'button', class: 'btn btn-danger', onclick: act(ctx, async function () {
          var no = p.person_no;
          await ctx.api.withdrawDone(p.id);
          if (also && also.checked && no) await removeCardByNumber(ctx, no);
        }, { title: p.display_name + ' 님을 탈퇴 처리하시겠습니까?', body: '계정 · 메일 · 올린 사진과 파일을 지웁니다. 되돌릴 수 없습니다.', ok: '탈퇴 처리', danger: true }, '탈퇴 처리했습니다.') }, '탈퇴 처리'),
        btn('요청 취소', act(ctx, function () { return ctx.api.withdrawCancel(p.id); }, null, '탈퇴 요청을 취소했습니다.'), 'btn-text')));
  }

  // 구성원 카드 사진 · 관심 분야 고침 요청(11-02). 승인 = 공개 표의 그 줄을 고침(저장 한 번, 기록 · 되돌리기 그대로) → 요청을 '승인됨'으로.
  // 표를 고치지 못하면 요청은 기다림으로 남는다. 관심 분야는 글을 다듬어 승인할 수 있다.
  // 카드와 아직 안 이어진 회원의 요청은 넣을 카드를 고른다(같은 이름 카드를 먼저 골라 둠). 승인하면 그 카드와 계정을 함께 잇는다.
  // 11-13 개편(연구자 결정, docs/2026-11-13_기능정리_확인.html 02): 한 사람의 요청(사진 · 키워드)을 카드 한 장으로 모으고 넣을 카드는 한 번만 고른다.
  // 요청 내용은 처음부터 보이고, 카드를 고르면 '지금' 자리가 채워진다. 비교 사진은 공개 카드 크기(120 × 150).
  // 넣을 카드는 이름을 쳐서 찾는다. [모두 승인하고 공개] 하나 + 요청이 둘이면 항목별 체크(사진만 승인 등).
  // 돌려보낼 때 자주 쓰는 이유를 눌러 고른다. 서버 규칙(요청 표)은 그대로: 화면에서 묶고, 결정은 요청마다 decideProfileRequest
  var REQ_LABEL = { photo: '사진', interest: '키워드' };
  var REJECT_REASONS = [
    { kind: 'photo', label: '얼굴이 잘 보이는 정면 사진으로', text: '얼굴이 잘 보이는 정면 사진으로 다시 보내 주십시오.' },
    { kind: 'photo', label: '더 밝고 선명한 사진으로', text: '더 밝고 선명한 사진으로 다시 보내 주십시오.' },
    { kind: 'interest', label: '키워드는 국문으로', text: '키워드는 국문으로 적어 주십시오.' }
  ];
  // 한 회원의 요청을 한 묶음으로(사진이 앞). 묶음 차례는 먼저 보낸 사람부터
  function groupReqs(reqs) {
    var by = {}, out = [];
    reqs.forEach(function (r) {
      if (!by[r.user_id]) { by[r.user_id] = []; out.push(by[r.user_id]); }
      by[r.user_id].push(r);
    });
    out.forEach(function (g) { g.sort(function (a, b) { return a.kind === b.kind ? 0 : a.kind === 'photo' ? -1 : 1; }); });
    return out;
  }
  function findCard(ctx, no) {
    var d = ctx.siteData, T = window.LabSiteTables, out = null;
    if (!d) return null;
    ['people', 'alumni'].forEach(function (name) {
      if (out) return;
      T.rows(T.parse(d.texts[name])).forEach(function (row, i) { if (!out && row['번호'] === String(no)) out = { name: name, index: i, row: row, t: d.rules.tables[name] }; });
    });
    return out;
  }
  // 이을 수 있는 카드: 번호가 있고 다른 회원과 안 이어진 카드. 관심 분야는 구성원 카드에만 있다(사진 요청이 있으면 졸업생 카드도)
  function freeCards(ctx, userId, withAlumni) {
    var d = ctx.siteData, T = window.LabSiteTables, used = {}, out = [];
    if (!d) return out;
    ctx.people.forEach(function (x) { if (x.person_no && x.id !== userId) used[String(x.person_no)] = true; });
    (withAlumni ? ['people', 'alumni'] : ['people']).forEach(function (name) {
      T.rows(T.parse(d.texts[name])).forEach(function (row, i) {
        if (row['번호'] && !used[row['번호']]) out.push({ name: name, index: i, row: row, t: d.rules.tables[name] });
      });
    });
    return out;
  }
  // 카드 한 줄 이름: 구성원 · 홍길동 (박사과정) / 졸업생 · 홍길동 (박사 2020)
  function cardName(c) {
    var sub = c.name === 'alumni' ? [c.row['학위'], c.row['졸업 연도']].filter(Boolean).join(' ') : c.row['과정'] || '';
    return c.t.label + ' · ' + (c.row['이름'] || '(이름 없음)') + (sub ? ' (' + sub + ')' : '');
  }
  function cardReqCard(ctx, g) {
    var api = ctx.api, r0 = g[0], userId = r0.user_id, name = r0.display_name;
    var photoReq = g.filter(function (r) { return r.kind === 'photo'; })[0] || null;
    var kwReq = g.filter(function (r) { return r.kind === 'interest'; })[0] || null;
    var linked = !!r0.person_no;
    var found = linked ? findCard(ctx, r0.person_no) : null;
    var latest = g.reduce(function (a, r) { return r.created_at > a ? r.created_at : a; }, r0.created_at);
    var more = h('div', { class: 'todo-more' });
    var body = h('div', { class: 'todo-body rq-body' });
    var editLink = h('a', { class: 'btn btn-text req-edit', href: '#' }, '명단에서 직접 고치기');

    // ---- 넣을 카드: 이어진 회원은 그 카드 한 줄, 아니면 이름으로 찾기(이름이 같은 카드가 하나면 미리 골라 둠)
    var pickBox = h('div', { class: 'rq-pick' });
    var cands = linked ? [] : freeCards(ctx, userId, !!photoReq);
    if (!linked) {
      var same = cands.filter(function (c) { return c.row['이름'] === name; });
      found = same.length === 1 ? same[0] : null;
    }
    function drawPick() {
      if (linked) {
        pickBox.replaceChildren(h('p', { class: 'rq-pick-h' }, h('span', { class: 'rq-k' }, '넣을 카드'),
          found ? h('b', {}, cardName(found)) : h('span', {}, '연결된 명단 항목(번호 ' + r0.person_no + ')을 찾지 못했습니다. 항목을 지웠거나 옮겼으면 돌려보내 주십시오.')));
        return;
      }
      var hint = h('p', { class: 'hint rq-hint' }, '명단 미등록 계정입니다. 승인하면 고른 카드와 연결됩니다. 카드가 없으면 ',
        h('a', { href: link({ tab: 'site', t: 'people', new: '1', from: userId }) }, '명단에 새로 등록'), '부터.');
      if (found) {
        var change = h('button', { type: 'button', class: 'btn btn-text btn-small' }, '다른 카드 찾기');
        change.addEventListener('click', function () { found = null; drawPick(); drawAll(); var i = pickBox.querySelector('input'); if (i) i.focus(); });
        pickBox.replaceChildren(h('div', { class: 'rq-pick-h' }, h('span', { class: 'rq-k' }, '넣을 카드'), h('b', {}, cardName(found)), change), hint);
        return;
      }
      var nPeople = cands.filter(function (c) { return c.name === 'people'; }).length, nAlum = cands.length - nPeople;
      var inp = h('input', { type: 'search', autocomplete: 'off', placeholder: '이름으로 찾기', 'aria-label': name + ' 님 요청을 넣을 카드를 이름으로 찾기' });
      var hits = h('ul', { class: 'rq-hits', 'aria-live': 'polite' });
      function show() {
        var w = inp.value.replace(/\s+/g, '').toLowerCase();
        if (!w) { hits.replaceChildren(h('li', { class: 'rq-hits-note' }, '구성원 ' + nPeople + (nAlum ? ' · 졸업생 ' + nAlum : '') + '명 가운데 이름으로 찾습니다.')); return; }
        var m = cands.filter(function (c) { return String(c.row['이름'] || '').replace(/\s+/g, '').toLowerCase().indexOf(w) !== -1; });
        if (!m.length) { hits.replaceChildren(h('li', { class: 'rq-hits-note' }, '이름이 맞는 카드가 없습니다.')); return; }
        hits.replaceChildren.apply(hits, m.slice(0, 8).map(function (c) {
          return h('li', {}, h('button', { type: 'button', class: 'rq-hit', onclick: function () { found = c; drawPick(); drawAll(); } }, cardName(c)));
        }).concat(m.length > 8 ? [h('li', { class: 'rq-hits-note' }, '그 밖에 ' + (m.length - 8) + '명. 이름을 더 적어 주십시오.')] : []));
      }
      inp.addEventListener('input', show);
      inp.addEventListener('keydown', function (e) {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); var b = hits.querySelector('.rq-hit'); if (b) b.click(); }
      });
      show();
      pickBox.replaceChildren(h('label', { class: 'rq-pick-h' }, h('span', { class: 'rq-k' }, '넣을 카드'), inp), hits, hint);
    }

    // ---- 지금 → 요청 나란히. 요청 쪽은 처음부터, 지금 쪽은 카드를 고르면 채워짐
    var newPhoto = photoReq ? h('span', { class: 'ph ph-none', 'aria-hidden': 'true' }, '…') : null;
    if (photoReq) {
      api.requestPhotoUrl(photoReq.id).then(function (u) {
        if (u) { var im = h('img', { class: 'ph', src: u, alt: name + ' 님이 보낸 사진', width: 120, height: 150 }); newPhoto.replaceWith(im); newPhoto = im; }
      }).catch(function () { /* 그림을 못 불러와도 단추는 쓴다 */ });
    }
    var kwEdit = null, kwNew = h('div', { class: 'rq-kw' }), kwFixArea = h('div', { class: 'rq-kwfix' });
    function drawKwNew() {
      if (!kwReq) return;
      kwNew.replaceChildren(kwEdit ? h('span', { class: 'muted' }, '(아래에서 고치는 중)') : L.keywordList(kwReq.interest) || h('span', { class: 'muted' }, '(비워 달라는 요청)'));
    }
    drawKwNew();
    var nowSide = h('figure', { class: 'rq-side' });
    var cmp = h('div', { class: 'rq-cmp' + (photoReq ? '' : ' no-photo') }, nowSide, h('span', { class: 'req-arrow', 'aria-hidden': 'true' }, '→'),
      h('figure', { class: 'rq-side is-new' }, h('figcaption', {}, '요청'), photoReq ? newPhoto : null, kwReq ? kwNew : null));
    function drawNow() {
      var cap = h('figcaption', {}, '지금');
      if (!found) {
        nowSide.replaceChildren(cap, h('span', { class: 'rq-empty' }, linked ? '명단 항목 없음' : '카드를 고르면 지금 사진 · 키워드가 여기에 보입니다'));
        return;
      }
      var pic = null;
      if (photoReq) {
        pic = h('span', { class: 'ph ph-none', 'aria-hidden': 'true' }, (found.row['이름'] || '?').slice(0, 1));
        var at = found;
        if (at.row['사진']) api.sitePhotoUrl(at.t.photo_dir + '/' + at.row['사진']).then(function (u0) {
          if (at === found && pic.isConnected) pic.replaceWith(h('img', { class: 'ph', src: u0, alt: '지금 사진', width: 120, height: 150 }));
        }).catch(function () { /* 그대로 첫 글자 */ });
      }
      var kw = null;
      if (kwReq) kw = h('div', { class: 'rq-kw' }, found.name !== 'people' ? h('span', { class: 'muted' }, '(졸업생 카드에는 키워드 칸이 없음)')
        : L.keywordList(found.row['관심 분야']) || h('span', { class: 'muted' }, '(비어 있음)'));
      nowSide.replaceChildren.apply(nowSide, [cap, pic, kw].filter(Boolean));
    }

    // ---- 항목별 체크(요청이 둘일 때만). 사진만 승인하면 키워드 요청은 기다림으로 남아 다음에 돌려보내거나 승인한다
    var checks = {};
    var approveBtn = h('button', { type: 'button', class: 'btn btn-ghost rq-go' });
    function picked() { return g.filter(function (r) { return !checks[r.kind] || (checks[r.kind].checked && !checks[r.kind].disabled); }); }
    function drawApprove() {
      var p = picked(), can = !!found && p.length > 0;
      approveBtn.textContent = g.length === 1 ? '승인하고 공개' : p.length === g.length ? '모두 승인하고 공개' : p.length ? REQ_LABEL[p[0].kind] + '만 승인하고 공개' : '승인할 항목을 고르십시오';
      approveBtn.disabled = !can;
      approveBtn.title = found ? '' : '넣을 카드를 먼저 고르십시오';
    }
    var fixBtn = null;
    if (kwReq) {
      fixBtn = h('button', { type: 'button', class: 'btn btn-text btn-small' }, '키워드 오타 고치기');
      fixBtn.addEventListener('click', function () {
        kwEdit = L.keywordInput(L.keywords(kwReq.interest), { label: '올릴 관심 분야 키워드' });
        kwFixArea.replaceChildren(kwEdit.el);
        fixBtn.hidden = true;
        drawKwNew();
        kwEdit.input.focus();
      });
    }
    var checkRow = null;
    if (g.length > 1 || fixBtn) {
      checkRow = h('div', { class: 'rq-checks' }, g.length > 1 ? g.map(function (r) {
        var box = h('input', { type: 'checkbox', checked: true });
        box.addEventListener('change', drawApprove);
        checks[r.kind] = box;
        return h('label', { class: 'check' }, box, ' ' + REQ_LABEL[r.kind] + ' 승인');
      }) : null, fixBtn);
    }
    // 졸업생 카드를 고르면 키워드는 넣을 곳이 없다: 체크를 끄고 막는다
    function drawChecks() {
      if (checks.interest) {
        var noKw = !!found && found.name !== 'people';
        if (noKw && !checks.interest.disabled) checks.interest.checked = false;
        else if (!noKw && checks.interest.disabled) checks.interest.checked = true;   // 졸업생 카드 때문에 꺼 둔 것만 되켬
        checks.interest.disabled = noKw;
      }
      drawApprove();
    }

    function drawAll() {
      drawNow(); drawChecks();
      editLink.hidden = !found;
      if (found) editLink.href = link({ tab: 'site', t: found.name, edit: String(found.index) });
    }

    async function approve() {
      if (!found) throw L.userError('넣을 카드를 먼저 고르십시오.');
      var todo = picked();
      if (!todo.length) throw L.userError('승인할 항목을 고르십시오.');
      var row = Object.assign({}, found.row), extra = { photos: [], removePhotos: [] };
      for (var i = 0; i < todo.length; i++) {
        var r = todo[i];
        if (r.kind === 'photo') {
          var blob = await api.requestPhotoBlob(r.id);
          var file = (row['번호'] || 'p') + '-' + Date.now().toString(36) + '.jpg';
          row['사진'] = file;
          extra.photos.push({ path: found.t.photo_dir + '/' + file, blob: blob });
          if (found.row['사진']) extra.removePhotos.push(found.t.photo_dir + '/' + found.row['사진']);
        } else {
          if (found.name !== 'people') throw L.userError('졸업생 카드에는 키워드 칸이 없습니다. 키워드 요청은 돌려보내 주십시오.');
          var list = kwEdit ? kwEdit.get() : L.keywords(r.interest);
          var bad = L.checkKeywords(list), v = list.join(L.kw.sep);
          if (bad) throw L.userError(bad);
          bad = window.LabSiteTables.checkCell(ctx.siteData.rules, found.t.columns.filter(function (c) { return c.name === '관심 분야'; })[0], v);
          if (bad) throw L.userError(bad);
          row['관심 분야'] = v;
        }
      }
      // 이어지지 않은 계정은 먼저 고른 카드와 잇는다(다른 회원과 이어진 카드면 서버가 막음). 표는 한 번에 저장 → 판 하나
      if (!linked) await api.linkPerson(userId, found.row['번호']);
      var res = await api.siteSave([{ table: found.name, op: 'edit', index: found.index, row: row, expect: found.row }], extra);
      for (var k = 0; k < todo.length; k++) await api.decideProfileRequest(todo[k].id, 'approved', '');
      return res;
    }
    approveBtn.addEventListener('click', function (e) {
      var what = picked().map(function (r) { return REQ_LABEL[r.kind]; }).join(' · ');
      return act(ctx, approve, null, name + ' 님 ' + what + '을(를) 승인했습니다. ' + (fake() ? '(미리 보기: 이 브라우저 안에만)' : '구성원 화면에는 1~2분 뒤 보입니다.'), true)(e);
    });

    // ---- 돌려보내기: 자주 쓰는 이유를 눌러 넣고, 요청이 둘이면 무엇을 돌려보낼지 고른다
    function openReject() {
      var why = h('input', { type: 'text', maxlength: 200, placeholder: '예: 얼굴이 잘 보이는 정면 사진으로 다시 보내 주십시오' });
      var go2 = h('button', { type: 'submit', class: 'btn btn-small btn-danger' }, '돌려보내기');
      var err = h('div', { 'aria-live': 'polite' });
      var kinds = g.map(function (r) { return r.kind; });
      var chips = REJECT_REASONS.filter(function (x) { return kinds.indexOf(x.kind) !== -1; }).map(function (x) {
        var c = h('button', { type: 'button', class: 'rq-chip', 'aria-pressed': 'false' }, x.label);
        c.addEventListener('click', function () {
          var on = c.getAttribute('aria-pressed') !== 'true', v = why.value.trim();
          if (on && v.indexOf(x.text) === -1) why.value = (v ? v + ' ' : '') + x.text;
          if (!on) why.value = v.replace(x.text, '').replace(/\s+/g, ' ').trim();
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        return c;
      });
      var own = h('button', { type: 'button', class: 'rq-chip is-own' }, '직접 적기');
      own.addEventListener('click', function () { why.focus(); });
      var backs = {};
      var which = g.length > 1 ? h('div', { class: 'rq-checks' }, h('span', { class: 'rq-k' }, '돌려보낼 것'), g.map(function (r) {
        var b = h('input', { type: 'checkbox', checked: true });
        backs[r.kind] = b;
        return h('label', { class: 'check' }, b, ' ' + REQ_LABEL[r.kind]);
      })) : null;
      var form = h('form', { class: 'form form-wide fix-form rq-why' }, which,
        h('label', {}, '이유(본인 내 정보에 보임, 비워도 됨)', why),
        h('div', { class: 'rq-chips', role: 'group', 'aria-label': '자주 쓰는 이유' }, chips, own),
        err, h('div', { class: 'btns' }, go2));
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var out = g.filter(function (r) { return !backs[r.kind] || backs[r.kind].checked; });
        if (!out.length) { showError(ctx, L.userError('돌려보낼 항목을 고르십시오.'), err); return; }
        err.replaceChildren();
        L.btnState(go2, 'run');
        try {
          for (var i = 0; i < out.length; i++) await api.decideProfileRequest(out[i].id, 'rejected', why.value);
          L.btnState(go2, 'done');
          flash(name + ' 님 ' + out.map(function (r) { return REQ_LABEL[r.kind]; }).join(' · ') + ' 요청을 돌려보냈습니다.');
          await wait(360); location.reload();
        } catch (er) { L.btnState(go2, null); showError(ctx, er, err); }
      });
      more.replaceChildren(form);
      why.focus();
    }

    drawPick(); drawAll();
    body.append(pickBox, cmp, kwFixArea);
    if (checkRow) body.append(checkRow);
    return h('article', { class: 'todo-card rq-card' },
      whoCol(name, g.map(function (r) { return pill(REQ_LABEL[r.kind], 'navy'); }).concat(linked ? [] : [pill('명단 미등록')]), L.fmtDate(latest) + ' 보냄'),
      body,
      h('div', { class: 'todo-acts' }, approveBtn, btn('돌려보내기', openReject, 'btn-text is-danger'), editLink),
      more);
  }

  async function removeCardByNumber(ctx, no) {
    var data = await ctx.api.siteLoad(), T = window.LabSiteTables;
    var changes = [], remove = [];
    ['people', 'alumni'].forEach(function (name) {
      var t = data.rules.tables[name];
      T.rows(T.parse(data.texts[name])).forEach(function (row, i) {
        if (row['번호'] !== String(no)) return;
        changes.push({ table: name, op: 'remove', index: i, expect: row });
        if (row['사진']) remove.push(t.photo_dir + '/' + row['사진']);
      });
    });
    if (changes.length) await ctx.api.siteSave(changes, { removePhotos: remove });
  }

  // ------------------------------------------------------------ 회원: 얼굴 · 상태 꼬리표 표(146) + 사람 찾기(245)
  async function drawMembers(ctx) {
    var root = ctx.root;
    var uid = q('u');
    if (uid) {
      var p = ctx.people.filter(function (x) { return x.id === uid; })[0];
      if (p) return memberDetail(ctx, p);
      root.appendChild(L.notice('그 회원을 찾지 못했습니다.', 'error'));
    }
    var members = ctx.people.filter(function (p) { return p.role !== 'pending'; });
    var pend = ctx.people.length - members.length;
    var find = h('input', { type: 'search', placeholder: '이름 · 아이디로 찾기', 'aria-label': '이름 · 아이디로 찾기', autocomplete: 'off' });
    var kind = h('select', { 'aria-label': '구분으로 거르기' }, h('option', { value: '' }, '구분 모두'), KINDS.map(function (k) { return h('option', { value: k }, k); }));
    var st = h('select', { 'aria-label': '상태로 거르기' }, h('option', { value: '' }, '상태 모두'),
      Object.keys(STATUS).map(function (k) { return h('option', { value: k }, STATUS[k]); }));
    var body = h('tbody');
    var count = h('span', { class: 'cnt' });
    // 찾는 낱말이 들어 있는 곳을 형광으로(사람 찾기 245)
    function hit(text, w) {
      var i = w ? text.toLowerCase().indexOf(w) : -1;
      return i === -1 ? text : [text.slice(0, i), h('mark', { class: 'hit' }, text.slice(i, i + w.length)), text.slice(i + w.length)];
    }
    var firstDraw = true;
    function draw() {
      var w = find.value.trim().toLowerCase();
      var list = members.filter(function (p) {
        return (!w || p.display_name.toLowerCase().indexOf(w) !== -1 || p.username.indexOf(w) !== -1) &&
          (!kind.value || p.kind === kind.value) && (!st.value || p.status === st.value);
      });
      if (firstDraw) count.replaceChildren(num(list.length), '명'); else count.textContent = list.length + '명';
      var rows = list.map(function (p) {
        var isMe = p.id === ctx.s.user.id;
        return h('tr', {},
          h('th', { scope: 'row' }, h('a', { class: 'mem-who', href: link({ tab: 'members', u: p.id }) }, face(p.display_name, ROLE_TONE[p.role]),
            h('span', { class: 'mem-name' }, hit(p.display_name, w)), isMe ? pill('나', 'navy') : null, p.withdraw_requested ? pill('탈퇴 요청', 'err') : null)),
          h('td', { class: 'mem-id' }, hit(p.username, w)), h('td', {}, pill(p.kind, KIND_TONE[p.kind])),
          h('td', {}, pill(ROLE[p.role] || p.role, ROLE_TONE[p.role])),
          h('td', {}, pill(STATUS[p.status] || p.status, STATUS_TONE[p.status])),
          h('td', {}, p.person_no ? pill('등록', 'ok') : pill('미등록', 'mute')));
      });
      body.replaceChildren.apply(body, rows.length ? rows : [h('tr', {}, h('td', { colspan: 6, class: 'mem-none' }, '찾는 회원이 없습니다. 이름 일부나 아이디로 다시 찾아보십시오.'))]);
      if (firstDraw) rise(rows);
      firstDraw = false;
    }
    [find, kind, st].forEach(function (x) { x.addEventListener('input', draw); });
    root.appendChild(h('div', { class: 'admin-filter mem-filter' }, h('span', { class: 'find-wrap' }, h('span', { class: 'find-ico', 'aria-hidden': 'true' }), find), kind, st));
    root.appendChild(h('div', { class: 'admin-sec-h' }, h('h3', { class: 'admin-h' }, '회원 ', count),
      pend ? h('p', { class: 'muted' }, '승인 대기 ' + pend + '명은 \'할 일\' 탭에 있습니다.') : null));
    root.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl admin-table mem-table' },
      h('thead', {}, h('tr', {}, ['이름', '아이디', '구분', '등급', '상태', '구성원 명단'].map(function (t) { return h('th', { scope: 'col' }, t); }))),
      body)));
    draw();
  }

  async function memberDetail(ctx, p) {
    var root = ctx.root, api = ctx.api, isMe = p.id === ctx.s.user.id;
    var email = await api.memberEmail(p.id);
    var data = await api.siteLoad(), T = window.LabSiteTables;
    var cards = [];
    ['people', 'alumni'].forEach(function (name) {
      T.rows(T.parse(data.texts[name])).forEach(function (row) {
        cards.push({ no: row['번호'], label: data.rules.tables[name].label + ' · ' + row['이름'] + (row['과정'] ? ' · ' + row['과정'] : row['졸업 연도'] ? ' · ' + row['졸업 연도'] : '') });
      });
    });
    var mine = cards.filter(function (c) { return c.no === String(p.person_no); })[0];
    root.appendChild(h('p', { class: 'back' }, h('a', { href: link({ tab: 'members' }) }, '회원 목록으로')));
    // 머리: 큰 얼굴 + 이름 + 알약 + 사실 줄
    root.appendChild(glow(h('section', { class: 'md-head' },
      face(p.display_name, ROLE_TONE[p.role], true),
      h('div', { class: 'md-who' }, title('h2', 'md-name', p.display_name),
        h('p', { class: 'md-pills' }, pill(ROLE[p.role] || p.role, ROLE_TONE[p.role]), pill(STATUS[p.status] || p.status, STATUS_TONE[p.status]), pill(p.kind, KIND_TONE[p.kind]), isMe ? pill('나', 'navy') : null)),
      h('dl', { class: 'md-facts' },
        [['아이디', p.username], ['메일', email || '(없음)'], ['가입일', L.fmtDate(p.created_at).slice(0, 10) + (p.legacy ? ' · 기존 홈페이지에서 이전' : '')],
          ['구성원 명단', mine ? mine.label : '미등록'], ['CV 주소', p.cv_url || '없음']].map(function (r) {
          return h('div', {}, h('dt', {}, r[0]), h('dd', {}, r[1]));
        })))));

    var grid = h('div', { class: 'md-grid' });
    root.appendChild(grid);
    function panel(name, desc, kids, wide) {
      var el = h('section', { class: 'md-panel' + (wide ? ' is-wide' : '') }, h('h3', {}, name), desc ? h('p', { class: 'muted' }, desc) : null, kids);
      grid.appendChild(el);
      return el;
    }

    // 메일 바꾸기
    var mailIn = h('input', { type: 'email', maxlength: 120, value: email || '', autocomplete: 'off' });
    var v = verifyFields(), merr = h('div', { 'aria-live': 'polite' });
    var mbtn = h('button', { type: 'submit', class: 'btn btn-small' }, '메일 바꾸기');
    var mform = h('form', { class: 'form form-wide', novalidate: true }, h('label', {}, '새 메일', mailIn), v.el, merr, h('div', { class: 'btns' }, mbtn));
    mform.addEventListener('submit', async function (e) {
      e.preventDefault();
      var m = v.method();
      if (!m) { showError(ctx, L.userError(VERIFY_MISSING), merr); return; }
      merr.replaceChildren();
      L.btnState(mbtn, 'run');
      try { await api.setEmail(p.id, mailIn.value, m); L.btnState(mbtn, 'done'); flash('메일을 바꿨습니다. 기존 메일로 "메일이 바뀌었습니다" 알림이 갑니다.'); await wait(360); location.reload(); }
      catch (err) { L.btnState(mbtn, null); showError(ctx, err, merr); }
    });
    panel('메일 바꾸기', isMe ? null : '기존 메일로 알림이 갑니다.', isMe ? h('p', { class: 'muted' }, '내 계정의 메일은 다른 관리자가 바꿉니다.') : mform, true);

    // 구분
    var kindSel = h('select', { 'aria-label': '구분' }, KINDS.map(function (k) { return h('option', { value: k, selected: k === p.kind }, k); }));
    panel('구분', null,
      h('div', { class: 'btns' }, kindSel, btn('구분 바꾸기', act(ctx, function () { return api.setKind(p.id, kindSel.value); }, null, '구분을 바꿨습니다.'))));

    // 구성원 카드
    var used = {};
    ctx.people.forEach(function (x) { if (x.person_no && x.id !== p.id) used[String(x.person_no)] = x.display_name; });
    var cardSel = h('select', { 'aria-label': '연결할 명단 항목' }, h('option', { value: '' }, '항목 고르기'),
      cards.map(function (c) { return h('option', { value: c.no, disabled: !!used[c.no], selected: c.no === String(p.person_no) }, c.label + (used[c.no] ? ' (' + used[c.no] + ' 님과 연결됨)' : '')); }));
    panel('구성원 명단 연결', null,
      h('div', { class: 'btns' }, cardSel,
        btn('연결', act(ctx, function () { if (!cardSel.value) throw L.userError('연결할 항목을 골라 주십시오.'); return api.linkPerson(p.id, cardSel.value); }, null, '명단과 연결했습니다.')),
        p.person_no ? btn('연결 해제', act(ctx, function () { return api.linkPerson(p.id, null); }, null, '연결을 해제했습니다.'), 'btn-text') : null,
        !p.person_no ? btn('명단에 새로 등록', function () { go({ tab: 'site', t: 'people', new: '1', from: p.id }); }, 'btn-text') : null));

    // 비밀번호 · 잠금 · CV · 등급
    // '그 밖'은 넓게(혼자 반쪽만 차지해 오른쪽이 비지 않게)
    panel('그 밖', null,
      h('div', { class: 'btns' },
        btn('비밀번호 링크 보내기', act(ctx, function () { return api.sendReset(p.id); }, null, '비밀번호 링크를 보냈습니다' + (fake() ? '(아래 가짜 메일함).' : '.'))),
        isMe ? null : p.status === 'locked'
          ? btn('잠금 풀기', act(ctx, function () { return api.setStatus(p.id, 'active'); }, null, '잠금을 풀었습니다.'))
          : btn('잠그기', act(ctx, function () { return api.setStatus(p.id, 'locked'); },
            { title: p.display_name + ' 님 계정을 잠그시겠습니까?', body: '로그인은 되지만 회원 칸이 열리지 않습니다. [잠금 풀기]로 다시 열 수 있습니다.', ok: '잠그기', danger: true }, '잠갔습니다.'), 'btn-danger'),
        p.cv_url ? btn('CV 보기', function () { window.open(p.cv_url, '_blank', 'noopener'); }, 'btn-text') : null,
        p.cv_url ? btn('CV 주소 지우기', act(ctx, function () { return api.clearCv(p.id); },
          { title: p.display_name + ' 님의 CV 주소를 지우시겠습니까?', body: '본인이 다시 적기 전까지 공개 화면에서 CV가 빠집니다.', ok: '지우기', danger: true }, 'CV 주소를 지웠습니다.'), 'btn-text is-danger') : null,
        !isMe && p.role === 'admin' && !p.leaving_to ? btn('회원으로 바꾸기', act(ctx, withAssist(ctx, function () { return api.setRole(p.id, 'member'); }),
          { title: p.display_name + ' 님을 회원으로 바꾸시겠습니까?', body: '관리 화면을 더 쓰지 못합니다. 다시 관리자로 두려면 \'관리자\' 탭을 씁니다.', ok: '회원으로 바꾸기' }, '회원으로 바꿨습니다.'), 'btn-text') : null), true);
  }

  // ------------------------------------------------------------ 사이트 내용
  async function drawSite(ctx) {
    var root = ctx.root, api = ctx.api, T = window.LabSiteTables;
    var data = await api.siteLoad();
    var rules = data.rules, docs = {};
    Object.keys(data.texts).forEach(function (k) { docs[k] = T.parse(data.texts[k]); });
    var name = rules.tables[q('t')] ? q('t') : 'people';
    var t = rules.tables[name];
    root.appendChild(h('nav', { class: 'admin-subtabs only-narrow', 'aria-label': '고칠 표' }, h('ul', {}, TABLE_ORDER.filter(function (k) { return rules.tables[k]; }).map(function (k) {
      return h('li', {}, h('a', { href: link({ tab: 'site', t: k }), 'aria-current': k === name ? 'page' : null }, rules.tables[k].label));
    }))));
    if (fake()) root.appendChild(h('p', { class: 'preview-note' }, pill('미리 보기', 'warn'),
      ' 저장하면 이 브라우저 안에만 남고 공개 화면 미리 보기는 바뀌지 않습니다. 진짜 서버를 연결하면 저장 뒤 1~2분이면 공개 화면에 보입니다.'));
    root.appendChild(helpBox(TABLE_HELP[name] || []));
    var ctx2 = { ctx: ctx, data: data, docs: docs, rules: rules, name: name, t: t, rows: T.rows(docs[name]) };
    if (q('new')) return rowForm(ctx2, null);
    if (q('edit') !== null) return rowForm(ctx2, Number(q('edit')));
    if (q('grad') !== null && name === 'people') return gradForm(ctx2, Number(q('grad')));
    return siteList(ctx2);
  }

  function rowTitle(name, r) {
    if (name === 'people') return r['이름'];
    if (name === 'alumni') return r['이름'];
    if (name === 'news') return r['제목'];
    if (name === 'projects') return r['과제'];
    return r['과목 이름'];
  }
  function rowMeta(name, r) {
    if (name === 'people') return [r['역할'], r['메일'] && r['메일 공개'] !== '아니오' ? r['메일'] : '메일 안 보임', r['사진'] ? '사진 있음' : null].filter(Boolean).join(' · ');
    if (name === 'alumni') return [r['학위'], r['지금 소속']].filter(Boolean).join(' · ');
    if (name === 'news') return [r['날짜'], r['갈래'], r['첫 화면에'] === '아니오' ? '첫 화면에 안 보임' : null].filter(Boolean).join(' · ');
    if (name === 'projects') return r['진행 중'] === '예' ? '진행 중' : '';
    return [r['학기'], r['그림'] ? '그림: ' + r['그림'] : null].filter(Boolean).join(' · ');
  }
  // 줄 오른쪽 알약(색 점 + 낱말): 졸업생 학위 · 소식 첫 화면 · 수행연구 진행 중
  function rowPills(name, r) {
    if (name === 'alumni') return r['학위'] ? pill(r['학위'], r['학위'] === '박사' ? 'gold' : 'navy') : null;
    if (name === 'news') return r['첫 화면에'] === '아니오' ? pill('첫 화면에 안 보임', 'mute') : pill('첫 화면에 보임', 'ok');
    if (name === 'projects') return r['진행 중'] === '예' ? pill('진행 중', 'ok') : pill('끝남', 'mute');
    return null;
  }

  // 표의 줄 목록(구성원은 과정별, 졸업생 · 수행연구는 해마다, 소식은 날짜 내림)
  function siteList(c) {
    var root = c.ctx.root, name = c.name, rows = c.rows.map(function (r, i) { return { r: r, i: i }; });
    var addLabel = { people: '새 학생 더하기', alumni: '졸업생 더하기', news: '소식 더하기', projects: '수행연구 더하기', courses: '교과목 더하기' }[name];
    root.appendChild(h('div', { class: 'site-top' },
      h('p', { class: 'site-total' }, h('b', {}, num(rows.length)), name === 'projects' || name === 'news' || name === 'courses' ? '개' : '명', h('span', { class: 'muted' }, ' · 공개 화면 ' + c.t.label)),
      h('div', { class: 'btns' }, h('a', { class: 'btn', href: link({ tab: 'site', t: name, new: '1' }) }, addLabel),
        h('a', { class: 'btn btn-ghost', href: c.t.page, target: '_blank', rel: 'noopener' }, '공개 화면 열기'))));
    var groups = [];
    function groupBy(key, order) {
      var m = {};
      rows.forEach(function (x) { var g = x.r[key] || '(비어 있음)'; (m[g] = m[g] || []).push(x); });
      var keys = Object.keys(m);
      keys.sort(order);
      keys.forEach(function (k) { groups.push([k, m[k]]); });
    }
    if (name === 'people') groupBy('과정', function (a, b) { var ch = c.t.columns[0].choices; return ch.indexOf(a) - ch.indexOf(b); });
    else if (name === 'alumni') groupBy('졸업 연도', function (a, b) { return b.localeCompare(a); });
    else if (name === 'projects') groupBy('연도', function (a, b) { return b.localeCompare(a); });
    else if (name === 'news') { rows.sort(function (a, b) { return b.r['날짜'].localeCompare(a.r['날짜']); }); groups.push(['', rows]); }
    else groups.push(['', rows]);

    var find = null;
    if (rows.length > 30) {
      find = h('input', { type: 'search', placeholder: '찾기', 'aria-label': c.t.label + ' 찾기' });
      root.appendChild(h('div', { class: 'admin-filter mem-filter' }, h('span', { class: 'find-wrap' }, h('span', { class: 'find-ico', 'aria-hidden': 'true' }), find)));
    }
    var lists = [], items = [];
    groups.forEach(function (g) {
      if (g[0]) root.appendChild(section(g[0], g[1].length, name === 'projects' ? '건' : '명'));
      if (g[1].length) root.appendChild(rowHead(c));
      var lis = g[1].map(function (x, k) { var li = glow(rowItem(c, x, g[1][k - 1], g[1][k + 1])); items.push(li); return li; });
      var ul = h('ul', { class: 'site-rows t-' + name }, lis);
      lists.push(ul);
      root.appendChild(ul);
    });
    rise(items);
    if (!rows.length) root.appendChild(h('p', { class: 'empty' }, '아직 없습니다. [' + addLabel + ']로 첫 줄을 더합니다.'));
    if (find) find.addEventListener('input', function () {
      var w = find.value.trim().toLowerCase();
      lists.forEach(function (ul) { Array.prototype.forEach.call(ul.children, function (li) { li.hidden = !!w && li.textContent.toLowerCase().indexOf(w) === -1; }); });
    });
  }

  function rowItem(c, x, prev, next) {
    var ctx = c.ctx, name = c.name, r = x.r;
    var photoDir = c.t.photo_dir;
    // 되돌릴 수 있는 고침(순서 · 빼기)은 묻지 않고 하고, 알림의 [되돌리기]로 되돌린다
    function save(changes, extra, ok) {
      return act(ctx, function () { return ctx.api.siteSave(changes, extra || {}); }, null, ok, true);
    }
    var editHref = link({ tab: 'site', t: name, edit: String(x.i) });
    var title0 = rowTitle(name, r);
    function arrow(dir, other) {
      var label = dir === 'up' ? '위로' : '아래로';
      if (!other) return h('span', { class: 'arw-none', 'aria-hidden': 'true' });
      return h('button', { type: 'button', class: 'btn-arw is-' + dir, 'aria-label': title0 + ' ' + label, title: label,
        onclick: save([{ table: name, op: 'move', index: x.i, to: other.i, expect: r }], null, title0 + ' 줄 순서를 바꿨습니다.') }, h('span', { class: 'sr-only' }, label));
    }
    var moreMenu = h('details', { class: 'row-more' }, h('summary', { class: 'btn btn-small btn-text' }, '더 보기'),
      h('div', { class: 'row-more-menu' },
        name === 'people' ? h('a', { href: link({ tab: 'site', t: name, grad: String(x.i) }) }, h('span', { class: 'mi-ico is-grad', 'aria-hidden': 'true' }), '졸업생으로 옮기기') : null,
        h('button', { type: 'button', class: 'is-danger', onclick: save([{ table: name, op: 'remove', index: x.i, expect: r }],
          { removePhotos: photoDir && r['사진'] ? [photoDir + '/' + r['사진']] : [] }, '\'' + title0 + '\' 줄을 뺐습니다.') },
          h('span', { class: 'mi-ico is-out', 'aria-hidden': 'true' }), '빼기'),
        h('p', { class: 'row-more-note' }, '빼거나 옮긴 뒤에도 알림의 [되돌리기]로 되돌릴 수 있습니다.')));
    var nameCell = h('a', { class: 'sr-name', href: editHref },
      name === 'people' || name === 'alumni' ? face(title0, name === 'people' ? KIND_TONE['재학'] : KIND_TONE['졸업']) : null,
      h('span', { class: 'site-row-name' }, title0));
    var cells;
    if (name === 'people') {
      var shown = r['메일'] && r['메일 공개'] !== '아니오';
      cells = [h('span', { class: 'sr-c sr-role' }, r['역할'] ? pill(r['역할'], 'gold') : null),
        h('span', { class: 'sr-c sr-mail' + (shown ? '' : ' muted') }, shown ? r['메일'] : pill('메일 안 보임', 'mute')),
        h('span', { class: 'sr-c sr-photo' }, r['사진'] ? pill('사진 있음', 'ok') : pill('사진 없음', 'mute'))];
    } else {
      var meta = name === 'alumni' ? r['지금 소속'] : name === 'news' ? [r['날짜'], r['갈래']].filter(Boolean).join(' · ') : name === 'projects' ? '' : rowMeta(name, r);
      cells = [h('span', { class: 'sr-c sr-meta' }, meta ? h('span', { class: 'muted' }, meta) : null, rowPills(name, r))];
    }
    return h('li', { class: 'site-row' }, nameCell, cells,
      c.t.orderable ? h('span', { class: 'sr-c sr-order' }, arrow('up', prev), arrow('down', next)) : null,
      h('span', { class: 'sr-c sr-acts' }, h('a', { class: 'btn btn-small btn-ghost', href: editHref }, '고치기'), moreMenu));
  }
  function rowHead(c) {
    var cols = c.name === 'people' ? ['이름', '역할', '메일', '사진'] : [c.name === 'news' ? '제목' : c.name === 'projects' ? '과제' : c.name === 'courses' ? '과목' : '이름', '내용'];
    if (c.t.orderable) cols.push('순서');
    cols.push('');
    return h('div', { class: 'site-rows-head t-' + c.name, 'aria-hidden': 'true' }, cols.map(function (t) { return h('span', {}, t); }));
  }

  // 칸 하나의 입력: 규칙(kind)대로 고르기 · 날짜 · 켜고 끄기 · 긴 글. 틀리면 그 칸 아래 이유
  function fieldFor(c, col, value, onChange) {
    var id = 'f-' + Math.random().toString(36).slice(2, 8), errId = id + '-e';
    var input, get;
    if (col.kind === 'choice') {
      // 꼭 적을 칸 · 처음 값이 있는 칸(메일 공개 · 첫 화면에)은 '(비움)'을 두지 않는다
      input = h('select', { id: id }, col.required || col.default ? null : h('option', { value: '' }, '(비움)'),
        col.choices.map(function (v) { return h('option', { value: v, selected: v === (value || col.default || '') }, v); }));
      get = function () { return input.value; };
    } else if (col.kind === 'flag') {
      input = h('input', { id: id, type: 'checkbox', checked: value === '예' });
      get = function () { return input.checked ? '예' : ''; };
    } else if (col.kind === 'long') {
      input = h('textarea', { id: id, rows: col.max > 400 ? 8 : 3, maxlength: col.max || 3000 });
      input.value = value || '';
      // 줄 바꿈은 표에 넣을 수 없어 빈칸으로 바꾼다
      input.addEventListener('input', function () { if (/[\r\n]/.test(input.value)) input.value = input.value.replace(/[\r\n]+/g, ' '); });
      get = function () { return input.value.trim(); };
    } else {
      var type = { date: 'date', email: 'email', https: 'url', link: 'url', year: 'text' }[col.kind] || 'text';
      input = h('input', { id: id, type: type, value: value || '', maxlength: col.max || 200,
        inputmode: col.kind === 'year' ? 'numeric' : null, placeholder: col.kind === 'year' ? '예: 2026' : (col.kind === 'https' || col.kind === 'link') ? 'https://' : null,
        list: col.suggest ? id + '-l' : null, readonly: col.kind === 'number' || col.kind === 'file' });
      get = function () { return input.value.trim(); };
    }
    input.setAttribute('aria-describedby', errId);
    var err = h('span', { class: 'field-err', id: errId });
    var dl = col.suggest ? h('datalist', { id: id + '-l' }, col.suggest.map(function (v) { return h('option', { value: v }); })) : null;
    var label = col.kind === 'flag'
      ? h('label', { class: 'check', for: id }, input, ' ' + col.name)
      : h('label', { for: id }, col.name + (col.required ? ' (꼭)' : ''), col.hint ? h('span', { class: 'hint' }, col.hint) : null, input, dl);
    function check() {
      var msg = window.LabSiteTables.checkCell(c.rules, col, get());
      err.textContent = msg || '';
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      return !msg;
    }
    input.addEventListener('input', function () { check(); if (onChange) onChange(); });
    input.addEventListener('change', function () { check(); if (onChange) onChange(); });
    return { el: h('div', { class: 'field' }, label, err), get: get, check: check, input: input, col: col };
  }

  // 구성원 사진: 세로 4:5 JPEG(upload.js, 내 정보 사진 요청과 같이 씀)
  function portrait(file) { return window.LabUpload.portrait(file); }

  // 공개 화면 구성원 카드와 같은 모양(build.py person_card)
  function personPreview(row, photoUrl) {
    var pic = photoUrl ? h('img', { class: 'ph', src: photoUrl, alt: '', width: 120, height: 150 })
      : h('span', { class: 'ph ph-none', 'aria-hidden': 'true' }, (row['이름'] || '?').slice(0, 1));
    var rows = [];
    if (L.keywordList(row['관심 분야'])) rows.push(['관심 분야', L.keywordList(row['관심 분야'])]);
    if (row['메일'] && row['메일 공개'] !== '아니오') rows.push(['메일', row['메일']]);
    return h('article', { class: 'person' + (row['역할'] ? ' has-role' : '') }, pic,
      h('div', {}, h('h3', {}, row['이름'] || '(이름)', row['영문 이름'] ? h('span', { class: 'en', lang: 'en' }, ' ' + row['영문 이름']) : null,
        row['역할'] ? h('span', { class: 'role' }, ' ' + row['역할']) : null),
      rows.length ? h('dl', { class: 'pf' }, rows.map(function (x) { return h('div', {}, h('dt', {}, x[0]), h('dd', {}, x[1])); })) : null));
  }

  async function rowForm(c, index) {
    var ctx = c.ctx, api = ctx.api, root = ctx.root, name = c.name, t = c.t, T = window.LabSiteTables;
    var old = index === null ? null : c.rows[index];
    if (index !== null && !old) { root.appendChild(L.notice('고칠 줄을 찾지 못했습니다. 목록에서 다시 골라 주십시오.', 'error')); return; }
    var start = old ? Object.assign({}, old) : {};
    var from = !old && q('from') ? ctx.people.filter(function (p) { return p.id === q('from'); })[0] : null;
    if (from && name === 'people') {
      var ch = t.columns[0].choices;
      start['과정'] = ch.indexOf(from.course) !== -1 ? from.course : ch[ch.length - 1];
      start['이름'] = from.display_name;
      start['메일'] = from.show_email ? await api.memberEmail(from.id) : '';
      start['메일 공개'] = '보임';   // 번호는 저장할 때 서버가 새로 붙이고, 그 번호로 이 회원과 잇는다
    }
    var heading = old ? rowTitle(name, old) + ' 고치기' : (from ? from.display_name + ' 님 명단 등록' : t.label + ' 더하기');
    root.appendChild(h('p', { class: 'back' }, h('a', { href: link({ tab: 'site', t: name }) }, t.label + ' 목록으로')));
    root.appendChild(title('h2', 'admin-h form-title', heading));
    if (from) root.appendChild(h('div', { class: 'draft-note' }, pill('초안 · 아직 공개 전', 'warn'),
      h('p', {}, '가입 신청을 승인했습니다. 아래 초안을 확인하고 [저장]해야 구성원 화면에 올라갑니다. ' +
        (from.show_email ? '메일은 본인이 공개에 동의해 넣었습니다.' : '본인이 메일 공개에 동의하지 않아 메일은 비웠습니다.'))));

    var preview = name === 'people' ? h('div', { class: 'site-preview' }) : null;
    var photoBlob = null, photoUrl = null, photoRemoved = false;
    if (old && old['사진'] && t.photo_dir) photoUrl = await api.sitePhotoUrl(t.photo_dir + '/' + old['사진']);
    var fields = [];
    function values() {
      var v = {};
      fields.forEach(function (f) { v[f.col.name] = f.get(); });
      if (photoBlob) v['사진'] = '__new__';
      else if (photoRemoved) v['사진'] = '';
      else v['사진'] = start['사진'] || '';
      return v;
    }
    function redraw() { if (preview) preview.replaceChildren(h('p', { class: 'preview-cap' }, pill('공개 화면에서 이렇게 보입니다', 'navy')), personPreview(values(), photoUrl)); }
    t.columns.forEach(function (col) {
      if (col.kind === 'photo') return;
      if (col.kind === 'number' && !start[col.name]) return;
      if (col.kind === 'file' && !start[col.name]) return;
      fields.push(fieldFor(c, col, start[col.name], redraw));
    });

    var photoCol = t.columns.filter(function (x) { return x.kind === 'photo'; })[0];
    var photoBox = null;
    if (photoCol && t.photo_dir) {
      var pin = h('input', { type: 'file', accept: window.LabUpload ? window.LabUpload.accept.photo : 'image/*' });
      var pmsg = h('span', { class: 'field-err' });
      var rm = h('button', { type: 'button', class: 'btn btn-small btn-ghost', hidden: !photoUrl }, '사진 빼기');
      pin.addEventListener('change', async function () {
        pmsg.textContent = '';
        if (!pin.files[0]) return;
        try { photoBlob = await portrait(pin.files[0]); photoUrl = URL.createObjectURL(photoBlob); photoRemoved = false; rm.hidden = false; redraw(); }
        catch (err) { pmsg.textContent = L.errText(err); pin.value = ''; }
      });
      rm.addEventListener('click', function () { photoBlob = null; photoUrl = null; photoRemoved = true; pin.value = ''; rm.hidden = true; redraw(); });
      photoBox = h('div', { class: 'field' }, h('label', {}, '사진', photoCol.hint ? h('span', { class: 'hint' }, photoCol.hint + '. 올리면 세로 4:5로 가운데를 잘라 줄입니다') : null, pin),
        h('div', { class: 'btns' }, rm), pmsg);
    }

    var saveBtn = h('button', { type: 'submit', class: 'btn' }, '저장');
    var ferr = h('div', { 'aria-live': 'polite' });
    var form = h('form', { class: 'form form-wide site-form', novalidate: true }, fields.map(function (f) { return f.el; }), photoBox, ferr,
      h('div', { class: 'btns form-go' }, saveBtn, h('a', { class: 'btn btn-text', href: link({ tab: 'site', t: name }) }, '취소')));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var bad = fields.filter(function (f) { return !f.check(); });
      if (bad.length) { bad[0].input.focus(); showError(ctx, L.userError('빨간 글이 있는 칸을 고쳐 주십시오.'), ferr); return; }
      ferr.replaceChildren();
      var v = values(), extra = { photos: [], removePhotos: [] };
      if (photoBlob) {
        var file = (v['번호'] || start['번호'] || 'p') + '-' + Date.now().toString(36) + '.jpg';
        v['사진'] = file;
        extra.photos.push({ path: t.photo_dir + '/' + file, blob: photoBlob });
      }
      if (old && old['사진'] && (photoBlob || photoRemoved)) extra.removePhotos.push(t.photo_dir + '/' + old['사진']);
      if (from) extra.link = { user_id: from.id };
      var change = old ? { table: name, op: 'edit', index: index, row: v, expect: old } : { table: name, op: 'add', row: v };
      L.btnState(saveBtn, 'run');
      try {
        var r = await api.siteSave([change], extra);
        L.btnState(saveBtn, 'done');
        flash(r && r.nothing ? '바뀐 것이 없습니다.' : savedText(t), r && r.log_id);
        await wait(360);
        go({ tab: 'site', t: name });
      } catch (err) { L.btnState(saveBtn, null); showError(ctx, err, ferr); }
    });
    root.appendChild(preview ? h('div', { class: 'site-edit' }, form, preview) : form);
    redraw();
  }

  function savedText(t) {
    return fake() ? '저장했습니다(미리 보기: 이 브라우저 안에만). 진짜 서버에서는 1~2분 뒤 공개 화면 ' + t.label + '에 보입니다.'
      : '저장했습니다. 공개 화면 ' + t.label + '에는 1~2분 뒤 보입니다.';
  }

  // 졸업생으로 옮기기: 한 번 저장으로 구성원에서 빼고 졸업생에 더함(번호 그대로), 연결된 회원 계정의 구분은 '졸업'
  function gradForm(c, index) {
    var ctx = c.ctx, root = ctx.root, p = c.rows[index];
    if (!p) { root.appendChild(L.notice('옮길 사람을 찾지 못했습니다. 목록에서 다시 골라 주십시오.', 'error')); return; }
    var at = c.rules.tables.alumni, linked = ctx.people.filter(function (u) { return p['번호'] && String(u.person_no) === p['번호']; })[0];
    var start = { '학위': p['과정'] === '박사과정' ? '박사' : '석사', '졸업 연도': String(new Date().getFullYear()), '이름': p['이름'] };
    var fields = at.columns.filter(function (col) { return ['학위', '졸업 연도', '이름', '지금 소속', '학위논문'].indexOf(col.name) !== -1; })
      .map(function (col) { return fieldFor({ rules: c.rules }, col, start[col.name] || ''); });
    root.appendChild(h('p', { class: 'back' }, h('a', { href: link({ tab: 'site', t: 'people' }) }, '구성원 목록으로')));
    root.appendChild(title('h2', 'admin-h form-title', p['이름'] + ' 님 졸업생으로 옮기기'));
    // 저장 한 번에 일어나는 일(구성원 → 졸업생 흐름)
    root.appendChild(h('div', { class: 'grad-flow' },
      h('div', { class: 'grad-step' }, face(p['이름'], 'navy'), h('p', {}, h('b', {}, '구성원'), h('span', {}, p['과정'] || ''))),
      h('span', { class: 'grad-arrow', 'aria-hidden': 'true' }),
      h('div', { class: 'grad-step' }, face(p['이름'], 'gold'), h('p', {}, h('b', {}, '졸업생'), h('span', {}, '학문 가계도에 더함'))),
      h('ul', { class: 'grad-notes' },
        h('li', {}, pill('옮김', 'ok'), ' 구성원 화면에서 빼고 졸업생 화면(학문 가계도)에 더합니다.'),
        p['사진'] ? h('li', {}, pill('지움', 'warn'), ' 구성원 사진은 옮기지 않고 지웁니다(졸업생 사진은 따로 올립니다).') : null,
        linked ? h('li', {}, pill('바뀜', 'navy'), ' 연결된 회원 계정(아이디 ' + linked.username + ')의 구분을 \'졸업\'으로 바꿉니다.') : h('li', {}, pill('그대로', 'mute'), ' 연결된 회원 계정이 없습니다(구분은 그대로).'),
        h('li', {}, pill('되돌리기', 'mute'), ' 옮긴 뒤 알림의 [되돌리기]로 한 번에 되돌릴 수 있습니다.'))));
    var saveBtn = h('button', { type: 'submit', class: 'btn' }, '옮기기');
    var ferr = h('div', { 'aria-live': 'polite' });
    var form = h('form', { class: 'form form-wide', novalidate: true }, fields.map(function (f) { return f.el; }), ferr,
      h('div', { class: 'btns form-go' }, saveBtn, h('a', { class: 'btn btn-text', href: link({ tab: 'site', t: 'people' }) }, '취소')));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var bad = fields.filter(function (f) { return !f.check(); });
      if (bad.length) { bad[0].input.focus(); showError(ctx, L.userError('빨간 글이 있는 칸을 고쳐 주십시오.'), ferr); return; }
      ferr.replaceChildren();
      var row = { '번호': p['번호'] };
      fields.forEach(function (f) { row[f.col.name] = f.get(); });
      L.btnState(saveBtn, 'run');
      try {
        var r = await ctx.api.siteSave([{ table: 'people', op: 'remove', index: index, expect: p }, { table: 'alumni', op: 'add', row: row }],
          { removePhotos: p['사진'] ? [c.t.photo_dir + '/' + p['사진']] : [], kind: linked ? { user_id: linked.id, kind: '졸업' } : null });
        L.btnState(saveBtn, 'done');
        flash(p['이름'] + ' 님을 졸업생으로 옮겼습니다. ' + (fake() ? '(미리 보기: 이 브라우저 안에만)' : '공개 화면에는 1~2분 뒤 보입니다.'), r && r.log_id);
        await wait(360);
        go({ tab: 'site', t: 'alumni' });
      } catch (err) { L.btnState(saveBtn, null); showError(ctx, err, ferr); }
    });
    root.appendChild(form);
  }

  // ------------------------------------------------------------ 관리자(조교)
  // 11-02 연구자: "나는 일단 쭉 갈거니까 1명하고 다음학기부터는 공동관리자를 위임할 수 있는 형태로".
  // "관리자 넘기기가 사실 조교한테 넘기는 거니까 거기서 하면 그 사람만 조교 표시". 관리자 = 조교:
  // 관리자가 바뀔 때마다 구성원 표 '역할'의 '조교'를 관리자(넘겨주는 중인 사람은 빼고)의 명단 항목에만 남긴다
  async function syncTaRole(ctx) {
    var api = ctx.api, T = window.LabSiteTables;
    var people = await api.adminProfiles();
    var assist = {};
    people.forEach(function (p) { if (p.role === 'admin' && !p.leaving_to && p.person_no) assist[String(p.person_no)] = true; });
    var data = await api.siteLoad(), changes = [];
    T.rows(T.parse(data.texts.people)).forEach(function (row, i) {
      var want = assist[row['번호']] ? '조교' : (row['역할'] === '조교' ? '' : row['역할']);
      if ((row['역할'] || '') !== (want || '')) changes.push({ table: 'people', op: 'edit', index: i, row: Object.assign({}, row, { '역할': want }), expect: row });
    });
    if (changes.length) await api.siteSave(changes, {});
  }
  // 관리자를 바꾸는 일 뒤에 조교 표시를 맞춘다. 표를 못 고쳐도 관리자 바꾸기는 끝난 것이라 알림만 남긴다
  function withAssist(ctx, fn) {
    return async function () {
      var r = await fn();
      try { await syncTaRole(ctx); } catch (err) { L.toast('관리자는 바꿨지만 구성원 화면의 조교 표시를 맞추지 못했습니다. 사이트 내용 > 구성원에서 \'역할\'을 고쳐 주십시오.', { kind: 'error', ms: 12000 }); }
      return r;
    };
  }

  function drawHandover(ctx) {
    var root = ctx.root, api = ctx.api, meId = ctx.s.user.id;
    var admins = ctx.people.filter(function (p) { return p.role === 'admin'; });
    var nameOf = function (id) { var x = ctx.people.filter(function (p) { return p.id === id; })[0]; return x ? x.display_name : '?'; };
    root.appendChild(section('지금 관리자', admins.length, '명'));
    var rows = admins.map(function (p) {
      var incoming = ctx.people.filter(function (x) { return x.leaving_to === p.id; })[0];
      return glow(h('li', { class: 'adm-row' }, face(p.display_name, 'gold'),
        h('div', { class: 'adm-who' }, h('b', {}, p.display_name), h('span', { class: 'muted' }, '아이디 ' + p.username)),
        h('span', { class: 'adm-pills' }, p.id === meId ? pill('나', 'navy') : null,
          p.leaving_to ? pill(nameOf(p.leaving_to) + ' 님에게 넘기는 중', 'warn') : incoming ? pill('넘겨받는 중 · 인증 앱 등록 전', 'warn') : pill('조교', 'gold')),
        p.id !== meId && !p.leaving_to && !incoming ? btn('위임 해제', act(ctx, withAssist(ctx, function () { return api.setRole(p.id, 'member'); }),
          { title: p.display_name + ' 님의 공동관리자 위임을 해제하시겠습니까?', body: '관리 화면을 더 쓰지 못하고, 구성원 화면의 조교 표시도 빠집니다.', ok: '위임 해제' }, '위임을 해제했습니다.'), 'btn-text') : h('span', {})));
    });
    root.appendChild(h('ul', { class: 'adm-list' }, rows));
    rise(rows);
    var mine = ctx.people.filter(function (p) { return p.id === meId; })[0];
    var cands = ctx.people.filter(function (p) { return p.role === 'member' && p.status === 'active'; });
    var opt = function (p) { return h('option', { value: p.id }, p.display_name + ' (아이디 ' + p.username + ' · ' + p.kind + ')'); };
    if (mine && mine.leaving_to) {
      root.appendChild(h('div', { class: 'hand-wait' }, pill('넘기는 중', 'warn'),
        h('p', {}, nameOf(mine.leaving_to) + ' 님이 인증 앱을 등록하면 넘기기가 끝나고, 나는 회원이 됩니다.'),
        btn('넘기기 취소', act(ctx, withAssist(ctx, function () { return api.cancelHandover(); }),
          { title: '넘기기를 취소하시겠습니까?', body: nameOf(mine.leaving_to) + ' 님은 다시 회원이 됩니다.', ok: '넘기기 취소' }, '넘기기를 취소했습니다.'), 'btn-ghost')));
    } else {
      // 공동관리자 위임: 관리자가 1명일 때만(서버도 2명까지만 허락)
      if (admins.length < 2) {
        var sel2 = h('select', { 'aria-label': '공동관리자로 위임할 회원' }, h('option', { value: '' }, '회원 고르기'), cands.map(opt));
        var hb2 = btn('위임', function (e) {
          if (!sel2.value) { showError(ctx, L.userError('위임할 회원을 골라 주십시오.')); sel2.focus(); return; }
          act(ctx, withAssist(ctx, function () { return api.setRole(sel2.value, 'admin'); }),
            { title: nameOf(sel2.value) + ' 님을 공동관리자로 위임하시겠습니까?', body: '나는 그대로 관리자로 남습니다. 그분은 처음 들어올 때 인증 앱을 등록합니다.', ok: '위임' }, '공동관리자로 위임했습니다.')(e);
        }, 'btn-ghost');
        root.appendChild(h('section', { class: 'hand-box' }, h('h3', { class: 'admin-h' }, '공동관리자 위임'),
          h('p', { class: 'muted' }, '나는 계속 관리자입니다.'),
          h('div', { class: 'btns' }, sel2, hb2)));
      }
      var sel = h('select', { 'aria-label': '넘겨받을 회원' }, h('option', { value: '' }, '회원 고르기'), cands.map(opt));
      var hb = h('button', { type: 'button', class: 'btn btn-ghost' }, '넘기기');
      hb.addEventListener('click', function (e) {
        if (!sel.value) { showError(ctx, L.userError('넘겨받을 회원을 골라 주십시오.')); sel.focus(); return; }
        act(ctx, withAssist(ctx, function () { return api.handover(sel.value); }),
          { title: nameOf(sel.value) + ' 님에게 관리자를 넘기시겠습니까?', body: '그분이 인증 앱을 등록하면 나는 회원이 됩니다. 그 전까지는 나도 관리자입니다.', ok: '넘기기' },
          '넘기기를 시작했습니다. 새 관리자가 인증 앱을 등록하면 끝납니다.')(e);
      });
      root.appendChild(h('section', { class: 'hand-box is-quiet' }, h('h3', { class: 'admin-h' }, '관리자 넘기기'),
        h('p', { class: 'muted' }, '새 관리자가 인증 앱을 등록하면 나는 회원이 됩니다.'),
        h('div', { class: 'btns' }, sel, hb)));
    }
    // 사이트 밖에서 넘길 것: 체크 목록(이 브라우저에만 기억)
    var OUT = [['회원 칸 서버(Supabase)', '연구실 조직에 새 조교를 구성원으로 더하고, 나는 빠집니다.'],
      ['연구실 GitHub 조직', '새 조교를 소유자로 더하고(2단계 인증 필수), 나는 빠집니다.'],
      ['메일 발송 서비스 계정', '로그인 정보를 넘기고 비밀번호를 새로 바꿉니다.'],
      ['주소 heconpol.org(닷네임코리아)', '계정을 넘기고 만료일(2026-12-27, 자동 연장)을 확인합니다.'],
      ['연구실 구글 드라이브 백업 폴더', '새 조교에게 권한을 줍니다.'],
      ['인증 앱 복구 코드', '새 조교가 자기 것을 새로 만들어 종이에 적어 연구실에 둡니다(이전 조교의 코드는 폐기).']];
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('labHandoverOut') || '{}'); } catch (e) { saved = {}; }
    var done = h('span', { class: 'cnt' });
    function tally() { var n = OUT.filter(function (x) { return saved[x[0]]; }).length; done.textContent = n + ' / ' + OUT.length; }
    root.appendChild(h('div', { class: 'admin-sec-h' }, h('h3', { class: 'admin-h' }, '사이트 밖에서 넘길 것 ', done)));
    root.appendChild(h('ul', { class: 'out-list' }, OUT.map(function (x) {
      var cb = h('input', { type: 'checkbox', checked: !!saved[x[0]] });
      cb.addEventListener('change', function () { saved[x[0]] = cb.checked; try { localStorage.setItem('labHandoverOut', JSON.stringify(saved)); } catch (e) { /* 없어도 됨 */ } tally(); });
      return h('li', {}, h('label', { class: 'out-item' }, cb, h('span', { class: 'out-box', 'aria-hidden': 'true' }), h('span', { class: 'out-t' }, h('b', {}, x[0]), h('span', {}, x[1]))));
    })));
    tally();
  }

  // ------------------------------------------------------------ 기록
  async function drawLog(ctx) {
    var root = ctx.root, api = ctx.api;
    root.appendChild(helpBox(['같은 표를 그 뒤에 또 고쳤으면 [되돌리기]가 안 됩니다. [자세히]로 고치기 전 내용을 봅니다.']));
    var logs = await api.adminLog();
    var only = h('select', { 'aria-label': '기록 거르기' }, h('option', { value: '' }, '모두'), h('option', { value: 'site' }, '사이트 내용'), h('option', { value: 'member' }, '회원 · 그 밖'));
    var body = h('tbody');
    var PUB = { published: [fake() ? '공개됨 · 미리 보기' : '공개됨', 'ok'], waiting: ['기다리는 중', 'warn'], failed: ['실패', 'err'] };
    var firstDraw = true;
    function draw() {
      var trs = [];
      body.replaceChildren.apply(body, logs.filter(function (l) { return !only.value || (only.value === 'site') === !!l.site; }).slice(0, 100).map(function (l) {
        var detailRow = h('tr', { class: 'log-detail', hidden: true }, h('td', { colspan: 6 }));
        var tools = l.site ? h('span', { class: 'btns log-tools' },
          btn('자세히', async function (e) {
            detailRow.hidden = !detailRow.hidden;
            e.currentTarget.setAttribute('aria-expanded', String(!detailRow.hidden));
            if (!detailRow.hidden) await showDiff(api, l.id, detailRow.firstChild);
          }, 'btn-text'),
          !l.undone ? btn('되돌리기', async function (e) {
            var b = e.currentTarget; L.btnState(b, 'run');
            try { await api.siteUndo(l.id); L.btnState(b, 'done'); flash('되돌렸습니다.' + (fake() ? '' : ' 공개 화면에는 1~2분 뒤 보입니다.')); await wait(360); location.reload(); }
            catch (err) { L.btnState(b, null); showError(ctx, err); if (err.code === 'stale' || /그 뒤에/.test(L.errText(err))) { detailRow.hidden = false; await showDiff(api, l.id, detailRow.firstChild); } }
          }, 'btn-ghost') : pill('되돌림', 'mute')) : null;
        var pub = l.site ? (l.undone ? pill('되돌림', 'mute') : PUB[l.publish_state] ? pill(PUB[l.publish_state][0], PUB[l.publish_state][1]) : null) : null;
        var tr = h('tr', {}, h('td', { class: 'log-when num' }, L.fmtDate(l.created_at)),
          h('td', {}, h('span', { class: 'mem-who' }, face(l.admin_name, 'gold'), h('span', {}, l.admin_name))),
          h('td', { class: 'log-act' }, l.action), h('td', {}, [l.target, l.detail].filter(Boolean).join(' · ')),
          h('td', {}, pub), h('td', {}, tools));
        trs.push(tr);
        return [tr, detailRow];
      }).reduce(function (a, b) { return a.concat(b); }, []));
      if (firstDraw) rise(trs);
      firstDraw = false;
    }
    only.addEventListener('input', draw);
    root.appendChild(h('div', { class: 'admin-filter' }, only));
    root.appendChild(logs.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl admin-table log-table' },
      h('thead', {}, h('tr', {}, ['때', '관리자', '한 일', '내용', '공개', ''].map(function (t) { return h('th', { scope: 'col' }, t); }))), body)) : h('p', { class: 'empty' }, '아직 기록이 없습니다.'));
    draw();
  }

  // 고치기 전 · 뒤에서 바뀐 줄만 보여 준다
  async function showDiff(api, id, cell) {
    var d = await api.siteLogDetail(id), T = window.LabSiteTables;
    var parts = [];
    Object.keys(d.files).forEach(function (name) {
      var key = function (r) { return JSON.stringify(r); };
      var before = T.rows(T.parse(d.files[name].before)), after = T.rows(T.parse(d.files[name].after));
      var bset = {}, aset = {};
      before.forEach(function (r) { bset[key(r)] = true; });
      after.forEach(function (r) { aset[key(r)] = true; });
      var gone = before.filter(function (r) { return !aset[key(r)]; }), added = after.filter(function (r) { return !bset[key(r)]; });
      var line = function (r) { return Object.keys(r).filter(function (k) { return r[k]; }).map(function (k) { return k + ': ' + r[k]; }).join(' · '); };
      parts.push(h('div', { class: 'diff' }, h('p', { class: 'diff-h' }, h('b', {}, FILE_LABEL[name] || name)),
        gone.length ? h('div', { class: 'diff-side' }, pill('고치기 전', 'err'), h('ul', { class: 'diff-old' }, gone.map(function (r) { return h('li', {}, line(r)); }))) : null,
        added.length ? h('div', { class: 'diff-side' }, pill('고친 뒤', 'ok'), h('ul', { class: 'diff-new' }, added.map(function (r) { return h('li', {}, line(r)); }))) : null,
        !gone.length && !added.length ? h('p', { class: 'muted' }, '줄 순서만 바뀜') : null));
    });
    (d.photos || []).forEach(function (x) { parts.push(h('p', { class: 'muted' }, x.add ? '사진 더함: ' + x.add : '사진 지움: ' + x.remove)); });
    cell.replaceChildren.apply(cell, parts);
  }
})();
