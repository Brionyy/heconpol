-- 메일이 바뀐 옛 회원은 '새 메일로 가입 신청'(2026-11-02 연구자: 본인 확인 요청은 "기분나쁠수도 있을 것 같고 … 귀찮을 것 같은데", 시안 안 1 고름).
-- 가입 신청서에 '예전 홈페이지 아이디(선택)'를 받아 둔다. 관리자는 승인 목록에서 그 아이디의 계정과 나란히 보고
-- [예전 계정에 잇기]를 누른다. 그러면 서버 도우미 admin-account(link_old)가 신청을 지우고, 옛 계정 메일을 신청 메일로 바꾸고,
-- 옛 메일에 알린 뒤, 새 메일로 비밀번호 링크를 보낸다. 신청서에 적은 예전 아이디가 그 계정 아이디와 같을 때만(서버가 다시 봄).
-- 적은 값은 신청 본인이 쓴 글일 뿐이므로 로그인 · 권한에는 쓰지 않는다. 관리자 목록에서만 보인다.

alter table public.profiles add column old_username text
  check (old_username is null or char_length(old_username) between 1 and 40);
comment on column public.profiles.old_username is '가입 신청서에 적은 예전 홈페이지 아이디(선택, 본인이 쓴 글). 관리자 승인 목록에서만 보인다.';

-- 새 회원 줄: 20261028000000_admin_join.sql 과 같고 old_username 한 칸만 더함(옮겨 온 회원은 비움)
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  migrated boolean := coalesce((app ->> 'migrated')::boolean, false);
  uname text := lower(trim(coalesce(meta ->> 'username', app ->> 'username', '')));
  k text := coalesce(meta ->> 'kind', app ->> 'kind');
begin
  if not migrated and uname !~ '^[a-z0-9_]{4,20}$' then
    raise exception '아이디는 영문 소문자 · 숫자 · 밑줄로 4~20자입니다.' using errcode = '22023';
  end if;
  if k is null or k not in ('재학', '졸업', '교수', '기타') then k := '기타'; end if;
  insert into public.profiles (id, username, display_name, kind, intro, role, status, legacy_user_id, approved_at,
                               course, entry_year, show_email, old_username)
  values (
    new.id,
    uname,
    left(trim(coalesce(meta ->> 'display_name', app ->> 'display_name', '')), 30),
    k,
    left(trim(coalesce(meta ->> 'intro', '')), 100),
    case when migrated then 'member' else 'pending' end,
    case when migrated then 'needs_password' else 'active' end,
    case when migrated then (app ->> 'legacy_user_id')::bigint end,
    case when migrated then now() end,
    case when not migrated and k = '재학' then nullif(left(trim(coalesce(meta ->> 'course', '')), 20), '') end,
    case when not migrated and k = '재학' and (meta ->> 'entry_year') ~ '^(19|20)[0-9]{2}$' then (meta ->> 'entry_year')::integer end,
    not migrated and k = '재학' and coalesce(meta ->> 'show_email', '') = 'true',
    case when not migrated then nullif(left(regexp_replace(coalesce(meta ->> 'old_username', ''), '\s', '', 'g'), 40), '') end
  );
  return new;
end
$$;

-- 관리자 목록에 old_username 을 더한다(나머지는 20261028000000_admin_join.sql 과 같음)
drop function public.admin_list_profiles();
create function public.admin_list_profiles()
returns table (id uuid, username text, display_name text, kind text, intro text, role text, status text,
               created_at timestamptz, approved_at timestamptz, withdraw_requested_at timestamptz, cv_url text,
               course text, entry_year integer, show_email boolean, person_no integer, leaving_to uuid, legacy boolean,
               old_username text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query
    select p.id, p.username, p.display_name, p.kind, p.intro, p.role, p.status, p.created_at, p.approved_at,
           p.withdraw_requested_at, p.cv_url, p.course, p.entry_year, p.show_email, p.person_no, p.leaving_to,
           p.legacy_user_id is not null, p.old_username
    from public.profiles p order by (p.role = 'pending') desc, p.created_at desc;
end
$$;

revoke all on function public.admin_list_profiles() from public, anon, authenticated;
grant execute on function public.admin_list_profiles() to authenticated;
