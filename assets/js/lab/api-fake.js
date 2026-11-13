// 시험용 가짜 회원 칸 서버. 이 컴퓨터 브라우저 안(localStorage · IndexedDB)에만 저장하고 바깥으로 아무것도 보내지 않는다.
// 진짜 서버(Supabase)의 표 · 권한 규칙(supabase/migrations)을 같은 이름으로 흉내 낸다.
// 공개용으로 만들 때(build.py, --local 없이)는 이 파일을 빼고, 혹시 섞여도 이 컴퓨터 주소가 아니면 돌지 않는다.
(function () {
  'use strict';
  if (window.LAB_BLOCKED) return;
  var host = location.hostname;
  if (!(host === 'localhost' || host === '127.0.0.1' || host === '[::1]')) return;

  // 가짜 자료가 바뀌면 판 번호를 올린다(옛 판은 지우고 새로 만듦). 2: 게시판 셋, 3: 임시저장 · 본문 그림(2026-10-27),
  // 4: 관리 화면 · 가입 흐름(2026-10-28: 본인 확인 요청 · 가짜 메일함 · 넘기기 · 사이트 내용 고치기)
  var VERSION = 5, KEY = 'labFake.v5', OLD_KEYS = ['labFake.v1', 'labFake.v2', 'labFake.v3', 'labFake.v4'], SKEY = 'labFake.session';
  var NOAUTO = 'labFake.noPreview';   // 로그아웃한 뒤에는 미리 보기 자동 로그인을 하지 않는다
  var AUTO = 'labFake.previewSession';  // 지금 로그인이 미리 보기가 자동으로 넣은 것인가(관리 화면에 오면 시험관리자로 바꿈)
  var REAL = 'labFake.realLogin';       // 로그인 화면 · 비밀번호 링크로 직접 들어왔는가(이때는 자동으로 바꾸지 않음)
  var DAY = 86400000;
  var LIMITS = { posts: 30, comments: 100, files: 100 };
  var LAB_PATH = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,120}$/;
  var LEGACY_TEST_PW = 'old-site-2015';   // 가짜 옛 회원(test_oldmember)의 '예전 홈페이지 비밀번호'(11-13)

  function now() { return new Date().toISOString(); }
  function uid() { return 'u-' + Math.random().toString(36).slice(2, 10); }
  function err(msg) { return window.Lab.userError(msg); }
  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 120); }); }

  // ---------------------------------------------------------------- 저장
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.version === VERSION) return s;
    } catch (e) { /* 새로 만든다 */ }
    OLD_KEYS.forEach(function (k) { localStorage.removeItem(k); });
    var s2 = seed();
    save(s2);
    return s2;
  }
  function save(s) { localStorage.setItem(KEY, JSON.stringify(s)); }
  function nextId(s, table) { s.seq[table] = (s.seq[table] || 0) + 1; return s.seq[table]; }

  var idb = null;
  function blobs() {
    if (idb) return idb;
    idb = new Promise(function (resolve, reject) {
      var req = indexedDB.open('labFake', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('blobs'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return idb;
  }
  async function putBlob(key, blob) {
    var db = await blobs();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put(blob, key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  async function getBlob(key) {
    var db = await blobs();
    return new Promise(function (resolve, reject) {
      var req = db.transaction('blobs').objectStore('blobs').get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }
  async function delBlob(key) {
    var db = await blobs();
    return new Promise(function (resolve) {
      var tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').delete(key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
    });
  }

  // ---------------------------------------------------------------- 옮긴 기존 글(미리 보기에서만, 2026-11-13)
  // 미리 보기 서버(migrate/preview_server.py)가 이 컴퓨터 작업 폴더의 옮긴 글을 /__old/data.json 으로 내준다.
  // 브라우저 저장 공간(한도 약 5MB)에는 넣지 않고 읽을 때마다 가짜 자료에 합친다. 옛 글은 읽기 · 댓글만(고치기 · 지우기 안 됨).
  // 보통 미리 보기(python3 -m http.server)나 공개용 빌드에는 이 주소가 없어 조용히 건너뛴다.
  var OLD_ID = 100000, oldPromise = null;
  function oldData() {
    if (oldPromise) return oldPromise;
    oldPromise = fetch(window.Lab.url('/__old/data.json'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.posts)) return null;
        var o = { users: [], posts: [], comments: [], attachments: [] }, cid = OLD_ID, aid = OLD_ID;
        var uid = function (lid) { return lid ? 'old-' + lid : null; };
        (d.users || []).forEach(function (u) {
          o.users.push({ id: uid(u.lid), username: 'old_' + u.lid, display_name: u.name || '기존회원', kind: u.kind || '기타',
            role: 'member', status: 'needs_password', legacy: true, password: null, created_at: '2015-01-01T00:00:00Z' });
        });
        d.posts.forEach(function (p, i) {
          var id = OLD_ID + i + 1;
          o.posts.push({ id: id, board: p.board, title: p.title || '(제목 없음)', body_md: p.body_md || '', body_html_legacy: p.body_html_legacy || null,
            author_id: uid(p.author_legacy), created_at: p.created_at, updated_at: p.updated_at || p.created_at, hidden: !!p.hidden,
            tags: p.tags || [], visibility: p.visibility === 'admins' ? 'admins' : 'members', pinned: !!p.pinned,
            cover_path: p.cover_path || null, allow_comments: true, old: true });
          (p.comments || []).forEach(function (c) {
            o.comments.push({ id: ++cid, post_id: id, author_id: uid(c.author_legacy), body: c.body, created_at: c.created_at, hidden: false, old: true });
          });
          (p.attachments || []).forEach(function (a) {
            o.attachments.push({ id: ++aid, post_id: id, owner_id: uid(p.author_legacy), bucket: a.bucket, path: a.path,
              original_name: a.original_name, mime: a.mime, size_bytes: a.size_bytes, created_at: p.created_at, old: true });
          });
        });
        return o;
      });
    return oldPromise;
  }
  // 읽기 전용으로 합친 자료. 이것을 save() 하지 않는다(쓰기는 load() 한 것에만).
  async function loadAll() {
    var s = load(), o = await oldData();
    if (!o) return s;
    return Object.assign({}, s, { users: s.users.concat(o.users), posts: s.posts.concat(o.posts),
      comments: s.comments.concat(o.comments), attachments: s.attachments.concat(o.attachments), merged: true });
  }
  function oldFileUrl(a) {
    return window.Lab.url('/__old/file/' + encodeURIComponent(a.bucket) + '/' + a.path.split('/').map(encodeURIComponent).join('/'));
  }

  // ---------------------------------------------------------------- 가짜 자료(실제 사람 아님)
  function seed() {
    var t = Date.now();
    var ago = function (d) { return new Date(t - d * DAY).toISOString(); };
    var users = [
      { id: 'u-admin', username: 'test_admin', password: 'Admin-test-2026', email: 'admin@example.test', display_name: '시험관리자', kind: '재학', intro: '조교', role: 'admin', status: 'active', created_at: ago(400), approved_at: ago(400), mfa: true },
      { id: 'u-member', username: 'test_member', password: 'Member-test-2026', email: 'member@example.test', display_name: '시험회원', kind: '재학', intro: '박사과정', role: 'member', status: 'active', created_at: ago(300), approved_at: ago(299) },
      { id: 'u-alum', username: 'test_alumni', password: 'Alumni-test-2026', email: 'alumni@example.test', display_name: '시험졸업생', kind: '졸업', intro: '2020 졸업', role: 'member', status: 'active', created_at: ago(900), approved_at: ago(899) },
      { id: 'u-old', username: 'test_oldmember', password: null, email: 'old@example.test', display_name: '기존회원', kind: '졸업', intro: '', role: 'member', status: 'needs_password', created_at: ago(3000), approved_at: ago(3000), legacy: true },
      { id: 'u-pend1', username: 'test_newcomer', password: 'Newcomer-test-2026', email: 'new@example.test', display_name: '신청자', kind: '재학', intro: '2026 석사 입학', role: 'pending', status: 'active', created_at: ago(1), approved_at: null, course: '석사과정', entry_year: 2026, show_email: true },
      { id: 'u-pend3', username: 'oldmember2026', password: 'Oldmember-test-2026', email: 'old.new@example.test', display_name: '기존회원', kind: '졸업', intro: '2012 박사 졸업', role: 'pending', status: 'active', created_at: ago(2), approved_at: null, old_username: 'test_oldmember' },
      { id: 'u-pend2', username: 'spam_bot99', password: 'Spam-test-2026', email: 'bot@example.test', display_name: '광고', kind: '기타', intro: '좋은 상품 소개', role: 'pending', status: 'active', created_at: ago(3), approved_at: null }
    ];
    var posts = [
      { id: 1, board: 'free', title: '세미나실 예약 안내', body_md: '다음 주 **화요일** 세미나실은 오후 2시부터 씁니다.\n\n- 장소: 221동\n- 준비물: 노트북', author_id: 'u-admin', created_at: ago(2), updated_at: ago(2), hidden: false },
      { id: 2, board: 'free', title: '[시험] 몰래 넣은 코드가 걸러지는지 보는 글', body_md: '아래 줄들은 모두 **글자로만** 보이거나 사라져야 합니다.\n\n<script>alert("x")</script>\n\n<img src=x onerror="alert(1)">\n\n[눌러도 아무 일 없는 링크](javascript:alert(1))\n\n<a href="data:text/html,<script>alert(1)</script>">data 링크</a>\n\n<svg onload="alert(1)"></svg>\n\n<iframe src="https://example.com"></iframe>\n\n[정상 링크](https://www.snu.ac.kr)', author_id: 'u-member', created_at: ago(1), updated_at: ago(1), hidden: false },
      { id: 3, board: 'newcomer', title: '안녕하세요, 새로 온 시험회원입니다', body_md: '# 큰 제목은 작게 보입니다\n\n잘 부탁드립니다.', author_id: 'u-member', created_at: ago(20), updated_at: ago(20), hidden: false },
      { id: 4, board: 'files', title: '[세미나] 2020 보건정책 세미나 자료', body_md: '기존 세미나 게시판에서 이전한 글이라고 가정한 시험 글입니다.', author_id: 'u-alum', created_at: ago(1500), updated_at: ago(1500), hidden: false },
      { id: 5, board: 'free', title: '관리자가 숨긴 글', body_md: '관리자와 글쓴이에게만 보입니다.', author_id: 'u-alum', created_at: ago(5), updated_at: ago(5), hidden: true },
      { id: 6, board: 'photos', title: '2026 봄 연구실 나들이(시험 사진)', body_md: '', author_id: 'u-admin', created_at: ago(30), updated_at: ago(30), hidden: false },
      { id: 7, board: 'seminar', title: '10월 연구실 세미나 후기(시험 글)', body_md: '시험용 글입니다.\n\n발표 뒤 나온 질문:\n\n- 자료를 연도별로 나눠 보면 어떨까\n- 다음 세미나는 11월 둘째 주', author_id: 'u-alum', created_at: ago(3), updated_at: ago(3), hidden: false },
      { id: 8, board: 'seminar', status: 'draft', title: '12월 세미나 후기(쓰는 중)', body_md: '시험회원이 **임시저장**해 둔 글입니다. 글쓴이에게만 보입니다.', author_id: 'u-member', created_at: ago(0.2), updated_at: ago(0.1), hidden: false }
    ];
    var comments = [
      { id: 1, post_id: 1, author_id: 'u-member', body: '확인했습니다.\n<b>굵게 아님</b>', created_at: ago(1), hidden: false },
      { id: 2, post_id: 7, author_id: 'u-member', body: '정리 고맙습니다.', created_at: ago(2), hidden: false }
    ];
    // 11-02부터 화면에서 본인 확인 요청을 받지 않음(새 메일로 가입 신청). 관리 화면의 요청 칸은 남아 있어 비워 둠
    var help = [];
    return { version: VERSION, users: users, posts: posts, comments: comments, attachments: [], log: [], resets: [],
      withdraw: ['u-alum'], help: help, mail: [], site: null, seq: { posts: 8, comments: 2, attachments: 0, log: 0, help: 1 }, seededPhotos: false };
  }

  // 가짜 사진첩용 그림을 처음 한 번 만든다.
  async function seedPhotos(s) {
    if (s.seededPhotos) return;
    var colors = [['#13203a', '#c9a45c'], ['#3c4557', '#e7d6b0'], ['#0e1a30', '#a8834a']];
    for (var i = 0; i < colors.length; i++) {
      var c = document.createElement('canvas');
      c.width = 800; c.height = 600;
      var g = c.getContext('2d');
      g.fillStyle = colors[i][0]; g.fillRect(0, 0, 800, 600);
      g.fillStyle = colors[i][1]; g.font = '48px serif'; g.fillText('시험 사진 ' + (i + 1), 260, 310);
      var blob = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.85); });
      var id = nextId(s, 'attachments');
      var path = 'u-admin/seed-' + id + '.jpg';
      await putBlob(path, blob);
      s.attachments.push({ id: id, post_id: 6, owner_id: 'u-admin', bucket: 'gallery', path: path, original_name: '시험사진' + (i + 1) + '.jpg', mime: 'image/jpeg', size_bytes: blob.size, created_at: now() });
    }
    s.seededPhotos = true;
    save(s);
  }

  // ---------------------------------------------------------------- 도움
  function me(s) {
    var id = localStorage.getItem(SKEY);
    var u = id && s.users.filter(function (x) { return x.id === id; })[0];
    return u || null;
  }
  function publicUser(u) {
    return { id: u.id, username: u.username, display_name: u.display_name, role: u.role, status: u.status, kind: u.kind };
  }
  function nameOf(s, id) {
    var u = s.users.filter(function (x) { return x.id === id; })[0];
    return u ? (u.status === 'withdrawn' ? '탈퇴한 회원' : u.display_name) : '탈퇴한 회원';
  }
  function needMember(s) {
    var u = me(s);
    if (!u || !(u.role === 'member' || u.role === 'admin') || u.status !== 'active') throw err('회원만 할 수 있습니다.');
    return u;
  }
  // 진짜 서버의 assert_admin 과 같다: 관리자이고 이번 로그인에서 2단계 인증(인증 앱)을 마쳤는가. 가짜에서는 '인증 앱 등록(시험)'을 누르면 마친 것으로 친다
  function needAdmin(s) {
    var u = needMember(s);
    if (u.role !== 'admin') throw err('관리자만 할 수 있습니다.');
    if (!u.mfa) throw err('관리자는 2단계 인증을 마친 뒤에 할 수 있습니다.');
    return u;
  }
  function errCode(msg, code) { var e = err(msg); e.code = code; return e; }
  function userBy(s, id) { return s.users.filter(function (x) { return x.id === id; })[0] || null; }
  var EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
  var KINDS = ['재학', '졸업', '교수', '기타'];
  // 메일을 바꾸기 전에 다른 길로 본인임을 확인한 방법(기록에 남음). 이름 · 졸업 연도는 졸업생 화면에 공개돼 있어 그것만으로는 확인이 안 된다
  var CHECK_METHODS = ['연구실이 아는 번호로 전화', '연구실이 아는 메신저', '교수님 확인', '동기 · 선후배 확인', '직접 만남'];
  // 가짜 메일함: 진짜 서버라면 메일로 갈 것을 쌓아 두고 로그인 · 가입 · 관리 화면 아래 '가짜 메일함'에 보인다
  function mail(s, to, subject, body, link) {
    s.mail.unshift({ to: to, subject: subject, body: body, link: link || null, created_at: now() });
    s.mail = s.mail.slice(0, 20);
  }
  function hashText(t) { var x = 5381; for (var i = 0; i < t.length; i++) x = ((x << 5) + x + t.charCodeAt(i)) | 0; return String(x >>> 0); }
  // 관리 화면에 실린 공개 표(만들 때 data/*.csv 를 그대로 넣음, 미리 보기에서만)
  function siteBase() {
    var d = window.Lab.pageData().site_tables;
    if (!d || !d.rules || !d.texts) throw err('이 화면에는 사이트 내용이 실려 있지 않습니다.');
    return d;
  }
  // 사이트를 다시 만들어 표가 바뀌었으면 가짜에서 고친 것은 버리고 새 표로 시작한다
  function siteState(s) {
    var base = siteBase(), sig = hashText(JSON.stringify(base.texts));
    if (!s.site || s.site.sig !== sig) s.site = { sig: sig, texts: Object.assign({}, base.texts), photos: {} };
    return s.site;
  }
  function countToday(list, who, field) {
    var since = Date.now() - DAY;
    return list.filter(function (x) { return x[field] === who && Date.parse(x.created_at) > since; }).length;
  }
  function checkPassword(pw) {
    if (typeof pw !== 'string' || pw.length < 8) throw err('비밀번호는 8자 이상으로 정해 주십시오.');
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw err('비밀번호에 영문과 숫자를 함께 넣어 주십시오.');
  }
  function log(s, admin, action, target, detail) {
    s.log.push({ id: nextId(s, 'log'), admin_id: admin.id, action: action, target: target, detail: detail || '', created_at: now() });
  }
  // 서버 규칙 posts_select 와 같다: 내 글(임시저장 · 숨김 포함)은 늘, 남의 글은 올린 글만(숨긴 글 · '관리자만' 글은 관리자만)
  function isDraft(p) { return p.status === 'draft'; }
  function visiblePost(s, u, p) {
    return p && (p.author_id === u.id || (!isDraft(p) && (!p.hidden || u.role === 'admin') && (!adminsOnly(p) || u.role === 'admin')));
  }
  // 올리기 설정(11-02, 서버 20261102010000_post_settings.sql). 이 판 전에 저장한 글에는 칸이 없으므로 없으면 기본값으로 읽는다(판 번호 그대로)
  function adminsOnly(p) { return p.visibility === 'admins'; }
  function settingsOf(p) {
    return { tags: (p.tags || []).slice(), cover_path: p.cover_path || null, visibility: adminsOnly(p) ? 'admins' : 'members',
      allow_comments: p.allow_comments !== false, pinned: !!p.pinned };
  }
  // 서버 트리거 posts_settings_before_write 와 같다: 앞뒤 빈칸 · 앞의 '#' 떼기 → 빈 것 빼기 → 같은 것은 처음 것만, 5개 · 20자까지
  function cleanTags(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (x) {
      var t = String(x == null ? '' : x).trim().replace(/^#+/, '').trim();
      if (t && out.indexOf(t) === -1) out.push(t);
    });
    if (out.length > 5) throw err('태그는 글마다 5개까지입니다.');
    if (out.some(function (t) { return t.length > 20; })) throw err('태그 하나는 20자까지입니다.');
    return out;
  }
  // 대표 사진: 아직 이 글에 달린 사진일 때만(서버 post_list 와 같다)
  function coverOf(s, p) {
    var c = p.cover_path;
    return c && s.attachments.some(function (a) { return a.post_id === p.id && a.bucket === 'gallery' && a.path === c; }) ? c : null;
  }
  // 진짜 서버의 boards 표 대신 화면에 실린 게시판 목록(data/boards.csv)을 본다.
  function boardOf(slug) {
    return (window.Lab.pageData().boards || []).filter(function (b) { return b.slug === slug; })[0] || null;
  }
  // 서버 규칙 attachments_insert 와 같다: 사진 칸 그림은 모든 게시판 글에(본문 그림 · 사진첩), 자료는 첨부 허용 게시판에만.
  function fileAllowed(b, bucket) {
    return bucket === 'gallery' || (bucket === 'files' && b.files && !b.gallery);
  }
  function boardName(slug) { var b = boardOf(slug); return b ? b.name : slug; }
  function makeReset(s, user) {
    var token = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    s.resets.push({ token: token, user_id: user.id, expires: Date.now() + 3600000, used: false, created: Date.now() });
    return window.Lab.url('/login/reset/') + '?token_hash=' + token + '&type=recovery';
  }

  // ---------------------------------------------------------------- 바깥에 보이는 기능(진짜 서버 연결과 같은 이름)
  var api = {
    name: 'fake',

    session: async function () {
      var s = load();
      var u = me(s);
      if (u && (u.status === 'withdrawn')) { localStorage.removeItem(SKEY); u = null; }
      return delay(u ? { user: publicUser(u) } : null);
    },

    signIn: async function (login, password) {
      var s = load();
      var key = String(login || '').trim().toLowerCase();
      var u = s.users.filter(function (x) { return x.username === key || (x.email && x.email === key); })[0];
      await delay();
      // 11-13 연구자 결정: 옮겨 온 회원은 예전 비밀번호 그대로. 진짜 서버에서는 보통 로그인이 틀리면 서버 도우미 login-help 의
      // legacy_login 이 옛 값(워드프레스 방식)으로 확인하고, 맞으면 새 방식으로 저장 · 옛 값 삭제 · 상태 active 로 바꾼 뒤 다시 로그인한다.
      // 가짜에서는 시험용 옛 비밀번호(LEGACY_TEST_PW)가 그 역할. 틀리면 늘 같은 글(누가 회원인지 드러내지 않음)
      if (u && u.status === 'needs_password' && u.legacy && !u.password && password === LEGACY_TEST_PW) {
        u.password = password; u.status = 'active'; save(s);
      }
      if (!u || !u.password || u.password !== password || u.status === 'withdrawn' || u.status === 'needs_password') {
        // 미리 보기 서버(migrate/preview_server.py)가 있으면 옮긴 실제 회원의 예전 비밀번호로도 확인해 본다(이 컴퓨터 안에서만).
        // 비밀번호는 이 브라우저에 저장하지 않는다(다음에도 서버가 다시 확인)
        var r = null;
        try {
          var res = await fetch(window.Lab.url('/__old/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: key, password: String(password || '') }) });
          r = res.ok ? await res.json() : null;
        } catch (e) { r = null; }
        if (!(r && r.ok && r.user)) throw errCode('아이디 또는 비밀번호가 맞지 않습니다.', 'bad_login');
        var oid = 'old-' + r.user.lid;
        var ou = userBy(s, oid);
        if (!ou) { ou = { id: oid, created_at: '2015-01-01T00:00:00Z', approved_at: '2015-01-01T00:00:00Z' }; s.users.push(ou); }
        Object.assign(ou, { username: r.user.username, display_name: r.user.name || '기존회원', kind: r.user.kind || '졸업', email: '',
          intro: '', role: 'member', status: 'active', legacy: true, password: null, old_login: true });
        save(s);
        localStorage.setItem(SKEY, ou.id); localStorage.removeItem(AUTO); localStorage.setItem(REAL, '1');
        return { user: publicUser(ou) };
      }
      localStorage.setItem(SKEY, u.id);
      localStorage.removeItem(AUTO);
      localStorage.setItem(REAL, '1');
      return { user: publicUser(u) };
    },

    signOut: async function () { [SKEY, AUTO, REAL].forEach(function (k) { localStorage.removeItem(k); }); localStorage.setItem(NOAUTO, '1'); return delay(true); },

    // 미리 보기에서만(config previewOpen): 로그인 안 한 사람에게 '시험회원' 화면을 보여 준다.
    // 한 번 로그아웃하면 이 브라우저에서는 멈춰서, 로그인 화면 · 가입 흐름도 그대로 시험할 수 있다.
    // 10-28: 관리 화면(role 'admin')이면 '시험관리자'로(연구자: 관리 화면을 바로 확인할 수 있게).
    // force: 관리 화면의 '시험관리자로 보기' 단추(로그아웃했거나 직접 로그인한 뒤에도 바꿈)
    previewSignIn: async function (role, force) {
      if (localStorage.getItem(NOAUTO) && !force) return null;
      if (force) localStorage.removeItem(NOAUTO);
      var s = load();
      var u = s.users.filter(function (x) { return x.id === (role === 'admin' ? 'u-admin' : 'u-member'); })[0];
      if (!u || u.status !== 'active' || (role === 'admin' && u.role !== 'admin')) return null;
      localStorage.setItem(SKEY, u.id);
      localStorage.setItem(AUTO, '1');
      localStorage.removeItem(REAL);
      return delay({ user: publicUser(u), preview: true });
    },
    // 10-28 18시 전 미리 보기는 표시 없이 '시험회원'을 넣었으므로, 직접 로그인 표시가 없는 로그인도 미리 보기 것으로 본다
    isPreviewSession: function () { return !!localStorage.getItem(AUTO) || (!!localStorage.getItem(SKEY) && !localStorage.getItem(REAL)); },

    // 있는 계정인지 알려 주지 않는다. 가짜에서만 '가짜 메일함' 링크를 돌려준다.
    requestReset: async function (login) {
      var s = load();
      var key = String(login || '').trim().toLowerCase();
      var u = key && s.users.filter(function (x) { return x.username === key || (x.email && x.email === key); })[0];
      var link = null;
      // 서버 도우미 login-help 와 같은 한도: 계정마다 10분에 1번 · 하루 3번(넘으면 보내지 않지만 화면 글은 같음)
      if (u && u.email && u.status !== 'withdrawn' && u.status !== 'locked') {
        var mine = s.resets.filter(function (r) { return r.user_id === u.id && (r.created || 0) > Date.now() - DAY; });
        var recent = mine.some(function (r) { return r.created > Date.now() - 600000; });
        if (!recent && mine.length < 3) {
          link = makeReset(s, u);
          mail(s, u.email, '비밀번호 재설정 링크', '아이디: ' + u.username + ' · 링크는 1시간 동안 한 번만 열립니다.', link);
          save(s);
        }
      }
      return delay({ sent: true, fakeMailLink: link });
    },

    completeReset: async function (tokenHash, newPassword) {
      checkPassword(newPassword);
      var s = load();
      var r = s.resets.filter(function (x) { return x.token === tokenHash; })[0];
      if (!r || r.used || r.expires < Date.now()) throw err('링크가 지났거나 이미 썼습니다. 비밀번호 찾기를 다시 해 주십시오.');
      var u = s.users.filter(function (x) { return x.id === r.user_id; })[0];
      if (!u) throw err('링크가 지났거나 이미 썼습니다. 비밀번호 찾기를 다시 해 주십시오.');
      r.used = true;
      u.password = newPassword;
      if (u.status === 'needs_password') u.status = 'active';
      localStorage.setItem(SKEY, u.id);
      localStorage.removeItem(AUTO);
      localStorage.setItem(REAL, '1');
      save(s);
      return delay({ user: publicUser(u), username: u.username });
    },

    signUp: async function (f) {
      var s = load();
      var username = String(f.username || '').trim().toLowerCase();
      // 새 메일로 가입 신청(11-02): 아이디 칸이 없고 메일로 로그인한다. 안에서 쓸 아이디는 메일 앞부분 + 숫자 넷으로 만든다(서버 login-help 와 같음)
      if (f.email_as_id === true && !username) {
        var base = String(f.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 12);
        if (base.length < 4) base = (base + 'user').slice(0, 4);
        do { username = base + '_' + String(Math.floor(1000 + Math.random() * 9000)); }
        while (s.users.some(function (x) { return x.username === username; }));
      }
      if (!/^[a-z0-9_]{4,20}$/.test(username)) throw err('아이디는 영문 소문자 · 숫자 · 밑줄로 4~20자입니다.');
      if (!f.display_name || f.display_name.length > 30) throw err('이름을 30자 안으로 적어 주십시오.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email || '')) throw err('메일 주소를 확인해 주십시오.');
      if ((f.intro || '').length > 100) throw err('한 줄 소개는 100자까지입니다.');
      checkPassword(f.password);
      var kind = KINDS.indexOf(f.kind) !== -1 ? f.kind : '기타';
      var course = kind === '재학' ? String(f.course || '').trim().slice(0, 20) : '';
      var year = kind === '재학' && /^(19|20)\d{2}$/.test(String(f.entry_year || '')) ? Number(f.entry_year) : null;
      var email = String(f.email).trim().toLowerCase();
      var taken = s.users.some(function (x) { return x.username === username; });
      var other = s.users.filter(function (x) { return x.email === email && x.status !== 'withdrawn'; })[0];
      await delay();
      // 아이디만은 겹치면 알려 준다(새 아이디를 고르려면 피할 수 없음). 화면이 '옛 아이디라면 비밀번호 처음 정하기'를 함께 보인다
      if (taken) throw errCode('이미 쓰는 아이디입니다.', 'username_taken');
      if (other) {
        // 메일이 이미 있으면 화면은 다른 신청과 똑같이 하고(누가 회원인지 드러내지 않음), 그 메일로 '이미 계정이 있습니다'를 보낸다
        var link = other.role !== 'pending' && other.status !== 'locked' ? makeReset(s, other) : null;
        mail(s, other.email, '이 메일로 이미 계정이 있습니다', '아이디: ' + other.username + (link
          ? ' · 새로 신청하지 않아도 됩니다. 아래 링크로 비밀번호를 정하면 바로 씁니다.' : ' · 가입 신청이 이미 들어가 있습니다. 관리자 승인을 기다려 주십시오.'), link);
      } else {
        s.users.push({ id: uid(), username: username, password: f.password, email: email, display_name: f.display_name.trim(),
          kind: kind, intro: (f.intro || '').trim(), role: 'pending', status: 'active', created_at: now(), approved_at: null,
          course: course || null, entry_year: year, show_email: kind === '재학' && f.show_email === true,
          old_username: String(f.old_username || '').replace(/\s/g, '').slice(0, 40) || null, email_as_id: f.email_as_id === true });   // 메일이 바뀐 옛 회원이 적은 예전 아이디(선택, 11-02)
      }
      save(s);
      return { ok: true };
    },

    // 본인 확인 요청(아이디 · 메일을 모르는 옛 회원, 로그인 없이). 서버 submit_help_request 와 같은 규칙
    submitHelp: async function (f) {
      var s = load();
      var name = String(f.name || '').trim(), email = String(f.email || '').trim().toLowerCase();
      var year = String(f.year || '').trim(), msg = String(f.message || '').trim();
      if (!name || name.length > 30) throw err('이름을 30자 안으로 적어 주십시오.');
      if (!EMAIL_RE.test(email) || email.length > 120) throw err('지금 연락되는 메일 주소를 확인해 주십시오.');
      if (year && !/^(19|20)\d{2}$/.test(year)) throw err('연도는 네 자리(예: 2012)로 적어 주십시오.');
      if (msg.length > 200) throw err('하실 말은 200자까지입니다.');
      var day = Date.now() - DAY;
      await delay();
      if (s.help.filter(function (r) { return r.email === email && Date.parse(r.created_at) > day; }).length >= 3)
        throw err('같은 메일로는 하루 세 번까지 보낼 수 있습니다. 조교가 확인할 때까지 기다려 주십시오.');
      var today = s.help.filter(function (r) { return Date.parse(r.created_at) > day; }).length;
      if (today >= 100) throw err('오늘은 요청이 많아 받지 못했습니다. 내일 다시 보내 주십시오.');
      var over = today >= 30;
      s.help.push({ id: nextId(s, 'help'), name: name, email: email, kind: KINDS.indexOf(f.kind) !== -1 ? f.kind : '기타',
        course: String(f.course || '').trim().slice(0, 20), year: year, message: msg, over_limit: over, status: 'open',
        handled_by: null, handled_at: null, handled_note: '', created_at: now() });
      save(s);
      return { ok: true };
    },

    // 가짜 메일함(시험에서만 있음)
    mailbox: async function () { var s = load(); return delay(s.mail.slice(0, 8)); },

    // tag: 이 태그가 붙은 글만(11-02). q: 제목 · 글쓴이에 이 말이 든 글만(11-02, 대소문자 무시).
    // 고정 글이 맨 위, 그다음 최근 차례(서버: order by pinned desc, created_at desc)
    listPosts: async function (board, page, tag, q) {
      var s = await loadAll(); var u = needMember(s);
      var qq = String(q || '').trim().toLowerCase();
      // 서버의 글 목록 모아 보기(post_list)처럼 올린 글만. 첨부 수는 자료만, 그림 수는 따로.
      var all = s.posts.filter(function (p) { return p.board === board && !isDraft(p) && visiblePost(s, u, p) && (!tag || (p.tags || []).indexOf(tag) !== -1)
          && (!qq || (p.title + ' ' + nameOf(s, p.author_id)).toLowerCase().indexOf(qq) !== -1); })
        .sort(function (a, b) { return (!!b.pinned - !!a.pinned) || b.created_at.localeCompare(a.created_at); });
      var size = 20, pg = Math.max(1, page || 1);
      var items = all.slice((pg - 1) * size, pg * size).map(function (p) {
        return { id: p.id, title: p.title, author_name: nameOf(s, p.author_id), created_at: p.created_at, hidden: p.hidden,
          comment_count: s.comments.filter(function (c) { return c.post_id === p.id && !c.hidden; }).length,
          file_count: s.attachments.filter(function (a) { return a.post_id === p.id && a.bucket === 'files'; }).length,
          image_count: s.attachments.filter(function (a) { return a.post_id === p.id && a.bucket === 'gallery'; }).length,
          tags: settingsOf(p).tags, cover_path: coverOf(s, p), visibility: settingsOf(p).visibility,
          allow_comments: settingsOf(p).allow_comments, pinned: settingsOf(p).pinned };
      });
      return delay({ items: items, total: all.length, size: size, page: pg, tag: tag || null, q: qq || null });
    },

    getPost: async function (id) {
      var s0 = load(); needMember(s0);
      if (s0.posts.some(function (x) { return x.board === 'photos'; })) await seedPhotos(s0);
      var s = await loadAll(); var u = needMember(s);
      var p = s.posts.filter(function (x) { return x.id === Number(id); })[0];
      if (!visiblePost(s, u, p)) throw err('없는 글이거나 볼 수 없는 글입니다.');
      return delay({
        post: { id: p.id, board: p.board, title: p.title, body_md: p.body_md, body_html_legacy: p.body_html_legacy || null,
          author_id: p.author_id, author_name: nameOf(s, p.author_id), created_at: p.created_at, updated_at: p.updated_at, hidden: p.hidden,
          status: isDraft(p) ? 'draft' : 'published',
          tags: settingsOf(p).tags, cover_path: settingsOf(p).cover_path, visibility: settingsOf(p).visibility,
          allow_comments: settingsOf(p).allow_comments, pinned: settingsOf(p).pinned,
          can_comment: !isDraft(p) && (settingsOf(p).allow_comments || u.role === 'admin'),
          can_edit: !p.old && p.author_id === u.id, can_delete: !p.old && (p.author_id === u.id || u.role === 'admin'), can_hide: !p.old && u.role === 'admin' && !isDraft(p) },
        comments: s.comments.filter(function (c) { return c.post_id === p.id && (!c.hidden || u.role === 'admin'); }).map(function (c) {
          return { id: c.id, body: c.body, author_name: nameOf(s, c.author_id), created_at: c.created_at, can_delete: !c.old && (c.author_id === u.id || u.role === 'admin') };
        }),
        attachments: s.attachments.filter(function (a) { return a.post_id === p.id; }).map(function (a) {
          return { id: a.id, bucket: a.bucket, path: a.path, original_name: a.original_name, mime: a.mime, size_bytes: a.size_bytes };
        })
      });
    },

    // f: { id(고칠 때), board, title, body_md, status: 'draft' | 'published', remove: [뺄 첨부 id],
    //      tags: [글], cover_path: 본문 사진 경로 | null, visibility: 'members' | 'admins', allow_comments, pinned(관리자만) } — 설정 칸은 빠지면 그대로 둔다
    // files: [{ blob, name, mime, size, ext, bucket: 'gallery' | 'files', path(본문 그림은 편집기가 정한 경로) }]
    // 진짜 서버에서는: 파일 칸에 올리기 → 글 줄(posts) 넣기 · 고치기 → 첨부 줄 넣기 → 뺀 첨부는 파일 칸 · 첨부 줄 모두 지우기.
    savePost: async function (f, files) {
      var s = load(); var u = needMember(s);
      var title = String(f.title || '').trim(), body = String(f.body_md || '');
      var status = f.status === 'draft' ? 'draft' : 'published';
      if (!title || title.length > 200) throw err('제목을 200자 안으로 적어 주십시오.');
      if (body.length > 20000) throw err('본문은 20,000자까지입니다.');
      files = files || [];
      var p = f.id ? s.posts.filter(function (x) { return x.id === Number(f.id); })[0] : null;
      if (f.id && (!p || p.author_id !== u.id)) throw err('내가 쓴 글만 고칠 수 있습니다.');
      if (p && !isDraft(p) && status === 'draft') throw err('올린 글은 임시저장으로 되돌릴 수 없습니다.');
      var b = boardOf(p ? p.board : f.board);
      if (!b) throw err('없는 게시판입니다.');
      if (files.some(function (x) { return !fileAllowed(b, x.bucket); })) throw err('이 게시판에는 그 파일을 붙일 수 없습니다.');
      if (files.some(function (x) { return x.bucket === 'gallery' && x.mime !== 'image/jpeg'; })) throw err('그림은 JPEG 로 다시 저장해서 올립니다.');
      if (files.some(function (x) { return x.path && !(LAB_PATH.test(x.path) && x.path.indexOf(u.id + '/') === 0); })) throw err('파일 경로가 올바르지 않습니다.');
      var remove = (f.remove || []).map(Number);
      if (remove.some(function (id) { var a = s.attachments.filter(function (x) { return x.id === id; })[0]; return !a || !p || a.post_id !== p.id || a.owner_id !== u.id; }))
        throw err('뺄 수 없는 첨부입니다.');
      if (!p && countToday(s.posts, u.id, 'author_id') >= LIMITS.posts) throw err('하루에 글은 30개까지 쓸 수 있습니다.');
      if (countToday(s.attachments, u.id, 'owner_id') + files.length > LIMITS.files) throw err('하루에 파일 · 그림은 100개까지 올릴 수 있습니다.');
      // 올리기 설정(서버 트리거 posts_settings_before_write · 칸 검사와 같은 규칙)
      var tags = 'tags' in f ? cleanTags(f.tags) : (p ? settingsOf(p).tags : []);
      var vis = 'visibility' in f ? f.visibility : (p ? settingsOf(p).visibility : 'members');
      if (vis !== 'members' && vis !== 'admins') throw err('공개 범위는 회원 전체 · 관리자만 가운데 고릅니다.');
      var allowC = 'allow_comments' in f ? f.allow_comments !== false : (p ? settingsOf(p).allow_comments : true);
      var pinned = 'pinned' in f ? !!f.pinned : (p ? settingsOf(p).pinned : false);
      if (pinned !== (p ? settingsOf(p).pinned : false) && !(u.role === 'admin' && u.mfa)) throw err('위에 고정은 관리자만 켜고 끌 수 있습니다.');
      var cover = 'cover_path' in f ? (f.cover_path || null) : (p ? settingsOf(p).cover_path : null);
      if (cover && !(LAB_PATH.test(cover) && (cover === (p && p.cover_path) || files.some(function (x) { return x.bucket === 'gallery' && x.path === cover; }) ||
        (p && s.attachments.some(function (a) { return a.post_id === p.id && a.bucket === 'gallery' && a.path === cover && remove.indexOf(a.id) === -1; })))))
        throw err('대표 사진은 이 글 본문에 넣은 사진에서만 고를 수 있습니다.');
      if (p) {
        if (isDraft(p) && status === 'published') p.created_at = now();   // 올리는 순간이 쓴 때(목록 맨 위로)
        p.title = title; p.body_md = body; p.status = status; p.updated_at = now();
      } else {
        p = { id: nextId(s, 'posts'), board: b.slug, status: status, title: title, body_md: body, author_id: u.id, created_at: now(), updated_at: now(), hidden: false };
        s.posts.push(p);
      }
      p.tags = tags; p.cover_path = cover; p.visibility = vis; p.allow_comments = allowC; p.pinned = pinned;
      for (var r = 0; r < remove.length; r++) {
        var gone = s.attachments.filter(function (x) { return x.id === remove[r]; })[0];
        await delBlob(gone.path);
        s.attachments = s.attachments.filter(function (x) { return x.id !== gone.id; });
      }
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var aid = nextId(s, 'attachments');
        var path = file.path || (u.id + '/' + crypto.randomUUID() + '.' + (file.ext || 'bin'));
        await putBlob(path, file.blob);
        s.attachments.push({ id: aid, post_id: p.id, owner_id: u.id, bucket: file.bucket, path: path, original_name: file.name, mime: file.mime, size_bytes: file.size, created_at: now() });
      }
      save(s);
      return delay({ id: p.id, status: status, updated_at: p.updated_at });
    },

    deletePost: async function (id) {
      var s = load(); var u = needMember(s);
      var p = s.posts.filter(function (x) { return x.id === Number(id); })[0];
      if (!p || !(p.author_id === u.id || u.role === 'admin')) throw err('지울 수 없는 글입니다.');
      var atts = s.attachments.filter(function (a) { return a.post_id === p.id; });
      for (var i = 0; i < atts.length; i++) await delBlob(atts[i].path);
      s.attachments = s.attachments.filter(function (a) { return a.post_id !== p.id; });
      s.comments = s.comments.filter(function (c) { return c.post_id !== p.id; });
      s.posts = s.posts.filter(function (x) { return x.id !== p.id; });
      if (u.role === 'admin' && p.author_id !== u.id) log(s, u, '글 지움', 'post:' + p.id, p.title);
      save(s);
      return delay(true);
    },

    setHidden: async function (id, hidden) {
      var s = load(); var u = needAdmin(s);
      var p = s.posts.filter(function (x) { return x.id === Number(id); })[0];
      if (!p) throw err('없는 글입니다.');
      p.hidden = !!hidden;
      log(s, u, hidden ? '글 숨김' : '글 다시 보임', 'post:' + p.id, p.title);
      save(s);
      return delay(true);
    },

    addComment: async function (postId, body) {
      var s = load(); var u = needMember(s);
      body = String(body || '').trim();
      if (!body || body.length > 2000) throw err('댓글은 2,000자 안으로 적어 주십시오.');
      var all = await loadAll();   // 옮긴 기존 글에도 댓글을 달 수 있게 찾기만 합친 자료에서(저장은 s 에)
      var p = all.posts.filter(function (x) { return x.id === Number(postId); })[0];
      if (!visiblePost(s, u, p)) throw err('없는 글입니다.');
      if (isDraft(p)) throw err('임시저장 글에는 댓글을 달 수 없습니다.');
      if (!settingsOf(p).allow_comments && u.role !== 'admin') throw err('댓글을 받지 않는 글입니다.');
      if (countToday(s.comments, u.id, 'author_id') >= LIMITS.comments) throw err('하루에 댓글은 100개까지 쓸 수 있습니다.');
      s.comments.push({ id: nextId(s, 'comments'), post_id: p.id, author_id: u.id, body: body, created_at: now(), hidden: false });
      save(s);
      return delay(true);
    },

    deleteComment: async function (id) {
      var s = load(); var u = needMember(s);
      var c = s.comments.filter(function (x) { return x.id === Number(id); })[0];
      if (!c || !(c.author_id === u.id || u.role === 'admin')) throw err('지울 수 없는 댓글입니다.');
      s.comments = s.comments.filter(function (x) { return x.id !== c.id; });
      save(s);
      return delay(true);
    },

    // 진짜 서버에서는 몇 분만 유효한 주소(사진 600초, 자료 60초)를 받는다. 가짜는 브라우저 안 주소를 만든다.
    // 볼 수 있는 글에 달린 파일이거나 내 폴더 파일만(서버 파일 칸 규칙 lab_files_read 와 같다).
    attachmentUrl: async function (att) {
      var s = await loadAll(); var u = needMember(s);
      var a = s.attachments.filter(function (x) { return x.path === att.path; })[0];
      var post = a && s.posts.filter(function (x) { return x.id === a.post_id; })[0];
      if (!(String(att.path || '').indexOf(u.id + '/') === 0 || (a && visiblePost(s, u, post)))) throw err('볼 수 없는 파일입니다.');
      if (a && a.old) return oldFileUrl(a);
      var blob = await getBlob(att.path);
      if (!blob) throw err('파일을 찾지 못했습니다.');
      return URL.createObjectURL(blob);
    },

    // 내 임시저장 글(모든 게시판, 최근 고친 차례)
    myDrafts: async function () {
      var s = load(); var u = needMember(s);
      return delay(s.posts.filter(function (p) { return p.author_id === u.id && isDraft(p); })
        .sort(function (a, b) { return b.updated_at.localeCompare(a.updated_at); })
        .map(function (p) { return { id: p.id, board: p.board, board_name: boardName(p.board), title: p.title, updated_at: p.updated_at }; }));
    },

    // 내가 올린 글(최근 차례, n개까지)
    myPosts: async function (n) {
      var s = load(); var u = needMember(s);
      return delay(s.posts.filter(function (p) { return p.author_id === u.id && !isDraft(p); })
        .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); }).slice(0, n || 10)
        .map(function (p) {
          return { id: p.id, board: p.board, board_name: boardName(p.board), title: p.title, created_at: p.created_at, hidden: p.hidden,
            comment_count: s.comments.filter(function (c) { return c.post_id === p.id && !c.hidden; }).length };
        }));
    },

    galleryList: async function () {
      var s = load(); var u = needMember(s);
      await seedPhotos(s);
      s = await loadAll();
      return delay(s.posts.filter(function (p) { return (boardOf(p.board) || {}).gallery && !isDraft(p) && visiblePost(s, u, p); })
        .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); })
        .map(function (p) {
          // 대표 사진: 글에 고른 사진(cover_path)이 아직 달려 있으면 그것, 아니면 첫 사진(11-13 행사 기록 연대표)
          var pics = s.attachments.filter(function (a) { return a.post_id === p.id && a.bucket === 'gallery'; });
          var c = coverOf(s, p);
          var cover = (c && pics.filter(function (a) { return a.path === c; })[0]) || pics[0] || null;
          return { id: p.id, title: p.title, created_at: p.created_at, author_name: nameOf(s, p.author_id), cover: cover,
            count: pics.length };
        }));
    },

    myProfile: async function () {
      var s = load(); var u = me(s);
      if (!u) throw err('로그인이 필요합니다.');
      return delay({ username: u.username, display_name: u.display_name, email: u.email, kind: u.kind, role: u.role, created_at: u.created_at,
        withdraw_requested: s.withdraw.indexOf(u.id) !== -1, cv_url: u.cv_url || '', person_no: u.person_no || null, cv_public: u.cv_public !== false });
    },

    updateDisplayName: async function (name) {
      var s = load(); var u = needMember(s);
      name = String(name || '').trim();
      if (!name || name.length > 30) throw err('이름을 30자 안으로 적어 주십시오.');
      u.display_name = name;
      save(s);
      return delay(true);
    },

    // CV 주소(서버 profiles.cv_url 과 같은 규칙: https만, 300자까지, 비우면 지움). show: 구성원 카드에 보일지(profiles.cv_public, 11-02)
    updateMyCv: async function (url, show) {
      var s = load(); var u = needMember(s);
      url = String(url || '').trim();
      if (url && (url.length > 300 || !/^https:\/\/[^\s<>"'`]+$/.test(url))) throw err('CV 주소는 https:// 로 시작하는 주소로 적어 주십시오(빈칸 없이, 300자까지).');
      u.cv_url = url || null;
      if (typeof show === 'boolean') u.cv_public = show;
      save(s);
      return delay(true);
    },

    // ---- 내 구성원 카드 사진 · 관심 분야(11-02). 본인은 요청만, 관리자가 '할 일'에서 승인해야 공개 표가 바뀐다
    // (서버: profile_requests 표 · request_profile_change · my_profile_requests, 사진은 비공개 칸 profile-photos)
    // 내 카드의 지금 공개 값. 미리 보기에서는 관리 화면에서 고친 표(이 브라우저 안)를, 진짜 서버에서는 화면에 실린 카드 값을 쓴다
    myCard: async function () {
      var s = load(); var u = needMember(s);
      if (!u.person_no) return delay(null);
      var no = String(u.person_no), T = window.LabSiteTables, d = window.Lab.pageData();
      if (d.site_tables && T) {
        var st = siteState(s), rules = siteBase().rules;
        save(s);
        var found = null;
        ['people', 'alumni'].forEach(function (name) {
          if (found) return;
          T.rows(T.parse(st.texts[name])).forEach(function (row) { if (row['번호'] === no) found = { name: name, row: row }; });
        });
        if (!found) return delay(null);
        var t = rules.tables[found.name];
        return delay({ table: found.name, label: t.label, interest: found.name === 'people' ? found.row['관심 분야'] || '' : null,
          photo_url: found.row['사진'] ? await api.sitePhotoUrl(t.photo_dir + '/' + found.row['사진']) : '' });
      }
      var c = (d.cards || {})[no];
      return delay(c ? { table: c.table, label: c.label, interest: c.interest, photo_url: c.photo ? window.Lab.url(c.photo) : '' } : null);
    },
    myProfileRequests: async function () {
      var s = load(); var u = needMember(s);
      var out = {};
      (s.requests || []).filter(function (r) { return r.user_id === u.id && r.status !== 'canceled'; }).forEach(function (r) {
        if (!out[r.kind] || out[r.kind].created_at < r.created_at) out[r.kind] = r;
      });
      return delay(Object.keys(out).map(function (k) { var r = out[k]; return { id: r.id, kind: r.kind, interest: r.interest, has_photo: !!r.photo_key,
        status: r.status, reason: r.reason || '', created_at: r.created_at, decided_at: r.decided_at || null }; }));
    },
    // kind 'photo': value 는 세로 4:5 JPEG(LabUpload.portrait). kind 'interest': value 는 키워드 0~5개를 ' · '로 이은 글
    // (11-02 저녁, 하나에 30자까지. 비우면 관심 분야를 지워 달라는 뜻. 서버 request_profile_change 와 같은 조건)
    requestProfileChange: async function (kind, value) {
      var s = load(); var u = needMember(s);
      s.requests = s.requests || [];
      // 카드와 아직 안 이어진 회원도 낸다(조교가 승인할 때 카드를 고르고 잇는다). 교수님 카드는 조교가 고친다
      if (u.kind === '교수') throw err('교수님 소개는 관리자가 관리 화면에서 고칩니다.');
      if (s.requests.filter(function (r) { return r.user_id === u.id && Date.now() - Date.parse(r.created_at) < DAY; }).length >= 10) throw err('오늘은 요청을 더 낼 수 없습니다(하루 10건).');
      var r = { id: nextId(s, 'requests'), user_id: u.id, person_no: u.person_no, kind: kind, interest: null, photo_key: null,
        status: 'pending', reason: '', created_at: now(), decided_at: null, decided_by: null };
      if (kind === 'interest') {
        var kws = String(value || '').replace(/\s+/g, ' ').trim();
        kws = kws ? kws.split(/\s*[,·]\s*/) : [];
        if (kws.length > 5) throw err('관심 분야 키워드는 5개까지 보낼 수 있습니다.');
        if (kws.some(function (w) { return w.length < 1 || w.length > 30; })) throw err('키워드 하나는 1~30자로 적어 주십시오.');
        r.interest = kws.join(' · ');
      } else if (kind === 'photo') {
        if (!(value instanceof Blob) || value.type !== 'image/jpeg') throw err('올린 사진을 찾지 못했습니다. 다시 골라 주십시오.');
        if (value.size > 1048576) throw err('사진이 너무 큽니다(1MB까지).');
        r.photo_key = 'profile:' + u.id + '/' + r.id + '.jpg';
        await putBlob(r.photo_key, value);
      } else throw err('요청 갈래가 올바르지 않습니다.');
      // 같은 갈래의 기다리는 요청은 새 요청으로 바뀐다
      for (var i = 0; i < s.requests.length; i++) {
        var o = s.requests[i];
        if (o.user_id === u.id && o.kind === kind && o.status === 'pending') {
          o.status = 'canceled'; o.decided_at = now();
          if (o.photo_key) { await delBlob(o.photo_key); o.photo_key = null; }
        }
      }
      s.requests.push(r);
      save(s);
      return delay(r.id);
    },
    cancelProfileRequest: async function (id) {
      var s = load(); var u = needMember(s);
      var r = (s.requests || []).filter(function (x) { return x.id === id && x.user_id === u.id && x.status === 'pending'; })[0];
      if (!r) throw err('취소할 요청이 없습니다.');
      r.status = 'canceled'; r.decided_at = now();
      if (r.photo_key) { await delBlob(r.photo_key); r.photo_key = null; }
      save(s);
      return delay(true);
    },
    // 요청한 사진(본인 · 관리자만). 결정이 나면 지워져 null
    requestPhotoUrl: async function (id) {
      var s = load(); var u = needMember(s);
      var r = (s.requests || []).filter(function (x) { return x.id === id; })[0];
      if (!r || !r.photo_key || (r.user_id !== u.id && !(u.role === 'admin' && u.mfa))) return delay(null);
      var b = await getBlob(r.photo_key);
      return b ? URL.createObjectURL(b) : null;
    },
    requestPhotoBlob: async function (id) {
      var s = load(); needAdmin(s);
      var r = (s.requests || []).filter(function (x) { return x.id === id; })[0];
      var b = r && r.photo_key ? await getBlob(r.photo_key) : null;
      if (!b) throw err('요청한 사진 파일을 찾지 못했습니다. 본인에게 다시 올려 달라고 해 주십시오.');
      return b;
    },

    changePassword: async function (current, next) {
      var s = load(); var u = needMember(s);
      if (u.password !== current) throw err('지금 비밀번호가 맞지 않습니다.');
      checkPassword(next);
      u.password = next;
      save(s);
      return delay(true);
    },

    requestWithdraw: async function () {
      var s = load(); var u = needMember(s);
      if (s.withdraw.indexOf(u.id) === -1) s.withdraw.push(u.id);
      save(s);
      return delay(true);
    },

    // ---- 관리(관리자만)
    adminProfiles: async function () {
      var s = load(); needAdmin(s);
      return delay(s.users.filter(function (u) { return u.status !== 'withdrawn'; }).map(function (u) {
        return { id: u.id, username: u.username, display_name: u.display_name, kind: u.kind, intro: u.intro, role: u.role, status: u.status,
          created_at: u.created_at, withdraw_requested: s.withdraw.indexOf(u.id) !== -1, cv_url: u.cv_url || '',
          course: u.course || '', entry_year: u.entry_year || null, show_email: !!u.show_email, person_no: u.person_no || null,
          leaving_to: u.leaving_to || null, legacy: !!u.legacy, old_username: u.old_username || null };
      }));
    },
    adminProfileRequests: async function () {
      var s = load(); needAdmin(s);
      return delay((s.requests || []).filter(function (r) { return r.status === 'pending'; }).map(function (r) {
        var u = userBy(s, r.user_id) || {};
        return { id: r.id, user_id: r.user_id, display_name: u.display_name || '탈퇴한 회원', username: u.username || '', person_no: u.person_no || null,
          member_kind: u.kind || '', kind: r.kind, interest: r.interest, has_photo: !!r.photo_key, created_at: r.created_at };
      }));
    },
    // 승인은 공개 표를 고친 뒤에 부른다(관리 화면이 siteSave 로 표를 고치고 이어서 부름). 결정이 나면 올린 사진 파일을 지운다
    decideProfileRequest: async function (id, decision, reason) {
      var s = load(); var a = needAdmin(s);
      if (decision !== 'approved' && decision !== 'rejected') throw err('결정이 올바르지 않습니다.');
      var r = (s.requests || []).filter(function (x) { return x.id === id && x.status === 'pending'; })[0];
      if (!r) throw err('이미 처리했거나 취소된 요청입니다.');
      r.status = decision; r.reason = String(reason || '').trim().slice(0, 200); r.decided_at = now(); r.decided_by = a.id;
      if (r.photo_key) { await delBlob(r.photo_key); r.photo_key = null; }
      var u = userBy(s, r.user_id) || {};
      log(s, a, (r.kind === 'photo' ? '소개 사진 요청 ' : '관심 분야 요청 ') + (decision === 'approved' ? '승인' : '돌려보냄'), 'user:' + (u.username || ''), r.reason);
      save(s);
      return delay(true);
    },
    clearCv: async function (id) {
      var s = load(); var a = needAdmin(s);
      var u = s.users.filter(function (x) { return x.id === id; })[0];
      if (!u || !u.cv_url) throw err('지울 CV 주소가 없습니다.');
      u.cv_url = null;
      log(s, a, 'CV 주소 지움', 'user:' + u.username);
      save(s);
      return delay(true);
    },
    approve: async function (id) {
      var s = load(); var a = needAdmin(s);
      var u = s.users.filter(function (x) { return x.id === id; })[0];
      if (!u || u.role !== 'pending') throw err('승인할 신청이 없습니다.');
      u.role = 'member'; u.approved_at = now();
      log(s, a, '가입 승인', 'user:' + u.username);
      // 가입 승인 알림(11-02): 신청 완료 판이 '승인하면 메일로 알려 드립니다'라고 하므로 승인 때 한 통. 진짜 서버는 admin-account approve(11-02 밤)
      if (u.email) mail(s, u.email, '회원가입이 승인되었습니다', (u.email_as_id ? '이 메일 주소와' : '아이디 ' + u.username + ' 와') + ' 가입 때 정한 비밀번호로 로그인하십시오.', window.Lab.url('/login/'));
      save(s);
      return delay(true);
    },
    reject: async function (id) {
      var s = load(); var a = needAdmin(s);
      var u = s.users.filter(function (x) { return x.id === id; })[0];
      if (!u || u.role !== 'pending') throw err('거절할 신청이 없습니다.');
      s.users = s.users.filter(function (x) { return x.id !== id; });
      log(s, a, '가입 거절', 'user:' + u.username);
      save(s);
      return delay(true);
    },
    setRole: async function (id, role) {
      var s = load(); var a = needAdmin(s);
      if (['member', 'admin'].indexOf(role) === -1) throw err('등급은 회원 · 관리자만 고를 수 있습니다.');
      var u = s.users.filter(function (x) { return x.id === id; })[0];
      if (!u || u.role === 'pending') throw err('바꿀 수 없는 회원입니다.');
      if (u.id === a.id && role !== 'admin') throw err('내 관리자 등급은 다른 관리자가 바꿔야 합니다.');
      if (s.users.some(function (x) { return x.leaving_to === u.id; }) || u.leaving_to) throw err('관리자 넘기는 중인 사람입니다. 넘기기를 끝내거나 취소한 뒤 바꿔 주십시오.');
      if (role === 'admin' && s.users.filter(function (x) { return x.role === 'admin'; }).length >= 2 && u.role !== 'admin') throw err('관리자는 두 명까지입니다.');
      log(s, a, '등급 바꿈', 'user:' + u.username, u.role + ' → ' + role);
      if (role === 'admin' && u.role !== 'admin') u.mfa = false;   // 새 관리자는 인증 앱 등록부터
      u.role = role;
      save(s);
      return delay(true);
    },
    setStatus: async function (id, status) {
      var s = load(); var a = needAdmin(s);
      if (['active', 'locked'].indexOf(status) === -1) throw err('바꿀 수 없는 상태입니다.');
      var u = s.users.filter(function (x) { return x.id === id; })[0];
      if (!u || u.id === a.id) throw err('바꿀 수 없는 회원입니다.');
      log(s, a, status === 'locked' ? '계정 잠금' : '잠금 풂', 'user:' + u.username);
      u.status = status;
      save(s);
      return delay(true);
    },
    sendReset: async function (id) {
      var s = load(); var a = needAdmin(s);
      var u = s.users.filter(function (x) { return x.id === id; })[0];
      if (!u) throw err('없는 회원입니다.');
      if (!u.email) throw err('이 계정에는 메일이 없습니다. 먼저 메일을 바꿔 주십시오.');
      var link = makeReset(s, u);
      mail(s, u.email, '비밀번호 재설정 링크(관리자가 보냄)', '아이디: ' + u.username + ' · 링크는 1시간 동안 한 번만 열립니다.', link);
      log(s, a, '비밀번호 링크 보냄', 'user:' + u.username);
      save(s);
      return delay({ sent: true, fakeMailLink: link });
    },
    adminLog: async function () {
      var s = load(); needAdmin(s);
      return delay(s.log.slice().reverse().map(function (l) {
        return { id: l.id, action: l.action, target: l.target, detail: l.detail, admin_name: nameOf(s, l.admin_id), created_at: l.created_at,
          site: !!l.site, publish_state: l.publish_state || null, undone: !!l.undone_by, undo_of: l.undo_of || null };
      }));
    },

    // ---- 관리 화면 2판(2026-10-28): 본인 확인 요청 · 회원 한 사람 · 넘기기 · 사이트 내용
    // 나(관리자)의 2단계 인증 · 넘기기 상태. 진짜 서버에서는 로그인 정보(aal)와 my_profile 로 안다
    adminSelf: async function () {
      var s = load(); var u = needMember(s);
      if (u.role !== 'admin') throw err('관리자만 할 수 있습니다.');
      return delay({ mfa: !!u.mfa, leaving_to: u.leaving_to || null,
        incoming: s.users.filter(function (x) { return x.leaving_to === u.id; }).map(function (x) { return x.display_name; }) });
    },
    // 가짜에만 있음: 인증 앱을 등록하고 6자리 숫자로 들어온 것으로 친다
    registerMfa: async function () {
      var s = load(); var u = needMember(s);
      if (u.role !== 'admin') throw err('관리자만 할 수 있습니다.');
      u.mfa = true;
      log(s, u, '2단계 인증 등록', 'user:' + u.username);
      save(s);
      return delay(true);
    },
    memberEmail: async function (id) {
      var s = load(); needAdmin(s);
      var u = userBy(s, id);
      return delay(u ? u.email || '' : '');
    },
    adminHelp: async function () {
      var s = load(); needAdmin(s);
      return delay(s.help.slice().sort(function (a, b) {
        return (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.created_at.localeCompare(a.created_at);
      }));
    },
    closeHelp: async function (id, note) {
      var s = load(); var a = needAdmin(s);
      var r = s.help.filter(function (x) { return x.id === id && x.status === 'open'; })[0];
      if (!r) throw err('처리할 요청이 없습니다.');
      r.status = 'done'; r.handled_by = a.id; r.handled_at = now(); r.handled_note = String(note || '').slice(0, 200);
      log(s, a, '본인 확인 요청 처리', 'help:' + id, r.handled_note);
      save(s);
      return delay(true);
    },
    deleteHelp: async function (id) {
      var s = load(); var a = needAdmin(s);
      if (!s.help.some(function (x) { return x.id === id; })) throw err('없는 요청입니다.');
      s.help = s.help.filter(function (x) { return x.id !== id; });
      log(s, a, '본인 확인 요청 지움', 'help:' + id);
      save(s);
      return delay(true);
    },
    // 메일 바꾸기(서버: admin-account 도우미). 다른 길로 본인 확인한 방법을 꼭 받고, 옛 메일에 알린다
    setEmail: async function (id, email, method) {
      var s = load(); var a = needAdmin(s);
      var u = userBy(s, id);
      if (!u || u.status === 'withdrawn' || u.role === 'pending') throw err('바꿀 수 없는 회원입니다.');
      if (u.id === a.id) throw err('내 계정의 메일은 다른 관리자가 바꿔야 합니다.');
      if (CHECK_METHODS.indexOf(method) === -1) throw err('다른 길로 본인임을 어떻게 확인했는지 골라 주십시오.');
      email = String(email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 120) throw err('메일 주소를 확인해 주십시오.');
      if (s.users.some(function (x) { return x.id !== u.id && x.email === email && x.status !== 'withdrawn'; })) throw err('그 메일은 다른 계정이 쓰고 있습니다.');
      var old = u.email;
      if (old === email) return delay(true);
      u.email = email;
      if (old) mail(s, old, '계정 메일이 바뀌었습니다', '관리자가 본인 확인(' + method + ') 뒤 아이디 ' + u.username + ' 의 메일을 바꿨습니다. 본인이 요청하지 않았다면 연구실 조교에게 바로 알려 주십시오.');
      log(s, a, '메일 바꿈', 'user:' + u.username, '확인 방법: ' + method);
      save(s);
      return delay(true);
    },
    setKind: async function (id, kind) {
      var s = load(); var a = needAdmin(s);
      if (KINDS.indexOf(kind) === -1) throw err('구분은 재학 · 졸업 · 교수 · 기타 가운데 하나입니다.');
      var u = userBy(s, id);
      if (!u || u.role === 'pending' || u.status === 'withdrawn') throw err('바꿀 수 없는 회원입니다.');
      if (u.kind === kind) return delay(true);
      log(s, a, '구분 바꿈', 'user:' + u.username, u.kind + ' → ' + kind);
      u.kind = kind;
      save(s);
      return delay(true);
    },
    // 구성원 카드(공개 표 '번호')와 잇기 · 끊기(no = null)
    linkPerson: async function (id, no) {
      var s = load(); var a = needAdmin(s);
      no = no == null || no === '' ? null : Number(no);
      var u = userBy(s, id);
      if (!u || u.role === 'pending' || u.status === 'withdrawn') throw err('바꿀 수 없는 회원입니다.');
      if (no !== null && s.users.some(function (x) { return x.id !== id && x.person_no === no && x.status !== 'withdrawn'; })) throw err('그 구성원 명단 항목은 이미 다른 회원 계정과 연결되어 있습니다.');
      u.person_no = no;
      log(s, a, no === null ? '구성원 명단 연결 해제' : '구성원 명단 연결', 'user:' + u.username, no === null ? '' : '번호 ' + no);
      save(s);
      return delay(true);
    },
    // 탈퇴 처리(서버: admin-account 도우미가 파일 칸에서 먼저 지운 뒤 admin_remove_user). 글은 '탈퇴한 회원'으로 남는다
    withdrawDone: async function (id) {
      var s = load(); var a = needAdmin(s);
      var u = userBy(s, id);
      if (!u || s.withdraw.indexOf(id) === -1) throw err('탈퇴 요청이 없습니다.');
      if (u.id === a.id) throw err('내 계정은 다른 관리자가 지워야 합니다.');
      var mine = s.attachments.filter(function (x) { return x.owner_id === u.id; });
      for (var i = 0; i < mine.length; i++) await delBlob(mine[i].path);
      s.attachments = s.attachments.filter(function (x) { return x.owner_id !== u.id; });
      // 사진 · 관심 분야 요청도 지운다(서버: profile_requests 는 회원 정보와 함께 지워짐, 올린 사진은 탈퇴 도우미가 지움)
      var reqs = (s.requests || []).filter(function (x) { return x.user_id === u.id; });
      for (var j = 0; j < reqs.length; j++) if (reqs[j].photo_key) await delBlob(reqs[j].photo_key);
      s.requests = (s.requests || []).filter(function (x) { return x.user_id !== u.id; });
      s.withdraw = s.withdraw.filter(function (x) { return x !== id; });
      log(s, a, '회원 지움(탈퇴)', 'user:' + u.username);
      u.status = 'withdrawn'; u.email = null; u.password = null; u.person_no = null; u.cv_url = null; u.role = 'member';
      save(s);
      return delay(true);
    },
    withdrawCancel: async function (id) {
      var s = load(); var a = needAdmin(s);
      var u = userBy(s, id);
      if (!u || s.withdraw.indexOf(id) === -1) throw err('탈퇴 요청이 없습니다.');
      s.withdraw = s.withdraw.filter(function (x) { return x !== id; });
      log(s, a, '탈퇴 요청 취소', 'user:' + u.username);
      save(s);
      return delay(true);
    },
    // 가입 신청이 사실 옛 회원이면: 신청은 지우고 옛 계정 메일로 비밀번호 링크(옛 계정 메일이 없으면 본인 확인 뒤 메일부터 바꿈)
    // byClaim(11-02, 메일이 바뀐 옛 회원의 '새 메일로 가입 신청'): 신청서의 예전 아이디가 그 계정과 같을 때만,
    // 옛 계정 메일을 신청 메일로 바꾸고 옛 메일에 알린 뒤 새 메일로 링크(서버 admin-account link_old by_claim 과 같음)
    linkOld: async function (pendingId, oldId, byClaim) {
      var s = load(); var a = needAdmin(s);
      var p = userBy(s, pendingId), o = userBy(s, oldId);
      if (!p || p.role !== 'pending') throw err('가입 신청을 찾지 못했습니다.');
      if (!o || o.role === 'pending' || o.status === 'withdrawn') throw err('기존 계정을 찾지 못했습니다.');
      if (byClaim) {
        if (o.id === a.id) throw err('내 계정은 다른 관리자가 이어야 합니다.');
        if (String(p.old_username || '').toLowerCase() !== String(o.username).toLowerCase()) throw err('신청서에 기재한 기존 아이디가 이 계정과 다릅니다.');
        var before = o.email, fresh = p.email;
        s.users = s.users.filter(function (x) { return x.id !== pendingId; });
        o.email = fresh;
        if (before && before !== fresh) mail(s, before, '계정 메일이 바뀌었습니다', '새 메일로 들어온 가입 신청을 이 계정(아이디 ' + o.username + ')에 연결했습니다. 본인이 요청하지 않았다면 연구실 조교에게 바로 알려 주십시오.');
        var link2 = makeReset(s, o);
        mail(s, fresh, '기존 계정에 새 메일이 연결되었습니다', '아이디 ' + o.username + ' 계정의 메일을 이 주소로 변경했습니다. 아래 링크로 비밀번호를 정하면 바로 로그인할 수 있습니다.', link2);
        log(s, a, '가입 신청을 기존 계정과 연결', 'user:' + o.username, '메일 바꿈 · 확인 방법: 신청서의 기존 아이디(' + p.username + ' 신청)');
        save(s);
        return delay({ sent: true, fakeMailLink: link2 });
      }
      if (!o.email) throw err('기존 계정에 메일이 없습니다. 연구실이 아는 연락처로 본인임을 확인한 뒤 회원 탭에서 기존 계정의 메일을 바꾸고 링크를 보내 주십시오.');
      // 링크를 먼저 만들고(못 보내면 신청은 그대로) 그다음 신청을 지운다
      var link = makeReset(s, o);
      s.users = s.users.filter(function (x) { return x.id !== pendingId; });
      mail(s, o.email, '기존 아이디를 그대로 사용하십시오', '새로 신청하신 것을 기존 계정(아이디 ' + o.username + ')과 연결했습니다. 아래 링크로 비밀번호를 정해 주십시오.', link);
      log(s, a, '가입 신청을 기존 계정과 연결', 'user:' + o.username, '신청 아이디 ' + p.username);
      save(s);
      return delay({ sent: true, fakeMailLink: link });
    },
    // 관리자 넘기기: 받는 사람은 바로 관리자(인증 앱 등록 전), 나는 그 사람이 2단계 인증으로 들어온 뒤 회원
    handover: async function (targetId) {
      var s = load(); var a = needAdmin(s);
      var t = userBy(s, targetId);
      if (!t || t.id === a.id) throw err('나에게는 넘길 수 없습니다.');
      if (a.leaving_to) throw err('이미 넘기는 중입니다. 먼저 넘기기를 취소해 주십시오.');
      if (t.role !== 'member' || t.status !== 'active') throw err('정상 회원에게만 넘길 수 있습니다.');
      t.role = 'admin'; t.mfa = false;
      a.leaving_to = t.id;
      log(s, a, '관리자 넘기기 시작', 'user:' + t.username);
      save(s);
      return delay(true);
    },
    cancelHandover: async function () {
      var s = load(); var a = needAdmin(s);
      var t = a.leaving_to && userBy(s, a.leaving_to);
      if (!a.leaving_to) throw err('넘기는 중이 아닙니다.');
      if (t && t.role === 'admin') t.role = 'member';
      a.leaving_to = null;
      log(s, a, '관리자 넘기기 취소', t ? 'user:' + t.username : '');
      save(s);
      return delay(true);
    },
    finishHandover: async function () {
      var s = load(); var a = needAdmin(s), n = 0;
      s.users.forEach(function (x) {
        if (x.leaving_to !== a.id) return;
        x.role = 'member'; x.leaving_to = null; n++;
        log(s, a, '관리자 넘기기 끝(넘긴 사람은 회원)', 'user:' + x.username);
      });
      if (n) save(s);
      return delay(n);
    },

    // ---- 사이트 내용(구성원 · 졸업생 · 소식 · 수행연구 · 교과목). 진짜 서버에서는 site-content 도우미가 GitHub 표를 고친다.
    // 가짜는 관리 화면에 실린 표(만들 때 data/*.csv 를 그대로 넣음)에서 시작해 이 브라우저 안에서만 고친다(공개 화면 미리 보기는 안 바뀜)
    siteLoad: async function () {
      var s = load(); needAdmin(s);
      var st = siteState(s);
      save(s);
      return delay({ rules: siteBase().rules, texts: Object.assign({}, st.texts), photos: Object.keys(st.photos) });
    },
    // changes: site-tables.js apply 와 같은 모양. extra: { photos: [{ path, blob }], removePhotos: [path], link: { user_id, person_no }, kind: { user_id, kind } }
    siteSave: async function (changes, extra) {
      var s = load(); var a = needAdmin(s);
      var st = siteState(s), rules = siteBase().rules, T = window.LabSiteTables;
      extra = extra || {};
      var docs = {};
      Object.keys(st.texts).forEach(function (k) { docs[k] = T.parse(st.texts[k]); });
      // 새 카드 번호: 서버 admin_reserve_person_nos 처럼 표 · 회원 연결 · 지난번 준 번호보다 늘 크게(한 번 쓴 번호는 다시 안 씀)
      var numbered = Object.keys(rules.tables).filter(function (k) { return rules.tables[k].columns.some(function (c) { return c.kind === 'number'; }); });
      var floor = s.seq.person || 0;
      numbered.forEach(function (k) { T.rows(docs[k]).forEach(function (row) { floor = Math.max(floor, Number(row['번호']) || 0); }); });
      s.users.forEach(function (u) { floor = Math.max(floor, u.person_no || 0); });
      var pool = [];
      (changes || []).forEach(function (c) { if (c.op === 'add' && numbered.indexOf(c.table) !== -1) pool.push(++floor); });
      if (pool.length) s.seq.person = floor;
      var r = T.apply(rules, docs, changes, { numbers: pool });
      var files = {};
      Object.keys(r.docs).forEach(function (k) {
        var after = T.serialize(r.docs[k]);
        if (after !== st.texts[k]) files[k] = { before: st.texts[k], after: after };
      });
      var photoOps = [], dirs = {};
      Object.keys(rules.tables).forEach(function (k) { if (rules.tables[k].photo_dir) dirs[rules.tables[k].photo_dir] = k; });
      var re = new RegExp(rules.photo_pattern);
      var used = {};
      Object.keys(rules.tables).forEach(function (k) {
        var t = rules.tables[k];
        if (!t.photo_dir) return;
        T.rows(docs[k]).forEach(function (row) { if (row['사진']) used[t.photo_dir + '/' + row['사진']] = true; });
      });
      var adds = extra.photos || [];
      for (var i = 0; i < adds.length; i++) {
        var p = adds[i], dir = p.path.slice(0, p.path.lastIndexOf('/')), file = p.path.slice(p.path.lastIndexOf('/') + 1);
        if (!dirs[dir] || !re.test(file)) throw err('사진 파일 이름이 올바르지 않습니다.');
        if (used[p.path] || st.photos[p.path]) throw err('같은 이름의 사진이 이미 있습니다. 새 이름으로 올립니다.');
        if (!(p.blob instanceof Blob) || p.blob.size > 1048576) throw err('사진이 너무 큽니다(1MB까지).');
        await putBlob('site:' + p.path, p.blob);
        st.photos[p.path] = true;
        photoOps.push({ add: p.path });
      }
      (extra.removePhotos || []).forEach(function (path) {
        var dir = path.slice(0, path.lastIndexOf('/'));
        if (!dirs[dir]) throw err('지울 수 없는 사진입니다.');
        delete st.photos[path];
        photoOps.push({ remove: path });
      });
      if (!Object.keys(files).length && !photoOps.length) return delay({ ok: true, nothing: true });
      Object.keys(files).forEach(function (k) { st.texts[k] = files[k].after; });
      var entry = { id: nextId(s, 'log'), admin_id: a.id, action: '사이트 내용 고침',
        target: Object.keys(files).map(function (k) { return rules.tables[k].label; }).join(' · ') || '사진',
        detail: r.notes.join(' / ') || photoOps.map(function (x) { return (x.add ? '사진 더함 ' + x.add : '사진 지움 ' + x.remove); }).join(' / '),
        created_at: now(), site: { files: files, photos: photoOps }, publish_state: 'published' };
      s.log.push(entry);
      // 이어서 하는 회원 쪽 일(진짜 서버에서는 공개 화면에 올라간 뒤): 구성원 카드 잇기 · 구분 바꾸기
      // 진짜로 뺀 카드는 이어진 회원 연결을 끊는다(옮기기는 번호가 그대로라 끊지 않음)
      r.freed.forEach(function (no) {
        s.users.forEach(function (u) { if (u.person_no === no) { u.person_no = null; log(s, a, '구성원 명단 연결 해제', 'user:' + u.username, '명단에서 뺌'); } });
      });
      var newCard = r.added.filter(function (x) { return x.table === 'people' && x.number; })[0];
      if (extra.link && newCard) {
        var lu = userBy(s, extra.link.user_id), no = Number(newCard.number);
        if (lu && !s.users.some(function (x) { return x.id !== lu.id && x.person_no === no; })) {
          lu.person_no = no; log(s, a, '구성원 명단 연결', 'user:' + lu.username, '번호 ' + no);
        }
      }
      if (extra.kind) {
        var ku = userBy(s, extra.kind.user_id);
        if (ku && KINDS.indexOf(extra.kind.kind) !== -1 && ku.kind !== extra.kind.kind) {
          log(s, a, '구분 바꿈', 'user:' + ku.username, ku.kind + ' → ' + extra.kind.kind); ku.kind = extra.kind.kind;
        }
      }
      save(s);
      return delay({ ok: true, log_id: entry.id, notes: r.notes });
    },
    // 되돌리기: 그 뒤에 같은 표를 고친 적이 없을 때만(고친 적이 있으면 '고치기 전' 내용을 보여 주고 직접 고치게)
    siteUndo: async function (logId) {
      var s = load(); var a = needAdmin(s);
      var st = siteState(s);
      var e = s.log.filter(function (l) { return l.id === logId && l.site; })[0];
      if (!e) throw err('되돌릴 기록이 없습니다.');
      if (e.undone_by) throw err('이미 되돌린 고침입니다.');
      var stale = Object.keys(e.site.files).filter(function (k) { return st.texts[k] !== e.site.files[k].after; });
      if (stale.length) throw errCode('그 뒤에 같은 표를 고친 것이 있어 되돌리지 못했습니다. 아래 \'고치기 전\' 내용을 보고 직접 고쳐 주십시오.', 'stale');
      // 되돌린 뒤의 표도 칸 규칙을 지키는지 먼저 본다(뺀 카드를 되살릴 때 그 사이 같은 번호를 쓴 카드가 있으면 만들기가 멈춤)
      var T = window.LabSiteTables, rules = siteBase().rules, docs = {};
      Object.keys(st.texts).forEach(function (k) { docs[k] = T.parse(e.site.files[k] ? e.site.files[k].before : st.texts[k]); });
      var bad = T.checkDocs(rules, docs);
      if (bad.length) throw errCode('되돌리면 표가 규칙에 어긋납니다(' + rules.tables[bad[0].table].label + ' ' + bad[0].line + '번째 줄: ' + bad[0].msg + '). 아래 \'고치기 전\' 내용을 보고 직접 고쳐 주십시오.', 'stale');
      var files = {};
      Object.keys(e.site.files).forEach(function (k) { files[k] = { before: e.site.files[k].after, after: e.site.files[k].before }; st.texts[k] = e.site.files[k].before; });
      var photos = e.site.photos.map(function (x) {
        if (x.add) { delete st.photos[x.add]; return { remove: x.add }; }
        st.photos[x.remove] = true; return { add: x.remove };
      });
      var u = { id: nextId(s, 'log'), admin_id: a.id, action: '되돌림', target: e.target, detail: e.detail + ' (회원 계정의 구분 · 명단 연결은 그대로)',
        created_at: now(), site: { files: files, photos: photos }, publish_state: 'published', undo_of: e.id };
      e.undone_by = u.id;
      s.log.push(u);
      save(s);
      return delay(true);
    },
    // 기록 한 줄의 고치기 전 · 뒤 표(화면이 바뀐 줄만 골라 보여 준다)
    siteLogDetail: async function (logId) {
      var s = load(); needAdmin(s);
      var e = s.log.filter(function (l) { return l.id === logId && l.site; })[0];
      if (!e) throw err('기록을 찾지 못했습니다.');
      return delay({ files: e.site.files, photos: e.site.photos });
    },
    // 관리 화면에서 올린 사진은 이 브라우저 안에만 있다. 없으면 사이트에 있는 파일 주소
    sitePhotoUrl: async function (path) {
      var s = load();
      if (s.site && s.site.photos[path]) {
        var b = await getBlob('site:' + path);
        if (b) return URL.createObjectURL(b);
      }
      return window.Lab.url('/' + path);
    },


    // 시험 자료를 처음 상태로 되돌린다(가짜에만 있음).
    resetFake: async function () {
      localStorage.removeItem(KEY);
      localStorage.removeItem(SKEY);
      localStorage.removeItem(AUTO);
      localStorage.removeItem(REAL);
      localStorage.removeItem(NOAUTO);
      indexedDB.deleteDatabase('labFake');
      return true;
    },
    fakeAccounts: [
      ['test_admin', 'Admin-test-2026', '관리자'],
      ['test_member', 'Member-test-2026', '회원'],
      ['test_newcomer', 'Newcomer-test-2026', '승인 대기'],
      ['test_oldmember', 'old-site-2015 (예전 홈페이지 비밀번호)', '옮겨 온 회원'],
      ['oldmember2026', 'Oldmember-test-2026', '승인 대기(기존 회원이 새로 신청)']
    ]
  };

  window.LabFakeApi = api;
})();
