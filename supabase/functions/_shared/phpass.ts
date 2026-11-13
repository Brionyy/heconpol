// 옛 사이트(워드프레스 4.2.1) 비밀번호 값 확인(2026-11-13, 연구자 "그냥 재설정 안하고 그대로 쓸 수 있게").
// 워드프레스 class-phpass.php 의 PasswordHash::CheckPassword 중 portable 방식($P$ · $H$)만 옮겼다.
//   값 = '$P$' + 반복 표시 1자(2의 몇 제곱 번) + 소금 8자 + MD5 결과 22자(phpass 자체 64글자 표)
//   계산: h = md5(소금 + 비밀번호); 반복 횟수만큼 h = md5(h + 비밀번호)
// 옛 값은 첫 로그인 확인에만 쓰고, 맞으면 서버가 새 방식(bcrypt)으로 저장한 뒤 옛 값을 지운다(login-help legacy_login).
// MD5 는 Deno 의 node:crypto 로 한다(Web Crypto 에는 MD5 가 없음). 바깥 부품은 불러오지 않는다.
import { createHash, timingSafeEqual } from 'node:crypto';

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const PHPASS_SHAPE = /^\$[PH]\$[./0-9A-Za-z]{31}$/;

function encode64(input: Uint8Array, count: number): string {
  let out = '';
  let i = 0;
  do {
    let value = input[i++];
    out += ITOA64[value & 0x3f];
    if (i < count) value |= input[i] << 8;
    out += ITOA64[(value >> 6) & 0x3f];
    if (i++ >= count) break;
    if (i < count) value |= input[i] << 16;
    out += ITOA64[(value >> 12) & 0x3f];
    if (i++ >= count) break;
    out += ITOA64[(value >> 18) & 0x3f];
  } while (i < count);
  return out;
}

const md5 = (...parts: Uint8Array[]) => {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};

// 워드프레스 crypt_private 와 같은 결과. 값 모양이 틀리면 null.
export function phpassCrypt(password: string, setting: string): string | null {
  if (!PHPASS_SHAPE.test(setting)) return null;
  const log2 = ITOA64.indexOf(setting[3]);
  if (log2 < 7 || log2 > 30) return null;
  let count = 1 << log2;
  const salt = new TextEncoder().encode(setting.slice(4, 12));
  const pw = new TextEncoder().encode(password);   // 워드프레스는 입력한 글자를 UTF-8 바이트 그대로 씀
  let hash = md5(salt, pw);
  do { hash = md5(hash, pw); } while (--count);
  return setting.slice(0, 12) + encode64(hash, 16);
}

// 맞으면 true. 비교는 같은 시간(앞 글자가 맞는 정도가 답 시간에 드러나지 않게).
// 워드프레스처럼 4096바이트 넘는 비밀번호는 거절한다(긴 입력으로 계산을 늘려 서버를 묶는 것을 막음).
export function phpassCheck(password: string, stored: string): boolean {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  if (new TextEncoder().encode(password).length > 4096) return false;
  const got = phpassCrypt(password, stored);
  if (!got) return false;
  const a = new TextEncoder().encode(got), b = new TextEncoder().encode(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
