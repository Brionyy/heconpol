-- 댓글의 조회 권한은 comments의 기존 RLS를 그대로 사용한다.
create or replace function private.comment_avatar(member_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select u.raw_user_meta_data ->> 'lab_avatar_id'
    from auth.users u
    where u.id = member_id and (select private.is_member())
      and (u.raw_user_meta_data ->> 'lab_avatar_id') ~ '^[a-z0-9-]{1,48}$'
$$;
revoke all on function private.comment_avatar(uuid) from public, anon;
grant execute on function private.comment_avatar(uuid) to authenticated;

create or replace view public.comment_list with (security_invoker = true) as
select c.id, c.post_id, c.body, c.author_id, c.created_at, c.hidden,
       private.comment_avatar(c.author_id) as avatar_id
from public.comments c;
revoke all on public.comment_list from public, anon, authenticated;
grant select on public.comment_list to authenticated;
