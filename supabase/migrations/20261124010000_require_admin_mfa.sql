-- 관리자 권한이 필요한 작업에는 현재 로그인의 2단계 인증을 요구한다.
create or replace function private.is_admin_aal2() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select private.my_role()) = 'admin', false)
     and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
$$;

create or replace function private.assert_admin() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce((select private.my_role()), '') <> 'admin' then
    raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
  if not (select private.is_admin_aal2()) then
    raise exception '관리자는 2단계 인증을 마친 뒤에 할 수 있습니다.' using errcode = '42501';
  end if;
end
$$;
