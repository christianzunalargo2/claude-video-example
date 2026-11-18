// Shot 2 (3–6 s): Ecuador's four highest peaks rise side by side, to scale.
import * as THREE from 'three';
import { makeNoise2D, smoothstep, clamp, lerp, ease, seg, fmt, mulberry32 } from '../util.js';
import { makeSkyDome, ASPECT, WIDTH, HEIGHT, LabelLayer, makeBar } from '../common.js';

const FLOOR_KM = 3.0; // the chart floor = 3,000 m (the high Andean valleys)
const S = 1.15; // world units per km
const yOf = (km) => (km - FLOOR_KM) * S;

// shape: h = H * (1 - u^a)^b  (a rounds the top, b flares the skirts)
const PEAKS = [
  { name: 'Antisana', km: 5.753, x: -5.6, seed: 4, a: 1.3, b: 1.9, crater: 0 },
  { name: 'Chimborazo', km: 6.263, x: -1.85, seed: 7, a: 1.55, b: 2.1, crater: 0, hero: true },
  { name: 'Cotopaxi', km: 5.897, x: 1.85, seed: 9, a: 1.0, b: 1.25, crater: 0.03 },
  { name: 'Cayambe', km: 5.79, x: 5.6, seed: 12, a: 1.4, b: 2.0, crater: 0 },
];

export function createCompare(labelRoot) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, ASPECT, 0.1, 500);
  camera.setViewOffset(WIDTH, HEIGHT, 0, 150, WIDTH, HEIGHT); // chart sits above the captions

  scene.fog = new THREE.FogExp2('#122038', 0.03);
  scene.add(makeSkyDome({ top: '#060d1c', horizon: '#122038', bottom: '#122038' }));

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(80, 64),
    new THREE.MeshStandardMaterial({ color: '#16233a', roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // lights
  const key = new THREE.DirectionalLight('#ffe0bd', 2.8);
  key.position.set(-6, 9, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 10, bottom: -6, near: 1, far: 40 });
  key.shadow.bias = -0.0008;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#7fb0ff', 2.0);
  rim.position.set(4, 5, -9);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight('#8ea6cc', '#1a140e', 0.7));

  // ---------- grid lines (every 1,000 m) ----------
  const gridMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.13, depthWrite: false });
  const labels = new LabelLayer(labelRoot);
  const gridLabels = [];
  for (let km = 3; km <= 6; km++) {
    const bar = makeBar(new THREE.Vector3(-8.2, yOf(km), -2.6), new THREE.Vector3(8.2, yOf(km), -2.6), 0.018, gridMat);
    scene.add(bar);
    gridLabels.push(
      labels.add(`${fmt(km * 1000)} m`, { cls: 'axis', pos: new THREE.Vector3(-8.35, yOf(km), -2.6) })
    );
  }

  // ---------- mountains ----------
  const mountains = PEAKS.map((p) => {
    const mesh = new THREE.Mesh(
      makeMountainGeometry(p),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.85,
        color: p.hero ? '#ffffff' : '#b9c2d3',
      })
    );
    mesh.position.x = p.x;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.h = yOf(p.km);
    scene.add(mesh);
    const label = labels.add(
      `<span class="peak-name">${p.name}</span><span class="peak-alt"><b class="js-alt">0</b> m</span>`,
      { cls: `peak ${p.hero ? 'peak-hero' : ''}`, pos: new THREE.Vector3(p.x, -0.15, 1.2) }
    );
    return { p, mesh, label, alt: label.el.querySelector('.js-alt') };
  });

  // ---------- record line + "+366 m" bracket ----------
  const gold = new THREE.MeshBasicMaterial({ color: '#f4b942', transparent: true, depthWrite: false, toneMapped: false });
  const dashes = [];
  for (let x = -8.2; x < 8.2; x += 0.42) {
    const d = makeBar(new THREE.Vector3(x, yOf(6.263), 0.3), new THREE.Vector3(x + 0.24, yOf(6.263), 0.3), 0.035, gold);
    d.visible = false;
    scene.add(d);
    dashes.push(d);
  }
  const cot = PEAKS[2];
  const bracket = makeBar(
    new THREE.Vector3(cot.x, yOf(cot.km), 0.3),
    new THREE.Vector3(cot.x, yOf(6.263), 0.3),
    0.05,
    gold
  );
  scene.add(bracket);
  const capTop = makeBar(new THREE.Vector3(cot.x - 0.18, yOf(cot.km), 0.3), new THREE.Vector3(cot.x + 0.18, yOf(cot.km), 0.3), 0.04, gold);
  scene.add(capTop);
  const recordLabel = labels.add('6,263 m', { cls: 'record', pos: new THREE.Vector3(8.3, yOf(6.263), 0.3) });
  const diffLabel = labels.add('+366 m', { cls: 'diff', pos: new THREE.Vector3(cot.x + 0.25, (yOf(cot.km) + yOf(6.263)) / 2, 0.3) });

  const target = new THREE.Vector3();
  function update(t) {
    const p = ease.inOutSine(clamp((t + 0.3) / 3.6));
    camera.position.set(lerp(-1.4, 1.0, p), lerp(3.3, 2.9, p), lerp(21.5, 19.8, p));
    target.set(lerp(-0.3, 0.3, p), 1.9, 0);
    camera.lookAt(target);

    const order = [0.05, 0.5, 0.2, 0.32]; // Chimborazo rises last
    mountains.forEach((m, i) => {
      const a = order[i];
      const g = ease.outCubic(seg(t, a, a + (m.p.hero ? 0.95 : 0.75)));
      // rise out of the floor (the opaque floor hides the part still below y = 0)
      m.mesh.position.y = -(1 - g) * (m.mesh.userData.h + 0.05);
      m.mesh.visible = g > 0.001;
      m.alt.textContent = fmt(m.p.km * 1000 * g);
      m.label.opacity = seg(t, a, a + 0.3);
      m.label.rise = 1 - ease.outCubic(seg(t, a, a + 0.4));
    });
    for (const g of gridLabels) g.opacity = 0.7 * seg(t, 0.0, 0.4);

    const lineP = seg(t, 1.25, 1.85);
    dashes.forEach((d, i) => {
      const k = i / dashes.length;
      d.visible = lineP > k;
    });
    recordLabel.opacity = seg(t, 1.7, 2.0);
    const bp = ease.outCubic(seg(t, 1.8, 2.15));
    bracket.setProgress(bp);
    capTop.visible = bp > 0.01;
    diffLabel.opacity = seg(t, 2.0, 2.3);
    diffLabel.rise = 1 - ease.outCubic(seg(t, 2.0, 2.35));
  }

  return { scene, camera, labels, update };
}

/** Low-poly volcano: a radial grid with a concave profile, noise, and a baked snowcap. */
function makeMountainGeometry({ km, seed, a: pa, b: pb, crater }) {
  const H = yOf(km);
  const R = 2.4;
  const rings = 16, segs = 36;
  const noise = makeNoise2D(seed);
  const rnd = mulberry32(seed);
  const rot = rnd() * Math.PI * 2;
  const verts = [];
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2 + rot + (i % 2) * (Math.PI / segs);
      const r = u * R * (1 + 0.08 * noise(Math.cos(a) * 1.3, Math.sin(a) * 1.3 + u));
      let h = H * Math.pow(1 - Math.pow(u, pa), pb);
      h *= 1 + 0.06 * noise(Math.cos(a) * 2 + u * 3, Math.sin(a) * 2 - u * 2) * Math.sin(Math.PI * u);
      if (crater) h -= H * crater * Math.exp(-((u / 0.06) ** 2));
      if (i === 0) h = H * (1 - crater * 0.6);
      verts.push(new THREE.Vector3(Math.cos(a) * r, Math.max(0, h), Math.sin(a) * r));
    }
  }
  const pos = [];
  const col = [];
  const snow = new THREE.Color('#f2f6fb');
  const rockA = new THREE.Color('#5b4a43');
  const rockB = new THREE.Color('#3c3431');
  const grass = new THREE.Color('#4d4a3a');
  const c = new THREE.Color();
  const snowY = yOf(4.95);
  const idx = (i, j) => i * segs + (((j % segs) + segs) % segs);
  const tri = (a, b, d) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
    const cy = (a.y + b.y + d.y) / 3;
    const k = rnd();
    c.copy(rockA).lerp(rockB, k * 0.6);
    c.lerp(grass, smoothstep(yOf(4.2), 0, cy) * 0.35);
    if (cy > snowY + (k - 0.5) * 0.35) c.copy(snow).multiplyScalar(0.9 + k * 0.1);
    for (let n = 0; n < 3; n++) col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = verts[idx(i, j)], b = verts[idx(i, j + 1)];
      const d = verts[idx(i + 1, j)], e = verts[idx(i + 1, j + 1)];
      if (i > 0) tri(a, b, d); // counter-clockwise seen from outside
      tri(b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
