// 첫 화면 WHO 협력센터 장면의 3D 지구본(시안 D1b 판 b를 옮김, 2026-10-27). build.py 가 <script type="module"> 로 부른다.
// 장면이 나타날 때마다 지구가 40도를 돌아 자리를 잡고 멈춘다(연구자 10-27: 협력 나라 선 · 이름표 없이 지구본만, 움직임은 그대로).
// 장면이 보일 때만 그리고, 다른 장면 · 화면 밖 · 숨긴 탭이면 멈추며, '동작 줄이기'면 정지 그림 한 장만 그린다.
import createGlobe from "../vendor/cobe.esm.js";

const slide = document.querySelector(".slide--globe");
if (slide) start(slide);

function start(slide) {
  const CFG = {
    lon: 77, theta: -0.05, turn: 40, intro: 3800, grid: [-40, -20, 0, 20, 40, 60], meridians: 12, dpr: 1.5,
    samples: 34000, bright: 1.05, base: [0.5, 0.49, 0.45],
  };
  const box = slide.querySelector(".slide-globe"), disk = box.querySelector(".disk");
  const fx = box.querySelector(".fx"), ctx = fx.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)"), fdpr = Math.min(devicePixelRatio, 2);
  const D = Math.PI / 180, { sin, cos } = Math;
  const U = ([la, lo]) => { const r = la * D, a = lo * D - Math.PI; return [-cos(r) * cos(a), sin(r), cos(r) * sin(a)]; }; // cobe 2.0.1과 같은 좌표
  const PHI = (lon) => -Math.PI / 2 - lon * D;
  const clamp = (v) => Math.max(0, Math.min(1, v)), ease = (u) => 1 - (1 - u) ** 3;
  const phiAt = (t) => PHI(CFG.lon + CFG.turn * (1 - ease(clamp(t / CFG.intro)))); // 들어올 때 40도를 돌아 자리를 잡는다

  let W = 0, H = 0, G = { x: 0, y: 0, r: 1 }, M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const view = (phi) => { const ct = cos(CFG.theta), st = sin(CFG.theta), cp = cos(phi), sp = sin(phi); M = [cp, 0, sp, sp * st, ct, -cp * st, -sp * ct, st, cp * ct]; };
  const P = (v) => { // cobe와 같은 정사영. on: 지구 앞면
    const x = M[0] * v[0] + M[2] * v[2], y = M[3] * v[0] + M[4] * v[1] + M[5] * v[2], z = M[6] * v[0] + M[7] * v[1] + M[8] * v[2];
    return { x: G.x + x * G.r, y: G.y - y * G.r, on: z > 0 };
  };
  // 아주 옅은 점선 위도 · 경도선(지구 앞면만 긋는다)
  const lines = [
    ...CFG.grid.map((la) => Array.from({ length: 121 }, (_, i) => U([la, i * 3 - 180]))),
    ...Array.from({ length: CFG.meridians }, (_, j) => Array.from({ length: 61 }, (_, i) => U([i * 3 - 90, j * 360 / CFG.meridians]))),
  ];
  function draw() {
    ctx.setTransform(fdpr, 0, 0, fdpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round"; ctx.setLineDash([1.2, 3.6]); ctx.lineWidth = .7; ctx.strokeStyle = "rgba(196,210,236,.17)";
    for (const L of lines) {
      ctx.beginPath(); let pen = false;
      for (const v of L) { const q = P(v); if (q.on) { pen ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); pen = true; } else pen = false; }
      ctx.stroke();
    }
  }

  let globe = null, time = 0, last = 0, raf = 0, onScreen = true, wasOn = false;
  function ensure() {
    if (globe) return;
    globe = createGlobe(box.querySelector(".gl"), {
      devicePixelRatio: Math.min(devicePixelRatio, CFG.dpr), width: 10, height: 10, phi: still.matches ? PHI(CFG.lon) : phiAt(0), theta: CFG.theta,
      dark: 1, diffuse: 1.5, mapSamples: CFG.samples, mapBrightness: CFG.bright, baseColor: CFG.base,
      glowColor: [0.07, 0.1, 0.17], markers: [], arcs: [],
    });
    layout();
    setTimeout(paint, 500); setTimeout(paint, 1500); // 지도 무늬가 늦게 읽히므로 정지 그림도 다시 그린다
  }
  function paint() { if (!globe) return; const phi = still.matches ? PHI(CFG.lon) : phiAt(time); view(phi); globe.update({ phi }); draw(); }
  function layout() { // 원판(.disk) 자리에 맞춰 cobe 크기 · 배율 · 위치와 덧그림 판을 맞춘다
    if (!globe) return;
    const hr = box.getBoundingClientRect(), dr = disk.getBoundingClientRect(), br = box.querySelector(".gl").getBoundingClientRect();
    W = hr.width; H = hr.height; fx.width = Math.round(W * fdpr); fx.height = Math.round(H * fdpr);
    G = { x: dr.left - hr.left + dr.width / 2, y: dr.top - hr.top + dr.height / 2, r: dr.width / 2 };
    const B = G.r / (0.4 * br.height);
    globe.update({ width: br.width, height: br.height, scale: B, offset: [2 * (G.x - (br.left - hr.left) - br.width / 2) / B, 2 * (G.y - (br.top - hr.top) - br.height / 2) / B] });
    paint();
  }
  function frame(now) {
    raf = 0;
    if (last && now - last < 33) { raf = requestAnimationFrame(frame); return; } // 1초에 30번까지만 그린다
    if (last) time += Math.min(now - last, 100);
    last = now; paint();
    if (time < CFG.intro) raf = requestAnimationFrame(frame); // 자리를 잡으면 더 그리지 않는다
  }
  function sync() {
    const on = slide.classList.contains("is-on");
    if (on && !wasOn) { ensure(); time = 0; last = 0; paint(); } // 장면이 다시 나타날 때마다 처음부터
    wasOn = on;
    const run = on && onScreen && !document.hidden && !still.matches && time < CFG.intro;
    if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (still.matches && on) paint();
  }
  new MutationObserver(sync).observe(slide, { attributes: true, attributeFilter: ["class"] });
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }).observe(slide);
  new ResizeObserver(layout).observe(box);
  document.addEventListener("visibilitychange", sync);
  still.addEventListener("change", sync);
  sync();
}
