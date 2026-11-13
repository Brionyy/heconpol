// 관리 화면 표 부품(assets/js/lab/site-tables.js) 시험. 돌리기: node tests/site_tables_test.mjs (test_admin.py 가 부른다)
// 1) 지금 표 다섯 개가 칸 규칙을 모두 지키는가(관리 화면에서 저장해도 막히지 않음)
// 2) 읽고 그대로 다시 쓰면 글자 하나 안 바뀌는가, 한 줄만 고치면 그 줄만 바뀌는가(GitHub 판 기록이 깨끗하게)
// 3) 맞음 · 틀림 예(fixtures/rule_cases.json)를 build.py 와 같게 판단하는가
// 4) 더하기 · 고치기 · 빼기 · 순서 · 졸업생으로 옮기기 · 메일 숨기기 · 그 사이 남이 고친 경우
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
await import(join(site, 'assets/js/lab/site-tables.js'));
const T = globalThis.LabSiteTables;
const rules = JSON.parse(readFileSync(join(site, 'schema/tables.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  실패  ' + name + (extra ? '\n        ' + extra : '')); }
}
function throwsMsg(fn) { try { fn(); return null; } catch (e) { return e.userMessage || e.message; } }

const texts = {}, docs = {};
for (const [name, t] of Object.entries(rules.tables)) {
  texts[name] = readFileSync(join(site, t.file), 'utf8');
  docs[name] = T.parse(texts[name]);
}

// 1) 지금 표
const problems = T.checkDocs(rules, docs);
ok('지금 표 다섯 개가 칸 규칙을 지킴', problems.length === 0, JSON.stringify(problems.slice(0, 5)));

// 2) 그대로 다시 쓰기
for (const name of Object.keys(docs)) {
  ok(`${name}: 읽고 다시 쓰면 같은 글자`, T.serialize(docs[name]) === texts[name]);
}
{
  const d = docs.people, rows = T.rows(d);
  const r = T.apply(rules, docs, [{ table: 'people', op: 'edit', index: 1, row: { ...rows[1], '관심 분야': '보건 재정' }, expect: rows[1] }]);
  const before = texts.people.split(d.eol), after = T.serialize(r.docs.people).split(d.eol);
  const diff = before.map((l, i) => l === after[i] ? 0 : 1).reduce((a, b) => a + b, 0);
  ok('한 줄만 고치면 그 줄만 바뀜(줄 끝 모양 그대로)', diff === 1 && before.length === after.length, `바뀐 줄 ${diff}`);
  ok('고친 기록 글', r.notes[0] === '구성원 고침: ' + rows[1]['이름'], r.notes[0]);
}
{
  // 따옴표 · 쉼표 · BOM · 줄 바꿈 섞인 표
  const raw = '﻿가,나\r\n"a,b","c ""d"""\r\n,\r\n x , y \r\n';
  const d = T.parse(raw);
  ok('따옴표 · BOM 표 다시 쓰기', T.serialize(d) === raw);
  ok('따옴표 칸 읽기', JSON.stringify(T.rows(d)) === JSON.stringify([{ 가: 'a,b', 나: 'c "d"' }, { 가: 'x', 나: 'y' }]), JSON.stringify(T.rows(d)));
}

// 3) 맞음 · 틀림 예
const cases = JSON.parse(readFileSync(join(here, 'fixtures/rule_cases.json'), 'utf8')).cases;
for (const [tname, col, value, expect] of cases) {
  const c = rules.tables[tname].columns.find(x => x.name === col);
  const msg = T.checkCell(rules, c, value);
  ok(`규칙 예 ${tname}.${col}=${JSON.stringify(value)}`, (msg === null) === expect, msg);
}

// 4) 고치기
{
  const n0 = T.rows(docs.people).length, a0 = T.rows(docs.alumni).length;
  const next = T.nextNumber(rules, docs, 'person');
  const r = T.apply(rules, docs, [{ table: 'people', op: 'add', row: { 과정: '석사과정', 이름: '새학생', 메일: 'new@snu.ac.kr' } }]);
  const added = T.rows(r.docs.people).at(-1);
  ok('새 학생 더하기: 끝에 한 줄, 번호 저절로, 메일 공개 처음 값', T.rows(r.docs.people).length === n0 + 1 && added['번호'] === next && added['메일 공개'] === '보임', JSON.stringify(added));
  ok('더한 표의 다른 줄은 그대로', T.serialize(r.docs.people).startsWith(texts.people.replace(/\r?\n$/, '')));

  const hidden = T.apply(rules, docs, [{ table: 'people', op: 'add', row: { 과정: '석사과정', 이름: '숨김', 메일: 'x@snu.ac.kr', '메일 공개': '아니오' } }]);
  ok('메일 공개를 끄면 표에서 메일을 지움', T.rows(hidden.docs.people).at(-1)['메일'] === '');

  const p = T.rows(docs.people)[0];
  const moved = T.apply(rules, docs, [
    { table: 'people', op: 'remove', index: 0, expect: p },
    { table: 'alumni', op: 'add', row: { 학위: '박사', '졸업 연도': '2026', 이름: p['이름'], 번호: p['번호'] } }]);
  ok('졸업생으로 옮기기: 구성원 -1, 졸업생 +1, 번호 그대로', T.rows(moved.docs.people).length === n0 - 1 && T.rows(moved.docs.alumni).length === a0 + 1
    && T.rows(moved.docs.alumni).at(-1)['번호'] === p['번호']);
  ok('옮기기 기록 두 줄', moved.notes.length === 2, moved.notes.join(' / '));

  ok('옮기기 뒤 뺀 번호 목록은 비어 있음(다시 쓴 번호)', moved.freed.length === 0, JSON.stringify(moved.freed));
  const given = T.apply(rules, docs, [{ table: 'alumni', op: 'add', row: { 학위: '박사', '졸업 연도': '2026', 이름: '번호 적음', 번호: p['번호'] } }]);
  ok('화면이 적어 보낸 번호는 같은 저장에서 뺀 번호가 아니면 버리고 새 번호', T.rows(given.docs.alumni).at(-1)['번호'] === next, T.rows(given.docs.alumni).at(-1)['번호']);
  const pooled = T.apply(rules, docs, [{ table: 'people', op: 'add', row: { 과정: '석사과정', 이름: '가' } }], { numbers: [900] });
  ok('서버가 내준 새 번호를 씀', pooled.added[0].number === '900' && T.rows(pooled.docs.people).at(-1)['번호'] === '900');
  const removed = T.apply(rules, docs, [{ table: 'people', op: 'remove', index: 0, expect: p }]);
  ok('진짜 빼기는 끊을 번호로 돌려줌', JSON.stringify(removed.freed) === JSON.stringify([Number(p['번호'])]), JSON.stringify(removed.freed));
  const alum = T.rows(docs.alumni)[0];
  const dup = throwsMsg(() => T.apply(rules, docs, [{ table: 'people', op: 'add', row: { 과정: '석사과정', 이름: '겹침' } }], { numbers: [alum['번호']] }));
  ok('고치지 않은 졸업생 표와 번호가 겹쳐도 저장 안 됨', dup && dup.includes('겹칩니다'), dup);

  const stale = throwsMsg(() => T.apply(rules, docs, [{ table: 'people', op: 'edit', index: 0, row: p, expect: { ...p, 이름: '다른사람' } }]));
  ok('그 사이 남이 고쳤으면 멈춤', stale && stale.includes('다른 관리자'), stale);

  const bad = throwsMsg(() => T.apply(rules, docs, [{ table: 'news', op: 'add', row: { 날짜: '2026-13-01', 제목: '소식' } }]));
  ok('틀린 칸은 저장 안 됨(어느 칸인지 알림)', bad && bad.includes("'날짜'"), bad);

  const mv = T.apply(rules, docs, [{ table: 'courses', op: 'move', index: 0, to: 2, expect: T.rows(docs.courses)[0] }]);
  const names0 = T.rows(docs.courses).map(c => c['과목 이름']), names1 = T.rows(mv.docs.courses).map(c => c['과목 이름']);
  ok('교과목 순서 바꾸기', JSON.stringify(names1) === JSON.stringify([names0[1], names0[2], names0[0], names0[3]]), names1.join(' | '));
  ok('수행연구는 순서를 안 바꿈', (throwsMsg(() => T.apply(rules, docs, [{ table: 'projects', op: 'move', index: 0, to: 1 }])) || '').includes('순서'));

  const keep = T.apply(rules, docs, [{ table: 'news', op: 'edit', index: 0, row: { ...T.rows(docs.news)[0], '글 파일': 'news/evil.md' } }]);
  ok('글 파일 칸은 관리 화면에서 못 바꿈', Object.keys(keep.docs).length === 0 || T.rows(keep.docs.news)[0]['글 파일'] === T.rows(docs.news)[0]['글 파일']);
  ok('규칙 밖 칸 이름 표는 거절', (throwsMsg(() => T.apply(rules, { courses: T.parse('이름,학기\n가,나\n') }, [{ table: 'courses', op: 'remove', index: 0 }])) || '').includes('첫 줄'));
}

console.log(`표 부품 시험: 통과 ${pass} · 실패 ${fail}`);
if (fail) process.exit(1);
