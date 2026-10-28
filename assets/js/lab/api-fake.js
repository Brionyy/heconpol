// 시험용 가짜 회원 칸 서버. 이 컴퓨터 브라우저 안(localStorage · IndexedDB)에만 저장하고 바깥으로 아무것도 보내지 않는다.
// 진짜 서버(Supabase)의 표 · 권한 규칙(supabase/migrations)을 같은 이름으로 흉내 낸다.
// 공개용으로 만들 때(build.py, --local 없이)는 이 파일을 빼고, 혹시 섞여도 이 컴퓨터 주소가 아니면 돌지 않는다.
(function () {
  'use strict';
  if (window.LAB_BLOCKED) return;
  var host = location.hostname;
  if (!(host === 'localhost' || host === '127.0.0.1' || host === '[::1]')) return;

  // 가짜 자료가 바뀌면 판 번호를 올린다(옛 판은 지우고 새로 만듦). 2: 게시판 셋, 3: 임시저장 · 본문 그림(2026-10-27)
  var VERSION = 3, KEY = 'labFake.v3', OLD_KEYS = ['labFake.v1', 'labFake.v2'], SKEY = 'labFake.session';
  var DAY = 86400000;
  var LIMITS = { posts: 30, comments: 100, files: 100 };
  var LAB_PATH = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,120}$/;

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

  // ---------------------------------------------------------------- 가짜 자료(실제 사람 아님)
  function seed() {
    var t = Date.now();
    var ago = function (d) { return new Date(t - d * DAY).toISOString(); };
    var users = [
      { id: 'u-admin', username: 'test_admin', password: 'Admin-test-2026', email: 'admin@example.test', display_name: '시험관리자', kind: '재학', intro: '조교', role: 'admin', status: 'active', created_at: ago(400), approved_at: ago(400) },
      { id: 'u-member', username: 'test_member', password: 'Member-test-2026', email: 'member@example.test', display_name: '시험회원', kind: '재학', intro: '박사과정', role: 'member', status: 'active', created_at: ago(300), approved_at: ago(299) },
      { id: 'u-alum', username: 'test_alumni', password: 'Alumni-test-2026', email: 'alumni@example.test', display_name: '시험졸업생', kind: '졸업', intro: '2020 졸업', role: 'member', status: 'active', created_at: ago(900), approved_at: ago(899) },
      { id: 'u-old', username: 'test_oldmember', password: null, email: 'old@example.test', display_name: '옛회원', kind: '졸업', intro: '', role: 'member', status: 'needs_password', created_at: ago(3000), approved_at: ago(3000) },
      { id: 'u-pend1', username: 'test_newcomer', password: 'Newcomer-test-2026', email: 'new@example.test', display_name: '신청자', kind: '재학', intro: '2026 석사 입학', role: 'pending', status: 'active', created_at: ago(1), approved_at: null },
      { id: 'u-pend2', username: 'spam_bot99', password: 'Spam-test-2026', email: 'bot@example.test', display_name: '광고', kind: '기타', intro: '좋은 상품 소개', role: 'pending', status: 'active', created_at: ago(3), approved_at: null }
    ];
    var posts = [
      { id: 1, board: 'free', title: '세미나실 예약 안내', body_md: '다음 주 **화요일** 세미나실은 오후 2시부터 씁니다.\n\n- 장소: 221동\n- 준비물: 노트북', author_id: 'u-admin', created_at: ago(2), updated_at: ago(2), hidden: false },
      { id: 2, board: 'free', title: '[시험] 몰래 넣은 코드가 걸러지는지 보는 글', body_md: '아래 줄들은 모두 **글자로만** 보이거나 사라져야 합니다.\n\n<script>alert("x")</script>\n\n<img src=x onerror="alert(1)">\n\n[눌러도 아무 일 없는 링크](javascript:alert(1))\n\n<a href="data:text/html,<script>alert(1)</script>">data 링크</a>\n\n<svg onload="alert(1)"></svg>\n\n<iframe src="https://example.com"></iframe>\n\n[정상 링크](https://www.snu.ac.kr)', author_id: 'u-member', created_at: ago(1), updated_at: ago(1), hidden: false },
      { id: 3, board: 'newcomer', title: '안녕하세요, 새로 온 시험회원입니다', body_md: '# 큰 제목은 작게 보입니다\n\n잘 부탁드립니다.', author_id: 'u-member', created_at: ago(20), updated_at: ago(20), hidden: false },
      { id: 4, board: 'files', title: '[세미나] 2020 보건정책 세미나 자료', body_md: '옛 세미나 게시판에서 옮긴 글이라고 가정한 시험 글입니다.', author_id: 'u-alum', created_at: ago(1500), updated_at: ago(1500), hidden: false },
      { id: 5, board: 'free', title: '관리자가 숨긴 글', body_md: '관리자와 글쓴이에게만 보입니다.', author_id: 'u-alum', created_at: ago(5), updated_at: ago(5), hidden: true },
      { id: 6, board: 'photos', title: '2026 봄 연구실 나들이(시험 사진)', body_md: '', author_id: 'u-admin', created_at: ago(30), updated_at: ago(30), hidden: false },
      { id: 7, board: 'seminar', title: '10월 연구실 세미나 후기(시험 글)', body_md: '시험용 글입니다.\n\n발표 뒤 나온 질문:\n\n- 자료를 연도별로 나눠 보면 어떨까\n- 다음 세미나는 11월 둘째 주', author_id: 'u-alum', created_at: ago(3), updated_at: ago(3), hidden: false },
      { id: 8, board: 'seminar', status: 'draft', title: '12월 세미나 후기(쓰는 중)', body_md: '시험회원이 **임시저장**해 둔 글입니다. 글쓴이에게만 보입니다.', author_id: 'u-member', created_at: ago(0.2), updated_at: ago(0.1), hidden: false }
    ];
    var comments = [
      { id: 1, post_id: 1, author_id: 'u-member', body: '확인했습니다.\n<b>굵게 아님</b>', created_at: ago(1), hidden: false },
      { id: 2, post_id: 7, author_id: 'u-member', body: '정리 고맙습니다.', created_at: ago(2), hidden: false }
    ];
    return { version: VERSION, users: users, posts: posts, comments: comments, attachments: [], log: [], resets: [],
      withdraw: [], seq: { posts: 8, comments: 2, attachments: 0, log: 0 }, seededPhotos: false };
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
  function needAdmin(s) {
    var u = needMember(s);
    if (u.role !== 'admin') throw err('관리자만 할 수 있습니다.');
    return u;
  }
  function countToday(list, who, field) {
    var since = Date.now() - DAY;
    return list.filter(function (x) { return x[field] === who && Date.parse(x.created_at) > since; }).length;
  }
  function checkPassword(pw) {
    if (typeof pw !== 'string' || pw.length < 10) throw err('비밀번호는 10자 이상으로 정해 주세요.');
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw err('비밀번호에 영문과 숫자를 함께 넣어 주세요.');
  }
  function log(s, admin, action, target, detail) {
    s.log.push({ id: nextId(s, 'log'), admin_id: admin.id, action: action, target: target, detail: detail || '', created_at: now() });
  }
  // 서버 규칙 posts_select 와 같다: 내 글(임시저장 · 숨김 포함)은 늘, 남의 글은 올린 글만(숨긴 글은 관리자만)
  function isDraft(p) { return p.status === 'draft'; }
  function visiblePost(s, u, p) {
    return p && (p.author_id === u.id || (!isDraft(p) && (!p.hidden || u.role === 'admin')));
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
    s.resets.push({ token: token, user_id: user.id, expires: Date.now() + 3600000, used: false });
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
      var u = s.users.filter(function (x) { return x.username === key; })[0];
      await delay();
      if (u && u.status === 'needs_password') throw err('처음 한 번 비밀번호를 새로 정해야 합니다. 아래 "비밀번호 처음 정하기 · 잊음"을 눌러 주세요.');
      if (!u || !u.password || u.password !== password || u.status === 'withdrawn') throw err('아이디 또는 비밀번호가 맞지 않습니다.');
      localStorage.setItem(SKEY, u.id);
      return { user: publicUser(u) };
    },

    signOut: async function () { localStorage.removeItem(SKEY); return delay(true); },

    // 있는 계정인지 알려 주지 않는다. 가짜에서만 '가짜 메일함' 링크를 돌려준다.
    requestReset: async function (login) {
      var s = load();
      var key = String(login || '').trim().toLowerCase();
      var u = s.users.filter(function (x) { return x.username === key || x.email === key; })[0];
      var link = null;
      if (u && u.status !== 'withdrawn' && u.status !== 'locked') { link = makeReset(s, u); save(s); }
      return delay({ sent: true, fakeMailLink: link });
    },

    completeReset: async function (tokenHash, newPassword) {
      checkPassword(newPassword);
      var s = load();
      var r = s.resets.filter(function (x) { return x.token === tokenHash; })[0];
      if (!r || r.used || r.expires < Date.now()) throw err('링크가 지났거나 이미 썼습니다. 비밀번호 찾기를 다시 해 주세요.');
      var u = s.users.filter(function (x) { return x.id === r.user_id; })[0];
      if (!u) throw err('링크가 지났거나 이미 썼습니다. 비밀번호 찾기를 다시 해 주세요.');
      r.used = true;
      u.password = newPassword;
      if (u.status === 'needs_password') u.status = 'active';
      localStorage.setItem(SKEY, u.id);
      save(s);
      return delay({ user: publicUser(u) });
    },

    signUp: async function (f) {
      var s = load();
      var username = String(f.username || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{4,20}$/.test(username)) throw err('아이디는 영문 소문자 · 숫자 · 밑줄로 4~20자입니다.');
      if (!f.display_name || f.display_name.length > 30) throw err('이름을 30자 안으로 적어 주세요.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email || '')) throw err('메일 주소를 확인해 주세요.');
      if ((f.intro || '').length > 100) throw err('한 줄 소개는 100자까지입니다.');
      checkPassword(f.password);
      var taken = s.users.some(function (x) { return x.username === username; });
      var mailTaken = s.users.some(function (x) { return x.email === String(f.email).toLowerCase(); });
      await delay();
      // 있는 아이디 · 메일이어도 같은 말을 돌려준다(남의 가입 여부를 알려 주지 않음). 아이디만은 겹치면 알려 준다.
      if (taken) throw err('이미 쓰는 아이디입니다. 다른 아이디를 골라 주세요.');
      if (!mailTaken) {
        s.users.push({ id: uid(), username: username, password: f.password, email: String(f.email).toLowerCase(), display_name: f.display_name.trim(),
          kind: f.kind || '기타', intro: (f.intro || '').trim(), role: 'pending', status: 'active', created_at: now(), approved_at: null });
        save(s);
      }
      return { ok: true };
    },

    listPosts: async function (board, page) {
      var s = load(); var u = needMember(s);
      // 서버의 글 목록 모아 보기(post_list)처럼 올린 글만. 첨부 수는 자료만, 그림 수는 따로.
      var all = s.posts.filter(function (p) { return p.board === board && !isDraft(p) && visiblePost(s, u, p); })
        .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });
      var size = 20, pg = Math.max(1, page || 1);
      var items = all.slice((pg - 1) * size, pg * size).map(function (p) {
        return { id: p.id, title: p.title, author_name: nameOf(s, p.author_id), created_at: p.created_at, hidden: p.hidden,
          comment_count: s.comments.filter(function (c) { return c.post_id === p.id && !c.hidden; }).length,
          file_count: s.attachments.filter(function (a) { return a.post_id === p.id && a.bucket === 'files'; }).length,
          image_count: s.attachments.filter(function (a) { return a.post_id === p.id && a.bucket === 'gallery'; }).length };
      });
      return delay({ items: items, total: all.length, size: size, page: pg });
    },

    getPost: async function (id) {
      var s = load(); var u = needMember(s);
      if (s.posts.some(function (x) { return x.board === 'photos'; })) await seedPhotos(s);
      var p = s.posts.filter(function (x) { return x.id === Number(id); })[0];
      if (!visiblePost(s, u, p)) throw err('없는 글이거나 볼 수 없는 글입니다.');
      return delay({
        post: { id: p.id, board: p.board, title: p.title, body_md: p.body_md, body_html_legacy: p.body_html_legacy || null,
          author_id: p.author_id, author_name: nameOf(s, p.author_id), created_at: p.created_at, updated_at: p.updated_at, hidden: p.hidden,
          status: isDraft(p) ? 'draft' : 'published',
          can_edit: p.author_id === u.id, can_delete: p.author_id === u.id || u.role === 'admin', can_hide: u.role === 'admin' && !isDraft(p) },
        comments: s.comments.filter(function (c) { return c.post_id === p.id && (!c.hidden || u.role === 'admin'); }).map(function (c) {
          return { id: c.id, body: c.body, author_name: nameOf(s, c.author_id), created_at: c.created_at, can_delete: c.author_id === u.id || u.role === 'admin' };
        }),
        attachments: s.attachments.filter(function (a) { return a.post_id === p.id; }).map(function (a) {
          return { id: a.id, bucket: a.bucket, path: a.path, original_name: a.original_name, mime: a.mime, size_bytes: a.size_bytes };
        })
      });
    },

    // f: { id(고칠 때), board, title, body_md, status: 'draft' | 'published', remove: [뺄 첨부 id] }
    // files: [{ blob, name, mime, size, ext, bucket: 'gallery' | 'files', path(본문 그림은 편집기가 정한 경로) }]
    // 진짜 서버에서는: 파일 칸에 올리기 → 글 줄(posts) 넣기 · 고치기 → 첨부 줄 넣기 → 뺀 첨부는 파일 칸 · 첨부 줄 모두 지우기.
    savePost: async function (f, files) {
      var s = load(); var u = needMember(s);
      var title = String(f.title || '').trim(), body = String(f.body_md || '');
      var status = f.status === 'draft' ? 'draft' : 'published';
      if (!title || title.length > 200) throw err('제목을 200자 안으로 적어 주세요.');
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
      if (p) {
        if (isDraft(p) && status === 'published') p.created_at = now();   // 올리는 순간이 쓴 때(목록 맨 위로)
        p.title = title; p.body_md = body; p.status = status; p.updated_at = now();
      } else {
        p = { id: nextId(s, 'posts'), board: b.slug, status: status, title: title, body_md: body, author_id: u.id, created_at: now(), updated_at: now(), hidden: false };
        s.posts.push(p);
      }
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
      if (!body || body.length > 2000) throw err('댓글은 2,000자 안으로 적어 주세요.');
      var p = s.posts.filter(function (x) { return x.id === Number(postId); })[0];
      if (!visiblePost(s, u, p)) throw err('없는 글입니다.');
      if (isDraft(p)) throw err('임시저장 글에는 댓글을 달 수 없습니다.');
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
      var s = load(); var u = needMember(s);
      var a = s.attachments.filter(function (x) { return x.path === att.path; })[0];
      var post = a && s.posts.filter(function (x) { return x.id === a.post_id; })[0];
      if (!(String(att.path || '').indexOf(u.id + '/') === 0 || (a && visiblePost(s, u, post)))) throw err('볼 수 없는 파일입니다.');
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
      s = load();
      return delay(s.posts.filter(function (p) { return (boardOf(p.board) || {}).gallery && !isDraft(p) && visiblePost(s, u, p); })
        .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); })
        .map(function (p) {
          var first = s.attachments.filter(function (a) { return a.post_id === p.id && a.bucket === 'gallery'; })[0] || null;
          return { id: p.id, title: p.title, created_at: p.created_at, author_name: nameOf(s, p.author_id), cover: first,
            count: s.attachments.filter(function (a) { return a.post_id === p.id; }).length };
        }));
    },

    myProfile: async function () {
      var s = load(); var u = me(s);
      if (!u) throw err('로그인이 필요합니다.');
      return delay({ username: u.username, display_name: u.display_name, email: u.email, kind: u.kind, role: u.role, created_at: u.created_at,
        withdraw_requested: s.withdraw.indexOf(u.id) !== -1, cv_url: u.cv_url || '' });
    },

    updateDisplayName: async function (name) {
      var s = load(); var u = needMember(s);
      name = String(name || '').trim();
      if (!name || name.length > 30) throw err('이름을 30자 안으로 적어 주세요.');
      u.display_name = name;
      save(s);
      return delay(true);
    },

    // CV 주소(서버 profiles.cv_url 과 같은 규칙: https만, 300자까지, 비우면 지움)
    updateMyCv: async function (url) {
      var s = load(); var u = needMember(s);
      url = String(url || '').trim();
      if (url && (url.length > 300 || !/^https:\/\/[^\s<>"'`]+$/.test(url))) throw err('CV 주소는 https:// 로 시작하는 주소로 적어 주세요(빈칸 없이, 300자까지).');
      u.cv_url = url || null;
      save(s);
      return delay(true);
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
          created_at: u.created_at, withdraw_requested: s.withdraw.indexOf(u.id) !== -1, cv_url: u.cv_url || '' };
      }));
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
      if (role === 'admin' && s.users.filter(function (x) { return x.role === 'admin'; }).length >= 2 && u.role !== 'admin') throw err('관리자는 두 명까지입니다.');
      log(s, a, '등급 바꿈', 'user:' + u.username, u.role + ' → ' + role);
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
      var link = makeReset(s, u);
      log(s, a, '비밀번호 링크 보냄', 'user:' + u.username);
      save(s);
      return delay({ sent: true, fakeMailLink: link });
    },
    adminLog: async function () {
      var s = load(); needAdmin(s);
      return delay(s.log.slice().reverse().map(function (l) { return { action: l.action, target: l.target, detail: l.detail, admin_name: nameOf(s, l.admin_id), created_at: l.created_at }; }));
    },

    // 시험 자료를 처음 상태로 되돌린다(가짜에만 있음).
    resetFake: async function () {
      localStorage.removeItem(KEY);
      localStorage.removeItem(SKEY);
      indexedDB.deleteDatabase('labFake');
      return true;
    },
    fakeAccounts: [
      ['test_admin', 'Admin-test-2026', '관리자'],
      ['test_member', 'Member-test-2026', '회원'],
      ['test_newcomer', 'Newcomer-test-2026', '승인 대기'],
      ['test_oldmember', '(없음: 처음 정하기)', '옮겨 온 회원']
    ]
  };

  window.LabFakeApi = api;
})();
