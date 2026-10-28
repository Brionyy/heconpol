-- 구성원 CV 주소(2026-10-27, 연구자: "cv 있는 사람은 본인이 등록할 수 있게 기능적으로 회원관리? 뭐 그런 창에서").
-- 회원이 회원 칸 '내 정보'에서 자기 CV 주소(https)를 적으면, 공개 화면을 만들 때 구성원 카드의 'CV' 줄에 붙는다.
-- 공개 화면은 회원 칸 서버를 부르지 않으므로(결정 10-24), 사이트를 만드는 단계(GitHub, 하루 한 번 · 표를 고칠 때,
-- build.py --fetch-cv)가 public_member_cv() 로 '이름 · CV 주소'만 받아 간다. 구성원 표(people.csv)와는 이름으로 잇는다.
-- 관리자는 맞지 않는 주소를 지울 수 있고(2단계 인증), 지운 일은 관리 기록에 남는다.

alter table public.profiles
  add column cv_url text check (cv_url is null or (char_length(cv_url) <= 300 and cv_url ~ '^https://[^[:space:]<>"''`]+$'));
comment on column public.profiles.cv_url is '구성원 화면 CV 줄에 붙일 주소(https만, 300자까지). 본인이 내 정보에서 고친다. 비우면 안 보인다.';

-- 본인만 자기 CV 주소를 고친다(칸 권한 + 원래 있던 profiles_update_self 규칙: 승인된 회원이 자기 줄만)
grant update (cv_url) on public.profiles to authenticated;

-- 내 정보 · 관리자 회원 목록에 CV 주소를 더한다(돌려주는 칸이 바뀌어 지우고 다시 만든다)
drop function public.my_profile();
create function public.my_profile()
returns table (username text, display_name text, kind text, role text, status text, email text,
               created_at timestamptz, withdraw_requested_at timestamptz, cv_url text)
language sql stable security definer set search_path = ''
as $$
  select p.username, p.display_name, p.kind, p.role, p.status, u.email::text, p.created_at, p.withdraw_requested_at, p.cv_url
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = (select auth.uid())
$$;

drop function public.admin_list_profiles();
create function public.admin_list_profiles()
returns table (id uuid, username text, display_name text, kind text, intro text, role text, status text,
               created_at timestamptz, approved_at timestamptz, withdraw_requested_at timestamptz, cv_url text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query
    select p.id, p.username, p.display_name, p.kind, p.intro, p.role, p.status, p.created_at, p.approved_at,
           p.withdraw_requested_at, p.cv_url
    from public.profiles p order by (p.role = 'pending') desc, p.created_at desc;
end
$$;

-- 관리자가 맞지 않는 CV 주소를 지운다(2단계 인증, 기록)
create function public.admin_clear_cv(target uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  update public.profiles set cv_url = null where id = target and cv_url is not null;
  if not found then raise exception '지울 CV 주소가 없습니다.' using errcode = 'P0002'; end if;
  insert into public.admin_log (admin_id, action, target) values ((select auth.uid()), 'CV 주소 지움', target::text);
end
$$;

-- 사이트를 만드는 단계가 부르는 공개 목록: 승인된(회원 · 관리자) 정상 계정 중 CV 주소를 적은 사람의 이름과 주소만.
-- 아이디 · 메일 · 등급은 내보내지 않는다. 방문자 열쇠(공개 열쇠)로 부를 수 있다.
create function public.public_member_cv()
returns table (name text, cv_url text)
language sql stable security definer set search_path = ''
as $$
  select p.display_name, p.cv_url
  from public.profiles p
  where p.cv_url is not null and p.role in ('member', 'admin') and p.status = 'active'
  order by p.display_name
$$;

revoke all on function public.my_profile(), public.admin_list_profiles(), public.admin_clear_cv(uuid), public.public_member_cv()
  from public, anon, authenticated;
grant execute on function public.my_profile(), public.admin_list_profiles(), public.admin_clear_cv(uuid) to authenticated;
grant execute on function public.public_member_cv() to anon, authenticated;
