// Shot 1 (0–3 s): golden-hour flyover of a procedural Chimborazo massif.
import * as THREE from 'three';
import { makeNoise2D, fbm, smoothstep, smax, clamp, lerp, ease, seg, fmt, mulberry32 } from '../util.js';
import { makeSkyDome, ASPECT, WIDTH, HEIGHT, LabelLayer } from '../common.js';

const VE = 1.35; // vertical exaggeration so the relief reads on screen
const BASE_KM = 3.0; // km mapped to world y = 0
const SUMMIT_KM = 6.263;
const toWorldY = (km) => (km - BASE_KM) * VE;

export function createHook(labelRoot) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, ASPECT, 0.1, 600);
  // shift the framing so the mountain sits right of centre, leaving room for the title
  camera.setViewOffset(WIDTH, HEIGHT, -440, 40, WIDTH, HEIGHT);

  const sunDir = new THREE.Vector3(0.85, 0.3, 0.2).normalize();

  // ---------- height field ----------
  const n1 = makeNoise2D(11), n2 = makeNoise2D(23), n3 = makeNoise2D(37), n4 = makeNoise2D(41);
  const R = 9.5;
  // the four summits of the massif: Whymper (highest), Veintimilla, Politécnica, Martínez
  const peaks = [
    { x: -0.8, z: 0.35, h: 0.24, s: 0.95 },
    { x: 0.35, z: 0.05, h: 0.16, s: 0.8 },
    { x: 1.35, z: -0.55, h: 0.07, s: 0.7 },
    { x: 2.05, z: -1.05, h: 0.03, s: 0.6 },
  ];
  function sample(x, z) {
    const plateau =
      3.8 + 0.5 * fbm(n1, x * 0.05 + 3.1, z * 0.05 - 1.7, 5) + 0.1 * fbm(n2, x * 0.35, z * 0.35, 3);
    const ex = x * 0.92, ez = z * 1.08;
    const r = Math.hypot(ex, ez);
    const ang = Math.atan2(ez, ex);
    const f = Math.pow(1 - smoothstep(0, R, r), 1.25);
    // radial ridges and gullies: noise sampled on a circle so it is periodic in angle
    const K = 2.6;
    const ridge = 1 - Math.abs(n3(Math.cos(ang) * K + r * 0.22, Math.sin(ang) * K + r * 0.15));
    const ridge2 = 1 - Math.abs(n4(Math.cos(ang) * K * 2.4 + r * 0.45, Math.sin(ang) * K * 2.4 - r * 0.35));
    const band = Math.sin(Math.PI * clamp(f * 1.06));
    let m = 3.5 + 2.5 * f + (ridge - 0.62) * 0.42 * band + (ridge2 - 0.62) * 0.16 * band;
    for (const p of peaks) {
      const d2 = ((x - p.x) ** 2 + (z - p.z) ** 2) / (p.s * p.s);
      m += p.h * Math.exp(-d2 * 2.0);
    }
    return { km: smax(plateau, m, 0.6), ridge, f };
  }

  // first pass: find the summit so we can calibrate it to exactly 6,263 m
  let maxKm = 0;
  for (let x = -3; x <= 3; x += 0.05) for (let z = -3; z <= 3; z += 0.05) maxKm = Math.max(maxKm, sample(x, z).km);
  const kmScale = SUMMIT_KM / maxKm;
  const heightKm = (x, z) => {
    const s = sample(x, z);
    s.km *= kmScale;
    return s;
  };

  // ---------- terrain meshes ----------
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  const C = {
    grass: new THREE.Color('#a08d4f'),
    grass2: new THREE.Color('#6d7a43'),
    sand: new THREE.Color('#8f6a4d'),
    rock: new THREE.Color('#54443e'),
    rockDark: new THREE.Color('#2e2624'),
    snow: new THREE.Color('#f5f8fc'),
    ice: new THREE.Color('#bfd2ea'),
  };
  const tmp = new THREE.Color();

  function buildTerrain(size, segs, dipInside = 0) {
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const meta = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const s = heightKm(x, z);
      let y = toWorldY(s.km);
      if (dipInside) {
        // the coarse outer skirt dives under the detailed inner tile so they never z-fight
        const d = Math.max(Math.abs(x), Math.abs(z));
        y -= 0.6 * smoothstep(dipInside, dipInside - 2, d);
      }
      pos.setY(i, y);
      meta.push(s);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const { km, ridge } = meta[i];
      const slope = 1 - nrm.getY(i);
      const v = 0.5 + 0.5 * n2(x * 0.4, z * 0.4);
      tmp.copy(C.grass).lerp(C.grass2, v * 0.7);
      tmp.lerp(C.sand, smoothstep(4.25, 4.75, km + (v - 0.5) * 0.3));
      tmp.lerp(C.rock, clamp(smoothstep(0.18, 0.42, slope) + smoothstep(4.7, 5.0, km) * 0.6));
      tmp.lerp(C.rockDark, smoothstep(0.35, 0.65, slope) * 0.7);
      const snowLine = 4.95 + 0.22 * n1(x * 0.25 + 9, z * 0.25) - (1 - ridge) * 0.45;
      let snow = smoothstep(snowLine - 0.04, snowLine + 0.14, km) * (1 - smoothstep(0.5, 0.78, slope));
      tmp.lerp(C.ice, snow);
      tmp.lerp(C.snow, snow * smoothstep(5.1, 5.6, km));
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }
  scene.add(buildTerrain(44, 330));
  scene.add(buildTerrain(260, 170, 22));

  // ---------- light & atmosphere ----------
  const sun = new THREE.DirectionalLight('#ffd2a1', 3.4);
  sun.position.copy(sunDir).multiplyScalar(60);
  sun.target.position.set(0, 2, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#9dbbe6', '#5a4632', 1.0));

  const fogColor = new THREE.Color('#d8bfa6');
  scene.fog = new THREE.FogExp2(fogColor, 0.0078);
  scene.add(
    makeSkyDome({
      top: '#2f5fa8',
      horizon: '#efc9a2',
      bottom: '#d8bfa6',
      sunDir,
      sunColor: '#ffd9ae',
      sunStrength: 1.4,
    })
  );

  // ---------- clouds ----------
  const cloudTex = makeCloudTexture(7);
  const clouds = [];
  const rnd = mulberry32(99);
  for (let i = 0; i < 10; i++) {
    // keep clouds behind / beside the massif so the foreground stays crisp
    const a = -Math.PI * 0.95 + rnd() * Math.PI * 1.15;
    const rad = 10 + rnd() * 8;
    const mat = new THREE.SpriteMaterial({
      map: cloudTex,
      color: new THREE.Color('#fff4ea'),
      transparent: true,
      opacity: 0.55 + rnd() * 0.25,
      depthWrite: false,
      fog: true,
    });
    const sp = new THREE.Sprite(mat);
    const w = 7 + rnd() * 7;
    sp.scale.set(w, w * 0.32, 1);
    sp.position.set(Math.cos(a) * rad, toWorldY(4.4 + rnd() * 0.5), Math.sin(a) * rad);
    sp.userData.base = sp.position.clone();
    sp.userData.speed = 0.25 + rnd() * 0.3;
    scene.add(sp);
    clouds.push(sp);
  }

  // ---------- labels ----------
  const labels = new LabelLayer(labelRoot);
  const summitPin = labels.add(
    `<span class="pin-kicker">Whymper summit</span><span class="pin-value"><b class="js-alt">0</b> m</span>`,
    { cls: 'pin pin-gold', pos: new THREE.Vector3(-0.8, toWorldY(SUMMIT_KM) + 0.05, 0.35) }
  );
  const altEl = summitPin.el.querySelector('.js-alt');

  // ---------- animation ----------
  const target = new THREE.Vector3();
  function update(t) {
    const p = ease.inOutSine(clamp((t + 0.3) / 3.6));
    const ang = lerp(-0.62, -0.12, p);
    const dist = lerp(29, 21.5, p);
    const y = lerp(toWorldY(4.3), toWorldY(4.7), p);
    camera.position.set(Math.sin(ang) * dist, y, Math.cos(ang) * dist);
    target.set(0, lerp(toWorldY(5.0), toWorldY(5.15), p), 0);
    camera.lookAt(target);

    for (const c of clouds) {
      c.position.x = c.userData.base.x + t * c.userData.speed;
    }

    const pinIn = ease.outCubic(seg(t, 0.9, 1.5));
    summitPin.opacity = pinIn * (1 - seg(t, 2.85, 3.1));
    summitPin.rise = 1 - pinIn;
    altEl.textContent = fmt(SUMMIT_KM * 1000 * ease.outExpo(seg(t, 0.9, 2.2)));
  }

  return { scene, camera, labels, update };
}

function makeCloudTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  for (let i = 0; i < 70; i++) {
    const x = 60 + rnd() * 392;
    const y = 96 + (rnd() - 0.5) * 50;
    const r = 18 + rnd() * 46;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.32)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
