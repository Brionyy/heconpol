// 올릴 파일 거르기와 사진 다시 저장(2_보안검토.md 3.2).
// 사진: JPEG · PNG · WebP 를 받아 긴 변 1600px JPEG 로 다시 저장한다. 이때 위치 정보(EXIF) 같은 숨은 내용이 빠진다.
// 자료: PDF · HWP · HWPX · DOCX · XLSX · PPTX 만 받는다. 확장자와 파일 첫 바이트가 맞아야 한다.
(function () {
  'use strict';
  if (window.LAB_BLOCKED) return;

  var PHOTO_MAX_IN = 30 * 1024 * 1024;   // 원본 30MB 까지 받음
  var PHOTO_MAX_OUT = 3 * 1024 * 1024;   // 저장 칸 한도 3MB
  var FILE_MAX = 20 * 1024 * 1024;       // 자료 한 개 20MB
  var LONG_SIDE = 1600;

  var PHOTO_TYPES = {
    jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp'
  };
  var FILE_TYPES = {
    pdf: { mime: 'application/pdf', magic: 'pdf' },
    hwp: { mime: 'application/x-hwp', magic: 'ole' },
    hwpx: { mime: 'application/x-hwpx', magic: 'zip' },
    docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'zip' },
    xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'zip' },
    pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: 'zip' }
  };

  function ext(name) {
    var m = /\.([A-Za-z0-9]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  async function head(file, n) {
    var buf = await file.slice(0, n).arrayBuffer();
    return new Uint8Array(buf);
  }
  function starts(b, arr, at) {
    at = at || 0;
    for (var i = 0; i < arr.length; i++) if (b[at + i] !== arr[i]) return false;
    return true;
  }
  function magicOf(b) {
    if (starts(b, [0xFF, 0xD8, 0xFF])) return 'jpeg';
    if (starts(b, [0x89, 0x50, 0x4E, 0x47])) return 'png';
    if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
    if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2D])) return 'pdf';
    if (starts(b, [0x50, 0x4B, 0x03, 0x04])) return 'zip';
    if (starts(b, [0xD0, 0xCF, 0x11, 0xE0])) return 'ole';
    return '';
  }

  // 화면에 보일 원래 이름: 위험한 글자(글자 방향을 뒤집는 숨은 글자 포함, 서버 규칙과 같음)를 빼고 100자까지
  function safeName(name) {
    var s = String(name || '파일').replace(/[\/\\:*?"<>|\u0000-\u001F\u007F؜‎‏‪-‮⁦-⁩]/g, '').trim();
    if (!s) s = '파일';
    return s.length > 100 ? s.slice(0, 100) : s;
  }

  async function checkPhoto(file) {
    var e = ext(file.name);
    if (!PHOTO_TYPES[e]) return { ok: false, error: '사진은 JPG · PNG · WebP 만 올릴 수 있습니다: ' + safeName(file.name) };
    if (file.size > PHOTO_MAX_IN) return { ok: false, error: '사진이 30MB 보다 큽니다: ' + safeName(file.name) };
    var m = magicOf(await head(file, 16));
    if (m !== PHOTO_TYPES[e]) return { ok: false, error: '사진 파일이 아니거나 확장자가 내용과 다릅니다: ' + safeName(file.name) };
    return { ok: true };
  }

  async function checkFile(file) {
    var e = ext(file.name);
    var t = FILE_TYPES[e];
    if (!t) return { ok: false, error: '자료는 PDF · 한글(HWP · HWPX) · DOCX · XLSX · PPTX 만 올릴 수 있습니다: ' + safeName(file.name) };
    if (file.size > FILE_MAX) return { ok: false, error: '파일 하나는 20MB 까지입니다: ' + safeName(file.name) };
    if (file.size === 0) return { ok: false, error: '빈 파일입니다: ' + safeName(file.name) };
    var m = magicOf(await head(file, 16));
    if (m !== t.magic) return { ok: false, error: '파일 내용이 확장자와 다릅니다: ' + safeName(file.name) };
    return { ok: true, mime: t.mime, ext: e, name: safeName(file.name), size: file.size };
  }

  function canvasToBlob(canvas, q) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob')); }, 'image/jpeg', q);
    });
  }

  // 사진을 다시 그려 JPEG 로 저장한다. 원본의 숨은 내용은 옮겨지지 않는다.
  async function reencodePhoto(file) {
    var bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    var scale = Math.min(1, LONG_SIDE / Math.max(bmp.width, bmp.height));
    var w = Math.max(1, Math.round(bmp.width * scale));
    var hgt = Math.max(1, Math.round(bmp.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';            // 투명한 PNG 는 흰 바탕으로
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(bmp, 0, 0, w, hgt);
    if (bmp.close) bmp.close();
    var q = 0.85, blob = await canvasToBlob(canvas, q);
    while (blob.size > PHOTO_MAX_OUT && q > 0.5) {
      q -= 0.1;
      blob = await canvasToBlob(canvas, q);
    }
    if (blob.size > PHOTO_MAX_OUT) throw window.Lab.userError('사진을 3MB 안으로 줄이지 못했습니다.');
    return { blob: blob, width: w, height: hgt, mime: 'image/jpeg', ext: 'jpg' };
  }

  // 구성원 카드 사진: 세로 4:5(480 × 600)로 가운데를 잘라 JPEG 로 다시 그린다(위치 정보 같은 숨은 내용이 빠짐).
  // 관리 화면 카드 고치기와 내 정보 사진 요청(11-02)이 같이 쓴다
  var OUT_W = 480, OUT_H = 600;
  // 틀을 따로 고르지 않았을 때의 자리: 가로 가운데, 세로 위쪽 3분의 1
  function autoRegion(w, hgt) {
    var r = Math.max(OUT_W / w, OUT_H / hgt), sw = OUT_W / r, sh = OUT_H / r;
    return { sx: (w - sw) / 2, sy: Math.max(0, (hgt - sh) / 3), sw: sw, sh: sh };
  }
  async function decodePhoto(file) {
    var ok = await checkPhoto(file);
    if (!ok.ok) throw window.Lab.userError(ok.error);
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  function drawRegion(bmp, rg) {
    var canvas = document.createElement('canvas');
    canvas.width = OUT_W; canvas.height = OUT_H;
    var g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, OUT_W, OUT_H);
    g.drawImage(bmp, rg.sx, rg.sy, rg.sw, rg.sh, 0, 0, OUT_W, OUT_H);
    return canvasToBlob(canvas, 0.85);
  }
  async function portrait(file) {
    var bmp = await decodePhoto(file);
    try { return await drawRegion(bmp, autoRegion(bmp.width, bmp.height)); }
    finally { if (bmp.close) bmp.close(); }
  }

  // 남길 자리 고르기(2026-11-23 연구자 선택 C '펼친 사진 위 틀 옮기기'): 고른 사진 전체를 펼치고 그 위 4:5 금색 틀을
  // 끌어 옮기거나 네 모서리로 크기를 바꾼다. 키보드는 화살표로 옮기기, + · − 로 크기. 바뀌면 opts.onChange() (0.12초 묶음).
  // 돌려주는 것: { el, blob(): 지금 틀 자리의 480 × 600 JPEG, destroy() }
  async function portraitPicker(file, opts) {
    opts = opts || {};
    var bmp = await decodePhoto(file);
    var W = bmp.width, H = bmp.height, R = autoRegion(W, H), first = autoRegion(W, H);
    var maxW = Math.min(W, H * OUT_W / OUT_H), minW = Math.min(maxW, Math.max(80, maxW * 0.15));
    function mk(tag, cls, attrs) {
      var e = document.createElement(tag); if (cls) e.className = cls;
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      return e;
    }
    var k0 = Math.min(1, 1000 / Math.max(W, H));   // 화면용은 긴 변 1000px 로 줄여 그림
    var view = mk('canvas', 'crop-img', { 'aria-hidden': 'true' });
    view.width = Math.max(1, Math.round(W * k0)); view.height = Math.max(1, Math.round(H * k0));
    view.getContext('2d').drawImage(bmp, 0, 0, view.width, view.height);
    var rect = mk('div', 'crop-rect', { tabindex: '0', role: 'group', 'aria-label': '남길 자리 틀. 화살표로 옮기고 더하기 · 빼기로 크기를 바꿉니다' });
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) { rect.appendChild(mk('span', 'crop-h is-' + c, { 'data-h': c, 'aria-hidden': 'true' })); });
    var stage = mk('div', 'crop-stage');
    stage.appendChild(view); stage.appendChild(rect);
    var reset = mk('button', 'btn-text crop-reset', { type: 'button' }); reset.textContent = '처음 자리로';
    var hint = mk('p', 'crop-hint');
    hint.textContent = '금색 틀 안이 소개 사진이 됩니다. 틀을 끌어 옮기고, 모서리 흰 점을 끌어 크기를 바꿉니다.';
    var row = mk('div', 'crop-row'); row.appendChild(hint); row.appendChild(reset);
    var wrap = mk('div', 'crop'); wrap.appendChild(stage); wrap.appendChild(row);

    var timer = 0;
    function notify(now) {
      if (!opts.onChange) return;
      clearTimeout(timer);
      if (now) opts.onChange(); else timer = setTimeout(function () { opts.onChange(); }, 120);
    }
    function clamp() {
      R.sw = Math.min(Math.max(R.sw, minW), maxW); R.sh = R.sw * OUT_H / OUT_W;
      R.sx = Math.min(Math.max(R.sx, 0), W - R.sw); R.sy = Math.min(Math.max(R.sy, 0), H - R.sh);
    }
    function draw() {
      clamp();
      rect.style.left = R.sx / W * 100 + '%'; rect.style.top = R.sy / H * 100 + '%';
      rect.style.width = R.sw / W * 100 + '%'; rect.style.height = R.sh / H * 100 + '%';
    }
    var drag = null;
    rect.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      e.preventDefault(); try { rect.setPointerCapture(e.pointerId); } catch (er) { /* 손가락을 이미 뗀 경우 */ } rect.focus({ preventScroll: true });
      drag = { mode: e.target.getAttribute('data-h') || 'move', x: e.clientX, y: e.clientY, r: { sx: R.sx, sy: R.sy, sw: R.sw, sh: R.sh } };
    });
    rect.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var k = stage.clientWidth / W, dx = (e.clientX - drag.x) / k, dy = (e.clientY - drag.y) / k, r0 = drag.r;
      if (drag.mode === 'move') { R.sx = r0.sx + dx; R.sy = r0.sy + dy; }
      else {
        var gx = drag.mode.charAt(1) === 'l' ? -1 : 1, gy = drag.mode.charAt(0) === 't' ? -1 : 1;
        var ax = gx > 0 ? r0.sx : r0.sx + r0.sw, ay = gy > 0 ? r0.sy : r0.sy + r0.sh;   // 반대쪽 모서리는 그대로
        var nw = Math.max(r0.sw + gx * dx, (r0.sh + gy * dy) * OUT_W / OUT_H);
        var lim = Math.min(gx > 0 ? W - ax : ax, (gy > 0 ? H - ay : ay) * OUT_W / OUT_H);
        nw = Math.min(Math.max(nw, minW), lim);
        R.sw = nw; R.sh = nw * OUT_H / OUT_W; R.sx = gx > 0 ? ax : ax - nw; R.sy = gy > 0 ? ay : ay - R.sh;
      }
      draw(); notify();
    });
    function up() { if (drag) { drag = null; notify(true); } }
    rect.addEventListener('pointerup', up);
    rect.addEventListener('pointercancel', up);
    rect.addEventListener('keydown', function (e) {
      var st = (e.shiftKey ? 40 : 10) * W / Math.max(1, stage.clientWidth), key = e.key, cx = R.sx + R.sw / 2, cy = R.sy + R.sh / 2;
      if (key === 'ArrowLeft') R.sx -= st; else if (key === 'ArrowRight') R.sx += st;
      else if (key === 'ArrowUp') R.sy -= st; else if (key === 'ArrowDown') R.sy += st;
      else if (key === '+' || key === '=' || key === '-' || key === '_') {
        R.sw += (key === '-' || key === '_' ? 2 : -2) * st; clamp(); R.sx = cx - R.sw / 2; R.sy = cy - R.sh / 2;
      } else return;
      e.preventDefault(); draw(); notify();
    });
    reset.addEventListener('click', function () { R = { sx: first.sx, sy: first.sy, sw: first.sw, sh: first.sh }; draw(); notify(true); });
    draw();
    return {
      el: wrap,
      blob: function () { return drawRegion(bmp, { sx: R.sx, sy: R.sy, sw: R.sw, sh: R.sh }); },
      destroy: function () { clearTimeout(timer); opts.onChange = null; if (bmp.close) bmp.close(); }
    };
  }

  window.LabUpload = {
    checkPhoto: checkPhoto, checkFile: checkFile, reencodePhoto: reencodePhoto, portrait: portrait, portraitPicker: portraitPicker, safeName: safeName,
    limits: { PHOTO_MAX_IN: PHOTO_MAX_IN, PHOTO_MAX_OUT: PHOTO_MAX_OUT, FILE_MAX: FILE_MAX, LONG_SIDE: LONG_SIDE },
    accept: { photo: '.jpg,.jpeg,.png,.webp', file: '.pdf,.hwp,.hwpx,.docx,.xlsx,.pptx' },
    _magicOf: magicOf
  };
})();
