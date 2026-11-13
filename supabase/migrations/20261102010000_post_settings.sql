-- 회원 글 '올리기 설정' 다섯 가지(2026-11-02, 글쓰기 시안 A 다음 차례: 태그 · 대표 사진 · 공개 범위 · 댓글 허용 · 위에 고정).
-- 1) 태그(tags): 글마다 0~5개, 하나에 1~20자. 앞뒤 빈칸 · 앞의 '#'을 떼고 같은 것은 하나로 줄인 뒤 센다(아래 트리거).
-- 2) 대표 사진(cover_path): 이 글의 사진 칸(gallery) 첨부 경로이거나 비움. 게시판 목록 줄 왼쪽 작은 그림.
--    글 줄을 먼저 넣고 첨부 줄을 넣은 뒤에 정하므로, 새 글은 저장 순서가 '글 넣기 → 첨부 넣기 → cover_path 고치기'다.
--    첨부를 빼서 경로가 없어지면 목록 모아 보기는 그 그림을 내보내지 않는다(글 줄의 값은 남음).
-- 3) 공개 범위(visibility): 'members'(회원 전체) · 'admins'(관리자만: 글쓴이와 관리자만 읽음).
--    댓글 · 첨부 · 파일 칸 그림 읽기 규칙은 모두 '읽을 수 있는 글'(posts 규칙)을 거쳐 보므로 posts_select 하나만 바꾸면 함께 막힌다.
-- 4) 댓글 허용(allow_comments): 끄면 관리자 말고는 댓글을 못 단다(글쓴이도). 이미 달린 댓글은 그대로 보인다.
-- 5) 위에 고정(pinned): 관리자만 켜고 끈다(2단계 인증을 마친 관리자). 회원이 켜거나 바꾸려 하면 거절.
-- 근거: docs/DECISIONS.md 11-02 글쓰기 절 '다음', docs/2_보안검토.md 3.x 권한 표.

alter table public.posts
  add column tags text[] not null default '{}' check (cardinality(tags) <= 5),
  add column cover_path text check (cover_path is null or cover_path ~ '^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_.-]{1,120}$'),
  add column visibility text not null default 'members' check (visibility in ('members', 'admins')),
  add column allow_comments boolean not null default true,
  add column pinned boolean not null default false;
comment on column public.posts.tags is '태그 0~5개, 하나에 1~20자(''#'' · 앞뒤 빈칸 없이, 겹침 없음). 트리거가 다듬는다.';
comment on column public.posts.cover_path is '대표 사진: 이 글의 gallery 첨부 경로이거나 null. 화면은 고르지 않으면 본문 첫 사진을 넣는다.';
comment on column public.posts.visibility is 'members = 회원 전체, admins = 글쓴이와 관리자만 읽음.';
comment on column public.posts.allow_comments is 'false 면 관리자 말고는 댓글을 못 단다. 이미 달린 댓글은 보인다.';
comment on column public.posts.pinned is '게시판 목록 맨 위 고정. 관리자(2단계 인증)만 바꾼다.';
create index posts_board_pinned_idx on public.posts (board, pinned desc, created_at desc) where status = 'published';
create index posts_tags_idx on public.posts using gin (tags);

-- 화면이 넣고 바꿀 수 있는 칸에 다섯 칸을 더한다(고정 칸도 열어 두고 트리거가 관리자만 통과시킨다)
grant insert (tags, cover_path, visibility, allow_comments, pinned) on public.posts to authenticated;
grant update (tags, cover_path, visibility, allow_comments, pinned) on public.posts to authenticated;

-- ------------------------------------------------------------ 쓸 때 다듬고 거르는 트리거
-- 이름 차례로 posts_before_write(글쓴이 · 상태 고정) 다음에 돈다.
create function private.posts_settings_before_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare me uuid := (select auth.uid());
begin
  -- 태그 다듬기(옮기기 도구도 같게): 앞뒤 빈칸 · 앞의 '#' 떼기 → 빈 것 빼기 → 같은 것은 처음 것만, 들어온 차례대로
  select coalesce(array_agg(t order by o), '{}') into new.tags
  from (select t, min(o) o
        from (select btrim(ltrim(btrim(x), '#')) t, o from unnest(coalesce(new.tags, '{}')) with ordinality u(x, o)) a
        where t is not null and t <> ''
        group by t) d;
  if cardinality(new.tags) > 5 then
    raise exception '태그는 글마다 5개까지입니다.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.tags) t where char_length(t) > 20) then
    raise exception '태그 하나는 20자까지입니다.' using errcode = '22023';
  end if;

  if me is null then return new; end if;            -- 옮기기 도구(비밀 열쇠)는 그대로 둔다

  -- 위에 고정: 새로 켜거나 값을 바꾸는 것은 2단계 인증을 마친 관리자만
  if (tg_op = 'INSERT' and new.pinned) or (tg_op = 'UPDATE' and new.pinned is distinct from old.pinned) then
    if not (select private.is_admin_aal2()) then
      raise exception '위에 고정은 관리자만 켜고 끌 수 있습니다.' using errcode = '42501';
    end if;
  end if;

  -- 대표 사진: 바뀔 때만 본다. 이 글에 달린 사진 칸 첨부 경로여야 한다(남의 글 · 남의 폴더 경로 거절)
  if new.cover_path is not null and (tg_op = 'INSERT' or new.cover_path is distinct from old.cover_path) then
    if not exists (select 1 from public.attachments a
                   where a.post_id = new.id and a.bucket = 'gallery' and a.path = new.cover_path) then
      raise exception '대표 사진은 이 글 본문에 넣은 사진에서만 고를 수 있습니다.' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.posts_settings_before_write() from public, anon, authenticated;
create trigger posts_settings_before_write before insert or update on public.posts
  for each row execute function private.posts_settings_before_write();

-- ------------------------------------------------------------ 읽기 · 댓글 규칙

-- 글 읽기: 내 글은 늘. 남의 글은 올린 글만, 숨긴 글 · '관리자만' 글은 관리자만
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated
  using ((select private.is_member())
         and (author_id = (select auth.uid())
              or (status = 'published'
                  and (not hidden or (select private.my_role()) = 'admin')
                  and (visibility = 'members' or (select private.my_role()) = 'admin'))));

-- 댓글은 올린 글에만, 댓글을 받는 글에만(관리자는 막힌 글에도 단다). 읽을 수 없는 글은 위 규칙으로 이미 빠진다
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check ((select private.is_member()) and author_id = (select auth.uid())
              and exists (select 1 from public.posts p
                          where p.id = post_id and p.status = 'published'
                            and (p.allow_comments or (select private.my_role()) = 'admin')));

-- 글 목록용 모아 보기: 끝에 다섯 칸을 더한다(앞 칸 차례는 그대로). 대표 사진은 아직 달린 사진일 때만 내보낸다
create or replace view public.post_list with (security_invoker = true) as
  select p.id, p.board, p.title, p.author_id,
         coalesce(pr.display_name, '탈퇴한 회원') as author_name,
         p.created_at, p.updated_at, p.hidden,
         (select count(*) from public.comments c where c.post_id = p.id and not c.hidden) as comment_count,
         (select count(*) from public.attachments a where a.post_id = p.id and a.bucket = 'files') as file_count,
         (select count(*) from public.attachments a where a.post_id = p.id and a.bucket = 'gallery') as image_count,
         p.tags,
         (select a.path from public.attachments a where a.post_id = p.id and a.bucket = 'gallery' and a.path = p.cover_path) as cover_path,
         p.visibility, p.allow_comments, p.pinned
  from public.posts p
  left join public.profiles pr on pr.id = p.author_id
  where p.status = 'published';
revoke all on public.post_list from public, anon, authenticated;
grant select on public.post_list to authenticated;
-- 화면은 post_list 를 'pinned desc, created_at desc' 차례로, 태그로 거를 때는 tags @> array[태그] 로 부른다.
