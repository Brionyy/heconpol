// 첫 화면 WHO 협력센터 장면: 실시간 WebGL 3D 지구본 (백금 실버-슬레이트 대륙 · 미드나잇 네이비 바다 · 서울 금색 포인트)
// 장면이 나타날 때 4초 동안 38도를 부드럽게 돌아 자리를 잡고 멈추며, 화면 밖 · 탭 숨김 · '동작 줄이기' 설정에서는 즉시 멈춘다.
const slide = document.querySelector(".slide--globe");
if (slide) startGlobe(slide);

function startGlobe(slide) {
  const CFG = {
    lonRest: 115.0,
    latTilt: 20.0,
    turnDeg: 38.0,
    introMs: 4000,
    seoul: [37.5665, 126.9780],
    dprMax: 2.0,
  };
  const box = slide.querySelector(".slide-globe");
  const disk = box.querySelector(".disk");
  const glCanvas = box.querySelector(".gl");
  const fxCanvas = box.querySelector(".fx");
  const ctx = fxCanvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const D = Math.PI / 180;

  const gl = glCanvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: false })
          || glCanvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false });
  if (!gl) return;

  const vsSrc = `
    attribute vec2 aPos;
    void main() {
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const fsSrc = `
    precision highp float;
    uniform vec2 uRes;
    uniform vec3 uGlobe;
    uniform vec2 uAngles;
    uniform sampler2D uSdf;
    uniform float uReady;

    const float PI = 3.14159265359;
    const vec2 TEX_SIZE = vec2(2048.0, 1024.0);
    const vec2 INV_TEX  = vec2(1.0 / 2048.0, 1.0 / 1024.0);

    vec2 camToLonLat(vec3 n) {
      float cl = cos(uAngles.y), sl = sin(uAngles.y);
      float y1 = n.y * cl + n.z * sl;
      float z1 = -n.y * sl + n.z * cl;
      float x1 = n.x;
      float lat = asin(clamp(y1, -1.0, 1.0));
      float lon = atan(x1, z1) + uAngles.x;
      return vec2(lon, lat);
    }

    // 4-tap Bicubic B-spline texture lookup: C2 continuous curves even at extreme polar grazing angles
    float sampleSdfBicubic(vec2 lonLat) {
      vec2 uv = vec2(fract(lonLat.x / (2.0 * PI) + 0.5), clamp(0.5 - lonLat.y / PI, 0.001, 0.999));
      vec2 coord = uv * TEX_SIZE - 0.5;
      vec2 idx = floor(coord);
      vec2 f = coord - idx;
      vec2 f2 = f * f;
      vec2 f3 = f2 * f;

      vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
      vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
      vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
      vec2 w3 = f3 / 6.0;

      vec2 g0 = w0 + w1;
      vec2 g1 = w2 + w3;
      vec2 h0 = ((idx + (w1 / g0) + 0.5) * INV_TEX);
      vec2 h1 = ((idx + 2.0 + (w3 / g1) + 0.5) * INV_TEX);

      float s00 = texture2D(uSdf, vec2(h0.x, h0.y)).r;
      float s10 = texture2D(uSdf, vec2(h1.x, h0.y)).r;
      float s01 = texture2D(uSdf, vec2(h0.x, h1.y)).r;
      float s11 = texture2D(uSdf, vec2(h1.x, h1.y)).r;

      float sx0 = mix(s10, s00, g0.x);
      float sx1 = mix(s11, s01, g0.x);
      return mix(sx1, sx0, g0.y);
    }

    void main() {
      vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      vec2 d = (frag - uGlobe.xy) / uGlobe.z;
      float r2 = dot(d, d);
      float r = sqrt(r2);

      vec3 L = normalize(vec3(-0.50, 0.55, 0.67));
      vec2 limbDir = r > 1e-4 ? d / r : vec2(0.0, -1.0);
      float sunSide = clamp(dot(vec3(limbDir.x, -limbDir.y, 0.25), L) * 0.65 + 0.40, 0.0, 1.0);

      // Soft, deep navy-slate atmospheric halo (NO white halo!)
      vec3 haloCol = mix(vec3(0.08, 0.15, 0.28), vec3(0.22, 0.35, 0.56), pow(sunSide, 1.4));

      if (r > 1.18) {
        gl_FragColor = vec4(0.0);
        return;
      }

      float outerFalloff = exp(-max(r - 1.0, 0.0) * 22.0);
      float outerAlpha = outerFalloff * (0.16 * sunSide + 0.04);

      if (r >= 1.0) {
        gl_FragColor = vec4(haloCol, outerAlpha);
        return;
      }

      float z = sqrt(max(0.0, 1.0 - r2));
      vec3 N = vec3(d.x, -d.y, z);
      vec3 V = vec3(0.0, 0.0, 1.0);

      vec2 ll = camToLonLat(N);
      // Exact coastline is 5.0 / 12.0 = 0.4166667
      float raw = uReady > 0.5 ? sampleSdfBicubic(ll) : 0.0;
      float sdfTex = (raw - 0.4166667) * 12.0;

      // Convert texel SDF to local spherical surface distance (correcting equirectangular polar stretch!)
      float cosLat = max(cos(ll.y), 0.18);
      float dAng = 1.0 / (uGlobe.z * max(z, 0.14));
      float aa = clamp((2048.0 / 6.2831853) * dAng / pow(cosLat, 0.55), 0.55, 2.4);

      // Clean, borderless anti-aliased land mask (NO white outline!)
      float land = smoothstep(-aa * 0.70, aa * 0.70, sdfTex) * step(0.5, uReady);
      float shelf = smoothstep(-3.8, 0.0, sdfTex) * (1.0 - land) * step(0.5, uReady);
      float inland = smoothstep(0.0, 4.5, sdfTex);

      float diff = clamp(dot(N, L), 0.0, 1.0);

      // Deep midnight navy ocean
      vec3 oceanShadow = vec3(0.022, 0.045, 0.096);
      vec3 oceanMid    = vec3(0.044, 0.088, 0.172);
      vec3 oceanLit    = vec3(0.074, 0.142, 0.262);
      vec3 oceanCol = mix(oceanShadow, oceanMid, smoothstep(0.0, 0.50, diff));
      oceanCol = mix(oceanCol, oceanLit, pow(diff, 1.6));
      oceanCol += vec3(0.018, 0.034, 0.062) * shelf * (0.35 + 0.65 * diff);

      vec3 Hvec = normalize(L + V);
      float oceanSpec = pow(max(dot(N, Hvec), 0.0), 26.0) * 0.055;
      oceanCol += vec3(0.55, 0.68, 0.88) * oceanSpec;

      // Smooth satin steel-silver continents (borderless, zero moire, zero white halo)
      vec3 landShadow = vec3(0.125, 0.178, 0.275);
      vec3 landMid    = vec3(0.255, 0.335, 0.455);
      vec3 landHi     = vec3(0.455, 0.545, 0.668);
      vec3 landCol = mix(landShadow, landMid, 0.26 + 0.62 * smoothstep(0.0, 0.82, diff));
      landCol = mix(landCol, landHi, pow(diff, 1.85) * 0.48);
      // Very gentle interior depth (no outline!)
      landCol *= (0.96 + 0.04 * inland);

      vec3 surf = mix(oceanCol, landCol, land);

      // Delicate spherical graticule (15 deg), fading cleanly toward poles and horizon limb
      float gLon = abs(sin(ll.x * 12.0));
      float gLat = abs(sin(ll.y * 12.0));
      float wLon = clamp(12.0 * dAng / max(cosLat, 0.20), 0.006, 0.16);
      float wLat = clamp(12.0 * dAng, 0.006, 0.12);
      float mer = (1.0 - smoothstep(0.0, wLon * 1.25, gLon)) * smoothstep(1.42, 1.08, abs(ll.y));
      float par = (1.0 - smoothstep(0.0, wLat * 1.25, gLat)) * smoothstep(1.46, 1.20, abs(ll.y));
      float eq  = 1.0 - smoothstep(0.0, dAng * 1.50, abs(ll.y));

      float limbFade = smoothstep(0.08, 0.42, z);
      float gridMask = max(mer, par) * limbFade;
      surf = mix(surf, mix(vec3(0.52, 0.64, 0.82), vec3(0.74, 0.82, 0.92), land), gridMask * mix(0.085, 0.105, land));
      surf = mix(surf, vec3(0.79, 0.64, 0.37), eq * limbFade * 0.26);

      // Restrained navy-blue Fresnel atmosphere (NO white border line!)
      float fresnel = pow(1.0 - z, 4.2);
      vec3 rimCol = mix(vec3(0.08, 0.16, 0.30), vec3(0.32, 0.46, 0.68), pow(sunSide, 1.35));
      surf += rimCol * fresnel * (0.14 + 0.26 * sunSide);

      // Seamless subpixel anti-aliasing at sphere horizon
      float sphereAA = smoothstep(1.0, 0.9955, r);
      vec3 finalRgb = mix(haloCol, surf, sphereAA);
      float finalA = mix(outerAlpha, 1.0, sphereAA);
      gl_FragColor = vec4(finalRgb, finalA);
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  const uRes = gl.getUniformLocation(prog, "uRes");
  const uGlobe = gl.getUniformLocation(prog, "uGlobe");
  const uAngles = gl.getUniformLocation(prog, "uAngles");
  const uSdf = gl.getUniformLocation(prog, "uSdf");
  const uReady = gl.getUniformLocation(prog, "uReady");

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  let texReady = 0;

  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    texReady = 1;
    paint();
  };
  img.src = new URL("../img/world-sdf.png", import.meta.url).href;

  let W = 0, H = 0, dpr = 1, G = { x: 0, y: 0, r: 1 };
  let time = 0, last = 0, raf = 0, onScreen = true, wasOn = false;

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const easeOut = (u) => 1 - Math.pow(1 - u, 3.2);
  const lonAt = (t) => {
    if (still.matches) return CFG.lonRest;
    const u = easeOut(clamp(t / CFG.introMs));
    return CFG.lonRest - CFG.turnDeg * (1 - u);
  };

  function smooth01(x) {
    const t = clamp(x);
    return t * t * (3 - 2 * t);
  }

  function projectLonLat(latDeg, lonDeg, lon0Deg, lat0Deg) {
    const lat = latDeg * D, lon = (lonDeg - lon0Deg) * D, lat0 = lat0Deg * D;
    const x1 = Math.cos(lat) * Math.sin(lon);
    const y1 = Math.sin(lat);
    const z1 = Math.cos(lat) * Math.cos(lon);
    const yc = y1 * Math.cos(lat0) - z1 * Math.sin(lat0);
    const zc = y1 * Math.sin(lat0) + z1 * Math.cos(lat0);
    return { x: G.x + x1 * G.r, y: G.y - yc * G.r, z: zc };
  }

  function drawOverlay(lon0Deg, u) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const p = projectLonLat(CFG.seoul[0], CFG.seoul[1], lon0Deg, CFG.latTilt);
    if (p.z <= 0.08) return;
    const vis = clamp((p.z - 0.08) / 0.25);

    if (!still.matches && u > 0.35 && u < 0.995) {
      const pu = (u - 0.35) / 0.65;
      const waveR = 4 + pu * 22;
      const waveA = Math.sin(pu * Math.PI) * 0.45 * vis;
      ctx.beginPath();
      ctx.arc(p.x, p.y, waveR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(201, 164, 92, ${waveA.toFixed(3)})`;
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    const settle = still.matches ? 1 : smooth01((u - 0.25) / 0.65);
    if (settle > 0.01) {
      const a = settle * vis;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(201, 164, 92, ${(0.62 * a).toFixed(3)})`;
      ctx.lineWidth = 1.15;
      ctx.stroke();

      const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 12);
      g.addColorStop(0, `rgba(243, 227, 189, ${(0.40 * a).toFixed(3)})`);
      g.addColorStop(1, "rgba(201, 164, 92, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(246, 232, 198, ${(0.98 * a).toFixed(3)})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(11, 21, 40, ${(0.72 * a).toFixed(3)})`;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }

  function layout() {
    const hr = box.getBoundingClientRect();
    const dr = disk.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, CFG.dprMax);
    W = Math.max(1, Math.round(hr.width));
    H = Math.max(1, Math.round(hr.height));
    glCanvas.width = Math.round(W * dpr);
    glCanvas.height = Math.round(H * dpr);
    fxCanvas.width = Math.round(W * dpr);
    fxCanvas.height = Math.round(H * dpr);
    G = {
      x: dr.left - hr.left + dr.width / 2,
      y: dr.top - hr.top + dr.height / 2,
      r: dr.width / 2,
    };
    paint();
  }

  function paint() {
    if (!W || !H) return;
    const u = still.matches ? 1 : clamp(time / CFG.introMs);
    const lon = lonAt(time);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uRes, glCanvas.width, glCanvas.height);
    gl.uniform3f(uGlobe, G.x * dpr, G.y * dpr, G.r * dpr);
    gl.uniform2f(uAngles, lon * D, CFG.latTilt * D);
    gl.uniform1i(uSdf, 0);
    gl.uniform1f(uReady, texReady);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    drawOverlay(lon, easeOut(u));
  }

  function frame(now) {
    raf = 0;
    if (last && now - last < 30) { raf = requestAnimationFrame(frame); return; }
    if (last) time += Math.min(now - last, 100);
    last = now;
    paint();
    if (time < CFG.introMs) raf = requestAnimationFrame(frame);
  }

  function sync() {
    const on = slide.classList.contains("is-on");
    if (on && !wasOn) {
      time = 0;
      last = 0;
      layout();
    }
    wasOn = on;
    const run = on && onScreen && !document.hidden && !still.matches && time < CFG.introMs;
    if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (still.matches && on) paint();
  }

  new MutationObserver(sync).observe(slide, { attributes: true, attributeFilter: ["class"] });
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }).observe(slide);
  new ResizeObserver(layout).observe(box);
  document.addEventListener("visibilitychange", sync);
  still.addEventListener("change", sync);
  layout();
  sync();
}
