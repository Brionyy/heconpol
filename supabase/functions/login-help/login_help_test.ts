// login-help 의 legacy_login(옛 비밀번호 그대로 첫 로그인) · login(아이디로 로그인, 2026-11-13) 시험. 진짜 서버 대신 이 시험 안의 흉내(메모리)로 돌린다.
// 돌리기(site/ 에서): deno test --no-config -A supabase/functions/login-help/login_help_test.ts
// 옛 값은 hashcat 공개 예시 값('$P$984478476IagS59wHZvyQMArzfx58u.' = 'hashcat')이다. 진짜 회원 값 아님.
Deno.env.set('SUPABASE_URL', 'https://sb.test');
Deno.env.set('SUPABASE_SECRET_KEY', 'sb_secret_test');
Deno.env.set('SITE_ORIGIN', 'https://heconpol.org');

// ---------------------------------------------------------------- 흉내 낸 회원 칸 서버 함수
const LEGACY = '$P$984478476IagS59wHZvyQMArzfx58u.';
const OLD_ID = '55555555-5555-4555-8555-555555555555';
let legacy: Record<string, string> = {};   // user_id → 옛 값
let failures: string[] = [];
let finished: { user: string; password: string }[] = [];
const calls: string[] = [];
// 로그인 서비스 흉내: 메일 → 비밀번호(옮겨 온 회원은 처음에 없음), 아이디 → 메일
let passwords: Record<string, string> = {};
const EMAILS: Record<string, string> = { test_oldmember: 'old@example.test', test_member: 'member@example.test' };
function reset() {
  legacy = { [OLD_ID]: LEGACY };
  passwords = { 'member@example.test': 'Member-test-2026' };
  failures = []; finished = []; calls.length = 0;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? '{}'));
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  if (url === 'https://sb.test/auth/v1/token?grant_type=password') {
    calls.push('token');
    return passwords[body.email] !== undefined && passwords[body.email] === body.password
      ? json({ access_token: 'at-' + body.email, refresh_token: 'rt-1', token_type: 'bearer' })
      : json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
  }
  const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/);
  if (!m) throw new Error('모르는 주소 ' + url);
  calls.push(m[1]);
  if (m[1] === 'login_email_for') return json(EMAILS[body.login] ?? null);
  if (m[1] === 'legacy_password_for') {
    const known = body.p_login === 'test_oldmember' || body.p_login === 'old@example.test';
    const blocked = failures.filter((u) => u === OLD_ID).length >= 5;
    return json(known && legacy[OLD_ID] && !blocked ? [{ user_id: OLD_ID, hash: legacy[OLD_ID] }] : []);
  }
  if (m[1] === 'legacy_login_failed') { failures.push(body.p_user); return json(null); }
  if (m[1] === 'legacy_login_finish') {
    finished.push({ user: body.p_user, password: body.p_password });
    delete legacy[body.p_user];
    passwords['old@example.test'] = body.p_password;
    return json(true);
  }
  throw new Error('모르는 함수 ' + m[1]);
};

const { handle } = await import('./index.ts');

async function call(body: Record<string, unknown>) {
  const t = performance.now();
  const r = await handle(new Request('https://sb.test/functions/v1/login-help', {
    method: 'POST', headers: { origin: 'https://heconpol.org', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: r.status, json: await r.json(), ms: performance.now() - t };
}
function same(a: unknown, b: unknown, what: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: 기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)}`);
}
const NO = { ok: true, retry: false };

Deno.test('없는 아이디 · 틀린 비밀번호는 같은 답, 0.9초 뒤', async () => {
  reset();
  const a = await call({ action: 'legacy_login', login: 'nobody', password: 'hashcat' });
  const b = await call({ action: 'legacy_login', login: 'test_oldmember', password: 'wrong' });
  same(a.json, NO, '없는 아이디'); same(b.json, NO, '틀린 비밀번호');
  same(a.status, 200, '없는 아이디 상태'); same(b.status, 200, '틀린 비밀번호 상태');
  if (a.ms < 880 || b.ms < 880) throw new Error(`답이 너무 빠름 ${a.ms.toFixed(0)} · ${b.ms.toFixed(0)}ms`);
  same(failures, [OLD_ID], '틀린 횟수 기록');
  same(finished.length, 0, '저장');
});

Deno.test('맞는 옛 비밀번호(메일로 넣어도)는 새 방식으로 저장하고 retry, 그다음은 옛 값이 없어 같은 답', async () => {
  reset();
  const r = await call({ action: 'legacy_login', login: ' Old@Example.test ', password: 'hashcat' });
  same(r.json, { ok: true, retry: true }, '첫 로그인');
  same(finished, [{ user: OLD_ID, password: 'hashcat' }], '저장한 비밀번호(다듬지 않음)');
  const again = await call({ action: 'legacy_login', login: 'test_oldmember', password: 'hashcat' });
  same(again.json, NO, '옛 값 지운 뒤');
});

Deno.test('틀린 횟수 한도를 넘으면 맞는 비밀번호도 같은 답', async () => {
  reset();
  failures = Array(5).fill(OLD_ID);
  const r = await call({ action: 'legacy_login', login: 'test_oldmember', password: 'hashcat' });
  same(r.json, NO, '한도 넘음');
  same(finished.length, 0, '저장');
});

Deno.test('빈 칸은 400, 다른 사이트에서 부르면 403', async () => {
  reset();
  same((await call({ action: 'legacy_login', login: 'test_oldmember' })).status, 400, '비밀번호 없음');
  const r = await handle(new Request('https://sb.test/functions/v1/login-help', {
    method: 'POST', headers: { origin: 'https://evil.test' }, body: JSON.stringify({ action: 'legacy_login', login: 'a', password: 'b' }),
  }));
  same(r.status, 403, '다른 사이트');
  same(calls.length, 0, '서버 함수 부름');
});

// ---------------------------------------------------------------- 아이디 로그인(login)
const NO_SESSION = { ok: true, session: null };

Deno.test('아이디 로그인: 없는 아이디 · 틀린 비밀번호 · 메일을 넣음은 모두 같은 답, 0.9초 뒤, 메일을 답에 넣지 않음', async () => {
  reset();
  const a = await call({ action: 'login', login: 'nobody', password: 'Member-test-2026' });
  const b = await call({ action: 'login', login: 'test_member', password: 'wrong-1234' });
  const c = await call({ action: 'login', login: 'member@example.test', password: 'Member-test-2026' });
  same(a.json, NO_SESSION, '없는 아이디'); same(b.json, NO_SESSION, '틀린 비밀번호'); same(c.json, NO_SESSION, '메일을 넣음');
  same([a.status, b.status, c.status], [200, 200, 200], '상태');
  for (const x of [a, b, c]) if (x.ms < 880) throw new Error(`답이 너무 빠름 ${x.ms.toFixed(0)}ms`);
  if (JSON.stringify([a.json, b.json, c.json]).includes('@')) throw new Error('답에 메일이 들어감');
});

Deno.test('아이디 로그인: 맞는 비밀번호면 로그인 열쇠, 옛 값 확인은 하지 않음', async () => {
  reset();
  const r = await call({ action: 'login', login: ' Test_Member ', password: 'Member-test-2026' });
  same(r.json, { ok: true, session: { access_token: 'at-member@example.test', refresh_token: 'rt-1' } }, '열쇠');
  same(calls.includes('legacy_password_for'), false, '옛 값 확인');
});

Deno.test('아이디 로그인: 옮겨 온 회원은 옛 비밀번호로 첫 로그인(새 방식 저장 뒤 열쇠), 다음부터는 바로', async () => {
  reset();
  const r = await call({ action: 'login', login: 'test_oldmember', password: 'hashcat' });
  same(r.json, { ok: true, session: { access_token: 'at-old@example.test', refresh_token: 'rt-1' } }, '첫 로그인');
  same(finished, [{ user: OLD_ID, password: 'hashcat' }], '새 방식 저장');
  calls.length = 0;
  const again = await call({ action: 'login', login: 'test_oldmember', password: 'hashcat' });
  same(again.json.session?.access_token, 'at-old@example.test', '두 번째');
  same(calls, ['login_email_for', 'token'], '두 번째는 옛 값 확인 없이');
  const wrong = await call({ action: 'login', login: 'test_oldmember', password: 'hashcat2' });
  same(wrong.json, NO_SESSION, '그 뒤 틀린 비밀번호');
});

Deno.test('아이디 로그인: 옛 비밀번호가 틀리면 같은 답, 틀린 횟수 기록', async () => {
  reset();
  const r = await call({ action: 'login', login: 'test_oldmember', password: 'nothashcat' });
  same(r.json, NO_SESSION, '틀림');
  same(failures, [OLD_ID], '틀린 횟수');
  same((await call({ action: 'login', login: 'test_member' })).status, 400, '비밀번호 없음');
});
