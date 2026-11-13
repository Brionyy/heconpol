-- 2026-11-13 사진첩 게시판 이름을 '행사 · 나들이 기록'으로 바꾼다(결정 기록 11-13 '사진첩은 행사 기록으로').
-- 주소(photos) · 권한 · 사진첩 모양은 그대로. 게시판 목록은 site/data/boards.csv 와 같게 둔다(supabase/tests/rls_test.mjs 가 비교한다).
update public.boards set name = '행사 · 나들이 기록' where slug = 'photos';
