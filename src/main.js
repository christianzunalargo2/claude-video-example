// Timeline + compositor. Every frame is a pure function of time t, so the page can
// play in real time for preview or be stepped frame-by-frame by scripts/render.mjs.
import * as THREE from 'three';
import { WIDTH, HEIGHT } from './common.js';
import { smoothstep, ease, seg, clamp } from './util.js';
import { createHook } from './shots/hook.js';
import { createCompare } from './shots/compare.js';
import { createTectonics } from './shots/tectonics.js';
import { createLayers } from './shots/layers.js';
import { createBulge } from './shots/bulge.js';

export const DURATION = 15;
export const FPS = 30;
const XF = 0.5; // cross-dissolve length between shots (s)

const SHOTS = [
  { start: 0, end: 3, make: createHook },
  { start: 3, end: 6, make: createCompare },
  { start: 6, end: 9, make: createTectonics },
  { start: 9, end: 12, make: createLayers },
  { start: 12, end: 15, make: createBulge },
];

// caption elements: [selector, in, out]; children with .anim stagger by data-d
const CAPTIONS = [
  ['#cap-1', 0.15, 2.8],
  ['#cap-2', 3.2, 5.85],
  ['#cap-3', 6.2, 8.85],
  ['#cap-4', 9.2, 11.85],
  ['#cap-5', 12.2, 99],
  ['#note-5', 12.6, 99],
];

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const makeRT = () =>
  new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { samples: 4, type: THREE.HalfFloatType });
const rtA = makeRT();
const rtB = makeRT();

// final pass: cross-dissolve, vignette, tone mapping, sRGB, a touch of grain
const post = new THREE.ShaderMaterial({
  uniforms: {
    tA: { value: rtA.texture },
    tB: { value: rtB.texture },
    uMix: { value: 0 },
    uFade: { value: 1 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tA, tB; uniform float uMix, uFade, uTime;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec3 col = mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, uMix);
      vec2 d = vUv - 0.5; d.x *= 1.3;
      col *= mix(1.0, 0.7, smoothstep(0.3, 0.95, length(d)));
      gl_FragColor = vec4(col * uFade, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime * 7.13) * 91.0) - 0.5) * 0.022;
    }`,
  depthTest: false,
  depthWrite: false,
});
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
quad.frustumCulled = false;
postScene.add(quad);

const labelRoot = document.getElementById('labels');
const shots = SHOTS.map((s) => ({ ...s, ...s.make(labelRoot) }));

// caption bookkeeping
const captions = CAPTIONS.map(([sel, tin, tout]) => {
  const el = document.querySelector(sel);
  const parts = [...el.querySelectorAll('.anim')].map((p) => ({ p, d: parseFloat(p.dataset.d || '0') }));
  return { el, tin, tout, parts };
});
const overlay = document.getElementById('overlay');
const prog = document.getElementById('prog');
const chap = document.getElementById('chap');
const brand = document.getElementById('brand');

function weightsAt(t) {
  return shots
    .map((s, i) => {
      const fin = i === 0 ? 1 : smoothstep(s.start - XF / 2, s.start + XF / 2, t);
      const fout = i === shots.length - 1 ? 1 : 1 - smoothstep(s.end - XF / 2, s.end + XF / 2, t);
      return { s, i, w: Math.min(fin, fout) };
    })
    .filter((x) => x.w > 0.0005);
}

export function renderAt(t) {
  t = clamp(t, 0, DURATION);
  const active = weightsAt(t);
  const [a, b] = active;
  a.s.update(t - a.s.start, t);
  renderer.setRenderTarget(rtA);
  renderer.render(a.s.scene, a.s.camera);
  let mix = 0;
  if (b) {
    b.s.update(t - b.s.start, t);
    renderer.setRenderTarget(rtB);
    renderer.render(b.s.scene, b.s.camera);
    mix = b.w;
  }
  const fade = 1 - smoothstep(DURATION - 0.45, DURATION - 0.02, t);
  post.uniforms.uMix.value = mix;
  post.uniforms.uFade.value = fade;
  post.uniforms.uTime.value = t;
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);

  // DOM overlay
  for (const s of shots) {
    const hit = active.find((x) => x.s === s);
    s.labels.layout(s.camera, hit ? hit.w : 0);
  }
  for (const c of captions) {
    const vis = t > c.tin - 0.01 && t < c.tout + 0.01;
    c.el.style.display = vis ? 'block' : 'none';
    if (!vis) continue;
    const out = 1 - smoothstep(c.tout - 0.3, c.tout, t);
    for (const { p, d } of c.parts) {
      const k = seg(t, c.tin + d, c.tin + d + 0.45);
      p.style.opacity = (smoothstep(0, 1, k) * out).toFixed(3);
      p.style.transform = `translateY(${((1 - ease.outCubic(k)) * 26).toFixed(1)}px)`;
    }
  }
  overlay.style.opacity = fade.toFixed(3);
  prog.style.transform = `scaleX(${(t / DURATION).toFixed(4)})`;
  const cur = active.reduce((m, x) => (x.w > m.w ? x : m), active[0]);
  chap.textContent = String(cur.i + 1).padStart(2, '0');
  brand.style.opacity = smoothstep(2.7, 3.2, t).toFixed(3);
}

async function fontsReady() {
  await Promise.all(
    ['900 100px Montserrat', '800 60px Montserrat', '700 24px Montserrat', '400 30px Inter', '600 20px Inter', '700 20px Inter'].map((f) =>
      document.fonts.load(f)
    )
  );
  await document.fonts.ready;
}

const params = new URLSearchParams(location.search);
const ready = fontsReady().then(() => {
  // compile every shot's shaders up front so the first frames don't stall
  for (const s of shots) {
    s.update(0, s.start);
    renderer.compile(s.scene, s.camera);
  }
});

window.__video = { duration: DURATION, fps: FPS, renderAt, ready };

if (params.has('capture')) {
  document.body.classList.add('capture');
} else {
  // interactive preview: plays in real time; Space = pause, ←/→ = seek, ?t=4.2 = still
  const fit = () => {
    const s = Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);
    document.getElementById('stage').style.transform = `scale(${s})`;
  };
  addEventListener('resize', fit);
  fit();
  ready.then(() => {
    const still = params.get('t');
    if (still !== null) return renderAt(parseFloat(still));
    let t = 0, last = performance.now(), paused = false;
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') paused = !paused;
      if (e.code === 'ArrowRight') t = Math.min(DURATION, t + 1);
      if (e.code === 'ArrowLeft') t = Math.max(0, t - 1);
    });
    const loop = (now) => {
      if (!paused) t = (t + (now - last) / 1000) % DURATION;
      last = now;
      renderAt(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
