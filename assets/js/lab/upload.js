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

  // 화면에 보일 원래 이름: 위험한 글자를 빼고 100자까지
  function safeName(name) {
    var s = String(name || '파일').replace(/[\/\\:*?"<>|\u0000-\u001F\u007F]/g, '').trim();
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

  window.LabUpload = {
    checkPhoto: checkPhoto, checkFile: checkFile, reencodePhoto: reencodePhoto, safeName: safeName,
    limits: { PHOTO_MAX_IN: PHOTO_MAX_IN, PHOTO_MAX_OUT: PHOTO_MAX_OUT, FILE_MAX: FILE_MAX, LONG_SIDE: LONG_SIDE },
    accept: { photo: '.jpg,.jpeg,.png,.webp', file: '.pdf,.hwp,.hwpx,.docx,.xlsx,.pptx' },
    _magicOf: magicOf
  };
})();
