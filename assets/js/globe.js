// A1: 실시간 하이엔드 WebGL 지구본
const slide = document.querySelector(".slide--globe");
if (slide) startGlobeA(slide);

function startGlobeA(slide) {
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

    vec2 camToLonLat(vec3 n) {
      float cl = cos(uAngles.y), sl = sin(uAngles.y);
      float y1 = n.y * cl + n.z * sl;
      float z1 = -n.y * sl + n.z * cl;
      float x1 = n.x;
      float lat = asin(clamp(y1, -1.0, 1.0));
      float lon = atan(x1, z1) + uAngles.x;
      return vec2(lon, lat);
    }

    float sampleSdf(vec2 lonLat) {
      float u = fract(lonLat.x / (2.0 * PI) + 0.5);
      float v = clamp(0.5 - lonLat.y / PI, 0.001, 0.999);
      return texture2D(uSdf, vec2(u, v)).r;
    }

    void main() {
      vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      vec2 d = (frag - uGlobe.xy) / uGlobe.z;
      float r2 = dot(d, d);
      float r = sqrt(r2);

      vec3 L = normalize(vec3(-0.52, 0.56, 0.64));
      vec2 limbDir = r > 1e-4 ? d / r : vec2(0.0, -1.0);
      float sunSide = clamp(dot(vec3(limbDir.x, -limbDir.y, 0.25), L) * 0.65 + 0.45, 0.0, 1.0);

      vec3 goldAtmo = vec3(0.885, 0.915, 0.968);
      vec3 navyAtmo = vec3(0.150, 0.245, 0.415);
      vec3 haloCol = mix(navyAtmo, goldAtmo, pow(sunSide, 1.35));

      if (r > 1.22) {
        gl_FragColor = vec4(0.0);
        return;
      }

      float outerFalloff = exp(-max(r - 1.0, 0.0) * 18.0);
      float outerAlpha = outerFalloff * (0.25 * sunSide + 0.075);

      if (r >= 1.0) {
        float edgeAA = smoothstep(1.0, 0.9965, r);
        gl_FragColor = vec4(haloCol, outerAlpha * (1.0 - edgeAA));
        return;
      }

      float z = sqrt(max(0.0, 1.0 - r2));
      vec3 N = vec3(d.x, -d.y, z);
      vec3 V = vec3(0.0, 0.0, 1.0);

      vec2 ll = camToLonLat(N);
      float raw = uReady > 0.5 ? sampleSdf(ll) : 0.0;
      float sdfPx = (raw - 0.40) * 20.0;

      // Subtle coastal bevel relief
      float eps = 0.0017;
      float sx = uReady > 0.5 ? sampleSdf(ll + vec2(eps / max(cos(ll.y), 0.18), 0.0)) - raw : 0.0;
      float sy = uReady > 0.5 ? sampleSdf(ll + vec2(0.0, eps)) - raw : 0.0;
      vec3 bevelN = normalize(N + vec3(-sx * 3.0, -sy * 3.0, 0.0));

      float diff = clamp(dot(N, L), 0.0, 1.0);
      float bevelDiff = clamp(dot(bevelN, L), 0.0, 1.0);

      float dAng = 1.0 / (uGlobe.z * max(z, 0.16));
      float aa = clamp(2048.0 / 6.2831853 * dAng, 0.55, 2.2);
      float land = smoothstep(-aa * 0.65, aa * 0.65, sdfPx);
      float shelf = smoothstep(-5.5, 0.0, sdfPx) * (1.0 - land);
      // Coastal luminosity rim inside continents: slightly brighter near coasts, calm velvet toward deep interior
      float coastRimGlow = exp(-max(sdfPx, 0.0) * 0.28);

      // Ocean
      vec3 oceanShadow = vec3(0.024, 0.048, 0.100);
      vec3 oceanMid    = vec3(0.046, 0.092, 0.178);
      vec3 oceanLit    = vec3(0.078, 0.148, 0.270);
      vec3 oceanCol = mix(oceanShadow, oceanMid, smoothstep(0.0, 0.48, diff));
      oceanCol = mix(oceanCol, oceanLit, pow(diff, 1.6));
      oceanCol += vec3(0.025, 0.042, 0.072) * shelf * (0.35 + 0.65 * diff);

      vec3 Hvec = normalize(L + V);
      float oceanSpec = pow(max(dot(N, Hvec), 0.0), 28.0) * 0.075;
      oceanCol += vec3(0.86, 0.90, 0.97) * oceanSpec;

      // Continents: refined architectural relief + subtle silk micro-grid (watch-dial guilloche feel)
      float micro = 0.965 + 0.035 * sin(ll.y * 540.0) * cos(ll.x * 540.0 * max(cos(ll.y), 0.2));
      vec3 landShadow = vec3(0.165, 0.215, 0.305);
      vec3 landMid    = vec3(0.345, 0.415, 0.525);
      vec3 landHi     = vec3(0.615, 0.685, 0.785);
      vec3 landCol = mix(landShadow, landMid, 0.28 + 0.58 * smoothstep(0.0, 0.80, bevelDiff));
      landCol = mix(landCol, landHi, (pow(bevelDiff, 1.95) * 0.46 + coastRimGlow * 0.24 * (0.35 + 0.65 * diff)));
      landCol *= micro;

      vec3 surf = mix(oceanCol, landCol, land);

      // Crisp 1px shoreline highlight
      float coastLine = 1.0 - smoothstep(0.0, aa * 1.22, abs(sdfPx));
      vec3 coastCol = mix(vec3(0.68, 0.75, 0.85), vec3(0.96, 0.98, 1.00), smoothstep(0.05, 0.85, diff));
      surf = mix(surf, coastCol, coastLine * (0.46 + 0.42 * diff) * step(0.5, uReady));

      // Spherical graticule (15 deg)
      float gLon = abs(sin(ll.x * 12.0));
      float gLat = abs(sin(ll.y * 12.0));
      float wLon = clamp(12.0 * dAng / max(cos(ll.y), 0.15), 0.006, 0.18);
      float wLat = clamp(12.0 * dAng, 0.006, 0.12);
      float mer = (1.0 - smoothstep(0.0, wLon * 1.25, gLon)) * smoothstep(1.48, 1.15, abs(ll.y));
      float par = 1.0 - smoothstep(0.0, wLat * 1.25, gLat);
      float eq  = 1.0 - smoothstep(0.0, dAng * 1.55, abs(ll.y));

      float limbFade = smoothstep(0.04, 0.38, z);
      float gridMask = max(mer, par) * limbFade;
      surf = mix(surf, mix(vec3(0.75, 0.82, 0.92), vec3(0.93, 0.96, 1.00), land), gridMask * mix(0.11, 0.15, land));
      surf = mix(surf, vec3(0.82, 0.67, 0.40), eq * limbFade * 0.30);

      // Fresnel atmospheric rim light
      float fresnel = pow(1.0 - z, 3.8);
      vec3 rimCol = mix(vec3(0.17, 0.27, 0.44), vec3(0.89, 0.92, 0.97), pow(sunSide, 1.25));
      surf += rimCol * fresnel * (0.18 + 0.42 * sunSide);

      float rimEdge = smoothstep(0.992, 0.999, r);
      surf = mix(surf, rimCol * 1.06, rimEdge * (0.24 + 0.38 * sunSide));

      float sphereAA = smoothstep(1.0, 0.9965, r);
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
      g.addColorStop(0, `rgba(243, 227, 189, ${(0.42 * a).toFixed(3)})`);
      g.addColorStop(1, "rgba(201, 164, 92, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.1, 0, Math.PI * 2);
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
