-- 2026-11-24 탈퇴하거나 옛 사이트에서 옮긴 글도 글쓴이 이름이 보이게 한다(연구자 결정).
-- 글 · 댓글에 글쓴이 이름 칸(author_name)을 두고, 쓸 때 그 회원의 이름을 함께 남긴다.
-- 화면에 보이는 이름 차례: 지금 계정 이름 → 남겨 둔 이름 → '탈퇴한 회원'.
-- 탈퇴한 사람이 이름을 지워 달라고 하면 관리자가 탈퇴 처리 때 '이름도 지움'을 고르거나(admin_remove_user 둘째 값),
-- 탈퇴 뒤 요청이면 서버 관리 화면(SQL)에서 그 글 · 댓글의 author_name 을 비운다(docs/DECISIONS.md 2026-11-24).

alter table public.posts add column if not exists author_name text
  check (author_name is null or char_length(author_name) between 1 and 40);
alter table public.comments add column if not exists author_name text
  check (author_name is null or char_length(author_name) between 1 and 40);
comment on column public.posts.author_name is '쓸 때 남긴 글쓴이 이름. 계정이 없어져도(탈퇴 · 옛 글) 이 이름으로 보인다.';
comment on column public.comments.author_name is '쓸 때 남긴 글쓴이 이름. 계정이 없어져도(탈퇴 · 옛 글) 이 이름으로 보인다.';
comment on column public.posts.author_id is '탈퇴하면 비고, 화면에는 author_name(없으면 "탈퇴한 회원")이 보인다.';

-- 이미 있는 글 · 댓글: 지금 계정 이름을 남겨 둔다
update public.posts p set author_name = pr.display_name
  from public.profiles pr where pr.id = p.author_id and p.author_name is null;
update public.comments c set author_name = pr.display_name
  from public.profiles pr where pr.id = c.author_id and c.author_name is null;

-- 쓸 때 이름 남기기. 화면은 이 칸을 직접 쓸 수 없고(쓰기 허용 칸 목록에 없음) 서버가 채운다.
-- 트리거 이름 차례(posts_before_write → posts_set_author_name)대로 글쓴이가 정해진 뒤에 돈다.
-- 옮기기 도구(비밀 열쇠, auth.uid() 없음)가 이름만 넣은 옛 글은 그대로 둔다.
create or replace function private.set_author_name() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.author_id is not null then
    new.author_name := coalesce((select pr.display_name from public.profiles pr where pr.id = new.author_id), new.author_name);
  end if;
  return new;
end
$$;
revoke all on function private.set_author_name() from public, anon, authenticated;

drop trigger if exists posts_set_author_name on public.posts;
create trigger posts_set_author_name before insert on public.posts
  for each row execute function private.set_author_name();
drop trigger if exists comments_set_author_name on public.comments;
create trigger comments_set_author_name before insert on public.comments
  for each row execute function private.set_author_name();

-- 탈퇴 처리: 지우기 직전 이름을 한 번 더 남긴다(이름을 바꾼 뒤 탈퇴한 경우 최근 이름).
-- keep_name = false 면(본인이 이름 삭제를 원할 때) 남긴 이름을 비워 '탈퇴한 회원'으로 보이게 한다.
drop function if exists public.admin_remove_user(uuid);
create function public.admin_remove_user(target uuid, keep_name boolean default true) returns void
language plpgsql security definer set search_path = ''
as $$
declare nm text := (select pr.display_name from public.profiles pr where pr.id = target);
begin
  perform private.assert_admin();
  if target = (select auth.uid()) then raise exception '내 계정은 다른 관리자가 지워야 합니다.' using errcode = '42501'; end if;
  if exists (select 1 from storage.objects o where o.owner_id = target::text) then
    raise exception '먼저 이 회원이 올린 파일을 지워야 합니다.' using errcode = 'P0001';
  end if;
  update public.posts set author_name = case when keep_name then nm end where author_id = target;
  update public.comments set author_name = case when keep_name then nm end where author_id = target;
  delete from public.attachments where owner_id = target;
  delete from auth.users where id = target;
  insert into public.admin_log (admin_id, action, target, detail) values ((select auth.uid()),
    '회원 지움(탈퇴)', target::text, case when keep_name then '글쓴이 이름 남김' else '글쓴이 이름도 지움' end);
end
$$;
revoke all on function public.admin_remove_user(uuid, boolean) from public, anon;
grant execute on function public.admin_remove_user(uuid, boolean) to authenticated;

-- 글 목록: 이름 차례만 바꾼다(칸 차례 그대로)
create or replace view public.post_list with (security_invoker = true) as
  select p.id, p.board, p.title, p.author_id,
         coalesce(pr.display_name, p.author_name, '탈퇴한 회원') as author_name,
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

-- 댓글 목록: 남긴 이름 칸을 끝에 더한다
create or replace view public.comment_list with (security_invoker = true) as
select c.id, c.post_id, c.body, c.author_id, c.created_at, c.hidden,
       private.comment_avatar(c.author_id) as avatar_id,
       c.author_name
from public.comments c;
revoke all on public.comment_list from public, anon, authenticated;
grant select on public.comment_list to authenticated;
