// Shot 3 (6–9 s): a cut-away block of the Ecuadorian margin.
// The Nazca plate slides under South America, melts at depth and feeds the volcano.
import * as THREE from 'three';
import { smoothstep, clamp, lerp, ease, seg } from '../util.js';
import { makeSkyDome, ASPECT, WIDTH, HEIGHT, LabelLayer, getGlowTexture, makeStrataTexture } from '../common.js';

const D = 4; // block depth (z)
const FRONT = D / 2;
const X0 = -9.5, X1 = 9.5;
const VOLCANO_X = 2.25;

function sampleCurve(ctrl, n) {
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
  return { curve, pts: curve.getSpacedPoints(n) };
}
function interpY(pts, x) {
  if (x <= pts[0].x) return pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x >= x) {
      const a = pts[i - 1], b = pts[i];
      return lerp(a.y, b.y, (x - a.x) / (b.x - a.x || 1));
    }
  }
  return pts[pts.length - 1].y;
}

export function createTectonics(labelRoot) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, ASPECT, 0.5, 500);
  camera.setViewOffset(WIDTH, HEIGHT, 0, 105, WIDTH, HEIGHT); // nudge content up, captions live below
  scene.add(makeSkyDome({ top: '#050b18', horizon: '#14223a', bottom: '#070b14' }));

  // ---------- geometry of the margin ----------
  const T = 0.75; // slab thickness
  const slab = sampleCurve(
    [[X0, -1.33], [-5, -1.33], [-3, -1.47], [-1.3, -2.0], [0.9, -3.0], [3.5, -4.3], [6.2, -5.6], [X1, -6.95]],
    160
  );
  const slabTop = [], slabBot = [];
  for (let i = 0; i < slab.pts.length; i++) {
    const tan = slab.curve.getTangentAt(i / (slab.pts.length - 1));
    const nrm = new THREE.Vector2(-tan.y, tan.x).normalize(); // points up-left
    const p = slab.pts[i];
    slabTop.push(new THREE.Vector2(p.x + nrm.x * T * 0.5, p.y + nrm.y * T * 0.5));
    slabBot.push(new THREE.Vector2(p.x - nrm.x * T * 0.5, p.y - nrm.y * T * 0.5));
  }
  const slabTopY = (x) => interpY(slabTop, x);
  const XT = -2.75; // trench

  const topCtrl = sampleCurve(
    [[XT, slabTopY(XT)], [-1.9, -0.45], [-1.15, 0.0], [0.4, 0.15], [1.4, 0.75], [VOLCANO_X, 1.3], [3.0, 1.0], [3.7, 0.85], [4.9, 1.2], [6.0, 0.6], [7.4, 0.3], [X1, 0.22]],
    140
  );
  const crustTopY = (x) => interpY(topCtrl.pts, x);
  const mohoY = (x) => -1.45 - 1.6 * smoothstep(0.3, 3.6, x) * (1 - 0.45 * smoothstep(4.2, 9.0, x));
  const crustBotY = (x) => Math.max(slabTopY(x), mohoY(x));

  const extrude = (shape, depth = D, z = 0) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
    g.translate(0, 0, -depth / 2 + z);
    return g;
  };

  // continental crust
  const crustShape = new THREE.Shape();
  topCtrl.pts.forEach((p, i) => (i ? crustShape.lineTo(p.x, p.y) : crustShape.moveTo(p.x, p.y)));
  for (let x = X1; x >= XT; x -= 0.1) crustShape.lineTo(x, crustBotY(x));
  const strata = makeStrataTexture(['#b88a5a', '#a4774c', '#c69a68', '#8f6642', '#b0845a', '#9c7048'], { bands: 26 });
  strata.repeat.set(0.25, 1 / 5);
  const crustGeo = extrude(crustShape);
  paintByHeight(crustGeo, (x, y) => {
    const c = new THREE.Color('#6e7a46').lerp(new THREE.Color('#7d5f45'), smoothstep(0.3, 0.9, y));
    return c.lerp(new THREE.Color('#f2f5fa'), smoothstep(1.05, 1.22, y));
  });
  const crust = new THREE.Mesh(crustGeo, [
    new THREE.MeshStandardMaterial({ map: strata, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  ]);
  scene.add(crust);

  // oceanic (Nazca) slab
  const slabShape = new THREE.Shape();
  slabTop.forEach((p, i) => (i ? slabShape.lineTo(p.x, p.y) : slabShape.moveTo(p.x, p.y)));
  for (let i = slabBot.length - 1; i >= 0; i--) slabShape.lineTo(slabBot[i].x, slabBot[i].y);
  const slabGeo = extrude(slabShape);
  paintByHeight(slabGeo, (x, y) => {
    const k = clamp((slabTopY(x) - y) / T);
    return new THREE.Color('#4f6f96').lerp(new THREE.Color('#1b2a40'), k);
  });
  scene.add(new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));

  // mantle: slightly shallower block sitting just behind the plates' front faces
  const mantleShape = new THREE.Shape();
  mantleShape.moveTo(X0 + 0.04, -7.6);
  mantleShape.lineTo(X1 - 0.04, -7.6);
  mantleShape.lineTo(X1 - 0.04, -1.4);
  mantleShape.lineTo(X0 + 0.04, -1.4);
  const mantleTex = makeGradientTexture(['#f08a2c', '#c4471d', '#7a2412', '#4a170d']);
  mantleTex.repeat.set(1, 1 / 6.2);
  mantleTex.offset.set(0, 7.6 / 6.2);
  const mantle = new THREE.Mesh(
    extrude(mantleShape, D - 0.06),
    new THREE.MeshStandardMaterial({ map: mantleTex, emissiveMap: mantleTex, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 1 })
  );
  scene.add(mantle);

  // ocean water
  const waterShape = new THREE.Shape();
  waterShape.moveTo(X0, 0);
  waterShape.lineTo(-1.15, 0);
  for (let x = -1.15; x >= XT; x -= 0.05) waterShape.lineTo(x, crustTopY(x));
  for (let x = XT; x >= X0; x -= 0.1) waterShape.lineTo(x, slabTopY(x));
  const water = new THREE.Mesh(
    extrude(waterShape, D - 0.02),
    new THREE.MeshStandardMaterial({ color: '#2f86c9', transparent: true, opacity: 0.5, roughness: 0.15, depthWrite: false })
  );
  water.renderOrder = 2;
  scene.add(water);

  // ---------- volcano (half cone cut by the front face) ----------
  const vBase = crustTopY(VOLCANO_X);
  // lathe profiles run bottom -> top so the faces point outwards
  const prof = [[1.7, -0.25], [1.3, 0.12], [0.95, 0.38], [0.6, 0.72], [0.3, 1.04], [0.14, 1.15], [0.001, 1.08]].map(
    ([r, y]) => new THREE.Vector2(r, y)
  );
  const cone = new THREE.LatheGeometry(prof, 40, Math.PI / 2, Math.PI);
  paintByHeight(cone, (x, y) => new THREE.Color('#6b5850').lerp(new THREE.Color('#f4f7fb'), smoothstep(0.62, 0.75, y)));
  const volcano = new THREE.Group();
  volcano.position.set(VOLCANO_X, vBase, FRONT);
  volcano.add(new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })));
  const cut = new THREE.Shape();
  cut.moveTo(prof[0].x, prof[0].y);
  prof.forEach((p) => cut.lineTo(p.x, p.y));
  for (let i = prof.length - 1; i >= 0; i--) cut.lineTo(-prof[i].x, prof[i].y);
  const cutMesh = new THREE.Mesh(new THREE.ShapeGeometry(cut), new THREE.MeshStandardMaterial({ map: strata, color: '#9d8a80', roughness: 0.95 }));
  cutMesh.position.z = -0.006;
  volcano.add(cutMesh);
  scene.add(volcano);

  // a second, distant volcano on the eastern ridge to suggest the whole arc
  const cone2 = new THREE.LatheGeometry(prof, 40);
  paintByHeight(cone2, (x, y) => new THREE.Color('#6b5850').lerp(new THREE.Color('#f4f7fb'), smoothstep(0.62, 0.75, y)));
  const v2 = new THREE.Mesh(cone2, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  v2.position.set(4.9, crustTopY(4.9) - 0.1, -0.6);
  v2.scale.setScalar(0.72);
  scene.add(v2);

  // ---------- magma ----------
  const additive = (color, opacity = 1) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const chamberY = -0.7;
  const chamber = new THREE.Mesh(new THREE.CircleGeometry(1, 40), additive('#ff8a2a', 0.95));
  chamber.scale.set(0.62, 0.26, 1);
  chamber.position.set(VOLCANO_X, chamberY, FRONT + 0.012);
  scene.add(chamber);
  const conduitTop = vBase + 1.08;
  const conduit = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 1), additive('#ffb14a'));
  conduit.position.set(VOLCANO_X, 0, FRONT + 0.014);
  scene.add(conduit);

  const glowTex = getGlowTexture();
  const spriteMat = (color, opacity = 1) =>
    new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const chamberGlow = new THREE.Sprite(spriteMat('#ff7a1f', 0.8));
  chamberGlow.scale.set(2.4, 1.3, 1);
  chamberGlow.position.copy(chamber.position).setZ(FRONT + 0.05);
  scene.add(chamberGlow);
  const craterGlow = new THREE.Sprite(spriteMat('#ff9a3a', 0.0));
  craterGlow.position.set(VOLCANO_X, conduitTop + 0.08, FRONT + 0.1);
  scene.add(craterGlow);

  const meltStart = new THREE.Vector3(3.25, slabTopY(3.25) + 0.08, FRONT + 0.03);
  const particles = [];
  for (let i = 0; i < 30; i++) {
    const s = new THREE.Sprite(spriteMat(i % 3 ? '#ff8c2e' : '#ffd36a'));
    s.userData.phase = i / 30;
    s.userData.wob = ((i * 7919) % 100) / 100;
    scene.add(s);
    particles.push(s);
  }
  function magmaPath(u, wob, out) {
    if (u < 0.6) {
      const k = u / 0.6;
      out.set(
        lerp(meltStart.x, VOLCANO_X + 0.05, k) + Math.sin(k * 9 + wob * 6) * 0.16 * (1 - k),
        lerp(meltStart.y, chamberY, ease.inOutSine(k)),
        FRONT + 0.03
      );
    } else {
      const k = (u - 0.6) / 0.4;
      out.set(VOLCANO_X + Math.sin(k * 12 + wob * 6) * 0.015, lerp(chamberY, conduitTop, k), FRONT + 0.03);
    }
    return out;
  }

  // ---------- subduction chevrons and plate arrow ----------
  const chevShape = new THREE.Shape();
  chevShape.moveTo(-0.16, 0.12);
  chevShape.lineTo(0.02, 0.0);
  chevShape.lineTo(-0.16, -0.12);
  chevShape.lineTo(-0.08, 0.0);
  const chevGeo = new THREE.ShapeGeometry(chevShape);
  const chevrons = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, depthWrite: false, toneMapped: false }));
    m.userData.phase = i / 14;
    scene.add(m);
    chevrons.push(m);
  }
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-1.3, 0.16);
  arrowShape.lineTo(0.5, 0.16);
  arrowShape.lineTo(0.5, 0.42);
  arrowShape.lineTo(1.2, 0);
  arrowShape.lineTo(0.5, -0.42);
  arrowShape.lineTo(0.5, -0.16);
  arrowShape.lineTo(-1.3, -0.16);
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })
  );
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.set(-6.2, slabTopY(-6) + 0.03, 0.2);
  arrow.renderOrder = 1; // drawn before the water so it reads as submerged
  scene.add(arrow);

  // ---------- lights ----------
  const key = new THREE.DirectionalLight('#fff0dc', 2.6);
  key.position.set(-6, 9, 12);
  scene.add(key);
  scene.add(new THREE.HemisphereLight('#a9c1e6', '#2a1a10', 0.9));

  // ---------- labels ----------
  const labels = new LabelLayer(labelRoot);
  const L = {
    ocean: labels.add('Pacific Ocean', { cls: 'tag tag-water', pos: new THREE.Vector3(-6.6, 0.0, FRONT) }),
    nazca: labels.add('Nazca plate', { cls: 'tag tag-in', pos: new THREE.Vector3(-6.3, -2.15, FRONT) }),
    sam: labels.add('South American plate', { cls: 'tag tag-in', pos: new THREE.Vector3(6.6, -0.9, FRONT) }),
    mantle: labels.add('Mantle', { cls: 'tag tag-in', pos: new THREE.Vector3(-5.2, -4.4, FRONT) }),
    magma: labels.add('Magma rises', { cls: 'tag tag-hot', pos: new THREE.Vector3(4.7, -2.6, FRONT) }),
    volcano: labels.add('<span class="pin-kicker">Western Andes</span><span class="pin-value">Chimborazo</span>', {
      cls: 'side-left side-gold lift',
      pos: new THREE.Vector3(VOLCANO_X - 0.25, conduitTop, FRONT),
    }),
  };
  const labelTimes = { ocean: 0.15, nazca: 0.3, sam: 0.5, mantle: 0.7, magma: 1.05, volcano: 1.6 };

  const target = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  function update(t) {
    const p = ease.inOutSine(clamp((t + 0.3) / 3.6));
    camera.position.set(lerp(-4.8, 3.2, p), lerp(6.0, 4.8, p), lerp(28.0, 26.5, p));
    target.set(lerp(-0.2, 0.5, p), -2.3, 0);
    camera.lookAt(target);

    // plates creep toward the trench
    chevrons.forEach((m) => {
      const u = (m.userData.phase + t * 0.07) % 1;
      const pt = slab.curve.getPointAt(u);
      const tan = slab.curve.getTangentAt(u);
      m.position.set(pt.x, pt.y, FRONT + 0.016);
      m.rotation.z = Math.atan2(tan.y, tan.x);
      m.material.opacity = 0.85 * smoothstep(0, 0.06, u) * (1 - smoothstep(0.85, 1, u));
    });
    arrow.position.x = -6.4 + ((t * 0.5) % 1) * 0.5;
    arrow.material.opacity = 0.9 * seg(t, 0.1, 0.4);

    // magma: rises from the slab into a chamber, then up the conduit
    const flow = seg(t, 0.55, 1.4);
    particles.forEach((s) => {
      const u = (s.userData.phase + t * 0.42) % 1;
      magmaPath(u, s.userData.wob, tmp);
      s.position.copy(tmp);
      const size = 0.24 + 0.1 * Math.sin(u * 20 + s.userData.wob * 9);
      s.scale.set(size, size, 1);
      const reach = flow * 1.15; // particles appear progressively along the path
      s.material.opacity = (u < reach ? 1 : 0) * smoothstep(0, 0.05, u) * (1 - smoothstep(0.93, 1, u));
    });
    const chamberOn = seg(t, 1.0, 1.4);
    chamber.material.opacity = 0.9 * chamberOn;
    chamberGlow.material.opacity = 0.7 * chamberOn * (0.85 + 0.15 * Math.sin(t * 6));
    const conduitP = ease.outCubic(seg(t, 1.2, 1.7));
    const len = (conduitTop - chamberY) * conduitP;
    conduit.scale.y = Math.max(len, 1e-3);
    conduit.position.y = chamberY + len / 2;
    conduit.visible = conduitP > 0.01;
    const erupt = seg(t, 1.65, 1.95);
    const pulse = 0.75 + 0.25 * Math.sin(t * 9);
    craterGlow.material.opacity = erupt * pulse;
    craterGlow.scale.set(0.8 + erupt * 0.5, 0.8 + erupt * 0.5, 1);

    for (const [k, t0] of Object.entries(labelTimes)) {
      L[k].opacity = seg(t, t0, t0 + 0.3);
      L[k].rise = 1 - ease.outCubic(seg(t, t0, t0 + 0.35));
    }
  }

  return { scene, camera, labels, update };
}

/** Bake per-vertex colours from a (x, y) -> Color function. */
function paintByHeight(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Vertical gradient texture: stops listed bottom (v=0) to top (v=1). */
function makeGradientTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 256, 0, 0);
  stops.forEach((s, i) => grd.addColorStop(i / (stops.length - 1), s));
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
