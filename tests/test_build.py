"""만들기 파일(build.py) 시험: 글 바꾸기가 코드를 막는지, 표 오류를 알기 쉽게 알려 주는지, 만든 화면이 규칙을 지키는지."""
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


class MarkdownTest(unittest.TestCase):
    def test_html_is_text(self):
        out = build.md_to_html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
        self.assertNotIn("<script", out)
        self.assertNotIn("<img", out)
        self.assertIn("&lt;script&gt;", out)

    def test_bad_links_removed(self):
        out = build.md_to_html("[a](javascript:alert(1)) [b](data:text/html,x) [c](https://snu.ac.kr) [d](/about/)")
        self.assertNotIn("javascript:", out)
        self.assertNotIn("data:", out)
        self.assertIn('href="https://snu.ac.kr" rel="noopener noreferrer"', out)
        self.assertIn('href="/about/"', out)

    def test_mailto_hidden_from_simple_bots(self):
        out = build.md_to_html("[kwons@snu.ac.kr](mailto:kwons@snu.ac.kr)")
        self.assertNotIn("kwons@snu.ac.kr", out)
        self.assertIn("&#64;", out)

    def test_blocks(self):
        out = build.md_to_html("## 제목 {#visit}\n\n- 하나\n- 둘\n\n| 가 | 나 |\n|---|---|\n| 1 | 2 |\n\n> 인용")
        self.assertIn('<h2 id="visit">제목</h2>', out)
        self.assertIn("<ul><li>하나</li><li>둘</li></ul>", out)
        self.assertIn('<th scope="col">가</th>', out)
        self.assertIn("<td>2</td>", out)
        self.assertIn("<blockquote>", out)

    def test_sections(self):
        # 글 화면은 절(h2)마다 묶는다: 앞 문단은 lead-block, 절은 제목 + sec-body
        out = build.by_section(build.md_to_html("첫 문단\n\n## 하나 {#one}\n\n가\n\n## 둘\n\n- 나"))
        self.assertTrue(out.startswith('<div class="lead-block"><p>첫 문단</p>'))
        self.assertIn('<section class="sec"><h2 id="one">하나</h2><div class="sec-body">', out)
        self.assertEqual(out.count('<section class="sec">'), 2)
        self.assertEqual(build.by_section("<h2>제목</h2><p>가</p>").count("lead-block"), 0)

    def test_fonts_stay_inside(self):
        # 글꼴 목록은 사이트 안 파일만 부르고, 부르는 파일이 모두 있다
        fonts = ROOT / "assets/fonts"
        css = (fonts / "fonts.css").read_text(encoding="utf-8")
        self.assertNotIn("http", css)
        for f in re.findall(r"url\(['\"]?([^'\")]+)['\"]?\)", css):
            self.assertTrue((fonts / f).exists(), f)


class TableTest(unittest.TestCase):
    def test_missing_cell_message(self):
        # 시험 표는 임시 폴더에 둔다(iCloud 안 data/ 에 만들었다 지우기를 되풀이하면 ' 2' 사본이 생길 수 있음)
        real = build.DATA
        with tempfile.TemporaryDirectory() as d:
            build.DATA = Path(d)
            (build.DATA / "_시험표.csv").write_text("이름,주소\n교수,\n", encoding="utf-8")
            try:
                with self.assertRaises(build.BuildError) as cm:
                    build.read_table("_시험표", ["이름", "주소"])
                self.assertIn("2번째 줄", str(cm.exception))
                self.assertIn("'주소'", str(cm.exception))
            finally:
                build.DATA = real


class PaletteTest(unittest.TestCase):
    """data/site.csv '색 배치'(2026-10-27): '기본'은 원래 화면 그대로, 다른 이름은 palettes.css 를 붙인다."""

    def render(self, palette=None):
        site = build.Site(local=True, palette=palette)
        site.page("/x/", "시험", "<p>시험</p>")
        return site.render(site.pages[0])

    def test_default_adds_nothing(self):
        s = self.render("기본")
        self.assertIn('<html lang="ko">', s)
        self.assertNotIn("palettes.css", s)

    def test_named_palette_links_css(self):
        for name, key in build.PALETTES.items():
            if not key:
                continue
            s = self.render(name)
            self.assertIn(f'<html lang="ko" data-palette="{key}">', s)
            self.assertRegex(s, r'site\.css\?v=\w+">\n<link rel="stylesheet" href="/assets/css/palettes\.css\?v=\w+">')

    def test_every_palette_has_colors(self):
        css = (ROOT / "assets/css/palettes.css").read_text(encoding="utf-8")
        for key in filter(None, build.PALETTES.values()):
            self.assertIn(f'html[data-palette="{key}"] {{', css)

    def test_unknown_name_message(self):
        with self.assertRaises(build.BuildError) as cm:
            build.Site(local=True, palette="분홍")
        self.assertIn("쓸 수 있는 이름: 기본, 신뢰, 고급", str(cm.exception))


class ListPagesTest(unittest.TestCase):
    """디자인 2회차(2026-10-27) 목록 화면: 수행연구 접기 · 구성원 카드 · 졸업생 · 소식 연도 묶음."""

    @classmethod
    def setUpClass(cls):
        cls.site = build.Site(local=True)
        build.build_pages(cls.site)
        cls.body = {p["path"]: p["body"] for p in cls.site.pages}

    def test_projects_recent_years_open_older_folded(self):
        b = self.body["/research/projects/"]
        rows = build.read_table("projects", ["연도", "과제"])
        years = sorted({r["연도"] for r in rows}, reverse=True)
        n = build.setting_int(self.site.cfg, "수행연구 펼칠 햇수", 5)
        for y in years[:n]:
            self.assertIn(f'<section class="grp" id="y{y}">', b)
        for y in years[n:]:
            self.assertIn(f'<section class="grp grp-fold" id="y{y}"><details><summary>', b)
        self.assertEqual(b.count("<details>"), max(0, len(years) - n))
        self.assertEqual(b.count("<li>"), len(rows))  # 접어도 과제는 모두 화면 안에 있다

    def test_open_years_must_be_number(self):
        with self.assertRaises(build.BuildError) as cm:
            build.setting_int({"수행연구 펼칠 햇수": "다섯"}, "수행연구 펼칠 햇수", 5)
        self.assertIn("숫자만", str(cm.exception))

    def test_english_titles_marked(self):
        # 관리 화면에서 과제를 고쳐도 시험이 멈추지 않게 시험용 줄로 본다(10-28)
        self.assertIn('<span lang="en">Strengthening the Performance', build.project_li({"연도": "2024", "과제": "Strengthening the Performance of Health Systems", "진행 중": ""}))
        self.assertTrue(build.is_english("Health policy"))
        self.assertFalse(build.is_english("에티오피아 UHC 달성을 위한 건강보험정책 협력사업 형성조사"))

    def test_people_cards_with_interest_label(self):
        b = self.body["/people/"]
        people = build.read_table("people", ["과정", "이름"])
        roles = [p for p in people if p.get("역할")]
        self.assertEqual(b.count('<article class="person">'), len(people) - len(roles))
        self.assertEqual(b.count('<article class="person has-role">'), len(roles))
        self.assertEqual(b.count('<span class="role">'), len(roles))
        # 관심 분야 · 메일 · CV 는 같은 이름표 줄(연구자, 10-27: "관심분야만 … 카테고리 … 이메일은 띡")
        self.assertEqual(b.count("<dt>관심 분야</dt>"), sum(1 for p in people if p.get("관심 분야")))
        self.assertEqual(b.count("<dt>메일</dt>"), sum(1 for p in people if p.get("메일") and not build.is_no(p.get("메일 공개", ""))))
        # CV는 메일 줄 끝에 붙는다(10-28). 메일을 안 보이는 사람만 'CV' 줄을 따로
        self.assertEqual(b.count('class="cv"'), sum(1 for p in people if build.cv_ok(p.get("CV 주소", ""))))
        self.assertEqual(b.count("<dt>CV</dt>"), sum(1 for p in people if build.cv_ok(p.get("CV 주소", ""))
                                                     and not (p.get("메일") and not build.is_no(p.get("메일 공개", "")))))
        self.assertNotIn('class="links"', b)
        for g in {p["과정"] for p in people}:
            self.assertIn(f'<section class="people-group" id="{build.anchor_name(g)}"><h2>{g}</h2>', b)

    def test_interest_keywords(self):
        # 관심 분야는 키워드(11-02 저녁): 본인 요청은 ' · '로, 예전 글은 쉼표로 나뉘어 있어도 같은 모양으로 낱말마다 나눈다
        self.assertEqual(build.keywords("건강보험 ·  장기요양, 건강보험,Health policy"), ["건강보험", "장기요양", "Health policy"])
        self.assertEqual(build.keywords(""), [])
        self.assertEqual(build.keyword_list("국제보건 · Health policy"),
                         '<ul class="kws"><li>국제보건</li><li><span lang="en">Health policy</span></li></ul>')
        b = self.body["/people/"]
        people = build.read_table("people", ["과정", "이름"])
        self.assertEqual(b.count('<ul class="kws">'), sum(1 for p in people if build.keywords(p.get("관심 분야"))))
        self.assertEqual(b.count('<ul class="kws"><li>'), b.count('<ul class="kws">'))

    def test_no_head_counts(self):
        # 재학생 · 졸업생 수는 쓰지 않는다(연구자, 10-27). 수행연구 · 소식의 건수는 둔다
        self.assertNotIn('class="cnt"', self.body["/people/"])
        self.assertNotIn('class="cnt"', self.body["/alumni/"])
        self.assertIn('<p class="cnt">', self.body["/research/projects/"])

    def test_role_tag(self):
        site = build.Site(local=True)
        card = build.person_card(site, {"이름": "가나", "역할": "조교"})
        self.assertIn('<article class="person has-role">', card)
        self.assertIn('<h3>가나 <span class="role">조교</span></h3>', card)
        self.assertNotIn("has-role", build.person_card(site, {"이름": "가나"}))

    def test_cv_link_only_for_safe_address(self):
        site = build.Site(local=True)
        link = ('<a class="cv" href="https://example.com/cv.pdf" target="_blank" rel="noopener noreferrer" '
                'aria-label="가나 CV 보기(새 창)">CV</a>')
        # 메일이 보이면 메일 줄 끝에 흐린 'CV'(10-28 연구자: "이메일 옆에 눈에 띄지 않게")
        ok = build.person_card(site, {"이름": "가나", "메일": "a@snu.ac.kr", "CV 주소": "https://example.com/cv.pdf"})
        self.assertIn('</a><span class="cv-wrap"><span class="cv-sep" aria-hidden="true">·</span>' + link + "</span></dd>", ok)
        self.assertNotIn("<dt>CV</dt>", ok)
        self.assertNotIn("example.com/cv.pdf</a>", ok)  # 주소 글자는 화면에 안 보인다
        # 메일을 안 보이면 'CV' 줄을 따로
        alone = build.person_card(site, {"이름": "가나", "CV 주소": "https://example.com/cv.pdf"})
        self.assertIn("<div><dt>CV</dt><dd>" + link + "</dd></div>", alone)
        self.assertNotIn("cv-sep", build.person_card(site, {"이름": "가나", "메일": "a@snu.ac.kr"}))  # CV 없으면 점도 없음
        for bad in ("javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "http://example.com/cv", "https://a b", ""):
            self.assertNotIn('class="cv"', build.person_card(site, {"이름": "가나", "CV 주소": bad}), bad)

    def test_member_cv_from_my_info(self):
        # 회원이 '내 정보'에서 적은 주소(사이트를 만들 때 받아 둔 파일)가 표의 'CV 주소'보다 먼저, 같은 이름에만 붙는다
        # 받아 둔 파일은 임시 폴더에 만든다(iCloud 안 data/ 에 만들었다 지우면 ' 2' 사본이 생길 수 있음)
        real = build.MEMBER_CV
        with tempfile.TemporaryDirectory() as d:
            build.MEMBER_CV = tmp = Path(d) / "_member_cv.json"
            # 10-28부터 이름 대신 구성원 카드 '번호'로 잇는다(관리 화면에서 회원과 카드를 이어 둔 사람만)
            tmp.write_text('[{"person_no": 7, "cv_url": "https://me.example/cv"}, {"person_no": 8, "cv_url": "javascript:x"}, {"person_no": "a", "cv_url": "https://x.example"}]',
                           encoding="utf-8")
            try:
                site = build.Site(local=True)
                site.member_cv = build.load_member_cv()
                self.assertEqual(site.member_cv, {"7": "https://me.example/cv"})  # 규칙에 안 맞는 주소 · 번호는 버림
                card = build.person_card(site, {"이름": "가나", "번호": "7", "CV 주소": "https://table.example/cv"})
                self.assertIn('href="https://me.example/cv"', card)
                # 이름이 같아도 번호가 다르면 안 붙는다(이름은 회원이 바꿀 수 있음)
                self.assertIn('href="https://table.example/cv"', build.person_card(site, {"이름": "가나", "번호": "9", "CV 주소": "https://table.example/cv"}))
                # 11-02: 본인이 'CV 공개'를 끄면 그 카드는 표에 적힌 CV 주소까지 숨긴다(점 · CV 줄도 없음)
                tmp.write_text('[{"person_no": 7, "cv_url": "https://me.example/cv", "cv_public": true}, {"person_no": 9, "cv_url": null, "cv_public": false}]',
                               encoding="utf-8")
                site.member_cv = build.load_member_cv()
                self.assertEqual(site.member_cv, {"7": "https://me.example/cv", "9": ""})
                hidden = build.person_card(site, {"이름": "가나", "번호": "9", "메일": "a@snu.ac.kr", "CV 주소": "https://table.example/cv"})
                self.assertNotIn('class="cv"', hidden)
                self.assertNotIn("cv-sep", hidden)
                self.assertIn('href="https://me.example/cv"', build.person_card(site, {"이름": "가나", "번호": "7"}))
                tmp.unlink()
                self.assertEqual(build.load_member_cv(), {})
            finally:
                build.MEMBER_CV = real

    def test_alumni_lineage(self):
        # 졸업생 '학문 가계도'(10-27 연구자 선택 B안): 교수님에서 시작해 처음 졸업생부터 해마다 마디 하나
        b = self.body["/alumni/"]
        rows = build.read_table("alumni", ["학위", "졸업 연도", "이름"])
        years = sorted({a["졸업 연도"] for a in rows})
        self.assertIn('<li class="t-root"><p class="nm"><a href="/professor/">권순만 교수</a></p>', b)
        self.assertEqual(b.count('<li class="t-year"'), len(years))
        positions = [b.index(f'<li class="t-year" id="y{y}">') for y in years]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(b.count('<h3 class="nm">'), len(rows))
        self.assertEqual(b.count('class="th"'), sum(1 for a in rows if a.get("학위논문")))  # 학위논문 칸이 비면 아무것도 안 보인다
        # 같은 해 졸업생은 가나다순
        for y in years:
            part = b[b.index(f'id="y{y}"'):].split('</ul>', 1)[0]
            names = re.findall(r'<h3 class="nm">(?:<span lang="en">)?([^<]+)', part)
            self.assertEqual(names, sorted(names, key=lambda n: (not re.match("[가-힣]", n), n)), y)

    def test_alumni_leaf_optional_fields(self):
        site = build.Site(local=True)
        leaf = build.alum_leaf(site, {"학위": "석사", "이름": "가나", "지금 소속": "", "학위논문": "제목", "사진": "a.jpg"})
        self.assertIn('<li class="has-ph"><img class="ph" src="/assets/img/alumni/a.jpg"', leaf)
        self.assertIn('<span class="deg">석사</span>', leaf)
        self.assertIn('<p class="th"><span class="lbl">학위논문</span> 제목</p>', leaf)
        self.assertNotIn('class="af"', leaf)

    def test_motion_is_optional(self):
        # 가계도 움직임은 지원하는 브라우저에서 '동작 줄이기'가 꺼져 있을 때만
        css = (ROOT / "assets/css/site.css").read_text(encoding="utf-8")
        start = css.index("@supports (animation-timeline: view())")
        self.assertIn("prefers-reduced-motion: no-preference", css[start:start + 300])
        self.assertNotIn("animation-timeline", css[:start])

    def test_news_grouped_by_year_with_month_day(self):
        b = self.body["/news/"]
        news = build.read_table("news", ["날짜", "제목"])
        for y in {n["날짜"][:4] for n in news}:
            self.assertIn(f'<section class="grp" id="y{y}">', b)
        if news:   # 관리 화면에서 소식을 모두 빼도 시험이 멈추지 않게(10-28)
            d = news[0]["날짜"]
            self.assertIn(f'<time datetime="{d}">{d[5:7]}.{d[8:10]}</time>', b)
        # 첫 화면 소식은 해까지 쓴다(시험용 줄)
        self.assertIn('<time datetime="2026-10-28">2026.10.28</time>', build.news_row(self.site, {"날짜": "2026-10-28", "제목": "시험 소식"}))

    def test_course_desc_shown(self):
        # 과목 소개는 처음부터 과목마다 한 문단(10-28 연구자: "과목소개는 기본적으로 나오게"), 설명이 빈 과목은 아무것도 안 보인다
        b = self.body["/courses/"]
        courses = build.read_table("courses", ["과목 이름"])
        with_text = [c for c in courses if c.get("설명", "").strip()]
        self.assertEqual(b.count('<p class="course-desc"'), len(with_text))
        self.assertNotIn("<details", b)
        if with_text:   # 첫 과목 설명이 영어가 아니어도 · 설명이 모두 비어도 시험이 멈추지 않게(10-28)
            self.assertIn(build.course_desc(with_text[0]), b)
        self.assertEqual(build.course_desc({"과목 이름": "가나", "설명": "Health policy"}), '<p class="course-desc" lang="en">Health policy</p>')
        self.assertEqual(build.course_desc({"과목 이름": "가나", "설명": ""}), "")
        self.assertEqual(build.course_desc({"과목 이름": "가나", "설명": "보건 재정 과목"}), '<p class="course-desc">보건 재정 과목</p>')

    def test_round4_access(self):
        # 디자인 4회차(10-28): 자바스크립트를 끈 브라우저용 꾸밈, 첫 화면 연구 분야 제목(h1 다음 h3 로 건너뛰지 않게), 로고 크기 표시
        tpl = (ROOT / "templates/base.html").read_text(encoding="utf-8")
        self.assertIn('<noscript><link rel="stylesheet" href="{{ nojs_css }}"></noscript>', tpl)
        nojs = (ROOT / "assets/css/nojs.css").read_text(encoding="utf-8")
        self.assertIn(".nav-list { display: flex; }", nojs)
        self.assertIn('<h2 class="sr-only" id="h-areas">연구 분야</h2>', self.body["/"])
        self.assertEqual(len(re.findall(r'<img [^>]*width="\d+" height="38">', tpl)), 2)

    def test_list_styles(self):
        css = (ROOT / "assets/css/site.css").read_text(encoding="utf-8")
        self.assertIn("font-variant-numeric: tabular-nums", css)
        self.assertNotIn("tbl-years", css)
        self.assertNotRegex(css, r"\.gallery figure \{[^}]*border")


class TextPagesTest(unittest.TestCase):
    """글 화면(2026-10-28): 소개는 교수님 글 그대로 + 왼쪽 칸 이름표, 글 문단은 한 크기, 교수 직함 줄 아래 나눔선."""

    @classmethod
    def setUpClass(cls):
        cls.site = build.Site(local=True)
        build.build_pages(cls.site)
        cls.body = {p["path"]: p["body"] for p in cls.site.pages}
        cls.css = (ROOT / "assets/css/site.css").read_text(encoding="utf-8")

    def test_about_text_kept_with_label(self):
        b = self.body["/about/"]
        self.assertIn('<section class="sec"><h2>연구실 소개</h2>', b)
        self.assertNotIn("lead-block", b)
        self.assertNotIn("&lt;!--", b)  # 메모가 화면에 글로 새지 않게
        src = build.read_text("about.md")
        paras = [t.strip() for t in src.split("\n\n") if t.strip() and not t.strip().startswith(("<!--", "#"))]
        self.assertEqual(len(paras), 4)
        for t in paras:
            self.assertIn(build.esc(t), b)

    def test_one_text_size(self):
        # 크게 쓰는 줄은 교수 화면 직함 줄뿐. 다른 글 화면은 절마다 위에 먹색 가는 선
        self.assertNotRegex(self.css, r"(?m)^\.lead-block > p:first-child \{")
        self.assertIn(".prose--aside .lead-block > p:first-child, ", self.css)
        self.assertIn(".prose > .sec { border-top: 1px solid var(--ink);", self.css)

    def test_professor_title_dividers(self):
        self.assertIn("linear-gradient(var(--gold), var(--gold)) 0 0 / 40px 2px no-repeat", self.css)
        b = self.body["/professor/"]
        self.assertIn('<div class="lead-block"><p>서울대학교 보건대학원 보건정책관리학과 교수</p>', b)
        self.assertIn('<section class="sec"><h2>Profile</h2><div class="sec-body">\n<p>Professor and Former Dean', b)
        self.assertEqual(b.count('<section class="tl-part">'), 2)  # 경력 · 학력 나눔 유지(다른 연구실 18곳 조사, 10-28)


class SiteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 공개용 화면은 임시 폴더에 만든다(미리 보기 _site 를 공개용으로 바꿔 놓지 않게)
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name)
        subprocess.run([sys.executable, str(ROOT / "build.py"), "--out", str(cls.out)], check=True, capture_output=True)
        cls.pages = list(cls.out.rglob("*.html"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_every_page_has_csp_first(self):
        for p in self.pages:
            head = p.read_text(encoding="utf-8")[:600]
            self.assertIn('http-equiv="Content-Security-Policy"', head, p)
            self.assertIn("default-src 'none'", head, p)
            self.assertIn("upgrade-insecure-requests", head, p)

    def test_no_inline_code_or_outside_sources(self):
        for p in self.pages:
            s = p.read_text(encoding="utf-8")
            self.assertIsNone(re.search(r"\sstyle=|\son[a-z]+=|<script>(?!</)", s), p)
            for src in re.findall(r'(?:src|href)="(https?://[^"]+)"', s):
                self.assertFalse(src.endswith((".js", ".css")), f"{p}: 바깥 부품 {src}")

    def test_lab_pages_noindex_and_no_fake(self):
        for p in self.out.glob("lab/**/*.html"):
            s = p.read_text(encoding="utf-8")
            self.assertIn('name="robots" content="noindex', s, p)
            self.assertNotIn("api-fake.js", s, p)
        self.assertFalse((self.out / "assets/js/lab/api-fake.js").exists())


if __name__ == "__main__":
    unittest.main()
