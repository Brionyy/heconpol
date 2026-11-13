-- 보안 검토 5인(2026-11-02, docs/2026-11-02_보안검토_5인/합친결과_해결방안.html) 반영.
-- 1) 관리자 읽기도 2단계 인증 뒤에만: 관리 기록 · 숨긴 글 · '관리자만' 글 · 숨긴 댓글 · 댓글 막힌 글에 댓글.
--    관리자 비밀번호만 새어도 숨긴 자료를 못 읽게 한다(고치기 · 지우기는 이미 2단계 인증 뒤에만).
-- 2) 첨부의 원래 이름: 확장자가 파일 형식과 맞아야 하고, 글자 방향을 뒤집는 숨은 글자 · 제어 글자는 안 됨.
--    (우리 화면을 거치지 않고 '보고서.pdf'처럼 보이는 실행 파일 이름을 붙여 퍼뜨리는 것을 막는다.)
-- 3) 파일 칸 세 개의 설정(비공개 · 크기 한도 · 형식)을 "이미 있으면 그대로 둠"이 아니라 늘 이 값으로 맞춘다.

-- ------------------------------------------------------------ 1) 관리자 읽기
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated
  using ((select private.is_member())
         and (author_id = (select auth.uid())
              or (status = 'published'
                  and (not hidden or (select private.is_admin_aal2()))
                  and (visibility = 'members' or (select private.is_admin_aal2())))));

drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated
  using ((select private.is_member())
         and (not hidden or (select private.is_admin_aal2()))
         and exists (select 1 from public.posts p where p.id = post_id));

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check ((select private.is_member()) and author_id = (select auth.uid())
              and exists (select 1 from public.posts p
                          where p.id = post_id and p.status = 'published'
                            and (p.allow_comments or (select private.is_admin_aal2()))));

drop policy if exists admin_log_select on public.admin_log;
create policy admin_log_select on public.admin_log for select to authenticated
  using ((select private.is_admin_aal2()));

-- ------------------------------------------------------------ 2) 첨부의 원래 이름
alter table public.attachments add constraint attachments_name_safe check (
  original_name !~ '[\u0000-\u001F\u007F؜‎‏‪-‮⁦-⁩]');
alter table public.attachments add constraint attachments_name_ext check (
  case mime
    when 'image/jpeg' then lower(original_name) ~ '\.(jpg|jpeg)$'
    when 'application/pdf' then lower(original_name) ~ '\.pdf$'
    when 'application/x-hwp' then lower(original_name) ~ '\.hwp$'
    when 'application/x-hwpx' then lower(original_name) ~ '\.hwpx$'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then lower(original_name) ~ '\.docx$'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then lower(original_name) ~ '\.xlsx$'
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then lower(original_name) ~ '\.pptx$'
    else false
  end);

-- ------------------------------------------------------------ 3) 파일 칸 설정
update storage.buckets set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg']
  where id = 'gallery';
update storage.buckets set public = false, file_size_limit = 20971520, allowed_mime_types = array[
    'application/pdf', 'application/x-hwp', 'application/x-hwpx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation']
  where id = 'files';
update storage.buckets set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg']
  where id = 'profile-photos';
