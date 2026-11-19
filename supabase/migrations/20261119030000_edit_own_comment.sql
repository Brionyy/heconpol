grant update (body) on public.comments to authenticated;
create policy comments_update_self on public.comments for update to authenticated
  using ((select private.is_member()) and author_id = (select auth.uid())
         and exists (select 1 from public.posts p where p.id = post_id))
  with check (author_id = (select auth.uid()) and body ~ '[^[:space:]]');

-- 두 창에서 편집했을 때 먼저 저장한 내용을 덮어쓰지 않는다.
create function public.edit_my_comment(comment_id bigint, previous_body text, new_body text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.comments set body = btrim(new_body)
  where id = comment_id and author_id = (select auth.uid()) and body = previous_body;
  return found;
end;
$$;
revoke all on function public.edit_my_comment(bigint,text,text) from public, anon;
grant execute on function public.edit_my_comment(bigint,text,text) to authenticated;
