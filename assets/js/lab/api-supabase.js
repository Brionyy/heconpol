// 진짜 회원 칸 서버(Supabase) 연결 자리.
// 연구실 Supabase 프로젝트를 만든 뒤(연구자 승인 · 6단계) 채운다. 지금은 비어 있어 회원 칸이 '준비 중'으로 보인다.
//
// 채울 때 지킬 것(2_보안검토.md):
// - 화면에는 공개 열쇠(sb_publishable_...)만 넣는다. 비밀 열쇠(sb_secret_...)는 절대 넣지 않는다.
// - 기능 이름 · 돌려주는 모양은 api-fake.js 와 똑같이 맞춘다(session, signIn, signOut, requestReset, completeReset,
//   signUp, listPosts, getPost, savePost, deletePost, setHidden, addComment, deleteComment, attachmentUrl,
//   galleryList, myProfile, updateDisplayName, changePassword, requestWithdraw, adminProfiles, approve, reject,
//   setRole, setStatus, sendReset, adminLog, myDrafts, myPosts).
// - savePost(2026-10-27): f.status('draft' | 'published') · f.remove(뺄 첨부 id)를 받는다. 본문 그림은 편집기가 정한 경로(files[].path,
//   '내 id/무작위.jpg')로 사진 칸에 올리고 첨부 줄을 넣는다. 뺀 첨부는 파일 칸에서 먼저 지우고 첨부 줄을 지운다.
//   올린 글 목록은 post_list(올린 글만), 내 임시저장 글은 posts 에서 status = 'draft'(규칙상 내 것만 보임).
// - 아이디 로그인은 작은 서버 함수(Edge Function)가 아이디 → 메일을 안에서 찾아 처리한다. 화면에서 메일을 찾지 않는다.
// - 비밀번호 링크는 /login/reset/?token_hash=...&type=recovery 로 받고, 단추를 눌러야 verifyOtp 를 부른다.
// - 파일 주소: 사진 createSignedUrl(path, 600), 자료 createSignedUrl(path, 60, { download: 원래이름 }).
(function () {
  'use strict';
  if (window.LAB_BLOCKED) return;
  window.LabSupabaseApi = null;
})();
