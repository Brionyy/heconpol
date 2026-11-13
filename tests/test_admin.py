"""관리 화면 · 가입 흐름(2026-10-28) 시험.

- 칸 규칙(schema/tables.json)이 표 첫 줄과 맞고, 지금 표가 규칙을 지키는가(관리 화면에서 저장해도 공개 단계가 멈추지 않음)
- 만들기(build.py)와 관리 화면 부품(site-tables.js)이 같은 예를 같게 판단하는가(tests/fixtures/rule_cases.json)
- 틀린 줄 · 겹친 번호가 있으면 만들기가 어느 파일 몇 번째 줄인지 알리며 멈추는가, --check 는 화면을 안 쓰는가
- 관리 화면 · 가입 화면에 필요한 스크립트 · 자료가 실리는가(미리 보기에서만 표를 실음)
- 공개 단계 지킴이가 허락 밖 파일을 막는가, 서버 도우미의 표 부품 사본이 원본과 같은가
- node · deno 가 있으면 표 부품 시험(site_tables_test.mjs) · 서버 도우미 시험(site_content_test.ts)도 돌린다
"""
import csv
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402
import check_admin_commit  # noqa: E402


class RulesTest(unittest.TestCase):
    def setUp(self):
        self.rules = build.load_rules()

    def test_rules_columns_in_table_headers(self):
        for name, t in self.rules["tables"].items():
            with (ROOT / t["file"]).open(encoding="utf-8-sig", newline="") as f:
                header = [c.strip() for c in next(csv.reader(f))]
            for col in t["columns"]:
                self.assertIn(col["name"], header, f"{t['file']} 첫 줄에 '{col['name']}' 칸")

    def test_current_tables_follow_rules(self):
        self.assertEqual(build.check_table_rules(), [])

    def test_rule_cases_same_answer_as_admin_screen(self):
        cases = json.loads((ROOT / "tests/fixtures/rule_cases.json").read_text(encoding="utf-8"))["cases"]
        for tname, col, value, expect in cases:
            c = next(x for x in self.rules["tables"][tname]["columns"] if x["name"] == col)
            msg = build.check_cell(self.rules, c, value)
            self.assertEqual(msg is None, expect, f"{tname}.{col}={value!r}: {msg}")

    def test_bad_row_and_duplicate_number_reported_with_line(self):
        with tempfile.TemporaryDirectory() as d:
            people, alumni = Path(d) / "people.csv", Path(d) / "alumni.csv"
            people.write_text("과정,이름,역할,영문 이름,메일,메일 공개,관심 분야,사진,CV 주소,번호\r\n"
                              "박사과정,가나,,,,보임,,,,1\r\n학부,다라,,,,보임,,,,2\r\n", encoding="utf-8")
            alumni.write_text("학위,졸업 연도,이름,지금 소속,학위논문,사진,번호\n박사,2020,마바,,,,1\n", encoding="utf-8")
            rules = json.loads(json.dumps(self.rules))
            rules["tables"] = {"people": dict(rules["tables"]["people"], file=str(people)),
                               "alumni": dict(rules["tables"]["alumni"], file=str(alumni))}
            problems = build.check_table_rules(rules)
            self.assertIn((str(people), 3, "과정", "박사과정 · 석사과정 가운데 하나를 고릅니다"), problems)
            self.assertTrue(any(p[0] == str(alumni) and p[2] == "번호" and "겹칩니다" in p[3] for p in problems), problems)

    def test_check_flag_writes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            r = subprocess.run([sys.executable, "build.py", "--check", "--out", str(out)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("검사 통과", r.stdout)
            self.assertFalse(out.exists())


class AdminPagesTest(unittest.TestCase):
    def pages(self, local):
        site = build.Site(local=local)
        build.build_pages(site)
        return {p["path"]: p for p in site.pages}

    def test_admin_page_scripts_and_fake_tables(self):
        p = self.pages(True)["/lab/admin/"]
        s = p["scripts"]
        for f in ("/assets/js/lab/site-tables.js", "/assets/js/lab/upload.js", "/assets/js/lab/admin.js"):
            self.assertIn(f, s)
        self.assertLess(s.index("/assets/js/lab/admin.js"), s.index("/assets/js/lab/app.js"))
        texts = p["data"]["site_tables"]["texts"]
        self.assertEqual(set(texts), {"people", "alumni", "news", "projects", "courses"})
        self.assertEqual(texts["people"], (ROOT / "data/people.csv").read_text(encoding="utf-8"))

    def test_public_build_does_not_embed_tables(self):
        # 공개용(진짜 서버)에서는 관리 화면에 표를 싣지 않는다(서버 도우미가 GitHub 에서 읽음)
        p = self.pages(False)["/lab/admin/"]
        self.assertNotIn("site_tables", p["data"])
        self.assertNotIn("/assets/js/lab/api-fake.js", p["scripts"])

    def test_join_page_courses_follow_rules(self):
        p = self.pages(True)["/login/join/"]
        rules = build.load_rules()
        courses = next(c["choices"] for c in rules["tables"]["people"]["columns"] if c["name"] == "과정")
        self.assertEqual(p["data"]["person_courses"], courses)


class GuardTest(unittest.TestCase):
    def test_allowed_paths(self):
        rules = build.load_rules()
        ok = ["data/people.csv", "data/news.csv", "assets/img/people/25-abc.jpg", "assets/img/alumni/a.webp"]
        no = ["build.py", "assets/js/lab/app.js", "data/site.csv", "data/menu.csv", "assets/img/people/../x.jpg",
              "assets/img/people/sub/a.jpg", "assets/img/people/a.svg", ".github/workflows/pages.yml", "schema/tables.json"]
        for p in ok:
            self.assertTrue(check_admin_commit.allowed(rules, p), p)
        for p in no:
            self.assertFalse(check_admin_commit.allowed(rules, p), p)

    def test_workflow_runs_guard(self):
        wf = (ROOT / ".github/workflows/pages.yml").read_text(encoding="utf-8")
        self.assertIn("tools/check_admin_commit.py", wf)
        self.assertIn("fetch-depth: 0", wf)
        # 허락 목록 · 지킴이는 지난번 공개된 판에서 읽고, 정기 실행에도 돈다(검토 10-28 1번)
        self.assertIn("--rules-ref", wf)
        self.assertNotIn("if: github.event_name == 'push'", wf)

    def test_guard_reads_rules_from_ref_and_blocks(self):
        # 시험용 저장소: 첫 판(허락 목록 있음) 뒤에 도우미가 app.js 와 허락 목록을 함께 바꾼 판 → 지난번 판의 목록으로 보므로 막힘
        with tempfile.TemporaryDirectory() as d:
            repo = Path(d)
            run = lambda *a, **kw: subprocess.run(["git", *a], cwd=repo, check=True, capture_output=True, text=True, **kw)
            run("init", "-q")
            (repo / "schema").mkdir()
            (repo / "data").mkdir()
            (repo / "assets/js").mkdir(parents=True)
            shutil.copy(ROOT / "schema/tables.json", repo / "schema/tables.json")
            (repo / "data/people.csv").write_text("x\n", encoding="utf-8")
            (repo / "assets/js/app.js").write_text("ok\n", encoding="utf-8")
            run("add", "-A")
            run("-c", "user.name=사람", "-c", "user.email=a@b.c", "commit", "-qm", "첫 판")
            base = run("rev-parse", "HEAD").stdout.strip()
            rules = json.loads((repo / "schema/tables.json").read_text(encoding="utf-8"))
            rules["tables"]["people"]["file"] = "assets/js/app.js"
            (repo / "schema/tables.json").write_text(json.dumps(rules, ensure_ascii=False), encoding="utf-8")
            (repo / "assets/js/app.js").write_text("evil\n", encoding="utf-8")
            run("add", "-A")
            run("-c", "user.name=heconpol-admin[bot]", "-c", "user.email=bot@x", "commit", "-qm", "도우미 판")
            head = run("rev-parse", "HEAD").stdout.strip()
            r = subprocess.run([sys.executable, str(ROOT / "tools/check_admin_commit.py"), "--root", str(repo), "--rules-ref", base, base, head],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("assets/js/app.js", r.stderr)
            # 사람 판만 있으면 통과
            ok = subprocess.run([sys.executable, str(ROOT / "tools/check_admin_commit.py"), "--root", str(repo), "--rules-ref", base, base, base],
                                capture_output=True, text=True)
            self.assertEqual(ok.returncode, 0, ok.stderr)

    def test_function_copy_same_as_site_part(self):
        a = (ROOT / "assets/js/lab/site-tables.js").read_text(encoding="utf-8")
        b = (ROOT / "supabase/functions/_shared/site-tables.js").read_text(encoding="utf-8")
        self.assertEqual(a, b, "supabase/functions/_shared/site-tables.js 를 assets/js/lab/site-tables.js 와 같게 복사하십시오")


class ScriptTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node 없음")
    def test_site_tables_js(self):
        r = subprocess.run(["node", "tests/site_tables_test.mjs"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    @unittest.skipUnless(shutil.which("deno"), "deno 없음")
    def test_site_content_function(self):
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run(["deno", "test", "--no-config", "-A", "supabase/functions/site-content/site_content_test.ts"],
                               cwd=ROOT, capture_output=True, text=True, env={**__import__("os").environ, "DENO_DIR": d, "NO_COLOR": "1"})
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
