import * as THREE from './vendor/three/three.module.min.js';

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ======================= Earth ======================= */
function lonLatToRot(lon, lat) {
  // SphereGeometry maps texture u=(lon+180)/360 to phi = u*2PI; vertex x=-cos(phi), z=sin(phi).
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const az = Math.atan2(-Math.cos(phi), Math.sin(phi));
  return { y: -az, x: (lat * Math.PI) / 180 };
}

function createEarth(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x020403, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  camera.position.set(0, 0, 4.4);

  const tilt = new THREE.Group();      // latitude
  const spin = new THREE.Group();      // longitude
  tilt.add(spin);
  scene.add(tilt);

  const loader = new THREE.TextureLoader();
  const load = url => new Promise(res => loader.load(url, t => { t.anisotropy = 8; res(t); }, undefined, () => res(null)));
  const sunDir = new THREE.Vector3(0.62, 0.28, 0.73).normalize();

  const earthMat = new THREE.ShaderMaterial({
    uniforms: { dayTex: { value: null }, nightTex: { value: null }, waterTex: { value: null }, sunDir: { value: sunDir } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position,1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D dayTex; uniform sampler2D nightTex; uniform sampler2D waterTex; uniform vec3 sunDir;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 n = normalize(vN);
        float d = dot(n, sunDir);
        float dayMix = smoothstep(-0.18, 0.22, d);
        vec3 day = texture2D(dayTex, vUv).rgb;
        day = mix(vec3(dot(day, vec3(0.299,0.587,0.114))), day, 1.12);
        vec3 night = texture2D(nightTex, vUv).rgb;
        night = pow(night, vec3(1.35)) * vec3(1.0, 0.78, 0.48) * 2.1;
        vec3 col = mix(night, day * (0.18 + 0.95 * max(d, 0.0)), dayMix);
        float w = texture2D(waterTex, vUv).r;
        vec3 r = reflect(-sunDir, n);
        float spec = pow(max(dot(r, normalize(vV)), 0.0), 28.0) * w * 0.55 * dayMix;
        col += vec3(0.85, 0.92, 1.0) * spec;
        float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 3.2);
        col += vec3(0.32, 0.62, 1.0) * rim * (0.15 + 0.85 * smoothstep(-0.3, 0.4, d)) * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 120), earthMat);
  spin.add(earth);

  const cloudMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { tex: { value: null }, sunDir: { value: sunDir } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `uniform sampler2D tex; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN;
      void main(){ float a = texture2D(tex, vUv).r; float l = smoothstep(-0.2, 0.35, dot(normalize(vN), sunDir));
        gl_FragColor = vec4(vec3(1.0) * (0.08 + 0.92 * l), a * (0.12 + 0.68 * l)); }`
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.007, 128, 96), cloudMat);
  spin.add(clouds);

  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.09, 96, 72), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { sunDir: { value: sunDir } },
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(normalMatrix*normal); vW = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
      void main(){ float i = pow(max(0.0, 0.72 - dot(vN, vec3(0.0,0.0,1.0))), 3.4);
        float l = 0.25 + 0.75 * smoothstep(-0.4, 0.5, dot(vW, sunDir));
        gl_FragColor = vec4(0.30, 0.62, 1.0, 1.0) * i * 2.4 * l; }`
  }));
  scene.add(atmo);

  // stars
  const N = 4200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = 70 + Math.random() * 30, s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    const b = 0.35 + Math.pow(Math.random(), 3) * 0.65, warm = Math.random() < 0.2;
    col.set([b, b * (warm ? 0.92 : 0.97), b * (warm ? 0.8 : 1.0)], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  scene.add(stars);

  // start pose: show the Atlantic/Africa side, slightly tilted
  const startRot = lonLatToRot(10, 12);
  spin.rotation.y = startRot.y; tilt.rotation.x = startRot.x;
  let idle = true, running = true, viewShift = 0;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    viewShift = w > 820 ? 190 : 0;           // keep the globe left of the side panel
    const yShift = w > 820 ? 0 : Math.round(h * 0.18);
    camera.setViewOffset(w, h, viewShift, yShift, w, h);
    camera.updateProjectionMatrix();
    if (idle) camera.position.z = camera.aspect < 1 ? Math.min(8, 3.1 / camera.aspect) : 4.4;
  }
  resize();
  window.addEventListener('resize', resize);

  let last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (idle) spin.rotation.y += dt * 0.06;
    clouds.rotation.y += dt * 0.012;
    stars.rotation.y += dt * 0.003;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const ready = Promise.all([load('assets/earth/day.jpg'), load('assets/earth/night.jpg'), load('assets/earth/water.jpg'), load('assets/earth/clouds.jpg')])
    .then(([d, n, w, c]) => {
      earthMat.uniforms.dayTex.value = d; earthMat.uniforms.nightTex.value = n;
      earthMat.uniforms.waterTex.value = w; cloudMat.uniforms.tex.value = c;
      return !!d;
    });

  function flyTo(lon, lat, ms, endDist) {
    idle = false;
    const t = lonLatToRot(lon, lat);
    const y0 = spin.rotation.y, x0 = tilt.rotation.x, z0 = camera.position.z;
    let dy = ((t.y - y0) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (dy > -0.6) dy -= Math.PI * 2;          // always sweep eastward, at least a good part of a turn
    if (REDUCED) ms = 0;
    return new Promise(resolve => {
      const t0 = performance.now();
      (function step(now) {
        const k = ms ? clamp((now - t0) / ms, 0, 1) : 1;
        const e = ease(k);
        spin.rotation.y = y0 + dy * e;
        tilt.rotation.x = x0 + (t.x - x0) * e;
        const ez = k < 0.35 ? 0 : ease((k - 0.35) / 0.65);
        camera.position.z = z0 + (endDist - z0) * ez;
        if (k < 1) requestAnimationFrame(step); else resolve();
      })(t0);
    });
  }

  function dispose() {
    running = false;
    window.removeEventListener('resize', resize);
    renderer.dispose();
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    [earthMat.uniforms.dayTex, earthMat.uniforms.nightTex, earthMat.uniforms.waterTex, cloudMat.uniforms.tex].forEach(u => u.value && u.value.dispose());
  }

  return { ready, flyTo, dispose };
}

/* ======================= Photo cube: the team's render rebuilt as a real 3D cube ======================= */
function createPhotoCube(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.75, 6.6);
  camera.lookAt(0, 0.42, 0);

  const loader = new THREE.TextureLoader();
  const tex = url => { const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const leftT = tex('assets/cube/left.webp'), rightT = tex('assets/cube/right.webp'), canopyT = tex('assets/cube/canopy.webp');
  const lightDir = new THREE.Vector3(-0.35, 0.55, 0.75).normalize();

  const faceMat = map => new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, time: { value: 0 }, lightDir: { value: lightDir } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform float time; uniform vec3 lightDir;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec3 n = normalize(vN), v = normalize(vV);
        vec3 c = texture2D(map, vUv).rgb;
        float ndv = clamp(dot(n, v), 0.0, 1.0);
        c *= 0.74 + 0.4 * max(dot(n, lightDir), 0.0);
        float fres = pow(1.0 - ndv, 2.4);
        vec3 rb = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fres * 1.4 + vUv.x * 0.7 + vUv.y * 0.3 + time * 0.04));
        c += rb * (0.02 + fres * 0.16);
        float band = smoothstep(0.07, 0.0, abs(fract(vP.x * 0.16 + vP.y * 0.12 - time * 0.11) - 0.5));
        c += vec3(1.0, 1.0, 0.94) * band * (0.12 + fres * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const top = new THREE.MeshBasicMaterial({ map: tex('assets/cube/top.webp'), color: 0xb0a090 });
  const bottom = new THREE.MeshBasicMaterial({ color: 0x0c140d });
  const mats = [faceMat(rightT), faceMat(rightT), top, bottom, faceMat(leftT), faceMat(leftT)];
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mats);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.006, 2.006, 2.006)), new THREE.LineBasicMaterial({ color: 0xf2fbe8, transparent: true, opacity: 0.55 }));

  // the canopy stays facing the camera while the cube turns beneath it
  const cw = 1400 / 419, ch = 400 / 419;
  const canopy = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), new THREE.MeshBasicMaterial({ map: canopyT, transparent: true, alphaTest: 0.08, depthTest: false, depthWrite: false }));
  canopy.renderOrder = 10;
  canopy.position.set(0, 1 + ch * (0.5 - (400 - 326) / 400), 0);

  const spinG = new THREE.Group(); spinG.add(box); spinG.add(edges);
  const floatG = new THREE.Group(); floatG.add(spinG); floatG.add(canopy);
  scene.add(floatG);

  let running = false, spin = -Math.PI / 4, dragging = false, lastX = 0, vel = 0, t0 = 0, last = 0, intro = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t0 += dt;
    if (!dragging) { vel *= 0.94; spin += dt * (REDUCED ? 0 : 0.28) + vel; }
    spinG.rotation.y = spin;
    floatG.position.y = REDUCED ? 0 : Math.sin(t0 * 1.1) * 0.06;
    mats.forEach(m => { if (m.uniforms) m.uniforms.time.value = t0; });
    if (intro < 1) { intro = Math.min(1, intro + dt * 1.3); const k = ease(intro); floatG.scale.setScalar(0.82 + 0.18 * k); }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!dragging) return; const d = (e.clientX - lastX) * 0.01; spin += d; vel = d * 0.25; lastX = e.clientX; });
  const up = () => { dragging = false; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  return {
    show() { resize(); intro = REDUCED ? 1 : 0; if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } },
    stop() { running = false; },
    resize
  };
}

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

window.GS3 = webglOK() ? { createEarth, createPhotoCube } : null;
window.dispatchEvent(new Event('gs3'));
