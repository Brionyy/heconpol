// 서버 도우미 site-content(2026-10-28 초안): 관리 화면 '사이트 내용' 탭이 공개 표 다섯 개(구성원 · 졸업생 · 소식 · 수행연구 · 교과목)를
// GitHub 저장소에서 읽고 고친다. 저장 한 번 = GitHub 판 하나. 공개 화면은 그 판을 보고 1~2분 뒤 다시 만들어진다(pages.yml).
// 할 일(action): load · save · undo · detail · status. 모두 2단계 인증을 마친 관리자만.
// 칸 검사 · 고치기는 관리 화면과 같은 부품(_shared/site-tables.js = assets/js/lab/site-tables.js 사본, 시험이 같은지 봄)과
// 같은 규칙 파일(schema/tables.json, 고칠 그 판에서 읽음)로 한다.
import '../_shared/site-tables.js';
import { HttpError, insertRow, requireAdmin, rpc, selectRows, handlerOf, updateRows } from '../_shared/common.ts';
import { blobShaOf, commit, head, publishState, readBlob, readFile, type Head, type Put } from '../_shared/github.ts';

// deno-lint-ignore no-explicit-any
const T: any = (globalThis as any).LabSiteTables;
const RULES_PATH = 'schema/tables.json';
const PHOTO_MAX = 1048576;
const KINDS = ['재학', '졸업', '교수', '기타'];

interface Loaded { at: Head; rules: any; texts: Record<string, string>; shas: Record<string, string> }

async function loadAll(): Promise<Loaded> {
  const at = await head();
  const rulesFile = await readFile(RULES_PATH, at.commit);
  if (!rulesFile) throw new HttpError(500, '칸 규칙 파일을 찾지 못했습니다.');
  const rules = JSON.parse(rulesFile.text);
  const texts: Record<string, string> = {}, shas: Record<string, string> = {};
  for (const [name, t] of Object.entries<any>(rules.tables)) {
    const f = await readFile(t.file, at.commit);
    if (!f) throw new HttpError(500, `표 파일이 없습니다: ${t.file}`);
    texts[name] = f.text;
    shas[name] = f.sha;
  }
  return { at, rules, texts, shas };
}

// 사진: 허락한 폴더 · 이름 규칙 · 새 이름만(있는 파일 덮어쓰기 금지) · 1MB · JPEG 머리
async function checkPhoto(rules: any, at: Head, p: { path?: unknown; base64?: unknown }): Promise<{ path: string; base64: string }> {
  const path = String(p.path ?? ''), b64 = String(p.base64 ?? '');
  const dirs = Object.values<any>(rules.tables).map((t) => t.photo_dir).filter(Boolean);
  const dir = path.slice(0, path.lastIndexOf('/')), file = path.slice(path.lastIndexOf('/') + 1);
  if (!dirs.includes(dir) || !new RegExp(rules.photo_pattern).test(file)) throw new HttpError(400, '사진 파일 이름이 올바르지 않습니다.');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length > PHOTO_MAX) throw new HttpError(400, '사진이 너무 큽니다(1MB까지).');
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new HttpError(400, '사진은 화면에서 JPEG 로 다시 저장해 올립니다.');
  if (await blobShaOf(path, at.commit)) throw new HttpError(400, '같은 이름의 사진이 이미 있습니다. 새 이름으로 올립니다.');
  return { path, base64: b64 };
}

function photoAllowed(rules: any, path: string): boolean {
  const dirs = Object.values<any>(rules.tables).map((t) => t.photo_dir).filter(Boolean);
  const dir = path.slice(0, path.lastIndexOf('/')), file = path.slice(path.lastIndexOf('/') + 1);
  return dirs.includes(dir) && new RegExp(rules.photo_pattern).test(file);
}

export const handle = handlerOf(async (req, body) => {
  const me = await requireAdmin(req);
  const action = String(body.action ?? '');

  if (action === 'load') {
    const d = await loadAll();
    return { rules: d.rules, texts: d.texts, base: d.shas, commit: d.at.commit };
  }

  if (action === 'save') {
    const d = await loadAll();
    // 화면이 불러온 뒤 그 사이 다른 관리자가 같은 표를 고쳤으면 멈춘다
    const base = (body.base ?? {}) as Record<string, string>;
    for (const [name, sha] of Object.entries(base)) {
      if (d.shas[name] && d.shas[name] !== sha) throw new HttpError(409, '그 사이 다른 관리자가 이 표를 고쳤습니다. 화면을 새로 불러온 뒤 다시 해 주십시오.', 'stale');
    }
    const docs: Record<string, unknown> = {};
    for (const k of Object.keys(d.texts)) docs[k] = T.parse(d.texts[k]);
    // 새 카드 번호는 서버가 미리 내준다(한 번 쓴 번호는 다시 쓰지 않음, 검토 10-28 3번)
    const changes = (body.changes ?? []) as { op?: string; table?: string }[];
    const numbered = Object.entries<any>(d.rules.tables).filter(([, t]) => t.columns.some((c: any) => c.kind === 'number')).map(([k]) => k);
    const needed = changes.filter((c) => c.op === 'add' && numbered.includes(String(c.table))).length;
    let numbers: number[] = [];
    if (needed) {
      let tableMax = 0;
      for (const k of numbered) for (const row of T.rows(docs[k])) tableMax = Math.max(tableMax, Number(row['번호']) || 0);
      numbers = await rpc<number[]>('admin_reserve_person_nos', { n: needed, table_max: tableMax }, me.jwt);
    }
    let r;
    try { r = T.apply(d.rules, docs, changes, { numbers }); } catch (e) { throw new HttpError(400, (e as { userMessage?: string }).userMessage ?? '고칠 수 없습니다.'); }
    const files: Record<string, Put> = {}, changed: Record<string, { before: string | null; after?: string }> = {};
    for (const [name, doc] of Object.entries<any>(r.docs)) {
      const text = T.serialize(doc);
      if (text === d.texts[name]) continue;
      files[d.rules.tables[name].file] = { text };
      changed[d.rules.tables[name].file] = { before: d.shas[name] };
    }
    const photoNotes: string[] = [];
    for (const p of (body.photos ?? []) as { path?: unknown; base64?: unknown }[]) {
      const ok = await checkPhoto(d.rules, d.at, p);
      files[ok.path] = { base64: ok.base64 };
      changed[ok.path] = { before: null };
      photoNotes.push('사진 더함 ' + ok.path);
    }
    for (const raw of (body.removePhotos ?? []) as unknown[]) {
      const path = String(raw);
      if (!photoAllowed(d.rules, path)) throw new HttpError(400, '지울 수 없는 사진입니다.');
      const sha = await blobShaOf(path, d.at.commit);
      if (!sha) continue;
      files[path] = null;
      changed[path] = { before: sha };
      photoNotes.push('사진 지움 ' + path);
    }
    if (!Object.keys(files).length) return { ok: true, nothing: true };
    const notes = [...r.notes, ...photoNotes];
    let sha: string;
    try {
      sha = await commit(d.at, files, `관리 화면: ${notes.join(' / ').slice(0, 200)} (${me.name})`);
    } catch (e) {
      if ((e as { stale?: boolean }).stale) throw new HttpError(409, '그 사이 다른 판이 올라갔습니다. 화면을 새로 불러온 뒤 다시 해 주십시오.', 'stale');
      throw e;
    }
    for (const path of Object.keys(changed)) changed[path].after = files[path] === null ? undefined : (await blobShaOf(path, sha)) ?? undefined;
    const log = await insertRow('admin_log', {
      admin_id: me.id, action: '사이트 내용 고침', target: Object.keys(changed).join(' · '), detail: notes.join(' / ').slice(0, 1000),
      changes: { notes, commit: sha, parent: d.at.commit, files: changed }, publish_state: 'waiting',
    });
    // 판이 올라간 뒤 회원 쪽 일(관리자 본인 권한으로 불러 2단계 인증 · 기록이 그대로 걸림)
    // 카드를 진짜로 뺐으면 그 번호와 이어진 회원 연결을 끊는다(옮기기는 번호가 그대로라 끊지 않음)
    if (r.freed.length) await rpc('admin_unlink_person_nos', { nos: r.freed }, me.jwt);
    // 새로 만든 구성원 카드와 회원 잇기: 번호는 화면이 아니라 이번에 붙은 번호로
    const link = body.link as { user_id?: string } | undefined;
    const newCard = (r.added as { table: string; number: string | null }[]).find((a) => a.table === 'people' && a.number);
    if (link?.user_id && newCard) await rpc('admin_link_person', { target: link.user_id, no: Number(newCard.number) }, me.jwt);
    const kind = body.kind as { user_id?: string; kind?: string } | undefined;
    if (kind?.user_id && KINDS.includes(String(kind.kind))) await rpc('admin_set_kind', { target: kind.user_id, new_kind: kind.kind }, me.jwt);
    return { ok: true, log_id: log.id, notes, commit: sha };
  }

  if (action === 'undo' || action === 'detail') {
    const rows = await selectRows('admin_log', `id=eq.${Number(body.log_id)}&select=id,changes,undo_of,detail,target`);
    const e = rows[0] as any;
    if (!e || !e.changes?.files) throw new HttpError(404, '기록을 찾지 못했습니다.');
    const at = await head();
    if (action === 'detail') {
      const files: Record<string, { before: string; after: string }> = {};
      for (const [path, v] of Object.entries<any>(e.changes.files)) {
        if (!path.endsWith('.csv')) continue;
        files[path] = { before: v.before ? await readBlob(v.before) : '', after: v.after ? await readBlob(v.after) : '' };
      }
      return { files, photos: (e.changes.notes ?? []).filter((n: string) => n.startsWith('사진')) };
    }
    const done = await selectRows('admin_log', `undo_of=eq.${e.id}&select=id`);
    if (done.length) throw new HttpError(409, '이미 되돌린 고침입니다.');
    // 그 뒤에 같은 파일을 고친 적이 없을 때만(지금 판 = 그때 고친 뒤 판)
    const files: Record<string, Put> = {}, changed: Record<string, { before: string | null; after?: string | null }> = {};
    for (const [path, v] of Object.entries<any>(e.changes.files)) {
      const now = await blobShaOf(path, at.commit);
      if ((now ?? undefined) !== (v.after ?? undefined)) throw new HttpError(409, "그 뒤에 같은 표를 고친 것이 있어 되돌리지 못했습니다. [자세히]로 '고치기 전' 내용을 보고 직접 고쳐 주십시오.", 'stale');
      files[path] = v.before ? { sha: v.before } : null;
      changed[path] = { before: now, after: v.before };
    }
    // 되돌린 뒤의 표도 칸 규칙을 지키는지 먼저 본다(뺀 카드를 되살릴 때 그 사이 같은 번호를 쓴 카드가 있으면 만들기가 멈춤)
    const d = await loadAll();
    const docs: Record<string, unknown> = {};
    for (const [name, t] of Object.entries<any>(d.rules.tables)) {
      const v = e.changes.files[t.file];
      docs[name] = T.parse(v ? (v.before ? await readBlob(v.before) : '') : d.texts[name]);
    }
    const bad = T.checkDocs(d.rules, docs);
    if (bad.length) throw new HttpError(409, `되돌리면 표가 규칙에 어긋납니다(${d.rules.tables[bad[0].table].label} ${bad[0].line}번째 줄: ${bad[0].msg}). [자세히]로 '고치기 전' 내용을 보고 직접 고쳐 주십시오.`, 'stale');
    const sha = await commit(at, files, `관리 화면: 되돌림(기록 ${e.id}) (${me.name})`);
    await insertRow('admin_log', {
      admin_id: me.id, action: '되돌림', target: e.target, detail: String(e.detail ?? '') + ' (회원 계정의 구분 · 명단 연결은 그대로)',
      changes: { notes: ['되돌림'], commit: sha, parent: at.commit, files: changed }, publish_state: 'waiting', undo_of: e.id,
    });
    return { ok: true, commit: sha };
  }

  if (action === 'status') {
    // 기록 탭이 열릴 때: 아직 '기다리는 중'인 고침의 공개 결과를 GitHub 에서 읽어 적는다
    const waiting = await selectRows('admin_log', 'publish_state=eq.waiting&select=id,changes&order=id.desc&limit=20');
    for (const w of waiting as any[]) {
      if (!w.changes?.commit) continue;
      const s = await publishState(w.changes.commit);
      if (s.state !== 'waiting') await updateRows('admin_log', `id=eq.${w.id}`, { publish_state: s.state, publish_note: s.note });
    }
    return { ok: true };
  }

  throw new HttpError(400, '모르는 일입니다.');
});

if (import.meta.main) Deno.serve(handle);
