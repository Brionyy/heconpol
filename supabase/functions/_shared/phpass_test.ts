// 옛 비밀번호 값 확인(phpass.ts) 시험(2026-11-13). 진짜 회원 값은 쓰지 않는다.
// 돌리기(site/ 에서): deno test --no-config -A supabase/functions/_shared/phpass_test.ts
// 쓰는 값:
//  - 공개 본보기: hashcat 예시 값 목록(hashcat.net/wiki example_hashes, 400번 phpass)의 '$P$984478476IagS59wHZvyQMArzfx58u.' = 'hashcat'
//  - 직접 만든 값 셋: 이 파일과 따로 짠 파이썬 계산으로 만든 것(2026-11-13). $H$ 방식, 한글이 든 비밀번호, 가장 적은 반복(2^7)
import { phpassCheck, phpassCrypt } from './phpass.ts';

function same(a: unknown, b: unknown, what: string) {
  if (a !== b) throw new Error(`${what}: 기대 ${b}, 실제 ${a}`);
}

Deno.test('공개 본보기 값: 맞는 비밀번호는 통과, 틀리면 거절', () => {
  const h = '$P$984478476IagS59wHZvyQMArzfx58u.';
  same(phpassCrypt('hashcat', h), h, '계산 결과');
  same(phpassCheck('hashcat', h), true, '맞는 비밀번호');
  same(phpassCheck('Hashcat', h), false, '대문자 하나 다름');
  same(phpassCheck('hashcat ', h), false, '뒤에 빈칸');
  same(phpassCheck('', h), false, '빈 비밀번호');
});

Deno.test('직접 만든 값: $H$ 방식 · 한글 비밀번호 · 짧은 비밀번호', () => {
  same(phpassCheck('test1234', '$H$9abcdefghHuWu6tXgu.wFkMlJR9ZvQ1'), true, '$H$');
  same(phpassCheck('비밀번호12', '$P$Bsalt1234.WyNCkiSYEDWUmsYzoOd3/'), true, '한글(UTF-8)');
  same(phpassCheck('ab', '$P$7zzzzzzzzVji1dKx4IWUeM03JDNbIU/'), true, '두 글자(새 규칙에 안 맞아도 옛 값으로는 통과)');
  same(phpassCheck('ab', '$P$7zzzzzzzzVji1dKx4IWUeM03JDNbIU.'), false, '값 끝 한 글자 다름');
});

Deno.test('모양이 틀린 값 · 지나친 반복 · 너무 긴 비밀번호는 거절', () => {
  same(phpassCheck('x', ''), false, '빈 값');
  same(phpassCheck('x', '5f4dcc3b5aa765d61d8327deb882cf99'), false, '옛 MD5 32자(이 사이트에는 없음)');
  same(phpassCheck('x', '$2y$10$abcdefghijklmnopqrstuuJ8HnB3iJxQ0iV0Pq3rA0xW1yYbS7d2'), false, 'bcrypt 값');
  same(phpassCrypt('x', '$P$4' + 'a'.repeat(30)), null, '반복 2^6(워드프레스도 거절)');
  same(phpassCrypt('x', '$P$z' + 'a'.repeat(30)), null, '반복 2^63(서버를 묶는 값)');
  same(phpassCheck('a'.repeat(4097), '$P$984478476IagS59wHZvyQMArzfx58u.'), false, '4096바이트 넘는 비밀번호');
});
