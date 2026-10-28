// 회원 칸 화면들. 화면 이름은 HTML 의 data-lab-page 값이다.
(function () {
  'use strict';
  if (window.LAB_BLOCKED || !window.Lab) return;
  var L = window.Lab, h = L.h;

  function field(label, input, hint) {
    return h('label', {}, label, hint ? h('span', { class: 'hint' }, hint) : null, input);
  }
  function busy(btn, on) { btn.disabled = on; }
  function go(path) { location.assign(L.url(path)); }

  function fakeMailNotice(link) {
    if (!link) return null;
    return h('p', { class: 'notice' }, '가짜 메일함(시험에서만 보임): ', h('a', { href: link.replace(L.cfg.base || '', '') }, '비밀번호 새로 정하기 링크 열기'));
  }

  // ---------------------------------------------------------------- 로그인
  async function login(api) {
    var root = L.root();
    var s = await api.session();
    var next = L.safeNext(L.params().get('next'), '/lab/');
    if (s && s.user.role !== 'pending') { location.replace(L.url(next)); return; }
    L.setStatus('');
    var msg = h('div');
    var id = h('input', { type: 'text', name: 'username', autocomplete: 'username', required: true, maxlength: 60 });
    var pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
    var btn = h('button', { type: 'submit', class: 'btn' }, '로그인');
    var form = h('form', { class: 'form', novalidate: true }, field('아이디', id), field('비밀번호', pw), h('div', { class: 'btns' }, btn));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      msg.replaceChildren();
      busy(btn, true);
      try {
        await api.signIn(id.value, pw.value);
        location.replace(L.url(next));
      } catch (err) {
        msg.replaceChildren(L.notice(L.errText(err), 'error'));
        busy(btn, false);
        pw.value = '';
        pw.focus();
      }
    });

    // 비밀번호 처음 정하기 · 잊음
    var rid = h('input', { type: 'text', name: 'login', autocomplete: 'username', required: true, maxlength: 120 });
    var rbtn = h('button', { type: 'submit', class: 'btn btn-ghost' }, '링크 받기');
    var rmsg = h('div');
    var rform = h('form', { class: 'form', novalidate: true },
      h('p', { class: 'muted' }, '옛 홈페이지 회원은 처음 한 번 비밀번호를 새로 정합니다. 아이디(또는 가입 때 적은 메일)를 넣으면 가입 때 등록한 메일로 링크가 갑니다. 링크는 1시간 동안 한 번만 열립니다.'),
      field('아이디 또는 메일', rid), h('div', { class: 'btns' }, rbtn), rmsg);
    rform.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!rid.value.trim()) return;
      busy(rbtn, true);
      try {
        var r = await api.requestReset(rid.value);
        rmsg.replaceChildren(L.notice('등록된 계정이면 메일을 보냈습니다. 메일이 오지 않거나 메일 주소가 바뀌었으면 조교에게 연락해 주세요.', 'ok'), fakeMailNotice(r.fakeMailLink));
      } catch (err) {
        rmsg.replaceChildren(L.notice(L.errText(err), 'error'));
      }
      busy(rbtn, false);
    });

    function draw() {
      L.clear();
      L.append(root, [L.fakeBadge(), msg, form,
        h('p', {}, '아직 회원이 아니면 ', h('a', { href: '/login/join/' }, '가입 신청'), '을 해 주세요. 관리자가 승인하면 회원 칸이 열립니다.'),
        h('h2', {}, '비밀번호 처음 정하기 · 잊음'), rform]);
      if (window.LabFakeApi && L.cfg.backend === 'fake') {
        L.append(root, h('details', {}, h('summary', {}, '시험용 가짜 계정 보기'),
          h('table', { class: 'tbl' }, h('tbody', {}, window.LabFakeApi.fakeAccounts.map(function (a) {
            return h('tr', {}, h('td', {}, a[2]), h('td', {}, a[0]), h('td', {}, a[1]));
          }))),
          h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { window.LabFakeApi.resetFake().then(function () { location.reload(); }); } }, '시험 자료 처음으로')));
      }
    }
    draw();
    id.focus();
  }

  // ---------------------------------------------------------------- 가입 신청
  async function join(api) {
    var root = L.root();
    L.setStatus('');
    var msg = h('div');
    var f = {
      username: h('input', { type: 'text', autocomplete: 'username', required: true, maxlength: 20, pattern: '[a-z0-9_]{4,20}' }),
      display_name: h('input', { type: 'text', autocomplete: 'name', required: true, maxlength: 30 }),
      email: h('input', { type: 'email', autocomplete: 'email', required: true, maxlength: 120 }),
      kind: h('select', {}, ['재학', '졸업', '교수', '기타'].map(function (k) { return h('option', { value: k }, k); })),
      intro: h('input', { type: 'text', maxlength: 100, placeholder: '예: 2026년 석사 입학, 2019년 박사 졸업' }),
      password: h('input', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 200 }),
      password2: h('input', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 200 })
    };
    var btn = h('button', { type: 'submit', class: 'btn' }, '가입 신청');
    var form = h('form', { class: 'form', novalidate: true },
      field('아이디', f.username, '영문 소문자 · 숫자 · 밑줄, 4~20자'),
      field('이름', f.display_name, '회원 칸에서 다른 회원에게 보이는 이름'),
      field('메일', f.email, '비밀번호 링크와 승인 안내가 이 메일로 갑니다. 다른 회원에게는 보이지 않습니다.'),
      field('구분', f.kind),
      field('한 줄 소개', f.intro, '관리자가 누구인지 알아볼 수 있게 적어 주세요(100자까지)'),
      field('비밀번호', f.password, '10자 이상, 영문과 숫자를 함께'),
      field('비밀번호 한 번 더', f.password2),
      h('p', { class: 'muted' }, '적은 정보는 회원 확인과 회원 칸 운영에만 씁니다. ', h('a', { href: '/privacy/' }, '개인정보 처리방침')),
      h('div', { class: 'btns' }, btn));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (f.password.value !== f.password2.value) { msg.replaceChildren(L.notice('비밀번호 두 칸이 다릅니다.', 'error')); return; }
      busy(btn, true);
      try {
        await api.signUp({ username: f.username.value, display_name: f.display_name.value, email: f.email.value.trim(),
          kind: f.kind.value, intro: f.intro.value, password: f.password.value });
        L.clear();
        L.append(root, [L.fakeBadge(), L.notice('가입 신청을 받았습니다. 관리자가 확인하고 승인하면 회원 칸을 쓸 수 있습니다. 승인 전에는 로그인해도 회원 칸이 열리지 않습니다.', 'ok'),
          h('p', {}, h('a', { href: '/', class: 'btn btn-ghost' }, '첫 화면으로'))]);
      } catch (err) {
        msg.replaceChildren(L.notice(L.errText(err), 'error'));
        busy(btn, false);
      }
    });
    L.append(root, [L.fakeBadge(), h('p', {}, '연구실 구성원 · 졸업생이 쓰는 회원 칸입니다. 신청하면 관리자가 확인한 뒤 승인합니다.'), msg, form]);
  }

  // ---------------------------------------------------------------- 비밀번호 새로 정하기(메일 링크로 들어옴)
  async function reset(api) {
    var root = L.root();
    L.setStatus('');
    var q = L.params();
    var token = q.get('token_hash') || '';
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(token) || q.get('type') !== 'recovery') {
      L.append(root, [L.notice('링크가 올바르지 않습니다. 로그인 화면에서 "비밀번호 처음 정하기 · 잊음"을 다시 해 주세요.', 'error'),
        h('p', {}, h('a', { href: '/login/', class: 'btn btn-ghost' }, '로그인 화면'))]);
      return;
    }
    var msg = h('div');
    var p1 = h('input', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 200 });
    var p2 = h('input', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 200 });
    var btn = h('button', { type: 'submit', class: 'btn' }, '새 비밀번호로 정하기');
    var form = h('form', { class: 'form', novalidate: true },
      h('p', {}, '새 비밀번호를 정해 주세요. 이 단추를 눌러야 링크가 쓰입니다(메일 보안 장치가 링크를 미리 열어도 사라지지 않게).'),
      field('새 비밀번호', p1, '10자 이상, 영문과 숫자를 함께. 다른 사이트와 같은 비밀번호는 쓰지 마세요.'),
      field('한 번 더', p2), h('div', { class: 'btns' }, btn));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (p1.value !== p2.value) { msg.replaceChildren(L.notice('두 칸이 다릅니다.', 'error')); return; }
      busy(btn, true);
      try {
        await api.completeReset(token, p1.value);
        history.replaceState(null, '', L.url('/login/reset/'));
        L.clear();
        L.append(root, [L.notice('비밀번호를 정했습니다. 이제 이 비밀번호로 로그인합니다.', 'ok'), h('p', {}, h('a', { href: '/lab/', class: 'btn' }, '회원 칸으로'))]);
      } catch (err) {
        msg.replaceChildren(L.notice(L.errText(err), 'error'));
        busy(btn, false);
      }
    });
    L.append(root, [L.fakeBadge(), msg, form]);
  }

  // ---------------------------------------------------------------- 회원 칸(내 글 · 임시저장)
  // 게시판 글은 게시판마다 따로 화면(머리 메뉴 '게시판 ▾')에서 본다(연구자 10-27: "한 화면에 있는게 아니라"). 여기는 내 것만.
  async function home(api) {
    var s = await L.guard(api, 'member');
    if (!s) return;
    var root = L.root();
    L.append(root, L.topBar(api, s, 'home'));
    var drafts = await api.myDrafts();
    root.appendChild(h('h2', {}, '임시저장 글 ', h('span', { class: 'cnt' }, drafts.length + '개')));
    root.appendChild(drafts.length ? h('ul', { class: 'board-list' }, drafts.map(function (d) {
      return h('li', {}, h('a', { class: 'b-title', href: pathOf(d.board) + '?edit=' + d.id }, d.title),
        h('span', { class: 'b-meta' }, d.board_name + ' · ' + L.fmtDate(d.updated_at) + ' 저장'));
    })) : h('p', { class: 'empty' }, '임시저장한 글이 없습니다. 글쓰기 화면의 \'임시저장\' 단추로 쓰던 글을 나만 보이게 남겨 둘 수 있습니다.'));
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

  function postList(b, items) {
    return h('ul', { class: 'board-list' }, items.map(function (p) {
      return h('li', { class: p.hidden ? 'is-hidden' : null },
        h('a', { class: 'b-title', href: L.boardPath(b) + '?id=' + p.id },
          p.hidden ? '[숨김] ' : '', p.title, p.comment_count ? ' (' + p.comment_count + ')' : '',
          p.image_count ? ' · 그림' : '', p.file_count ? ' · 첨부' : ''),
        h('span', { class: 'b-meta' }, p.author_name + ' · ' + L.fmtDate(p.created_at)));
    }));
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
    if (q.get('write') === '1') await writeForm(api, b, null, s);
    else if (Number(q.get('edit'))) await writeForm(api, b, Number(q.get('edit')), s);
    else if (id) await viewPost(api, b, id);
    else await listBoard(api, b, Math.max(1, Number(q.get('page')) || 1));
    L.setStatus('');
  }

  async function listBoard(api, b, page) {
    var root = L.root();
    var r = await api.listPosts(b.slug, page);
    var drafts = (await api.myDrafts()).filter(function (d) { return d.board === b.slug; });
    root.appendChild(h('div', { class: 'board-head' }, h('p', { class: 'muted' }, '글 ' + r.total + '개'),
      h('a', { class: 'btn', href: L.boardPath(b) + '?write=1' }, '글쓰기')));
    if (drafts.length) root.appendChild(draftBox(b, drafts));
    root.appendChild(r.items.length ? postList(b, r.items) : h('p', { class: 'empty' }, '아직 글이 없습니다. \'글쓰기\'로 첫 글을 올려 주세요.'));
    var pages = Math.ceil(r.total / r.size);
    if (pages > 1) {
      var nav = h('p', { class: 'btns' });
      for (var i = 1; i <= pages; i++) nav.appendChild(h('a', { class: 'btn btn-small' + (i === page ? '' : ' btn-ghost'), href: L.boardPath(b) + '?page=' + i, 'aria-current': i === page ? 'page' : null }, String(i)));
      root.appendChild(nav);
    }
  }

  // 이 게시판에 내가 임시저장해 둔 글(나만 보임)
  function draftBox(b, drafts) {
    return h('div', { class: 'drafts' }, h('p', { class: 'drafts-h' }, '내 임시저장 글 ' + drafts.length + '개 · 나만 보입니다'),
      h('ul', {}, drafts.map(function (d) {
        return h('li', {}, h('a', { href: L.boardPath(b) + '?edit=' + d.id }, d.title), h('span', { class: 'muted' }, ' · ' + L.fmtDate(d.updated_at) + ' 저장'));
      })));
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
      if (!confirm('이 글을 지울까요? 본문 그림과 첨부 파일도 함께 지워집니다.')) return;
      try { await api.deletePost(p.id); go(L.boardPath(b)); } catch (e) { alert(L.errText(e)); }
    } }, '지우기'));
    var files = d.attachments.filter(function (a) { return a.bucket === 'files'; });
    root.appendChild(h('article', { class: 'post-view' },
      h('h2', {}, p.hidden ? '[숨김] ' : '', p.title),
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

  function commentsBox(api, p, comments) {
    var list = h('div', {}, comments.length ? comments.map(function (c) {
      return h('div', { class: 'comment' }, h('span', { class: 'c-meta' }, c.author_name + ' · ' + L.fmtDate(c.created_at),
        c.can_delete ? h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: async function () {
          if (!confirm('댓글을 지울까요?')) return;
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
    return h('section', { class: 'comments' }, h('h3', {}, '댓글 ' + comments.length), list, form);
  }

  // 글쓰기 · 고치기 · 임시저장(연구자 10-27: "등록, 수정, 임시저장"). 본문은 편집기(editor.js)가 맡는다.
  // 새 글과 임시저장 글: '글 올리기' · '임시저장'(나만 보임), 바뀐 것이 있으면 3분마다 저절로도 임시저장. 올린 글: '고친 글 저장'.
  async function writeForm(api, b, editId, s) {
    var root = L.root();
    var d = editId ? await api.getPost(editId) : null;
    var old = d ? d.post : null;
    if (old && (!old.can_edit || old.board !== b.slug)) { root.appendChild(L.notice('내가 쓴 이 게시판 글만 고칠 수 있습니다.', 'error')); return; }
    if (!window.LabEditor) { root.appendChild(L.notice('글쓰기 부품을 불러오지 못했습니다. 새로 고쳐 주세요.', 'error')); return; }
    var postId = old ? old.id : null;
    var draft = !old || old.status === 'draft';
    var existing = d ? d.attachments.slice() : [];      // 이미 올린 그림 · 자료
    var removed = Object.create(null), newFiles = [];    // 뺄 자료(id), 새로 고른 자료
    var dirty = false, saving = false;
    var msg = h('div');

    var title = h('input', { type: 'text', maxlength: 200, required: true, value: old ? old.title : null, placeholder: '제목' });
    title.addEventListener('input', function () { dirty = true; });
    var ed = window.LabEditor.create({ api: api, me: s.user.id, md: old ? old.body_md : '',
      onChange: function () { dirty = true; }, onSave: function () { if (draft) save('draft'); },
      onFiles: b.files ? function (list) { addFiles(list); } : null });

    // 자료 첨부(첨부가 '예'인 게시판만): 이미 올린 것은 '빼기', 새로 고른 것은 저장할 때 올라간다
    var fileIn = b.files ? h('input', { type: 'file', multiple: true, accept: window.LabUpload.accept.file }) : null;
    var fileList = h('ul', { class: 'att-edit' });
    function drawFiles() {
      fileList.replaceChildren();
      existing.filter(function (a) { return a.bucket === 'files'; }).forEach(function (a) {
        var gone = !!removed[a.id];
        fileList.appendChild(h('li', { class: gone ? 'is-gone' : null },
          h('span', {}, a.original_name, ' ', h('span', { class: 'muted' }, gone ? '저장하면 빠짐' : L.fmtSize(a.size_bytes))),
          h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () {
            if (gone) delete removed[a.id]; else removed[a.id] = true;
            dirty = true; drawFiles();
          } }, gone ? '다시 두기' : '빼기')));
      });
      newFiles.forEach(function (f, i) {
        fileList.appendChild(h('li', {}, h('span', {}, f.name, ' ', h('span', { class: 'muted' }, L.fmtSize(f.size) + ' · 저장할 때 올라감')),
          h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { newFiles.splice(i, 1); drawFiles(); } }, '빼기')));
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

    var pubBtn = h('button', { type: 'submit', class: 'btn' }, draft ? '글 올리기' : '고친 글 저장');
    var draftBtn = draft ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { save('draft'); } }, '임시저장') : null;
    var stamp = h('span', { class: 'muted', 'aria-live': 'polite' }, old && draft ? L.fmtDate(old.updated_at) + ' 임시저장' : '');
    var delBtn = old && draft ? h('button', { type: 'button', class: 'btn btn-danger btn-small', onclick: async function () {
      if (!confirm('이 임시저장 글을 지울까요? 넣어 둔 그림 · 파일도 함께 지워집니다.')) return;
      try { await api.deletePost(postId); dirty = false; ed.clean(); go(L.boardPath(b)); } catch (e) { msg.replaceChildren(L.notice(L.errText(e), 'error')); }
    } }, '임시저장 글 지우기') : null;

    async function save(kind, quiet) {
      if (saving) return;
      if (ed.busy()) { if (!quiet) msg.replaceChildren(L.notice('그림을 줄이는 중입니다. 잠시 뒤 다시 눌러 주세요.', 'error')); return; }
      if (!title.value.trim()) {
        if (!quiet) { msg.replaceChildren(L.notice('제목을 적어 주세요.', 'error')); title.focus(); }
        return;
      }
      saving = true; busy(pubBtn, true); if (draftBtn) busy(draftBtn, true);
      try {
        var im = ed.images(), keep = Object.create(null);
        im.paths.forEach(function (p) { keep[p] = true; });
        var files = im.fresh.map(function (x) { return { blob: x.blob, name: x.name, mime: 'image/jpeg', size: x.size, ext: 'jpg', bucket: 'gallery', path: x.path }; })
          .concat(newFiles);
        var remove = existing.filter(function (a) { return (a.bucket === 'gallery' && !keep[a.path]) || removed[a.id]; })
          .map(function (a) { return a.id; });
        var r = await api.savePost({ id: postId, board: b.slug, title: title.value, body_md: ed.markdown(),
          status: kind === 'draft' ? 'draft' : 'published', remove: remove }, files);
        ed.uploaded(im.fresh.map(function (x) { return x.path; }));
        dirty = false; ed.clean();
        if (kind !== 'draft') { go(L.boardPath(b) + '?id=' + r.id); return; }
        // 임시저장: 이 주소(?edit=)로 다시 열면 이어 쓰고, 올라간 첨부를 다시 받아 둔다
        postId = r.id;
        history.replaceState(null, '', L.url(L.boardPath(b) + '?edit=' + r.id));
        existing = (await api.getPost(r.id)).attachments; newFiles = []; removed = Object.create(null); drawFiles();
        stamp.textContent = L.fmtDate(r.updated_at) + (quiet ? ' 저절로 임시저장' : ' 임시저장');
        if (!quiet) msg.replaceChildren(L.notice('임시저장했습니다. 나만 볼 수 있고, \'글 올리기\'를 눌러야 다른 회원에게 보입니다.', 'ok'));
      } catch (err) {
        msg.replaceChildren(L.notice(L.errText(err), 'error'));
      } finally {
        saving = false; busy(pubBtn, false); if (draftBtn) busy(draftBtn, false);
      }
    }

    var form = h('form', { class: 'form form-wide write', novalidate: true },
      field('제목', title),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, '본문'), ed.el),
      fileIn ? field('첨부 파일', fileIn, 'PDF · 한글(HWP · HWPX) · DOCX · XLSX · PPTX, 하나에 20MB까지. 본문 칸에 끌어다 놓아도 여기로 들어옵니다.') : null,
      fileIn ? fileList : null,
      h('div', { class: 'btns' }, pubBtn, draftBtn, h('a', { class: 'btn btn-ghost', href: L.boardPath(b) + (old && !draft ? '?id=' + old.id : '') }, '그만두기'), stamp),
      msg, delBtn ? h('p', {}, delBtn) : null);
    form.addEventListener('submit', function (e) { e.preventDefault(); save('publish'); });

    // 쓰던 글이 남은 채로 화면을 떠나려 하면 브라우저가 한 번 묻는다
    window.addEventListener('beforeunload', function (e) { if (dirty || ed.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
    // 새 글 · 임시저장 글은 바뀐 것이 있으면 3분마다 저절로 임시저장(제목이 있을 때)
    if (draft) setInterval(function () { if (dirty || ed.isDirty()) save('draft', true); }, 180000);

    root.appendChild(h('h2', {}, old ? (draft ? '임시저장 글 이어 쓰기' : '글 고치기') : '글쓰기'));
    if (!old) {
      var mine = (await api.myDrafts()).filter(function (x) { return x.board === b.slug; });
      if (mine.length) root.appendChild(draftBox(b, mine));
    }
    root.appendChild(form);
    await ed.ready;
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

  async function photoList(api, gb) {
    var root = L.root();
    var albums = await api.galleryList();
    root.appendChild(h('div', { class: 'board-head' }, h('p', { class: 'muted' }, '사진 묶음 ' + albums.length + '개'),
      h('a', { class: 'btn', href: L.boardPath(gb) + '?write=1' }, '사진 올리기')));
    if (!albums.length) { root.appendChild(h('p', { class: 'empty' }, '아직 사진이 없습니다.')); return; }
    var grid = h('div', { class: 'gallery' });
    for (var i = 0; i < albums.length; i++) {
      var a = albums[i];
      var pic = a.cover ? await imgFor(api, a.cover, '') : h('span', { class: 'ph ph-none' }, '사진');
      grid.appendChild(h('a', { href: L.boardPath(gb) + '?id=' + a.id }, h('figure', {}, pic, h('figcaption', {}, a.title, h('span', { class: 'muted' }, ' · ' + a.count + '장')))));
    }
    root.appendChild(grid);
  }

  async function photoView(api, gb, id) {
    var root = L.root();
    var d = await api.getPost(id);
    var p = d.post;
    root.appendChild(h('h2', {}, p.hidden ? '[숨김] ' : '', p.title));
    root.appendChild(h('p', { class: 'post-meta' }, p.author_name + ' · ' + L.fmtDate(p.created_at)));
    if (p.body_md && window.LabRender) root.appendChild(h('div', { class: 'prose' }, window.LabRender.markdown(p.body_md)));
    var grid = h('div', { class: 'gallery' });
    for (var i = 0; i < d.attachments.length; i++) {
      var a = d.attachments[i];
      grid.appendChild(h('figure', {}, await imgFor(api, a, a.original_name), h('figcaption', {}, a.original_name)));
    }
    root.appendChild(grid);
    var actions = h('p', { class: 'btns' }, h('a', { class: 'btn btn-ghost btn-small', href: L.boardPath(gb) }, '사진첩 목록'));
    if (p.can_hide) actions.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: async function () { await api.setHidden(p.id, !p.hidden); location.reload(); } }, p.hidden ? '다시 보이기' : '숨기기'));
    if (p.can_delete) actions.appendChild(h('button', { type: 'button', class: 'btn btn-danger btn-small', onclick: async function () {
      if (!confirm('이 사진 묶음을 지울까요?')) return;
      await api.deletePost(p.id); go(L.boardPath(gb));
    } }, '지우기'));
    root.appendChild(actions);
    root.appendChild(commentsBox(api, p, d.comments));
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
      field('제목', title), field('사진', fileIn, 'JPG · PNG · WebP, 한 번에 30장까지. 올리기 전에 이 브라우저에서 줄이고 위치 정보를 지웁니다.'),
      preview, h('div', { class: 'btns' }, btn, h('a', { class: 'btn btn-ghost', href: L.boardPath(gb) }, '그만두기')), msg);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!ready.length) { msg.replaceChildren(L.notice('올릴 사진을 골라 주세요.', 'error')); return; }
      if (ready.length > 30) { msg.replaceChildren(L.notice('한 번에 30장까지 올릴 수 있습니다.', 'error')); return; }
      busy(btn, true);
      try {
        var r = await api.savePost({ board: gb.slug, title: title.value, body_md: '' }, ready);
        go(L.boardPath(gb) + '?id=' + r.id);
      } catch (err) { msg.replaceChildren(L.notice(L.errText(err), 'error')); busy(btn, false); }
    });
    root.appendChild(h('h2', {}, '사진 올리기'));
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
    root.appendChild(h('h2', {}, '내 정보'));
    root.appendChild(h('table', { class: 'tbl' }, h('tbody', {},
      h('tr', {}, h('th', { scope: 'row' }, '아이디'), h('td', {}, p.username)),
      h('tr', {}, h('th', { scope: 'row' }, '메일'), h('td', {}, p.email, ' ', h('span', { class: 'muted' }, '(바꾸려면 조교에게 연락)'))),
      h('tr', {}, h('th', { scope: 'row' }, '구분'), h('td', {}, p.kind)),
      h('tr', {}, h('th', { scope: 'row' }, '가입일'), h('td', {}, L.fmtDate(p.created_at))))));

    var nm = h('input', { type: 'text', maxlength: 30, value: p.display_name });
    var nbtn = h('button', { type: 'submit', class: 'btn btn-small' }, '이름 바꾸기');
    var nmsg = h('div');
    var nform = h('form', { class: 'form' }, field('보이는 이름', nm), h('div', { class: 'btns' }, nbtn), nmsg);
    nform.addEventListener('submit', async function (e) {
      e.preventDefault();
      try { await api.updateDisplayName(nm.value); nmsg.replaceChildren(L.notice('바꿨습니다.', 'ok')); }
      catch (err) { nmsg.replaceChildren(L.notice(L.errText(err), 'error')); }
    });

    // CV 주소(연구자, 10-27): 구성원 화면 내 카드의 'CV' 줄에 작은 클립으로 붙는다. 공개 화면은 사이트를 다시 만들 때 받아 간다
    var cv = h('input', { type: 'url', inputmode: 'url', autocomplete: 'url', maxlength: 300, placeholder: 'https://', value: p.cv_url || '' });
    var cbtn = h('button', { type: 'submit', class: 'btn btn-small' }, 'CV 주소 저장');
    var cmsg = h('div');
    var cform = h('form', { class: 'form form-wide', novalidate: true },
      field('CV 주소', cv, 'https:// 로 시작하는 주소. 구성원 화면의 내 카드 \'CV\' 줄에 작은 클립으로 붙고, 누르면 새 창으로 열립니다. 구성원 화면에 위의 \'보이는 이름\'과 같은 이름으로 올라 있어야 붙습니다. 비우고 저장하면 지워집니다.'),
      h('div', { class: 'btns' }, cbtn), cmsg);
    cform.addEventListener('submit', async function (e) {
      e.preventDefault();
      try {
        await api.updateMyCv(cv.value);
        cmsg.replaceChildren(L.notice(cv.value.trim() ? '저장했습니다. 구성원 화면에는 사이트를 다시 만들 때(하루 한 번) 붙습니다.'
          : '지웠습니다. 구성원 화면에서도 사이트를 다시 만들 때 빠집니다.', 'ok'));
      } catch (err) { cmsg.replaceChildren(L.notice(L.errText(err), 'error')); }
    });

    var cur = h('input', { type: 'password', autocomplete: 'current-password', maxlength: 200 });
    var nw = h('input', { type: 'password', autocomplete: 'new-password', maxlength: 200 });
    var pbtn = h('button', { type: 'submit', class: 'btn btn-small' }, '비밀번호 바꾸기');
    var pmsg = h('div');
    var pform = h('form', { class: 'form' }, field('지금 비밀번호', cur), field('새 비밀번호', nw, '10자 이상, 영문과 숫자를 함께'), h('div', { class: 'btns' }, pbtn), pmsg);
    pform.addEventListener('submit', async function (e) {
      e.preventDefault();
      try { await api.changePassword(cur.value, nw.value); cur.value = nw.value = ''; pmsg.replaceChildren(L.notice('바꿨습니다.', 'ok')); }
      catch (err) { pmsg.replaceChildren(L.notice(L.errText(err), 'error')); }
    });

    var wmsg = h('div');
    var wbtn = h('button', { type: 'button', class: 'btn btn-danger btn-small', disabled: p.withdraw_requested, onclick: async function () {
      if (!confirm('탈퇴를 요청할까요? 관리자가 확인한 뒤 계정과 메일, 올린 사진 · 파일을 지웁니다. 글은 이름을 "탈퇴한 회원"으로 바꿔 남깁니다.')) return;
      await api.requestWithdraw(); wbtn.disabled = true; wmsg.replaceChildren(L.notice('탈퇴 요청을 받았습니다.', 'ok'));
    } }, p.withdraw_requested ? '탈퇴 요청함' : '탈퇴 요청');

    L.append(root, [h('h2', {}, '이름'), nform, h('h2', {}, 'CV 주소'), cform, h('h2', {}, '비밀번호'), pform,
      p.role === 'admin' ? h('p', { class: 'notice' }, '관리자는 인증 앱으로 2단계 인증을 해야 지우기 · 등급 바꾸기를 할 수 있습니다(진짜 서버를 연결한 뒤 켬).') : null,
      h('h2', {}, '탈퇴'), h('p', { class: 'muted' }, '탈퇴하면 계정과 메일 주소, 올린 사진 · 파일을 지웁니다.'), wbtn, wmsg]);
    L.setStatus('');
  }

  // ---------------------------------------------------------------- 관리
  async function admin(api) {
    var s = await L.guard(api, 'admin');
    if (!s) return;
    var root = L.root();
    L.append(root, L.topBar(api, s, 'admin'));
    var people = await api.adminProfiles();
    var pending = people.filter(function (p) { return p.role === 'pending'; });
    var members = people.filter(function (p) { return p.role !== 'pending'; });
    var msg = h('div');

    function act(fn, confirmText) {
      return async function () {
        if (confirmText && !confirm(confirmText)) return;
        try {
          var r = await fn();
          if (r && r.fakeMailLink) { msg.replaceChildren(L.notice('링크를 보냈습니다.', 'ok'), fakeMailNotice(r.fakeMailLink)); return; }
          location.reload();
        } catch (e) { msg.replaceChildren(L.notice(L.errText(e), 'error')); }
      };
    }

    root.appendChild(msg);
    root.appendChild(h('h2', {}, '가입 신청 ', h('span', { class: 'cnt' }, pending.length + '건')));
    root.appendChild(pending.length ? h('table', { class: 'tbl admin-table' },
      h('thead', {}, h('tr', {}, ['신청일', '이름', '아이디', '구분', '한 줄 소개', ''].map(function (t) { return h('th', { scope: 'col' }, t); }))),
      h('tbody', {}, pending.map(function (p) {
        return h('tr', {}, h('td', {}, L.fmtDate(p.created_at)), h('td', {}, p.display_name), h('td', {}, p.username), h('td', {}, p.kind), h('td', {}, p.intro),
          h('td', {}, h('span', { class: 'btns' },
            h('button', { type: 'button', class: 'btn btn-small', onclick: act(function () { return api.approve(p.id); }) }, '승인'),
            h('button', { type: 'button', class: 'btn btn-danger btn-small', onclick: act(function () { return api.reject(p.id); }, p.display_name + ' 님의 신청을 거절할까요?') }, '거절'))));
      }))) : h('p', { class: 'empty' }, '기다리는 신청이 없습니다. 승인하지 않은 신청은 30일 뒤 저절로 지워집니다.'));

    var roleName = { member: '회원', admin: '관리자' };
    var statusName = { active: '정상', needs_password: '비밀번호 정하기 전', locked: '잠금' };
    root.appendChild(h('h2', {}, '회원 ', h('span', { class: 'cnt' }, members.length + '명')));
    root.appendChild(h('table', { class: 'tbl admin-table' },
      h('thead', {}, h('tr', {}, ['이름', '아이디', '구분', '등급', '상태', 'CV', ''].map(function (t) { return h('th', { scope: 'col' }, t); }))),
      h('tbody', {}, members.map(function (p) {
        var isMe = p.id === s.user.id;
        // CV: 본인이 적은 주소(새 창으로 보기) · 맞지 않으면 지우기(기록 남음)
        var cvCell = p.cv_url ? h('span', { class: 'btns' },
          h('a', { class: 'mail', href: '#', target: '_blank', rel: 'noopener noreferrer', onclick: function (e) { e.preventDefault(); window.open(p.cv_url, '_blank', 'noopener'); } }, '보기'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: act(function () { return api.clearCv(p.id); }, p.display_name + ' 님의 CV 주소를 지울까요?') }, '지우기'))
          : h('span', { class: 'muted' }, '없음');
        return h('tr', {}, h('td', {}, p.display_name, p.withdraw_requested ? h('span', { class: 'tag' }, '탈퇴 요청') : null), h('td', {}, p.username), h('td', {}, p.kind),
          h('td', {}, h('span', { class: 'role-pill role-' + p.role }, roleName[p.role] || p.role)),
          h('td', {}, statusName[p.status] || p.status),
          h('td', {}, cvCell),
          h('td', {}, isMe ? h('span', { class: 'muted' }, '나') : h('span', { class: 'btns' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: act(function () { return api.sendReset(p.id); }) }, '비밀번호 링크'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: act(function () { return api.setRole(p.id, p.role === 'admin' ? 'member' : 'admin'); }, p.role === 'admin' ? '관리자에서 회원으로 바꿀까요?' : '관리자로 바꿀까요? 관리자는 두 명까지입니다.') }, p.role === 'admin' ? '회원으로' : '관리자로'),
            h('button', { type: 'button', class: 'btn btn-danger btn-small', onclick: act(function () { return api.setStatus(p.id, p.status === 'locked' ? 'active' : 'locked'); }, p.status === 'locked' ? null : p.display_name + ' 님 계정을 잠글까요?') }, p.status === 'locked' ? '잠금 풀기' : '잠그기'))));
      }))));

    var logs = await api.adminLog();
    root.appendChild(h('h2', {}, '관리 기록'));
    root.appendChild(logs.length ? h('table', { class: 'tbl admin-table' },
      h('thead', {}, h('tr', {}, ['때', '관리자', '한 일', '대상', ''].map(function (t) { return h('th', { scope: 'col' }, t); }))),
      h('tbody', {}, logs.slice(0, 50).map(function (l) {
        return h('tr', {}, h('td', {}, L.fmtDate(l.created_at)), h('td', {}, l.admin_name), h('td', {}, l.action), h('td', {}, l.target), h('td', {}, l.detail));
      }))) : h('p', { class: 'empty' }, '아직 기록이 없습니다.'));
    L.setStatus('');
  }

  L.start({ login: login, join: join, reset: reset, home: home, board: board, photos: photos, forward: forward, me: meInfo, admin: admin });
})();
