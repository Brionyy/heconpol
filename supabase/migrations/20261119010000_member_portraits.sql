-- 관리자 회원 명단에서 공개 사진을 찾는 데 필요한 값만 반환한다.
create or replace function public.admin_member_portraits(public_mail_keys text[])
returns table (id uuid, mail_key text, avatar_id text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query
    select p.id, case when k.mail_key = any(public_mail_keys) then k.mail_key end,
           u.raw_user_meta_data ->> 'lab_avatar_id'
    from public.profiles p
    join auth.users u on u.id = p.id
    cross join lateral (select encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex') as mail_key) k
    where p.role <> 'pending' and (k.mail_key = any(public_mail_keys) or u.raw_user_meta_data ? 'lab_avatar_id');
end
$$;
revoke all on function public.admin_member_portraits(text[]) from public, anon, authenticated;
grant execute on function public.admin_member_portraits(text[]) to authenticated;
