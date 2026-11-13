-- 관리 화면 · 가입 흐름(2026-10-28, 설계서 docs/2026-10-28_plan_관리화면_가입.md 2판, 연구자 승인).
-- 연구자: "관리자는 나만있는 게 아니라 이후 조교들에게 넘길 것이기 떄문에 사이트 상에서 정보를 수정하는 것이 UI 상으로 편하게",
--         "회원가입은 이전에 계셧던 분들이 헷갈리지 않게".
-- 1) 가입 신청에 과정 · 입학 연도 · '구성원 화면에 메일 공개' 동의(재학생만, 처음엔 꺼짐. 10-28 연구자 선택)
-- 2) 회원 ↔ 구성원 카드를 뜻 없는 '번호'로 잇는다(공개 표 people.csv · alumni.csv 에는 번호만, 누구와 이어졌는지는 여기에만).
--    CV 공개 목록도 이름 대신 번호로(회원이 이름을 남의 이름으로 바꿔 남의 카드에 CV 를 붙이던 구멍을 막음)
-- 3) 본인 확인 요청(아이디 · 메일을 모르는 옛 회원, 로그인 없이). 같은 메일 하루 3건, 30일 뒤 지움
-- 4) 구분 바꾸기, 탈퇴 요청 취소, 회원 메일 보기(관리자, 2단계 인증)
-- 5) 관리자 넘기기: 새 사람은 바로 관리자, 나는 새 사람이 2단계 인증으로 한 번 들어온 뒤 회원(일할 관리자가 0명이 되지 않게)
-- 6) 관리 기록에 사이트 내용 고침(파일별 판 표시 · 공개 결과 · 되돌림) 칸
-- 비밀 열쇠가 필요한 일(메일 바꾸기 · 탈퇴 처리 · 사이트 내용 고침 · 로그인 없이 링크 받기)은 작은 서버 도우미(supabase/functions)가 한다.

-- ------------------------------------------------------------ 회원 정보 칸 더하기

alter table public.profiles
  add column course text check (course is null or char_length(course) between 1 and 20),
  add column entry_year integer check (entry_year is null or entry_year between 1980 and 2100),
  add column show_email boolean not null default false,
  add column person_no integer unique check (person_no is null or person_no between 1 and 999999),
  add column leaving_to uuid references public.profiles (id) on delete set null;
comment on column public.profiles.course is '가입 때 적은 과정(재학생). 승인 때 구성원 카드 초안에 쓴다.';
comment on column public.profiles.show_email is '가입 때 "구성원 화면에 이 메일 보이기"를 켰는가(처음엔 꺼짐).';
comment on column public.profiles.person_no is '공개 표(people.csv · alumni.csv) 번호 칸과 잇는 값. 관리자만 바꾼다.';
comment on column public.profiles.leaving_to is '관리자 넘기는 중: 넘겨받는 사람. 그 사람이 2단계 인증으로 들어오면 이 사람은 회원이 된다.';
create index profiles_leaving_to_idx on public.profiles (leaving_to);
-- 새 칸은 화면이 바로 읽거나 고치지 못한다(칸 권한을 주지 않음). 관리자 함수로만.

-- 가입 신청: 과정 · 입학 연도 · 메일 공개 동의를 받는다(등급 · 상태는 여전히 화면이 보낸 값으로 정하지 않음).
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
                               course, entry_year, show_email)
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
    not migrated and k = '재학' and coalesce(meta ->> 'show_email', '') = 'true'
  );
  return new;
end
$$;

-- ------------------------------------------------------------ 본인 확인 요청(로그인 없이)

create table public.help_requests (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 30),
  email text not null check (char_length(email) <= 120 and email ~ '^[^[:space:]@,;<>"]+@[^[:space:]@,;<>"]+\.[^[:space:]@,;<>"]+$'),
  kind text not null default '기타' check (kind in ('재학', '졸업', '교수', '기타')),
  course text not null default '' check (char_length(course) <= 20),
  year text not null default '' check (year = '' or year ~ '^(19|20)[0-9]{2}$'),
  message text not null default '' check (char_length(message) <= 200),
  over_limit boolean not null default false,
  status text not null default 'open' check (status in ('open', 'done')),
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  handled_note text not null default '' check (char_length(handled_note) <= 200),
  created_at timestamptz not null default now()
);
comment on table public.help_requests is '아이디 · 메일을 모르는 옛 회원의 본인 확인 요청. 화면은 직접 못 읽고 함수로만 넣고 본다. 30일 뒤 지움.';
create index help_requests_email_idx on public.help_requests (email, created_at);
create index help_requests_created_idx on public.help_requests (created_at);
create index help_requests_handled_by_idx on public.help_requests (handled_by);
alter table public.help_requests enable row level security;   -- 규칙을 하나도 두지 않아 화면은 못 읽고 못 쓴다
revoke all on public.help_requests from public, anon, authenticated;

-- 같은 메일은 하루 3건까지. 전체가 하루 30건을 넘으면 받되 '많음' 표시(관리자에게 사람 확인 장치를 켜라고 알림), 100건이면 그날은 안 받음.
create function public.submit_help_request(p_name text, p_email text, p_kind text, p_course text, p_year text, p_message text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare mail text := lower(trim(coalesce(p_email, '')));
begin
  if (select count(*) from public.help_requests where email = mail and created_at > now() - interval '1 day') >= 3 then
    raise exception '같은 메일로는 하루 세 번까지 보낼 수 있습니다. 조교가 확인할 때까지 기다려 주십시오.' using errcode = 'P0001';
  end if;
  -- 메일을 바꿔 가며 끝없이 넣지 못하게 하루 전체 100건에서 멈춘다(검토 10-28 6번)
  if (select count(*) from public.help_requests where created_at > now() - interval '1 day') >= 100 then
    raise exception '오늘은 요청이 많아 받지 못했습니다. 내일 다시 보내 주십시오.' using errcode = 'P0001';
  end if;
  insert into public.help_requests (name, email, kind, course, year, message, over_limit)
  values (trim(coalesce(p_name, '')), mail, coalesce(nullif(trim(coalesce(p_kind, '')), ''), '기타'),
          trim(coalesce(p_course, '')), trim(coalesce(p_year, '')), trim(coalesce(p_message, '')),
          (select count(*) from public.help_requests where created_at > now() - interval '1 day') >= 30);
end
$$;

create function public.admin_list_help()
returns table (id bigint, name text, email text, kind text, course text, year text, message text, over_limit boolean,
               status text, handled_by uuid, handled_at timestamptz, handled_note text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query select r.id, r.name, r.email, r.kind, r.course, r.year, r.message, r.over_limit, r.status, r.handled_by,
                      r.handled_at, r.handled_note, r.created_at
               from public.help_requests r order by (r.status = 'open') desc, r.created_at desc;
end
$$;

create function public.admin_close_help(target bigint, note text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  update public.help_requests set status = 'done', handled_by = (select auth.uid()), handled_at = now(),
         handled_note = left(trim(coalesce(note, '')), 200)
  where id = target and status = 'open';
  if not found then raise exception '처리할 요청이 없습니다.' using errcode = 'P0002'; end if;
  insert into public.admin_log (admin_id, action, target, detail) values ((select auth.uid()), '본인 확인 요청 처리', 'help:' || target, left(trim(coalesce(note, '')), 200));
end
$$;

create function public.admin_delete_help(target bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  delete from public.help_requests where id = target;
  if not found then raise exception '없는 요청입니다.' using errcode = 'P0002'; end if;
  insert into public.admin_log (admin_id, action, target) values ((select auth.uid()), '본인 확인 요청 지움', 'help:' || target);
end
$$;

create function private.delete_old_help() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from public.help_requests where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end
$$;

-- ------------------------------------------------------------ 회원 한 사람 관리

create function public.admin_member_email(target uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare mail text;
begin
  perform private.assert_admin();
  select u.email::text into mail from auth.users u where u.id = target;
  return mail;
end
$$;

create function public.admin_set_kind(target uuid, new_kind text) returns void
language plpgsql security definer set search_path = ''
as $$
declare old_kind text;
begin
  perform private.assert_admin();
  if new_kind not in ('재학', '졸업', '교수', '기타') then raise exception '구분은 재학 · 졸업 · 교수 · 기타 가운데 하나입니다.' using errcode = '22023'; end if;
  select kind into old_kind from public.profiles where id = target and role <> 'pending' for update;
  if old_kind is null then raise exception '바꿀 수 없는 회원입니다.' using errcode = 'P0002'; end if;
  if old_kind = new_kind then return; end if;
  update public.profiles set kind = new_kind where id = target;
  insert into public.admin_log (admin_id, action, target, detail) values ((select auth.uid()), '구분 바꿈', target::text, old_kind || ' → ' || new_kind);
end
$$;

-- 구성원 카드(공개 표 번호)와 잇기 · 끊기(no = null)
create function public.admin_link_person(target uuid, no integer) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  if no is not null and exists (select 1 from public.profiles where person_no = no and id <> target) then
    raise exception '그 구성원 명단 항목은 이미 다른 회원 계정과 연결되어 있습니다.' using errcode = 'P0001';
  end if;
  update public.profiles set person_no = no where id = target and role <> 'pending';
  if not found then raise exception '바꿀 수 없는 회원입니다.' using errcode = 'P0002'; end if;
  insert into public.admin_log (admin_id, action, target, detail) values ((select auth.uid()),
    case when no is null then '구성원 명단 연결 해제' else '구성원 명단 연결' end, target::text, coalesce('번호 ' || no, ''));
end
$$;

create function public.admin_cancel_withdraw(target uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  update public.profiles set withdraw_requested_at = null where id = target and withdraw_requested_at is not null;
  if not found then raise exception '탈퇴 요청이 없습니다.' using errcode = 'P0002'; end if;
  insert into public.admin_log (admin_id, action, target) values ((select auth.uid()), '탈퇴 요청 취소', target::text);
end
$$;

-- ------------------------------------------------------------ 관리자 넘기기

-- 넘기기 시작: 받는 사람은 바로 관리자(잠시 관리자 3명이 될 수 있음), 나는 '넘기는 중'
create function public.admin_handover(target uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := (select auth.uid());
begin
  perform private.assert_admin();
  if target = me then raise exception '나에게는 넘길 수 없습니다.' using errcode = '22023'; end if;
  if exists (select 1 from public.profiles where id = me and leaving_to is not null) then
    raise exception '이미 넘기는 중입니다. 먼저 넘기기를 취소해 주십시오.' using errcode = 'P0001';
  end if;
  update public.profiles set role = 'admin' where id = target and role = 'member' and status = 'active';
  if not found then raise exception '정상 회원에게만 넘길 수 있습니다.' using errcode = 'P0002'; end if;
  update public.profiles set leaving_to = target where id = me;
  insert into public.admin_log (admin_id, action, target) values (me, '관리자 넘기기 시작', target::text);
end
$$;

-- 넘기기 취소: 아직 끝나지 않았을 때만, 받는 사람은 다시 회원
create function public.admin_cancel_handover() returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := (select auth.uid()); t uuid;
begin
  perform private.assert_admin();
  select leaving_to into t from public.profiles where id = me for update;
  if t is null then raise exception '넘기는 중이 아닙니다.' using errcode = 'P0002'; end if;
  update public.profiles set role = 'member' where id = t and role = 'admin';
  update public.profiles set leaving_to = null where id = me;
  insert into public.admin_log (admin_id, action, target) values (me, '관리자 넘기기 취소', t::text);
end
$$;

-- 넘기기 끝: 받은 사람이 2단계 인증으로 들어와 부른다(관리 화면이 열릴 때 저절로). 넘긴 사람은 회원이 된다.
create function public.admin_finish_handover() returns integer
language plpgsql security definer set search_path = ''
as $$
declare me uuid := (select auth.uid()); r record; n integer := 0;
begin
  perform private.assert_admin();   -- 2단계 인증을 마쳤다는 증거
  for r in update public.profiles set role = 'member', leaving_to = null where leaving_to = me returning id loop
    n := n + 1;
    insert into public.admin_log (admin_id, action, target) values (me, '관리자 넘기기 끝(넘긴 사람은 회원)', r.id::text);
  end loop;
  return n;
end
$$;

-- 등급 바꾸기는 그대로 두되, 넘기는 중인 사람을 바꾸지 못하게 한다(넘기기는 넘기기 함수로만).
create or replace function public.admin_set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare old_role text;
begin
  perform private.assert_admin();
  if new_role not in ('member', 'admin') then raise exception '등급은 회원 · 관리자만 고를 수 있습니다.' using errcode = '22023'; end if;
  if target = (select auth.uid()) then raise exception '내 등급은 다른 관리자가 바꿔야 합니다.' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where leaving_to = target or (id = target and leaving_to is not null)) then
    raise exception '관리자 넘기는 중인 사람입니다. 넘기기를 끝내거나 취소한 뒤 바꿔 주십시오.' using errcode = 'P0001';
  end if;
  -- 관리자 줄을 모두 잠근 뒤 내가 아직 관리자인지 다시 본다(두 관리자가 동시에 서로를 회원으로 내려 0명이 되는 것을 막음, 검토 10-28)
  perform 1 from public.profiles where role = 'admin' for update;
  if coalesce((select role from public.profiles where id = (select auth.uid())), '') <> 'admin' then
    raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
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

-- ------------------------------------------------------------ 구성원 카드 번호(검토 10-28 3번)
-- 한 번 쓴 번호는 다시 쓰지 않는다: 카드를 뺀 뒤 새 학생이 같은 번호를 받아 옛 회원의 CV · 구분 바꾸기가 새 카드에 붙는 것을 막음.
-- 서버 도우미(site-content)가 새 카드를 더하기 전에 번호를 받아 간다. 표에 있는 가장 큰 번호(table_max)보다 늘 크다.
create sequence private.person_no_seq;
create function public.admin_reserve_person_nos(n integer, table_max integer) returns setof integer
language plpgsql security definer set search_path = ''
as $$
declare floor_no bigint; i integer;
begin
  perform private.assert_admin();
  if n is null or n < 1 or n > 50 then raise exception '번호는 한 번에 50개까지 받습니다.' using errcode = '22023'; end if;
  floor_no := greatest(coalesce(table_max, 0), coalesce((select max(person_no) from public.profiles), 0),
                       (select case when is_called then last_value else 0 end from private.person_no_seq));
  perform setval('private.person_no_seq', greatest(floor_no, 1), floor_no > 0);
  for i in 1..n loop
    return next nextval('private.person_no_seq')::integer;
  end loop;
end
$$;

-- 카드를 빼면(졸업생으로 옮기기가 아닌 진짜 빼기) 그 번호와 이어진 회원 연결을 끊는다
create function public.admin_unlink_person_nos(nos integer[]) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  perform private.assert_admin();
  for r in update public.profiles set person_no = null where person_no = any(nos) returning id loop
    n := n + 1;
    insert into public.admin_log (admin_id, action, target, detail) values ((select auth.uid()), '구성원 명단 연결 해제', r.id::text, '명단에서 뺌');
  end loop;
  return n;
end
$$;

-- ------------------------------------------------------------ 목록 함수 다시 만들기(돌려주는 칸이 늘어 지우고 다시 만든다)

drop function public.my_profile();
create function public.my_profile()
returns table (username text, display_name text, kind text, role text, status text, email text,
               created_at timestamptz, withdraw_requested_at timestamptz, cv_url text, person_no integer)
language sql stable security definer set search_path = ''
as $$
  select p.username, p.display_name, p.kind, p.role, p.status, u.email::text, p.created_at, p.withdraw_requested_at, p.cv_url, p.person_no
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = (select auth.uid())
$$;

drop function public.admin_list_profiles();
create function public.admin_list_profiles()
returns table (id uuid, username text, display_name text, kind text, intro text, role text, status text,
               created_at timestamptz, approved_at timestamptz, withdraw_requested_at timestamptz, cv_url text,
               course text, entry_year integer, show_email boolean, person_no integer, leaving_to uuid, legacy boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query
    select p.id, p.username, p.display_name, p.kind, p.intro, p.role, p.status, p.created_at, p.approved_at,
           p.withdraw_requested_at, p.cv_url, p.course, p.entry_year, p.show_email, p.person_no, p.leaving_to,
           p.legacy_user_id is not null
    from public.profiles p order by (p.role = 'pending') desc, p.created_at desc;
end
$$;

-- CV 공개 목록: 이름 대신 구성원 카드 번호로(관리자가 이어 둔 회원만)
drop function public.public_member_cv();
create function public.public_member_cv()
returns table (person_no integer, cv_url text)
language sql stable security definer set search_path = ''
as $$
  select p.person_no, p.cv_url
  from public.profiles p
  where p.cv_url is not null and p.person_no is not null and p.role in ('member', 'admin') and p.status = 'active'
  order by p.person_no
$$;

-- ------------------------------------------------------------ 관리 기록 칸 더하기(사이트 내용 고침)

alter table public.admin_log
  add column changes jsonb,
  add column publish_state text check (publish_state is null or publish_state in ('waiting', 'published', 'failed')),
  add column publish_note text not null default '',
  add column undo_of bigint references public.admin_log (id) on delete set null;
comment on column public.admin_log.changes is '사이트 내용 고침: {"notes": [...], "commit": 판, "files": {"data/people.csv": {"before": 판 표시, "after": 판 표시}}}. 서버 도우미만 쓴다.';
create index admin_log_undo_of_idx on public.admin_log (undo_of);

-- ------------------------------------------------------------ 로그인 없이 보내는 메일 한도(서버 도우미 login-help 만 씀)
-- 아이디(계정)마다 10분에 1번 · 하루 3번, 전체 한 시간 20통. 남의 아이디로 되풀이해 메일 한도를 다 써 버리는 것을 막는다.
create table public.mail_quota (
  id bigint generated always as identity primary key,
  key text not null check (char_length(key) <= 80),
  created_at timestamptz not null default now()
);
create index mail_quota_key_idx on public.mail_quota (key, created_at);
create index mail_quota_created_idx on public.mail_quota (created_at);
alter table public.mail_quota enable row level security;
revoke all on public.mail_quota from public, anon, authenticated;

create function public.take_mail_quota(p_key text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.mail_quota where key = p_key and created_at > now() - interval '10 minutes')
     or (select count(*) from public.mail_quota where key = p_key and created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.mail_quota where created_at > now() - interval '1 hour') >= 20 then
    return false;
  end if;
  insert into public.mail_quota (key) values (p_key);
  return true;
end
$$;

-- 가입 신청에서 메일이 이미 있는지(있으면 화면은 같게 하고 그 계정으로 비밀번호 링크를 보냄). 서버 도우미만.
create function public.account_for_email(p_email text)
returns table (id uuid, username text, role text, status text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.username, p.role, p.status from public.profiles p join auth.users u on u.id = p.id
  where lower(u.email) = lower(trim(p_email))
$$;

-- 가입 신청에서 아이디가 이미 있는지(잠긴 계정 · 승인 대기 포함). 서버 도우미만.
create function public.username_exists(p_username text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where username = lower(trim(p_username))) $$;

-- 30일 지난 본인 확인 요청 · 메일 한도 기록을 지운다(하루 한 번)
create or replace function private.delete_old_help() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from public.help_requests where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  delete from public.mail_quota where created_at < now() - interval '30 days';
  return n;
end
$$;

-- ------------------------------------------------------------ 권한

revoke all on function public.submit_help_request(text, text, text, text, text, text), public.admin_list_help(),
  public.admin_close_help(bigint, text), public.admin_delete_help(bigint), private.delete_old_help(),
  public.admin_member_email(uuid), public.admin_set_kind(uuid, text), public.admin_link_person(uuid, integer),
  public.admin_cancel_withdraw(uuid), public.admin_handover(uuid), public.admin_cancel_handover(), public.admin_finish_handover(),
  public.admin_set_role(uuid, text), public.my_profile(), public.admin_list_profiles(), public.public_member_cv(),
  public.take_mail_quota(text), public.account_for_email(text), public.username_exists(text),
  public.admin_reserve_person_nos(integer, integer), public.admin_unlink_person_nos(integer[])
  from public, anon, authenticated;
grant execute on function public.admin_reserve_person_nos(integer, integer), public.admin_unlink_person_nos(integer[]) to authenticated;
grant execute on function public.take_mail_quota(text), public.account_for_email(text), public.username_exists(text) to service_role;
grant execute on function public.submit_help_request(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_list_help(), public.admin_close_help(bigint, text), public.admin_delete_help(bigint),
  public.admin_member_email(uuid), public.admin_set_kind(uuid, text), public.admin_link_person(uuid, integer),
  public.admin_cancel_withdraw(uuid), public.admin_handover(uuid), public.admin_cancel_handover(), public.admin_finish_handover(),
  public.admin_set_role(uuid, text), public.my_profile(), public.admin_list_profiles()
  to authenticated;
grant execute on function public.public_member_cv() to anon, authenticated;

-- ------------------------------------------------------------ Supabase 화면에서 따로 할 일(이 파일 밖)
-- 1) pg_cron: select cron.schedule('delete-old-help', '40 3 * * *', 'select private.delete_old_help()');
-- 2) 옛 회원을 옮길 때(옮기기 도구) 아이디를 raw_user_meta_data.username 에도 적는다(메일 틀이 user_metadata 만 읽음).
--    비밀번호 메일 틀(Reset Password)에 "아이디: {{ .Data.username }}" 한 줄.
-- 3) Authentication: 'Allow new users to sign up' 끔(10-24 init.sql 끝의 '가입 켬'을 바꿈). 가입 신청은 서버 도우미 login-help 가
--    관리자 API 로 만든다. 공개 /signup 은 이미 있는 메일에 다른 답을 줘 누가 회원인지 드러난다(검토 10-28 2번).
-- 4) 공개 /recover · /otp 를 바로 되풀이해 메일 한도를 다 쓰는 것: 연결 때 로그인 서비스의 사람 확인(Turnstile)을 켜거나
--    Send Email Hook 으로 take_mail_quota 를 거치게 한다(어느 쪽이든 연결 때 공식 문서로 확인하고 고름).
