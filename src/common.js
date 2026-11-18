import * as THREE from 'three';

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const ASPECT = WIDTH / HEIGHT;

/** Large inverted sphere with a vertical gradient and an optional sun glow. */
export function makeSkyDome({
  top = '#0b1830',
  horizon = '#33415c',
  bottom = '#05070d',
  sunDir = new THREE.Vector3(0, 0.2, -1),
  sunColor = '#ffffff',
  sunStrength = 0,
  radius = 300,
} = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uHorizon: { value: new THREE.Color(horizon) },
      uBottom: { value: new THREE.Color(bottom) },
      uSunDir: { value: sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(sunColor) },
      uSunStrength: { value: sunStrength },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // keep at far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uBottom, uSunColor, uSunDir;
      uniform float uSunStrength;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0
          ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.65, h), 0.55))
          : mix(uHorizon, uBottom, smoothstep(0.0, 0.25, -h));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * uSunStrength * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

let glowTex = null;
/** Soft radial sprite used for magma, sparks and halos. */
export function getGlowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/**
 * A thin flat bar between two points in the XY plane (a "thick line").
 * Returns a mesh whose scale.x controls how much of the segment is drawn (0..1).
 */
export function makeBar(from, to, width, material) {
  const geo = new THREE.PlaneGeometry(1, width);
  geo.translate(0.5, 0, 0);
  const mesh = new THREE.Mesh(geo, material);
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const pivot = new THREE.Group();
  pivot.position.copy(from);
  pivot.rotation.z = Math.atan2(dy, dx);
  mesh.scale.x = len;
  pivot.add(mesh);
  pivot.userData = { mesh, len };
  pivot.setProgress = (p) => {
    mesh.scale.x = Math.max(1e-4, len * p);
  };
  return pivot;
}

/**
 * HTML labels pinned to 3D points. Each shot owns a LabelLayer; main.js projects
 * the anchors with the shot's camera every frame.
 */
export class LabelLayer {
  constructor(root) {
    this.root = document.createElement('div');
    this.root.className = 'label-layer';
    root.appendChild(this.root);
    this.items = [];
  }
  add(html, { cls = '', pos = new THREE.Vector3() } = {}) {
    const el = document.createElement('div');
    el.className = `lbl ${cls}`;
    el.innerHTML = `<div class="lbl-inner"><div class="lbl-box">${html}</div></div>`;
    this.root.appendChild(el);
    const item = { el, pos: pos.clone(), opacity: 0, rise: 0, inner: el.firstChild };
    this.items.push(item);
    return item;
  }
  layout(camera, weight) {
    const v = new THREE.Vector3();
    this.root.style.opacity = weight.toFixed(3);
    this.root.style.display = weight <= 0.001 ? 'none' : 'block';
    if (weight <= 0.001) return;
    for (const it of this.items) {
      v.copy(it.pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * WIDTH;
      const y = (-v.y * 0.5 + 0.5) * HEIGHT;
      it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      it.el.style.opacity = it.opacity.toFixed(3);
      it.inner.style.transform = `translateY(${(it.rise * 14).toFixed(1)}px)`;
      if (it.column != null) it.el.style.setProperty('--lead', `${Math.max(40, it.column - x).toFixed(1)}px`);
      it.el.style.visibility = it.opacity <= 0.001 || v.z > 1 ? 'hidden' : 'visible';
    }
  }
}

/** Canvas texture of soft horizontal bands — used for rock strata. */
export function makeStrataTexture(colors, { bands = 24, seed = 3, noise = 0.12 } = {}) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d');
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const h = c.height / bands;
  for (let i = 0; i < bands; i++) {
    const base = new THREE.Color(colors[i % colors.length]);
    const k = 1 + (rnd() - 0.5) * 2 * noise;
    base.multiplyScalar(k);
    g.fillStyle = `#${base.getHexString()}`;
    g.fillRect(0, i * h, c.width, h + 1);
    // a darker hairline between beds
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, i * h, c.width, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
