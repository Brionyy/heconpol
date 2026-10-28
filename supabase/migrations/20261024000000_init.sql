-- 회원 칸 빈 그릇(2026-10-24)
-- 회원 정보 · 게시판 · 글 · 댓글 · 첨부 · 관리 기록 표, 등급별 권한 규칙(RLS), 파일 칸(Storage) 규칙.
-- 근거: docs/1_큰틀.md 5절(등급), docs/2_보안검토.md 3.2 ~ 3.4절.
-- 등급: pending(승인 대기) · member(회원) · admin(관리자, 2명). 방문자(anon)는 회원 칸 표를 하나도 못 읽는다.
-- 메일 주소는 로그인 서비스 표(auth.users)에만 두고 여기에 다시 적지 않는다.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ------------------------------------------------------------ 표

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.@-]{2,60}$'),
  display_name text not null check (char_length(display_name) between 1 and 30),
  kind text not null default '기타' check (kind in ('재학', '졸업', '교수', '기타')),
  intro text not null default '' check (char_length(intro) <= 100),
  role text not null default 'pending' check (role in ('pending', 'member', 'admin')),
  status text not null default 'active' check (status in ('active', 'needs_password', 'locked')),
  legacy_user_id bigint unique,
  withdraw_requested_at timestamptz,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null
);
comment on table public.profiles is '회원 정보. 메일은 auth.users 에만 있다. 등급 · 상태는 관리자 함수만 바꾼다.';
create index profiles_role_idx on public.profiles (role);
create index profiles_approved_by_idx on public.profiles (approved_by);

create table public.boards (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,30}$'),
  name text not null check (char_length(name) between 1 and 30),
  allow_files boolean not null default false,
  is_gallery boolean not null default false,
  sort smallint not null default 0
);
comment on table public.boards is '회원 칸 게시판 목록. site/data/boards.csv 와 같게 둔다.';

create table public.posts (
  id bigint generated always as identity primary key,
  board text not null references public.boards (slug) on update cascade,
  title text not null check (char_length(title) between 1 and 200),
  body_md text not null default '' check (char_length(body_md) <= 20000),
  body_html_legacy text,
  author_id uuid references public.profiles (id) on delete set null,
  hidden boolean not null default false,
  legacy_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.posts.body_html_legacy is '옛 사이트(망보드)에서 옮긴 HTML. 옮길 때 한 번, 보여 줄 때 또 거른다.';
comment on column public.posts.author_id is '탈퇴하면 비어서 화면에 "탈퇴한 회원"으로 보인다.';
create index posts_board_created_idx on public.posts (board, created_at desc);
create index posts_author_created_idx on public.posts (author_id, created_at);
create unique index posts_legacy_idx on public.posts (board, legacy_id) where legacy_id is not null;

create table public.comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  hidden boolean not null default false,
  legacy_id bigint,
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_author_created_idx on public.comments (author_id, created_at);

-- 파일은 파일 칸(storage)에, 이 표는 어느 글의 어떤 파일인지만 적는다.
-- 글을 지울 때는 파일 칸의 파일을 먼저 지운다(SQL 로 행만 지우면 파일이 남는다).
create table public.attachments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  bucket text not null check (bucket in ('gallery', 'files')),
  path text not null unique check (path ~ '^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_.-]{1,120}$'),
  original_name text not null check (char_length(original_name) between 1 and 100),
  mime text not null check (mime in (
    'image/jpeg', 'application/pdf', 'application/x-hwp', 'application/x-hwpx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 20971520),
  created_at timestamptz not null default now()
);
create index attachments_post_idx on public.attachments (post_id);
create index attachments_owner_created_idx on public.attachments (owner_id, created_at);

create table public.admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index admin_log_created_idx on public.admin_log (created_at desc);
create index admin_log_admin_idx on public.admin_log (admin_id);

insert into public.boards (slug, name, allow_files, is_gallery, sort) values
  ('free', '자유게시판', true, false, 1),
  ('newcomer', '새식구 소개', false, false, 2),
  ('files', '자료실', true, false, 3),
  ('photos', '사진첩', false, true, 4);

-- ------------------------------------------------------------ 등급 확인(바깥에 안 보이는 칸)

-- 지금 로그인한 사람의 등급. 잠긴 계정 · 비밀번호 정하기 전 계정은 등급이 없다.
create function private.my_role() returns text
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.status = 'active'
$$;

create function private.is_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select private.my_role()) in ('member', 'admin'), false) $$;

-- 관리자이고 이번 로그인에서 2단계 인증(인증 앱)을 마쳤는가
create function private.is_admin_aal2() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select private.my_role()) = 'admin', false)
     and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
$$;

create function private.assert_admin() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce((select private.my_role()), '') <> 'admin' then
    raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
  if coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception '관리자는 2단계 인증을 마친 뒤에 할 수 있습니다.' using errcode = '42501';
  end if;
end
$$;

-- 오늘(24시간) 올린 파일 수. 파일 칸 규칙에서 쓴다.
create function private.my_uploads_today() returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*) from storage.objects o
  where o.owner_id = (select auth.uid())::text and o.created_at > now() - interval '1 day'
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.my_role(), private.is_member(), private.is_admin_aal2(), private.my_uploads_today()
  to authenticated;

-- ------------------------------------------------------------ 가입 · 옮기기

-- 가입 신청(auth.users 에 새 줄)이 오면 회원 정보를 '승인 대기'로 만든다.
-- 화면이 보낸 값(raw_user_meta_data)은 누구나 바꿀 수 있으므로 등급을 정하는 데 쓰지 않는다.
-- 옛 회원 옮기기는 비밀 열쇠로만 쓸 수 있는 raw_app_meta_data.migrated 로 표시한다.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  migrated boolean := coalesce((app ->> 'migrated')::boolean, false);
  uname text := lower(trim(coalesce(meta ->> 'username', app ->> 'username', '')));
begin
  if not migrated and uname !~ '^[a-z0-9_]{4,20}$' then
    raise exception '아이디는 영문 소문자 · 숫자 · 밑줄로 4~20자입니다.' using errcode = '22023';
  end if;
  insert into public.profiles (id, username, display_name, kind, intro, role, status, legacy_user_id, approved_at)
  values (
    new.id,
    uname,
    left(trim(coalesce(meta ->> 'display_name', app ->> 'display_name', '')), 30),
    case when coalesce(meta ->> 'kind', app ->> 'kind') in ('재학', '졸업', '교수', '기타')
         then coalesce(meta ->> 'kind', app ->> 'kind') else '기타' end,
    left(trim(coalesce(meta ->> 'intro', '')), 100),
    case when migrated then 'member' else 'pending' end,
    case when migrated then 'needs_password' else 'active' end,
    case when migrated then (app ->> 'legacy_user_id')::bigint end,
    case when migrated then now() end
  );
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- 옮겨 온 회원이 메일 링크로 비밀번호를 정하면 '정상'으로 바꾼다.
create function private.handle_password_set() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password and new.encrypted_password is not null then
    update public.profiles set status = 'active' where id = new.id and status = 'needs_password';
  end if;
  return new;
end
$$;
create trigger on_auth_password_set after update of encrypted_password on auth.users
  for each row execute function private.handle_password_set();

-- ------------------------------------------------------------ 쓸 때 고정하는 값 · 하루 한도

create function private.posts_before_write() returns trigger
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
  end if;
  new.updated_at := now();
  return new;
end
$$;
create trigger posts_before_write before insert or update on public.posts
  for each row execute function private.posts_before_write();

create function private.comments_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare me uuid := (select auth.uid());
begin
  if me is null then return new; end if;
  new.author_id := me;
  new.hidden := false;
  new.legacy_id := null;
  new.created_at := now();
  if (select count(*) from public.comments c where c.author_id = me and c.created_at > now() - interval '1 day') >= 100 then
    raise exception '하루에 댓글은 100개까지 쓸 수 있습니다.' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger comments_before_insert before insert on public.comments
  for each row execute function private.comments_before_insert();

create function private.attachments_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare me uuid := (select auth.uid());
begin
  if me is null then return new; end if;
  new.owner_id := me;
  new.created_at := now();
  if (select count(*) from public.attachments a where a.owner_id = me and a.created_at > now() - interval '1 day') >= 30 then
    raise exception '하루에 파일은 30개까지 올릴 수 있습니다.' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger attachments_before_insert before insert on public.attachments
  for each row execute function private.attachments_before_insert();

-- ------------------------------------------------------------ 권한: 표 단위 · 칸 단위

revoke all on public.profiles, public.boards, public.posts, public.comments, public.attachments, public.admin_log
  from public, anon, authenticated;

grant select on public.boards to authenticated;
grant select (id, display_name, kind, role) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, delete on public.posts to authenticated;
grant insert (board, title, body_md) on public.posts to authenticated;
grant update (title, body_md) on public.posts to authenticated;
grant select, delete on public.comments to authenticated;
grant insert (post_id, body) on public.comments to authenticated;
grant select, delete on public.attachments to authenticated;
grant insert (post_id, bucket, path, original_name, mime, size_bytes) on public.attachments to authenticated;
grant select on public.admin_log to authenticated;

-- ------------------------------------------------------------ 권한: 줄 단위(RLS)

alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.admin_log enable row level security;

-- 회원 정보: 승인 대기는 자기 것만, 회원은 모두의 이름만(칸 권한), 고치기는 자기 이름만
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_member()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select private.is_member()))
  with check (id = (select auth.uid()));

create policy boards_select on public.boards for select to authenticated
  using ((select private.is_member()));

-- 글: 숨긴 글은 관리자와 글쓴이만 본다
create policy posts_select on public.posts for select to authenticated
  using ((select private.is_member())
         and (not hidden or author_id = (select auth.uid()) or (select private.my_role()) = 'admin'));
create policy posts_insert on public.posts for insert to authenticated
  with check ((select private.is_member()) and author_id = (select auth.uid()));
create policy posts_update_own on public.posts for update to authenticated
  using ((select private.is_member()) and author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
create policy posts_delete on public.posts for delete to authenticated
  using (((select private.is_member()) and author_id = (select auth.uid())) or (select private.is_admin_aal2()));

create policy comments_select on public.comments for select to authenticated
  using ((select private.is_member())
         and (not hidden or (select private.my_role()) = 'admin')
         and exists (select 1 from public.posts p where p.id = post_id));
create policy comments_insert on public.comments for insert to authenticated
  with check ((select private.is_member()) and author_id = (select auth.uid())
              and exists (select 1 from public.posts p where p.id = post_id));
create policy comments_delete on public.comments for delete to authenticated
  using (((select private.is_member()) and author_id = (select auth.uid())) or (select private.is_admin_aal2()));

-- 첨부: 볼 수 있는 글의 첨부만. 자기 글에, 자기 폴더 파일만 단다. 사진첩 글에는 사진만, 첨부 허용 게시판에는 자료만.
create policy attachments_select on public.attachments for select to authenticated
  using ((select private.is_member()) and exists (select 1 from public.posts p where p.id = post_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (
    (select private.is_member())
    and owner_id = (select auth.uid())
    and split_part(path, '/', 1) = (select auth.uid())::text
    and exists (
      select 1 from public.posts p join public.boards b on b.slug = p.board
      where p.id = post_id and p.author_id = (select auth.uid())
        and ((bucket = 'gallery' and b.is_gallery) or (bucket = 'files' and b.allow_files and not b.is_gallery))));
create policy attachments_delete on public.attachments for delete to authenticated
  using (((select private.is_member()) and owner_id = (select auth.uid())) or (select private.is_admin_aal2()));

create policy admin_log_select on public.admin_log for select to authenticated
  using ((select private.my_role()) = 'admin');

-- 글 목록용 모아 보기: 부르는 사람의 권한 규칙을 그대로 따른다(security_invoker)
create view public.post_list with (security_invoker = true) as
  select p.id, p.board, p.title, p.author_id,
         coalesce(pr.display_name, '탈퇴한 회원') as author_name,
         p.created_at, p.updated_at, p.hidden,
         (select count(*) from public.comments c where c.post_id = p.id and not c.hidden) as comment_count,
         (select count(*) from public.attachments a where a.post_id = p.id) as file_count
  from public.posts p
  left join public.profiles pr on pr.id = p.author_id;
revoke all on public.post_list from public, anon, authenticated;
grant select on public.post_list to authenticated;

-- ------------------------------------------------------------ 화면이 부르는 함수

-- 내 정보(메일 포함, 나만)
create function public.my_profile()
returns table (username text, display_name text, kind text, role text, status text, email text,
               created_at timestamptz, withdraw_requested_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.username, p.display_name, p.kind, p.role, p.status, u.email::text, p.created_at, p.withdraw_requested_at
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = (select auth.uid())
$$;

create function public.request_withdraw() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select private.is_member()) then raise exception '회원만 할 수 있습니다.' using errcode = '42501'; end if;
  update public.profiles set withdraw_requested_at = coalesce(withdraw_requested_at, now()) where id = (select auth.uid());
end
$$;

-- ------------------------------------------------------------ 관리자 함수(2단계 인증 필수, 모두 기록)

create function public.admin_list_profiles()
returns table (id uuid, username text, display_name text, kind text, intro text, role text, status text,
               created_at timestamptz, approved_at timestamptz, withdraw_requested_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query
    select p.id, p.username, p.display_name, p.kind, p.intro, p.role, p.status, p.created_at, p.approved_at, p.withdraw_requested_at
    from public.profiles p order by (p.role = 'pending') desc, p.created_at desc;
end
$$;

create function public.admin_approve(target uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  update public.profiles set role = 'member', approved_at = now(), approved_by = (select auth.uid())
  where id = target and role = 'pending';
  if not found then raise exception '승인할 신청이 없습니다.' using errcode = 'P0002'; end if;
  insert into public.admin_log (admin_id, action, target) values ((select auth.uid()), '가입 승인', target::text);
end
$$;

create function public.admin_reject(target uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  if not exists (select 1 from public.profiles where id = target and role = 'pending') then
    raise exception '거절할 신청이 없습니다.' using errcode = 'P0002';
  end if;
  delete from auth.users where id = target;
  insert into public.admin_log (admin_id, action, target) values ((select auth.uid()), '가입 거절', target::text);
end
$$;

create function public.admin_set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare old_role text;
begin
  perform private.assert_admin();
  if new_role not in ('member', 'admin') then raise exception '등급은 회원 · 관리자만 고를 수 있습니다.' using errcode = '22023'; end if;
  if target = (select auth.uid()) then raise exception '내 등급은 다른 관리자가 바꿔야 합니다.' using errcode = '42501'; end if;
  select role into old_role from public.profiles where id = target for update;
  if old_role is null or old_role = 'pending' then raise exception '바꿀 수 없는 회원입니다.' using errcode = 'P0002'; end if;
  if new_role = 'admin' and old_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') >= 2 then
    raise exception '관리자는 두 명까지입니다.' using errcode = 'P0001';
  end if;
  update public.profiles set role = new_role where id = target;
  insert into public.admin_log (admin_id, action, target, detail)
    values ((select auth.uid()), '등급 바꿈', target::text, old_role || ' → ' || new_role);
end
$$;

create function public.admin_set_status(target uuid, new_status text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  if new_status not in ('active', 'locked') then raise exception '바꿀 수 없는 상태입니다.' using errcode = '22023'; end if;
  if target = (select auth.uid()) then raise exception '내 계정은 잠글 수 없습니다.' using errcode = '42501'; end if;
  update public.profiles set status = new_status where id = target and status <> 'needs_password';
  if not found then raise exception '바꿀 수 없는 회원입니다.' using errcode = 'P0002'; end if;
  insert into public.admin_log (admin_id, action, target) values ((select auth.uid()),
    case new_status when 'locked' then '계정 잠금' else '잠금 풂' end, target::text);
end
$$;

create function public.admin_set_hidden(post bigint, hide boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  update public.posts set hidden = hide where id = post;
  if not found then raise exception '없는 글입니다.' using errcode = 'P0002'; end if;
  insert into public.admin_log (admin_id, action, target) values ((select auth.uid()),
    case when hide then '글 숨김' else '글 다시 보임' end, 'post:' || post);
end
$$;

-- 탈퇴 처리: 이 회원의 파일을 파일 칸에서 먼저 지운 뒤 부른다. 글은 남고 글쓴이가 비어 '탈퇴한 회원'이 된다.
create function public.admin_remove_user(target uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  if target = (select auth.uid()) then raise exception '내 계정은 다른 관리자가 지워야 합니다.' using errcode = '42501'; end if;
  if exists (select 1 from storage.objects o where o.owner_id = target::text) then
    raise exception '먼저 이 회원이 올린 파일을 지워야 합니다.' using errcode = 'P0001';
  end if;
  delete from public.attachments where owner_id = target;
  delete from auth.users where id = target;
  insert into public.admin_log (admin_id, action, target) values ((select auth.uid()), '회원 지움(탈퇴)', target::text);
end
$$;

-- 아이디로 로그인: 작은 서버 함수(Edge Function, 비밀 열쇠)만 부른다. 화면은 못 부른다.
create function public.login_email_for(login text) returns text
language sql stable security definer set search_path = ''
as $$
  select u.email::text from public.profiles p join auth.users u on u.id = p.id
  where p.username = lower(trim(login)) and p.status in ('active', 'needs_password')
$$;

-- 승인하지 않은 신청 30일 뒤 지우기: Supabase 에서 pg_cron 으로 하루 한 번 부른다(아래 설명).
create function private.delete_stale_pending() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from auth.users u using public.profiles p
  where p.id = u.id and p.role = 'pending' and p.created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.my_profile(), public.request_withdraw(), public.admin_list_profiles(),
  public.admin_approve(uuid), public.admin_reject(uuid), public.admin_set_role(uuid, text),
  public.admin_set_status(uuid, text), public.admin_set_hidden(bigint, boolean), public.admin_remove_user(uuid),
  public.login_email_for(text), private.delete_stale_pending(), private.handle_new_user(), private.handle_password_set(),
  private.posts_before_write(), private.comments_before_insert(), private.attachments_before_insert(), private.assert_admin()
  from public, anon, authenticated;
grant execute on function public.my_profile(), public.request_withdraw(), public.admin_list_profiles(),
  public.admin_approve(uuid), public.admin_reject(uuid), public.admin_set_role(uuid, text),
  public.admin_set_status(uuid, text), public.admin_set_hidden(bigint, boolean), public.admin_remove_user(uuid)
  to authenticated;
grant execute on function public.login_email_for(text) to service_role;

-- ------------------------------------------------------------ 파일 칸(Storage)
-- 두 칸 모두 비공개. 보여 줄 때 몇 분만 유효한 주소(사진 600초, 자료 60초)를 만든다.
-- 고치기(update) 규칙은 만들지 않는다(덮어쓰기 금지). 지우기는 Storage API 로 한다.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('gallery', 'gallery', false, 3145728, array['image/jpeg']),
  ('files', 'files', false, 20971520, array[
    'application/pdf', 'application/x-hwp', 'application/x-hwpx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

create policy lab_files_read on storage.objects for select to authenticated
  using (bucket_id in ('gallery', 'files')
         and (select private.is_member())
         and (owner_id = (select auth.uid())::text
              or exists (select 1 from public.attachments a where a.bucket = bucket_id and a.path = name)));

create policy lab_files_upload on storage.objects for insert to authenticated
  with check (bucket_id in ('gallery', 'files')
              and (select private.is_member())
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select private.my_uploads_today()) < 30);

create policy lab_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('gallery', 'files')
         and (owner_id = (select auth.uid())::text or (select private.is_admin_aal2())));

-- ------------------------------------------------------------ Supabase 화면에서 따로 할 일(이 파일 밖)
-- 1) pg_cron 켜고: select cron.schedule('delete-stale-pending', '30 3 * * *', 'select private.delete_stale_pending()');
-- 2) Authentication: 가입 켬(가입 신청을 받으므로), 가입 확인 메일 끔(관리자 승인으로 거름, 2026-10-24 결정), Email OTP Expiration 3600초, 비밀번호 10자 · 영문+숫자,
--    Site URL https://heconpol.org, Redirect URLs 는 /login/reset/ 만.
-- 3) 공개 전 Security Advisor 경고 0 확인.
