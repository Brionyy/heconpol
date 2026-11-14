"""자동 AI 티 검사(2026-11-14, 연구자 '추천대로': 홈페이지 AI 티 빼기 1단계).

만든 화면(임시 폴더에 --local 로 만듦)과 꾸밈 파일(site.css)을 읽어, 셀 수 있는 AI 티를 잡는다.
기준 글: workspace_hub/design/_rules/ai_tells.md(목록) · web_craft.md(세부 마감), 홈페이지 원칙 docs/3_디자인원칙.html 7절.

1. 제목 위 영문 대문자 머리말(예: 'SEOUL NATIONAL UNIVERSITY' 같은 짧은 대문자 줄)
2. 회색 · 검은 그림자(box-shadow 의 rgba(0,0,0,…) · 회색), 카드 그림자
3. 한글 글에 넓힌 자간(letter-spacing 이 0보다 큰데 그 자리에 한글이 있음), 명조 제목 -0.05em 보다 좁힘
4. 화면마다 쪽 제목 · 설명 메타 · 파비콘 · 공유 그림(og:image) 누락

공개 화면만 본다. 회원 칸(로그인 · 게시판 · 회원 화면)은 원칙 6절 예외(둥근 판 · 상태 알약 · 그림자)라 EXCEPT_PAGES 로 뺀다.
꾸밈 규칙이 어느 화면에 걸리는지는 화면 HTML 의 요소와 선택자를 맞춰 본다(자바스크립트가 나중에 만드는 요소는 못 봄, 눈 검수는 따로).
"""
import contextlib
import html.parser
import io
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build  # noqa: E402

# 회원 칸 화면: 원칙 6절 예외(둥근 판 · 그림자 · 상태 알약), 승인 뒤 회원 화면 정리 때 따로 본다
EXCEPT_PAGES = ("lab/", "login/", "board/")
# 꾸밈 규칙 예외(이유 한 줄씩). 선택자 글자 그대로 적는다
EXCEPT_RULES = {
    # 남색 알약 단추의 그림자: 10-28 밤 연구자 선택(원칙 6절), 단추 모양은 교수님 승인 뒤 회원 화면 정리 때 연구자에게 묻기로 함(11-14)
    "html .btn", "html .btn:hover:not([disabled])", "html .btn:active:not([disabled])",
    "html .btn-ghost", "html .btn-ghost:hover:not([disabled])",
}
HANGUL = re.compile(r"[가-힣]")


# ---------------------------------------------------------------- 화면 읽기

class Node:
    __slots__ = ("tag", "attrs", "parent", "children", "text")

    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent = tag, attrs, parent
        self.children, self.text = [], []

    @property
    def classes(self):
        return set((self.attrs.get("class") or "").split())

    def all_text(self):
        return "".join(self.text) + "".join(c.all_text() for c in self.children)

    def iter(self):
        yield self
        for c in self.children:
            yield from c.iter()


VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class TreeParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", {}, None)
        self.cur = self.root
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        node = Node(tag, {k: (v or "") for k, v in attrs}, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, {k: (v or "") for k, v in attrs}, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        if self.cur.tag not in ("script", "style"):
            self.cur.text.append(data)


def parse_html(text):
    p = TreeParser()
    p.feed(text)
    return p.root


# ---------------------------------------------------------------- 꾸밈 파일 읽기

def css_rules(css):
    """(선택자 목록, {속성: 값}, 키프레임 안인지)를 돌려준다. @media 안 규칙도 같이(어느 폭이든 걸리면 본다)."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = []

    def walk(text, in_kf):
        i = 0
        while i < len(text):
            j = text.find("{", i)
            if j < 0:
                break
            head = text[i:j].strip()
            depth, k = 1, j + 1
            while k < len(text) and depth:
                depth += {"{": 1, "}": -1}.get(text[k], 0)
                k += 1
            inner = text[j + 1:k - 1]
            if head.startswith("@media") or head.startswith("@supports"):
                walk(inner, in_kf)
            elif head.startswith("@keyframes"):
                walk(inner, True)
            elif head.startswith("@"):
                pass  # @font-face 등
            else:
                decls = {}
                for d in inner.split(";"):
                    if ":" in d:
                        prop, val = d.split(":", 1)
                        decls[prop.strip().lower()] = val.strip()
                out.append(([s.strip() for s in head.split(",") if s.strip()], decls, in_kf))
            i = k

    walk(css, False)
    return out


def css_vars(rules):
    v = {}
    for sels, decls, kf in rules:
        if any(s in (":root", "html") for s in sels):
            v.update({k: val for k, val in decls.items() if k.startswith("--")})
    return v


def resolve(val, vars_, depth=0):
    if depth > 8:
        return val
    out = re.sub(r"var\((--[\w-]+)(?:,\s*([^()]*))?\)",
                 lambda m: vars_.get(m.group(1), m.group(2) or ""), val)
    return resolve(out, vars_, depth + 1) if "var(" in out else out


# ---------------------------------------------------------------- 선택자 맞추기(필요한 만큼만)

COMPOUND = re.compile(r"([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?)*)")


def parse_compound(text):
    m = COMPOUND.fullmatch(text)
    if not m:
        return None
    tag, rest = m.group(1), m.group(2)
    classes = re.findall(r"\.([\w-]+)", rest)
    ids = re.findall(r"#([\w-]+)", rest)
    attrs = [a.split("=")[0].strip("~|^$*") for a in re.findall(r"\[([^\]]*)\]", rest)]
    pseudo_el = bool(re.search(r"::(before|after|marker|placeholder|selection|file-selector-button)", rest))
    return tag if tag not in (None, "*") else None, classes, ids, attrs, pseudo_el


def matches(node, comp):
    tag, classes, ids, attrs, _ = comp
    if tag and node.tag != tag:
        return False
    cls = node.classes
    if any(c not in cls for c in classes):
        return False
    if any(node.attrs.get("id") != i for i in ids):
        return False
    return all(a in node.attrs for a in attrs)


def select(roots, selector):
    """선택자에 맞는 요소들과 가상 요소(::before 등)인지를 돌려준다. 결합자 '>' · ' '는 같은 조상 맞춤으로, '+' · '~'는 앞 조건을 건너뜀."""
    sel = re.sub(r":not\([^)]*\)", "", selector)
    sel = re.sub(r"\s*([>+~])\s*", r" \1 ", sel).split()
    comps, skip_next = [], False
    for part in sel:
        if part in (">",):
            continue
        if part in ("+", "~"):
            if comps:
                comps.pop()   # 형제 조건은 보지 않고 넓게 맞춘다
            continue
        c = parse_compound(part)
        if c is None:
            return [], False
        comps.append(c)
    if not comps:
        return [], False
    last, ancestors = comps[-1], comps[:-1]
    found = []
    for root in roots:
        for node in root.iter():
            if node.tag == "#root" or not matches(node, last):
                continue
            p, need = node.parent, list(ancestors)
            while need and p is not None:
                if p.tag != "#root" and matches(p, need[-1]):
                    need.pop()
                p = p.parent
            if not need:
                found.append(node)
    return found, last[4]


# ---------------------------------------------------------------- 시험

def build_site(out):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        code = build.main(["--local", "--out", str(out)])
    if code not in (0, None):
        raise AssertionError(f"만들기 실패(돌려준 값 {code})")


GREY = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)|#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|\b(black|gray|grey)\b")


def grey_in(value):
    for m in GREY.finditer(value):
        if m.group(5):
            return m.group(0)
        if m.group(4):
            h = m.group(4)
            h = "".join(c * 2 for c in h) if len(h) == 3 else h
            r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        else:
            r, g, b = (int(m.group(i)) for i in (1, 2, 3))
        if r == g == b and r < 255:   # 흰색은 그림자가 아니라 빛 · 고리
            return m.group(0)
    return None


def spacing_em(value):
    """letter-spacing 값을 em 으로(px 는 18px 본문 기준으로 바꿈). 0 · normal 은 0."""
    v = value.strip().lower()
    if v in ("", "normal", "0", "inherit", "initial", "unset"):
        return 0.0
    m = re.fullmatch(r"(-?\d*\.?\d+)(em|px|rem)?", v)
    if not m:
        return 0.0
    n, unit = float(m.group(1)), m.group(2) or "px"
    return n / 18 if unit == "px" else n


class AiTellsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        out = Path(cls.tmp.name) / "site"
        build_site(out)
        cls.pages = {}
        for f in sorted(out.rglob("*.html")):
            rel = f.relative_to(out).as_posix()
            if rel.startswith(EXCEPT_PAGES) or "/assets/" in f"/{rel}":
                continue
            cls.pages[rel] = (f.read_text(encoding="utf-8"), parse_html(f.read_text(encoding="utf-8")))
        cls.out = out
        css = (ROOT / "assets/css/site.css").read_text(encoding="utf-8")
        cls.rules = css_rules(css)
        cls.vars = css_vars(cls.rules)
        cls.roots = [tree for _, tree in cls.pages.values()]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_public_pages_found(self):
        # 공개 화면(첫 화면 · 소개 · 연구 분야 · 수행연구 · 교수 · 교과목 · 구성원 · 졸업생 · 소식 · English · 개인정보 등)을 실제로 읽었는지
        for rel in ("index.html", "about/index.html", "professor/index.html", "people/index.html",
                    "news/index.html", "en/index.html"):
            self.assertIn(rel, self.pages)
        self.assertGreaterEqual(len(self.pages), 12)

    def test_no_english_caps_kicker(self):
        # 제목(h1 · h2 · h3) 바로 앞 짧은 줄이 영문 대문자뿐이면 AI 티(ai_tells 2-2 '제목 위 작은 영문 대문자 머리말')
        found = []
        for rel, (_, tree) in self.pages.items():
            for node in tree.iter():
                kids = [c for c in node.children if c.tag not in ("script", "style")]
                for a, b in zip(kids, kids[1:]):
                    if b.tag not in ("h1", "h2", "h3") or a.tag in ("h1", "h2", "h3"):
                        continue
                    t = " ".join(a.all_text().split())
                    if 2 <= len(t) <= 48 and re.search(r"[A-Z]{2}", t) and not HANGUL.search(t) and t == t.upper():
                        found.append(f"{rel}: '{t}' → {b.tag}")
        self.assertEqual(found, [], "제목 위 영문 대문자 머리말")

    def test_no_grey_or_card_shadow(self):
        # 공개 화면에 걸리는 그림자에 회색 · 검정이 있으면 AI 티(ai_tells 2-1), 카드에는 그림자 자체를 쓰지 않음(금색 윗선만)
        found = []
        for sels, decls, kf in self.rules:
            shadow = decls.get("box-shadow")
            if not shadow or kf:
                continue
            value = resolve(shadow, self.vars)
            if value.strip() in ("none", "0", ""):
                continue
            for sel in sels:
                if sel in EXCEPT_RULES:
                    continue
                nodes, _ = select(self.roots, sel)
                if not nodes:
                    continue
                grey = grey_in(value)
                card = any("card" in c for n in nodes for c in n.classes) and "inset" not in value
                if grey or card:
                    found.append(f"{sel} {{ box-shadow: {shadow} }}" + (f" 회색 {grey}" if grey else " 카드 그림자"))
        self.assertEqual(found, [], "공개 화면의 회색 · 카드 그림자")

    def test_no_wide_tracking_on_hangul(self):
        # 한글에 넓힌 자간 금지(본문 0, 큰 제목만 -0.01~-0.02em, 명조 제목 -0.05em 까지. web_craft 1절 · W3C KLREQ)
        found = []
        for sels, decls, kf in self.rules:
            ls = decls.get("letter-spacing")
            if ls is None:
                continue
            em = spacing_em(resolve(ls, self.vars))
            if kf:
                if em > 0:
                    found.append(f"@keyframes 안 letter-spacing: {ls}(움직이는 동안 한글 자간이 넓어짐)")
                continue
            if em == 0:
                continue
            for sel in sels:
                nodes, pseudo = select(self.roots, sel)
                if pseudo:
                    continue
                hangul = [n for n in nodes if HANGUL.search(n.all_text())]
                if not hangul:
                    continue
                sample = " ".join(hangul[0].all_text().split())[:24]
                if em > 0:
                    found.append(f"{sel} {{ letter-spacing: {ls} }} 한글 '{sample}'")
                elif em < -0.05:
                    found.append(f"{sel} {{ letter-spacing: {ls} }} -0.05em 보다 좁음 '{sample}'")
        self.assertEqual(found, [], "한글 자간")

    def test_page_finish(self):
        # 화면마다 쪽 제목 · 설명 메타 · 파비콘 · 공유 그림(ai_tells 2-6, web_craft 7절)
        missing = []
        for rel, (text, tree) in self.pages.items():
            if rel == "404.html":
                continue
            heads = [n for n in tree.iter() if n.tag in ("title", "meta", "link")]
            title = next((" ".join(n.all_text().split()) for n in heads if n.tag == "title"), "")
            meta = {(n.attrs.get("name") or n.attrs.get("property")): n.attrs.get("content", "")
                    for n in heads if n.tag == "meta"}
            icon = any(n.tag == "link" and "icon" in n.attrs.get("rel", "").split() and n.attrs.get("href") for n in heads)
            if not title or title.lower() in ("document", "untitled", "index"):
                missing.append(f"{rel}: 쪽 제목")
            if not meta.get("description"):
                missing.append(f"{rel}: 설명 메타")
            if not icon:
                missing.append(f"{rel}: 파비콘")
            img = meta.get("og:image", "")
            if not img:
                missing.append(f"{rel}: 공유 그림(og:image)")
            elif img.startswith("/") and not (self.out / img.lstrip("/")).is_file():
                missing.append(f"{rel}: 공유 그림 파일이 없음 {img}")
            if not meta.get("og:title"):
                missing.append(f"{rel}: 공유 제목(og:title)")
        self.assertEqual(missing, [], "쪽 마무리 누락")

    def test_checker_catches_tells(self):
        # 검사 자체가 잡는지(가짜 화면 · 꾸밈으로): 대문자 머리말 · 회색 그림자 · 한글 넓힌 자간
        tree = parse_html('<div class="h"><p class="kick">SEOUL NATIONAL UNIVERSITY</p><h1>연구실</h1>'
                          '<a class="card x">바로가기</a></div>')
        rules = css_rules(".card { box-shadow: 0 8px 20px rgba(0, 0, 0, .2); } .h .kick { letter-spacing: .3em; }"
                          "@media (max-width: 640px) { .x { letter-spacing: .1em; } }")
        self.assertEqual(grey_in("0 8px 20px rgba(0, 0, 0, .2)"), "rgba(0, 0, 0")
        self.assertIsNone(grey_in("0 0 0 4px rgba(255, 255, 255, .14)"))
        self.assertIsNone(grey_in("0 18px 40px -22px rgba(8, 16, 32, .35)"))
        self.assertEqual(len(select([tree], ".h .kick")[0]), 1)
        self.assertEqual(len(select([tree], ".lab-root .kick")[0]), 0)
        self.assertEqual(len(rules), 3)
        self.assertAlmostEqual(spacing_em(".34em"), .34)
        self.assertGreater(spacing_em("2px"), 0)


if __name__ == "__main__":
    unittest.main()
