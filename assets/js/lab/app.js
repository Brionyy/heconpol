// 회원 칸 화면들. 화면 이름은 HTML 의 data-lab-page 값이다.
(function () {
  'use strict';
  if (window.LAB_BLOCKED || !window.Lab) return;
  var L = window.Lab, h = L.h;

  function field(label, input, hint) {
    return h('label', {}, label, hint ? h('span', { class: 'hint' }, hint) : null, input);
  }
  // 시안 A3: 단추 상태 한 벌(대기 → 진행 → 체크, 취향 장부 22). on 이면 진행, 끝나면 busy(btn, false, true)로 체크
  function busy(btn, on, ok) { if (L.btnState) L.btnState(btn, on ? 'run' : ok ? 'done' : null); else btn.disabled = on; }
  function go(path) { location.assign(L.url(path)); }

  // ---------------------------------------------------------------- 시안 A3 회원 쪽 조각
  // 연구자(10-28): "내 취향을 상당히 많이 넣어놨는데 결국에는 그냥 claude가 만들어주는 디자인이랑 비슷한 거같아서".
  // 취향 장부(design/TASTE.md 9절)에서 '좋음'으로 고른 것: 판 위 마우스 빛 · 테두리 빛(13 · 14), 차례로 올라옴(17),
  // 흐림에서 또렷한 제목(19), 단계 세로 줄(요청 → 확인 → 링크), 이름 · 풀이 붙은 스위치, 끝난 화면은 체크가 그려지는 판
  function glow(el) { return L.glow ? L.glow(el) : el; }
  // 화면 머리: 뒤로 가기(선으로 그린 화살표, 글자 기호 아님) · 제목(흐림에서 또렷) · 한 줄 풀이
  function pageHead(title, lead, back) {
    return h('div', { class: 'm-head' },
      back ? h('a', { class: 'm-back', href: back[0] }, h('span', { class: 'm-back-arw', 'aria-hidden': 'true' }), back[1]) : null,
      h('h2', { class: 'm-title' }, title), lead ? h('p', { class: 'm-lead' }, lead) : null);
  }
  function panel(cls, kids) { return glow(h('section', { class: 'm-panel' + (cls ? ' ' + cls : '') }, kids)); }
  // 끝난 화면: 체크가 그려지는 판(찍기 도구 · 보안 글 때문에 notice is-ok 표시는 그대로 둔다)
  function doneCard(title, text, acts, extra) {
    return h('section', { class: 'notice is-ok m-done', role: 'status' },
      h('span', { class: 'm-done-mark', 'aria-hidden': 'true' }),
      h('h2', { class: 'm-done-h' }, title), h('p', { class: 'm-done-b' }, text), extra || null,
      acts ? h('div', { class: 'btns' }, acts) : null);
  }
  // 비밀번호 칸 아래 조건 체크(쓰는 대로 켜짐). 판단은 서버가 하고, 이것은 보기만.
  // 11-02 연구자 "비밀번호 10자 이상 아니어도 ㄱㅊ고 두 칸이 같지 않아도 괜찮아": 8자 이상, 확인 칸은 없앰
  function pwRules(p1) {
    var rules = [['8자 이상', function () { return p1.value.length >= 8; }], ['영문 섞기', function () { return /[A-Za-z]/.test(p1.value); }],
      ['숫자 섞기', function () { return /\d/.test(p1.value); }]];
    var lis = rules.map(function (r) { return h('li', {}, r[0]); });
    function check() { rules.forEach(function (r, i) { lis[i].classList.toggle('is-ok', !!r[1]()); }); }
    p1.addEventListener('input', check);
    return h('ul', { class: 'm-rules', 'aria-label': '비밀번호 조건' }, lis);
  }
  // 이름 · 풀이 붙은 스위치 줄(체크 칸을 스위치 모양으로, 뜻은 그대로 체크 칸)
  function switchRow(input, label, hint) {
    input.classList.add('m-switch');
    input.setAttribute('role', 'switch');
    return h('label', { class: 'check m-switch-row' }, input, h('span', { class: 'm-switch-t' }, h('b', {}, label), hint ? h('span', { class: 'hint' }, hint) : null));
  }

  // 구성원 소개 화면 메일 공개 동의(가입 신청, 11-02 연구자: "오피셜한 느낌으로 바꾸고 허가 했을 때 티가 더 나게").
  // 켜면 줄 전체가 옅은 금색 판 + 금색 테두리, 오른쪽 상태 꼬리표가 '비공개' → '공개 동의'
  function consentRow(input) {
    input.classList.add('m-switch');
    input.setAttribute('role', 'switch');
    var state = h('span', { class: 'g-consent-state', 'aria-hidden': 'true' }, '비공개');
    function sync() { state.textContent = input.checked ? '공개 동의' : '비공개'; }
    input.addEventListener('change', sync);
    return h('label', { class: 'check m-switch-row g-consent' }, input,
      h('span', { class: 'm-switch-t' }, h('b', {}, '구성원 소개 화면 메일 주소 공개'),
        h('span', { class: 'hint' }, '동의하면 구성원 소개 화면에 위 메일 주소가 표시됩니다.')), state);
  }

  function fakeMailNotice(link) {
    if (!link) return null;
    return h('p', { class: 'notice m-fake-link' }, '가짜 메일함(시험에서만 보임): ', h('a', { href: link.replace(L.cfg.base || '', '') }, '비밀번호 새로 정하기 링크 열기'));
  }

  // 가짜 메일함(시험에서만): 진짜 서버라면 메일로 갈 것을 화면 아래에 보인다. 관리 화면(admin.js)도 쓴다
  // 시안 A3: 메일마다 한 줄(제목 · 받는 곳 · 때 · 본문 · [링크 열기]), 위에 통 수 알약
  async function fakeMailbox(api) {
    if (L.cfg.backend !== 'fake' || !api.mailbox) return null;
    var mails = await api.mailbox();
    return h('details', { class: 'fake-mail' }, h('summary', {}, h('span', {}, '가짜 메일함(시험에서만 보임)'), h('span', { class: 'm-pill is-quiet' }, mails.length + '통')),
      h('p', { class: 'muted' }, '진짜 서버라면 메일로 갈 것들입니다. 같은 계정의 비밀번호 링크는 10분에 한 번, 하루 세 번까지만 보냅니다.'),
      mails.length ? h('ul', { class: 'm-mails' }, mails.map(function (m) {
        return h('li', {}, h('p', { class: 'm-mail-s' }, m.subject), h('p', { class: 'm-mail-m' }, m.to + ' · ' + L.fmtDate(m.created_at)),
          h('p', { class: 'm-mail-b' }, m.body),
          m.link ? h('a', { class: 'btn btn-small btn-ghost', href: m.link.replace(L.cfg.base || '', '') }, '링크 열기') : null);
      })) : h('p', { class: 'muted' }, '아직 없습니다.'));
  }
  L.fakeMailbox = fakeMailbox;
  async function mailbox(api, root) { var m = await fakeMailbox(api); if (m) root.appendChild(m); }

  // ---------------------------------------------------------------- 로그인 · 가입 · 비밀번호 찾기(시안 1, 2026-11-02)
  // 연구자(11-02): "보통 로그인 창을 보면은 그런거보다는 그냥 [회원 가입 ] 뭐 이런식으로 버튼 위주", 시안 1 고름,
  // "비밀번호 처음 정하기라는 표현보다는 비밀번호 찾지.재설정 뭐 이런 느낌", 말투는 '있으십니까?'(하십시오체).
  // 문장 안내 대신 단추 줄. 옛 회원 표시는 [비밀번호 찾기 · 재설정] 위 꼬리표 한 줄. 카드는 남색 제목 띠에 반쯤 걸친다.
  var FIND = '/login/find/', JOIN = '/login/join/', NEWJOIN = '/login/join/?step=new', OLDJOIN = '/login/join/?step=new&old=1';
  // 메일이 바뀐 옛 회원 · 아이디도 메일도 모르는 분은 본인 확인 요청 대신 '새 메일로 가입 신청'(11-02 연구자: 본인 확인 요청은
  // "기분나쁠수도 있을 것 같고 … 귀찮을 것 같은데", 시안 안 1 고름). 신청서에 예전 아이디(선택)를 받고 관리자가 승인 목록에서 잇는다
  // 선으로 그린 화살표(글자 기호 아님)
  function arw() { return h('span', { class: 'g-arw', 'aria-hidden': 'true' }); }
  function linkBtn(href, text, cls) { return h('a', { class: 'btn ' + (cls || 'btn-ghost'), href: href }, text); }
  // 띠에 걸친 카드 화면: 감싼 틀에 표시를 달아 제목 띠 아래를 늘리고 카드를 끌어올린다
  function gatePage(card) {
    var wrap = document.querySelector('[data-lab-page]');
    if (wrap) wrap.classList.add('lab-gate-page');
    return h('div', { class: 'gate' }, glow(h('section', { class: 'gate-card' }, card)));
  }
  // 세 걸음 표시 한 줄(지난 걸음은 금색, 지금 걸음은 남색)
  function stepLine(items, now) {
    return h('ol', { class: 'g-steps' }, items.map(function (t, i) {
      return h('li', { class: i < now ? 'is-done' : i === now ? 'is-now' : null, 'aria-current': i === now ? 'step' : null },
        h('span', { class: 'g-n' }, String(i + 1)), t);
    }));
  }
  var FIND_STEPS = ['아이디 · 메일', '메일 링크 열기', '새 비밀번호'];

  // 링크를 보낸 뒤 늘 같은 글(등록된 계정인지 화면으로 드러내지 않음) + [메일이 오지 않습니다]
  function sentBox(fakeLink) {
    var more = h('div', { class: 'g-more', hidden: true },
      h('p', {}, '스팸함을 확인해 주십시오. 메일 주소가 바뀌었으면 새 메일로 가입을 신청해 주십시오.'),
      h('div', { class: 'g-acts' }, linkBtn(FIND, '링크 다시 받기', 'btn-ghost btn-small'), linkBtn(OLDJOIN, '새 메일로 가입 신청', 'btn-ghost btn-small')));
    var noMail = h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { more.hidden = false; noMail.hidden = true; } }, '메일이 오지 않습니다');
    return h('div', { class: 'notice is-ok g-sent', role: 'status' },
      h('span', { class: 'g-ck', 'aria-hidden': 'true' }),
      h('div', {}, h('b', {}, '등록된 아이디 · 메일이면 링크를 보냈습니다.'),
        h('p', {}, '링크는 1시간 동안 한 번만 쓸 수 있습니다. 아이디도 메일에 적혀 있습니다.'),
        h('div', { class: 'g-acts' }, noMail), more, fakeMailNotice(fakeLink)));
  }
  async function sendLink(api, login, place) {
    try {
      var r = await api.requestReset(login);
      place.replaceChildren(sentBox(r.fakeMailLink));
      return true;
    } catch (err) { place.replaceChildren(L.notice(L.errText(err), 'error')); return false; }
  }

  // ---------------------------------------------------------------- 로그인
  // 칸 둘 + [로그인], 아래 단추 줄 [회원가입] · [비밀번호 찾기 · 재설정](꼬리표 '비밀번호를 잊었을 때', 11-13 옛 비밀번호 그대로 쓰기)
  async function login(api) {
    var root = L.root();
    var s = await api.session();
    var next = L.safeNext(L.params().get('next'), '/lab/');
    if (s && s.user.role !== 'pending') { location.replace(L.url(next)); return; }
    L.setStatus('');
    var msg = h('div', { 'aria-live': 'polite' });
    var id = h('input', { type: 'text', name: 'username', autocomplete: 'username', required: true, maxlength: 60 });
    var pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
    var btn = h('button', { type: 'submit', class: 'btn g-full' }, '로그인');
    var form = h('form', { class: 'form', novalidate: true }, field('아이디 또는 메일', id), field('비밀번호', pw), h('div', { class: 'btns' }, btn));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      msg.replaceChildren();
      busy(btn, true);
      try {
        await api.signIn(id.value, pw.value);
        location.replace(L.url(next));
      } catch (err) {
        var who = id.value.trim();
        var place = h('div');
        // 아이디가 있든 없든 같은 글(10-28 설계서 8절)
        msg.replaceChildren(h('div', { class: 'notice is-error g-err', role: 'alert' },
          h('b', {}, L.errText(err)),
          h('p', {}, '기존 홈페이지 회원은 예전 아이디 · 비밀번호를 그대로 쓰시면 됩니다. 비밀번호를 잊으셨으면 아래에서 링크를 받으십시오.'),
          h('div', { class: 'g-acts' },
            who ? h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: async function (ev) {
              var b = ev.currentTarget; busy(b, true); var ok = await sendLink(api, who, place); busy(b, false, ok); if (ok) msg.replaceChildren(place);
            } }, '이 아이디로 재설정 링크 받기') : linkBtn(FIND, '비밀번호 찾기 · 재설정', 'btn-ghost btn-small'),
            linkBtn(OLDJOIN, '아이디도 메일도 모릅니다', 'btn-text btn-small'))), place);
        busy(btn, false);
        pw.value = '';
        pw.focus();
      }
    });
    L.clear();
    L.append(root, [gatePage([
      h('h2', { class: 'gate-h' }, '로그인'), msg, form,
      // 11-13 연구자: 기존 회원은 재설정 없이 예전 비밀번호 그대로(첫 로그인 때 서버가 새 방식으로 바꿔 저장)
      h('p', { class: 'g-note' }, '기존 홈페이지 회원은 예전 아이디 · 비밀번호 그대로 로그인합니다.'),
      h('div', { class: 'g-or' }),
      h('div', { class: 'g-row2' },
        linkBtn(JOIN, '회원가입'),
        h('span', { class: 'g-tagw' }, h('em', { class: 'g-tag' }, '비밀번호를 잊었을 때'), linkBtn(FIND, '비밀번호 찾기 · 재설정')))]), L.fakeBadge()]);
    if (window.LabFakeApi && L.cfg.backend === 'fake') {
      L.append(root, h('details', { class: 'm-fake-acc' }, h('summary', {}, '시험용 가짜 계정 보기'),
        h('table', { class: 'tbl' }, h('tbody', {}, window.LabFakeApi.fakeAccounts.map(function (a) {
          return h('tr', {}, h('td', {}, a[2]), h('td', {}, a[0]), h('td', {}, a[1]));
        }))),
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { window.LabFakeApi.resetFake().then(function () { location.reload(); }); } }, '시험 자료 처음으로')));
    }
    await mailbox(api, root);
    id.focus();
  }

  // ---------------------------------------------------------------- 회원가입(연구자 10-28: "이전에 계셧던 분들이 헷갈리지 않게")
  // 첫 화면에서 예전 아이디가 있는지 큰 단추 둘로 묻는다(옛 회원이 새로 신청해 계정이 둘이 되는 일을 막는 장치라 남김).
  // ?step=new(가입 신청, &old=1 이면 새 메일로 가입 신청). 예전 주소 ?step=old 는 비밀번호 찾기 · 재설정으로, ?step=help(옛 본인 확인 요청)는 새 메일로 가입 신청으로.
  async function join(api) {
    var root = L.root();
    L.setStatus('');
    var step = L.params().get('step');
    if (step === 'old') { location.replace(L.url(FIND)); return; }
    if (step === 'new') return joinNew(api, root, L.params().get('old') === '1');
    if (step === 'help') return joinNew(api, root, true);
    L.append(root, [gatePage([
      h('h2', { class: 'gate-h' }, h('span', { class: 'nb' }, '기존 홈페이지(heconpol.org)'), ' ', h('span', { class: 'nb' }, '아이디가 있으십니까?')),
      h('div', { class: 'g-choice' },
        h('a', { class: 'btn g-big g-full', href: '/login/' }, '예, 기존 아이디가 있습니다', arw()),   // 11-13: 예전 비밀번호 그대로 로그인
        h('a', { class: 'btn btn-ghost g-big g-full', href: NEWJOIN }, '아니요, 처음 가입합니다', arw())),
      h('div', { class: 'g-center' }, linkBtn(FIND, '잘 모르겠습니다', 'btn-text'))]), L.fakeBadge()]);
    await mailbox(api, root);
  }

  // ---------------------------------------------------------------- 비밀번호 찾기 · 재설정
  // 비밀번호를 잊었을 때(옛 회원도 예전 비밀번호를 잊었으면) 여기. 세 걸음 표시 한 줄 + 칸 하나 + [메일로 링크 받기], 아래 단추 둘
  async function find(api) {
    var root = L.root();
    L.setStatus('');
    var rid = h('input', { type: 'text', name: 'login', autocomplete: 'username', required: true, maxlength: 120, placeholder: '예: hong2012' });
    var rbtn = h('button', { type: 'submit', class: 'btn g-full' }, '메일로 링크 받기');
    var rmsg = h('div', { 'aria-live': 'polite' });
    var steps = h('div', {}, stepLine(FIND_STEPS, 0));
    var rform = h('form', { class: 'form', novalidate: true },
      field('아이디 또는 가입 때 적은 메일', rid), h('div', { class: 'btns' }, rbtn));
    rform.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!rid.value.trim()) { rmsg.replaceChildren(L.notice('아이디나 메일을 적어 주십시오.', 'error')); rid.focus(); return; }
      busy(rbtn, true);
      var ok = await sendLink(api, rid.value, rmsg);
      busy(rbtn, false, ok);
      if (ok) { steps.replaceChildren(stepLine(FIND_STEPS, 1)); rform.hidden = true; }   // 보낸 뒤에는 [메일로 링크 받기]를 감춤(다시 받기는 보낸 글 안)
    });
    L.append(root, [gatePage([
      h('h2', { class: 'gate-h' }, '비밀번호 찾기 · 재설정'),
      steps, rmsg, rform,
      h('div', { class: 'g-or' }),
      h('div', { class: 'g-row2 is-even' }, linkBtn(OLDJOIN, '아이디도 메일도 모릅니다', 'btn-ghost btn-small'), linkBtn(NEWJOIN, '처음 가입합니다', 'btn-ghost btn-small'))]), L.fakeBadge()]);
    await mailbox(api, root);
    rid.focus();
  }

  // 가입 신청: 서식 판 하나 + 위에 세 걸음 표시 한 줄. old 면 '새 메일로 가입 신청'(맨 위에 예전 아이디 칸, 선택)
  async function joinNew(api, root, old) {
    var msg = h('div', { 'aria-live': 'polite' });
    var courses = (L.pageData().person_courses || ['박사과정', '석사과정']);
    var thisYear = new Date().getFullYear();
    var f = {
      display_name: h('input', { type: 'text', autocomplete: 'name', required: true, maxlength: 30 }),
      email: h('input', { type: 'email', autocomplete: 'email', required: true, maxlength: 120 }),
      kind: h('select', {}, ['재학', '졸업'].map(function (k) { return h('option', { value: k }, k); })),   // 11-02 연구자: "교수님을 왜 넣어 재학과 졸업만"
      course: h('select', {}, courses.map(function (c) { return h('option', { value: c }, c); })),
      entry_year: h('input', { type: 'text', inputmode: 'numeric', maxlength: 4, value: String(thisYear), placeholder: '예: ' + thisYear }),
      show_email: h('input', { type: 'checkbox' }),
      password: h('input', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 200 }),
      old_username: h('input', { type: 'text', autocomplete: 'off', maxlength: 40, placeholder: '예: hong2012' })
    };
    if (old) f.kind.value = '졸업';
    var oldBox = old ? h('div', { class: 'g-oldid' },
      h('label', {}, h('span', {}, '기존 홈페이지 아이디', h('em', { class: 'g-opt' }, '선택')),
        h('span', { class: 'hint' }, '승인 시 기존 계정과 연결하는 데 사용합니다.'), f.old_username)) : null;
    // 재학생만: 과정 · 입학 연도 · 구성원 화면 메일 공개(처음엔 꺼짐, 10-28 연구자 선택). 승인 때 구성원 카드 초안에 쓴다
    var student = h('fieldset', { class: 'join-student' }, h('legend', {}, '재학생이면'),
      field('과정', f.course), field('입학 연도', f.entry_year),
      consentRow(f.show_email));
    function sync() { student.hidden = f.kind.value !== '재학'; }
    f.kind.addEventListener('change', sync);
    var btn = h('button', { type: 'submit', class: 'btn' }, '가입 신청');
    var form = h('form', { class: 'form m-form', novalidate: true },
      h('div', { class: 'm-group' }, h('p', { class: 'm-group-h' }, '기본 정보'), old
        ? [oldBox, field('이름', f.display_name), field('새 메일', f.email, '로그인 아이디로 사용합니다')]
        : [field('이름', f.display_name), field('메일', f.email, '로그인 아이디로 사용합니다')]),   // 11-02 연구자: "회원가입을 그냥 이메일로 하게 하면 어때? 아이디를 따로 입력하지 말고"
      h('div', { class: 'm-group' }, h('p', { class: 'm-group-h' }, '소속 정보'),
        field('구분', f.kind), student),   // 한 줄 소개는 뺌(11-02 연구자 "한 줄 소개도 없애")
      h('div', { class: 'm-group' }, h('p', { class: 'm-group-h' }, '비밀번호'),
        field('비밀번호', f.password),
        pwRules(f.password)),
      h('p', { class: 'muted' }, h('a', { href: '/privacy/' }, '개인정보 처리방침')),
      h('div', { class: 'btns' }, btn));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var isStudent = f.kind.value === '재학';
      if (isStudent && f.entry_year.value && !/^(19|20)\d{2}$/.test(f.entry_year.value.trim())) { msg.replaceChildren(L.notice('입학 연도는 네 자리(예: ' + thisYear + ')로 적어 주십시오.', 'error')); return; }
      busy(btn, true);
      try {
        await api.signUp({ username: '', email_as_id: true, display_name: f.display_name.value, email: f.email.value.trim(),
          kind: f.kind.value, intro: '', password: f.password.value,
          course: isStudent ? f.course.value : '', entry_year: isStudent ? f.entry_year.value.trim() : '', show_email: isStudent && f.show_email.checked,
          old_username: old ? f.old_username.value.trim() : '' });
        L.clear();
        // 메일이 이미 있는 신청도 똑같은 글(누가 회원인지 화면으로 드러내지 않음)
        L.append(root, [L.fakeBadge(), doneCard('가입 신청을 받았습니다', old ? '관리자 확인 후 새 메일로 안내합니다.' : '관리자가 승인하면 메일로 알려 드립니다.',
          [h('a', { href: '/', class: 'btn btn-ghost' }, '첫 화면으로'), old ? null : linkBtn(FIND, '기존 회원입니다', 'btn-text')])]);
        await mailbox(api, root);
      } catch (err) {
        if (err && err.code === 'username_taken') {
          msg.replaceChildren(h('div', { class: 'notice is-error g-err', role: 'alert' }, h('b', {}, '이미 쓰는 아이디입니다.'),
            h('p', {}, '다른 아이디를 골라 주십시오.'),
            h('div', { class: 'g-acts' }, h('a', { class: 'btn btn-ghost btn-small', href: FIND }, '기존 홈페이지 아이디입니다', arw()))));
        } else msg.replaceChildren(L.notice(L.errText(err), 'error'));
        busy(btn, false);
        msg.scrollIntoView({ block: 'nearest' });
      }
    });
    sync();
    L.append(root, [L.fakeBadge(), pageHead(old ? '새 메일로 가입 신청' : '회원가입 신청', null, old ? [FIND, '비밀번호 찾기 · 재설정으로'] : [JOIN, '처음 질문으로']),
      h('div', { class: 'm-narrow is-form m-stagger' },
        panel('is-main', [stepLine(['신청 보내기', '관리자 승인', '승인 뒤 로그인'], 0), msg, form]))]);
  }

  // ---------------------------------------------------------------- 비밀번호 새로 정하기(메일 링크로 들어옴)
  // 정하면 완료 판을 거치지 않고 바로 회원 칸으로. 회원 칸 맨 위에 '내 아이디' 알림 띠(아이디를 잊은 분을 위해, 닫을 때까지)
  function badLink() {
    return h('section', { class: 'm-gate is-error', role: 'alert' }, h('span', { class: 'm-gate-mark', 'aria-hidden': 'true' }),
      h('h2', { class: 'm-gate-h' }, '링크가 지났거나 이미 쓴 링크입니다'), h('p', { class: 'm-gate-b' }, '링크는 1시간 동안 한 번만 쓸 수 있습니다.'),
      h('div', { class: 'btns' }, linkBtn(FIND, '링크 다시 받기', '')));
  }
  async function reset(api) {
    var root = L.root();
    L.setStatus('');
    var q = L.params();
    var token = q.get('token_hash') || '';
    // 어떤 링크든 같은 글(10-28 설계서 8절)
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(token) || q.get('type') !== 'recovery') { L.append(root, [L.fakeBadge(), badLink()]); return; }
    var msg = h('div');
    var p1 = h('input', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 200 });
    var btn = h('button', { type: 'submit', class: 'btn' }, '새 비밀번호로 정하기');
    var form = h('form', { class: 'form', novalidate: true },
      field('새 비밀번호', p1, '다른 사이트와 같은 비밀번호는 쓰지 마십시오.'),
      pwRules(p1), h('div', { class: 'btns' }, btn));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      busy(btn, true);
      try {
        var done = await api.completeReset(token, p1.value);
        try { sessionStorage.setItem('labPwDone', (done && done.username) || '-'); } catch (e2) { /* 없어도 됨 */ }
        location.replace(L.url('/lab/'));
      } catch (err) {
        msg.replaceChildren(L.notice(L.errText(err), 'error'), h('div', { class: 'btns' }, linkBtn(FIND, '링크 다시 받기', 'btn-ghost btn-small')));
        busy(btn, false);
      }
    });
    L.append(root, [L.fakeBadge(), pageHead('새 비밀번호 정하기'),
      stepLine(FIND_STEPS, 2), h('div', { class: 'm-narrow m-stagger' }, panel('is-main', [msg, form]))]);
  }
  // 회원 칸 맨 위 알림 띠: 비밀번호를 정한 바로 뒤 한 번(닫을 때까지 보임)
  function pwDoneBar() {
    var who = null;
    try { who = sessionStorage.getItem('labPwDone'); } catch (e) { return null; }
    if (!who) return null;
    var bar = h('div', { class: 'notice is-ok g-done-bar', role: 'status' },
      h('b', {}, '비밀번호를 정했습니다'), who !== '-' ? h('span', {}, '내 아이디 ', h('b', { class: 'g-id' }, who)) : null,
      h('button', { type: 'button', class: 'btn btn-text btn-small', onclick: function () {
        try { sessionStorage.removeItem('labPwDone'); } catch (e) { /* 없어도 됨 */ }
        bar.remove();
      } }, '닫기'));
    return bar;
  }

  // ---------------------------------------------------------------- 회원 칸(내 글 · 임시저장)
  // 게시판 글은 게시판마다 따로 화면(머리 메뉴 '게시판 ▾')에서 본다(연구자 10-27: "한 화면에 있는게 아니라"). 여기는 내 것만.
  async function home(api) {
    var s = await L.guard(api, 'member');
    if (!s) return;
    var root = L.root();
    L.append(root, L.topBar(api, s, 'home'));
    var pwDone = pwDoneBar();
    if (pwDone) root.appendChild(pwDone);
    // 11-13: 구성원 소개 변경 요청 결과 알림 한 줄(없으면 줄 자체가 없음)과 '내 정보' 옆 금색 점
    var news = await resultNews(api, s);
    if (news.length) { root.appendChild(newsBar(news)); meDot(); }
    var drafts = await api.myDrafts();
    root.appendChild(h('h2', {}, '임시저장 글 ', h('span', { class: 'cnt' }, drafts.length + '개')));
    root.appendChild(drafts.length ? h('ul', { class: 'board-list' }, drafts.map(function (d) {
      return h('li', {}, h('a', { class: 'b-title', href: pathOf(d.board) + '?edit=' + d.id }, d.title),
        h('span', { class: 'b-meta' }, d.board_name + ' · ' + L.fmtDate(d.updated_at) + ' 저장'));
    })) : h('p', { class: 'empty' }, '임시저장한 글이 없습니다.'));
    var mine = await api.myPosts(10);
    root.appendChild(h('h2', {}, '내가 올린 글'));
    root.appendChild(mine.length ? h('ul', { class: 'board-list' }, mine.map(function (p) {
      return h('li', { class: p.hidden ? 'is-hidden' : null },
        h('a', { class: 'b-title', href: pathOf(p.board) + '?id=' + p.id }, p.hidden ? '[숨김] ' : '', p.title, p.comment_count ? ' (' + p.comment_count + ')' : ''),
        h('span', { class: 'b-meta' }, p.board_name + ' · ' + L.fmtDate(p.created_at)));
    })) : h('p', { class: 'empty' }, '아직 올린 글이 없습니다.'));
    root.appendChild(h('h2', {}, '게시판'));
    root.appendChild(h('ul', { class: 'lab-boards' }, (L.pageData().boards || []).map(function (b) {
      return h('li', {}, h('a', { href: L.boardPath(b) }, b.name), b.desc ? h('span', { class: 'muted' }, b.desc) : null);
    })));
    L.setStatus('');
  }

  function pathOf(slug) { var b = L.boardBySlug(slug); return b ? L.boardPath(b) : '/lab/'; }

  // 글 보기 화면의 태그(누르면 그 태그 글만 목록에)
  function tagChip(b, t) {
    return h('a', { class: 'tag-chip', href: L.boardPath(b) + '?tag=' + encodeURIComponent(t) }, '#' + t);
  }

  // 11-02 게시판 목록(시안 A 정돈된 목록, 연구자: 주제 칸 없이 그 게시판 글만): 제목 · 글쓴이 · 날짜 · 댓글(자료실은 첨부 수) 칸,
  // 고정 글은 맨 위, 해가 바뀌는 곳마다 연도 줄. 휴대폰에서는 제목 아래 한 줄로 글쓴이 · 날짜 · 수
  var ICON = {
    clip: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M13.5 6.5 7.6 12.4a1.6 1.6 0 0 0 2.3 2.3l6-6a3.2 3.2 0 0 0-4.5-4.5l-6.2 6.2a4.8 4.8 0 0 0 6.8 6.8l5-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    pic: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2.75" y="3.75" width="14.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m3.5 14 4.2-4.2 3 3 2-2 3.8 3.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="13" cy="7.5" r="1.3" fill="currentColor"/></svg>',
    talk: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.5 4.5h13v9h-7l-3.5 3v-3H3.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    search: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m12.6 12.6 4.4 4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
  };
  function icon(name, label) {   // 그림 글자(고정된 SVG 문자열만 넣음)
    var el = h('span', { class: 'bd-ic', title: label || null });
    el.innerHTML = ICON[name];
    if (label) el.appendChild(h('span', { class: 'sr-only' }, label));
    return el;
  }
  // 목록 날짜: 오늘 · 어제는 시각, 올해는 월.일, 그 전은 연.월.일
  function listDate(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    var now = new Date(), day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - day) / 864e5);
    if (diff === 0 || diff === 1) return [h('b', { class: 'bd-new' }, diff ? '어제' : '오늘'), ' ' + p(d.getHours()) + ':' + p(d.getMinutes())];
    if (d.getFullYear() === now.getFullYear()) return p(d.getMonth() + 1) + '.' + p(d.getDate());
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }
  function boardTable(b, items, page) {
    var files = b.slug === 'files' || b.slug === 'seminar';   // 자료 · 발표 자료가 중심인 게시판은 오른쪽 칸이 첨부 수
    var rows = h('ul', { class: 'bd-rows' });
    function row(p) {
      var n = files ? p.file_count : p.comment_count;
      var nLabel = (files ? '첨부 ' : '댓글 ') + n + '개';
      return h('li', { class: 'bd-row' + (p.pinned ? ' is-pin' : '') + (p.hidden ? ' is-hidden' : '') },
        h('span', { class: 'bd-ttl' },
          p.pinned ? h('span', { class: 'b-badge is-pin' }, '고정') : null,
          p.hidden ? h('span', { class: 'b-badge is-hid' }, '숨김') : null,
          p.visibility === 'admins' ? h('span', { class: 'b-badge' }, '관리자만') : null,
          h('a', { class: 'bd-link', href: L.boardPath(b) + '?id=' + p.id }, p.title),
          p.image_count ? icon('pic', '사진 있음') : null,
          !files && p.file_count ? icon('clip', '첨부 있음') : null),
        h('span', { class: 'bd-who' }, p.author_name),
        h('span', { class: 'bd-date' }, listDate(p.created_at)),
        h('span', { class: 'bd-n' }, n ? [icon(files ? 'clip' : 'talk'), h('span', { class: 'sr-only' }, nLabel), h('span', { 'aria-hidden': 'true' }, String(n))] : null),
        h('span', { class: 'bd-mmeta' }, p.author_name + ' · ', listDate(p.created_at),
          p.comment_count ? h('span', { class: 'bd-mn' }, icon('talk'), '댓글 ' + p.comment_count) : null,
          p.image_count ? h('span', { class: 'bd-mn' }, icon('pic'), '사진 ' + p.image_count) : null,
          p.file_count ? h('span', { class: 'bd-mn' }, icon('clip'), '첨부 ' + p.file_count) : null));
    }
    var pins = items.filter(function (p) { return p.pinned; }), rest = items.filter(function (p) { return !p.pinned; });
    pins.forEach(function (p) { rows.appendChild(row(p)); });
    var thisYear = new Date().getFullYear(), yr = null;
    rest.forEach(function (p, i) {
      var y = new Date(p.created_at).getFullYear();
      if (y !== yr) {
        // 첫 쪽 맨 위가 올해 글이면 연도 줄은 빼고 시작한다
        if (!(i === 0 && page === 1 && y === thisYear)) rows.appendChild(h('li', { class: 'bd-year', 'aria-hidden': 'true' }, y + '년'));
        yr = y;
      }
      rows.appendChild(row(p));
    });
    return h('div', { class: 'bd-table' },
      h('div', { class: 'bd-th', 'aria-hidden': 'true' }, h('span', {}, '제목'), h('span', {}, '글쓴이'), h('span', {}, '날짜'), h('span', { class: 'r' }, files ? '첨부' : '댓글')),
      rows);
  }
  // 쪽 넘김: 이전 · 1 … 4 5 6 … 12 · 다음
  function pager(b, page, pages, extra) {
    if (pages < 2) return null;
    function at(n) { return L.boardPath(b) + '?page=' + n + extra; }
    var nav = h('nav', { class: 'bd-pages', 'aria-label': '쪽 넘기기' });
    nav.appendChild(page > 1 ? h('a', { class: 'bd-pg is-arrow', href: at(page - 1) }, '이전') : h('span', { class: 'bd-pg is-arrow is-off' }, '이전'));
    var last = 0;
    for (var i = 1; i <= pages; i++) {
      if (i !== 1 && i !== pages && Math.abs(i - page) > 2) continue;
      if (last && i - last > 1) nav.appendChild(h('span', { class: 'bd-pg is-gap', 'aria-hidden': 'true' }, '…'));
      nav.appendChild(h('a', { class: 'bd-pg' + (i === page ? ' is-on' : ''), href: at(i), 'aria-current': i === page ? 'page' : null }, String(i)));
      last = i;
    }
    nav.appendChild(page < pages ? h('a', { class: 'bd-pg is-arrow', href: at(page + 1) }, '다음') : h('span', { class: 'bd-pg is-arrow is-off' }, '다음'));
    return nav;
  }

  // ---------------------------------------------------------------- 게시판
  // 게시판마다 /board/<주소 이름>/ 화면 하나가 목록(?page=) · 글 보기(?id=) · 글쓰기(?write=1) · 고치기와 임시저장 글 이어 쓰기(?edit=)를 맡는다.
  async function board(api) {
    var s = await L.guard(api, 'member');
    if (!s) return;
    var root = L.root();
    var b = L.boardBySlug(L.pageData().board);
    if (!b || b.gallery) { L.append(root, L.notice('없는 게시판입니다.', 'error')); L.setStatus(''); return; }
    L.append(root, L.topBar(api, s, 'board'));
    var q = L.params();
    var id = Number(q.get('id'));
    // 제목 띠 안 찾기 칸(세미나, 11-13): 글을 쓰거나 고치는 동안에는 숨긴다(쓰던 글에서 실수로 벗어나지 않게)
    var bandSearch = document.querySelector('.band-search');
    if (bandSearch && (q.get('write') === '1' || Number(q.get('edit')))) bandSearch.hidden = true;
    if (q.get('write') === '1') await writeForm(api, b, null, s);
    else if (Number(q.get('edit'))) await writeForm(api, b, Number(q.get('edit')), s);
    else if (id) await viewPost(api, b, id);
    else await listBoard(api, b, Math.max(1, Number(q.get('page')) || 1), (q.get('tag') || '').trim().slice(0, 20), (q.get('q') || '').trim().slice(0, 40));
    L.setStatus('');
  }

  // tag: 주소의 ?tag= (글 보기의 태그를 누르면 옴), q: 주소의 ?q= (위 찾기 칸). 거르는 중이면 위에 '모두 보기'
  async function listBoard(api, b, page, tag, q) {
    var root = L.root();
    var r = await api.listPosts(b.slug, page, tag || null, q || null);
    var drafts = (await api.myDrafts()).filter(function (d) { return d.board === b.slug; });
    // 제목 띠에 찾기 칸이 있으면(세미나 사진 띠, 11-13) 그 칸을 쓰고 목록 위에는 두지 않는다
    var bandIn = document.querySelector('.band-search input[name="q"]');
    if (bandIn) bandIn.value = q || '';
    var input = h('input', { id: 'bd-q', name: 'q', type: 'search', value: q || '', placeholder: '제목 · 글쓴이로 찾기', autocomplete: 'off', maxlength: 40 });
    var form = bandIn ? null : h('form', { class: 'bd-search', role: 'search', method: 'get', action: L.url(L.boardPath(b)) },
      h('label', { class: 'sr-only', for: 'bd-q' }, '이 게시판에서 찾기'), icon('search'), input,
      h('button', { class: 'btn btn-ghost btn-small', type: 'submit' }, '찾기'));
    root.appendChild(h('div', { class: 'bd-tools' },
      h('p', { class: 'bd-count' }, tag || q ? '찾은 글 ' : '글 ', h('b', {}, String(r.total)), '개'),
      form,
      h('a', { class: 'btn bd-write', href: L.boardPath(b) + '?write=1' }, '글쓰기')));
    if (tag || q) root.appendChild(h('p', { class: 'tag-filter' },
      tag ? [h('b', {}, '#' + tag), ' 글만 보는 중'] : ['‘', h('b', {}, q), '’ 찾는 중'], ' · ', h('a', { href: L.boardPath(b) }, '모두 보기')));
    if (drafts.length && !tag && !q) root.appendChild(draftBox(b, drafts));
    root.appendChild(r.items.length ? boardTable(b, r.items, page)
      : h('p', { class: 'empty' }, tag ? '이 태그가 붙은 글이 없습니다.' : q ? '찾는 글이 없습니다.' : '아직 글이 없습니다.'));
    // 쪽이 하나뿐이면 쪽 넘김 줄이 없다(null). 그대로 붙이면 오류가 나 빨간 '처리하지 못했습니다'가 떴다(11-13 고침)
    var nav = pager(b, page, Math.ceil(r.total / r.size),
      (tag ? '&tag=' + encodeURIComponent(tag) : '') + (q ? '&q=' + encodeURIComponent(q) : ''));
    if (nav) root.appendChild(nav);
  }

  // 이 게시판에 내가 임시저장해 둔 글(나만 보임), 한 줄로
  function draftBox(b, drafts) {
    return h('p', { class: 'bd-draft' }, h('span', { class: 'muted' }, '내 임시저장 글 ' + drafts.length + '개 · 나만 보임'),
      drafts.map(function (d) {
        return h('span', {}, h('a', { href: L.boardPath(b) + '?edit=' + d.id }, d.title), h('span', { class: 'muted' }, ' ' + L.fmtDate(d.updated_at) + ' 저장'));
      }));
  }

  async function viewPost(api, b, id) {
    var root = L.root();
    var d = await api.getPost(id);
    var p = d.post;
    if (p.board !== b.slug) { root.appendChild(L.notice('이 게시판의 글이 아닙니다.', 'error')); return; }
    if (p.status === 'draft') { location.replace(L.url(L.boardPath(b) + '?edit=' + p.id)); return; }   // 임시저장 글은 쓰던 화면으로
    var body = h('div', { class: 'post-body prose' });
    if (!window.LabRender) body.appendChild(L.notice('글을 보여 주는 부품을 불러오지 못했습니다.', 'error'));
    else {
      body.appendChild(p.body_html_legacy ? window.LabRender.legacyHtml(p.body_html_legacy) : window.LabRender.markdown(p.body_md));
      window.LabRender.images(body, api);
    }
    var actions = h('p', { class: 'btns' }, h('a', { class: 'btn btn-ghost btn-small', href: L.boardPath(b) }, '목록'));
    if (p.can_edit) actions.appendChild(h('a', { class: 'btn btn-ghost btn-small', href: L.boardPath(b) + '?edit=' + p.id }, '고치기'));
    if (p.can_hide) actions.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: async function () {
      await api.setHidden(p.id, !p.hidden); location.reload();
    } }, p.hidden ? '다시 보이기' : '숨기기'));
    if (p.can_delete) actions.appendChild(h('button', { type: 'button', class: 'btn btn-danger btn-small', onclick: async function () {
      if (!confirm('이 글을 지우시겠습니까? 본문 그림과 첨부 파일도 함께 지워집니다.')) return;
      try { await api.deletePost(p.id); go(L.boardPath(b)); } catch (e) { alert(L.errText(e)); }
    } }, '지우기'));
    var files = d.attachments.filter(function (a) { return a.bucket === 'files'; });
    root.appendChild(h('article', { class: 'post-view' },
      h('h2', {}, p.hidden ? '[숨김] ' : '', p.title),
      (p.tags && p.tags.length) || p.visibility === 'admins' || p.pinned ? h('p', { class: 'post-tags' },
        p.pinned ? h('span', { class: 'b-badge is-pin' }, '고정') : null,
        p.visibility === 'admins' ? h('span', { class: 'b-badge' }, '관리자만') : null,
        (p.tags || []).map(function (t) { return tagChip(b, t); })) : null,
      h('p', { class: 'post-meta' }, p.author_name + ' · ' + L.fmtDate(p.created_at) + (p.updated_at && p.updated_at !== p.created_at ? ' (고침 ' + L.fmtDate(p.updated_at) + ')' : '')),
      body, files.length ? attachList(api, files) : null));
    root.appendChild(actions);
    root.appendChild(commentsBox(api, p, d.comments));
  }

  // 첨부 파일: 누르면 내려받기(진짜 서버는 60초짜리 주소)
  function attachList(api, files) {
    return h('ul', { class: 'attach-list' }, files.map(function (a) {
      return h('li', {}, h('button', { type: 'button', onclick: async function () {
        try {
          var u = await api.attachmentUrl(a, { download: a.original_name });
          var link = document.createElement('a');
          link.href = u; link.download = a.original_name; link.rel = 'noopener';
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(function () { if (u.indexOf('blob:') === 0) URL.revokeObjectURL(u); }, 60000);
        } catch (e) { alert(L.errText(e)); }
      } }, a.original_name), ' ', h('span', { class: 'muted' }, L.fmtSize(a.size_bytes)));
    }));
  }

  // 11-02: 댓글을 받지 않는 글(allow_comments 끔)은 쓰는 칸 대신 안내만, 이미 달린 댓글은 그대로 보인다(관리자는 쓰는 칸이 남음)
  function commentsBox(api, p, comments) {
    var list = h('div', {}, comments.length ? comments.map(function (c) {
      return h('div', { class: 'comment' }, h('span', { class: 'c-meta' }, c.author_name + ' · ' + L.fmtDate(c.created_at),
        c.can_delete ? h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: async function () {
          if (!confirm('댓글을 지우시겠습니까?')) return;
          await api.deleteComment(c.id); location.reload();
        } }, '지우기') : null), c.body);
    }) : h('p', { class: 'empty' }, '댓글이 없습니다.'));
    var ta = h('textarea', { maxlength: 2000, rows: 3 });
    ta.style.minHeight = '90px';
    var btn = h('button', { type: 'submit', class: 'btn btn-small' }, '댓글 쓰기');
    var msg = h('div');
    var form = h('form', { class: 'form form-wide' }, field('댓글', ta), h('div', { class: 'btns' }, btn), msg);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      busy(btn, true);
      try { await api.addComment(p.id, ta.value); location.reload(); }
      catch (err) { msg.replaceChildren(L.notice(L.errText(err), 'error')); busy(btn, false); }
    });
    var closed = p.can_comment === false;
    return h('section', { class: 'comments' }, h('h3', {}, '댓글 ' + comments.length), list,
      closed ? h('p', { class: 'c-closed' }, '댓글을 받지 않는 글입니다.') : form,
      !closed && p.allow_comments === false ? h('p', { class: 'c-closed' }, '댓글을 받지 않는 글입니다. 관리자라서 쓸 수 있습니다.') : null);
  }

  // 글쓰기 · 고치기 · 임시저장(연구자 10-27: "등록, 수정, 임시저장"). 본문은 편집기(editor.js)가 맡는다.
  // 새 글과 임시저장 글: '올리기' · '임시저장'(나만 보임), 바뀐 것이 있으면 3분마다 저절로도 임시저장. 올린 글: '고친 글 올리기'.
  // 11-02 시안 A(연구자: "네이버 블로그 … 기능을 많이 넣고 … 고급스럽게", "추천대로"): 두 층 도구 줄 + 아래 단추 줄 + 미리 보기(넓은 화면 · 휴대폰).
  // 11-02 오른쪽 설정 판 뺌(연구자: "옆에 있으니 AI 티 나고 없어도 됨, 꼭 필요한 기능만 최소로 다른 곳에"): 위 줄에 저장 상태 · 미리 보기,
  // 편집기 아래 얇은 첨부 줄 · 글자 수, 글 설정 네 가지(태그 · 공개 범위 · 댓글 허용 · 고정. 대표 사진은 11-13 뺌)는 '올리기'를 누르면 뜨는 '올리기 설정' 창에.
  async function writeForm(api, b, editId, s) {
    var root = L.root();
    var d = editId ? await api.getPost(editId) : null;
    var old = d ? d.post : null;
    if (old && (!old.can_edit || old.board !== b.slug)) { root.appendChild(L.notice('내가 쓴 이 게시판 글만 고칠 수 있습니다.', 'error')); return; }
    if (!window.LabEditor) { root.appendChild(L.notice('글쓰기 부품을 불러오지 못했습니다. 새로 고쳐 주십시오.', 'error')); return; }
    var icon = window.LabEditor.icon;
    var postId = old ? old.id : null;
    var draft = !old || old.status === 'draft';
    var isAdmin = s.user.role === 'admin';
    var existing = d ? d.attachments.slice() : [];      // 이미 올린 그림 · 자료
    var removed = Object.create(null), newFiles = [];    // 뺄 자료(id), 새로 고른 자료
    var dirty = false, saving = false;
    var savedAt = old && draft ? new Date(old.updated_at) : null;
    var msg = h('div');
    // 올리기 설정 값(임시저장에도 함께 저장, 창을 안 열어도 이 값으로 감)
    var opt = {
      tags: old && old.tags ? old.tags.slice() : [],
      cover: old ? old.cover_path || null : null,
      visibility: old && old.visibility === 'admins' ? 'admins' : 'members',
      allowComments: !(old && old.allow_comments === false),
      pinned: !!(old && old.pinned)
    };

    var title = h('input', { type: 'text', class: 'w-title', maxlength: 200, required: true, value: old ? old.title : null, placeholder: '제목을 적어 주십시오', 'aria-label': '제목' });
    title.addEventListener('input', function () { dirty = true; tick(); });
    var fileIn = b.files ? h('input', { type: 'file', multiple: true, hidden: true, accept: window.LabUpload.accept.file }) : null;
    var ed = window.LabEditor.create({ api: api, me: s.user.id, md: old ? old.body_md : '', head: title,
      onChange: function () { dirty = true; tick(); }, onSave: function () { if (draft) save('draft'); },
      onFiles: b.files ? function (list) { addFiles(list); } : null,
      onFileButton: fileIn ? function () { fileIn.click(); } : null });

    // 자료 첨부(첨부가 '예'인 게시판만): 편집기 아래 얇은 줄. 이미 올린 것은 '빼기', 새로 고른 것은 저장할 때 올라간다
    var fileList = h('ul', { class: 'att-edit w-att-list' });
    function drawFiles() {
      fileList.replaceChildren();
      existing.filter(function (a) { return a.bucket === 'files'; }).forEach(function (a) {
        var gone = !!removed[a.id];
        fileList.appendChild(h('li', { class: gone ? 'is-gone' : null },
          h('span', {}, a.original_name, ' ', h('span', { class: 'muted' }, gone ? '저장하면 빠짐' : L.fmtSize(a.size_bytes))),
          h('button', { type: 'button', class: 'btn btn-text btn-small', onclick: function () {
            if (gone) delete removed[a.id]; else removed[a.id] = true;
            dirty = true; drawFiles();
          } }, gone ? '다시 두기' : '빼기')));
      });
      newFiles.forEach(function (f, i) {
        fileList.appendChild(h('li', {}, h('span', {}, f.name, ' ', h('span', { class: 'muted' }, L.fmtSize(f.size) + ' · 저장할 때 올라감')),
          h('button', { type: 'button', class: 'btn btn-text btn-small', onclick: function () { newFiles.splice(i, 1); drawFiles(); } }, '빼기')));
      });
    }
    async function addFiles(list) {
      var errors = [];
      for (var i = 0; i < list.length; i++) {
        var chk = await window.LabUpload.checkFile(list[i]);
        if (!chk.ok) { errors.push(chk.error); continue; }
        newFiles.push({ blob: list[i], name: chk.name, mime: chk.mime, size: chk.size, ext: chk.ext, bucket: 'files' });
      }
      dirty = true; drawFiles();
      if (errors.length) msg.replaceChildren(L.notice(errors.join(' / '), 'error'));
    }
    if (fileIn) fileIn.addEventListener('change', function () { addFiles(fileIn.files); fileIn.value = ''; });
    drawFiles();

    // ---- 저장 상태: 'n분 전 저장됨'(위 줄 오른쪽)
    var saveDot = h('span', { class: 'w-save-dot', 'aria-hidden': 'true' });
    var saveText = h('span', {});
    var saveBadge = h('p', { class: 'w-save', 'aria-live': 'polite' }, saveDot, saveText);
    function ago(t) {
      var m = Math.floor((Date.now() - t.getTime()) / 60000);
      return m < 1 ? '방금' : m < 60 ? m + '분 전' : L.fmtDate(t.toISOString());
    }
    function drawSave() {
      saveBadge.classList.toggle('is-dirty', dirty || ed.isDirty());
      if (saving) saveText.textContent = '저장하는 중…';
      else if (!draft) saveText.textContent = dirty || ed.isDirty() ? '고친 것이 아직 저장되지 않음' : '올린 글을 고치는 중';
      else if (savedAt) saveText.textContent = ago(savedAt) + ' 임시저장됨' + (dirty || ed.isDirty() ? ' · 그 뒤 고친 것 있음' : '');
      else saveText.textContent = dirty || ed.isDirty() ? '아직 저장 안 함 · 3분마다 저절로 임시저장' : '아직 저장 안 함';
    }
    setInterval(drawSave, 30000);

    // ---- 글자 수(편집기 아래 오른쪽 끝 작은 회색 한 줄)
    var cnt = h('span', { class: 'w-cnt' });
    var tickT = 0;
    function tick() {
      if (tickT) return;
      tickT = requestAnimationFrame(function () {
        tickT = 0;
        cnt.textContent = '글자 ' + ed.stats().chars.toLocaleString('ko-KR') + '자';
        drawSave();
      });
    }

    // ---- 미리 보기: 저장할 모양 그대로(글 보기와 같은 거르기)를 넓은 화면 · 휴대폰 폭으로(창 안에서 바꿈)
    var pvPage = h('article', { class: 'pv-page post-view' });
    var pvClose = h('button', { type: 'button', class: 'pv-x', 'aria-label': '미리 보기 닫기' }, icon('close'));
    var pvWide = h('button', { type: 'button', 'aria-pressed': 'true' }, icon('pc'), '넓은 화면');
    var pvPhone = h('button', { type: 'button', 'aria-pressed': 'false' }, icon('phone'), '휴대폰');
    var pv = h('div', { class: 'pv', role: 'dialog', 'aria-modal': 'true', 'aria-label': '미리 보기', hidden: true },
      h('div', { class: 'pv-in' },
        h('div', { class: 'pv-bar' }, h('b', {}, '미리 보기'),
          h('span', { class: 'pv-seg' }, pvWide, pvPhone), pvClose),
        h('div', { class: 'pv-stage' }, pvPage)));
    var pvBack = null;
    function pvMode(phone) { pvPage.classList.toggle('is-phone', phone); pvWide.setAttribute('aria-pressed', String(!phone)); pvPhone.setAttribute('aria-pressed', String(phone)); }
    pvWide.addEventListener('click', function () { pvMode(false); });
    pvPhone.addEventListener('click', function () { pvMode(true); });
    function preview(phone) {
      pvBack = document.activeElement;
      var body = h('div', { class: 'post-body prose' });
      body.appendChild(window.LabRender.markdown(ed.markdown()));
      Array.prototype.forEach.call(body.querySelectorAll('img[data-lab-src]'), function (img) {
        var p = img.getAttribute('data-lab-src'), u = ed.imageUrl(p);
        if (u) img.src = u; else api.attachmentUrl({ bucket: 'gallery', path: p }).then(function (x) { img.src = x; }).catch(function () { img.alt = '그림을 불러오지 못했습니다'; });
      });
      // replaceChildren 은 null 을 글자 'null'로 넣으므로 빈 자리는 먼저 거른다
      pvPage.replaceChildren.apply(pvPage, [h('span', { class: 'gl', 'aria-hidden': 'true' }), h('h2', {}, title.value.trim() || '(제목 없음)'),
        opt.tags.length || opt.visibility === 'admins' ? h('p', { class: 'post-tags' },
          opt.visibility === 'admins' ? h('span', { class: 'b-badge' }, '관리자만') : null,
          opt.tags.map(function (t) { return h('span', { class: 'tag-chip' }, '#' + t); })) : null,
        h('p', { class: 'pv-meta' }, s.user.display_name + ' · ' + b.name + ' · ' + L.fmtDate(new Date().toISOString())), body].filter(Boolean));
      pvMode(!!phone);
      pv.hidden = false; document.body.classList.add('pv-open'); pvClose.focus();
    }
    function pvHide() { pv.hidden = true; document.body.classList.remove('pv-open'); if (pvBack && pvBack.focus) pvBack.focus(); }
    pvClose.addEventListener('click', pvHide);
    pv.addEventListener('click', function (e) { if (e.target === pv) pvHide(); });
    pv.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); pvHide(); }
      if (e.key === 'Tab') {   // 미리 보기 안에서만 돈다
        var f = [pvWide, pvPhone, pvClose], i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
      }
    });

    // ---- 올리기 설정 창: '올리기'를 누르면 그 위에 뜨고, 창 안 '올리기'를 눌러야 저장(Esc · 바깥 누르면 닫힘)
    var goLabel = draft ? '올리기' : '고친 글 올리기';
    // 태그: Enter · 쉼표로 더하고 × 로 뺀다(5개 · 20자까지, 앞의 # 은 뗌)
    var tagIn = h('input', { type: 'text', class: 'tag-in', maxlength: 21, placeholder: '태그 적고 Enter', 'aria-label': '태그 더하기' });
    var tagBox = h('div', { class: 'tag-box' });
    var tagNote = h('p', { class: 'pub-note' });
    function drawTags(say) {
      tagBox.replaceChildren();
      opt.tags.forEach(function (t, i) {
        tagBox.appendChild(h('span', { class: 'tag-chip is-edit' }, '#' + t,
          h('button', { type: 'button', class: 'tag-x', 'aria-label': t + ' 태그 빼기', onclick: function () { opt.tags.splice(i, 1); dirty = true; drawTags(); tagIn.focus(); } }, '×')));
      });
      tagIn.hidden = opt.tags.length >= 5;
      tagBox.appendChild(tagIn);
      tagNote.textContent = say || (opt.tags.length + ' / 5개 · 하나에 20자까지');
      tagNote.classList.toggle('is-err', !!say);
    }
    function addTag() {
      var parts = tagIn.value.split(/[,，]/), say = '';
      parts.forEach(function (x) {
        var t = x.trim().replace(/^#+/, '').trim();
        if (!t) return;
        if (t.length > 20) { say = '태그 하나는 20자까지입니다.'; return; }
        if (opt.tags.indexOf(t) !== -1) return;
        if (opt.tags.length >= 5) { say = '태그는 5개까지입니다.'; return; }
        opt.tags.push(t); dirty = true;
      });
      tagIn.value = '';
      drawTags(say);
      if (!tagIn.hidden) tagIn.focus();
    }
    tagIn.addEventListener('keydown', function (e) {
      if (e.isComposing) return;   // 한글 조합 중 Enter 는 글자 확정
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
      else if (e.key === 'Backspace' && !tagIn.value && opt.tags.length) { opt.tags.pop(); dirty = true; drawTags(); tagIn.focus(); }
    });
    tagIn.addEventListener('input', function () { if (/[,，]/.test(tagIn.value)) addTag(); });
    tagBox.addEventListener('click', function (e) { if (e.target === tagBox) tagIn.focus(); });

    // 대표 사진: 2026-11-13 연구자 결정으로 올리기 설정 창에서 뺐다(어느 목록에도 보이지 않음). 저장할 때는 본문 첫 사진을 자동으로 적는다.
    // 아래 고르는 칸 코드는 사진첩(행사 기록) 화면에서 다시 쓸 수 있어 남겨 둔다(창에는 붙이지 않음).
    var coverBox = h('div', { class: 'cover-pick', role: 'radiogroup', 'aria-label': '대표 사진' });
    var coverNote = h('p', { class: 'pub-note' });
    var thumbUrl = Object.create(null);
    function drawCovers() {
      var paths = ed.images().paths;
      if (opt.cover && paths.indexOf(opt.cover) === -1) opt.cover = null;   // 본문에서 뺀 사진이면 고른 것을 푼다
      coverBox.replaceChildren();
      coverBox.hidden = !paths.length;
      paths.forEach(function (p, i) {
        var on = opt.cover ? opt.cover === p : i === 0;
        var img = h('img', { alt: '', width: 72, height: 54 });
        var u = ed.imageUrl(p) || thumbUrl[p];
        if (u) img.src = u;
        else api.attachmentUrl({ bucket: 'gallery', path: p }).then(function (x) { thumbUrl[p] = x; img.src = x; }).catch(function () { img.alt = '그림을 불러오지 못했습니다'; });
        coverBox.appendChild(h('button', { type: 'button', class: 'cover-opt', role: 'radio', 'aria-checked': String(on), 'aria-label': (i + 1) + '번째 사진',
          onclick: function () { opt.cover = p; dirty = true; drawCovers(); } }, img, on ? h('span', { class: 'cover-on' }, '대표') : null));
      });
      coverNote.textContent = paths.length
        ? (opt.cover ? '' : '고르지 않으면 본문 첫 사진을 씁니다.')
        : '본문에 넣은 사진에서 고릅니다.';
    }

    // 공개 범위(두 칸 고르기) · 댓글 허용 · 위에 고정(관리자만)
    function segBtn(val, label) {
      return h('button', { type: 'button', role: 'radio', 'data-v': val, onclick: function () { opt.visibility = val; dirty = true; drawSeg(); } }, label);
    }
    var seg = h('div', { class: 'pub-seg', role: 'radiogroup', 'aria-label': '공개 범위' }, segBtn('members', '회원 전체'), segBtn('admins', '관리자만'));
    var segNote = h('p', { class: 'pub-note' });
    function drawSeg() {
      Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute('aria-checked', String(x.getAttribute('data-v') === opt.visibility)); });
      segNote.textContent = opt.visibility === 'admins' ? '글쓴이와 관리자만 읽습니다.' : '';
    }
    var allowIn = h('input', { type: 'checkbox', checked: opt.allowComments });
    allowIn.addEventListener('change', function () { opt.allowComments = allowIn.checked; dirty = true; });
    var pinIn = isAdmin ? h('input', { type: 'checkbox', checked: opt.pinned }) : null;
    if (pinIn) pinIn.addEventListener('change', function () { opt.pinned = pinIn.checked; dirty = true; });

    function pubGrp(label, body, extra) { return h('section', { class: 'pub-grp' }, h('h3', { class: 'pub-l' }, label, extra || null), body); }
    var pubGo = h('button', { type: 'button', class: 'btn btn-small', onclick: function () { save('publish'); } }, goLabel);
    var pubX = h('button', { type: 'button', class: 'pv-x pub-x', 'aria-label': '올리기 설정 닫기', onclick: function () { pubShow(false); } }, icon('close'));
    var pub = h('div', { class: 'pub', role: 'dialog', 'aria-label': '올리기 설정', hidden: true },
      h('div', { class: 'pub-h' }, h('h2', {}, '올리기 설정'), pubX),
      h('div', { class: 'pub-b' },
        pubGrp('태그', h('div', {}, tagBox, tagNote)),
        pubGrp('공개 범위', h('div', {}, seg, segNote)),
        pubGrp('댓글', switchRow(allowIn, '댓글 받기')),
        pinIn ? pubGrp('위에 고정', switchRow(pinIn, '게시판 목록 맨 위에 고정'), h('span', { class: 'b-badge' }, '관리자만')) : null),
      h('div', { class: 'pub-f' }, h('button', { type: 'button', class: 'btn btn-text btn-small', onclick: function () { pubShow(false); } }, '닫기'), pubGo));
    function pubShow(on, stay) {   // stay: 바깥을 눌러 닫을 때는 누른 곳에 초점을 둔다
      if (on) { drawTags(); drawCovers(); drawSeg(); allowIn.checked = opt.allowComments; if (pinIn) pinIn.checked = opt.pinned; }
      pub.hidden = !on;
      // 낮은 창에서도 위가 잘리지 않게: 단추 위 남은 높이만큼만 편다(휴대폰 아래 판은 꾸밈 파일이 맡음)
      pub.style.maxHeight = '';
      if (on && !window.matchMedia('(max-width: 640px)').matches) {
        pubBtn.scrollIntoView({ block: 'nearest' });
        pub.style.maxHeight = Math.max(240, Math.min(640, pubBtn.getBoundingClientRect().top - 28)) + 'px';
      }
      pubBtn.setAttribute('aria-expanded', String(on));
      document.body.classList.toggle('pub-open', on);
      if (on) (tagIn.hidden ? pubGo : tagIn).focus(); else if (!stay) pubBtn.focus();
    }
    pub.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); pubShow(false); } });
    document.addEventListener('mousedown', function (e) {
      if (!pub.hidden && !pub.contains(e.target) && !pubBtn.contains(e.target)) pubShow(false, true);
    });

    // ---- 단추들
    var pubBtn = h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: function () { pubShow(pub.hidden); } }, goLabel);
    var draftBtn = draft ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { save('draft'); } }, '임시저장') : null;
    var pvBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-small w-pv-btn', onclick: function () { preview(false); } }, icon('eye'), '미리 보기');
    var delBtn = old && draft ? h('button', { type: 'button', class: 'btn btn-danger btn-small', onclick: async function () {
      if (!confirm('이 임시저장 글을 지우시겠습니까? 넣어 둔 그림 · 파일도 함께 지워집니다.')) return;
      try { await api.deletePost(postId); dirty = false; ed.clean(); go(L.boardPath(b)); } catch (e) { msg.replaceChildren(L.notice(L.errText(e), 'error')); }
    } }, icon('trash'), '지우기') : null;

    async function save(kind, quiet) {
      if (saving) return;
      if (ed.busy()) { if (!quiet) msg.replaceChildren(L.notice('그림을 줄이는 중입니다. 잠시 뒤 다시 눌러 주십시오.', 'error')); return; }
      if (!title.value.trim()) {
        if (!quiet) { if (!pub.hidden) pubShow(false); msg.replaceChildren(L.notice('제목을 적어 주십시오.', 'error')); title.focus(); }
        return;
      }
      if (tagIn.value.trim()) addTag();   // 적다 만 태그도 넣는다
      saving = true; drawSave(); busy(pubBtn, true); busy(pubGo, true); if (draftBtn) busy(draftBtn, true);
      try {
        var im = ed.images(), keep = Object.create(null);
        im.paths.forEach(function (p) { keep[p] = true; });
        var files = im.fresh.map(function (x) { return { blob: x.blob, name: x.name, mime: 'image/jpeg', size: x.size, ext: 'jpg', bucket: 'gallery', path: x.path }; })
          .concat(newFiles);
        var remove = existing.filter(function (a) { return (a.bucket === 'gallery' && !keep[a.path]) || removed[a.id]; })
          .map(function (a) { return a.id; });
        // 대표 사진: 고른 것이 아직 본문에 있으면 그것, 아니면 본문 첫 사진(없으면 비움)
        var cover = opt.cover && keep[opt.cover] ? opt.cover : (im.paths[0] || null);
        var f = { id: postId, board: b.slug, title: title.value, body_md: ed.markdown(),
          status: kind === 'draft' ? 'draft' : 'published', remove: remove,
          tags: opt.tags.slice(), cover_path: cover, visibility: opt.visibility, allow_comments: opt.allowComments };
        if (isAdmin) f.pinned = opt.pinned;   // 고정은 관리자만 보낸다(회원 글은 있던 값 그대로)
        var r = await api.savePost(f, files);
        ed.uploaded(im.fresh.map(function (x) { return x.path; }));
        dirty = false; ed.clean();
        if (kind !== 'draft') { go(L.boardPath(b) + '?id=' + r.id); return; }
        // 임시저장: 이 주소(?edit=)로 다시 열면 이어 쓰고, 올라간 첨부를 다시 받아 둔다
        postId = r.id;
        history.replaceState(null, '', L.url(L.boardPath(b) + '?edit=' + r.id));
        existing = (await api.getPost(r.id)).attachments; newFiles = []; removed = Object.create(null); drawFiles();
        savedAt = new Date(r.updated_at || Date.now());
        if (!quiet) {
          var okNote = L.notice('임시저장했습니다. 나만 볼 수 있습니다.', 'ok');
          msg.replaceChildren(okNote);
          // 아래에 붙은 단추 줄이 글을 가리지 않게 알림은 잠시 뒤 걷는다(저장 시각은 위 줄에 남음)
          setTimeout(function () { if (okNote.parentNode === msg) msg.replaceChildren(); }, 6000);
        }
      } catch (err) {
        if (!pub.hidden) pubShow(false);
        msg.replaceChildren(L.notice(L.errText(err), 'error'));
      } finally {
        saving = false; drawSave(); busy(pubBtn, false); busy(pubGo, false); if (draftBtn) busy(draftBtn, false);
      }
    }

    // 편집기 아래 얇은 줄: 왼쪽 '파일 첨부'(첨부 허용 게시판만) + 고른 파일, 오른쪽 끝 글자 수
    var under = h('div', { class: 'w-under' },
      fileIn ? h('div', { class: 'w-att' }, fileIn,
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', title: 'PDF · 한글(HWP · HWPX) · DOCX · XLSX · PPTX, 하나에 20MB까지',
          onclick: function () { fileIn.click(); } }, '파일 첨부'), fileList) : h('div'),
      cnt);

    var form = h('form', { class: 'form form-wide write write-a', novalidate: true },
      h('div', { class: 'w-main' }, ed.el), under,
      // 단추 줄: 왼쪽 '그만두기'(글자만), 오른쪽 지우기 · 임시저장 · 올리기(올리기 설정 창이 그 위에 뜸). 알림도 이 줄 안에 떠서 늘 단추 곁에 보인다
      h('div', { class: 'write-actions' }, msg,
        h('div', { class: 'write-row' },
          h('a', { class: 'btn btn-text', href: L.boardPath(b) + (old && !draft ? '?id=' + old.id : '') }, '그만두기'),
          h('div', { class: 'write-go' }, delBtn, draftBtn, h('span', { class: 'pub-wrap' }, pub, pubBtn)))));
    form.addEventListener('submit', function (e) { e.preventDefault(); pubShow(true); });

    // 쓰던 글이 남은 채로 화면을 떠나려 하면 브라우저가 한 번 묻는다
    window.addEventListener('beforeunload', function (e) { if (dirty || ed.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
    // 새 글 · 임시저장 글은 바뀐 것이 있으면 3분마다 저절로 임시저장(제목이 있을 때)
    if (draft) setInterval(function () { if (dirty || ed.isDirty()) save('draft', true); }, 180000);

    root.classList.add('lab-root--write');   // 쓰는 칸은 글 보기 폭에 가깝게
    root.appendChild(h('div', { class: 'w-head' },
      h('div', {}, h('p', { class: 'w-crumb' }, '회원 게시판 · ' + b.name), h('h2', {}, old ? (draft ? '임시저장 글 이어 쓰기' : '글 고치기') : '글쓰기')),
      saveBadge, pvBtn));
    root.appendChild(form);
    document.body.appendChild(pv);
    await ed.ready;
    dirty = false; tick(); drawSave();
    if (!old) title.focus();
  }

  // ---------------------------------------------------------------- 사진첩(사진첩 게시판 화면)
  async function photos(api) {
    var s = await L.guard(api, 'member');
    if (!s) return;
    var root = L.root();
    var gb = L.boardBySlug(L.pageData().board);
    if (!gb || !gb.gallery) { L.append(root, L.notice('사진첩 게시판이 게시판 목록 표에 없습니다.', 'error')); L.setStatus(''); return; }
    L.append(root, L.topBar(api, s, 'board'));
    var q = L.params();
    if (q.get('write') === '1') await photoForm(api, gb);
    else if (Number(q.get('id'))) await photoView(api, gb, Number(q.get('id')));
    else await photoList(api, gb);
    L.setStatus('');
  }

  async function imgFor(api, att, alt) {
    var img = h('img', { alt: alt || '', loading: 'lazy', width: 400, height: 300 });
    try { img.src = await api.attachmentUrl(att); } catch (e) { img.alt = '사진을 불러오지 못했습니다'; }
    return img;
  }

  // 11-13 사진첩 = 행사 · 나들이 기록(연구자 선택 '가' 연도별 세로 연대표): 해마다 묶고, 행사마다 대표 사진 + 날짜(요일) · 이름 · 사진 수.
  // 대표 사진은 글에 고른 사진(cover_path), 없으면 첫 사진(서버 · 가짜 회원 칸 galleryList 가 정함). 가장 최근 행사만 금색 점.
  var WDAY = '일월화수목금토';
  function evDate(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '. ' + p(d.getMonth() + 1) + '. ' + p(d.getDate()) + '(' + WDAY[d.getDay()] + ')';
  }
  function evArrow() { return h('span', { class: 'ev-arr', 'aria-hidden': 'true' }); }

  async function photoList(api, gb) {
    var root = L.root();
    var albums = await api.galleryList();
    var total = albums.reduce(function (n, a) { return n + (a.count || 0); }, 0);
    root.appendChild(h('div', { class: 'ev-tools' },
      h('p', {}, '행사 ', h('b', {}, String(albums.length)), '개 · 사진 ', h('b', {}, String(total)), '장'),
      h('a', { class: 'btn', href: L.boardPath(gb) + '?write=1' }, '행사 올리기')));
    if (!albums.length) { root.appendChild(h('p', { class: 'empty' }, '아직 올린 행사가 없습니다.')); return; }
    var years = [], byYear = {};
    albums.forEach(function (a) {
      var y = new Date(a.created_at).getFullYear();
      if (!byYear[y]) { byYear[y] = []; years.push(y); }
      byYear[y].push(a);
    });
    var pics = [];
    years.forEach(function (y) {
      var line = h('ol', { class: 'ev-line' });
      byYear[y].forEach(function (a) {
        var href = L.boardPath(gb) + '?id=' + a.id;
        var frame = h('a', { class: 'ev-pic', href: href, tabindex: '-1', 'aria-hidden': 'true' });
        if (a.cover) pics.push([frame, a]); else frame.appendChild(h('span', { class: 'ev-none' }, '사진 없음'));
        line.appendChild(h('li', { class: 'ev-item' + (a === albums[0] ? ' is-latest' : '') },
          h('span', { class: 'ev-node', 'aria-hidden': 'true' }), frame,
          h('div', { class: 'ev-tx' },
            h('time', { datetime: a.created_at }, evDate(a.created_at)),
            h('h3', {}, h('a', { href: href }, a.title)),
            a.count ? h('a', { class: 'ev-go', href: href, 'aria-label': a.title + ' 사진 ' + a.count + '장 보기' },
              h('span', {}, '사진 ', h('span', { class: 'num' }, String(a.count)), '장 보기'), evArrow())
              : h('a', { class: 'ev-go', href: href, 'aria-label': a.title + ' 글 보기' }, h('span', {}, '글 보기'), evArrow()))));
      });
      root.appendChild(h('section', { class: 'ev-year', 'aria-label': y + '년' },
        h('h2', {}, String(y), h('small', {}, '행사 ' + byYear[y].length + '개')), line));
    });
    // 사진 주소는 화면을 그린 뒤 한꺼번에 받는다(진짜 서버는 사진마다 짧은 주소를 새로 받음)
    await Promise.all(pics.map(async function (x) { x[0].appendChild(await imgFor(api, x[1].cover, '')); }));
  }

  async function photoView(api, gb, id) {
    var root = L.root();
    var d = await api.getPost(id);
    var p = d.post;
    if (p.board !== gb.slug) { root.appendChild(L.notice('이 게시판의 글이 아닙니다.', 'error')); return; }
    var photos = d.attachments.filter(function (a) { return a.bucket === 'gallery'; });
    var art = h('article', { class: 'ev-view' },
      h('a', { class: 'ev-back', href: L.boardPath(gb) }, evArrow(), gb.name),
      h('h2', {}, p.hidden ? '[숨김] ' : '', p.title),
      h('p', { class: 'ev-meta' }, evDate(p.created_at) + ' · 사진 ' + photos.length + '장 · 올린 사람 ' + p.author_name));
    if (p.body_md && p.body_md.trim() && window.LabRender) art.appendChild(h('div', { class: 'prose' }, window.LabRender.markdown(p.body_md)));
    var grid = h('div', { class: 'ev-grid' });
    art.appendChild(photos.length ? grid : h('p', { class: 'empty' }, '이 행사에 올린 사진이 없습니다.'));
    root.appendChild(art);
    var actions = h('p', { class: 'btns' }, h('a', { class: 'btn btn-ghost btn-small', href: L.boardPath(gb) }, '목록'));
    if (p.can_hide) actions.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: async function () { await api.setHidden(p.id, !p.hidden); location.reload(); } }, p.hidden ? '다시 보이기' : '숨기기'));
    if (p.can_delete) actions.appendChild(h('button', { type: 'button', class: 'btn btn-danger btn-small', onclick: async function () {
      if (!confirm('이 행사 글과 사진을 모두 지우시겠습니까?')) return;
      await api.deletePost(p.id); go(L.boardPath(gb));
    } }, '지우기'));
    root.appendChild(actions);
    root.appendChild(commentsBox(api, p, d.comments));
    // 사진은 누르면 원본 크기로 새 창에서 열린다
    await Promise.all(photos.map(async function (a, i) {
      var img = await imgFor(api, a, (i + 1) + '번째 사진');
      var link = h('a', { href: img.src || '#', target: '_blank', rel: 'noopener', 'aria-label': (i + 1) + '번째 사진 크게 보기(새 창)' }, img);
      grid.appendChild(link);
    }));
  }

  async function photoForm(api, gb) {
    var root = L.root();
    var U = window.LabUpload;
    var title = h('input', { type: 'text', maxlength: 200, required: true, placeholder: '예: 2026 가을 학술대회' });
    var fileIn = h('input', { type: 'file', multiple: true, accept: U.accept.photo });
    var preview = h('div', { class: 'preview-grid' });
    var btn = h('button', { type: 'submit', class: 'btn' }, '올리기');
    var msg = h('div');
    var ready = [];
    fileIn.addEventListener('change', async function () {
      preview.replaceChildren(); ready = []; msg.replaceChildren();
      busy(btn, true);
      var errors = [];
      for (var i = 0; i < fileIn.files.length; i++) {
        var f = fileIn.files[i];
        var chk = await U.checkPhoto(f);
        if (!chk.ok) { errors.push(chk.error); continue; }
        try {
          var out = await U.reencodePhoto(f);
          var name = U.safeName(f.name.replace(/\.[^.]+$/, '') + '.jpg');
          ready.push({ blob: out.blob, name: name, mime: out.mime, size: out.blob.size, ext: 'jpg', bucket: 'gallery' });
          var img = h('img', { alt: name });
          img.src = URL.createObjectURL(out.blob);
          preview.appendChild(img);
        } catch (e) { errors.push(L.errText(e)); }
      }
      if (errors.length) msg.replaceChildren(L.notice(errors.join(' / '), 'error'));
      if (ready.length) msg.appendChild(L.notice(ready.length + '장을 긴 변 1600px 로 줄였습니다(사진 속 위치 정보는 빠짐).', 'ok'));
      busy(btn, false);
    });
    var form = h('form', { class: 'form form-wide', novalidate: true },
      field('행사 이름', title), field('사진', fileIn, 'JPG · PNG · WebP, 한 번에 30장까지. 첫 사진이 목록의 대표 사진이 됩니다.'),
      preview, h('div', { class: 'btns' }, btn, h('a', { class: 'btn btn-ghost', href: L.boardPath(gb) }, '그만두기')), msg);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!ready.length) { msg.replaceChildren(L.notice('올릴 사진을 골라 주십시오.', 'error')); return; }
      if (ready.length > 30) { msg.replaceChildren(L.notice('한 번에 30장까지 올릴 수 있습니다.', 'error')); return; }
      busy(btn, true);
      try {
        var r = await api.savePost({ board: gb.slug, title: title.value, body_md: '' }, ready);
        go(L.boardPath(gb) + '?id=' + r.id);
      } catch (err) { msg.replaceChildren(L.notice(L.errText(err), 'error')); busy(btn, false); }
    });
    root.appendChild(h('h2', {}, '행사 올리기'));
    root.appendChild(form);
  }

  // ---------------------------------------------------------------- 옛 주소 넘기기(10-27 전 /lab/board/?b=… · /lab/photos/ → /board/…/)
  function forward() {
    var q = L.params(), boards = L.pageData().boards || [];
    var b = /\/lab\/photos\/$/.test(location.pathname) ? boards.filter(function (x) { return x.gallery; })[0] : L.boardBySlug(q.get('b'));
    if (!b) { L.append(L.root(), [L.notice('없는 게시판입니다.', 'error'), h('p', {}, h('a', { href: '/lab/' }, '회원 칸으로'))]); L.setStatus(''); return; }
    q.delete('b');
    var rest = q.toString();
    location.replace(L.url(L.boardPath(b)) + (rest ? '?' + rest : ''));
  }

  // ---------------------------------------------------------------- 내 정보
  async function meInfo(api) {
    var s = await L.guard(api, 'member');
    if (!s) return;
    var root = L.root();
    L.append(root, L.topBar(api, s, 'me'));
    var p = await api.myProfile();
    // 시안 A3: 맨 위 남색 '명함'(첫 글자 동그라미 · 이름 · 점 붙은 알약 · 계정 네 칸), 아래는 고칠 것마다 흰 판(마우스 빛 · 차례로 올라옴).
    // 고친 뒤 성공 글은 화면 아래 알림, 틀린 입력은 그 판 안 글. 탈퇴 요청은 브라우저 기본 확인 창 대신 확인 창
    root.appendChild(h('div', { class: 'work-head' }, h('h2', { class: 'work-title' }, '내 정보')));
    var cardName = h('p', { class: 'me-name' }, p.display_name);
    root.appendChild(h('section', { class: 'me-card m-card', 'aria-label': '계정' },
      h('div', { class: 'm-card-top' },
        h('span', { class: 'm-card-face', 'aria-hidden': 'true' }, (p.display_name || '?').slice(0, 1)),
        h('div', { class: 'm-card-id' }, cardName,
          h('p', { class: 'm-card-pills' }, h('span', { class: 'm-pill is-ok' }, p.kind),
            p.role === 'admin' ? h('span', { class: 'm-pill is-gold' }, '관리자') : null,
            h('span', { class: 'm-pill ' + (p.person_no ? 'is-ok' : 'is-quiet') }, p.person_no ? '구성원 명단 등록' : '구성원 명단 미등록')))),
      h('dl', { class: 'me-facts' },
        h('div', {}, h('dt', {}, '아이디'), h('dd', {}, p.username)),
        h('div', {}, h('dt', {}, '메일'), h('dd', {}, p.email, h('span', { class: 'me-hint' }, '바꾸려면 조교에게 연락'))),
        h('div', {}, h('dt', {}, '구분'), h('dd', {}, p.kind)),
        h('div', {}, h('dt', {}, '가입일'), h('dd', { class: 'num' }, L.fmtDate(p.created_at))))));

    var nm = h('input', { type: 'text', maxlength: 30, value: p.display_name });
    var nbtn = h('button', { type: 'submit', class: 'btn btn-ghost' }, '이름 바꾸기');
    var nmsg = h('div');
    var nform = h('form', { class: 'form' }, field('보이는 이름', nm), h('div', { class: 'btns' }, nbtn), nmsg);
    nform.addEventListener('submit', async function (e) {
      e.preventDefault();
      nmsg.replaceChildren(); busy(nbtn, true);
      try { await api.updateDisplayName(nm.value); busy(nbtn, false, true); cardName.textContent = nm.value; L.toast('보이는 이름을 바꿨습니다.', { kind: 'ok' }); }
      catch (err) { busy(nbtn, false); nmsg.replaceChildren(L.notice(L.errText(err), 'error')); }
    });

    // CV 주소: 10-28부터 구성원 화면 내 카드의 메일 주소 뒤에 흐린 글자 'CV'로 붙는다. 공개 화면은 사이트를 다시 만들 때 받아 간다
    var cv = h('input', { type: 'url', inputmode: 'url', autocomplete: 'url', maxlength: 300, placeholder: 'https://', value: p.cv_url || '' });
    // CV 공개(11-02, 승인 없이 본인이 정함): 끄면 주소는 남기고 카드에서만 뺀다. 조교가 표에 적어 둔 CV도 함께 빠진다
    var cvShow = h('input', { type: 'checkbox', checked: p.cv_public !== false });
    var cbtn = h('button', { type: 'submit', class: 'btn' }, 'CV 저장');
    var cmsg = h('div');
    var cform = h('form', { class: 'form form-wide', novalidate: true },
      switchRow(cvShow, '구성원 화면에 CV 공개'),
      field('CV 주소', cv),
      h('div', { class: 'btns' }, cbtn), cmsg);
    cform.addEventListener('submit', async function (e) {
      e.preventDefault();
      cmsg.replaceChildren(); busy(cbtn, true);
      try {
        await api.updateMyCv(cv.value, cvShow.checked);
        busy(cbtn, false, true);
        L.toast(!cvShow.checked ? '저장했습니다. 구성원 화면에서는 하루 안에 빠집니다.'
          : cv.value.trim() ? '저장했습니다. 구성원 화면에는 하루 안에 붙습니다.' : '지웠습니다. 구성원 화면에서는 하루 안에 빠집니다.', { kind: 'ok' });
      } catch (err) { busy(cbtn, false); cmsg.replaceChildren(L.notice(L.errText(err), 'error')); }
    });

    var cur = h('input', { type: 'password', autocomplete: 'current-password', maxlength: 200 });
    var nw = h('input', { type: 'password', autocomplete: 'new-password', maxlength: 200 });
    var pbtn = h('button', { type: 'submit', class: 'btn btn-ghost' }, '비밀번호 바꾸기');
    var pmsg = h('div');
    var pform = h('form', { class: 'form' }, field('지금 비밀번호', cur), field('새 비밀번호', nw), pwRules(nw), h('div', { class: 'btns' }, pbtn), pmsg);
    pform.addEventListener('submit', async function (e) {
      e.preventDefault();
      pmsg.replaceChildren(); busy(pbtn, true);
      try { await api.changePassword(cur.value, nw.value); cur.value = nw.value = ''; busy(pbtn, false, true); L.toast('비밀번호를 바꿨습니다.', { kind: 'ok' }); }
      catch (err) { busy(pbtn, false); pmsg.replaceChildren(L.notice(L.errText(err), 'error')); }
    });

    var wbtn = h('button', { type: 'button', class: 'btn btn-danger', disabled: p.withdraw_requested, onclick: async function () {
      var yes = L.ask ? await L.ask({ title: '탈퇴를 요청하시겠습니까?', body: '관리자가 확인한 뒤 계정과 메일, 올린 사진 · 파일을 지웁니다. 글은 이름을 "탈퇴한 회원"으로 바꿔 남깁니다.', ok: '탈퇴 요청', danger: true })
        : confirm('탈퇴를 요청하시겠습니까? 관리자가 확인한 뒤 계정과 메일, 올린 사진 · 파일을 지웁니다. 글은 이름을 "탈퇴한 회원"으로 바꿔 남깁니다.');
      if (!yes) return;
      busy(wbtn, true);
      try { await api.requestWithdraw(); busy(wbtn, false, true); wbtn.disabled = true; wbtn.textContent = '탈퇴 요청함'; L.toast('탈퇴 요청을 받았습니다.', { kind: 'ok' }); }
      catch (err) { busy(wbtn, false); L.toast(L.errText(err), { kind: 'error' }); }
    } }, p.withdraw_requested ? '탈퇴 요청함' : '탈퇴 요청');

    // 교수님 카드(교수 화면)는 조교가 고친다
    var cardBox = p.kind === '교수' ? null : h('div', { class: 'me-cardreq' });
    if (cardBox) await drawCardRequests(api, p, cardBox);

    function mePanel(title, desc, body, cls, tag) {
      return glow(h('section', { class: 'me-panel m-panel' + (cls ? ' ' + cls : '') }, h('div', { class: 'm-panel-top' }, h('h3', {}, title), tag || null),
        desc ? h('p', { class: 'muted' }, desc) : null, body));
    }
    L.append(root, [
      p.role === 'admin' ? h('p', { class: 'notice m-info' }, '관리 화면은 인증 앱(2단계 인증)을 등록한 뒤에 열립니다.') : null,
      h('div', { class: 'me-grid m-stagger' },
        // 11-13: 휴대폰에서 이름 · 비밀번호 판을 지나야 나오던 것을 계정 요약 바로 아래로
        cardBox ? mePanel('구성원 소개 사진 · 관심 분야', null,
          cardBox, 'is-wide', h('span', { class: 'm-pill is-gold' }, '조교 승인 뒤 공개')) : null,
        mePanel('이름', null, nform),
        mePanel('비밀번호', null, pform),
        mePanel('CV', null, cform, 'is-wide'),
        mePanel('탈퇴', null, [wbtn], 'is-wide is-quiet'))]);
    L.setStatus('');
  }

  // 구성원 카드 사진 · 관심 분야 바꾸기 요청(11-02, 연구자: "사진과 연구 관심분야는 조교의 승인이 필요하게").
  // 11-13 개선(확인판 1번, 연구자가 고른 6가지): 사진 · 키워드를 단추 하나로 함께 보냄, '지금 구성원 화면 → 요청한 모습'을 나란히,
  // 결과는 회원 칸 첫 화면 알림 줄 · '내 정보' 옆 금색 점(resultNews), 판은 계정 요약 바로 아래, 사진은 끌어다 놓는 넓은 칸, '까닭' → '이유'.
  // 서버 규칙(요청 표)은 그대로: 사진 · 키워드는 요청 두 건으로 저장되고 화면만 묶는다.
  async function drawCardRequests(api, p, box) {
    var card = null, reqs = [];
    try { card = p.person_no ? await api.myCard() : null; reqs = await api.myProfileRequests(); }
    catch (err) { box.replaceChildren(L.notice(L.errText(err), 'error')); return; }
    var byKind = {};
    reqs.forEach(function (r) { byKind[r.kind] = r; });
    var redraw = function () { return drawCardRequests(api, p, box); };
    var withInterest = !card || card.table === 'people';   // 졸업생 소개에는 관심 분야가 없다
    var rp = byKind.photo, ri = withInterest ? byKind.interest : null;
    var pendP = rp && rp.status === 'pending', pendI = ri && ri.status === 'pending';
    var cur = L.keywords(card && card.interest ? card.interest : '');
    var startKw = pendI || (ri && ri.status === 'rejected') ? L.keywords(ri.interest || '') : cur;

    // 지금 카드 → 요청한 카드(구성원 화면과 같은 모양)
    function face(src, alt) {
      return src ? h('img', { class: 'ph', src: src, alt: alt, width: 120, height: 150 })
        : h('span', { class: 'ph ph-none', 'aria-hidden': 'true' }, (p.display_name || '?').slice(0, 1));
    }
    function mini(label, pic, kws, changed) {
      return h('figure', { class: 'reqcard' + (changed && (changed.pic || changed.kw) ? ' is-changed' : '') },
        h('figcaption', { class: 'reqcard-l' }, label),
        h('div', { class: 'reqcard-pic' + (changed && changed.pic ? ' is-diff' : '') }, pic),
        h('p', { class: 'reqcard-name' }, p.display_name),
        withInterest ? h('div', { class: 'reqcard-kw' + (changed && changed.kw ? ' is-diff' : '') },
          kws.length ? L.keywordList(kws.join(L.kw.sep)) : h('span', { class: 'muted' }, '관심 분야 없음')) : null);
    }
    var nowCard = mini(card ? '지금 ' + card.label + ' 화면' : '지금 모습', face(card && card.photo_url, '지금 공개된 내 사진'), cur);
    var wantSlot = h('div', { class: 'reqcard-slot' });
    var blob = null, blobUrl = null, pendUrl = null;
    if (pendP && rp.has_photo) { try { pendUrl = await api.requestPhotoUrl(rp.id); } catch (e) { pendUrl = null; } }
    var kwNow = startKw.slice();
    function sameKw(a, b) { return a.join(L.kw.sep) === b.join(L.kw.sep); }
    function drawWant() {
      var picSrc = blobUrl || pendUrl || (card && card.photo_url) || null;
      wantSlot.replaceChildren(mini('요청한 모습', face(picSrc, '요청한 사진'), kwNow,
        { pic: !!(blobUrl || pendUrl), kw: withInterest && !sameKw(kwNow, cur) }));
    }

    // 사진: 끌어다 놓거나 눌러서 고르는 넓은 칸 하나(휴대폰에서 '선택된 파일 없음'이 잘리던 것)
    var pin = h('input', { type: 'file', class: 'sr-only', id: 'cardreq-file', accept: window.LabUpload ? window.LabUpload.accept.photo : 'image/*' });
    var dropTxt = h('span', { class: 'drop-t' }, pendP ? '다른 사진으로 바꾸려면 여기에 끌어다 놓거나 눌러서 고르기' : '사진을 여기에 끌어다 놓거나 눌러서 고르기');
    var drop = h('label', { class: 'drop', for: 'cardreq-file' }, dropTxt, h('span', { class: 'drop-s' }, 'JPG · PNG · WebP, 세로 4:5로 잘립니다'));
    var msg = h('div');
    async function takeFile(f) {
      msg.replaceChildren();
      if (!f) return;
      try {
        blob = await window.LabUpload.portrait(f);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(blob);
        dropTxt.textContent = '고른 사진: ' + (f.name || '사진') + ' · 바꾸려면 다시 끌어다 놓기';
        drop.classList.add('is-set');
        drawWant(); sync();
      } catch (err) { pin.value = ''; msg.replaceChildren(L.notice(L.errText(err), 'error')); }
    }
    pin.addEventListener('change', function () { takeFile(pin.files[0]); });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('is-over'); }); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) takeFile(f); });

    var kw = withInterest ? L.keywordInput(startKw, { label: '관심 분야 키워드', onChange: function (list) { kwNow = list; drawWant(); sync(); } }) : null;
    var sbtn = h('button', { type: 'submit', class: 'btn', disabled: true }, '변경 요청 보내기');
    var sNote = h('span', { class: 'hint' }, '바꾼 것만 보냅니다');
    function kwChanged() {
      if (!kw) return false;
      var v = kwNow;
      if (pendI) return !sameKw(v, L.keywords(ri.interest || ''));
      return !sameKw(v, cur);
    }
    function sync() { if (sbtn) sbtn.disabled = !(blob || kwChanged()); }   // 키워드 칸이 처음 그려질 때는 단추가 아직 없음

    var form = h('form', { class: 'form cardreq-one', novalidate: true },
      resultLines(),
      pendingLine(),
      h('div', { class: 'reqcards' }, nowCard, h('span', { class: 'reqcards-arrow', 'aria-hidden': 'true' }, '→'), wantSlot),
      h('div', { class: 'cardreq-inputs' },
        h('div', { class: 'field' }, h('span', { class: 'field-l' }, '사진'), pin, drop),
        kw ? h('div', { class: 'field' }, h('span', { class: 'field-l' }, '관심 분야 키워드 ', h('span', { class: 'm-pill kw-opt' }, '선택 사항'), ' 최대 ' + L.kw.max + '개'), kw.el)
          : h('p', { class: 'm-side-note' }, '졸업생 소개에는 관심 분야가 없어 사진만 바꿉니다.')),
      h('div', { class: 'btns' }, sbtn, sNote), msg);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = null;
      if (kwChanged()) {
        try { var list = kw.get(), bad = L.checkKeywords(list); if (bad) throw L.userError(bad); v = list.join(L.kw.sep); }
        catch (er) { msg.replaceChildren(L.notice(L.errText(er), 'error')); return; }
      }
      if (!blob && v === null) return;
      msg.replaceChildren(); busy(sbtn, true);
      var sent = [];
      try {
        if (blob) { await api.requestProfileChange('photo', blob); sent.push('사진'); }
        if (v !== null) { await api.requestProfileChange('interest', v); sent.push('키워드'); }
        L.toast(sent.join(' · ') + '을(를) 보냈습니다. 조교가 승인하면 구성원 화면에 올라갑니다.', { kind: 'ok' });
        await redraw();
      } catch (err) {
        busy(sbtn, false);
        msg.replaceChildren(L.notice((sent.length ? sent.join(' · ') + '은(는) 보냈지만 나머지는 ' : '') + L.errText(err), 'error'));
        if (sent.length) await redraw();
      }
    });

    // 기다리는 요청 한 줄(사진 · 키워드 함께): 날짜 · 요청 취소
    function pendingLine() {
      var list = [pendP ? rp : null, pendI ? ri : null].filter(Boolean);
      if (!list.length) return null;
      var what = list.map(function (r) { return r.kind === 'photo' ? '사진' : '키워드'; }).join(' · ');
      var cbtn = h('button', { type: 'button', class: 'btn btn-text btn-small' }, '요청 취소');
      cbtn.addEventListener('click', async function () {
        busy(cbtn, true);
        try { for (var i = 0; i < list.length; i++) await api.cancelProfileRequest(list[i].id); L.toast('요청을 취소했습니다.', { kind: 'ok' }); await redraw(); }
        catch (err) { busy(cbtn, false); L.toast(L.errText(err), { kind: 'error' }); }
      });
      var first = list.map(function (r) { return r.created_at; }).sort()[0];
      return h('p', { class: 'cardreq-state' }, h('span', { class: 'm-pill is-warn' }, '조교 확인 기다림'),
        h('span', {}, what + ' ' + list.length + '가지'), h('span', { class: 'num' }, L.fmtDate(first) + ' 보냄'), cbtn);
    }
    // 끝난 요청(승인됨 · 돌려받음)은 갈래마다 한 줄
    function resultLines() {
      var rows = [rp, ri].filter(function (r) { return r && r.status !== 'pending'; }).map(function (r) {
        var nm = r.kind === 'photo' ? '사진' : '관심 분야 키워드';
        if (r.status === 'rejected') return h('p', { class: 'cardreq-state' }, h('span', { class: 'm-pill is-err' }, nm + ' 돌려받음'),
          h('span', {}, r.reason ? '이유: ' + r.reason : '이유는 적지 않았습니다. 고쳐서 다시 보낼 수 있습니다.'));
        return h('p', { class: 'cardreq-state' }, h('span', { class: 'm-pill is-ok' }, nm + ' 승인됨'),
          h('span', { class: 'num' }, L.fmtDate(r.decided_at) + ' · 구성원 화면에는 1~2분 뒤 보입니다'));
      });
      return rows.length ? h('div', { class: 'cardreq-results' }, rows) : null;
    }

    drawWant();
    box.replaceChildren(form);
    markSeen(p, reqs);
  }

  // 요청 결과 알림(11-13): 내 정보를 연 뒤에 나온 승인 · 돌려받음만 '새 소식'. 본 시각은 이 브라우저에 적는다
  // (진짜 서버도 같은 방식으로 충분: 결과가 바뀌면 decided_at 이 바뀜. 메일 알림은 메일 발송 서비스를 정한 뒤)
  function seenKey(uid) { return 'lab.meSeen.' + uid; }
  // 본 시각은 '지금'과 화면에 보인 결과 시각 중 늦은 것(서버 시계가 조금 앞서도 본 알림이 다시 뜨지 않게)
  function markSeen(p, reqs) {
    var t = new Date().toISOString();
    (reqs || []).forEach(function (r) { if (r.decided_at && r.decided_at > t) t = r.decided_at; });
    try { localStorage.setItem(seenKey(p.username), t); } catch (e) { /* 저장 못 해도 화면은 그대로 */ }
  }
  async function resultNews(api, s) {
    var seen = '';
    try { seen = localStorage.getItem(seenKey(s.user.username)) || ''; } catch (e) { seen = ''; }
    var reqs = [];
    try { reqs = await api.myProfileRequests(); } catch (e) { return []; }
    return reqs.filter(function (r) { return r.status !== 'pending' && r.decided_at && r.decided_at > seen; });
  }
  function newsBar(news) {
    if (!news.length) return null;
    var parts = news.map(function (r) {
      var nm = r.kind === 'photo' ? '사진' : '관심 분야 키워드';
      return r.status === 'rejected' ? nm + '는 돌려받았습니다' + (r.reason ? ' · 이유: ' + r.reason : '')
        : nm + ' 변경이 승인되었습니다 · ' + L.fmtDate(r.decided_at);
    });
    return h('div', { class: 'news-bar', role: 'status' }, h('span', { class: 'news-l' }, '알림'),
      h('span', { class: 'news-t' }, parts.join(' / ')), h('a', { class: 'news-go', href: '/lab/me/' }, '내 정보에서 보기'));
  }
  function meDot() {
    var a = document.querySelector('.rail-nav a[href$="/lab/me/"]');
    if (a && !a.querySelector('.rail-dot')) a.appendChild(h('span', { class: 'rail-dot', title: '새 알림' }, h('span', { class: 'sr-only' }, ' 새 알림')));
  }

  // ---------------------------------------------------------------- 관리
  // 관리 화면은 admin.js(2026-10-28 2판: 할 일 · 회원 · 사이트 내용 · 관리자 넘기기 · 기록)
  function admin(api) {
    if (window.LabAdminPage) return window.LabAdminPage(api);
    L.setStatus('관리 화면 파일을 불러오지 못했습니다.', true);
  }

  L.start({ login: login, join: join, find: find, reset: reset, home: home, board: board, photos: photos, forward: forward, me: meInfo, admin: admin });
})();
