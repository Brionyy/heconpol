// login-help 의 legacy_login(옛 비밀번호 그대로 첫 로그인, 2026-11-13) 시험. 진짜 서버 대신 이 시험 안의 흉내(메모리)로 돌린다.
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
function reset() {
  legacy = { [OLD_ID]: LEGACY };
  failures = []; finished = []; calls.length = 0;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? '{}'));
  const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/);
  if (!m) throw new Error('모르는 주소 ' + url);
  calls.push(m[1]);
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
  if (m[1] === 'legacy_password_for') {
    const known = body.p_login === 'test_oldmember' || body.p_login === 'old@example.test';
    const blocked = failures.filter((u) => u === OLD_ID).length >= 5;
    return json(known && legacy[OLD_ID] && !blocked ? [{ user_id: OLD_ID, hash: legacy[OLD_ID] }] : []);
  }
  if (m[1] === 'legacy_login_failed') { failures.push(body.p_user); return json(null); }
  if (m[1] === 'legacy_login_finish') {
    finished.push({ user: body.p_user, password: body.p_password });
    delete legacy[body.p_user];
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
