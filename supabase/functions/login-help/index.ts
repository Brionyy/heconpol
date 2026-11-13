// 서버 도우미 login-help(2026-10-28 초안): 로그인 없이 하는 일 셋. 누가 회원인지 드러나지 않게 답은 늘 같은 글 · 같은 시간.
// - reset: 아이디 또는 메일로 비밀번호 링크 받기(옛 회원 처음 정하기 · 잊음). 메일 한도: 계정마다 10분에 1번 · 하루 3번, 전체 한 시간 20통.
//   링크 메일은 로그인 서비스의 메일 틀(Reset Password, "아이디: {{ .Data.username }}" 한 줄)로 간다.
// - signup: 가입 신청. 아이디가 겹치면 알려 준다(새 아이디를 고르려면 피할 수 없음). 메일이 겹치면 화면은 똑같이
//   "받았습니다"를 보이고, 그 계정으로 비밀번호 링크를 보낸다(옛 회원이 '처음이에요'로 잘못 들어온 경우).
//   계정은 관리자 API 로 만든다. 그래서 로그인 서비스의 공개 가입(Allow new users to sign up)을 끌 수 있다
//   (공개 /signup 은 이미 있는 메일에 다른 답을 줘 누가 회원인지 드러남, 검토 10-28 2번).
// 메일 보내기 · 계정 만들기는 답을 준 뒤 뒤에서 한다(inBackground). 답은 늘 0.9초 뒤 같은 글.
// 메일이 바뀐 옛 회원은 본인 확인 요청 대신 새 메일로 가입 신청을 하고 '예전 아이디'를 적는다(11-02). 관리자가 승인 목록에서 잇는다.
// - legacy_login(2026-11-13, 연구자 "그냥 재설정 안하고 그대로 쓸 수 있게"): 옛 회원이 옛 비밀번호 그대로 처음 로그인.
//   화면은 보통 로그인(signIn)이 bad_login 이면 이것을 한 번 부르고, retry 가 true 면 같은 아이디 · 비밀번호로 다시 로그인한다.
//   '비밀번호 정하기 전'이고 옛 값(워드프레스 phpass)이 있으면 확인(_shared/phpass.ts) → 맞으면 회원 칸 서버 함수 legacy_login_finish 가
//   같은 비밀번호를 bcrypt 로 저장 · 상태 정상 · 옛 값 지움. 새 비밀번호 규칙(8자 · 영문+숫자)에 안 맞아도 받는다(연구자 뜻: 그대로 쓰기).
//   틀림 · 없는 계정 · 옛 값 없음 · 틀린 횟수 한도(계정마다 15분에 5번, 전체 한 시간 100번) 넘음은 모두 같은 답 { ok: true, retry: false }를
//   0.9초 뒤에 준다(누가 회원인지 드러나지 않게). 비밀번호는 기록에 남기지 않는다. 규칙: migrations/20261113000000_legacy_password.sql
import { HttpError, SECRET_KEY, SITE_ORIGIN, SUPABASE_URL, atLeast, handlerOf, inBackground, pause, rpc, sha256Hex } from '../_shared/common.ts';
import { phpassCheck } from '../_shared/phpass.ts';

const SAME_ANSWER = { ok: true };
const KINDS = ['재학', '졸업', '교수', '기타'];

async function recover(email: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(SITE_ORIGIN + '/login/reset/')}`, {
    method: 'POST', headers: { apikey: SECRET_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email }),
  });
}

// 옛 비밀번호로 확인. 맞아서 새 방식으로 저장했으면 true
async function legacyLogin(login: string, password: string): Promise<boolean> {
  const row = (await rpc<{ user_id: string; hash: string }[]>('legacy_password_for', { p_login: login }))[0];
  if (!row) return false;
  if (!phpassCheck(password, row.hash)) {
    await rpc('legacy_login_failed', { p_user: row.user_id });
    return false;
  }
  return (await rpc<boolean>('legacy_login_finish', { p_user: row.user_id, p_password: password })) === true;
}

async function sendLinkFor(login: string): Promise<void> {
  const email = await rpc<string | null>('login_email_for', { login });
  if (!email) return;
  if (!(await rpc<boolean>('take_mail_quota', { p_key: 'reset:' + (await sha256Hex(email.toLowerCase())) }))) return;
  await recover(email);
}

export const handle = handlerOf(async (_req, body) => {
  const action = String(body.action ?? '');

  if (action === 'reset') {
    const login = String(body.login ?? '').trim().toLowerCase().slice(0, 120);
    if (!login) throw new HttpError(400, '아이디나 메일을 적어 주십시오.');
    // 메일로 넣었으면 그 메일, 아이디로 넣었으면 아이디로 메일을 찾는다(화면은 메일을 보지 못함)
    inBackground((async () => {
      if (login.includes('@')) {
        const acc = (await rpc<{ username: string; status: string; role: string }[]>('account_for_email', { p_email: login }))[0];
        if (acc && acc.status !== 'locked') await sendLinkFor(acc.username);
      } else await sendLinkFor(login);
    })());
    await pause(900);
    return SAME_ANSWER;
  }

  if (action === 'signup') {
    const f = body as Record<string, unknown>;
    let username = String(f.username ?? '').trim().toLowerCase();
    const email = String(f.email ?? '').trim().toLowerCase();
    if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(email) || email.length > 120) throw new HttpError(400, '메일 주소를 확인해 주십시오.');
    // 새 메일로 가입 신청(11-02): 아이디 칸 없이 메일로 로그인한다. 안에서 쓸 아이디는 메일 앞부분 + 숫자 넷(겹치면 다시)
    if (f.email_as_id === true && !username) {
      let base = email.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 12);
      if (base.length < 4) base = (base + 'user').slice(0, 4);
      for (let i = 0; i < 8 && (!username || await rpc<boolean>('username_exists', { p_username: username })); i++)
        username = `${base}_${1000 + Math.floor(Math.random() * 9000)}`;
    }
    if (!/^[a-z0-9_]{4,20}$/.test(username)) throw new HttpError(400, '아이디는 영문 소문자 · 숫자 · 밑줄로 4~20자입니다.');
    const password = String(f.password ?? '');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new HttpError(400, '비밀번호는 8자 이상, 영문과 숫자를 함께 넣어 주십시오.');
    if (await rpc<boolean>('username_exists', { p_username: username })) throw new HttpError(409, '이미 쓰는 아이디입니다.', 'username_taken');
    const kind = KINDS.includes(String(f.kind)) ? String(f.kind) : '기타';
    inBackground((async () => {
      const acc = (await rpc<{ username: string; role: string; status: string }[]>('account_for_email', { p_email: email }))[0];
      if (acc) {
        if (acc.role !== 'pending' && acc.status !== 'locked') await sendLinkFor(acc.username);
        return;
      }
      // 관리자 API 로 만든다(공개 가입은 끔). 확인 메일 없이 확인된 메일로(관리자 승인으로 거름, 10-24). 등급 · 상태는 회원 칸 서버가 정한다
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST', headers: { apikey: SECRET_KEY, authorization: `Bearer ${SECRET_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: {
          username, display_name: String(f.display_name ?? '').trim().slice(0, 30), kind, intro: String(f.intro ?? '').trim().slice(0, 100),
          course: kind === '재학' ? String(f.course ?? '').trim().slice(0, 20) : '', entry_year: kind === '재학' ? String(f.entry_year ?? '') : '',
          show_email: kind === '재학' && f.show_email === true ? 'true' : 'false',
          old_username: String(f.old_username ?? '').replace(/\s/g, '').slice(0, 40) } }),   // 메일이 바뀐 옛 회원이 적은 예전 아이디(선택, 11-02)
      });
      if (!r.ok) console.error('가입 신청 실패', r.status);
    })());
    await pause(900);
    return SAME_ANSWER;
  }

  if (action === 'legacy_login') {
    const login = String(body.login ?? '').trim().toLowerCase().slice(0, 120);
    const password = typeof body.password === 'string' ? body.password : '';   // 비밀번호는 다듬지 않는다(옛 사이트도 그대로 씀)
    if (!login || !password) throw new HttpError(400, '아이디와 비밀번호를 적어 주십시오.');
    const done = await atLeast(900, legacyLogin(login, password).catch((e) => {
      console.error('옛 비밀번호 확인 실패', e instanceof Error ? e.message : String(e));   // 서버 원문만, 비밀번호 없음
      return false;
    }));
    return done ? { ok: true, retry: true } : { ok: true, retry: false };
  }

  throw new HttpError(400, '모르는 일입니다.');
});

if (import.meta.main) Deno.serve(handle);
