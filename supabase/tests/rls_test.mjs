// 회원 칸 권한 규칙 시험. 진짜 Postgres(PGlite)에 규칙 파일을 올리고 등급마다 해 보면 되는 일 · 막혀야 하는 일을 확인한다.
// 돌리기: PGLITE_DIR=<@electric-sql/pglite 를 설치한 폴더> node supabase/tests/rls_test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(process.env.PGLITE_DIR || '.', 'node_modules/@electric-sql/pglite/dist');
const { PGlite } = await import(pathToFileURL(join(pkg, 'index.js')).href);
const { pgcrypto } = await import(pathToFileURL(join(pkg, 'contrib/pgcrypto.js')).href);

const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec(readFileSync(join(here, 'supabase_stub.sql'), 'utf8'));
// 규칙 파일은 진짜 서버에 올리는 차례(파일 이름 = 날짜 순)대로 모두 올린다.
const migrations = join(here, '../migrations');
for (const f of readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(migrations, f), 'utf8'));
}
await db.exec(readFileSync(join(here, '../seed_fake.sql'), 'utf8'));

// site/data/boards.csv 를 읽는다(따옴표 칸 허용). 값은 build.py 와 같은 규칙으로 바꾼다.
function readCsv(file) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  const endRow = () => { row.push(cell); cell = ''; if (row.some(x => x.trim())) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') endRow();
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) endRow();
  const head = rows.shift().map(x => x.trim());
  return rows.map(r => Object.fromEntries(head.map((k, i) => [k, (r[i] || '').trim()])));
}
const YES = ['예', 'O', 'o'];
const csvBoards = readCsv(join(here, '../../data/boards.csv')).map(b => ({
  slug: b['주소 이름'], name: b['이름'], allow_files: YES.includes(b['첨부']), is_gallery: YES.includes(b['사진첩']),
  group_name: b['묶음'] || null,
}));

const U = {
  admin: '11111111-1111-4111-8111-111111111111',
  member: '22222222-2222-4222-8222-222222222222',
  alumni: '33333333-3333-4333-8333-333333333333',
  pending: '44444444-4444-4444-8444-444444444444',
  old: '55555555-5555-4555-8555-555555555555',
};

// who: 'anon' | 'service_role' | 사용자 키. 한 번의 거래 안에서 돌리고 되돌린다(keep=true 면 남김).
async function as(who, fn, { aal = 'aal1', keep = false } = {}) {
  await db.exec('begin');
  try {
    if (who === 'anon' || who === 'service_role') {
      await db.exec(`set local role ${who}`);
    } else {
      const claims = JSON.stringify({ sub: U[who], role: 'authenticated', aal });
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await db.exec('set local role authenticated');
    }
    const r = await fn((sql, params) => db.query(sql, params));
    await db.exec(keep ? 'commit' : 'rollback');
    return r;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); pass++; console.log('  통과  ' + name); }
  catch (e) { fail++; console.log('  실패  ' + name + '\n        ' + (e && e.message)); }
}
async function denied(name, fn, pattern) {
  try { await fn(); fail++; console.log('  실패  ' + name + ' (막혀야 하는데 됨)'); }
  catch (e) {
    if (pattern && !pattern.test(e.message)) { fail++; console.log('  실패  ' + name + ' (다른 오류: ' + e.message + ')'); return; }
    pass++; console.log('  통과  ' + name + '  [' + e.message.split('\n')[0] + ']');
  }
}
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: 기대 ${b}, 실제 ${a}`); }
const n = async (q, sql, p) => Number((await q(sql, p)).rows[0].n);

console.log('게시판 목록');
await ok('서버 게시판 목록이 data/boards.csv 와 같음(순서 · 이름 · 첨부 · 사진첩 · 묶음)', async () => {
  const rows = (await db.query('select slug, name, allow_files, is_gallery, group_name from boards order by sort, slug')).rows;
  const got = JSON.stringify(rows), want = JSON.stringify(csvBoards);
  if (got !== want) throw new Error('다름\n        표:   ' + want + '\n        서버: ' + got);
});
await ok("'대상' 칸은 없앰(2026-11-13 연구자 결정)", async () => {
  const r = await db.query("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'boards' and column_name = 'audience'");
  if (r.rows.length) throw new Error('audience 칸이 남아 있음');
});

console.log('방문자(로그인 안 함)');
await denied('글 표를 못 읽음', () => as('anon', q => q('select * from posts')), /permission denied/);
await denied('회원 정보를 못 읽음', () => as('anon', q => q('select * from profiles')), /permission denied/);
await denied('글 목록 모아 보기를 못 읽음', () => as('anon', q => q('select * from post_list')), /permission denied/);
await denied('관리자 함수를 못 부름', () => as('anon', q => q(`select admin_approve('${U.pending}')`)), /permission denied/);

console.log('승인 대기');
await ok('자기 회원 정보 한 줄만 보임', () => as('pending', async q => eq(await n(q, 'select count(*) n from profiles'), 1, '보이는 줄')));
await ok('글이 하나도 안 보임', () => as('pending', async q => eq(await n(q, 'select count(*) n from posts'), 0, '글')));
await ok('게시판 목록도 안 보임', () => as('pending', async q => eq(await n(q, 'select count(*) n from boards'), 0, '게시판')));
await denied('글을 못 씀', () => as('pending', q => q(`insert into posts (board, title, body_md) values ('free', 'x', 'y')`)), /row-level security/);
await denied('파일을 못 올림', () => as('pending', q => q(`insert into storage.objects (bucket_id, name) values ('gallery', '${U.pending}/a.jpg')`)), /row-level security/);

console.log('회원');
await ok('숨긴 글 빼고 4개가 보임', () => as('member', async q => eq(await n(q, 'select count(*) n from posts'), 4, '글')));
await ok('글 목록 모아 보기도 같은 규칙(4개)', () => as('member', async q => eq(await n(q, 'select count(*) n from post_list'), 4, '글')));
await ok('글쓴이 칸은 자기로 고정됨', () => as('member', async q => {
  const r = await q(`insert into posts (board, title, body_md) values ('free', '새 글', '본문') returning author_id, hidden`);
  eq(r.rows[0].author_id, U.member, '글쓴이'); eq(r.rows[0].hidden, false, '숨김');
}));
await denied('글쓴이를 남으로 적어 넣지 못함', () => as('member', q => q(`insert into posts (board, title, author_id) values ('free', 'x', '${U.admin}')`)), /permission denied/);
await ok('남의 글은 못 고침(0줄)', () => as('member', async q => {
  const r = await q(`update posts set title = '바꿈' where title = '세미나실 예약 안내'`); eq(r.affectedRows, 0, '고친 줄');
}));
await ok('내 글은 고침(1줄)', () => as('member', async q => {
  const r = await q(`update posts set title = '고친 제목' where title = '안녕하십니까, 시험회원입니다'`); eq(r.affectedRows, 1, '고친 줄');
}));
await denied('숨김 칸은 못 바꿈', () => as('member', q => q(`update posts set hidden = true where author_id = '${U.member}'`)), /permission denied/);
await denied('자기 등급을 못 올림', () => as('member', q => q(`update profiles set role = 'admin' where id = '${U.member}'`)), /permission denied/);
await ok('자기 이름은 바꿈, 남의 이름은 0줄', () => as('member', async q => {
  eq((await q(`update profiles set display_name = '새이름' where id = '${U.member}'`)).affectedRows, 1, '내 이름');
  eq((await q(`update profiles set display_name = '남이름' where id = '${U.alumni}'`)).affectedRows, 0, '남 이름');
}));
await denied('남의 아이디 칸은 못 읽음', () => as('member', q => q('select username from profiles')), /permission denied/);
await ok('내 정보(메일 포함)는 나만 봄', () => as('member', async q => {
  const r = await q('select * from my_profile()'); eq(r.rows.length, 1, '줄'); eq(r.rows[0].email, 'member@example.test', '메일');
}));
const hiddenId = (await db.query(`select id from posts where hidden limit 1`)).rows[0].id;
await denied('숨긴 글에 댓글 못 닮', () => as('member', q => q(`insert into comments (post_id, body) values ($1, '댓글')`, [hiddenId])), /row-level security/);
await ok('보이는 글에는 댓글 닮 · 글쓴이 고정', () => as('member', async q => {
  const r = await q(`insert into comments (post_id, body) select id, '댓글' from posts where not hidden limit 1 returning author_id`);
  eq(r.rows[0].author_id, U.member, '댓글 쓴이');
}));
await denied('관리자 함수를 못 부름', () => as('member', q => q(`select admin_approve('${U.pending}')`)), /관리자만/);
await ok('관리 기록이 안 보임', () => as('member', async q => eq(await n(q, 'select count(*) n from admin_log'), 0, '기록')));
await denied('아이디로 메일 찾기 함수를 못 부름', () => as('member', q => q(`select login_email_for('test_admin')`)), /permission denied/);
await ok('하루 글 30개에서 막힘', () => as('member', async q => {
  let made = 0, msg = '';
  for (let i = 0; i < 40; i++) {
    try { await q(`insert into posts (board, title) values ('free', '많이 ${i}')`); made++; }
    catch (e) { msg = e.message; break; }
  }
  if (!/30개/.test(msg)) throw new Error('막히지 않음: ' + made + '개 씀');
  eq(made, 28, '오늘 더 쓴 개수(이미 2개 씀)');
}));

console.log('첨부 · 파일 칸');
await ok('내 글에 자료 첨부(자기 폴더)', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title) values ('free', '첨부 글') returning id`)).rows[0].id;
  await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'files', $2, '자료.pdf', 'application/pdf', 100)`, [id, `${U.member}/a1.pdf`]);
}));
await ok('자유게시판 글에 본문 그림(사진 칸 JPEG)을 닮', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title) values ('free', '글') returning id`)).rows[0].id;
  await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'gallery', $2, 'a.jpg', 'image/jpeg', 100)`, [id, `${U.member}/a.jpg`]);
  eq(await n(q, 'select count(*) n from post_list where id = $1 and image_count = 1 and file_count = 0', [id]), 1, '그림 1 · 첨부 0');
}));
await denied('사진 칸에는 JPEG 만(PNG 거절)', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title) values ('free', '글') returning id`)).rows[0].id;
  await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'gallery', $2, 'a.png', 'application/pdf', 100)`, [id, `${U.member}/a.png`]);
}), /check constraint/);
await denied('사진첩 글에는 자료 칸 파일을 못 닮', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title) values ('photos', '사진') returning id`)).rows[0].id;
  await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'files', $2, 'a.pdf', 'application/pdf', 100)`, [id, `${U.member}/p1.pdf`]);
}), /row-level security/);
await denied('남의 폴더 경로로 못 닮', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title) values ('free', '글') returning id`)).rows[0].id;
  await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'files', $2, 'a.pdf', 'application/pdf', 100)`, [id, `${U.admin}/a.pdf`]);
}), /row-level security/);
await denied('SVG 같은 형식은 표에서도 거절', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title) values ('free', '글') returning id`)).rows[0].id;
  await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'files', $2, 'a.svg', 'image/svg+xml', 100)`, [id, `${U.member}/a.svg`]);
}), /check constraint/);
await denied('원래 이름의 확장자가 형식과 다르면 거절(실행 파일을 PDF로 속이기)', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title) values ('free', '글') returning id`)).rows[0].id;
  await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'files', $2, '보고서.exe', 'application/pdf', 100)`, [id, `${U.member}/x1.pdf`]);
}), /check constraint/);
await denied('원래 이름에 글자 방향을 뒤집는 숨은 글자는 거절', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title) values ('free', '글') returning id`)).rows[0].id;
  await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'files', $2, $3, 'application/pdf', 100)`, [id, `${U.member}/x2.pdf`, '보고서‮exe.pdf']);
}), /check constraint/);
await ok('파일 칸 세 개는 늘 비공개', async () => {
  eq((await db.query(`select count(*)::int n from storage.buckets where id in ('gallery', 'files', 'profile-photos') and not public`)).rows[0].n, 3, '비공개 칸');
});
await ok('파일 칸: 내 폴더에는 올림', () => as('member', q => q(`insert into storage.objects (bucket_id, name) values ('gallery', '${U.member}/p.jpg')`)));
await denied('파일 칸: 남의 폴더에는 못 올림', () => as('member', q => q(`insert into storage.objects (bucket_id, name) values ('gallery', '${U.admin}/p.jpg')`)), /row-level security/);
await ok('파일 칸: 글에 안 달린 남의 파일은 안 보임', () => as('member', async q => {
  await db.query(`select 1`);
  eq(await n(q, `select count(*) n from storage.objects where owner_id <> '${U.member}'`), 0, '보이는 남의 파일');
}));

console.log('게시판 셋(세미나 후기 · 신입생 자기소개 · 자유게시판, 2026-10-27)');
for (const [slug, label] of [['seminar', '세미나'], ['newcomer', '신입생 자기소개'], ['free', '자유게시판']]) {
  for (const [who, role] of [['member', '회원이'], ['admin', '관리자가']]) {
    await ok(`${label}: ${role} 글 · 댓글을 씀`, () => as(who, async q => {
      const id = (await q(`insert into posts (board, title, body_md) values ($1, '시험 글', '본문') returning id`, [slug])).rows[0].id;
      await q(`insert into comments (post_id, body) values ($1, '시험 댓글')`, [id]);
      eq(await n(q, 'select count(*) n from post_list where id = $1 and board = $2 and comment_count = 1', [id, slug]), 1, '목록에 보이는 글(댓글 1)');
    }));
  }
}
for (const [who, role] of [['member', '회원이'], ['admin', '관리자가']]) {
  await ok(`세미나 후기: ${role} 발표 자료(PDF)를 붙임`, () => as(who, async q => {
    const id = (await q(`insert into posts (board, title) values ('seminar', '후기') returning id`)).rows[0].id;
    await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'files', $2, '발표.pdf', 'application/pdf', 100)`, [id, `${U[who]}/s1.pdf`]);
    eq(await n(q, 'select count(*) n from post_list where id = $1 and file_count = 1', [id]), 1, '첨부 1개인 글');
  }));
}
await ok('세미나 후기 · 신입생 자기소개: 본문 그림(사진 칸)을 붙임', () => as('member', async q => {
  for (const b of ['seminar', 'newcomer']) {
    const id = (await q(`insert into posts (board, title) values ($1, '그림 글') returning id`, [b])).rows[0].id;
    await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'gallery', $2, '그림.jpg', 'image/jpeg', 100)`, [id, `${U.member}/${b}.jpg`]);
  }
}));
await denied('신입생 자기소개: 자료 파일은 못 붙임(첨부 아니오)', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title) values ('newcomer', '인사') returning id`)).rows[0].id;
  await q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'files', $2, 'a.pdf', 'application/pdf', 100)`, [id, `${U.member}/n1.pdf`]);
}), /row-level security/);
await denied('없는 게시판에는 글을 못 씀', () => as('member', q => q(`insert into posts (board, title) values ('nothing', 'x')`)), /foreign key/);

console.log('임시저장(2026-10-27)');
await ok('임시저장 글은 글쓴이에게만 보이고 목록 모아 보기에는 안 나옴', () => as('member', async q => {
  const id = (await q(`insert into posts (board, title, status) values ('seminar', '쓰는 중', 'draft') returning id`)).rows[0].id;
  eq(await n(q, 'select count(*) n from posts where id = $1', [id]), 1, '내가 보는 임시저장 글');
  eq(await n(q, 'select count(*) n from post_list where id = $1', [id]), 0, '목록에 보이는 임시저장 글');
}));
const draftId = (await as('member', q => q(`insert into posts (board, title, status) values ('seminar', '남이 보면 안 되는 글', 'draft') returning id`), { keep: true })).rows[0].id;
await as('member', q => q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'gallery', $2, '그림.jpg', 'image/jpeg', 100)`, [draftId, `${U.member}/draft.jpg`]), { keep: true });
await ok('다른 회원은 남의 임시저장 글 · 그 그림을 못 봄', () => as('alumni', async q => {
  eq(await n(q, 'select count(*) n from posts where id = $1', [draftId]), 0, '글');
  eq(await n(q, 'select count(*) n from attachments where post_id = $1', [draftId]), 0, '그림');
}));
await ok('관리자도 남의 임시저장 글은 못 봄', () => as('admin', async q => eq(await n(q, 'select count(*) n from posts where id = $1', [draftId]), 0, '글'), { aal: 'aal2' }));
await denied('임시저장 글에는 댓글을 못 닮(글쓴이도)', () => as('member', q => q(`insert into comments (post_id, body) values ($1, '댓글')`, [draftId])), /row-level security/);
await ok('올리면 남에게 보이고, 쓴 때가 올린 때로 바뀜', async () => {
  await db.query(`update posts set created_at = now() - interval '5 days' where id = $1`, [draftId]);
  await as('member', q => q(`update posts set status = 'published' where id = $1`, [draftId]), { keep: true });
  await as('alumni', async q => {
    eq(await n(q, `select count(*) n from post_list where id = $1 and created_at > now() - interval '1 minute' and image_count = 1`, [draftId]), 1, '올린 글(그림 1)');
  });
});
await denied('올린 글은 임시저장으로 못 되돌림', () => as('member', q => q(`update posts set status = 'draft' where id = $1`, [draftId])), /되돌릴 수 없습니다/);
await denied('상태 칸에 모르는 값은 거절', () => as('member', q => q(`insert into posts (board, title, status) values ('free', 'x', 'secret')`)), /check constraint/);
await db.query('delete from posts where id = $1', [draftId]);   // 뒤 시험의 글 수를 그대로 두려고 지운다

console.log('관리자');
await denied('2단계 인증 전에는 승인 못 함', () => as('admin', q => q(`select admin_approve('${U.pending}')`)), /2단계/);
await ok('2단계 인증 전에는 남의 글을 못 지움(0줄)', () => as('admin', async q => {
  eq((await q(`delete from posts where author_id = '${U.member}'`)).affectedRows, 0, '지운 줄');
}));
await ok('2단계 인증 전에는 숨긴 글 · 관리 기록이 안 보임(보안 검토 11-02)', () => as('admin', async q => {
  eq(await n(q, 'select count(*) n from posts'), 4, '글');
  eq(await n(q, 'select count(*) n from admin_log'), 0, '기록');
}));
await ok('2단계 인증 뒤 숨긴 글도 보임(5개)', () => as('admin', async q => eq(await n(q, 'select count(*) n from posts'), 5, '글'), { aal: 'aal2' }));
await ok('2단계 인증 뒤 남의 글 지움', () => as('admin', async q => {
  if ((await q(`delete from posts where author_id = '${U.member}'`)).affectedRows < 1) throw new Error('못 지움');
}, { aal: 'aal2' }));
await ok('2단계 인증 뒤 가입 승인 · 기록 남음', () => as('admin', async q => {
  await q(`select admin_approve('${U.pending}')`);
  eq((await q(`select role from admin_list_profiles() where id = '${U.pending}'`)).rows[0].role, 'member', '등급');
  eq(await n(q, `select count(*) n from admin_log where action = '가입 승인'`), 1, '기록');
}, { aal: 'aal2' }));
await ok('관리자는 두 명까지', () => as('admin', async q => {
  await q(`select admin_set_role('${U.member}', 'admin')`);
  let msg = '';
  try { await q(`select admin_set_role('${U.alumni}', 'admin')`); } catch (e) { msg = e.message; }
  if (!/두 명/.test(msg)) throw new Error('세 번째 관리자가 만들어짐');
}, { aal: 'aal2' }));
await denied('내 등급은 내가 못 바꿈', () => as('admin', q => q(`select admin_set_role('${U.admin}', 'member')`), { aal: 'aal2' }), /다른 관리자/);
await ok('잠근 회원은 아무 글도 못 봄', async () => {
  await as('admin', q => q(`select admin_set_status('${U.alumni}', 'locked')`), { aal: 'aal2', keep: true });
  await as('alumni', async q => eq(await n(q, 'select count(*) n from posts'), 0, '잠긴 회원이 보는 글'));
  await as('admin', q => q(`select admin_set_status('${U.alumni}', 'active')`), { aal: 'aal2', keep: true });
});
await ok('가입 거절하면 계정이 지워짐', () => as('admin', async q => {
  await db.query('select 1');
  await q(`select admin_reject('${U.pending}')`);
  eq(await n(q, `select count(*) n from admin_list_profiles() where id = '${U.pending}'`), 0, '남은 신청');
}, { aal: 'aal2' }));

console.log('가입 · 옮겨 온 회원');
await ok('가입 신청은 승인 대기로 들어가고, 화면이 보낸 등급은 무시', async () => {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ('66666666-6666-4666-8666-666666666666', 'x@example.test', '{"username":"hacker1","display_name":"해커","role":"admin"}')`);
  const r = await db.query(`select role, status from profiles where id = '66666666-6666-4666-8666-666666666666'`);
  eq(r.rows[0].role, 'pending', '등급'); eq(r.rows[0].status, 'active', '상태');
});
await denied('규칙에 안 맞는 아이디로는 가입 못 함', () => db.query(`insert into auth.users (email, raw_user_meta_data) values ('y@example.test', '{"username":"A B<script>","display_name":"x"}')`), /아이디는/);
await ok('옮겨 온 회원은 비밀번호를 정하기 전에는 등급이 없음', () => as('old', async q => eq(await n(q, 'select count(*) n from posts'), 0, '글')));
await ok('비밀번호를 정하면 정상 회원이 됨', async () => {
  await db.query(`update auth.users set encrypted_password = extensions.crypt('New-pass-2026', extensions.gen_salt('bf')) where id = '${U.old}'`);
  await as('old', async q => eq(await n(q, 'select count(*) n from posts'), 5 - 1, '글(숨긴 글 빼고)'));
});
await ok('아이디로 메일 찾기는 비밀 열쇠(서버 함수)만', () => as('service_role', async q => {
  eq((await q(`select login_email_for('TEST_ADMIN') as e`)).rows[0].e, 'admin@example.test', '메일');
}));
// 새 메일로 가입 신청(11-02, 20261102020000_old_username_claim.sql): 적은 예전 아이디는 신청 줄에만 남고 관리자 목록에서만 보인다
await ok('가입 신청서의 예전 아이디는 빈칸을 떼고 40자까지 남음', async () => {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ('77777777-7777-4777-8777-777777777777', 'z@example.test', '{"username":"oldfresh1","display_name":"옛회원","old_username":" test_old member "}')`);
  eq((await db.query(`select old_username from profiles where id = '77777777-7777-4777-8777-777777777777'`)).rows[0].old_username, 'test_oldmember', '예전 아이디');
});
await ok('관리자 목록에 예전 아이디가 보임', () => as('admin', async q => {
  eq((await q(`select old_username from admin_list_profiles() where id = '77777777-7777-4777-8777-777777777777'`)).rows[0].old_username, 'test_oldmember', '예전 아이디');
}, { aal: 'aal2' }));
await denied('회원은 예전 아이디 칸을 바로 못 읽음', () => as('member', q => q('select old_username from profiles')), /permission denied/);

// 구성원 CV 주소(20261027010000_member_cv.sql): 본인만 적고, 공개 목록에는 정상 회원의 이름 · 주소만 나온다
console.log('CV 주소(구성원 화면)');
await ok('회원은 자기 CV 주소를 적고 내 정보에서 봄', () => as('member', async q => {
  eq((await q(`update profiles set cv_url = 'https://example.com/cv' where id = '${U.member}'`)).affectedRows, 1, '내 줄');
  eq((await q('select cv_url from my_profile()')).rows[0].cv_url, 'https://example.com/cv', '내 정보');
}));
await denied('https 가 아닌 주소는 못 적음', () => as('member', q => q(`update profiles set cv_url = 'javascript:alert(1)' where id = '${U.member}'`)), /check constraint/);
await ok('남의 CV 주소는 못 고침(0줄)', () => as('member', async q => {
  eq((await q(`update profiles set cv_url = 'https://example.com/x' where id = '${U.alumni}'`)).affectedRows, 0, '남의 줄');
}));
await ok('승인 대기는 자기 CV 주소도 못 적음(0줄)', () => as('pending', async q => {
  eq((await q(`update profiles set cv_url = 'https://example.com/p' where id = '${U.pending}'`)).affectedRows, 0, '내 줄');
}));
await denied('방문자는 회원 표의 CV 칸을 바로 못 읽음', () => as('anon', q => q('select cv_url from profiles')), /permission denied/);
await ok('공개 목록은 방문자도 읽고, 구성원 카드와 이어진 정상 회원의 번호 · 주소만 나옴(10-28: 이름 대신 번호)', async () => {
  await db.query(`update profiles set cv_url = 'https://example.com/m', person_no = 7 where id = $1`, [U.member]);
  await db.query(`update profiles set cv_url = 'https://example.com/a', status = 'locked', person_no = 8 where id = $1`, [U.alumni]);
  await db.query(`update profiles set cv_url = 'https://example.com/p' where id = $1`, [U.pending]);
  await db.query(`update profiles set cv_url = 'https://example.com/x' where id = $1`, [U.admin]);   // 카드와 안 이어짐 → 안 나옴
  try {
    const rows = (await as('anon', q => q('select * from public_member_cv()'))).rows;
    eq(JSON.stringify(rows), JSON.stringify([{ person_no: 7, cv_url: 'https://example.com/m', cv_public: true }]), '공개 목록');
  } finally {
    await db.query(`update profiles set cv_url = null, status = 'active', person_no = null where id = $1`, [U.alumni]);
    await db.query(`update profiles set cv_url = null where id in ($1, $2)`, [U.pending, U.admin]);
    await db.query(`update profiles set person_no = null where id = $1`, [U.member]);
  }
});
// 11-02 내 정보: CV 공개 끄기(승인 없음) · 카드 사진 · 관심 분야 요청(조교 승인)
await ok('CV 공개를 끄면 공개 목록에 주소 없이 번호와 "끔"만 나옴(표의 CV 도 숨기게)', async () => {
  const before = (await db.query(`select cv_url from profiles where id = $1`, [U.member])).rows[0].cv_url;   // 뒤 시험(CV 지우기)이 쓰므로 되돌려 둔다
  await db.query(`update profiles set cv_url = 'https://example.com/m', person_no = 7 where id = $1`, [U.member]);
  try {
    await as('member', async q => eq((await q(`update profiles set cv_public = false where id = '${U.member}'`)).affectedRows, 1, '내 줄'), { keep: true });
    eq((await as('member', q => q('select cv_public from my_profile()'))).rows[0].cv_public, false, '내 정보');
    const rows = (await as('anon', q => q('select * from public_member_cv()'))).rows;
    eq(JSON.stringify(rows), JSON.stringify([{ person_no: 7, cv_url: null, cv_public: false }]), '공개 목록');
  } finally {
    await db.query(`update profiles set cv_url = $2, cv_public = true, person_no = null where id = $1`, [U.member, before]);
  }
});
await ok('남의 CV 공개는 못 바꿈', () => as('member', async q => {
  eq((await q(`update profiles set cv_public = false where id = '${U.alumni}'`)).affectedRows, 0, '남의 줄');
}));
await ok('카드와 안 이어진 회원도 요청을 냄(관리자 목록에는 이어진 카드 없음으로 보임)', async () => {
  try {
    await as('member', q => q(`select request_profile_change('interest', '보건정책', null)`), { keep: true });
    const list = (await as('admin', q => q('select person_no, member_kind, kind from admin_list_profile_requests()'), { aal: 'aal2' })).rows;
    eq(JSON.stringify(list), JSON.stringify([{ person_no: null, member_kind: '재학', kind: 'interest' }]), '관리자 목록');
  } finally {
    await db.query(`delete from profile_requests`);
  }
});
await ok('교수 구분 회원은 요청을 못 냄', async () => {
  const before = (await db.query(`select kind from profiles where id = $1`, [U.member])).rows[0].kind;
  await db.query(`update profiles set kind = '교수' where id = $1`, [U.member]);
  try {
    await denied('교수 요청', () => as('member', q => q(`select request_profile_change('interest', '보건정책', null)`)), /교수님 소개는/);
  } finally {
    await db.query(`update profiles set kind = $2 where id = $1`, [U.member, before]);
  }
});
await denied('승인 대기는 요청을 못 냄', () => as('pending', q => q(`select request_profile_change('interest', '보건정책', null)`)), /승인된 회원만/);
await denied('회원은 요청 표를 바로 못 씀', () => as('member', q => q(`insert into profile_requests (user_id, kind, interest) values ('${U.member}', 'interest', 'x')`)), /permission denied/);
// 11-02 저녁: 관심 분야는 키워드 5개까지, 하나에 30자까지
await denied('키워드 6개는 못 보냄', () => as('member', q => q(`select request_profile_change('interest', 'a · b · c · d · e · f', null)`)), /5개까지/);
await denied('31자 키워드는 못 보냄', () => as('member', q => q(`select request_profile_change('interest', '보건 · ${'가'.repeat(31)}', null)`)), /1~30자/);
await denied('빈 키워드는 못 보냄', () => as('member', q => q(`select request_profile_change('interest', '보건 ·  · 재정', null)`)), /1~30자/);
await ok('관심 분야 요청: 다시 보내면 앞 요청은 취소, 관리자 승인 · 기록', async () => {
  await db.query(`update profiles set person_no = 7 where id = $1`, [U.member]);
  try {
    await as('member', async q => {
      await q(`select request_profile_change('interest', '  보건  재정 ', null)`);
      await q(`select request_profile_change('interest', '보건정책, 건강보험', null)`);
    }, { keep: true });
    const mine = (await as('member', q => q('select * from my_profile_requests()'))).rows;
    eq(mine.length, 1, '내 요청 수');
    eq(mine[0].interest, '보건정책 · 건강보험', '마지막 글(쉼표도 \' · \'로 맞춤)');
    eq(mine[0].status, 'pending', '상태');
    await denied('2단계 인증 전 관리자는 요청 목록을 못 봄', () => as('admin', q => q('select * from admin_list_profile_requests()')), /2단계/);
    const list = (await as('admin', q => q('select * from admin_list_profile_requests()'), { aal: 'aal2' })).rows;
    eq(list.length, 1, '기다리는 요청');
    eq(list[0].person_no, 7, '이어진 카드');
    await denied('회원은 결정을 못 함', () => as('member', q => q(`select admin_decide_profile_request(${list[0].id}, 'approved', '')`)), /관리자만/);
    await as('admin', q => q(`select admin_decide_profile_request(${list[0].id}, 'approved', '')`), { aal: 'aal2', keep: true });
    eq((await as('member', q => q('select status from my_profile_requests()'))).rows[0].status, 'approved', '승인됨');
    eq(await n((sql, params) => db.query(sql, params), `select count(*) n from admin_log where action = '관심 분야 요청 승인'`), 1, '기록');
    await denied('한 번 정한 요청은 다시 못 정함', () => as('admin', q => q(`select admin_decide_profile_request(${list[0].id}, 'rejected', '')`), { aal: 'aal2' }), /이미 처리/);
  } finally {
    await db.query(`delete from profile_requests`);
    await db.query(`update profiles set person_no = null where id = $1`, [U.member]);
  }
});
await ok('사진 요청: 내 폴더에 올린 파일만, 돌려보내면 까닭이 내 정보에 보임', async () => {
  await db.query(`update profiles set person_no = 7 where id = $1`, [U.member]);
  try {
    await as('member', q => q(`insert into storage.objects (bucket_id, name) values ('profile-photos', '${U.member}/p1.jpg')`), { keep: true });
    await denied('남의 폴더 사진으로는 요청 못 함', () => as('member', q => q(`select request_profile_change('photo', null, '${U.admin}/p1.jpg')`)), /사진을 찾지/);
    await denied('올리지 않은 사진으로는 요청 못 함', () => as('member', q => q(`select request_profile_change('photo', null, '${U.member}/none.jpg')`)), /사진을 찾지/);
    await denied('남의 폴더에는 사진을 못 올림', () => as('member', q => q(`insert into storage.objects (bucket_id, name) values ('profile-photos', '${U.admin}/x.jpg')`)), /row-level security/);
    const id = (await as('member', q => q(`select request_profile_change('photo', null, '${U.member}/p1.jpg') id`), { keep: true })).rows[0].id;
    eq(await n((sql, params) => db.query(sql, params), `select count(*) n from storage.objects where bucket_id = 'profile-photos'`), 1, '올린 사진');
    await as('alumni', async q => eq(await n(q, `select count(*) n from storage.objects where bucket_id = 'profile-photos'`), 0, '다른 회원이 보는 사진'));
    await as('admin', async q => eq(await n(q, `select count(*) n from storage.objects where bucket_id = 'profile-photos'`), 1, '관리자가 보는 사진'), { aal: 'aal2' });
    await as('admin', q => q(`select admin_decide_profile_request(${id}, 'rejected', '정면 사진으로 다시 보내 주십시오')`), { aal: 'aal2', keep: true });
    const r = (await as('member', q => q(`select status, reason from my_profile_requests() where kind = 'photo'`))).rows[0];
    eq(r.status + ' / ' + r.reason, 'rejected / 정면 사진으로 다시 보내 주십시오', '돌려받음');
  } finally {
    await db.query(`delete from profile_requests`);
    await db.query(`delete from storage.objects where bucket_id = 'profile-photos'`);
    await db.query(`update profiles set person_no = null where id = $1`, [U.member]);
  }
});
await denied('관리자도 2단계 인증 전에는 CV 주소를 못 지움', () => as('admin', q => q(`select admin_clear_cv('${U.member}')`)), /2단계/);
await ok('2단계 인증 뒤 CV 주소를 지우고 기록 남음', () => as('admin', async q => {
  await q(`select admin_clear_cv('${U.member}')`);
  eq((await q(`select cv_url from admin_list_profiles() where id = '${U.member}'`)).rows[0].cv_url, null, '지운 뒤');
  eq(await n(q, `select count(*) n from admin_log where action = 'CV 주소 지움'`), 1, '기록');
}, { aal: 'aal2' }));
await db.query(`update profiles set cv_url = null where id = $1`, [U.member]);


// 관리 화면 · 가입 흐름(20261028000000_admin_join.sql)
console.log('관리 화면 · 가입(10-28)');
const NEWU = 'a1a1a1a1-1028-4000-8000-000000000001', NEWU2 = 'a1a1a1a1-1028-4000-8000-000000000002';
await ok('재학생 가입 신청에 과정 · 입학 연도 · 메일 공개 동의가 들어가고 등급은 승인 대기', async () => {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'j1@example.test', $2)`,
    [NEWU, JSON.stringify({ username: 'test_join1', display_name: '새학생', kind: '재학', course: '석사과정', entry_year: '2027', show_email: 'true', role: 'admin' })]);
  const r = (await db.query(`select role, status, course, entry_year, show_email from profiles where id = $1`, [NEWU])).rows[0];
  eq(JSON.stringify(r), JSON.stringify({ role: 'pending', status: 'active', course: '석사과정', entry_year: 2027, show_email: true }), '신청');
});
await ok('재학이 아니면 과정 · 메일 공개는 버림, 메일 공개는 "true"일 때만 켜짐', async () => {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'j2@example.test', $2)`,
    [NEWU2, JSON.stringify({ username: 'test_join2', display_name: '졸업생', kind: '졸업', course: '박사과정', show_email: 'true' })]);
  const r = (await db.query(`select course, show_email from profiles where id = $1`, [NEWU2])).rows[0];
  eq(JSON.stringify(r), JSON.stringify({ course: null, show_email: false }), '졸업 신청');
  await db.query(`delete from auth.users where id in ($1, $2)`, [NEWU, NEWU2]);
});

await ok('방문자는 본인 확인 요청을 보냄', () => as('anon', q => q(
  `select submit_help_request('옛회원', 'Old.Person@example.test', '졸업', '박사', '2012', '메일이 바뀌었습니다')`), { keep: true }));
await denied('방문자는 요청 표를 못 읽음', () => as('anon', q => q('select * from help_requests')), /permission denied/);
await denied('회원도 요청 표를 바로 못 읽음', () => as('member', q => q('select * from help_requests')), /permission denied/);
await denied('회원은 요청 목록 함수를 못 씀', () => as('member', q => q('select * from admin_list_help()')), /관리자만/);
await denied('관리자도 2단계 인증 전에는 요청 목록을 못 봄', () => as('admin', q => q('select * from admin_list_help()')), /2단계/);
await ok('2단계 인증 뒤 요청을 보고(메일은 소문자로) 처리하면 기록이 남음', () => as('admin', async q => {
  const r = (await q('select * from admin_list_help()')).rows;
  eq(r.length, 1, '요청 수'); eq(r[0].email, 'old.person@example.test', '메일'); eq(r[0].over_limit, false, '많음 표시');
  await q(`select admin_close_help($1, '전화로 확인')`, [r[0].id]);
  eq((await q('select status from admin_list_help()')).rows[0].status, 'done', '처리');
  eq(await n(q, `select count(*) n from admin_log where action = '본인 확인 요청 처리'`), 1, '기록');
}, { aal: 'aal2' }));
await ok('같은 메일은 하루 세 번까지', async () => {
  await as('anon', q => q(`select submit_help_request('가', 'old.person@example.test', '졸업', '', '', '')`), { keep: true });
  await as('anon', q => q(`select submit_help_request('가', 'old.person@example.test', '졸업', '', '', '')`), { keep: true });
});
await denied('같은 메일 넷째 요청은 막힘', () => as('anon', q => q(`select submit_help_request('가', 'OLD.person@example.test', '졸업', '', '', '')`)), /세 번/);
await denied('메일 모양이 아니면 막힘', () => as('anon', q => q(`select submit_help_request('가', 'not-mail', '졸업', '', '', '')`)), /check constraint/);
await denied('201자 넘는 말은 막힘', () => as('anon', q => q(`select submit_help_request('가', 'a@example.test', '졸업', '', '', $1)`, ['가'.repeat(201)])), /check constraint/);
await ok('하루 전체 30건을 넘으면 받되 "많음" 표시', async () => {
  for (let i = 0; i < 30; i++) await db.query(`insert into help_requests (name, email) values ('봇', $1)`, [`bot${i}@example.test`]);
  await as('anon', q => q(`select submit_help_request('사람', 'real@example.test', '졸업', '', '', '')`), { keep: true });
  eq((await db.query(`select over_limit from help_requests where email = 'real@example.test'`)).rows[0].over_limit, true, '많음 표시');
  await db.query(`delete from help_requests`);
});
await ok('30일 지난 요청은 지움', async () => {
  await db.query(`insert into help_requests (name, email, created_at) values ('옛', 'x@example.test', now() - interval '31 days'), ('새', 'y@example.test', now())`);
  eq((await db.query('select private.delete_old_help() n')).rows[0].n, 1, '지운 수');
  await db.query(`delete from help_requests`);
});

await denied('회원은 남의 구분을 못 바꿈', () => as('member', q => q(`select admin_set_kind('${U.alumni}', '재학')`)), /관리자만/);
await denied('구분은 네 가지만', () => as('admin', q => q(`select admin_set_kind('${U.member}', '학부')`), { aal: 'aal2' }), /구분은/);
await ok('관리자가 구분을 바꾸면 기록에 전 → 후', () => as('admin', async q => {
  await q(`select admin_set_kind('${U.member}', '졸업')`);
  eq((await q(`select kind from admin_list_profiles() where id = '${U.member}'`)).rows[0].kind, '졸업', '구분');
  eq((await q(`select detail from admin_log where action = '구분 바꿈'`)).rows[0].detail, '재학 → 졸업', '기록');
}, { aal: 'aal2' }));
await ok('구성원 카드 잇기 · 끊기(번호), 같은 카드를 두 회원에 못 이음', () => as('admin', async q => {
  await q(`select admin_link_person('${U.member}', 12)`);
  eq((await q(`select person_no from admin_list_profiles() where id = '${U.member}'`)).rows[0].person_no, 12, '이음');
  let blocked = false;
  try { await q('savepoint s'); await q(`select admin_link_person('${U.alumni}', 12)`); } catch (e) { blocked = /다른 회원/.test(e.message); await q('rollback to savepoint s'); }
  eq(blocked, true, '겹침 막힘');
  await q(`select admin_link_person('${U.member}', null)`);
  eq((await q(`select person_no from admin_list_profiles() where id = '${U.member}'`)).rows[0].person_no, null, '끊음');
}, { aal: 'aal2' }));
await denied('회원은 구성원 카드 번호를 직접 못 바꿈', () => as('member', q => q(`update profiles set person_no = 3 where id = '${U.member}'`)), /permission denied/);
await ok('관리자는 회원 메일을 봄', () => as('admin', async q => eq((await q(`select admin_member_email('${U.member}') m`)).rows[0].m, 'member@example.test', '메일'), { aal: 'aal2' }));
await denied('회원은 남의 메일을 못 봄', () => as('member', q => q(`select admin_member_email('${U.alumni}')`)), /관리자만/);
await ok('탈퇴 요청 취소', async () => {
  await db.query(`update profiles set withdraw_requested_at = now() where id = $1`, [U.alumni]);
  await as('admin', q => q(`select admin_cancel_withdraw('${U.alumni}')`), { aal: 'aal2' , keep: true });
  eq((await db.query(`select withdraw_requested_at w from profiles where id = $1`, [U.alumni])).rows[0].w, null, '요청');
});

await denied('나에게는 못 넘김', () => as('admin', q => q(`select admin_handover('${U.admin}')`), { aal: 'aal2' }), /나에게는/);
await denied('승인 대기에게는 못 넘김', () => as('admin', q => q(`select admin_handover('${U.pending}')`), { aal: 'aal2' }), /정상 회원/);
await ok('넘기기 시작: 받는 사람은 바로 관리자, 나는 넘기는 중', async () => {
  await as('admin', q => q(`select admin_handover('${U.member}')`), { aal: 'aal2', keep: true });
  const r = (await db.query(`select id, role, leaving_to from profiles where id in ($1, $2) order by id`, [U.admin, U.member])).rows;
  eq(r[0].role + '/' + r[0].leaving_to, 'admin/' + U.member, '넘기는 사람');
  eq(r[1].role, 'admin', '받는 사람');
});
await denied('넘기는 중인 사람은 등급 바꾸기로 못 바꿈', () => as('member', q => q(`select admin_set_role('${U.admin}', 'member')`), { aal: 'aal2' }), /넘기는 중/);
await denied('받은 사람도 2단계 인증 전에는 넘기기를 못 끝냄', () => as('member', q => q('select admin_finish_handover()')), /2단계/);
await ok('받은 사람이 2단계 인증으로 들어오면 넘긴 사람은 회원', async () => {
  const r = await as('member', q => q('select admin_finish_handover() n'), { aal: 'aal2', keep: true });
  eq(r.rows[0].n, 1, '끝낸 수');
  eq((await db.query(`select role, leaving_to from profiles where id = $1`, [U.admin])).rows[0].role, 'member', '넘긴 사람');
  await db.query(`update profiles set role = 'admin' where id = $1`, [U.admin]);
  await db.query(`update profiles set role = 'member' where id = $1`, [U.member]);
});
await ok('넘기기 취소: 받는 사람은 다시 회원', async () => {
  await as('admin', q => q(`select admin_handover('${U.member}')`), { aal: 'aal2', keep: true });
  await as('admin', q => q('select admin_cancel_handover()'), { aal: 'aal2', keep: true });
  const r = (await db.query(`select role, leaving_to from profiles where id in ($1, $2) order by id`, [U.admin, U.member])).rows;
  eq(JSON.stringify(r), JSON.stringify([{ role: 'admin', leaving_to: null }, { role: 'member', leaving_to: null }]), '되돌림');
});
await denied('관리자도 관리 기록에 직접 못 씀(사이트 내용 고침은 서버 도우미만)', () => as('admin', q => q(
  `insert into admin_log (action, target, changes) values ('사이트 내용 고침', 'people', '{}')`), { aal: 'aal2' }), /permission denied|row-level security/);
await ok('서버 도우미(비밀 열쇠)는 사이트 내용 고침 기록을 씀', () => as('service_role', async q => {
  await q(`insert into admin_log (action, target, changes, publish_state) values ('사이트 내용 고침', 'data/people.csv', '{"notes":["구성원 더함: 가"]}', 'waiting')`);
}));
await denied('방문자 · 회원은 메일 한도 · 메일로 계정 찾기를 못 부름', () => as('anon', q => q(`select take_mail_quota('x')`)), /permission denied/);
await denied('회원도 메일로 계정 찾기를 못 부름', () => as('member', q => q(`select * from account_for_email('admin@example.test')`)), /permission denied/);
await ok('메일 한도: 같은 계정 10분 안에 두 번째는 막힘, 전체 한 시간 20통', () => as('service_role', async q => {
  eq((await q(`select take_mail_quota('k1') ok`)).rows[0].ok, true, '첫 번째');
  eq((await q(`select take_mail_quota('k1') ok`)).rows[0].ok, false, '10분 안 두 번째');
  for (let i = 2; i <= 20; i++) await q(`select take_mail_quota('k${i}')`);
  eq((await q(`select take_mail_quota('k21') ok`)).rows[0].ok, false, '한 시간 21통째');
}));
await ok('서버 도우미는 메일로 계정을 찾음(가입 신청 메일 겹침)', () => as('service_role', async q => {
  eq((await q(`select username from account_for_email(' ADMIN@example.test ')`)).rows[0].username, 'test_admin', '아이디');
}));
await ok('하루 전체 100건이면 그날은 본인 확인 요청을 안 받음', async () => {
  for (let i = 0; i < 100; i++) await db.query(`insert into help_requests (name, email) values ('봇', $1)`, [`flood${i}@example.test`]);
  let refused = false;
  try { await as('anon', q => q(`select submit_help_request('사람', 'late@example.test', '졸업', '', '', '')`)); } catch (e) { refused = /많아/.test(e.message); }
  await db.query(`delete from help_requests`);
  eq(refused, true, '101번째 거절');
});

console.log('옛 비밀번호 그대로 쓰기(11-13, migrations/20261113000000_legacy_password.sql)');
const LEGACY = '$P$984478476IagS59wHZvyQMArzfx58u.';   // hashcat 공개 예시 값(비밀번호 'hashcat'). 진짜 회원 값 아님
const legacyFor = async (q, login) => (await q(`select hash from legacy_password_for($1)`, [login])).rows.length;
// 옛 회원(test_oldmember)은 위 '가입 · 옮겨 온 회원'에서 비밀번호를 정했으므로, 이 거래 안에서만 '정하기 전'으로 되돌리고 옛 값을 넣는다
async function oldWithLegacy(q) {
  await q('reset role');
  await q(`update profiles set status = 'needs_password' where id = $1`, [U.old]);
  await q('set local role service_role');
  await q(`insert into legacy_passwords (user_id, hash) values ($1, $2)`, [U.old, LEGACY]);
}
await denied('방문자는 옛 값 표를 못 읽음', () => as('anon', q => q('select * from legacy_passwords')), /permission denied/);
await denied('회원은 옛 값 표를 못 읽음', () => as('member', q => q('select * from legacy_passwords')), /permission denied/);
await denied('관리자(2단계 인증)도 옛 값 표를 바로 못 읽음', () => as('admin', q => q('select * from legacy_passwords'), { aal: 'aal2' }), /permission denied/);
await denied('회원은 틀린 횟수 기록을 못 읽음', () => as('member', q => q('select * from legacy_login_failures')), /permission denied/);
await denied('회원은 옛 값 찾기 함수를 못 부름', () => as('member', q => q(`select * from legacy_password_for('test_oldmember')`)), /permission denied/);
await denied('방문자는 옛 값으로 비밀번호 저장 함수를 못 부름', () => as('anon', q => q(`select legacy_login_finish('${U.old}', 'x')`)), /permission denied/);
await denied('옛 값 모양($P$ · $H$ 34자)이 아니면 표에 안 들어감', () => as('service_role', q => q(
  `insert into legacy_passwords (user_id, hash) values ($1, 'plain-text')`, [U.old])), /check constraint/);
await ok('서버 도우미: 아이디 · 메일로 찾고, 맞으면 새 방식(bcrypt)으로 저장 · 정상 상태 · 옛 값 지움', () => as('service_role', async q => {
  await oldWithLegacy(q);
  eq(await legacyFor(q, ' TEST_OLDMEMBER '), 1, '아이디로 찾음');
  eq(await legacyFor(q, 'Old@example.test'), 1, '메일로 찾음');
  eq(await legacyFor(q, 'test_member'), 0, '옛 값 없는 회원');
  eq((await q(`select legacy_login_finish($1, 'hashcat') ok`, [U.old])).rows[0].ok, true, '저장');
  await q('reset role');
  const r = (await q(`select u.encrypted_password = extensions.crypt('hashcat', u.encrypted_password) good, left(u.encrypted_password, 4) kind, p.status
                      from auth.users u join profiles p on p.id = u.id where u.id = $1`, [U.old])).rows[0];
  eq(r.good, true, '새 값으로 같은 비밀번호 확인'); eq(r.kind, '$2a$', '값 종류'); eq(r.status, 'active', '상태');
  eq(Number((await q('select count(*) n from legacy_passwords')).rows[0].n), 0, '남은 옛 값');
  await q('set local role service_role');
  eq(await legacyFor(q, 'test_oldmember'), 0, '정상 회원은 더 안 찾음');
  eq((await q(`select legacy_login_finish($1, 'hashcat') ok`, [U.old])).rows[0].ok, false, '두 번째 저장');
}));
await ok('틀린 횟수: 같은 계정 15분에 5번이면 그 뒤로는 찾아 주지 않음, 15분 지나면 다시', () => as('service_role', async q => {
  await oldWithLegacy(q);
  for (let i = 0; i < 4; i++) await q(`select legacy_login_failed($1)`, [U.old]);
  eq(await legacyFor(q, 'test_oldmember'), 1, '4번 틀린 뒤');
  await q(`select legacy_login_failed($1)`, [U.old]);
  eq(await legacyFor(q, 'test_oldmember'), 0, '5번 틀린 뒤');
  await q(`update legacy_login_failures set created_at = now() - interval '16 minutes'`);
  eq(await legacyFor(q, 'test_oldmember'), 1, '15분 뒤');
}));
await ok('틀린 횟수: 전체 한 시간 100번이면 모든 계정을 멈춤', () => as('service_role', async q => {
  await oldWithLegacy(q);
  await q(`insert into legacy_login_failures (user_id) select $1::uuid from generate_series(1, 100)`, [U.member]);
  eq(await legacyFor(q, 'test_oldmember'), 0, '다른 계정');
}));
await ok('메일 링크로 비밀번호를 정해도 옛 값이 지워짐', () => as('service_role', async q => {
  await oldWithLegacy(q);
  await q('reset role');
  await q(`update auth.users set encrypted_password = 'set-by-link' where id = $1`, [U.old]);
  eq(Number((await q('select count(*) n from legacy_passwords')).rows[0].n), 0, '남은 옛 값');
}));
await ok('카드 번호는 표의 가장 큰 번호보다 크고, 한 번 준 번호는 다시 안 줌', () => as('admin', async q => {
  const a = (await q(`select * from admin_reserve_person_nos(2, 47) n`)).rows.map(r => r.n);
  eq(JSON.stringify(a), '[48,49]', '처음 둘');
  const b = (await q(`select * from admin_reserve_person_nos(1, 10) n`)).rows.map(r => r.n);
  eq(JSON.stringify(b), '[50]', '표 번호가 작아져도 앞으로만');
}, { aal: 'aal2', keep: true }));
await denied('회원은 카드 번호를 못 받음', () => as('member', q => q(`select * from admin_reserve_person_nos(1, 1)`)), /관리자만/);
await ok('카드를 빼면 그 번호와 이어진 회원 연결을 끊고 기록', async () => {
  await db.query(`update profiles set person_no = 7 where id = $1`, [U.member]);
  const r = await as('admin', q => q(`select admin_unlink_person_nos(array[7, 99]) n`), { aal: 'aal2', keep: true });
  eq(r.rows[0].n, 1, '끊은 수');
  eq((await db.query(`select person_no from profiles where id = $1`, [U.member])).rows[0].person_no, null, '끊김');
});
await ok('관리자가 둘이면 다른 관리자를 회원으로 내릴 수 있음(잠근 뒤 내가 관리자인지 다시 봄)', async () => {
  await db.query(`update profiles set role = 'admin' where id = $1`, [U.alumni]);
  await as('admin', q => q(`select admin_set_role('${U.alumni}', 'member')`), { aal: 'aal2', keep: true });
  eq((await db.query(`select role from profiles where id = $1`, [U.alumni])).rows[0].role, 'member', '내림');
});
await db.query(`update profiles set kind = '재학' where id = $1`, [U.member]);

// 올리기 설정 다섯 가지(20261102010000_post_settings.sql)
console.log('올리기 설정(11-02: 태그 · 대표 사진 · 공개 범위 · 댓글 허용 · 고정)');
const made = [];   // 끝에 지울 글
const keepPost = async (who, sql, params, aal) => {
  const id = (await as(who, q => q(sql, params), { keep: true, aal: aal || 'aal1' })).rows[0].id;
  made.push(id); return id;
};
const addPic = async (who, postId, path) => {
  await as(who, q => q(`insert into storage.objects (bucket_id, name) values ('gallery', $1)`, [path]), { keep: true });
  await as(who, q => q(`insert into attachments (post_id, bucket, path, original_name, mime, size_bytes) values ($1, 'gallery', $2, '그림.jpg', 'image/jpeg', 100)`, [postId, path]), { keep: true });
};
try {
  // 관리자만 글: 글쓴이 · 관리자만 읽고, 그 글의 댓글 · 첨부 · 파일 칸 그림도 다른 회원에게 안 보임
  const secret = await keepPost('member', `insert into posts (board, title, visibility) values ('free', '관리자만 보는 글', 'admins') returning id`);
  await addPic('member', secret, `${U.member}/secret.jpg`);
  await as('member', q => q(`insert into comments (post_id, body) values ($1, '글쓴이 댓글')`, [secret]), { keep: true });
  await ok('관리자만 글: 다른 회원은 글 · 목록 · 댓글 · 첨부 · 그림 모두 못 봄', () => as('alumni', async q => {
    eq(await n(q, 'select count(*) n from posts where id = $1', [secret]), 0, '글');
    eq(await n(q, 'select count(*) n from post_list where id = $1', [secret]), 0, '목록');
    eq(await n(q, 'select count(*) n from comments where post_id = $1', [secret]), 0, '댓글');
    eq(await n(q, 'select count(*) n from attachments where post_id = $1', [secret]), 0, '첨부');
    eq(await n(q, `select count(*) n from storage.objects where name = $1`, [`${U.member}/secret.jpg`]), 0, '파일 칸 그림');
  }));
  await denied('관리자만 글: 다른 회원은 댓글도 못 닮', () => as('alumni', q => q(`insert into comments (post_id, body) values ($1, '댓글')`, [secret])), /row-level security/);
  await ok('관리자만 글: 글쓴이는 읽음(목록에 관리자만 표시)', () => as('member', async q => {
    eq(await n(q, `select count(*) n from post_list where id = $1 and visibility = 'admins'`, [secret]), 1, '목록');
  }));
  await ok('관리자만 글: 관리자도 2단계 인증 전에는 못 읽음(보안 검토 11-02)', () => as('admin', async q => {
    eq(await n(q, 'select count(*) n from posts where id = $1', [secret]), 0, '글');
    eq(await n(q, 'select count(*) n from comments where post_id = $1', [secret]), 0, '댓글');
  }));
  await ok('관리자만 글: 2단계 인증 관리자는 글 · 댓글 · 그림을 읽음', () => as('admin', async q => {
    eq(await n(q, 'select count(*) n from posts where id = $1', [secret]), 1, '글');
    eq(await n(q, 'select count(*) n from comments where post_id = $1', [secret]), 1, '댓글');
    eq(await n(q, `select count(*) n from storage.objects where name = $1`, [`${U.member}/secret.jpg`]), 1, '그림');
  }, { aal: 'aal2' }));
  await denied('공개 범위에 모르는 값은 거절', () => as('member', q => q(`insert into posts (board, title, visibility) values ('free', 'x', 'everyone')`)), /check constraint/);

  // 댓글 막힌 글
  const closed = await keepPost('member', `insert into posts (board, title, allow_comments) values ('free', '댓글 받지 않는 글', false) returning id`);
  await denied('댓글 막힌 글: 글쓴이도 댓글을 못 닮', () => as('member', q => q(`insert into comments (post_id, body) values ($1, '댓글')`, [closed])), /row-level security/);
  await denied('댓글 막힌 글: 다른 회원도 못 닮', () => as('alumni', q => q(`insert into comments (post_id, body) values ($1, '댓글')`, [closed])), /row-level security/);
  await denied('댓글 막힌 글: 관리자도 2단계 인증 전에는 못 닮', () => as('admin', q => q(`insert into comments (post_id, body) values ($1, '댓글')`, [closed])), /row-level security/);
  await ok('댓글 막힌 글: 2단계 인증 관리자는 닮 · 글은 모두에게 보임', async () => {
    await as('admin', q => q(`insert into comments (post_id, body) values ($1, '관리자 안내')`, [closed]), { aal: 'aal2' });
    await as('alumni', async q => eq(await n(q, 'select count(*) n from post_list where id = $1 and not allow_comments', [closed]), 1, '목록'));
  });

  // 위에 고정
  await denied('고정: 회원이 새 글을 고정으로 못 씀', () => as('member', q => q(`insert into posts (board, title, pinned) values ('free', 'x', true)`)), /관리자만/);
  await denied('고정: 회원이 내 글을 고정으로 못 바꿈', () => as('member', q => q(`update posts set pinned = true where id = $1`, [closed])), /관리자만/);
  await denied('고정: 관리자도 2단계 인증 전에는 못 켬', () => as('admin', q => q(`insert into posts (board, title, pinned) values ('free', 'x', true)`)), /관리자만/);
  await ok('고정: 2단계 인증 관리자는 켜고, 목록 맨 위에 옴', async () => {
    const pin = await keepPost('admin', `insert into posts (board, title, pinned) values ('free', '고정 공지', true) returning id`, [], 'aal2');
    await db.query(`update posts set created_at = now() - interval '300 days' where id = $1`, [pin]);   // 오래된 글이어도 맨 위
    await as('member', async q => {
      const top = (await q(`select id from post_list where board = 'free' order by pinned desc, created_at desc limit 1`)).rows[0].id;
      eq(top, pin, '맨 위 글');
    });
  });
  await ok('고정: 회원이 고정 안 바꾸고 제목만 고치는 것은 됨', () => as('member', async q => {
    eq((await q(`update posts set title = '제목만 고침' where id = $1`, [closed])).affectedRows, 1, '고친 줄');
  }));

  // 대표 사진
  const withPic = await keepPost('member', `insert into posts (board, title) values ('free', '사진 글') returning id`);
  await addPic('member', withPic, `${U.member}/cover1.jpg`);
  const other = await keepPost('member', `insert into posts (board, title) values ('free', '다른 사진 글') returning id`);
  await addPic('member', other, `${U.member}/cover2.jpg`);
  await denied('대표 사진: 남의 폴더 경로는 거절', () => as('member', q => q(`update posts set cover_path = $2 where id = $1`, [withPic, `${U.admin}/x.jpg`])), /대표 사진은/);
  await denied('대표 사진: 내 다른 글의 사진도 거절', () => as('member', q => q(`update posts set cover_path = $2 where id = $1`, [withPic, `${U.member}/cover2.jpg`])), /대표 사진은/);
  await denied('대표 사진: 그림 경로 모양이 아니면 거절', () => as('member', q => q(`update posts set cover_path = '../x' where id = $1`, [withPic])), /check constraint|대표 사진은/);   // 거절만 되면 됨(먼저 걸리는 규칙이 경로 모양 검사 또는 서버 확인)
  await ok('대표 사진: 이 글 사진은 됨, 목록 모아 보기에 나옴', () => as('member', async q => {
    await q(`update posts set cover_path = $2 where id = $1`, [withPic, `${U.member}/cover1.jpg`]);
    eq((await q('select cover_path from post_list where id = $1', [withPic])).rows[0].cover_path, `${U.member}/cover1.jpg`, '목록 그림');
  }));

  // 태그
  await ok('태그: 앞뒤 빈칸 · # 떼고 같은 것은 하나로', () => as('member', async q => {
    const r = await q(`insert into posts (board, title, tags) values ('free', '태그 글', $1) returning tags`, [['#정책', ' 정책 ', '보건 재정', '', '##보건 재정']]);
    eq(JSON.stringify(r.rows[0].tags), JSON.stringify(['정책', '보건 재정']), '태그');
  }));
  await denied('태그: 6개는 거절', () => as('member', q => q(`insert into posts (board, title, tags) values ('free', 'x', $1)`, [['a', 'b', 'c', 'd', 'e', 'f']])), /5개/);
  await denied('태그: 21자는 거절', () => as('member', q => q(`insert into posts (board, title, tags) values ('free', 'x', $1)`, [['가'.repeat(21)]])), /20자/);
  await ok('태그: 태그로 목록 거르기', () => as('alumni', async q => {
    await db.query('select 1');
    eq(await n(q, `select count(*) n from post_list where board = 'free' and tags @> array['없는태그']`), 0, '거른 글');
  }));
} finally {
  for (const id of made) await db.query('delete from posts where id = $1', [id]);
  await db.query(`delete from storage.objects where bucket_id = 'gallery' and name in ($1, $2, $3)`, [`${U.member}/secret.jpg`, `${U.member}/cover1.jpg`, `${U.member}/cover2.jpg`]);
}

console.log(`\n통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
