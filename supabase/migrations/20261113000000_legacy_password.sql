-- 옛 비밀번호 그대로 쓰기(2026-11-13 연구자: "그냥 재설정 안하고 그대로 쓸 수 있게 하고 싶은데 조금은 위험하더라도... 귀찮잖아").
-- 지금까지는 옛 값을 옮기지 않고 첫 로그인 때 메일 링크로 새로 정했다. 이제 옛 값(워드프레스 phpass, '$P$…')을 따로 표에 두고,
-- 처음 로그인할 때 서버 도우미 login-help(legacy_login)가 그 값으로 확인한다. 맞으면 같은 비밀번호를 새 방식(bcrypt)으로 저장하고
-- 옛 값 줄을 지운다. 로그인 서비스(Supabase Auth)는 bcrypt · Argon2 값만 받으므로 phpass 값을 auth.users 에 그대로 넣을 수 없다.
-- 메일 링크(비밀번호 잊음 · 처음 정하기)는 그대로 둔다. 링크로 정해도 옛 값 줄은 지운다(아래 트리거).
--
-- 새 비밀번호 저장을 로그인 서비스 관리자 API 대신 여기(pgcrypto bcrypt)서 하는 이유: 관리자 API 의 비밀번호 바꾸기는
-- 비밀번호 규칙(최소 길이 · 문자 종류)을 다시 검사해 짧은 옛 비밀번호를 거절한다(supabase/auth internal/api/admin.go adminUserUpdate →
-- checkPasswordStrength, 2026-11-13 원본 확인). 로그인 자체는 규칙에 안 맞는 비밀번호도 받는다(token.go: weak_password 표시만).
-- 이 프로젝트는 이미 auth.users 를 서버 함수에서 다룬다(admin_remove_user).
--
-- 막는 것: 옛 값 표 · 실패 기록은 서버 도우미(비밀 열쇠)만 읽고 쓴다(RLS 켬 · 정책 없음 · anon/authenticated 권한 회수).
-- 실패 한도: 계정마다 15분에 5번, 전체 한 시간 100번(여러 계정을 돌아가며 넣어 보는 것 막기). 넘으면 맞는 비밀번호도 15분 · 한 시간 동안 안 됨.

-- ------------------------------------------------------------ 표
create table public.legacy_passwords (
  user_id uuid primary key references auth.users (id) on delete cascade,
  hash text not null check (hash ~ '^\$[PH]\$[./0-9A-Za-z]{31}$'),
  source text not null default 'wp_users' check (source in ('wp_users', 'mb_users')),
  created_at timestamptz not null default now()
);
comment on table public.legacy_passwords is '옛 사이트 비밀번호 값(워드프레스 phpass). 첫 로그인 확인에만 쓰고 맞으면 지운다. 서버 도우미만 읽는다.';
alter table public.legacy_passwords enable row level security;
revoke all on public.legacy_passwords from public, anon, authenticated;

create table public.legacy_login_failures (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index legacy_login_failures_user_idx on public.legacy_login_failures (user_id, created_at);
create index legacy_login_failures_created_idx on public.legacy_login_failures (created_at);
alter table public.legacy_login_failures enable row level security;
revoke all on public.legacy_login_failures from public, anon, authenticated;

-- ------------------------------------------------------------ 서버 도우미만 부르는 함수
-- 아이디 또는 메일로 옛 값을 찾는다. '비밀번호 정하기 전'이고, 옛 값이 있고, 실패 한도 안일 때만 한 줄. 아니면 0줄.
create function public.legacy_password_for(p_login text)
returns table (user_id uuid, hash text)
language sql stable security definer set search_path = ''
as $$
  select l.user_id, l.hash
  from public.legacy_passwords l
  join public.profiles p on p.id = l.user_id
  join auth.users u on u.id = l.user_id
  where p.status = 'needs_password'
    and (p.username = lower(trim(p_login)) or lower(u.email) = lower(trim(p_login)))
    and (select count(*) from public.legacy_login_failures f
         where f.user_id = l.user_id and f.created_at > now() - interval '15 minutes') < 5
    and (select count(*) from public.legacy_login_failures f where f.created_at > now() - interval '1 hour') < 100
  order by (p.username = lower(trim(p_login))) desc
  limit 1
$$;

-- 틀린 비밀번호 한 번을 적는다(하루 지난 기록은 이때 지움)
create function public.legacy_login_failed(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.legacy_login_failures where created_at < now() - interval '1 day';
  insert into public.legacy_login_failures (user_id) values (p_user);
end
$$;

-- 옛 값이 맞았을 때: 같은 비밀번호를 bcrypt 로 저장하고(로그인 서비스가 읽는 '$2a$' 값), 상태를 정상으로, 옛 값 · 실패 기록을 지운다.
-- 비밀번호 확인은 부르는 쪽(login-help, phpass.ts)이 이미 했다. 그 사이 링크로 정했거나 옛 값이 없어졌으면 false.
-- bcrypt 는 72바이트까지만 보므로 그보다 긴 비밀번호는 받지 않는다(메일 링크로 정하게 함).
create function public.legacy_login_finish(p_user uuid, p_password text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_password is null or p_password = '' or octet_length(p_password) > 72 then return false; end if;
  if not exists (select 1 from public.legacy_passwords l join public.profiles p on p.id = l.user_id
                 where l.user_id = p_user and p.status = 'needs_password') then
    return false;
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
    where id = p_user;
  update public.profiles set status = 'active' where id = p_user and status = 'needs_password';
  delete from public.legacy_passwords where user_id = p_user;
  delete from public.legacy_login_failures where user_id = p_user;
  return true;
end
$$;

-- 메일 링크로 비밀번호를 정해도 옛 값은 더 쓸 일이 없으므로 지운다(20261024000000_init.sql 의 같은 함수에 한 줄 더함)
create or replace function private.handle_password_set() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password and new.encrypted_password is not null then
    update public.profiles set status = 'active' where id = new.id and status = 'needs_password';
    delete from public.legacy_passwords where user_id = new.id;
  end if;
  return new;
end
$$;

-- ------------------------------------------------------------ 권한
revoke all on function public.legacy_password_for(text), public.legacy_login_failed(uuid),
  public.legacy_login_finish(uuid, text), private.handle_password_set()
  from public, anon, authenticated;
grant execute on function public.legacy_password_for(text), public.legacy_login_failed(uuid),
  public.legacy_login_finish(uuid, text) to service_role;

-- ------------------------------------------------------------ 따로 할 일(이 파일 밖)
-- 1) 옮기기(5단계): migrate/convert.py 가 만든 legacy_passwords.json(이 Mac 전용)을 회원을 만든 직후 이 표에 넣는다(user_id = 새 회원 id).
-- 2) 공개 뒤 몇 달 지나 옛 값이 남은 계정이 적으면 이 표를 비우고(옛 값 삭제) 메일 링크만 남기는 것을 다시 정한다.
