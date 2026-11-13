-- 시험용 가짜 자료(실제 사람 아님). Supabase 로컬 시험이나 시험용 프로젝트에서만 쓴다. 진짜 프로젝트에는 넣지 않는다.
-- 계정 · 비밀번호는 site/assets/js/lab/api-fake.js 의 가짜 계정과 같다.

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'admin@example.test', extensions.crypt('Admin-test-2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"username":"test_admin","display_name":"시험관리자","kind":"재학","intro":"조교"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'member@example.test', extensions.crypt('Member-test-2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"username":"test_member","display_name":"시험회원","kind":"재학","intro":"박사과정"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'alumni@example.test', extensions.crypt('Alumni-test-2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"username":"test_alumni","display_name":"시험졸업생","kind":"졸업"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated',
   'new@example.test', extensions.crypt('Newcomer-test-2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"username":"test_newcomer","display_name":"신청자","kind":"재학","intro":"2026 석사 입학"}', now(), now()),
  -- 옛 사이트에서 옮겨 온 회원: 비밀번호 없음, 메일 링크로 처음 정한다
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated',
   'old@example.test', null, now(),
   '{"provider":"email","providers":["email"],"migrated":true,"legacy_user_id":17,"username":"test_oldmember","display_name":"옛회원","kind":"졸업"}', '{}', now(), now());

-- 가입하면 모두 '승인 대기'이므로 시험 계정 등급을 정한다(신청자만 그대로 둔다).
update public.profiles set role = 'admin', approved_at = now() where id = '11111111-1111-4111-8111-111111111111';
update public.profiles set role = 'member', approved_at = now()
  where id in ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');

insert into public.posts (board, title, body_md, author_id, hidden) values
  ('free', '세미나실 예약 안내', '다음 주 **화요일** 세미나실은 오후 2시부터 씁니다.', '11111111-1111-4111-8111-111111111111', false),
  ('free', '[시험] 몰래 넣은 코드가 걸러지는지 보는 글', E'<script>alert(1)</script>\n\n[링크](javascript:alert(1))', '22222222-2222-4222-8222-222222222222', false),
  ('newcomer', '안녕하십니까, 시험회원입니다', '잘 부탁드립니다.', '22222222-2222-4222-8222-222222222222', false),
  ('files', '[세미나] 2020 보건정책 세미나 자료', '옛 세미나 글이라고 가정한 시험 글', '33333333-3333-4333-8333-333333333333', false),
  ('free', '관리자가 숨긴 글', '관리자와 글쓴이에게만 보입니다.', '33333333-3333-4333-8333-333333333333', true);

insert into public.comments (post_id, body, author_id)
  select id, '확인했습니다.', '22222222-2222-4222-8222-222222222222' from public.posts where title = '세미나실 예약 안내';
