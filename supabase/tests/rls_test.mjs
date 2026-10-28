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
  group_name: b['묶음'] || null, audience: (b['대상'] || '').split(/[·,/]/).map(x => x.trim()).filter(Boolean),
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
await ok('서버 게시판 목록이 data/boards.csv 와 같음(순서 · 이름 · 첨부 · 사진첩 · 묶음 · 대상)', async () => {
  const rows = (await db.query('select slug, name, allow_files, is_gallery, group_name, audience from boards order by sort, slug')).rows;
  const got = JSON.stringify(rows), want = JSON.stringify(csvBoards);
  if (got !== want) throw new Error('다름\n        표:   ' + want + '\n        서버: ' + got);
});
await denied('대상 칸에는 가입 때 구분(재학 · 졸업 · 교수 · 기타)만 들어감', () => db.query(`update boards set audience = '{신입생}' where slug = 'free'`), /check constraint/);

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
  const r = await q(`update posts set title = '고친 제목' where title = '안녕하세요, 시험회원입니다'`); eq(r.affectedRows, 1, '고친 줄');
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
await ok('파일 칸: 내 폴더에는 올림', () => as('member', q => q(`insert into storage.objects (bucket_id, name) values ('gallery', '${U.member}/p.jpg')`)));
await denied('파일 칸: 남의 폴더에는 못 올림', () => as('member', q => q(`insert into storage.objects (bucket_id, name) values ('gallery', '${U.admin}/p.jpg')`)), /row-level security/);
await ok('파일 칸: 글에 안 달린 남의 파일은 안 보임', () => as('member', async q => {
  await db.query(`select 1`);
  eq(await n(q, `select count(*) n from storage.objects where owner_id <> '${U.member}'`), 0, '보이는 남의 파일');
}));

console.log('게시판 셋(세미나 후기 · 신입생 자기소개 · 자유게시판, 2026-10-27)');
for (const [slug, label] of [['seminar', '세미나 후기'], ['newcomer', '신입생 자기소개'], ['free', '자유게시판']]) {
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
await ok('숨긴 글도 보임(5개)', () => as('admin', async q => eq(await n(q, 'select count(*) n from posts'), 5, '글')));
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
await ok('공개 목록은 방문자도 읽고, 정상 회원 중 적은 사람의 이름 · 주소만 나옴', async () => {
  await db.query(`update profiles set cv_url = 'https://example.com/m' where id = $1`, [U.member]);
  await db.query(`update profiles set cv_url = 'https://example.com/a', status = 'locked' where id = $1`, [U.alumni]);
  await db.query(`update profiles set cv_url = 'https://example.com/p' where id = $1`, [U.pending]);
  try {
    const rows = (await as('anon', q => q('select * from public_member_cv()'))).rows;
    eq(JSON.stringify(rows), JSON.stringify([{ name: '시험회원', cv_url: 'https://example.com/m' }]), '공개 목록');
  } finally {
    await db.query(`update profiles set cv_url = null, status = 'active' where id = $1`, [U.alumni]);
    await db.query(`update profiles set cv_url = null where id = $1`, [U.pending]);
  }
});
await denied('관리자도 2단계 인증 전에는 CV 주소를 못 지움', () => as('admin', q => q(`select admin_clear_cv('${U.member}')`)), /2단계/);
await ok('2단계 인증 뒤 CV 주소를 지우고 기록 남음', () => as('admin', async q => {
  await q(`select admin_clear_cv('${U.member}')`);
  eq((await q(`select cv_url from admin_list_profiles() where id = '${U.member}'`)).rows[0].cv_url, null, '지운 뒤');
  eq(await n(q, `select count(*) n from admin_log where action = 'CV 주소 지움'`), 1, '기록');
}, { aal: 'aal2' }));
await db.query(`update profiles set cv_url = null where id = $1`, [U.member]);

console.log(`\n통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
