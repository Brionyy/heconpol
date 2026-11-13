// 서버 도우미 셋(site-content · admin-account · login-help)이 같이 쓰는 것(2026-10-28 초안, 진짜 서버 연결은 교수님 승인 뒤).
// - 부른 사람 확인: 로그인 서비스에 그 사람의 열쇠(JWT)를 보여 확인받고, 등급은 회원 칸 서버 함수(my_profile)로 본다.
// - 관리자 일은 2단계 인증(aal2)을 마친 관리자만. 화면에서 단추를 숨기는 것은 막는 장치가 아니다.
// - 비밀 열쇠는 이 도우미 안에만 있다(화면 · 저장소에 두지 않음).
// 바깥 부품을 불러오지 않는다(Deno 표준 fetch · crypto 만). 그래서 판 고정 · 공급망 걱정이 없다.

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
// 새 비밀 열쇠(sb_secret_...)가 먼저, 없으면 옛 이름(2026년 말 폐지 예정, 2_보안검토.md)
export const SECRET_KEY = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
export const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://heconpol.org';
// 메일 링크의 사이트 주소. 임시 주소(https://brionyy.github.io/heconpol)처럼 하위 경로에 있으면 SITE_BASE=/heconpol (2026-11-13)
export const SITE_URL = SITE_ORIGIN + (Deno.env.get('SITE_BASE') ?? '').replace(/\/+$/, '');

export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// 우리 사이트에서 부른 것만 받는다(브라우저가 붙이는 Origin 확인)
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return origin === SITE_ORIGIN
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type, apikey', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' }
    : { vary: 'origin' };
}

export function answer(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) } });
}

// 도우미 하나를 감싼다: 미리 묻기(OPTIONS), 다른 사이트에서 부름 막기, 오류는 사람이 읽을 말로만(서버 원문은 기록에만).
// 각 index.ts 는 handle 을 내보내고, 직접 돌릴 때만 Deno.serve(handle) 한다(시험이 handle 을 바로 부름).
export function handlerOf(handler: (req: Request, body: Record<string, unknown>) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== 'POST') return answer(req, { error: '받을 수 없는 요청입니다.' }, 405);
    if ((req.headers.get('origin') ?? '') !== SITE_ORIGIN) return answer(req, { error: '우리 사이트에서만 부를 수 있습니다.' }, 403);
    try {
      const body = await req.json().catch(() => ({}));
      return answer(req, await handler(req, body ?? {}));
    } catch (e) {
      if (e instanceof HttpError) return answer(req, { error: e.message, code: e.code }, e.status);
      console.error(e);
      return answer(req, { error: '처리하지 못했습니다. 잠시 뒤 다시 해 주십시오.' }, 500);
    }
  };
}

// 회원 칸 서버 함수 부르기. jwt 가 있으면 그 사람 권한으로(관리자 함수의 2단계 인증 확인이 그대로 걸림), 없으면 비밀 열쇠로
export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}, jwt?: string): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SECRET_KEY, authorization: `Bearer ${jwt ?? SECRET_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = '처리하지 못했습니다.';
    try { msg = JSON.parse(text).message || msg; } catch { /* 그대로 */ }
    throw new HttpError(r.status === 401 || r.status === 403 ? 403 : 400, msg);
  }
  return (text ? JSON.parse(text) : null) as T;
}

// 표에 바로 쓰기(비밀 열쇠, 관리 기록처럼 도우미만 쓰는 곳)
export async function insertRow(table: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SECRET_KEY, authorization: `Bearer ${SECRET_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`${table} 쓰기 실패 ${r.status} ${await r.text()}`);
  return (await r.json())[0];
}

export async function selectRows(table: string, query: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: { apikey: SECRET_KEY, authorization: `Bearer ${SECRET_KEY}` } });
  if (!r.ok) throw new Error(`${table} 읽기 실패 ${r.status}`);
  return await r.json();
}

export async function updateRows(table: string, query: string, patch: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { apikey: SECRET_KEY, authorization: `Bearer ${SECRET_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`${table} 고치기 실패 ${r.status}`);
}

function jwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

export interface Caller { id: string; role: string; status: string; aal: string; jwt: string; name: string }

// 부른 사람: 로그인 서비스가 열쇠를 확인해 준 뒤에만 열쇠 속 값(aal)을 믿는다
export async function caller(req: Request): Promise<Caller> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, '로그인이 필요합니다.');
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SECRET_KEY, authorization: `Bearer ${jwt}` } });
  if (!r.ok) throw new HttpError(401, '로그인이 끝났습니다. 다시 로그인해 주십시오.');
  const user = await r.json();
  const claims = jwtPayload(jwt);
  if (claims.sub !== user.id) throw new HttpError(401, '로그인이 올바르지 않습니다.');
  const me = (await rpc<Record<string, string>[]>('my_profile', {}, jwt))[0];
  if (!me) throw new HttpError(403, '회원 정보를 찾지 못했습니다.');
  return { id: user.id, role: me.role, status: me.status, aal: String(claims.aal ?? ''), jwt, name: me.display_name };
}

export async function requireAdmin(req: Request): Promise<Caller> {
  const c = await caller(req);
  if (c.role !== 'admin' || c.status !== 'active') throw new HttpError(403, '관리자만 할 수 있습니다.');
  if (c.aal !== 'aal2') throw new HttpError(403, '관리자는 2단계 인증을 마친 뒤에 할 수 있습니다.');
  return c;
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 답을 늘 같은 시간 뒤에 준다(있는 계정인지에 따라 답 시간이 달라지지 않게)
export async function atLeast<T>(ms: number, work: Promise<T>): Promise<T> {
  const [v] = await Promise.all([work, new Promise((r) => setTimeout(r, ms))]);
  return v as T;
}

// 일을 뒤에서 하고 답은 바로(정해진 시간 뒤) 준다. 메일 보내기처럼 계정이 있을 때만 하는 일이 답 시간에 드러나지 않게(검토 10-28 2번).
// Supabase Edge Function 은 EdgeRuntime.waitUntil 로 답한 뒤에도 일을 끝낸다. 없으면(시험) 그냥 돌려 둔다.
export function inBackground(work: Promise<unknown>): void {
  const done = work.catch((e) => console.error(e));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(done);
}
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 우리 메일(이미 계정이 있습니다 · 메일이 바뀌었습니다)은 메일 발송 서비스를 고른 뒤 채운다(DECISIONS.md 10-24: 교수님 승인 뒤).
// 그 전까지는 보내지 않고 기록만 남긴다. 비밀번호 링크는 로그인 서비스의 메일 틀(Reset Password)로 간다.
export async function sendNotice(to: string, subject: string, _text: string): Promise<void> {
  console.log(`[메일 보류] ${subject} → ${to.replace(/^(.).*(@.*)$/, '$1***$2')}`);
}
