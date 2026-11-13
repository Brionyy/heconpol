-- 내 정보에서 고치는 구성원 카드(2026-11-02, 연구자: "홈페이지에서 CV 공개 여부를 체크하는 항목이 내 정보에서 있으면 좋겠음.
-- 그리고 본인의 사진을 본인이 올릴 수 있게도 + 그리고 연구 관심 분야도 본인이 수정할 수 있게 다만 사진과 연구 관심분야는
-- 조교의 승인이 필요하게 시스템적으로 구현해").
-- 1) CV 공개: 본인이 켜고 끈다(승인 없음). 끄면 주소는 남기고 구성원 카드에서만 뺀다. 관리자가 표에 적어 둔 CV 주소도 함께 빠진다.
-- 2) 사진 · 관심 분야: 본인은 '바꿔 달라는 요청'만 낸다. 관리자(조교)가 관리 화면 '할 일'에서 [승인하고 공개]를 눌러야
--    공개 표(people.csv · alumni.csv)가 바뀐다. 표를 고치는 일은 지금처럼 서버 도우미 site-content 가 한다(저장 한 번 = GitHub 판 하나).
--    순서: 관리자 화면이 site-content 로 표를 고침 → 성공하면 admin_decide_profile_request(승인) → 올린 사진 파일을 Storage API 로 지움.
--    표 고치기가 실패하면 요청은 '기다림'으로 남는다.
-- 3) 올린 사진은 비공개 칸 'profile-photos'에 '내 id/파일'로 둔다(관리자 화면이 세로 4:5 JPEG 로 다시 그린 것, 1MB까지).
--    본인과 관리자만 보고, 결정이 나면 지운다.

-- ------------------------------------------------------------ CV 공개

alter table public.profiles add column cv_public boolean not null default true;
comment on column public.profiles.cv_public is '구성원 카드에 CV 를 보이는가. 본인이 내 정보에서 끈다. 끄면 표의 CV 주소도 안 보인다.';
grant update (cv_public) on public.profiles to authenticated;

drop function public.my_profile();
create function public.my_profile()
returns table (username text, display_name text, kind text, role text, status text, email text,
               created_at timestamptz, withdraw_requested_at timestamptz, cv_url text, person_no integer, cv_public boolean)
language sql stable security definer set search_path = ''
as $$
  select p.username, p.display_name, p.kind, p.role, p.status, u.email::text, p.created_at, p.withdraw_requested_at, p.cv_url,
         p.person_no, p.cv_public
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = (select auth.uid())
$$;

-- 사이트를 만드는 단계(build.py --fetch-cv)가 받는 목록: 카드 번호 · 보일 CV 주소 · 공개 여부.
-- CV 를 끈 사람은 주소를 내보내지 않고(null) cv_public = false 만 보낸다. build.py 는 그 카드의 표 CV 주소도 숨긴다.
drop function public.public_member_cv();
create function public.public_member_cv()
returns table (person_no integer, cv_url text, cv_public boolean)
language sql stable security definer set search_path = ''
as $$
  select p.person_no, case when p.cv_public then p.cv_url end, p.cv_public
  from public.profiles p
  where p.person_no is not null and p.role in ('member', 'admin') and p.status = 'active'
    and (p.cv_url is not null or not p.cv_public)
  order by p.person_no
$$;

-- ------------------------------------------------------------ 사진 · 관심 분야 바꾸기 요청

create table public.profile_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('photo', 'interest')),
  interest text check (interest is null or (char_length(interest) <= 300 and interest !~ '[\r\n]')),
  photo_path text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,60}\.jpg$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'canceled')),
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  check ((kind = 'photo' and photo_path is not null and interest is null) or (kind = 'interest' and interest is not null and photo_path is null))
);
comment on table public.profile_requests is '회원이 내 정보에서 낸 구성원 카드 사진 · 관심 분야 바꾸기 요청. 관리자가 승인해야 공개 표가 바뀐다.';
create index profile_requests_user_idx on public.profile_requests (user_id, kind, created_at desc);
create index profile_requests_pending_idx on public.profile_requests (status) where status = 'pending';
create unique index profile_requests_one_pending on public.profile_requests (user_id, kind) where status = 'pending';
create index profile_requests_decided_by_idx on public.profile_requests (decided_by);
alter table public.profile_requests enable row level security;
-- 화면은 표를 바로 읽거나 쓰지 않는다(아래 함수로만)
revoke all on public.profile_requests from public, anon, authenticated;

-- 요청 내기: 승인된 회원이면 카드와 아직 안 이어져도 낸다(관리자가 승인할 때 카드를 고르고 잇는다). 교수 구분은 못 낸다(교수님 카드는 관리자가 고침). 같은 갈래의 기다리는 요청은 새 요청으로 바뀐다(앞 요청은 '취소').
-- 사진은 먼저 Storage 의 profile-photos 칸 '내 id/…jpg'에 올린 뒤 그 경로를 넘긴다. 하루 10건까지.
create function public.request_profile_change(p_kind text, p_interest text, p_photo_path text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare me uuid := (select auth.uid()); rid bigint; kws text[];
begin
  if not (select private.is_member()) then raise exception '승인된 회원만 할 수 있습니다.' using errcode = '42501'; end if;
  if (select p.kind from public.profiles p where p.id = me) = '교수' then
    raise exception '교수님 소개는 관리자가 관리 화면에서 고칩니다.' using errcode = '42501';
  end if;
  if (select count(*) from public.profile_requests r where r.user_id = me and r.created_at > now() - interval '1 day') >= 10 then
    raise exception '오늘은 요청을 더 낼 수 없습니다(하루 10건).' using errcode = 'P0001';
  end if;
  if p_kind = 'interest' then
    -- 관심 분야는 키워드 0~5개(하나에 30자까지)를 ' · '로 이은 한 줄(11-02 저녁, 연구자: "키워드를 몇 개 작성해서 보내는 거임 최대 뭐 5개").
    -- 쉼표로 나눠 와도 같은 모양으로 맞춘다. 비우면 관심 분야를 지워 달라는 뜻
    p_interest := btrim(regexp_replace(coalesce(p_interest, ''), '\s+', ' ', 'g'));
    kws := case when p_interest = '' then '{}'::text[] else regexp_split_to_array(p_interest, '\s*[,·]\s*') end;
    if cardinality(kws) > 5 then raise exception '관심 분야 키워드는 5개까지 보낼 수 있습니다.' using errcode = 'P0001'; end if;
    if exists (select 1 from unnest(kws) w where char_length(w) not between 1 and 30) then
      raise exception '키워드 하나는 1~30자로 적어 주십시오.' using errcode = 'P0001';
    end if;
    p_interest := array_to_string(kws, ' · ');
    p_photo_path := null;
  elsif p_kind = 'photo' then
    if p_photo_path is null or split_part(p_photo_path, '/', 1) <> me::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos' and o.name = p_photo_path) then
      raise exception '올린 사진을 찾지 못했습니다. 다시 골라 주십시오.' using errcode = 'P0001';
    end if;
    p_interest := null;
  else
    raise exception '요청 갈래가 올바르지 않습니다.' using errcode = 'P0001';
  end if;
  update public.profile_requests set status = 'canceled', decided_at = now()
    where user_id = me and kind = p_kind and status = 'pending';
  insert into public.profile_requests (user_id, kind, interest, photo_path)
    values (me, p_kind, p_interest, p_photo_path) returning id into rid;
  return rid;
end
$$;

-- 기다리는 내 요청 취소(올린 사진 파일은 화면이 Storage API 로 지운다)
create function public.cancel_profile_request(target bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profile_requests set status = 'canceled', decided_at = now()
    where id = target and user_id = (select auth.uid()) and status = 'pending';
  if not found then raise exception '취소할 요청이 없습니다.' using errcode = 'P0002'; end if;
end
$$;

-- 내 요청: 갈래마다 가장 최근 것(기다림 · 승인됨 · 돌려받음과 까닭을 내 정보에 보임)
create function public.my_profile_requests()
returns table (id bigint, kind text, interest text, photo_path text, status text, reason text, created_at timestamptz, decided_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select distinct on (r.kind) r.id, r.kind, r.interest, r.photo_path, r.status, r.reason, r.created_at, r.decided_at
  from public.profile_requests r
  where r.user_id = (select auth.uid()) and r.status <> 'canceled'
  order by r.kind, r.created_at desc
$$;

-- 관리자: 기다리는 요청(할 일 탭). person_no 는 지금 이어진 카드(없으면 null: 승인할 때 카드를 고르고 잇는다)
create function public.admin_list_profile_requests()
returns table (id bigint, user_id uuid, display_name text, username text, person_no integer, member_kind text, kind text, interest text,
               photo_path text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query
    select r.id, r.user_id, p.display_name, p.username, p.person_no, p.kind, r.kind, r.interest, r.photo_path, r.created_at
    from public.profile_requests r join public.profiles p on p.id = r.user_id
    where r.status = 'pending' order by r.created_at;
end
$$;

-- 관리자: 승인(공개 표를 고친 뒤에 부른다) · 돌려보내기(까닭은 본인 내 정보에 보임). 기록에 남김
create function public.admin_decide_profile_request(target bigint, decision text, why text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.profile_requests;
begin
  perform private.assert_admin();
  if decision not in ('approved', 'rejected') then raise exception '결정이 올바르지 않습니다.' using errcode = 'P0001'; end if;
  update public.profile_requests
    set status = decision, reason = left(btrim(coalesce(why, '')), 200), decided_at = now(), decided_by = (select auth.uid())
    where id = target and status = 'pending'
    returning * into r;
  if r.id is null then raise exception '이미 처리했거나 취소된 요청입니다.' using errcode = 'P0002'; end if;
  insert into public.admin_log (admin_id, action, target, detail)
    values ((select auth.uid()),
            case r.kind when 'photo' then '소개 사진 요청 ' else '관심 분야 요청 ' end || case decision when 'approved' then '승인' else '돌려보냄' end,
            r.user_id::text, coalesce(nullif(r.reason, ''), ''));
end
$$;

-- 기다리는 요청은 60일 뒤 저절로 '취소'(pg_cron, 아래 '따로 할 일'). 사진 파일은 서버 도우미 정리에서 지운다
create function private.expire_profile_requests() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.profile_requests set status = 'canceled', decided_at = now()
    where status = 'pending' and created_at < now() - interval '60 days';
  get diagnostics n = row_count;
  return n;
end
$$;

-- ------------------------------------------------------------ 사진 칸(비공개, 본인 · 관리자만)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('profile-photos', 'profile-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy profile_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin_aal2())));

create policy profile_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos'
              and (select private.is_member())
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select private.my_uploads_today()) < 30);

create policy profile_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin_aal2())));

-- ------------------------------------------------------------ 권한

revoke all on function public.my_profile(), public.public_member_cv(), public.request_profile_change(text, text, text),
  public.cancel_profile_request(bigint), public.my_profile_requests(), public.admin_list_profile_requests(),
  public.admin_decide_profile_request(bigint, text, text), private.expire_profile_requests()
  from public, anon, authenticated;
grant execute on function public.my_profile(), public.request_profile_change(text, text, text), public.cancel_profile_request(bigint),
  public.my_profile_requests(), public.admin_list_profile_requests(), public.admin_decide_profile_request(bigint, text, text)
  to authenticated;
grant execute on function public.public_member_cv() to anon, authenticated;

-- ------------------------------------------------------------ Supabase 화면에서 따로 할 일(이 파일 밖)
-- 1) pg_cron: select cron.schedule('expire-profile-requests', '50 3 * * *', 'select private.expire_profile_requests()');
-- 2) 탈퇴 처리(admin-account)가 이 사람의 profile-photos 파일도 지우는지 연결 때 확인(지금은 owner 로 찾아 지움).
