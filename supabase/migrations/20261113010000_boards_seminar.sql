-- 2026-11-13 연구자 결정(기능 정리 확인):
-- 1) 게시판 '대상' 칸을 없앤다("대상 칸 필요 없는 것 같음 그냥 없애"). 모든 회원이 모든 게시판을 읽고 쓴다.
-- 2) 세미나 후기 + 자료실의 옛 세미나 글을 '세미나' 게시판 하나로 합친다. 옛 세미나 글은 옮길 때 seminar 로 넣는다(migrate/mapping.json).
-- 3) 사진첩은 행사 · 나들이마다 대표 사진 한 장이 쌓이는 모양으로 쓴다(설명 글만 바뀜, 권한 그대로).
-- 게시판 목록은 site/data/boards.csv 와 같게 둔다(supabase/tests/rls_test.mjs 가 비교한다).

alter table public.boards drop column if exists audience;

insert into public.boards (slug, name, allow_files, is_gallery, sort, group_name) values
  ('seminar', '세미나', true, false, 1, '게시판'),
  ('newcomer', '신입생 자기소개', false, false, 2, '게시판'),
  ('free', '자유게시판', true, false, 3, '게시판'),
  ('files', '자료실', true, false, 4, '게시판'),
  ('photos', '사진첩', false, true, 5, '게시판')
on conflict (slug) do update
  set name = excluded.name, allow_files = excluded.allow_files, is_gallery = excluded.is_gallery,
      sort = excluded.sort, group_name = excluded.group_name;
