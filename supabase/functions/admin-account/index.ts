// 서버 도우미 admin-account(2026-10-28 초안): 비밀 열쇠가 있어야 하는 관리자 일 둘.
// - set_email: 회원 메일 바꾸기. 다른 길로 본인 확인한 방법을 꼭 받고(기록에 남음), 옛 메일에 알린다. 내 계정 메일은 다른 관리자만.
// - withdraw_done: 탈퇴 처리. 그 회원이 올린 파일을 파일 칸에서 먼저 지운 뒤 admin_remove_user(글은 '탈퇴한 회원'으로 남음).
// - link_old: 가입 신청이 옛 회원이면 옛 계정 메일로 비밀번호 링크를 보내고, 보낸 뒤에만 신청을 거절(지움)한다.
//   보내지 못하면(메일 없음 · 한도) 신청을 그대로 두고 까닭을 돌려준다(검토 10-28 5번).
//   by_claim(11-02, 메일이 바뀐 옛 회원의 '새 메일로 가입 신청'): 신청서에 적은 예전 아이디가 그 계정 아이디와 같을 때만,
//   신청을 지우고 → 옛 계정 메일을 신청 메일로 바꾸고 → 옛 메일에 알리고 → 새 메일로 링크를 보낸다. 다른 길 본인 확인은 받지 않는다.
// - approve(11-02 밤): 가입 승인(rpc admin_approve) 뒤 그 회원 메일로 '회원가입이 승인되었습니다' + 로그인 주소. 메일을 못 보내도 승인은 남음(mailed: false).
// 모두 2단계 인증을 마친 관리자만.
import { HttpError, SECRET_KEY, SITE_ORIGIN, SUPABASE_URL, insertRow, requireAdmin, rpc, selectRows, sendNotice, handlerOf } from '../_shared/common.ts';

const METHODS = ['연구실이 아는 번호로 전화', '연구실이 아는 메신저', '교수님 확인', '동기 · 선후배 확인', '직접 만남'];
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function authAdmin(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init, headers: { apikey: SECRET_KEY, authorization: `Bearer ${SECRET_KEY}`, 'content-type': 'application/json' },
  });
  if (!r.ok) throw new HttpError(400, r.status === 422 ? '그 메일은 다른 계정이 쓰고 있습니다.' : '처리하지 못했습니다.');
  return r.status === 204 ? null : await r.json();
}

async function storage(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1${path}`, {
    ...init, headers: { apikey: SECRET_KEY, authorization: `Bearer ${SECRET_KEY}`, 'content-type': 'application/json' },
  });
  if (!r.ok) throw new Error(`파일 칸 ${path} ${r.status}`);
  return await r.json();
}

export const handle = handlerOf(async (req, body) => {
  const me = await requireAdmin(req);
  const action = String(body.action ?? '');
  const target = String(body.user_id ?? '');
  if (!UUID.test(target)) throw new HttpError(400, '회원을 찾지 못했습니다.');

  if (action === 'set_email') {
    if (target === me.id) throw new HttpError(403, '내 계정의 메일은 다른 관리자가 바꿔야 합니다.');
    const method = String(body.method ?? '');
    if (!METHODS.includes(method)) throw new HttpError(400, '다른 길로 본인임을 어떻게 확인했는지 골라 주십시오.');
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 120) throw new HttpError(400, '메일 주소를 확인해 주십시오.');
    const old = await rpc<string | null>('admin_member_email', { target }, me.jwt);   // 관리자 확인이 한 번 더 걸림
    if (old === email) return { ok: true };
    await authAdmin(`/users/${target}`, { method: 'PUT', body: JSON.stringify({ email, email_confirm: true }) });
    await insertRow('admin_log', { admin_id: me.id, action: '메일 바꿈', target, detail: `확인 방법: ${method}` });
    if (old) await sendNotice(old, '계정 메일이 바뀌었습니다', `관리자가 본인 확인(${method}) 뒤 이 계정의 메일을 바꿨습니다. 본인이 요청하지 않았다면 연구실 조교에게 바로 알려 주십시오.`);
    return { ok: true };
  }

  if (action === 'withdraw_done') {
    if (target === me.id) throw new HttpError(403, '내 계정은 다른 관리자가 지워야 합니다.');
    // 올린 파일은 '회원 id/…' 폴더에 있다(파일 칸 규칙). 두 칸에서 모두 지운다
    for (const bucket of ['gallery', 'files']) {
      for (;;) {
        const list = await storage(`/object/list/${bucket}`, { method: 'POST', body: JSON.stringify({ prefix: `${target}/`, limit: 100 }) });
        const names = (list as { name: string }[]).map((o) => `${target}/${o.name}`);
        if (!names.length) break;
        await storage(`/object/${bucket}`, { method: 'DELETE', body: JSON.stringify({ prefixes: names }) });
      }
    }
    await rpc('admin_remove_user', { target }, me.jwt);
    return { ok: true };
  }

  if (action === 'link_old') {
    const pending = String(body.pending_id ?? '');
    if (!UUID.test(pending)) throw new HttpError(400, '가입 신청을 찾지 못했습니다.');
    const old = await authAdmin(`/users/${target}`);
    if (body.by_claim === true) {
      // 서버가 다시 본다: 신청이 아직 대기이고, 신청서의 예전 아이디가 이 계정 아이디와 같고, 이 계정은 대기 · 탈퇴가 아님
      const [p] = await selectRows('profiles', `id=eq.${pending}&select=role,old_username,username`);
      const [o] = await selectRows('profiles', `id=eq.${target}&select=role,status,username`);
      if (!p || p.role !== 'pending') throw new HttpError(400, '가입 신청을 찾지 못했습니다.');
      if (!o || o.role === 'pending' || o.status === 'withdrawn') throw new HttpError(400, '기존 계정을 찾지 못했습니다.');
      if (target === me.id) throw new HttpError(403, '내 계정은 다른 관리자가 이어야 합니다.');
      if (String(p.old_username ?? '').toLowerCase() !== String(o.username ?? '').toLowerCase())
        throw new HttpError(400, '신청서에 기재한 기존 아이디가 이 계정과 다릅니다.');
      const fresh = String((await authAdmin(`/users/${pending}`))?.email ?? '').toLowerCase();
      if (!EMAIL.test(fresh)) throw new HttpError(400, '신청 메일을 찾지 못했습니다.');
      const before = String(old?.email ?? '');
      // 신청 계정이 그 메일을 쥐고 있으므로 신청을 먼저 지운다(지운 뒤 메일 바꾸기가 실패하면 까닭을 돌려주고, 관리자가 회원 탭에서 마저 함)
      await rpc('admin_reject', { target: pending }, me.jwt);
      await authAdmin(`/users/${target}`, { method: 'PUT', body: JSON.stringify({ email: fresh, email_confirm: true }) });
      await insertRow('admin_log', { admin_id: me.id, action: '가입 신청을 기존 계정과 연결', target, detail: `메일 바꿈 · 확인 방법: 신청서의 기존 아이디(${p.username} 신청)` });
      if (before && before.toLowerCase() !== fresh) await sendNotice(before, '계정 메일이 바뀌었습니다', `새 메일로 들어온 가입 신청을 이 계정(아이디 ${o.username})에 연결했습니다. 본인이 요청하지 않았다면 연구실 조교에게 바로 알려 주십시오.`);
      await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(SITE_ORIGIN + '/login/reset/')}`, {
        method: 'POST', headers: { apikey: SECRET_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: fresh }),
      });
      return { ok: true };
    }
    const mail = String(old?.email ?? '');
    if (!mail) throw new HttpError(400, '기존 계정에 메일이 없습니다. 연구실이 아는 연락처로 본인임을 확인한 뒤 회원 탭에서 메일을 바꾸고 링크를 보내 주십시오.');
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(SITE_ORIGIN + '/login/reset/')}`, {
      method: 'POST', headers: { apikey: SECRET_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: mail }),
    });
    if (!r.ok) throw new HttpError(429, '링크를 보내지 못했습니다(조금 전에 보냈거나 메일 한도). 신청은 그대로 두었습니다. 10분 뒤 다시 해 주십시오.');
    await rpc('admin_reject', { target: pending }, me.jwt);
    await insertRow('admin_log', { admin_id: me.id, action: '가입 신청을 기존 계정과 연결', target, detail: `신청 ${pending}` });
    return { ok: true };
  }

  if (action === 'approve') {
    // 가입 승인 + 안내 메일(11-02 밤, 연구자: "내가 승인하면 그 사람의 메일에 승인 되었다면서 url 보내는 거"). 승인은 규칙 함수가 하고
    // (관리자 확인 · 기록이 거기서 걸림), 메일은 승인이 된 뒤에만 보낸다. 메일을 못 보내도 승인은 그대로 두고 그 사실을 돌려준다
    await rpc('admin_approve', { target }, me.jwt);
    const [p] = await selectRows('profiles', `id=eq.${target}&select=username`);
    const mail = String((await authAdmin(`/users/${target}`))?.email ?? '');
    if (!mail) return { ok: true, mailed: false };
    try {
      await sendNotice(mail, '회원가입이 승인되었습니다',
        `보건정치경제연구실 홈페이지 회원가입이 승인되었습니다. 이 메일 주소(또는 아이디 ${p?.username ?? ''})와 가입 때 정한 비밀번호로 로그인하십시오.\n\n로그인: ${SITE_ORIGIN}/login/`);
    } catch (_e) { return { ok: true, mailed: false }; }
    return { ok: true, mailed: true };
  }

  throw new HttpError(400, '모르는 일입니다.');
});

if (import.meta.main) Deno.serve(handle);
