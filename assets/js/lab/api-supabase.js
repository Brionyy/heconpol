// 진짜 회원 칸 서버(Supabase) 연결 자리.
// 연구실 Supabase 프로젝트를 만든 뒤(연구자 승인 · 6단계) 채운다. 지금은 비어 있어 회원 칸이 '준비 중'으로 보인다.
//
// 채울 때 지킬 것(2_보안검토.md):
// - 화면에는 공개 열쇠(sb_publishable_...)만 넣는다. 비밀 열쇠(sb_secret_...)는 절대 넣지 않는다.
// - 기능 이름 · 돌려주는 모양은 api-fake.js 와 똑같이 맞춘다(session, signIn, signOut, requestReset, completeReset,
//   signUp, listPosts, getPost, savePost, deletePost, setHidden, addComment, deleteComment, attachmentUrl,
//   galleryList, myProfile, updateDisplayName, changePassword, requestWithdraw, adminProfiles, approve, reject,
//   setRole, setStatus, sendReset, adminLog, myDrafts, myPosts).
// - 관리 화면 · 가입 흐름(2026-10-28, admin.js · app.js)이 더 부르는 것과 맡는 곳:
//   requestReset · signUp → 서버 도우미 login-help(같은 답 · 같은 시간, 메일 한도. signUp 은 old_username(예전 아이디, 선택)과 email_as_id(새 메일로 가입 신청: 아이디 칸 없음, 도우미가 안에서 쓸 아이디를 만듦)도 넘김),
//   signIn 은 '@'가 든 값이면 메일로 바로 로그인한다(새 메일로 가입한 분은 메일이 아이디, 11-02),
//   signIn 이 bad_login 이면 서버 도우미 login-help legacy_login({ login, password })을 한 번 부르고, { retry: true } 면 같은 값으로 한 번 더 로그인한다
//   (옛 회원이 옛 비밀번호 그대로 첫 로그인, 2026-11-13. retry 가 false 면 처음 bad_login 그대로 돌려준다. 가짜 서버 흉내는 api-fake.js 몫),
//   (11-02부터 화면은 submitHelp 를 부르지 않음: 메일이 바뀐 옛 회원은 '새 메일로 가입 신청'. rpc submit_help_request 는 남아 있음),
//   adminSelf(로그인 정보의 aal + my_profile) · registerMfa(supabase.auth.mfa.enroll · verify, QR 화면) · finishHandover → rpc admin_finish_handover,
//   adminHelp · closeHelp · deleteHelp · memberEmail · setKind · linkPerson · withdrawCancel · handover · cancelHandover → 같은 이름의 rpc admin_*,
//   approve → 서버 도우미 admin-account approve(승인 뒤 그 회원에게 로그인 주소가 든 승인 메일, 11-02 밤. rpc admin_approve 를 바로 부르지 않음),
//   setEmail · withdrawDone → 서버 도우미 admin-account, linkOld(pendingId, oldId, byClaim) → admin-account link_old
//   (byClaim 이면 by_claim: true, 신청서 예전 아이디가 같을 때만 옛 계정 메일을 신청 메일로 바꾸고 새 메일로 링크, 11-02),
//   adminProfiles 는 old_username 도 돌려준다(migrations/20261102020000_old_username_claim.sql),
//   siteLoad · siteSave · siteUndo · siteLogDetail → 서버 도우미 site-content(load · save · undo · detail, 기록 탭이 열릴 때 status),
//   sitePhotoUrl → 사이트 주소(/assets/img/...). siteSave 의 사진은 base64 로, base 에 불러올 때 받은 표 판 표시를 함께 보낸다.
//   completeReset 은 { username } 도 돌려준다(아이디를 잊은 분께 한 번 더 보여 줌).
// - 내 정보 구성원 카드(2026-11-02, migrations/20261102000000_profile_requests.sql): updateMyCv(url, show) → profiles.cv_url · cv_public 고치기,
//   myCard → 화면에 실린 cards(번호 = my_profile 의 person_no), myProfileRequests → rpc my_profile_requests,
//   requestProfileChange('photo', JPEG) → Storage profile-photos 에 '내 id/무작위.jpg'로 올린 뒤 rpc request_profile_change('photo', null, 경로),
//   requestProfileChange('interest', 키워드를 ' · '로 이은 글) → rpc request_profile_change('interest', 글, null), cancelProfileRequest → rpc cancel_profile_request 뒤 사진 파일 지우기,
//   requestPhotoUrl(id) → profile-photos createSignedUrl(경로, 600), adminProfileRequests → rpc admin_list_profile_requests,
//   requestPhotoBlob(id) → profile-photos download, decideProfileRequest → rpc admin_decide_profile_request 뒤 사진 파일 지우기(관리자 2단계 인증).
//   가짜와 같게 has_photo(사진 요청인가)를 돌려준다.
// - savePost(2026-10-27): f.status('draft' | 'published') · f.remove(뺄 첨부 id)를 받는다. 본문 그림은 편집기가 정한 경로(files[].path,
//   '내 id/무작위.jpg')로 사진 칸에 올리고 첨부 줄을 넣는다. 뺀 첨부는 파일 칸에서 먼저 지우고 첨부 줄을 지운다.
//   올린 글 목록은 post_list(올린 글만), 내 임시저장 글은 posts 에서 status = 'draft'(규칙상 내 것만 보임).
// - 올리기 설정(2026-11-02, migrations/20261102010000_post_settings.sql): savePost 의 f.tags · f.visibility · f.allow_comments · f.pinned 는
//   posts 줄 넣기 · 고치기에 함께 보내고(고정은 관리자만, 서버 트리거가 거름), f.cover_path 는 첨부 줄을 다 넣은 뒤 posts 를 한 번 더 고쳐 넣는다
//   (서버가 '이 글의 사진 칸 첨부'인지 보므로). listPosts(board, page, tag) 는 post_list 를 order('pinned', desc) · order('created_at', desc),
//   tag 가 있으면 .contains('tags', [tag]) 로 부르고 tags · cover_path · visibility · allow_comments · pinned 를 그대로 돌려준다.
//   listPosts 의 넷째 인자 q(2026-11-02 목록 찾기 칸)는 제목 · 글쓴이(author_name)에 든 말로 거른다: .or('title.ilike.*말*,author_name.ilike.*말*').
//   말 안의 , ( ) * % _ \ 는 빼거나 막고(가짜와 같게 40자까지), 결과에 q 를 함께 돌려준다.
//   getPost 도 다섯 칸과 can_comment(올린 글이고 allow_comments 이거나 관리자)를 돌려준다. 오류 글은 가짜와 같게.
// - galleryList(2026-11-13 행사 기록 연대표): 행사 글마다 { id, title, created_at, author_name, cover, count }. cover 는 cover_path 가
//   아직 그 글의 사진 칸 첨부이면 그 첨부, 아니면 첫 사진(없으면 null). count 는 사진 칸 첨부 수. 최근 글이 먼저.
// - 아이디 로그인은 작은 서버 함수(Edge Function)가 아이디 → 메일을 안에서 찾아 처리한다. 화면에서 메일을 찾지 않는다.
// - 비밀번호 링크는 /login/reset/?token_hash=...&type=recovery 로 받고, 단추를 눌러야 verifyOtp 를 부른다.
// - 파일 주소: 사진 createSignedUrl(path, 600), 자료 createSignedUrl(path, 60, { download: 원래이름 }).
(function () {
  'use strict';
  if (window.LAB_BLOCKED) return;
  window.LabSupabaseApi = null;
})();
