"""회원 칸 게시판 목록(data/boards.csv) 시험: 게시판 셋(2026-10-27), 나중 분류용 '묶음' · '대상' 칸, 서버 규칙과 맞추기."""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


def row(line, **cells):
    base = {"주소 이름": "free", "이름": "자유게시판", "설명": "", "첨부": "예", "사진첩": "아니오", "묶음": ""}
    base.update(cells)
    base["_line"] = line
    return base


class BoardsTableTest(unittest.TestCase):
    def test_three_boards(self):
        # 연구자 요청(10-27): 세미나 후기(첨부 됨) · 신입생 자기소개(옛 newcomer 주소) · 자유게시판(모임 뒤 후기)
        by = {b["slug"]: b for b in build.read_boards()}
        self.assertEqual(by["seminar"]["name"], "세미나")  # 11-13 세미나 후기 + 옛 세미나 글 합침
        self.assertTrue(by["seminar"]["files"])
        self.assertEqual(by["newcomer"]["name"], "신입생 자기소개")
        self.assertIn("모임 · 행사 뒤 후기", by["free"]["desc"])
        self.assertTrue(any(b["gallery"] for b in by.values()), "사진첩 게시판이 하나는 있어야 사진첩 화면이 열린다")

    def test_group_read_and_no_audience(self):
        # '대상' 칸은 2026-11-13 연구자 결정으로 없앴다
        boards = build.read_boards([row(2, 묶음="게시판")])
        self.assertEqual(boards[0]["group"], "게시판")
        self.assertNotIn("audience", boards[0])

    def test_bad_values_named_with_line(self):
        cases = [
            (row(5, **{"주소 이름": "Seminar"}), ["5번째 줄", "'주소 이름'", "Seminar"]),
            (row(6, 묶음="가" * 31), ["6번째 줄", "30자"]),
        ]
        for r, words in cases:
            with self.assertRaises(build.BuildError) as cm:
                build.read_boards([r])
            for w in words:
                self.assertIn(w, str(cm.exception))
        with self.assertRaises(build.BuildError) as cm:
            build.read_boards([row(2), row(3)])
        self.assertIn("3번째 줄", str(cm.exception))

    def test_every_board_is_in_server_rules(self):
        # 표에 게시판을 더하면 서버 규칙(supabase/migrations)에도 같은 주소 이름이 있어야 한다.
        # 이름 · 첨부 · 순서까지 같은지는 권한 시험(supabase/tests/rls_test.mjs)이 진짜 Postgres 에서 비교한다.
        sql = "\n".join(p.read_text(encoding="utf-8") for p in sorted((ROOT / "supabase/migrations").glob("*.sql")))
        for b in build.read_boards():
            self.assertRegex(sql, r"\(\s*'" + re.escape(b["slug"]) + r"'\s*,", f"서버 규칙에 게시판 {b['slug']} 이 없습니다")


class LabPagesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = build.Site(local=True)
        build.build_lab_pages(cls.site)
        cls.pages = {p["path"]: p for p in cls.site.pages}

    def test_page_data_carries_boards(self):
        # 회원 칸 화면은 이 목록으로 게시판 주소 · 이름 · 첨부 허용을 안다
        data = self.pages["/lab/"]["data"]["boards"]
        self.assertEqual(data, build.read_boards())
        self.assertEqual(set(data[0]), {"slug", "name", "desc", "files", "gallery", "group"})

    def test_each_board_has_its_own_page(self):
        # 연구자(10-27): "한 화면에 있는게 아니라 … 구성원 졸업생 이런 것 처럼" → 게시판마다 /board/<주소 이름>/ 화면
        for b in build.read_boards():
            p = self.pages[f"/board/{b['slug']}/"]
            self.assertEqual(p["data"]["board"], b["slug"])
            self.assertEqual(p["title"], b["name"])
            self.assertIn(f'data-lab-page="{"photos" if b["gallery"] else "board"}"', p["body"])
            for js in ("upload.js", "render.js", "editor.js"):
                self.assertIn(f"/assets/js/lab/{js}", p["scripts"])
            html = self.site.render(p)
            self.assertIn('name="robots" content="noindex', html)
            self.assertIn(f"<h1>{b['name']}</h1>", html)

    def test_old_addresses_forward(self):
        # 10-27 전 주소(/lab/board/?b=… · /lab/photos/)와 옛 사이트 번호는 새 게시판 화면으로
        for path in ("/lab/board/", "/lab/photos/"):
            self.assertIn('data-lab-page="forward"', self.pages[path]["body"])
        old = {r["옛 번호"]: r["새 주소"] for r in build.read_table("redirects", ["옛 번호", "새 주소"])}
        self.assertEqual([old[n] for n in ("42", "584", "633", "44")],
                         ["/board/free/", "/board/newcomer/", "/board/files/", "/board/photos/"])

    def test_page_data_is_json_safe(self):
        html = self.site.render(self.pages["/lab/"])
        m = re.search(r'<script type="application/json" id="page-data">(.*?)</script>', html, re.S)
        self.assertIsNotNone(m)
        self.assertEqual([b["slug"] for b in json.loads(m.group(1))["boards"]], [b["slug"] for b in build.read_boards()])


class BoardMenuTest(unittest.TestCase):
    """머리 메뉴: data/menu.csv 의 '@게시판' 자리에 게시판이 '묶음' 이름 아래(▾)로 들어간다."""

    def test_menu_has_board_dropdown(self):
        site = build.Site(local=True)
        names = [(m["이름"], m["주소"], m.get("위", "")) for m in site.menu]
        top = [n for n in names if not n[2]]
        self.assertIn(("게시판", "/board/seminar/", ""), top)
        self.assertLess([t[0] for t in top].index("소식"), [t[0] for t in top].index("게시판"))
        self.assertEqual([n[0] for n in names if n[2] == "게시판"], [b["name"] for b in build.read_boards()])
        nav = site.nav("/board/free/")
        self.assertIn('<a href="/board/seminar/" aria-current="page">게시판</a>', nav)
        self.assertIn('<a href="/board/free/" aria-current="page">자유게시판</a>', nav)
        self.assertNotIn('<a href="/lab/" aria-current="page">회원</a>', nav)

    def test_groups_split_menu(self):
        menu = [{"이름": "연구실", "주소": "/about/", "위": ""}, {"이름": "x", "주소": "@게시판", "위": ""},
                {"이름": "회원", "주소": "/lab/", "위": ""}]
        boards = build.read_boards([row(2, **{"주소 이름": "a1", "이름": "가", "묶음": "커뮤니티"}),
                                    row(3, **{"주소 이름": "a2", "이름": "나", "묶음": ""}),
                                    row(4, **{"주소 이름": "a3", "이름": "다", "묶음": "연구실"}),
                                    row(5, **{"주소 이름": "a4", "이름": "라", "묶음": "커뮤니티"})])
        out = [(m["이름"], m["주소"], m["위"]) for m in build.board_menu(menu, boards)]
        self.assertEqual(out, [("연구실", "/about/", ""), ("커뮤니티", "/board/a1/", ""), ("가", "/board/a1/", "커뮤니티"),
                               ("나", "/board/a2/", ""), ("다", "/board/a3/", "연구실"), ("라", "/board/a4/", "커뮤니티"),
                               ("회원", "/lab/", "")])


if __name__ == "__main__":
    unittest.main()
