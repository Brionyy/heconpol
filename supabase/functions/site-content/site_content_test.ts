// site-content 도우미 시험(2026-10-28). 진짜 GitHub · 회원 칸 서버 대신 이 시험 안의 흉내(메모리)로 돌린다. 바깥으로 아무것도 보내지 않는다.
// 돌리기(site/ 에서): deno test --no-config -A supabase/functions/site-content/site_content_test.ts  (tests/test_admin.py 가 부름)
// 보는 것: 관리자 · 2단계 인증 확인, 저장 한 번 = 판 하나(고친 줄만 바뀜), 그 사이 남이 고쳤으면 멈춤, 사진 규칙, 되돌리기, 공개 결과 적기.
const SITE = new URL('../../../', import.meta.url);
Deno.env.set('SUPABASE_URL', 'https://sb.test');
Deno.env.set('SUPABASE_SECRET_KEY', 'sb_secret_test');
Deno.env.set('SITE_ORIGIN', 'https://heconpol.org');
Deno.env.set('GITHUB_REPO', 'lab/heconpol');
Deno.env.set('GITHUB_APP_ID', '1');
Deno.env.set('GITHUB_APP_INSTALLATION_ID', '2');
// 시험용으로 그때그때 만든 열쇠(어디에도 쓰지 않음)
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pk = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
Deno.env.set('GITHUB_APP_PRIVATE_KEY', `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pk))}\n-----END PRIVATE KEY-----`);

// ---------------------------------------------------------------- 흉내 낸 GitHub 저장소
const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const dec = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
let seq = 0;
const blobs: Record<string, string> = {}, trees: Record<string, Record<string, string>> = {}, commits: Record<string, { tree: string; parent?: string }> = {};
function putBlob(b64: string) { const sha = 'b' + (++seq); blobs[sha] = b64; return sha; }
const files: Record<string, string> = {};
for (const p of ['schema/tables.json', 'data/people.csv', 'data/alumni.csv', 'data/news.csv', 'data/projects.csv', 'data/courses.csv']) {
  files[p] = putBlob(enc(await Deno.readTextFile(new URL(p, SITE))));
}
files['assets/img/people/old.jpg'] = putBlob(btoa('\xff\xd8\xff old'));
trees.t0 = files; commits.c0 = { tree: 't0' };
let ref = 'c0';
let refMovedByOther = false;

// ---------------------------------------------------------------- 흉내 낸 회원 칸 서버
const log: Record<string, unknown>[] = [];
let role = 'admin';
const rpcs: string[] = [];
const rpcArgs: Record<string, any>[] = [];
let numSeq = 1000, forceNumber: number | null = null, runConclusion = 'success';

function jwt(aal: string) {
  const b = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b({ alg: 'HS256' })}.${b({ sub: 'u-admin', aal })}.sig`;
}
const J = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (url.host === 'sb.test') {
    if (url.pathname === '/auth/v1/user') return J({ id: 'u-admin' });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.slice('/rest/v1/rpc/'.length);
      rpcs.push(name);
      rpcArgs.push({ name, ...body });
      if (name === 'my_profile') return J([{ role, status: 'active', display_name: '시험관리자' }]);
      if (name === 'admin_reserve_person_nos') return J(Array.from({ length: body.n }, () => forceNumber ?? ++numSeq));
      return J(null);
    }
    if (url.pathname === '/rest/v1/admin_log') {
      if (method === 'POST') { const row = { id: log.length + 1, ...body }; log.push(row); return J([row], 201); }
      if (method === 'PATCH') { const id = Number(url.searchParams.get('id')!.slice(3)); Object.assign(log[id - 1], body); return new Response(null, { status: 204 }); }
      const id = url.searchParams.get('id'), undo = url.searchParams.get('undo_of'), st = url.searchParams.get('publish_state');
      if (id) return J(log.filter((l) => `eq.${l.id}` === id));
      if (undo) return J(log.filter((l) => `eq.${l.undo_of}` === undo));
      if (st) return J(log.filter((l) => `eq.${l.publish_state}` === st));
    }
    return J({ message: 'no' }, 404);
  }
  if (url.host === 'api.github.com') {
    const p = url.pathname.replace('/repos/lab/heconpol', '');
    if (p === '/app/installations/2/access_tokens') return J({ token: 'ghs_test', expires_at: new Date(Date.now() + 3600e3).toISOString() });
    if (p === '/git/ref/heads/main') return J({ object: { sha: ref } });
    if (p.startsWith('/git/commits/') && method === 'GET') return J({ tree: { sha: commits[p.slice(13)].tree } });
    if (p.startsWith('/contents/')) {
      const path = decodeURIComponent(p.slice(10)), sha = trees[commits[url.searchParams.get('ref')!].tree][path];
      return sha ? J({ sha, content: blobs[sha] }) : J({}, 404);
    }
    if (p.startsWith('/git/blobs/')) return J({ content: blobs[p.slice(11)] });
    if (p === '/git/blobs') return J({ sha: putBlob(body.encoding === 'base64' ? body.content : enc(body.content)) }, 201);
    if (p === '/git/trees') {
      const t = { ...trees[body.base_tree] };
      for (const e of body.tree) { if (e.sha === null) delete t[e.path]; else t[e.path] = e.sha; }
      const sha = 't' + (++seq); trees[sha] = t; return J({ sha }, 201);
    }
    if (p === '/git/commits') { const sha = 'c' + (++seq); commits[sha] = { tree: body.tree, parent: body.parents[0] }; return J({ sha }, 201); }
    if (p === '/git/refs/heads/main' && method === 'PATCH') {
      if (refMovedByOther || commits[body.sha].parent !== ref) return J({ message: 'not fast forward' }, 422);
      ref = body.sha; return J({});
    }
    if (p === '/actions/runs') return J({ workflow_runs: [{ path: '.github/workflows/pages.yml', status: 'completed', conclusion: runConclusion, html_url: 'x' }] });
    if (p === '/actions/workflows/pages.yml/runs') return J({ workflow_runs: [{ head_sha: 'c-later' }] });   // 뒤 판에서 성공한 만들기
    if (p.startsWith('/compare/')) return J({ status: 'ahead' });
    return J({}, 404);
  }
  throw new Error('바깥 주소를 부르면 안 됩니다: ' + url);
};

const { handle } = await import('./index.ts');
// deno-lint-ignore no-explicit-any
const T: any = (globalThis as any).LabSiteTables;

async function call(body: Record<string, unknown>, opts: { aal?: string; origin?: string } = {}) {
  const r = await handle(new Request('https://sb.test/functions/v1/site-content', {
    method: 'POST', body: JSON.stringify(body),
    headers: { origin: opts.origin ?? 'https://heconpol.org', authorization: `Bearer ${jwt(opts.aal ?? 'aal2')}`, 'content-type': 'application/json' },
  }));
  return { status: r.status, body: await r.json() };
}
const fileAt = (path: string) => { const sha = trees[commits[ref].tree][path]; return sha ? dec(blobs[sha]) : null; };
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

Deno.test('다른 사이트에서 부르면 막힘 · 2단계 인증 전 관리자 · 회원은 막힘', async () => {
  assert((await call({ action: 'load' }, { origin: 'https://evil.example' })).status === 403, '다른 사이트');
  const a1 = await call({ action: 'load' }, { aal: 'aal1' });
  assert(a1.status === 403 && /2단계/.test(a1.body.error), '2단계 인증 전');
  role = 'member';
  assert((await call({ action: 'load' })).status === 403, '회원');
  role = 'admin';
});

Deno.test('불러오기 → 새 학생 더하기: 판 하나, 고친 줄만, 기록에 전 · 후 판', async () => {
  const l = await call({ action: 'load' });
  assert(l.status === 200 && Object.keys(l.body.texts).length === 5, '불러오기');
  const before = fileAt('data/people.csv')!;
  const s = await call({ action: 'save', base: { people: l.body.base.people },
    changes: [{ table: 'people', op: 'add', row: { 과정: '석사과정', 이름: '새학생' } }], link: { user_id: 'u-new', person_no: 99 } });
  assert(s.status === 200 && s.body.ok, '저장 ' + JSON.stringify(s.body));
  const after = fileAt('data/people.csv')!;
  assert(after.startsWith(before.replace(/\r?\n$/, '')) && after.includes('석사과정,새학생'), '끝에 한 줄만 더함');
  const e = log.at(-1) as any;
  assert(e.publish_state === 'waiting' && e.changes.files['data/people.csv'].before === l.body.base.people, '기록');
  assert(rpcs.includes('admin_link_person'), '카드 잇기를 관리자 권한으로 부름');
});

Deno.test('그 사이 남이 고쳤으면 멈춤(표 판 · 저장소 판 둘 다)', async () => {
  const s = await call({ action: 'save', base: { people: 'b-old' }, changes: [{ table: 'people', op: 'add', row: { 과정: '석사과정', 이름: '가' } }] });
  assert(s.status === 409 && s.body.code === 'stale', '표 판');
  const l = await call({ action: 'load' });
  refMovedByOther = true;
  const s2 = await call({ action: 'save', base: l.body.base, changes: [{ table: 'news', op: 'add', row: { 날짜: '2026-10-28', 제목: '소식' } }] });
  refMovedByOther = false;
  assert(s2.status === 409, '저장소 판');
});

Deno.test('틀린 칸 · 사진 규칙', async () => {
  const bad = await call({ action: 'save', changes: [{ table: 'news', op: 'add', row: { 날짜: '2026-13-40', 제목: '소식' } }] });
  assert(bad.status === 400 && bad.body.error.includes("'날짜'"), '틀린 날짜');
  const notJpeg = await call({ action: 'save', changes: [], photos: [{ path: 'assets/img/people/a.jpg', base64: btoa('GIF89a') }] });
  assert(notJpeg.status === 400, 'JPEG 아님');
  const outside = await call({ action: 'save', changes: [], photos: [{ path: 'assets/js/lab/app.js', base64: btoa('\xff\xd8\xff') }] });
  assert(outside.status === 400, '허락 밖 폴더');
  const same = await call({ action: 'save', changes: [], photos: [{ path: 'assets/img/people/old.jpg', base64: btoa('\xff\xd8\xff x') }] });
  assert(same.status === 400 && /이미 있습니다/.test(same.body.error), '덮어쓰기 금지');
  const ok = await call({ action: 'save', changes: [], photos: [{ path: 'assets/img/people/new-1.jpg', base64: btoa('\xff\xd8\xff new') }], removePhotos: ['assets/img/people/old.jpg'] });
  assert(ok.status === 200 && trees[commits[ref].tree]['assets/img/people/new-1.jpg'] && !trees[commits[ref].tree]['assets/img/people/old.jpg'], '사진 더하기 · 지우기');
});

Deno.test('되돌리기: 그 뒤 안 고쳤으면 되고, 고쳤으면 멈춤', async () => {
  const l = await call({ action: 'load' });
  const orig = fileAt('data/courses.csv');
  const rows = T.rows(T.parse(l.body.texts.courses));
  const s = await call({ action: 'save', base: l.body.base, changes: [{ table: 'courses', op: 'edit', index: 0, row: { ...rows[0], 학기: '2027-1' }, expect: rows[0] }] });
  assert(s.status === 200, '고침');
  const u = await call({ action: 'undo', log_id: s.body.log_id });
  assert(u.status === 200 && fileAt('data/courses.csv') === orig, '되돌림');
  assert((await call({ action: 'undo', log_id: s.body.log_id })).status === 409, '두 번 되돌리기 막힘');

  const l2 = await call({ action: 'load' });
  const s2 = await call({ action: 'save', base: l2.body.base, changes: [{ table: 'courses', op: 'edit', index: 0, row: { ...rows[0], 학기: 'A' }, expect: rows[0] }] });
  const r2 = T.rows(T.parse((await call({ action: 'load' })).body.texts.courses));
  await call({ action: 'save', changes: [{ table: 'courses', op: 'edit', index: 0, row: { ...r2[0], 학기: 'B' }, expect: r2[0] }] });
  const u2 = await call({ action: 'undo', log_id: s2.body.log_id });
  assert(u2.status === 409 && u2.body.code === 'stale', '그 뒤에 또 고쳤으면 멈춤');
  const d = await call({ action: 'detail', log_id: s2.body.log_id });
  assert(d.status === 200 && d.body.files['data/courses.csv'].after.includes(',A,'), '자세히(고치기 전 · 뒤)');
});

Deno.test('공개 결과: 기다리는 중 → 공개됨', async () => {
  const r = await call({ action: 'status' });
  assert(r.status === 200 && log.filter((l) => l.publish_state === 'waiting').length === 0, '모두 공개됨으로');
});

Deno.test('새 카드 번호는 서버가 내준 번호, 회원 잇기도 그 번호로 · 빼면 연결 끊기', async () => {
  const l = await call({ action: 'load' });
  const s1 = await call({ action: 'save', base: l.body.base, changes: [{ table: 'people', op: 'add', row: { 과정: '박사과정', 이름: '번호시험', 번호: '3' } }], link: { user_id: 'u-x', person_no: 3 } });
  assert(s1.status === 200, '저장');
  const rows = T.rows(T.parse(fileAt('data/people.csv')!));
  const mine = rows.at(-1);
  assert(Number(mine['번호']) > 1000, '화면이 적은 3 대신 서버 번호 ' + mine['번호']);
  const link = rpcArgs.filter((a) => a.name === 'admin_link_person').at(-1);
  assert(link && String(link.no) === mine['번호'] && link.target === 'u-x', '잇기 번호 ' + JSON.stringify(link));
  const s2 = await call({ action: 'save', changes: [{ table: 'people', op: 'remove', index: rows.length - 1, expect: mine }] });
  assert(s2.status === 200, '빼기');
  const un = rpcArgs.filter((a) => a.name === 'admin_unlink_person_nos').at(-1);
  assert(un && JSON.stringify(un.nos) === JSON.stringify([Number(mine['번호'])]), '연결 끊기 ' + JSON.stringify(un));
});

Deno.test('되돌리면 번호가 겹치는 경우는 멈춤(만들기가 멈추지 않게)', async () => {
  const alum = T.rows(T.parse(fileAt('data/alumni.csv')!));
  const s1 = await call({ action: 'save', changes: [{ table: 'alumni', op: 'remove', index: 0, expect: alum[0] }] });
  assert(s1.status === 200, '졸업생 빼기');
  forceNumber = Number(alum[0]['번호']);   // 그 사이 같은 번호를 쓴 카드(사람이 표를 직접 고친 경우 등)
  const s2 = await call({ action: 'save', changes: [{ table: 'people', op: 'add', row: { 과정: '석사과정', 이름: '같은번호' } }] });
  forceNumber = null;
  assert(s2.status === 200, '같은 번호 카드');
  const u = await call({ action: 'undo', log_id: s1.body.log_id });
  assert(u.status === 409 && /겹칩니다/.test(u.body.error), '멈춤 ' + JSON.stringify(u.body));
});

Deno.test('앞 만들기가 취소돼도 뒤 판의 만들기가 성공했으면 공개됨', async () => {
  await call({ action: 'save', changes: [{ table: 'news', op: 'add', row: { 날짜: '2026-10-28', 제목: '취소 시험' } }] });
  runConclusion = 'cancelled';
  const r = await call({ action: 'status' });
  runConclusion = 'success';
  const e = log.at(-1) as any;
  assert(r.status === 200 && e.publish_state === 'published', '공개됨 ' + e.publish_state);
});
