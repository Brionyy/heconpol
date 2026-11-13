#!/usr/bin/env python3
"""보건정치경제연구실 홈페이지를 만든다.

data/ 의 표(CSV)와 content/ 의 글(마크다운)을 읽어 _site/ 에 화면(HTML)을 쓴다.
파이썬 표준 라이브러리만 쓴다. _site/ 는 폴더째 지우지 않고 바뀐 파일만 고치며, iCloud 동기화에서 빼고(이 Mac에만 둠),
한 번에 하나만 만든다(다른 대화가 만드는 중이면 기다림).

    python3 build.py            # 공개용
    python3 build.py --local    # 이 컴퓨터에서 미리 보기(가짜 로그인, https 올림 끔)
    python3 build.py --fetch-cv # 회원이 '내 정보'에서 적은 CV 주소를 서버에서 받아 구성원 화면에 붙임(GitHub 에서 쓰는 것)
    python3 build.py --out <폴더> # _site 대신 다른 폴더에(시험이 씀, 미리 보기 _site 는 그대로)
"""
import argparse
import base64
import contextlib
import csv
import hashlib
import html
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

try:
    import fcntl  # 한 번에 하나만 만들기(맥 · 리눅스)
except ImportError:
    fcntl = None

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
CONTENT = ROOT / "content"
OUT = ROOT / "_site"

# iCloud 가 같은 이름의 판 둘을 만나면 붙이는 이름: 'index 2.html', 'assets 3', '.nojekyll 2'
ICLOUD_COPY = re.compile(r".+ (?:[2-9]|\d{2,})(?:\.[^. ]+)?$")
# 이 표시가 달린 폴더는 iCloud Drive 가 올리지 않는다(macOS 14 이후, 2026-10-27 이 Mac mini 26.6.2 에서 확인)
ICLOUD_IGNORE = "com.apple.fileprovider.ignore#P"

# data/site.csv '색 배치' 칸에 쓸 수 있는 이름 → assets/css/palettes.css 의 data-palette 값.
# '기본'은 site.css 그대로(palettes.css 를 붙이지 않음).
PALETTES = {"기본": "", "신뢰": "trust", "고급": "luxe"}

# 관리 화면에서 고치는 공개 표 다섯 개(구성원 · 졸업생 · 소식 · 수행연구 · 교과목)의 칸 규칙(2026-10-28).
# 관리 화면 · 가짜 서버 · 서버 도우미가 같은 파일을 읽고(assets/js/lab/site-tables.js), 여기서도 같은 규칙으로 본다.
RULES_FILE = ROOT / "schema" / "tables.json"


class BuildError(Exception):
    pass


# ---------------------------------------------------------------- 표 읽기

def read_table(name, required=()):
    """data/<name>.csv 를 읽어 줄마다 dict 로 돌려준다. 빈 줄은 건너뛴다."""
    path = DATA / f"{name}.csv"
    if not path.exists():
        raise BuildError(f"표 파일이 없습니다: data/{name}.csv")
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        cols = [c.strip() for c in (reader.fieldnames or [])]
        missing = [c for c in required if c not in cols]
        if missing:
            raise BuildError(f"data/{name}.csv 첫 줄에 칸 이름이 없습니다: {', '.join(missing)}")
        rows = []
        for i, raw in enumerate(reader, start=2):
            row = {(k or "").strip(): (v or "").strip() for k, v in raw.items()}
            if not any(row.values()):
                continue
            for c in required:
                if not row.get(c):
                    raise BuildError(f"data/{name}.csv {i}번째 줄: '{c}' 칸이 비었습니다")
            row["_line"] = i
            rows.append(row)
    return rows


_CTRL = re.compile("[\u0000-\u001f\u007f\u2028\u2029]")
_EMAIL = re.compile(r'^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$')
_HTTPS = re.compile(r"^https://[^\s<>\"'`]+$")
_SITE_PATH = re.compile(r"^/(?!/)[A-Za-z0-9._~\-/#?=&%]*$")
_MD_FILE = re.compile(r"^[A-Za-z0-9_\-]+(/[A-Za-z0-9_.\-]+)*\.md$")
_DEFAULT_MAX = {"text": 200, "long": 3000, "email": 120, "https": 300, "link": 300, "file": 200, "choice": 40,
                "flag": 1, "date": 10, "year": 4, "number": 6, "photo": 85}


def load_rules():
    return json.loads(RULES_FILE.read_text(encoding="utf-8"))


def check_cell(rules, col, v):
    """칸 하나를 규칙대로 본다. 틀리면 사람이 읽을 까닭, 맞으면 None(site-tables.js checkCell 과 같음)."""
    v = "" if v is None else str(v)
    if _CTRL.search(v):
        return "줄 바꿈이나 보이지 않는 글자는 넣을 수 없습니다"
    if v != v.strip():
        return "앞뒤 빈칸을 지워 주십시오"
    if not v:
        return "꼭 적어야 합니다" if col.get("required") else None
    kind = col.get("kind", "text")
    limit = col.get("max") or _DEFAULT_MAX.get(kind, 200)
    if len(v) > limit:
        return f"{limit}자까지 적을 수 있습니다(지금 {len(v)}자)"
    if kind == "choice":
        return None if v in col["choices"] else " · ".join(col["choices"]) + " 가운데 하나를 고릅니다"
    if kind == "flag":
        return None if v == "예" else "'예' 또는 빈칸입니다"
    if kind == "date":
        ok = bool(re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", v))
        if ok:
            try:
                time.strptime(v, "%Y-%m-%d")
            except ValueError:
                ok = False
        return None if ok else "2026-10-28 모양으로 적습니다"
    if kind == "year":
        return None if re.fullmatch(r"(19|20)[0-9]{2}", v) else "네 자리 해(예: 2026)로 적습니다"
    if kind == "email":
        return None if _EMAIL.match(v) else "메일 주소 모양이 아닙니다"
    if kind == "https":
        return None if _HTTPS.match(v) else "https:// 로 시작하는 주소만 됩니다"
    if kind == "link":
        return None if _HTTPS.match(v) or _SITE_PATH.match(v) else "https:// 로 시작하는 주소(또는 /로 시작하는 사이트 안 주소)만 됩니다"
    if kind == "photo":
        return None if re.search(rules["photo_pattern"], v) else "사진 파일 이름은 영문 · 숫자 · _ · - 와 .jpg · .png · .webp 로 끝나야 합니다"
    if kind == "number":
        return None if re.fullmatch(r"[1-9][0-9]{0,5}", v) else "1 이상의 숫자입니다"
    if kind == "file":
        return None if _MD_FILE.match(v) else "글 파일 이름 모양이 아닙니다"
    return None


def check_table_rules(rules=None):
    """공개 표 다섯 개가 칸 규칙(schema/tables.json)을 지키는지 본다. 틀린 곳 [(파일, 줄, 칸, 까닭)].
    구성원 · 졸업생의 '번호'(회원 계정과 잇는 값)가 두 표를 통틀어 겹치지 않는지도 본다."""
    rules = rules or load_rules()
    out, seen = [], {}
    for name, t in rules["tables"].items():
        path = ROOT / t["file"]
        if not path.exists():
            out.append((t["file"], 0, "", "표 파일이 없습니다"))
            continue
        with path.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            header = [c.strip() for c in (reader.fieldnames or [])]
            missing = [c["name"] for c in t["columns"] if c["name"] not in header]
            if missing:
                out.append((t["file"], 1, "", "첫 줄에 칸이 없습니다: " + ", ".join(missing)))
                continue
            for i, raw in enumerate(reader, start=2):
                row = {(k or "").strip(): (v or "").strip() for k, v in raw.items() if k is not None}
                if not any(row.values()):
                    continue
                for col in t["columns"]:
                    msg = check_cell(rules, col, row.get(col["name"], ""))
                    if msg:
                        out.append((t["file"], i, col["name"], msg))
                    if col.get("kind") == "number" and row.get(col["name"]):
                        key = (t.get("number_group") or name, row[col["name"]])
                        if key in seen:
                            out.append((t["file"], i, col["name"], f"번호 {row[col['name']]}이(가) {seen[key]}와 겹칩니다"))
                        else:
                            seen[key] = f"{t['label']} {i}번째 줄"
    return out


def read_settings():
    return {r["항목"]: r.get("값", "") for r in read_table("site", ["항목"])}


def read_text(rel):
    path = CONTENT / rel
    if not path.exists():
        raise BuildError(f"글 파일이 없습니다: content/{rel}")
    return path.read_text(encoding="utf-8")


def is_no(value):
    return value.strip() in ("아니오", "아니요", "no", "No", "X", "x", "0")


def setting_int(cfg, key, default):
    value = (cfg.get(key) or "").strip()
    if not value:
        return default
    if not value.isdigit():
        raise BuildError(f"data/site.csv '{key}' 칸에는 숫자만 적습니다: {value}")
    return int(value)


# ---------------------------------------------------------------- 글자 다루기

def esc(s):
    return html.escape(s or "", quote=True)


def obfuscate_email(addr):
    """메일 주소를 글자 하나하나 &#..; 로 바꾼다. 화면에는 똑같이 보인다."""
    return "".join(f"&#{ord(c)};" for c in addr)


HANGUL = re.compile(r"[가-힣]")


def is_english(text):
    """한글 없이 영어로만 쓴 글인가(화면 읽기 프로그램이 영어로 읽고, 좁은 화면에서 긴 낱말을 나누게 표시한다)."""
    return bool(text) and not HANGUL.search(text) and bool(re.search(r"[A-Za-z]", text))


def text_lang(text):
    return f'<span lang="en">{esc(text)}</span>' if is_english(text) else esc(text)


def keywords(text):
    """관심 분야 칸을 키워드 목록으로(11-02 저녁: 본인 요청은 키워드 5개까지를 ' · '로 이어 넣는다).
    예전 글처럼 쉼표로 나눈 것도 같이 읽는다. 같은 키워드는 한 번만(common.js keywords 와 같음)."""
    out, seen = [], set()
    for w in re.split(r"[,，·・;\r\n]+", text or ""):
        w = re.sub(r"\s+", " ", w).strip()
        if w and w.lower() not in seen:
            seen.add(w.lower())
            out.append(w)
    return out


def keyword_list(text):
    """키워드마다 한 덩어리(줄이 바뀌어도 낱말 중간에서 끊기지 않게), 사이는 금색 점(CSS .kws)."""
    return '<ul class="kws">' + "".join(f"<li>{text_lang(w)}</li>" for w in keywords(text)) + "</ul>"


SAFE_URL = re.compile(r"^(https?://|mailto:|/(?!/)|#)", re.I)


def safe_url(u):
    u = (u or "").strip()
    if SAFE_URL.match(u):
        return u
    if re.match(r"^[A-Za-z0-9._~\-/]+$", u):  # 같은 사이트 안 상대 주소
        return u
    return "#"


def inline_md(text, link):
    """한 줄 안의 꾸밈: **굵게**, [글](주소). 먼저 글자를 모두 막고 시작한다."""
    t = esc(text)

    def _link(m):
        label, href = m.group(1), html.unescape(m.group(2))
        href = safe_url(href)
        if href.lower().startswith("mailto:"):
            o = obfuscate_email(href[7:])
            shown = obfuscate_email(html.unescape(label)) if "@" in label else label
            return f'<a href="&#109;&#97;&#105;&#108;&#116;&#111;&#58;{o}">{shown}</a>'
        ext = href.startswith(("http://", "https://"))
        attrs = ' rel="noopener noreferrer"' if ext else ""
        return f'<a href="{esc(link(href))}"{attrs}>{label}</a>'

    t = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", _link, t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    return t


def md_to_html(src, link=lambda u: u):
    """마크다운 일부만 바꾼다: ## 제목 {#이름표}, 문단, - 목록, 1. 목록, > 인용, | 표 |, ---.
    문단 안의 줄바꿈은 그대로 줄바꿈이 된다. HTML 을 직접 쓰면 글자로 보인다."""
    out, para, items, quote, table = [], [], [], [], []
    kind = None  # 'ul' | 'ol'

    def cells(line):
        return [c.strip() for c in line.strip().strip("|").split("|")]

    def flush():
        nonlocal kind
        if table:
            head, rest = cells(table[0]), [r for r in table[1:] if not re.fullmatch(r"[\s|:\-]+", r)]
            th = "".join(f'<th scope="col">{inline_md(c, link)}</th>' for c in head)
            trs = "".join("<tr>" + "".join(f"<td>{inline_md(c, link)}</td>" for c in cells(r)) + "</tr>" for r in rest)
            out.append(f'<table class="tbl"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>')
            table.clear()
        if para:
            out.append("<p>" + "<br>".join(inline_md(l, link) for l in para) + "</p>")
            para.clear()
        if items:
            out.append(f"<{kind}>" + "".join(f"<li>{inline_md(i, link)}</li>" for i in items) + f"</{kind}>")
            items.clear()
            kind = None
        if quote:
            out.append("<blockquote><p>" + "<br>".join(inline_md(l, link) for l in quote) + "</p></blockquote>")
            quote.clear()

    for raw in src.replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()
        s = line.strip()
        if not s:
            flush()
            continue
        if s.startswith("<!--") and s.endswith("-->"):
            continue  # 관리자용 메모
        if s.startswith("|"):
            if not table:
                flush()
            table.append(s)
            continue
        if table:
            flush()
        m = re.match(r"^(#{2,4})\s+(.*?)(?:\s+\{#([a-z0-9-]+)\})?$", s)
        if m:
            flush()
            n = len(m.group(1))
            anchor = f' id="{m.group(3)}"' if m.group(3) else ""
            out.append(f"<h{n}{anchor}>{inline_md(m.group(2), link)}</h{n}>")
            continue
        if s in ("---", "***"):
            flush()
            out.append("<hr>")
            continue
        m_ul = re.match(r"^[-*]\s+(.*)$", s)
        m_ol = re.match(r"^\d+[.)]\s+(.*)$", s)
        if m_ul or m_ol:
            want = "ul" if m_ul else "ol"
            if para or quote or (items and kind != want):
                flush()
            kind = want
            items.append((m_ul or m_ol).group(1))
            continue
        m = re.match(r"^>\s?(.*)$", s)
        if m:
            if para or items:
                flush()
            quote.append(m.group(1))
            continue
        if items or quote:
            flush()
        para.append(s)
    flush()
    return "\n".join(out)


def by_section(body):
    """글 화면을 절(h2)마다 묶는다. 넓은 화면에서 절 제목은 왼쪽 칸, 글은 오른쪽 칸에 놓인다."""
    parts = re.split(r"(?=<h2[ >])", body)
    out = [f'<div class="lead-block">{parts[0]}</div>'] if parts[0].strip() else []
    for part in parts[1:]:
        head, rest = part.split("</h2>", 1)
        out.append(f'<section class="sec">{head}</h2><div class="sec-body">{rest}</div></section>')
    return "".join(out)


def split_front(src):
    """글 파일 맨 위의 '항목: 값' 줄들(--- 로 감쌈)을 읽는다."""
    meta = {}
    if src.startswith("---\n"):
        end = src.find("\n---", 4)
        if end != -1:
            for line in src[4:end].splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip()
            src = src[end + 4:].lstrip("\n")
    return meta, src


# ---------------------------------------------------------------- 사이트

# 제목 띠 선 그림: 화면마다 내용에 맞는 정확한 도형(수는 표에서 읽음). 선은 들어올 때 한 번 그려지고(.ln),
# 점은 한 번 나타난다(.dot). d0~d11 은 시작을 조금씩 늦추는 칸, gold 는 금색 한 곳.

def _svg(kind, shapes):
    return f'<svg class="band-art band-art--{kind}" viewBox="0 0 600 600" focusable="false">{"".join(shapes)}</svg>'


def _ln(d, i=0, gold=False):
    return f'<path class="ln d{min(i, 11)}{" gold" if gold else ""}" d="{d}" pathLength="1"/>'


def _dot(x, y, r, i=0, gold=False):
    return f'<circle class="dot d{min(i, 11)}{" gold" if gold else ""}" cx="{x:.1f}" cy="{y:.1f}" r="{r}"/>'


def _oval(cx, cy, rx, ry):
    return f"M{cx - rx:.1f},{cy:.1f} a{rx:.1f},{ry:.1f} 0 1,0 {2 * rx:.1f},0 a{rx:.1f},{ry:.1f} 0 1,0 {-2 * rx:.1f},0"


def art_globe():
    """지구본 경선 · 위선(국제보건 · WHO 협력센터). 적도만 금색."""
    r, c = 270, 300
    shapes = [_ln(_oval(c, c, r, r))]
    shapes += [_ln(_oval(c, c, r * abs(math.cos(math.radians(k * 18))), r), k) for k in range(1, 5)]
    for i, lat in enumerate((-60, -40, -20, 20, 40, 60)):
        y, hw = c - r * math.sin(math.radians(lat)), r * math.cos(math.radians(lat))
        shapes.append(_ln(f"M{c - hw:.1f},{y:.1f} H{c + hw:.1f}", 2 + i))
    shapes.append(_ln(f"M{c - r},{c} H{c + r}", 9, gold=True))
    return _svg("globe", [f'<g transform="rotate(-18 {c} {c})">{"".join(shapes)}</g>'])


def art_bars(counts):
    """수행연구: 해마다 맡은 과제 수만큼 올라가는 세로선(왼쪽이 옛날). 가장 최근 해만 금색."""
    n, top = len(counts), max([c for _, c in counts] + [1])
    x0, x1, base, h = 70, 530, 500, 380
    step = (x1 - x0) / max(n - 1, 1)
    shapes = [_ln(f"M{x0 - 24},{base} H{x1 + 24}")]
    shapes += [_ln(f"M{x0 + i * step:.1f},{base} V{base - h * c / top:.1f}", 1 + i * 10 // max(n, 1), gold=i == n - 1)
               for i, (_, c) in enumerate(counts)]
    return _svg("bars", shapes)


def art_network():
    """구성원: 가운데 연구실(금색 점)에서 두 겹 고리로 이어지는 사람들. 점 수는 실제 인원과 상관없는 고정 무늬."""
    c, rings, lines, dots, inner = 300, (128, 236), [], [], []
    lines.append(_ln(_oval(c, c, rings[0], rings[0])))
    for gi, n in enumerate((7, 12)):
        r = rings[gi]
        pts = [(c + r * math.cos(math.radians(-90 + 360 * k / n + gi * 11)),
                c + r * math.sin(math.radians(-90 + 360 * k / n + gi * 11))) for k in range(n)]
        for k, (x, y) in enumerate(pts):
            px, py = (c, c) if gi == 0 else min(inner, key=lambda q: (q[0] - x) ** 2 + (q[1] - y) ** 2)
            lines.append(_ln(f"M{px:.1f},{py:.1f} L{x:.1f},{y:.1f}", 1 + gi * 4 + k * 4 // n))
            dots.append(_dot(x, y, 4, 3 + gi * 4 + k * 4 // n))
        inner = pts
    dots.append(_dot(c, c, 6, 0, gold=True))
    return _svg("network", lines + dots)


def art_paths():
    """졸업생: 연구실(금색 점)에서 여러 곳으로 뻗어 나가는 길. 길 수는 실제 인원과 상관없는 고정 무늬."""
    ox, oy, lines, dots = 120, 470, [], []
    for i, a in enumerate(range(-78, 1, 13)):
        r = 300 + (i % 3) * 70
        x, y = ox + r * math.cos(math.radians(a)), oy + r * math.sin(math.radians(a))
        lines.append(_ln(f"M{ox},{oy} Q{ox + r * .55:.1f},{oy - 40:.1f} {x:.1f},{y:.1f}", 1 + i))
        dots.append(_dot(x, y, 5, 3 + i))
    lines.append(_ln(f"M40,{oy} H580"))
    dots.append(_dot(ox, oy, 7, 0, gold=True))
    return _svg("paths", lines + dots)


def art_venn(n):
    """교과목: 과목 수만큼 겹치는 원(서로 이어진 과목). 하나만 금색."""
    c, r, off, n = 300, 150, 92, max(n, 1)
    return _svg("venn", [_ln(_oval(c + off * math.cos(math.radians(-90 + 360 * k / n)),
                                    c + off * math.sin(math.radians(-90 + 360 * k / n)), r, r), k * 2, gold=k == 0)
                         for k in range(n)])


def art_ripples():
    """소식: 한 점에서 퍼져 나가는 동심원. 가장 안쪽만 금색."""
    return _svg("ripples", [_ln(_oval(300, 300, r, r), i, gold=i == 0) for i, r in enumerate(range(36, 290, 36))])


ART_GLOBE = art_globe()


def course_icon(kind):
    """교과목 옆 작은 선 그림(제목 띠 선 그림과 같은 굵기 · 금색 한 곳). kind 는 data/courses.csv 의 '그림' 칸."""
    def ln(d, gold=False):
        return f'<path class="ln{" gold" if gold else ""}" d="{d}" pathLength="1"/>'
    if kind == "재정":        # 쌓인 동전과 오르는 선: 재원 조달 · 지출
        body = "".join(ln(f"M28,{y} a32,10 0 1,0 64,0 a32,10 0 1,0 -64,0") + ln(f"M28,{y} v12 M92,{y} v12")
                       for y in (96, 84, 72)) + ln("M28,108 a32,10 0 0,0 64,0") + ln("M104,96 L120,70 L134,78 L152,40", True)
    elif kind == "정치경제":   # 저울: 정치와 경제의 균형
        body = (ln("M80,30 V134 M56,134 H104") + ln("M34,52 H126", True) + ln("M34,52 L22,92 M34,52 L46,92")
                + ln("M126,52 L114,92 M126,52 L138,92") + ln("M18,92 a16,7 0 0,0 32,0 Z") + ln("M110,92 a16,7 0 0,0 32,0 Z"))
    elif kind == "장기요양":   # 모래시계(나이 듦)와 받쳐 주는 손바닥 선(돌봄)
        body = (ln("M52,24 H108 M52,112 H108") + ln("M58,24 C58,56 78,60 80,68 C82,60 102,56 102,24")
                + ln("M58,112 C58,80 78,76 80,68 C82,76 102,80 102,112") + ln("M66,112 C70,96 90,96 94,112", True)
                + ln("M80,72 V100") + ln("M30,128 C46,140 114,140 130,128"))
    elif kind == "비교":       # 나란한 두 지구본: 나라별 체계 비교
        body = "".join(ln(f"M{cx - 34},80 a34,34 0 1,0 68,0 a34,34 0 1,0 -68,0") + ln(f"M{cx - 14},80 a14,34 0 1,0 28,0 a14,34 0 1,0 -28,0")
                       + ln(f"M{cx - 34},80 H{cx + 34}") for cx in (46, 114)) + ln("M46,128 H114", True)
    else:
        body = ln("M30,80 a50,50 0 1,0 100,0 a50,50 0 1,0 -100,0")
    return f'<svg viewBox="0 0 160 160" focusable="false">{body}</svg>'


def course_desc(c):
    """교과목 이름 아래 과목 소개 글('설명' 칸). 처음부터 보인다(10-28 연구자: "과목소개는 기본적으로 나오게").
    영어로만 쓴 글은 화면 읽기 프로그램이 영어로 읽게 표시한다. 설명이 비면 아무것도 안 보인다."""
    text = c.get("설명", "").strip()
    if not text:
        return ""
    lang = ' lang="en"' if is_english(text) else ""
    return f'<p class="course-desc"{lang}>{esc(text)}</p>'


class Site:
    def __init__(self, local, palette=None):
        self.local = local
        self.cfg = read_settings()
        # 미리 보기(--local)는 이 컴퓨터 주소(localhost) 맨 위에서 열므로 기본 경로를 쓰지 않는다(11-13 임시 주소 /heconpol)
        self.base = "" if local else self.cfg.get("기본 경로", "").rstrip("/")
        name = (palette or self.cfg.get("색 배치", "") or "기본").strip()
        if name not in PALETTES:
            raise BuildError(f"data/site.csv '색 배치' 칸의 '{name}'을 모릅니다. 쓸 수 있는 이름: {', '.join(PALETTES)}")
        self.palette = PALETTES[name]
        self.menu = board_menu(read_table("menu", ["이름", "주소"]), read_boards())
        self.template = (ROOT / "templates" / "base.html").read_text(encoding="utf-8")
        backend = self.cfg.get("회원 칸 서버", "").strip()
        # 미리 보기(--local)는 서버 주소가 있어도 늘 시험용 가짜 로그인으로 만든다(진짜 회원 자료에 붙지 않게, 11-13 서버 연결)
        self.supabase = backend if backend.startswith("https://") and not local else ""
        if not local and not self.supabase:
            print("알림: '회원 칸 서버' 주소가 없어 회원 칸은 '준비 중'으로 보입니다.", file=sys.stderr)
        self.pages = []
        # 제목 띠 설명 한 줄(data/bands.csv: 주소, 설명). 표가 없으면 설명 없이 만든다.
        self.bands = ({r["주소"]: r.get("설명", "") for r in read_table("bands", ["주소"])}
                      if (ROOT / "data" / "bands.csv").exists() else {})

    # 주소 앞에 기본 경로를 붙인다(임시 주소에서 확인할 때 씀)
    def url(self, u):
        if u.startswith("/") and not u.startswith("//"):
            return self.base + u
        return u

    # 꾸밈 · 동작 파일은 내용이 바뀌면 주소 끝 표시도 바뀌어 브라우저가 옛 파일을 쓰지 않게 한다.
    def asset(self, u):
        path = ROOT / u.lstrip("/")
        if path.exists() and path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()[:10]
            return self.url(u) + "?v=" + digest
        return self.url(u)

    def csp(self, globe=False):
        sb = f" {self.supabase}" if self.supabase else ""
        # 첫 화면 지구본 부품(cobe 2.0.1)은 머리에 빈 꾸밈 글('' 과 ':root{}')을 넣는다. 그 두 글만 지문으로 허용한다
        style = "style-src 'self'" + ("".join(f" 'sha256-{h}'" for h in COBE_STYLE_SHA) if globe else "")
        parts = [
            "default-src 'none'",
            "script-src 'self'",
            style,
            "font-src 'self'",
            f"img-src 'self' data: blob:{sb}",
            f"connect-src 'self'{sb}",
            "media-src 'self'",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "manifest-src 'self'",
        ]
        if not self.local:
            parts.append("upgrade-insecure-requests")
        return "; ".join(parts)

    def nav(self, current):
        tops, children = [], {}
        for item in self.menu:
            parent = item.get("위", "")
            if parent:
                children.setdefault(parent, []).append(item)
            else:
                tops.append(item)
        html_items = []
        for n, item in enumerate(tops):
            kids = children.get(item["이름"], [])
            href = item["주소"]
            here = current == href or (href != "/" and current.startswith(href)) or any(
                current.startswith(k["주소"]) for k in kids)
            cls = ["nav-item"]
            if item["이름"] == "EN":
                cls.append("nav-en")
            aria = ' aria-current="page"' if here else ""
            if kids:
                sub = "".join(
                    f'<li><a href="{esc(self.url(k["주소"]))}"'
                    f'{" aria-current=\"page\"" if current.startswith(k["주소"]) else ""}>{esc(k["이름"])}</a></li>'
                    for k in kids)
                html_items.append(
                    f'<li class="{" ".join(cls)} has-sub">'
                    f'<a href="{esc(self.url(href))}"{aria}>{esc(item["이름"])}</a>'
                    f'<button type="button" class="sub-toggle" aria-expanded="false" aria-controls="sub-{n}">'
                    f'<span class="sr-only">{esc(item["이름"])} 아래 메뉴 열기</span><span aria-hidden="true">▾</span></button>'
                    f'<ul class="sub" id="sub-{n}">{sub}</ul></li>')
            else:
                html_items.append(
                    f'<li class="{" ".join(cls)}"><a href="{esc(self.url(href))}"{aria}>{esc(item["이름"])}</a></li>')
        return "".join(html_items)

    def page(self, path, title, body, *, kind="inner", lang="ko", lab=False, scripts=(), data=None, heading=None,
             sub=None, description=None, index=None, photo=None, photo_alt="", art=None, cv=None, modules=(),
             band_photo=None, band_search=None):
        """화면 하나를 기록해 둔다. path 는 '/about/' 같은 주소. index 는 제목 띠의 '이 화면 바로가기'(id, 이름, 수).
        cv 는 제목 띠 이름 아래 작은 'CV' 링크 주소(교수 화면). modules 는 다른 파일을 불러 쓰는 동작 파일(첫 화면 지구본).
        band_photo 는 제목 띠 바탕 사진('photos/파일', 그림 설명), band_search 는 띠 안 찾기 칸(주소, 안내 글). 세미나 게시판(11-13)."""
        self.pages.append(dict(path=path, title=title, body=body, kind=kind, lang=lang, lab=lab,
                               scripts=list(scripts), data=data, heading=heading, sub=sub,
                               description=description, index=index, photo=photo, photo_alt=photo_alt, art=art, cv=cv,
                               modules=list(modules), band_photo=band_photo, band_search=band_search))

    def render(self, p):
        name = self.cfg.get("이름", "")
        full_title = name if p["path"] == "/" else f'{p["title"]} | {name}'
        head_extra = []
        if p["lab"]:
            head_extra.append('<meta name="robots" content="noindex, nofollow">')
        desc = p["description"] or self.cfg.get("소개 한 줄", "")
        if desc and not p["lab"]:
            head_extra.append(f'<meta name="description" content="{esc(desc)}">')
        scripts = [self.asset("/assets/js/site.js")]
        for s in p["scripts"]:
            scripts.append(self.asset(s))
        script_tags = "\n".join([f'<script src="{esc(s)}" defer></script>' for s in scripts] +
                                [f'<script type="module" src="{esc(self.asset(m))}"></script>' for m in p["modules"]])
        data_block = ""
        if p["data"] is not None:
            payload = json.dumps(p["data"], ensure_ascii=False).replace("</", "<\\/")
            data_block = f'<script type="application/json" id="page-data">{payload}</script>'
        if p["kind"] == "home":
            band = ""
        else:
            sub = f'<p class="band-sub">{esc(p["sub"])}</p>' if p["sub"] else ""
            note = self.bands.get(p["path"], "")
            note = f'<p class="band-desc">{esc(note)}</p>' if note else ""
            side, photo = "", ""
            if p["photo"]:
                photo = (f'<figure class="band-photo"><img src="{esc(self.url("/assets/img/" + p["photo"]))}" '
                         f'alt="{esc(p["photo_alt"])}" width="170" height="212"></figure>')
            if p["index"]:
                items = "".join(
                    f'<li><a href="#{esc(a)}"><span>{esc(t)}</span>{f"<span class=\"band-n\">{esc(n)}</span>" if n else ""}</a></li>'
                    for a, t, n in p["index"])
                side = f'<nav class="band-index" aria-label="이 화면 바로가기"><ul>{items}</ul></nav>'
            # 교수 CV: 이름 아래 작은 클립 + CV, 새 창으로 연다(구성원 카드 CV 와 같은 모양)
            cv = ""
            if p["cv"]:
                cv = (f'<p class="band-cv"><a href="{esc(self.url(p["cv"]))}" target="_blank" rel="noopener noreferrer" '
                      f'aria-label="{esc(p["heading"] or p["title"])} CV 열기(새 창)">{CLIP}<span>CV</span></a></p>')
            art = p["art"] or ART_GLOBE
            title = f'<h1>{esc(p["heading"] or p["title"])}</h1>{sub}{note}{cv}'
            text = (f'<div class="band-text band-prof">{photo}<div>{title}</div></div>' if photo
                    else f'<div class="band-text">{title}</div>')
            band = (f'<div class="band{" band--profile" if photo else ""}"><div class="band-bg" aria-hidden="true">{art}</div>'
                    f'<div class="wrap">{text}{side}</div></div>')
            if p["band_photo"]:
                # 2026-11-13 세미나 게시판 시안 '가'(연구자 선택): 사진 위 남색 덮개 · 금색 짧은 선 · 명조 제목 · 찾기 칸.
                # 꾸밈 규칙(CSP)이 글 속 style 을 막아 사진은 <img> 로 깐다
                src = p["band_photo"][0]   # 꾸밈 사진이라 그림 설명은 비워 둔다(읽어 주는 프로그램이 건너뜀)
                look = ""
                if p["band_search"]:
                    act, hint = p["band_search"]
                    look = (f'<form class="band-search" role="search" method="get" action="{esc(self.url(act))}">'
                            f'<label class="sr-only" for="band-q">이 게시판에서 찾기</label>{SEARCH_ICO}'
                            f'<input id="band-q" name="q" type="search" placeholder="{esc(hint)}" autocomplete="off" maxlength="40">'
                            f'<button type="submit">찾기</button></form>')
                band = (f'<div class="band band--photo"><div class="band-bg" aria-hidden="true">'
                        f'<img src="{esc(self.url("/assets/img/" + src))}" alt="" width="966" height="644" decoding="async"></div>'
                        f'<div class="wrap"><div class="band-text">{title}{look}</div></div></div>')
        values = {
            "lang": p["lang"],
            "csp": self.csp(globe="/assets/js/globe.js" in p["modules"]),
            "title": esc(full_title),
            "head_extra": "\n".join(head_extra),
            "css": esc(self.asset("/assets/css/site.css")),
            "nojs_css": esc(self.asset("/assets/css/nojs.css")),
            "palette_attr": f' data-palette="{self.palette}"' if self.palette else "",
            "palette_css": (f'\n<link rel="stylesheet" href="{esc(self.asset("/assets/css/palettes.css"))}">'
                            if self.palette else ""),
            "fonts": esc(self.asset("/assets/fonts/fonts.css")),
            "favicon": esc(self.url("/assets/img/favicon.svg")),
            "home": esc(self.url("/")),
            "brand_name": esc(name),
            "brand_en": esc(self.cfg.get("영문 이름", "")),
            "nav": self.nav(p["path"]),
            "header_class": "hdr hdr--over" if p["kind"] == "home" else "hdr hdr--solid",
            "band": band,
            "main_class": "main-home" if p["kind"] == "home" else "main-inner",
            "body": p["body"],
            "aff_ko": esc(self.url("/assets/img/logos/gsph_ko.png")),
            "aff_snu": esc(self.url("/assets/img/logos/snu_signature_ko.png")),
            "foot_name": esc(f'{name} · {self.cfg.get("영문 이름", "")}'),
            "foot_addr": esc(self.cfg.get("주소", "")),
            "foot_mail": self._foot_mail(),
            "privacy": esc(self.url("/privacy/")),
            "year": esc(self.cfg.get("저작권 연도", "")),
            "data_block": data_block,
            "scripts": script_tags,
            "body_class": "is-lab" if p["lab"] else ("is-home" if p["kind"] == "home" else "is-inner"),
        }

        def fill(m):
            key = m.group(1)
            if key not in values:
                raise BuildError(f"templates/base.html 의 {{{{ {key} }}}} 자리에 넣을 값이 없습니다")
            return values[key]

        return re.sub(r"\{\{\s*([a-z_]+)\s*\}\}", fill, self.template)

    def _foot_mail(self):
        m = self.cfg.get("대표 메일", "")
        if not m:
            return ""
        o = obfuscate_email(m)
        return f'<a href="&#109;&#97;&#105;&#108;&#116;&#111;&#58;{o}">{o}</a>'

    def write_all(self, out=None):
        """화면을 out(처음 값 _site)에 쓴다. 폴더째 지우지 않고 바뀐 파일만 고친다(아래 '화면 폴더 쓰기')."""
        out = Path(out) if out else OUT
        files = read_files(ROOT / "assets", "assets")
        for p in self.pages:
            rel = p["path"].strip("/") + "/index.html" if p["path"] != "/" else "index.html"
            if p["path"].endswith(".html"):
                rel = p["path"].lstrip("/")
            files[rel] = self.render(p).encode("utf-8")
        lab_cfg = {
            "backend": "fake" if self.local and not self.supabase else ("supabase" if self.supabase else "none"),
            "supabaseUrl": self.supabase,
            "publishableKey": self.cfg.get("공개 열쇠", ""),
            "base": self.base,
            # 이 컴퓨터 미리 보기(가짜 로그인)에서만 로그인 없이 게시판을 '시험회원'으로 보여 준다(10-28 연구자:
            # "일단은 회원이 아니더라도 볼 수 있게"). 공개용 · 진짜 서버 연결에서는 늘 False라 회원만 본다.
            "previewOpen": self.local and not self.supabase,
        }
        cfg_js = "window.LAB_CONFIG = Object.freeze(" + json.dumps(lab_cfg, ensure_ascii=False) + ");\n"
        files["assets/js/lab/config.js"] = cfg_js.encode("utf-8")
        if lab_cfg["backend"] != "fake":
            files.pop("assets/js/lab/api-fake.js", None)
        files["robots.txt"] = b"User-agent: *\nDisallow: /lab/\nDisallow: /login/\nDisallow: /board/\n"
        files[".nojekyll"] = b""
        out.mkdir(parents=True, exist_ok=True)
        with one_builder(out):
            keep_out_of_icloud(out)
            sync_folder(out, files)


# ---------------------------------------------------------------- 화면 폴더 쓰기
# 화면 폴더는 폴더째 지우고 다시 만들지 않는다. iCloud 안에서 그렇게 하면 아직 올리던 지난 판을 iCloud 가 되살려
# 'index 2.html' · 'about 2' 같은 사본을 남긴다(2026-10-27: 두 대화가 시험과 만들기로 24초 사이 네 번 다시 만듦, 19개).

def read_files(top, under):
    """top 아래 파일을 {'under/상대 경로': 내용}으로 읽는다. iCloud 겹친 사본은 공개 화면에 넣지 않는다."""
    files = {}
    for src in sorted(top.rglob("*")):
        rel = src.relative_to(top)
        if src.is_file() and not any(ICLOUD_COPY.match(x) for x in rel.parts):
            files[f"{under}/{rel.as_posix()}"] = src.read_bytes()
    return files


def icloud_copies(top, skip=()):
    """top 아래에서 iCloud 겹친 사본처럼 보이는 이름을 찾는다(skip 폴더 · .git · node_modules 는 안 봄)."""
    found = []
    for d, dirs, names in os.walk(top):
        found += [Path(d, x) for x in dirs + names if ICLOUD_COPY.match(x)]
        dirs[:] = [x for x in dirs if not ICLOUD_COPY.match(x) and x not in (".git", "node_modules")
                   and Path(d, x) not in skip]
    return sorted(found)


def keep_out_of_icloud(out):
    """iCloud Drive 안의 화면 폴더에 '동기화 제외' 표시를 단다. 만든 결과라 Mac마다 만들면 된다(이 Mac에만 둠)."""
    if sys.platform != "darwin" or "/Library/Mobile Documents/" not in str(out):
        return
    if subprocess.run(["xattr", "-p", ICLOUD_IGNORE, str(out)], capture_output=True).returncode == 0:
        return
    r = subprocess.run(["xattr", "-w", ICLOUD_IGNORE, "1", str(out)], capture_output=True, text=True)
    if r.returncode:
        print(f"주의: 화면 폴더를 iCloud 동기화에서 빼지 못했습니다({r.stderr.strip()}). 겹친 사본이 다시 생길 수 있습니다.",
              file=sys.stderr)
    else:
        print(f"알림: 화면 폴더를 iCloud 동기화에서 뺐습니다(이 Mac에만 둡니다): {out}", file=sys.stderr)


@contextlib.contextmanager
def one_builder(out, wait=120):
    """한 번에 하나만 out 을 쓴다. 다른 대화가 만드는 중이면 끝날 때까지 기다린다(폴더 잠금, 닫으면 풀림)."""
    fd = os.open(out, os.O_RDONLY)
    try:
        start, told = time.monotonic(), False
        while fcntl:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() - start > wait:
                    raise BuildError(f"다른 곳에서 화면을 만드는 중이라 {wait}초를 기다렸지만 끝나지 않았습니다. 잠시 뒤 다시 하십시오")
                if not told:
                    print("알림: 다른 곳에서 화면을 만드는 중이라 끝나기를 기다립니다.", file=sys.stderr)
                    told = True
                time.sleep(0.2)
        yield
    finally:
        os.close(fd)


def sync_folder(out, files):
    """out 을 files({'상대/경로': 내용})와 똑같이 맞춘다. 내용이 같은 파일은 그대로 두고, 바뀐 파일만 그 자리에
    덮어쓰고, 더는 만들지 않는 파일과 빈 폴더만 지운다(미리 보기도 만드는 도중에 빈 폴더를 내주지 않는다)."""
    for rel, data in files.items():
        dst = out / rel
        if dst.is_dir():
            shutil.rmtree(dst)
        elif dst.is_file() and dst.read_bytes() == data:
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
    for d, dirs, names in os.walk(out, topdown=False):
        for x in names:
            if Path(d, x).relative_to(out).as_posix() not in files:
                Path(d, x).unlink()
        for x in dirs:
            if not any(Path(d, x).iterdir()):
                Path(d, x).rmdir()


# ---------------------------------------------------------------- 화면들

def build_pages(site):
    url = site.url
    md = lambda src: md_to_html(src, url)

    # 관리 화면이 고치는 표 다섯 개는 칸 규칙을 먼저 본다(관리 화면 저장과 같은 규칙이라 둘이 어긋나지 않음)
    problems = check_table_rules()
    if problems:
        f, line, col, msg = problems[0]
        more = f" (그 밖에 {len(problems) - 1}곳)" if len(problems) > 1 else ""
        raise BuildError(f"{f} {line}번째 줄" + (f" '{col}' 칸" if col else "") + f": {msg}{more}")

    # 공통으로 쓰는 표
    news = read_table("news", ["날짜", "제목"])
    news.sort(key=lambda r: r["날짜"], reverse=True)
    areas = read_table("areas", ["이름"])

    # ---- 첫 화면
    slides = read_table("slides", ["사진", "제목"])
    # 이용 조건상 만든 사람을 밝혀야 하는 사진(CC 사진)은 그 사진 위에 작게 출처를 붙인다(2026-11-13 연구자: 바닥글 '사진 출처' 없앰)
    credit_of = {c["사진"]: c for c in read_table("photo_credits", ["사진", "만든 사람", "이용 조건", "주소"])
                 if c.get("이용 조건", "").upper().startswith("CC")}
    quick = read_table("quicklinks", ["제목", "주소"])
    pos = {"위": "pos-top", "가운데": "pos-center", "아래": "pos-bottom"}
    slide_html = []
    # '사진' 칸에 그림 이름(@지구본)을 쓰면 사진 대신 3D 지구본 장면(WHO 협력센터, 연구자 10-27: 선 · 이름표 없이 지구본만)
    for s in slides:
        if s["사진"].startswith("@") and s["사진"] != "@지구본":
            raise BuildError(f"data/slides.csv '사진' 칸의 '{s['사진']}'을 모릅니다. 사진 파일 이름이나 @지구본 을 씁니다.")
    has_globe = any(s["사진"] == "@지구본" for s in slides)
    for i, s in enumerate(slides):
        btn = ""
        if s.get("단추 주소"):
            btn = (f'<a class="btn-line" href="{esc(url(s["단추 주소"]))}">{esc(s.get("단추 이름") or "자세히")}'
                   f'<span aria-hidden="true" class="arw-r"></span></a>')
        small = f'<p class="hero-s">{esc(s["작은 줄"])}</p>' if s.get("작은 줄") else ""
        line = f'<p class="hero-p">{esc(s["한 줄"])}</p>' if s.get("한 줄") else ""
        heading = "h1" if i == 0 else "h2"
        globe = s["사진"] == "@지구본"
        slide_html.append(
            f'<div class="slide{" slide--globe" if globe else ""}{" is-on" if i == 0 else ""}" role="group" aria-roledescription="slide" '
            f'aria-label="{i + 1} / {len(slides)}"{"" if i == 0 else " aria-hidden=\"true\" inert"}>'
            + (f'<div class="slide-globe" role="img" aria-label="{esc(s.get("사진 설명", ""))}"><div class="disk"></div>'
               f'<canvas class="gl"></canvas><canvas class="fx"></canvas></div>'
               if globe else
               f'<img class="slide-img {pos.get(s.get("사진 위치", ""), "pos-center")}" '
               f'src="{esc(url("/assets/img/photos/" + s["사진"]))}" alt="{esc(s.get("사진 설명", ""))}"'
               f'{" fetchpriority=\"high\"" if i == 0 else " loading=\"lazy\""}>') +
            f'<div class="hero-center"><div class="rule"></div>'
            f'<p class="kick">{esc(s.get("위 작은 줄", ""))}</p>'
            f'<{heading} class="hero-h">{esc(s["제목"])}</{heading}>{line}{small}{btn}</div>'
            + (f'<p class="slide-credit">사진 <a href="{esc(safe_url(credit_of[s["사진"]]["주소"]))}" rel="noopener noreferrer">'
               f'{esc(credit_of[s["사진"]]["만든 사람"])}</a> · {esc(credit_of[s["사진"]]["이용 조건"])}</p>'
               if s["사진"] in credit_of else "") + '</div>')
    controls = ""
    if len(slides) > 1:
        controls = (
            '<button type="button" class="arw arw-l" data-slide="-1"><span class="sr-only">이전 사진</span></button>'
            '<button type="button" class="arw arw-r2" data-slide="1"><span class="sr-only">다음 사진</span></button>'
            f'<div class="count" aria-hidden="true"><span class="count-now">01</span><i><b class="count-bar"></b></i>'
            f'<span>{len(slides):02d}</span></div>')
    hero = f'<section class="hero" aria-label="연구실 사진" data-count="{len(slides)}">{"".join(slide_html)}{controls}</section>'

    quick_html = "".join(
        f'<a class="quick-card" href="{esc(url(q["주소"]))}"'
        f'{" rel=\"noopener noreferrer\"" if q["주소"].startswith("http") else ""}>'
        f'<b>{esc(q["제목"])}</b>'
        f'<span class="quick-p">{esc(q.get("설명", ""))}<span aria-hidden="true" class="arw-r"></span></span></a>'
        for q in quick)
    area_html = "".join(
        f'<div class="area"><h3>{esc(a["이름"])}</h3>'
        f'<small>{esc(a.get("영문", ""))}</small><p>{esc(a.get("한 줄", ""))}</p></div>'
        for a in areas)
    home_news = [n for n in news if not is_no(n.get("첫 화면에", ""))][:3]
    news_html = "".join(news_row(site, n) for n in home_news) or '<p class="empty">아직 소식이 없습니다.</p>'
    redirects = {r["옛 번호"]: r["새 주소"] for r in read_table("redirects", ["옛 번호", "새 주소"])}
    body = (f'{hero}<section class="quick" aria-label="바로가기">{quick_html}</section>'
            f'<section class="areas" aria-labelledby="h-areas"><h2 class="sr-only" id="h-areas">연구 분야</h2>{area_html}</section>'
            f'<section class="news-home"><h2>소식</h2><div class="news-list">{news_html}'
            f'<a class="more" href="{esc(url("/news/"))}">소식 모두 보기</a></div></section>')
    site.page("/", "첫 화면", body, kind="home", data={"redirects": redirects, "base": site.base},
              modules=["/assets/js/globe.js"] if has_globe else [])

    # ---- 글 한 편짜리 화면(소개 · 교수 · English · 개인정보 처리방침)
    timelines = {}
    if (ROOT / "data" / "timelines.csv").exists():
        for t in read_table("timelines", ["주소", "연도", "내용"]):
            timelines.setdefault(t["주소"], []).append(t)
    for r in read_table("pages", ["주소", "제목", "글 파일"]):
        meta, src = split_front(read_text(r["글 파일"]))
        lang = r.get("언어") or "ko"
        body = f'<div class="wrap prose">{by_section(md(src))}</div>'
        if r["주소"] in timelines:
            # '구분' 칸(경력 · 학력)마다 따로 묶는다. 다른 연구실 교수 소개처럼 나눔(연구자, 10-27). 칸이 비면 '이력' 하나
            parts = {}
            for t in timelines[r["주소"]]:
                parts.setdefault(t.get("구분") or "이력", []).append(t)
            lists = "".join(
                f'<section class="tl-part"><h2>{esc(name)}</h2><ol>' + "".join(
                    f'<li{" class=\"now\"" if t.get("지금") in ("예", "O", "o") else ""}>'
                    f'<span class="tl-yr">{esc(t["연도"])}</span><span class="tl-t">{text_lang(t["내용"])}</span></li>'
                    for t in rows) + '</ol></section>'
                for name, rows in parts.items())
            body = (f'<div class="wrap prose prose--aside"><div class="prose-main">{by_section(md(src))}</div>'
                    f'<aside class="timeline" aria-label="{esc(r.get("큰 제목") or r["제목"])} 이력">{lists}</aside></div>')
        # 'CV 주소' 칸(교수 화면): 비우면 CV 링크 없이 만든다
        cv = safe_url(r.get("CV 주소", ""))
        cv = cv if r.get("CV 주소") and cv != "#" and not cv.lower().startswith("mailto:") else None
        site.page(r["주소"], r["제목"], body, lang=lang,
                  heading=r.get("큰 제목") or r["제목"], sub=r.get("작은 제목") or None,
                  photo=r.get("사진") or None, photo_alt=r.get("사진 설명", ""), cv=cv)

    # ---- 연구 분야(2회차: 분야 이름은 왼쪽 칸, 소개와 글 목록은 오른쪽 칸)
    posts = read_table("research_posts", ["분야", "날짜", "제목"])
    posts.sort(key=lambda r: r["날짜"], reverse=True)
    blocks = []
    for a in areas:
        mine = [p for p in posts if p["분야"] == a["이름"]]
        rows = "".join(post_row(site, p, "research") for p in mine) or '<p class="empty">아직 글이 없습니다.</p>'
        intro = md(read_text(a["글 파일"])) if a.get("글 파일") else f'<p>{esc(a.get("한 줄", ""))}</p>'
        blocks.append(group(a["이름"], a.get("영문", ""), f'<div class="grp-b">{intro}<div class="news-list">{rows}</div></div>',
                            ident=a.get("영문 주소") or "", note_lang="en"))
    area_index = [(a.get("영문 주소"), a["이름"], f'{sum(1 for p in posts if p["분야"] == a["이름"])}편')
                  for a in areas if a.get("영문 주소")]
    site.page("/research/", "연구 분야", f'<div class="wrap list">{"".join(blocks)}</div>',
              sub="건강보장 · 장기요양 · 국제개발", index=area_index)
    for p in posts:
        if p.get("글 파일"):
            article_page(site, p, "research", "연구 분야", "/research/")

    # ---- 수행연구(2회차: 연도는 왼쪽 칸. 최근 몇 해만 펼치고 그 전 해는 연도 줄만 보이며 누르면 펼쳐진다)
    projects = read_table("projects", ["연도", "과제"])
    by_year = {}
    for pr in projects:
        by_year.setdefault(pr["연도"], []).append(pr)
    open_years = setting_int(site.cfg, "수행연구 펼칠 햇수", 5)
    groups = [f'<p class="muted list-note">{esc(site.cfg.get("수행연구 안내", ""))}</p>']
    for i, year in enumerate(sorted(by_year, reverse=True)):
        items = f'<ul class="rows proj">{"".join(project_li(pr) for pr in by_year[year])}</ul>'
        count = f"{len(by_year[year])}건"
        if i < open_years:
            groups.append(group(year, count, items, ident=f"y{year}", label_cls="num"))
        else:
            groups.append(f'<section class="grp grp-fold" id="y{esc(year)}"><details><summary>'
                          f'<h2 class="num">{esc(year)}</h2><span class="cnt">{count}</span>'
                          f'<span class="chev" aria-hidden="true"></span></summary>{items}</details></section>')
    year_index = [(f"y{y}", y, f"{len(by_year[y])}건") for y in sorted(by_year, reverse=True)]
    site.page("/research/projects/", "수행연구", f'<div class="wrap list">{"".join(groups)}</div>',
              index=year_index, art=art_bars([(y, len(by_year[y])) for y in sorted(by_year)]))

    # ---- 교과목
    courses = read_table("courses", ["과목 이름"])
    cards = "".join(
        f'<article class="course" id="c{i}"><div class="course-art" aria-hidden="true">{course_icon(c.get("그림", ""))}</div>'
        f'<div class="course-text"><h2>{esc(c["과목 이름"])}</h2>'
        f'{f"<p class=\"muted\">{esc(c["학기"])}</p>" if c.get("학기") else ""}'
        f'{course_desc(c)}</div></article>'
        for i, c in enumerate(courses, 1))
    site.page("/courses/", "교과목", f'<div class="wrap courses">{cards}</div>',
              art=art_venn(len(courses)))

    # ---- 구성원(2회차 연구자 선택: 카드 모양은 그대로, 넓은 화면에서 한 줄에 두 사람)
    people = read_table("people", ["과정", "이름"])
    site.member_cv = load_member_cv()
    nos = {pe.get("번호", "") for pe in people}
    for no in sorted({k for k, v in site.member_cv.items() if v} - nos, key=int):
        print(f"알림: 번호 {no} 카드에 이어진 회원이 적은 CV 주소는 구성원 표에 그 번호가 없어 붙이지 않았습니다(졸업생으로 옮겼을 수 있음).",
              file=sys.stderr)
    groups = {}
    for pe in people:
        groups.setdefault(pe["과정"], []).append(pe)
    sections = []
    for g, members in groups.items():
        cards = "".join(person_card(site, pe) for pe in members)
        # 재학생 수는 쓰지 않는다(연구자, 10-27)
        sections.append(f'<section class="people-group" id="{esc(anchor_name(g))}"><h2>{esc(g)}</h2>'
                        f'<div class="people">{cards}</div></section>')
    site.page("/people/", "구성원", f'<div class="wrap">{"".join(sections)}</div>',
              index=[(anchor_name(g), g, "") for g in groups], art=art_network())

    # ---- 졸업생(2회차 덧붙임, 연구자 선택 B안 '학문 가계도'. 졸업생 수는 쓰지 않는다)
    site.page("/alumni/", "졸업생", lineage(site, read_table("alumni", ["학위", "졸업 연도", "이름"])), art=art_paths())

    # ---- 소식(2회차: 해마다 묶고 날짜는 '월.일'만)
    by_year = {}
    for n in news:
        by_year.setdefault(n["날짜"][:4], []).append(n)
    groups = [group(y, f"{len(ns)}건", f'<div class="news-list short">{"".join(news_row(site, n, short=True) for n in ns)}</div>',
                    ident=f"y{y}", label_cls="num") for y, ns in by_year.items()]
    site.page("/news/", "소식", f'<div class="wrap list">{"".join(groups) or "<p class=\"empty\">아직 소식이 없습니다.</p>"}</div>',
              index=[(f"y{y}", y, f"{len(ns)}건") for y, ns in by_year.items()], art=art_ripples())
    for n in news:
        if n.get("글 파일"):
            article_page(site, n, "news", "소식", "/news/")

    # ---- 없는 주소
    site.page("/404.html", "찾는 화면이 없습니다",
              f'<div class="wrap prose"><p>주소가 바뀌었거나 없는 화면입니다.</p>'
              f'<p><a href="{esc(url("/"))}">첫 화면으로 가기</a></p></div>')

    build_lab_pages(site)


def group(label, note, body, *, ident="", label_cls="", note_lang=""):
    """목록 화면의 묶음 하나(2회차). 넓은 화면에서 묶음 이름(분야 · 연도 · 학위)은 왼쪽 칸에서 그 묶음 끝까지 따라
    내려오고, 줄은 오른쪽 칸에 놓인다(글 화면의 절 제목 왼쪽 칸과 같은 폭)."""
    i = f' id="{esc(ident)}"' if ident else ""
    c = f' class="{label_cls}"' if label_cls else ""
    nl = f' lang="{note_lang}"' if note_lang else ""
    sub = f'<p class="cnt"{nl}>{esc(note)}</p>' if note else ""
    return f'<section class="grp"{i}><div class="grp-h"><h2{c}>{esc(label)}</h2>{sub}</div>{body}</section>'


def anchor_name(text):
    """묶음 이름을 화면 안 바로가기 이름표(id)로: 빈칸만 '-'로 바꾼다(예: 박사과정)."""
    return re.sub(r"\s+", "-", text.strip())


def project_li(pr):
    """수행연구 한 줄. '진행 중'은 제목 마지막 낱말 바로 뒤에 붙어 긴 제목이 꺾여도 떨어지지 않는다."""
    tag = ' <span class="tag">진행 중</span>' if pr.get("진행 중") in ("예", "O", "o") else ""
    org = f' <span class="muted">{esc(pr["맡긴 곳"])}</span>' if pr.get("맡긴 곳") else ""
    return f'<li><span class="t">{text_lang(pr["과제"])}{tag}{org}</span></li>'


def lineage(site, alumni):
    """졸업생 '학문 가계도': 맨 위 교수님(금색 네모)에서 가는 줄기가 내려오고, 졸업 연도마다 마디, 그 해 졸업생은
    가지 끝(넓은 화면 두 칸). 처음 졸업생부터 아래로. 선 · 마디 · 움직임은 site.css 가 그린다."""
    prof = next((p for p in read_table("pages", ["주소", "제목", "글 파일"]) if p["주소"] == "/professor/"), {})
    by_year = {}
    for r in alumni:
        by_year.setdefault(r["졸업 연도"], []).append(r)
    root = (f'<li class="t-root"><p class="nm"><a href="{esc(site.url("/professor/"))}">'
            f'{esc(prof.get("큰 제목") or prof.get("제목", ""))}</a></p><p class="af">{esc(site.cfg.get("이름", ""))}</p></li>')
    # 같은 해 졸업생은 가나다순(한글 이름 먼저, 영문 이름은 뒤). 표에 적은 순서와 상관없다(연구자, 10-27)
    name_key = lambda r: (not HANGUL.match(r["이름"]), r["이름"])
    years = "".join(f'<li class="t-year" id="y{esc(y)}"><h2 class="num">{esc(y)}</h2>'
                    f'<ul class="leaves">{"".join(alum_leaf(site, r) for r in sorted(by_year[y], key=name_key))}</ul></li>'
                    for y in sorted(by_year))
    return f'<div class="wrap lineage"><ol class="tree">{root}{years}</ol></div>'


def alum_leaf(site, r):
    """가지 끝 한 사람: 이름(명조) · 지금 소속. '학위논문' · '사진' 칸은 적힌 사람만 보이고, 박사가 아니면 학위를 붙인다."""
    photo = (f'<img class="ph" src="{esc(site.url("/assets/img/alumni/" + r["사진"]))}" alt="" loading="lazy" '
             f'width="144" height="180">' if r.get("사진") else "")
    deg = f' <span class="deg">{esc(r["학위"])}</span>' if r.get("학위") not in ("", "박사", None) else ""
    af = f'<p class="af">{text_lang(r["지금 소속"])}</p>' if r.get("지금 소속") else ""
    thesis = (f'<p class="th"><span class="lbl">학위논문</span> {text_lang(r["학위논문"])}</p>'
              if r.get("학위논문") else "")
    cls = ' class="has-ph"' if photo else ""
    return f'<li{cls}>{photo}<div><h3 class="nm">{text_lang(r["이름"])}{deg}</h3>{af}{thesis}</div></li>'


def news_row(site, n, short=False):
    """소식 한 줄. short 이면 날짜를 '월.일'만 쓴다(해마다 묶은 소식 화면)."""
    href = f'/news/{Path(n["글 파일"]).stem}/' if n.get("글 파일") else (n.get("주소") or "")
    tag = f'<span class="tag">{esc(n["갈래"])}</span>' if n.get("갈래") else ""
    shown = ".".join(n["날짜"].split("-")[1:]) if short else n["날짜"].replace("-", ".")
    inner = (f'<time datetime="{esc(n["날짜"])}">{esc(shown)}</time>'
             f'<span class="t">{tag}{text_lang(n["제목"])}</span>')
    if href:
        ext = href.startswith("http")
        return (f'<a class="row" href="{esc(site.url(href))}"{" rel=\"noopener noreferrer\"" if ext else ""}>'
                f'{inner}<span aria-hidden="true" class="arw-r"></span></a>')
    return f'<div class="row">{inner}<span></span></div>'


def post_row(site, p, section):
    who = f'<span class="muted"> · {esc(p["글쓴이"])}</span>' if p.get("글쓴이") else ""
    inner = (f'<time datetime="{esc(p["날짜"])}">{esc(p["날짜"].replace("-", "."))}</time>'
             f'<span class="t">{text_lang(p["제목"])}{who}</span>')
    if p.get("글 파일"):
        href = site.url(f'/{section}/{Path(p["글 파일"]).stem}/')
        return f'<a class="row" href="{esc(href)}">{inner}<span aria-hidden="true" class="arw-r"></span></a>'
    return f'<div class="row">{inner}<span></span></div>'


def article_page(site, row, section, section_name, back):
    meta, src = split_front(read_text(row["글 파일"]))
    stem = Path(row["글 파일"]).stem
    who = f' · {esc(row["글쓴이"])}' if row.get("글쓴이") else ""
    source = (f'<p class="muted src">{esc(meta["출처"])}</p>' if meta.get("출처") else "")
    body = (f'<div class="wrap prose article"><p class="meta"><time datetime="{esc(row["날짜"])}">'
            f'{esc(row["날짜"].replace("-", "."))}</time>{who}</p>{md_to_html(src, site.url)}{source}'
            f'<p class="back"><a href="{esc(site.url(back))}">{esc(section_name)} 목록으로</a></p></div>')
    site.page(f"/{section}/{stem}/", row["제목"], body, heading=row["제목"], sub=section_name)


# 지구본 부품이 넣는 빈 꾸밈 글의 지문(내용이 정확히 같을 때만 허용됨)
COBE_STYLE_SHA = [base64.b64encode(hashlib.sha256(t.encode()).digest()).decode() for t in ("", ":root{}")]


# CV 링크 표시: 클립 모양 선 그림(이모지는 기기마다 모양 · 색이 달라 쓰지 않음, 2회차)
CLIP = ('<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">'
        '<path d="M10 7v9a2 2 0 0 0 4 0V5a3.5 3.5 0 0 0-7 0v12a5 5 0 0 0 10 0V7" fill="none" stroke="currentColor" '
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>')


# CV 주소는 https 주소만(서버 profiles.cv_url 칸과 같은 규칙)
CV_URL = re.compile(r"^https://[^\s<>\"'`]+$")
MEMBER_CV = DATA / "_member_cv.json"  # 회원이 '내 정보'에서 적은 CV 주소(사이트를 만들 때 서버에서 받아 둠, 저장소에 안 올림)


def cv_ok(url):
    return bool(url) and len(url) <= 300 and bool(CV_URL.match(url))


def load_member_cv():
    """회원이 '내 정보'에서 적은 CV 주소 {구성원 카드 번호: 주소}. 받아 둔 파일이 없으면 빈 것(표의 'CV 주소'만 쓴다).
    10-28부터 이름 대신 '번호'로 잇는다(관리 화면에서 회원과 카드를 이어 둔 사람만). 이름은 회원이 바꿀 수 있어 남의 카드에 붙을 수 있었다.
    11-02부터 본인이 'CV 공개'를 끈 카드는 빈 글자(""): 그 카드는 표의 'CV 주소'도 숨긴다."""
    if not MEMBER_CV.exists():
        return {}
    try:
        rows = json.loads(MEMBER_CV.read_text(encoding="utf-8"))
    except ValueError:
        print(f"알림: {MEMBER_CV.name} 을 읽지 못해 회원이 적은 CV 주소 없이 만듭니다.", file=sys.stderr)
        return {}
    out = {}
    for r in rows:
        if not isinstance(r, dict) or not re.fullmatch(r"[1-9][0-9]{0,5}", str(r.get("person_no") or "")):
            continue
        if r.get("cv_public") is False:
            out[str(r["person_no"])] = ""
        elif cv_ok(r.get("cv_url") or ""):
            out[str(r["person_no"])] = r["cv_url"]
    return out


def fetch_member_cv(site):
    """회원 칸 서버에서 '구성원 카드 번호 · CV 주소'만 받아 data/_member_cv.json 에 둔다(GitHub 에서 사이트를 만들 때).
    공개 열쇠로 public_member_cv() 만 부른다. 서버가 없거나 안 되면 알리고 넘어간다(만들기는 계속)."""
    key = site.cfg.get("공개 열쇠", "").strip()
    if not site.supabase or not key:
        print("알림: '회원 칸 서버' · '공개 열쇠'가 없어 회원이 적은 CV 주소를 받지 않았습니다.", file=sys.stderr)
        return
    req = urllib.request.Request(site.supabase.rstrip("/") + "/rest/v1/rpc/public_member_cv", data=b"{}", method="POST",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.loads(r.read().decode("utf-8"))
    except (OSError, ValueError) as e:
        print(f"알림: 회원이 적은 CV 주소를 받지 못했습니다({e}). 지난번 받은 것으로 만듭니다.", file=sys.stderr)
        return
    rows = [{"person_no": r.get("person_no"), "cv_url": r.get("cv_url"), "cv_public": r.get("cv_public") is not False}
            for r in rows if isinstance(r, dict)]
    MEMBER_CV.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"회원이 적은 CV 주소 {len(rows)}개를 받았습니다.")


def person_card(site, pe):
    """구성원 카드: 이름(+ 역할 표) 아래 '관심 분야 · 메일'을 같은 이름표 줄로(연구자, 10-27).
    CV는 메일 줄 끝에 흐린 작은 글자로 붙인다(10-28 연구자: "이메일 옆에 눈에 띄지 않게 … 모두가 CV를 넣는 거는 아니거든").
    CV가 없는 사람과 카드 높이가 같아진다. 메일을 안 보이는 사람만 'CV' 줄을 따로 둔다."""
    if pe.get("사진"):
        pic = (f'<img class="ph" src="{esc(site.url("/assets/img/people/" + pe["사진"]))}" alt="" loading="lazy" '
               f'width="160" height="200">')
    else:
        pic = f'<span class="ph ph-none" aria-hidden="true">{esc(pe["이름"][:1])}</span>'
    en = f' <span class="en" lang="en">{esc(pe["영문 이름"])}</span>' if pe.get("영문 이름") else ""
    # '역할' 칸(예: 조교)을 적으면 이름 옆에 글자 표, 카드 위에 금색 선(연구자, 10-27)
    role = f' <span class="role">{esc(pe["역할"])}</span>' if pe.get("역할") else ""
    rows = []
    if keywords(pe.get("관심 분야")):
        rows.append(("관심 분야", keyword_list(pe["관심 분야"])))
    # CV: 본인이 '내 정보'에서 적은 주소가 먼저, 없으면 표의 'CV 주소'. 본인이 'CV 공개'를 껐으면(빈 글자) 표 주소도 숨김.
    # 주소 글자 대신 'CV' 두 글자, 새 창
    member_cv = getattr(site, "member_cv", {})
    no = pe.get("번호", "")
    cv = member_cv[no] if no in member_cv else pe.get("CV 주소", "")
    cv_link = (f'<a class="cv" href="{esc(cv)}" target="_blank" rel="noopener noreferrer" '
               f'aria-label="{esc(pe["이름"])} CV 보기(새 창)">CV</a>') if cv_ok(cv) else ""
    if pe.get("메일") and not is_no(pe.get("메일 공개", "")):
        o = obfuscate_email(pe["메일"])
        mail = f'<a class="mail" href="&#109;&#97;&#105;&#108;&#116;&#111;&#58;{o}">{o}</a>'
        # 점과 CV는 한 덩어리(줄이 넘어가도 점만 남지 않게). 휴대폰에서는 메일 아래 줄에 'CV'만
        rows.append(("메일", mail + (f'<span class="cv-wrap"><span class="cv-sep" aria-hidden="true">·</span>{cv_link}</span>'
                                     if cv_link else "")))
    elif cv_link:
        rows.append(("CV", cv_link))
    info = ('<dl class="pf">' + "".join(f"<div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in rows) + "</dl>") if rows else ""
    cls = "person has-role" if role else "person"
    return f'<article class="{cls}">{pic}<div><h3>{esc(pe["이름"])}{en}{role}</h3>{info}</div></article>'


# ---------------------------------------------------------------- 회원 칸 화면(틀만)

LAB_SCRIPTS_BASE = ["/assets/js/lab/config.js", "/assets/js/lab/api-fake.js", "/assets/vendor/supabase.js",
                    "/assets/js/lab/api-supabase.js", "/assets/js/lab/common.js"]
LAB_SCRIPTS_TEXT = ["/assets/vendor/marked.umd.js", "/assets/vendor/purify.min.js", "/assets/js/lab/render.js"]
LAB_SCRIPTS_UPLOAD = ["/assets/js/lab/upload.js"]
LAB_SCRIPTS_EDIT = ["/assets/js/lab/editor.js"]
# 관리 화면(2026-10-28 2판): 표 고치기 부품 · 사진 줄이기 · 다섯 탭
LAB_SCRIPTS_ADMIN = ["/assets/js/lab/site-tables.js", "/assets/js/lab/upload.js", "/assets/js/lab/admin.js"]


SEARCH_ICO = ('<svg class="band-search-ico" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">'
              '<circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/>'
              '<path d="m12.6 12.6 4.4 4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>')
# 제목 띠를 사진으로 까는 게시판(주소 이름: 사진, 그림 설명). 사진 출처는 data/photo_credits.csv
BOARD_BAND_PHOTO = {"seminar": ("photos/classroom.jpg", "보건대학원 강의실 사진")}


def lab_shell(name, extra=""):
    """회원 칸 화면은 빈 틀이다. 내용은 로그인 뒤 스크립트가 채운다."""
    return (f'<div class="wrap lab" data-lab-page="{name}">'
            f'<noscript><p class="notice">회원 칸은 자바스크립트를 켜야 쓸 수 있습니다.</p></noscript>'
            f'<div class="lab-status" role="status" aria-live="polite">불러오는 중…</div>'
            f'<div class="lab-root"></div>{extra}</div>')


def read_boards(rows=None):
    """data/boards.csv: 게시판 하나가 한 줄. 서버 규칙(supabase/migrations)의 boards 표와 같아야 한다.

    게시판마다 /board/<주소 이름>/ 화면이 생기고, 머리 메뉴에서 '묶음' 이름 아래(▾)에 들어간다(board_menu).
    '대상' 칸은 2026-11-13 연구자 결정으로 없앴다(모든 회원이 모든 게시판을 읽고 씀).
    """
    if rows is None:
        rows = read_table("boards", ["주소 이름", "이름"])
    boards, seen = [], set()
    for b in rows:
        where = f"data/boards.csv {b['_line']}번째 줄"
        slug, name, group = b["주소 이름"], b["이름"], b.get("묶음", "")
        if not re.fullmatch(r"[a-z0-9-]{2,30}", slug):
            raise BuildError(f"{where}: '주소 이름'은 영문 소문자 · 숫자 · '-'로 2~30자입니다: {slug}")
        if slug in seen:
            raise BuildError(f"{where}: 위 줄과 같은 '주소 이름'입니다: {slug}")
        seen.add(slug)
        if len(name) > 30 or len(group) > 30:
            raise BuildError(f"{where}: '이름' · '묶음'은 30자까지입니다")
        boards.append({"slug": slug, "name": name, "desc": b.get("설명", ""),
                       "files": b.get("첨부") in ("예", "O", "o"), "gallery": b.get("사진첩") in ("예", "O", "o"),
                       "group": group})
    return boards


def board_url(b):
    return f"/board/{b['slug']}/"


def board_menu(menu, boards):
    """data/menu.csv 에서 주소가 '@게시판'인 줄 자리에 게시판 메뉴를 넣는다(data/boards.csv 줄 순서).

    '묶음'이 같은 게시판은 그 이름 아래(▾)에 모인다. 묶음 이름이 이미 메뉴에 있으면(예: 연구실) 그 아래로 들어가고,
    '묶음'이 빈 게시판은 구성원 · 졸업생처럼 메뉴에 따로 한 칸이 된다.
    """
    tops = {m["이름"] for m in menu if not m.get("위")}
    out, placed = [], False
    for item in menu:
        if item["주소"] != "@게시판":
            out.append(item)
            continue
        placed, made = True, set()
        for b in boards:
            group = b["group"]
            if group and group not in tops and group not in made:
                made.add(group)
                out.append({"이름": group, "주소": board_url(b), "위": ""})
            out.append({"이름": b["name"], "주소": board_url(b), "위": group})
    if boards and not placed:
        print("알림: data/menu.csv 에 주소가 '@게시판'인 줄이 없어 게시판이 머리 메뉴에 안 보입니다.", file=sys.stderr)
    return out


def site_tables_data(rules):
    """미리 보기 가짜 서버가 이 브라우저 안에서 고치는 공개 표 다섯 개(만들 때 data/*.csv 그대로)."""
    return {"rules": rules, "texts": {name: (ROOT / t["file"]).read_text(encoding="utf-8") for name, t in rules["tables"].items()}}


def member_cards(rules):
    """카드 번호 → 어느 표 · 사진 주소 · 관심 분야(내 정보 화면에서 '지금 공개된 내 카드'를 보일 때). 공개 화면에 이미 나온 값만."""
    out = {}
    for name in ("people", "alumni"):
        t = rules["tables"][name]
        for r in read_table(name):
            if not re.fullmatch(r"[1-9][0-9]{0,5}", r.get("번호", "")):
                continue
            out[r["번호"]] = {"table": name, "label": t["label"],
                              "photo": f'/{t["photo_dir"]}/{r["사진"]}' if r.get("사진") else "",
                              "interest": r.get("관심 분야", "") if name == "people" else None}
    return out


def build_lab_pages(site):
    board_data = read_boards()
    common = dict(lab=True, data={"boards": board_data})
    fake = site.local and not site.supabase
    skip = {"/assets/js/lab/api-fake.js"} if not fake else {"/assets/vendor/supabase.js", "/assets/js/lab/api-supabase.js"}
    js = lambda *groups: [s for g in groups for s in g if s not in skip] + ["/assets/js/lab/app.js"]
    site.page("/login/", "로그인", lab_shell("login"), scripts=js(LAB_SCRIPTS_BASE), **common)
    # 가입: 옛 아이디가 있는지 먼저 묻는다(10-28). 재학생 과정 고르기는 칸 규칙의 구성원 '과정'과 같은 낱말
    rules = load_rules()
    courses = next(c["choices"] for c in rules["tables"]["people"]["columns"] if c["name"] == "과정")
    site.page("/login/join/", "회원가입", lab_shell("join"), scripts=js(LAB_SCRIPTS_BASE), lab=True,
              data={"boards": board_data, "person_courses": courses})
    # 비밀번호 찾기 · 재설정(11-02 시안 1): 옛 회원 처음 한 번 · 잊었을 때 모두 여기. 예전 주소 /login/join/?step=old 는 여기로 넘김
    site.page("/login/find/", "비밀번호 찾기 · 재설정", lab_shell("find"), scripts=js(LAB_SCRIPTS_BASE), **common)
    site.page("/login/reset/", "비밀번호 새로 정하기", lab_shell("reset"), scripts=js(LAB_SCRIPTS_BASE), **common)
    site.page("/lab/", "회원 칸", lab_shell("home"), scripts=js(LAB_SCRIPTS_BASE), **common)
    # 게시판마다 따로 화면(구성원 · 졸업생처럼 머리 메뉴에서 열림). 글 목록 · 보기 · 쓰기 · 고치기를 한 화면이 맡는다.
    for b in board_data:
        bp = BOARD_BAND_PHOTO.get(b["slug"])
        site.page(board_url(b), b["name"], lab_shell("photos" if b["gallery"] else "board"),
                  scripts=js(LAB_SCRIPTS_BASE, LAB_SCRIPTS_TEXT, LAB_SCRIPTS_UPLOAD, LAB_SCRIPTS_EDIT),
                  lab=True, data={"boards": board_data, "board": b["slug"]}, sub=b["desc"] or None,
                  band_photo=bp, band_search=(board_url(b), "제목 · 글쓴이로 찾기") if bp else None)
    # 옛 주소(2026-10-27 전 /lab/board/?b=… · /lab/photos/)는 새 게시판 화면으로 넘긴다.
    site.page("/lab/board/", "게시판", lab_shell("forward"), scripts=js(LAB_SCRIPTS_BASE), **common)
    site.page("/lab/photos/", "행사 · 나들이 기록", lab_shell("forward"), scripts=js(LAB_SCRIPTS_BASE), **common)
    # 내 정보(11-02): 내 구성원 카드의 지금 사진 · 관심 분야를 보이려고 카드 번호별 공개 값만 싣는다(공개 화면에 이미 보이는 것).
    # 미리 보기에서는 관리 화면처럼 표를 실어, 가짜 서버가 이 브라우저 안에서 승인한 결과를 보이게 한다
    me_data = {"boards": board_data, "cards": member_cards(rules)}
    if fake:
        me_data["site_tables"] = site_tables_data(rules)
    site.page("/lab/me/", "내 정보", lab_shell("me"), scripts=js(LAB_SCRIPTS_BASE, ["/assets/js/lab/site-tables.js"], LAB_SCRIPTS_UPLOAD),
              lab=True, data=me_data)
    # 관리 화면. 미리 보기(가짜 로그인)에서만 공개 표 다섯 개를 화면에 실어 가짜 서버가 이 브라우저 안에서 고치게 한다.
    # 진짜 서버에서는 서버 도우미(site-content)가 GitHub 의 표를 읽고 고친다(이 화면에 표를 싣지 않음).
    admin_data = {"boards": board_data}
    if fake:
        admin_data["site_tables"] = site_tables_data(rules)
    site.page("/lab/admin/", "관리", lab_shell("admin"), scripts=js(LAB_SCRIPTS_BASE, LAB_SCRIPTS_TEXT, LAB_SCRIPTS_ADMIN),
              lab=True, data=admin_data)


# ---------------------------------------------------------------- 시작

def main(argv=None):
    ap = argparse.ArgumentParser(description="연구실 홈페이지 만들기")
    ap.add_argument("--local", action="store_true", help="이 컴퓨터에서 미리 보기용(가짜 로그인)")
    ap.add_argument("--palette", help="이번만 다른 색 배치로 만들기(" + " · ".join(PALETTES) + "), 표는 그대로")
    ap.add_argument("--fetch-cv", action="store_true", help="회원이 '내 정보'에서 적은 CV 주소를 서버에서 받아 붙이기")
    ap.add_argument("--out", help="화면을 쓸 폴더(처음 값 _site). 시험은 임시 폴더에 만든다")
    ap.add_argument("--check", action="store_true", help="표 · 글 검사만 하고 화면은 쓰지 않기(공개 단계 · 관리 화면 저장 뒤 확인용)")
    args = ap.parse_args(argv)
    out = Path(args.out).resolve() if args.out else OUT
    try:
        site = Site(local=args.local, palette=args.palette)
        if args.fetch_cv:
            fetch_member_cv(site)
        build_pages(site)
        if args.check:
            print(f"표 · 글 검사 통과: 화면 {len(site.pages)}개를 만들 수 있습니다(쓰지는 않음).")
            return 0
        stale = icloud_copies(out)
        site.write_all(out)
    except BuildError as e:
        print(f"만들기 실패: {e}", file=sys.stderr)
        return 1
    if stale:
        print(f"알림: 화면 폴더에 있던 iCloud 겹친 사본 {len(stale)}개를 지웠습니다(만든 결과라 다시 만들어짐).", file=sys.stderr)
    copies = icloud_copies(ROOT, skip={OUT, out})
    if copies:
        print(f"주의: iCloud 겹친 사본으로 보이는 것 {len(copies)}개는 쓰지 않았고 공개 화면에도 넣지 않았습니다. "
              "원본과 비교해 필요한 고침을 원본에 옮긴 뒤 사본은 휴지통으로 옮기십시오:", file=sys.stderr)
        for p in copies:
            print(f"  {p.relative_to(ROOT)}", file=sys.stderr)
    # 끝 줄만 보는 경우가 많아 사본이 있으면 끝 줄에도 적는다
    note = f" (주의: iCloud 겹친 사본 {len(copies)}개, 위 목록)" if copies else ""
    print(f"화면 {len(site.pages)}개를 만들었습니다: {out}{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
