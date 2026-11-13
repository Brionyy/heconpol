"""제목 띠 · 첫 화면 · 교수 화면 시험(2026-10-27): 화면마다 선 그림과 바로가기, 교수 CV · 이력, 첫 화면 지구본 장면."""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


class BandTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = build.Site(local=True)
        build.build_pages(cls.site)
        cls.pages = {p["path"]: p for p in cls.site.pages}
        cls.html = {path: cls.site.render(p) for path, p in cls.pages.items()}

    def test_band_index_points_to_real_sections(self):
        # 제목 띠 '이 화면 바로가기'의 #주소는 본문에 실제로 있어야 한다
        for path in ("/research/", "/research/projects/", "/people/", "/news/"):
            h = self.html[path]
            nav = re.search(r'<nav class="band-index".*?</nav>', h, re.S)
            self.assertIsNotNone(nav, path)
            for a in re.findall(r'href="#([^"]+)"', nav.group(0)):
                self.assertIn(f'id="{a}"', h, (path, a))

    def test_no_people_counts(self):
        # 재학생 · 졸업생 수는 쓰지 않는다(연구자 10-27)
        for path in ("/people/", "/alumni/"):
            self.assertNotIn("명</span>", self.html[path], path)

    def test_inner_pages_have_line_art(self):
        # 사진 띠 화면(세미나 게시판, 11-13 연구자 선택)은 선 그림 대신 사진을 깐다
        for path, p in self.pages.items():
            if p["kind"] != "home" and not p.get("band_photo"):
                self.assertIn('class="band-art', self.html[path], path)

    def test_seminar_photo_band(self):
        # 11-13 세미나 '가': 강의실 사진 띠 + 띠 안 찾기 칸(이 게시판 주소로 q). 회차 · 연도 칸 · 자료 표시는 넣지 않음
        h = self.html["/board/seminar/"]
        band = re.search(r'<div class="band band--photo">.*?</form>', h, re.S)
        self.assertIsNotNone(band)
        self.assertIn('src="/assets/img/photos/classroom.jpg"', band.group(0))
        self.assertRegex(band.group(0), r'<form class="band-search"[^>]*action="/board/seminar/"')
        self.assertIn('name="q"', band.group(0))
        self.assertNotIn("band--photo", self.html["/board/free/"])

    def test_professor_cv_and_timeline(self):
        h = self.html["/professor/"]
        self.assertRegex(h, r'<p class="band-cv"><a href="https://[^"]+" target="_blank" rel="noopener noreferrer"')
        aside = re.search(r'<aside class="timeline".*?</aside>', h, re.S).group(0)
        self.assertEqual(re.findall(r"<h2>([^<]+)</h2>", aside), ["경력", "학력"])  # 다른 연구실 교수 소개처럼 나눔
        self.assertNotIn("교육상", aside)  # 상은 이력에 넣지 않는다(연구자 10-27)
        self.assertIn("Chief of Health Sector Group", aside)  # 교수님이 영어로만 쓰신 직함은 번역하지 않는다
        self.assertEqual(aside.count('class="now"'), 2)  # 지금 맡은 일(소장 · 교수)만 금색 점

    def test_globe_slide_only_on_home(self):
        home = self.html["/"]
        self.assertIn('class="slide slide--globe', home)
        self.assertNotIn('class="tags"', home)  # 협력 나라 선 · 이름표 없이 지구본만(연구자 10-27)
        self.assertIn('<script type="module" src="/assets/js/globe.js?v=', home)
        self.assertEqual(re.findall(r"'sha256-[^']+'", re.search(r"style-src[^;\"]*", home).group(0)),
                         [f"'sha256-{h}'" for h in build.COBE_STYLE_SHA])
        for path, h in self.html.items():
            if path != "/":
                self.assertEqual(re.search(r"style-src[^;\"]*", h).group(0).strip(), "style-src 'self'", path)
                self.assertNotIn("globe.js", h, path)

    def test_unknown_slide_art_name(self):
        orig = build.read_table

        def fake(name, required=()):
            rows = orig(name, required)
            return rows + [dict(rows[0], 사진="@모르는그림")] if name == "slides" else rows

        build.read_table = fake
        try:
            with self.assertRaises(build.BuildError) as cm:
                build.build_pages(build.Site(local=True))
            self.assertIn("@모르는그림", str(cm.exception))
        finally:
            build.read_table = orig


if __name__ == "__main__":
    unittest.main()
