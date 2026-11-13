// 진짜 회원 칸 서버(Supabase) 연결 자리.
// 2026-11-13 채움(프로젝트 heconpol, 서울). data/site.csv '회원 칸 서버' · '공개 열쇠'가 있을 때만 쓰인다(없으면 회원 칸 '준비 중').
//
// 채울 때 지킬 것(2_보안검토.md):
// - 화면에는 공개 열쇠(sb_publishable_...)만 넣는다. 비밀 열쇠(sb_secret_...)는 절대 넣지 않는다.
// - 기능 이름 · 돌려주는 모양은 api-fake.js 와 똑같이 맞춘다(session, signIn, signOut, requestReset, completeReset,
//   signUp, listPosts, getPost, savePost, deletePost, setHidden, addComment, deleteComment, attachmentUrl,
//   galleryList, myProfile, updateDisplayName, changePassword, requestWithdraw, adminProfiles, approve, reject,
//   setRole, setStatus, sendReset, adminLog, myDrafts, myPosts).
// - 관리 화면 · 가입 흐름(2026-10-28, admin.js · app.js)이 더 부르는 것과 맡는 곳:
//   requestReset · signUp → 서버 도우미 login-help(같은 답 · 같은 시간, 메일 한도. signUp 은 old_username(예전 아이디, 선택)과 email_as_id(새 메일로 가입 신청: 아이디 칸 없음, 도우미가 안에서 쓸 아이디를 만듦)도 넘김),
//   signIn 은 '@'가 든 값이면 메일로 바로 로그인한다(새 메일로 가입한 분은 메일이 아이디, 11-02),
//   signIn 이 bad_login 이면 서버 도우미 login-help legacy_login({ login, password })을 한 번 부르고, { retry: true } 면 같은 값으로 한 번 더 로그인한다
//   (옛 회원이 옛 비밀번호 그대로 첫 로그인, 2026-11-13. retry 가 false 면 처음 bad_login 그대로 돌려준다. 가짜 서버 흉내는 api-fake.js 몫),
//   (11-02부터 화면은 submitHelp 를 부르지 않음: 메일이 바뀐 옛 회원은 '새 메일로 가입 신청'. rpc submit_help_request 는 남아 있음),
//   adminSelf(로그인 정보의 aal + my_profile) · registerMfa(supabase.auth.mfa.enroll · verify, QR 화면) · finishHandover → rpc admin_finish_handover,
//   adminHelp · closeHelp · deleteHelp · memberEmail · setKind · linkPerson · withdrawCancel · handover · cancelHandover → 같은 이름의 rpc admin_*,
//   approve → 서버 도우미 admin-account approve(승인 뒤 그 회원에게 로그인 주소가 든 승인 메일, 11-02 밤. rpc admin_approve 를 바로 부르지 않음),
//   setEmail · withdrawDone → 서버 도우미 admin-account, linkOld(pendingId, oldId, byClaim) → admin-account link_old
//   (byClaim 이면 by_claim: true, 신청서 예전 아이디가 같을 때만 옛 계정 메일을 신청 메일로 바꾸고 새 메일로 링크, 11-02),
//   adminProfiles 는 old_username 도 돌려준다(migrations/20261102020000_old_username_claim.sql),
//   siteLoad · siteSave · siteUndo · siteLogDetail → 서버 도우미 site-content(load · save · undo · detail, 기록 탭이 열릴 때 status),
//   sitePhotoUrl → 사이트 주소(/assets/img/...). siteSave 의 사진은 base64 로, base 에 불러올 때 받은 표 판 표시를 함께 보낸다.
//   completeReset 은 { username } 도 돌려준다(아이디를 잊은 분께 한 번 더 보여 줌).
// - 내 정보 구성원 카드(2026-11-02, migrations/20261102000000_profile_requests.sql): updateMyCv(url, show) → profiles.cv_url · cv_public 고치기,
//   myCard → 화면에 실린 cards(번호 = my_profile 의 person_no), myProfileRequests → rpc my_profile_requests,
//   requestProfileChange('photo', JPEG) → Storage profile-photos 에 '내 id/무작위.jpg'로 올린 뒤 rpc request_profile_change('photo', null, 경로),
//   requestProfileChange('interest', 키워드를 ' · '로 이은 글) → rpc request_profile_change('interest', 글, null), cancelProfileRequest → rpc cancel_profile_request 뒤 사진 파일 지우기,
//   requestPhotoUrl(id) → profile-photos createSignedUrl(경로, 600), adminProfileRequests → rpc admin_list_profile_requests,
//   requestPhotoBlob(id) → profile-photos download, decideProfileRequest → rpc admin_decide_profile_request 뒤 사진 파일 지우기(관리자 2단계 인증).
//   가짜와 같게 has_photo(사진 요청인가)를 돌려준다.
// - savePost(2026-10-27): f.status('draft' | 'published') · f.remove(뺄 첨부 id)를 받는다. 본문 그림은 편집기가 정한 경로(files[].path,
//   '내 id/무작위.jpg')로 사진 칸에 올리고 첨부 줄을 넣는다. 뺀 첨부는 파일 칸에서 먼저 지우고 첨부 줄을 지운다.
//   올린 글 목록은 post_list(올린 글만), 내 임시저장 글은 posts 에서 status = 'draft'(규칙상 내 것만 보임).
// - 올리기 설정(2026-11-02, migrations/20261102010000_post_settings.sql): savePost 의 f.tags · f.visibility · f.allow_comments · f.pinned 는
//   posts 줄 넣기 · 고치기에 함께 보내고(고정은 관리자만, 서버 트리거가 거름), f.cover_path 는 첨부 줄을 다 넣은 뒤 posts 를 한 번 더 고쳐 넣는다
//   (서버가 '이 글의 사진 칸 첨부'인지 보므로). listPosts(board, page, tag) 는 post_list 를 order('pinned', desc) · order('created_at', desc),
//   tag 가 있으면 .contains('tags', [tag]) 로 부르고 tags · cover_path · visibility · allow_comments · pinned 를 그대로 돌려준다.
//   listPosts 의 넷째 인자 q(2026-11-02 목록 찾기 칸)는 제목 · 글쓴이(author_name)에 든 말로 거른다: .or('title.ilike.*말*,author_name.ilike.*말*').
//   말 안의 , ( ) * % _ \ 는 빼거나 막고(가짜와 같게 40자까지), 결과에 q 를 함께 돌려준다.
//   getPost 도 다섯 칸과 can_comment(올린 글이고 allow_comments 이거나 관리자)를 돌려준다. 오류 글은 가짜와 같게.
// - galleryList(2026-11-13 행사 기록 연대표): 행사 글마다 { id, title, created_at, author_name, cover, count }. cover 는 cover_path 가
//   아직 그 글의 사진 칸 첨부이면 그 첨부, 아니면 첫 사진(없으면 null). count 는 사진 칸 첨부 수. 최근 글이 먼저.
// - 아이디 로그인은 작은 서버 함수(Edge Function)가 아이디 → 메일을 안에서 찾아 처리한다. 화면에서 메일을 찾지 않는다.
// - 비밀번호 링크는 /login/reset/?token_hash=...&type=recovery 로 받고, 단추를 눌러야 verifyOtp 를 부른다.
// - 파일 주소: 사진 createSignedUrl(path, 600), 자료 createSignedUrl(path, 60, { download: 원래이름 }).
// - 2026-11-13 채움. 아이디(메일이 아닌 값) 로그인은 login-help 'login'(아이디 → 메일을 서버 안에서 찾고, 옛 비밀번호면 옛 값 확인까지)이
//   맞을 때만 로그인 열쇠를 돌려주고, 틀리면 늘 같은 답(누가 회원인지 드러나지 않음). 화면은 받은 열쇠로 setSession 한다.
// - 2단계 인증(관리자): registerMfa() 는 진짜 서버에서 인증 앱 등록을 시작해 { factor_id, qr, secret } 을 돌려주고,
//   verifyMfa(factor_id, 6자리) 가 확인한다. adminSelf 는 이미 등록한 인증 앱이 있으면 factor_id 를 함께 돌려준다(그때는 6자리만 넣음).
// - 비밀번호 링크: 무료판 기본 메일 틀은 링크를 /login/reset/#access_token=...&type=recovery 로 보낸다. completeReset 은
//   token_hash(메일 틀을 바꾼 뒤) 와 { access_token, refresh_token }(기본 틀) 둘 다 받는다.
(function () {
  'use strict';
  if (window.LAB_BLOCKED) return;
  var cfg = window.LAB_CONFIG || {};
  if (cfg.backend !== 'supabase' || !cfg.supabaseUrl || !cfg.publishableKey || !window.supabase || !window.supabase.createClient) {
    window.LabSupabaseApi = null;
    return;
  }
  var URL0 = String(cfg.supabaseUrl).replace(/\/+$/, '');
  var sb = window.supabase.createClient(URL0, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'heconpol-auth' }
  });

  var LAB_PATH = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,120}$/;
  var EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
  var KINDS = ['재학', '졸업', '교수', '기타'];
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var BAD_LOGIN = '아이디 또는 비밀번호가 맞지 않습니다.';
  var BAD_LINK = '링크가 지났거나 이미 썼습니다. 비밀번호 찾기를 다시 해 주십시오.';

  function L() { return window.Lab; }
  function err(msg) { return L().userError(msg); }
  function errCode(msg, code) { var e = err(msg); e.code = code; return e; }
  // 서버 오류를 사람이 읽을 말로. 회원 칸 서버 함수 · 트리거가 낸 한국어 글은 그대로, 영어 원문은 기록에만 남기고 일반 글로
  function fromServer(e, fallback) {
    if (!e) return err(fallback || '처리하지 못했습니다. 잠시 뒤 다시 해 주십시오.');
    if (e.userMessage) return e;
    var m = String(e.message || e.error || '');
    if (/[가-힣]/.test(m)) return errCode(m, e.code);
    if (window.console) console.warn(e);
    if (e.code === '42501' || /row-level security|permission denied/i.test(m)) return err(fallback || '권한이 없습니다.');
    return err(fallback || '처리하지 못했습니다. 잠시 뒤 다시 해 주십시오.');
  }
  async function run(p, fallback) {
    var r = await p;
    if (r.error) throw fromServer(r.error, fallback);
    return r.data;
  }
  function rpc(name, args, fallback) { return run(sb.rpc(name, args || {}), fallback); }

  // 서버 도우미(Edge Function) 부르기. 로그인했으면 그 사람 열쇠로(관리자 확인), 아니면 공개 열쇠로
  async function fn(name, body) {
    var s = (await sb.auth.getSession()).data.session;
    var res;
    try {
      res = await fetch(URL0 + '/functions/v1/' + name, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: cfg.publishableKey, authorization: 'Bearer ' + (s ? s.access_token : cfg.publishableKey) },
        body: JSON.stringify(body || {})
      });
    } catch (e) { throw err('서버에 닿지 못했습니다. 인터넷 연결을 확인한 뒤 다시 해 주십시오.'); }
    var j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    if (!res.ok) {
      var m = j && j.error ? String(j.error) : '';
      throw errCode(/[가-힣]/.test(m) ? m : '처리하지 못했습니다. 잠시 뒤 다시 해 주십시오.', j && j.code);
    }
    return j || {};
  }

  // ---------------------------------------------------------------- 지금 로그인한 사람(한 화면에서 한 번만 묻는다)
  var meP = null;
  function forget() { meP = null; }
  function loadMe() {
    if (meP) return meP;
    meP = (async function () {
      var s = (await sb.auth.getSession()).data.session;
      if (!s) return null;
      var r = await sb.rpc('my_profile');
      if (r.error || !r.data || !r.data[0]) return null;
      var p = r.data[0];
      return { id: s.user.id, email: p.email || '', profile: p };
    })();
    meP.catch(function () { meP = null; });
    return meP;
  }
  function publicUser(m) {
    var p = m.profile;
    return { id: m.id, username: p.username, display_name: p.display_name, role: p.role, status: p.status, kind: p.kind };
  }
  async function needMember() {
    var m = await loadMe();
    if (!m || !(m.profile.role === 'member' || m.profile.role === 'admin') || m.profile.status !== 'active') throw err('회원만 할 수 있습니다.');
    return m;
  }
  async function needAdminRole() {
    var m = await needMember();
    if (m.profile.role !== 'admin') throw err('관리자만 할 수 있습니다.');
    return m;
  }

  function checkPassword(pw) {
    if (typeof pw !== 'string' || pw.length < 8) throw err('비밀번호는 8자 이상으로 정해 주십시오.');
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw err('비밀번호에 영문과 숫자를 함께 넣어 주십시오.');
  }
  function boards() { return L().pageData().boards || []; }
  function boardOf(slug) { return boards().filter(function (b) { return b.slug === slug; })[0] || null; }
  function boardName(slug) { var b = boardOf(slug); return b ? b.name : slug; }
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
  function settingsOf(p) {
    return { tags: (p.tags || []).slice(), cover_path: p.cover_path || null, visibility: p.visibility === 'admins' ? 'admins' : 'members',
      allow_comments: p.allow_comments !== false, pinned: !!p.pinned };
  }
  function randomName(ext) {
    var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return id + '.' + String(ext || 'bin').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  }
  // 이름 찾기: 회원은 서로의 이름만 본다(칸 권한)
  async function namesOf(ids) {
    var list = ids.filter(function (x, i) { return x && ids.indexOf(x) === i; });
    if (!list.length) return {};
    var rows = await run(sb.from('profiles').select('id,display_name').in('id', list));
    var out = {};
    (rows || []).forEach(function (r) { out[r.id] = r.display_name; });
    return out;
  }
  async function removeFiles(bucket, paths) {
    if (!paths.length) return;
    var r = await sb.storage.from(bucket).remove(paths);
    if (r.error && window.console) console.warn(r.error);
  }
  function asList(rows) { return Array.isArray(rows) ? rows : (rows ? [rows] : []); }

  // 사진 요청 경로는 화면에 내보내지 않고 여기에만 둔다(has_photo 만 화면에)
  var photoPaths = {};
  function rememberPhotos(rows) { asList(rows).forEach(function (r) { if (r.photo_path) photoPaths[r.id] = r.photo_path; else delete photoPaths[r.id]; }); }
  async function photoPathOf(id, admin) {
    if (photoPaths[id]) return photoPaths[id];
    rememberPhotos(await rpc('my_profile_requests'));
    if (!photoPaths[id] && admin) rememberPhotos(await rpc('admin_list_profile_requests'));
    return photoPaths[id] || null;
  }

  // 사이트 내용 도우미가 불러올 때 준 표 판 표시(저장할 때 함께 보냄)
  var siteBaseMark = null;
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  var api = {
    name: 'supabase',

    session: async function () {
      var m = await loadMe();
      return m ? { user: publicUser(m) } : null;
    },

    // '@'가 든 값은 메일로 바로 로그인하고, 틀리면 옛 비밀번호 확인(login-help legacy_login)을 한 번 거친다.
    // 아이디는 login-help login 이 서버 안에서 메일을 찾아 처리하고 맞을 때만 열쇠를 준다.
    signIn: async function (login, password) {
      var key = String(login || '').trim().toLowerCase(), pw = String(password || '');
      if (!key || !pw) throw errCode(BAD_LOGIN, 'bad_login');
      forget();
      if (key.indexOf('@') !== -1) {
        var r = await sb.auth.signInWithPassword({ email: key, password: pw });
        if (r.error) {
          if (r.error.status === 429) throw err('잠시 동안 로그인 시도가 많았습니다. 몇 분 뒤 다시 해 주십시오.');
          var lr = await fn('login-help', { action: 'legacy_login', login: key, password: pw });
          if (!lr.retry) throw errCode(BAD_LOGIN, 'bad_login');
          r = await sb.auth.signInWithPassword({ email: key, password: pw });
          if (r.error) throw errCode(BAD_LOGIN, 'bad_login');
        }
      } else {
        var res = await fn('login-help', { action: 'login', login: key, password: pw });
        if (!res.session || !res.session.access_token) throw errCode(BAD_LOGIN, 'bad_login');
        var set = await sb.auth.setSession({ access_token: res.session.access_token, refresh_token: res.session.refresh_token });
        if (set.error) throw fromServer(set.error);
      }
      forget();
      var m = await loadMe();
      if (!m) { await sb.auth.signOut(); forget(); throw errCode(BAD_LOGIN, 'bad_login'); }
      return { user: publicUser(m) };
    },

    signOut: async function () { await sb.auth.signOut(); forget(); return true; },

    requestReset: async function (login) {
      var key = String(login || '').trim();
      if (!key) throw err('아이디나 메일을 적어 주십시오.');
      await fn('login-help', { action: 'reset', login: key });
      return { sent: true, fakeMailLink: null };
    },

    // token: 메일 틀의 token_hash(글) 또는 기본 메일 틀이 주소 뒤(#)에 붙인 { access_token, refresh_token }
    completeReset: async function (token, newPassword) {
      checkPassword(newPassword);
      forget();
      var r;
      if (token && typeof token === 'object') r = await sb.auth.setSession({ access_token: token.access_token, refresh_token: token.refresh_token });
      else r = await sb.auth.verifyOtp({ token_hash: String(token || ''), type: 'recovery' });
      if (r.error) throw err(BAD_LINK);
      var u = await sb.auth.updateUser({ password: newPassword });
      if (u.error) {
        if (/password/i.test(u.error.message || '') && u.error.status === 422) throw err('비밀번호는 8자 이상, 영문과 숫자를 함께 넣어 주십시오. 지금 비밀번호와 같으면 바뀌지 않습니다.');
        throw fromServer(u.error);
      }
      forget();
      var m = await loadMe();
      if (!m) throw err(BAD_LINK);
      return { user: publicUser(m), username: m.profile.username };
    },

    signUp: async function (f) {
      f = f || {};
      if (!f.display_name || String(f.display_name).length > 30) throw err('이름을 30자 안으로 적어 주십시오.');
      if (!EMAIL_RE.test(String(f.email || '').trim())) throw err('메일 주소를 확인해 주십시오.');
      if (String(f.intro || '').length > 100) throw err('한 줄 소개는 100자까지입니다.');
      checkPassword(f.password);
      var body = { action: 'signup' };
      ['username', 'password', 'email', 'display_name', 'kind', 'intro', 'course', 'entry_year', 'show_email', 'old_username', 'email_as_id']
        .forEach(function (k) { if (k in f) body[k] = f[k]; });
      await fn('login-help', body);
      return { ok: true };
    },

    // 11-02부터 화면은 부르지 않음(남겨 둔 서버 함수)
    submitHelp: async function (f) {
      await rpc('submit_help_request', { p_name: String(f.name || '').trim(), p_email: String(f.email || '').trim().toLowerCase(),
        p_kind: KINDS.indexOf(f.kind) !== -1 ? f.kind : '기타', p_course: String(f.course || '').trim().slice(0, 20),
        p_year: String(f.year || '').trim(), p_message: String(f.message || '').trim() });
      return { ok: true };
    },

    listPosts: async function (board, page, tag, q) {
      await needMember();
      var size = 20, pg = Math.max(1, Number(page) || 1);
      var qq = String(q || '').replace(/[,()*%_\\"]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40).trim();
      var query = sb.from('post_list').select('id,title,author_name,created_at,hidden,comment_count,file_count,image_count,tags,cover_path,visibility,allow_comments,pinned', { count: 'exact' })
        .eq('board', board);
      if (tag) query = query.contains('tags', [tag]);
      if (qq) query = query.or('title.ilike."*' + qq + '*",author_name.ilike."*' + qq + '*"');
      var r = await query.order('pinned', { ascending: false }).order('created_at', { ascending: false }).range((pg - 1) * size, pg * size - 1);
      if (r.error) throw fromServer(r.error);
      var items = (r.data || []).map(function (p) {
        var st = settingsOf(p);
        return { id: p.id, title: p.title, author_name: p.author_name, created_at: p.created_at, hidden: p.hidden,
          comment_count: Number(p.comment_count) || 0, file_count: Number(p.file_count) || 0, image_count: Number(p.image_count) || 0,
          tags: st.tags, cover_path: p.cover_path || null, visibility: st.visibility, allow_comments: st.allow_comments, pinned: st.pinned };
      });
      return { items: items, total: r.count || 0, size: size, page: pg, tag: tag || null, q: qq || null };
    },

    getPost: async function (id) {
      var m = await needMember();
      var admin = m.profile.role === 'admin';
      var p = await run(sb.from('posts').select('id,board,title,body_md,body_html_legacy,author_id,hidden,legacy_id,created_at,updated_at,status,tags,cover_path,visibility,allow_comments,pinned')
        .eq('id', Number(id)).maybeSingle());
      if (!p) throw err('없는 글이거나 볼 수 없는 글입니다.');
      var cs = await run(sb.from('comments').select('id,body,author_id,created_at,hidden').eq('post_id', p.id).order('created_at', { ascending: true }));
      var as = await run(sb.from('attachments').select('id,bucket,path,original_name,mime,size_bytes').eq('post_id', p.id).order('id', { ascending: true }));
      var names = await namesOf([p.author_id].concat((cs || []).map(function (c) { return c.author_id; })));
      var nameOf = function (uid) { return (uid && names[uid]) || '탈퇴한 회원'; };
      var st = settingsOf(p), draft = p.status === 'draft', mine = p.author_id === m.id;
      return {
        post: { id: p.id, board: p.board, title: p.title, body_md: p.body_md, body_html_legacy: p.body_html_legacy || null,
          author_id: p.author_id, author_name: nameOf(p.author_id), created_at: p.created_at, updated_at: p.updated_at, hidden: p.hidden,
          status: draft ? 'draft' : 'published',
          tags: st.tags, cover_path: st.cover_path, visibility: st.visibility, allow_comments: st.allow_comments, pinned: st.pinned,
          can_comment: !draft && (st.allow_comments || admin),
          // 옮겨 온 글(옛 HTML 본문)은 편집기로 고치면 본문이 사라지므로 고치기는 막고 지우기만
          can_edit: mine && !p.body_html_legacy, can_delete: mine || admin, can_hide: admin && !draft },
        comments: (cs || []).map(function (c) {
          return { id: c.id, body: c.body, author_name: nameOf(c.author_id), created_at: c.created_at, can_delete: c.author_id === m.id || admin };
        }),
        attachments: (as || []).map(function (a) {
          return { id: a.id, bucket: a.bucket, path: a.path, original_name: a.original_name, mime: a.mime, size_bytes: a.size_bytes };
        })
      };
    },

    // 순서: 파일 칸에 올리기 → 글 줄 넣기 · 고치기 → 뺀 첨부(파일 칸 → 첨부 줄) 지우기 → 첨부 줄 넣기 → 대표 사진
    savePost: async function (f, files) {
      var m = await needMember();
      var title = String(f.title || '').trim(), body = String(f.body_md || '');
      var status = f.status === 'draft' ? 'draft' : 'published';
      if (!title || title.length > 200) throw err('제목을 200자 안으로 적어 주십시오.');
      if (body.length > 20000) throw err('본문은 20,000자까지입니다.');
      files = files || [];
      var p = null;
      if (f.id) {
        p = await run(sb.from('posts').select('id,board,status,author_id,cover_path').eq('id', Number(f.id)).maybeSingle());
        if (!p || p.author_id !== m.id) throw err('내가 쓴 글만 고칠 수 있습니다.');
        if (p.status === 'published' && status === 'draft') throw err('올린 글은 임시저장으로 되돌릴 수 없습니다.');
      }
      var b = boardOf(p ? p.board : f.board);
      if (!b) throw err('없는 게시판입니다.');
      if (files.some(function (x) { return !(x.bucket === 'gallery' || (x.bucket === 'files' && b.files && !b.gallery)); })) throw err('이 게시판에는 그 파일을 붙일 수 없습니다.');
      if (files.some(function (x) { return x.bucket === 'gallery' && x.mime !== 'image/jpeg'; })) throw err('그림은 JPEG 로 다시 저장해서 올립니다.');
      if (files.some(function (x) { return x.path && !(LAB_PATH.test(x.path) && x.path.indexOf(m.id + '/') === 0); })) throw err('파일 경로가 올바르지 않습니다.');
      var remove = (f.remove || []).map(Number).filter(function (x) { return x > 0; });
      var row = { title: title, body_md: body, status: status };
      if ('tags' in f) row.tags = cleanTags(f.tags);
      if ('visibility' in f) {
        if (f.visibility !== 'members' && f.visibility !== 'admins') throw err('공개 범위는 회원 전체 · 관리자만 가운데 고릅니다.');
        row.visibility = f.visibility;
      }
      if ('allow_comments' in f) row.allow_comments = f.allow_comments !== false;
      if ('pinned' in f) row.pinned = !!f.pinned;

      // 1) 파일 칸에 올리기
      var up = [];
      try {
        for (var i = 0; i < files.length; i++) {
          var x = files[i];
          var path = x.path || (m.id + '/' + randomName(x.ext));
          if (!(x.blob instanceof Blob) || !x.blob.size) throw err('파일을 읽지 못했습니다. 파일을 다시 골라 주십시오.');
          var ur = await sb.storage.from(x.bucket).upload(path, x.blob, { contentType: x.mime, upsert: false });
          if (ur.error) throw fromServer(ur.error, '파일을 올리지 못했습니다(하루 30개 · 크기 한도를 확인해 주십시오).');
          up.push({ bucket: x.bucket, path: path, name: String(x.name || '파일').slice(0, 100), mime: x.mime, size: x.blob.size });
        }
        // 2) 글 줄
        var saved;
        if (p) saved = await run(sb.from('posts').update(row).eq('id', p.id).select('id,status,updated_at').single());
        else { row.board = b.slug; saved = await run(sb.from('posts').insert(row).select('id,status,updated_at').single()); }
        // 3) 뺀 첨부
        if (remove.length) {
          var gone = await run(sb.from('attachments').select('id,bucket,path,owner_id').eq('post_id', saved.id).in('id', remove));
          if ((gone || []).length !== remove.length || gone.some(function (a) { return a.owner_id !== m.id; })) throw err('뺄 수 없는 첨부입니다.');
          for (var g = 0; g < gone.length; g++) await removeFiles(gone[g].bucket, [gone[g].path]);
          await run(sb.from('attachments').delete().in('id', remove));
        }
        // 4) 첨부 줄
        if (up.length) {
          await run(sb.from('attachments').insert(up.map(function (u) {
            return { post_id: saved.id, bucket: u.bucket, path: u.path, original_name: u.name, mime: u.mime, size_bytes: u.size };
          })));
          up = [];
        }
        // 5) 대표 사진(서버가 '이 글의 사진 칸 첨부'인지 본다)
        if ('cover_path' in f && (f.cover_path || null) !== (p ? p.cover_path || null : null)) {
          saved = await run(sb.from('posts').update({ cover_path: f.cover_path || null }).eq('id', saved.id).select('id,status,updated_at').single());
        }
        return { id: saved.id, status: saved.status, updated_at: saved.updated_at };
      } catch (e) {
        // 첨부 줄이 없는 채로 올라간 파일은 지운다
        var byBucket = {};
        up.forEach(function (u) { (byBucket[u.bucket] = byBucket[u.bucket] || []).push(u.path); });
        for (var k in byBucket) { try { await removeFiles(k, byBucket[k]); } catch (e2) { /* 그대로 */ } }
        throw fromServer(e);
      }
    },

    deletePost: async function (id) {
      await needMember();
      var p = await run(sb.from('posts').select('id').eq('id', Number(id)).maybeSingle());
      if (!p) throw err('지울 수 없는 글입니다.');
      var atts = await run(sb.from('attachments').select('bucket,path').eq('post_id', p.id));
      var byBucket = {};
      (atts || []).forEach(function (a) { (byBucket[a.bucket] = byBucket[a.bucket] || []).push(a.path); });
      // 파일 칸을 먼저 지운다(첨부 줄이 없어지면 관리자는 남의 파일을 더 못 찾음)
      for (var k in byBucket) await removeFiles(k, byBucket[k]);
      var done = await run(sb.from('posts').delete().eq('id', p.id).select('id'));
      if (!done || !done.length) throw err('지울 수 없는 글입니다.');
      return true;
    },

    setHidden: async function (id, hidden) { await rpc('admin_set_hidden', { post: Number(id), hide: !!hidden }); return true; },

    addComment: async function (postId, body) {
      await needMember();
      body = String(body || '').trim();
      if (!body || body.length > 2000) throw err('댓글은 2,000자 안으로 적어 주십시오.');
      await run(sb.from('comments').insert({ post_id: Number(postId), body: body }), '댓글을 달 수 없는 글입니다.');
      return true;
    },

    deleteComment: async function (id) {
      await needMember();
      var done = await run(sb.from('comments').delete().eq('id', Number(id)).select('id'));
      if (!done || !done.length) throw err('지울 수 없는 댓글입니다.');
      return true;
    },

    // 몇 분만 유효한 주소: 사진 600초, 자료 60초(내려받기 이름은 원래 이름)
    attachmentUrl: async function (att, opts) {
      var bucket = att && att.bucket === 'files' ? 'files' : 'gallery';
      var path = String(att && att.path || '');
      if (!LAB_PATH.test(path)) throw err('볼 수 없는 파일입니다.');
      var r = bucket === 'files'
        ? await sb.storage.from('files').createSignedUrl(path, 60, { download: (opts && opts.download) || att.original_name || true })
        : await sb.storage.from('gallery').createSignedUrl(path, 600);
      if (r.error || !r.data) throw err('볼 수 없는 파일입니다.');
      return r.data.signedUrl;
    },

    myDrafts: async function () {
      var m = await needMember();
      var rows = await run(sb.from('posts').select('id,board,title,updated_at').eq('author_id', m.id).eq('status', 'draft').order('updated_at', { ascending: false }));
      return (rows || []).map(function (p) { return { id: p.id, board: p.board, board_name: boardName(p.board), title: p.title, updated_at: p.updated_at }; });
    },

    myPosts: async function (n) {
      var m = await needMember();
      var rows = await run(sb.from('post_list').select('id,board,title,created_at,hidden,comment_count').eq('author_id', m.id)
        .order('created_at', { ascending: false }).limit(n || 10));
      return (rows || []).map(function (p) {
        return { id: p.id, board: p.board, board_name: boardName(p.board), title: p.title, created_at: p.created_at, hidden: p.hidden, comment_count: Number(p.comment_count) || 0 };
      });
    },

    galleryList: async function () {
      await needMember();
      var slugs = boards().filter(function (b) { return b.gallery; }).map(function (b) { return b.slug; });
      if (!slugs.length) return [];
      var posts = await run(sb.from('post_list').select('id,title,created_at,author_name,cover_path').in('board', slugs)
        .order('created_at', { ascending: false }).limit(1000));
      posts = posts || [];
      var pics = [];
      for (var i = 0; i < posts.length; i += 200) {
        var ids = posts.slice(i, i + 200).map(function (p) { return p.id; });
        pics = pics.concat(await run(sb.from('attachments').select('id,post_id,owner_id,bucket,path,original_name,mime,size_bytes,created_at')
          .in('post_id', ids).eq('bucket', 'gallery').order('id', { ascending: true })) || []);
      }
      return posts.map(function (p) {
        var mine = pics.filter(function (a) { return a.post_id === p.id; });
        var cover = (p.cover_path && mine.filter(function (a) { return a.path === p.cover_path; })[0]) || mine[0] || null;
        return { id: p.id, title: p.title, created_at: p.created_at, author_name: p.author_name, cover: cover, count: mine.length };
      });
    },

    myProfile: async function () {
      var p = (await rpc('my_profile'))[0];
      if (!p) throw err('로그인이 필요합니다.');
      return { username: p.username, display_name: p.display_name, email: p.email || '', kind: p.kind, role: p.role, created_at: p.created_at,
        withdraw_requested: !!p.withdraw_requested_at, cv_url: p.cv_url || '', person_no: p.person_no || null, cv_public: p.cv_public !== false };
    },

    updateDisplayName: async function (name) {
      var m = await needMember();
      name = String(name || '').trim();
      if (!name || name.length > 30) throw err('이름을 30자 안으로 적어 주십시오.');
      var done = await run(sb.from('profiles').update({ display_name: name }).eq('id', m.id).select('id'));
      if (!done || !done.length) throw err('이름을 바꾸지 못했습니다.');
      forget();
      return true;
    },

    updateMyCv: async function (url, show) {
      var m = await needMember();
      url = String(url || '').trim();
      if (url && (url.length > 300 || !/^https:\/\/[^\s<>"'`]+$/.test(url))) throw err('CV 주소는 https:// 로 시작하는 주소로 적어 주십시오(빈칸 없이, 300자까지).');
      var patch = { cv_url: url || null };
      if (typeof show === 'boolean') patch.cv_public = show;
      await run(sb.from('profiles').update(patch).eq('id', m.id));
      return true;
    },

    // 내 카드의 지금 공개 값: 진짜 서버에서는 화면에 실린 카드 값
    myCard: async function () {
      var p = (await rpc('my_profile'))[0];
      if (!p || !p.person_no) return null;
      var c = (L().pageData().cards || {})[String(p.person_no)];
      return c ? { table: c.table, label: c.label, interest: c.interest, photo_url: c.photo ? L().url(c.photo) : '' } : null;
    },
    myProfileRequests: async function () {
      var rows = await rpc('my_profile_requests');
      rememberPhotos(rows);
      return (rows || []).map(function (r) {
        return { id: r.id, kind: r.kind, interest: r.interest, has_photo: !!r.photo_path, status: r.status, reason: r.reason || '',
          created_at: r.created_at, decided_at: r.decided_at || null };
      });
    },
    requestProfileChange: async function (kind, value) {
      var m = await needMember();
      if (m.profile.kind === '교수') throw err('교수님 소개는 관리자가 관리 화면에서 고칩니다.');
      if (kind === 'interest') {
        var kws = String(value || '').replace(/\s+/g, ' ').trim();
        kws = kws ? kws.split(/\s*[,·]\s*/) : [];
        if (kws.length > 5) throw err('관심 분야 키워드는 5개까지 보낼 수 있습니다.');
        if (kws.some(function (w) { return w.length < 1 || w.length > 30; })) throw err('키워드 하나는 1~30자로 적어 주십시오.');
        return await rpc('request_profile_change', { p_kind: 'interest', p_interest: kws.join(' · '), p_photo_path: null });
      }
      if (kind !== 'photo') throw err('요청 갈래가 올바르지 않습니다.');
      if (!(value instanceof Blob) || value.type !== 'image/jpeg') throw err('올린 사진을 찾지 못했습니다. 다시 골라 주십시오.');
      if (value.size > 1048576) throw err('사진이 너무 큽니다(1MB까지).');
      var path = m.id + '/' + randomName('jpg');
      var up = await sb.storage.from('profile-photos').upload(path, value, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw fromServer(up.error, '사진을 올리지 못했습니다.');
      try {
        return await rpc('request_profile_change', { p_kind: 'photo', p_interest: null, p_photo_path: path });
      } catch (e) { await removeFiles('profile-photos', [path]); throw e; }
    },
    cancelProfileRequest: async function (id) {
      var path = await photoPathOf(id, false);
      await rpc('cancel_profile_request', { target: Number(id) });
      if (path) await removeFiles('profile-photos', [path]);
      return true;
    },
    requestPhotoUrl: async function (id) {
      var m = await needMember();
      var path = await photoPathOf(id, m.profile.role === 'admin').catch(function () { return null; });
      if (!path) return null;
      var r = await sb.storage.from('profile-photos').createSignedUrl(path, 600);
      return r.error || !r.data ? null : r.data.signedUrl;
    },
    requestPhotoBlob: async function (id) {
      var path = await photoPathOf(id, true);
      var r = path ? await sb.storage.from('profile-photos').download(path) : { error: true };
      if (r.error || !r.data) throw err('요청한 사진 파일을 찾지 못했습니다. 본인에게 다시 올려 달라고 해 주십시오.');
      return r.data;
    },

    // 지금 비밀번호 확인은 다시 로그인으로 한다(관리자는 그 뒤 6자리를 한 번 더 넣음)
    changePassword: async function (current, next) {
      var m = await needMember();
      if (!m.email) throw err('이 계정에는 메일이 없어 비밀번호를 바꾸지 못했습니다. 조교에게 문의해 주십시오.');
      var chk = await sb.auth.signInWithPassword({ email: m.email, password: String(current || '') });
      if (chk.error) throw err('지금 비밀번호가 맞지 않습니다.');
      checkPassword(next);
      var r = await sb.auth.updateUser({ password: next });
      if (r.error) {
        if (r.error.status === 422) throw err('비밀번호는 8자 이상, 영문과 숫자를 함께 넣어 주십시오. 지금 비밀번호와 같으면 바뀌지 않습니다.');
        throw fromServer(r.error);
      }
      forget();
      return true;
    },

    requestWithdraw: async function () { await rpc('request_withdraw'); forget(); return true; },

    // ---- 관리(관리자, 2단계 인증을 마친 뒤. 서버 함수가 다시 확인)
    adminProfiles: async function () {
      var rows = await rpc('admin_list_profiles');
      return (rows || []).map(function (u) {
        return { id: u.id, username: u.username, display_name: u.display_name, kind: u.kind, intro: u.intro, role: u.role, status: u.status,
          created_at: u.created_at, withdraw_requested: !!u.withdraw_requested_at, cv_url: u.cv_url || '',
          course: u.course || '', entry_year: u.entry_year || null, show_email: !!u.show_email, person_no: u.person_no || null,
          leaving_to: u.leaving_to || null, legacy: !!u.legacy, old_username: u.old_username || null };
      });
    },
    adminProfileRequests: async function () {
      var rows = await rpc('admin_list_profile_requests');
      rememberPhotos(rows);
      return (rows || []).map(function (r) {
        return { id: r.id, user_id: r.user_id, display_name: r.display_name || '탈퇴한 회원', username: r.username || '', person_no: r.person_no || null,
          member_kind: r.member_kind || '', kind: r.kind, interest: r.interest, has_photo: !!r.photo_path, created_at: r.created_at };
      });
    },
    decideProfileRequest: async function (id, decision, reason) {
      if (decision !== 'approved' && decision !== 'rejected') throw err('결정이 올바르지 않습니다.');
      var path = await photoPathOf(id, true).catch(function () { return null; });
      await rpc('admin_decide_profile_request', { target: Number(id), decision: decision, why: String(reason || '').trim().slice(0, 200) });
      if (path) await removeFiles('profile-photos', [path]);
      return true;
    },
    clearCv: async function (id) { await rpc('admin_clear_cv', { target: id }); return true; },
    approve: async function (id) { await fn('admin-account', { action: 'approve', user_id: id }); return true; },
    reject: async function (id) { await rpc('admin_reject', { target: id }); return true; },
    setRole: async function (id, role) { await rpc('admin_set_role', { target: id, new_role: role }); return true; },
    setStatus: async function (id, status) { await rpc('admin_set_status', { target: id, new_status: status }); return true; },
    // 관리자가 보내는 비밀번호 링크: 메일이 있는지 먼저 보고 login-help reset(메일 한도 같음)으로 보낸다
    sendReset: async function (id) {
      var email = await rpc('admin_member_email', { target: id });
      if (!email) throw err('이 계정에는 메일이 없습니다. 먼저 메일을 바꿔 주십시오.');
      await fn('login-help', { action: 'reset', login: String(email) });
      return { sent: true, fakeMailLink: null };
    },
    adminLog: async function () {
      await needAdminRole();
      var rows = await run(sb.from('admin_log').select('id,admin_id,action,target,detail,created_at,changes,publish_state,undo_of')
        .order('created_at', { ascending: false }).limit(300));
      rows = rows || [];
      var ids = [];
      rows.forEach(function (l) { ids.push(l.admin_id); if (UUID_RE.test(l.target)) ids.push(l.target); });
      var names = await namesOf(ids);
      var undone = {};
      rows.forEach(function (l) { if (l.undo_of) undone[l.undo_of] = true; });
      return rows.map(function (l) {
        return { id: l.id, action: l.action, target: UUID_RE.test(l.target) ? 'user:' + (names[l.target] || '탈퇴한 회원') : l.target, detail: l.detail,
          admin_name: (l.admin_id && names[l.admin_id]) || '탈퇴한 회원', created_at: l.created_at,
          site: !!l.changes, publish_state: l.publish_state || null, undone: !!undone[l.id], undo_of: l.undo_of || null };
      });
    },

    // 나(관리자)의 2단계 인증 · 넘기기 상태. factor_id 는 이미 등록한 인증 앱(있으면 6자리만 넣음)
    adminSelf: async function () {
      var m = await needAdminRole();
      var aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      var mfa = !aal.error && aal.data && aal.data.currentLevel === 'aal2';
      var f = await sb.auth.mfa.listFactors();
      var totp = (!f.error && f.data && f.data.totp || []).filter(function (x) { return x.status === 'verified'; })[0];
      var out = { mfa: mfa, factor_id: totp ? totp.id : null, leaving_to: null, incoming: [] };
      if (mfa) {
        var people = await rpc('admin_list_profiles');
        var mine = (people || []).filter(function (u) { return u.id === m.id; })[0];
        out.leaving_to = mine ? mine.leaving_to || null : null;
        out.incoming = (people || []).filter(function (u) { return u.leaving_to === m.id; }).map(function (u) { return u.display_name; });
      }
      return out;
    },
    // 인증 앱 등록 시작: 확인 안 된 옛 등록은 지우고 새로. QR(그림 주소)과 손으로 넣을 열쇠 글을 돌려준다
    registerMfa: async function () {
      await needAdminRole();
      var f = await sb.auth.mfa.listFactors();
      var stale = (!f.error && f.data && f.data.all || []).filter(function (x) { return x.factor_type === 'totp' && x.status !== 'verified'; });
      for (var i = 0; i < stale.length; i++) await sb.auth.mfa.unenroll({ factorId: stale[i].id });
      var r = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: '연구실 관리 ' + new Date().toISOString().slice(0, 10) });
      if (r.error || !r.data) throw fromServer(r.error, '인증 앱 등록을 시작하지 못했습니다.');
      return { factor_id: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret };
    },
    verifyMfa: async function (factorId, code) {
      code = String(code || '').replace(/\s/g, '');
      if (!/^\d{6}$/.test(code)) throw err('인증 앱의 6자리 숫자를 넣어 주십시오.');
      var r = await sb.auth.mfa.challengeAndVerify({ factorId: factorId, code: code });
      if (r.error) throw err('숫자가 맞지 않습니다. 인증 앱의 지금 숫자를 다시 넣어 주십시오.');
      forget();
      return true;
    },
    memberEmail: async function (id) { return (await rpc('admin_member_email', { target: id })) || ''; },
    adminHelp: async function () { return (await rpc('admin_list_help')) || []; },
    closeHelp: async function (id, note) { await rpc('admin_close_help', { target: Number(id), note: String(note || '').slice(0, 200) }); return true; },
    deleteHelp: async function (id) { await rpc('admin_delete_help', { target: Number(id) }); return true; },
    setEmail: async function (id, email, method) { await fn('admin-account', { action: 'set_email', user_id: id, email: email, method: method }); return true; },
    setKind: async function (id, kind) { await rpc('admin_set_kind', { target: id, new_kind: kind }); return true; },
    linkPerson: async function (id, no) { await rpc('admin_link_person', { target: id, no: no == null || no === '' ? null : Number(no) }); return true; },
    withdrawDone: async function (id) { await fn('admin-account', { action: 'withdraw_done', user_id: id }); return true; },
    withdrawCancel: async function (id) { await rpc('admin_cancel_withdraw', { target: id }); return true; },
    linkOld: async function (pendingId, oldId, byClaim) {
      await fn('admin-account', { action: 'link_old', pending_id: pendingId, user_id: oldId, by_claim: !!byClaim });
      return { sent: true, fakeMailLink: null };
    },
    handover: async function (targetId) { await rpc('admin_handover', { target: targetId }); return true; },
    cancelHandover: async function () { await rpc('admin_cancel_handover'); return true; },
    finishHandover: async function () { return Number(await rpc('admin_finish_handover')) || 0; },

    // ---- 사이트 내용(서버 도우미 site-content 가 연구실 조직의 GitHub App 으로 표를 고친다. 조직이 생긴 뒤 동작)
    siteLoad: async function () {
      var d = await fn('site-content', { action: 'load' });
      siteBaseMark = d.base || null;
      return { rules: d.rules, texts: d.texts, photos: [], base: d.base, commit: d.commit };
    },
    siteSave: async function (changes, extra) {
      extra = extra || {};
      var photos = [];
      for (var i = 0; i < (extra.photos || []).length; i++) {
        var p = extra.photos[i];
        if (!(p.blob instanceof Blob) || p.blob.size > 1048576) throw err('사진이 너무 큽니다(1MB까지).');
        photos.push({ path: p.path, base64: await blobToBase64(p.blob) });
      }
      if (!siteBaseMark) await api.siteLoad();
      var r = await fn('site-content', { action: 'save', base: siteBaseMark, changes: changes || [], photos: photos,
        removePhotos: extra.removePhotos || [], link: extra.link, kind: extra.kind });
      siteBaseMark = null;
      return r;
    },
    siteUndo: async function (logId) { await fn('site-content', { action: 'undo', log_id: logId }); siteBaseMark = null; return true; },
    siteLogDetail: async function (logId) { return await fn('site-content', { action: 'detail', log_id: logId }); },
    sitePhotoUrl: async function (path) { return L().url('/' + path); }
  };

  window.LabSupabaseApi = api;
})();
