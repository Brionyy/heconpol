-- 회원 글 임시저장 · 본문 그림(2026-10-27, 연구자: "등록, 수정, 임시저장 … 블로그 같이 작성하는 경우도 있으니까 이미지 복붙").
-- 1) 글 상태(status): 'draft'(임시저장, 글쓴이만 봄) · 'published'(올림). 임시저장 → 올림만 되고 거꾸로는 안 된다.
--    올리는 순간 쓴 때(created_at)를 지금으로 바꿔 목록 맨 위에 온다. 관리자도 남의 임시저장 글은 못 본다. 댓글은 올린 글에만.
-- 2) 본문 그림: 사진 칸(gallery)에 브라우저가 다시 저장한 JPEG 만 쓰고, 본문에는 lab:<경로> 로만 적는다
--    (바깥 주소 그림 · data: 그림은 화면이 거른다, 2_보안검토.md 3.1). 그래서 사진 칸 파일은 모든 게시판 글에 달 수 있다.
--    자료 칸(files)은 그대로 '첨부'가 예인 게시판(사진첩 빼고)에만.

alter table public.posts
  add column status text not null default 'published' check (status in ('draft', 'published'));
comment on column public.posts.status is 'draft = 임시저장(글쓴이만 봄), published = 올림. draft → published 만 된다.';
create index posts_drafts_idx on public.posts (author_id, updated_at desc) where status = 'draft';

-- 사진 칸 첨부는 JPEG 만(파일 칸 규칙과 같게)
alter table public.attachments
  add constraint attachments_gallery_jpeg check (bucket <> 'gallery' or mime = 'image/jpeg');

-- 화면이 넣고 바꿀 수 있는 칸: 상태 더함(제목 · 본문은 그대로)
grant insert (status) on public.posts to authenticated;
grant update (status) on public.posts to authenticated;

-- 쓸 때 고정하는 값 · 하루 한도에 상태 바꾸기 규칙을 더한다
create or replace function private.posts_before_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare me uuid := (select auth.uid());
begin
  if me is null then return new; end if;            -- 옮기기 도구(비밀 열쇠)는 그대로 둔다
  if tg_op = 'INSERT' then
    new.author_id := me;
    new.hidden := false;
    new.legacy_id := null;
    new.body_html_legacy := null;
    new.created_at := now();
    if (select count(*) from public.posts p where p.author_id = me and p.created_at > now() - interval '1 day') >= 30 then
      raise exception '하루에 글은 30개까지 쓸 수 있습니다.' using errcode = 'P0001';
    end if;
  else
    if old.status = 'published' and new.status = 'draft' then
      raise exception '올린 글은 임시저장으로 되돌릴 수 없습니다.' using errcode = 'P0001';
    end if;
    if old.status = 'draft' and new.status = 'published' then
      new.created_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.posts_before_write() from public, anon, authenticated;

-- 글 읽기: 내 글(임시저장 · 숨김 포함)은 늘 보이고, 남의 글은 올린 글만(숨긴 글은 관리자만)
drop policy posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated
  using ((select private.is_member())
         and (author_id = (select auth.uid())
              or (status = 'published' and (not hidden or (select private.my_role()) = 'admin'))));

-- 댓글은 올린 글에만
drop policy comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check ((select private.is_member()) and author_id = (select auth.uid())
              and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'));

-- 첨부: 사진 칸 그림은 모든 게시판 글에(본문 그림 · 사진첩), 자료 칸 파일은 첨부 허용 게시판(사진첩 빼고)에만
drop policy attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert to authenticated
  with check (
    (select private.is_member())
    and owner_id = (select auth.uid())
    and split_part(path, '/', 1) = (select auth.uid())::text
    and exists (
      select 1 from public.posts p join public.boards b on b.slug = p.board
      where p.id = post_id and p.author_id = (select auth.uid())
        and (bucket = 'gallery' or (bucket = 'files' and b.allow_files and not b.is_gallery))));

-- 글 목록용 모아 보기: 올린 글만. 첨부 수는 자료 칸만 세고, 그림 수는 따로 센다(끝에 칸 더함)
create or replace view public.post_list with (security_invoker = true) as
  select p.id, p.board, p.title, p.author_id,
         coalesce(pr.display_name, '탈퇴한 회원') as author_name,
         p.created_at, p.updated_at, p.hidden,
         (select count(*) from public.comments c where c.post_id = p.id and not c.hidden) as comment_count,
         (select count(*) from public.attachments a where a.post_id = p.id and a.bucket = 'files') as file_count,
         (select count(*) from public.attachments a where a.post_id = p.id and a.bucket = 'gallery') as image_count
  from public.posts p
  left join public.profiles pr on pr.id = p.author_id
  where p.status = 'published';
revoke all on public.post_list from public, anon, authenticated;
grant select on public.post_list to authenticated;

-- 3) 하루 파일 한도 30 → 100개(본문 그림이 첨부 · 사진과 같은 한도를 쓰므로). 남용 막기 한도는 그대로 둔다(글 30 · 댓글 100).
create or replace function private.attachments_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare me uuid := (select auth.uid());
begin
  if me is null then return new; end if;
  new.owner_id := me;
  new.created_at := now();
  if (select count(*) from public.attachments a where a.owner_id = me and a.created_at > now() - interval '1 day') >= 100 then
    raise exception '하루에 파일 · 그림은 100개까지 올릴 수 있습니다.' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function private.attachments_before_insert() from public, anon, authenticated;

drop policy lab_files_upload on storage.objects;
create policy lab_files_upload on storage.objects for insert to authenticated
  with check (bucket_id in ('gallery', 'files')
              and (select private.is_member())
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select private.my_uploads_today()) < 100);
