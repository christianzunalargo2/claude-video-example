// Shot 5 (12–15 s): bonus — Earth's equatorial bulge puts Chimborazo's summit
// farther from the planet's centre than any other point (6,384.4 km vs Everest 6,382.3 km).
// Geometry is exaggerated but consistent: one scale for the bulge and the mountains.
import * as THREE from 'three';
import { clamp, lerp, ease, seg, mulberry32 } from '../util.js';
import { ASPECT, WIDTH, HEIGHT, LabelLayer, makeBar, getGlowTexture } from '../common.js';

const K = 0.014; // world units per km of radius difference (exaggeration)
const A = 1 + K * 21.4; // equatorial radius (polar radius = 1); real difference ≈ 21.4 km
const deg = Math.PI / 180;

/** Point on the visible ellipse at geocentric latitude psi (on the +x side if dir = 1). */
function surface(psi, dir) {
  const r = A / Math.sqrt(Math.cos(psi) ** 2 + (A * Math.sin(psi)) ** 2);
  return { r, v: new THREE.Vector3(dir * Math.cos(psi), Math.sin(psi), 0) };
}

export function createBulge(labelRoot) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03050b');
  const camera = new THREE.PerspectiveCamera(30, ASPECT, 0.1, 500);
  camera.setViewOffset(WIDTH, HEIGHT, -80, 140, WIDTH, HEIGHT);

  // stars
  const rnd = mulberry32(5);
  const starPos = [];
  for (let i = 0; i < 1800; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    starPos.push(Math.cos(a) * s * 120, u * 120, Math.sin(a) * s * 120 - 40);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#9fb6e0', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8 })));

  // ---------- globe ----------
  const globeMat = new THREE.ShaderMaterial({
    uniforms: {
      uRot: { value: 0 },
      uLight: { value: new THREE.Vector3(-0.55, 0.45, 0.7).normalize() },
      uOcean: { value: new THREE.Color('#0f3a66') },
      uDeep: { value: new THREE.Color('#06162b') },
      uGrid: { value: new THREE.Color('#6fb6ff') },
      uEq: { value: new THREE.Color('#f4b942') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vUnit; varying vec3 vN; varying vec3 vView;
      void main() {
        vUnit = normalize(position);
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uRot; uniform vec3 uLight, uOcean, uDeep, uGrid, uEq;
      varying vec3 vUnit; varying vec3 vN; varying vec3 vView;
      float gridLine(float v, float step, float w) {
        float d = abs(fract(v / step + 0.5) - 0.5) * step;
        float aa = fwidth(v) * 1.2;
        return 1.0 - smoothstep(w, w + aa, d);
      }
      void main() {
        float lat = degrees(asin(clamp(vUnit.y, -1.0, 1.0)));
        float lon = degrees(atan(vUnit.z, vUnit.x)) + uRot;
        float diff = clamp(dot(normalize(vN), uLight), 0.0, 1.0);
        vec3 col = mix(uDeep, uOcean, 0.25 + 0.75 * diff);
        float g = max(gridLine(lat, 15.0, 0.18), gridLine(lon, 15.0, 0.18));
        col += uGrid * g * (0.25 + 0.35 * diff);
        float eq = 1.0 - smoothstep(0.45, 0.45 + fwidth(lat) * 1.5, abs(lat));
        col = mix(col, uEq * 1.4, eq);
        float fres = pow(1.0 - max(dot(normalize(vN), vView), 0.0), 3.0);
        col += vec3(0.25, 0.55, 1.0) * fres * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 96), globeMat);
  globe.scale.set(A, 1, A);
  scene.add(globe);
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 48),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vView;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vView;
        void main() {
          float f = pow(clamp(1.0 + dot(normalize(vN), vView) * 1.0, 0.0, 1.0), 4.0);
          gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * f * 1.4, 1.0);
        }`,
    })
  );
  atmo.scale.set(A * 1.06, 1.06, A * 1.06);
  scene.add(atmo);

  const light = new THREE.DirectionalLight('#ffffff', 2.5);
  light.position.set(-3, 2, 4);
  scene.add(light, new THREE.AmbientLight('#7d8db0', 0.6));

  // ---------- diagram overlay (drawn on top of the globe) ----------
  const flat = (color, opacity = 1) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
  const overlay = new THREE.Group();
  overlay.renderOrder = 10;
  scene.add(overlay);
  const onTop = (o) => {
    o.traverse((c) => (c.renderOrder = 10));
    overlay.add(o);
    return o;
  };

  const center = onTop(new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), flat('#ffffff')));
  const centerHalo = onTop(new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: '#9fd0ff', transparent: true, depthTest: false, blending: THREE.AdditiveBlending })));
  centerHalo.scale.set(0.35, 0.35, 1);

  const peaks = {
    everest: { psi: 27.99 * deg, dir: -1, km: 8.849, color: '#e8edf6' },
    chimborazo: { psi: -1.47 * deg, dir: 1, km: 6.263, color: '#f4b942' },
  };
  for (const p of Object.values(peaks)) {
    const s = surface(p.psi, p.dir);
    p.base = s.v.clone().multiplyScalar(s.r);
    p.tip = s.v.clone().multiplyScalar(s.r + K * p.km);
    p.tipR = s.r + K * p.km;
    // the mountain: a small triangle standing on the surface
    const side = new THREE.Vector3(-s.v.y, s.v.x, 0).multiplyScalar(0.055);
    const g = new THREE.BufferGeometry().setFromPoints([
      p.base.clone().add(side).addScaledVector(s.v, -0.01),
      p.tip,
      p.base.clone().sub(side).addScaledVector(s.v, -0.01),
    ]);
    p.spike = onTop(new THREE.Mesh(g, flat(p.color)));
    p.spike.material.side = THREE.DoubleSide;
    p.line = onTop(makeBar(new THREE.Vector3(), p.tip, 0.012, flat(p.color, 0.95)));
  }

  // dashed circle through Everest's summit: Chimborazo pokes out past it
  const arcR = peaks.everest.tipR;
  const arcFrom = Math.PI - peaks.everest.psi; // Everest direction
  const arcTo = peaks.chimborazo.psi; // Chimborazo direction
  const dashes = [];
  const nD = 70;
  for (let i = 0; i < nD; i++) {
    const a0 = lerp(arcFrom, arcTo, i / nD), a1 = lerp(arcFrom, arcTo, (i + 0.55) / nD);
    const d = onTop(
      makeBar(
        new THREE.Vector3(Math.cos(a0) * arcR, Math.sin(a0) * arcR, 0),
        new THREE.Vector3(Math.cos(a1) * arcR, Math.sin(a1) * arcR, 0),
        0.008,
        flat('#ffffff', 0.55)
      )
    );
    d.visible = false;
    dashes.push(d);
  }
  const gapBar = onTop(
    makeBar(
      new THREE.Vector3(Math.cos(arcTo) * arcR, Math.sin(arcTo) * arcR, 0),
      peaks.chimborazo.tip,
      0.03,
      flat('#f4b942')
    )
  );

  // ---------- labels ----------
  const labels = new LabelLayer(labelRoot);
  const L = {
    center: labels.add('Earth’s center', { cls: 'center-note', pos: new THREE.Vector3(0, 0, 0) }),
    equator: labels.add('Equator', { cls: 'side-left eq-note', pos: new THREE.Vector3(-A - 0.03, 0, 0) }),
    everest: labels.add('<span class="pin-kicker">Everest · 8,849 m tall</span><span class="pin-value">6,382.3 km</span>', {
      cls: 'side-left side-white',
      pos: peaks.everest.tip.clone().addScaledVector(peaks.everest.tip.clone().normalize(), 0.03),
    }),
    chimborazo: labels.add('<span class="pin-kicker">Chimborazo · 6,263 m tall</span><span class="pin-value">6,384.4 km</span>', {
      cls: 'side-right side-gold',
      pos: peaks.chimborazo.tip.clone().addScaledVector(peaks.chimborazo.tip.clone().normalize(), 0.03),
    }),
    gap: labels.add('+2.1 km farther out', { cls: 'gap-note', pos: peaks.chimborazo.tip.clone().add(new THREE.Vector3(-0.02, 0.07, 0)) }),
  };

  function update(t) {
    const p = ease.inOutSine(clamp((t + 0.3) / 3.6));
    camera.position.set(0, 0, lerp(8.1, 7.6, p));
    camera.lookAt(0, 0, 0);
    globeMat.uniforms.uRot.value = t * 14;

    const c = seg(t, 0.05, 0.35);
    center.material.opacity = c;
    centerHalo.material.opacity = c * 0.8;
    L.center.opacity = c * 0.9;
    L.equator.opacity = seg(t, 0.1, 0.4) * 0.9;

    const e = ease.outCubic(seg(t, 0.2, 0.7));
    peaks.everest.line.setProgress(e);
    peaks.everest.spike.material.opacity = seg(t, 0.1, 0.35);
    L.everest.opacity = seg(t, 0.55, 0.85);
    L.everest.rise = 1 - ease.outCubic(seg(t, 0.55, 0.9));

    const ch = ease.outCubic(seg(t, 0.75, 1.25));
    peaks.chimborazo.line.setProgress(ch);
    peaks.chimborazo.spike.material.opacity = seg(t, 0.6, 0.85);
    L.chimborazo.opacity = seg(t, 1.1, 1.4);
    L.chimborazo.rise = 1 - ease.outCubic(seg(t, 1.1, 1.45));

    const arc = seg(t, 1.35, 1.9);
    dashes.forEach((d, i) => (d.visible = arc > i / nD));
    gapBar.setProgress(ease.outCubic(seg(t, 1.9, 2.15)));
    gapBar.visible = t > 1.9;
    L.gap.opacity = seg(t, 2.0, 2.3);
    L.gap.rise = 1 - ease.outCubic(seg(t, 2.0, 2.35));
  }

  return { scene, camera, labels, update };
}
