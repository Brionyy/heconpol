"""공개 단계 지킴이(2026-10-28): 관리 화면 도우미(GitHub App)가 만든 판은 허락한 파일만 고쳤는지 본다.

관리 화면이 고칠 수 있는 것은 칸 규칙(schema/tables.json)의 표 다섯 개와 사진 폴더(새 이름 더하기 · 지우기)뿐이다.
도우미가 뚫려 회원 칸 스크립트(assets/js 등)를 바꾸면 로그인 정보가 새 나갈 수 있으므로, 그런 판이 보이면 공개를 멈춘다.
돌리기(GitHub 공개 단계, .github/workflows/pages.yml):
    python3 <지난번 공개 판의 이 파일> --root . --rules-ref <지난번 공개 판> <지난번 공개 판> <새 판>
허락 목록(schema/tables.json)과 이 지킴이는 '지난번 공개된 판'에서 읽는다. 새 판이 허락 목록이나 지킴이를 함께 바꿔
스스로 통과하는 것을 막기 위해서다(검토 10-28 1번). 그 판에 허락 목록이 없으면(이 기능 전) 지금 판의 것을 쓴다.
도우미 이름은 환경 변수 ADMIN_BOT(처음 값 heconpol-admin[bot]).
남는 구멍: 도우미 판인지 판의 작성자 이름으로 가리므로, 열쇠를 훔친 쪽이 작성자를 사람 이름으로 적으면 건너뛴다.
그래서 진짜 연결 전에 저장소 보호 규칙(main 은 사람만 · 도우미는 따로 가지 + 지킴이를 통과해야 합치기)으로 바꾼다(README '아직 안 한 것').
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def allowed(rules, path):
    """관리 화면 도우미가 고쳐도 되는 파일인가."""
    tables = rules["tables"].values()
    if path in {t["file"] for t in tables}:
        return True
    photo = re.compile(rules["photo_pattern"])
    for t in tables:
        d = t.get("photo_dir")
        if d and path.startswith(d + "/") and "/" not in path[len(d) + 1:] and photo.search(path[len(d) + 1:]):
            return True
    return False


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def main(argv):
    global ROOT
    args = list(argv[1:])
    rules_ref = None
    while args and args[0].startswith("--"):
        flag = args.pop(0)
        if flag == "--root" and args:
            ROOT = Path(args.pop(0)).resolve()
        elif flag == "--rules-ref" and args:
            rules_ref = args.pop(0)
        else:
            args = []
    if len(args) != 2:
        print("쓰는 법: check_admin_commit.py [--root 폴더] [--rules-ref 판] <전 판> <새 판>", file=sys.stderr)
        return 2
    before, after = args
    bot = os.environ.get("ADMIN_BOT") or "heconpol-admin[bot]"
    text = None
    if rules_ref and not re.fullmatch(r"0+", rules_ref):
        try:
            text = git("show", f"{rules_ref}:schema/tables.json")
        except subprocess.CalledProcessError:
            text = None   # 그 판에는 허락 목록이 없다(이 기능 전): 도우미 판도 있을 수 없으므로 지금 판의 것을 쓴다
    rules = json.loads(text if text is not None else (ROOT / "schema" / "tables.json").read_text(encoding="utf-8"))
    rng = after if re.fullmatch(r"0+", before) else f"{before}..{after}"   # 저장소 첫 판이면 전 판이 0
    bad = []
    for line in git("log", "--format=%H%x09%an", rng).splitlines():
        sha, author = line.split("\t", 1)
        if author != bot:
            continue
        for path in git("show", "--name-only", "--format=", sha).splitlines():
            if path and not allowed(rules, path):
                bad.append(f"{sha[:8]} {path}")
    if bad:
        print("멈춤: 관리 화면 도우미가 만든 판이 허락 밖 파일을 고쳤습니다(공개하지 않음). 관리자 두 명에게 알리고 그 판을 되돌리십시오:", file=sys.stderr)
        for b in bad:
            print("  " + b, file=sys.stderr)
        return 1
    print("관리 화면 판 지킴이: 문제없음")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
