// GitHub 저장소 고치기(2026-10-28 초안). 연구실 조직이 가진 GitHub App 으로 이 저장소 하나만, 내용 쓰기 · 만들기 결과 읽기만.
// 사람 한 명의 열쇠에 묶이지 않아 조교가 바뀌어도 그대로 돈다(설계서 9절 8번).
// 비밀 값(회원 칸 서버 Edge Function secrets): GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY(PKCS#8 PEM),
//   GITHUB_REPO(예: heconpol-lab/heconpol), GITHUB_BRANCH(처음 값 main).
// GitHub 이 주는 열쇠 파일은 PKCS#1(BEGIN RSA PRIVATE KEY)이라 넣기 전에 바꾼다:
//   openssl pkcs8 -topk8 -nocrypt -in app.pem -out app-pkcs8.pem

const API = 'https://api.github.com';
const REPO = Deno.env.get('GITHUB_REPO') ?? '';
export const BRANCH = Deno.env.get('GITHUB_BRANCH') ?? 'main';

function b64url(bytes: Uint8Array | string): string {
  const s = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function appJwt(): Promise<string> {
  const pem = (Deno.env.get('GITHUB_APP_PRIVATE_KEY') ?? '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: Deno.env.get('GITHUB_APP_ID') ?? '' }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

let cached: { token: string; until: number } | null = null;
async function token(): Promise<string> {
  if (cached && cached.until > Date.now() + 60000) return cached.token;
  const r = await fetch(`${API}/app/installations/${Deno.env.get('GITHUB_APP_INSTALLATION_ID')}/access_tokens`, {
    method: 'POST', headers: { authorization: `Bearer ${await appJwt()}`, accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error(`GitHub 연결 실패 ${r.status}`);
  const j = await r.json();
  cached = { token: j.token, until: Date.parse(j.expires_at) };
  return j.token;
}

export async function gh<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}/repos/${REPO}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await token()}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (r.status === 404) return null as T;
  if (!r.ok) {
    const e = new Error(`GitHub ${path} ${r.status}`) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return r.status === 204 ? (null as T) : await r.json();
}

export interface Head { commit: string; tree: string }
export async function head(): Promise<Head> {
  const ref = await gh(`/git/ref/heads/${BRANCH}`);
  const c = await gh(`/git/commits/${ref.object.sha}`);
  return { commit: ref.object.sha, tree: c.tree.sha };
}

// 파일 하나의 지금 판 표시(blob sha)와 글. 없으면 null
export async function readFile(path: string, ref: string): Promise<{ sha: string; text: string } | null> {
  const f = await gh(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${ref}`);
  if (!f) return null;
  const bytes = Uint8Array.from(atob(String(f.content).replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  return { sha: f.sha, text: new TextDecoder().decode(bytes) };
}

export async function readBlob(sha: string): Promise<string> {
  const b = await gh(`/git/blobs/${sha}`);
  return new TextDecoder().decode(Uint8Array.from(atob(String(b.content).replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
}

export async function blobShaOf(path: string, ref: string): Promise<string | null> {
  const f = await gh(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${ref}`);
  return f ? f.sha : null;
}

// 여러 파일을 한꺼번에 판 하나로: files 의 값이 글(text) · 그림(base64) · 지우기(null) · 옛 판 되살리기(sha)
export type Put = { text: string } | { base64: string } | { sha: string } | null;
export async function commit(base: Head, files: Record<string, Put>, message: string): Promise<string> {
  const tree: Record<string, unknown>[] = [];
  for (const [path, v] of Object.entries(files)) {
    if (v === null) { tree.push({ path, mode: '100644', type: 'blob', sha: null }); continue; }
    if ('sha' in v) { tree.push({ path, mode: '100644', type: 'blob', sha: v.sha }); continue; }
    const blob = 'text' in v
      ? await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: v.text, encoding: 'utf-8' }) })
      : await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: v.base64, encoding: 'base64' }) });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const t = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base.tree, tree }) });
  const c = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [base.commit] }) });
  // 덮어쓰기(force) 하지 않는다: 그 사이 다른 판이 올라갔으면 실패하고 다시 하게 한다
  try {
    await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) });
  } catch (e) {
    if ((e as { status?: number }).status === 422) throw Object.assign(new Error('stale'), { stale: true });
    throw e;
  }
  return c.sha;
}

// 그 판의 '사이트 만들기' 결과: published · failed · waiting.
// 연달아 저장하면 앞 만들기는 취소(cancelled)되고 뒤 만들기가 둘 다 공개한다(pages.yml cancel-in-progress). 그래서 취소 · 건너뜀은
// 실패로 적지 않고, 이 판을 품은 뒤 판의 만들기가 성공했으면 '공개됨'으로 적는다(검토 10-28 7번).
export async function publishState(sha: string): Promise<{ state: 'published' | 'failed' | 'waiting'; note: string }> {
  const runs = await gh(`/actions/runs?head_sha=${sha}&per_page=5`);
  const run = (runs?.workflow_runs ?? []).filter((r: any) => r.path?.endsWith('pages.yml'))[0];
  if (run && run.status === 'completed') {
    if (run.conclusion === 'success') return { state: 'published', note: '' };
    if (['failure', 'timed_out', 'startup_failure', 'action_required'].includes(run.conclusion)) {
      return { state: 'failed', note: `만들기 ${run.conclusion} (${run.html_url})` };
    }
  }
  const ok = await gh(`/actions/workflows/pages.yml/runs?branch=${BRANCH}&status=success&per_page=1`);
  const last = ok?.workflow_runs?.[0];
  if (last && last.head_sha !== sha) {
    const cmp = await gh(`/compare/${sha}...${last.head_sha}`);
    if (cmp && (cmp.status === 'ahead' || cmp.status === 'identical')) return { state: 'published', note: '뒤 판의 만들기가 함께 공개' };
  }
  return { state: 'waiting', note: '' };
}
