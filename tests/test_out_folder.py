"""화면 폴더 쓰기 시험(2026-10-27): 폴더째 지우지 않기, iCloud 겹친 사본 거르기, 한 번에 하나만 만들기.

화면 폴더를 폴더째 지우고 다시 만들면 iCloud 가 지난 판을 'index 2.html' · 'about 2' 로 되살린다(10-27 19개)."""
import contextlib
import io
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


def build_into(out, local=True):
    """out 에 만들고 (돌려준 값, 알림 글)을 돌려준다. 처음 값은 미리 보기용(--local)."""
    err = io.StringIO()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
        code = build.main((["--local"] if local else []) + ["--out", str(out)])
    return code, err.getvalue()


class CopyNameTest(unittest.TestCase):
    def test_copy_names(self):
        for name in ("index 2.html", "assets 3", ".nojekyll 2", "audit 2.json", "people 12.csv"):
            self.assertTrue(build.ICLOUD_COPY.match(name), name)
        for name in ("index.html", "07_people.png", "y2024", "site.css", "2_목록", "후_2026-10-27", "a 1.txt"):
            self.assertFalse(build.ICLOUD_COPY.match(name), name)

    def test_copies_not_published_and_named(self):
        # 꾸밈 · 그림 폴더에 사본이 생겨도 공개 화면에는 넣지 않고, 만들 때 이름을 알린다
        with tempfile.TemporaryDirectory() as d:
            top = Path(d)
            for rel in ("css/site.css", "css/site 2.css", "img 3/a.png", "img/a.png"):
                (top / rel).parent.mkdir(parents=True, exist_ok=True)
                (top / rel).write_bytes(b"x")
            self.assertEqual(set(build.read_files(top, "assets")), {"assets/css/site.css", "assets/img/a.png"})
            self.assertEqual([p.relative_to(top).as_posix() for p in build.icloud_copies(top)], ["css/site 2.css", "img 3"])


class OutFolderTest(unittest.TestCase):
    def test_rebuild_keeps_folder_and_unchanged_files(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "_site"
            self.assertEqual(build_into(out)[0], 0)
            ino = out.stat().st_ino
            same = {p: (p.stat().st_ino, p.stat().st_mtime_ns) for p in (out / "assets/css/site.css", out / "people/index.html")}
            (out / "old.html").write_text("지난번에만 있던 화면", encoding="utf-8")
            (out / "index 2.html").write_text("iCloud 사본", encoding="utf-8")
            (out / "about 2").mkdir()
            code, err = build_into(out)
            self.assertEqual(code, 0, err)
            self.assertEqual(out.stat().st_ino, ino)  # 폴더째 지우지 않음
            self.assertEqual({p: (p.stat().st_ino, p.stat().st_mtime_ns) for p in same}, same)  # 같은 파일은 다시 안 씀
            for x in ("old.html", "index 2.html", "about 2"):
                self.assertFalse((out / x).exists(), x)
            self.assertIn("겹친 사본 2개", err)

    def test_public_build_after_local_drops_fake_login(self):
        # 미리 보기용으로 만든 폴더에 공개용을 다시 만들면 가짜 로그인 파일이 남지 않는다
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "_site"
            build_into(out)
            self.assertTrue((out / "assets/js/lab/api-fake.js").exists())
            self.assertEqual(build_into(out, local=False)[0], 0)
            self.assertFalse((out / "assets/js/lab/api-fake.js").exists())
            self.assertIn('"backend": "none"', (out / "assets/js/lab/config.js").read_text(encoding="utf-8"))

    def test_preview_open_only_in_local_build(self):
        # 로그인 없이 게시판을 '시험회원'으로 보여 주는 것은 이 컴퓨터 미리 보기에서만(10-28). 공개용은 회원만.
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "_site"
            build_into(out)
            self.assertIn('"previewOpen": true', (out / "assets/js/lab/config.js").read_text(encoding="utf-8"))
            self.assertEqual(build_into(out, local=False)[0], 0)
            self.assertIn('"previewOpen": false', (out / "assets/js/lab/config.js").read_text(encoding="utf-8"))

    @unittest.skipIf(build.fcntl is None, "폴더 잠금이 없는 기기")
    def test_waits_while_another_builds(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "_site"
            out.mkdir()
            fd = os.open(out, os.O_RDONLY)
            build.fcntl.flock(fd, build.fcntl.LOCK_EX)  # 다른 대화가 만드는 중인 셈
            p = subprocess.Popen([sys.executable, str(ROOT / "build.py"), "--local", "--out", str(out)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            seen = []

            def first_wait_line():
                for line in p.stderr:
                    if "기다립니다" in line:
                        seen.append(line)
                        return

            t = threading.Thread(target=first_wait_line, daemon=True)
            t.start()
            t.join(30)
            try:
                self.assertTrue(seen, "다른 곳이 만드는 중인데 기다리지 않았습니다")
                self.assertIsNone(p.poll())
                self.assertFalse((out / "index.html").exists())
            finally:
                os.close(fd)  # 잠금이 풀리면 이어서 만든다
            p.wait(timeout=60)
            rest = p.stderr.read()
            p.stderr.close()
            self.assertEqual(p.returncode, 0, rest)
            self.assertTrue((out / "index.html").exists())


if __name__ == "__main__":
    unittest.main()
