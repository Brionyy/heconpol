-- 회원 칸 게시판 셋(2026-10-27, 연구자): 세미나 후기(새로) · 신입생 자기소개('새식구 소개'에서 이름만 바꿈) · 자유게시판.
-- 자료실 · 사진첩은 그대로 둔다. 순서는 연구자가 말한 순서(세미나 후기 → 신입생 자기소개 → 자유게시판 → 자료실 → 사진첩).
-- 머리 메뉴에서 게시판을 묶을 이름(묶음, 지금은 모두 '게시판')과 나중에 읽고 쓸 사람을 나눌(대상, 지금은 빈) 칸을 더한다.
-- 권한 규칙은 바꾸지 않는다(임시저장 · 본문 그림은 20261027020000_drafts_images.sql).
-- 게시판 목록은 site/data/boards.csv 와 같게 둔다(supabase/tests/rls_test.mjs 가 비교한다).

alter table public.boards
  add column group_name text check (group_name is null or char_length(group_name) between 1 and 30),
  add column audience text[] not null default '{}' check (audience <@ array['재학', '졸업', '교수', '기타']);
comment on column public.boards.group_name is '묶음(대분류, boards.csv 묶음 칸). 머리 메뉴에서 이 이름 아래(▾)에 모인다. 비면 메뉴에 따로 한 칸.';
comment on column public.boards.audience is '대상(profiles.kind 값, boards.csv 대상 칸). 아직 권한에 쓰지 않는다. 비면 모든 회원.';

-- 오늘 기준 게시판 목록 전체. 주소 이름(slug)이 이미 있으면 나머지 칸을 이 값으로 바꾼다.
-- 게시판을 더하거나 고칠 때는 이 덩어리를 새 파일에 옮겨 고친다(이미 올린 파일은 고치지 않는다).
insert into public.boards (slug, name, allow_files, is_gallery, sort, group_name, audience) values
  ('seminar', '세미나 후기', true, false, 1, '게시판', '{}'),
  ('newcomer', '신입생 자기소개', false, false, 2, '게시판', '{}'),
  ('free', '자유게시판', true, false, 3, '게시판', '{}'),
  ('files', '자료실', true, false, 4, '게시판', '{}'),
  ('photos', '사진첩', false, true, 5, '게시판', '{}')
on conflict (slug) do update
  set name = excluded.name, allow_files = excluded.allow_files, is_gallery = excluded.is_gallery,
      sort = excluded.sort, group_name = excluded.group_name, audience = excluded.audience;
