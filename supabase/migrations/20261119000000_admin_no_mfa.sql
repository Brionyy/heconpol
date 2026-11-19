-- 관리자 2단계 인증(aal2) 필수 조건 해제 (2026-11-19)
-- 관리자 계정으로 로그인되어 있으면 별도 인증 앱 등록·입력 없이 바로 관리 화면 및 관리자 기능을 사용할 수 있게 한다.

create or replace function private.is_admin_aal2() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select private.my_role()) = 'admin', false)
$$;

create or replace function private.assert_admin() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce((select private.my_role()), '') <> 'admin' then
    raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
end
$$;
