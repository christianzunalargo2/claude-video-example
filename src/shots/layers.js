// Shot 4 (9–12 s): a cut-away of Chimborazo growing as three stacked edifices
// (Basal ~120–60 ka, Intermediate ~60–35 ka, Young Cone = today's Whymper summit).
import * as THREE from 'three';
import { smoothstep, clamp, lerp, ease, seg, fmt } from '../util.js';
import { makeSkyDome, ASPECT, WIDTH, HEIGHT, LabelLayer, makeStrataTexture } from '../common.js';

const GAP = (100 * Math.PI) / 180; // the slice cut out of the mountain
const PHI_A = Math.PI / 2 + GAP / 2; // solid runs from PHI_A ...
const PHI_B = Math.PI / 2 - GAP / 2 + Math.PI * 2; // ... to PHI_B (wrapping round the back)
const BASE_Y = -0.9;
const SNOW_Y = 2.3;

const LAYERS = [
  { key: 'base', R: 8.6, color: '#3d332e', T: () => -BASE_Y, wall: true },
  { key: 'ch1', R: 7.0, color: '#86452f', T: (r) => 1.5 * Math.pow(1 - smoothstep(0, 7.0, r), 1.15) },
  { key: 'ch2', R: 4.3, color: '#b07a45', T: (r) => 0.95 * Math.pow(clamp(1 - (r / 4.3) ** 2), 1.4) },
  { key: 'ch3', R: 2.3, color: '#7c7d84', T: (r) => 0.62 * Math.pow(clamp(1 - (r / 2.3) ** 2), 1.25) },
];

export function createLayers(labelRoot) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, ASPECT, 0.5, 500);
  camera.setViewOffset(WIDTH, HEIGHT, 230, 170, WIDTH, HEIGHT);
  scene.add(makeSkyDome({ top: '#060c1a', horizon: '#111d31', bottom: '#111d31' }));
  scene.fog = new THREE.FogExp2('#111d31', 0.022);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: '#152238', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = BASE_Y - 0.02;
  floor.receiveShadow = true;
  scene.add(floor);

  const key = new THREE.DirectionalLight('#ffe6c8', 2.9);
  key.position.set(-7, 10, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
  key.shadow.bias = -0.0008;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#86aef5', 1.6);
  rim.position.set(6, 5, -8);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight('#a8bde0', '#2a2018', 0.75));

  const stripes = makeStrataTexture(['#ffffff', '#d9d9d9', '#f2f2f2', '#c4c4c4', '#e6e6e6'], { bands: 10, noise: 0.06 });

  const NR = 48; // radial samples
  const NP = 120; // angular samples
  const layers = LAYERS.map((L, k) => {
    const rs = Array.from({ length: NR + 1 }, (_, i) => (i / NR) * L.R);
    // outer surface
    const outer = new THREE.BufferGeometry();
    const op = new Float32Array((NR + 1) * (NP + 1) * 3);
    const idx = [];
    for (let i = 0; i < NR; i++)
      for (let j = 0; j < NP; j++) {
        const a = i * (NP + 1) + j, b = a + 1, c = a + NP + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    outer.setIndex(idx);
    outer.setAttribute('position', new THREE.BufferAttribute(op, 3));
    outer.setAttribute('color', new THREE.BufferAttribute(new Float32Array(op.length), 3));
    const outerMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: (LAYERS.length - k) * 1.5,
      polygonOffsetUnits: (LAYERS.length - k) * 6,
    });
    const outerMesh = new THREE.Mesh(outer, outerMat);
    outerMesh.castShadow = outerMesh.receiveShadow = true;
    scene.add(outerMesh);

    // the two cut faces (+ the basement's outer wall)
    const tex = stripes.clone();
    tex.repeat.set(1, k === 0 ? 1.5 : 1);
    const cutMat = new THREE.MeshStandardMaterial({ map: tex, color: L.color, roughness: 0.95, side: THREE.DoubleSide });
    const faces = [PHI_A, PHI_B].map((phi) => {
      const g = new THREE.BufferGeometry();
      const p = new Float32Array((NR + 1) * 2 * 3);
      const uv = new Float32Array((NR + 1) * 2 * 2);
      const ix = [];
      for (let i = 0; i <= NR; i++) {
        uv.set([i / NR, 0, i / NR, 1], i * 4);
        if (i < NR) ix.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      }
      g.setIndex(ix);
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const n = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi)); // plane normal
      const nr = new Float32Array(p.length);
      for (let i = 0; i < nr.length; i += 3) nr.set([n.x, n.y, n.z], i);
      g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
      const m = new THREE.Mesh(g, cutMat);
      m.castShadow = true;
      scene.add(m);
      return { g, phi };
    });
    let wall = null;
    if (L.wall) {
      wall = new THREE.Mesh(
        new THREE.CylinderGeometry(L.R, L.R, -BASE_Y, NP, 1, true, Math.PI / 2 - PHI_B + Math.PI * 2, PHI_B - PHI_A),
        new THREE.MeshStandardMaterial({ color: '#2c2522', roughness: 1 })
      );
      wall.position.y = BASE_Y / 2;
      scene.add(wall);
    }
    return { L, k, rs, outer, outerMesh, faces, grow: k === 0 ? 1 : 0 };
  });

  // glowing feeder conduit along the axis, drawn on both cut faces
  const conduitMat = new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const conduits = [PHI_A, PHI_B].map((phi) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 1), conduitMat);
    m.rotation.y = -phi;
    m.position.set(Math.cos(phi) * 0.07, 0, Math.sin(phi) * 0.07);
    m.position.addScaledVector(new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi)), phi === PHI_A ? -0.012 : 0.012);
    scene.add(m);
    return m;
  });

  const snowC = new THREE.Color('#f4f7fb');
  const tmpC = new THREE.Color();
  function rebuild(snowAmt) {
    for (const layer of layers) {
      const { L, k, rs, outer, faces, grow } = layer;
      const base = (r) => {
        let y = BASE_Y;
        for (let j = 0; j < k; j++) if (r <= LAYERS[j].R) y += LAYERS[j].T(r) * layers[j].grow;
        return y;
      };
      const top = (r) => base(r) + (r <= L.R ? L.T(r) * grow : 0);
      layer.outerMesh.visible = grow > 0.005;
      const pos = outer.attributes.position.array;
      const col = outer.attributes.color.array;
      const c0 = new THREE.Color(L.color);
      for (let i = 0; i <= NR; i++) {
        const r = rs[i];
        const y = top(r) + (k === 0 ? 0 : 0.002);
        for (let j = 0; j <= NP; j++) {
          const phi = lerp(PHI_A, PHI_B, j / NP);
          const o = (i * (NP + 1) + j) * 3;
          pos[o] = Math.cos(phi) * r;
          pos[o + 1] = y;
          pos[o + 2] = Math.sin(phi) * r;
          tmpC.copy(c0).multiplyScalar(0.92 + 0.16 * Math.sin(phi * 23 + r * 3.1) * Math.sin(r * 5.3));
          if (k === 3) tmpC.lerp(snowC, snowAmt * smoothstep(SNOW_Y - 0.05, SNOW_Y + 0.15, y + 0.06 * Math.sin(phi * 9)));
          col[o] = tmpC.r;
          col[o + 1] = tmpC.g;
          col[o + 2] = tmpC.b;
        }
      }
      outer.attributes.position.needsUpdate = true;
      outer.attributes.color.needsUpdate = true;
      outer.computeVertexNormals();
      for (const f of faces) {
        const p = f.g.attributes.position.array;
        const cx = Math.cos(f.phi), cz = Math.sin(f.phi);
        for (let i = 0; i <= NR; i++) {
          const r = rs[i];
          const yb = base(r), yt = Math.max(top(r), yb + 1e-4);
          p.set([cx * r, yb, cz * r, cx * r, yt, cz * r], i * 6);
        }
        f.g.attributes.position.needsUpdate = true;
        f.g.computeBoundingSphere();
      }
      outer.computeBoundingSphere();
    }
  }

  // ---------- labels ----------
  const labels = new LabelLayer(labelRoot);
  const mkLayerLabel = (num, title, sub) =>
    labels.add(`<span class="co-num">${num}</span><span class="co-text"><b>${title}</b><span>${sub}</span></span>`, { cls: 'callout' });
  const lab = {
    ch1: mkLayerLabel('1', 'Basal edifice', '120,000–60,000 years ago'),
    ch2: mkLayerLabel('2', 'Intermediate edifice', '60,000–35,000 years ago'),
    ch3: mkLayerLabel('3', 'Young cone', 'today’s Whymper summit'),
  };
  for (const l of Object.values(lab)) l.column = 1380;
  const summit = labels.add('<span class="pin-kicker">Summit</span><span class="pin-value"><b class="js-alt">0</b> m</span>', {
    cls: 'pin pin-gold',
    pos: new THREE.Vector3(0, 0, 0),
  });
  const altEl = summit.el.querySelector('.js-alt');

  const target = new THREE.Vector3();
  const anchorFor = (k, frac) => {
    const L = LAYERS[k];
    const r = L.R * frac;
    let yb = BASE_Y;
    for (let j = 0; j < k; j++) if (r <= LAYERS[j].R) yb += LAYERS[j].T(r) * layers[j].grow;
    const yt = yb + L.T(r) * layers[k].grow;
    // on the cut face at PHI_B (the one facing right on screen)
    return new THREE.Vector3(Math.cos(PHI_B) * r, (yb + yt) / 2, Math.sin(PHI_B) * r);
  };

  function update(t) {
    const p = ease.inOutSine(clamp((t + 0.3) / 3.6));
    const az = Math.PI / 2 + lerp(0.32, -0.12, p);
    const dist = lerp(26, 23.5, p);
    camera.position.set(Math.cos(az) * dist, lerp(9.5, 8.0, p), Math.sin(az) * dist);
    target.set(0, lerp(0.9, 1.2, p), 0);
    camera.lookAt(target);

    const times = { ch1: [0.05, 0.85], ch2: [0.75, 1.45], ch3: [1.35, 2.05] };
    layers[1].grow = ease.inOutCubic(seg(t, ...times.ch1));
    layers[2].grow = ease.inOutCubic(seg(t, ...times.ch2));
    layers[3].grow = ease.inOutCubic(seg(t, ...times.ch3));
    const snowAmt = seg(t, 1.85, 2.35);
    rebuild(snowAmt);

    let topY = BASE_Y;
    for (let k = 1; k < layers.length; k++) topY += LAYERS[k].T(0) * layers[k].grow;
    for (const c of conduits) {
      const h = topY - BASE_Y;
      c.scale.y = Math.max(h, 1e-3);
      c.position.y = BASE_Y + h / 2;
    }
    conduitMat.opacity = 0.75 + 0.25 * Math.sin(t * 7);

    const fracs = { ch1: 0.5, ch2: 0.42, ch3: 0.3 };
    ['ch1', 'ch2', 'ch3'].forEach((key, i) => {
      const [a] = times[key];
      lab[key].pos.copy(anchorFor(i + 1, fracs[key]));
      lab[key].opacity = seg(t, a + 0.15, a + 0.45);
      lab[key].rise = 1 - ease.outCubic(seg(t, a + 0.15, a + 0.5));
    });

    summit.pos.set(0, topY + 0.08, 0);
    const s = seg(t, 1.95, 2.3);
    summit.opacity = s;
    summit.rise = 1 - ease.outCubic(s);
    altEl.textContent = fmt(6263 * ease.outExpo(seg(t, 1.95, 2.45)));
  }

  return { scene, camera, labels, update };
}
